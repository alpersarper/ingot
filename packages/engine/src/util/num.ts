/**
 * Deterministic numeric helpers.
 *
 * Every number that reaches the output document goes through {@link round} so
 * that floating point drift can never change the serialised bytes, and so that
 * `-0` can never appear in JSON.
 */

/** Round to `digits` decimal places, normalising `-0` to `0`. */
export function round(value: number, digits = 0): number {
  if (!Number.isFinite(value)) throw new RangeError(`cannot round non-finite value: ${value}`)
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

/** Clamp `value` into the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * Snap `value` to the nearest multiple of `base`, breaking exact `.5` ties
 * upward so the result never depends on the host's rounding mode.
 */
export function snapToMultiple(value: number, base: number): number {
  if (base <= 0) throw new RangeError(`base must be positive, received ${base}`)
  return Math.floor(value / base + 0.5) * base
}

/** Median of a numeric list. Returns the lower of the two middles for even lengths. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of an empty list is undefined')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = (sorted.length - 1) >> 1
  return sorted[mid] as number
}
