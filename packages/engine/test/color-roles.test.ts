/**
 * Colour role assignment.
 *
 * These tests pin the heuristics that decide what a colour *means*, which is
 * the part of the engine most likely to drift when the rules are tuned.
 */
import { describe, expect, it } from 'vitest'
import { assignRoles, clusterColors, detectMode, readColors } from '../src/index'
import type { CaptureRecord, ColorRoleName, ComponentType } from '../src/index'

let counter = 0
function capture(styles: Record<string, string>, componentType: ComponentType = 'button'): CaptureRecord {
  counter += 1
  return {
    schemaVersion: 1,
    id: `c-${counter}`,
    componentType,
    sourceUrl: 'https://example.com/',
    capturedAt: '2026-01-01T00:00:00.000Z',
    styles,
  }
}

function rolesOf(captures: CaptureRecord[]): Record<string, string> {
  const clusters = clusterColors(readColors(captures))
  const mode = detectMode(clusters)
  const out: Record<string, string> = {}
  for (const assignment of assignRoles(clusters, mode)) out[assignment.role] = assignment.cluster?.hex ?? 'derived'
  return out
}

const bordered = { borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderStyle: 'solid' }

describe('detectMode', () => {
  it('reads a mostly-dark set of backgrounds as dark mode', () => {
    const clusters = clusterColors(
      readColors([
        capture({ backgroundColor: '#0b0b0d', color: '#f5f5f5' }),
        capture({ backgroundColor: '#161618', color: '#f5f5f5' }),
      ]),
    )
    expect(detectMode(clusters)).toBe('dark')
  })

  it('ignores foreground colours when deciding', () => {
    // A light page whose text is almost entirely white-on-brand would read as
    // dark if foregrounds counted.
    const clusters = clusterColors(
      readColors([
        capture({ backgroundColor: '#ffffff', color: '#ffffff' }),
        capture({ backgroundColor: '#ffffff', color: '#ffffff' }),
        capture({ backgroundColor: '#fafafa', color: '#ffffff' }),
      ]),
    )
    expect(detectMode(clusters)).toBe('light')
  })

  it('falls back to light when no background colour was captured', () => {
    expect(detectMode(clusterColors(readColors([capture({ color: '#333333' })])))).toBe('light')
  })
})

describe('assignRoles', () => {
  it('picks the most extreme neutral background as the page background', () => {
    const roles = rolesOf([
      capture({ backgroundColor: '#ffffff', color: '#1a1a1a' }),
      capture({ backgroundColor: '#f4f4f5', color: '#1a1a1a' }, 'card'),
      capture({ backgroundColor: '#f4f4f5', color: '#1a1a1a' }, 'card'),
    ])
    // #f4f4f5 is more frequent, but the page background is the lightest one.
    expect(roles['background']).toBe('#ffffff')
    expect(roles['surface']).toBe('#f4f4f5')
  })

  it('prefers the most used high-contrast text colour over the most extreme one', () => {
    // #ffffff appears once, only as a label on the brand button. #1a1f36 is the
    // colour the page is actually set in, so it is the text role.
    const roles = rolesOf([
      capture({ backgroundColor: '#635bff', color: '#ffffff' }),
      capture({ backgroundColor: '#ffffff', color: '#1a1f36' }, 'card'),
      capture({ backgroundColor: '#ffffff', color: '#1a1f36' }, 'typography'),
      capture({ backgroundColor: '#ffffff', color: '#1a1f36' }, 'input'),
    ])
    expect(roles['text']).toBe('#1a1f36')
    expect(roles['primaryForeground']).toBe('#ffffff')
  })

  it('refuses a muted colour that is not visibly separate from text', () => {
    // #2f2f2f and #333333 are both dark greys. Neither may stand in as the
    // "muted" counterpart of the other.
    const roles = rolesOf([
      capture({ backgroundColor: '#ffffff', color: '#2f2f2f' }, 'typography'),
      capture({ backgroundColor: '#ffffff', color: '#2f2f2f' }, 'typography'),
      capture({ backgroundColor: '#ffffff', color: '#333333' }, 'card'),
    ])
    expect(roles['text']).toBe('#2f2f2f')
    expect(roles['textMuted']).toBe('derived')
  })

  it('takes a separated mid-lightness foreground as textMuted', () => {
    const roles = rolesOf([
      capture({ backgroundColor: '#ffffff', color: '#1a1f36' }, 'typography'),
      capture({ backgroundColor: '#ffffff', color: '#1a1f36' }, 'typography'),
      capture({ backgroundColor: '#ffffff', color: '#697386' }, 'typography'),
    ])
    expect(roles['textMuted']).toBe('#697386')
  })

  it('prefers a saturated colour that fills a surface over one that only tints text', () => {
    const roles = rolesOf([
      capture({ backgroundColor: '#0b76ef', color: '#ffffff' }),
      capture({ backgroundColor: '#ffffff', color: '#e91e63' }, 'typography'),
      capture({ backgroundColor: '#ffffff', color: '#1a1a1a' }, 'typography'),
    ])
    expect(roles['primary']).toBe('#0b76ef')
  })

  it('ranks the more used brand colour ahead of the more saturated one', () => {
    // #d93025 is fractionally more saturated; #0b76ef is used twice.
    const roles = rolesOf([
      capture({ backgroundColor: '#0b76ef', color: '#ffffff' }),
      capture({ backgroundColor: '#ffffff', color: '#0a74ec' }, 'typography'),
      capture({ backgroundColor: '#d93025', color: '#ffffff' }),
      capture({ backgroundColor: '#ffffff', color: '#1a1a1a' }, 'typography'),
    ])
    expect(roles['primary']).toBe('#0b76ef')
    expect(roles['destructive']).toBe('#d93025')
  })

  it('only claims a border colour from a capture that draws a border', () => {
    // The first capture reports a border colour with zero width; browsers do
    // that constantly and it must not become the border role.
    const roles = rolesOf([
      capture({ backgroundColor: '#ffffff', color: '#1a1a1a', borderColor: '#ff00ff' }),
      capture({ backgroundColor: '#ffffff', color: '#1a1a1a', borderColor: '#e3e8ee', ...bordered }, 'card'),
    ])
    expect(roles['border']).toBe('#e3e8ee')
  })

  it('derives a border colour when no capture draws one', () => {
    const roles = rolesOf([capture({ backgroundColor: '#ffffff', color: '#1a1a1a' })])
    expect(roles['border']).toBe('derived')
  })

  it('emits no destructive role when the captures contain no red signal colour', () => {
    const roles = rolesOf([
      capture({ backgroundColor: '#635bff', color: '#ffffff' }),
      capture({ backgroundColor: '#ffffff', color: '#1a1f36' }, 'typography'),
    ])
    expect(roles['destructive']).toBeUndefined()
    expect(roles['destructiveForeground']).toBeUndefined()
  })

  it('never leaves a required role unfilled, even from a single capture', () => {
    const clusters = clusterColors(readColors([capture({ color: '#123456' })]))
    const assigned = new Set(assignRoles(clusters, detectMode(clusters)).map((a) => a.role))
    const required: ColorRoleName[] = ['background', 'surface', 'border', 'text', 'textMuted', 'primary', 'primaryForeground']
    for (const role of required) expect(assigned).toContain(role)
  })
})
