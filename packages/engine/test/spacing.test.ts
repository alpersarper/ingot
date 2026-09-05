/**
 * Base-unit selection and snapping.
 *
 * The snapping rule is the one place the engine deliberately rewrites source
 * values, so its edges are pinned here.
 */
import { describe, expect, it } from 'vitest'
import {
  BASE_FIT_THRESHOLD,
  CANDIDATE_BASES,
  LAYOUT_TARGETS_PX,
  baseFit,
  chooseBase,
  distill,
  snapSpacing,
} from '../src/index'
import type { CaptureRecord } from '../src/index'

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

/**
 * The two bands.
 *
 * A capture is one component, so the largest length the evidence can supply is
 * that component's own padding -- 24px across every fixture set. The exported
 * spec forbids off-scale values, so before the layout band existed every page
 * gutter in every consumer collapsed onto that same 24px.
 */
describe('spacing bands', () => {
  const capture = (id: string, styles: Record<string, string>): CaptureRecord =>
    ({
      schemaVersion: 1,
      id,
      componentType: 'card',
      sourceUrl: 'https://example.com/',
      capturedAt: '2026-01-01T00:00:00.000Z',
      styles,
    }) as CaptureRecord

  const distilled = (padding: string) =>
    distill({
      schemaVersion: 1,
      id: 'demo',
      name: 'Demo',
      description: 'Demo.',
      captures: [
        capture('card', {
          color: '#111111',
          backgroundColor: '#ffffff',
          fontSize: '16px',
          fontWeight: '400',
          lineHeight: '24px',
          paddingTop: padding,
          paddingRight: padding,
          paddingBottom: padding,
          paddingLeft: padding,
        }),
      ],
    }).spacing

  it('labels everything up to the largest observation as component space', () => {
    const spacing = distilled('24px')
    const component = spacing.steps.filter((step) => step.value.band === 'component')
    expect(component.map((step) => step.value.px)).toEqual([0, 8, 16, 24])
    expect(spacing.largestObservedMultiple * spacing.baseUnit).toBe(24)
  })

  it('continues the series into layout range past the largest observation', () => {
    const layout = distilled('24px').steps.filter((step) => step.value.band === 'layout')
    expect(layout.map((step) => step.value.px)).toEqual([...LAYOUT_TARGETS_PX])
  })

  it('marks layout steps as extrapolated, never as evidence', () => {
    for (const step of distilled('24px').steps.filter((s) => s.value.band === 'layout')) {
      expect(step.provenance.captureIds).toEqual([])
      expect(step.provenance.observed).toEqual([])
      expect(step.provenance.decision.strategy).toBe('derived')
      expect(step.provenance.decision.derivation?.method).toBe('layout-scale-extension')
    }
  })

  it('does not extrapolate a length the captures already reached', () => {
    // A 48px padding puts 48 in the component band; only the steps above it are
    // extrapolated, and 48px is never emitted twice.
    const spacing = distilled('48px')
    const at48 = spacing.steps.filter((step) => step.value.px === 48)
    expect(at48).toHaveLength(1)
    expect(at48[0]?.value.band).toBe('component')
    expect(spacing.steps.filter((step) => step.value.band === 'layout').map((s) => s.value.px)).toEqual([64])
  })

  it('states the banding rule in prose the exported spec can quote', () => {
    const spacing = distilled('24px')
    expect(spacing.layoutRule).toContain('component steps')
    expect(spacing.layoutRule).toContain('layout')
    for (const px of LAYOUT_TARGETS_PX) expect(spacing.layoutRule).toContain(`${px}px`)
  })
})
