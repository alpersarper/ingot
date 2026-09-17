/**
 * The two claims the selection bar makes, tested without rendering anything.
 *
 * The type mix is a statement about the evidence a kit would be distilled from,
 * and the slug becomes `tokens.source.setId` -- both are wrong in ways that are
 * invisible on screen, which is why they are functions rather than JSX.
 */
import { describe, expect, it } from 'vitest'
import { groupSlug, typeMix } from '@/workbench/selection'
import type { CaptureSummary, GroupSummary } from '@/lib/api'

function capture(id: string, componentType: string): CaptureSummary {
  return {
    id,
    componentType,
    sourceUrl: 'https://example.com/pricing',
    capturedAt: '2026-02-11T09:14:22.000Z',
    tags: [],
    hasScreenshot: false,
  }
}

function group(slug: string): GroupSummary {
  return { id: `g-${slug}`, slug, name: slug, description: '', origin: 'manual', captureCount: 0 }
}

describe('typeMix', () => {
  it('counts each type and names it in the engine\'s own order', () => {
    const mix = typeMix([
      capture('t1', 'typography'),
      capture('c1', 'card'),
      capture('b1', 'button'),
      capture('b2', 'button'),
      capture('i1', 'input'),
      capture('t2', 'typography'),
      capture('t3', 'typography'),
      capture('b3', 'button'),
      capture('b4', 'button'),
      capture('c2', 'card'),
      capture('c3', 'card'),
      capture('i2', 'input'),
    ])
    // Fixed order, so the same selection reads the same way every time.
    expect(mix).toBe('4 buttons · 3 cards · 2 inputs · 3 type')
  })

  it('says one of a kind in the singular, and typography as "type"', () => {
    expect(typeMix([capture('b1', 'button'), capture('t1', 'typography')])).toBe('1 button · 1 type')
  })

  it('omits a type nothing was selected of', () => {
    expect(typeMix([capture('c1', 'card'), capture('c2', 'card')])).toBe('2 cards')
    expect(typeMix([])).toBe('')
  })

  it('names a type it does not know the word for rather than dropping it', () => {
    // A newer extension sending a fifth type must not silently shrink the count
    // the bar reports next to it.
    expect(typeMix([capture('b1', 'button'), capture('x1', 'badge')])).toBe('1 button · 1 badge')
  })
})

describe('groupSlug', () => {
  it('holds a name to the engine\'s slug rule', () => {
    expect(groupSlug('Warm editorial', [])).toBe('warm-editorial')
    expect(groupSlug('  Ghost / Warm!! ', [])).toBe('ghost-warm')
    expect(groupSlug('!!!', [])).toBe('group')
  })

  it('disambiguates against the groups that exist rather than asking the server twice', () => {
    expect(groupSlug('Warm', [group('warm')])).toBe('warm-2')
    expect(groupSlug('Warm', [group('warm'), group('warm-2')])).toBe('warm-3')
  })
})
