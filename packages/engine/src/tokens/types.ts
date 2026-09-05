/**
 * The tokens document, version 1.
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

export const TOKENS_SCHEMA_VERSION = 1

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
 * present. The rest appear only when the captures support them.
 */
export type ColorRoleName =
  | 'background'
  | 'surface'
  | 'surfaceHover'
  | 'border'
  | 'text'
  | 'textMuted'
  | 'primary'
  | 'primaryHover'
  | 'primaryActive'
  | 'primaryForeground'
  | 'destructive'
  | 'destructiveForeground'

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

export interface SpacingStep {
  /** Step name: the multiplier as a string, so `"2"` is `2 x baseUnit`. */
  name: string
  multiple: number
  px: number
}

export interface SpacingTokens {
  baseUnit: number
  unit: 'px'
  /** Human-readable statement of the rule the engine applied. */
  snappingRule: string
  /** Fraction of raw observations that were already exact multiples of `baseUnit`. */
  fit: number
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
  diagnostics: Diagnostic[]
}

export type { ContrastAdjustment, ContrastPair }
