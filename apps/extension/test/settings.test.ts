/**
 * The options page's two decisions, as data: which grant to drop, and what a
 * save does when Chrome will not give the grant at all.
 *
 * `patternToRevoke` is the grant-hygiene half: the README's permission table
 * promises the extension holds access to the configured panel address and
 * nothing else, so the previous address's grant goes when it stops being the
 * configured one -- except the default, which is a static `host_permissions`
 * entry Chrome cannot remove at runtime.
 *
 * `saveSettings` is the other half, and it is here rather than in the page
 * because of what it must never do again: lose the token.
 */
import { describe, expect, it } from 'vitest'
import { hostPatternFor, patternToRevoke, readSettings, saveSettings } from '../src/shared/settings'
import type { HostAccess } from '../src/shared/settings'
import type { KeyValueStore } from '../src/shared/queue'
import { DEFAULT_PANEL_URL } from '../src/shared/protocol'

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>()
  return {
    async get(keys) {
      const out: Record<string, unknown> = {}
      for (const key of keys) if (data.has(key)) out[key] = data.get(key)
      return out
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value))
    },
  }
}

/** A Chrome that answers host-permission calls however the case needs. */
function browser(overrides: Partial<HostAccess> = {}): HostAccess & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    contains: overrides.contains ?? (async () => false),
    request: overrides.request ?? (async () => true),
    remove:
      overrides.remove ??
      (async (pattern: string) => {
        removed.push(pattern)
      }),
  }
}

describe('patternToRevoke', () => {
  it('revokes the previous grant when a different panel address is saved', () => {
    expect(patternToRevoke('http://10.0.0.5:4310', 'http://studio.local:4310', DEFAULT_PANEL_URL)).toBe(
      'http://10.0.0.5:4310/*',
    )
  })

  it('revokes nothing when the address did not change', () => {
    expect(patternToRevoke('http://studio.local:4310', 'http://studio.local:4310', DEFAULT_PANEL_URL)).toBeNull()
  })

  it('treats a trailing slash as the same address, not a change', () => {
    expect(patternToRevoke('http://studio.local:4310/', 'http://studio.local:4310', DEFAULT_PANEL_URL)).toBeNull()
  })

  it('never asks to revoke the default address', () => {
    // The default pattern is declared in the manifest's `host_permissions`;
    // a static grant cannot be removed and must not be attempted.
    expect(patternToRevoke(DEFAULT_PANEL_URL, 'http://studio.local:4310', DEFAULT_PANEL_URL)).toBeNull()
    expect(patternToRevoke(`${DEFAULT_PANEL_URL}/`, 'http://studio.local:4310', DEFAULT_PANEL_URL)).toBeNull()
  })

  it('revokes nothing for an address that never had a grantable pattern', () => {
    expect(patternToRevoke('not a url', 'http://studio.local:4310', DEFAULT_PANEL_URL)).toBeNull()
    expect(patternToRevoke('ftp://studio.local', 'http://studio.local:4310', DEFAULT_PANEL_URL)).toBeNull()
  })

  it('distinguishes hosts the way hostPatternFor does, port included', () => {
    expect(patternToRevoke('http://studio.local:4310', 'http://studio.local:4311', DEFAULT_PANEL_URL)).toBe(
      hostPatternFor('http://studio.local:4310'),
    )
  })
})

describe('saveSettings', () => {
  const deps = (access: HostAccess, store: KeyValueStore) => ({ store, access, defaultUrl: DEFAULT_PANEL_URL })

  it('needs no prompt for the default address, which the manifest already grants', async () => {
    const store = memoryStore()
    const access = browser({ contains: async () => true, request: async () => false })

    const outcome = await saveSettings(deps(access, store), { panelUrl: DEFAULT_PANEL_URL, token: 'paste-me' })

    expect(outcome).toEqual({ saved: true, granted: true, message: 'Saved.', tone: 'ok' })
    expect(await readSettings(store)).toEqual({ panelUrl: DEFAULT_PANEL_URL, token: 'paste-me' })
  })

  /*
   * The regression. Typing `127.0.0.1` instead of `localhost` is enough to make
   * Chrome ask, and a dismissed prompt used to leave the status line blank and
   * the pairing token unsaved -- on the one page whose job is to hold it.
   */
  it('keeps the token when the host permission is refused, and says what is missing', async () => {
    const store = memoryStore()
    const access = browser({ request: async () => false })

    const outcome = await saveSettings(deps(access, store), { panelUrl: 'http://127.0.0.1:4310', token: 'paste-me' })

    expect(outcome.saved).toBe(true)
    expect(outcome.granted).toBe(false)
    expect(outcome.tone).toBe('error')
    expect(outcome.message).toContain('http://127.0.0.1:4310/*')
    // The whole point: nothing was lost.
    expect(await readSettings(store)).toEqual({ panelUrl: 'http://127.0.0.1:4310', token: 'paste-me' })
  })

  it('keeps the token when Chrome throws instead of answering', async () => {
    const store = memoryStore()
    const access = browser({
      request: async () => {
        // What Chrome raises for a request made outside a user gesture.
        throw new Error('This function must be called during a user gesture')
      },
    })

    const outcome = await saveSettings(deps(access, store), { panelUrl: 'http://127.0.0.1:4310', token: 'paste-me' })

    expect(outcome.saved).toBe(true)
    expect(outcome.granted).toBe(false)
    expect(outcome.tone).toBe('error')
    expect(outcome.message).toContain('user gesture')
    expect(await readSettings(store)).toEqual({ panelUrl: 'http://127.0.0.1:4310', token: 'paste-me' })
  })

  it('writes nothing for an address that could never be granted, and says why', async () => {
    const store = memoryStore()

    const outcome = await saveSettings(deps(browser(), store), { panelUrl: 'ftp://studio.local', token: 'paste-me' })

    expect(outcome).toEqual({
      saved: false,
      granted: false,
      message: 'that is not an http(s) address',
      tone: 'error',
    })
    // An unusable address must not overwrite a usable one.
    expect(await readSettings(store)).toEqual({ panelUrl: DEFAULT_PANEL_URL, token: '' })
  })

  it('drops the superseded grant only once the new address is usable', async () => {
    const store = memoryStore()
    const access = browser()
    await saveSettings(deps(access, store), { panelUrl: 'http://studio.local:4310', token: 't' })

    const refusing = browser({ request: async () => false })
    await saveSettings(deps(refusing, store), { panelUrl: 'http://10.0.0.5:4310', token: 't' })
    expect(refusing.removed).toEqual([])

    const granting = browser()
    await saveSettings(deps(granting, store), { panelUrl: 'http://10.0.0.5:4310', token: 't' })
    expect(granting.removed).toEqual([])

    const moving = browser()
    await saveSettings(deps(moving, store), { panelUrl: 'http://studio.local:4310', token: 't' })
    expect(moving.removed).toEqual(['http://10.0.0.5:4310/*'])
  })
})
