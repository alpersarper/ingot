/**
 * The ship test.
 *
 * From quality run #1: *"two independent LLM runs against the same kit should
 * produce controls of the same height and padding. Today they cannot."* That is
 * not a test about how good the numbers are -- it is a test about whether there
 * is any room left to disagree. So it checks, for every kit and every control,
 * that the number exists, that it is on the kit's own scales, that `design.md`
 * states it, and that a reader can tell measurement from default.
 *
 * A consumer only ever reads `design.md`, so the assertions about the document
 * matter as much as the ones about the token file.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { distill, renderDesignMarkdown } from '@ingot/engine'
import type { ComponentRecipe, PristineTokens } from '@ingot/engine'
import { fixtureSetIds } from '../scripts/skeleton'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const setIds = await fixtureSetIds()

async function tokensFor(setId: string): Promise<PristineTokens> {
  return distill(JSON.parse(await readFile(join(ROOT, 'fixtures', setId, 'set.json'), 'utf8')))
}

/** Controls every kit has to be able to describe, whatever it captured. */
const ALWAYS: ReadonlyArray<ComponentRecipe['name']> = [
  'button.primary',
  'button.secondary',
  'button.ghost',
  'input',
  'select',
  'table.header',
  'table.row',
  'badge',
]

const GEOMETRY = ['paddingY', 'paddingX', 'radius', 'typeStep', 'fontWeight'] as const

describe.each(setIds)('%s', (setId) => {
  it('describes every control a screen needs', async () => {
    const { components } = await tokensFor(setId)
    const names = components.recipes.map((recipe) => recipe.name)
    for (const name of ALWAYS) expect(names, `${setId} cannot describe a ${name}`).toContain(name)
    expect(new Set(names).size, 'a recipe is emitted twice').toBe(names.length)
  })

  it('leaves nothing for a consumer to invent', async () => {
    const { components } = await tokensFor(setId)
    for (const recipe of components.recipes) {
      for (const field of GEOMETRY) {
        expect(recipe[field].value, `${recipe.name}.${field} is empty`).toBeDefined()
      }
      expect(recipe.height.value, `${recipe.name} has no height`).toBeGreaterThan(0)
      expect(recipe.paddingX.value).toBeGreaterThanOrEqual(0)
      expect(recipe.paddingY.value).toBeGreaterThanOrEqual(0)
      expect(recipe.fontWeight.value).toBeGreaterThanOrEqual(100)
    }
  })

  it('only ever points at values the rest of the kit defines', async () => {
    const tokens = await tokensFor(setId)
    const spacing = new Set(tokens.spacing.steps.map((step) => step.value.px))
    const radii = new Set(Object.keys(tokens.radius.steps))
    const types = new Set(tokens.typography.steps.map((step) => step.value.name))
    const weights = new Set(tokens.typography.weights.map((weight) => weight.value.value))
    const roles = new Set(Object.keys(tokens.color.roles).map((role) => `color.roles.${role}`))

    for (const recipe of tokens.components.recipes) {
      expect(spacing, `${recipe.name}.paddingY is off-scale`).toContain(recipe.paddingY.value)
      expect(spacing, `${recipe.name}.paddingX is off-scale`).toContain(recipe.paddingX.value)
      expect(radii, `${recipe.name}.radius names a missing step`).toContain(recipe.radius.value)
      expect(types, `${recipe.name}.typeStep names a missing step`).toContain(recipe.typeStep.value)
      expect(weights, `${recipe.name} uses a weight outside the system`).toContain(recipe.fontWeight.value)
      for (const path of Object.values(recipe.colors)) {
        if (path !== null) expect(roles, `${recipe.name} points at a missing role`).toContain(path)
      }
    }

    const { states } = tokens.components
    for (const path of [states.disabled.surface, states.disabled.foreground, states.selected.surface, states.selected.foreground, states.focusRing.colorRole]) {
      expect(roles, `${path} is not a role in this kit`).toContain(path)
    }
  })

  it('gives a height that can be recomputed from its own parts', async () => {
    // Two consumers who add the parts up themselves must land on the stated
    // number, or the stated number is decoration.
    const tokens = await tokensFor(setId)
    for (const recipe of tokens.components.recipes) {
      const step = tokens.typography.steps.find((entry) => entry.value.name === recipe.typeStep.value)
      expect(step, `${recipe.name} names a type step that does not exist`).toBeDefined()
      const lineBox = Math.round((step as NonNullable<typeof step>).value.fontSize * (step as NonNullable<typeof step>).value.lineHeight)
      const borderPx = recipe.colors.border === null ? 0 : tokens.border.width.value
      expect(recipe.height.value, `${recipe.name} height does not match its own parts`).toBe(
        recipe.paddingY.value * 2 + lineBox + borderPx * 2,
      )
    }
  })

  it('says of every value whether it was measured, derived or defaulted', async () => {
    const { components } = await tokensFor(setId)
    const kinds = new Set(['dominant-value', 'snapped-scale', 'derived', 'sanctioned-default'])
    for (const recipe of components.recipes) {
      for (const field of [...GEOMETRY, 'height'] as const) {
        const decision = recipe[field].provenance.decision
        expect(kinds, `${recipe.name}.${field} has an unexpected strategy`).toContain(decision.strategy)
        if (decision.strategy === 'derived' || decision.strategy === 'sanctioned-default') {
          expect(decision.derivation, `${recipe.name}.${field} is derived with no derivation`).toBeDefined()
        } else {
          expect(
            recipe[field].provenance.captureIds.length,
            `${recipe.name}.${field} claims observation but names no capture`,
          ).toBeGreaterThan(0)
        }
      }
    }
  })

  it('states a disabled pair made of real colours, held above its floor', async () => {
    const tokens = await tokensFor(setId)
    const { disabled } = tokens.components.states
    expect(tokens.color.roles.disabledSurface).toBeDefined()
    expect(tokens.color.roles.disabledForeground).toBeDefined()
    expect(disabled.ratio).toBeGreaterThanOrEqual(disabled.floor)
    // The failure this replaces: opacity: 0.5 measures 1:1 on a light kit.
    expect(disabled.ratio).toBeGreaterThan(1)
    expect(tokens.color.roles.disabledSurface?.value.hex).not.toBe(
      tokens.color.roles.disabledForeground?.value.hex,
    )
  })

  it('gives the focus ring a geometry, not just a colour', async () => {
    const { focusRing } = (await tokensFor(setId)).components.states
    expect(focusRing.width.value).toBeGreaterThanOrEqual(2)
    expect(focusRing.offset.value).toBeGreaterThanOrEqual(0)
    expect(focusRing.colorRole).toMatch(/^color\.roles\./)
  })

  it('publishes every control in design.md, where a consumer will actually look', async () => {
    const tokens = await tokensFor(setId)
    const markdown = renderDesignMarkdown(tokens)
    expect(markdown).toContain('## 7. Components')
    for (const recipe of tokens.components.recipes) {
      expect(markdown, `${recipe.name} is missing from design.md`).toContain(`\`${recipe.name}\``)
      expect(markdown, `${recipe.name}'s height is missing from design.md`).toContain(
        `| ${recipe.height.value}px `,
      )
      expect(markdown, `${recipe.name}'s padding is missing from design.md`).toContain(
        `${recipe.paddingY.value}px, ${recipe.paddingX.value}px`,
      )
    }
    // The gap that produced 1:1 disabled labels in two of the three kits.
    expect(markdown).toContain('disabledForeground')
    expect(markdown).toMatch(/Do \*\*not\*\* use `opacity`/)
  })
})
