/**
 * Liveness. Open, because a health check that needs a secret is not a health
 * check. Reports only what a client needs to know it is talking to a compatible
 * server.
 */
import { Hono } from 'hono'
import { ENGINE_NAME, ENGINE_VERSION } from '@ingot/engine'
import { SCHEMA_VERSION } from '../storage/sqlite/schema'
import type { AppEnv } from '../context'

export function healthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/', (c) =>
    c.json({ status: 'ok', engine: { name: ENGINE_NAME, version: ENGINE_VERSION }, schemaVersion: SCHEMA_VERSION }),
  )
  return app
}
