/**
 * The provider seam.
 *
 * Everything above this file asks one question -- "here is a prompt and the
 * shape of the answer; give me that shape back" -- and knows nothing else about
 * how the answer was produced. That is the whole point of the interface: the
 * assistant's capabilities are prompt engineering plus a parse, and neither of
 * those should have to change to put a hosted proxy, a second provider or a
 * recorded fixture behind them.
 *
 * Three rules keep the seam narrow enough to be worth having.
 *
 * 1. **Structured output is the contract, not a convention.** A capability
 *    supplies a JSON Schema *and* a hand-written reader. The schema constrains
 *    the provider; the reader is what actually decides whether the reply is
 *    usable, because a schema a provider honours is still not a promise this
 *    process should take on trust. What comes back out of {@link LlmClient} has
 *    already been through both.
 *
 * 2. **The key never crosses this seam outward.** It goes in through
 *    {@link LlmClientConfig} and is the implementation's business from there.
 *    Nothing on {@link LlmReply} carries it, and {@link LlmError} is the only
 *    error type callers see -- see `redact.ts` for why an implementation must
 *    never let a provider's own error escape unfiltered.
 *
 * 3. **No streaming, no sessions, no tools.** Every assistant operation in this
 *    build is one request and one structured answer. A capability that needed
 *    a conversation would be a different seam, and inventing one before there
 *    is a use for it is how a provider interface becomes a provider.
 */

import { describeError } from './redact'

/** One turn of the conversation handed to the model. */
export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

/** A JSON Schema object, as the provider's structured-output format takes it. */
export type JsonSchema = Record<string, unknown>

/**
 * One request: what to say, what shape to say it back in, and how to read it.
 *
 * `parse` is deliberately part of the request rather than something the caller
 * does afterwards. It is what makes "validated structured output out" true of
 * the interface itself: a client that returns an unparsed blob has moved the
 * validation to every call site, and one of them will forget.
 */
export interface LlmRequest<T> {
  /** The versioned template's instructions. Stable across calls of one kind. */
  system: string
  messages: LlmMessage[]
  /** Constrains the reply. Sent to the provider; not a substitute for `parse`. */
  schema: JsonSchema
  /**
   * The hand-written reader for this capability's answer.
   *
   * Throw for anything unusable -- a missing field, an out-of-range number, a
   * path that is not a string. The client turns a throw into an
   * {@link LlmError} of kind `'unusable'`, which callers report and do not
   * retry, because the model saying something malformed twice is the ordinary
   * case rather than the surprising one.
   */
  parse: (value: unknown) => T
  maxTokens: number
}

/** What the model spent, so a caller can say so. Never anything identifying. */
export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmReply<T> {
  value: T
  usage: LlmUsage
  /** The model that actually answered, as the provider reported it. */
  model: string
}

/**
 * Why an assistant call did not produce an answer.
 *
 * The kinds are the ones a panel has a different sentence for. `auth` means the
 * key is wrong or has no credit and the user must go and fix something;
 * `rate-limit` and `unavailable` mean try again; `unusable` means the model
 * answered and the answer was not the shape asked for, which is nobody's
 * emergency and no reason to retry.
 */
export type LlmErrorKind = 'auth' | 'rate-limit' | 'unavailable' | 'unusable' | 'invalid-request'

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  /** The provider's HTTP status, when there was one. */
  readonly status: number | undefined

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    this.status = status
  }
}

/** Everything an implementation needs to reach a provider. */
export interface LlmClientConfig {
  /** The secret. It goes in here and comes out of nothing. */
  apiKey: string
  model: string
  /** Provider endpoint, when it is not the default. */
  baseUrl?: string
  /** Wall-clock ceiling for one request, in milliseconds. */
  timeoutMs?: number
}

export interface LlmClient {
  /** The model this client will use, for the panel to state. */
  readonly model: string
  complete<T>(request: LlmRequest<T>): Promise<LlmReply<T>>
}

/* --------------------------------------------- the shared half of a client -- */

