/**
 * User overrides.
 *
 * The product stance is that a reviewer disagreeing with the engine is the
 * experience, so these tests are about the properties that stance needs to be
 * true: the override wins, the evidence survives, the document stays
 * deterministic, and everything the override invalidated is either recomputed
 * or said out loud.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { distill, serializeTokens } from '../src/distill'
import { round } from '../src/util/num'
import { renderDesignMarkdown } from '../src/export/design-md'
import { renderComponentMarkdown } from '../src/export/component-md'
import {
  applyOverrides,
  baselineFor,
  originOf,
  overriddenSlots,
  overrideRejection,
  planOverrideWrite,
  readTokenValue,
  standingConflict,
  tokenSlots,
} from '../src/tokens/overrides'
import type { OverrideWrite, OverrideWriteReport, TokenOverride } from '../src/tokens/overrides'
import { asPristine } from '../src/tokens/documents'
import type { PristineTokens } from '../src/tokens/documents'
import type { CaptureSet } from '../src/capture/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function fixture(name: string): CaptureSet {
  return JSON.parse(readFileSync(join(ROOT, 'fixtures', name, 'set.json'), 'utf8')) as CaptureSet
}

function kit(name = 'ghost-warm'): PristineTokens {
  return distill(fixture(name))
}

/**
 * The document a question about `path` is asked of, with no other overrides.
 *
 * Redundancy and conflict are baseline questions, so even the simplest test has
 * to name the document it is asking about -- which is the point of the split.
 */
function baseline(tokens: PristineTokens, path: string, others: TokenOverride[] = []) {
  return baselineFor(tokens, others, path)
}

/**
 * The cells of one markdown table row.
 *
 * `design.md` is a generated text contract, so splitting a row the way a
 * markdown reader does is the way to ask how many columns it really has: an
 * unescaped pipe in a cell shows up here as an extra column.
 */
function splitRow(line: string): string[] {
  return line
    .replace(/^\| /, '')
    .replace(/ \|$/, '')
    .split(/(?<!\\) \| /)
    .map((cell) => cell.trim())
}

describe('the slot enumeration', () => {
  const tokens = kit()
  const slots = tokenSlots(tokens)

  it('covers every group a reviewer can edit', () => {
    const groups = new Set(slots.map((slot) => slot.group))
    expect([...groups].sort()).toEqual(['border', 'color', 'component', 'radius', 'shadow', 'spacing', 'state', 'typography'])
  })

  it('gives every slot a unique path that reads back', () => {
    const paths = slots.map((slot) => slot.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const slot of slots) expect(readTokenValue(tokens, slot.path)).toBe(slot.value)
  })

  it('is stable across runs, because the panel lists it in order', () => {
    expect(tokenSlots(kit()).map((slot) => slot.path)).toEqual(slots.map((slot) => slot.path))
  })

  it('labels a distilled kit with no overrides as anything but overridden', () => {
    expect(slots.every((slot) => originOf(slot) !== 'overridden')).toBe(true)
    expect(overriddenSlots(tokens)).toEqual([])
  })
})

describe('applying an override', () => {
  it('replaces the value and stamps the provenance without touching the input', () => {
    const tokens = kit()
    const before = serializeTokens(tokens)
    const { tokens: next, report } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: '10px', note: 'the captured 6px reads timid at this scale' },
    ])

    expect(report.rejected).toEqual([])
    expect(report.applied).toEqual([
      {
        path: 'radius.steps.md',
        value: '10px',
        engineValue: `${tokens.radius.steps.md?.value}px`,
        note: 'the captured 6px reads timid at this scale',
      },
    ])
    expect(next.radius.steps.md?.value).toBe(10)
    expect(serializeTokens(tokens)).toBe(before)

    const decision = next.radius.steps.md?.provenance.decision
    expect(decision?.strategy).toBe('user-override')
    expect(decision?.chosen).toBe('10px')
    expect(decision?.note).toBe('the captured 6px reads timid at this scale')
    // The evidence is untouched: an override changes the answer, not the sources.
    expect(decision?.supersedes?.chosen).toBe(`${tokens.radius.steps.md?.value}px`)
    expect(next.radius.steps.md?.provenance.observed).toEqual(tokens.radius.steps.md?.provenance.observed)
  })

  it('is deterministic: same document and same overrides, byte-identical output', () => {
    const overrides: TokenOverride[] = [
      { path: 'color.roles.primary', value: '#1155cc' },
      { path: 'radius.steps.md', value: '10px' },
      { path: 'components.recipes.button.primary.paddingX', value: '20px' },
    ]
    const a = applyOverrides(kit(), overrides)
    const b = applyOverrides(kit(), [...overrides].reverse())
    expect(serializeTokens(a.tokens)).toBe(serializeTokens(b.tokens))
  })

  it('announces itself in the diagnostics, so nobody reads a hand-set value as evidence', () => {
    const { tokens } = applyOverrides(kit(), [{ path: 'border.width', value: '2px' }])
    const note = tokens.diagnostics.find((diagnostic) => diagnostic.code === 'override.applied')
    expect(note?.level).toBe('info')
    expect(note?.message).toContain('border.width = 2px')
  })

  it('refuses a path this kit does not have, rather than inventing a token', () => {
    const { tokens, report } = applyOverrides(kit(), [{ path: 'color.roles.tertiary', value: '#ff0000' }])
    expect(report.rejected[0]?.path).toBe('color.roles.tertiary')
    expect(tokens.diagnostics.some((diagnostic) => diagnostic.code === 'override.rejected')).toBe(true)
  })

  it('refuses a value it cannot parse, rather than writing NaN into the document', () => {
    const { tokens, report } = applyOverrides(kit(), [{ path: 'radius.steps.md', value: 'quite round' }])
    expect(report.rejected[0]?.reason).toContain('pixel length')
    expect(tokens.radius.steps.md?.provenance.decision.strategy).not.toBe('user-override')
  })

  it('refuses a step name the kit does not carry', () => {
    const { report } = applyOverrides(kit(), [
      { path: 'components.recipes.button.primary.typeStep', value: '4xl' },
    ])
    expect(report.rejected[0]?.reason).toContain('no `4xl` type step')
  })
})

