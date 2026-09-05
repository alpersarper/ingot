/**
 * The WCAG contrast floor.
 *
 * The engine's strongest promise is that it never emits a text/background pair
 * below AA. These tests cover the promise and the two escape hatches: moving
 * the foreground, and moving the background when the foreground has nowhere
 * left to go.
 */
import { describe, expect, it } from 'vitest'
import { CONTRAST_FLOOR, contrastRatio, enforceContrast, parseColor } from '../src/index'
import type { Oklch } from '../src/index'

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
