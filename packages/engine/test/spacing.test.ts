/**
 * Base-unit selection and snapping.
 *
 * The snapping rule is the one place the engine deliberately rewrites source
 * values, so its edges are pinned here.
 */
import { describe, expect, it } from 'vitest'
import { BASE_FIT_THRESHOLD, CANDIDATE_BASES, baseFit, chooseBase, snapSpacing } from '../src/index'

describe('baseFit', () => {
  it('is the share of non-zero observations that are exact multiples', () => {
    expect(baseFit([8, 16, 24, 32], 8)).toBe(1)
    expect(baseFit([8, 16, 12, 4], 8)).toBe(0.5)
  })

  it('ignores zeros, which are multiples of everything and prove nothing', () => {
    expect(baseFit([0, 0, 0, 8, 12], 8)).toBe(0.5)
  })

  it('treats an all-zero set as a perfect fit rather than dividing by zero', () => {
    expect(baseFit([0, 0], 8)).toBe(1)
  })
})

describe('chooseBase', () => {
  it('adopts 8px when the evidence is 8px-clean', () => {
    expect(chooseBase([8, 16, 24, 8, 32, 8])).toEqual({ base: 8, fit: 1, fellBack: false })
  })

  it('prefers the largest fitting base', () => {
    expect(chooseBase([4, 8, 16, 24]).base).toBe(4)
    expect(chooseBase([8, 16, 24, 40]).base).toBe(8)
  })

  it('falls back to the smallest candidate and says so when nothing fits', () => {
    const result = chooseBase([7, 10, 13, 15, 8])
    expect(result.base).toBe(CANDIDATE_BASES[CANDIDATE_BASES.length - 1])
    expect(result.fellBack).toBe(true)
    expect(result.fit).toBeLessThan(BASE_FIT_THRESHOLD)
  })

  it('does not adopt a base that only barely fits', () => {
    // 5 of 6 is 0.833, under the 0.85 threshold: adopting 8 here would rewrite
    // a sixth of the source spacing.
    expect(chooseBase([8, 16, 24, 32, 40, 12]).base).toBe(4)
  })
})

describe('snapSpacing', () => {
  it('leaves exact multiples alone', () => {
    expect(snapSpacing(16, 8)).toBe(16)
    expect(snapSpacing(12, 4)).toBe(12)
  })

  it('rounds to the nearest multiple', () => {
    expect(snapSpacing(13, 4)).toBe(12)
    expect(snapSpacing(15, 4)).toBe(16)
  })

  it('breaks exact .5 ties upward', () => {
    expect(snapSpacing(6, 4)).toBe(8)
    expect(snapSpacing(12, 8)).toBe(16)
  })

  it('never collapses a visible gap to zero', () => {
    expect(snapSpacing(1, 8)).toBe(8)
    expect(snapSpacing(3, 8)).toBe(8)
  })

  it('keeps zero at zero', () => {
    expect(snapSpacing(0, 8)).toBe(0)
  })
})
