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
import type { TokensDocument } from '@ingot/engine'

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

export interface KitPayload {
  kit: KitSummary
  tokens: TokensDocument
  designMd?: string
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
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestedFilename(response, file)
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  },
}

/** Prefer the server's filename, which carries the set id and kit version. */
function suggestedFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? ''
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback
}
