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
