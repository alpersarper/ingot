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
 *     The extension records the backdrop whenever the own fill is not fully
 *     opaque, because a translucent fill is only half a colour: what a reader
 *     sees is it laid over what is behind, and that composite is what counts.
 *   - **For a component's own fill**, it does not. A ghost button on a white
 *     page is a ghost button, not a white button; `hasOpaqueFill` in
 *     `components/` reads `styles.backgroundColor` directly and must keep
 *     doing so.
 */
import { compositeOver, parseColor } from '../color/space'
import type { CaptureRecord } from './types'

/** A capture's background as it was painted, and whose value it is. */
export interface SurfaceBackground {
  /** The raw string, exactly as captured. */
  raw: string
  /**
   * The colour a reader sees. `raw` itself unless the element's own fill is
   * translucent and a backdrop was measured, in which case it is the one laid
   * over the other -- a `rgba(255, 255, 255, 0.04)` glass card on `#0b0f19`
   * is a dark surface, and read alone it is white.
   */
  rendered: string
  /** True when the value came from an ancestor rather than the element itself. */
  inherited: boolean
}

/**
 * The background painted behind a capture: its own fill, or what showed through.
 *
 * `undefined` when neither is a colour this engine can read -- an unparseable
 * string, or a transparent element whose capture carries no inherited value
 * (every record written before the extension measured one). A translucent own
 * fill with no backdrop to lay it over is read as it stands rather than over an
 * invented canvas.
 */
export function surfaceBackground(capture: CaptureRecord): SurfaceBackground | undefined {
  const own = capture.styles.backgroundColor
  const inherited = capture.inheritedBackgroundColor
  const backdrop = inherited !== undefined && parseColor(inherited) !== undefined ? inherited.trim() : undefined
  const parsedOwn = own === undefined ? undefined : parseColor(own)
  if (own !== undefined && parsedOwn !== undefined) {
    const raw = own.trim()
    const rendered = parsedOwn.alpha < 1 && backdrop !== undefined ? compositeOver(raw, backdrop) : undefined
    return { raw, rendered: rendered ?? raw, inherited: false }
  }
  if (backdrop !== undefined) return { raw: backdrop, rendered: backdrop, inherited: true }
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
 *
 * A control you can partly see through is judged by the measured backdrop, the
 * page behind it. That cannot bring the dark CTA back: an opaque fill has no
 * backdrop recorded at all, precisely because it is opaque, so it still votes
 * with nothing. Only a translucent control gets a vote, and what it votes with
 * is the page, never its own fill.
 */
export function surfaceTone(capture: CaptureRecord): SurfaceTone {
  const background = surfaceBackground(capture)
  if (background === undefined) return 'unknown'
  if (background.inherited || capture.componentType === 'card') return toneOf(background.rendered)
  const own = parseColor(background.raw)
  const backdrop = capture.inheritedBackgroundColor
  if (own === undefined || own.alpha >= 1 || backdrop === undefined) return 'unknown'
  return toneOf(backdrop)
}

function toneOf(color: string): SurfaceTone {
  const parsed = parseColor(color)
  if (parsed === undefined) return 'unknown'
  if (parsed.oklch.l >= LIGHT_TONE_MIN) return 'light'
  if (parsed.oklch.l <= DARK_TONE_MAX) return 'dark'
  return 'mid'
}
