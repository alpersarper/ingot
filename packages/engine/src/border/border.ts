/**
 * Border width distillation.
 *
 * A one-token group, but it earns its place: without it the exported spec has
 * to assert "borders are 1px" on faith, and a set built from sources that use
 * 2px rules would be silently wrong.
 */
import { byNumber, byString, chain } from '../util/sort'
import type { Observation } from '../capture/read'
import { decide, derive, provenance, tally } from '../provenance'
import type { ObservedValue } from '../provenance'
import type { BorderTokens } from '../tokens/types'

export function distillBorder(observations: readonly Observation<number>[]): BorderTokens {
  // Zero-width borders are the default on most elements and would swamp the
  // tally; only widths that actually draw a line are evidence.
  const drawn = observations.filter((observation) => observation.value > 0)

  if (drawn.length === 0) {
    return {
      unit: 'px',
      width: {
        value: 1,
        provenance: {
          captureIds: [],
          observed: [],
          decision: derive('1px', {
            method: 'default-border-width',
            from: [],
            detail: 'no visible border was captured; 1px is the hairline every kit falls back to',
          }),
        },
      },
    }
  }

  const observed = tally(drawn.map((observation) => ({ value: observation.raw, captureId: observation.captureId })))
  const dominant = [...observed].sort(
    chain<ObservedValue>(
      (a, b) => byNumber(b.count, a.count),
      (a, b) => byNumber(Number.parseFloat(a.value), Number.parseFloat(b.value)),
      (a, b) => byString(a.value, b.value),
    ),
  )[0] as ObservedValue

  return {
    unit: 'px',
    width: {
      value: Number.parseFloat(dominant.value),
      provenance: provenance(observed, decide('dominant-value', dominant.value, observed, { unit: 'edge' })),
    },
  }
}
