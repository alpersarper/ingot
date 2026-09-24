/**
 * The connections: the three ways this assistant can reach a model, and what
 * each one needs before it can.
 *
 * This file is vocabulary and arithmetic, nothing else. It imports no provider,
 * spawns nothing and fetches nothing -- it takes what the server already knows
 * (is there a key, is there a base URL, is the CLI there, are we in a
 * container) and answers two questions: *which connections are ready*, and
 * *which one should be used when nobody has chosen*. Keeping that pure is what
 * lets the panel's connection picker, the service's client selection and the
 * tests all agree without any of them re-deriving readiness.
 *
 * The order of {@link CONNECTION_IDS} is the order the panel shows, and it is
 * the product ranking rather than an implementation detail: **the paths that
 * cost nothing come first.** A person opening this panel for the first time
 * should meet "you are already signed into Claude on this machine" before they
 * meet "go and top up a prepaid balance", because for most users the first one
 * is true and the second one is a twenty-minute errand.
 *
 * What a connection is *not* is a different kind of assistant. Every one of
 * them ends up behind `LlmClient`, produces the same structured answers from
 * the same versioned prompts, and is checked by the same engine guardrails
 * before anything becomes a card. Swapping connections changes who answers,
 * never what an answer is allowed to do.
 */

export const CONNECTION_IDS = ['claude-cli', 'openai-compatible', 'anthropic-api'] as const

export type ConnectionId = (typeof CONNECTION_IDS)[number]

export function isConnectionId(value: unknown): value is ConnectionId {
  return typeof value === 'string' && (CONNECTION_IDS as readonly string[]).includes(value)
}

/** What a connection needs from configuration before it can serve a call. */
export interface ConnectionShape {
  id: ConnectionId
  label: string
  /** One line, the panel's subtitle. Says what it costs, because that is the question. */
  summary: string
  /** True when it cannot run without an API key. */
  requiresApiKey: boolean
  /** True when an API key is meaningful but optional (a local endpoint needs none). */
  acceptsApiKey: boolean
  /** True when the endpoint is the user's to name. */
  requiresBaseUrl: boolean
  /** The model asked when nothing is configured. Empty when there is no sane guess. */
  defaultModel: string
  /**
   * True when this connection is a *process on the host* rather than an address.
   *
   * The only consequence is honesty about Docker: see `runtime.ts`.
   */
  needsHostProcess: boolean
}

export const CONNECTIONS: Record<ConnectionId, ConnectionShape> = {
  'claude-cli': {
    id: 'claude-cli',
    label: 'Local Claude Code CLI',
    summary: 'No API key. Uses the `claude` CLI on this machine and the account it is already signed into.',
    requiresApiKey: false,
    acceptsApiKey: false,
    requiresBaseUrl: false,
    // An alias would also work -- the CLI accepts `sonnet` -- but the full name
    // is what the panel prints and what a support thread can be specific about.
    defaultModel: 'claude-sonnet-5',
    needsHostProcess: true,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    summary: 'Any server that speaks `/chat/completions`: Ollama on this machine, OpenRouter, Groq, Gemini.',
    requiresApiKey: false,
    acceptsApiKey: true,
    requiresBaseUrl: true,
    // Deliberately empty. There is no model this could guess that would be
    // right for both a 7B running locally and a hosted frontier model, and a
    // wrong guess here is a confusing 404 rather than a helpful default.
    defaultModel: '',
    needsHostProcess: false,
  },
  'anthropic-api': {
    id: 'anthropic-api',
    label: 'Anthropic API key',
    summary: 'Prepaid API credit from the Anthropic Console. Separate from a Claude subscription.',
    requiresApiKey: true,
    acceptsApiKey: true,
    requiresBaseUrl: false,
    defaultModel: 'claude-sonnet-5',
    needsHostProcess: false,
  },
}

/**
 * What the server knows about its own configuration, with no secrets in it.
 *
 * Presence rather than value, throughout: readiness is a question about whether
 * a key exists, and this type existing means nothing that computes readiness
 * ever has to be handed one.
 */
export interface ConnectionFacts {
  /** True when an Anthropic key exists, wherever it came from. */
  hasApiKey: boolean
  /**
   * True when the Anthropic key is pinned by the environment.
   *
   * Presence and provenance are different facts here: a pinned key is a
   * deployment's explicit statement, made before `INGOT_LLM_CONNECTION`
   * existed, and {@link resolveConnection} honours it so a v1 deployment that
   * pinned a key (and possibly an Anthropic proxy URL) keeps reaching the
   * Anthropic client rather than having its proxy mistaken for a chat endpoint.
   */
  apiKeyPinned?: boolean
  baseUrl: string | undefined
  model: string
  /** The host CLI, as `probeClaudeCli` found it. Absent when it was not probed. */
  cli: { available: boolean; signedIn: boolean | undefined; detail: string } | undefined
  containerized: boolean
}

/** One connection, as the panel renders it. Never carries a secret. */
export interface ConnectionReport {
  id: ConnectionId
  label: string
  summary: string
  /** True when a call on this connection would reach a model right now. */
  ready: boolean
  /**
   * Why it would not, in a sentence a person can act on. Empty when ready.
   *
   * Written as an instruction rather than a diagnosis wherever there is one to
   * give: "run `claude auth login`" beats "not authenticated".
   */
  blocked: string
  /**
   * True when this runtime cannot reach this connection at all.
   *
   * Distinct from `blocked`, which is a thing the user can fix here. An
   * unreachable connection is disabled in the panel and explained, never
   * silently dropped: "the CLI connection is for the local run" is exactly the
   * fact a person comparing the two run paths needs.
   */
  unreachable: boolean
  requiresApiKey: boolean
  acceptsApiKey: boolean
  requiresBaseUrl: boolean
  defaultModel: string
}

