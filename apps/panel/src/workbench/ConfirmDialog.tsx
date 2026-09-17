/**
 * The panel's one confirmation dialog.
 *
 * Deleting is the only thing in this product that cannot be undone, so the
 * dialog is written around one rule: **it names exactly what is destroyed and
 * exactly what survives**, in the same words the server would use. A dialog
 * that says "Are you sure?" makes the user guess, and the guess is where the
 * damage happens -- somebody deletes a group expecting the captures to go with
 * it, or hesitates over a capture delete because they think it will take the
 * kit down too.
 *
 * `typeToConfirm` escalates that for the one action that destroys a whole
 * library: the user has to type a word, so the confirmation cannot be a reflex
 * click. It is the same word the API insists on, rather than a flourish in
 * front of an endpoint that would have accepted anything.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface ConfirmDialogProps {
  title: string
  /** What will happen, in full. Rendered above the buttons. */
  children: ReactNode
  confirmLabel: string
  /** When set, the confirm button stays disabled until this word is typed. */
  typeToConfirm?: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  typeToConfirm,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactNode {
  const [typed, setTyped] = useState('')
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  // Focus lands inside the dialog so the keyboard is already where the decision
  // is, and Escape gets out of it. Both are what a native dialog would do.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const ready = typeToConfirm === undefined || typed.trim() === typeToConfirm

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-sm font-semibold">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">{children}</div>

        {typeToConfirm === undefined ? null : (
          <label className="mt-4 block text-xs font-medium text-foreground">
            Type <code className="font-mono text-destructive">{typeToConfirm}</code> to confirm
            <Input
              className="mt-1.5"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              aria-label={`Type ${typeToConfirm} to confirm`}
            />
          </label>
        )}

        {error === null ? null : (
          <p className="mt-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} disabled={busy || !ready}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