describe('judging a candidate before it is stored', () => {
  it('refuses a candidate that agrees with the engine, which is not an override', () => {
    const tokens = kit()
    const current = `${tokens.radius.steps.md?.value}px`
    expect(overrideRejection(baseline(tokens, 'radius.steps.md'), { path: 'radius.steps.md', value: current })).toContain(
      'is not an override',
    )
    expect(
      overrideRejection(baseline(tokens, 'radius.steps.md'), { path: 'radius.steps.md', value: current }, 'create'),
    ).toContain('is not an override')
    // Two spellings of one value are one value, so the check is on the
    // canonical form rather than on the string the reviewer happened to type.
    expect(
      overrideRejection(baseline(tokens, 'radius.steps.md'), {
        path: 'radius.steps.md',
        value: ` ${tokens.radius.steps.md?.value} `,
      }),
    ).toContain('is not an override')
  })

  it('refuses a path the kit has no slot for, and a value it cannot read', () => {
    const tokens = kit()
    expect(
      overrideRejection(baseline(tokens, 'color.roles.tertiary'), { path: 'color.roles.tertiary', value: '#ff0000' }),
    ).toContain('no such token')
    expect(
      overrideRejection(baseline(tokens, 'radius.steps.md'), { path: 'radius.steps.md', value: 'quite round' }),
    ).toContain('pixel length')
  })

  it('passes a candidate that really does disagree', () => {
    expect(
      overrideRejection(baseline(kit(), 'radius.steps.md'), { path: 'radius.steps.md', value: '10px' }),
    ).toBeUndefined()
  })

  it('lets a reviewer restate a value on an override they already own', () => {
    const tokens = kit()
    const current = `${tokens.radius.steps.md?.value}px`
    // Editing is a different question from creating. Resubmitting the same
    // value -- which is what a note-only edit sends -- must not be refused, or
    // a reviewer could never add a reason to an override the evidence has
    // caught up with.
    expect(
      overrideRejection(baseline(tokens, 'radius.steps.md'), { path: 'radius.steps.md', value: current }, 'edit'),
    ).toBeUndefined()
    // ...but an edit is still held to everything else.
    expect(
      overrideRejection(baseline(tokens, 'radius.steps.md'), { path: 'radius.steps.md', value: 'quite round' }, 'edit'),
    ).toContain('pixel length')
  })

  it('judges redundancy against the baseline, not against the stored distillation', () => {
    const tokens = kit()
    // Moving the border re-derives every bordered control's height, so the
    // engine's current answer for that height is no longer the stored one.
    const path = 'components.recipes.button.secondary.height'
    const withBorder = baseline(tokens, path, [{ path: 'border.width', value: '3px' }])
    const stored = readTokenValue(tokens, path) as string
    expect(readTokenValue(withBorder, path)).not.toBe(stored)

    // Pinning the height back to what it was is a real disagreement with what
    // the kit now says, so it is not redundant.
    expect(overrideRejection(withBorder, { path, value: stored })).toBeUndefined()
    expect(overrideRejection(withBorder, { path, value: readTokenValue(withBorder, path) as string })).toContain(
      'is not an override',
    )
  })

  it('refuses a font stack carrying characters that would escape a CSS rule', () => {
    const tokens = kit()
    for (const hostile of ['Bad} .x{color:red', 'Inter; color: red', 'Inter</style><script>', 'Inter\\65 ']) {
      expect(
        overrideRejection(baseline(tokens, 'typography.families.sans'), {
          path: 'typography.families.sans',
          value: hostile,
        }),
      ).toContain(
        'family names separated by commas',
      )
    }
    // A real stack still lands, quotes, hyphens and all.
    expect(
      overrideRejection(baseline(tokens, 'typography.families.sans'), {
        path: 'typography.families.sans',
        value: '"Helvetica Neue", -apple-system, .SFNSText, system_ui, sans-serif',
      }),
    ).toBeUndefined()
  })

  it('never writes a hostile font stack into the document', () => {
    const tokens = kit()
    const { tokens: next, report } = applyOverrides(tokens, [
      { path: 'typography.families.sans', value: 'Bad} .x{color:red' },
    ])
    expect(report.applied).toEqual([])
    expect(report.rejected[0]?.reason).toContain('family names separated by commas')
    expect(next.typography.families.sans.value).toBe(tokens.typography.families.sans.value)
  })
})

describe('a standing override the evidence catches up with', () => {
  const tokens = kit()
  const engineValue = `${tokens.radius.steps.md?.value}px`
  const result = applyOverrides(tokens, [
    { path: 'radius.steps.md', value: engineValue, baseValue: '4px', note: 'rounder reads friendlier' },
  ])

  it('keeps the reviewer\'s attribution rather than handing the credit back', () => {
    const decision = result.tokens.radius.steps.md?.provenance.decision
    expect(decision?.strategy).toBe('user-override')
    expect(decision?.note).toBe('rounder reads friendlier')
    expect(result.report.rejected).toEqual([])
    expect(result.report.applied.map((entry) => entry.path)).toEqual(['radius.steps.md'])
    expect(result.tokens.diagnostics.some((entry) => entry.code === 'override.rejected')).toBe(false)
  })

  it('reports the convergence once, as information rather than as a problem', () => {
    const notes = result.tokens.diagnostics.filter((entry) => entry.code === 'override.now-agrees')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.level).toBe('info')
    expect(notes[0]?.message).toContain(`radius.steps.md = ${engineValue}`)
    expect(result.report.converged).toEqual([{ path: 'radius.steps.md', value: engineValue }])
  })

  it('is a convergence rather than a conflict, even though the base value moved', () => {
    expect(result.report.conflicts).toEqual([])
    expect(result.tokens.diagnostics.some((entry) => entry.code === 'override.conflict')).toBe(false)
  })

  it('covers every converged path in the one diagnostic', () => {
    const borderWidth = `${tokens.border.width.value}px`
    const { tokens: next, report } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: engineValue, baseValue: '4px' },
      { path: 'border.width', value: borderWidth, baseValue: '3px' },
    ])
    expect(report.converged.map((entry) => entry.path)).toEqual(['border.width', 'radius.steps.md'])
    const notes = next.diagnostics.filter((entry) => entry.code === 'override.now-agrees')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.message).toContain('border.width')
    expect(notes[0]?.message).toContain('radius.steps.md')
  })

})

