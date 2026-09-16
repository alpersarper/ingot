/**
 * The component-type guess.
 *
 * These are not accuracy tests -- the popover lets a person correct the guess,
 * so being wrong is survivable. They pin the rules that would be *surprising*
 * if they changed: semantics beat appearance, and the call-to-action link that
 * every marketing page has is a button.
 */
import { describe, expect, it } from 'vitest'
import { guessComponentType } from '../src/shared/component-type'
import type { ElementDescriptor } from '../src/shared/component-type'

function describeAs(overrides: Partial<ElementDescriptor>): ElementDescriptor {
  return {
    tagName: 'div',
    role: null,
    inputType: null,
    hasBlockChildren: false,
    childElementCount: 0,
    textLength: 0,
    hasSurface: false,
    width: 200,
    height: 60,
    ...overrides,
  }
}

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

  it('reads a call-to-action link as a button', () => {
    // No tag and no role say so; a short link that paints its own surface and
    // is control-sized is the only evidence there is, and it is usually right.
    expect(
      guessComponentType(describeAs({ tagName: 'a', hasSurface: true, height: 40, textLength: 9 })),
    ).toBe('button')
  })

  it('does not read a whole linked panel as a button', () => {
    expect(
      guessComponentType(describeAs({ tagName: 'a', hasSurface: true, height: 220, hasBlockChildren: true })),
    ).toBe('card')
  })

  it('reads headings and paragraphs as typography', () => {
    expect(guessComponentType(describeAs({ tagName: 'h2', textLength: 24 }))).toBe('typography')
    expect(guessComponentType(describeAs({ tagName: 'p', textLength: 180, height: 90 }))).toBe('typography')
  })

  it('reads a bare text leaf as typography', () => {
    expect(guessComponentType(describeAs({ tagName: 'span', textLength: 11, height: 20 }))).toBe('typography')
  })

  it('falls back to card for a panel', () => {
    expect(
      guessComponentType(describeAs({ hasSurface: true, hasBlockChildren: true, childElementCount: 3, height: 240 })),
    ).toBe('card')
  })

  it('reads a tall empty surface as a card rather than as typography', () => {
    expect(guessComponentType(describeAs({ hasSurface: true, textLength: 4, height: 300 }))).toBe('card')
  })
})
