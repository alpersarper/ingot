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
import { boundarySummary, paints, paintsOwnSurface, wrapperReason } from '../src/shared/boundary'
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
