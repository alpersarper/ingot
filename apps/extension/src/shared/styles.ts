/**
 * Computed styles -> a capture record's `styles`, and nothing else.
 *
 * This is the whole of what the extension reads off a page: the properties
 * `schemas/capture-record.schema.json` names, as `getComputedStyle` resolved
 * them. No markup, no stylesheets, no selectors, no attributes -- the consuming
 * pipeline needs values and a picture, and DECISIONS.md forbids the rest.
 *
 * It is a pure function of a property reader and a box so it can be tested
 * without a browser, which matters more than it looks: the interesting cases
 * here are the ones a real page produces and jsdom does not.
 *
 * Four things need normalising on the way out, and each is a case where the
 * browser's honest answer is not a value the schema accepts:
 *
 *   - percentage radii, which `getComputedStyle` reports verbatim as `"50%"`;
 *   - variable-font weights like `"450"`, which the schema's `^[1-9]00$` rejects;
 *   - `gap`, which is `"normal"` on every element that is not flex or grid;
 *   - border colour, which browsers report even when no border is drawn -- the
 *     phantom value `docs/capture-record.md` warns about.
 *
 * Everything else is passed through exactly as the browser said it, including
 * colours: the record carries what was observed and the engine normalises.
 */
import type { CapturedStyles } from '@ingot/engine'
import type { Rect } from './protocol'

/**
 * Reads one CSSOM property. `getComputedStyle` satisfies this directly; a test
 * hands it a map.
 */
export type StyleReader = (property: string) => string

/** `"12px"`, `"-4px"`, `"13.3333px"` -- what the schema's `cssLength` accepts. */
const PX = /^-?\d+(?:\.\d+)?px$/

/** A radius at or beyond this is read as a pill by the engine. */
const PILL_RADIUS = '9999px'

const RADIUS_CORNERS = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
] as const

const BORDER_WIDTHS = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] as const

const BORDER_SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const

/** Properties that are already px on every element and just need checking. */
const PLAIN_LENGTHS = [
  'fontSize',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  ...BORDER_WIDTHS,
] as const

function px(value: string): string | undefined {
  return PX.test(value.trim()) ? value.trim() : undefined
}

function toNumber(value: string): number | undefined {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim())
  return match === null ? undefined : Number(match[1])
}

