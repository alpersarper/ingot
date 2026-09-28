/**
 * The claims the selection bar makes, tested without rendering anything.
 *
 * The type mix is a statement about the evidence a kit would be distilled from,
 * the warnings are statements about what that evidence will cost, and the slug
 * becomes `tokens.source.setId`. All of them are wrong in ways that are
 * invisible on screen, which is why they are functions rather than JSX.
 */
import { describe, expect, it } from 'vitest'
import { groupSlug, selectionWarnings, typeMix } from '@/workbench/selection'
import type { CaptureSummary, GroupSummary } from '@/lib/api'
import type { CaptureRecord } from '@ingot/engine'

function capture(id: string, componentType: string, styles: CaptureRecord['styles'] = {}): CaptureSummary {
  const sourceUrl = 'https://example.com/pricing'
  return {
    id,
    componentType,
    sourceUrl,
    capturedAt: '2026-02-11T09:14:22.000Z',
    tags: [],
    hasScreenshot: false,
    record: {
      schemaVersion: 1,
      id,
      componentType: componentType as CaptureRecord['componentType'],
      sourceUrl,
      capturedAt: '2026-02-11T09:14:22.000Z',
      styles,
    },
  }
}

/**
 * A capture off a light page, and one off a dark page: a card by its own fill,
 * anything else by the backdrop it was measured on.
 */
function onPage(id: string, type: string, backdrop: string): CaptureSummary {
  if (type === 'card') return capture(id, type, { backgroundColor: backdrop })
  const summary = capture(id, type, { backgroundColor: 'rgba(0, 0, 0, 0)' })
  summary.record.inheritedBackgroundColor = backdrop
  return summary
}
const onLight = (id: string, type = 'card'): CaptureSummary => onPage(id, type, 'rgb(255, 255, 255)')
const onDark = (id: string, type = 'card'): CaptureSummary => onPage(id, type, '#0b0f19')

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

describe('selectionWarnings', () => {
  it('says so when every capture is the same type', () => {
    // The selection that produced the complaint: seven captures off three real
    // sites, every one of them recorded as a card, and nothing said a word.
    const warnings = selectionWarnings([
      onLight('c1'),
      onLight('c2'),
      onLight('c3'),
      onLight('c4'),
      onLight('c5'),
      onLight('c6'),
      onLight('c7'),
    ])
    expect(warnings.map((warning) => warning.id)).toEqual(['one-type'])
    expect(warnings[0]?.text).toBe('All 7 of these are cards.')
    expect(warnings[0]?.remedy).toContain('sanctioned defaults')
  })

  it('holds off while a selection is plainly still being made', () => {
    expect(selectionWarnings([onLight('c1'), onLight('c2')])).toEqual([])
    expect(selectionWarnings([])).toEqual([])
  })

  it('says nothing about type once the selection is a mix', () => {
    expect(
      selectionWarnings([onLight('c1'), onLight('b1', 'button'), onLight('i1', 'input')]).map((w) => w.id),
    ).toEqual([])
  })

  it('counts the light and dark surfaces a selection mixes', () => {
    // Apple's white store page and BetterStack's dark one, in one kit.
    const warnings = selectionWarnings([
      onLight('a1', 'card'),
      onLight('a2', 'button'),
      onDark('b1', 'input'),
    ])
    expect(warnings.map((warning) => warning.id)).toEqual(['mixed-tone'])
    expect(warnings[0]?.text).toBe('These mix light and dark surfaces (2 light, 1 dark).')
    expect(warnings[0]?.remedy).toContain('one kit each')
  })

  it('judges a transparent capture by the background it was sitting on', () => {
    const ghost = capture('g1', 'button', { backgroundColor: 'rgba(0, 0, 0, 0)' })
    ghost.record.inheritedBackgroundColor = '#0b0f19'
    expect(selectionWarnings([onLight('a1', 'card'), ghost]).map((w) => w.id)).toEqual(['mixed-tone'])
  })

  it('does not call a brand fill a second theme', () => {
    // Two captures off the same light page. An indigo button is not a dark UI,
    // and a warning that fired here would be one nobody reads.
    expect(
      selectionWarnings([
        onLight('c1', 'card'),
        capture('b1', 'button', { backgroundColor: '#5e6ad2' }),
        onLight('i1', 'input'),
      ]),
    ).toEqual([])
  })

  it('does not call a near-black CTA on a light page a second theme', () => {
    // A navy button is a control, not a surface: its own fill says nothing
    // about which theme the page it came off is.
    expect(
      selectionWarnings([
        onLight('c1', 'card'),
        capture('b1', 'button', { backgroundColor: '#0a2540' }),
        onLight('i1', 'input'),
      ]),
    ).toEqual([])
  })

  it('can report both at once, in the order they were found', () => {
    const warnings = selectionWarnings([onLight('c1'), onLight('c2'), onDark('c3'), onDark('c4')])
    expect(warnings.map((warning) => warning.id)).toEqual(['one-type', 'mixed-tone'])
  })

  it('never says nothing can be done', () => {
    // Both of these are warnings, not gates: the reviewer may know exactly what
    // they want, and every remedy has to name a way forward.
    for (const warning of selectionWarnings([onLight('c1'), onLight('c2'), onDark('c3')])) {
      expect(warning.remedy.length).toBeGreaterThan(0)
      expect(warning.remedy.toLowerCase()).not.toContain('cannot')
    }
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
