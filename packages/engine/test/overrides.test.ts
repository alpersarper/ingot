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
import { renderDesignMarkdown } from '../src/export/design-md'
import {
  applyOverrides,
  originOf,
  overriddenSlots,
  overrideRejection,
  readTokenValue,
  tokenSlots,
} from '../src/tokens/overrides'
import type { TokenOverride } from '../src/tokens/overrides'
import type { TokensDocument } from '../src/tokens/types'
import type { CaptureSet } from '../src/capture/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function fixture(name: string): CaptureSet {
  return JSON.parse(readFileSync(join(ROOT, 'fixtures', name, 'set.json'), 'utf8')) as CaptureSet
}

function kit(name = 'ghost-warm'): TokensDocument {
  return distill(fixture(name))
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
    const { tokens: next, applied, rejected } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: '10px', note: 'the captured 6px reads timid at this scale' },
    ])

    expect(rejected).toEqual([])
    expect(applied).toEqual([
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
    const { tokens, rejected } = applyOverrides(kit(), [{ path: 'color.roles.tertiary', value: '#ff0000' }])
    expect(rejected[0]?.path).toBe('color.roles.tertiary')
    expect(tokens.diagnostics.some((diagnostic) => diagnostic.code === 'override.rejected')).toBe(true)
  })

  it('refuses a value it cannot parse, rather than writing NaN into the document', () => {
    const { tokens, rejected } = applyOverrides(kit(), [{ path: 'radius.steps.md', value: 'quite round' }])
    expect(rejected[0]?.reason).toContain('pixel length')
    expect(tokens.radius.steps.md?.provenance.decision.strategy).not.toBe('user-override')
  })

  it('refuses a step name the kit does not carry', () => {
    const { rejected } = applyOverrides(kit(), [
      { path: 'components.recipes.button.primary.typeStep', value: '4xl' },
    ])
    expect(rejected[0]?.reason).toContain('no `4xl` type step')
  })
})

describe('judging a candidate before it is stored', () => {
  it('refuses a candidate that agrees with the engine, which is not an override', () => {
    const tokens = kit()
    const current = `${tokens.radius.steps.md?.value}px`
    expect(overrideRejection(tokens, { path: 'radius.steps.md', value: current })).toContain('is not an override')
    // Two spellings of one value are one value, so the check is on the
    // canonical form rather than on the string the reviewer happened to type.
    expect(overrideRejection(tokens, { path: 'radius.steps.md', value: ` ${tokens.radius.steps.md?.value} ` })).toContain(
      'is not an override',
    )
  })

  it('refuses a path the kit has no slot for, and a value it cannot read', () => {
    const tokens = kit()
    expect(overrideRejection(tokens, { path: 'color.roles.tertiary', value: '#ff0000' })).toContain('no such token')
    expect(overrideRejection(tokens, { path: 'radius.steps.md', value: 'quite round' })).toContain('pixel length')
  })

  it('passes a candidate that really does disagree', () => {
    expect(overrideRejection(kit(), { path: 'radius.steps.md', value: '10px' })).toBeUndefined()
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
    expect(result.rejected).toEqual([])
    expect(result.applied.map((entry) => entry.path)).toEqual(['radius.steps.md'])
    expect(result.tokens.diagnostics.some((entry) => entry.code === 'override.rejected')).toBe(false)
  })

  it('reports the convergence once, as information rather than as a problem', () => {
    const notes = result.tokens.diagnostics.filter((entry) => entry.code === 'override.now-agrees')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.level).toBe('info')
    expect(notes[0]?.message).toContain(`radius.steps.md = ${engineValue}`)
    expect(result.converged).toEqual([{ path: 'radius.steps.md', value: engineValue }])
  })

  it('is a convergence rather than a conflict, even though the base value moved', () => {
    expect(result.conflicts).toEqual([])
    expect(result.tokens.diagnostics.some((entry) => entry.code === 'override.conflict')).toBe(false)
  })

  it('covers every converged path in the one diagnostic', () => {
    const borderWidth = `${tokens.border.width.value}px`
    const { converged, tokens: next } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: engineValue, baseValue: '4px' },
      { path: 'border.width', value: borderWidth, baseValue: '3px' },
    ])
    expect(converged.map((entry) => entry.path)).toEqual(['border.width', 'radius.steps.md'])
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
    expect(after?.height.value).toBe((recipe?.height.value ?? 0) + 8)
    expect(after?.height.provenance.decision.derivation?.detail).toContain('recomputed after an override')
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
    // linear-dark distils with a collapsed state, so the stale statement is
    // really there to be replaced rather than merely absent.
    const tokens = kit('linear-dark')
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

  it('leaves a height the reviewer set by hand exactly where they put it', () => {
    const tokens = kit()
    const recipe = tokens.components.recipes.find((entry) => entry.name === 'button.primary')
    const { tokens: next } = applyOverrides(tokens, [
      { path: 'components.recipes.button.primary.height', value: '44px' },
      { path: 'components.recipes.button.primary.paddingY', value: `${(recipe?.paddingY.value ?? 0) + 4}px` },
    ])
    const after = next.components.recipes.find((entry) => entry.name === 'button.primary')
    expect(after?.height.value).toBe(44)
    expect(after?.height.provenance.decision.strategy).toBe('user-override')
  })
})

describe('conflicts between an override and new evidence', () => {
  it('reports the disagreement and keeps the override', () => {
    const tokens = kit()
    const engineValue = `${tokens.radius.steps.md?.value}px`
    const { tokens: next, conflicts } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: '10px', baseValue: '4px' },
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ path: 'radius.steps.md', value: '10px', baseValue: '4px', engineValue })
    // The override still wins. Anything else would make an override provisional.
    expect(next.radius.steps.md?.value).toBe(10)
    const warning = next.diagnostics.find((diagnostic) => diagnostic.code === 'override.conflict')
    expect(warning?.level).toBe('warning')
    expect(warning?.message).toContain(engineValue)
  })

  it('stays quiet when the evidence has not moved', () => {
    const tokens = kit()
    const { conflicts } = applyOverrides(tokens, [
      { path: 'radius.steps.md', value: '10px', baseValue: `${tokens.radius.steps.md?.value}px` },
    ])
    expect(conflicts).toEqual([])
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
    const { tokens: next } = applyOverrides(tokens, [
      { path: 'color.roles.primary', value: '#1155cc', note: 'the brand is moving to blue' },
    ])
    const markdown = renderDesignMarkdown(next)

    expect(markdown).toContain('## 10. User overrides')
    expect(markdown).toContain('the brand is moving to blue')
    expect(markdown).toContain('#1155cc')
    expect(markdown).toContain(engineHex as string)
    // The colour table labels the row itself, so a reader scanning §2 sees it.
    expect(markdown).toMatch(/`primary`.*user override/)
    // And the header warns before any of the values are read.
    expect(markdown).toContain('set by hand, not distilled')
  })

  it('is deterministic with overrides applied', () => {
    const overrides: TokenOverride[] = [{ path: 'color.roles.primary', value: '#1155cc' }]
    expect(renderDesignMarkdown(applyOverrides(kit(), overrides).tokens)).toBe(
      renderDesignMarkdown(applyOverrides(kit(), overrides).tokens),
    )
  })
})
