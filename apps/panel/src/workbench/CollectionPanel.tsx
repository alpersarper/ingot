/**
 * Left column: the collection, and the curation that happens in it.
 *
 * The library is the type-agnostic pool every capture lands in. Groups are
 * named curations *within* it and are deliberately **not exclusive**: a capture
 * can be in several, because the whole job of this product is deciding which
 * captures belong together, and a capture that can only ever be in one place
 * makes that decision unrepeatable.
 *
 * So this column has three layers, in the order the work happens.
 *
 * 1. **Collect.** Import brings a set in. (The browser extension will post to
 *    the same capture endpoint; nothing here assumes the import path.)
 * 2. **Curate.** Tick captures, then either name the selection as a group or
 *    hand it straight to the engine. Selection is the primary verb of the
 *    column: everything the bar offers acts on exactly what is ticked.
 * 3. **Scope.** Groups are first-class objects here -- open, rename, delete --
 *    and the selected scope shows its own name and description, so an imported
 *    set's "Ghost-like warm editorial UI" has somewhere to live and be read.
 *
 * Destruction is confirmed and named, never implied: see `ConfirmDialog`.
 */
import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  FileJson,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from './ConfirmDialog'
import { SIZING_GUIDANCE, groupSlug, typeMix } from './selection'
import { RESET_CONFIRMATION } from '@/lib/api'
import type { CaptureSummary, GroupSummary } from '@/lib/api'

/** Where a "Group selection" click sends the ticked captures. */
export type GroupTarget = { kind: 'new'; name: string; slug: string } | { kind: 'existing'; groupId: string }

