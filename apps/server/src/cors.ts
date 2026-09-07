/**
 * CORS, locked to the panel.
 *
 * This middleware does two jobs, and the second is the one that matters. It
 * answers preflights and sets `Access-Control-Allow-Origin` for origins on the
 * allowlist -- and it *rejects* any cross-origin request whose `Origin` is not
 * on it, rather than merely declining to add the header. Declining the header
 * is enough to stop a script reading the response, but not enough to stop the
 * request happening; for an API with mutating endpoints, refusing outright is
 * the honest behaviour.
 *
 * The server's own origin is always allowed without being configured. In the
 * container the panel is served from this very server, so its requests are
 * same-origin, and requiring the operator to name their own port would be a
 * setup step that exists only to be got wrong.
 */
import type { MiddlewareHandler } from 'hono'
import { PAIRING_HEADER } from './pairing'

const ALLOWED_HEADERS = ['content-type', PAIRING_HEADER].join(', ')
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'

/** The origin this request was addressed to, as the browser would compute it. */
function selfOrigin(url: string, forwardedProto: string | undefined): string | null {
  try {
    const parsed = new URL(url)
    const protocol = forwardedProto === undefined ? parsed.protocol : `${forwardedProto}:`
    return `${protocol}//${parsed.host}`
  } catch {
    return null
  }
}

export function cors(allowedOrigins: readonly string[]): MiddlewareHandler {
  const allowed = new Set(allowedOrigins.map((origin) => origin.replace(/\/$/, '')))

  return async (c, next) => {
    const origin = c.req.header('origin')

    // Always, whether or not an Origin was sent: the response body can differ by
    // origin (allowed, or a 403), so a cache must not serve one origin's answer
    // to another.
    c.header('Vary', 'Origin')

    // No Origin header means it is not a cross-origin browser request: a
    // same-origin navigation, curl, or the extension's background worker. The
    // pairing token is the guard for those.
    if (origin === undefined) return next()

    const normalised = origin.replace(/\/$/, '')
    const isSelf = normalised === selfOrigin(c.req.url, c.req.header('x-forwarded-proto'))

    if (!allowed.has(normalised) && !isSelf) {
      return c.json(
        { error: { code: 'forbidden_origin', message: `origin ${origin} is not allowed to call this panel` } },
        403,
      )
    }

    // No `Allow-Credentials`: the panel authenticates with a header, not a
    // cookie, so allowing credentials would widen this for nothing.
    c.header('Access-Control-Allow-Origin', origin)

    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', ALLOWED_METHODS)
      c.header('Access-Control-Allow-Headers', ALLOWED_HEADERS)
      c.header('Access-Control-Max-Age', '600')
      return c.body(null, 204)
    }

    return next()
  }
}
