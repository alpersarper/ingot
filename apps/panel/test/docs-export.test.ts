/**
 * The static docs site.
 *
 * The promise is narrow and testable: one file, opens from `file://`, no
 * server, no network, and it renders every component with the kit's own tokens.
 * The way it keeps that promise is by *not* being a second renderer -- it is the
 * docs view rendered to a string -- so the tests here check both the
 * self-containment and that the components actually arrived.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPONENT_DOC_IDS, applyOverrides } from '@ingot/engine'
import type { TokensDocument } from '@ingot/engine'
import { docsHtmlFilename, renderDocsHtml } from '@/export/docs-html'

function repositoryRoot(): string {
  let candidate = process.cwd()
  while (!existsSyncSafe(join(candidate, 'examples', 'ghost-warm', 'tokens.json'))) {
    const parent = dirname(candidate)
    if (parent === candidate) throw new Error('could not find the repository root from ' + process.cwd())
    candidate = parent
  }
  return candidate
}

function existsSyncSafe(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

const ROOT = repositoryRoot()

function kit(name: string): TokensDocument {
  return JSON.parse(readFileSync(join(ROOT, 'examples', name, 'tokens.json'), 'utf8')) as TokensDocument
}

const SETS = ['ghost-warm', 'linear-dark', 'stripe-light', 'messy-mixed']

describe('the static docs export', () => {
  const tokens = kit('ghost-warm')
  const html = renderDocsHtml(tokens)

  it('inlines both stylesheets, so the page is styled and not just structured', () => {
    // Asserted explicitly because the failure mode is silent: an empty
    // stylesheet still produces a page with every element in it, and every
    // other assertion here would still pass.
    expect(html).toContain('.kit-button {')
    expect(html).toContain('.kit-docs-link {')
    expect(html).toContain('.kit-table th {')
    // The kit's own variables reach the components through this rule.
    expect(html).toMatch(/\.ingot-kit-root \{[\s\S]*--kit-color-background:/)
  })

  it('is one self-contained document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    // Nothing to fetch: no script, no external stylesheet, no remote font, no
    // image. A file that needed any of them would not open from file://.
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<link')
    expect(html).not.toContain('@import')
    expect(html).not.toContain('url(')
    expect(html).not.toMatch(/(?:src|href)="https?:/)
  })

  it('renders every component with the kit\'s own tokens', () => {
    for (const id of COMPONENT_DOC_IDS) expect(html).toContain(`id="component-${id}"`)
    // The canonical components are really in there, not a summary of them.
    expect(html).toContain('class="kit-button"')
    expect(html).toContain('class="kit-input"')
    expect(html).toContain('class="kit-select"')
    expect(html).toContain('class="kit-badge"')
    expect(html).toContain('class="kit-table"')
    expect(html).toContain('class="kit-card"')
    // And they are painted by this kit's variables, carrying this kit's values.
    expect(html).toContain(`--kit-color-primary: ${tokens.color.roles.primary?.value.hex};`)
    expect(html).toContain(`--kit-space-unit: ${tokens.spacing.baseUnit}px;`)
    expect(html).toContain(`--kit-border-width: ${tokens.border.width.value}px;`)
  })

  it('navigates without JavaScript', () => {
    for (const id of COMPONENT_DOC_IDS) expect(html).toContain(`href="#component-${id}"`)
  })

  it('states each value\'s origin, so a reader knows what to argue with', () => {
    expect(html).toContain('data-origin="observed"')
    expect(html).toMatch(/data-origin="(derived|filled)"/)
  })

  it('is deterministic, like every other export', () => {
    expect(renderDocsHtml(kit('ghost-warm'))).toBe(html)
  })

  it.each(SETS)('renders %s without leaving a value undefined', (name) => {
    const page = renderDocsHtml(kit(name))
    expect(page).not.toContain('undefined')
    expect(page).not.toContain('NaN')
    expect(page.length).toBeGreaterThan(20000)
  })

  it('carries an override into the page and labels it', () => {
    const { tokens: overridden } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: '10px', note: 'rounder' },
    ])
    const page = renderDocsHtml(overridden)
    expect(page).toContain('data-origin="overridden"')
    expect(page).toContain('user override')
    expect(page).toContain('--kit-radius-md: 10px;')
  })

  it('names the file so it can be found again', () => {
    expect(docsHtmlFilename('ghost-warm', 3)).toBe('ghost-warm-v3-docs.html')
  })
})