describe('what an override invalidates', () => {
  it('re-measures the contrast pairs a colour override moved', () => {
    const tokens = kit()
    // A near-white text colour on a near-white page: guaranteed to fail.
    const { tokens: next } = applyOverrides(tokens, [{ path: 'color.roles.text', value: '#f4f2ee' }])

    const pair = next.color.contrast.find(
      (entry) => entry.foreground === 'color.roles.text' && entry.background === 'color.roles.background',
    )
    expect(pair?.passes).toBe(false)
    expect(pair?.ratio).toBeLessThan(4.5)
    const warning = next.diagnostics.find((diagnostic) => diagnostic.code === 'override.contrast')
    expect(warning?.level).toBe('warning')
    expect(warning?.message).toContain('text on background')
  })

  it('drops the engine\'s contrast adjustment from a colour a person replaced', () => {
    const tokens = kit('messy-mixed')
    const adjusted = Object.entries(tokens.color.roles).find(([, token]) => token?.contrastAdjustment !== undefined)
    expect(adjusted).toBeDefined()
    const [role] = adjusted as [string, unknown]
    const { tokens: next } = applyOverrides(tokens, [{ path: `color.roles.${role}`, value: '#123456' }])
    expect(next.color.roles[role as 'primary']?.contrastAdjustment).toBeUndefined()
  })

  it('re-derives a control height when the padding under it moves', () => {
    const tokens = kit()
    const recipe = tokens.components.recipes.find((entry) => entry.name === 'button.primary')
    const paddingY = recipe?.paddingY.value ?? 0
    const { tokens: next } = applyOverrides(tokens, [
      { path: 'components.recipes.button.primary.paddingY', value: `${paddingY + 4}px` },
    ])
    const after = next.components.recipes.find((entry) => entry.name === 'button.primary')
    expect(after?.height?.value).toBe((recipe?.height?.value ?? 0) + 8)
    expect(after?.height?.provenance.decision.derivation?.detail).toContain('recomputed after an override')
  })

  it('re-derives the shades computed from a colour a person replaced', () => {
    const tokens = kit()
    const before = tokens.color.roles.primaryHover?.value.hex
    const { tokens: next } = applyOverrides(tokens, [{ path: 'color.roles.primary', value: '#1155cc' }])

    // The brand moved to blue, so the states of the brand move with it. Leaving
    // them behind would ship a blue button that hovers to the old green.
    expect(next.color.roles.primary?.value.hex).toBe('#1155cc')
    expect(next.color.roles.primaryHover?.value.hex).not.toBe(before)
    for (const role of ['primaryHover', 'primaryActive', 'selectedSurface'] as const) {
      const decision = next.color.roles[role]?.provenance.decision
      // No derivation may still name a hex the document no longer contains.
      expect(decision?.derivation?.detail).not.toContain(before as string)
      expect(decision?.derivation?.detail).toContain('set by hand')
      expect(decision?.derivation?.from).toContain('color.roles.primary')
    }
  })

  it('holds a re-derived shade to the floor the kit guarantees on it', () => {
    const tokens = kit()
    const { tokens: next } = applyOverrides(tokens, [{ path: 'color.roles.primary', value: '#1155cc' }])
    for (const pair of next.color.contrast) {
      if (pair.background !== 'color.roles.primaryHover' && pair.background !== 'color.roles.primaryActive') continue
      expect(pair.passes).toBe(true)
    }
  })

  it('leaves a shade the reviewer set by hand alone when its base moves', () => {
    const tokens = kit()
    const { tokens: next } = applyOverrides(tokens, [
      { path: 'color.roles.primary', value: '#1155cc' },
      { path: 'color.roles.primaryHover', value: '#223344' },
    ])
    expect(next.color.roles.primaryHover?.value.hex).toBe('#223344')
    expect(next.color.roles.primaryHover?.provenance.decision.strategy).toBe('user-override')
    // ...and the shades that are not hand-set still follow the new brand.
    expect(next.color.roles.primaryActive?.provenance.decision.strategy).toBe('derived')
  })

  it('says a state collapsed rather than shipping two identical fills', () => {
    // Black in a light kit: hover and pressed both move darker, and both are
    // already at the end of the ladder, so the whole offset is consumed.
    const { tokens: next } = applyOverrides(kit(), [{ path: 'color.roles.primary', value: '#000000' }])
    expect(next.color.roles.primaryHover?.value.hex).toBe(next.color.roles.primary?.value.hex)

    const collapsed = next.diagnostics.filter((entry) => entry.code === 'color.state-collapsed')
    // Stated once, under the code the engine already uses for this, rather than
    // added to the one that described the distilled palette.
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.message).toContain('primaryHover and primary')
  })

  it('restates a collapse the engine reported against the palette now on screen', () => {
    // No fixture distils with a collapse any more -- the chroma rescue is why --
    // so the stale statement is manufactured the only honest way there is: a
    // black primary really does collapse, and the document it produces is the
    // stored distillation a later reviewer would be overriding.
    const collapsedKit = applyOverrides(kit('linear-dark'), [
      { path: 'color.roles.primary', value: '#000000' },
    ]).tokens
    const tokens = asPristine(collapsedKit)
    const stale = tokens.diagnostics.filter((entry) => entry.code === 'color.state-collapsed')
    expect(stale).toHaveLength(1)

    const { tokens: next } = applyOverrides(tokens, [{ path: 'color.roles.primary', value: '#1155cc' }])
    const fresh = next.diagnostics.filter((entry) => entry.code === 'color.state-collapsed')
    // Described once, and by the palette on screen -- never by the one the
    // engine distilled and the reviewer has since replaced.
    expect(fresh.length).toBeLessThanOrEqual(1)
    for (const diagnostic of fresh) expect(stale).not.toContainEqual(diagnostic)
  })

  it('stays deterministic once the shades are re-derived', () => {
    const overrides: TokenOverride[] = [{ path: 'color.roles.primary', value: '#1155cc' }]
    expect(serializeTokens(applyOverrides(kit(), overrides).tokens)).toBe(
      serializeTokens(applyOverrides(kit(), overrides).tokens),
    )
  })

  it('leaves the shades alone when no colour was overridden', () => {
    const tokens = kit()
    const { tokens: next } = applyOverrides(tokens, [{ path: 'radius.steps.md', value: '10px' }])
    for (const role of ['primaryHover', 'primaryActive', 'selectedSurface', 'surfaceHover'] as const) {
      expect(next.color.roles[role]).toEqual(tokens.color.roles[role])
    }
  })

  it('drops a contrast diagnostic describing a walk on a colour a person replaced', () => {
    const tokens = kit()
    const stale = tokens.diagnostics.filter(
      (entry) => entry.code === 'color.contrast-adjusted' || entry.code === 'color.contrast-unmet',
    )
    // The fixture has to carry one, or this proves nothing.
    expect(stale.length).toBeGreaterThan(0)
    const role = (stale[0]?.path ?? '').replace('color.roles.', '')
    expect(tokens.color.roles[role as 'primary']?.contrastAdjustment).toBeDefined()

    const { tokens: next } = applyOverrides(tokens, [{ path: `color.roles.${role}`, value: '#112233' }])
    // The record went from the token, so the sentence describing it goes too --
    // it names two hexes the document no longer holds.
    expect(next.color.roles[role as 'primary']?.contrastAdjustment).toBeUndefined()
    const survivors = next.diagnostics.filter(
      (entry) =>
        (entry.code === 'color.contrast-adjusted' || entry.code === 'color.contrast-unmet') &&
        entry.path === `color.roles.${role}`,
    )
    expect(survivors).toEqual([])
  })

  it('keeps a contrast diagnostic for a colour nobody touched, at the level the ratios now say', () => {
    const tokens = kit('messy-mixed')
    const adjusted = tokens.diagnostics.filter(
      (entry) => entry.code === 'color.contrast-adjusted' || entry.code === 'color.contrast-unmet',
    )
    expect(adjusted.length).toBeGreaterThan(0)

    // Override something else entirely; the untouched roles keep their notes.
    const { tokens: next } = applyOverrides(tokens, [{ path: 'color.roles.background', value: '#ffffff' }])
    const failing = new Set(
      next.color.contrast.filter((pair) => !pair.passes).flatMap((pair) => [pair.foreground, pair.background]),
    )
    for (const entry of next.diagnostics) {
      if (entry.code !== 'color.contrast-adjusted' && entry.code !== 'color.contrast-unmet') continue
      const role = (entry.path ?? '').replace('color.roles.', '') as 'primary'
      // Every surviving note still describes a walk the document carries...
      expect(next.color.roles[role]?.contrastAdjustment).toBeDefined()
      // ...and its level agrees with the ratios as they now stand, so a pair an
      // override fixed stops being reported as unmet in `design.md`.
      expect(entry.code).toBe(failing.has(entry.path ?? '') ? 'color.contrast-unmet' : 'color.contrast-adjusted')
      expect(entry.level).toBe(failing.has(entry.path ?? '') ? 'warning' : 'info')
    }
  })

  it('does not claim agreement on a slot the engine yielded to a person on', () => {
    const tokens = kit()
    const path = 'components.recipes.button.secondary.height'
    const pristine = readTokenValue(tokens, path) as string

    const { tokens: next, report } = applyOverrides(tokens, [
      { path: 'border.width', value: '3px' },
      { path, value: pristine },
    ])

    // The pin holds...
    expect(readTokenValue(next, path)).toBe(pristine)
    // ...but the engine wanted 42px here and stepped aside, so saying it now
    // independently chooses the reviewer's number would be false.
    expect(report.converged.map((entry) => entry.path)).not.toContain(path)
    const notes = next.diagnostics.filter((entry) => entry.code === 'override.now-agrees')
    for (const note of notes) expect(note.message).not.toContain(path)
  })

  it('does not claim agreement on a colour shade pinned back to its pre-override value', () => {
    const tokens = kit()
    const shade = 'color.roles.primaryHover'
    const pristine = readTokenValue(tokens, shade) as string

    const { tokens: next, report } = applyOverrides(tokens, [
      { path: 'color.roles.primary', value: '#1155cc' },
      { path: shade, value: pristine },
    ])

    expect(readTokenValue(next, shade)).toBe(pristine)
    expect(next.color.roles.primaryHover?.provenance.decision.strategy).toBe('user-override')
    expect(report.converged.map((entry) => entry.path)).not.toContain(shade)
    expect(next.diagnostics.some((entry) => entry.code === 'override.now-agrees')).toBe(false)
  })

  it('still reports agreement on a slot nothing was re-derived under', () => {
    const tokens = kit()
    const radius = `${tokens.radius.steps.md?.value}px`
    const { report } = applyOverrides(tokens, [
      { path: 'border.width', value: '3px' },
      { path: 'radius.steps.md', value: radius, baseValue: '4px' },
    ])
    expect(report.converged.map((entry) => entry.path)).toEqual(['radius.steps.md'])
  })

  it('leaves a height the reviewer set by hand exactly where they put it', () => {
    const tokens = kit()
    const recipe = tokens.components.recipes.find((entry) => entry.name === 'button.primary')
    const { tokens: next } = applyOverrides(tokens, [
      { path: 'components.recipes.button.primary.height', value: '44px' },
      { path: 'components.recipes.button.primary.paddingY', value: `${(recipe?.paddingY.value ?? 0) + 4}px` },
    ])
    const after = next.components.recipes.find((entry) => entry.name === 'button.primary')
    expect(after?.height?.value).toBe(44)
    expect(after?.height?.provenance.decision.strategy).toBe('user-override')
  })
})

