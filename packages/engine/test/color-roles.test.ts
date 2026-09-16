/**
 * Colour role assignment.
 *
 * These tests pin the heuristics that decide what a colour *means*, which is
 * the part of the engine most likely to drift when the rules are tuned.
 */
import { describe, expect, it } from 'vitest'
import { assignRoles, clusterColors, detectMode, readColors } from '../src/index'
import type { CaptureRecord, ColorRoleName, ComponentType } from '../src/index'
import {
  AMBIENT_SEPARATION_MIN,
  CONTROL_STATE_SEPARATION_MIN,
  SELECTED_SURFACE_SEPARATION,
  collapsedShades,
  deriveInteractionShades,
} from '../src/color/roles'
import { parseColor, renderedDistance } from '../src/color/space'
import type { Oklch } from '../src/color/space'

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

/**
 * State perceptibility.
 *
 * A hover the reviewer cannot see is a defect whether or not the two hexes are
 * equal, and quality run #2 shipped `linear-dark` with three identical-looking
 * primary buttons because the old test asked the wrong question. The numbers
 * below are that run's own measurements, so a threshold that stopped separating
 * the kits it was calibrated on fails here rather than on a screenshot.
 */
describe('collapsed states', () => {
  const oklch = (hex: string): Oklch => parseColor(hex)?.oklch as Oklch
  const collapsedFor = (pairs: Partial<Record<ColorRoleName, string>>): string[] =>
    collapsedShades((role) => {
      const hex = pairs[role]
      return hex === undefined ? undefined : oklch(hex)
    }).map((entry) => `${entry.shade}/${entry.base}`)

  it('reads the three kits a reviewer could see as separated', () => {
    // primaryHover vs primary, measured: 0.040 / 0.042 / 0.043.
    for (const [primary, hover] of [
      ['#635bff', '#594df1'],
      ['#0f7a5a', '#006d50'],
      ['#0373ec', '#0067d7'],
    ] as const) {
      expect(collapsedFor({ primary, primaryHover: hover })).toEqual([])
    }
  })

  it('reads the kit a reviewer could not see as collapsed, equal hexes or not', () => {
    // The pair that shipped: 1.04:1, one hex digit apart, and invisible.
    expect(collapsedFor({ primary: '#5e6ad2', primaryHover: '#616dd5' })).toEqual(['primaryHover/primary'])
    expect(collapsedFor({ primaryHover: '#616dd5', primaryActive: '#616dd5' })).toEqual([
      'primaryActive/primaryHover',
    ])
  })

  it('holds the ambient tints to a lower bar than a control fill', () => {
    // A hovered row is 0.030 from its resting fill in every kit and is meant to
    // be quiet. Judging it by the control floor would flood every kit with a
    // diagnostic about a state that works.
    expect(collapsedFor({ surface: '#f6f9fc', surfaceHover: '#eceff2' })).toEqual([])
    // ...but a tint that does not move at all is still a collapse.
    expect(collapsedFor({ surface: '#f6f9fc', surfaceHover: '#f6f9fc' })).toEqual(['surfaceHover/surface'])
  })

  it('says how far apart a collapsed pair actually renders', () => {
    const [entry] = collapsedShades((role) =>
      role === 'primary' ? oklch('#5e6ad2') : role === 'primaryHover' ? oklch('#616dd5') : undefined,
    )
    expect(entry?.distance).toBeCloseTo(0.0098, 4)
    expect(entry?.floor).toBe(CONTROL_STATE_SEPARATION_MIN)
  })

  it('keeps a pairing with a missing side out of it', () => {
    expect(collapsedFor({ primary: '#5e6ad2' })).toEqual([])
  })
})

/**
 * The selected-row tint.
 *
 * The rule this replaced asked for a chroma and let the sRGB gamut decide what
 * landed, which is why one reviewer called the same code path a highlighter
 * mark on one kit and a whisper on another.
 */
describe('the selected-row tint', () => {
  const tintFor = (surface: string, primary: string, mode: 'light' | 'dark'): number => {
    const base = [
      { role: 'surface' as ColorRoleName, color: parseColor(surface)?.oklch as Oklch, rule: '', detail: '', derivedFrom: [] },
      { role: 'primary' as ColorRoleName, color: parseColor(primary)?.oklch as Oklch, rule: '', detail: '', derivedFrom: [] },
    ]
    const shade = deriveInteractionShades(base, mode).find((entry) => entry.role === 'selectedSurface')
    return renderedDistance(shade?.color as Oklch, parseColor(surface)?.oklch as Oklch)
  }

  it('lands on one perceptual distance whatever headroom the brand hue has', () => {
    // A light blue has almost no chroma left at surface lightness; a green has
    // plenty. Before this they landed at 0.025 and 0.054.
    expect(tintFor('#f6f9fc', '#635bff', 'light')).toBeCloseTo(SELECTED_SURFACE_SEPARATION, 2)
    expect(tintFor('#f5f2ec', '#0f7a5a', 'light')).toBeCloseTo(SELECTED_SURFACE_SEPARATION, 2)
    expect(tintFor('#141516', '#5e6ad2', 'dark')).toBeCloseTo(SELECTED_SURFACE_SEPARATION, 2)
  })

  it('stays distinguishable from the hover fill it sits beside', () => {
    for (const [surface, hover, primary, mode] of [
      ['#f6f9fc', '#eceff2', '#635bff', 'light'],
      ['#f5f2ec', '#ebe8e2', '#0f7a5a', 'light'],
      ['#141516', '#1b1c1d', '#5e6ad2', 'dark'],
    ] as const) {
      const base = [
        { role: 'surface' as ColorRoleName, color: parseColor(surface)?.oklch as Oklch, rule: '', detail: '', derivedFrom: [] },
        { role: 'primary' as ColorRoleName, color: parseColor(primary)?.oklch as Oklch, rule: '', detail: '', derivedFrom: [] },
      ]
      const shade = deriveInteractionShades(base, mode).find((entry) => entry.role === 'selectedSurface')
      expect(renderedDistance(shade?.color as Oklch, parseColor(hover)?.oklch as Oklch)).toBeGreaterThanOrEqual(
        AMBIENT_SEPARATION_MIN,
      )
    }
  })
})
