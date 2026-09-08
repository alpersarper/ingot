/**
 * The Assistant tab: the advisory layer, and the way in to it.
 *
 * Three states, and the first one matters most.
 *
 * **Setup.** With no API key, this tab is a short honest explanation and a
 * field. It says the thing every one of these screens omits and every user
 * discovers by failing: *a Claude subscription does not include API usage.*
 * They are separate products with separate billing, and someone who pays
 * Anthropic every month is entitled to be surprised by that. So the setup path
 * says it plainly, links the two pages, and states what this will actually
 * cost -- a few cents a suggestion, five dollars is plenty -- because a person
 * being asked to top up an account deserves a number rather than a shrug.
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
 * kit, overriding a token or downloading `design.md`.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { KeyRound, Loader2, MessageSquare, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import type { AssistantAnswer, AssistantNaming, AssistantState } from '@/lib/api'

export interface AssistantTabProps {
  assistant: AssistantState | null
  busy: boolean
  onSuggest: (capability: 'derive' | 'merge') => Promise<void>
  onAsk: (question: string) => Promise<AssistantAnswer>
  onName: () => Promise<AssistantNaming>
  onSaveLlmKey: (key: string) => Promise<void>
  onSaveLlmModel: (model: string) => Promise<void>
}

export function AssistantTab(props: AssistantTabProps): ReactNode {
  const { assistant } = props
  if (assistant === null || !assistant.assistant.configured) return <SetupState {...props} />
  return <WorkingState {...props} assistant={assistant} />
}

/* ----------------------------------------------------------------- setup -- */

/**
 * What a person needs in order to turn this on, in the order they need it.
 *
 * Written out rather than linked away to, because "get an API key" is a
 * four-step errand on a site the user has probably never opened, and the step
 * everybody gets wrong -- expecting their subscription to cover it -- happens
 * before they leave this page.
 */
function SetupState({ assistant, onSaveLlmKey }: AssistantTabProps): ReactNode {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pinned = assistant?.assistant.managedByEnvironment === true

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

      <section className="rounded-md border border-border p-3">
        <h4 className="text-[11px] font-semibold">You need an Anthropic API key</h4>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">A Claude subscription does not include API usage.</span> Claude
          Pro or Max pays for claude.ai; the API is billed separately, from prepaid credit on an Anthropic Console
          account. Having one does not give you the other, and this is the step nearly everybody is surprised by.
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
            Under <span className="text-foreground">Billing</span>, add credit. There is no subscription to buy; you
            top up a balance.
          </li>
          <li>
            Under <span className="text-foreground">API keys</span>, create a key. It is shown once, so copy it then.
          </li>
          <li>Paste it below. It is stored on this server and is never returned to this browser.</li>
        </ol>
        <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">What it costs.</span> One suggestion sends this kit and its
          provenance and reads back a short answer — around{' '}
          <span className="font-medium text-foreground">$0.03</span> at the default model.{' '}
          <span className="font-medium text-foreground">$5 of credit is ample</span> for working through a kit many
          times over. The panel also caps how many assistant calls it will make per minute, so a mistake cannot become
          a bill.
        </p>
      </section>

      {pinned ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A key is pinned by <span className="font-mono">INGOT_LLM_API_KEY</span> on the server and cannot be changed
          from here.
        </p>
      ) : (
        <section className="flex flex-col gap-1.5">
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
        </section>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- working -- */

function WorkingState({
  assistant,
  busy,
  onSuggest,
  onAsk,
  onName,
  onSaveLlmModel,
}: AssistantTabProps & { assistant: AssistantState }): ReactNode {
  const [running, setRunning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [naming, setNaming] = useState<AssistantNaming | null>(null)
  const [model, setModel] = useState(assistant.assistant.model)

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

      <section className="px-4 py-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Model</h3>
        {assistant.assistant.modelManagedByEnvironment ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Pinned to <span className="font-mono text-foreground">{assistant.assistant.model}</span> by{' '}
            <span className="font-mono">INGOT_LLM_MODEL</span> on the server.
          </p>
        ) : (
          <div className="flex gap-1.5">
            <Input
              className="h-7 font-mono text-xs"
              value={model}
              aria-label="Assistant model"
              onChange={(event) => setModel(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy || running !== null || model.trim() === '' || model === assistant.assistant.model}
              onClick={() => void run('model', () => onSaveLlmModel(model.trim()))}
            >
              Save
            </Button>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {assistant.assistant.rateLimit.remaining} of {assistant.assistant.rateLimit.max} assistant calls left in this{' '}
          {Math.round(assistant.assistant.rateLimit.windowMs / 1000)}-second window. Prompts:{' '}
          <span className="font-mono">{assistant.assistant.promptVersion}</span>.
        </p>
      </section>
    </div>
  )
}
