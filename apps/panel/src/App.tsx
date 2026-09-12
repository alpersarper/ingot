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
import { Loader2 } from 'lucide-react'
import type { ComponentDocId } from '@ingot/engine'
import { CollectionPanel } from './workbench/CollectionPanel'
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
  PanelSettings,
} from './lib/api'

type Phase = 'checking' | 'unpaired' | 'ready'

export function App(): ReactNode {
  const [phase, setPhase] = useState<Phase>('checking')
  const [settings, setSettings] = useState<PanelSettings | null>(null)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [captures, setCaptures] = useState<CaptureSummary[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
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
    async (groupId: string | null, stillWanted: () => boolean = () => true): Promise<void> => {
      const next = await api.assistant(groupId).catch(() => null)
      if (stillWanted()) setAssistant(next)
    },
    [],
  )

  /** The library list is the count behind "Whole library" and the fallback view. */
  const refreshLibrary = useCallback(async (): Promise<void> => {
    const [nextGroups, allCaptures] = await Promise.all([api.groups(), api.captures()])
    setGroups(nextGroups)
    setLibraryCount(allCaptures.length)
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

  async function onGenerate(): Promise<void> {
    setGenerating(true)
    setKitError(null)
    try {
      setKit(await api.generateKit(selectedGroupId))
    } catch (error) {
      setKitError(handle(error))
    } finally {
      setGenerating(false)
    }
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
    await api.suggest(selectedGroupId, capability)
    await refreshAssistant(selectedGroupId)
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
      const result = await api.acceptProposal(selectedGroupId, id)
      await refreshAssistant(selectedGroupId)
      return result
    })
  }

  async function onDismissProposal(id: string): Promise<void> {
    setReviewing(true)
    try {
      await api.dismissProposal(selectedGroupId, id)
      await refreshAssistant(selectedGroupId)
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

  return (
    <div className="flex h-full flex-col">
      <Topbar
        settings={settings}
        onSaveLlmKey={async (key) => {
          try {
            await api.saveLlmKey(key)
            setSettings(await api.settings())
            await refreshAssistant(selectedGroupId)
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
            libraryCaptureCount={libraryCount}
            importing={importing}
            importError={importError}
            onSelectGroup={setSelectedGroupId}
            onImport={(set) => void onImport(set)}
            onDismissImportError={() => setImportError(null)}
          />
        </aside>

        <section className="min-h-0 overflow-hidden" aria-label="Live preview">
          {kit === null ? (
            <EmptyPreview scopeLabel={scopeLabel} hasCaptures={captures.length > 0} />
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
            generating={generating}
            busy={reviewing}
            error={kitError}
            onGenerate={() => void onGenerate()}
            onDownload={(file) => void onDownload(file)}
            onDownloadComponent={(component) => void onDownloadComponent(component)}
            onDownloadDocs={() => void onDownloadDocs()}
            onOverride={(path, value, note) =>
              void runReview(() => api.setOverride(selectedGroupId, path, value, note))
            }
            onClearOverride={(path) => void runReview(() => api.clearOverride(selectedGroupId, path))}
            onDecide={(cardId, state) => void runReview(() => api.setDecision(selectedGroupId, cardId, state))}
            assistant={assistant}
            onSuggest={onSuggest}
            onAcceptProposal={(id) => void onAcceptProposal(id)}
            onDismissProposal={(id) => void onDismissProposal(id)}
            onAsk={(question: string): Promise<AssistantAnswer> => api.ask(selectedGroupId, question)}
            onName={(): Promise<AssistantNaming> => api.nameKit(selectedGroupId)}
            onDraftReason={(path: string): Promise<string> => api.draftRationale(selectedGroupId, path)}
            onSaveLlmKey={async (key) => {
              await api.saveLlmKey(key)
              setSettings(await api.settings().catch(() => null))
              await refreshAssistant(selectedGroupId)
            }}
            onSaveLlmModel={async (model) => {
              await api.saveLlmModel(model)
              setSettings(await api.settings().catch(() => null))
              await refreshAssistant(selectedGroupId)
            }}
          />
        </aside>
      </main>
    </div>
  )
}

function EmptyPreview({ scopeLabel, hasCaptures }: { scopeLabel: string; hasCaptures: boolean }): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-sm text-center">
        <h2 className="text-sm font-semibold">Nothing to preview yet</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {hasCaptures
            ? `Generate a kit for ${scopeLabel} and this is where it will be rendered -- buttons, a card, inputs and the type scale, drawn entirely from its tokens.`
            : 'Import a capture set on the left, generate a kit, and the system will be drawn here.'}
        </p>
      </div>
    </div>
  )
}

function groupName(groups: GroupSummary[], id: string): string | undefined {
  return groups.find((group) => group.id === id)?.name
}