/** Trim a float to at most three decimals without turning `12` into `12.000`. */
function roundPx(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`
}

/**
 * A corner radius as the browser will actually draw it, in px.
 *
 * Percentages resolve against the box -- that is what a `50%` radius means --
 * and a corner rounded to its maximum is a pill rather than "half the width",
 * which is the distinction `docs/capture-record.md` draws at 999px. Reporting
 * `20px` for a fully-round 40px control would tell the engine the opposite of
 * what the eye sees.
 */
export function normaliseRadius(value: string, box: Rect): string | undefined {
  const raw = value.trim()
  const shorter = Math.min(box.width, box.height)

  // Elliptical corners compute to the two-value form -- `"10px 20px"`,
  // `"50% 40%"`. The first value is the horizontal radius; the engine models
  // one number per corner, so that is the one that travels.
  const first = raw.split(/\s+/)[0] ?? raw

  const direct = px(first)
  if (direct !== undefined) {
    const size = toNumber(direct) ?? 0
    return shorter > 0 && size >= shorter / 2 ? PILL_RADIUS : direct
  }

  const percent = /^(\d+(?:\.\d+)?)%$/.exec(first)
  if (percent === null) return undefined
  const ratio = Number(percent[1]) / 100
  if (!Number.isFinite(ratio)) return undefined
  if (ratio >= 0.5) return PILL_RADIUS
  const size = ratio * box.width
  return shorter > 0 && size >= shorter / 2 ? PILL_RADIUS : roundPx(size)
}

/**
 * A numeric weight the schema accepts.
 *
 * Variable fonts resolve to anything -- `"450"`, `"325"` -- and the schema only
 * takes hundreds. Snapping to the nearest hundred keeps the observation rather
 * than dropping it; the alternative is a capture with no weight at all, which
 * is a worse lie than a 25-unit rounding.
 */
export function normaliseWeight(value: string): string | undefined {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  const snapped = Math.min(900, Math.max(100, Math.round(parsed / 100) * 100))
  return String(snapped)
}

/**
 * The gap, when the element is one of the two display types that have one.
 *
 * `getComputedStyle().gap` is `"normal"` on everything else, and the two-value
 * form `"10px 20px"` on a grid with different row and column gaps -- the
 * shorthand is `<row-gap> <column-gap>`. One number reaches the record, so the
 * row gap -- the first -- is the one taken: the two-value form only appears
 * when the gaps differ, and the row gap is the one that describes the vertical
 * rhythm of the column layouts most captured cards use.
 */
export function normaliseGap(value: string): string | undefined {
  const first = value.trim().split(/\s+/)[0]
  return first === undefined ? undefined : px(first)
}

/**
 * Does this element draw a border at all?
 *
 * `docs/capture-record.md`: browsers report `border-color` even at zero width,
 * usually as the text colour, and a capture that carries it hands the engine a
 * border colour that was never on screen.
 */
export function drawsBorder(read: StyleReader): boolean {
  const style = borderStyleOf(read)
  if (style === undefined || style === 'none' || style === 'hidden') return false
  return BORDER_WIDTHS.some((property) => (toNumber(read(property)) ?? 0) > 0)
}

/**
 * The border style, taken from whichever side actually draws one.
 *
 * Per-side styles differ often enough -- a table row with only a bottom rule --
 * that reading `borderTopStyle` alone would report `"none"` for a border the
 * page plainly has.
 */
function borderStyleOf(read: StyleReader): string | undefined {
  const styles = BORDER_SIDES.map((side) => read(`border${side}Style`).trim()).filter((value) => value !== '')
  if (styles.length === 0) return undefined
  const drawn = BORDER_SIDES.find((side) => {
    const style = read(`border${side}Style`).trim()
    return style !== '' && style !== 'none' && style !== 'hidden' && (toNumber(read(`border${side}Width`)) ?? 0) > 0
  })
  return drawn === undefined ? styles[0] : read(`border${drawn}Style`).trim()
}

/** The colour of the side that draws the border, for the same reason. */
function borderColourOf(read: StyleReader): string | undefined {
  const drawn = BORDER_SIDES.find(
    (side) =>
      (toNumber(read(`border${side}Width`)) ?? 0) > 0 &&
      !['none', 'hidden', ''].includes(read(`border${side}Style`).trim()),
  )
  const colour = read(`border${drawn ?? 'Top'}Color`).trim()
  return colour === '' ? undefined : colour
}

function set<K extends keyof CapturedStyles>(into: CapturedStyles, key: K, value: string | undefined): void {
  if (value !== undefined && value !== '') into[key] = value
}

/**
 * Read one element's capture styles.
 *
 * `box` is the element's border box in CSS pixels; only the percentage-radius
 * rule uses it.
 */
export function extractStyles(read: StyleReader, box: Rect): CapturedStyles {
  const styles: CapturedStyles = {}

  set(styles, 'color', read('color').trim())
  set(styles, 'backgroundColor', read('backgroundColor').trim())

  set(styles, 'fontFamily', read('fontFamily').trim())
  set(styles, 'fontWeight', normaliseWeight(read('fontWeight')))
  // `lineHeight` and `letterSpacing` may legitimately be `"normal"`; the record
  // carries it and the engine ignores it, which is better than the extension
  // deciding a font's default leading on the engine's behalf.
  set(styles, 'lineHeight', read('lineHeight').trim())
  set(styles, 'letterSpacing', read('letterSpacing').trim())

  for (const property of PLAIN_LENGTHS) set(styles, property, px(read(property)))
  set(styles, 'gap', normaliseGap(read('gap')))

  const style = borderStyleOf(read)
  set(styles, 'borderStyle', style)
  if (drawsBorder(read)) set(styles, 'borderColor', borderColourOf(read))

  for (const corner of RADIUS_CORNERS) set(styles, corner, normaliseRadius(read(corner), box))

  set(styles, 'boxShadow', read('boxShadow').trim())

  return styles
}
