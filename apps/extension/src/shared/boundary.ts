/**
 * Does the thing under the cursor have a visual boundary, or is it scaffolding?
 *
 * This module exists because of what a real capture session produced. Seven
 * captures off apple.com, dribbble.com and betterstack.com came back as seven
 * `card`s, five of them with `backgroundColor: rgba(0, 0, 0, 0)` and padding of
 * either `0px` or `128px`. Nothing had gone wrong mechanically: every one of
 * them was delivered, stored and distilled. They were simply not components.
 * They were the transparent `<div>`s that modern layout is built out of, and the
 * picker had happily measured the box the cursor landed in.
 *
 * A reader cannot see such an element. It paints no fill, draws no border, casts
 * no shadow, and the padding is either nothing at all or the 128px of a page
 * section -- which are the same fact twice over, not two different ones: a
 * transparent box with no border and no shadow is invisible whatever its
 * padding. So the rule is about *paint*, plus one case where the geometry
 * settles it on its own:
 *
 *   1. It paints nothing of its own, and it is not text. Text is the exception
 *      that has to be carved out: a heading paints nothing either, and it is a
 *      perfectly good typography capture.
 *   2. It is as wide as the viewport. A full-bleed hero is a layout container
 *      even when it does paint a background.
 *
 * Everything here is a pure function of an {@link ElementDescriptor} so the
 * rules can be tested against the values a real browser returns rather than the
 * ones jsdom can fake.
 */
import type { ElementDescriptor } from './descriptor'

/** A box at or beyond this share of the viewport width is layout, not a component. */
export const FULL_BLEED_RATIO = 0.9

/**
 * The alpha of a computed colour, when it states one.
 *
 * Computed styles come back as `rgb(r, g, b)` or `rgba(r, g, b, a)` from every
 * engine that matters, but a page using a wide-gamut colour gets
 * `color(srgb r g b / a)` and `rgb(r g b / a)` -- and a picker that read the
 * blue channel as an alpha would call an opaque `rgb(0, 0, 0)` transparent, so
 * the alpha slot is matched rather than "the last number".
 */
function alphaOf(value: string): number | undefined {
  const comma = /^rgba?\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*([^,)]+)\)$/.exec(value)
  const slash = /\/\s*([^/)]+)\)$/.exec(value)
  const raw = (comma?.[1] ?? slash?.[1])?.trim()
  if (raw === undefined) return undefined
  const percent = raw.endsWith('%')
  const parsed = Number.parseFloat(percent ? raw.slice(0, -1) : raw)
  if (!Number.isFinite(parsed)) return undefined
  return percent ? parsed / 100 : parsed
}

/** Does this computed colour put anything on screen? */
export function paints(color: string): boolean {
  const value = color.trim().toLowerCase()
  if (value === '' || value === 'transparent' || value === 'none') return false
  const alpha = alphaOf(value)
  return alpha === undefined || alpha > 0
}

/**
 * Does the element draw a background, border or shadow **of its own**?
 *
 * Its own, emphatically: an inherited background is what shows through it, and
 * an element you can only see because of what is behind it is the thing this
 * module is here to catch.
 */
export function paintsOwnSurface(element: Pick<ElementDescriptor, 'painted' | 'borderWidth' | 'hasShadow'>): boolean {
  if (element.painted !== null && !element.painted.inherited) return true
  return element.borderWidth > 0 || element.hasShadow
}

/** Is the element's content just text -- something to read, on one flow? */
export function isTextish(element: ElementDescriptor): boolean {
  return element.textLength > 0 && !element.hasBlockChildren
}

/**
 * Why this element looks like a layout wrapper rather than a component, in the
 * words the picker puts on screen. `null` when it looks like a component.
 */
export function wrapperReason(element: ElementDescriptor): string | null {
  if (element.viewportWidth > 0 && element.width >= element.viewportWidth * FULL_BLEED_RATIO) {
    return 'it is as wide as the whole viewport'
  }
  if (!paintsOwnSurface(element) && !isTextish(element)) {
    return 'it paints no background, border or shadow of its own'
  }
  return null
}

/* ------------------------------------------------------------- the words -- */

/** `"16px"`, `"16/24px"`, `"8/16/8/16px"` -- as few numbers as say it. */
function paddingPhrase(padding: readonly [number, number, number, number]): string {
  const [top, right, bottom, left] = padding
  if (padding.every((side) => side === 0)) return 'no padding'
  const sides =
    top === right && right === bottom && bottom === left
      ? [top]
      : top === bottom && right === left
        ? [top, right]
        : [top, right, bottom, left]
  return `${sides.map(round).join('/')}px padding`
}

/** Trim a subpixel length to one decimal; the chip is not a spreadsheet. */
function round(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function backgroundPhrase(element: ElementDescriptor): string {
  const painted = element.painted
  if (painted === null) return 'no background'
  if (!painted.inherited) return painted.color
  return `transparent, on ${painted.color}`
}

/**
 * The compact background / border / padding line the hover chip shows.
 *
 * It is here rather than in the picker because it is the *evidence* for the
 * wrapper verdict: a person who is told "this looks like a wrapper" is owed the
 * three facts that led to it, and the two have to agree by construction.
 */
export function boundarySummary(element: ElementDescriptor): string {
  const parts = [backgroundPhrase(element)]
  parts.push(element.borderWidth > 0 ? `${round(element.borderWidth)}px border` : 'no border')
  if (element.hasShadow) parts.push('shadow')
  parts.push(paddingPhrase(element.padding))
  return parts.join(' · ')
}
