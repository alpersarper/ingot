/**
 * The WCAG contrast floor.
 *
 * The engine's strongest promise is that it never emits a text/background pair
 * below AA. These tests cover the promise and the three escape hatches: moving
 * the foreground, moving the background when the foreground has nowhere left to
 * go, and moving chroma when lightness has run out too.
 *
 * They also cover the pairs the promise used to skip. A derived interaction
 * shade is an offset of a role that already passed, and an offset is not a
 * guarantee -- on a dark kit the hover lift moves a brand fill toward its white
 * label, so the label got worse on every interaction while the exported
 * contrast table still read as complete.
 */
import { describe, expect, it } from 'vitest'
import {
  CONTRAST_FLOOR,
  DISABLED_CONTRAST_FLOOR,
  contrastRatio,
  deriveInteractionShades,
  enforceContrast,
  enforceContrastByChroma,
  enforceContrastOnBackground,
  parseColor,
} from '../src/index'
import type { Oklch, RoleAssignment } from '../src/index'

function oklch(hex: string): Oklch {
  const parsed = parseColor(hex)
  if (!parsed) throw new Error(`unparseable colour in test: ${hex}`)
  return parsed.oklch
}

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio(oklch('#000000'), oklch('#ffffff'))).toBe(21)
    expect(contrastRatio(oklch('#ffffff'), oklch('#ffffff'))).toBe(1)
    expect(contrastRatio(oklch('#999999'), oklch('#ffffff'))).toBeCloseTo(2.85, 2)
  })

  it('is symmetric', () => {
    expect(contrastRatio(oklch('#697386'), oklch('#ffffff'))).toBe(
      contrastRatio(oklch('#ffffff'), oklch('#697386')),
    )
  })
})

