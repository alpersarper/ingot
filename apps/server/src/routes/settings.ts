/**
 * Settings, including the LLM API key.
 *
 * The rule this file exists to enforce: **the key goes in and never comes out.**
 * `GET` reports whether one is configured and where it came from; there is no
 * endpoint, and no code path, that returns the value. The key lives server-side
 * because the browser is the one place it must not be -- an extension, a
 * bookmarklet or a stray script in the panel's own origin can read anything the
 * page holds.
 *
 * No LLM call is made anywhere in this build. This is storage and a presence
 * report, so that the feature that needs a key finds one already there.
 */
import { Hono } from 'hono'
import { ENGINE_NAME, ENGINE_VERSION } from '@ingot/engine'
import { SCHEMA_VERSION } from '../storage/sqlite/schema'
import { ApiError } from '../errors'
import type { AppContext, AppEnv } from '../context'
import { isRecord, readJsonBody } from '../validate'

export const LLM_API_KEY_SETTING = 'llm.apiKey'

/** Where a configured key came from. Never the key itself. */
export type LlmKeySource = 'environment' | 'settings' | 'none'

export function settingsRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store, config } = context

  async function keySource(): Promise<LlmKeySource> {
    // The environment wins, so an operator who pins a key in compose cannot be
    // silently overridden by whatever is in the database.
    if (config.llmApiKey !== undefined) return 'environment'
    return (await store.settings.get(LLM_API_KEY_SETTING)) === null ? 'none' : 'settings'
  }

  app.get('/', async (c) => {
    const source = await keySource()
    return c.json({
      settings: {
        llm: {
          configured: source !== 'none',
          source,
          /** True when the key is pinned in the environment and cannot be edited here. */
          managedByEnvironment: source === 'environment',
        },
        engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
        storage: { adapter: 'sqlite', schemaVersion: SCHEMA_VERSION },
        allowedOrigins: config.allowedOrigins,
      },
    })
  })

  app.put('/', async (c) => {
    const body = await readJsonBody(c.req.raw)
    if (!('llmApiKey' in body)) throw ApiError.badRequest('nothing to update; send llmApiKey')
    if (config.llmApiKey !== undefined) {
      throw ApiError.conflict('the LLM API key is pinned by INGOT_LLM_API_KEY and cannot be changed from the panel')
    }

    const value = isRecord(body) ? body['llmApiKey'] : undefined
    if (value === null) {
      await store.settings.delete(LLM_API_KEY_SETTING)
    } else if (typeof value === 'string' && value.trim() !== '') {
      await store.settings.set(LLM_API_KEY_SETTING, value.trim())
    } else {
      throw ApiError.badRequest('llmApiKey must be a non-empty string, or null to clear it')
    }

    const source = await keySource()
    return c.json({ settings: { llm: { configured: source !== 'none', source, managedByEnvironment: false } } })
  })

  return app
}
