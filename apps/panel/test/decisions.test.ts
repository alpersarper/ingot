/**
 * The review queue.
 *
 * A card is the unit the reviewer works through, and two properties have to
 * hold for that to mean anything: one card is one decision, and every card
 * offers only the actions that can actually be carried out. Both are asserted
 * here against the committed `examples/*​/tokens.json` -- generated public
 * output, and the only place the awkward real shapes live: messy-mixed reports
 * the same collision code three times on one path, and most diagnostics point
 * at a container that is not an overridable token at all.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOverrides, readTokenValue, tokenSlots } from '@ingot/engine'
import { asPristine } from '@ingot/engine'
import type { PristineTokens, TokensDocument } from '@ingot/engine'
import { decisionCards, openCount } from '@/workbench/decisions'

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

function kit(name: string): PristineTokens {
  // The committed examples are exactly the bytes `distill` wrote, which is what
  // makes naming them the pristine document sound.
  return asPristine(JSON.parse(readFileSync(join(ROOT, 'examples', name, 'tokens.json'), 'utf8')) as TokensDocument)
}

function cardsFor(
  tokens: TokensDocument,
  accepted: string[] = [],
  overridden: string[] = [],
  rejected: string[] = [],
): ReturnType<typeof decisionCards> {
  return decisionCards({
    tokens,
    conflicts: [],
    overriddenPaths: new Set(overridden),
    rejectedPaths: new Set(rejected),
    accepted: new Set(accepted),
  })
}

describe('one card is one decision', () => {
  const tokens = kit('messy-mixed')

  it('gives every diagnostic its own card, even when code and path repeat', () => {
    const collisions = tokens.diagnostics.filter(
      (entry) => entry.code === 'typography.adjacent-sizes' && entry.path === 'typography.steps',
    )
    // The fixture has to carry the repeat, or this proves nothing.
    expect(collisions.length).toBe(3)

    const cards = cardsFor(tokens)
    const matching = cards.filter((card) => card.title === 'typography.adjacent-sizes')
    expect(matching).toHaveLength(3)
    // Distinct ids: the React key and the `(scope, card_id)` review row are the
    // same string, so a collision is both a rendering bug and a storage one.
    expect(new Set(matching.map((card) => card.id)).size).toBe(3)
    // ...and every card in the queue is distinct, not just these.
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length)
    // Each card still carries its own message, so they are three real decisions.
    expect(new Set(matching.map((card) => card.detail)).size).toBe(3)
  })

  it('settles only the collision the reviewer actually read', () => {
    const open = cardsFor(tokens)
    const target = open.find((card) => card.title === 'typography.adjacent-sizes')
    expect(target).toBeDefined()

    const after = cardsFor(tokens, [target?.id as string])
    const collisions = after.filter((card) => card.title === 'typography.adjacent-sizes')
    expect(collisions.filter((card) => card.state === 'accepted')).toHaveLength(1)
    expect(collisions.filter((card) => card.state === 'open')).toHaveLength(2)
    expect(openCount(after)).toBe(openCount(open) - 1)
  })

  it('gives a card the same id again, so an acceptance survives regeneration', () => {
    // A regeneration from the same captures produces the same document; the
    // ids are what carry a reviewer's acceptances across it.
    expect(cardsFor(kit('messy-mixed')).map((card) => card.id)).toEqual(cardsFor(tokens).map((card) => card.id))
  })
})

describe('a card offers only what can be carried out', () => {
  it.each(['ghost-warm', 'linear-dark', 'stripe-light', 'messy-mixed'])(
    'marks a card editable exactly when its path is a real token slot (%s)',
    (name) => {
      const tokens = kit(name)
      const slots = new Set(tokenSlots(tokens).map((slot) => slot.path))
      const cards = cardsFor(tokens)

      for (const card of cards) {
        expect(card.editable).toBe(card.path !== undefined && slots.has(card.path))
        // The engine cannot write a container path, so a card on one must not
        // carry a one-click value either.
        if (!card.editable) expect(card.options.every((option) => option.kind === 'clear')).toBe(true)
      }
    },
  )

  it('marks the container-path diagnostics that really occur as not editable', () => {
    const cards = cardsFor(kit('messy-mixed'))
    const containers = cards.filter((card) => card.path !== undefined && !card.editable).map((card) => card.path)
    // These are the paths a reviewer could previously type into and only ever
    // get a 422 back from, whatever they typed.
    expect(containers).toContain('typography.steps')
    expect(containers).toContain('components.recipes')
    expect(new Set(containers).size).toBeGreaterThan(0)
    for (const path of containers) expect(readTokenValue(kit('messy-mixed'), path as string)).toBeNull()
  })

  it('keeps a diagnostic that names a real token editable', () => {
    const cards = cardsFor(kit('ghost-warm'))
    const onARole = cards.find((card) => card.path === 'color.roles.disabledForeground')
    expect(onARole).toBeDefined()
    expect(onARole?.editable).toBe(true)
  })
})

describe('a statement is not a decision', () => {
  const tokens = kit('ghost-warm')

  /** A document whose standing override the evidence has caught up with. */
  function converged(): TokensDocument {
    const value = readTokenValue(tokens, 'radius.steps.md') as string
    const result = applyOverrides(tokens, [{ path: 'radius.steps.md', value, baseValue: '4px' }])
    expect(result.converged).toHaveLength(1)
    return result.tokens
  }

  it('never asks the reviewer to accept a convergence report', () => {
    const next = converged()
    expect(next.diagnostics.some((entry) => entry.code === 'override.now-agrees')).toBe(true)

    const cards = cardsFor(next, [], ['radius.steps.md'])
    expect(cards.some((card) => card.title === 'override.now-agrees')).toBe(false)
    // Its own message ends "nothing needs doing", so it must not put a number
    // on the Review tab that only an Accept click can clear.
    expect(cards.filter((card) => card.state === 'open').map((card) => card.title)).not.toContain(
      'override.now-agrees',
    )
  })

  it('leaves the badge where it was before the evidence caught up', () => {
    const before = openCount(cardsFor(tokens))
    const after = openCount(cardsFor(converged(), [], ['radius.steps.md']))
    expect(after).toBeLessThanOrEqual(before)
  })

  it('still raises the statements that are actionable', () => {
    // `override.rejected` and `override.contrast` describe something wrong and
    // want a person, so they stay cards.
    const { tokens: next } = applyOverrides(tokens, [{ path: 'color.roles.tertiary', value: '#ff0000' }])
    expect(cardsFor(next).some((card) => card.title === 'override.rejected')).toBe(true)
  })
})

