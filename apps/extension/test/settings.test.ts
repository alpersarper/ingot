/**
 * The grant-hygiene decision, as data.
 *
 * `patternToRevoke` is the pure half of what the options page does after a
 * save: the README's permission table promises the extension holds access to
 * the configured panel address and nothing else, so the previous address's
 * grant goes when it stops being the configured one -- except the default,
 * which is a static `host_permissions` entry Chrome cannot remove at runtime.
 */
import { describe, expect, it } from 'vitest'
import { hostPatternFor, patternToRevoke } from '../src/shared/settings'
import { DEFAULT_PANEL_URL } from '../src/shared/protocol'

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
