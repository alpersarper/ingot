/**
 * WCAG contrast enforcement.
 *
 * Distilled palettes inherit whatever contrast the source sites had, and source
 * sites are frequently below AA. The engine will not emit a text/background
 * pair that fails: it walks the foreground's OKLCH lightness away from the
 * background until the pair passes, and records exactly what it changed.
 */
import { round } from '../util/num'
import { contrastRatio, formatOklch, oklchToHex, withLightness } from './space'
import type { Oklch } from './space'

/** WCAG 2.1 AA for normal-size text. Every emitted pair must clear this. */
export const CONTRAST_FLOOR = 4.5

/** Lightness step used when walking a colour toward compliance. */
const STEP = 0.005

/** A foreground/background pairing the engine guarantees. */
export interface ContrastPair {
  /** Token path of the foreground role, e.g. `"color.roles.text"`. */
  foreground: string
  /** Token path of the background role. */
  background: string
  ratio: number
  floor: number
  passes: boolean
}

/** A lightness change applied to meet {@link CONTRAST_FLOOR}. */
export interface ContrastAdjustment {
  /** Token path of the role whose lightness moved. */
  role: string
  /** Token paths of the roles it had to clear. */
  against: string[]
  from: { hex: string; oklch: string; lightness: number }
  to: { hex: string; oklch: string; lightness: number }
  deltaL: number
  ratioBefore: number
  ratioAfter: number
  floor: number
  /** False when the floor could not be reached even at the gamut boundary. */
  met: boolean
  /** Stable explanation of the walk, for the panel and for `design.md`. */
  reason: string
}

/** The lowest contrast `color` achieves against any of `backgrounds`. */
function worstRatio(color: Oklch, backgrounds: readonly Oklch[]): number {
  let worst = Number.POSITIVE_INFINITY
  for (const background of backgrounds) worst = Math.min(worst, contrastRatio(color, background))
  return worst === Number.POSITIVE_INFINITY ? 21 : worst
}

function snapshot(color: Oklch): ContrastAdjustment['from'] {
  return { hex: oklchToHex(color), oklch: formatOklch(color), lightness: round(color.l, 4) }
}

/**
 * Walk `color`'s lightness until it clears `floor` against every background.
 *
 * Direction is away from the mean background lightness -- lighter on a dark
 * background, darker on a light one -- because that is the direction that both
 * increases contrast and preserves the designer's intent. If the walk reaches
 * the 0/1 boundary without clearing the floor, the boundary value is returned
 * with `met: false`; the caller decides whether to nudge the background too.
 */
export function enforceContrast(
  role: string,
  color: Oklch,
  backgrounds: ReadonlyArray<{ path: string; color: Oklch }>,
  floor = CONTRAST_FLOOR,
): { color: Oklch; adjustment?: ContrastAdjustment } {
  if (backgrounds.length === 0) return { color }

  const backgroundColors = backgrounds.map((b) => b.color)
  const ratioBefore = worstRatio(color, backgroundColors)
  if (ratioBefore >= floor) return { color }

  const meanBackgroundLightness =
    backgroundColors.reduce((sum, b) => sum + b.l, 0) / backgroundColors.length
  const direction = color.l >= meanBackgroundLightness ? 1 : -1

  let current = color
  let ratio = ratioBefore
  let lightness = color.l
  while (ratio < floor) {
    const next = round(lightness + direction * STEP, 4)
    if (next <= 0 || next >= 1) {
      lightness = direction > 0 ? 1 : 0
      current = withLightness(color, lightness)
      ratio = worstRatio(current, backgroundColors)
      break
    }
    lightness = next
    current = withLightness(color, lightness)
    ratio = worstRatio(current, backgroundColors)
  }

  const met = ratio >= floor
  return {
    color: current,
    adjustment: {
      role,
      against: backgrounds.map((b) => b.path),
      from: snapshot(color),
      to: snapshot(current),
      deltaL: round(current.l - color.l, 4),
      ratioBefore,
      ratioAfter: ratio,
      floor,
      met,
      reason: met
        ? `raised contrast from ${ratioBefore}:1 to ${ratio}:1 by moving OKLCH lightness ${direction > 0 ? '+' : ''}${round(current.l - color.l, 4)}`
        : `could not reach ${floor}:1 by lightness alone; stopped at ${ratio}:1 on the gamut boundary`,
    },
  }
}

/**
 * Last resort for a foreground that is already at black or white: move the
 * *background* instead, away from the foreground, until the pair passes.
 *
 * Only used for the primary surface, where the foreground is a label colour
 * with nowhere left to go and the brand colour can absorb a small lightness
 * nudge without losing its identity.
 */
export function enforceContrastOnBackground(
  role: string,
  background: Oklch,
  foreground: { path: string; color: Oklch },
  floor = CONTRAST_FLOOR,
): { color: Oklch; adjustment?: ContrastAdjustment } {
  const ratioBefore = contrastRatio(foreground.color, background)
  if (ratioBefore >= floor) return { color: background }

  const direction = background.l >= foreground.color.l ? 1 : -1
  let current = background
  let ratio = ratioBefore
  let lightness = background.l
  while (ratio < floor) {
    const next = round(lightness + direction * STEP, 4)
    if (next <= 0 || next >= 1) {
      lightness = direction > 0 ? 1 : 0
      current = withLightness(background, lightness)
      ratio = contrastRatio(foreground.color, current)
      break
    }
    lightness = next
    current = withLightness(background, lightness)
    ratio = contrastRatio(foreground.color, current)
  }

  const met = ratio >= floor
  return {
    color: current,
    adjustment: {
      role,
      against: [foreground.path],
      from: snapshot(background),
      to: snapshot(current),
      deltaL: round(current.l - background.l, 4),
      ratioBefore,
      ratioAfter: ratio,
      floor,
      met,
      reason: met
        ? `foreground was already at the gamut boundary, so the background moved instead: ${ratioBefore}:1 to ${ratio}:1 by OKLCH lightness ${direction > 0 ? '+' : ''}${round(current.l - background.l, 4)}`
        : `could not reach ${floor}:1 by lightness alone; stopped at ${ratio}:1 on the gamut boundary`,
    },
  }
}