describe('conflicts between an override and new evidence', () => {
  it('reports the disagreement and keeps the override', () => {
    const tokens = kit()
    const engineValue = `${tokens.radius.steps.md?.value}px`
    const { tokens: next, report } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: '10px', baseValue: '4px' },
    ])

    expect(report.conflicts).toHaveLength(1)
    expect(report.conflicts[0]).toMatchObject({ path: 'radius.steps.md', value: '10px', baseValue: '4px', engineValue })
    // The override still wins. Anything else would make an override provisional.
    expect(next.radius.steps.md?.value).toBe(10)
    const warning = next.diagnostics.find((diagnostic) => diagnostic.code === 'override.conflict')
    expect(warning?.level).toBe('warning')
    expect(warning?.message).toContain(engineValue)
  })

  it('stays quiet when the evidence has not moved', () => {
    const tokens = kit()
    const { report } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: '10px', baseValue: `${tokens.radius.steps.md?.value}px` },
    ])
    expect(report.conflicts).toEqual([])
  })
})

describe('a conflict is judged against the slot\'s own baseline', () => {
  const tokens = kit()
  const path = 'components.recipes.input.height'
  const borderOverride: TokenOverride = { path: 'border.width', value: '3px' }
  /** The engine's answer for the height once the wider border has re-derived it. */
  const rederived = readTokenValue(baselineFor(tokens, [borderOverride], path), path) as string

  it('moves a dependent slot, so the stored distillation is not the engine\'s answer', () => {
    expect(rederived).not.toBe(readTokenValue(tokens, path))
  })

  it('reports no conflict when the reviewer disagreed with exactly that answer', () => {
    // The reviewer sees the re-derived height and overrides it. Judging that
    // against the pristine value would invent a disagreement with a number the
    // reviewer was never shown -- and design.md would go on to say the captures
    // "moved to" the value the override was made against.
    const { report } = applyOverrides(tokens, [
      borderOverride,
      { path, value: '48px', baseValue: rederived },
    ])
    expect(report.conflicts).toEqual([])
    expect(report.converged).toEqual([])
  })

  it('keeps reporting a conflict the other overrides did not answer', () => {
    // The engine's answer for this slot has moved away from what it said when
    // the override was made, and no other override brought it back. A report
    // that went quiet here would be the silent clobbering the whole mechanism
    // exists to prevent.
    const { report } = applyOverrides(tokens, [
      borderOverride,
      { path, value: '48px', baseValue: '38.5px' },
    ])
    expect(report.conflicts.map((entry) => entry.path)).toEqual([path])
    expect(report.conflicts[0]).toMatchObject({ baseValue: '38.5px', engineValue: rederived })
  })

  it('reports convergence when the other overrides re-derived the engine onto the reviewer\'s value', () => {
    const { report } = applyOverrides(tokens, [
      borderOverride,
      { path, value: rederived, baseValue: '38.5px' },
    ])
    expect(report.conflicts).toEqual([])
    expect(report.converged).toEqual([{ path, value: rederived }])
  })

  it('is the same answer the write boundary gets from `standingConflict`', () => {
    const standing: TokenOverride = { path, value: '48px', baseValue: rederived }
    const overrides = [borderOverride, standing]
    // One question, one document: whatever `applyOverrides` reports for a
    // standing override, asking about it on its own has to match, or the write
    // boundary and the exports tell the reviewer two different stories.
    expect(standingConflict(baselineFor(tokens, overrides, path), standing)).toBeUndefined()
    expect(applyOverrides(tokens, overrides).report.conflicts).toEqual([])

    const stale: TokenOverride = { path, value: '48px', baseValue: '38.5px' }
    const staleSet = [borderOverride, stale]
    expect(standingConflict(baselineFor(tokens, staleSet, path), stale)).toMatchObject({ engineValue: rederived })
    expect(applyOverrides(tokens, staleSet).report.conflicts).toHaveLength(1)
  })

  it('stays deterministic across the extra replays', () => {
    const overrides = [borderOverride, { path, value: '48px', baseValue: rederived }]
    expect(serializeTokens(applyOverrides(kit(), overrides).tokens)).toBe(
      serializeTokens(applyOverrides(kit(), overrides).tokens),
    )
  })
})

describe('a conflict the reviewer answered', () => {
  const tokens = kit()
  const engineValue = `${tokens.border.width.value}px`

  /** The shape the write path stores once a value change answers a conflict. */
  const answered: TokenOverride = {
    path: 'border.width',
    value: '4px',
    baseValue: engineValue,
    resolvedConflict: { value: '2px', baseValue: '0.5px', engineValue: '1.5px' },
  }

  it('raises no conflict, because the reviewer has responded to it', () => {
    const { tokens: next, report } = applyOverrides(tokens, [answered])
    expect(report.conflicts).toEqual([])
    expect(next.diagnostics.some((entry) => entry.code === 'override.conflict')).toBe(false)
  })

  it('records what was answered on the token, so the report does not just go quiet', () => {
    const { tokens: next } = applyOverrides(tokens, [answered])
    const decision = next.border.width.provenance.decision
    expect(decision.strategy).toBe('user-override')
    expect(decision.chosen).toBe('4px')
    expect(decision.resolvedConflict).toEqual({ value: '2px', baseValue: '0.5px', engineValue: '1.5px' })
    // The engine's own answer it replaced is still there beside it.
    expect(decision.supersedes?.chosen).toBe(engineValue)
    expect(decision.summary).toContain('in answer to the conflict against 2px')
  })

  it('says so in design.md, which is what a consumer actually reads', () => {
    const markdown = renderDesignMarkdown(applyOverrides(tokens, [answered]))
    expect(markdown).toContain('answered a conflict with new evidence rather than simply being edited')
    expect(markdown).toContain('`border.width` is now 4px')
    expect(markdown).toContain('It was 2px, set when the engine said 0.5px')
    // The answer that was answered comes off the record. The engine's answer in
    // *this* version is a different number, and naming it would credit the
    // reviewer with responding to something they never saw.
    expect(markdown).toContain('the captures then moved to 1.5px')
    expect(markdown).not.toContain(`the captures then moved to ${engineValue}`)
  })

  it('does not call a disagreement answered while the same document reports it open', () => {
    // The record describes a conflict that was retired. A later distillation
    // moved the engine again, so `override.conflict` stands for this very path:
    // §10 saying it was answered would have one half of the document contradict
    // the other.
    const reopened: TokenOverride = { ...answered, baseValue: '2.5px' }
    const reviewed = applyOverrides(tokens, [reopened])
    expect(reviewed.report.conflicts.map((entry) => entry.path)).toEqual(['border.width'])
    // The report leaves it out, which is what §10 reads.
    expect(reviewed.report.retired).toEqual([])

    const markdown = renderDesignMarkdown(reviewed)
    expect(markdown).toContain('**override.conflict**')
    expect(markdown).toContain('## 10. User overrides')
    expect(markdown).not.toContain('answered a conflict with new evidence')
  })

  it('says nothing about answered conflicts on an override that answered none', () => {
    const markdown = renderDesignMarkdown(
      applyOverrides(tokens, [{ path: 'border.width', value: '4px', baseValue: engineValue }]),
    )
    expect(markdown).toContain('## 10. User overrides')
    expect(markdown).not.toContain('answered a conflict with new evidence')
  })

  it('stays deterministic carrying the record', () => {
    expect(serializeTokens(applyOverrides(kit(), [answered]).tokens)).toBe(
      serializeTokens(applyOverrides(kit(), [answered]).tokens),
    )
  })
})

