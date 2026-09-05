/**
 * Corner radius distillation.
 *
 * Dominant choice: the most frequently observed radius becomes `md`, and the
 * nearest observed radii on either side become `sm` and `lg`. Anything the
 * captures do not supply is derived from `md` by halving and doubling.
 */
import { byNumber, byString, chain } from '../util/sort'
import { median, round } from '../util/num'
import type { Observation } from '../capture/read'
import { decide, derive, provenance, tally } from '../provenance'
import type { Contribution, ObservedValue } from '../provenance'
import type { Diagnostic, RadiusStepName, RadiusTokens, Token } from '../tokens/types'

/** A radius at or above this is a pill, not a corner rounding. */
export const PILL_THRESHOLD = 999

/** How many distinct corner radii the scale keeps. */
const MAX_STEPS = 3

function derivedToken(px: number, method: string, detail: string): Token<number> {
  return {
    value: px,
    provenance: {
      captureIds: [],
      observed: [],
      decision: derive(`${px}px`, { method, from: ['radius.steps.md'], detail }),
    },
  }
}

export function distillRadius(
  observations: readonly Observation<number>[],
  diagnostics: Diagnostic[],
): RadiusTokens {
  const steps: Partial<Record<RadiusStepName, Token<number>>> = {}

  const pills = observations.filter((observation) => observation.value >= PILL_THRESHOLD)
  const corners = observations.filter(
    (observation) => observation.value > 0 && observation.value < PILL_THRESHOLD,
  )
  const zeros = observations.filter((observation) => observation.value === 0)

  const contributionsFor = (list: readonly Observation<number>[]): Contribution[] =>
    list.map((observation) => ({ value: observation.raw, captureId: observation.captureId }))

  const zeroTally = tally(contributionsFor(zeros))
  steps.none =
    zeros.length > 0
      ? { value: 0, provenance: provenance(zeroTally, decide('dominant-value', '0px', zeroTally, { unit: 'corner' })) }
      : {
          value: 0,
          provenance: {
            captureIds: [],
            observed: [],
            decision: derive('0px', {
              method: 'scale-anchor',
              from: [],
              detail: 'every scale needs a square corner; 0px is always available',
            }),
          },
        }

  if (corners.length === 0) {
    steps.md = derivedToken(
      6,
      'default-radius',
      'no rounded corners were captured; used a conservative 6px default so the scale is complete',
    )
    steps.sm = derivedToken(3, 'half-of-md', 'md / 2, rounded to the nearest px')
    steps.lg = derivedToken(12, 'double-md', 'md x 2')
    return { unit: 'px', steps: ordered(steps) }
  }

  const cornerTally = tally(contributionsFor(corners))
  const cornerValues = corners.map((observation) => observation.value)
  const middle = median(cornerValues)

  // Dominant choice picks *which* radii belong in the scale: the three most
  // observed, with ties broken toward the median so a three-way tie yields the
  // middle value rather than an arbitrary end. Size then names them, so `md` is
  // always between `sm` and `lg` even when it was not the single most common.
  const ranked = [...cornerTally].sort(
    chain<ObservedValue>(
      (a, b) => byNumber(b.count, a.count),
      (a, b) =>
        byNumber(
          Math.abs(Number.parseFloat(a.value) - middle),
          Math.abs(Number.parseFloat(b.value) - middle),
        ),
      (a, b) => byNumber(Number.parseFloat(a.value), Number.parseFloat(b.value)),
      (a, b) => byString(a.value, b.value),
    ),
  )

  const kept = ranked.slice(0, MAX_STEPS).sort((a, b) => byNumber(Number.parseFloat(a.value), Number.parseFloat(b.value)))
  const dropped = ranked.slice(MAX_STEPS)
  if (dropped.length > 0) {
    diagnostics.push({
      level: 'info',
      code: 'radius.truncated',
      path: 'radius.steps',
      message: `${ranked.length} distinct corner radii were observed; kept the ${MAX_STEPS} most used. Dropped: ${dropped.map((entry) => `${entry.value} (x${entry.count})`).join(', ')}.`,
    })
  }

  const names: RadiusStepName[] =
    kept.length >= 3 ? ['sm', 'md', 'lg'] : kept.length === 2 ? ['sm', 'md'] : ['md']
  kept.forEach((entry, index) => {
    const name = names[index] as RadiusStepName
    const px = Number.parseFloat(entry.value)
    steps[name] = {
      value: px,
      provenance: provenance(
        [entry],
        decide('dominant-value', entry.value, cornerTally, { unit: 'corner' }),
      ),
    }
  })

  const md = steps.md as Token<number>
  if (!steps.sm) {
    steps.sm = derivedToken(
      Math.max(1, round(md.value / 2)),
      'half-of-md',
      'no smaller radius was captured; md / 2 rounded to the nearest px',
    )
  }
  if (!steps.lg) {
    steps.lg = derivedToken(round(md.value * 2), 'double-md', 'no larger radius was captured; md x 2')
  }

  if (pills.length > 0) {
    const pillObserved = tally(contributionsFor(pills))
    const dominantPill = pillObserved[0] as ObservedValue
    steps.full = {
      value: Number.parseFloat(dominantPill.value),
      provenance: provenance(
        pillObserved,
        decide('dominant-value', dominantPill.value, pillObserved, { unit: 'corner' }),
      ),
    }
  }

  return { unit: 'px', steps: ordered(steps) }
}

/** Reinsert steps in scale order so the serialised document reads low-to-high. */
function ordered(
  steps: Partial<Record<RadiusStepName, Token<number>>>,
): Partial<Record<RadiusStepName, Token<number>>> {
  const out: Partial<Record<RadiusStepName, Token<number>>> = {}
  for (const name of ['none', 'sm', 'md', 'lg', 'full'] as const) {
    const token = steps[name]
    if (token) out[name] = token
  }
  return out
}
