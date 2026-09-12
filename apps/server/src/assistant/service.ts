/**
 * The assistant, assembled.
 *
 * This is where the key, the model, the prompt templates, the provider and the
 * engine's guardrails meet, and it is deliberately the only place they do. The
 * routes above it decide nothing except which capability was asked for; the
 * capability code below it knows only {@link LlmClient}. What lives here is the
 * wiring that has to be got right once:
 *
 *   - **The key is read per call, never held.** It can change while the process
 *     runs -- the panel writes it, the environment can pin it -- and a service
 *     that captured it at construction would be using the wrong one after the
 *     first edit. It is read, used, and dropped; nothing on any value returned
 *     from this file carries it.
 *   - **Absence is a first-class answer.** `status()` reports whether the
 *     assistant can run without ever attempting a call, because the panel needs
 *     to render its setup state before anything is spent, and because every
 *     other panel feature has to work with no key at all.
 *   - **A proposal is checked before it is stored.** {@link checkProposals}
 *     runs the engine over every candidate; what fails never becomes a row, so
 *     there is no state in which a card exists that the accept path would
 *     refuse.
 *   - **Nothing here writes a token.** Accepting is a separate call, made by a
 *     person, that goes through `planOverrideWrite` like any other override.
 */
import { asPristine, tokenSlots } from '@ingot/engine'
import type { PristineTokens, TokenOverride, TokensDocument } from '@ingot/engine'
import { DEFAULT_LLM_MODEL, createAnthropicClient, looksLikeAnthropicKey } from './anthropic'
import { LlmError } from './llm'
import type { LlmClient, LlmClientFactory, LlmReply, LlmRequest } from './llm'
import { PROMPTS, PROMPT_VERSION } from './prompts'
import type { CapabilityId } from './prompts'
import { kitBrief, renderBrief } from './context'
import { checkProposals } from './proposals'
import type { Candidate, RefusedProposal } from './proposals'
import { readAnswer, readNaming, readProposals, readRationale } from './capabilities'
import type { Naming } from './capabilities'
import { createRedactingLogger } from './redact'
import { LLM_API_KEY_SETTING, LLM_MODEL_SETTING } from './settings-keys'
import type { ServerConfig } from '../config'
import type { ReviewScope, StoredOverride, StoredProposal, Store } from '../storage/store'

/** Where a configured key came from. Never the key itself. */
export type LlmKeySource = 'environment' | 'settings' | 'none'

/** What the panel needs to render the assistant without spending anything. */
export interface AssistantStatus {
  configured: boolean
  source: LlmKeySource
  /** True when the key is pinned in the environment and cannot be edited here. */
  managedByEnvironment: boolean
  model: string
  /** True when the model is pinned in the environment too. */
  modelManagedByEnvironment: boolean
  promptVersion: string
}

export interface AssistantService {
  status(): Promise<AssistantStatus>
  /**
   * Run a proposing capability over a kit and store what survives the engine.
   *
   * The capability's own open queue for the scope is replaced rather than
   * appended to: a fresh run is a fresh reading of the kit, and a queue that
   * only grows is one nobody works through. Another capability's open cards
   * survive untouched -- clearing is capability-scoped for the same reasons
   * suppression is (a derive run must not silence a merge), and nothing
   * user-facing disappears silently: each of those cards cost real credit to
   * produce. The queue stays bounded even so, because every capability's own
   * re-run still replaces its own cards. Accepted and dismissed proposals are
   * kept, and the kept dismissals gate this run: a suggestion of the same
   * capability at the same path is withheld while the engine's answer the
   * dismissal was made against still stands, and comes back marked as a
   * re-offer when it moved.
   */
  suggest(input: SuggestInput): Promise<SuggestResult>
  /** Name the kit's vocabulary. Content: nothing here can change a token. */
  name(input: KitInput): Promise<Naming>
  /** Answer a question strictly from the kit's provenance. Content. */
  ask(input: KitInput & { question: string }): Promise<GroundedAnswer>
  /** Draft the reason for an override the reviewer has not explained. Content. */
  rationale(input: KitInput & { path: string }): Promise<{ reason: string }>
}

export interface KitInput {
  tokens: TokensDocument
  overrides: readonly StoredOverride[]
}

export interface SuggestInput extends KitInput {
  scope: ReviewScope
  capability: Extract<CapabilityId, 'derive' | 'merge'>
  /** The stored distillation, which every guardrail check is made against. */
  pristine: PristineTokens
  standing: readonly TokenOverride[]
}

/**
 * A citation resolved against the kit it claims to be about.
 *
 * The model cites token paths; this is what those paths actually say. Resolving
 * them here rather than trusting the prose is the only mechanical grounding
 * check there is: a path the kit does not have is dropped and counted, so an
 * answer that cited three tokens and invented one says so instead of reading
 * as four confident facts.
 */
