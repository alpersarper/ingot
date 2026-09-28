/**
 * The Hono app: middleware order, routes, and the static panel.
 *
 * Order is load-bearing and is the security story of this server, so it is
 * written out once here rather than spread across the route files:
 *
 *   0. The request log, outermost, so that a request refused by either guard
 *      below is still a line somebody can read. A log that only sees what got
 *      past the guards cannot answer the one question worth asking when
 *      nothing is arriving, which is whether anything arrived at all.
 *   1. CORS, which refuses a cross-origin request that is not from the panel.
 *   2. The pairing check, which refuses any API request without the token.
 *   3. The API.
 *   4. The built panel, served last so a route can never be shadowed by a file.
 */
import { Hono } from 'hono'
import { ApiError, errorBody } from './errors'
import { assistantRoutes } from './routes/assistant'
import { cors } from './cors'
import { requestLog } from './logging'
import { captureRoutes } from './routes/captures'
import { exportRoutes, kitRoutes } from './routes/kits'
import { groupRoutes } from './routes/groups'
import { healthRoutes } from './routes/health'
import { pairingRoutes, requirePairing } from './routes/pairing'
import { resetRoutes } from './routes/reset'
import { reviewRoutes } from './routes/reviews'
import { settingsRoutes } from './routes/settings'
import { panelRoutes } from './static'
import type { AppContext, AppEnv } from './context'

export function createApp(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  if (context.config.requestLog) {
    const sink = context.requestLogSink ?? ((line: string) => console.log(line))
    // The secrets are the ones this process holds without an await. The log
    // never reads a header, a body or a query value, so nothing here should
    // ever match; this is the guard for the day that stops being true.
    app.use(
      '*',
      requestLog({
        secrets: () => [context.pairingToken, context.config.pairingToken, context.config.llmApiKey, context.config.llmEndpointKey],
        write: sink,
      }),
    )
  }

  app.use('/api/*', cors(context.config.allowedOrigins))
  app.use('/api/*', requirePairing(context))

  app.route('/api/health', healthRoutes())
  app.route('/api/pairing', pairingRoutes(context))
  app.route('/api/settings', settingsRoutes(context))
  app.route('/api/captures', captureRoutes(context))
  app.route('/api/groups', groupRoutes(context))
  app.route('/api/kits', kitRoutes(context))
  app.route('/api/reviews', reviewRoutes(context))
  app.route('/api/reset', resetRoutes(context))
  app.route('/api/assistant', assistantRoutes(context))
  app.route('/api/export', exportRoutes(context))

  app.notFound((c) =>
    c.json(errorBody(ApiError.notFound(`no route for ${c.req.method} ${new URL(c.req.url).pathname}`)), 404),
  )

  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json(errorBody(error), error.status)
    // Anything else is a bug. Log it whole; return nothing of it, because an
    // internal message can carry a path or a secret.
    console.error('[ingot] unhandled error', error)
    return c.json(errorBody(new ApiError(500, 'internal', 'the panel server hit an unexpected error')), 500)
  })

  if (context.config.panelDir !== undefined) app.route('/', panelRoutes(context.config.panelDir))

  return app
}
