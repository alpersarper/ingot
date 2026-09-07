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
 *   - capture order comes from the group's membership positions, never from
 *     whatever order the database felt like;
 *   - the set's id, name and description come from the group, which an import
 *     copies from the incoming set.
 *
 * `test/kit-determinism.test.ts` asserts the result against the committed
 * `examples/`, so a regression here fails rather than quietly producing a
 * different kit than the CLI would.
 */
import { CAPTURE_SCHEMA_VERSION, ENGINE_VERSION, distill, renderDesignMarkdown, serializeTokens } from '@ingot/engine'
import type { CaptureSet, TokensDocument } from '@ingot/engine'
import type { Kit, Store } from './storage/store'

/** Set identity used when distilling the whole library rather than one group. */
export const LIBRARY_SET = {
  slug: 'library',
  name: 'Ingot library',
  description: 'Every capture currently in this Ingot library, distilled as one kit.',
} as const

export class KitGenerationError extends Error {
  readonly status: 404 | 422

  constructor(message: string, status: 404 | 422 = 422) {
    super(message)
    this.name = 'KitGenerationError'
    this.status = status
  }
}

/** Rebuild the engine's input from stored captures. Exported for the tests. */
export async function buildCaptureSet(store: Store, groupId: string | null): Promise<CaptureSet> {
  const identity =
    groupId === null
      ? LIBRARY_SET
      : await (async () => {
          const group = await store.groups.get(groupId)
          if (!group) throw new KitGenerationError(`no group with id ${groupId}`, 404)
          return { slug: group.slug, name: group.name, description: group.description }
        })()

  const captures = await store.captures.list(groupId === null ? {} : { groupId })
  if (captures.length === 0) {
    throw new KitGenerationError(
      groupId === null
        ? 'the library has no captures yet; import a capture set before generating a kit'
        : 'that group has no captures yet; add some before generating a kit',
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

export interface GeneratedKit {
  kit: Kit
  tokens: TokensDocument
}

/** Distil a group (or the whole library) and store the result as a new kit version. */
export async function generateKit(store: Store, groupId: string | null): Promise<GeneratedKit> {
  const set = await buildCaptureSet(store, groupId)
  const tokens = distill(set)
  const kit = await store.kits.create({
    groupId,
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
