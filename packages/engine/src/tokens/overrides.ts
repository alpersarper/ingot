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
 */
import { contrastRatio, formatOklch, oklchToHex, parseColor, roundOklch } from '../color/space'
import type { Oklch } from '../color/space'
import { parseShadow } from '../shadow/shadow'
import { round } from '../util/num'
import { byString, chain } from '../util/sort'
import { derive, userOverride } from '../provenance'
import type { DominantChoice, Provenance } from '../provenance'
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
   * moved" is distinguishable from "you disagreed with the engine".
   */
  baseValue?: string
  /** The reviewer's own reason, carried into `design.md`. */
  note?: string
}

/** An override that landed. */
export interface AppliedOverride {
  path: string
  value: string
  /** The engine's answer for this path in *this* distillation. */
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

export interface OverrideResult {
  /** A new document. The input is never mutated. */
  tokens: TokensDocument
  applied: AppliedOverride[]
  conflicts: OverrideConflict[]
  rejected: RejectedOverride[]
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

  for (const step of tokens.typography.steps) {
    const base = `typography.steps.${step.value.name}`
    slots.push({
      path: `${base}.fontSize`,
      group: 'typography',
      label: `${step.value.name} size`,
      kind: 'length',
      value: `${step.value.fontSize}px`,
      provenance: step.provenance,
    })
    slots.push({
      path: `${base}.lineHeight`,
      group: 'typography',
      label: `${step.value.name} line height`,
      kind: 'ratio',
      value: String(step.value.lineHeight),
      provenance: step.provenance,
    })
    slots.push({
      path: `${base}.fontWeight`,
      group: 'typography',
      label: `${step.value.name} weight`,
      kind: 'weight',
      value: String(step.value.fontWeight),
      provenance: step.provenance,
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

function parseFontStack(raw: string): Parsed | string {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (text === '') return 'a font stack cannot be empty'
  if (text.length > 300) return 'that font stack is longer than any this kit would emit'
  return { canonical: text }
}

/* -------------------------------------------------------------- applying -- */

/**
 * Replay `overrides` over a freshly distilled document.
 *
 * The result is a function of the two inputs alone: overrides are applied in
 * path order, unknown or unparseable ones are rejected rather than guessed at,
 * and everything an override invalidated -- contrast ratios, derived control
 * heights, the disabled pair -- is recomputed from the new values.
 */
export function applyOverrides(
  tokens: TokensDocument,
  overrides: readonly TokenOverride[],
): OverrideResult {
  const next = clone(tokens)
  const applied: AppliedOverride[] = []
  const conflicts: OverrideConflict[] = []
  const rejected: RejectedOverride[] = []

  const ordered = [...overrides].sort(chain<TokenOverride>((a, b) => byString(a.path, b.path)))
  const slots = new Map(tokenSlots(next).map((slot) => [slot.path, slot]))
  const colorTouched = new Set<ColorRoleName>()
  const recipesTouched = new Set<string>()

  for (const override of ordered) {
    const slot = slots.get(override.path)
    if (slot === undefined) {
      rejected.push({
        path: override.path,
        value: override.value,
        reason: 'this kit has no such token, so there is nothing to override',
      })
      continue
    }

    const parsed = parseFor(slot, next, override.value)
    if (typeof parsed === 'string') {
      rejected.push({ path: override.path, value: override.value, reason: parsed })
      continue
    }

    const engineValue = slot.value
    if (parsed.canonical === engineValue) {
      // Agreeing with the engine is not an override: recording one would put a
      // "set by hand" label on a value the engine also chose, which is exactly
      // the kind of quiet dishonesty the rest of this document avoids.
      rejected.push({
        path: override.path,
        value: override.value,
        reason: `the engine already chose ${engineValue}; an override that agrees is not an override`,
      })
      continue
    }

    write(next, slot, parsed.canonical, override.note, colorTouched, recipesTouched)
    const entry: AppliedOverride = { path: override.path, value: parsed.canonical, engineValue }
    if (override.note !== undefined && override.note !== '') entry.note = override.note
    applied.push(entry)

    if (override.baseValue !== undefined && override.baseValue !== engineValue) {
      conflicts.push({
        path: override.path,
        value: parsed.canonical,
        baseValue: override.baseValue,
        engineValue,
        message:
          `\`${override.path}\` was overridden to ${parsed.canonical} when the engine said ${override.baseValue}. ` +
          `The captures now say ${engineValue}. Your value is still in force; re-check it, or clear the override to take ${engineValue}.`,
      })
    }
  }

  if (recipesTouched.size > 0) recomputeHeights(next, recipesTouched)
  if (colorTouched.size > 0) recomputeContrast(next)

  next.diagnostics = [...next.diagnostics, ...overrideDiagnostics(next, applied, conflicts, rejected, colorTouched)]

  return { tokens: next, applied, conflicts, rejected }
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
): void {
  const stamp = (token: { provenance: Provenance }): void => {
    token.provenance = {
      ...token.provenance,
      decision: userOverride(value, token.provenance.decision, note),
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
    const rounded = roundOklch(color)
    token.value = {
      oklch: formatOklch(color),
      hex: oklchToHex(color),
      lightness: rounded.l,
      chroma: rounded.c,
      hue: rounded.c === 0 || rounded.h === undefined ? 0 : rounded.h,
    }
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
    stamp(step)
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

/**
 * Re-derive the control heights an override invalidated.
 *
 * A height the engine computed from padding, line box and border is a
 * consequence of those three; leaving it stale after one of them moves would
 * ship a recipe whose own numbers do not add up. A height the reviewer set by
 * hand is left exactly where they put it -- that is what overriding it means.
 */
function recomputeHeights(tokens: TokensDocument, touched: ReadonlySet<string>): void {
  for (const recipe of tokens.components.recipes) {
    if (!touched.has('*') && !touched.has(recipe.name)) continue
    if (recipe.height.provenance.decision.strategy === 'user-override') continue
    const step = tokens.typography.steps.find((entry) => entry.value.name === recipe.typeStep.value)
    if (step === undefined) continue
    const borderPx = recipe.colors.border === null ? 0 : tokens.border.width.value
    const lineBox = round(step.value.fontSize * step.value.lineHeight)
    const height = round(recipe.paddingY.value * 2 + lineBox + borderPx * 2, 2)
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
