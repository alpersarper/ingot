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
import { DARK_TONE_MAX, LIGHT_TONE_MIN, readColors, surfaceBackground, surfaceTone } from '../src/index'
import type { CaptureRecord } from '../src/index'

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
    ).toEqual({ raw: 'rgb(94, 106, 210)', inherited: false })
  })

  it('falls back to what showed through a transparent one, and says so', () => {
    expect(
      surfaceBackground(
        capture({
          styles: { backgroundColor: 'rgba(0, 0, 0, 0)' },
          inheritedBackgroundColor: 'rgb(12, 14, 22)',
        }),
      ),
    ).toEqual({ raw: 'rgb(12, 14, 22)', inherited: true })
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

  it('refuses to call a brand fill dark', () => {
    // The band is wide on purpose. Two captures off the same light page -- a
    // white card and an indigo button -- must not read as a theme clash.
    expect(surfaceTone(capture({ styles: { backgroundColor: '#5e6ad2' } }))).toBe('mid')
    expect(surfaceTone(capture({ styles: { backgroundColor: '#808080' } }))).toBe('mid')
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

  it('still reads nothing from a transparent capture that measured nothing', () => {
    const observations = readColors([capture({ styles: { backgroundColor: 'rgba(0, 0, 0, 0)', color: '#111111' } })])
    expect(observations.map((observation) => observation.channel)).toEqual(['foreground'])
  })
})
