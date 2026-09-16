/**
 * One token, with its reasoning and its edit box.
 *
 * This is the atom the right column is made of, and it exists once rather than
 * per token group because the rules are the same everywhere: show the value,
 * label where it came from, and open the whole provenance on demand -- which
 * captures contributed, every raw value observed, the dominant-choice record,
 * any contrast adjustment, and, for an overridden token, the engine's own
 * answer it replaced.
 *
 * Editing is inline and the value is sent as typed. The engine parses and
 * normalises it and refuses what it cannot read, so the panel does not carry a
 * second, quietly different, idea of what "10px" means.
 *
 * The one place the assistant appears here is the reason field, and only on an
 * override that has none. That reason is what `design.md` prints as the whole
 * explanation for a value disagreeing with the evidence, so an empty one is a
 * real gap -- and drafting prose from the evidence is exactly the judgement a
 * language model is good at. It fills the box; it never sends it. The reviewer
 * still has to press Override, which is the same click it always was.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import type { TokenOrigin, TokenSlot } from '@ingot/engine'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Origin, in one word, with the tone a reader should give it. */
const ORIGIN_STYLE: Record<TokenOrigin, { label: string; className: string }> = {
  observed: { label: 'measured', className: 'text-muted-foreground' },
  derived: { label: 'derived', className: 'text-muted-foreground' },
  filled: { label: 'default', className: 'text-muted-foreground italic' },
  adjusted: { label: 'adjusted', className: 'text-amber-600 dark:text-amber-500' },
  overridden: { label: 'yours', className: 'text-primary font-medium' },
}

export interface TokenRowProps {
  slot: TokenSlot
  origin: TokenOrigin
  /** The reviewer's note, when this token carries an override. */
  note?: string
  /** True when this value was one the assistant proposed and the reviewer took. */
  suggested?: boolean
  busy: boolean
  onOverride: (path: string, value: string, note?: string) => void
  onClear: (path: string) => void
  /**
   * Draft a reason for this override, or `undefined` when the assistant is not
   * available. Absent means the button simply is not offered -- a disabled
   * control explaining that a key is missing would be a second setup screen in
   * the middle of the token list.
   */
  onDraftReason?: (path: string) => Promise<string>
}