describe('design.md with overrides', () => {
  it('says nothing about overrides when there are none', () => {
    const markdown = renderDesignMarkdown(kit())
    expect(markdown).not.toContain('## 10. User overrides')
    expect(markdown).not.toContain('user override')
  })

  it('states the overridden value, the engine\'s answer and the reason', () => {
    const tokens = kit()
    const engineHex = tokens.color.roles.primary?.value.hex
    const markdown = renderDesignMarkdown(
      applyOverrides(tokens, [
        { path: 'color.roles.primary', value: '#1155cc', note: 'the brand is moving to blue' },
      ]),
    )

    expect(markdown).toContain('## 10. User overrides')
    expect(markdown).toContain('the brand is moving to blue')
    expect(markdown).toContain('#1155cc')
    expect(markdown).toContain(engineHex as string)
    // The colour table labels the row itself, so a reader scanning §2 sees it.
    expect(markdown).toMatch(/`primary`.*user override/)
    // And the header warns before any of the values are read.
    expect(markdown).toContain('set by hand, not distilled')
  })

  it('survives a reason containing a pipe, which markdown reads as a column break', () => {
    const note = '8px is too tight | 12px reads better\nand it matches the header'
    const markdown = renderDesignMarkdown(applyOverrides(kit(), [{ path: 'radius.steps.md', value: '10px', note }]))

    // §10 is a four-column table. The reviewer's prose must not add a fifth.
    const rows = markdown
      .split('\n')
      .slice(markdown.split('\n').findIndex((line) => line.startsWith('## 10. User overrides')))
      .filter((line) => line.startsWith('|') && line.includes('radius.steps.md'))
    expect(rows).toHaveLength(1)
    const cells = splitRow(rows[0] as string)
    expect(cells).toHaveLength(4)
    expect(cells[0]).toBe('`radius.steps.md`')
    expect(cells[1]).toBe('10px')
    // The reason is still readable, on one line, with the pipe escaped rather
    // than swallowed.
    expect(cells[3]).toBe('8px is too tight \\| 12px reads better and it matches the header')
  })

  it('never states a spacing rule the table beneath it contradicts', () => {
    const tokens = kit()
    const base = tokens.spacing.baseUnit
    const step = tokens.spacing.steps[1]
    expect(step).toBeDefined()

    // Un-reviewed, every step is snapped onto the base unit, so the blanket
    // rule is true and is stated.
    expect(renderDesignMarkdown(tokens)).toContain(`is a multiple of ${base}px`)

    // A reviewer may set a step off that scale. The document must then stop
    // asserting the rule its own table breaks.
    const offScale = base * 3 + 1
    const reviewed = applyOverrides(tokens, [
      { path: `spacing.steps.${step?.value.name as string}`, value: `${offScale}px` },
    ])
    const next = reviewed.tokens
    const markdown = renderDesignMarkdown(reviewed)
    expect(markdown).not.toContain(`is a multiple of ${base}px`)
    expect(markdown).toContain(`\`${step?.value.name as string}\` (${offScale}px)`)
    expect(markdown).toContain('A step name is an identifier, not a multiplier')

    // ...and the step says in the table that a person put it there, rather than
    // leaving a reader to notice the arithmetic does not work.
    const row = markdown
      .split('\n')
      .find((line) => line.startsWith(`| \`${step?.value.name as string}\``) && line.includes(`${offScale}px`))
    expect(row).toBeDefined()
    expect(row).toContain('*(user override)*')

    // The name is an identifier and does not move; `multiple` carries the truth.
    const after = next.spacing.steps.find((entry) => entry.value.name === step?.value.name)
    expect(after?.value.px).toBe(offScale)
    expect(after?.value.multiple).toBe(round(offScale / base, 3))
  })

  it('is deterministic with overrides applied', () => {
    const overrides: TokenOverride[] = [{ path: 'color.roles.primary', value: '#1155cc' }]
    expect(renderDesignMarkdown(applyOverrides(kit(), overrides))).toBe(
      renderDesignMarkdown(applyOverrides(kit(), overrides)),
    )
  })
})

