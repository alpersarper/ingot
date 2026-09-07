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
  llm: { configured: boolean; source: 'environment' | 'settings' | 'none'; managedByEnvironment: boolean }
  engine: { name: string; version: string }
  storage: { adapter: string; schemaVersion: number }
  allowedOrigins: string[]
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

  /** The overrides and accepted decisions for a scope, before any kit exists. */
  async review(groupId: string | null): Promise<{ overrides: StoredOverride[]; kitId: string | null }> {
    const query = groupId === null ? '' : `?groupId=${encodeURIComponent(groupId)}`
    return get(`/api/reviews${query}`)
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