export interface CollectionPanelProps {
  groups: GroupSummary[]
  captures: CaptureSummary[]
  selectedGroupId: string | null
  libraryCaptureCount: number
  /** Kits per group id, for stating what a group delete would orphan. */
  kitsByGroup: Record<string, number>
  importing: boolean
  importError: string | null
  /** True while a curation write (group, delete, reset) is in flight. */
  busy: boolean
  generating: boolean
  /** Whatever the last curation action failed with. Shown, never swallowed. */
  error: string | null
  onDismissError: () => void
  selectedIds: readonly string[]
  onSelectGroup: (groupId: string | null) => void
  onImport: (set: unknown) => void
  onDismissImportError: () => void
  onToggleCapture: (captureId: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onGroupSelection: (target: GroupTarget) => void
  onGenerateFromSelection: () => void
  onDeleteCaptures: (captureIds: readonly string[]) => void
  onRenameGroup: (groupId: string, name: string) => void
  onDeleteGroup: (groupId: string) => void
  onReset: () => void
}

export function CollectionPanel(props: CollectionPanelProps): ReactNode {
  const {
    groups,
    captures,
    selectedGroupId,
    libraryCaptureCount,
    importing,
    importError,
    busy,
    error,
    onDismissError,
    selectedIds,
    onSelectGroup,
    onImport,
    onDismissImportError,
    onToggleCapture,
    onSelectAll,
    onClearSelection,
    onDeleteCaptures,
    onReset,
  } = props

  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Which destructive question is on screen, if any. One at a time. */
  const [confirming, setConfirming] = useState<Confirming>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const chosen = useMemo(() => captures.filter((capture) => selected.has(capture.id)), [captures, selected])
  const scope = selectedGroupId === null ? null : groups.find((group) => group.id === selectedGroupId)

  /** Carry out the question the dialog asked. One place, so the dialog's
   * confirm button cannot drift from what the confirm text promised. */
  function act(target: Exclude<Confirming, null>): void {
    if (target.kind === 'captures') onDeleteCaptures(target.ids)
    else if (target.kind === 'group') props.onDeleteGroup(target.group.id)
    else onReset()
  }

  function submit(raw: string): void {
    setParseError(null)
    onDismissImportError()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      setParseError('That is not valid JSON.')
      return
    }
    onImport(parsed)
    setPasted('')
    setPasting(false)
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    submit(await file.text())
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Collection</h2>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} disabled={importing}>
            <Upload aria-hidden />
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void onFile(event)}
            data-testid="import-file"
          />
          <div className="relative">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Collection menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal aria-hidden />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-background p-1 shadow-md">
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirming({ kind: 'reset' })
                  }}
                >
                  Start over...
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {error === null ? null : (
        <div className="flex items-start gap-2 border-b border-border px-4 py-2.5" role="alert">
          <p className="min-w-0 flex-1 text-xs text-destructive">{error}</p>
          <button type="button" onClick={onDismissError} aria-label="Dismiss error" className="text-muted-foreground">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <div className="border-b border-border px-4 py-3">
        {pasting ? (
          <div className="flex flex-col gap-2">
            <Textarea
              rows={6}
              value={pasted}
              autoFocus
              spellCheck={false}
              placeholder='{"schemaVersion": 1, "id": "ghost-warm", ...}'
              onChange={(event) => setPasted(event.target.value)}
              aria-label="Capture set JSON"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => submit(pasted)} disabled={importing || pasted.trim() === ''}>
                {importing ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Import set
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setPasting(true)}>
            <FileJson aria-hidden />
            Paste a capture set
          </Button>
        )}
        {parseError === null ? null : <p className="mt-2 text-xs text-destructive">{parseError}</p>}
        {importError === null ? null : <p className="mt-2 text-xs text-destructive">{importError}</p>}
      </div>

      <nav className="border-b border-border px-2 py-2" aria-label="Groups">
        <ScopeButton
          label="Whole library"
          count={libraryCaptureCount}
          icon={<Layers aria-hidden />}
          selected={selectedGroupId === null}
          onClick={() => onSelectGroup(null)}
        />
        {groups.length === 0 ? null : (
          <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Groups
          </p>
        )}
        {groups.map((group) => (
          <GroupRow
            key={group.id}
            group={group}
            selected={selectedGroupId === group.id}
            busy={busy}
            onOpen={() => onSelectGroup(group.id)}
            onRename={(name) => props.onRenameGroup(group.id, name)}
            onDelete={() => setConfirming({ kind: 'group', group })}
          />
        ))}
      </nav>

      {scope === undefined || scope === null ? null : (
        <div className="border-b border-border px-4 py-2.5">
          <p className="text-xs font-medium">{scope.name}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{scope.description}</p>
        </div>
      )}

      {captures.length === 0 ? null : (
        <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
          <span className="text-[11px] text-muted-foreground">
            {captures.length} capture{captures.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={selectedIds.length === captures.length ? onClearSelection : onSelectAll}
          >
            {selectedIds.length === captures.length ? 'Clear selection' : 'Select all'}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {captures.length === 0 ? (
          <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
            Nothing captured yet. Import a set -- <code className="font-mono">fixtures/ghost-warm/set.json</code> in
            this repository is a good first one.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {captures.map((capture) => (
              <CaptureRow
                key={capture.id}
                capture={capture}
                selected={selected.has(capture.id)}
                busy={busy}
                onToggle={() => onToggleCapture(capture.id)}
                onDelete={() => setConfirming({ kind: 'captures', ids: [capture.id] })}
              />
            ))}
          </ul>
        )}
      </div>

      {selectedIds.length === 0 ? null : (
        <SelectionBar
          {...props}
          chosen={chosen}
          onDeleteSelection={() => setConfirming({ kind: 'captures', ids: selectedIds })}
        />
      )}

      {confirming === null ? null : (
        <ConfirmDialog
          {...dialogFor(confirming, props.kitsByGroup)}
          busy={busy}
          // The question has been answered, so it stops being asked. What the
          // answer did is reported by the column itself -- the lists it changed,
          // or the error banner above them -- rather than by a dialog hanging
          // over a library it has already emptied.
          onConfirm={() => {
            act(confirming)
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}

type Confirming =
  | null
  | { kind: 'captures'; ids: readonly string[] }
  | { kind: 'group'; group: GroupSummary }
  | { kind: 'reset' }

/**
 * What each confirmation says.
 *
 * One function rather than three dialogs, because the thing that must not drift
 * is the *shape* of the promise: every one of these names what goes **and what
 * stays**. `RESET_CONFIRMATION` is imported rather than spelled, so the word the
 * user types is the word the endpoint checks.
 */
function dialogFor(
  confirming: Exclude<Confirming, null>,
  kitsByGroup: Record<string, number>,
): { title: string; children: ReactNode; confirmLabel: string; typeToConfirm?: string } {
  if (confirming.kind === 'captures') {
    const { ids } = confirming
    const one = ids.length === 1
    return {
      title: one ? 'Delete this capture?' : `Delete ${ids.length} captures?`,
      confirmLabel: one ? 'Delete capture' : `Delete ${ids.length} captures`,
      children: (
        <>
          <p>
            {one ? 'It' : 'They'} will be removed from the library and from every group{' '}
            {one ? 'it belongs' : 'they belong'} to, along with{' '}
            {one ? 'its screenshot' : 'their screenshots'}. This cannot be undone.
          </p>
          <p>
            Kits you have already generated keep the evidence they were distilled from, so nothing you have exported
            changes. The next kit you generate will not see {one ? 'this capture' : 'these captures'}.
          </p>
        </>
      ),
    }
  }

  if (confirming.kind === 'group') {
    const { group } = confirming
    const kits = kitsByGroup[group.id] ?? 0
    return {
      title: `Delete the group "${group.name}"?`,
      confirmLabel: 'Delete group',
      children: (
        <>
          <p>
            The group goes. Its {group.captureCount} capture{group.captureCount === 1 ? '' : 's'} stay in the library
            -- a group is a curation, not a container.
          </p>
          <p>
            {kits === 0
              ? 'No kit has been generated from it, so there is nothing to keep.'
              : `Its ${kits} kit${kits === 1 ? '' : 's'} ${kits === 1 ? 'is' : 'are'} kept too, as one-off${
                  kits === 1 ? '' : 's'
                } with no group: kit history is append-only, so a document you exported never loses the record of what produced it.`}
          </p>
          <p>
            Overrides you made while reviewing this group are kept against its id. Re-importing the same set makes a new
            group, which will not pick them up.
          </p>
        </>
      ),
    }
  }

  return {
    title: 'Start over?',
    confirmLabel: 'Destroy this library',
    typeToConfirm: RESET_CONFIRMATION,
    children: (
      <>
        <p>
          This destroys <span className="font-medium text-foreground">everything in this library</span>: every capture
          and screenshot, every group, every kit and every version of one, and every override, decision and assistant
          proposal you have made.
        </p>
        <p>
          It is the only action in Ingot that deletes a kit -- everywhere else kit history is append-only -- so there is
          no version to go back to afterwards.
        </p>
        <p>
          Your pairing stays, and so does your API key: you will not have to pair again.
        </p>
      </>
    ),
  }
}

/* ------------------------------------------------------------- selection -- */

/**
 * The selection bar: what is ticked, what it is made of, and what can be done
 * with it.
 *
 * The type mix is the part that earns its space. "6 selected" says nothing
 * about whether a kit distilled from it will be any good; "4 buttons - 1 card -
 * 1 input" says the evidence is a mix, which is what the engine needs and what
 * the one line of guidance underneath is about.
 */
function SelectionBar({
  chosen,
  groups,
  busy,
  generating,
  selectedIds,
  onClearSelection,
  onGroupSelection,
  onGenerateFromSelection,
  onDeleteSelection,
}: CollectionPanelProps & { chosen: CaptureSummary[]; onDeleteSelection: () => void }): ReactNode {
  const [grouping, setGrouping] = useState(false)
  const [name, setName] = useState('')
  const [existing, setExisting] = useState('')

  const count = selectedIds.length

  function group(target: GroupTarget): void {
    onGroupSelection(target)
    setGrouping(false)
    setName('')
    setExisting('')
  }

  return (
    <section className="border-t border-border bg-muted/40 px-4 py-3" aria-label="Selection">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">
          {count} selected
        </p>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={onClearSelection}
        >
          Clear
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="type-mix">
        {typeMix(chosen)}
      </p>

      {grouping ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-background p-2.5">
          <label className="text-[11px] font-medium">
            New group
            <div className="mt-1 flex gap-1.5">
              <Input
                className="h-8 text-xs"
                value={name}
                autoFocus
                placeholder="Warm editorial"
                onChange={(event) => setName(event.target.value)}
                aria-label="New group name"
              />
              <Button
                size="sm"
                disabled={busy || name.trim() === ''}
                onClick={() => group({ kind: 'new', name: name.trim(), slug: groupSlug(name, groups) })}
              >
                Create
              </Button>
            </div>
          </label>

          {groups.length === 0 ? null : (
            <label className="text-[11px] font-medium">
              Existing group
              <div className="mt-1 flex gap-1.5">
                <select
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                  value={existing}
                  onChange={(event) => setExisting(event.target.value)}
                  aria-label="Add to an existing group"
                >
                  <option value="">Choose a group...</option>
                  {groups.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || existing === ''}
                  onClick={() => group({ kind: 'existing', groupId: existing })}
                >
                  Add
                </Button>
              </div>
            </label>
          )}

          <Button size="sm" variant="ghost" className="self-start" onClick={() => setGrouping(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setGrouping(true)} disabled={busy}>
            <FolderPlus aria-hidden />
            Group selection
          </Button>
          <Button size="sm" onClick={onGenerateFromSelection} disabled={busy || generating}>
            {generating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            Generate from selection
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={onDeleteSelection}
            disabled={busy}
            aria-label={`Delete ${count} selected capture${count === 1 ? '' : 's'}`}
          >
            <Trash2 aria-hidden />
            Delete
          </Button>
        </div>
      )}

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{SIZING_GUIDANCE}</p>
    </section>
  )
}

/* ------------------------------------------------------------------ rows -- */

function CaptureRow({
  capture,
  selected,
  busy,
  onToggle,
  onDelete,
}: {
  capture: CaptureSummary
  selected: boolean
  busy: boolean
  onToggle: () => void
  onDelete: () => void
}): ReactNode {
  return (
    <li className={cn('group px-4 py-2.5', selected && 'bg-accent/40')}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-3.5 shrink-0 accent-current"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${capture.id}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{capture.id}</span>
        <Badge variant="outline">{capture.componentType}</Badge>
        <button
          type="button"
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete ${capture.id}`}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 truncate pl-6 text-[11px] text-muted-foreground">{hostOf(capture.sourceUrl)}</p>
      {capture.tags.length === 0 ? null : (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
          {capture.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}
    </li>
  )
}

/**
 * One group, as an object rather than as a filter.
 *
 * Opening it is the row itself; renaming and deleting are on a menu beside it.
 * A group the user cannot rename is a group they will abandon and re-import,
 * which is how a library ends up with four versions of the same set.
 */
function GroupRow({
  group,
  selected,
  busy,
  onOpen,
  onRename,
  onDelete,
}: {
  group: GroupSummary
  selected: boolean
  busy: boolean
  onOpen: () => void
  onRename: (name: string) => void
  onDelete: () => void
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(group.name)

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Input
          className="h-7 text-xs"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          aria-label={`Rename ${group.name}`}
        />
        <Button
          size="sm"
          className="h-7"
          disabled={busy || draft.trim() === ''}
          onClick={() => {
            onRename(draft.trim())
            setRenaming(false)
          }}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => {
            setDraft(group.name)
            setRenaming(false)
          }}
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="relative flex items-center">
      <ScopeButton
        label={group.name}
        slug={group.slug}
        count={group.captureCount}
        icon={<FolderOpen aria-hidden />}
        selected={selected}
        onClick={onOpen}
      />
      <button
        type="button"
        className="absolute right-1 rounded p-1 text-muted-foreground hover:bg-background"
        aria-label={`Actions for ${group.name}`}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </button>
      {menuOpen ? (
        <div className="absolute right-1 top-7 z-20 w-36 rounded-md border border-border bg-background p-1 shadow-md">
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => {
              setMenuOpen(false)
              setRenaming(true)
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
          >
            Delete group...
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ScopeButton({
  label,
  slug,
  count,
  icon,
  selected,
  onClick,
}: {
  label: string
  slug?: string
  count: number
  icon: ReactNode
  selected: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
      )}
    >
      <span className="shrink-0 [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {slug === undefined ? null : <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{slug}</span>}
      </span>
      <span className="shrink-0 pr-5 tabular-nums text-[11px] text-muted-foreground">{count}</span>
    </button>
  )
}

/** Captures are from all over; the host is the part a user recognises. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
