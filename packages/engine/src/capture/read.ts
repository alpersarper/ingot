/**
 * Style-value readers.
 *
 * Turns the string soup of computed styles into typed observations. Anything
 * unparseable is skipped rather than guessed at: a value the engine cannot
 * read with certainty must not influence a token.
 */
import type { CaptureRecord } from './types'

/** One observation of a value, tagged with the capture it came from. */
export interface Observation<T> {
  captureId: string
  /** The CSS property the value was read from, e.g. `"paddingTop"`. */
  property: string
  /** The raw string exactly as it appeared in the capture. */
  raw: string
  value: T
}

const LENGTH_PX = /^(-?\d+(?:\.\d+)?)px$/

/** Parse an absolute `px` length. Returns `undefined` for any other syntax. */
export function parsePx(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const match = LENGTH_PX.exec(raw.trim())
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** Parse a numeric CSS font weight. Keywords (`bold`, `normal`) are rejected. */
export function parseWeight(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  if (!/^\d{3}$/.test(raw.trim())) return undefined
  const value = Number(raw.trim())
  return value >= 100 && value <= 900 ? value : undefined
}

/**
 * Parse a line height into a unitless ratio, given the font size it applies to.
 * `"20px"` at 14px becomes `1.4286`; `"1.5"` stays `1.5`; `"normal"` is
 * rejected because its resolved value depends on the font, which the engine
 * cannot know.
 */
export function parseLineHeight(raw: string | undefined, fontSizePx: number | undefined): number | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  const px = parsePx(trimmed)
  if (px !== undefined) {
    if (fontSizePx === undefined || fontSizePx <= 0) return undefined
    return px / fontSizePx
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const value = Number(trimmed)
    return value > 0 ? value : undefined
  }
  return undefined
}

/**
 * Normalise a font-family list: trim members, strip quoting, drop empties.
 * Returns the canonical comma-joined form used as the clustering key.
 */
export function normalizeFontFamily(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const members = raw
    .split(',')
    .map((member) => member.trim().replace(/^["']|["']$/g, '').trim())
    .filter((member) => member.length > 0)
  if (members.length === 0) return undefined
  return members.map((member) => (/\s/.test(member) ? `"${member}"` : member)).join(', ')
}

const PADDING_PROPERTIES = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const
const MARGIN_PROPERTIES = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const
const RADIUS_PROPERTIES = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
] as const
const BORDER_WIDTH_PROPERTIES = [
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const

function collectPx(
  captures: readonly CaptureRecord[],
  properties: readonly string[],
): Array<Observation<number>> {
  const out: Array<Observation<number>> = []
  for (const capture of captures) {
    for (const property of properties) {
      const raw = (capture.styles as Record<string, string | undefined>)[property]
      const value = parsePx(raw)
      if (value === undefined || raw === undefined) continue
      out.push({ captureId: capture.id, property, raw, value })
    }
  }
  return out
}

/**
 * Every padding, margin and gap length in the set.
 *
 * Negative margins are dropped: they are layout escape hatches, not evidence of
 * a spacing scale.
 */
export function readSpacing(captures: readonly CaptureRecord[]): Array<Observation<number>> {
  return collectPx(captures, [...PADDING_PROPERTIES, ...MARGIN_PROPERTIES, 'gap']).filter((o) => o.value >= 0)
}

/** Every corner radius in the set. */
export function readRadii(captures: readonly CaptureRecord[]): Array<Observation<number>> {
  return collectPx(captures, RADIUS_PROPERTIES).filter((o) => o.value >= 0)
}

/** Every border width in the set. */
export function readBorderWidths(captures: readonly CaptureRecord[]): Array<Observation<number>> {
  return collectPx(captures, BORDER_WIDTH_PROPERTIES).filter((o) => o.value >= 0)
}

/** Whether a capture draws a visible border, and so whether its border colour counts. */
export function hasVisibleBorder(capture: CaptureRecord): boolean {
  const style = capture.styles.borderStyle?.trim()
  if (style !== undefined && (style === 'none' || style === 'hidden')) return false
  return BORDER_WIDTH_PROPERTIES.some((property) => (parsePx(capture.styles[property]) ?? 0) > 0)
}

/** Every font size in the set. */
export function readFontSizes(captures: readonly CaptureRecord[]): Array<Observation<number>> {
  return collectPx(captures, ['fontSize']).filter((o) => o.value > 0)
}

/** Every numeric font weight in the set. */
export function readFontWeights(captures: readonly CaptureRecord[]): Array<Observation<number>> {
  const out: Array<Observation<number>> = []
  for (const capture of captures) {
    const raw = capture.styles.fontWeight
    const value = parseWeight(raw)
    if (value === undefined || raw === undefined) continue
    out.push({ captureId: capture.id, property: 'fontWeight', raw, value })
  }
  return out
}

/** Every font family in the set, normalised. */
export function readFontFamilies(captures: readonly CaptureRecord[]): Array<Observation<string>> {
  const out: Array<Observation<string>> = []
  for (const capture of captures) {
    const raw = capture.styles.fontFamily
    const value = normalizeFontFamily(raw)
    if (value === undefined || raw === undefined) continue
    out.push({ captureId: capture.id, property: 'fontFamily', raw, value })
  }
  return out
}
