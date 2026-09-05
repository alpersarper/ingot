/**
 * Radius, shadow and typography scale selection.
 */
import { describe, expect, it } from 'vitest'
import { distill, parseShadow } from '../src/index'
import type { CaptureRecord, CaptureSet, ComponentType } from '../src/index'

function set(captures: CaptureRecord[]): CaptureSet {
  return {
    schemaVersion: 1,
    id: 'unit-set',
    name: 'Unit set',
    description: 'Synthesised for a unit test.',
    captures,
  }
}

let counter = 0
function capture(styles: Record<string, string>, componentType: ComponentType = 'card'): CaptureRecord {
  counter += 1
  return {
    schemaVersion: 1,
    id: `c-${counter}`,
    componentType,
    sourceUrl: 'https://example.com/',
    capturedAt: '2026-01-01T00:00:00.000Z',
    styles: { backgroundColor: '#ffffff', color: '#1a1a1a', ...styles },
  }
}

function corners(px: string): Record<string, string> {
  return {
    borderTopLeftRadius: px,
    borderTopRightRadius: px,
    borderBottomRightRadius: px,
    borderBottomLeftRadius: px,
  }
}

function type(size: string, lineHeight: string, weight = '400', family = 'Inter, sans-serif'): Record<string, string> {
  return { fontSize: size, lineHeight, fontWeight: weight, fontFamily: family }
}

describe('radius scale', () => {
  it('names the three most used radii by size, so md always sits between sm and lg', () => {
    const tokens = distill(
      set([
        capture(corners('4px')),
        capture(corners('4px')),
        capture(corners('6px')),
        capture(corners('8px')),
      ]),
    )
    expect(tokens.radius.steps.sm?.value).toBe(4)
    expect(tokens.radius.steps.md?.value).toBe(6)
    expect(tokens.radius.steps.lg?.value).toBe(8)
  })

  it('breaks a three-way tie toward the median rather than an end', () => {
    const tokens = distill(
      set([
        capture(corners('4px')),
        capture(corners('8px')),
        capture(corners('16px')),
        capture(corners('64px')),
      ]),
    )
    // All four are equally frequent; the one furthest from the median is dropped.
    expect(tokens.radius.steps.lg?.value).toBe(16)
    expect(tokens.diagnostics.some((d) => d.code === 'radius.truncated')).toBe(true)
  })

  it('derives the neighbours of a single observed radius', () => {
    const tokens = distill(set([capture(corners('8px')), capture(corners('8px'))]))
    expect(tokens.radius.steps.md?.value).toBe(8)
    expect(tokens.radius.steps.sm?.value).toBe(4)
    expect(tokens.radius.steps.lg?.value).toBe(16)
    expect(tokens.radius.steps.sm?.provenance.decision.strategy).toBe('derived')
  })

  it('emits a full step only when a pill was actually captured', () => {
    expect(distill(set([capture(corners('8px'))])).radius.steps.full).toBeUndefined()
    expect(distill(set([capture(corners('8px')), capture(corners('9999px'))])).radius.steps.full?.value).toBe(9999)
  })
})

describe('parseShadow', () => {
  it('splits layers on top-level commas only', () => {
    const shadow = parseShadow('0 2px 5px -1px rgba(50, 50, 93, 0.25), 0 1px 3px -1px rgba(0, 0, 0, 0.3)')
    expect(shadow?.layers).toHaveLength(2)
    expect(shadow?.layers[0]).toEqual({
      offsetX: 0,
      offsetY: 2,
      blur: 5,
      spread: -1,
      color: 'rgb(50 50 93 / 0.25)',
    })
  })

  it('normalises equivalent notations to the same canonical css', () => {
    const canonical = '0px 1px 2px 0px rgb(0 0 0 / 0.32)'
    expect(parseShadow('0px 1px 2px 0px rgba(0, 0, 0, 0.32)')?.css).toBe(canonical)
    expect(parseShadow('0 1px 2px 0 rgb(0 0 0 / 0.32)')?.css).toBe(canonical)
  })

  it('fills in an omitted spread', () => {
    expect(parseShadow('0 1px 2px rgba(0, 0, 0, 0.32)')?.layers[0]?.spread).toBe(0)
  })

  it('rejects none and inset', () => {
    expect(parseShadow('none')).toBeUndefined()
    expect(parseShadow('inset 0 1px 2px rgba(0,0,0,0.2)')).toBeUndefined()
  })

  it('measures elevation as offset plus blur plus spread', () => {
    expect(parseShadow('0 2px 8px 0 rgba(0,0,0,0.1)')?.elevation).toBe(10)
  })
})

