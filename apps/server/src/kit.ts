/**
 * Kit generation: the one place the engine runs.
 *
 * The engine is pure and stays untouched -- the server imports it as a library.
 * The whole job of this file is to rebuild the exact `CaptureSet` the engine
 * expects out of stored rows, so that a kit generated through the server is
 * byte-identical to one `pnpm skeleton` would have written from the same
 * captures. Three things make that true, and all three are easy to break:
 *
 *   - records are handed back verbatim, exactly as they were stored;
 *   - capture order comes from the group's membership positions -- or, for a
 *     selection, from the library's own insertion order rather than from the
 *     order the ids happened to arrive in -- never from whatever order the
 *     database felt like;
 *   - the set's id, name and description come from the group, which an import
 *     copies from the incoming set.
 *
 * `test/kit-determinism.test.ts` asserts the result against the committed
 * `examples/`, so a regression here fails rather than quietly producing a
 * different kit than the CLI would.
 */
import {
  CAPTURE_SCHEMA_VERSION,
  ENGINE_VERSION,
  applyOverrides,
  asEffective,
  asPristine,
  distill,
  renderDesignMarkdown,
  serializeTokens,
} from '@ingot/engine'
import type {
  CaptureSet,
  EffectiveTokens,
  OverrideReport,
  TokenOverride,
  TokensDocument,
} from '@ingot/engine'
import type { Capture, Kit, KitScope, ReviewScope, StoredOverride, Store } from './storage/store'

/** Set identity used when distilling the whole library rather than one group. */
export const LIBRARY_SET = {
  slug: 'library',
  name: 'Ingot library',
  description: 'Every capture currently in this Ingot library, distilled as one kit.',
} as const

/**
 * Set identity used when distilling an ad-hoc selection.
 *
 * The description carries the count rather than the ids: it is prose the engine
 * prints at the top of `design.md`, and a list of twelve opaque ids there would
 * be noise. The count is a function of the selection, so the bytes stay a
 * function of the input -- which is the rule the whole file exists to keep.
 */
export const SELECTION_SET = {
  slug: 'selection',
  name: 'Selected captures',
} as const

function selectionDescription(count: number): string {
  return `${count} capture${count === 1 ? '' : 's'} selected from this Ingot library, distilled as one kit.`
}

/**
 * What a generation run is pointed at.
 *
 * A group and the library are durable scopes and are named by what they are. A
 * selection is a set of capture ids and nothing else -- it has no name, no
 * description and no lifetime beyond the click that made it, which is exactly
 * why it is a distinct kind here rather than a group the server invents.
 */
export type KitTarget =
  | { kind: 'group'; groupId: string }
  | { kind: 'library' }
  | { kind: 'selection'; captureIds: readonly string[] }

/** The target a `groupId` alone names: the library, or one group. */
export function targetFor(groupId: string | null): KitTarget {
  return groupId === null ? { kind: 'library' } : { kind: 'group', groupId }
}

export class KitGenerationError extends Error {
  readonly status: 404 | 422

  constructor(message: string, status: 404 | 422 = 422) {
    super(message)
    this.name = 'KitGenerationError'
    this.status = status
  }
}

/**
 * The captures a selection names, in the library's own order.
 *
 * Deliberately *not* the order the ids arrived in. A selection is a set: the
 * same six captures ticked in a different order are the same six captures, and
 * a kit whose bytes depended on click order would not be deterministic in any
 * sense a user could rely on. The library's insertion order is total and
 * stable, so it is the one order a selection can be handed to the engine in.
 */
async function selectedCaptures(store: Store, captureIds: readonly string[]): Promise<Capture[]> {
  if (captureIds.length === 0) {
    throw new KitGenerationError('select at least one capture before generating a kit from a selection')
  }
  const wanted = new Set(captureIds)
  const library = await store.captures.list()
  const found = library.filter((capture) => wanted.has(capture.id))
  if (found.length !== wanted.size) {
    const have = new Set(found.map((capture) => capture.id))
    const missing = [...wanted].filter((id) => !have.has(id)).sort(compareIds)
    throw new KitGenerationError(`no capture with id ${missing.join(', ')}`, 404)
  }
  return found
}

/** Locale-independent, like every other comparator the product sorts with. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Rebuild the engine's input from stored captures. Exported for the tests. */
export async function buildCaptureSet(store: Store, target: KitTarget): Promise<CaptureSet> {
  const { identity, captures } = await resolve(store, target)
  // A selection cannot reach here empty -- `selectedCaptures` refuses one --
  // so the two messages below are the only two this can be.
  if (captures.length === 0) {
    throw new KitGenerationError(
      target.kind === 'group'
        ? 'that group has no captures yet; add some before generating a kit'
        : 'the library has no captures yet; import a capture set before generating a kit',
    )
  }

  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    id: identity.slug,
    name: identity.name,
    description: identity.description,
    captures: captures.map((capture) => capture.record),
  }
}

interface SetIdentity {
  slug: string
  name: string
  description: string
}