describe('a typography step, which is three slots behind one record', () => {
  const tokens = kit()
  const step = tokens.typography.steps.find((entry) => entry.value.name === 'base')
  const engineSize = `${step?.value.fontSize as number}px`
  const engineLineHeight = String(step?.value.lineHeight as number)
  const reviewed = applyOverrides(tokens, [
    { path: 'typography.steps.base.fontSize', value: '18px', baseValue: engineSize, note: 'body reads small' },
  ])
  const sized = reviewed.tokens

  it('marks only the field the reviewer set', () => {
    expect(overriddenSlots(sized).map((slot) => slot.path)).toEqual(['typography.steps.base.fontSize'])
    const origin = (path: string): string | undefined =>
      tokenSlots(sized).filter((slot) => slot.path === path).map(originOf)[0]
    expect(origin('typography.steps.base.fontSize')).toBe('overridden')
    expect(origin('typography.steps.base.lineHeight')).not.toBe('overridden')
    expect(origin('typography.steps.base.fontWeight')).not.toBe('overridden')
  })

  it('leaves the untouched fields reading as the engine\'s own decision', () => {
    const lineHeight = tokenSlots(sized).find((slot) => slot.path === 'typography.steps.base.lineHeight')
    expect(lineHeight?.value).toBe(engineLineHeight)
    expect(lineHeight?.provenance.decision.strategy).toBe(step?.provenance.decision.strategy)
    expect(lineHeight?.provenance.decision.chosen).toBe(step?.provenance.decision.chosen)
    expect(lineHeight?.provenance.decision.note).toBeUndefined()
  })

  it('does not refuse a reviewer editing an untouched sibling field', () => {
    // The sibling reads as the engine's own value, so setting a *different* one
    // is an ordinary creation and restating it is refused as one -- exactly the
    // judgement any untouched slot gets.
    const sibling = baseline(tokens, 'typography.steps.base.lineHeight', [
      { path: 'typography.steps.base.fontSize', value: '18px' },
    ])
    expect(overrideRejection(sibling, { path: 'typography.steps.base.lineHeight', value: '1.7' })).toBeUndefined()
    expect(overrideRejection(sibling, { path: 'typography.steps.base.lineHeight', value: engineLineHeight })).toContain(
      'an override that agrees is not an override',
    )
  })

  it('names one value in design.md, and states the engine answer for that field', () => {
    const markdown = renderDesignMarkdown(reviewed)
    expect(markdown).toContain('1 value below was set by hand in the Ingot panel')
    const rows = markdown
      .split('\n')
      .slice(markdown.split('\n').findIndex((line) => line.startsWith('## 10. User overrides')))
      .filter((line) => line.startsWith('| `typography.steps.base.'))
    expect(rows).toHaveLength(1)
    expect(splitRow(rows[0] as string)).toEqual([
      '`typography.steps.base.fontSize`',
      '18px',
      engineSize,
      'body reads small',
    ])
  })

  it('keeps both when two fields of one step are set, and neither claims the third', () => {
    const both = applyOverrides(tokens, [
      { path: 'typography.steps.base.fontSize', value: '18px', baseValue: engineSize },
      { path: 'typography.steps.base.lineHeight', value: '1.7', baseValue: engineLineHeight },
    ]).tokens
    expect(overriddenSlots(both).map((slot) => slot.path)).toEqual([
      'typography.steps.base.fontSize',
      'typography.steps.base.lineHeight',
    ])
    expect(both.typography.steps.find((entry) => entry.value.name === 'base')?.value).toMatchObject({
      fontSize: 18,
      lineHeight: 1.7,
    })
    // The earlier override is not swallowed by the later one: the size still
    // says what it replaced, rather than pointing at the line height's answer.
    const size = tokenSlots(both).find((slot) => slot.path === 'typography.steps.base.fontSize')
    expect(size?.provenance.decision.supersedes?.chosen).toBe(engineSize)
  })

  it('states the engine answer for the field that was set, not the step\'s size', () => {
    // The step's own decision answers for the whole token, and its `chosen` is
    // the font size whatever field was overridden. A line height whose stated
    // engine answer is a pixel length is the kind of thing this document must
    // never say.
    const engineWeight = String(step?.value.fontWeight as number)
    for (const [field, value, engineAnswer] of [
      ['lineHeight', '1.5', engineLineHeight],
      ['fontWeight', '500', engineWeight],
    ] as const) {
      const path = `typography.steps.base.${field}`
      const edited = applyOverrides(tokens, [{ path, value, baseValue: engineAnswer, note: 'airier' }])
      const next = edited.tokens
      const slot = tokenSlots(next).find((entry) => entry.path === path)
      expect(slot?.provenance.decision.supersedes?.chosen).toBe(engineAnswer)
      expect(slot?.provenance.decision.summary).toContain(`the engine chose ${engineAnswer}`)

      // design.md §10 and the per-component "What was overridden" table read
      // that one record, so both name the field's own prior value.
      const row = renderDesignMarkdown(edited)
        .split('\n')
        .filter((line) => line.startsWith(`| \`${path}\``))
      expect(row).toHaveLength(1)
      expect(splitRow(row[0] as string)).toEqual([`\`${path}\``, value, engineAnswer, 'airier'])

      // The per-component markdown reads the same record, so a row it prints
      // for an overridden field names that field's answer too. (Button docs
      // reference the size and the line height of the step they use; the weight
      // is not one of their rows, so there is nothing there to be wrong about.)
      const component = renderComponentMarkdown(next, 'button')
        .split('\n')
        .filter((line) => line.includes('type step base') && line.includes('airier'))
      for (const line of component) expect(line).not.toContain(engineSize)
      if (field === 'lineHeight') {
        expect(component).toHaveLength(1)
        expect(splitRow(component[0] as string)).toEqual(['type step base line height', value, engineAnswer, 'airier'])
      }
    }
  })

  it('gives each of two overridden fields its own engine answer', () => {
    const both = applyOverrides(tokens, [
      { path: 'typography.steps.base.fontSize', value: '18px', baseValue: engineSize },
      { path: 'typography.steps.base.lineHeight', value: '1.7', baseValue: engineLineHeight },
    ]).tokens
    const answerFor = (path: string): string | undefined =>
      tokenSlots(both).find((slot) => slot.path === path)?.provenance.decision.supersedes?.chosen
    // One chain, two questions: narrowing it for the line height must not make
    // the size report the line height's answer.
    expect(answerFor('typography.steps.base.fontSize')).toBe(engineSize)
    expect(answerFor('typography.steps.base.lineHeight')).toBe(engineLineHeight)
  })

  it('stays deterministic', () => {
    const overrides: TokenOverride[] = [
      { path: 'typography.steps.base.lineHeight', value: '1.7' },
      { path: 'typography.steps.base.fontSize', value: '18px' },
    ]
    expect(serializeTokens(applyOverrides(kit(), overrides).tokens)).toBe(
      serializeTokens(applyOverrides(kit(), overrides).tokens),
    )
  })
})

/**
 * The write boundary.
 *
 * Every question a write raises -- is this an override at all, did the value
 * move or only the reason, was a conflict standing, and against what number --
 * is a question about the *baseline*, and each one of them produced a defect
 * when a caller answered it from whichever document it happened to be holding.
 * So the engine answers all of them at once and hands back the row to store,
 * and these are the five shapes that went wrong.
 */
