/**
 * Id and time factories.
 *
 * These are the only places the server reaches for randomness or the clock on
 * the storage path, so the tests can pin both by handing an adapter different
 * ones. Ids are opaque and stable: nothing derives meaning from their shape.
 */
import { randomUUID } from 'node:crypto'
import type { Clock, IdFactory } from './store'

export const uuidIdFactory: IdFactory = () => randomUUID()

export const systemClock: Clock = () => new Date().toISOString()

/** Sequential ids, for tests that assert on stored values. */
export function countingIdFactory(prefix = 'id'): IdFactory {
  let next = 0
  return () => {
    next += 1
    return `${prefix}-${String(next).padStart(4, '0')}`
  }
}

/** A clock that advances one second per call, for tests. */
export function steppingClock(startIso = '2026-01-01T00:00:00.000Z'): Clock {
  let millis = Date.parse(startIso)
  return () => {
    const value = new Date(millis).toISOString()
    millis += 1000
    return value
  }
}