async function resolve(
  store: Store,
  target: KitTarget,
): Promise<{ identity: SetIdentity; captures: Capture[] }> {
  if (target.kind === 'group') {
    const group = await store.groups.get(target.groupId)
    if (!group) throw new KitGenerationError(`no group with id ${target.groupId}`, 404)
    return {
      identity: { slug: group.slug, name: group.name, description: group.description },
      captures: await store.captures.list({ groupId: target.groupId }),
    }
  }
  if (target.kind === 'selection') {
    const captures = await selectedCaptures(store, target.captureIds)
    return {
      identity: { ...SELECTION_SET, description: selectionDescription(captures.length) },
      captures,
    }
  }
  return { identity: LIBRARY_SET, captures: await store.captures.list() }
}

export interface GeneratedKit {
  kit: Kit
  tokens: TokensDocument
}

/** Distil a target and store the result as a new kit version. */
export async function generateKit(store: Store, target: KitTarget): Promise<GeneratedKit> {
  const set = await buildCaptureSet(store, target)
  const tokens = distill(set)
  const scope: KitScope = target.kind
  const kit = await store.kits.create({
    groupId: target.kind === 'group' ? target.groupId : null,
    scope,
    setId: tokens.source.setId,
    name: set.name,
    engineVersion: ENGINE_VERSION,
    captureIds: set.captures.map((capture) => capture.id),
    tokensJson: serializeTokens(tokens),
    designMd: renderDesignMarkdown(tokens),
    warningCount: tokens.diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length,
  })
  return { kit, tokens }
}

/**
 * The review scope a kit belongs to.
 *
 * `null` is the library, and a **selection kit reviews there too**: a selection
 * is a lens on the library rather than a collection of its own, so a reviewer's
 * decisions about one are decisions about the pool it was drawn from. The
 * alternative -- a review scope keyed to the ad-hoc selection -- would store
 * overrides under an identity nothing can ever reach again, which is a decision
 * that disappears silently the moment the user unticks a box. A reviewer who
 * wants a lineage of their own groups the selection, which is one click away in
 * the same bar.
 *
 * An orphaned group kit -- one whose group was deleted -- has a null `groupId`
 * but is still a group kit, and it has no scope left to carry overrides for;
 * returning `undefined` says exactly that, rather than quietly handing it the
 * library's review state.
 */
export function reviewScopeOf(kit: Pick<Kit, 'scope' | 'groupId'>): ReviewScope | undefined {
  if (kit.scope !== 'group') return null
  return kit.groupId === null ? undefined : kit.groupId
}

/**
 * A kit as the panel and every export see it: the engine's answer with the
 * reviewer's on top.
 *
 * The stored kit is never rewritten. `tokensJson` and `designMd` on the row stay
 * byte-identical to what `pnpm skeleton` would have written, which is what
 * `test/kit-determinism.test.ts` holds the server to; overrides are replayed on
 * read instead. That also means an override is not frozen into a version: edit
 * one and every surface turns, without regenerating anything.
 */
export interface EffectiveKit {
  kit: Kit
  /** The kit as it is rendered and exported: every override replayed. */
  tokens: EffectiveTokens
  designMd: string
  tokensJson: string
  overrides: StoredOverride[]
  /**
   * What the engine determined while replaying them: the conflicts standing,
   * the retirements, the convergences, and what it was refused. The server
   * carries this report; it never works one out.
   */
  report: OverrideReport
  /** Card ids the reviewer has accepted, sorted. */
  accepted: string[]
}

/** The report for a kit nobody has overridden: everything empty, nothing said. */
const NO_REVIEW: OverrideReport = {
  applied: [],
  conflicts: [],
  converged: [],
  retired: [],
  rejected: [],
}

/** Apply a scope's standing review state to one stored kit. */
export async function effectiveKit(store: Store, kit: Kit): Promise<EffectiveKit> {
  const scope = reviewScopeOf(kit)
  const overrides = scope === undefined ? [] : await store.reviews.overrides(scope)
  const accepted = scope === undefined ? [] : (await store.reviews.decisions(scope)).map((entry) => entry.cardId)

  if (overrides.length === 0) {
    // Nothing to replay: hand back the stored strings rather than a re-rendered
    // copy of them, so "no overrides" is byte-identical by construction and not
    // merely by the serializer behaving.
    return {
      kit,
      // With nothing overridden the stored distillation *is* the effective
      // document, which is what makes handing back its own bytes sound.
      tokens: asEffective(JSON.parse(kit.tokensJson) as TokensDocument),
      designMd: kit.designMd,
      tokensJson: kit.tokensJson,
      overrides,
      report: NO_REVIEW,
      accepted,
    }
  }

  const base = asPristine(JSON.parse(kit.tokensJson) as TokensDocument)
  const result = applyOverrides(base, overrides.map(toEngineOverride))
  return {
    kit,
    tokens: result.tokens,
    // The whole result, not just its document: `design.md` states what a
    // reviewer answered and what the engine said when they answered it, and
    // those come from the engine's report rather than from a second reading of
    // the document it produced.
    designMd: renderDesignMarkdown(result),
    tokensJson: serializeTokens(result.tokens),
    overrides,
    report: result.report,
    accepted,
  }
}

/** The engine takes a note only when there is one; an empty string is not one. */
export function toEngineOverride(stored: StoredOverride): TokenOverride {
  const override: TokenOverride = { path: stored.path, value: stored.value, baseValue: stored.baseValue }
  if (stored.note !== '') override.note = stored.note
  if (stored.resolvedConflict !== undefined) override.resolvedConflict = stored.resolvedConflict
  if (stored.suggestedBy !== undefined) override.suggestedBy = stored.suggestedBy
  return override
}