export interface Citation {
  path: string
  /** The value in the kit right now. */
  value: string
  /** The dominant-choice sentence, verbatim from the token's provenance. */
  decision: string
}

export interface GroundedAnswer {
  answer: string
  citations: Citation[]
  /**
   * Paths the answer cited that this kit does not have.
   *
   * Reported rather than hidden. An answer whose citations do not resolve is
   * one a reviewer should read sceptically, and the panel says so.
   */
  unresolved: string[]
}

export interface SuggestResult {
  proposals: StoredProposal[]
  /**
   * Candidates the engine would not take.
   *
   * Reported so the caller can log them, never rendered as suggestions: a card
   * whose accept button is guaranteed to fail is worse than no card.
   */
  refused: RefusedProposal[]
  model: string
}

export interface AssistantDeps {
  store: Store
  config: ServerConfig
  /**
   * The pairing token as resolved at startup, for the redacting logger.
   *
   * `config.pairingToken` only exists when the environment pins one; in the
   * default deployment the token is minted at first run and lives on the app
   * context, and "every secret this process holds" has to include it either
   * way. Never read to make a request.
   */
  pairingToken?: string
  /** Injected so a test can exercise all of this without a network or a key. */
  llmFactory?: LlmClientFactory
  /**
   * Where log lines go. The *logger* is never injectable, only its sink.
   *
   * That distinction is the point: redaction is a security property, so the
   * tests have to exercise the real one. Handing in a whole logger would let a
   * test pass against a logger that redacts nothing, which is precisely the
   * bug the test exists to catch.
   */
  logSink?: (line: string) => void
}

