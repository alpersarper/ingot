/**
 * The tokens document, version 3.
 *
 * Stack-agnostic on purpose: nothing in here mentions Tailwind, shadcn or CSS
 * variables. Target-specific naming lives entirely in the export layer
 * (`src/export/`), so adding a second target never means changing this shape.
 *
 * Documented in `docs/tokens.md`; machine-readable schema in
 * `schemas/tokens.schema.json`.
 */
import type { ContrastAdjustment, ContrastPair } from '../color/contrast'
import type { Provenance } from '../provenance'

export const TOKENS_SCHEMA_VERSION = 3

/** Base shape shared by every token: a value plus why it has that value. */
export interface Token<TValue> {
  value: TValue
  provenance: Provenance
}

/**
 * The semantic colour roles. Deliberately small -- a distilled kit that offers
 * thirty roles has not distilled anything.
 *
 * `background`, `text`, `primary`, `primaryForeground` and `border` are always
 * present, as are the derived interaction and state surfaces. `destructive` and
 * `destructiveForeground` appear only when the captures support them.
 *
 * The state colours (`selectedSurface`, `disabledSurface`, `disabledForeground`)
 * are real colours, never an opacity ramp: an opacity ramp cannot be
 * contrast-checked, and the consumer that reaches for one produces a 1:1
 * disabled label on a light kit.
 */
export type ColorRoleName =
  | 'background'
  | 'surface'
  | 'surfaceHover'
  | 'selectedSurface'
  | 'border'
  | 'text'
  | 'textMuted'
  | 'primary'
  | 'primaryHover'
  | 'primaryActive'
  | 'primaryForeground'
  | 'destructive'
  | 'destructiveForeground'
  | 'disabledSurface'
  | 'disabledForeground'

export interface ColorValue {
  /** `oklch(L C H)`, the canonical form. */
  oklch: string
  /** sRGB fallback, lowercase `#rrggbb`. */
  hex: string
  lightness: number
  chroma: number
  hue: number
}

export interface ColorToken extends Token<ColorValue> {
  /** Present when the contrast floor moved this role's lightness. */
  contrastAdjustment?: ContrastAdjustment
}

export interface ColorTokens {
  /** Derived from the lightness of the observed background colours. */
  mode: 'light' | 'dark'
  roles: Partial<Record<ColorRoleName, ColorToken>>
  /** Every foreground/background pair the engine guarantees, with final ratios. */
  contrast: ContrastPair[]
  /** Every colour cluster considered, including the ones no role claimed. */
  palette: Array<{
    hex: string
    oklch: string
    count: number
    channels: { background: number; foreground: number; border: number }
    captureIds: string[]
    mergedFrom: Array<{ hex: string; count: number }>
    /** The role this cluster became, or `null` if it was not used. */
    role: ColorRoleName | null
  }>
}

/**
 * Which half of the scale a step belongs to.
 *
 * `component` steps sit at or below the largest observed length: captures are
 * individual components, so component-internal padding and gap is as far as the
 * evidence reaches, and each step's own provenance records whether it was
 * observed or gap-filled. `layout` steps are extrapolated past the largest
 * observation to give page-level rhythm somewhere on-scale to live. The
 * distinction is emitted rather than smoothed over, because a consumer is
 * entitled to know which numbers came from the sources and which the engine
 * continued.
 */
export type SpacingBand = 'component' | 'layout'

export interface SpacingStep {
  /**
   * Opaque stable identifier for the step.
   *
   * Distillation mints it from the multiplier, so a freshly distilled `"2"` is
   * `2 x baseUnit` -- but it is an identity, not an assertion. It is the
   * override path key (`spacing.steps.2`) and the `--kit-space-<name>` variable
   * suffix, so it stays put when a reviewer overrides the step to a length off
   * the base scale; renumbering it would break every reference to it instead.
   * {@link SpacingStep.multiple} is the field that carries the arithmetic.
   */
  name: string
  /** `px / baseUnit`. Not necessarily a whole number once a human has been here. */
  multiple: number
  px: number
  band: SpacingBand
}

export interface SpacingTokens {
  baseUnit: number
  unit: 'px'
  /** Human-readable statement of the rule the engine applied. */
  snappingRule: string
  /** Human-readable statement of how the layout band was continued. */
  layoutRule: string
  /** Fraction of raw observations that were already exact multiples of `baseUnit`. */
  fit: number
  /** Largest multiple any capture actually supported; the band boundary. */
  largestObservedMultiple: number
  steps: Array<Token<SpacingStep>>
}

export interface BorderTokens {
  unit: 'px'
  /** Dominant width of the borders that actually draw a line. */
  width: Token<number>
}

export type RadiusStepName = 'none' | 'sm' | 'md' | 'lg' | 'full'

export interface RadiusTokens {
  unit: 'px'
  steps: Partial<Record<RadiusStepName, Token<number>>>
}

export type ShadowStepName = 'none' | 'sm' | 'md' | 'lg'

export interface ShadowLayer {
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  /** `rgb(R G B / A)`. */
  color: string
}

