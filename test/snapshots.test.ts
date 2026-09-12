/**
 * Per-fixture snapshots.
 *
 * The committed `examples/` are already a byte-exact snapshot (see
 * `determinism.test.ts`), but a whole tokens.json is too large to review in a
 * diff. These snapshots capture the *decisions* -- the shape a reviewer
 * actually needs to see change -- so a tuning change to a heuristic shows up as
 * a readable diff rather than a thousand-line one.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { distill } from '@ingot/engine'
import type { ColorRoleName, TokensDocument } from '@ingot/engine'
import { fixtureSetIds } from '../scripts/skeleton'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const setIds = await fixtureSetIds()

/**
 * The sets held to the "I would ship this" quality bar. `messy-mixed` is
 * deliberately incoherent and is judged on degrading legibly instead, so it is
 * not in this list -- see README, "The fixture sets".
 */
const COHERENT_SETS = ['ghost-warm', 'linear-dark', 'stripe-light'] as const

async function tokensFor(setId: string): Promise<TokensDocument> {
  return distill(JSON.parse(await readFile(join(ROOT, 'fixtures', setId, 'set.json'), 'utf8')))
}

/** The decisions, without the provenance bulk that surrounds them. */
function summarise(tokens: TokensDocument): unknown {
  return {
    mode: tokens.color.mode,
    roles: Object.fromEntries(
      Object.entries(tokens.color.roles).map(([role, token]) => [
        role,
        {
          hex: token.value.hex,
          oklch: token.value.oklch,
          decision: token.provenance.decision.strategy,
          from: token.provenance.captureIds,
          ...(token.contrastAdjustment
            ? {
                adjusted: `${token.contrastAdjustment.from.hex} -> ${token.contrastAdjustment.to.hex}`,
                ratio: `${token.contrastAdjustment.ratioBefore} -> ${token.contrastAdjustment.ratioAfter}`,
                met: token.contrastAdjustment.met,
              }
            : {}),
        },
      ]),
    ),
    contrast: tokens.color.contrast.map(
      (pair) =>
        `${pair.foreground.replace('color.roles.', '')} on ${pair.background.replace('color.roles.', '')} = ${pair.ratio}:1 (floor ${pair.floor}) ${pair.passes ? 'pass' : 'FAIL'}`,
    ),
    unusedColors: tokens.color.palette.filter((entry) => entry.role === null).map((entry) => entry.hex),
    mergedColors: tokens.color.palette
      .filter((entry) => entry.mergedFrom.length > 1)
      .map((entry) => `${entry.hex} <- ${entry.mergedFrom.map((m) => m.hex).join(' + ')}`),
    spacing: {
      baseUnit: tokens.spacing.baseUnit,
      fit: tokens.spacing.fit,
      steps: tokens.spacing.steps.map((step) => `${step.value.name}: ${step.value.px}px ${step.value.band}`),
    },
    borderWidth: `${tokens.border.width.value}px`,
    radius: Object.fromEntries(
      Object.entries(tokens.radius.steps).map(([name, token]) => [name, `${token.value}px`]),
    ),
    shadow: Object.fromEntries(
      Object.entries(tokens.shadow.steps).map(([name, token]) => [name, token.value.css]),
    ),
    typography: {
      sans: tokens.typography.families.sans.value,
      mono: tokens.typography.families.mono?.value ?? null,
      baseSize: tokens.typography.baseSize,
      scaleRatio: tokens.typography.scaleRatio,
      weights: tokens.typography.weights.map((weight) => `${weight.value.value} ${weight.value.name}`),
      steps: tokens.typography.steps.map(
        (step) =>
          `${step.value.name}: ${step.value.fontSize}px/${step.value.lineHeight} @${step.value.fontWeight}${step.value.letterSpacing !== undefined ? ` ls${step.value.letterSpacing}` : ''}`,
      ),
    },
    components: {
      // The provenance strategy travels with each number: a recipe silently
      // sliding from "measured" to "defaulted" is exactly the kind of tuning
      // regression this snapshot exists to surface.
      recipes: tokens.components.recipes.map(
        (recipe) =>
          `${recipe.name}: ${recipe.height === undefined ? 'container' : `${recipe.height.value}px`}, pad ${recipe.paddingY.value}/${recipe.paddingX.value}, ` +
          `radius ${recipe.radius.value}, type ${recipe.typeStep.value}@${recipe.fontWeight.value} ` +
          `[${[recipe.paddingY, recipe.paddingX, recipe.radius, recipe.typeStep, recipe.fontWeight]
            .map((token) => token.provenance.decision.strategy)
            .join(',')}]`,
      ),
      states: [
        `disabled: ${tokens.components.states.disabled.ratio}:1 (floor ${tokens.components.states.disabled.floor})`,
        `focusRing: ${tokens.components.states.focusRing.width.value}px at +${tokens.components.states.focusRing.offset.value}px`,
      ],
    },
    diagnostics: tokens.diagnostics.map((diagnostic) => `${diagnostic.level} ${diagnostic.code}`),
  }
}

