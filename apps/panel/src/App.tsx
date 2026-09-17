/**
 * The workbench shell.
 *
 * Three columns, per the approved skeleton: collection on the left, the live
 * sample UI in the middle, the system on the right. The middle is the widest
 * on purpose -- the user's question is "will my app look good", and the answer
 * is the thing that should have the most room.
 *
 * All the server state lives here and is passed down, so the columns stay
 * presentational and the next task can slot a token editor into the right
 * column without unpicking any data flow.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { ComponentDocId } from '@ingot/engine'
import { Button } from './components/ui/button'
import { CollectionPanel } from './workbench/CollectionPanel'
import type { GroupTarget } from './workbench/CollectionPanel'
import { SIZING_GUIDANCE } from './workbench/selection'
import { SystemPanel } from './workbench/SystemPanel'
import { Topbar } from './workbench/Topbar'
import { FirstRun } from './workbench/FirstRun'
import { CanonicalPreview } from './preview/CanonicalPreview'
import type { PreviewView } from './preview/CanonicalPreview'
import type { PreviewTheme } from './preview/counterpart'
import { ApiError, api, saveBlob, storeToken, storedToken } from './lib/api'
import type {
  AssistantAnswer,
  AssistantNaming,
  AssistantState,
  CaptureSummary,
  GroupSummary,
  KitPayload,
  KitSummary,
  PanelSettings,
} from './lib/api'

type Phase = 'checking' | 'unpaired' | 'ready'

/**
 * The review scope a kit belongs to.
 *
 * Mirrors the server's `reviewScopeOf` (apps/server/src/kit.ts), which wins if
 * the two ever disagree: a group kit reviews under its group, a library or
 * selection kit under the library (`null`), and an orphaned group kit -- one
 * whose group was deleted -- has no review scope at all. `undefined` says
 * exactly that, rather than quietly filing its decisions under the library.
 */
function reviewScopeOfKit(kit: KitSummary): string | null | undefined {
  if (kit.scope !== 'group') return null
  return kit.groupId ?? undefined
}

