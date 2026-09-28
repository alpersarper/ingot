/**
 * Settings, including the LLM keys and the model the assistant asks.
 *
 * The rule this file exists to enforce: **a key goes in and never comes out.**
 * That covers both of them -- the Anthropic key and the OpenAI-compatible
 * endpoint's bearer token, each stored under its own setting so a connection
 * switch can never carry one to an endpoint it was not saved for. `GET`
 * reports whether one is configured and where it came from; `PUT` stores,
 * replaces or clears it, and `DELETE /llm-key` also clears the Anthropic one.
 * There is no endpoint, and no code
 * path, that returns either value -- not to the panel, not in an error, not in
 * a log. The keys live server-side because the browser is the one place they
 * must not be: an extension, a bookmarklet or a stray script in the panel's
 * own origin can read anything the page holds.
 *
 * The model, the connection and the endpoint are the opposite kind of setting
 * and are treated as one. None is a secret, the panel shows all three, and a
 * reviewer changes them here. The endpoint in particular is *deliberately*
 * readable: a typo in a URL has to be visible to be fixed, and hiding it behind
 * the key's write-only rule would make it undiagnosable. All four follow the
 * same precedence rule: a value pinned in the environment wins and cannot be
 * edited from the panel, so a deployment that fixes one stays fixed.
 *
 * Which connections exist, and whether each is usable, is not this file's
 * question either -- `assistant.status()` answers it, and `llmBlock` below
 * passes that answer through unchanged. See `src/assistant/connections.ts`.
 *
 * The assistant that spends the key is in `src/assistant/`; this file stores
 * and reports, and knows nothing about how a call is made.
 */
import { Hono } from 'hono'
import { ENGINE_NAME, ENGINE_VERSION } from '@ingot/engine'
import { SCHEMA_VERSION } from '../storage/sqlite/schema'
import { ApiError } from '../errors'
import {
  LLM_API_KEY_SETTING,
  LLM_BASE_URL_SETTING,
  LLM_CONNECTION_SETTING,
  LLM_ENDPOINT_KEY_SETTING,
  LLM_MODEL_SETTING,
} from '../assistant/settings-keys'
import { CONNECTION_IDS, isConnectionId } from '../assistant/connections'
import { BASE_URL_MAX, endpointOrigin, isUsableBaseUrl, storedBaseUrl } from '../assistant/openai-compatible'
import type { AppContext, AppEnv } from '../context'
import { isRecord, optionalString, readJsonBody } from '../validate'

