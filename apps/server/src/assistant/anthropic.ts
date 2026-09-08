/**
 * The one implementation of {@link LlmClient}, on the official Anthropic SDK.
 *
 * This is the only file in the repository that imports an LLM SDK, and it is
 * deliberately the only one that could: everything above it takes
 * {@link LlmClient}, so a hosted proxy or a second provider is a sibling of
 * this file rather than a change to any capability. The engine, of course,
 * imports none of it -- `packages/engine/test/purity.test.ts` would fail if it
 * did, and the assistant is a server concern precisely because the engine has
 * to stay runnable anywhere.
 *
 * What is left here after {@link structuredClient} takes the shared half is
 * exactly the provider-specific part, and no more:
 *
 * **Transport.** One `messages.create` with `output_config.format` set to the
 * caller's JSON Schema. Structured output rather than prose, because a
 * suggestion that has to be regex'd out of a paragraph is a suggestion that
 * will one day be misread into a token value.
 *
 * **Classification.** Which HTTP status means which kind of failure. It says
 * only *which kind*; it never decides whether a message is safe to repeat --
 * every string it builds comes from `describe`, which the seam supplies with
 * the key already in hand. That is why an SDK error, built from a request that
 * carried the key in a header, cannot leave this file as itself.
 */
import Anthropic from '@anthropic-ai/sdk'
import { LlmError, structuredClient } from './llm'
import type { LlmClient, LlmClientConfig } from './llm'

/**
 * The model used when nothing is configured.
 *
 * Sonnet is the default rather than the largest model on offer: every operation
 * here is a bounded judgement over a document that is already in front of it --
 * name this, is this a duplicate, why is this 8px -- and the user is paying per
 * call out of their own credit. The setting exists for the reviewer who
 * disagrees.
 */
export const DEFAULT_LLM_MODEL = 'claude-sonnet-5'

/** One request's ceiling. Generous for a card, nowhere near a document. */
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * `true` when this looks like an Anthropic API key.
 *
 * Used only to give a better message before a request is spent, never to decide
 * whether a key is valid -- that is the provider's answer, and a key shape is
 * not a security boundary.
 */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{16,}$/.test(key.trim())
}

export function createAnthropicClient(config: LlmClientConfig): LlmClient {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl === undefined ? {} : { baseURL: config.baseUrl }),
    timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // The SDK retries 429s and 5xxs by default. One retry is worth having on a
    // user-initiated suggestion; more turns a rate limit into a long stall
    // behind a spinner, and the panel already says "try again" perfectly well.
    maxRetries: 1,
  })

  return structuredClient({
    model: config.model,
    secrets: () => [config.apiKey],
    classify: toLlmError,

    async transport(request) {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
        output_config: { format: { type: 'json_schema', schema: request.schema } },
      })

      return {
        text: response.content
          .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        model: response.model,
        refused: response.stop_reason === 'refusal',
      }
    },
  })
}

/**
 * Which kind of failure this is. The message comes from `describe`, always.
 *
 * The status drives the kind rather than the message text: matching on strings
 * is how an error class stops being recognised the week a provider rewords
 * something. 401 and 403 are both "go and fix your key" from the panel's point
 * of view; 402 is credit, which is the one every new user hits and deserves its
 * own sentence.
 */
function toLlmError(error: unknown, describe: (error: unknown) => string): LlmError | undefined {
  const status = error instanceof Anthropic.APIError ? error.status : undefined
  const detail = describe(error)

  if (error instanceof Anthropic.AuthenticationError || status === 401 || status === 403) {
    return new LlmError('auth', `the Anthropic API rejected this key: ${detail}`, status)
  }
  if (status === 402) {
    return new LlmError(
      'auth',
      `this Anthropic account has no API credit: ${detail}. A Claude subscription does not include API usage; add credit at console.anthropic.com.`,
      status,
    )
  }
  if (error instanceof Anthropic.RateLimitError || status === 429) {
    return new LlmError('rate-limit', `the Anthropic API is rate-limiting this key: ${detail}`, status)
  }
  if (error instanceof Anthropic.BadRequestError || (status !== undefined && status >= 400 && status < 500)) {
    return new LlmError('invalid-request', `the Anthropic API refused the request: ${detail}`, status)
  }
  // Everything else -- a socket reset, a 502 from a proxy, an SDK bug -- falls
  // through to the seam's own `unavailable`, which is already redacted.
  return undefined
}
