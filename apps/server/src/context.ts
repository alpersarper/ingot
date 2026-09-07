/**
 * What every route can reach: the store, the screenshot volume, and the
 * resolved config. Assembled once in `app.ts` and handed in, so nothing in a
 * route reaches for a module-level singleton and nothing in a test has to
 * monkey-patch one.
 */
import type { ServerConfig } from './config'
import type { ScreenshotStore } from './screenshots'
import type { Store } from './storage/store'

export interface AppContext {
  config: ServerConfig
  store: Store
  screenshots: ScreenshotStore
  /** The token every API call must present. Never sent to a client. */
  pairingToken: string
}

/** Hono environment: no request-scoped variables, just the shared context. */
export type AppEnv = { Bindings: Record<string, never>; Variables: Record<string, never> }
