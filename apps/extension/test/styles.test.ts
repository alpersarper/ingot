/**
 * Style extraction, against the values a real browser actually returns.
 *
 * Every fixture in this file is a `getComputedStyle` answer Chrome gives on
 * some ordinary page -- `"50%"` radii, `"450"` weights from a variable font,
 * `"normal"` gaps, border colours on elements with no border. jsdom returns
 * none of those, which is exactly why the extractor takes a reader instead of
 * an element: the cases worth testing are the ones a fake DOM cannot produce.
 */
import { describe, expect, it } from 'vitest'
import { drawsBorder, extractStyles, normaliseGap, normaliseRadius, normaliseWeight } from '../src/shared/styles'
import type { StyleReader } from '../src/shared/styles'
import type { Rect } from '../src/shared/protocol'

const BOX: Rect = { x: 0, y: 0, width: 120, height: 40 }

/** A reader over a plain map; anything unset reads as the empty string. */
function reader(values: Record<string, string>): StyleReader {
  return (property) => values[property] ?? ''
}

/** What Chrome reports for a plain, unstyled `<div>`. Padded out per test. */
const BARE: Record<string, string> = {
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  fontFamily: 'Arial',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: 'normal',
  letterSpacing: 'normal',
  paddingTop: '0px',
  paddingRight: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
  marginTop: '0px',
  marginRight: '0px',
  marginBottom: '0px',
  marginLeft: '0px',
  gap: 'normal',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  borderTopStyle: 'none',
  borderRightStyle: 'none',
  borderBottomStyle: 'none',
  borderLeftStyle: 'none',
  borderTopColor: 'rgb(0, 0, 0)',
  borderRightColor: 'rgb(0, 0, 0)',
  borderBottomColor: 'rgb(0, 0, 0)',
  borderLeftColor: 'rgb(0, 0, 0)',
  borderTopLeftRadius: '0px',
  borderTopRightRadius: '0px',
  borderBottomRightRadius: '0px',
  borderBottomLeftRadius: '0px',
  boxShadow: 'none',
}

describe('normaliseRadius', () => {
  it('passes an ordinary px radius through', () => {
    expect(normaliseRadius('6px', BOX)).toBe('6px')
  })

  it('resolves a percentage against the box', () => {
    expect(normaliseRadius('25%', { ...BOX, width: 80, height: 100 })).toBe('20px')
  })

  it('reads a maximally-rounded corner as a pill rather than as half the box', () => {
    // A 40px-tall control with a 20px radius is a pill on screen. Reporting
    // "20px" would tell the engine it is a softly rounded rectangle.
    expect(normaliseRadius('20px', BOX)).toBe('9999px')
    expect(normaliseRadius('50%', BOX)).toBe('9999px')
  })

  it('takes the horizontal radius of an elliptical corner', () => {
    expect(normaliseRadius('10% 40%', { ...BOX, width: 100 })).toBe('10px')
    expect(normaliseRadius('10px 20px', BOX)).toBe('10px')
  })

  it('reads an elliptical corner as a pill when its horizontal radius fills the shorter side', () => {
    expect(normaliseRadius('24px 32px', BOX)).toBe('9999px')
  })

  it('applies the pill check to a resolved percentage against the shorter side', () => {
    // 45% of a 200px-wide, 40px-tall element is 90px -- the same corner a
    // direct "90px" would report as a pill, so the percentage must agree.
    expect(normaliseRadius('45%', { ...BOX, width: 200 })).toBe('9999px')
    expect(normaliseRadius('25%', { ...BOX, width: 80 })).toBe('9999px')
  })

  it('drops a value it cannot read as a length', () => {
    expect(normaliseRadius('', BOX)).toBeUndefined()
    expect(normaliseRadius('auto', BOX)).toBeUndefined()
  })
})

describe('normaliseWeight', () => {
  it('keeps a weight the schema already accepts', () => {
    expect(normaliseWeight('700')).toBe('700')
  })

  it('snaps a variable-font weight to the nearest hundred', () => {
    expect(normaliseWeight('450')).toBe('500')
    expect(normaliseWeight('325')).toBe('300')
  })

  it('clamps to the range the schema allows', () => {
    expect(normaliseWeight('1000')).toBe('900')
    expect(normaliseWeight('40')).toBe('100')
  })

  it('drops a keyword, because the schema takes numbers only', () => {
    expect(normaliseWeight('bold')).toBeUndefined()
  })
})

