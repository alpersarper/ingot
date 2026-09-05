/**
 * Typography distillation.
 *
 * Dominant choice throughout: the most-used font family becomes `sans`, the
 * most-used font size becomes `base`, and the observed sizes around it fill the
 * scale outward. Sizes are never snapped -- unlike spacing, a 15px heading is a
 * deliberate typographic choice, not a rounding error, and merging it would
 * silently rewrite the source's voice.
 */
import { byNumber, byString, chain } from '../util/sort'
import { round } from '../util/num'
import type { CaptureRecord } from '../capture/types'
import {
  normalizeFontFamily,
  parseLineHeight,
  parsePx,
  parseWeight,
  readFontFamilies,
  readFontSizes,
  readFontWeights,
} from '../capture/read'
import { decide, derive, provenance, tally } from '../provenance'
import type { Contribution, ObservedValue } from '../provenance'
import type { Diagnostic, Token, TypeStep, TypeStepName, TypographyTokens } from '../tokens/types'

/** Step names below `base`, nearest first. */
const BELOW: TypeStepName[] = ['sm', 'xs']
/** Step names above `base`, nearest first. */
const ABOVE: TypeStepName[] = ['lg', 'xl', '2xl', '3xl', '4xl']

/** Canonical names for the CSS numeric weights a kit is likely to use. */
const WEIGHT_NAMES: ReadonlyMap<number, string> = new Map([
  [100, 'thin'],
  [200, 'extralight'],
  [300, 'light'],
  [400, 'regular'],
  [500, 'medium'],
  [600, 'semibold'],
  [700, 'bold'],
  [800, 'extrabold'],
  [900, 'black'],
])

/** Sizes closer than this ratio are near-duplicates worth flagging. */
const ADJACENT_SIZE_RATIO = 1.1

/** Fallback line height when a size has no usable observation. */
const DEFAULT_LINE_HEIGHT = 1.5

const MONO_HINT = /\b(mono|consolas|menlo|courier|monaco|code)\b/i