describe('planning one write', () => {
  const tokens = kit()

  /** The plan, or a failure loud enough to read, so the tests below stay flat. */
  function stored(report: OverrideWriteReport): Extract<OverrideWriteReport, { outcome: 'stored' }> {
    if (report.outcome !== 'stored') throw new Error(`expected a stored plan, got: ${report.reason}`)
    return report
  }

  function plan(standing: TokenOverride[], write: OverrideWrite): OverrideWriteReport {
    return planOverrideWrite(tokens, standing, write)
  }

  describe('judging a candidate before anything is persisted', () => {
    const engineRadius = readTokenValue(tokens, 'radius.steps.md') as string

    it('refuses a candidate that restates the engine, with no row to store', () => {
      // A refusal carries a reason and nothing else. There is deliberately no
      // record on that branch: an override store keyed on (scope, path) would
      // have destroyed the standing override by the time the answer came back.
      const refused = plan([], { path: 'radius.steps.md', value: engineRadius })
      expect(refused.outcome).toBe('refused')
      expect(refused).not.toHaveProperty('record')
      expect(refused).toMatchObject({ reason: expect.stringContaining('an override that agrees is not an override') })
    })

    it('refuses an unreadable value and a path this kit has no token at', () => {
      expect(plan([], { path: 'radius.steps.md', value: 'quite round' })).toMatchObject({
        outcome: 'refused',
        reason: expect.stringContaining('pixel length'),
      })
      expect(plan([], { path: 'color.roles.tertiary', value: '#ff0000' })).toMatchObject({
        outcome: 'refused',
        reason: 'this kit has no token at color.roles.tertiary, so there is nothing to override',
      })
    })

    it('does not refuse an edit restating a decision the reviewer already owns', () => {
      // The evidence has caught up with this override, so its value *is* the
      // engine's answer. Refusing the edit would delete a standing decision for
      // the crime of being agreed with -- and the reviewer only typed a reason.
      const standing: TokenOverride[] = [{ path: 'radius.steps.md', value: engineRadius, baseValue: '4px' }]
      const plan = stored(planOverrideWrite(tokens, standing, {
        path: 'radius.steps.md',
        value: engineRadius,
        note: 'still the right call',
      }))
      expect(plan.record).toMatchObject({ path: 'radius.steps.md', value: engineRadius, note: 'still the right call' })
    })
  })

  describe('judging against the baseline rather than the stored distillation', () => {
    const path = 'components.recipes.input.height'
    const borderOverride: TokenOverride = { path: 'border.width', value: '3px' }
    const distilled = readTokenValue(tokens, path) as string
    const rederived = readTokenValue(baselineFor(tokens, [borderOverride], path), path) as string

    it('has a number to tell the two documents apart', () => {
      expect(rederived).not.toBe(distilled)
    })

    it('refuses the value the panel is showing, because that one is the engine\'s', () => {
      expect(planOverrideWrite(tokens, [borderOverride], { path, value: rederived })).toMatchObject({
        outcome: 'refused',
        reason: expect.stringContaining('an override that agrees is not an override'),
      })
    })

    it('accepts a value that only the stored distillation agrees with', () => {
      // Pinning the height back to what it was before the wider border moved it
      // is a real disagreement with what the kit now says. Judged against the
      // pristine bytes it would read as redundant and be refused.
      const plan = stored(planOverrideWrite(tokens, [borderOverride], { path, value: distilled }))
      expect(plan.record.value).toBe(distilled)
      // ...and what the engine said is recorded from the same document the
      // comparison will later be made against, so the two cannot disagree.
      expect(plan.record.baseValue).toBe(rederived)
    })
  })

  describe('an edit that changes only the reason', () => {
    const answered = { value: '1px', baseValue: '0.25px', engineValue: '0.75px' }
    const standing: TokenOverride[] = [
      { path: 'border.width', value: '2px', baseValue: '0.5px', note: 'the hairline reads thin', resolvedConflict: answered },
    ]

    it('leaves the base value and the answered record exactly where they were', () => {
      // Annotating is not answering. Refreshing `baseValue` here would retire a
      // standing conflict the reviewer never responded to, and dropping the
      // record would stop the kit saying a disagreement was ever resolved.
      const plan = stored(planOverrideWrite(tokens, standing, {
        path: 'border.width',
        value: '2 px',
        note: 'still reads thin at this scale',
      }))
      expect(plan.retired).toBeUndefined()
      expect(plan.record).toEqual({
        path: 'border.width',
        value: '2 px',
        baseValue: '0.5px',
        note: 'still reads thin at this scale',
        resolvedConflict: answered,
      })
    })

    it('recognises the edit however the same value was spelled', () => {
      // "10 px" and "10px" are one value, and only the engine knows that.
      expect(stored(planOverrideWrite(tokens, standing, { path: 'border.width', value: '2px' })).record.baseValue).toBe(
        '0.5px',
      )
    })

    it('says nothing about the reason when the write says nothing about it', () => {
      const plan = stored(planOverrideWrite(tokens, standing, { path: 'border.width', value: '2px' }))
      expect(plan.record.note).toBe('the hairline reads thin')
      // ...and an explicitly empty one is a statement, so it clears it.
      expect(
        stored(planOverrideWrite(tokens, standing, { path: 'border.width', value: '2px', note: '' })).record.note,
      ).toBe('')
    })
  })

  describe('an override the evidence has caught up with', () => {
    const engineWidth = `${tokens.border.width.value}px`
    const converged: TokenOverride[] = [{ path: 'border.width', value: engineWidth, baseValue: '0.5px' }]

    it('is a convergence, so it is not standing in conflict with anything', () => {
      const report = applyOverrides(tokens, converged).report
      expect(report.conflicts).toEqual([])
      expect(report.converged).toEqual([{ path: 'border.width', value: engineWidth }])
    })

    it('claims no answer when the reviewer later moves the value', () => {
      // Nothing was disagreeing, so this change answered nothing. Recording a
      // retirement here would have design.md announce a conflict that was never
      // reported.
      const plan = stored(planOverrideWrite(tokens, converged, { path: 'border.width', value: '3px' }))
      expect(plan.retired).toBeUndefined()
      expect(plan.record.resolvedConflict).toBeUndefined()
      expect(plan.record.baseValue).toBe(engineWidth)
    })
  })

  describe('answering a conflict, and carrying the answer', () => {
    const path = 'components.recipes.input.height'
    const borderOverride: TokenOverride = { path: 'border.width', value: '3px' }
    const distilled = readTokenValue(tokens, path) as string
    const rederived = readTokenValue(baselineFor(tokens, [borderOverride], path), path) as string
    /** A decision carried forward from before the wider border moved the height. */
    const stale: TokenOverride = { path, value: '48px', baseValue: distilled }

    it('names the engine answer that was actually consulted', () => {
      const plan = stored(planOverrideWrite(tokens, [borderOverride, stale], { path, value: '50px' }))
      expect(plan.retired).toMatchObject({ path, engineValue: rederived })
      expect(plan.record.resolvedConflict).toEqual({
        value: '48px',
        baseValue: distilled,
        engineValue: rederived,
      })
      expect(plan.record.baseValue).toBe(rederived)
    })

    it('reports the retirement, and design.md states the number off that report', () => {
      const record = stored(planOverrideWrite(tokens, [borderOverride, stale], { path, value: '50px' })).record
      // Exactly the row the server would have stored, replayed back.
      const replayed: TokenOverride = { path, value: record.value, baseValue: record.baseValue }
      if (record.resolvedConflict !== undefined) replayed.resolvedConflict = record.resolvedConflict
      const reviewed = applyOverrides(tokens, [borderOverride, replayed])

      expect(reviewed.report.conflicts).toEqual([])
      expect(reviewed.report.retired).toEqual([
        { path, value: '50px', answered: { value: '48px', baseValue: distilled, engineValue: rederived } },
      ])

      // The lookalike this whole seam exists to stop: `distilled` is what a
      // surface re-deriving "the engine's answer" from the document in front of
      // it would print, and nobody ever answered that number.
      const markdown = renderDesignMarkdown(reviewed)
      expect(markdown).toContain(`the captures then moved to ${rederived}`)
      expect(markdown).not.toContain(`the captures then moved to ${distilled}`)
      expect(markdown).toContain(`\`${path}\` is now 50px`)
    })

    it('is deterministic, like everything else the engine answers', () => {
      const once = planOverrideWrite(tokens, [borderOverride, stale], { path, value: '50px' })
      const twice = planOverrideWrite(kit(), [borderOverride, stale], { path, value: '50px' })
      expect(twice).toEqual(once)
    })
  })
})

describe('where an accepted value came from', () => {
  const path = 'border.width'

  it('is recorded on the decision without changing what the decision is', () => {
    const tokens = kit()
    const engineValue = readTokenValue(tokens, path)
    const { tokens: next } = applyOverrides(tokens, [
      { path, value: '3px', baseValue: engineValue as string, suggestedBy: 'assistant' },
    ])

    const decision = next.border.width.provenance.decision
    // The strategy is unchanged: a person chose this value, and the assistant
    // having offered it does not make the decision anybody else's.
    expect(decision.strategy).toBe('user-override')
    expect(decision.suggestedBy).toBe('assistant')
    expect(decision.summary).toContain('proposed by the assistant and accepted by the reviewer')
    // And the evidence is untouched, as it is for any override.
    expect(next.border.width.provenance.observed).toEqual(tokens.border.width.provenance.observed)
  })

  it('says nothing at all about an override the reviewer wrote themselves', () => {
    const tokens = kit()
    const engineValue = readTokenValue(tokens, path)
    const { tokens: next } = applyOverrides(tokens, [
      { path, value: '3px', baseValue: engineValue as string },
    ])
    const decision = next.border.width.provenance.decision
    // Absent, not `'reviewer'`: there is no third state to distinguish, and a
    // field that appeared on every override would change the bytes of every
    // kit anybody has ever reviewed.
    expect(decision.suggestedBy).toBeUndefined()
    expect(decision.summary).not.toContain('assistant')
  })

  it('follows the value: kept by a note-only edit, cleared by a new value', () => {
    const tokens = kit()
    const engineValue = readTokenValue(tokens, path) as string
    const standing: TokenOverride[] = [
      { path, value: '3px', baseValue: engineValue, suggestedBy: 'assistant' },
    ]

    // Annotating a suggestion does not make the reviewer its author.
    const annotated = planOverrideWrite(tokens, standing, { path, value: '3px', note: 'thicker reads better' })
    expect(annotated.outcome).toBe('stored')
    if (annotated.outcome === 'stored') expect(annotated.record.suggestedBy).toBe('assistant')

    // Typing a different value does: that string was never proposed, so an
    // attribution carried onto it would credit the assistant with somebody
    // else's decision.
    const retyped = planOverrideWrite(tokens, standing, { path, value: '4px' })
    expect(retyped.outcome).toBe('stored')
    if (retyped.outcome === 'stored') expect(retyped.record.suggestedBy).toBeUndefined()
  })

  it('names the accepted suggestions in design.md, and stays silent otherwise', () => {
    const tokens = kit()
    const engineValue = readTokenValue(tokens, path) as string

    const suggested = renderDesignMarkdown(
      applyOverrides(tokens, [{ path, value: '3px', baseValue: engineValue, suggestedBy: 'assistant' }]),
    )
    expect(suggested).toContain('proposed by the Ingot assistant')
    expect(suggested).toContain(`\`${path}\``)

    const byHand = renderDesignMarkdown(applyOverrides(tokens, [{ path, value: '3px', baseValue: engineValue }]))
    // A kit reviewed entirely by hand says nothing about an assistant it never
    // ran -- which is also what keeps every committed example byte-identical.
    expect(byHand).not.toContain('assistant')
  })
})

