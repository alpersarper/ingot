/**
 * User overrides: the reviewer's answer replacing the engine's.
 *
 * The product stance is "decisive but overridable" -- the engine picks the
 * dominant direction and shows its reasoning, and a human disagreeing with it
 * in the panel is the experience rather than an escape hatch. That makes an
 * override a first-class provenance state, not an annotation bolted on top, and
 * it makes this module part of the engine rather than part of the panel:
 *
 *   - it must be **pure and deterministic**, because a kit with overrides is
 *     still a kit and `design.md` still has to be byte-identical run to run;
 *   - it must **re-check what the override invalidated**. A hand-set colour that
 *     drops a guaranteed pair under its floor has to say so out loud, exactly as
 *     a distilled one would;
 *   - it must **report conflicts rather than resolve them**. When fresh evidence
 *     disagrees with a standing override, neither side is silently clobbered:
 *     the override wins the value and the disagreement becomes a diagnostic.
 *
 * {@link applyOverrides} is a function of `(tokens, overrides)` and nothing
 * else. The panel stores overrides, the server replays them; the answer is the
 * same wherever it is computed.
 *
 * It is also the *only* place those answers are worked out. Every one of them
 * -- whether a value conflicts, what the engine said when it was set, what it
 * says now, whether a write retired a conflict, whether the evidence has caught
 * up -- depends on which of the three documents in `./documents` was consulted,
 * and picking one is a decision a caller cannot make well from outside. So the
 * two entry points hand back a report rather than the material to build one:
 * {@link applyOverrides} returns the effective document with its
 * {@link OverrideReport}, and {@link planOverrideWrite} returns the row to
 * store. Nothing outside this module needs the baseline, and nothing outside it
 * should have an opinion about a conflict.
 */
import { contrastRatio, formatOklch, oklchToHex, parseColor, roundOklch } from '../color/space'
import type { Oklch } from '../color/space'
import { enforceContrastByChroma, enforceContrastOnBackground } from '../color/contrast'
import { SHADE_RELATIONS, deriveInteractionShades } from '../color/roles'
import type { RoleAssignment } from '../color/roles'
import { parseShadow } from '../shadow/shadow'
import { round } from '../util/num'
import { byString, chain } from '../util/sort'
import { derive, userOverride } from '../provenance'
import type { BaselineTokens, EffectiveTokens, PristineTokens } from './documents'
import type { DominantChoice, Provenance, ResolvedConflict } from '../provenance'
import type { ContrastAdjustment } from '../color/contrast'
import type {
  ColorRoleName,
  ColorToken,
  ComponentRecipe,
  Diagnostic,
  RadiusStepName,
  ShadowStepName,
  Token,
  TokensDocument,
  TypeStepName,
} from './types'

/** What a slot holds, which is what its replacement has to parse as. */
export type OverrideKind =
  | 'color'
  | 'length'
  | 'ratio'
  | 'weight'
  | 'shadow'
  | 'font-stack'
  | 'radius-step'
  | 'type-step'

/** Which part of the document a slot belongs to. The panel groups by this. */
export type OverrideGroup =
  | 'color'
  | 'spacing'
  | 'radius'
  | 'border'
  | 'shadow'
  | 'typography'
  | 'component'
  | 'state'

/**
 * One overridable position in a tokens document.
 *
 * The list is the contract between the engine and the panel: a path the panel
 * offers but {@link applyOverrides} cannot write would be an edit that silently
 * did nothing, so both sides read the same enumeration.
 */
export interface TokenSlot {
  /** Dotted path, e.g. `"components.recipes.button.primary.paddingX"`. */
  path: string
  group: OverrideGroup
  /** Short human label, unique within its group. */
  label: string
  kind: OverrideKind
  /** The current value in decision notation (`"8px"`, `"#0f7a5a"`, `"md"`). */
  value: string
  provenance: Provenance
  /** Present when the contrast floor moved this colour during distillation. */
  contrastAdjustment?: ContrastAdjustment
}

/** A value a human set by hand, as it is stored and replayed. */
export interface TokenOverride {
  path: string
  /** The replacement, in the same notation as {@link TokenSlot.value}. */
  value: string
  /**
   * What the engine had at this path when the override was made.
   *
   * This is the whole conflict mechanism: on a later regeneration the engine's
   * answer is compared against this, not against the override, so "the evidence
   * moved" is distinguishable from "you disagreed with the engine". It is read
   * from the *baseline* -- the same document class the comparison is later made
   * against, because a value recorded from one document and compared against
   * another reports disagreements neither of them ever had.
   */
  baseValue?: string
  /** The reviewer's own reason, carried into `design.md`. */
  note?: string
  /**
   * The conflict this value was chosen in answer to, when it was.
   *
   * Set by the write path when a reviewer changes an override while fresh
   * evidence disagrees with it: that write retires the `override.conflict`
   * report, so what retired it is recorded on the token rather than the report
   * simply going quiet. It describes one answered disagreement and is not a
   * standing claim: a later value change that answered nothing arrives without
   * it, and a path the engine reports as still in conflict is one `design.md`
   * does not describe as answered.
   */
  resolvedConflict?: ResolvedConflict
  /**
   * Where the value the reviewer accepted came from, when it was not their own.
   *
   * `'assistant'` means a proposal the assistant made and a person accepted.
   * The decision is still theirs -- the assistant has no write path -- so this
   * changes nothing about how the value is applied, only what the kit is able
   * to say about it. Absent is the ordinary case: the reviewer typed it.
   */
  suggestedBy?: 'assistant'
}

/** An override that landed. */
export interface AppliedOverride {
  path: string
  value: string
  /** The engine's answer for this path, with every other override in force. */
  engineValue: string
  note?: string
}

/**
 * An override whose evidence has moved since it was made.
 *
 * The override still wins -- an override that new evidence could quietly undo
 * would not be an override. This is a report, and it is deliberately a warning
 * diagnostic so it travels into `design.md` with everything else the kit is
 * honest about.
 */
export interface OverrideConflict {
  path: string
  /** The value the reviewer set. */
  value: string
  /** What the engine said when the override was made. */
  baseValue: string
  /** What the engine says now. */
  engineValue: string
  message: string
}

/** An override that could not be applied, and why. */
export interface RejectedOverride {
  path: string
  value: string
  reason: string
}

/**
 * A standing override the evidence has caught up with.
 *
 * The reviewer set a value the engine has since arrived at independently. The
 * value is the same either way, so nothing changes on screen -- but the
 * decision stays attributed to the person who made it rather than being quietly
 * handed back to the engine, and the convergence is reported once.
 */
export interface ConvergedOverride {
  path: string
  /** The value both the reviewer and the engine now name. */
  value: string
}

/**
 * A conflict a reviewer answered, and the answer still standing.
 *
 * The retirement is reported rather than left to be inferred from a warning
 * that stopped appearing. A path the engine reports as *still* in conflict is
 * not in this list: one document must not call the same disagreement both
 * answered and open.
 */
export interface RetiredConflict {
  path: string
  /** The value the effective document now holds: how the reviewer answered. */
  value: string
  /**
   * The disagreement that answer retired, as the reviewer's own write recorded
   * it -- the abandoned value, the engine's answer when it was set, and the
   * engine's answer that was actually responded to. Every number a surface
   * needs to describe the retirement is here, so none of them is re-derived
   * from the engine's answer in *this* version, which nobody answered.
   */
  answered: ResolvedConflict
}

/**
 * Everything replaying a set of overrides decided, beside the document itself.
 *
 * This is the engine's report, and it is the only account of these questions
 * there is: no caller determines a conflict, a retirement, a convergence or an
 * engine value of its own, because each of those answers depends on which of
 * the three documents it was asked of and that choice is made in here.
 */
