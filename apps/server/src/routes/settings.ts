/**
 * Settings, including the LLM API key and the model the assistant asks.
 *
 * The rule this file exists to enforce: **the key goes in and never comes out.**
 * `GET` reports whether one is configured and where it came from; `PUT` stores
 * or replaces it and `DELETE` removes it. There is no endpoint, and no code
 * path, that returns the value -- not to the panel, not in an error, not in a
 * log. The key lives server-side because the browser is the one place it must
 * not be: an extension, a bookmarklet or a stray script in the panel's own
 * origin can read anything the page holds.
 *
 * The model is the opposite kind of setting and is treated as one. It is not a
 * secret, the panel shows it, and a reviewer changes it here. Both follow the
 * same precedence rule: a value pinned in the environment wins and cannot be
 * edited from the panel, so a deployment that fixes either one stays fixed.
 *
 * The assistant that spends the key is in `src/assistant/`; this file stores
 * and reports, and knows nothing about how a call is made.
 */
import { Hono } from 'hono'
import { ENGINE_NAME, ENGINE_VERSION } from '@ingot/engine'
import { SCHEMA_VERSION } from '../storage/sqlite/schema'
import { ApiError } from '../errors'
import { LLM_API_KEY_SETTING, LLM_MODEL_SETTING } from '../assistant/settings-keys'
import type { AppContext, AppEnv } from '../context'
import { isRecord, optionalString, readJsonBody } from '../validate'

export { LLM_API_KEY_SETTING, LLM_MODEL_SETTING }

/** Where a configured key came from. Never the key itself. */
export type LlmKeySource = 'environment' | 'settings' | 'none'

/**
 * The longest model identifier this will store.
 *
 * A model id is a short slug. The bound is here because this string is sent to
 * the provider on every assistant call, and an unbounded one is somewhere to
 * put something that is not a model id.
 */
const MODEL_MAX = 100

export function settingsRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store, config, assistant } = context

  app.get('/', async (c) => {
    // The assistant answers for itself: presence, source, and which model it
    // would ask. One reporter rather than two means the panel's setup state and
    // the assistant's own behaviour cannot disagree about whether a key exists.
    const llm = await assistant.status()
    return c.json({
      settings: {
        llm: {
          configured: llm.configured,
          source: llm.source,
          /** True when the key is pinned in the environment and cannot be edited here. */
          managedByEnvironment: llm.managedByEnvironment,
          model: llm.model,
          modelManagedByEnvironment: llm.modelManagedByEnvironment,
        },
        engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
        storage: { adapter: 'sqlite', schemaVersion: SCHEMA_VERSION },
        allowedOrigins: config.allowedOrigins,
      },
    })
  })

  app.put('/', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const touchesKey = 'llmApiKey' in body
    const touchesModel = 'llmModel' in body
    if (!touchesKey && !touchesModel) {
      throw ApiError.badRequest('nothing to update; send llmApiKey or llmModel')
    }

    if (touchesKey) {
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
    }

    if (touchesModel) {
      if (config.llmModel !== undefined) {
        throw ApiError.conflict('the assistant model is pinned by INGOT_LLM_MODEL and cannot be changed from the panel')
      }
      const value = body['llmModel']
      if (value === null) {
        await store.settings.delete(LLM_MODEL_SETTING)
      } else {
        const model = optionalString(body, 'llmModel')
        if (model === undefined || model.trim() === '') {
          throw ApiError.badRequest('llmModel must be a non-empty string, or null to take the default')
        }
        if (model.length > MODEL_MAX) {
          throw ApiError.badRequest(`llmModel must be at most ${MODEL_MAX} characters`)
        }
        await store.settings.set(LLM_MODEL_SETTING, model.trim())
      }
    }

    const llm = await assistant.status()
    return c.json({
      settings: {
        llm: {
          configured: llm.configured,
          source: llm.source,
          managedByEnvironment: llm.managedByEnvironment,
          model: llm.model,
          modelManagedByEnvironment: llm.modelManagedByEnvironment,
        },
      },
    })
  })

  /**
   * Remove the stored key.
   *
   * `PUT { llmApiKey: null }` does the same thing and is what the panel sends;
   * this exists because "set, replace, delete, never read" is the contract, and
   * a delete that is only reachable as a special case of a write is a contract
   * somebody has to be told about rather than one they can see.
   */
  app.delete('/llm-key', async (c) => {
    if (config.llmApiKey !== undefined) {
      throw ApiError.conflict('the LLM API key is pinned by INGOT_LLM_API_KEY and cannot be cleared from the panel')
    }
    const removed = await store.settings.delete(LLM_API_KEY_SETTING)
    const llm = await assistant.status()
    return c.json({ removed, settings: { llm: { configured: llm.configured, source: llm.source } } })
  })

  return app
}
