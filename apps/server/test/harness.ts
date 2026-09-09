/**
 * An app in memory: no port, no file, no clock.
 *
 * The API tests call `app.fetch(request)` directly, which is the whole reason
 * `createApp` takes its world as an argument. Screenshots still need a real
 * directory, because the volume is a real thing and pretending otherwise would
 * test a filesystem that does not exist.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app'
import { createAssistant } from '../src/assistant/service'
import { createRateLimiter } from '../src/assistant/rate-limit'
import { LlmError, structuredClient } from '../src/assistant/llm'
import { loadConfig } from '../src/config'
import { createScreenshotStore } from '../src/screenshots'
import { countingIdFactory, steppingClock } from '../src/storage/ids'
import { createSqliteStore } from '../src/storage/sqlite'
import type { AppContext } from '../src/context'
import type { LlmClient, LlmClientConfig } from '../src/assistant/llm'
import type { Store } from '../src/storage/store'

export const TEST_TOKEN = 'test-pairing-token'

/**
 * A stand-in for the provider.
 *
 * The assistant takes an {@link LlmClientFactory} rather than reaching for the
 * SDK, and this is the whole payoff: every capability, every guardrail check
 * and every security property below can be exercised with no network, no key
 * and no cost. What the tests script here is only ever the *model's* answer --
 * the engine checks, the redaction and the write path are the real ones.
 */
export interface FakeLlm {
  /** Answer the next call with this value, before parsing. */
  reply(value: unknown): void
  /** Fail the next call with this error, as the provider would raise it. */
  fail(error: unknown): void
  /** Every request the assistant made, in order. What actually left the box. */
  readonly calls: Array<{ system: string; messages: Array<{ role: string; content: string }> }>
  /** The config each client was built with, key included. Never asserted as safe. */
  readonly configs: LlmClientConfig[]
}

export interface Harness {
  /** Lines the assistant logged. Redacted, because the logger redacts. */
  readonly logs: string[]
  llm: FakeLlm
  /** Move the rate limiter's clock forward, so a burst test needs no timers. */
  advance(ms: number): void
  app: ReturnType<typeof createApp>
  context: AppContext
  store: Store
  /** Fetch an API path with the pairing token already attached. */
  call(path: string, init?: RequestInit): Promise<Response>
  /** Fetch without the token, for the tests that must be rejected. */
  raw(path: string, init?: RequestInit): Promise<Response>
  json<T = unknown>(path: string, init?: RequestInit): Promise<T>
  close(): Promise<void>
}

const ORIGIN = 'http://localhost:4310'

export async function createHarness(env: NodeJS.ProcessEnv = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ingot-api-'))
  const config = loadConfig({ INGOT_DATA_DIR: dataDir, ...env })
  const store = createSqliteStore({ file: ':memory:', idFactory: countingIdFactory(), clock: steppingClock() })

  // The scripted provider. Queues rather than single slots, so a test can set
  // up two answers and assert on the order they were consumed in.
  const replies: unknown[] = []
  const failures: unknown[] = []
  const calls: FakeLlm['calls'] = []
  const configs: LlmClientConfig[] = []
  const llm: FakeLlm = {
    reply: (value) => void replies.push(value),
    fail: (error) => void failures.push(error),
    calls,
    configs,
  }

  // Only the *transport* is faked. Everything a client owes its callers --
  // parsing, refusing an unusable answer, and turning a provider error into a
  // redacted `LlmError` -- comes from `structuredClient`, the same shared code
  // the Anthropic client uses. A fake that reimplemented those would let the
  // security tests below pass against a fake that leaks.
  const llmFactory = (clientConfig: LlmClientConfig): LlmClient => {
    configs.push(clientConfig)
    return structuredClient({
      model: clientConfig.model,
      secrets: () => [clientConfig.apiKey],
      async transport(request) {
        calls.push({ system: request.system, messages: request.messages.map((m) => ({ ...m })) })
        const failure = failures.shift()
        // Thrown raw, exactly as a provider SDK would: it is the seam's job,
        // not the fake's, to make sure nothing of it escapes.
        if (failure !== undefined) throw failure
        const next = replies.shift()
        if (next === undefined) throw new LlmError('unusable', 'the fake provider had no scripted reply')
        return {
          text: JSON.stringify(next),
          usage: { inputTokens: 0, outputTokens: 0 },
          model: clientConfig.model,
          refused: false,
        }
      },
    })
  }

  // The assistant's own logger writes here. Only the sink is redirected: the
  // redaction itself is the real one, because that is the thing under test.
  const logs: string[] = []

  let clockMs = 1_700_000_000_000
  const assistantLimiter = createRateLimiter({
    max: config.assistantRateLimit,
    windowMs: config.assistantRateWindowMs,
    now: () => clockMs,
  })

  const context: AppContext = {
    config,
    store,
    screenshots: createScreenshotStore(config.screenshotDir),
    pairingToken: TEST_TOKEN,
    assistant: createAssistant({
      store,
      config,
      pairingToken: TEST_TOKEN,
      llmFactory,
      logSink: (line) => void logs.push(line),
    }),
    assistantLimiter,
  }
  const app = createApp(context)

  const raw = async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.fetch(new Request(`${ORIGIN}${path}`, init))

  const call = (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('x-ingot-token', TEST_TOKEN)
    if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
    return raw(path, { ...init, headers })
  }

  return {
    app,
    context,
    store,
    logs,
    llm,
    advance: (ms: number) => {
      clockMs += ms
    },
    call,
    raw,
    async json<T>(path: string, init?: RequestInit): Promise<T> {
      return (await call(path, init)).json() as Promise<T>
    },
    async close() {
      await store.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

/** A JSON POST body, so the tests read as what they are testing. */
export function body(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) }
}

/** The same, for the routes that replace rather than create. */
export function put(value: unknown): RequestInit {
  return { method: 'PUT', body: JSON.stringify(value) }
}