export function createAssistant(deps: AssistantDeps): AssistantService {
  const { store, config } = deps
  const llmFactory = deps.llmFactory ?? createAnthropicClient
  // The logger reads the secrets at log time rather than closing over them,
  // because the stored key changes while the process runs and a logger holding
  // the old one would let the new one through.
  const logger = createRedactingLogger(
    () => [config.llmApiKey, cachedKey, config.pairingToken, deps.pairingToken],
    deps.logSink,
  )

  // The last key this service saw, held only so the logger can redact a key
  // that has since been replaced in storage but is still quoted in an error
  // that is on its way to being logged. Never read to make a request.
  let cachedKey: string | undefined

  /** The key to use, or `null`. The environment wins, as it does for settings. */
  async function apiKey(): Promise<string | null> {
    const key = config.llmApiKey ?? (await store.settings.get(LLM_API_KEY_SETTING))
    if (key !== null && key !== undefined) cachedKey = key
    return key ?? null
  }

  async function model(): Promise<string> {
    return config.llmModel ?? (await store.settings.get(LLM_MODEL_SETTING)) ?? DEFAULT_LLM_MODEL
  }

  /**
   * A client, or a refusal a person can act on.
   *
   * The absent-key case is an `LlmError` of kind `auth` rather than a thrown
   * `ApiError` so that every failure on this path has one shape, and so the
   * panel's "set up the assistant" state is reached by the same branch that
   * handles a key the provider rejected.
   */
  async function client(): Promise<LlmClient> {
    const key = await apiKey()
    if (key === null) {
      throw new LlmError(
        'auth',
        'no Anthropic API key is configured, so the assistant cannot run. Add one in the panel; every other feature works without it.',
      )
    }
    if (!looksLikeAnthropicKey(key)) {
      // Said before a request is spent, and said as a warning about shape
      // rather than a verdict: the provider decides whether a key is valid.
      logger.warn('the stored LLM API key does not look like an Anthropic key; sending it anyway')
    }
    return llmFactory({
      apiKey: key,
      model: await model(),
      ...(config.llmBaseUrl === undefined ? {} : { baseUrl: config.llmBaseUrl }),
    })
  }

  /** The kit and the review state, as the model is shown them. */
  function brief(input: KitInput): string {
    return renderBrief(kitBrief(input.tokens, input.overrides))
  }

  /**
   * One assistant call, logged whichever way it goes wrong.
   *
   * The seam already guarantees that what comes out of a client is an
   * {@link LlmError} with a redacted message, so this adds no redaction of its
   * own -- it adds the *log*, in one place, so that a failing key or a template
   * that has started producing garbage is visible in the server output rather
   * than only in whatever the panel happened to render. Anything that is not an
   * `LlmError` is a client not keeping the seam's contract: it is turned into
   * one here rather than allowed to reach the route, where its message could
   * end up in a response.
   */
  async function complete<T>(request: LlmRequest<T>): Promise<LlmReply<T>> {
    const llm = await client()
    try {
      return await llm.complete(request)
    } catch (error) {
      if (error instanceof LlmError) {
        logger.warn(`assistant call failed (${error.kind}): ${error.message}`)
        throw error
      }
      // A client that threw something else has broken the seam. The original
      // is logged through the redacting logger and never repeated onward.
      logger.error('an LLM client threw something that was not an LlmError', error)
      throw new LlmError('unavailable', 'the assistant call failed unexpectedly; the server log has the detail')
    }
  }

  return {
    async status() {
      const source: LlmKeySource =
        config.llmApiKey !== undefined
          ? 'environment'
          : (await store.settings.get(LLM_API_KEY_SETTING)) === null
            ? 'none'
            : 'settings'
      return {
        configured: source !== 'none',
        source,
        managedByEnvironment: source === 'environment',
        model: await model(),
        modelManagedByEnvironment: config.llmModel !== undefined,
        promptVersion: PROMPT_VERSION,
      }
    },

    async suggest(input) {
      const template = PROMPTS[input.capability]

      const reply = await complete({
        system: template.system,
        schema: template.schema,
        parse: readProposals,
        maxTokens: template.maxTokens,
        messages: [{ role: 'user', content: `Here is the kit.\n\n${brief(input)}` }],
      })

      const candidates: Candidate[] = reply.value.proposals
      // The kept dismissals for this capability gate the run: a person already
      // answered these, and the check honours that answer for exactly as long
      // as the engine's answer they responded to stands.
      const dismissed = (await store.proposals.list(input.scope)).filter(
        (row) => row.status === 'dismissed' && row.capability === input.capability,
      )
      const checked = checkProposals(asPristine(clone(input.pristine)), input.standing, candidates, dismissed)

      // Every refusal is logged: it is the signal that a template has started
      // producing values the engine will not take, and nothing else would show
      // it, since a refused candidate is invisible in the panel by design.
      for (const entry of checked.refused) {
        logger.warn(`assistant proposal refused at ${entry.path}: ${entry.reason}`)
      }
      // Suppressions too, for the same reason: withheld is invisible by design.
      for (const entry of checked.suppressed) {
        logger.warn(`assistant proposal withheld at ${entry.path}: ${entry.reason}`)
      }

      await store.proposals.clearOpen(input.scope, input.capability)
      const proposals: StoredProposal[] = []
      for (const proposal of checked.accepted) {
        proposals.push(
          await store.proposals.create(input.scope, {
            capability: input.capability,
            promptVersion: template.version,
            model: reply.model,
            path: proposal.path,
            value: proposal.value,
            baseValue: proposal.baseValue,
            title: proposal.title,
            rationale: proposal.rationale,
            engineNotes: proposal.engineNotes,
            ...(proposal.reoffered ? { reoffered: true } : {}),
          }),
        )
      }

      return { proposals, refused: checked.refused, model: reply.model }
    },

    async name(input) {
      const template = PROMPTS.name
      const reply = await complete({
        system: template.system,
        schema: template.schema,
        parse: readNaming,
        maxTokens: template.maxTokens,
        messages: [{ role: 'user', content: `Here is the kit.\n\n${brief(input)}` }],
      })
      return reply.value
    },

    async ask(input) {
      const template = PROMPTS.qa
      const reply = await complete({
        system: template.system,
        schema: template.schema,
        parse: readAnswer,
        maxTokens: template.maxTokens,
        messages: [
          // The kit first and the question last: the kit is the same bytes on
          // every call for a given scope, so it is the part worth having in
          // front, and the question is the part that varies.
          { role: 'user', content: `Here is the kit.\n\n${brief(input)}\n\nQuestion: ${input.question}` },
        ],
      })
      // The grounding check: every cited path is looked up in the kit the
      // question was asked about. What resolves carries the token's own value
      // and its dominant-choice record, so the panel shows the evidence rather
      // than the model's summary of it; what does not resolve is named.
      const slots = new Map(tokenSlots(input.tokens).map((slot) => [slot.path, slot]))
      const citations: Citation[] = []
      const unresolved: string[] = []
      for (const path of reply.value.citations) {
        const slot = slots.get(path)
        if (slot === undefined) unresolved.push(path)
        else citations.push({ path, value: slot.value, decision: slot.provenance.decision.summary })
      }
      return { answer: reply.value.answer, citations, unresolved }
    },

    async rationale(input) {
      const template = PROMPTS.rationale
      const reply = await complete({
        system: template.system,
        schema: template.schema,
        parse: readRationale,
        maxTokens: template.maxTokens,
        messages: [
          {
            role: 'user',
            content: `Here is the kit.\n\n${brief(input)}\n\nDraft the reason for the override at ${input.path}.`,
          },
        ],
      })
      return reply.value
    },
  }
}

/** A structural copy, so a guardrail check cannot disturb the caller's document. */
function clone(tokens: TokensDocument): TokensDocument {
  return JSON.parse(JSON.stringify(tokens)) as TokensDocument
}
