/**
 * Decision cards: the review queue.
 *
 * The engine is decisive and shows its reasoning; this turns that reasoning
 * into the thing a reviewer actually works through. Three sources feed one
 * queue, in the order a person should meet them:
 *
 *   1. **Conflicts** -- a standing override that fresh evidence now disagrees
 *      with. Nothing else in the panel is more urgent, because it is the one
 *      place where two answers are both live.
 *   2. **Diagnostics** -- what the engine wants a human to look at: an adjacent
 *      size collision, a collapsed state, a contrast adjustment.
 *   3. **Close calls** -- a dominant choice with a real minority behind it.
 *      "16 of 28 corners at 6px, runner-up 12px" is a decision somebody should
 *      confirm, and the runner-up is right there to take instead.
 *
 * A card id is derived from the kit's own content rather than from a row id, so
 * accepting a card survives regeneration: the same collision in the next
 * version is the same card, already dealt with.
 */
import { tokenSlots } from '@ingot/engine'
import type { OverrideConflict, OverrideGroup, TokenSlot, TokensDocument } from '@ingot/engine'

/**
 * What to call a token on a card.
 *
 * In the Tokens tab a slot sits under its group heading, so `lg` is
 * unambiguous. On a card it is not: "lg — close call" could be a radius, a type
 * step or a shadow, so the group comes with it. Component slots already carry
 * the recipe name and need no prefix.
 */
const GROUP_PREFIX: Record<OverrideGroup, string> = {
  color: 'colour',
  typography: 'type',
  spacing: 'spacing',
  radius: 'radius',
  border: 'border',
  shadow: 'elevation',
  component: '',
  state: 'state',
}

function slotName(slot: TokenSlot): string {
  const prefix = GROUP_PREFIX[slot.group]
  return prefix === '' ? slot.label : `${prefix} ${slot.label}`
}

/** Below this, a dominant choice is a plurality and is worth a second opinion. */
export const CLOSE_CALL_CONFIDENCE = 0.6

export type CardKind = 'conflict' | 'diagnostic' | 'choice'
export type CardSeverity = 'conflict' | 'warning' | 'info'
export type CardState = 'open' | 'accepted' | 'overridden'

/**
 * One resolution a card offers.
 *
 * `override` sends a value; `clear` removes the standing override at the card's
 * path and takes the engine's answer back. They are not interchangeable: an
 * override whose value equals the engine's own answer is not an override at
 * all, so "take what the engine now says" has to be a deletion.
 */
export type CardOption =
  | { kind: 'override'; value: string; label: string }
  | { kind: 'clear'; label: string }

export interface DecisionCard {
  id: string
  kind: CardKind
  severity: CardSeverity
  title: string
  detail: string
  /** The token this card is about, when it is about one. */
  path?: string
  /** What the engine saw. Shown when the card is opened. */
  evidence: string[]
  /** One-click resolutions, most credible first. */
  options: CardOption[]
  state: CardState
}

export interface CardInputs {
  tokens: TokensDocument
  conflicts: readonly OverrideConflict[]
  /** Paths that currently carry an override. */
  overriddenPaths: ReadonlySet<string>
  /** Card ids the reviewer has accepted. */
  accepted: ReadonlySet<string>
}

/**
 * Diagnostics that are statements rather than decisions.
 *
 * `override.applied` reports what a human already did, and `override.conflict`
 * has a card of its own with the evidence attached. Listing either here would
 * ask somebody to review their own decision twice.
 */
const NOT_A_DECISION = new Set(['override.applied', 'override.conflict'])

const SEVERITY_ORDER: Record<CardSeverity, number> = { conflict: 0, warning: 1, info: 2 }

/** Build the review queue. Deterministic: same kit and state, same order. */
export function decisionCards({ tokens, conflicts, overriddenPaths, accepted }: CardInputs): DecisionCard[] {
  const cards: DecisionCard[] = []

  for (const conflict of conflicts) {
    cards.push({
      id: `conflict:${conflict.path}`,
      kind: 'conflict',
      severity: 'conflict',
      title: `Your value and the new evidence disagree`,
      detail: conflict.message,
      path: conflict.path,
      evidence: [
        `you set ${conflict.value}`,
        `the engine said ${conflict.baseValue} when you set it`,
        `the captures now say ${conflict.engineValue}`,
      ],
      options: [{ kind: 'clear', label: `Revert to the engine (${conflict.engineValue})` }],
      state: accepted.has(`conflict:${conflict.path}`) ? 'accepted' : 'open',
    })
  }

  for (const diagnostic of tokens.diagnostics) {
    if (NOT_A_DECISION.has(diagnostic.code)) continue
    const id = `diag:${diagnostic.code}:${diagnostic.path ?? ''}`
    const card: DecisionCard = {
      id,
      kind: 'diagnostic',
      severity: diagnostic.level === 'warning' ? 'warning' : 'info',
      title: diagnostic.code,
      detail: diagnostic.message,
      evidence: [],
      options: [],
      state: cardState(id, diagnostic.path, overriddenPaths, accepted),
    }
    if (diagnostic.path !== undefined) card.path = diagnostic.path
    cards.push(card)
  }

  for (const slot of tokenSlots(tokens)) {
    const decision = slot.provenance.decision
    if (decision.strategy === 'user-override') continue
    if (decision.competitors.length === 0) continue
    if (decision.confidence >= CLOSE_CALL_CONFIDENCE) continue

    const id = `choice:${slot.path}`
    cards.push({
      id,
      kind: 'choice',
      severity: 'info',
      title: `${slotName(slot)} — close call`,
      detail: decision.summary,
      path: slot.path,
      evidence: slot.provenance.observed.map(
        (entry) =>
          `${entry.value} — ${entry.count} observation${entry.count === 1 ? '' : 's'} in ${entry.captureIds.length} capture${entry.captureIds.length === 1 ? '' : 's'}`,
      ),
      // The runner-ups, in the order they lost. A one-click override is the
      // whole reason the engine records competitors.
      options: decision.competitors
        .slice(0, 3)
        .map((competitor) => ({
          kind: 'override' as const,
          value: competitor.value,
          label: `Use ${competitor.value}`,
        })),
      state: cardState(id, slot.path, overriddenPaths, accepted),
    })
  }

  return cards.sort((a, b) => {
    // Anything still open outranks anything settled, then by severity, then by
    // id so the order is total and does not shuffle between renders.
    const openness = Number(a.state !== 'open') - Number(b.state !== 'open')
    if (openness !== 0) return openness
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (severity !== 0) return severity
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function cardState(
  id: string,
  path: string | undefined,
  overriddenPaths: ReadonlySet<string>,
  accepted: ReadonlySet<string>,
): CardState {
  // An override settles a card without anyone having to accept it as well:
  // acting on a decision is a stronger answer than agreeing with it.
  if (path !== undefined && overriddenPaths.has(path)) return 'overridden'
  return accepted.has(id) ? 'accepted' : 'open'
}

/** How many cards still want a human. The number on the Review tab. */
export function openCount(cards: readonly DecisionCard[]): number {
  return cards.filter((card) => card.state === 'open').length
}
