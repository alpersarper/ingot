/**
 * The pairing token: the only thing standing between this API and any page the
 * user happens to have open.
 *
 * The panel is an ordinary web app on a known local port, so without a guard
 * any site in any tab could script requests at it and read a user's captures.
 * The guard is deliberately not an auth framework -- there are no accounts and
 * no sessions to manage. It is a shared secret the server mints once, the user
 * copies in on first run, and the panel sends as a header on every call.
 *
 * A header is the point: it cannot be attached by a form post or an image tag,
 * so a cross-site request cannot forge one, and the CORS lock in `cors.ts`
 * stops a scripted request from ever reading a response even if it could.
 *
 * The token is written to `<dataDir>/pairing-token.txt` and logged at startup
 * so the user has somewhere to copy it from. It never appears in an API
 * response body.
 */
import { randomBytes } from 'node:crypto'
import { timingSafeEqual } from 'node:crypto'
import type { Store } from './storage/store'

export const PAIRING_TOKEN_KEY = 'pairing.token'
export const PAIRING_HEADER = 'x-ingot-token'

/** 32 bytes of base64url: long enough that guessing is not a strategy. */
export function generatePairingToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * The token this server will accept, establishing one on first run.
 *
 * An environment-supplied token wins and is written through to storage, so a
 * deployment can pin it; otherwise the first boot on a fresh volume mints one
 * and every later boot reuses it.
 */
export async function resolvePairingToken(store: Store, fromEnv: string | undefined): Promise<string> {
  if (fromEnv !== undefined) {
    await store.settings.set(PAIRING_TOKEN_KEY, fromEnv)
    return fromEnv
  }
  const existing = await store.settings.get(PAIRING_TOKEN_KEY)
  if (existing !== null) return existing
  const minted = generatePairingToken()
  await store.settings.set(PAIRING_TOKEN_KEY, minted)
  return minted
}

/** Constant-time compare, so a wrong token leaks nothing about the right one. */
export function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
