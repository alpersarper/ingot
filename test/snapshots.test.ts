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
        `${pair.foreground.replace('color.roles.', '')} on ${pair.background.replace('color.roles.', '')} = ${pair.ratio}:1 ${pair.passes ? 'pass' : 'FAIL'}`,
    ),
    unusedColors: tokens.color.palette.filter((entry) => entry.role === null).map((entry) => entry.hex),
    mergedColors: tokens.color.palette
      .filter((entry) => entry.mergedFrom.length > 1)
      .map((entry) => `${entry.hex} <- ${entry.mergedFrom.map((m) => m.hex).join(' + ')}`),
    spacing: {
      baseUnit: tokens.spacing.baseUnit,
      fit: tokens.spacing.fit,
      steps: tokens.spacing.steps.map((step) => `${step.value.name}: ${step.value.px}px`),
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
    expect((await tokensFor('messy-mixed')).color.mode).toBe('light')
  })

  it('leaves the coherent sets free of warnings and the messy one full of them', async () => {
    const warnings = async (setId: string): Promise<string[]> =>
      (await tokensFor(setId)).diagnostics.filter((d) => d.level === 'warning').map((d) => d.code)

    expect(await warnings('linear-dark')).toEqual([])
    expect(await warnings('stripe-light')).toEqual([])
    expect((await warnings('messy-mixed')).length).toBeGreaterThan(0)
  })

  it('guarantees the contrast floor on every pair of every set', async () => {
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
      'border',
      'text',
      'textMuted',
      'primary',
      'primaryHover',
      'primaryActive',
      'primaryForeground',
    ]
    for (const setId of setIds) {
      const roles = (await tokensFor(setId)).color.roles
      for (const role of required) expect(roles[role], `${setId} is missing ${role}`).toBeDefined()
    }
  })
})
