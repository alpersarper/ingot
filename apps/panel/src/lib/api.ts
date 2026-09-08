/**
 * The panel's one door to the server.
 *
 * Two things are centralised here on purpose. Every request carries the pairing
 * token, so no component can forget it; and every URL is relative, so the panel
 * does not know or care whether it is being served by the server (in the
 * container) or by Vite proxying to it (in development). The day the server
 * address becomes configurable for the extension, it becomes configurable here
 * and nowhere else.
 */
import type { OverrideConflict, RejectedOverride, TokensDocument } from '@ingot/engine'

const TOKEN_STORAGE_KEY = 'ingot.pairingToken'

/** The token the user pasted on the first-run screen, if they have. */
export function storedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    else window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // A browser with storage disabled still works for one session; the user
    // just pairs again next time.
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly details: readonly string[]

  constructor(status: number, message: string, details: readonly string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }

  /** True when the server says we are not paired, so the shell can send us back. */
  get isUnpaired(): boolean {
    return this.status === 401
  }
}

interface ErrorBody {
  error?: { message?: string; details?: string[] }
}

async function toError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody
  return new ApiError(
    response.status,
    body.error?.message ?? `the panel server answered ${response.status}`,
    body.error?.details ?? [],
  )
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = storedToken()
  if (token !== null) headers.set('x-ingot-token', token)
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const response = await fetch(path, { ...init, headers })
  if (!response.ok) throw await toError(response)
  return response
}

async function get<T>(path: string): Promise<T> {
  return (await send(path)).json() as Promise<T>
}

async function write<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', payload: unknown): Promise<T> {
  return (await send(path, { method, body: JSON.stringify(payload) })).json() as Promise<T>
}

export interface CaptureSummary {
  id: string
  componentType: string
  sourceUrl: string
  capturedAt: string
  tags: string[]
  hasScreenshot: boolean
}

export interface GroupSummary {
  id: string
  slug: string
  name: string
  description: string
  origin: 'import' | 'manual'
  captureCount: number
}

export interface KitSummary {
  id: string
  groupId: string | null
  /** What the kit distils. A deleted group's kit keeps `group`; only `library` kits are the library's. */
  scope: 'group' | 'library'
  version: number
  setId: string
  name: string
  engineVersion: string
  captureIds: string[]
  warningCount: number
  createdAt: string
}

/** One value a human replaced, as the server stores it. */
export interface StoredOverride {
  path: string
  value: string
  /** What the engine said when the override was made. Drives conflict reports. */
  baseValue: string
  note: string
  /**
   * Present when the reviewer accepted a value the assistant proposed.
   *
   * The decision is still theirs. This is where the candidate came from, which
   * is what lets the Tokens tab distinguish a value somebody typed from one
   * they were offered without implying the assistant decided anything.
   */
  suggestedBy?: 'assistant'
  createdAt: string
  updatedAt: string
}

/** The standing review state that produced the tokens in the same payload. */
export interface ReviewState {
  overrides: StoredOverride[]
  conflicts: OverrideConflict[]
  rejected: RejectedOverride[]
  /** Card ids the reviewer has accepted. */
  accepted: string[]
}

/**
 * A kit as the panel sees it: the stored kit, its *effective* tokens, and the
 * review state behind them. They are only ever true together, which is why
 * every write returns the whole thing rather than a patch.
 */
export interface KitPayload {
  kit: KitSummary
  tokens: TokensDocument
  designMd: string
  review: ReviewState
}

export interface PanelSettings {
  llm: {
    configured: boolean
    source: 'environment' | 'settings' | 'none'
    managedByEnvironment: boolean
    /** The model the assistant will ask. Not a secret; the panel shows it. */
    model: string
    modelManagedByEnvironment: boolean
  }
  engine: { name: string; version: string }
  storage: { adapter: string; schemaVersion: number }
  allowedOrigins: string[]
}

/* ------------------------------------------------------------- assistant -- */

