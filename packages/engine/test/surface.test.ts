/**
 * The background behind a capture, and how light it is.
 *
 * The case these exist for: a real session produced seven captures where five
 * carried `backgroundColor: rgba(0, 0, 0, 0)`. A fully transparent colour is
 * read as "no colour" everywhere in this engine, so those five contributed no
 * background evidence at all and the kit's surface came down to the two that
 * happened to paint their own. The extension now measures what was painted
 * behind such an element; this is where the engine decides what that is worth.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DARK_TONE_MAX, LIGHT_TONE_MIN, distill, readColors, surfaceBackground, surfaceTone } from '../src/index'
import type { CaptureRecord, CaptureSet } from '../src/index'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function capture(overrides: Partial<CaptureRecord> & { styles: CaptureRecord['styles'] }): CaptureRecord {
  return {
    schemaVersion: 1,
    id: 'c-1',
    componentType: 'card',
    sourceUrl: 'https://example.com/',
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('surfaceBackground', () => {
  it('prefers the fill the element paints itself', () => {
    expect(
      surfaceBackground(
        capture({
          styles: { backgroundColor: 'rgb(94, 106, 210)' },
          inheritedBackgroundColor: 'rgb(255, 255, 255)',
        }),
      ),
    ).toEqual({ raw: 'rgb(94, 106, 210)', rendered: 'rgb(94, 106, 210)', inherited: false })
  })

  it('falls back to what showed through a transparent one, and says so', () => {
    expect(
      surfaceBackground(
        capture({
          styles: { backgroundColor: 'rgba(0, 0, 0, 0)' },
          inheritedBackgroundColor: 'rgb(12, 14, 22)',
        }),
      ),
    ).toEqual({ raw: 'rgb(12, 14, 22)', rendered: 'rgb(12, 14, 22)', inherited: true })
  })

  it('lays a translucent own fill over the backdrop it was measured on', () => {
    const glass = capture({
      styles: { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
      inheritedBackgroundColor: '#0b0f19',
    })
    expect(surfaceBackground(glass)).toEqual({ raw: 'rgba(255, 255, 255, 0.04)', rendered: '#151922', inherited: false })
    expect(glass.styles.backgroundColor).toBe('rgba(255, 255, 255, 0.04)')
  })

  it('reads a translucent fill as it stands when nothing was measured behind it', () => {
    expect(surfaceBackground(capture({ styles: { backgroundColor: 'rgba(0, 0, 0, 0.5)' } }))).toEqual({
      raw: 'rgba(0, 0, 0, 0.5)',
      rendered: 'rgba(0, 0, 0, 0.5)',
      inherited: false,
    })
  })

  it('reports nothing when nothing was measured', () => {
    // Every record written before the extension measured an inherited colour
    // lands here, and so does a page that genuinely paints no background
    // anywhere. Not knowing is not the same as white.
    expect(surfaceBackground(capture({ styles: { backgroundColor: 'rgba(0, 0, 0, 0)' } }))).toBeUndefined()
    expect(surfaceBackground(capture({ styles: {} }))).toBeUndefined()
  })

  it('skips an inherited value it cannot parse rather than guessing at it', () => {
    expect(
      surfaceBackground(
        capture({ styles: { backgroundColor: 'rgba(0, 0, 0, 0)' }, inheritedBackgroundColor: 'var(--surface)' }),
      ),
    ).toBeUndefined()
  })
})

describe('surfaceTone', () => {
  it('tells a light UI from a dark one', () => {
    expect(surfaceTone(capture({ styles: { backgroundColor: '#ffffff' } }))).toBe('light')
    expect(surfaceTone(capture({ styles: { backgroundColor: '#f6f9fc' } }))).toBe('light')
    expect(surfaceTone(capture({ styles: { backgroundColor: '#0b0f19' } }))).toBe('dark')
    expect(surfaceTone(capture({ styles: { backgroundColor: '#191a23' } }))).toBe('dark')
  })

  it('judges a transparent capture by what is behind it', () => {
    expect(
      surfaceTone(
        capture({
          styles: { backgroundColor: 'rgba(0, 0, 0, 0)' },
          inheritedBackgroundColor: 'rgb(255, 255, 255)',
        }),
      ),
    ).toBe('light')
  })

  it('judges a glass card by what a reader sees through it', () => {
    // A Linear- or BetterStack-style card: near-invisible white over a dark
    // page. With its alpha dropped it would read as white and call a dark kit
    // light.
    const dark = capture({ styles: { backgroundColor: 'rgba(255, 255, 255, 0.04)' }, inheritedBackgroundColor: '#0b0f19' })
    const light = capture({ styles: { backgroundColor: 'rgba(0, 0, 0, 0.03)' }, inheritedBackgroundColor: '#ffffff' })
    expect(surfaceTone(dark)).toBe('dark')
    expect(surfaceTone(light)).toBe('light')
    expect(dark.styles.backgroundColor).toBe('rgba(255, 255, 255, 0.04)')
    expect(light.styles.backgroundColor).toBe('rgba(0, 0, 0, 0.03)')
  })

  it('refuses to call a brand fill dark', () => {
    // The band is wide on purpose. Two captures off the same light page -- a
    // white card and an indigo button -- must not read as a theme clash.
    expect(surfaceTone(capture({ styles: { backgroundColor: '#5e6ad2' } }))).toBe('mid')
    expect(surfaceTone(capture({ styles: { backgroundColor: '#808080' } }))).toBe('mid')
  })

  it('judges a control by what it sits on, not by its own fill', () => {
    // A near-black CTA off a light pricing page is one theme, not two.
    const cta = { componentType: 'button' as const, styles: { backgroundColor: '#0a2540' } }
    expect(surfaceTone(capture(cta))).toBe('unknown')
    expect(surfaceTone(capture({ ...cta, inheritedBackgroundColor: 'rgb(255, 255, 255)' }))).toBe('unknown')
    expect(surfaceTone(capture({ componentType: 'input', styles: { backgroundColor: '#ffffff' } }))).toBe('unknown')
    expect(
      surfaceTone(
        capture({
          componentType: 'button',
          styles: { backgroundColor: 'rgba(0, 0, 0, 0)' },
          inheritedBackgroundColor: '#0b0f19',
        }),
      ),
    ).toBe('dark')
  })

  it('separates "neither" from "not measured"', () => {
    expect(surfaceTone(capture({ styles: { backgroundColor: 'rgba(0, 0, 0, 0)' } }))).toBe('unknown')
    expect(LIGHT_TONE_MIN).toBeGreaterThan(DARK_TONE_MAX)
  })
})

describe('readColors, with an inherited background', () => {
  it('counts the colour a transparent capture is sitting on', () => {
    const observations = readColors([
      capture({
        styles: { backgroundColor: 'rgba(0, 0, 0, 0)', color: '#111111' },
        inheritedBackgroundColor: 'rgb(255, 255, 255)',
      }),
    ])
    expect(observations.map((observation) => [observation.channel, observation.hex])).toEqual([
      ['background', '#ffffff'],
      ['foreground', '#111111'],
    ])
  })

  it('counts a glass card as the colour it renders, keeping its own raw value', () => {
    const glass = capture({
      styles: { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
      inheritedBackgroundColor: '#0b0f19',
    })
    const [background] = readColors([glass])
    expect(background).toMatchObject({ channel: 'background', raw: 'rgba(255, 255, 255, 0.04)', hex: '#151922' })
    expect(glass.styles.backgroundColor).toBe('rgba(255, 255, 255, 0.04)')
  })

  it('still reads nothing from a transparent capture that measured nothing', () => {
    const observations = readColors([capture({ styles: { backgroundColor: 'rgba(0, 0, 0, 0)', color: '#111111' } })])
    expect(observations.map((observation) => observation.channel)).toEqual(['foreground'])
  })
})

describe('a ghost button on a brand surface', () => {
  it('is a ghost button, and never the primary recipe', () => {
    const set = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'ghost-warm', 'set.json'), 'utf8')) as CaptureSet
    const primary = set.captures.find((entry) => entry.id === 'ghost-btn-primary')
    const brand = primary?.styles.backgroundColor as string
    const ghost: CaptureRecord = {
      schemaVersion: 1,
      id: 'ghost-btn-on-brand',
      componentType: 'button',
      sourceUrl: 'https://example.com/',
      capturedAt: '2026-01-01T00:00:00.000Z',
      styles: {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        color: '#ffffff',
        paddingTop: '40px',
        paddingBottom: '40px',
        paddingLeft: '64px',
        paddingRight: '64px',
      },
      inheritedBackgroundColor: brand,
    }
    const tokens = distill({ ...set, captures: [...set.captures, ghost] })
    const button = tokens.components.recipes.find((recipe) => recipe.name === 'button.primary')
    const ghostRecipe = tokens.components.recipes.find((recipe) => recipe.name === 'button.ghost')
    for (const token of [button?.paddingY, button?.paddingX]) {
      expect(token?.provenance.captureIds).toContain('ghost-btn-primary')
      expect(token?.provenance.captureIds).not.toContain(ghost.id)
    }
    expect(ghostRecipe?.paddingY.provenance.captureIds).toContain(ghost.id)
  })
})