export function distillTypography(
  captures: readonly CaptureRecord[],
  diagnostics: Diagnostic[],
): TypographyTokens {
  const familyObservations = readFontFamilies(captures)
  const sizeObservations = readFontSizes(captures)
  const weightObservations = readFontWeights(captures)

  // --- families -------------------------------------------------------------
  const monoRaw = familyObservations.filter((observation) => MONO_HINT.test(observation.value))
  const sansRaw = familyObservations.filter((observation) => !MONO_HINT.test(observation.value))

  const sansTally = tally(sansRaw.map((o) => ({ value: o.value, captureId: o.captureId })))
  const families: TypographyTokens['families'] = (() => {
    const winner = sansTally[0]
    if (winner) {
      return {
        sans: {
          value: winner.value,
          provenance: provenance(sansTally, decide('dominant-value', winner.value, sansTally, { unit: 'capture' })),
        },
      }
    }
    const fallback = normalizeFontFamily(
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    ) as string
    diagnostics.push({
      level: 'warning',
      code: 'typography.no-family',
      path: 'typography.families.sans',
      message: 'No font family was captured; fell back to the system sans stack.',
    })
    return {
      sans: {
        value: fallback,
        provenance: {
          captureIds: [],
          observed: [],
          decision: derive(fallback, {
            method: 'system-stack',
            from: [],
            detail: 'no font family was captured',
          }),
        },
      },
    }
  })()

  const monoTally = tally(monoRaw.map((o) => ({ value: o.value, captureId: o.captureId })))
  const monoWinner = monoTally[0]
  if (monoWinner) {
    families.mono = {
      value: monoWinner.value,
      provenance: provenance(monoTally, decide('dominant-value', monoWinner.value, monoTally, { unit: 'capture' })),
    }
  }

  // --- size scale -----------------------------------------------------------
  const sizeTally = tally(sizeObservations.map((o) => ({ value: o.raw, captureId: o.captureId })))
  const distinctSizes = [...new Set(sizeObservations.map((o) => o.value))].sort(byNumber)

  const baseWinner = [...sizeTally].sort(
    chain<ObservedValue>(
      (a, b) => byNumber(b.count, a.count),
      // Ties go to the smaller size: body text is the most common text on a
      // page, and body text is small.
      (a, b) => byNumber(Number.parseFloat(a.value), Number.parseFloat(b.value)),
      (a, b) => byString(a.value, b.value),
    ),
  )[0]

  const basePx = baseWinner ? Number.parseFloat(baseWinner.value) : 16
  if (!baseWinner) {
    diagnostics.push({
      level: 'warning',
      code: 'typography.no-sizes',
      path: 'typography.steps',
      message: 'No font sizes were captured; fell back to a 16px base with a 1.25 ratio.',
    })
  }

  const belowSizes = distinctSizes.filter((size) => size < basePx).sort((a, b) => b - a)
  const aboveSizes = distinctSizes.filter((size) => size > basePx).sort(byNumber)

  const named: Array<{ name: TypeStepName; px: number; observed: boolean }> = [
    { name: 'base', px: basePx, observed: Boolean(baseWinner) },
  ]
  belowSizes.slice(0, BELOW.length).forEach((px, index) => {
    named.push({ name: BELOW[index] as TypeStepName, px, observed: true })
  })
  aboveSizes.slice(0, ABOVE.length).forEach((px, index) => {
    named.push({ name: ABOVE[index] as TypeStepName, px, observed: true })
  })

  const droppedSizes = [
    ...belowSizes.slice(BELOW.length),
    ...aboveSizes.slice(ABOVE.length),
  ].sort(byNumber)
  if (droppedSizes.length > 0) {
    diagnostics.push({
      level: 'info',
      code: 'typography.sizes-dropped',
      path: 'typography.steps',
      message: `The scale holds ${BELOW.length} steps below and ${ABOVE.length} above base; dropped ${droppedSizes.map((px) => `${px}px`).join(', ')}.`,
    })
  }

  // A single observed size is not a scale; extend it geometrically so the kit
  // has somewhere to put a heading.
  if (named.length === 1) {
    const ratio = 1.25
    named.push({ name: 'sm', px: round(basePx / ratio), observed: false })
    named.push({ name: 'lg', px: round(basePx * ratio), observed: false })
    named.push({ name: 'xl', px: round(basePx * ratio * ratio), observed: false })
    diagnostics.push({
      level: 'warning',
      code: 'typography.single-size',
      path: 'typography.steps',
      message: `Only one font size (${basePx}px) was captured; extended it with a 1.25 ratio so the scale is usable.`,
    })
  }

  named.sort(chain((a, b) => byNumber(a.px, b.px), (a, b) => byString(a.name, b.name)))

  for (let index = 1; index < named.length; index += 1) {
    const previous = named[index - 1] as { px: number }
    const current = named[index] as { px: number }
    if (current.px / previous.px < ADJACENT_SIZE_RATIO) {
      diagnostics.push({
        level: 'warning',
        code: 'typography.adjacent-sizes',
        path: 'typography.steps',
        message: `${previous.px}px and ${current.px}px are within ${round((current.px / previous.px - 1) * 100, 1)}% of each other. Merge them unless the difference is load-bearing.`,
      })
    }
  }

  const steps: Array<Token<TypeStep>> = named.map(({ name, px, observed }) => {
    const atSize = captures.filter((capture) => parsePx(capture.styles.fontSize) === px)

    const lineHeights = atSize
      .map((capture) => ({
        capture,
        ratio: parseLineHeight(capture.styles.lineHeight, px),
      }))
      .filter((entry): entry is { capture: CaptureRecord; ratio: number } => entry.ratio !== undefined)

    const lineHeightTally = tally(
      lineHeights.map((entry) => ({ value: String(round(entry.ratio, 3)), captureId: entry.capture.id })),
    )
    const lineHeight = lineHeightTally[0] ? Number.parseFloat(lineHeightTally[0].value) : DEFAULT_LINE_HEIGHT

    const weightTally = tally(
      atSize
        .map((capture) => ({ capture, weight: parseWeight(capture.styles.fontWeight) }))
        .filter((entry): entry is { capture: CaptureRecord; weight: number } => entry.weight !== undefined)
        .map((entry) => ({ value: String(entry.weight), captureId: entry.capture.id })),
    )
    const fontWeight = weightTally[0] ? Number.parseInt(weightTally[0].value, 10) : 400

    const trackingTally = tally(
      atSize
        .map((capture) => ({ capture, tracking: parsePx(capture.styles.letterSpacing) }))
        .filter((entry): entry is { capture: CaptureRecord; tracking: number } => entry.tracking !== undefined)
        .map((entry) => ({ value: String(entry.tracking), captureId: entry.capture.id })),
    )
    const tracking = trackingTally[0] ? Number.parseFloat(trackingTally[0].value) : undefined

    const step: TypeStep = {
      name,
      fontSize: px,
      lineHeight: round(lineHeight, 3),
      fontWeight,
      ...(tracking !== undefined && tracking !== 0 ? { letterSpacing: tracking } : {}),
    }

    const contributions: Contribution[] = atSize
      .map((capture) => ({ value: capture.styles.fontSize, captureId: capture.id }))
      .filter((entry): entry is Contribution => entry.value !== undefined)
    const observedTally = tally(contributions)

    if (!observed || observedTally.length === 0) {
      return {
        value: step,
        provenance: {
          captureIds: [],
          observed: [],
          decision: derive(`${px}px`, {
            method: 'geometric-extension',
            from: ['typography.baseSize'],
            detail: `extended the base size by a 1.25 ratio; line height defaults to ${DEFAULT_LINE_HEIGHT}`,
          }),
        },
      }
    }

    const decision = decide('dominant-value', `${px}px`, observedTally, { unit: 'capture' })
    decision.summary =
      `${observedTally.reduce((sum, entry) => sum + entry.count, 0)} capture(s) at ${px}px; ` +
      `line height ${step.lineHeight} from ${lineHeightTally[0]?.count ?? 0}/${lineHeights.length}, ` +
      `weight ${fontWeight} from ${weightTally[0]?.count ?? 0}/${atSize.length}`
    return { value: step, provenance: provenance(observedTally, decision) }
  })

  const ratios: number[] = []
  for (let index = 1; index < steps.length; index += 1) {
    const previous = (steps[index - 1] as Token<TypeStep>).value.fontSize
    const current = (steps[index] as Token<TypeStep>).value.fontSize
    if (previous > 0) ratios.push(current / previous)
  }
  const scaleRatio =
    ratios.length === 0
      ? 1
      : round(Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length), 3)

  // --- weights --------------------------------------------------------------
  const weightTally = tally(weightObservations.map((o) => ({ value: o.raw, captureId: o.captureId })))
  const weights = weightTally
    .map((entry) => {
      const value = Number.parseInt(entry.value, 10)
      return {
        value: { name: WEIGHT_NAMES.get(value) ?? `w${value}`, value },
        provenance: provenance([entry], decide('dominant-value', entry.value, weightTally, { unit: 'capture' })),
      }
    })
    .sort(chain((a, b) => byNumber(a.value.value, b.value.value)))

  return { families, baseSize: basePx, scaleRatio, weights, steps }
}
