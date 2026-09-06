/**
 * Left column: the collection.
 *
 * Scope first, then what is in it. Choosing a scope is the only navigation the
 * workbench has -- everything else on screen (the preview, the system panel,
 * the downloads) is about whatever is selected here.
 *
 * The import control accepts a fixture set as a file or as pasted JSON, which
 * is how a library exists at all before the browser extension does.
 */
import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { FileJson, FolderOpen, Layers, Loader2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CaptureSummary, GroupSummary } from '@/lib/api'

export interface CollectionPanelProps {
  groups: GroupSummary[]
  captures: CaptureSummary[]
  selectedGroupId: string | null
  libraryCaptureCount: number
  importing: boolean
  importError: string | null
  onSelectGroup: (groupId: string | null) => void
  onImport: (set: unknown) => void
  onDismissImportError: () => void
}

export function CollectionPanel({
  groups,
  captures,
  selectedGroupId,
  libraryCaptureCount,
  importing,
  importError,
  onSelectGroup,
  onImport,
  onDismissImportError,
}: CollectionPanelProps): ReactNode {
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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
        </div>
      </header>

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
        {groups.map((group) => (
          <ScopeButton
            key={group.id}
            label={group.name}
            slug={group.slug}
            count={group.captureCount}
            icon={<FolderOpen aria-hidden />}
            selected={selectedGroupId === group.id}
            onClick={() => onSelectGroup(group.id)}
          />
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {captures.length === 0 ? (
          <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
            Nothing captured yet. Import a set -- <code className="font-mono">fixtures/ghost-warm/set.json</code> in
            this repository is a good first one.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {captures.map((capture) => (
              <li key={capture.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs">{capture.id}</span>
                  <Badge variant="outline">{capture.componentType}</Badge>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">{hostOf(capture.sourceUrl)}</p>
                {capture.tags.length === 0 ? null : (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {capture.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
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
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{count}</span>
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
