/**
 * What every route can reach: the store, the screenshot volume, and the
 * resolved config. Assembled once in `app.ts` and handed in, so nothing in a
 * route reaches for a module-level singleton and nothing in a test has to
 * monkey-patch one.
 */
import type { AssistantService } from './assistant/service'
import type { RateLimiter } from './assistant/rate-limit'
import type { ServerConfig } from './config'
import type { ScreenshotStore } from './screenshots'
import type { Store } from './storage/store'

export interface AppContext {
  config: ServerConfig
  store: Store
  screenshots: ScreenshotStore
  /** The token every API call must present. Never sent to a client. */
  pairingToken: string
  /**
   * The advisory layer. Present whether or not a key is configured -- absence
   * of a key is an answer it gives, not a reason for it not to exist, because
   * the panel has to be able to render its setup state before anything is spent.
   */
  assistant: AssistantService
  /**
   * The budget for assistant calls, shared by every caller of this server.
   *
   * On the context rather than built inside the route so that its clock is
   * injectable: a test bursts against it without waiting a minute, and a
   * deployment that wants a different window gets one from configuration.
   */
  assistantLimiter: RateLimiter
}

/** Hono environment: no request-scoped variables, just the shared context. */
export type AppEnv = { Bindings: Record<string, never>; Variables: Record<string, never> }
