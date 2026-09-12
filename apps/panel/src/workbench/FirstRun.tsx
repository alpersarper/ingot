/**
 * First run: pair, then optionally hand the server an LLM key.
 *
 * Pairing is not a login. There is no account -- the token exists so that a
 * page the user happens to have open in another tab cannot script requests at
 * their panel. Saying that plainly here matters: a screen that looks like a
 * login without being one invites the user to type a password into it.
 *
 * The key step is deliberately skippable. The key powers the assistant -- the
 * panel's advisory layer -- and the Assistant tab carries the full guided
 * setup (subscription-vs-API, Console steps, cost) for anyone who skips it
 * here. That walkthrough lives there on purpose; this screen only points.
 */
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { api, storeToken } from '@/lib/api'

type Step = 'pair' | 'key'

export function FirstRun({ onPaired }: { onPaired: () => void }): ReactNode {
  const [step, setStep] = useState<Step>('pair')
  const [token, setToken] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitToken(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (await api.verifyPairing(token.trim())) {
        storeToken(token.trim())
        setStep('key')
      } else {
        setError('That token does not match. Check the server log, or data/pairing-token.txt.')
      }
    } catch {
      setError('Could not reach the panel server. Is it running?')
    } finally {
      setBusy(false)
    }
  }

  async function submitKey(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (apiKey.trim() !== '') await api.saveLlmKey(apiKey.trim())
      onPaired()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the key.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <IngotMark />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Ingot</h1>
            <p className="text-xs text-muted-foreground">Design-kit distillation workbench</p>
          </div>
        </div>

        {step === 'pair' ? (
          <form onSubmit={(event) => void submitToken(event)} className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold">Pair this browser with your panel</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Your panel runs a local server. The pairing token is what stops any other page you have open from
                  talking to it. The server printed one when it started, and wrote it to{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">pairing-token.txt</code> in its data
                  directory.
                </p>
              </div>
            </div>

            <Label htmlFor="pairing-token">Pairing token</Label>
            <Input
              id="pairing-token"
              className="mt-1.5 font-mono"
              value={token}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="paste the token here"
              onChange={(event) => setToken(event.target.value)}
            />
            {error === null ? null : <p className="mt-2 text-xs text-destructive">{error}</p>}

            <Button type="submit" className="mt-4 w-full" disabled={busy || token.trim() === ''}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Pair
            </Button>
          </form>
        ) : (
          <form onSubmit={(event) => void submitKey(event)} className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-start gap-3">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold">LLM API key (optional)</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Stored on the server, never in this browser, and never returned by any endpoint. The key powers the
                  assistant&apos;s suggestions; everything else works without one, and the Assistant tab will walk you
                  through getting a key whenever you want it.
                </p>
              </div>
            </div>

            <Label htmlFor="llm-key">API key</Label>
            <Input
              id="llm-key"
              className="mt-1.5 font-mono"
              type="password"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              onChange={(event) => setApiKey(event.target.value)}
            />
            {error === null ? null : <p className="mt-2 text-xs text-destructive">{error}</p>}

            <div className="mt-4 flex gap-2">
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {apiKey.trim() === '' ? 'Continue without a key' : 'Save and continue'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/** The mark: an ingot. Inline so the panel ships no image requests. */
export function IngotMark({ className = 'size-9' }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden role="presentation">
      <path d="M5 23h22l-3.5-10.5h-15z" className="fill-primary" />
      <path d="M8.5 12.5h15L21 8H11z" className="fill-primary/55" />
    </svg>
  )
}