/**
 * One thing the assistant proposed, as the server stores it.
 *
 * It is a suggestion and nothing more until somebody accepts it: the value is
 * not in the kit, it is in no export, and the only way it gets there is the
 * accept call below, which goes through the ordinary override write path.
 */
export interface AssistantProposal {
  id: string
  /** Which capability produced it: `derive`, `merge`. */
  capability: string
  promptVersion: string
  model: string
  path: string
  value: string
  /** The engine's own answer at that path when the proposal was checked. */
  baseValue: string
  title: string
  rationale: string
  /** What the engine said applying it would also do. Empty when it lands clean. */
  engineNotes: string[]
  status: 'open' | 'accepted' | 'dismissed'
  createdAt: string
  updatedAt: string
}

export interface AssistantStatus {
  configured: boolean
  source: 'environment' | 'settings' | 'none'
  managedByEnvironment: boolean
  model: string
  modelManagedByEnvironment: boolean
  /** The prompt template version behind every proposal in this build. */
  promptVersion: string
  rateLimit: { max: number; windowMs: number; remaining: number }
}

export interface AssistantState {
  assistant: AssistantStatus
  proposals: AssistantProposal[]
}

/** A citation the server resolved against the kit, so the panel shows evidence. */
export interface AssistantCitation {
  path: string
  value: string
  decision: string
}

export interface AssistantAnswer {
  answer: string
  citations: AssistantCitation[]
  /** Paths the answer cited that this kit does not have. Shown, not hidden. */
  unresolved: string[]
}

export interface AssistantNaming {
  kitName: string
  kitDescription: string
  roles: Array<{ path: string; name: string; rationale: string }>
}

