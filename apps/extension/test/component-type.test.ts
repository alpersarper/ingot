/**
 * The component-type guess.
 *
 * These are not accuracy tests -- the popover makes a person choose, so being
 * wrong is survivable. They pin the rules that would be *surprising* if they
 * changed: semantics beat appearance, the call-to-action link that every
 * marketing page has is a button, and a box that paints nothing and reads as one
 * run of text is type rather than a card.
 */
import { describe, expect, it } from 'vitest'
import { guessComponentType } from '../src/shared/component-type'
import { describeAs, filled } from './element'

describe('guessComponentType', () => {
  it('reads a <button> as a button', () => {
    expect(guessComponentType(describeAs({ tagName: 'button', textLength: 6 }))).toBe('button')
  })

  it('reads a submit input as a button and a text input as an input', () => {
    expect(guessComponentType(describeAs({ tagName: 'input', inputType: 'submit' }))).toBe('button')
    expect(guessComponentType(describeAs({ tagName: 'input', inputType: 'email' }))).toBe('input')
  })

  it('trusts role over tag', () => {
    expect(guessComponentType(describeAs({ tagName: 'div', role: 'button' }))).toBe('button')
    expect(guessComponentType(describeAs({ tagName: 'div', role: 'textbox' }))).toBe('input')
  })

  it('reads a textarea and a select as inputs', () => {
    expect(guessComponentType(describeAs({ tagName: 'textarea' }))).toBe('input')
    expect(guessComponentType(describeAs({ tagName: 'select' }))).toBe('input')
  })

  it('reads a switch and a checkbox as inputs, not buttons', () => {
    // Pressing a button does something; setting one of these records something,
    // and of the four types `input` is what that is.
    expect(guessComponentType(describeAs({ tagName: 'div', role: 'switch' }))).toBe('input')
    expect(guessComponentType(describeAs({ tagName: 'span', role: 'checkbox' }))).toBe('input')
  })

  it('reads a <summary> as the control it is', () => {
    expect(guessComponentType(describeAs({ tagName: 'summary', textLength: 12 }))).toBe('button')
  })

  it('reads a call-to-action link as a button', () => {
    // No tag and no role say so; a short link that paints its own surface and
    // is control-sized is the only evidence there is, and it is usually right.
    expect(guessComponentType(filled('rgb(94, 106, 210)', { tagName: 'a', height: 40, textLength: 9 }))).toBe('button')
  })

  it('does not read a whole linked panel as a button', () => {
    expect(
      guessComponentType(filled('rgb(20, 22, 30)', { tagName: 'a', height: 220, hasBlockChildren: true })),
    ).toBe('card')
  })

  it('reads headings and paragraphs as typography', () => {
    expect(guessComponentType(describeAs({ tagName: 'h2', textLength: 24 }))).toBe('typography')
    expect(guessComponentType(describeAs({ tagName: 'p', textLength: 180, height: 90 }))).toBe('typography')
  })

  it('reads a bare text leaf as typography', () => {
    expect(guessComponentType(describeAs({ tagName: 'span', textLength: 11, height: 20 }))).toBe('typography')
  })

  it('reads a <div> whose whole content is a sentence as typography', () => {
    // The commonest shape on a real page: a text run with an inline `<strong>`
    // or `<a>` in it. It has an element child, so the old leaf rule called it a
    // card -- which put a phantom component in the library.
    expect(
      guessComponentType(describeAs({ tagName: 'div', textLength: 96, childElementCount: 2, height: 48 })),
    ).toBe('typography')
  })

  it('does not read a filled badge as typography', () => {
    expect(guessComponentType(filled('rgb(240, 240, 245)', { tagName: 'span', textLength: 3, height: 20 }))).toBe(
      'card',
    )
  })

  it('does not treat an inherited background as a surface of the element\'s own', () => {
    // A ghost heading on a dark page paints nothing itself. The inherited colour
    // is what is behind it, and reading it as the element's own fill would turn
    // every piece of text on a coloured page into a card.
    expect(
      guessComponentType(
        describeAs({
          tagName: 'span',
          textLength: 14,
          height: 20,
          painted: { color: 'rgb(12, 14, 22)', inherited: true },
        }),
      ),
    ).toBe('typography')
  })

  it('falls back to card for a panel', () => {
    expect(
      guessComponentType(
        filled('rgb(255, 255, 255)', { hasBlockChildren: true, childElementCount: 3, height: 240 }),
      ),
    ).toBe('card')
  })

  it('reads a tall empty surface as a card rather than as typography', () => {
    expect(guessComponentType(filled('rgb(255, 255, 255)', { textLength: 4, height: 300 }))).toBe('card')
  })
})
