/**
 * The pairing endpoints, and the middleware that guards everything else.
 *
 * These two routes are open by necessity: the panel has to be able to ask
 * whether pairing is required and to check a token the user just typed, before
 * it holds one. Neither leaks anything -- the status route returns a constant,
 * and verify returns yes or no.
 */
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { ApiError } from '../errors'
import { PAIRING_HEADER, tokenMatches } from '../pairing'
import type { AppContext, AppEnv } from '../context'
import { readJsonBody, requireString } from '../validate'

/** Paths under `/api` that do not require a token. Everything else does. */
export const OPEN_API_PATHS: readonly string[] = ['/api/health', '/api/pairing', '/api/pairing/verify']

function isOpen(path: string): boolean {
  return OPEN_API_PATHS.includes(path)
}

/**
 * Reject any API request that does not present the pairing token.
 *
 * Written as an allowlist of open paths rather than as "register the open
 * routes first and hope": route registration order is easy to disturb, and the
 * failure mode of disturbing it is an unguarded API.
 */
export function requirePairing(context: AppContext): MiddlewareHandler {
  return async (c, next) => {
    if (isOpen(new URL(c.req.url).pathname)) return next()
    if (!tokenMatches(context.pairingToken, c.req.header(PAIRING_HEADER))) {
      throw ApiError.unauthorized(
        `this panel is not paired with you; send the pairing token in the ${PAIRING_HEADER} header`,
      )
    }
    return next()
  }
}

export function pairingRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', (c) =>
    c.json({
      pairing: {
        required: true,
        header: PAIRING_HEADER,
        /** Where the user can find the token the server minted. */
        tokenFile: 'pairing-token.txt in the panel data directory, and the server startup log',
      },
    }),
  )

  app.post('/verify', async (c) => {
    const token = requireString(await readJsonBody(c.req.raw), 'token')
    if (!tokenMatches(context.pairingToken, token)) throw ApiError.unauthorized('that pairing token is not valid')
    return c.json({ paired: true })
  })

  return app
}
