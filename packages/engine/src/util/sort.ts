/**
 * Locale-independent comparators.
 *
 * `Array.prototype.sort` without a comparator stringifies and compares with
 * implementation-defined collation; every sort in the engine passes one of
 * these instead so ordering is identical on every machine.
 */

/** Byte-order string comparison (no locale, no case folding). */
export function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Ascending numeric comparison. */
export function byNumber(a: number, b: number): number {
  return a - b
}

/**
 * Compose comparators: the first non-zero result wins.
 *
 * Always terminate a chain with a total tie-breaker (usually {@link byString}
 * over a unique key) so the ordering is a total order, not just a partial one.
 */
export function chain<T>(...comparators: Array<(a: T, b: T) => number>): (a: T, b: T) => number {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b)
      if (result !== 0) return result
    }
    return 0
  }
}
