/**
 * Any server that speaks `/chat/completions`, as an {@link LlmClient}.
 *
 * One implementation covers Ollama on the user's own machine, OpenRouter, Groq,
 * Gemini's compatibility endpoint and whatever the next one is, because they
 * all agreed on the same request body years ago. That is the whole reason this
 * connection type exists rather than a file per vendor: the differences between
 * them are a base URL, a model name and whether a key is needed, and all three
 * are configuration.
 *
 * It is written against `fetch` rather than an SDK on purpose. The seam already
 * owns parsing, validation and redaction, so an SDK here would contribute a
 * dependency, a second retry policy and a second error taxonomy in exchange for
 * about thirty lines. The same reasoning is why the Vercel AI SDK stayed
 * unadopted -- see `docs/assistant.md`.
 *
 * Two things are genuinely provider-shaped and both live here.
 *
 * **Structured output is asked for twice.** `response_format` with a JSON
 * Schema is the modern spelling and the strong one, but an endpoint that
 * predates it -- or a small local model behind one -- will ignore the field
 * without saying so. So the schema is *also* stated in the system prompt. The
 * belt is the field; the braces are the sentence; and the seam's own reader is
 * what actually decides whether an answer is usable, so a provider that honours
 * neither fails as `unusable` rather than as a wrong token value.
 *
 * **The base URL is the user's, and it is treated as such.** It is validated
 * for scheme and length and otherwise sent where it points, including at
 * `localhost` -- which is the point, since a local Ollama is the whole no-key
 * story. This server is a single-user local tool, so an operator naming their
 * own endpoint is not a boundary being crossed; it is the feature.
 */
import { LlmError, structuredClient } from './llm'
import type { LlmClient, LlmClientConfig } from './llm'

/** One request's ceiling. Generous, because a local 7B on a laptop is not fast. */
const DEFAULT_TIMEOUT_MS = 120_000

/** The longest endpoint this will accept. A URL, not a payload. */
export const BASE_URL_MAX = 2048

/**
 * The name the JSON Schema is given in the request.
 *
 * Required by the OpenAI shape and read by nobody; constant so two calls with
 * the same schema are byte-identical, which is what makes a provider's prompt
 * cache work.
 */
const SCHEMA_NAME = 'ingot_response'

/**
 * Where `/chat/completions` actually is, given what the user typed.
 *
 * Three spellings are all common and all meant the same thing, so all three
 * work: the OpenAI-style base (`.../v1`), a bare origin (`http://localhost:11434`,
 * which is what a person copies out of the Ollama readme), and the full
 * endpoint pasted from someone's documentation.
 */