export const api = {
  /** Open: answers before the panel holds a token. */
  async health(): Promise<{ status: string; engine: { name: string; version: string } }> {
    return get('/api/health')
  },

  /** Open: the only way to check a token without spending a real request. */
  async verifyPairing(token: string): Promise<boolean> {
    const response = await fetch('/api/pairing/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (response.status === 401) return false
    if (!response.ok) throw await toError(response)
    return true
  },

  async settings(): Promise<PanelSettings> {
    return (await get<{ settings: PanelSettings }>('/api/settings')).settings
  },

  async saveLlmKey(key: string | null): Promise<void> {
    await write('/api/settings', 'PUT', { llmApiKey: key })
  },

  /** The model the assistant asks. `null` takes the server's default back. */
  async saveLlmModel(model: string | null): Promise<void> {
    await write('/api/settings', 'PUT', { llmModel: model })
  },

  async captures(groupId?: string): Promise<CaptureSummary[]> {
    const query = groupId === undefined ? '' : `?groupId=${encodeURIComponent(groupId)}`
    return (await get<{ captures: CaptureSummary[] }>(`/api/captures${query}`)).captures
  },

  async groups(): Promise<GroupSummary[]> {
    return (await get<{ groups: GroupSummary[] }>('/api/groups')).groups
  },

  async importSet(set: unknown): Promise<{ group: GroupSummary; created: string[]; replaced: string[] }> {
    return write('/api/captures/import', 'POST', set)
  },

  async generateKit(groupId: string | null): Promise<KitPayload> {
    return write('/api/kits', 'POST', { groupId })
  },

  async latestKit(groupId: string | null): Promise<KitPayload | null> {
    const query = groupId === null ? '' : `?groupId=${encodeURIComponent(groupId)}`
    try {
      return await get<KitPayload>(`/api/kits/latest${query}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  },

  /**
   * Replace one token's value by hand.
   *
   * `baseValue` is deliberately not sent: the server reads the engine's own
   * answer from the kit, so the record of what was disagreed with cannot be a
   * stale number this browser happened to be holding.
   */
  async setOverride(groupId: string | null, path: string, value: string, note?: string): Promise<KitPayload> {
    return write('/api/reviews/overrides', 'PUT', { groupId, path, value, note })
  },

  async clearOverride(groupId: string | null, path: string): Promise<KitPayload> {
    const scope = groupId === null ? '' : `&groupId=${encodeURIComponent(groupId)}`
    return (await send(`/api/reviews/overrides?path=${encodeURIComponent(path)}${scope}`, {
      method: 'DELETE',
    })).json() as Promise<KitPayload>
  },

  async setDecision(groupId: string | null, cardId: string, state: 'accepted' | 'open'): Promise<KitPayload> {
    return write('/api/reviews/decisions', 'PUT', { groupId, cardId, state })
  },

  /**
   * The assistant's own state, plus this scope's proposals.
   *
   * Free and never rate-limited: it reaches no provider. The panel asks it on
   * load so it knows whether to render the assistant or its setup path, and a
   * setup screen that could itself be rate-limited would be the worst possible
   * first impression.
   */
  async assistant(groupId: string | null): Promise<AssistantState> {
    const query = groupId === null ? '' : `?groupId=${encodeURIComponent(groupId)}`
    return get(`/api/assistant${query}`)
  },

  /** Run a proposing capability. Returns the cards; changes no token. */
  async suggest(
    groupId: string | null,
    capability: 'derive' | 'merge',
  ): Promise<{ proposals: AssistantProposal[]; refusedCount: number; model: string }> {
    return write('/api/assistant/suggest', 'POST', { groupId, capability })
  },

  async ask(groupId: string | null, question: string): Promise<AssistantAnswer> {
    return write('/api/assistant/ask', 'POST', { groupId, question })
  },

  async nameKit(groupId: string | null): Promise<AssistantNaming> {
    return (await write<{ naming: AssistantNaming }>('/api/assistant/name', 'POST', { groupId })).naming
  },

  async draftRationale(groupId: string | null, path: string): Promise<string> {
    return (await write<{ reason: string }>('/api/assistant/rationale', 'POST', { groupId, path })).reason
  },

  /**
   * Accept one proposal.
   *
   * Answers with the whole effective kit, exactly as an override write does,
   * because it *is* an override write: the panel re-renders from one
   * authoritative answer rather than patching a local copy.
   */
  async acceptProposal(groupId: string | null, id: string): Promise<KitPayload & { proposal: AssistantProposal }> {
    return write(`/api/assistant/proposals/${encodeURIComponent(id)}/accept`, 'POST', { groupId })
  },

  async dismissProposal(groupId: string | null, id: string): Promise<{ proposal: AssistantProposal }> {
    return write(`/api/assistant/proposals/${encodeURIComponent(id)}/dismiss`, 'POST', { groupId })
  },

  /**
   * Download a kit file.
   *
   * It goes through `fetch` rather than a plain link because the pairing token
   * lives in a header, and a link cannot send one. The blob round-trip is the
   * price of not putting the token in a URL, where it would end up in history
   * and in logs.
   */
  async download(kitId: string, file: 'tokens.json' | 'design.md'): Promise<void> {
    const response = await send(`/api/kits/${encodeURIComponent(kitId)}/${file}`)
    saveBlob(await response.blob(), suggestedFilename(response, file))
  },

  /** One component's markdown, self-sufficient, straight from the engine. */
  async downloadComponent(kitId: string, component: string): Promise<void> {
    const response = await send(`/api/kits/${encodeURIComponent(kitId)}/components/${component}.md`)
    saveBlob(await response.blob(), suggestedFilename(response, `${component}.md`))
  },
}

/**
 * Hand a file to the browser.
 *
 * Downloads go through `fetch` and a blob rather than a plain link because the
 * pairing token lives in a header and a link cannot send one. The blob
 * round-trip is the price of not putting the token in a URL, where it would end
 * up in history and in logs. The static docs export uses the same path with a
 * blob the panel built itself.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Prefer the server's filename, which carries the set id and kit version. */
function suggestedFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? ''
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback
}