describe('normaliseGap', () => {
  it('drops the "normal" every non-flex, non-grid element reports', () => {
    expect(normaliseGap('normal')).toBeUndefined()
  })

  it('takes the row gap -- the first -- of a grid\'s two gaps', () => {
    // The shorthand is `<row-gap> <column-gap>`; the row gap travels.
    expect(normaliseGap('10px 24px')).toBe('10px')
  })

  it('keeps a single gap', () => {
    expect(normaliseGap('8px')).toBe('8px')
  })
})

describe('drawsBorder', () => {
  it('is false for the phantom border every element reports', () => {
    expect(drawsBorder(reader(BARE))).toBe(false)
  })

  it('is false when a style is set but the width is zero', () => {
    expect(drawsBorder(reader({ ...BARE, borderTopStyle: 'solid' }))).toBe(false)
  })

  it('is true when one side actually draws', () => {
    expect(drawsBorder(reader({ ...BARE, borderBottomStyle: 'solid', borderBottomWidth: '1px' }))).toBe(true)
  })
})

describe('extractStyles', () => {
  it('omits the border colour when no border is drawn', () => {
    // docs/capture-record.md: browsers report border-color at zero width, and
    // it is usually the text colour. Carrying it would invent a border token.
    const styles = extractStyles(reader(BARE), BOX)
    expect(styles.borderColor).toBeUndefined()
    expect(styles.borderStyle).toBe('none')
  })

  it('carries the colour of the side that draws, not of the top by default', () => {
    const styles = extractStyles(
      reader({
        ...BARE,
        borderBottomStyle: 'solid',
        borderBottomWidth: '1px',
        borderBottomColor: 'rgb(220, 223, 232)',
      }),
      BOX,
    )
    expect(styles.borderStyle).toBe('solid')
    expect(styles.borderColor).toBe('rgb(220, 223, 232)')
  })

  it('passes colours through exactly as the browser reported them', () => {
    const styles = extractStyles(reader({ ...BARE, backgroundColor: 'rgb(99, 91, 255)' }), BOX)
    expect(styles.backgroundColor).toBe('rgb(99, 91, 255)')
    // A fully transparent background is evidence of nothing, and the engine
    // already knows that -- so it travels verbatim rather than being guessed at.
    expect(extractStyles(reader(BARE), BOX).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('keeps "normal" for line height and letter spacing', () => {
    const styles = extractStyles(reader(BARE), BOX)
    expect(styles.lineHeight).toBe('normal')
    expect(styles.letterSpacing).toBe('normal')
  })

  it('drops a length it cannot read as px', () => {
    const styles = extractStyles(reader({ ...BARE, paddingLeft: 'auto', marginTop: '' }), BOX)
    expect(styles.paddingLeft).toBeUndefined()
    expect(styles.marginTop).toBeUndefined()
  })

  it('keeps a negative margin, which the engine drops for itself', () => {
    expect(extractStyles(reader({ ...BARE, marginTop: '-8px' }), BOX).marginTop).toBe('-8px')
  })

  it('reads a whole button the way a page would report it', () => {
    const styles = extractStyles(
      reader({
        ...BARE,
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(99, 91, 255)',
        fontFamily: '"Sohne Var", Helvetica, sans-serif',
        fontSize: '14px',
        fontWeight: '535',
        lineHeight: '20px',
        letterSpacing: '0.2px',
        paddingTop: '8px',
        paddingRight: '16px',
        paddingBottom: '8px',
        paddingLeft: '16px',
        borderTopLeftRadius: '6px',
        borderTopRightRadius: '6px',
        borderBottomRightRadius: '6px',
        borderBottomLeftRadius: '6px',
        boxShadow: 'rgba(0, 0, 0, 0.08) 0px 1px 1px 0px',
      }),
      BOX,
    )
    expect(styles).toEqual({
      color: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(99, 91, 255)',
      fontFamily: '"Sohne Var", Helvetica, sans-serif',
      fontSize: '14px',
      fontWeight: '500',
      lineHeight: '20px',
      letterSpacing: '0.2px',
      paddingTop: '8px',
      paddingRight: '16px',
      paddingBottom: '8px',
      paddingLeft: '16px',
      marginTop: '0px',
      marginRight: '0px',
      marginBottom: '0px',
      marginLeft: '0px',
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderStyle: 'none',
      borderTopLeftRadius: '6px',
      borderTopRightRadius: '6px',
      borderBottomRightRadius: '6px',
      borderBottomLeftRadius: '6px',
      boxShadow: 'rgba(0, 0, 0, 0.08) 0px 1px 1px 0px',
    })
  })
})