export interface OverrideReport {
  applied: AppliedOverride[]
  conflicts: OverrideConflict[]
  converged: ConvergedOverride[]
  retired: RetiredConflict[]
  rejected: RejectedOverride[]
}

/**
 * The effective document and the report that goes with it.
 *
 * They travel together on purpose: every surface that states what an override
 * answered takes this pair, so there is no way to render the document while
 * re-deriving the report's numbers from it.
 */
export interface OverrideResult {
  /** A new document, with every override in it. The input is never mutated. */
  tokens: EffectiveTokens
  report: OverrideReport
}

/* -------------------------------------------------------------- the slots -- */

const RADIUS_ORDER: RadiusStepName[] = ['none', 'sm', 'md', 'lg', 'full']
const SHADOW_ORDER: ShadowStepName[] = ['none', 'sm', 'md', 'lg']

/**
 * Every position in `tokens` a reviewer may replace, in document order.
 *
 * Document order rather than alphabetical: the panel reads top to bottom the
 * way the kit is built up, and the order is fixed by this function rather than
 * by object iteration so two runs list the same slots in the same places.
 */
export function tokenSlots(tokens: TokensDocument): TokenSlot[] {
  const slots: TokenSlot[] = []

  for (const [name, token] of Object.entries(tokens.color.roles)) {
    if (token === undefined) continue
    const slot: TokenSlot = {
      path: `color.roles.${name}`,
      group: 'color',
      label: name,
      kind: 'color',
      value: token.value.hex,
      provenance: token.provenance,
    }
    if (token.contrastAdjustment !== undefined) slot.contrastAdjustment = token.contrastAdjustment
    slots.push(slot)
  }

  for (const step of tokens.spacing.steps) {
    slots.push({
      path: `spacing.steps.${step.value.name}`,
      group: 'spacing',
      label: `${step.value.name} (${step.value.band})`,
      kind: 'length',
      value: `${step.value.px}px`,
      provenance: step.provenance,
    })
  }

  slots.push({
    path: 'border.width',
    group: 'border',
    label: 'width',
    kind: 'length',
    value: `${tokens.border.width.value}px`,
    provenance: tokens.border.width.provenance,
  })

  for (const name of RADIUS_ORDER) {
    const token = tokens.radius.steps[name]
    if (token === undefined) continue
    slots.push({
      path: `radius.steps.${name}`,
      group: 'radius',
      label: name,
      kind: 'length',
      value: `${token.value}px`,
      provenance: token.provenance,
    })
  }

  for (const name of SHADOW_ORDER) {
    const token = tokens.shadow.steps[name]
    if (token === undefined) continue
    slots.push({
      path: `shadow.steps.${name}`,
      group: 'shadow',
      label: name,
      kind: 'shadow',
      value: token.value.css,
      provenance: token.provenance,
    })
  }

  slots.push({
    path: 'typography.families.sans',
    group: 'typography',
    label: 'sans stack',
    kind: 'font-stack',
    value: tokens.typography.families.sans.value,
    provenance: tokens.typography.families.sans.provenance,
  })
  const mono = tokens.typography.families.mono
  if (mono !== undefined) {
    slots.push({
      path: 'typography.families.mono',
      group: 'typography',
      label: 'mono stack',
      kind: 'font-stack',
      value: mono.value,
      provenance: mono.provenance,
    })
  }

  // A type step is one token behind three slots, so each slot is given the
  // provenance that answers for *its* field rather than the step's shared
  // record -- otherwise overriding the size would label the line height and the
  // weight as hand-set too. {@link fieldProvenance} reads the decision's own
  // `fields` record; nothing downstream has to work it out again.
  for (const step of tokens.typography.steps) {
    const base = `typography.steps.${step.value.name}`
    slots.push({
      path: `${base}.fontSize`,
      group: 'typography',
      label: `${step.value.name} size`,
      kind: 'length',
      value: `${step.value.fontSize}px`,
      provenance: fieldProvenance(step.provenance, 'fontSize'),
    })
    slots.push({
      path: `${base}.lineHeight`,
      group: 'typography',
      label: `${step.value.name} line height`,
      kind: 'ratio',
      value: String(step.value.lineHeight),
      provenance: fieldProvenance(step.provenance, 'lineHeight'),
    })
    slots.push({
      path: `${base}.fontWeight`,
      group: 'typography',
      label: `${step.value.name} weight`,
      kind: 'weight',
      value: String(step.value.fontWeight),
      provenance: fieldProvenance(step.provenance, 'fontWeight'),
    })
  }

  for (const recipe of tokens.components.recipes) {
    const base = `components.recipes.${recipe.name}`
    slots.push(
      recipeSlot(base, recipe.name, 'height', 'length', `${recipe.height.value}px`, recipe.height),
      recipeSlot(base, recipe.name, 'paddingY', 'length', `${recipe.paddingY.value}px`, recipe.paddingY),
      recipeSlot(base, recipe.name, 'paddingX', 'length', `${recipe.paddingX.value}px`, recipe.paddingX),
      recipeSlot(base, recipe.name, 'radius', 'radius-step', recipe.radius.value, recipe.radius),
      recipeSlot(base, recipe.name, 'typeStep', 'type-step', recipe.typeStep.value, recipe.typeStep),
      recipeSlot(base, recipe.name, 'fontWeight', 'weight', String(recipe.fontWeight.value), recipe.fontWeight),
    )
  }

  const ring = tokens.components.states.focusRing
  slots.push(
    {
      path: 'components.states.focusRing.width',
      group: 'state',
      label: 'focus ring width',
      kind: 'length',
      value: `${ring.width.value}px`,
      provenance: ring.width.provenance,
    },
    {
      path: 'components.states.focusRing.offset',
      group: 'state',
      label: 'focus ring offset',
      kind: 'length',
      value: `${ring.offset.value}px`,
      provenance: ring.offset.provenance,
    },
  )

  return slots
}

function recipeSlot(
  base: string,
  recipe: string,
  field: string,
  kind: OverrideKind,
  value: string,
  token: Token<unknown>,
): TokenSlot {
  return {
    path: `${base}.${field}`,
    group: 'component',
    label: `${recipe} ${field}`,
    kind,
    value,
    provenance: token.provenance,
  }
}

/**
 * Whether a decision answers for `field`.
 *
 * A decision with no `fields` record answers for the whole token, which is what
 * every engine decision and every override on a single-valued token is.
 */
function covers(decision: DominantChoice, field: string): boolean {
  return decision.fields === undefined || decision.fields.includes(field)
}

/**
 * The decision that answers for one field of a multi-field token.
 *
 * Overriding a type step's size leaves the line height and the weight where the
 * engine put them, but all three read one provenance record. Walking the
 * `supersedes` chain past the overrides that named other fields is what lets a
 * slot report its own authority: the size says "yours", the line height still
 * says what the engine decided and why. The chain is walked for `supersedes`
 * too, so "the engine chose" on an overridden field names the engine's decision
 * rather than another field's override -- and the decision it lands on reports
 * *this* field's prior value, from the `supersededValue` the override recorded,
 * rather than the token-wide `chosen` that answers for the size. The replaced
 * decision is copied rather than rewritten, because the sibling fields still
 * read it and it answers differently for each of them.
 */
function decisionForField(decision: DominantChoice, field: string): DominantChoice {
  let current = decision
  while (current.strategy === 'user-override' && !covers(current, field)) {
    const next = current.supersedes
    if (next === undefined) break
    current = next
  }
  if (current.strategy !== 'user-override' || current.supersedes === undefined) return current
  const resolved = decisionForField(current.supersedes, field)
  const superseded =
    current.supersededValue === undefined || resolved.chosen === current.supersededValue
      ? resolved
      : { ...resolved, chosen: current.supersededValue }
  return superseded === current.supersedes ? current : { ...current, supersedes: superseded }
}

