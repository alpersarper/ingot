/**
 * Spacing distillation.
 *
 * Real sites space things at 7px, 10px, 13px and 15px. A design system cannot
 * carry that, so the engine picks one base unit and snaps everything onto it.
 * The snapping is the clustering: values that land on the same multiple are the
 * same step, and each step's provenance lists the raw values it absorbed.
 */
import { byNumber, byString, chain } from '../util/sort'
import { round, snapToMultiple } from '../util/num'
import type { Observation } from '../capture/read'
import { decide, provenance, tally } from '../provenance'
import type { Contribution } from '../provenance'
import type { Diagnostic, SpacingStep, SpacingTokens } from '../tokens/types'
import type { Token } from '../tokens/types'

/**
 * Base units the engine will consider, largest first.
 *
 * 4px is the floor: below that a "scale" stops constraining anything, so a set
 * that fits nothing better still gets 4.
 */
export const CANDIDATE_BASES = [8, 4] as const

/**
 * Fraction of observations that must already be exact multiples of a base for
 * that base to be adopted. Set high on purpose -- adopting 8px when only 70% of
 * the evidence is 8px-clean silently rewrites a third of the source spacing.
 */
export const BASE_FIT_THRESHOLD = 0.85

/** Largest multiple the engine will fill in when closing gaps in the scale. */
const MAX_FILLED_MULTIPLE = 12

export const SNAPPING_RULE =
  'Each observed padding, margin and gap length is snapped to the nearest multiple of the base unit; ' +
  'exact .5 ties round up. A non-zero length shorter than half the base unit snaps up to one base unit ' +
  'rather than collapsing to 0, because a visible gap must stay visible. Steps are named by their ' +
  'multiplier, so step "3" is 3 x the base unit.'

/** How well a candidate base fits the observations: the multiple-of-base share. */
export function baseFit(values: readonly number[], base: number): number {
  const nonZero = values.filter((value) => value > 0)
  if (nonZero.length === 0) return 1
  const exact = nonZero.filter((value) => value % base === 0).length
  return round(exact / nonZero.length, 3)
}

/**
 * Pick the base unit: the largest candidate whose fit clears
 * {@link BASE_FIT_THRESHOLD}, else the smallest candidate.
 */
export function chooseBase(values: readonly number[]): { base: number; fit: number; fellBack: boolean } {
  for (const base of CANDIDATE_BASES) {
    const fit = baseFit(values, base)
    if (fit >= BASE_FIT_THRESHOLD) return { base, fit, fellBack: false }
  }
  const fallback = CANDIDATE_BASES[CANDIDATE_BASES.length - 1] as number
  return { base: fallback, fit: baseFit(values, fallback), fellBack: true }
}

/** Snap one length onto the base unit, per {@link SNAPPING_RULE}. */
export function snapSpacing(value: number, base: number): number {
  if (value <= 0) return 0
  return Math.max(base, snapToMultiple(value, base))
}

export function distillSpacing(
  observations: readonly Observation<number>[],
  diagnostics: Diagnostic[],
): SpacingTokens {
  const values = observations.map((observation) => observation.value)
  const { base, fit, fellBack } = chooseBase(values)

  if (fellBack) {
    diagnostics.push({
      level: 'warning',
      code: 'spacing.low-fit',
      path: 'spacing.baseUnit',
      message:
        `No candidate base unit fit the captures well (best fit ${fit} against a ${BASE_FIT_THRESHOLD} threshold). ` +
        `Fell back to ${base}px; ${round((1 - fit) * 100, 1)}% of observed lengths were rewritten by snapping.`,
    })
  }

  const byMultiple = new Map<number, Contribution[]>()
  for (const observation of observations) {
    const snapped = snapSpacing(observation.value, base)
    const multiple = snapped / base
    const existing = byMultiple.get(multiple)
    const contribution: Contribution = { value: observation.raw, captureId: observation.captureId }
    if (existing) existing.push(contribution)
    else byMultiple.set(multiple, [contribution])
  }

  const observedMultiples = [...byMultiple.keys()].sort(byNumber)
  const maxObserved = observedMultiples[observedMultiples.length - 1] ?? 0
  const fillTo = Math.min(maxObserved, MAX_FILLED_MULTIPLE)

  const allMultiples = new Set(observedMultiples)
  for (let multiple = 0; multiple <= fillTo; multiple += 1) allMultiples.add(multiple)

  const steps: Array<Token<SpacingStep>> = [...allMultiples].sort(byNumber).map((multiple) => {
    const px = round(multiple * base, 3)
    const step: SpacingStep = { name: String(multiple), multiple, px }
    const contributions = byMultiple.get(multiple)

    if (!contributions || contributions.length === 0) {
      return {
        value: step,
        provenance: {
          captureIds: [],
          observed: [],
          decision: {
            strategy: 'derived',
            chosen: `${px}px`,
            chosenCount: 0,
            totalCount: 0,
            confidence: 0,
            competitors: [],
            summary: `derived: gap in the observed scale, filled as ${multiple} x ${base}px`,
            derivation: {
              method: 'scale-gap-fill',
              from: ['spacing.baseUnit'],
              detail: `no capture used ${px}px, but the step is needed to keep the scale contiguous up to ${fillTo} x ${base}px`,
            },
          },
        },
      }
    }

    const observed = tally(contributions)
    const decision = decide('snapped-scale', `${px}px`, observed, { unit: 'length' })
    // `chosen` is the snapped value, which frequently was never literally
    // observed, so restate the summary in terms of what the step absorbed.
    const rawList = observed
      .map((entry) => `${entry.value} x${entry.count}`)
      .sort(byString)
      .join(', ')
    decision.chosenCount = decision.totalCount
    decision.confidence = 1
    decision.competitors = []
    decision.summary = `${decision.totalCount} observed length(s) snapped to ${px}px (${rawList})`
    return { value: step, provenance: provenance(observed, decision) }
  })

  const offScale = observations.filter(
    (observation) => observation.value > 0 && observation.value % base !== 0,
  )
  if (offScale.length > 0) {
    const worst = [...offScale]
      .sort(
        chain<Observation<number>>(
          (a, b) =>
            byNumber(
              Math.abs(snapSpacing(b.value, base) - b.value),
              Math.abs(snapSpacing(a.value, base) - a.value),
            ),
          (a, b) => byString(a.captureId + a.property, b.captureId + b.property),
        ),
      )
      .slice(0, 5)
      .map((observation) => `${observation.raw} -> ${snapSpacing(observation.value, base)}px (${observation.captureId})`)
    diagnostics.push({
      level: 'info',
      code: 'spacing.snapped',
      path: 'spacing.steps',
      message: `${offScale.length} observed length(s) were not multiples of ${base}px and were snapped. Largest moves: ${worst.join(', ')}.`,
    })
  }

  return { baseUnit: base, unit: 'px', snappingRule: SNAPPING_RULE, fit, steps }
}
