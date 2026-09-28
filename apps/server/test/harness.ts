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
import type { CliProbe } from '../src/assistant/claude-cli'
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

/**
 * Everything a test may vary about the world outside this process.
 *
 * The CLI probe is here rather than left to the real one on purpose: whether
 * the developer running the suite happens to have Claude Code installed must
 * not change which connection the assistant resolves, or the same test would
 * mean two different things on two machines. The default is "no CLI, not a
 * container", which is the configuration every pre-existing test was written
 * against.
 */
export interface HarnessOptions {
  env?: NodeJS.ProcessEnv
  cli?: CliProbe
  containerized?: boolean
}

export interface Harness {
  /** Lines the assistant logged. Redacted, because the logger redacts. */
  readonly logs: string[]
  /** Lines the request log wrote. One per request, guards included. */
  readonly requestLogs: string[]
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

const NO_CLI: CliProbe = {
  available: false,
  version: undefined,
  signedIn: undefined,
  auth: undefined,
  detail: '`claude` is not on this server’s PATH',
}

export async function createHarness(
  envOrOptions: NodeJS.ProcessEnv | HarnessOptions = {},
): Promise<Harness> {
  const options: HarnessOptions = isOptions(envOrOptions) ? envOrOptions : { env: envOrOptions }
  const dataDir = await mkdtemp(join(tmpdir(), 'ingot-api-'))
  const config = loadConfig({ INGOT_DATA_DIR: dataDir, ...(options.env ?? {}) })
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
      // Exactly what every real implementation does: the service's whole list
      // of secrets, falling back to this client's own key. A fake that used
      // only `apiKey` would let the redaction test pass on a connection that
      // has no key of its own -- which is the connection where a leaked
      // pairing token or an unrelated stored key would actually escape.
      secrets: () => clientConfig.secrets?.() ?? [clientConfig.apiKey],
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
  // And the request log here, for the same reason -- plus one more: a suite
  // that printed a line per request would bury its own failures.
  const requestLogs: string[] = []

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
      cliProbe: async () => options.cli ?? NO_CLI,
      runtime: { containerized: options.containerized === true, detail: 'test harness' },
      logSink: (line) => void logs.push(line),
    }),
    assistantLimiter,
    requestLogSink: (line) => void requestLogs.push(line),
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
    requestLogs,
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

/**
 * Options or a bare environment?
 *
 * The suite predates the options object and passes environments positionally in
 * a dozen places. Rather than rewrite those, the two shapes are told apart by
 * the keys only the options object has.
 */
function isOptions(value: NodeJS.ProcessEnv | HarnessOptions): value is HarnessOptions {
  return 'env' in value || 'cli' in value || 'containerized' in value
}

/** A JSON POST body, so the tests read as what they are testing. */
export function body(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) }
}

/** The same, for the routes that replace rather than create. */
export function put(value: unknown): RequestInit {
  return { method: 'PUT', body: JSON.stringify(value) }
}
