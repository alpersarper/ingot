/**
 * The Assistant tab: the advisory layer, and the way in to it.
 *
 * Three states, and the first one matters most.
 *
 * **Setup.** With no usable connection, this tab is a connection picker and a
 * short honest explanation of each one. The order is the product's position on
 * what a first-time user should meet: **the paths that cost nothing come
 * first.** Most people opening this panel already have Claude Code installed
 * and signed in, and telling them to go and top up a prepaid API balance before
 * mentioning that would be advice that wastes twenty minutes of their evening.
 * Where the Anthropic key genuinely is the answer, the setup path still says
 * the thing every one of these screens omits and every user discovers by
 * failing: *a Claude subscription does not include API usage.*
 *
 * **Working.** Two capability buttons that produce *cards in the Review queue*
 * rather than output here, a question box answered from the kit's own
 * provenance, and a naming report. The split is not arbitrary: anything that
 * would change a token is a card a person accepts, and anything that would not
 * is content, shown here and copied by hand if it is wanted.
 *
 * **Failing.** Every error is a notice in this column and nothing else. The
 * assistant is advisory; a provider being down, a key being wrong or a rate
 * limit being hit must never stop somebody importing captures, generating a
 * kit, overriding a token or downloading `design-kit.md`.
 *
 * One rule runs through the connection UI. **Readiness is the server's answer,
 * not this component's.** Whether the `claude` binary exists, whether it is
 * signed in, whether this deployment could even reach it -- only the server can
 * see any of that, so it computes it and this file renders the sentence it is
 * given. A panel that worked out its own version of "ready" would be a second
 * opinion, and the two would disagree on exactly the machine where it mattered.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, KeyRound, Loader2, MessageSquare, Sparkles, Terminal, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import type {
  AssistantAnswer,
  AssistantNaming,
  AssistantState,
  AssistantStatus,
  ConnectionId,
  ConnectionReport,
} from '@/lib/api'

export interface AssistantTabProps {
  assistant: AssistantState | null
  busy: boolean
  onSuggest: (capability: 'derive' | 'merge') => Promise<void>
  onAsk: (question: string) => Promise<AssistantAnswer>
  onName: () => Promise<AssistantNaming>
  /** Stores the Anthropic key. The endpoint's token has its own handler. */
  onSaveLlmKey: (key: string) => Promise<void>
  /** Stores the OpenAI-compatible endpoint's bearer token, and nothing else. */
  onSaveLlmEndpointKey: (key: string) => Promise<void>
  onSaveLlmModel: (model: string) => Promise<void>
  onSaveLlmConnection: (connection: ConnectionId) => Promise<void>
  onSaveLlmBaseUrl: (baseUrl: string) => Promise<void>
}

export function AssistantTab(props: AssistantTabProps): ReactNode {
  const { assistant } = props
  if (assistant === null || !assistant.assistant.configured) return <SetupState {...props} />
  return <WorkingState {...props} assistant={assistant} />
}

/* ----------------------------------------------------------------- setup -- */

