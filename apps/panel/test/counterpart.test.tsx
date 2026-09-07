/**
 * The counterpart theme: this kit's palette, in the mode it was not distilled in.
 *
 * It is a derivation, and a derivation shown next to measured values is exactly
 * where a preview starts lying. So these tests are about the two honesty
 * properties rather than the arithmetic: the page never presents a colour this
 * panel computed as one the captures supplied, and nothing derived here reaches
 * an export.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { originOf, tokenSlots } from '@ingot/engine'
import type { ColorRoleName, TokensDocument } from '@ingot/engine'
import { KitDocs } from '@/docs/KitDocs'
import { renderDocsHtml } from '@/export/docs-html'
import { counterpartTokens, modeOf } from '@/preview/counterpart'

function repositoryRoot(): string {
  let candidate = process.cwd()
  for (;;) {
    try {
      readFileSync(join(candidate, 'examples', 'ghost-warm', 'tokens.json'))
      return candidate
    } catch {
      const parent = dirname(candidate)
      if (parent === candidate) throw new Error('could not find the repository root from ' + process.cwd())
      candidate = parent
    }
  }
}

const ROOT = repositoryRoot()

function kit(name: string): TokensDocument {
  return JSON.parse(readFileSync(join(ROOT, 'examples', name, 'tokens.json'), 'utf8')) as TokensDocument
}

/** Roles whose value the derivation is allowed to move. */
const LADDER: ColorRoleName[] = [
  'background',
  'surface',
  'surfaceHover',
  'selectedSurface',
  'border',
  'text',
  'textMuted',
  'disabledSurface',
  'disabledForeground',
]

describe('the counterpart theme', () => {
  const tokens = kit('ghost-warm')
  const counterpart = counterpartTokens(tokens)

  it('flips the mode and moves the ladder', () => {
    expect(modeOf(tokens, 'counterpart')).toBe(counterpart.color.mode)
    expect(counterpart.color.mode).not.toBe(tokens.color.mode)
    for (const role of LADDER) {
      expect(counterpart.color.roles[role]?.value.hex).not.toBe(tokens.color.roles[role]?.value.hex)
    }
  })

  it('labels every role it rewrote as derived, not as measured', () => {
    for (const role of LADDER) {
      const token = counterpart.color.roles[role]
      expect(token).toBeDefined()
      const decision = token?.provenance.decision
      expect(decision?.strategy).toBe('derived')
      // The captures that produced the *other* mode's value are not evidence
      // for this one, so they do not travel with it.
      expect(token?.provenance.observed).toEqual([])
      expect(token?.provenance.captureIds).toEqual([])
      // ...and the derivation says what was actually done.
      expect(decision?.derivation?.detail).toMatch(/mirrored and re-spread|re-enforced/)
    }
  })

  it('leaves a role it did not move labelled as the kit labelled it', () => {
    // The brand keeps its hue, chroma and lightness, so it keeps its evidence:
    // relabelling it would be the same mislabelling in the other direction.
    expect(counterpart.color.roles.primary?.value.hex).toBe(tokens.color.roles.primary?.value.hex)
    expect(counterpart.color.roles.primary?.provenance).toEqual(tokens.color.roles.primary?.provenance)
  })

  it('never labels a panel-derived colour as measured, on any coherent kit', () => {
    for (const name of ['ghost-warm', 'linear-dark', 'stripe-light']) {
      const base = kit(name)
      const derived = counterpartTokens(base)
      for (const slot of tokenSlots(derived)) {
        if (!slot.path.startsWith('color.roles.')) continue
        const role = slot.path.slice('color.roles.'.length) as ColorRoleName
        if (slot.value === base.color.roles[role]?.value.hex) continue
        expect(originOf(slot)).toBe('derived')
      }
    }
  })

  it('restates every ratio against the palette on screen', () => {
    // The table is a measurement, so it may not keep reporting the kit's own
    // numbers once the colours under them have moved.
    const moved = counterpart.color.contrast.filter((pair, index) => {
      const before = tokens.color.contrast[index]
      return before !== undefined && before.ratio !== pair.ratio
    })
    expect(moved.length).toBeGreaterThan(0)
    for (const pair of counterpart.color.contrast) {
      expect(pair.passes).toBe(pair.ratio >= pair.floor)
    }
  })

  it('is deterministic, and never touches the document it derived from', () => {
    const before = JSON.stringify(tokens)
    expect(JSON.stringify(counterpartTokens(tokens))).toBe(JSON.stringify(counterpart))
    expect(JSON.stringify(tokens)).toBe(before)
  })
})

describe('the docs page under a derived palette', () => {
  const tokens = kit('ghost-warm')
  const counterpart = counterpartTokens(tokens)

  it('renders the derived roles as derived rather than as measured', () => {
    // The card doc paints with `surface`, `text`, `textMuted` and `border` --
    // four roles the captures really did supply, and four the counterpart moves.
    const labels = ['fill', 'text', 'body copy', 'border']

    const kitView = render(<KitDocs tokens={tokens} active="card" onSelect={() => {}} />)
    for (const label of labels) {
      const row = kitView.getByText(label, { selector: 'td' }).closest('tr')
      expect(within(row as HTMLElement).getByText('measured')).toBeTruthy()
    }
    kitView.unmount()

    render(<KitDocs tokens={counterpart} active="card" onSelect={() => {}} derivedPalette />)
    for (const label of labels) {
      const row = screen.getByText(label, { selector: 'td' }).closest('tr')
      // The value in this row was computed in the panel, so the page may not
      // present it as something the captures measured.
      expect(within(row as HTMLElement).queryByText('measured')).toBeNull()
      expect(within(row as HTMLElement).getByText('derived')).toBeTruthy()
    }
  })

  it('says the palette was derived here rather than claiming it was measured', () => {
    const { container, unmount } = render(
      <KitDocs tokens={counterpart} active="button" onSelect={() => {}} derivedPalette />,
    )
    expect(container.textContent).toContain('derived in the panel')
    expect(container.textContent).not.toContain('Every value on this page comes from that kit')
    unmount()

    const plain = render(<KitDocs tokens={tokens} active="button" onSelect={() => {}} />)
    expect(plain.container.textContent).not.toContain('derived in the panel')
  })
})

describe('the export under a derived palette', () => {
  it('never carries the counterpart: the kit ships in the mode it was distilled in', () => {
    const tokens = kit('ghost-warm')
    const html = renderDocsHtml(tokens)
    // The counterpart's own colours are not in the exported document...
    const counterpart = counterpartTokens(tokens)
    for (const role of LADDER) {
      const derivedHex = counterpart.color.roles[role]?.value.hex
      if (derivedHex === undefined || derivedHex === tokens.color.roles[role]?.value.hex) continue
      expect(html).not.toContain(derivedHex)
    }
    // ...and the page states the mode the kit was distilled in.
    expect(html).toContain(`--kit-color-background: ${tokens.color.roles.background?.value.hex}`)
    expect(html).not.toContain('derived in the panel')
  })
})
