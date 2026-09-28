/**
 * The boundary check, against the captures that made it necessary.
 *
 * A first real session produced seven captures off apple.com, dribbble.com and
 * betterstack.com. All seven were recorded as `card`; five carried
 * `backgroundColor: rgba(0, 0, 0, 0)` with padding of either `0px` or `128px`.
 * Nothing had failed -- they were delivered, stored and distilled. They were
 * transparent layout `<div>`s, and the kit was distilled from boxes a reader
 * cannot see.
 *
 * So the cases below are those elements, plus the components that were actually
 * on those pages, and the rule has to separate them.
 */
import { describe, expect, it } from 'vitest'
import { surfaceTone } from '@ingot/engine'
import type { CaptureRecord } from '@ingot/engine'
import {
  boundarySummary,
  compositeBackground,
  drawsItself,
  paints,
  paintsOwnSurface,
  wrapperReason,
} from '../src/shared/boundary'
import { describeAs, filled, onTop } from './element'

describe('paints', () => {
  it('reads a fully transparent colour as painting nothing', () => {
    expect(paints('rgba(0, 0, 0, 0)')).toBe(false)
    expect(paints('transparent')).toBe(false)
    expect(paints('')).toBe(false)
  })

  it('does not mistake an opaque black for a transparent one', () => {
    // `rgb(0, 0, 0)` ends in ", 0)" too. A check that read the last number as an
    // alpha would report every black surface on the web as invisible.
    expect(paints('rgb(0, 0, 0)')).toBe(true)
    expect(paints('rgb(12, 14, 22)')).toBe(true)
  })

  it('reads the slash and wide-gamut forms a modern page returns', () => {
    expect(paints('rgb(255 255 255 / 0%)')).toBe(false)
    expect(paints('color(srgb 0 0 0 / 0)')).toBe(false)
    expect(paints('rgb(255 255 255 / 40%)')).toBe(true)
    expect(paints('oklch(0.62 0.18 265)')).toBe(true)
  })

  it('keeps a partly transparent fill, which is still a fill', () => {
    expect(paints('rgba(0, 0, 0, 0.4)')).toBe(true)
  })
})

/** The tone the engine reads off a transparent capture sitting on `backdrop`. */
function toneOn(backdrop: string): string {
  const record: CaptureRecord = {
    schemaVersion: 1,
    id: 'c-1',
    componentType: 'button',
    sourceUrl: 'https://example.com/',
    capturedAt: '2026-01-01T00:00:00.000Z',
    styles: { backgroundColor: 'rgba(0, 0, 0, 0)' },
    inheritedBackgroundColor: backdrop,
  }
  return surfaceTone(record)
}

describe('compositeBackground', () => {
  it('reads a faint tinted row on a white page as near-white, not black', () => {
    const color = compositeBackground(['rgba(0, 0, 0, 0.04)', 'rgb(255, 255, 255)'])
    expect(color).toBe('rgb(245, 245, 245)')
    expect(toneOn(color as string)).toBe('light')
  })

  it('reads a frosted layer on a dark page as light, but not as white', () => {
    const color = compositeBackground(['rgba(255, 255, 255, 0.8)', 'rgb(12, 14, 22)'])
    expect(color).toBe('rgb(206, 207, 208)')
    expect(color).not.toBe('rgb(255, 255, 255)')
    expect(toneOn(color as string)).toBe('light')
  })

  it('stops at the first opaque layer', () => {
    expect(compositeBackground(['rgb(10, 20, 30)', 'rgb(255, 255, 255)'])).toBe('rgb(10, 20, 30)')
  })

  it('stacks several translucent layers in the order the walk found them', () => {
    expect(
      compositeBackground(['rgba(255, 0, 0, 0.5)', 'rgba(0, 0, 255, 0.5)', 'rgb(0, 0, 0)']),
    ).toBe('rgb(128, 0, 64)')
  })

  it('reports nothing when nothing opaque is behind the translucent layers', () => {
    // Laying them over an assumed white canvas would be recording a value
    // nobody measured.
    expect(compositeBackground(['rgba(0, 0, 0, 0.04)'])).toBeNull()
    expect(compositeBackground([])).toBeNull()
  })

  it('refuses a layer it cannot read rather than guessing at it', () => {
    expect(compositeBackground(['color(srgb 0 0 0 / 0.5)', 'rgb(255, 255, 255)'])).toBeNull()
  })
})

describe('paintsOwnSurface', () => {
  it('counts a fill, a border and a shadow of the element\'s own', () => {
    expect(paintsOwnSurface(filled('rgb(255, 255, 255)'))).toBe(true)
    expect(paintsOwnSurface(describeAs({ borderWidth: 1 }))).toBe(true)
    expect(paintsOwnSurface(describeAs({ hasShadow: true }))).toBe(true)
  })

  it('does not count the background showing through it', () => {
    expect(paintsOwnSurface(onTop('rgb(255, 255, 255)'))).toBe(false)
  })
})