describe('shadow scale', () => {
  it('orders steps by elevation, not by how often each was seen', () => {
    const tokens = distill(
      set([
        capture({ boxShadow: '0px 8px 24px 0px rgba(0, 0, 0, 0.2)' }),
        capture({ boxShadow: '0px 1px 2px 0px rgba(0, 0, 0, 0.05)' }),
        capture({ boxShadow: '0px 1px 2px 0px rgba(0, 0, 0, 0.05)' }),
      ]),
    )
    expect(tokens.shadow.steps.sm?.value.css).toContain('1px 2px')
    expect(tokens.shadow.steps.md?.value.css).toContain('8px 24px')
  })

  it('invents no elevation scale when the sources use none', () => {
    const tokens = distill(set([capture({}), capture({})]))
    expect(Object.keys(tokens.shadow.steps)).toEqual(['none'])
    expect(tokens.diagnostics.some((d) => d.code === 'shadow.none-observed')).toBe(true)
  })
})

describe('typography scale', () => {
  it('takes the most used size as base and names the rest outward', () => {
    const tokens = distill(
      set([
        capture(type('14px', '20px'), 'typography'),
        capture(type('14px', '20px'), 'typography'),
        capture(type('12px', '16px'), 'typography'),
        capture(type('20px', '28px'), 'typography'),
        capture(type('32px', '40px'), 'typography'),
      ]),
    )
    expect(tokens.typography.baseSize).toBe(14)
    expect(tokens.typography.steps.map((step) => [step.value.name, step.value.fontSize])).toEqual([
      ['sm', 12],
      ['base', 14],
      ['lg', 20],
      ['xl', 32],
    ])
  })

  it('converts px line heights to unitless ratios', () => {
    const tokens = distill(set([capture(type('16px', '24px'), 'typography')]))
    expect(tokens.typography.steps.find((s) => s.value.name === 'base')?.value.lineHeight).toBe(1.5)
  })

  it('extends a single observed size into a usable scale', () => {
    const tokens = distill(set([capture(type('16px', '24px'), 'typography')]))
    expect(tokens.typography.steps.length).toBeGreaterThan(1)
    expect(tokens.diagnostics.some((d) => d.code === 'typography.single-size')).toBe(true)
  })

  it('separates a monospace stack from the body stack', () => {
    const tokens = distill(
      set([
        capture(type('14px', '20px', '400', 'Inter, sans-serif'), 'typography'),
        capture(type('14px', '20px', '400', 'Inter, sans-serif'), 'typography'),
        capture(type('14px', '20px', '400', '"Source Code Pro", Menlo, monospace'), 'typography'),
      ]),
    )
    expect(tokens.typography.families.sans.value).toBe('Inter, sans-serif')
    expect(tokens.typography.families.mono?.value).toBe('"Source Code Pro", Menlo, monospace')
  })

  it('flags sizes too close together to be distinct steps', () => {
    const tokens = distill(
      set([
        capture(type('15px', '20px'), 'typography'),
        capture(type('16px', '24px'), 'typography'),
        capture(type('16px', '24px'), 'typography'),
      ]),
    )
    expect(tokens.diagnostics.some((d) => d.code === 'typography.adjacent-sizes')).toBe(true)
  })
})

describe('border width', () => {
  it('ignores zero-width edges and takes the dominant drawn width', () => {
    const edges = (px: string) => ({
      borderTopWidth: px,
      borderRightWidth: px,
      borderBottomWidth: px,
      borderLeftWidth: px,
      borderStyle: 'solid',
    })
    const tokens = distill(set([capture(edges('1px')), capture(edges('1px')), capture(edges('2px')), capture({})]))
    expect(tokens.border.width.value).toBe(1)
  })

  it('falls back to a 1px hairline when nothing draws a border', () => {
    const tokens = distill(set([capture({})]))
    expect(tokens.border.width.value).toBe(1)
    expect(tokens.border.width.provenance.decision.strategy).toBe('derived')
  })
})
