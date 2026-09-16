/**
 * Capture ids.
 *
 * `docs/capture-record.md` makes one demand and the schema makes another:
 * recapturing an element must give the same id, and the id must be a lowercase
 * slug. Both are load-bearing -- the first is how provenance survives a
 * recapture, the second is how the panel's screenshot store derives a filename.
 */
import { describe, expect, it } from 'vitest'
import { captureIdFor, hostLabel, slugify } from '../src/shared/identity'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('slugify', () => {
  it('produces the shape the engine demands', () => {
    expect(slugify('Linear.app')).toBe('linear-app')
    expect(slugify('  --Weird__Name!!  ')).toBe('weird-name')
  })

  it('never produces the empty string, which is not a valid slug', () => {
    expect(slugify('///')).toBe('page')
  })
})

describe('hostLabel', () => {
  it('drops the www prefix so one site is one label', () => {
    expect(hostLabel('https://www.stripe.com/pricing')).toBe('stripe-com')
    expect(hostLabel('https://stripe.com/pricing')).toBe('stripe-com')
  })

  it('survives an address it cannot parse', () => {
    expect(hostLabel('not a url')).toBe('page')
  })
})

describe('captureIdFor', () => {
  const path = 'html/body/main/div:2/button'

  it('is a valid capture id', () => {
    expect(captureIdFor('https://linear.app/method', path)).toMatch(SLUG)
  })

  it('is the same for the same element on the same page', () => {
    expect(captureIdFor('https://linear.app/method', path)).toBe(captureIdFor('https://linear.app/method', path))
  })

  it('ignores the query and the fragment, which change without the page doing so', () => {
    expect(captureIdFor('https://linear.app/method?ref=hn#top', path)).toBe(
      captureIdFor('https://linear.app/method', path),
    )
  })

  it('separates two elements on one page', () => {
    expect(captureIdFor('https://linear.app/method', path)).not.toBe(
      captureIdFor('https://linear.app/method', 'html/body/main/div:2/a'),
    )
  })

  it('separates the same element on two pages of one site', () => {
    // Provenance is meant to show that a button was captured twice, from two
    // pages; collapsing them would hide half the evidence.
    expect(captureIdFor('https://linear.app/method', path)).not.toBe(
      captureIdFor('https://linear.app/pricing', path),
    )
  })

  it('names the site it came from', () => {
    expect(captureIdFor('https://stripe.com/pricing', path).startsWith('stripe-com-')).toBe(true)
  })
})
