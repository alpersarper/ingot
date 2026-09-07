/**
 * Right column: the system, and the review of it.
 *
 * Three tabs, in the order the work happens.
 *
 * **Review** is the main loop and the reason this column exists. The engine
 * picked a direction and said why; this is where a person agrees, or does not.
 * Cards come from three places -- a conflict between a standing override and
 * fresh evidence, a diagnostic the engine raised, and a dominant choice with a
 * real minority behind it -- and every card carries its evidence and the
 * runner-up as a one-click override. It is not a settings page: accepting is
 * one click and overriding is one more, and both land immediately in the
 * preview, the docs and every export.
 *
 * **Tokens** is the whole document, group by group, each value with its origin
 * and its provenance a click away, each editable in place.
 *
 * **Export** is the four artefacts. Three come from the server byte for byte;
 * the docs site is rendered here from the same components the preview draws,
 * which is why it needs no server to open.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileCode,
  Info,
  Loader2,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { COMPONENT_DOC_IDS, originOf, tokenSlots } from '@ingot/engine'
import type { ComponentDocId, OverrideGroup, TokensDocument, TokenSlot } from '@ingot/engine'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { KitSummary, ReviewState } from '@/lib/api'
import { decisionCards, openCount } from './decisions'
import type { DecisionCard } from './decisions'
import { TokenRow } from './TokenRow'

type Tab = 'review' | 'tokens' | 'export'

/** Group headings, in the order the kit is built up. */
const GROUP_ORDER: OverrideGroup[] = [
  'color',
  'typography',
  'spacing',
  'radius',
  'border',
  'shadow',
  'component',
  'state',
]

const GROUP_LABEL: Record<OverrideGroup, string> = {
  color: 'Colour roles',
  typography: 'Type scale',
  spacing: 'Spacing bands',
  radius: 'Radius',
  border: 'Border',
  shadow: 'Elevation',
  component: 'Component recipes',
  state: 'State tokens',
}

export interface SystemPanelProps {
  kit: KitSummary | null
  tokens: TokensDocument | null
  review: ReviewState | null
  scopeLabel: string
  captureCount: number
  generating: boolean
  busy: boolean
  error: string | null
  onGenerate: () => void
  onDownload: (file: 'tokens.json' | 'design.md') => void
  onDownloadComponent: (component: ComponentDocId) => void
  onDownloadDocs: () => void
  onOverride: (path: string, value: string, note?: string) => void
  onClearOverride: (path: string) => void
  onDecide: (cardId: string, state: 'accepted' | 'open') => void
}

export function SystemPanel(props: SystemPanelProps): ReactNode {
  const { kit, tokens, review, scopeLabel, captureCount, generating, error, onGenerate } = props
  const [tab, setTab] = useState<Tab>('review')

  const cards = useMemo(() => {
    if (tokens === null) return []
    return decisionCards({
      tokens,
      conflicts: review?.conflicts ?? [],
      overriddenPaths: new Set((review?.overrides ?? []).map((entry) => entry.path)),
      rejectedPaths: new Set((review?.rejected ?? []).map((entry) => entry.path)),
      accepted: new Set(review?.accepted ?? []),
    })
  }, [tokens, review])

  const open = openCount(cards)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">System</h2>
        <Button size="sm" onClick={onGenerate} disabled={generating || captureCount === 0}>
          {generating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {kit === null ? 'Generate kit' : 'Regenerate'}
        </Button>
      </header>

      {error === null ? null : (
        <p className="border-b border-border px-4 py-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {tokens === null || kit === null ? (
        <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
          No kit for <span className="font-medium text-foreground">{scopeLabel}</span> yet.
          {captureCount === 0
            ? ' Import some captures first.'
            : ` Generate one from the ${captureCount} capture${captureCount === 1 ? '' : 's'} in this scope.`}
        </p>
      ) : (
        <>
          <nav className="flex shrink-0 gap-1 border-b border-border px-2 py-1.5" role="tablist" aria-label="System">
            <TabButton current={tab} value="review" onSelect={setTab} count={open}>
              Review
            </TabButton>
            <TabButton current={tab} value="tokens" onSelect={setTab}>
              Tokens
            </TabButton>
            <TabButton current={tab} value="export" onSelect={setTab}>
              Export
            </TabButton>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'review' ? <ReviewTab {...props} cards={cards} /> : null}
            {tab === 'tokens' ? <TokensTab {...props} tokens={tokens} /> : null}
            {tab === 'export' ? <ExportTab {...props} kit={kit} /> : null}
          </div>
        </>
      )}
    </div>
  )
}

function TabButton({
  current,
  value,
  onSelect,
  count,
  children,
}: {
  current: Tab
  value: Tab
  onSelect: (tab: Tab) => void
  count?: number
  children: ReactNode
}): ReactNode {
  const active = current === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
      {count !== undefined && count > 0 ? (
        <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
          {count}
        </span>
      ) : null}
    </button>
  )
}

/* ---------------------------------------------------------------- review -- */