export function completionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new LlmError('invalid-request', `the endpoint ${JSON.stringify(baseUrl)} is not a URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new LlmError('invalid-request', 'the endpoint must be an http:// or https:// URL')
  }

  // A bare origin is the Ollama readme's spelling. Everything else is already
  // a versioned base and gets the endpoint appended as-is.
  const path = parsed.pathname.replace(/\/+$/, '')
  return path === '' ? `${trimmed}/v1/chat/completions` : `${trimmed}/chat/completions`
}

/** `true` when this looks like a URL worth sending a request to. Not a verdict. */
export function isUsableBaseUrl(value: string): boolean {
  if (value.trim() === '' || value.length > BASE_URL_MAX) return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export interface OpenAiCompatibleOptions {
  /** Injected so the tests exercise the real parsing against scripted bodies. */
  fetchImpl?: typeof fetch
}

export function createOpenAiCompatibleClient(
  config: LlmClientConfig,
  options: OpenAiCompatibleOptions = {},
): LlmClient {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const baseUrl = config.baseUrl ?? ''

  return structuredClient({
    model: config.model,
    secrets: () => config.secrets?.() ?? [config.apiKey],
    classify: toLlmError,

    async transport(request) {
      if (baseUrl === '') {
        throw new LlmError(
          'auth',
          'no endpoint is configured for the OpenAI-compatible connection. Set one in the panel — for Ollama on this machine that is http://localhost:11434/v1.',
        )
      }
      const url = completionsUrl(baseUrl)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response: Response
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Omitted entirely rather than sent empty: a local Ollama needs no
            // key, and an `Authorization: Bearer ` header is a 401 waiting to
            // happen on an endpoint that validates the shape.
            ...(config.apiKey === undefined || config.apiKey === '' ? {} : { authorization: `Bearer ${config.apiKey}` }),
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: request.maxTokens,
            // Both spellings. The newer one is required by some endpoints and
            // ignored by the rest; sending one alone fails somewhere.
            max_completion_tokens: request.maxTokens,
            // Zero, because none of these capabilities wants variety: the same
            // kit should get the same reading twice.
            temperature: 0,
            stream: false,
            messages: [
              { role: 'system', content: `${request.system}\n\n${schemaInstruction(request.schema)}` },
              ...request.messages.map((message) => ({ role: message.role, content: message.content })),
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: SCHEMA_NAME, strict: true, schema: request.schema },
            },
          }),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new LlmError('unavailable', `the endpoint at ${url} did not answer within ${Math.round(timeoutMs / 1000)}s`)
        }
        // A connection refused is the single most common failure here -- Ollama
        // not running, or a container reaching for the host's localhost -- so
        // it names the address rather than reporting a bare socket error.
        throw new LlmError('unavailable', `could not reach the endpoint at ${url}`)
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) throw await httpError(response, url)

      let payload: unknown
      try {
        payload = (await response.json()) as unknown
      } catch {
        throw new LlmError('unusable', `the endpoint at ${url} did not return JSON`)
      }

      return readCompletion(payload, config.model, url)
    },
  })
}

/**
 * The schema, restated as an instruction.
 *
 * Belt and braces for an endpoint that ignores `response_format`. Deliberately
 * terse and deliberately last in the system prompt, so it cannot displace the
 * grounding rules a template spent paragraphs establishing.
 */
function schemaInstruction(schema: Record<string, unknown>): string {
  return `Reply with a single JSON object and nothing else — no prose before it, no code fence around it. It must validate against this JSON Schema:\n${JSON.stringify(schema)}`
}

interface Completion {
  text: string
  usage: { inputTokens: number; outputTokens: number }
  model: string
  refused: boolean
}

function readCompletion(payload: unknown, fallbackModel: string, url: string): Completion {
  if (typeof payload !== 'object' || payload === null) {
    throw new LlmError('unusable', `the endpoint at ${url} returned something that was not a completion`)
  }
  const record = payload as Record<string, unknown>

  // Some gateways report an application-level error with a 200. It is still an
  // error, and reading past it would turn it into "unparseable answer".
  const error = record['error']
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    throw new LlmError('unavailable', `the endpoint at ${url} returned an error: ${typeof message === 'string' ? message : 'no detail'}`)
  }

  const choices = record['choices']
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined
  if (first === undefined) {
    throw new LlmError('unusable', `the endpoint at ${url} returned no choices`)
  }

  const message = first['message']
  const content = typeof message === 'object' && message !== null ? (message as Record<string, unknown>)['content'] : undefined
  const usage = record['usage']
  const usageRecord = typeof usage === 'object' && usage !== null ? (usage as Record<string, unknown>) : {}

  return {
    text: contentText(content),
    usage: {
      inputTokens: number(usageRecord['prompt_tokens']),
      outputTokens: number(usageRecord['completion_tokens']),
    },
    model: typeof record['model'] === 'string' && record['model'] !== '' ? record['model'] : fallbackModel,
    refused: first['finish_reason'] === 'content_filter',
  }
}

/**
 * The answer text, whichever of the two shapes it came in.
 *
 * Most endpoints put a string on `message.content`; a few put the list of
 * content parts the multimodal APIs use. Both are read, because an assistant
 * that works against one gateway and mysteriously does not against another is
 * the failure this connection type exists to avoid.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .join('')
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * An HTTP failure, classified by status and described from the body.
 *
 * The body is read because these endpoints put the useful part there -- "model
 * not found: llama3.2", "insufficient credits" -- and truncated because some of
 * them return an HTML error page. Everything in it goes through the seam's
 * redaction before it reaches a log or a response, as everything does.
 */
async function httpError(response: Response, url: string): Promise<LlmError> {
  let detail = ''
  try {
    detail = (await response.text()).trim().slice(0, 500)
  } catch {
    detail = ''
  }
  const suffix = detail === '' ? '' : `: ${detail}`
  const status = response.status

  if (status === 401 || status === 403) {
    return new LlmError('auth', `the endpoint at ${url} rejected this key${suffix}`, status)
  }
  if (status === 402) {
    return new LlmError('auth', `the account behind ${url} has no credit${suffix}`, status)
  }
  if (status === 404) {
    return new LlmError(
      'invalid-request',
      `the endpoint at ${url} has no such route or model${suffix}. Check the URL ends where /chat/completions begins, and that the model name is one this endpoint serves.`,
      status,
    )
  }
  if (status === 429) {
    return new LlmError('rate-limit', `the endpoint at ${url} is rate-limiting this key${suffix}`, status)
  }
  if (status >= 400 && status < 500) {
    return new LlmError('invalid-request', `the endpoint at ${url} refused the request${suffix}`, status)
  }
  return new LlmError('unavailable', `the endpoint at ${url} failed with ${String(status)}${suffix}`, status)
}

function toLlmError(error: unknown, describe: (error: unknown) => string): LlmError | undefined {
  if (error instanceof LlmError) return error
  return new LlmError('unavailable', `the OpenAI-compatible endpoint failed: ${describe(error)}`)
}
