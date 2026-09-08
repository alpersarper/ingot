/**
 * Server-side rate limiting for the assistant endpoints.
 *
 * The pairing token is the guard on this API, and it is a shared secret written
 * to a file and printed to a log. It is a good guard against a random page in a
 * tab; it is not a guard against having been copied. Everywhere else in this
 * server that costs nothing to get wrong -- a leaked token means someone can
 * read a user's captures, which is bad but bounded. The assistant is different
 * in kind: every call spends the user's own API credit, so a leaked token plus
 * a loop is a bill.
 *
 * So the limit is here rather than in the panel. A client-side limit protects
 * nobody -- the client is the thing that would be leaked -- and a limit on the
 * provider's side arrives after the money is spent. This one is counted in the
 * server, keyed on nothing, and applies to every assistant request from every
 * caller together, because there is exactly one user of a local panel and
 * per-caller buckets would only give an attacker somewhere to hide.
 *
 * A fixed window rather than a token bucket: the thing being prevented is a
 * loop, the window is short, and a window a person can state in a sentence --
 * "20 assistant calls a minute" -- is one they can reason about when they hit
 * it. The clock is injected so the tests can burst without sleeping.
 */
import { ApiError } from '../errors'
import type { MiddlewareHandler } from 'hono'

/** Requests allowed per window when nothing is configured. */
export const DEFAULT_ASSISTANT_RATE_LIMIT = 20

/** Length of that window, in milliseconds. */
export const DEFAULT_ASSISTANT_RATE_WINDOW_MS = 60_000

export interface RateLimitOptions {
  /** Requests allowed per window. */
  max: number
  windowMs: number
  /** Milliseconds since the epoch. Injected so tests need no timers. */
  now?: () => number
}

export interface RateLimiter {
  /**
   * Count one request.
   *
   * Returns the seconds a caller should wait when the window is full, or
   * `undefined` when the request is allowed. Counting happens on the way in, so
   * a request that fails at the provider still costs a slot -- the limit is
   * about the rate of *attempts*, and a loop of failures is exactly the shape
   * this is here to stop.
   */
  take(): number | undefined
  /** What the panel is told: the limit, and how much of it is left. */
  state(): { max: number; windowMs: number; remaining: number }
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? (() => Date.now())
  const { max, windowMs } = options
  let windowStart = now()
  let count = 0

  const roll = (): void => {
    const current = now()
    if (current - windowStart >= windowMs) {
      windowStart = current
      count = 0
    }
  }

  return {
    take() {
      roll()
      if (count >= max) return Math.max(1, Math.ceil((windowStart + windowMs - now()) / 1000))
      count += 1
      return undefined
    },
    state() {
      roll()
      return { max, windowMs, remaining: Math.max(0, max - count) }
    },
  }
}

/**
 * Refuse an over-budget request with a 429 and a `Retry-After`.
 *
 * 429 rather than 403: this is a "not now", and a client that treats it as a
 * permanent refusal will stop asking forever after one burst.
 */
export function rateLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const retryAfter = limiter.take()
    if (retryAfter === undefined) return next()
    c.header('Retry-After', String(retryAfter))
    throw new ApiError(
      429,
      'rate_limited',
      `too many assistant requests; this panel allows a limited number per minute so a copied pairing token cannot spend your API credit. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
    )
  }
}