describe('wrapperReason', () => {
  it('flags the transparent, unpadded div the cursor actually lands on', () => {
    // apple.com/tr/store: transparent, no border, padding 0px, and it came back
    // as a `card`.
    expect(wrapperReason(onTop('rgb(255, 255, 255)', { width: 980, height: 420 }))).toBe(
      'it paints no background, border or shadow of its own',
    )
  })

  it('flags the 128px page section for the same reason, not a different one', () => {
    // Padding is not the evidence: a transparent box with no border and no
    // shadow is invisible whatever its padding, which is why one rule catches
    // both the 0px and the 128px case.
    expect(wrapperReason(onTop('rgb(10, 12, 20)', { width: 900, padding: [128, 0, 128, 0] }))).toBe(
      'it paints no background, border or shadow of its own',
    )
  })

  it('flags a full-bleed hero even when it does paint a background', () => {
    expect(wrapperReason(filled('rgb(10, 12, 20)', { width: 1440, viewportWidth: 1440, height: 600 }))).toBe(
      'it is as wide as the whole viewport',
    )
  })

  it('passes a real card: a fill, a border and some padding', () => {
    expect(
      wrapperReason(
        filled('rgb(255, 255, 255)', {
          width: 360,
          height: 220,
          borderWidth: 1,
          padding: [24, 24, 24, 24],
          hasBlockChildren: true,
        }),
      ),
    ).toBeNull()
  })

  it('passes a ghost button, which is a border and nothing else', () => {
    expect(
      wrapperReason(onTop('rgb(255, 255, 255)', { tagName: 'button', borderWidth: 1, width: 120, height: 40 })),
    ).toBeNull()
  })

  it('passes a heading, which paints nothing and is still a component', () => {
    // The exception that has to be carved out: text is visible because it is
    // text. Flagging every `<h1>` as a wrapper would make the warning noise.
    expect(wrapperReason(onTop('rgb(255, 255, 255)', { tagName: 'h1', textLength: 28, height: 40 }))).toBeNull()
  })

  it('passes a Chrome checkbox, which draws itself through the UA stylesheet', () => {
    const checkbox = onTop('rgb(255, 255, 255)', { tagName: 'input', inputType: 'checkbox', width: 13, height: 13 })
    expect(drawsItself(checkbox)).toBe(true)
    expect(wrapperReason(checkbox)).toBeNull()
  })

  it('passes a range input, which paints no background and is plainly a control', () => {
    expect(
      wrapperReason(onTop('rgb(255, 255, 255)', { tagName: 'input', inputType: 'range', width: 160, height: 16 })),
    ).toBeNull()
  })

  it('passes an icon-only svg button, which has no text and no fill', () => {
    expect(wrapperReason(onTop('rgb(255, 255, 255)', { tagName: 'svg', width: 24, height: 24 }))).toBeNull()
    expect(
      wrapperReason(onTop('rgb(255, 255, 255)', { tagName: 'button', childElementCount: 1, width: 32, height: 32 })),
    ).toBeNull()
  })

  it('still flags a self-drawn element that spans the viewport', () => {
    expect(wrapperReason(onTop('rgb(255, 255, 255)', { tagName: 'video', width: 1440, viewportWidth: 1440 }))).toBe(
      'it is as wide as the whole viewport',
    )
  })

  it('still flags a transparent section that merely contains text', () => {
    // Text somewhere inside is not the same as being text: this one has block
    // children, so what the cursor is on is the container, not the words.
    expect(
      wrapperReason(
        onTop('rgb(255, 255, 255)', { textLength: 240, hasBlockChildren: true, childElementCount: 4, width: 900 }),
      ),
    ).toBe('it paints no background, border or shadow of its own')
  })
})

describe('boundarySummary', () => {
  it('states the fill, the border and the padding it measured', () => {
    expect(
      boundarySummary(
        filled('rgb(255, 255, 255)', { borderWidth: 1, padding: [16, 24, 16, 24] }),
      ),
    ).toBe('rgb(255, 255, 255) · 1px border · 16/24px padding')
  })

  it('says whose background it is when the element paints none', () => {
    expect(boundarySummary(onTop('rgb(12, 14, 22)'))).toBe('transparent, on rgb(12, 14, 22) · no border · no padding')
  })

  it('says so when nothing up the chain paints one either', () => {
    expect(boundarySummary(describeAs({ padding: [8, 8, 8, 8] }))).toBe('no background · no border · 8px padding')
  })

  it('mentions a shadow, and only when there is one', () => {
    expect(boundarySummary(filled('rgb(255, 255, 255)', { hasShadow: true }))).toContain('shadow')
    expect(boundarySummary(filled('rgb(255, 255, 255)'))).not.toContain('shadow')
  })

  it('spells four different paddings out', () => {
    expect(boundarySummary(describeAs({ padding: [8, 16, 24, 32] }))).toContain('8/16/24/32px padding')
  })
})