export function connectionReports(facts: ConnectionFacts): ConnectionReport[] {
  return CONNECTION_IDS.map((id) => report(CONNECTIONS[id], facts))
}

function report(shape: ConnectionShape, facts: ConnectionFacts): ConnectionReport {
  const base = {
    id: shape.id,
    label: shape.label,
    summary: shape.summary,
    requiresApiKey: shape.requiresApiKey,
    acceptsApiKey: shape.acceptsApiKey,
    requiresBaseUrl: shape.requiresBaseUrl,
    defaultModel: shape.defaultModel,
  }

  if (shape.needsHostProcess && facts.containerized) {
    return {
      ...base,
      ready: false,
      unreachable: true,
      blocked:
        'This server is running in a container, which cannot start a process on your machine. Run Ingot with `pnpm dev` to use the CLI, or configure one of the other connections here.',
    }
  }

  switch (shape.id) {
    case 'claude-cli': {
      if (facts.cli === undefined || !facts.cli.available) {
        return {
          ...base,
          ready: false,
          unreachable: false,
          blocked:
            'The `claude` command was not found on this server’s PATH. Install Claude Code (`npm i -g @anthropic-ai/claude-code`), or set INGOT_CLAUDE_CLI_PATH to its full path and restart.',
        }
      }
      if (facts.cli.signedIn === false) {
        return {
          ...base,
          ready: false,
          unreachable: false,
          blocked: 'The `claude` CLI is installed but not signed in. Run `claude auth login` in a terminal.',
        }
      }
      // `signedIn: undefined` means the probe could not tell -- an older CLI
      // with no `auth status`, say. That is not a reason to refuse: the call
      // itself will report an auth failure perfectly well, and refusing on a
      // probe we could not run would break a working setup.
      return { ...base, ready: true, unreachable: false, blocked: '' }
    }

    case 'openai-compatible': {
      if (facts.baseUrl === undefined || facts.baseUrl === '') {
        return {
          ...base,
          ready: false,
          unreachable: false,
          blocked: 'Set the endpoint URL. For Ollama on this machine that is http://localhost:11434/v1.',
        }
      }
      if (facts.model.trim() === '') {
        return {
          ...base,
          ready: false,
          unreachable: false,
          blocked: 'Set the model name this endpoint serves — there is no default that would be right for all of them.',
        }
      }
      return { ...base, ready: true, unreachable: false, blocked: '' }
    }

    case 'anthropic-api': {
      if (!facts.hasApiKey) {
        return {
          ...base,
          ready: false,
          unreachable: false,
          blocked:
            'Add an Anthropic API key — prepaid credit from the Anthropic Console, which a Claude subscription does not cover.',
        }
      }
      return { ...base, ready: true, unreachable: false, blocked: '' }
    }
  }
}

/**
 * Which connection to use when nobody has chosen one.
 *
 * The rule is "the first ready one, in the product's own order", which makes
 * the local CLI the default wherever it works -- the captain's instruction, and
 * also the only default that costs a first-time user nothing.
 *
 * One exception, for the deployments that predate choosing: an Anthropic key
 * *pinned in the environment* outranks the OpenAI-compatible connection. A v1
 * deployment pinned `INGOT_LLM_API_KEY` -- possibly with `INGOT_LLM_BASE_URL`
 * naming an Anthropic proxy -- before `INGOT_LLM_CONNECTION` existed, and that
 * proxy URL satisfying the OpenAI-compatible readiness check must not quietly
 * re-route the pinned key to a client it was never meant for. The local CLI
 * still comes first where it works: it costs nothing, and a pinned key says
 * "use Anthropic", not "pay when the free path is signed in".
 *
 * When *none* is ready the answer is still a connection rather than a null,
 * because the panel has to render a setup state for something and the service
 * has to produce a specific error. The fallback is the one whose setup path is
 * written out in full, which is the Anthropic key.
 */
export function resolveConnection(facts: ConnectionFacts): ConnectionId {
  const reports = connectionReports(facts)
  const ready = (id: ConnectionId): boolean => reports.find((entry) => entry.id === id)?.ready === true
  if (ready('claude-cli')) return 'claude-cli'
  if (facts.apiKeyPinned === true && ready('anthropic-api')) return 'anthropic-api'
  return reports.find((entry) => entry.ready)?.id ?? 'anthropic-api'
}

/**
 * The model a connection asks, given whatever the reviewer stored.
 *
 * One `llm.model` setting serves every connection rather than one each: a
 * per-connection model table is bookkeeping for a panel that shows one
 * connection at a time, and the failure it would prevent -- switching
 * connection and forgetting to change the model -- is a 404 with the model name
 * in it, which is self-explaining.
 */
export function modelFor(connection: ConnectionId, stored: string | undefined): string {
  const trimmed = stored?.trim() ?? ''
  return trimmed === '' ? CONNECTIONS[connection].defaultModel : trimmed
}
