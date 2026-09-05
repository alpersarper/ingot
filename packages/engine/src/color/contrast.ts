/**
 * WCAG contrast enforcement.
 *
 * Distilled palettes inherit whatever contrast the source sites had, and source
 * sites are frequently below AA. The engine will not emit a text/background
 * pair that fails: it walks the foreground's OKLCH lightness away from the
 * background until the pair passes, and records exactly what it changed.
 */
import { clamp, round } from '../util/num'
import { contrastRatio, formatOklch, oklchToHex, withLightness } from './space'
import type { Oklch } from './space'

/** WCAG 2.1 AA for normal-size text. Every emitted pair must clear this. */
export const CONTRAST_FLOOR = 4.5

/**
 * Floor for the disabled pair.
 *
 * Deliberately below {@link CONTRAST_FLOOR}: WCAG 2.1 exempts inactive controls
 * from 1.4.3, and a disabled label that clears the body-text floor no longer
 * reads as disabled. 3:1 is WCAG's own non-text threshold and is the point at
 * which the label is unambiguously still there -- which the `opacity: 0.5` every
 * consumer reaches for is not: it measures 1:1 on a light kit.
 */
export const DISABLED_CONTRAST_FLOOR = 3

/** Lightness step used when walking a colour toward compliance. */
const STEP = 0.005

/** Chroma step used when lightness has run out of room. */
const CHROMA_STEP = 0.005

/** Chroma the walk will not exceed: past this a brand colour stops being one. */
const CHROMA_MAX = 0.4

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

/**
 * Last resort when a fill has run out of lightness: move its **chroma** instead.
 *
 * A derived interaction shade sits between a foreground that is already pinned
 * at a gamut pole and a base role that is already guaranteed, so neither of
 * those may move. Saturating or desaturating the shade changes its luminance
 * without changing its lightness coordinate, which is the only axis left. Hue
 * never moves: that is the brand.
 *
 * The direction is chosen by measurement rather than by theory -- whether more
 * chroma helps depends on the hue -- so the walk first probes one step each way
 * and takes whichever improved the ratio.
 */
export function enforceContrastByChroma(
  role: string,
  background: Oklch,
  foreground: { path: string; color: Oklch },
  floor = CONTRAST_FLOOR,
): { color: Oklch; adjustment?: ContrastAdjustment } {
  const ratioBefore = contrastRatio(foreground.color, background)
  if (ratioBefore >= floor) return { color: background }
  if (background.h === undefined) return { color: background }

  const at = (chroma: number): Oklch => ({ ...background, c: round(clamp(chroma, 0, CHROMA_MAX), 4) })
  const up = contrastRatio(foreground.color, at(background.c + CHROMA_STEP))
  const down = contrastRatio(foreground.color, at(background.c - CHROMA_STEP))
  // Neither direction helps: leave the colour alone rather than saturating it to
  // the gamut edge for nothing.
  if (Math.max(up, down) <= ratioBefore) return { color: background }
  const direction = up >= down ? 1 : -1

  let current = background
  let ratio = ratioBefore
  let chroma = background.c
  while (ratio < floor) {
    const next = round(chroma + direction * CHROMA_STEP, 4)
    if (next <= 0 || next >= CHROMA_MAX) {
      chroma = direction > 0 ? CHROMA_MAX : 0
      current = at(chroma)
      ratio = contrastRatio(foreground.color, current)
      break
    }
    chroma = next
    current = at(chroma)
    ratio = contrastRatio(foreground.color, current)
  }

  const met = ratio >= floor
  const delta = round(current.c - background.c, 4)
  return {
    color: current,
    adjustment: {
      role,
      against: [foreground.path],
      from: snapshot(background),
      to: snapshot(current),
      deltaL: 0,
      ratioBefore,
      ratioAfter: ratio,
      floor,
      met,
      reason: met
        ? `lightness had nowhere left to go, so chroma moved instead: ${ratioBefore}:1 to ${ratio}:1 by OKLCH chroma ${direction > 0 ? '+' : ''}${delta}`
        : `could not reach ${floor}:1 by lightness or chroma; stopped at ${ratio}:1`,
    },
  }
}