function ReviewTab({
  cards,
  review,
  busy,
  onDecide,
  onOverride,
  onClearOverride,
}: SystemPanelProps & { cards: DecisionCard[] }): ReactNode {
  if (cards.length === 0) {
    return (
      <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
        Nothing to review. The engine had no diagnostics and no close calls on this set — every decision it made was
        clear-cut. You can still change any value from the <span className="text-foreground">Tokens</span> tab.
      </p>
    )
  }

  // The reason already standing at a card's path. A card that resolves a value
  // must not blank it: the reason is the reviewer's own writing and design.md
  // prints it, so a card writes one only where there is none to lose.
  const notes = new Map(
    (review?.overrides ?? []).filter((entry) => entry.note !== '').map((entry) => [entry.path, entry.note]),
  )

  return (
    <ul className="flex flex-col">
      {cards.map((card) => (
        <ReviewCard
          key={card.id}
          card={card}
          hasReason={card.path !== undefined && notes.has(card.path)}
          busy={busy}
          onDecide={onDecide}
          onOverride={onOverride}
          onClearOverride={onClearOverride}
        />
      ))}
    </ul>
  )
}

const SEVERITY_ICON = {
  conflict: TriangleAlert,
  warning: AlertTriangle,
  info: Info,
} as const

const SEVERITY_TONE = {
  conflict: 'text-destructive',
  warning: 'text-amber-600 dark:text-amber-500',
  info: 'text-muted-foreground',
} as const