export function TokenRow({
  slot,
  origin,
  note,
  suggested = false,
  busy,
  onOverride,
  onClear,
  onDraftReason,
}: TokenRowProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(slot.value)
  const [reason, setReason] = useState(note ?? '')
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  // A regeneration or another edit can move the value under the editor; the
  // draft follows it rather than holding a value nobody chose. The reason
  // follows the stored note for the same reason: an edit made elsewhere, or one
  // carried in by a regeneration, has to show here rather than being shadowed
  // by whatever this row was first mounted with.
  useEffect(() => {
    setDraft(slot.value)
  }, [slot.value])

  useEffect(() => {
    setReason(note ?? '')
  }, [note])

  const decision = slot.provenance.decision
  const style = ORIGIN_STYLE[origin]

  function commit(): void {
    const next = draft.trim()
    const nextReason = reason.trim()
    // The reason is part of the override, not decoration on it: it is what
    // `design.md` prints in its overrides section. So a note-only edit on a
    // standing override is a real edit and is sent. On a token nobody has
    // overridden there is nothing for a reason to attach to, and re-sending the
    // engine's own value to carry one would be refused as an override that
    // agrees -- so that case closes the editor and writes nothing.
    const valueChanged = next !== slot.value
    const reasonChanged = nextReason !== (note ?? '')
    if (next === '' || (!valueChanged && !(reasonChanged && origin === 'overridden'))) {
      setEditing(false)
      return
    }
    // The reason is sent only when this edit changed it -- including when it
    // was cleared, which is a decision and is sent as an empty one. Leaving it
    // out says "no statement about the reason", and the standing one survives.
    onOverride(slot.path, next, reasonChanged ? nextReason : undefined)
    setEditing(false)
  }

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <div className="flex items-center gap-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          {/* `color-or-none` is a colour whenever the kit actually has one; the
              error colour is the only slot that can be neither. */}
          {slot.kind === 'color' || (slot.kind === 'color-or-none' && slot.value !== 'none') ? (
            <span
              className="size-3.5 shrink-0 rounded-sm border border-border"
              style={{ background: slot.value }}
              aria-hidden
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs">{slot.label}</span>
          <span className={`shrink-0 text-[10px] uppercase tracking-wide ${style.className}`}>
            {origin === 'overridden' && suggested ? 'yours · suggested' : style.label}
          </span>
        </button>

        <button
          type="button"
          className="shrink-0 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setEditing(true)}
          title={`Override ${slot.path}`}
        >
          {slot.value}
        </button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5 pb-2 pl-5">
          <Input
            className="h-7 font-mono text-xs"
            value={draft}
            autoFocus
            aria-label={`New value for ${slot.path}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                setDraft(slot.value)
                setReason(note ?? '')
                setEditing(false)
              }
            }}
          />
          <Input
            className="h-7 text-xs"
            value={reason}
            placeholder="Why (optional) — it goes into design.md"
            aria-label={`Reason for overriding ${slot.path}`}
            onChange={(event) => setReason(event.target.value)}
          />
          {/*
            Offered only where there is a gap to fill: an override that already
            carries a reason does not need one drafted, and a token nobody has
            overridden has no decision to explain.
          */}
          {onDraftReason === undefined || origin !== 'overridden' || reason.trim() !== '' ? null : (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                disabled={busy || drafting}
                onClick={() => {
                  setDrafting(true)
                  setDraftError(null)
                  void onDraftReason(slot.path)
                    .then((drafted) => setReason(drafted))
                    .catch((error: unknown) =>
                      setDraftError(error instanceof Error ? error.message : 'The assistant could not draft one.'),
                    )
                    .finally(() => setDrafting(false))
                }}
              >
                {drafting ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                Draft a reason
              </Button>
              {draftError === null ? null : (
                <span className="text-[10px] text-amber-600 dark:text-amber-500" role="alert">
                  {draftError}
                </span>
              )}
            </div>
          )}
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7" disabled={busy} onClick={commit}>
              Override
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                setDraft(slot.value)
                setReason(note ?? '')
                setEditing(false)
              }}
            >
              Cancel
            </Button>
            {origin === 'overridden' ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  onClear(slot.path)
                }}
              >
                <RotateCcw aria-hidden />
                Revert
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-1.5 pb-2.5 pl-5 text-[11px] leading-relaxed text-muted-foreground">
          <p className="font-mono text-[10px] text-foreground/70">{slot.path}</p>
          <p>{decision.summary}</p>

          {decision.supersedes === undefined ? null : (
            <p>
              The engine chose <span className="font-mono text-foreground">{decision.supersedes.chosen}</span> —{' '}
              {decision.supersedes.summary}
            </p>
          )}
          {decision.note === undefined ? null : <p className="italic">“{decision.note}”</p>}
          {decision.suggestedBy === undefined ? null : (
            <p className="text-violet-600 dark:text-violet-400">
              The assistant proposed this value and you accepted it. The decision is yours; where the candidate came
              from is recorded beside it, and <span className="font-mono">design.md</span> says so too.
            </p>
          )}
          {decision.derivation === undefined ? null : (
            <p>
              {decision.derivation.method}: {decision.derivation.detail}
            </p>
          )}
          {slot.contrastAdjustment === undefined ? null : (
            <p className="text-amber-600 dark:text-amber-500">
              {slot.contrastAdjustment.from.hex} → {slot.contrastAdjustment.to.hex} (
              {slot.contrastAdjustment.ratioBefore}:1 → {slot.contrastAdjustment.ratioAfter}:1).{' '}
              {slot.contrastAdjustment.reason}.
            </p>
          )}

          {slot.provenance.observed.length === 0 ? (
            <p className="italic">Nothing in the captures described this; the value above was supplied, not measured.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {slot.provenance.observed.map((entry) => (
                <li key={entry.value} className="flex items-baseline gap-1.5">
                  <span className="font-mono text-foreground">{entry.value}</span>
                  <span>
                    ×{entry.count} · {entry.captureIds.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {slot.provenance.captureIds.length === 0 ? null : (
            <p>
              From {slot.provenance.captureIds.length} capture
              {slot.provenance.captureIds.length === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      ) : null}
    </li>
  )
}