export {
  LLM_API_KEY_SETTING,
  LLM_BASE_URL_SETTING,
  LLM_CONNECTION_SETTING,
  LLM_ENDPOINT_KEY_SETTING,
  LLM_MODEL_SETTING,
}

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

  /**
   * The assistant's own account of itself, minus the prompt version.
   *
   * One reporter rather than two means the panel's setup state and the
   * assistant's own behaviour cannot disagree about whether it can run. Every
   * field here is presence or provenance; none of them is the key.
   */
  async function llmBlock(): Promise<Record<string, unknown>> {
    const llm = await assistant.status()
    return {
      configured: llm.configured,
      connection: llm.connection,
      connectionManagedByEnvironment: llm.connectionManagedByEnvironment,
      source: llm.source,
      /** True when the key is pinned in the environment and cannot be edited here. */
      managedByEnvironment: llm.managedByEnvironment,
      model: llm.model,
      modelManagedByEnvironment: llm.modelManagedByEnvironment,
      baseUrl: llm.baseUrl,
      baseUrlManagedByEnvironment: llm.baseUrlManagedByEnvironment,
      /** Presence only, like the Anthropic key: the token itself never comes out. */
      endpointKeyConfigured: llm.endpointKeyConfigured,
      endpointKeyManagedByEnvironment: llm.endpointKeyManagedByEnvironment,
      containerized: llm.containerized,
      connections: llm.connections,
    }
  }

  app.get('/', async (c) => {
    return c.json({
      settings: {
        llm: await llmBlock(),
        engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
        storage: { adapter: 'sqlite', schemaVersion: SCHEMA_VERSION },
        allowedOrigins: config.allowedOrigins,
      },
    })
  })

  app.put('/', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const touchesKey = 'llmApiKey' in body
    const touchesEndpointKey = 'llmEndpointKey' in body
    const touchesModel = 'llmModel' in body
    const touchesConnection = 'llmConnection' in body
    const touchesBaseUrl = 'llmBaseUrl' in body
    let endpointKeyCleared = false
    if (!touchesKey && !touchesEndpointKey && !touchesModel && !touchesConnection && !touchesBaseUrl) {
      throw ApiError.badRequest(
        'nothing to update; send llmApiKey, llmEndpointKey, llmConnection, llmBaseUrl or llmModel',
      )
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

    if (touchesEndpointKey) {
      if (config.llmEndpointKey !== undefined) {
        throw ApiError.conflict(
          'the endpoint key is pinned by INGOT_LLM_ENDPOINT_KEY and cannot be changed from the panel',
        )
      }
      const value = isRecord(body) ? body['llmEndpointKey'] : undefined
      if (value === null) {
        await store.settings.delete(LLM_ENDPOINT_KEY_SETTING)
      } else if (typeof value === 'string' && value.trim() !== '') {
        await store.settings.set(LLM_ENDPOINT_KEY_SETTING, value.trim())
      } else {
        throw ApiError.badRequest('llmEndpointKey must be a non-empty string, or null to clear it')
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

    if (touchesConnection) {
      if (config.llmConnection !== undefined) {
        throw ApiError.conflict(
          'the assistant connection is pinned by INGOT_LLM_CONNECTION and cannot be changed from the panel',
        )
      }
      const value = body['llmConnection']
      if (value === null) {
        // Cleared rather than set to a default: with nothing chosen the server
        // takes whichever connection is ready, which is the behaviour a first
        // run gets and the one a reviewer should be able to get back to.
        await store.settings.delete(LLM_CONNECTION_SETTING)
      } else if (isConnectionId(value)) {
        await store.settings.set(LLM_CONNECTION_SETTING, value)
      } else {
        throw ApiError.badRequest(
          `llmConnection must be one of ${CONNECTION_IDS.join(', ')}, or null to let the server pick whichever is ready`,
        )
      }
    }

    if (touchesBaseUrl) {
      if (config.llmBaseUrl !== undefined) {
        throw ApiError.conflict(
          'the assistant endpoint is pinned by INGOT_LLM_BASE_URL and cannot be changed from the panel',
        )
      }
      const value = body['llmBaseUrl']
      const previous = await store.settings.get(LLM_BASE_URL_SETTING)
      let next: string | null = null
      if (value === null) {
        await store.settings.delete(LLM_BASE_URL_SETTING)
      } else {
        const url = optionalString(body, 'llmBaseUrl')
        if (url === undefined || !isUsableBaseUrl(url)) {
          throw ApiError.badRequest(
            `llmBaseUrl must be an http:// or https:// URL of at most ${BASE_URL_MAX} characters, or null to clear it`,
          )
        }
        next = storedBaseUrl(url)
        await store.settings.set(LLM_BASE_URL_SETTING, next)
      }

      // A credential never reaches an address it was not saved for, and the
      // address is the ORIGIN: scheme + host + port, compared together. Not the
      // host alone -- that would keep the key across an https -> http downgrade
      // and send it in cleartext. The endpoint key was saved for the origin the
      // stored endpoint named, so a move to a different origin -- or away from
      // any, or to one that does not parse -- drops it, and the response says
      // so. A path or trailing-slash edit on the same origin keeps it, and so
      // does a request that saves a key for the new endpoint in the same write.
      const previousOrigin = previous === null ? undefined : endpointOrigin(previous)
      const nextOrigin = next === null ? null : endpointOrigin(next)
      if (
        previousOrigin !== undefined &&
        !touchesEndpointKey &&
        config.llmEndpointKey === undefined &&
        (previousOrigin === null || nextOrigin === null || previousOrigin !== nextOrigin)
      ) {
        endpointKeyCleared = await store.settings.delete(LLM_ENDPOINT_KEY_SETTING)
      }
    }

    return c.json({ settings: { llm: await llmBlock() }, endpointKeyCleared })
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