function ReviewCard({
  card,
  hasReason,
  busy,
  onDecide,
  onOverride,
  onClearOverride,
}: {
  card: DecisionCard
  /** Whether this card's path already carries a reason the reviewer wrote. */
  hasReason: boolean
  busy: boolean
  onDecide: (cardId: string, state: 'accepted' | 'open') => void
  onOverride: (path: string, value: string, note?: string) => void
  onClearOverride: (path: string) => void
}): ReactNode {
  // Conflicts open by default: they are the one card whose whole purpose is to
  // be read, and a collapsed conflict is a conflict nobody sees.
  const [open, setOpen] = useState(card.severity === 'conflict')
  const [custom, setCustom] = useState('')
  const Icon = SEVERITY_ICON[card.severity]

  const settled = card.state !== 'open'

  return (
    <li
      className={`border-b border-border px-4 py-3 last:border-b-0 ${settled ? 'opacity-60' : ''}`}
      data-card-state={card.state}
    >
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 size-3.5 shrink-0 ${SEVERITY_TONE[card.severity]}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="w-full text-left"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span className="block text-xs font-medium">{card.title}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{card.detail}</span>
          </button>

          {open ? (
            <div className="mt-2 flex flex-col gap-2">
              {card.evidence.length === 0 ? null : (
                <ul className="flex flex-col gap-0.5 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                  {card.evidence.map((line) => (
                    <li key={line} className="truncate font-mono" title={line}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {card.state === 'open' ? (
                  <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => onDecide(card.id, 'accepted')}>
                    <Check aria-hidden />
                    Accept
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onDecide(card.id, 'open')}>
                    Reopen
                  </Button>
                )}

                {card.path === undefined
                  ? null
                  : card.options
                      .filter((option) => option.kind === 'clear' || card.editable)
                      .map((option) => (
                      <Button
                        key={option.label}
                        size="sm"
                        variant="ghost"
                        className="h-7 font-mono"
                        disabled={busy}
                        onClick={() =>
                          option.kind === 'clear'
                            ? onClearOverride(card.path as string)
                            : onOverride(
                                card.path as string,
                                option.value,
                                // Sending no reason leaves the standing one in
                                // place, which is what the Tokens editor does.
                                hasReason
                                  ? undefined
                                  : `chosen over the engine's pick from the ${card.kind === 'conflict' ? 'conflict' : 'close call'} on ${card.path}`,
                              )
                        }
                      >
                        {option.label}
                      </Button>
                    ))}

                {/* A conflict card offers this among its options already, and
                    offering it twice would read as two different actions. */}
                {card.state === 'overridden' && card.path !== undefined && card.kind !== 'conflict' ? (
                  <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => onClearOverride(card.path as string)}>
                    Revert to the engine
                  </Button>
                ) : null}
              </div>

              {card.path === undefined || !card.editable ? null : (
                <div className="flex gap-1.5">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={custom}
                    placeholder="or type a value"
                    aria-label={`Override ${card.path}`}
                    onChange={(event) => setCustom(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || custom.trim() === '') return
                      onOverride(card.path as string, custom.trim())
                      setCustom('')
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={busy || custom.trim() === ''}
                    onClick={() => {
                      onOverride(card.path as string, custom.trim())
                      setCustom('')
                    }}
                  >
                    Set
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {settled ? (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {card.state}
          </Badge>
        ) : null}
      </div>
    </li>
  )
}

/* ---------------------------------------------------------------- tokens -- */

function TokensTab({
  tokens,
  review,
  busy,
  onOverride,
  onClearOverride,
}: SystemPanelProps & { tokens: TokensDocument }): ReactNode {
  const slots = useMemo(() => tokenSlots(tokens), [tokens])
  const notes = new Map((review?.overrides ?? []).map((entry) => [entry.path, entry.note]))

  const grouped = new Map<OverrideGroup, TokenSlot[]>()
  for (const slot of slots) {
    const list = grouped.get(slot.group) ?? []
    list.push(slot)
    grouped.set(slot.group, list)
  }

  return (
    <div>
      {GROUP_ORDER.filter((group) => (grouped.get(group)?.length ?? 0) > 0).map((group) => (
        <section key={group} className="border-b border-border px-4 py-3 last:border-b-0">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {GROUP_LABEL[group]}
          </h3>
          <ul className="flex flex-col">
            {(grouped.get(group) ?? []).map((slot) => {
              const note = notes.get(slot.path)
              return (
                <TokenRow
                  key={slot.path}
                  slot={slot}
                  origin={originOf(slot)}
                  {...(note === undefined || note === '' ? {} : { note })}
                  busy={busy}
                  onOverride={onOverride}
                  onClear={onClearOverride}
                />
              )
            })}
          </ul>
        </section>
      ))}

      <section className="border-b border-border px-4 py-3 last:border-b-0">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Contrast · {tokens.color.contrast.length} pairs enforced
        </h3>
        <ul className="flex flex-col gap-1 text-[11px]">
          {tokens.color.contrast.map((pair) => (
            <li key={`${pair.foreground}-on-${pair.background}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {pair.foreground.replace('color.roles.', '')} on {pair.background.replace('color.roles.', '')}
              </span>
              <span className={`shrink-0 font-mono tabular-nums ${pair.passes ? '' : 'text-destructive'}`}>
                {pair.ratio.toFixed(2)}:1
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ---------------------------------------------------------------- export -- */

function ExportTab({
  kit,
  review,
  onDownload,
  onDownloadComponent,
  onDownloadDocs,
}: SystemPanelProps & { kit: KitSummary }): ReactNode {
  // Only the overrides the engine actually applied on this replay are in the
  // files. A stored row the engine refused -- a slot the regenerated kit no
  // longer has, a value that stopped parsing -- reaches no export, so counting
  // it here would promise a reader something none of these downloads contains.
  const refused = new Set((review?.rejected ?? []).map((entry) => entry.path))
  const carried = (review?.overrides ?? []).filter((entry) => !refused.has(entry.path)).length
  const dropped = (review?.overrides ?? []).filter((entry) => refused.has(entry.path))

  return (
    <div>
      <section className="border-b border-border px-4 py-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <Field label="Set" value={kit.setId} mono />
          <Field label="Version" value={`v${kit.version}`} />
          <Field label="Engine" value={kit.engineVersion} mono />
          <Field label="Captures" value={String(kit.captureIds.length)} />
          <Field label="Overrides" value={carried === 0 ? 'none' : String(carried)} />
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {carried === 0
            ? 'Every value in these files is distilled evidence.'
            : `Every file below carries your ${carried} override${carried === 1 ? '' : 's'}, and design.md names ${carried === 1 ? 'it' : 'them'} with your reason.`}
        </p>
        {dropped.length === 0 ? null : (
          <p className="mt-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
            {dropped.length === 1 ? 'One more override' : `${dropped.length} more overrides`} could not be applied to
            this kit and {dropped.length === 1 ? 'is' : 'are'} in none of these files:{' '}
            <span className="font-mono">{dropped.map((entry) => entry.path).join(', ')}</span>. The Review tab says why.
          </p>
        )}
      </section>

      <section className="border-b border-border px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          The whole kit
        </h3>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" onClick={() => onDownload('design.md')}>
            <Download aria-hidden />
            design.md
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDownload('tokens.json')}>
            <Download aria-hidden />
            tokens.json
          </Button>
          <Button size="sm" variant="outline" onClick={onDownloadDocs}>
            <FileCode aria-hidden />
            Docs site (single HTML file)
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          The docs site is the Docs tab, rendered to one self-contained file. It opens with no server and no network.
        </p>
      </section>

      <section className="border-b border-border px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          One component
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          {COMPONENT_DOC_IDS.map((id) => (
            <Button key={id} size="sm" variant="ghost" className="justify-start" onClick={() => onDownloadComponent(id)}>
              <Download aria-hidden />
              {id}.md
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Each one stands alone: the component&rsquo;s rules plus the token subset it needs, embedded. Hand one to an
          LLM without the library file.
        </p>
      </section>

      {/*
        The assistant's seam. Nothing in this build calls an LLM; the key is
        already stored server-side and the review queue this column produces is
        exactly what the assistant will be asked to reason about.
      */}
      <section className="px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assistant</h3>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Naming, gap-filling and merge suggestions arrive here next. Nothing in this build calls an LLM — the key is
          stored server-side and never returned to this browser.
        </p>
      </section>
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): ReactNode {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'truncate font-mono' : 'truncate'}>{value}</dd>
    </>
  )
}
