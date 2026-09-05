/**
 * Near-duplicate colour clustering.
 */
import { describe, expect, it } from 'vitest'
import { CLUSTER_RADIUS, clusterColors, colorDistance, parseColor, readColors } from '../src/index'
import type { CaptureRecord } from '../src/index'

let counter = 0
function capture(styles: Record<string, string>): CaptureRecord {
  counter += 1
  return {
    schemaVersion: 1,
    id: `c-${counter}`,
    componentType: 'card',
    sourceUrl: 'https://example.com/',
    capturedAt: '2026-01-01T00:00:00.000Z',
    styles,
  }
}

function oklchOf(hex: string) {
  const parsed = parseColor(hex)
  if (!parsed) throw new Error(hex)
  return parsed.oklch
}

describe('readColors', () => {
  it('discards fully transparent colours instead of reading them as black', () => {
    const observations = readColors([capture({ backgroundColor: 'rgba(0, 0, 0, 0)', color: '#111111' })])
    expect(observations.map((o) => o.channel)).toEqual(['foreground'])
  })

  it('normalises every notation to the same hex key', () => {
    const observations = readColors([
      capture({ backgroundColor: '#5e6ad2' }),
      capture({ backgroundColor: 'rgb(94, 106, 210)' }),
    ])
    expect(new Set(observations.map((o) => o.hex))).toEqual(new Set(['#5e6ad2']))
  })
})

describe('clusterColors', () => {
  it('merges colours a reader cannot tell apart', () => {
    expect(colorDistance(oklchOf('#ffffff'), oklchOf('#fdfdfd'))).toBeLessThan(CLUSTER_RADIUS)
    const clusters = clusterColors(
      readColors([capture({ backgroundColor: '#ffffff' }), capture({ backgroundColor: '#fdfdfd' })]),
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members).toHaveLength(2)
  })

  it('keeps colours a reader can tell apart', () => {
    expect(colorDistance(oklchOf('#ffffff'), oklchOf('#f6f9fc'))).toBeGreaterThan(CLUSTER_RADIUS)
    const clusters = clusterColors(
      readColors([capture({ backgroundColor: '#ffffff' }), capture({ backgroundColor: '#f6f9fc' })]),
    )
    expect(clusters).toHaveLength(2)
  })

  it('represents a cluster by the member that fills a surface, not the alphabetical one', () => {
    // #0a74ec sorts first and is equally frequent, but #0b76ef is the fill.
    const clusters = clusterColors(
      readColors([capture({ backgroundColor: '#0b76ef' }), capture({ color: '#0a74ec' })]),
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.hex).toBe('#0b76ef')
  })

  it('counts observations per channel', () => {
    const clusters = clusterColors(
      readColors([
        capture({ backgroundColor: '#ffffff', color: '#ffffff' }),
        capture({ backgroundColor: '#ffffff' }),
      ]),
    )
    expect(clusters[0]?.channels).toEqual({ background: 2, foreground: 1, border: 0 })
  })

  it('does not chain a ramp of near-neighbours into one cluster', () => {
    // Each pair of adjacent greys is within the merge radius, but the ends are
    // far apart; comparing against the centroid keeps them separate.
    const clusters = clusterColors(
      readColors(
        ['#111111', '#161616', '#1b1b1b', '#202020', '#252525', '#2a2a2a', '#2f2f2f', '#343434'].map((hex) =>
          capture({ backgroundColor: hex }),
        ),
      ),
    )
    expect(clusters.length).toBeGreaterThan(1)
  })

  it('orders clusters by frequency, then by hex, with no dependence on input order', () => {
    const hexes = ['#ffffff', '#5e6ad2', '#5e6ad2', '#26282c']
    const forward = clusterColors(readColors(hexes.map((hex) => capture({ backgroundColor: hex }))))
    const reversed = clusterColors(readColors([...hexes].reverse().map((hex) => capture({ backgroundColor: hex }))))
    expect(forward.map((c) => c.hex)).toEqual(reversed.map((c) => c.hex))
    expect(forward[0]?.hex).toBe('#5e6ad2')
  })
})
