/**
 * Where the panel is and how we prove we may talk to it.
 *
 * Both live in `chrome.storage.local`, never `chrome.storage.sync`. That is
 * the difference between a pairing token that stays on this machine and one
 * that is copied to a Google account and back down onto every browser the user
 * is signed into. The token guards a local API; it has no business travelling.
 */
import { DEFAULT_SETTINGS } from './protocol'
import type { Settings } from './protocol'
import { normalisePanelUrl } from './transport'
import type { KeyValueStore } from './queue'

export const SETTINGS_KEY = 'ingot.settings'

/** `chrome.storage.local` behind the small interface the rest of the code uses. */
export function chromeLocalStore(): KeyValueStore {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
  }
}

export async function readSettings(store: KeyValueStore): Promise<Settings> {
  const raw = (await store.get([SETTINGS_KEY]))[SETTINGS_KEY]
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const candidate = raw as Partial<Settings>
  return {
    panelUrl:
      typeof candidate.panelUrl === 'string' && candidate.panelUrl.trim() !== ''
        ? normalisePanelUrl(candidate.panelUrl)
        : DEFAULT_SETTINGS.panelUrl,
    token: typeof candidate.token === 'string' ? candidate.token : DEFAULT_SETTINGS.token,
  }
}

export async function writeSettings(store: KeyValueStore, settings: Settings): Promise<void> {
  await store.set({
    [SETTINGS_KEY]: { panelUrl: normalisePanelUrl(settings.panelUrl), token: settings.token.trim() },
  })
}

/**
 * The match pattern that grants access to one panel address.
 *
 * The default address is in `host_permissions`; anything else the user types is
 * requested at the moment they save it, which is what keeps the permission set
 * as small as the configuration actually requires.
 */
export function hostPatternFor(panelUrl: string): string | null {
  try {
    const url = new URL(normalisePanelUrl(panelUrl))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.protocol}//${url.host}/*`
  } catch {
    return null
  }
}

/**
 * Which standing grant a saved address change has made redundant.
 *
 * The minimal-permission posture is a stated requirement -- the README's
 * permission table promises access to the configured panel address and nothing
 * else, and behaviour conforms to the documented promise, never the other way
 * round. So the previous address's grant is revoked once it is no longer the
 * configured one. The exception is the default address: that pattern is a
 * static `host_permissions` entry in the manifest, which cannot be removed at
 * runtime and must not be attempted.
 */
export function patternToRevoke(previousUrl: string, nextUrl: string, defaultUrl: string): string | null {
  const previous = hostPatternFor(previousUrl)
  if (previous === null) return null
  if (previous === hostPatternFor(nextUrl) || previous === hostPatternFor(defaultUrl)) return null
  return previous
}

/**
 * Chrome's permission API, as the three calls this module makes.
 *
 * Injected rather than imported so the save sequence below can be exercised in
 * Node against a browser that grants, one that refuses, and one that throws --
 * the three cases whose handling is the whole point of the function.
 */
export interface HostAccess {
  contains(pattern: string): Promise<boolean>
  request(pattern: string): Promise<boolean>
  remove(pattern: string): Promise<void>
}

/** What a save did, and the sentence to put on screen for it. */
export interface SaveOutcome {
  /** The settings are in storage. False only when nothing was written. */
  saved: boolean
  /** The extension may reach the configured address. */
  granted: boolean
  message: string
  tone: 'ok' | 'error'
}

/**
 * Save the panel address and token, then make sure we may reach them.
 *
 * **That order is the fix.** It used to be the other way round: host access was
 * requested first and the settings were written only if the grant came back
 * true, inside a floating async function with no `catch`. So a user who typed
 * an address Chrome had to ask about -- `127.0.0.1` instead of `localhost` is
 * enough -- and then dismissed the prompt, or hit anything that made
 * `permissions.request` reject or never settle, got a blank status line and
 * lost the pairing token they had just pasted. Silently. On the one page whose
 * entire job is to hold that token.
 *
 * Writing first cannot lose anything, and a configured address the extension
 * cannot yet reach is a state the user can see, understand and fix by granting
 * the permission -- which is exactly what the returned message tells them to
 * do. Every branch returns a sentence; there is no path out of here that says
 * nothing.
 */
export async function saveSettings(
  deps: { store: KeyValueStore; access: HostAccess; defaultUrl: string },
  input: Settings,
): Promise<SaveOutcome> {
  const pattern = hostPatternFor(input.panelUrl)
  if (pattern === null) {
    return { saved: false, granted: false, message: 'that is not an http(s) address', tone: 'error' }
  }

  const previous = await readSettings(deps.store)
  await writeSettings(deps.store, input)

  let granted: boolean
  try {
    granted = (await deps.access.contains(pattern)) || (await deps.access.request(pattern))
  } catch (error) {
    // A refusal Chrome raises rather than returns -- a request made outside a
    // user gesture is the common one. The settings are already safe; say what
    // is missing and what it costs.
    return {
      saved: true,
      granted: false,
      message: `Saved, but Chrome would not grant access to ${pattern} (${error instanceof Error ? error.message : String(error)}). Captures cannot be sent until it does -- press Save again from this page.`,
      tone: 'error',
    }
  }

  if (!granted) {
    return {
      saved: true,
      granted: false,
      message: `Saved, but without access to ${pattern} captures cannot be sent. Press Save again and allow it.`,
      tone: 'error',
    }
  }

  // Only once the new address is usable: dropping the old grant before that
  // would leave an extension that can reach neither address.
  const stale = patternToRevoke(previous.panelUrl, input.panelUrl, deps.defaultUrl)
  if (stale !== null) {
    // The save already succeeded; a refused revocation changes nothing here.
    await deps.access.remove(stale).catch(() => undefined)
  }
  return { saved: true, granted: true, message: 'Saved.', tone: 'ok' }
}
