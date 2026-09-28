/**
 * What was actually painted behind a capture, and how light or dark it is.
 *
 * A component that draws no fill of its own is the commonest thing on the web:
 * a ghost button, a heading, a bordered card on a tinted section. The browser
 * reports `rgba(0, 0, 0, 0)` for all of them, which is true and useless -- a
 * fully transparent colour is read as "no colour" everywhere in this engine
 * (see `parseColor`), so such a capture used to contribute *no background
 * evidence at all*. A library where most captures were picked that way distils
 * from almost nothing: the kit's background comes down to the two or three
 * captures that happened to paint their own.
 *
 * So the extension now measures the background it is sitting on and records it
 * as {@link CaptureRecord.inheritedBackgroundColor}, and this module is where
 * the engine decides what to do with the pair. Two rules, and they are not the
 * same rule:
 *
 *   - **For colour evidence**, the painted background counts. That is what a
 *     reader sees behind the component, so {@link surfaceBackground} prefers the
 *     element's own fill and falls back to the inherited one -- marking which it
 *     returned, because provenance that cannot tell them apart is not provenance.
 *   - **For a component's own fill**, it does not. A ghost button on a white
 *     page is a ghost button, not a white button; `hasOpaqueFill` in
 *     `components/` reads `styles.backgroundColor` directly and must keep
 *     doing so.
 */
import { parseColor } from '../color/space'
import type { CaptureRecord } from './types'

/** A capture's background as it was painted, and whose value it is. */
export interface SurfaceBackground {
  /** The raw string, exactly as captured. */
  raw: string
  /** True when the value came from an ancestor rather than the element itself. */
  inherited: boolean
}

/**
 * The background painted behind a capture: its own fill, or what showed through.
 *
 * `undefined` when neither is a colour this engine can read -- an unparseable
 * string, or a transparent element whose capture carries no inherited value
 * (every record written before the extension measured one).
 */
export function surfaceBackground(capture: CaptureRecord): SurfaceBackground | undefined {
  const own = capture.styles.backgroundColor
  if (own !== undefined && parseColor(own) !== undefined) return { raw: own.trim(), inherited: false }
  const inherited = capture.inheritedBackgroundColor
  if (inherited !== undefined && parseColor(inherited) !== undefined) return { raw: inherited.trim(), inherited: true }
  return undefined
}

/**
 * How light the surface behind a capture is, in the four answers worth having.
 *
 * `mid` and `unknown` are deliberately distinct and both inert: `mid` is a
 * surface that is genuinely neither -- a brand blue, a mid grey -- and
 * `unknown` is a capture that carries no readable background at all. Collapsing
 * them would make "nothing measured" look like a judgement.
 *
 * The thresholds are wide on purpose. This answers "would a reader call this a
 * light UI or a dark one", which is the question a mixed selection turns on, and
 * a band that classified a `#5e6ad2` button fill as dark would report a theme
 * clash between two captures off the same light page.
 */
export type SurfaceTone = 'light' | 'dark' | 'mid' | 'unknown'

/** At or above this OKLCH lightness, a surface reads as a light UI. */
export const LIGHT_TONE_MIN = 0.75
/** At or below it, a dark one. */
export const DARK_TONE_MAX = 0.4

/**
 * A theme is a *surface*, so a capture's own fill counts as evidence of one
 * only when the capture is a card; every other type is judged by what it sits
 * on. The case this exists for is the near-black CTA on a light page -- a
 * `#0a2540` button off a white pricing page is one theme, not two, and a fill
 * that voted would report a clash on an ordinary light site. It errs one way
 * only: it can lose evidence, never invent a clash.
 */
export function surfaceTone(capture: CaptureRecord): SurfaceTone {
  const background = surfaceBackground(capture)
  if (background === undefined) return 'unknown'
  if (!background.inherited && capture.componentType !== 'card') return 'unknown'
  const parsed = parseColor(background.raw)
  if (parsed === undefined) return 'unknown'
  if (parsed.oklch.l >= LIGHT_TONE_MIN) return 'light'
  if (parsed.oklch.l <= DARK_TONE_MAX) return 'dark'
  return 'mid'
}