/** A token's provenance as one of its fields sees it. */
function fieldProvenance(provenance: Provenance, field: string): Provenance {
  const decision = decisionForField(provenance.decision, field)
  return decision === provenance.decision ? provenance : { ...provenance, decision }
}

/** The current value at `path`, or `null` when the path is not a slot. */
export function readTokenValue(tokens: TokensDocument, path: string): string | null {
  return tokenSlots(tokens).find((slot) => slot.path === path)?.value ?? null
}

/* --------------------------------------------------------------- parsing -- */

interface Parsed {
  /** Canonical form, which is what is stored and compared. */
  canonical: string
}

function parseLength(raw: string): Parsed | string {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(raw)
  if (!match) return 'expected a pixel length such as "12px"'
  const value = round(Number(match[1]), 2)
  if (value < 0) return 'a length cannot be negative'
  if (value > 512) return 'a length above 512px is outside anything this kit describes'
  return { canonical: `${value}px` }
}

function parseRatio(raw: string): Parsed | string {
  const value = Number(raw.trim())
  if (!Number.isFinite(value)) return 'expected a unitless ratio such as 1.5'
  if (value < 0.5 || value > 4) return 'a line height outside 0.5-4 is not a line height'
  return { canonical: String(round(value, 3)) }
}

function parseWeight(raw: string): Parsed | string {
  const value = Number(raw.trim())
  if (!Number.isInteger(value)) return 'expected a whole font weight such as 500'
  if (value < 1 || value > 1000) return 'a font weight outside 1-1000 is not a font weight'
  return { canonical: String(value) }
}

function parseHex(raw: string): Parsed | string {
  const color = readColor(raw)
  if (color === undefined) return 'expected a colour such as "#0f7a5a" or "oklch(0.5 0.1 150)"'
  return { canonical: oklchToHex(color) }
}

/** A colour in the engine's own working space, or `undefined` if unreadable. */
function readColor(raw: string): Oklch | undefined {
  return parseColor(raw.trim())?.oklch
}

function parseShadowValue(raw: string): Parsed | string {
  const text = raw.trim()
  if (text === '' || text === 'none') return { canonical: 'none' }
  // `parseShadow` returns the canonical form, so two spellings of one shadow
  // compare equal and an override that restates the engine's value is caught.
  const parsed = parseShadow(text)
  if (parsed === undefined) {
    return 'expected a CSS box-shadow such as "0px 1px 2px 0px rgb(0 0 0 / 0.08)", or "none"'
  }
  return { canonical: parsed.css }
}

/**
 * What a font stack may be made of.
 *
 * A stack is family names separated by commas, each an identifier or a quoted
 * string. Nothing else belongs in one -- and this is the canonicalisation
 * point, the last place a value is judged before every surface renders it. A
 * stack carrying `}`, `;` or `</style>` would escape the CSS rule it is emitted
 * into and silently truncate the stylesheet around it, so those characters are
 * refused here rather than left for each consumer to remember to escape.
 */