export function App(): ReactNode {
  const [phase, setPhase] = useState<Phase>('checking')
  const [settings, setSettings] = useState<PanelSettings | null>(null)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  /**
   * Every capture id the library currently holds, whatever scope is open.
   *
   * The ids rather than a count, because the kit on screen may have been
   * distilled from evidence that has since been deleted, and saying so takes
   * comparing its own captureIds against what actually still exists -- the
   * whole pool, not the open scope's filtered list, which would report
   * deletions that never happened whenever a group is open.
   */
  const [libraryCaptureIds, setLibraryCaptureIds] = useState<ReadonlySet<string>>(new Set())
  const [captures, setCaptures] = useState<CaptureSummary[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  /**
   * The captures ticked in the left column.
   *
   * Held here rather than in the column because three other things act on it --
   * grouping, generating and deleting -- and because it has to be dropped when
   * the scope changes: a selection that survived a scope change would be a set
   * of ids the user can no longer see, acted on by a bar stating a number they
   * cannot check.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Kits per group, so a group delete can state what it would orphan. */
  const [kitsByGroup, setKitsByGroup] = useState<Record<string, number>>({})
  const [kit, setKit] = useState<KitPayload | null>(null)
  /**
   * The assistant's state and this scope's proposals.
   *
   * Null means the panel has not been able to ask -- an older server, or an
   * unreachable one -- and the tab renders its setup state, which is the right
   * thing to show somebody who has not got an assistant either way.
   */
  const [assistant, setAssistant] = useState<AssistantState | null>(null)

  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [kitError, setKitError] = useState<string | null>(null)
  /** True while a review write is in flight, so a double click cannot race. */
  const [reviewing, setReviewing] = useState(false)
  /** The same, for the curation writes the left column makes. */
  const [curating, setCurating] = useState(false)
  const [curationError, setCurationError] = useState<string | null>(null)
  const [view, setView] = useState<PreviewView>('preview')
  const [theme, setTheme] = useState<PreviewTheme>('kit')

  /** Any 401 means the token we hold is no longer the server's. Start over. */
  const handle = useCallback((error: unknown): string => {
    if (error instanceof ApiError && error.isUnpaired) {
      storeToken(null)
      setPhase('unpaired')
      return 'This panel is no longer paired.'
    }
    return error instanceof Error ? error.message : 'Something went wrong.'
  }, [])

  /**
   * Reload the assistant's state for a scope.
   *
   * Failures are swallowed on purpose: the assistant is advisory, and a panel
   * that could not render its captures because an assistant status call failed
   * would have the dependency exactly backwards. `stillWanted` is the same
   * cancellation discipline the scope-change effect applies to captures and
   * kit: a slow answer for a scope the user has since left must not land.
   */
  const refreshAssistant = useCallback(
    async (scope: string | null | undefined, stillWanted: () => boolean = () => true): Promise<void> => {
      if (scope === undefined) return
      const next = await api.assistant(scope).catch(() => null)
      if (stillWanted()) setAssistant(next)
    },
    [],
  )

  /**
   * The scope every review and assistant write is made against: the kit on
   * screen, never the browsing scope. A one-off generated from a selection can
   * sit on screen while a group is still open on the left, and its notice
   * promises that overrides made on it stand for the library -- so the write
   * has to land there, not under the group the user happens to be browsing.
   * Resetting the browsing scope to make the two agree would instead yank the
   * user out of the group they were looking at, which is its own small
   * dishonesty. Before a kit exists, the browsing scope is the only scope
   * there is.
   */
  const reviewScope = kit === null ? selectedGroupId : reviewScopeOfKit(kit.kit)

  /** A write with no scope to land in is refused loudly rather than misfiled. */
  function requireReviewScope(): string | null {
    if (reviewScope !== undefined) return reviewScope
    throw new Error("This kit's group was deleted, so it has no review scope for this decision to land in.")
  }

  /**
   * The library list: the count behind "Whole library", the groups, and how many
   * kits each group has -- which is what a group delete has to be able to state
   * before it happens.
   */
  const refreshLibrary = useCallback(async (): Promise<void> => {
    const [nextGroups, allCaptures, allKits] = await Promise.all([api.groups(), api.captures(), api.kits()])
    setGroups(nextGroups)
    setLibraryCaptureIds(new Set(allCaptures.map((capture) => capture.id)))
    const counts: Record<string, number> = {}
    for (const kit of allKits) {
      if (kit.groupId !== null) counts[kit.groupId] = (counts[kit.groupId] ?? 0) + 1
    }
    setKitsByGroup(counts)
  }, [])

  useEffect(() => {
    if (storedToken() === null) {
      setPhase('unpaired')
      return
    }
    void (async () => {
      try {
        setSettings(await api.settings())
        await refreshLibrary()
        setPhase('ready')
      } catch (error) {
        if (error instanceof ApiError && error.isUnpaired) {
          storeToken(null)
          setPhase('unpaired')
        } else {
          // The server is unreachable rather than unpaired. Showing the shell
          // and letting the next action report the failure beats a dead end.
          setPhase('ready')
        }
      }
    })()
  }, [refreshLibrary])

  // Whenever the scope changes, load what is in it and whichever kit it already
  // has, so switching groups shows that group's system rather than a stale one.
  useEffect(() => {
    if (phase !== 'ready') return
    // A selection is about captures on screen. Leaving the scope takes them off
    // it, so the selection goes with them rather than quietly acting on rows
    // the user can no longer see.
    setSelectedIds([])
    // The cancelled flag keeps a slow response for a previous scope from
    // landing on top of the one the user has since switched to.
    let cancelled = false
    void (async () => {
      try {
        const nextCaptures = await api.captures(selectedGroupId ?? undefined)
        const nextKit = await api.latestKit(selectedGroupId)
        if (cancelled) return
        setCaptures(nextCaptures)
        setKit(nextKit)
        setKitError(null)
        if (!cancelled) await refreshAssistant(selectedGroupId, () => !cancelled)
      } catch (error) {
        if (!cancelled) setKitError(handle(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, selectedGroupId, handle, refreshAssistant])

  async function onPaired(): Promise<void> {
    setSettings(await api.settings().catch(() => null))
    await refreshLibrary().catch(() => undefined)
    setPhase('ready')
  }

  async function onImport(set: unknown): Promise<void> {
    setImporting(true)
    setImportError(null)
    try {
      const result = await api.importSet(set)
      await refreshLibrary()
      // Land the user in what they just imported: it is what they came to look at.
      setSelectedGroupId(result.group.id)
      setCaptures(await api.captures(result.group.id))
      setKit(await api.latestKit(result.group.id))
    } catch (error) {
      const message = handle(error)
      const details = error instanceof ApiError && error.details.length > 0 ? ` (${error.details[0]})` : ''
      setImportError(`${message}${details}`)
    } finally {
      setImporting(false)
    }
  }

  /**
   * Regenerate whatever is on screen.
   *
   * A selection kit regenerates from its *own* ids rather than from the scope
   * it lives in: the button under a one-off has to mean "run this again", and
   * quietly distilling the whole library instead would replace what the user is
   * looking at with a different kit under the same click. Changing the ticks
   * and pressing "Generate from selection" is the other path, and it is
   * deliberately a different button.
   */
  async function onGenerate(): Promise<void> {
    const showing = kit?.kit
    await runGeneration(
      showing !== undefined && showing.scope === 'selection'
        ? () => api.generateKitFromSelection(showing.captureIds)
        : () => api.generateKit(selectedGroupId),
    )
  }

  async function onGenerateFromSelection(): Promise<void> {
    await runGeneration(() => api.generateKitFromSelection(selectedIds))
  }

  async function runGeneration(run: () => Promise<KitPayload>): Promise<void> {
    setGenerating(true)
    setKitError(null)
    try {
      const payload = await run()
      setKit(payload)
      await refreshLibrary()
      // The kit that just landed decides which scope the assistant tab is
      // about: a one-off's proposals are the library's, whatever group is
      // open on the left.
      await refreshAssistant(reviewScopeOfKit(payload.kit))
    } catch (error) {
      setKitError(handle(error))
    } finally {
      setGenerating(false)
    }
  }

  /**
   * One curation write, then a reload of what it changed.
   *
   * Every one of these moves rows the three columns are drawn from, so they all
   * end the same way: ask the server again rather than patch a local copy. The
   * panel is never the authority on what the library contains. The action
   * answers with the scope it left the panel in: when it moved the selection,
   * the scope-change effect owns the reload, and re-reading the old scope here
   * would race it -- whichever response landed last would win. The reload runs
   * on failure too, because a half-finished action has already changed the
   * library, and the ticked ids are pruned to the rows that still exist for
   * the same reason: the column reports what actually survived.
   */
  async function runCuration(action: () => Promise<string | null>): Promise<void> {
    setCurating(true)
    setCurationError(null)
    let scope = selectedGroupId
    let failed = false
    try {
      scope = await action()
    } catch (error) {
      failed = true
      setCurationError(handle(error))
    }
    try {
      await refreshLibrary()
      if (scope === selectedGroupId) {
        const survivors = await api.captures(scope ?? undefined)
        setCaptures(survivors)
        setSelectedIds((current) => current.filter((id) => survivors.some((capture) => capture.id === id)))
      }
    } catch (error) {
      if (!failed) setCurationError(handle(error))
    } finally {
      setCurating(false)
    }
  }

  function onToggleCapture(captureId: string): void {
    setSelectedIds((current) =>
      current.includes(captureId) ? current.filter((id) => id !== captureId) : [...current, captureId],
    )
  }

  /**
   * Put the selection in a group -- a new one, or one that exists.
   *
   * Groups are not exclusive, so this adds rather than moves: a capture that is
   * already in another group stays in it. The server skips ids the group
   * already holds, which is what makes pressing this twice harmless.
   */
  async function onGroupSelection(target: GroupTarget): Promise<void> {
    const ids = selectedIds
    await runCuration(async () => {
      const groupId =
        target.kind === 'existing' ? target.groupId : (await api.createGroup(target.slug, target.name)).id
      await api.addToGroup(groupId, ids)
      // Land in what was just curated: it is the thing the user made.
      setSelectedGroupId(groupId)
      return groupId
    })
  }

  /**
   * Delete captures, one request each.
   *
   * There is no bulk endpoint on purpose: `DELETE /api/captures/:id` is the
   * contract the extension is being built against, and a second way to remove a
   * capture would be a second place for the screenshot cleanup to be forgotten.
   * A partial failure stops at the first bad request and says so -- and the
   * lists are re-read either way, because the deletes before it have already
   * landed: the column has to report what survived, not what it remembered.
   */
  async function onDeleteCaptures(captureIds: readonly string[]): Promise<void> {
    await runCuration(async () => {
      for (const id of captureIds) await api.deleteCapture(id)
      // The kit on screen stays exactly as it is. A kit is a snapshot of the
      // evidence at the moment it was distilled and kit history is append-only,
      // so it legitimately outlives the captures that fed it -- and re-reading
      // the browsing scope's latest to decide what to display is how a one-off
      // silently vanished, swapped for that scope's kit or for the empty state
      // when it had none. Deleted contributing captures are stated instead: the
      // System panel notes them, from the kit's own ids against the library's.
      return selectedGroupId
    })
  }

  async function onRenameGroup(groupId: string, name: string): Promise<void> {
    await runCuration(async () => {
      await api.renameGroup(groupId, name)
      return selectedGroupId
    })
  }

  async function onDeleteGroup(groupId: string): Promise<void> {
    await runCuration(async () => {
      await api.deleteGroup(groupId)
      if (selectedGroupId !== groupId) return selectedGroupId
      // The scope the user was in no longer exists; the library always does.
      setSelectedGroupId(null)
      return null
    })
  }

  /** The only path that destroys a kit. The dialog in front of it says so. */
  async function onReset(): Promise<void> {
    await runCuration(async () => {
      await api.resetLibrary()
      setSelectedIds([])
      setKit(null)
      setAssistant(null)
      setSelectedGroupId(null)
      setCaptures([])
      return null
    })
  }

  async function onDownload(file: 'tokens.json' | 'design.md'): Promise<void> {
    if (kit === null) return
    try {
      await api.download(kit.kit.id, file)
    } catch (error) {
      setKitError(handle(error))
    }
  }

  async function onDownloadComponent(component: ComponentDocId): Promise<void> {
    if (kit === null) return
    try {
      await api.downloadComponent(kit.kit.id, component)
    } catch (error) {
      setKitError(handle(error))
    }
  }

  /**
   * The static docs site is built here rather than fetched.
   *
   * It is the docs view rendered to a string by the same components that draw
   * it on screen, so there is one renderer and the file cannot drift from the
   * panel. The kit's own mode is what ships: the counterpart theme is a way to
   * look at the palette, not a second kit.
   */
  async function onDownloadDocs(): Promise<void> {
    if (kit === null) return
    try {
      // Loaded on demand: the renderer it pulls in is a third of the panel's
      // bundle and is only needed the moment somebody asks for the file.
      const { docsHtmlFilename, renderDocsHtml } = await import('./export/docs-html')
      const html = renderDocsHtml(kit.tokens)
      saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), docsHtmlFilename(kit.kit.setId, kit.kit.version))
    } catch (error) {
      setKitError(handle(error))
    }
  }

  /**
   * Every review write answers with the whole effective kit, so the panel
   * replaces its copy rather than patching one -- the preview, the docs and the
   * export list all follow from one authoritative answer.
   */
  async function runReview(action: () => Promise<KitPayload>): Promise<void> {
    setReviewing(true)
    setKitError(null)
    try {
      setKit(await action())
    } catch (error) {
      setKitError(handle(error))
    } finally {
      setReviewing(false)
    }
  }

  /**
   * Run one assistant capability and pick up the cards it produced.
   *
   * The proposals land in the Review queue, so the state that has to move is
   * the assistant's rather than the kit's: nothing about the kit has changed,
   * because a suggestion is not a value.
   */
  async function onSuggest(capability: 'derive' | 'merge'): Promise<void> {
    const scope = requireReviewScope()
    await api.suggest(scope, capability)
    await refreshAssistant(scope)
  }

  /**
   * Accept one proposal.
   *
   * It answers with the whole effective kit, exactly as an override write does
   * -- because it is one -- so the preview, the docs and every export turn from
   * one authoritative answer. The assistant's own state is reloaded after, so
   * the card settles.
   */
  async function onAcceptProposal(id: string): Promise<void> {
    await runReview(async () => {
      const scope = requireReviewScope()
      const result = await api.acceptProposal(scope, id)
      await refreshAssistant(scope)
      return result
    })
  }

  async function onDismissProposal(id: string): Promise<void> {
    setReviewing(true)
    try {
      const scope = requireReviewScope()
      await api.dismissProposal(scope, id)
      await refreshAssistant(scope)
    } catch (error) {
      setKitError(handle(error))
    } finally {
      setReviewing(false)
    }
  }

  function onUnpair(): void {
    storeToken(null)
    setKit(null)
    setCaptures([])
    setGroups([])
    setAssistant(null)
    setPhase('unpaired')
  }

  if (phase === 'checking') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    )
  }

  if (phase === 'unpaired') return <FirstRun onPaired={() => void onPaired()} />

  const scopeLabel = selectedGroupId === null ? 'the whole library' : (groupName(groups, selectedGroupId) ?? 'this group')

  // How many of the on-screen kit's contributing captures no longer exist.
  // Judged against the whole library, never the open scope's filtered list.
  const deletedCaptureCount =
    kit === null ? 0 : kit.kit.captureIds.filter((id) => !libraryCaptureIds.has(id)).length

  return (
    <div className="flex h-full flex-col">
      <Topbar
        settings={settings}
        onSaveLlmKey={async (key) => {
          try {
            await api.saveLlmKey(key)
            setSettings(await api.settings())
            await refreshAssistant(reviewScope)
          } catch (error) {
            // handle() routes a 401 back to pairing; the message goes to the
            // topbar so the failure is visible where the user typed the key.
            throw new Error(handle(error))
          }
        }}
        onUnpair={onUnpair}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <aside className="hidden min-h-0 border-r border-border lg:block" aria-label="Collection">
          <CollectionPanel
            groups={groups}
            captures={captures}
            selectedGroupId={selectedGroupId}
            libraryCaptureCount={libraryCaptureIds.size}
            kitsByGroup={kitsByGroup}
            importing={importing}
            importError={importError}
            busy={curating}
            generating={generating}
            error={curationError}
            onDismissError={() => setCurationError(null)}
            selectedIds={selectedIds}
            onSelectGroup={setSelectedGroupId}
            onImport={(set) => void onImport(set)}
            onDismissImportError={() => setImportError(null)}
            onToggleCapture={onToggleCapture}
            onSelectAll={() => setSelectedIds(captures.map((capture) => capture.id))}
            onClearSelection={() => setSelectedIds([])}
            onGroupSelection={(target) => void onGroupSelection(target)}
            onGenerateFromSelection={() => void onGenerateFromSelection()}
            onDeleteCaptures={(ids) => void onDeleteCaptures(ids)}
            onRenameGroup={(groupId, name) => void onRenameGroup(groupId, name)}
            onDeleteGroup={(groupId) => void onDeleteGroup(groupId)}
            onReset={() => void onReset()}
          />
        </aside>

        <section className="min-h-0 overflow-hidden" aria-label="Live preview">
          {kit === null ? (
            <EmptyPreview
              scopeLabel={scopeLabel}
              captureCount={captures.length}
              selectedCount={selectedIds.length}
              generating={generating}
              onGenerate={() => void onGenerate()}
              onGenerateFromSelection={() => void onGenerateFromSelection()}
            />
          ) : (
            <CanonicalPreview
              tokens={kit.tokens}
              view={view}
              onChangeView={setView}
              theme={theme}
              onChangeTheme={setTheme}
            />
          )}
        </section>

        <aside className="hidden min-h-0 border-l border-border lg:block" aria-label="System">
          <SystemPanel
            kit={kit?.kit ?? null}
            tokens={kit?.tokens ?? null}
            review={kit?.review ?? null}
            scopeLabel={scopeLabel}
            captureCount={captures.length}
            deletedCaptureCount={deletedCaptureCount}
            generating={generating}
            busy={reviewing}
            error={kitError}
            onGenerate={() => void onGenerate()}
            onDownload={(file) => void onDownload(file)}
            onDownloadComponent={(component) => void onDownloadComponent(component)}
            onDownloadDocs={() => void onDownloadDocs()}
            onOverride={(path, value, note) =>
              void runReview(() => api.setOverride(requireReviewScope(), path, value, note))
            }
            onClearOverride={(path) => void runReview(() => api.clearOverride(requireReviewScope(), path))}
            onDecide={(cardId, state) => void runReview(() => api.setDecision(requireReviewScope(), cardId, state))}
            assistant={assistant}
            onSuggest={onSuggest}
            onAcceptProposal={(id) => void onAcceptProposal(id)}
            onDismissProposal={(id) => void onDismissProposal(id)}
            onAsk={async (question: string): Promise<AssistantAnswer> => api.ask(requireReviewScope(), question)}
            onName={async (): Promise<AssistantNaming> => api.nameKit(requireReviewScope())}
            onDraftReason={async (path: string): Promise<string> => api.draftRationale(requireReviewScope(), path)}
            onSaveLlmKey={async (key) => {
              await api.saveLlmKey(key)
              setSettings(await api.settings().catch(() => null))
              await refreshAssistant(reviewScope)
            }}
            onSaveLlmModel={async (model) => {
              await api.saveLlmModel(model)
              setSettings(await api.settings().catch(() => null))
              await refreshAssistant(reviewScope)
            }}
          />
        </aside>
      </main>
    </div>
  )
}

/**
 * The middle column before a kit exists.
 *
 * It carries the generate button itself, which is the whole point: an empty
 * state that tells somebody to press a control in another column is an
 * instruction they have to go and find, and the one place they are already
 * looking is the empty space where the answer should be. The right column keeps
 * its own button -- that one is for regenerating, and it belongs next to the
 * system it regenerates.
 */
function EmptyPreview({
  scopeLabel,
  captureCount,
  selectedCount,
  generating,
  onGenerate,
  onGenerateFromSelection,
}: {
  scopeLabel: string
  captureCount: number
  selectedCount: number
  generating: boolean
  onGenerate: () => void
  onGenerateFromSelection: () => void
}): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-sm text-center">
        <h2 className="text-sm font-semibold">Nothing to preview yet</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {captureCount === 0
            ? 'Import a capture set on the left, generate a kit, and the system will be drawn here.'
            : `Distil ${scopeLabel} and this is where the result is rendered -- buttons, a card, inputs and the type scale, drawn entirely from its tokens.`}
        </p>
        {captureCount === 0 ? null : (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onGenerate} disabled={generating}>
              {generating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
              Generate kit
            </Button>
            {selectedCount === 0 ? null : (
              <Button variant="outline" onClick={onGenerateFromSelection} disabled={generating}>
                Generate from {selectedCount} selected
              </Button>
            )}
          </div>
        )}
        {/* Once the selection bar is on screen it carries this line, and the
            guidance is worth exactly one line anywhere. */}
        {captureCount === 0 || selectedCount > 0 ? null : (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{SIZING_GUIDANCE}</p>
        )}
      </div>
    </div>
  )
}

function groupName(groups: GroupSummary[], id: string): string | undefined {
  return groups.find((group) => group.id === id)?.name
}
