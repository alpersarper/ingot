/**
 * Colour-space plumbing.
 *
 * The engine reasons in OKLCH because the decisions it makes -- "are these two
 * colours the same colour?", "make this one lighter until it passes contrast" --
 * are perceptual questions that sRGB answers badly. culori does the maths;
 * this module pins down the parts that must be deterministic: rounding, hex
 * formatting, and gamut clamping.
 */
import { clampChroma, converter, formatHex, parse, wcagContrast } from 'culori'
import { clamp, round } from '../util/num'

/** A colour in OKLCH: lightness 0-1, chroma 0-~0.4, hue 0-360 degrees. */
export interface Oklch {
  l: number
  c: number
  /** Undefined for achromatic colours, where hue is meaningless. */
  h: number | undefined
}

const toOklch = converter('oklch')
const toRgb = converter('rgb')

/**
 * Parse any CSS colour into OKLCH plus alpha.
 *
 * Returns `undefined` for unparseable input and for fully transparent colours:
 * `rgba(0, 0, 0, 0)` is the computed value of "no background", and treating it
 * as evidence of a black background is the single easiest way to poison a
 * palette.
 */
export function parseColor(raw: string): { oklch: Oklch; alpha: number; hex: string } | undefined {
  const parsed = parse(raw.trim())
  if (!parsed) return undefined
  const alpha = parsed.alpha ?? 1
  if (alpha === 0) return undefined

  const converted = toOklch(parsed)
  if (!converted || !Number.isFinite(converted.l)) return undefined

  const hex = formatHex({ ...toRgb(parsed), alpha: 1 })
  if (!hex) return undefined

  return {
    oklch: {
      l: converted.l,
      c: converted.c ?? 0,
      h: converted.c !== undefined && converted.c > 0 ? (converted.h ?? 0) : undefined,
    },
    alpha,
    hex: hex.toLowerCase(),
  }
}

/** Round an OKLCH triple to the precision used everywhere in the output. */
export function roundOklch(color: Oklch): Oklch {
  return {
    l: round(clamp(color.l, 0, 1), 4),
    c: round(Math.max(color.c, 0), 4),
    h: color.h === undefined ? undefined : round(((color.h % 360) + 360) % 360, 2),
  }
}

/**
 * Format OKLCH as CSS, matching the `oklch(L C H)` notation shadcn and
 * Tailwind v4 themes use.
 */
export function formatOklch(color: Oklch): string {
  const r = roundOklch(color)
  const hue = r.c === 0 || r.h === undefined ? 0 : r.h
  return `oklch(${r.l.toFixed(4)} ${r.c.toFixed(4)} ${hue.toFixed(2)})`
}

/**
 * Convert OKLCH back to an sRGB hex string, clamping chroma to the sRGB gamut
 * first so out-of-gamut colours degrade gracefully instead of clipping per
 * channel (which shifts hue).
 */
export function oklchToHex(color: Oklch): string {
  const r = roundOklch(color)
  const clamped = clampChroma({ mode: 'oklch', l: r.l, c: r.c, h: r.h ?? 0 }, 'oklch')
  return (formatHex({ ...toRgb(clamped), alpha: 1 }) ?? '#000000').toLowerCase()
}

/**
 * Perceptual distance between two colours: Euclidean distance in OKLab.
 *
 * Computed in OKLab rather than OKLCH because hue is an angle and is unstable
 * for near-grey colours -- two near-identical greys can sit 180 degrees apart
 * in hue while being visually indistinguishable.
 */
export function colorDistance(a: Oklch, b: Oklch): number {
  const [aa, ab] = labAxes(a)
  const [ba, bb] = labAxes(b)
  return Math.sqrt((a.l - b.l) ** 2 + (aa - ba) ** 2 + (ab - bb) ** 2)
}

/**
 * The colour a screen actually draws for `color`.
 *
 * OKLCH can name colours sRGB cannot show, and {@link oklchToHex} clamps them
 * on the way out. Any question about whether two colours *look* different has
 * to be asked of the clamped pair: a selected-row tint asked for at chroma 0.05
 * lands at 0.019 on one palette and 0.050 on another, and a rule calibrated on
 * the number that was asked for is calibrated on a colour nobody sees.
 */
export function renderedColor(color: Oklch): Oklch {
  return parseColor(oklchToHex(color))?.oklch ?? color
}

/** {@link colorDistance} between the colours a screen actually draws. */
export function renderedDistance(a: Oklch, b: Oklch): number {
  return colorDistance(renderedColor(a), renderedColor(b))
}

function labAxes(color: Oklch): [number, number] {
  if (color.h === undefined || color.c === 0) return [0, 0]
  const radians = (color.h * Math.PI) / 180
  return [color.c * Math.cos(radians), color.c * Math.sin(radians)]
}

/**
 * WCAG 2.1 contrast ratio between two colours, 1-21, rounded to 2 decimals.
 *
 * WCAG's own sRGB-luminance formula is used rather than an OKLCH approximation
 * because the acceptance threshold is a WCAG number; approximating it would let
 * pairs that fail a real audit pass here.
 */
export function contrastRatio(a: Oklch, b: Oklch): number {
  return round(wcagContrast(oklchToHex(a), oklchToHex(b)), 2)
}

/** Weighted mean of colours in OKLab, converted back to OKLCH. */
export function meanColor(colors: ReadonlyArray<{ color: Oklch; weight: number }>): Oklch {
  let totalWeight = 0
  let l = 0
  let a = 0
  let b = 0
  for (const entry of colors) {
    const [ea, eb] = labAxes(entry.color)
    l += entry.color.l * entry.weight
    a += ea * entry.weight
    b += eb * entry.weight
    totalWeight += entry.weight
  }
  if (totalWeight === 0) return { l: 0, c: 0, h: undefined }
  l /= totalWeight
  a /= totalWeight
  b /= totalWeight
  const chroma = Math.sqrt(a * a + b * b)
  return {
    l,
    c: chroma,
    h: chroma < 1e-6 ? undefined : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  }
}

/** Shift lightness by `delta`, clamped to the valid range. */
export function withLightness(color: Oklch, lightness: number): Oklch {
  return { ...color, l: clamp(lightness, 0, 1) }
}

/** Replace chroma, clamped to the non-negative range. Hue is untouched. */
export function withChroma(color: Oklch, chroma: number): Oklch {
  return { ...color, c: Math.max(chroma, 0) }
}
