/**
 * The component documentation model and the per-component markdown target.
 *
 * The bar for a per-component file is **self-sufficiency**: someone handed only
 * `button.md` has to be able to build the button correctly, without the library
 * document beside them. So these tests check that the numbers, the colours, the
 * states and the prohibitions are all actually in the file, and that nothing in
 * it names a value the kit does not carry.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { distill } from '../src/distill'
import { COMPONENT_DOC_IDS, componentDoc, componentDocs } from '../src/export/component-doc'
import { renderComponentMarkdown } from '../src/export/component-md'
import { applyOverrides } from '../src/tokens/overrides'
import type { CaptureSet } from '../src/capture/types'
import type { PristineTokens } from '../src/tokens/documents'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function kit(name: string): PristineTokens {
  return distill(JSON.parse(readFileSync(join(ROOT, 'fixtures', name, 'set.json'), 'utf8')) as CaptureSet)
}

const SETS = ['ghost-warm', 'linear-dark', 'stripe-light', 'messy-mixed'] as const

describe('the component doc model', () => {
  it.each(SETS)('describes every component for %s', (name) => {
    const docs = componentDocs(kit(name))
    expect(docs.map((doc) => doc.id)).toEqual([...COMPONENT_DOC_IDS])
    for (const doc of docs) {
      expect(doc.title.length).toBeGreaterThan(0)
      expect(doc.summary.length).toBeGreaterThan(0)
      expect(doc.usage.length).toBeGreaterThan(0)
      expect(doc.doNot.length).toBeGreaterThan(0)
      expect(doc.variants.length).toBeGreaterThan(0)
    }
  })

  it('never names a colour role the kit does not carry', () => {
    for (const name of SETS) {
      const tokens = kit(name)
      for (const doc of componentDocs(tokens)) {
        for (const row of doc.colors) {
          if (row.role === null) continue
          expect(tokens.color.roles[row.role], `${name}/${doc.id} names ${row.role}`).toBeDefined()
        }
      }
    }
  })

  it('offers a destructive button only when the kit has a destructive colour', () => {
    const withRed = kit('stripe-light')
    const withoutRed = kit('linear-dark')
    expect(withRed.color.roles.destructive).toBeDefined()
    expect(withoutRed.color.roles.destructive).toBeUndefined()
    expect(componentDoc(withRed, 'button').variants.map((variant) => variant.id)).toContain('destructive')
    expect(componentDoc(withoutRed, 'button').variants.map((variant) => variant.id)).not.toContain('destructive')
  })

  it('says so when a kit has no destructive colour, rather than going quiet', () => {
    const doc = componentDoc(kit('linear-dark'), 'button')
    expect(doc.summary).toContain('no destructive colour')
    expect(doc.doNot.join(' ')).toContain('arbitrary red')
  })
})

describe('per-component markdown', () => {
  const tokens = kit('ghost-warm')
  const markdown = renderComponentMarkdown(tokens, 'button')

  it('is deterministic', () => {
    expect(renderComponentMarkdown(kit('ghost-warm'), 'button')).toBe(markdown)
  })

  it('stands alone: geometry, colours, states, rules and a pasteable block', () => {
    const recipe = tokens.components.recipes.find((entry) => entry.name === 'button.primary')
    expect(markdown).toContain('# Button')
    expect(markdown).toContain(`${recipe?.height?.value}px`)
    expect(markdown).toContain(`${recipe?.paddingX.value}px`)
    expect(markdown).toContain(tokens.color.roles.primary?.value.hex as string)
    expect(markdown).toContain(tokens.color.roles.primaryForeground?.value.hex as string)
    expect(markdown).toContain('## 4. Custom properties')
    expect(markdown).toContain('--kit-color-primary:')
    expect(markdown).toContain('--kit-button-primary-height:')
    expect(markdown).toContain('## 5. States')
    expect(markdown).toContain('## 7. Do not')
    // Every state a button can be in has a row, not just the resting one.
    for (const state of ['hover', 'active', 'focus', 'disabled']) expect(markdown).toContain(state)
  })

  it('labels where each number came from, so a reader knows what to argue with', () => {
    expect(markdown).toContain('measured in the captures')
    expect(markdown).toMatch(/computed from another token|engine default/)
  })

  it('never mentions the whole-library document as a prerequisite', () => {
    expect(markdown).toContain('you do not need it to build a button correctly')
  })

  it('reads the article off the title rather than fixing it at "a"', () => {
    expect(renderComponentMarkdown(tokens, 'input')).toContain('you do not need it to build an input correctly')
    // A title that is not a count noun names itself instead of taking one.
    const typography = renderComponentMarkdown(tokens, 'typography')
    expect(typography).toContain('you do not need it to build the type scale correctly')
    expect(typography).not.toContain('build a typography')
  })

  it('numbers its sections in sequence even when a component has no states', () => {
    // The type scale is the one doc with no states, so it is the one that
    // exposed a hardcoded "## 6. Rules" sitting after a skipped "## 5".
    const typography = renderComponentMarkdown(tokens, 'typography')
    const numbers = [...typography.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]))
    expect(numbers).toEqual(numbers.map((_, index) => index + 1))
    expect(typography).not.toContain('## 5. States')

    for (const id of COMPONENT_DOC_IDS) {
      const sections = [...renderComponentMarkdown(tokens, id).matchAll(/^## (\d+)\. /gm)].map((match) =>
        Number(match[1]),
      )
      expect(sections).toEqual(sections.map((_, index) => index + 1))
    }
  })

  it('gives a recipe with no derived hover fill its own fill, never transparent', () => {
    const destructive = tokens.components.recipes.find((entry) => entry.name === 'button.destructive')
    // The fixture has to actually exercise the case, or this proves nothing.
    expect(destructive?.colors.hoverSurface).toBeNull()
    const fill = tokens.color.roles.destructive?.value.hex

    // The pasteable block must not hand the reader a button that vanishes.
    expect(markdown).toContain('--kit-button-destructive-hover-surface: var(--kit-color-destructive);')
    expect(markdown).not.toContain('--kit-button-destructive-hover-surface: transparent;')

    // ...and the colour table names the fill rather than reporting transparency.
    const doc = componentDoc(tokens, 'button')
    const hover = doc.colors.find((row) => row.label.startsWith('destructive hover fill'))
    expect(hover?.hex).toBe(fill)
    expect(hover?.role).toBe('destructive')
    expect(hover?.label).toContain('unchanged')

    // ...and the reader is told, in prose, that the fill is constant on hover.
    expect(doc.usage.join(' ')).toContain('no derived hover fill')
    expect(markdown).toContain('no distinct hover fill in this kit')
  })

  it('leaves a recipe that does have a hover shade pointing at it', () => {
    const primary = tokens.components.recipes.find((entry) => entry.name === 'button.primary')
    expect(primary?.colors.hoverSurface).toBe('color.roles.primaryHover')
    expect(markdown).toContain('--kit-button-primary-hover-surface: var(--kit-color-primary-hover);')
    const hover = componentDoc(tokens, 'button').colors.find((row) => row.label === 'primary hover fill')
    expect(hover?.hex).toBe(tokens.color.roles.primaryHover?.value.hex)
  })

  it.each(COMPONENT_DOC_IDS)('renders %s for every fixture set without an empty value', (id) => {
    for (const name of SETS) {
      const text = renderComponentMarkdown(kit(name), id)
      expect(text.startsWith('# ')).toBe(true)
      expect(text).not.toContain('undefined')
      expect(text).not.toContain('NaN')
    }
  })

  it('names a hand-set colour as one, in the file that paints with it', () => {
    const { tokens: next } = applyOverrides(tokens, [
      { path: 'color.roles.primary', value: '#1155cc', note: 'the brand is moving to blue' },
    ])
    const text = renderComponentMarkdown(next, 'button')
    expect(text).toContain('#1155cc')
    expect(text).toContain('set by hand in the panel')
    expect(text).toContain('## 8. What was overridden')
    expect(text).toContain('the brand is moving to blue')
  })

  it('carries an override into the component file it belongs to', () => {
    const { tokens: next } = applyOverrides(tokens, [
      { path: 'components.recipes.button.primary.paddingX', value: '24px', note: 'wider reads more deliberate' },
    ])
    const text = renderComponentMarkdown(next, 'button')
    expect(text).toContain('set by hand in the panel')
    expect(text).toContain('## 8. What was overridden')
    expect(text).toContain('wider reads more deliberate')
    expect(text).toContain('24px')
    // And it does not leak into a component that does not use that token.
    expect(renderComponentMarkdown(next, 'badge')).not.toContain('## 8. What was overridden')
  })
})