describe.each(setIds)('%s', (setId) => {
  it('distils to the expected decisions', async () => {
    expect(summarise(await tokensFor(setId))).toMatchSnapshot()
  })
})

describe('cross-set expectations', () => {
  it('reads the dark fixture as dark and the light ones as light', async () => {
    expect((await tokensFor('linear-dark')).color.mode).toBe('dark')
    expect((await tokensFor('stripe-light')).color.mode).toBe('light')
    expect((await tokensFor('ghost-warm')).color.mode).toBe('light')
    expect((await tokensFor('messy-mixed')).color.mode).toBe('light')
  })

  it('leaves the coherent sets free of warnings and the messy one full of them', async () => {
    const warnings = async (setId: string): Promise<string[]> =>
      (await tokensFor(setId)).diagnostics.filter((d) => d.level === 'warning').map((d) => d.code)

    // The ship bar applies to the coherent sets; messy-mixed is the smoke test
    // and is expected to warn. See README, "The fixture sets".
    //
    // One warning is allowed through, and only where it is true: a coherent set
    // whose captures carry no red has no error colour, and that is a product
    // question the engine is *right* to refuse and *required* to say out loud.
    // Silencing it to keep this list empty would be the quiet the whole
    // informed-consent ruling exists to stop. Every other warning is still a
    // regression, and a set that carries this code while its palette does have
    // a destructive colour is a bug in the restatement rather than an exception.
    for (const setId of COHERENT_SETS) {
      const tokens = await tokensFor(setId)
      const allowed = tokens.color.roles.destructive === undefined ? ['color.no-destructive'] : []
      expect(await warnings(setId), setId).toEqual(allowed)
    }
    expect((await warnings('messy-mixed')).length).toBeGreaterThan(0)
  })

  it('keeps the third coherent set a distinct subject rather than a third indigo', async () => {
    // linear-dark and stripe-light are both cool indigo/violet brands three
    // degrees apart. ghost-warm exists to give the quality bar a third
    // *character*, so its brand hue and its neutral temperature both have to
    // stand clear of them.
    const primaryHue = async (setId: string): Promise<number> =>
      (await tokensFor(setId)).color.roles.primary?.value.hue ?? 0
    const backgroundHue = async (setId: string): Promise<number> =>
      (await tokensFor(setId)).color.roles.background?.value.hue ?? 0

    const ghost = await primaryHue('ghost-warm')
    for (const other of ['linear-dark', 'stripe-light']) {
      const distance = Math.abs(ghost - (await primaryHue(other)))
      expect(Math.min(distance, 360 - distance), `ghost-warm shares a brand hue with ${other}`).toBeGreaterThan(60)
    }

    // Warm neutrals sit in the yellow half of the hue circle; the cool greys of
    // the other light set sit in the blue half.
    expect(await backgroundHue('ghost-warm')).toBeGreaterThan(45)
    expect(await backgroundHue('ghost-warm')).toBeLessThan(135)
  })

  it('guarantees each pair its own floor in every set', async () => {
    for (const setId of setIds) {
      const tokens = await tokensFor(setId)
      for (const pair of tokens.color.contrast) {
        expect(pair.ratio, `${setId}: ${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(pair.floor)
      }
    }
  })

  it('always fills the roles a kit cannot ship without', async () => {
    const required: ColorRoleName[] = [
      'background',
      'surface',
      'surfaceHover',
      'selectedSurface',
      'border',
      'text',
      'textMuted',
      'primary',
      'primaryHover',
      'primaryActive',
      'primaryForeground',
      'disabledSurface',
      'disabledForeground',
    ]
    for (const setId of setIds) {
      const roles = (await tokensFor(setId)).color.roles
      for (const role of required) expect(roles[role], `${setId} is missing ${role}`).toBeDefined()
    }
  })
})