/**
 * What a provider implementation actually has to do: send text, get text back.
 *
 * Everything else a client owes its callers -- refusing an empty answer,
 * parsing the JSON, running the caller's reader, and above all making sure no
 * provider error escapes with a key in it -- is the same work whichever
 * provider is on the other end, so it is done once in {@link structuredClient}
 * rather than once per implementation.
 *
 * That split is a security decision rather than a tidiness one. Redaction that
 * lives inside one implementation is a promise the *next* implementation has to
 * remember to keep, and the failure mode of forgetting is a key in a log file.
 * Here it is a property of the seam: a transport that throws a provider error
 * with an `x-api-key` header in it still cannot leak, because the thing that
 * turns errors into {@link LlmError}s sits above the transport and always runs.
 */
export interface LlmTransportRequest {
  system: string
  messages: readonly LlmMessage[]
  schema: JsonSchema
  maxTokens: number
}

export interface LlmTransportReply {
  /** The model's answer, expected to be JSON matching the request's schema. */
  text: string
  usage: LlmUsage
  /** The model that answered, as the provider reported it. */
  model: string
  /** True when the provider says the model declined rather than answered. */
  refused: boolean
}

export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportReply>

export interface StructuredClientOptions {
  model: string
  transport: LlmTransport
  /**
   * Every secret this client must never let out, read at throw time.
   *
   * A function rather than a list because the key can be replaced while the
   * process runs, and a client holding the old one would let the new one
   * through.
   */
  secrets: () => readonly (string | undefined)[]
  /**
   * Provider-specific classification of a provider-specific error.
   *
   * Optional, and safe to omit: anything it does not classify -- and anything
   * at all when it is absent -- becomes an `unavailable` {@link LlmError} whose
   * message has been through `describeError` with the secrets in hand. An
   * implementation supplies this to say *which* kind a failure is, never to
   * decide whether it is safe to repeat.
   */
  classify?: (error: unknown, describe: (error: unknown) => string) => LlmError | undefined
}

/**
 * A client, given a transport.
 *
 * This is where "validated structured output out" is made true, and where the
 * key stops. Read the branches in order: they are the list of things a model
 * can do instead of answering, and each becomes a message a person can act on
 * rather than a stack trace.
 */
export function structuredClient(options: StructuredClientOptions): LlmClient {
  const describe = (error: unknown): string => describeError(error, options.secrets())

  return {
    model: options.model,

    async complete<T>(request: LlmRequest<T>): Promise<LlmReply<T>> {
      let reply: LlmTransportReply
      try {
        reply = await options.transport({
          system: request.system,
          messages: request.messages,
          schema: request.schema,
          maxTokens: request.maxTokens,
        })
      } catch (error) {
        // An `LlmError` from a transport is already safe -- it was built here
        // or from `describe`. Anything else is a provider's own object and is
        // never repeated as itself.
        if (error instanceof LlmError) throw error
        throw (
          options.classify?.(error, describe) ??
          new LlmError('unavailable', `the assistant call failed: ${describe(error)}`)
        )
      }

      if (reply.refused) {
        throw new LlmError(
          'unusable',
          'the model declined to answer that. Rephrase the question, or ask about a different part of the kit.',
        )
      }
      if (reply.text.trim() === '') throw new LlmError('unusable', 'the model returned an empty answer')

      let parsed: unknown
      try {
        parsed = JSON.parse(reply.text) as unknown
      } catch {
        // The reply itself is never quoted back: it is model output built from
        // a prompt that contains the kit, and this message may be logged.
        throw new LlmError('unusable', 'the model did not answer in the requested JSON shape')
      }

      let value: T
      try {
        value = request.parse(parsed)
      } catch (error) {
        throw new LlmError(
          'unusable',
          `the model's answer was not usable: ${error instanceof Error ? error.message : 'unexpected shape'}`,
        )
      }

      return { value, usage: reply.usage, model: reply.model }
    },
  }
}

/**
 * How the server obtains a client.
 *
 * A factory rather than an instance because the key and the model are settings:
 * both can change while the process is running, and a client built at boot
 * would be holding whichever one happened to be stored then. Tests hand in a
 * factory of their own, which is what lets the whole assistant be exercised
 * without a network or a key.
 */
export type LlmClientFactory = (config: LlmClientConfig) => LlmClient