/**
 * The error colour a kit does not have.
 *
 * The law stands: no captured red means no `destructive`, because a brand
 * decision is the one thing the engine will not default. What the reviewer gets
 * is the informed choice -- nominate a colour, or acknowledge that the kit ships
 * without one -- and the whole lifecycle of that acknowledgment is an ordinary
 * override, so the properties tested here are the ones the override machinery
 * already promises, asked of the decision that stops a form going quiet.
 */
describe('shipping without an error colour', () => {
  const MODE = 'components.states.error.mode'
  const ROLE = 'color.roles.destructive'
  const acknowledge = (tokens: PristineTokens, standing: TokenOverride[] = []): TokenOverride => {
    const plan = planOverrideWrite(tokens, standing, { path: MODE, value: 'acknowledged', note: 'no red in these captures' })
    if (plan.outcome !== 'stored') throw new Error(plan.reason)
    const { record } = plan
    return { path: record.path, value: record.value, baseValue: record.baseValue, note: record.note }
  }

  it('states the consequence rather than going quiet about it', () => {
    const tokens = kit('linear-dark')
    const notice = tokens.diagnostics.find((entry) => entry.code === 'color.no-destructive')
    expect(notice?.level).toBe('warning')
    expect(notice?.message).toContain('cannot signal errors in colour')
    expect(notice?.path).toBe(MODE)
    expect(tokens.components.states.error.mode.value).toBe('unresolved')
  })

  it('offers both exits as real slots, so neither is an edit that does nothing', () => {
    const paths = new Set(tokenSlots(kit('linear-dark')).map((slot) => slot.path))
    expect(paths.has(MODE)).toBe(true)
    // The one role a reviewer may bring into existence.
    expect(paths.has(ROLE)).toBe(true)
  })

  it('refuses to let a person restate the engine reading instead of deciding', () => {
    const tokens = kit('linear-dark')
    const baseline = baselineFor(tokens, [], MODE)
    expect(overrideRejection(baseline, { path: MODE, value: 'unresolved' })).toContain('acknowledged')
    expect(overrideRejection(baseline, { path: MODE, value: 'acknowledged' })).toBeUndefined()
  })

  it('records who decided what, and keeps the reason', () => {
    const tokens = kit('linear-dark')
    const { tokens: next } = applyOverrides(tokens, [acknowledge(tokens)])
    const mode = next.components.states.error.mode
    expect(mode.value).toBe('acknowledged')
    expect(mode.provenance.decision.strategy).toBe('user-override')
    expect(mode.provenance.decision.note).toBe('no red in these captures')
    // The engine's own answer at the time is on the row, which is what makes the
    // later disagreement measurable rather than a matter of opinion.
    expect(acknowledge(tokens).baseValue).toBe('unresolved')
  })

  it('prescribes the non-colour error language once, and only once it is decided', () => {
    const tokens = kit('linear-dark')
    const open = renderDesignMarkdown(applyOverrides(tokens, []))
    expect(open).toContain('how it signals an error is undecided')
    expect(open).not.toContain('`Error: `')

    const settled = renderDesignMarkdown(applyOverrides(tokens, [acknowledge(tokens)]))
    expect(settled).toContain('deliberately ships **without** an error colour')
    expect(settled).toContain('`Error: `')
    // Icon, weight and prefix -- the three signals, all of them.
    expect(settled).toContain('Put an icon immediately before the message')
    expect(settled).toContain('Set the message at weight')
    // The field's own page carries the same language; it is where a form
    // actually draws the state.
    expect(renderComponentMarkdown(applyOverrides(tokens, [acknowledge(tokens)]).tokens, 'input')).toContain(
      '`Error: `',
    )
  })

  it('survives a regeneration the way every other decision does', () => {
    // A later distillation of the same captures is a new document; the row is
    // replayed onto it and the decision is still the reviewer's.
    const standing = acknowledge(kit('linear-dark'))
    const { tokens: next, report } = applyOverrides(kit('linear-dark'), [standing])
    expect(next.components.states.error.mode.value).toBe('acknowledged')
    expect(report.rejected).toEqual([])
    expect(report.conflicts).toEqual([])
  })

  it('reports the disagreement when a later capture set does supply a red', () => {
    // The acknowledgment answered an absence. The absence is gone, so the two
    // are in conflict -- and the reviewer's value stays in force until they say
    // otherwise, which is the whole point of an override.
    const withRed = kit('messy-mixed')
    expect(withRed.components.states.error.mode.value).toBe('color')

    const { tokens: next, report } = applyOverrides(withRed, [
      { path: MODE, value: 'acknowledged', baseValue: 'unresolved' },
    ])
    expect(report.conflicts.map((conflict) => conflict.path)).toEqual([MODE])
    expect(report.conflicts[0]?.engineValue).toBe('color')
    expect(next.components.states.error.mode.value).toBe('acknowledged')
    // ...and the kit does not call the same thing both answered and absent.
    expect(next.diagnostics.some((entry) => entry.code === 'color.no-destructive')).toBe(false)
  })

  it('finishes the job when a reviewer nominates the colour instead', () => {
    const tokens = kit('linear-dark')
    const plan = planOverrideWrite(tokens, [], { path: ROLE, value: '#e5484d' })
    expect(plan.outcome).toBe('stored')
    if (plan.outcome !== 'stored') return
    expect(plan.record.baseValue).toBe('none')

    const { tokens: next, report } = applyOverrides(tokens, [
      { path: ROLE, value: '#e5484d', baseValue: plan.record.baseValue },
    ])
    expect(report.rejected).toEqual([])
    expect(next.color.roles.destructive?.value.hex).toBe('#e5484d')
    // Everything the nomination implies is the engine's own work.
    expect(next.color.roles.destructiveForeground).toBeDefined()
    expect(next.components.recipes.map((recipe) => recipe.name)).toContain('button.destructive')
    expect(next.components.states.error.mode.value).toBe('color')
    expect(next.diagnostics.some((entry) => entry.code === 'color.no-destructive')).toBe(false)
    const pairs = next.color.contrast.filter((pair) => pair.background === ROLE || pair.foreground === ROLE)
    expect(pairs.length).toBeGreaterThanOrEqual(3)
    for (const pair of pairs) expect(pair.ratio).toBeGreaterThan(1)
    expect(renderDesignMarkdown({ tokens: next, report })).toContain('`button.destructive`')
  })

  it('refuses `none` where the kit has a colour, rather than doing nothing', () => {
    const baseline = baselineFor(kit('messy-mixed'), [], ROLE)
    expect(overrideRejection(baseline, { path: ROLE, value: 'none' })).toContain('clear the override')
  })

  it('stays deterministic: the same review state replays to the same bytes', () => {
    const standing = [acknowledge(kit('linear-dark'))]
    const first = serializeTokens(applyOverrides(kit('linear-dark'), standing).tokens)
    const second = serializeTokens(applyOverrides(kit('linear-dark'), standing).tokens)
    expect(first).toBe(second)
    // ...and a kit nobody reviewed is byte-identical with the feature present.
    expect(serializeTokens(applyOverrides(kit('linear-dark'), []).tokens)).not.toBe(first)
  })
})