export interface ShadowValue {
  /** Canonical CSS, ready to paste into a stylesheet. */
  css: string
  layers: ShadowLayer[]
  /** Sum of |offsetY| + blur + spread across layers. Orders the steps. */
  elevation: number
}

export interface ShadowTokens {
  steps: Partial<Record<ShadowStepName, Token<ShadowValue>>>
}

export type TypeStepName = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl'

export interface TypeStep {
  name: TypeStepName
  fontSize: number
  /** Unitless ratio, rounded to 3 decimals. */
  lineHeight: number
  fontWeight: number
  /** Omitted when every capture at this size reported `normal`. */
  letterSpacing?: number
}

export interface TypographyTokens {
  families: {
    sans: Token<string>
    mono?: Token<string>
  }
  /** Font size of the `base` step, in px. */
  baseSize: number
  /** Geometric mean ratio between adjacent steps, rounded to 3 decimals. */
  scaleRatio: number
  weights: Array<Token<{ name: string; value: number }>>
  steps: Array<Token<TypeStep>>
}

/**
 * The controls a kit has to be able to describe before an LLM can build a
 * screen against it.
 *
 * Deliberately a closed list, and deliberately shallow: this is not a component
 * library, it is the minimum geometry two independent consumers need in order
 * to draw the same button. Anything not on this list is composed from the
 * scales above.
 */
export type ComponentRecipeName =
  | 'button.primary'
  | 'button.secondary'
  | 'button.ghost'
  | 'button.destructive'
  | 'input'
  | 'select'
  | 'table.header'
  | 'table.row'
  | 'badge'

/** Which colour roles paint a recipe. Token paths, not values. */
export interface ComponentColors {
  /** Fill, or `null` when the control is transparent until it is hovered. */
  surface: string | null
  foreground: string
  /** Outline, or `null` when the control draws no border. */
  border: string | null
  /** Fill under the pointer, or `null` when the control has no hover state. */
  hoverSurface: string | null
}

/**
 * One control, fully specified.
 *
 * Every number here is either observed, derived from another token, or an
 * engine default -- and the token's own provenance says which, so a reader can
 * tell "your captures say buttons are 36px tall" from "nothing in your captures
 * described a badge, so here is a sanctioned one".
 */
export interface ComponentRecipe {
  name: ComponentRecipeName
  /** One line on what the recipe is for, written for the consumer. */
  purpose: string
  colors: ComponentColors
  /** Total border-box height in px: `paddingY x 2 + line box + border x 2`. */
  height: Token<number>
  paddingY: Token<number>
  paddingX: Token<number>
  /** Name of the radius step, so the value tracks `radius.steps`. */
  radius: Token<RadiusStepName>
  /** Name of the type step, so size and line height track `typography.steps`. */
  typeStep: Token<TypeStepName>
  fontWeight: Token<number>
}

/**
 * Focus ring geometry. The colour is a role that already exists, so only the
 * geometry -- the part every consumer was otherwise inventing -- lives here.
 */
export interface FocusRingTokens {
  /** Token path of the colour role the ring is drawn in. */
  colorRole: string
  unit: 'px'
  width: Token<number>
  offset: Token<number>
}

/** The interaction states a control can be in, beyond hover and pressed. */
export interface StateTokens {
  /**
   * Disabled controls. Two real colours held to a stated floor against each
   * other -- not an opacity ramp, which cannot be contrast-checked and which
   * measures 1:1 on a light kit.
   */
  disabled: {
    /** Token path of the fill. */
    surface: string
    /** Token path of the label colour. */
    foreground: string
    /** Final measured ratio of `foreground` on `surface`. */
    ratio: number
    /** The floor that pair was held to. Below the body-text floor on purpose. */
    floor: number
  }
  /** The selected row / active nav item fill. */
  selected: {
    /** Token path of the fill. */
    surface: string
    /** Token path of the label colour drawn on it. */
    foreground: string
  }
  focusRing: FocusRingTokens
}

export interface ComponentTokens {
  states: StateTokens
  /** Sorted by {@link ComponentRecipeName} so the document key order is fixed. */
  recipes: ComponentRecipe[]
}

/** Severity of a distillation note. `warning` means a human should look. */
export type DiagnosticLevel = 'info' | 'warning'

/** Something the engine wants the operator to know about this distillation. */
export interface Diagnostic {
  level: DiagnosticLevel
  /** Stable machine-readable identifier, e.g. `"spacing.low-fit"`. */
  code: string
  /** Token path the note is about, when there is one. */
  path?: string
  message: string
}

export interface TokensDocument {
  schemaVersion: number
  engine: { name: string; version: string }
  source: {
    setId: string
    name: string
    description: string
    captureCount: number
    /** Distinct origins with how many captures each contributed, sorted. */
    origins: Array<{ origin: string; captureCount: number }>
    /** Capture ids, sorted. */
    captureIds: string[]
    componentTypes: Array<{ type: string; count: number }>
  }
  color: ColorTokens
  spacing: SpacingTokens
  border: BorderTokens
  radius: RadiusTokens
  shadow: ShadowTokens
  typography: TypographyTokens
  components: ComponentTokens
  diagnostics: Diagnostic[]
}

export type { ContrastAdjustment, ContrastPair }