const FONT_STACK_CHARACTERS = /^[A-Za-z0-9 ,._'"-]+$/

function parseFontStack(raw: string): Parsed | string {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (text === '') return 'a font stack cannot be empty'
  if (text.length > 300) return 'that font stack is longer than any this kit would emit'
  if (!FONT_STACK_CHARACTERS.test(text)) {
    return (
      'a font stack is family names separated by commas: letters, digits, spaces, commas, quotes, ' +
      'hyphens, underscores and full stops only'
    )
  }
  return { canonical: text }
}

/* -------------------------------------------------------------- applying -- */

/** One replay of a set of overrides: the values written, and nothing judged. */
interface Replay {
  tokens: TokensDocument
  /** The canonical value written for each override, by its position in the input. */
  written: Map<number, string>
  rejected: RejectedOverride[]
  /** Roles a human replaced, which is what the shade derivation pins. */
  colorTouched: Set<ColorRoleName>
  /** Slots the engine wanted to move and stepped aside from. */
  yielded: Set<string>
}

/**
 * Write `ordered` into a copy of `tokens` and recompute what they invalidated.
 *
 * Deliberately judges nothing: no conflicts, no convergence, no diagnostics.
 * That is what lets {@link applyOverrides} call it again, once per override, to
 * build the baseline each of those judgements has to be made against -- the
 * document with every *other* override in force. Doing it any other way means
 * two ideas of "the engine's current answer", which is the drift this split
 * exists to stop.
 */
function replay(tokens: TokensDocument, ordered: readonly TokenOverride[]): Replay {
  const next = clone(tokens)
  const written = new Map<number, string>()
  const rejected: RejectedOverride[] = []
  const slots = new Map(tokenSlots(next).map((slot) => [slot.path, slot]))
  const colorTouched = new Set<ColorRoleName>()
  const recipesTouched = new Set<string>()
  const yielded = new Set<string>()

  ordered.forEach((override, index) => {
    const slot = slots.get(override.path)
    if (slot === undefined) {
      rejected.push({
        path: override.path,
        value: override.value,
        reason: 'this kit has no such token, so there is nothing to override',
      })
      return
    }

    const parsed = parseFor(slot, next, override.value)
    if (typeof parsed === 'string') {
      rejected.push({ path: override.path, value: override.value, reason: parsed })
      return
    }

    write(
      next,
      slot,
      parsed.canonical,
      override.note,
      colorTouched,
      recipesTouched,
      override.resolvedConflict,
      override.suggestedBy,
    )
    written.set(index, parsed.canonical)
  })

  if (recipesTouched.size > 0) for (const path of recomputeHeights(next, recipesTouched)) yielded.add(path)
  if (colorTouched.size > 0) {
    const shades = rederiveShades(next, colorTouched)
    for (const path of shades.yielded) yielded.add(path)
    enforceShades(next, shades.rewritten)
    recomputeContrast(next)
    restateCollapsedStates(next)
    restateContrastAdjustments(next)
  }

  return { tokens: next, written, rejected, colorTouched, yielded }
}

/** Overrides in the order they are replayed, so a replay is a function of the set. */
function ordering(overrides: readonly TokenOverride[]): TokenOverride[] {
  return [...overrides].sort(chain<TokenOverride>((a, b) => byString(a.path, b.path)))
}

/**
 * The document a question about `path` is asked of.
 *
 * Every standing override *except* the one at `path`, replayed over the stored
 * distillation. That is the engine's current answer for the slot: the pristine
 * value is not it, because another override may have re-derived a control
 * height or an interaction shade out from under this one, and the effective
 * document is not it either, because it already contains the very value the
 * question is about.
 *
 * It is the engine's job rather than a caller's precisely so that the write
 * boundary and {@link applyOverrides} cannot end up asking about two different
 * documents -- which is how `design.md` came to report a conflict that had been
 * answered against a value nobody ever saw. Engine-internal for the same
 * reason: it is not exported from the package, so no caller can hold a baseline
 * at all, let alone ask it the wrong question.
 */
export function baselineFor(
  tokens: PristineTokens,
  overrides: readonly TokenOverride[],
  path: string,
): BaselineTokens {
  const others = overrides.filter((override) => override.path !== path)
  return replay(tokens, ordering(others)).tokens as BaselineTokens
}

/**
 * Replay `overrides` over a freshly distilled document.
 *
 * The result is a function of the two inputs alone: overrides are applied in
 * path order, unknown or unparseable ones are rejected rather than guessed at,
 * and everything an override invalidated -- contrast ratios, derived control
 * heights, the disabled pair -- is recomputed from the new values.
 *
 * Whether each one agrees with the engine or disagrees with it is decided
 * against that override's own baseline, one replay per override, because an
 * answer measured against the pristine value would be about a document nobody
 * is looking at. That choice of document is made here and nowhere else: what
 * comes back is the effective document *and* the report, so a surface states
 * what the engine determined rather than determining it again from the
 * document in front of it.
 */
export function applyOverrides(
  tokens: PristineTokens,
  overrides: readonly TokenOverride[],
): OverrideResult {
  const ordered = ordering(overrides)
  const result = replay(tokens, ordered)
  const next = result.tokens

  const applied: AppliedOverride[] = []
  const conflicts: OverrideConflict[] = []
  const converged: ConvergedOverride[] = []
  const retired: RetiredConflict[] = []

  ordered.forEach((override, index) => {
    const value = result.written.get(index)
    if (value === undefined) return

    // The engine's answer for this slot with every other override in force,
    // which is the only value it is honest to compare a standing decision
    // against. The exclusion is by position rather than by path so that the
    // question is about this override alone.
    const others = ordered.filter((_, other) => other !== index)
    const engineValue =
      readTokenValue(replay(tokens, others).tokens, override.path) ?? readTokenValue(tokens, override.path)
    if (engineValue === null) return

    const entry: AppliedOverride = { path: override.path, value, engineValue }
    if (override.note !== undefined && override.note !== '') entry.note = override.note
    applied.push(entry)

    if (value === engineValue) {
      // The evidence has caught up with a standing decision. Refusing it here
      // would strip the `user-override` mark off a value the reviewer really
      // did choose and hand the credit back to the engine, so the override
      // stands and the convergence is reported instead. A *candidate* that
      // agrees is a different thing and is still refused, at the write boundary
      // -- see {@link overrideRejection}.
      // A slot the engine wanted to move and stepped aside from is not
      // agreement, whatever the two values end up reading.
      if (!result.yielded.has(override.path)) converged.push({ path: override.path, value })
    } else {
      const conflict = conflictBetween(override, value, engineValue)
      if (conflict !== undefined) conflicts.push(conflict)
    }
  })

  // A retirement the reviewer's own write recorded, reported now that it is
  // known whether the same path is *also* in conflict. Reporting both of one
  // path would have the kit call a single disagreement answered and open at
  // once, so the open one wins and the record stays on the token, waiting for
  // the answer it describes to become true again.
  const open = new Set(conflicts.map((conflict) => conflict.path))
  ordered.forEach((override, index) => {
    if (result.written.get(index) === undefined) return
    const answered = override.resolvedConflict
    if (answered === undefined || open.has(override.path)) return
    // The value as the finished document holds it, not the canonical form that
    // was written into it: what a reader is told is now in force has to be what
    // the kit ships, after everything the write re-derived.
    const inForce = readTokenValue(next, override.path)
    if (inForce === null) return
    retired.push({ path: override.path, value: inForce, answered })
  })

  next.diagnostics = [
    ...next.diagnostics,
    ...overrideDiagnostics(next, applied, conflicts, converged, result.rejected, result.colorTouched),
  ]

  return {
    tokens: next as EffectiveTokens,
    report: { applied, conflicts, converged, retired, rejected: result.rejected },
  }
}

/**
 * The disagreement between one override and the engine's current answer.
 *
 * Two things have to be true for a conflict: the override still says something
 * different from the engine, *and* the engine has moved since the override was
 * made. An override the evidence has caught up with is convergence, not a
 * conflict, and an override the engine never agreed with in the first place is
 * simply an override.
 */
function conflictBetween(
  override: TokenOverride,
  value: string,
  engineValue: string,
): OverrideConflict | undefined {
  if (value === engineValue) return undefined
  if (override.baseValue === undefined || override.baseValue === engineValue) return undefined
  return {
    path: override.path,
    value,
    baseValue: override.baseValue,
    engineValue,
    message:
      `\`${override.path}\` was overridden to ${value} when the engine said ${override.baseValue}. ` +
      `The engine now says ${engineValue}. Your value is still in force; re-check it, or clear the override to take ${engineValue}.`,
  }
}

/**
 * The conflict a stored override stands in against `tokens`, or `undefined`.
 *
 * The same determination {@link applyOverrides} makes when it decides whether to
 * report `override.conflict`, asked of one override on its own.
 * {@link planOverrideWrite} needs it to know whether an edit *answered* a
 * conflict; it stays inside the engine because a caller that reimplemented the
 * predicate would drift from it, and `design.md` would go on to state that a
 * disagreement was answered when none was ever reported.
 */
export function standingConflict(
  tokens: BaselineTokens,
  override: TokenOverride,
): OverrideConflict | undefined {
  const slot = tokenSlots(tokens).find((entry) => entry.path === override.path)
  if (slot === undefined) return undefined
  const parsed = parseFor(slot, tokens, override.value)
  if (typeof parsed === 'string') return undefined
  return conflictBetween(override, parsed.canonical, slot.value)
}

/**
 * Why a candidate override would be refused, or `undefined` when it would land.
 *
 * {@link planOverrideWrite} needs this answer *before* anything is stored.
 * Storing first
 * and compensating afterwards is not the same thing: the store keys overrides
 * on `(scope, path)`, so writing a candidate that turns out to be unreadable
 * would already have destroyed whatever override was standing at that path, and
 * the compensating delete would then take the rest.
 *
 * It is also the only place the "agrees with the engine" refusal lives, and
 * that refusal is narrower than it looks:
 *
 *   - **`tokens` is the baseline**, not the pristine distillation. Replaying an
 *     override re-derives what depended on it, so the engine's current answer
 *     for a control height or an interaction shade is the re-derived value.
 *     Judging against the stored bytes would refuse a reviewer pinning a height
 *     back to what it was before another override moved it -- a value that
 *     genuinely disagrees with what the kit now says. {@link baselineFor} builds
 *     the document this takes: every other override replayed, this path's own
 *     left out. (`baseValue` is recorded from that same baseline, because it is
 *     an input to the conflict comparison later made against it.)
 *   - **`mode` says which question is being asked.** Creating an override that
 *     merely restates the baseline is not an override and is refused. Editing
 *     one that already stands -- a new value, a new reason, or the same value on
 *     an override the evidence has since caught up with -- is a decision the
 *     reviewer already owns, so the refusal does not apply and the row survives.
 *
 * A *standing* override the evidence later caught up with is never rejected at
 * all: {@link applyOverrides} keeps it and reports `override.now-agrees`.
 */
export function overrideRejection(
  tokens: BaselineTokens,
  candidate: { path: string; value: string },
  mode: 'create' | 'edit' = 'create',
): string | undefined {
  const slot = tokenSlots(tokens).find((entry) => entry.path === candidate.path)
  if (slot === undefined) return 'this kit has no such token, so there is nothing to override'
  const parsed = parseFor(slot, tokens, candidate.value)
  if (typeof parsed === 'string') return parsed
  if (mode === 'create' && parsed.canonical === slot.value) {
    return `the engine already chose ${slot.value}; an override that agrees is not an override`
  }
  return undefined
}

/**
 * What `value` would become at `path`, or `undefined` when it is not writable.
 *
 * {@link planOverrideWrite} needs this to answer one question the raw strings cannot:
 * did the reviewer actually change the value, or only its reason? `"10 px"` and
 * `"10px"` are one value, and only the engine knows that -- so "unchanged" is
 * decided on the canonical form rather than on the spelling that happened to be
 * typed, and a note-only edit is recognised as one however it was submitted.
 */
export function canonicalOverrideValue(
  tokens: TokensDocument,
  path: string,
  value: string,
): string | undefined {
  const slot = tokenSlots(tokens).find((entry) => entry.path === path)
  if (slot === undefined) return undefined
  const parsed = parseFor(slot, tokens, value)
  return typeof parsed === 'string' ? undefined : parsed.canonical
}

/* -------------------------------------------------- the write boundary -- */

/**
 * A write a reviewer is asking for, exactly as the panel submits it.
 *
 * `note` absent and `note: ''` are different requests. A write that says
 * nothing about the reason -- answering a conflict from its card, taking a
 * runner-up in one click -- leaves whatever the reviewer already wrote in
 * place; an explicitly empty one is a statement, and clears it.
 */
export interface OverrideWrite {
  path: string
  value: string
  note?: string
  /**
   * Where the value came from, when the reviewer did not think of it.
   *
   * Set by the one caller that has an answer -- accepting an assistant
   * proposal. Every other write leaves it absent, and an absent value is not
   * "unknown": it is the reviewer's own.
   */
  suggestedBy?: 'assistant'
}

/**
 * The row to persist for an accepted write: every field, already decided.
 *
 * A caller stores this verbatim. It works out none of it -- not `baseValue`,
 * not whether a conflict was answered -- because each of those answers is a
 * question about which document was consulted, and that is the engine's to
 * answer.
 */
export interface OverrideRecord {
  path: string
  value: string
  /** The engine's answer for this slot, read from the baseline. */
  baseValue: string
  /** The reason to store. Empty string when there is none. */
  note: string
  /** The conflict this write answered, when it answered one. */
  resolvedConflict?: ResolvedConflict
  /**
   * Where the accepted value came from. Carried on the row rather than
   * re-derived, because after the write there is nothing left to derive it
   * from: an accepted proposal and a typed value are the same string.
   */
  suggestedBy?: 'assistant'
}

/**
 * What the engine decided about one write.
 *
 * `refused` carries the reason and nothing else: there is deliberately no
 * record to store on that branch, because the judgement has to happen *before*
 * anything is written. An override store keyed on `(scope, path)` would already
 * have destroyed the standing override by the time a refusal came back.
 */
export type OverrideWriteReport =
  | { outcome: 'refused'; reason: string }
  | {
      outcome: 'stored'
      record: OverrideRecord
      /** The conflict this write retired, when it retired one. */
      retired?: OverrideConflict
    }

/**
 * Decide one write against the standing review state, and say what to store.
 *
 * This is the whole write boundary, and it is in the engine for the same reason
 * {@link applyOverrides} is: every question it answers -- is this value
 * redundant, did the reviewer move the value or only its reason, was a conflict
 * standing, and what number was it standing against -- is a question about the
 * *baseline*, the stored distillation with every other override replayed and
 * this path's own left out. A caller answering any of them from the document it
 * happens to be holding is how `design.md` came to announce a disagreement
 * answered against a value nobody was ever shown.
 *
 * `standing` is the review state as it is now, this path's own override
 * included; the exclusion is done here, so no caller has to know that it is the
 * rule.
 */
export function planOverrideWrite(
  tokens: PristineTokens,
  standing: readonly TokenOverride[],
  write: OverrideWrite,
): OverrideWriteReport {
  const { path, value } = write
  const existing = standing.find((entry) => entry.path === path)
  const baseline = baselineFor(tokens, standing, path)

  // The engine's own answer for this slot, read from the same document every
  // judgement below is made against -- `baseValue` is an input to the conflict
  // comparison later made from it, and a value recorded from one document and
  // compared against another reports disagreements neither of them ever had.
  const baseValue = readTokenValue(baseline, path)
  if (baseValue === null) {
    return { outcome: 'refused', reason: `this kit has no token at ${path}, so there is nothing to override` }
  }

  // Editing an override the reviewer already owns is judged as an edit: a new
  // reason on an unchanged value, or the same value on one the evidence has
  // since caught up with, is a decision they already made and must not be
  // refused -- still less deleted.
  const rejection = overrideRejection(baseline, { path, value }, existing === undefined ? 'create' : 'edit')
  if (rejection !== undefined) return { outcome: 'refused', reason: rejection }

  // Did the reviewer move the value, or only annotate it? Asked of the
  // canonical forms, because `"10 px"` and `"10px"` are one value and only the
  // engine knows that.
  const changed =
    existing === undefined ||
    canonicalOverrideValue(baseline, path, existing.value) !== canonicalOverrideValue(baseline, path, value)

  // `baseValue` is refreshed only by a write that moves the value. A conflict is
  // retired by the reviewer *responding* to it, and annotating is not a
  // response: refreshing on a note-only edit would silently drop a standing
  // `override.conflict` the reviewer never meant to answer.
  const recorded = existing === undefined || changed ? baseValue : (existing.baseValue ?? baseValue)

  // ...and when a value change does answer a standing conflict, what it
  // answered is kept, so the report does not merely go quiet. The rest of the
  // lifecycle follows from what that record claims: a note-only edit changes
  // nothing about the answer, so an earlier one stands, and a value change with
  // no conflict standing retires nothing -- keeping the old record there would
  // bind the new value to a retirement it had no part in, so it is cleared.
  const retired = changed && existing !== undefined ? standingConflict(baseline, existing) : undefined
  const answered: ResolvedConflict | undefined =
    existing === undefined
      ? undefined
      : retired !== undefined
        ? { value: existing.value, baseValue: retired.baseValue, engineValue: retired.engineValue }
        : changed
          ? undefined
          : existing.resolvedConflict

  // Where the value came from follows the value, not the row. This write says
  // so when it is an accepted proposal; a note-only edit leaves whatever the
  // value already carried, because annotating a suggestion does not make the
  // reviewer its author; and a value change that says nothing is the reviewer's
  // own, so an earlier attribution is cleared rather than inherited by a string
  // the assistant never proposed.
  const suggestedBy =
    write.suggestedBy ?? (existing !== undefined && !changed ? existing.suggestedBy : undefined)

  return {
    outcome: 'stored',
    record: {
      path,
      value,
      baseValue: recorded,
      note: write.note ?? existing?.note ?? '',
      ...(answered === undefined ? {} : { resolvedConflict: answered }),
      ...(suggestedBy === undefined ? {} : { suggestedBy }),
    },
    ...(retired === undefined ? {} : { retired }),
  }
}

/** A structural copy. The document is plain JSON, so this is exact. */
function clone(tokens: TokensDocument): TokensDocument {
  return JSON.parse(JSON.stringify(tokens)) as TokensDocument
}

function parseFor(slot: TokenSlot, tokens: TokensDocument, raw: string): Parsed | string {
  switch (slot.kind) {
    case 'color':
      return parseHex(raw)
    case 'length':
      return parseLength(raw)
    case 'ratio':
      return parseRatio(raw)
    case 'weight':
      return parseWeight(raw)
    case 'shadow':
      return parseShadowValue(raw)
    case 'font-stack':
      return parseFontStack(raw)
    case 'radius-step': {
      const name = raw.trim()
      return RADIUS_ORDER.includes(name as RadiusStepName) &&
        tokens.radius.steps[name as RadiusStepName] !== undefined
        ? { canonical: name }
        : `this kit has no \`${name}\` radius step; it has ${present(RADIUS_ORDER.filter((step) => tokens.radius.steps[step] !== undefined))}`
    }
    case 'type-step': {
      const name = raw.trim()
      const available = tokens.typography.steps.map((step) => step.value.name)
      return available.includes(name as TypeStepName)
        ? { canonical: name }
        : `this kit has no \`${name}\` type step; it has ${present(available)}`
    }
  }
}

function present(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.map((name) => `\`${name}\``).join(', ')
}

/**
 * Write one parsed value into the document and restamp its provenance.
 *
 * Restamping is the point: after this the token *is* a user override, and every
 * surface that reads provenance -- the panel, `design.md`, a per-component md --
 * says so without being told separately.
 */
function write(
  tokens: TokensDocument,
  slot: TokenSlot,
  value: string,
  note: string | undefined,
  colorTouched: Set<ColorRoleName>,
  recipesTouched: Set<string>,
  resolvedConflict?: ResolvedConflict,
  suggestedBy?: 'assistant',
): void {
  // `field` is given only for a token that holds several overridable fields.
  // Two things are recorded for it: which field a human set, and what stood in
  // that field before -- `slot.value`, read from this document before any of
  // this replay's writes. The replaced decision answers for the whole token, so
  // its own `chosen` is the step's font size whatever field was overridden, and
  // that is what a surface would otherwise print as the engine's answer for a
  // line height. The whole prior decision stays in `supersedes` either way, so
  // an earlier override of a sibling field is never dropped.
  const stamp = (token: { provenance: Provenance }, field?: string): void => {
    token.provenance = {
      ...token.provenance,
      decision: userOverride(value, token.provenance.decision, {
        ...(note === undefined ? {} : { note }),
        ...(resolvedConflict === undefined ? {} : { resolvedConflict }),
        ...(suggestedBy === undefined ? {} : { suggestedBy }),
        ...(field === undefined ? {} : { fields: [field], supersededValue: slot.value }),
      }),
    }
  }

  const path = slot.path

  if (path.startsWith('color.roles.')) {
    const role = path.slice('color.roles.'.length) as ColorRoleName
    const token = tokens.color.roles[role]
    if (token === undefined) return
    const color = readColor(value)
    if (color === undefined) return
    // Built exactly the way `distill` builds one, so an overridden colour and a
    // distilled one are the same shape down to the rounding.
    writeColorValue(token, color)
    // The engine's adjustment described a walk away from a captured colour that
    // is no longer in this document. Keeping it would credit the engine with a
    // move it did not make to the value on screen.
    delete (token as { contrastAdjustment?: ContrastAdjustment }).contrastAdjustment
    stamp(token)
    colorTouched.add(role)
    return
  }

  if (path.startsWith('spacing.steps.')) {
    const name = path.slice('spacing.steps.'.length)
    const step = tokens.spacing.steps.find((entry) => entry.value.name === name)
    if (step === undefined) return
    step.value.px = pixels(value)
    step.value.multiple = round(step.value.px / tokens.spacing.baseUnit, 3)
    stamp(step)
    return
  }

  if (path === 'border.width') {
    tokens.border.width.value = pixels(value)
    stamp(tokens.border.width)
    recipesTouched.add('*')
    return
  }

  if (path.startsWith('radius.steps.')) {
    const name = path.slice('radius.steps.'.length) as RadiusStepName
    const token = tokens.radius.steps[name]
    if (token === undefined) return
    token.value = pixels(value)
    stamp(token)
    return
  }

  if (path.startsWith('shadow.steps.')) {
    const name = path.slice('shadow.steps.'.length) as ShadowStepName
    const token = tokens.shadow.steps[name]
    if (token === undefined) return
    const parsed = parseShadow(value)
    token.value = parsed ?? { css: 'none', layers: [], elevation: 0 }
    stamp(token)
    return
  }

  if (path === 'typography.families.sans') {
    tokens.typography.families.sans.value = value
    stamp(tokens.typography.families.sans)
    return
  }
  if (path === 'typography.families.mono') {
    const mono = tokens.typography.families.mono
    if (mono === undefined) return
    mono.value = value
    stamp(mono)
    return
  }

  if (path.startsWith('typography.steps.')) {
    const [name, field] = path.slice('typography.steps.'.length).split('.')
    const step = tokens.typography.steps.find((entry) => entry.value.name === name)
    if (step === undefined) return
    if (field === 'fontSize') step.value.fontSize = pixels(value)
    else if (field === 'lineHeight') step.value.lineHeight = Number(value)
    else if (field === 'fontWeight') step.value.fontWeight = Number(value)
    else return
    stamp(step, field)
    // `baseSize` restates the `base` step's size rather than holding a second
    // opinion, so it follows the step instead of drifting away from it.
    if (name === 'base' && field === 'fontSize') tokens.typography.baseSize = pixels(value)
    recipesTouched.add('*')
    return
  }

  if (path.startsWith('components.recipes.')) {
    const rest = path.slice('components.recipes.'.length)
    const cut = rest.lastIndexOf('.')
    const recipeName = rest.slice(0, cut)
    const field = rest.slice(cut + 1)
    const recipe = tokens.components.recipes.find((entry) => entry.name === recipeName)
    if (recipe === undefined) return
    switch (field) {
      case 'height':
        recipe.height.value = pixels(value)
        stamp(recipe.height)
        return
      case 'paddingY':
        recipe.paddingY.value = pixels(value)
        stamp(recipe.paddingY)
        break
      case 'paddingX':
        recipe.paddingX.value = pixels(value)
        stamp(recipe.paddingX)
        return
      case 'radius':
        recipe.radius.value = value as RadiusStepName
        stamp(recipe.radius)
        return
      case 'typeStep':
        recipe.typeStep.value = value as TypeStepName
        stamp(recipe.typeStep)
        break
      case 'fontWeight':
        recipe.fontWeight.value = Number(value)
        stamp(recipe.fontWeight)
        return
      default:
        return
    }
    // paddingY and typeStep are two of the three terms of the height formula.
    recipesTouched.add(recipeName)
    return
  }

  if (path === 'components.states.focusRing.width') {
    tokens.components.states.focusRing.width.value = pixels(value)
    stamp(tokens.components.states.focusRing.width)
    return
  }
  if (path === 'components.states.focusRing.offset') {
    tokens.components.states.focusRing.offset.value = pixels(value)
    stamp(tokens.components.states.focusRing.offset)
  }
}

function pixels(value: string): number {
  return round(Number.parseFloat(value), 2)
}

/** A colour token's value block, shaped exactly the way `distill` shapes one. */
function writeColorValue(token: ColorToken, color: Oklch): void {
  const rounded = roundOklch(color)
  token.value = {
    oklch: formatOklch(color),
    hex: oklchToHex(color),
    lightness: rounded.l,
    chroma: rounded.c,
    hue: rounded.c === 0 || rounded.h === undefined ? 0 : rounded.h,
  }
}

/**
 * Re-derive the interaction shades an overridden colour left stale.
 *
 * `primaryHover` is `primary` lightness +/-0.04; `selectedSurface` carries
 * `primary`'s hue. Replacing `primary` and leaving those where they were would
 * ship a kit whose brand fill is blue and whose hover is the old green, under a
 * derivation still naming a colour the document no longer contains -- the same
 * dishonesty the code avoids two functions up when it drops `contrastAdjustment`
 * from a colour a person replaced.
 *
 * The offsets are not restated here: {@link deriveInteractionShades} is the
 * engine's own derivation path and is called with the document's current
 * colours. Roles the reviewer set by hand are `pinned`, so a hand-set shade is
 * never recomputed and the shades below it are derived from the value the
 * reviewer gave it.
 *
 * It is called twice, for two different answers. The pinned call carries the
 * values, chained correctly through whatever the reviewer set. The unpinned
 * call carries the shape -- every role and what it derives from, in dependency
 * order -- including the pinned roles the first call deliberately omits, which
 * is the only way to see that the engine wanted to move a shade and stepped
 * aside. Returns the roles that moved and the paths it yielded on.
 */
function rederiveShades(
  tokens: TokensDocument,
  touched: ReadonlySet<ColorRoleName>,
): { rewritten: ColorRoleName[]; yielded: string[] } {
  const pinned = new Set<ColorRoleName>()
  const base: RoleAssignment[] = []
  for (const [name, token] of Object.entries(tokens.color.roles)) {
    if (token === undefined) continue
    const role = name as ColorRoleName
    if (token.provenance.decision.strategy === 'user-override') pinned.add(role)
    const color = readColor(token.value.hex)
    if (color === undefined) continue
    base.push({ role, color, rule: 'current-value', detail: '', derivedFrom: [] })
  }

  const derived = new Map(
    deriveInteractionShades(base, tokens.color.mode, pinned).map((shade) => [shade.role, shade]),
  )

  // A shade whose source moved has itself moved, so the ones below it in the
  // chain (`disabledForeground` sits on `disabledSurface`) go stale in turn. A
  // pinned shade does not move, so nothing below it goes stale either.
  const stale = new Set<ColorRoleName>(touched)
  const rewritten: ColorRoleName[] = []
  const yielded: string[] = []

  for (const shape of deriveInteractionShades(base, tokens.color.mode)) {
    const moved = shape.derivedFrom.filter((from) => stale.has(from))
    if (moved.length === 0) continue
    if (pinned.has(shape.role)) {
      yielded.push(`color.roles.${shape.role}`)
      continue
    }
    const shade = derived.get(shape.role)
    const token = tokens.color.roles[shape.role]
    if (shade === undefined || token === undefined) continue

    writeColorValue(token, shade.color)
    // The adjustment on the record described a walk on the colour this shade
    // used to be. It is not the walk that produced the value now on screen.
    delete (token as { contrastAdjustment?: ContrastAdjustment }).contrastAdjustment
    token.provenance = {
      captureIds: [],
      observed: [],
      decision: derive(token.value.hex, {
        method: shade.rule,
        from: shade.derivedFrom.map((from) => `color.roles.${from}`),
        detail: `${shade.detail}; re-derived after ${present(moved)} was set by hand`,
      }),
    }
    stale.add(shade.role)
    rewritten.push(shade.role)
  }

  return { rewritten, yielded }
}

/**
 * Hold the re-derived shades to the floors the kit already guarantees.
 *
 * The pair list and its floors come from `tokens.color.contrast`, which is the
 * engine's own statement of what it guarantees, so this enforces exactly that
 * set without keeping a second copy of it.
 *
 * The shade always yields, never the foreground. In a distillation the engine
 * may move either side, but here the foreground may itself be a value a human
 * set -- and walking a foreground would in any case reopen a pair it was
 * already guaranteed against. A shade exists to serve a role, so it gives way,
 * lightness first and then chroma, exactly as the derived-surface pass does.
 */
function enforceShades(tokens: TokensDocument, shades: readonly ColorRoleName[]): void {
  for (const role of shades) {
    const token = tokens.color.roles[role]
    if (token === undefined) continue
    const path = `color.roles.${role}`
    const pairs = tokens.color.contrast
      .filter((pair) => pair.background === path)
      .sort(chain((a, b) => byString(a.foreground, b.foreground)))
    if (pairs.length === 0) continue

    let color = readColor(token.value.hex)
    if (color === undefined) continue
    let moved = false

    for (const pair of pairs) {
      const foreground = tokens.color.roles[pair.foreground.replace('color.roles.', '') as ColorRoleName]
      const against = foreground === undefined ? undefined : readColor(foreground.value.hex)
      if (against === undefined) continue
      const target = { path: pair.foreground, color: against }

      const nudged = enforceContrastOnBackground(path, color, target, pair.floor)
      if (nudged.adjustment !== undefined) {
        color = nudged.color
        moved = true
        if (!nudged.adjustment.met) {
          const saturated = enforceContrastByChroma(path, color, target, pair.floor)
          if (saturated.adjustment !== undefined) color = saturated.color
        }
      }
    }

    if (!moved) continue
    writeColorValue(token, color)
    const derivation = token.provenance.decision.derivation
    if (derivation === undefined) continue
    token.provenance = {
      ...token.provenance,
      decision: derive(token.value.hex, {
        ...derivation,
        detail: `${derivation.detail}, then held at the contrast floor as ${token.value.hex}`,
      }),
    }
  }
}

/**
 * Restate `color.state-collapsed` for the palette as it now stands.
 *
 * Re-deriving a shade and then holding it at the floor can consume the whole
 * offset, leaving a state that exists in the token set but cannot be seen --
 * and it can equally *un*-collapse one the engine reported. The existing
 * diagnostic described the distilled palette, so it is replaced rather than
 * added to: a state has one answer, not two that can disagree.
 */
function restateCollapsedStates(tokens: TokensDocument): void {
  tokens.diagnostics = tokens.diagnostics.filter((diagnostic) => diagnostic.code !== 'color.state-collapsed')

  const collapsed = SHADE_RELATIONS.filter(([shade, role]) => {
    const a = tokens.color.roles[shade]?.value.hex
    const b = tokens.color.roles[role]?.value.hex
    return a !== undefined && b !== undefined && a === b
  })
  if (collapsed.length === 0) return

  tokens.diagnostics.push({
    level: 'info',
    code: 'color.state-collapsed',
    path: 'color.roles',
    message:
      `${collapsed.map(([shade, role]) => `${shade} and ${role}`).join('; ')} render as the same colour: ` +
      'holding the foreground at the contrast floor consumed the whole offset. The state exists in the ' +
      'token set but cannot be seen; distinguish it with something other than fill.',
  })
}

/**
 * Restate the contrast-walk diagnostics for the palette as it now stands.
 *
 * A `color.contrast-adjusted` or `color.contrast-unmet` note and the token's own
 * `contrastAdjustment` are two views of one walk. {@link write} already deletes
 * the record from a colour a reviewer replaced, and {@link rederiveShades} does
 * the same for a shade it recomputed, precisely so the kit does not credit the
 * engine with a move it did not make -- but the sentence saying so lived on,
 * naming two hexes the document no longer holds, and `color.contrast-unmet` is
 * a warning, so `design.md` kept declaring a pair unmet that now passes.
 *
 * So the note goes wherever the record went, and one that survives has its level
 * re-decided from the ratios now measured, by the same rule the distiller uses:
 * a walk is only "unmet" while the role is still in a failing pair.
 */
function restateContrastAdjustments(tokens: TokensDocument): void {
  const failing = new Set(
    tokens.color.contrast
      .filter((pair) => !pair.passes)
      .flatMap((pair) => [pair.foreground, pair.background]),
  )

  tokens.diagnostics = tokens.diagnostics.flatMap((diagnostic) => {
    if (diagnostic.code !== 'color.contrast-adjusted' && diagnostic.code !== 'color.contrast-unmet') {
      return [diagnostic]
    }
    const path = diagnostic.path ?? ''
    const role = path.replace('color.roles.', '') as ColorRoleName
    if (tokens.color.roles[role]?.contrastAdjustment === undefined) return []

    const unresolved = failing.has(path)
    const restated: Diagnostic = {
      ...diagnostic,
      level: unresolved ? 'warning' : 'info',
      code: unresolved ? 'color.contrast-unmet' : 'color.contrast-adjusted',
    }
    return [restated]
  })
}

/**
 * Re-derive the control heights an override invalidated.
 *
 * A height the engine computed from padding, line box and border is a
 * consequence of those three; leaving it stale after one of them moves would
 * ship a recipe whose own numbers do not add up. A height the reviewer set by
 * hand is left exactly where they put it -- that is what overriding it means.
 */
function recomputeHeights(tokens: TokensDocument, touched: ReadonlySet<string>): string[] {
  const yielded: string[] = []
  for (const recipe of tokens.components.recipes) {
    if (!touched.has('*') && !touched.has(recipe.name)) continue
    const step = tokens.typography.steps.find((entry) => entry.value.name === recipe.typeStep.value)
    if (step === undefined) continue
    const borderPx = recipe.colors.border === null ? 0 : tokens.border.width.value
    const lineBox = round(step.value.fontSize * step.value.lineHeight)
    const height = round(recipe.paddingY.value * 2 + lineBox + borderPx * 2, 2)
    if (recipe.height.provenance.decision.strategy === 'user-override') {
      // The formula is worked out even for a height the reviewer set, but only
      // to answer one question: did the engine actually want a different
      // number here? If it did, this slot is one the engine yielded on, and
      // saying the two now agree would be false.
      if (height !== recipe.height.value) yielded.push(`components.recipes.${recipe.name}.height`)
      continue
    }
    if (height === recipe.height.value) continue
    recipe.height.value = height
    recipe.height.provenance = {
      ...recipe.height.provenance,
      decision: derive(`${height}px`, {
        method: 'box-model-sum',
        from: [
          `components.recipes.${recipe.name}.paddingY`,
          `typography.steps.${recipe.typeStep.value}`,
          'border.width',
        ],
        detail:
          `${recipe.paddingY.value}px padding x 2 + a ${step.value.fontSize}px/${step.value.lineHeight} line box (${lineBox}px)` +
          ` + ${borderPx}px border x 2 = ${height}px, recomputed after an override moved one of the three`,
      }),
    }
  }
  return yielded
}

/**
 * Re-measure every guaranteed pair against the colours now in the document.
 *
 * The engine adjusts a colour until a pair clears its floor. A reviewer who
 * replaces that colour is entitled to -- and is not overruled here -- but the
 * contrast table has to stop claiming a ratio the kit no longer has, because
 * that table reads as a guarantee.
 */
function recomputeContrast(tokens: TokensDocument): void {
  const hexOf = (path: string): string | undefined => {
    const role = path.replace('color.roles.', '') as ColorRoleName
    return tokens.color.roles[role]?.value.hex
  }

  for (const pair of tokens.color.contrast) {
    const foreground = hexOf(pair.foreground)
    const background = hexOf(pair.background)
    if (foreground === undefined || background === undefined) continue
    const a = readColor(foreground)
    const b = readColor(background)
    if (a === undefined || b === undefined) continue
    pair.ratio = round(contrastRatio(a, b), 2)
    pair.passes = pair.ratio >= pair.floor
  }

  const disabled = tokens.components.states.disabled
  const surface = hexOf(disabled.surface)
  const foreground = hexOf(disabled.foreground)
  if (surface !== undefined && foreground !== undefined) {
    const a = readColor(foreground)
    const b = readColor(surface)
    if (a !== undefined && b !== undefined) disabled.ratio = round(contrastRatio(a, b), 2)
  }
}

/**
 * What the kit now has to say out loud.
 *
 * Overrides are announced rather than folded in silently: a reader of
 * `tokens.json` who does not know a human was here would take every value as
 * distilled evidence.
 */
function overrideDiagnostics(
  tokens: TokensDocument,
  applied: readonly AppliedOverride[],
  conflicts: readonly OverrideConflict[],
  converged: readonly ConvergedOverride[],
  rejected: readonly RejectedOverride[],
  colorTouched: ReadonlySet<ColorRoleName>,
): Diagnostic[] {
  const out: Diagnostic[] = []

  if (applied.length > 0) {
    out.push({
      level: 'info',
      code: 'override.applied',
      message:
        `${applied.length} token${applied.length === 1 ? ' was' : 's were'} set by hand in the panel and ` +
        `${applied.length === 1 ? 'is' : 'are'} not distilled evidence: ` +
        `${applied.map((entry) => `${entry.path} = ${entry.value}`).join(', ')}.`,
    })
  }

  if (converged.length > 0) {
    // One diagnostic for every converged path rather than one each, and `info`
    // rather than `warning`: the reviewer's call became the consensus, which is
    // worth saying once and is not something anybody has to act on.
    out.push({
      level: 'info',
      code: 'override.now-agrees',
      message:
        `the captures have caught up with ${converged.length === 1 ? 'a standing override' : `${converged.length} standing overrides`}: ` +
        `the engine now independently chooses ${converged.map((entry) => `${entry.path} = ${entry.value}`).join(', ')}. ` +
        'The value stays attributed to the reviewer who chose it first; nothing needs doing.',
    })
  }

  for (const conflict of conflicts) {
    out.push({ level: 'warning', code: 'override.conflict', path: conflict.path, message: conflict.message })
  }

  for (const entry of rejected) {
    out.push({
      level: 'warning',
      code: 'override.rejected',
      path: entry.path,
      message: `the override \`${entry.path}\` = ${entry.value} was not applied: ${entry.reason}.`,
    })
  }

  if (colorTouched.size > 0) {
    const failing = tokens.color.contrast.filter((pair) => !pair.passes)
    if (failing.length > 0) {
      out.push({
        level: 'warning',
        code: 'override.contrast',
        message:
          `after the colour overrides, ${failing.length} guaranteed pair${failing.length === 1 ? '' : 's'} ` +
          `${failing.length === 1 ? 'falls' : 'fall'} below the floor: ` +
          `${failing.map((pair) => `${pair.foreground.replace('color.roles.', '')} on ${pair.background.replace('color.roles.', '')} at ${pair.ratio}:1 (floor ${pair.floor}:1)`).join(', ')}. ` +
          'The engine does not move a colour a human set; fix the pair or accept that it fails.',
      })
    }
  }

  return out
}

/* --------------------------------------------------------------- reading -- */

/** Every slot a human set by hand, in document order. */
export function overriddenSlots(tokens: TokensDocument): TokenSlot[] {
  return tokenSlots(tokens).filter((slot) => slot.provenance.decision.strategy === 'user-override')
}

/** True when any token in the document was set by hand. */
export function hasOverrides(tokens: TokensDocument): boolean {
  return tokenSlots(tokens).some((slot) => slot.provenance.decision.strategy === 'user-override')
}

/**
 * Where a token's value came from, as one word.
 *
 * `design.md` and the panel both need to label a value's authority, and both
 * need to label it the same way, so the mapping lives here rather than twice.
 */
export type TokenOrigin = 'overridden' | 'adjusted' | 'observed' | 'derived' | 'filled'

export function originOf(slot: { provenance: Provenance; contrastAdjustment?: ContrastAdjustment }): TokenOrigin {
  const strategy = slot.provenance.decision.strategy
  if (strategy === 'user-override') return 'overridden'
  if (slot.contrastAdjustment !== undefined) return 'adjusted'
  if (strategy === 'sanctioned-default') return 'filled'
  if (strategy === 'derived') return 'derived'
  return 'observed'
}

/** The decision an override replaced, when there is one. */
export function supersededBy(decision: DominantChoice): DominantChoice | undefined {
  return decision.strategy === 'user-override' ? decision.supersedes : undefined
}

/** Recipes, keyed for the surfaces that render one component at a time. */
export function recipeByName(tokens: TokensDocument, name: string): ComponentRecipe | undefined {
  return tokens.components.recipes.find((recipe) => recipe.name === name)
}

/** A colour role's hex, or `undefined` when the kit does not carry that role. */
export function roleHex(tokens: TokensDocument, role: ColorRoleName): string | undefined {
  return (tokens.color.roles[role] as ColorToken | undefined)?.value.hex
}