function SetupState(props: AssistantTabProps): ReactNode {
  const status = props.assistant?.assistant ?? null

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <section>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" aria-hidden />
          The assistant is not set up
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          It proposes names, fills gaps the captures left, spots near-duplicates and answers questions about this kit
          from its own provenance. Every suggestion is a card you accept or dismiss — it can never write a token.
          Everything else in this panel works without it.
        </p>
      </section>

      {status === null ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Generate a kit and this tab will report which connections this server can use.
        </p>
      ) : (
        <ConnectionSection {...props} status={status} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------ connection -- */

/**
 * Choosing how the assistant reaches a model, and configuring that choice.
 *
 * Shown in both states rather than only in setup, because "which model answered
 * this" is a thing a reviewer wants while they are working, and because
 * switching from a rate-limited subscription to a key mid-session is exactly
 * when someone needs this control and exactly when the setup screen is gone.
 */
function ConnectionSection({
  status,
  busy,
  onSaveLlmKey,
  onSaveLlmEndpointKey,
  onSaveLlmModel,
  onSaveLlmConnection,
  onSaveLlmBaseUrl,
}: AssistantTabProps & { status: AssistantStatus }): ReactNode {
  const [switching, setSwitching] = useState<ConnectionId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = status.connections.find((entry) => entry.id === status.connection)

  async function choose(connection: ConnectionId): Promise<void> {
    if (connection === status.connection) return
    setSwitching(connection)
    setError(null)
    try {
      await onSaveLlmConnection(connection)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not switch connection.')
    } finally {
      setSwitching(null)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Connection</h4>

      {status.connectionManagedByEnvironment ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Pinned to <span className="font-mono text-foreground">{status.connection}</span> by{' '}
          <span className="font-mono">INGOT_LLM_CONNECTION</span> on the server.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Assistant connection">
          {status.connections.map((connection) => (
            <ConnectionChoice
              key={connection.id}
              connection={connection}
              chosen={connection.id === status.connection}
              busy={busy || switching !== null}
              onChoose={() => void choose(connection.id)}
            />
          ))}
        </ul>
      )}

      {error === null ? null : (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {selected === undefined ? null : (
        <ConnectionSetup
          status={status}
          connection={selected}
          busy={busy}
          onSaveLlmKey={onSaveLlmKey}
          onSaveLlmEndpointKey={onSaveLlmEndpointKey}
          onSaveLlmModel={onSaveLlmModel}
          onSaveLlmBaseUrl={onSaveLlmBaseUrl}
        />
      )}
    </section>
  )
}

/**
 * One connection in the list.
 *
 * An unreachable connection is rendered *disabled and explained* rather than
 * hidden. "This one is for the local run, not the container" is exactly what a
 * person comparing the two run paths needs to read; silently dropping it would
 * leave them wondering whether they had misread the documentation.
 */
function ConnectionChoice({
  connection,
  chosen,
  busy,
  onChoose,
}: {
  connection: ConnectionReport
  chosen: boolean
  busy: boolean
  onChoose: () => void
}): ReactNode {
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={chosen}
        disabled={busy || connection.unreachable}
        onClick={onChoose}
        className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          chosen ? 'border-violet-500/60 bg-violet-500/5' : 'border-border hover:bg-muted/50'
        }`}
      >
        <span className="flex items-center gap-1.5">
          {connection.id === 'claude-cli' ? (
            <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="text-[11px] font-semibold">{connection.label}</span>
          <StateChip connection={connection} />
        </span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{connection.summary}</span>
        {connection.ready || connection.blocked === '' ? null : (
          <span className="mt-1 block text-[10px] leading-relaxed text-amber-600 dark:text-amber-500">
            {connection.blocked}
          </span>
        )}
      </button>
    </li>
  )
}

function StateChip({ connection }: { connection: ConnectionReport }): ReactNode {
  const label = connection.unreachable ? 'Not available here' : connection.ready ? 'Ready' : 'Needs setup'
  const tone = connection.ready
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : 'bg-muted text-muted-foreground'
  return <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${tone}`}>{label}</span>
}

/** The fields the chosen connection actually needs, and nothing else. */
function ConnectionSetup({
  status,
  connection,
  busy,
  onSaveLlmKey,
  onSaveLlmEndpointKey,
  onSaveLlmModel,
  onSaveLlmBaseUrl,
}: {
  status: AssistantStatus
  connection: ConnectionReport
  busy: boolean
  onSaveLlmKey: (key: string) => Promise<void>
  onSaveLlmEndpointKey: (key: string) => Promise<void>
  onSaveLlmModel: (model: string) => Promise<void>
  onSaveLlmBaseUrl: (baseUrl: string) => Promise<void>
}): ReactNode {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      {connection.id === 'claude-cli' ? <ClaudeCliSetup status={status} connection={connection} /> : null}
      {connection.id === 'openai-compatible' ? (
        <OpenAiSetup
          status={status}
          busy={busy}
          onSaveLlmBaseUrl={onSaveLlmBaseUrl}
          onSaveLlmEndpointKey={onSaveLlmEndpointKey}
        />
      ) : null}
      {connection.id === 'anthropic-api' ? <AnthropicSetup status={status} onSaveLlmKey={onSaveLlmKey} /> : null}

      <ModelField
        key={connection.id}
        status={status}
        busy={busy}
        connection={connection}
        onSaveLlmModel={onSaveLlmModel}
      />
    </div>
  )
}

function ClaudeCliSetup({
  status,
  connection,
}: {
  status: AssistantStatus
  connection: ConnectionReport
}): ReactNode {
  const keyed = connection.cliAuth === 'api-key'
  return (
    <div>
      <h4 className="text-[11px] font-semibold">{keyed ? 'Signed in with an API key' : 'No API key needed'}</h4>
      {keyed ? (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          This runs the <span className="font-mono text-foreground">claude</span> command on the machine the server is
          on, in headless mode — but that command is signed in with an API key, so each call is billed to that key
          rather than covered by a subscription. To use the free path, sign it into your Claude account:{' '}
          <span className="font-mono text-foreground">claude auth login</span>.
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          This runs the <span className="font-mono text-foreground">claude</span> command on the machine the server is
          on, in headless mode, using the account it is already signed into. Nothing is billed per call: your Claude
          subscription covers it, and the usage limits are the ones you already have. The server hands it none of its
          own keys, so a key in the environment cannot quietly change who pays.
        </p>
      )}
      {status.containerized ? (
        <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">This server is in a container.</span> A container cannot start a
          process on your machine, so this connection is only available on the local run —{' '}
          <span className="font-mono">pnpm dev</span>. In Docker, use an OpenAI-compatible endpoint or an Anthropic key.
        </p>
      ) : (
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            Install Claude Code if you have not:{' '}
            <span className="font-mono text-foreground">npm i -g @anthropic-ai/claude-code</span>.
          </li>
          <li>
            Sign in once: <span className="font-mono text-foreground">claude auth login</span>.
          </li>
          <li>That is the whole setup. The server finds it on its PATH.</li>
        </ol>
      )}
    </div>
  )
}

function OpenAiSetup({
  status,
  busy,
  onSaveLlmBaseUrl,
  onSaveLlmEndpointKey,
}: {
  status: AssistantStatus
  busy: boolean
  onSaveLlmBaseUrl: (baseUrl: string) => Promise<void>
  onSaveLlmEndpointKey: (key: string) => Promise<void>
}): ReactNode {
  const [url, setUrl] = useState(status.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(what: string, operation: () => Promise<void>): Promise<void> {
    setSaving(what)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="text-[11px] font-semibold">Any endpoint that speaks /chat/completions</h4>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          A model on this machine costs nothing and sends nothing anywhere:{' '}
          <span className="font-mono text-foreground">ollama serve</span>, then{' '}
          <span className="font-mono text-foreground">http://localhost:11434/v1</span>. OpenRouter, Groq and
          Gemini&rsquo;s compatibility endpoint all work here too, with a key.
        </p>
        {status.containerized ? (
          <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">This server is in a container.</span> Its{' '}
            <span className="font-mono">localhost</span> is the container, not your machine — point it at{' '}
            <span className="font-mono text-foreground">http://host.docker.internal:11434/v1</span> to reach an Ollama
            running on the host.
          </p>
        ) : null}
      </div>

      {status.baseUrlManagedByEnvironment ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Pinned to <span className="font-mono text-foreground">{status.baseUrl}</span> by{' '}
          <span className="font-mono">INGOT_LLM_BASE_URL</span> on the server.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assistant-base-url" className="text-[11px] font-semibold">
            Endpoint URL
          </Label>
          <div className="flex gap-1.5">
            <Input
              id="assistant-base-url"
              className="h-7 font-mono text-xs"
              value={url}
              placeholder="http://localhost:11434/v1"
              autoComplete="off"
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              // Three "Save" buttons can be on screen at once. The visible
              // label stays short; the accessible one says which.
              aria-label="Save endpoint"
              disabled={busy || saving !== null || url.trim() === '' || url.trim() === (status.baseUrl ?? '')}
              onClick={() => void save('url', () => onSaveLlmBaseUrl(url.trim()))}
            >
              {saving === 'url' ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Save
            </Button>
          </div>
        </div>
      )}

      {status.endpointKeyManagedByEnvironment ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A key for this endpoint is pinned by <span className="font-mono">INGOT_LLM_ENDPOINT_KEY</span> on the server.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assistant-endpoint-key" className="text-[11px] font-semibold">
            API key (optional)
          </Label>
          <div className="flex gap-1.5">
            <Input
              id="assistant-endpoint-key"
              type="password"
              className="h-7 font-mono text-xs"
              value={key}
              placeholder={status.endpointKeyConfigured ? 'a key is stored' : 'not needed for a local model'}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              aria-label="Save endpoint key"
              disabled={busy || saving !== null || key.trim() === ''}
              onClick={() =>
                void save('key', async () => {
                  await onSaveLlmEndpointKey(key.trim())
                  setKey('')
                })
              }
            >
              {saving === 'key' ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
              Save
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Sent as a bearer token to the endpoint above and nowhere else. A model running on this machine needs none.
          </p>
        </div>
      )}

      {error === null ? null : (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The Anthropic key path, written out in full.
 *
 * Kept long rather than trimmed to a field, because "get an API key" is a
 * four-step errand on a site the user has probably never opened, and the step
 * everybody gets wrong -- expecting their subscription to cover it -- happens
 * before they leave this page.
 */
function AnthropicSetup({
  status,
  onSaveLlmKey,
}: {
  status: AssistantStatus
  onSaveLlmKey: (key: string) => Promise<void>
}): ReactNode {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onSaveLlmKey(key.trim())
      setKey('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the key.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="text-[11px] font-semibold">You need an Anthropic API key</h4>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">A Claude subscription does not include API usage.</span> Claude
          Pro or Max pays for claude.ai; the API is billed separately, from prepaid credit on an Anthropic Console
          account. Having one does not give you the other, and this is the step nearly everybody is surprised by — if
          you have Claude Code installed, the connection above uses that subscription instead and costs nothing.
        </p>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            Sign in at{' '}
            <a
              className="font-medium text-foreground underline underline-offset-2"
              href="https://console.anthropic.com"
              target="_blank"
              rel="noreferrer"
            >
              console.anthropic.com
            </a>{' '}
            — the Console, not claude.ai.
          </li>
          <li>
            Under <span className="text-foreground">Billing</span>, add credit. There is no subscription to buy; you top
            up a balance.
          </li>
          <li>
            Under <span className="text-foreground">API keys</span>, create a key. It is shown once, so copy it then.
          </li>
          <li>Paste it below. It is stored on this server and is never returned to this browser.</li>
        </ol>
        <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">What it costs.</span> One suggestion sends this kit and its
          provenance and reads back a short answer — around <span className="font-medium text-foreground">$0.03</span>{' '}
          at the default model. <span className="font-medium text-foreground">$5 of credit is ample</span> for working
          through a kit many times over. The panel also caps how many assistant calls it will make per minute, so a
          mistake cannot become a bill.
        </p>
      </div>

      {status.managedByEnvironment ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A key is pinned by <span className="font-mono">INGOT_LLM_API_KEY</span> on the server and cannot be changed
          from here.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assistant-llm-key" className="text-[11px] font-semibold">
            Anthropic API key
          </Label>
          <Input
            id="assistant-llm-key"
            type="password"
            className="h-8 font-mono text-xs"
            value={key}
            placeholder="sk-ant-..."
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && key.trim() !== '') void save()
            }}
          />
          {error === null ? null : (
            <p className="text-[11px] text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button size="sm" className="self-start" disabled={saving || key.trim() === ''} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
            Save key
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Stored server-side, never sent back to this browser, and redacted from every log and error message. What
            leaves this machine on an assistant call is this kit&rsquo;s tokens and provenance plus your question —
            never the key, never your captures, never your screenshots.
          </p>
        </div>
      )}
    </div>
  )
}

function ModelField({
  status,
  connection,
  busy,
  onSaveLlmModel,
}: {
  status: AssistantStatus
  connection: ConnectionReport
  busy: boolean
  onSaveLlmModel: (model: string) => Promise<void>
}): ReactNode {
  const [model, setModel] = useState(status.model)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onSaveLlmModel(model.trim())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the model.')
    } finally {
      setSaving(false)
    }
  }

  if (status.modelManagedByEnvironment) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Model pinned to <span className="font-mono text-foreground">{status.model}</span> by{' '}
        <span className="font-mono">INGOT_LLM_MODEL</span> on the server.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="assistant-model" className="text-[11px] font-semibold">
        Assistant model
      </Label>
      <div className="flex gap-1.5">
        <Input
          id="assistant-model"
          className="h-7 font-mono text-xs"
          value={model}
          placeholder={connection.defaultModel === '' ? 'the model this endpoint serves' : connection.defaultModel}
          onChange={(event) => setModel(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          aria-label="Save model"
          disabled={busy || saving || model.trim() === '' || model === status.model}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          Save
        </Button>
      </div>
      {error === null ? null : (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- working -- */

function WorkingState(props: AssistantTabProps & { assistant: AssistantState }): ReactNode {
  const { assistant, busy, onSuggest, onAsk, onName } = props
  const [running, setRunning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [naming, setNaming] = useState<AssistantNaming | null>(null)

  const open = assistant.proposals.filter((entry) => entry.status === 'open').length

  /**
   * Run one capability, and turn any failure into a notice.
   *
   * Deliberately swallowing: this is the advisory layer, and a failure here is
   * a sentence in this column rather than something the rest of the panel has
   * to know about. `busy` still guards double clicks.
   */
  async function run(label: string, operation: () => Promise<void>): Promise<void> {
    setRunning(label)
    setNotice(null)
    try {
      await operation()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The assistant could not answer.')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="flex flex-col">
      {notice === null ? null : (
        <p
          className="border-b border-border bg-amber-500/10 px-4 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400"
          role="alert"
        >
          {notice}
        </p>
      )}

      <section className="border-b border-border px-4 py-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Suggestions</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
          Each of these lands as a card in <span className="text-foreground">Review</span>, beside the engine&rsquo;s
          own findings and marked as a suggestion. Every value is checked against the engine&rsquo;s guardrails —
          contrast floor included — before it is offered, and nothing reaches the kit until you accept it.
        </p>
        <div className="flex flex-col gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || running !== null}
            onClick={() => void run('derive', () => onSuggest('derive'))}
          >
            {running === 'derive' ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
            Fill the gaps the captures left
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || running !== null}
            onClick={() => void run('merge', () => onSuggest('merge'))}
          >
            {running === 'merge' ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
            Find near-duplicate tokens
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {open === 0
            ? 'No suggestions waiting.'
            : `${open} suggestion${open === 1 ? '' : 's'} waiting in the Review tab.`}
        </p>
      </section>

      <section className="border-b border-border px-4 py-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ask about this kit
        </h3>
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
          Answered from this kit&rsquo;s provenance only, citing the tokens it rests on. &ldquo;The kit does not record
          that&rdquo; is an answer you should expect to get.
        </p>
        <div className="flex gap-1.5">
          <Input
            className="h-7 text-xs"
            value={question}
            placeholder="why is the radius 8?"
            aria-label="Ask the assistant about this kit"
            disabled={busy || running !== null}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || question.trim() === '') return
              void run('ask', async () => setAnswer(await onAsk(question.trim())))
            }}
          />
          <Button
            size="sm"
            className="h-7"
            disabled={busy || running !== null || question.trim() === ''}
            onClick={() => void run('ask', async () => setAnswer(await onAsk(question.trim())))}
          >
            {running === 'ask' ? <Loader2 className="animate-spin" aria-hidden /> : <MessageSquare aria-hidden />}
            Ask
          </Button>
        </div>

        {answer === null ? null : (
          <div className="mt-2 rounded-md border border-border p-2">
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed">{answer.answer}</p>
            {answer.citations.length === 0 ? null : (
              <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                {answer.citations.map((citation) => (
                  <li key={citation.path} className="text-[10px] leading-relaxed text-muted-foreground">
                    <span className="font-mono text-foreground">{citation.path}</span> = {citation.value} —{' '}
                    {citation.decision}
                  </li>
                ))}
              </ul>
            )}
            {answer.unresolved.length === 0 ? null : (
              // An answer that cited something this kit does not have is one to
              // read sceptically, and saying so is cheaper than hoping nobody
              // relies on the sentence around it.
              <p className="mt-2 text-[10px] leading-relaxed text-amber-600 dark:text-amber-500">
                It also cited {answer.unresolved.map((path) => path).join(', ')}, which this kit does not have. Treat
                the rest of the answer with that in mind.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="border-b border-border px-4 py-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Naming</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
          A brand-meaningful vocabulary for this kit. Ingot&rsquo;s role names are a fixed set that every export
          depends on, so these are documentation to copy into a design doc — not a rename, and not a card.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || running !== null}
          onClick={() => void run('name', async () => setNaming(await onName()))}
        >
          {running === 'name' ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          Name this kit
        </Button>

        {naming === null ? null : (
          <div className="mt-2 rounded-md border border-border p-2">
            <p className="text-xs font-medium">{naming.kitName}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{naming.kitDescription}</p>
            {naming.roles.length === 0 ? null : (
              <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                {naming.roles.map((role) => (
                  <li key={role.path} className="text-[10px] leading-relaxed">
                    <span className="font-medium">{role.name}</span>{' '}
                    <span className="font-mono text-muted-foreground">{role.path}</span>
                    <span className="block text-muted-foreground">{role.rationale}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <div className="px-4 py-3">
        <ConnectionSection {...props} status={assistant.assistant} />
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {assistant.assistant.rateLimit.remaining} of {assistant.assistant.rateLimit.max} assistant calls left in this{' '}
          {Math.round(assistant.assistant.rateLimit.windowMs / 1000)}-second window. Prompts:{' '}
          <span className="font-mono">{assistant.assistant.promptVersion}</span>.
        </p>
      </div>
    </div>
  )
}