describe('an override the engine refused', () => {
  const tokens = kit('ghost-warm')

  /**
   * A stored override whose slot this kit does not have.
   *
   * The real path to this is a regeneration: `tokenSlots` only emits
   * `typography.families.mono`, `color.roles.destructive` and the destructive
   * button's recipe when the captures support them, so a kit that loses one
   * leaves a standing override with nowhere to land.
   */
  const stranded = { path: 'color.roles.tertiary', value: '#ff0000' }
  const { tokens: next, rejected } = applyOverrides(tokens, [stranded])

  it('is really refused, so the rest of this describes something that happens', () => {
    expect(rejected.map((entry) => entry.path)).toEqual([stranded.path])
    expect(next.diagnostics.some((entry) => entry.code === 'override.rejected')).toBe(true)
  })

  it('reads as open rather than as a value in force', () => {
    // The panel holds the stored row, which is what previously settled the card.
    const cards = cardsFor(next, [], [stranded.path], [stranded.path])
    const card = cards.find((entry) => entry.title === 'override.rejected')
    expect(card).toBeDefined()
    expect(card?.state).toBe('open')
  })

  it('counts toward the number on the Review tab', () => {
    const cards = cardsFor(next, [], [stranded.path], [stranded.path])
    const card = cards.find((entry) => entry.title === 'override.rejected')
    expect(cards.filter((entry) => entry.state === 'open')).toContainEqual(card)
    expect(openCount(cards)).toBe(openCount(cardsFor(tokens)) + 1)
  })

  it('offers the one exit that always works: clearing it', () => {
    const cards = cardsFor(next, [], [stranded.path], [stranded.path])
    const card = cards.find((entry) => entry.title === 'override.rejected')
    // The slot is gone, so there is nothing to retype into...
    expect(card?.editable).toBe(false)
    // ...but the stored row can always be removed.
    expect(card?.options).toEqual([{ kind: 'clear', label: 'Clear this override' }])
    expect(card?.path).toBe(stranded.path)
  })

  it('is the rejection, not the stored row, that decides this', () => {
    const state = (rejectedPaths: string[]): string | undefined =>
      cardsFor(next, [], [stranded.path], rejectedPaths).find((entry) => entry.title === 'override.rejected')
        ?.state

    // A stored row on its own used to settle the card -- which is the bug: the
    // row exists either way, and it says nothing about whether the value landed.
    expect(state([])).toBe('overridden')
    // Told what the engine actually did with it, the card stays open.
    expect(state([stranded.path])).toBe('open')
  })
})