describe('enforceContrast', () => {
  const white = { path: 'bg', color: oklch('#ffffff') }
  const near_black = { path: 'bg', color: oklch('#08090a') }

  it('leaves a compliant colour untouched', () => {
    const result = enforceContrast('fg', oklch('#1a1f36'), [white])
    expect(result.adjustment).toBeUndefined()
    expect(result.color).toEqual(oklch('#1a1f36'))
  })

  it('darkens a failing foreground on a light background', () => {
    const before = oklch('#999999')
    const result = enforceContrast('fg', before, [white])
    expect(result.adjustment?.met).toBe(true)
    expect(result.color.l).toBeLessThan(before.l)
    expect(contrastRatio(result.color, white.color)).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
  })

  it('lightens a failing foreground on a dark background', () => {
    const before = oklch('#3a3a3a')
    const result = enforceContrast('fg', before, [near_black])
    expect(result.adjustment?.met).toBe(true)
    expect(result.color.l).toBeGreaterThan(before.l)
    expect(contrastRatio(result.color, near_black.color)).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
  })

  it('preserves hue and chroma; only lightness moves', () => {
    const before = oklch('#999999')
    const after = enforceContrast('fg', before, [white]).color
    expect(after.c).toBe(before.c)
    expect(after.h).toBe(before.h)
  })

  it('satisfies every background it is given, not just the first', () => {
    const surfaces = [
      { path: 'bg', color: oklch('#ffffff') },
      { path: 'surface', color: oklch('#f6f9fc') },
    ]
    const result = enforceContrast('fg', oklch('#999999'), surfaces)
    for (const surface of surfaces) {
      expect(contrastRatio(result.color, surface.color)).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
  })

  it('records the adjustment it made', () => {
    const adjustment = enforceContrast('color.roles.textMuted', oklch('#999999'), [white]).adjustment
    expect(adjustment).toMatchObject({
      role: 'color.roles.textMuted',
      against: ['bg'],
      floor: CONTRAST_FLOOR,
      met: true,
    })
    expect(adjustment?.from.hex).toBe('#999999')
    expect(adjustment?.ratioBefore).toBeLessThan(CONTRAST_FLOOR)
    expect(adjustment?.ratioAfter).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    expect(adjustment?.deltaL).toBeLessThan(0)
    expect(adjustment?.reason).toContain('lightness')
  })

  it('reports met: false rather than pretending, when the gamut runs out', () => {
    // White on this blue is 4.33:1 and white cannot get lighter.
    const result = enforceContrast('fg', oklch('#ffffff'), [{ path: 'bg', color: oklch('#0b76ef') }])
    expect(result.adjustment?.met).toBe(false)
    expect(result.adjustment?.deltaL).toBe(0)
    expect(result.adjustment?.reason).toContain('could not reach')
  })

  it('is a no-op when there is nothing to contrast against', () => {
    const result = enforceContrast('fg', oklch('#999999'), [])
    expect(result.adjustment).toBeUndefined()
  })
})

describe('enforceContrastOnBackground', () => {
  const white = { path: 'color.roles.primaryForeground', color: oklch('#ffffff') }

  it('walks a derived hover shade back until its label clears AA', () => {
    // linear-dark: primary #5e6ad2 lifted +0.04 lightness for hover, which drops
    // white from 4.7:1 to 3.99:1. Measured in quality run #1.
    const hover = oklch('#6976e0')
    expect(contrastRatio(white.color, hover)).toBeLessThan(CONTRAST_FLOOR)

    const result = enforceContrastOnBackground('color.roles.primaryHover', hover, white)
    expect(result.adjustment?.met).toBe(true)
    expect(contrastRatio(white.color, result.color)).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    // The hover shade darkens toward its base rather than the label moving:
    // the label is at the gamut pole and the base role is already guaranteed.
    expect(result.color.l).toBeLessThan(hover.l)
    expect(result.color.h).toBe(hover.h)
    expect(result.color.c).toBe(hover.c)
  })

  it('does the same for the pressed shade, which starts further out', () => {
    const active = oklch('#7483ed')
    expect(contrastRatio(white.color, active)).toBeLessThan(CONTRAST_FLOOR)
    const result = enforceContrastOnBackground('color.roles.primaryActive', active, white)
    expect(contrastRatio(white.color, result.color)).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
  })

  it('leaves a shade that already passes exactly where it was', () => {
    // stripe-light darkens on hover, which raises contrast with a white label.
    const hover = oklch('#594df1')
    const result = enforceContrastOnBackground('color.roles.primaryHover', hover, white)
    expect(result.adjustment).toBeUndefined()
    expect(result.color).toEqual(hover)
  })
})

describe('enforceContrastByChroma', () => {
  const white = { path: 'fg', color: oklch('#ffffff') }

  it('moves chroma, never lightness or hue', () => {
    const before = oklch('#6976e0')
    const result = enforceContrastByChroma('bg', before, white)
    expect(result.color.l).toBe(before.l)
    expect(result.color.h).toBe(before.h)
    expect(result.color.c).not.toBe(before.c)
    expect(result.adjustment?.deltaL).toBe(0)
  })

  it('improves the ratio it was given', () => {
    const before = oklch('#6976e0')
    const result = enforceContrastByChroma('bg', before, white)
    expect(contrastRatio(white.color, result.color)).toBeGreaterThanOrEqual(
      contrastRatio(white.color, before),
    )
  })

  it('reports met: false rather than pretending, when chroma cannot close the gap', () => {
    // An indigo at this lightness tops out around 4.07:1 against white however
    // saturated it gets, because sRGB runs out of gamut first.
    const result = enforceContrastByChroma('bg', oklch('#6976e0'), white)
    expect(result.adjustment?.met).toBe(false)
    expect(result.adjustment?.reason).toContain('could not reach')
  })

  it('is a no-op on an achromatic colour, which has no chroma axis to move', () => {
    const result = enforceContrastByChroma('bg', oklch('#999999'), white)
    expect(result.adjustment).toBeUndefined()
  })

  it('leaves a compliant pair alone', () => {
    const result = enforceContrastByChroma('bg', oklch('#5e6ad2'), white)
    expect(result.adjustment).toBeUndefined()
  })
})

describe('deriveInteractionShades', () => {
  const assignment = (role: RoleAssignment['role'], hex: string): RoleAssignment => ({
    role,
    color: oklch(hex),
    rule: 'test',
    detail: 'test',
    derivedFrom: [],
  })

  const base = [
    assignment('background', '#08090a'),
    assignment('surface', '#141516'),
    assignment('text', '#f7f8f8'),
    assignment('textMuted', '#8a8f98'),
    assignment('primary', '#5e6ad2'),
  ]

  it('derives every interaction and state surface a kit needs', () => {
    const roles = deriveInteractionShades(base, 'dark').map((shade) => shade.role)
    expect(roles).toEqual([
      'surfaceHover',
      'primaryHover',
      'primaryActive',
      'disabledSurface',
      'selectedSurface',
      'disabledForeground',
    ])
  })

  it('moves surfaces toward the viewer: lighter on dark, darker on light', () => {
    const dark = deriveInteractionShades(base, 'dark')
    const light = deriveInteractionShades(base, 'light')
    const surfaceOf = (shades: RoleAssignment[]): number =>
      shades.find((shade) => shade.role === 'surfaceHover')?.color.l ?? 0
    expect(surfaceOf(dark)).toBeGreaterThan(0.195)
    expect(surfaceOf(light)).toBeLessThan(0.195)
  })

  it('tints the selected surface with the brand hue instead of another grey', () => {
    const selected = deriveInteractionShades(base, 'dark').find(
      (shade) => shade.role === 'selectedSurface',
    )
    expect(selected?.color.h).toBeCloseTo(oklch('#5e6ad2').h as number, 1)
    expect(selected?.color.c).toBeGreaterThan(0)
    expect(selected?.derivedFrom).toEqual(['surface', 'primary'])
  })

  it('fades the disabled label toward its own fill rather than reaching for opacity', () => {
    const shades = deriveInteractionShades(base, 'dark')
    const surface = shades.find((shade) => shade.role === 'disabledSurface')
    const label = shades.find((shade) => shade.role === 'disabledForeground')
    expect(label?.derivedFrom).toEqual(['textMuted', 'disabledSurface'])
    // Quieter than textMuted, but still a colour of its own, not a transparency.
    expect(label?.color.l).toBeLessThan(oklch('#8a8f98').l)
    expect(label?.color.l).toBeGreaterThan(surface?.color.l ?? 0)
  })

  it('leaves the shades unchecked, because checking them is the caller\'s job', () => {
    // The regression this whole pass exists for: derivation alone produced a
    // 3.99:1 hover on linear-dark and nothing looked at it.
    const hover = deriveInteractionShades(base, 'dark').find((shade) => shade.role === 'primaryHover')
    expect(contrastRatio(oklch('#ffffff'), hover?.color as Oklch)).toBeLessThan(CONTRAST_FLOOR)
  })
})

describe('DISABLED_CONTRAST_FLOOR', () => {
  it('sits below the body-text floor and far above what opacity produces', () => {
    expect(DISABLED_CONTRAST_FLOOR).toBeLessThan(CONTRAST_FLOOR)
    expect(DISABLED_CONTRAST_FLOOR).toBeGreaterThan(1)
  })
})
