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
 *   4. **Assistant proposals** -- a suggestion the LLM made, already checked
 *      against the engine's guardrails. They sit in this queue rather than in a
 *      panel of their own because they are the same kind of thing: a value
 *      somebody is being asked to agree with. They sort *last* among open cards
 *      and carry their own kind, because a finding the engine made about the
 *      evidence outranks a suggestion a language model made about the finding,
 *      and a reviewer must never have to work out which is which.
 *
 * A card id is derived from the kit's own content rather than from a row id, so
 * accepting a card survives regeneration: the same collision in the next
 * version is the same card, already dealt with.
 */
import { tokenSlots } from '@ingot/engine'
import type { OverrideConflict, OverrideGroup, TokenSlot, TokensDocument } from '@ingot/engine'
import type { AssistantProposal } from '@/lib/api'

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

export type CardKind = 'conflict' | 'diagnostic' | 'choice' | 'proposal'
export type CardSeverity = 'conflict' | 'warning' | 'info' | 'suggestion'
export type CardState = 'open' | 'accepted' | 'overridden' | 'dismissed'

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
  // The two an assistant proposal offers. They are their own kinds rather than
  // an `override` with a value, because accepting a proposal goes through a
  // different endpoint -- one that records where the value came from -- and a
  // card that offered "set this value" would let the panel take a shortcut
  // around the provenance the whole feature turns on.
  | { kind: 'accept-proposal'; id: string; label: string }
  | { kind: 'dismiss-proposal'; id: string; label: string }

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
  /**
   * Whether `path` is a token the engine can actually write.
   *
   * Most diagnostics point at a container -- `typography.steps`,
   * `components.recipes`, `color.palette` -- rather than at a slot, and
   * `tokenSlots` is the contract that says so. Offering an edit box on one of
   * those can only ever produce a 422, whatever the reviewer types, so a card
   * that is not editable is informational and shows no way to set a value.
   */
  editable: boolean
  state: CardState
  /**
   * Present on an assistant proposal: what the engine said applying it would
   * also do, beyond setting the value.
   *
   * Shown on the card because it is a consequence the reviewer is agreeing to.
   * Empty means it lands exactly as proposed.
   */
  engineNotes?: string[]
  /** Present on an assistant proposal: the model and template behind it. */
  attribution?: string
  /**
   * Present on an assistant proposal the reviewer had dismissed before the
   * engine's answer at its path moved. Marked beside the "Assistant
   * suggestion" label -- the `override.now-agrees` transparency rule: nothing
   * reappears quietly, the panel states what changed.
   */
  reoffered?: boolean
}

export interface CardInputs {
  tokens: TokensDocument
  conflicts: readonly OverrideConflict[]
  /**
   * Paths that carry a stored override, applied or not.
   *
   * The stored rows, straight from the review payload. A row is not the same as
   * a value in force, which is why `rejectedPaths` comes with it.
   */
  overriddenPaths: ReadonlySet<string>
  /**
   * Paths whose stored override the engine refused on this replay.
   *
   * A slot can disappear between kit versions -- `typography.families.mono`,
   * `color.roles.destructive` and the destructive button's recipe are only
   * emitted when the captures support them -- and a value can stop parsing
   * against a scale that no longer has the step it names. Either way the
   * reviewer's value is not in force, so it must not settle its card: being
   * told a value is applied when it was dropped is the one thing worse than
   * being told nothing.
   */
  rejectedPaths: ReadonlySet<string>
  /** Card ids the reviewer has accepted. */
  accepted: ReadonlySet<string>
  /**
   * The assistant's proposals for this scope, in the order the server stores
   * them. Optional so every existing caller -- and a panel with no key -- keeps
   * working unchanged.
   */
  proposals?: readonly AssistantProposal[]
}

/**
 * Diagnostics that are statements rather than decisions.
 *
 * `override.applied` reports what a human already did, `override.conflict` has a
 * card of its own with the evidence attached, and `override.now-agrees` says the
 * evidence caught up with a standing decision -- its own message ends "nothing
 * needs doing". A card for any of them would put a number on the Review tab that
 * the reviewer can only clear by accepting a non-decision, on every read.
 *
 * `override.contrast` and `override.rejected` are deliberately *not* here: both
 * describe something that is wrong and wants a person, so both stay as cards.
 */
const NOT_A_DECISION = new Set(['override.applied', 'override.conflict', 'override.now-agrees'])

// A suggestion sorts after everything the engine said. The engine looked at the
// evidence; the assistant looked at the engine.
const SEVERITY_ORDER: Record<CardSeverity, number> = { conflict: 0, warning: 1, info: 2, suggestion: 3 }

/** Build the review queue. Deterministic: same kit and state, same order. */
export function decisionCards({
  tokens,
  conflicts,
  overriddenPaths,
  rejectedPaths,
  accepted,
  proposals = [],
}: CardInputs): DecisionCard[] {
  const cards: DecisionCard[] = []
  const slots = tokenSlots(tokens)
  const editablePaths = new Set(slots.map((slot) => slot.path))

  // What is actually in force, which is what a card state may be built from.
  const appliedPaths = new Set([...overriddenPaths].filter((path) => !rejectedPaths.has(path)))

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
        `the engine now says ${conflict.engineValue}`,
      ],
      options: [{ kind: 'clear', label: `Revert to the engine (${conflict.engineValue})` }],
      editable: editablePaths.has(conflict.path),
      state: accepted.has(`conflict:${conflict.path}`) ? 'accepted' : 'open',
    })
  }

  // A kit can carry several diagnostics with one code on one path -- messy-mixed
  // reports three `typography.adjacent-sizes` collisions on `typography.steps`.
  // Without the ordinal all three share an id, which is a duplicate React key
  // and, worse, one `(scope, card_id)` row: accepting the collision the reviewer
  // read would settle two they never saw. The ordinal is their position among
  // the diagnostics sharing that code and path, which is stable across a
  // regeneration in a way the message text -- carrying numbers that move between
  // distillations -- is not.
  const occurrences = new Map<string, number>()

  for (const diagnostic of tokens.diagnostics) {
    if (NOT_A_DECISION.has(diagnostic.code)) continue
    const group = `diag:${diagnostic.code}:${diagnostic.path ?? ''}`
    const ordinal = occurrences.get(group) ?? 0
    occurrences.set(group, ordinal + 1)

    const id = `${group}#${ordinal}`
    const card: DecisionCard = {
      id,
      kind: 'diagnostic',
      severity: diagnostic.level === 'warning' ? 'warning' : 'info',
      title: diagnostic.code,
      detail: diagnostic.message,
      evidence: [],
      options: [],
      editable: diagnostic.path !== undefined && editablePaths.has(diagnostic.path),
      state: cardState(id, diagnostic.path, appliedPaths, accepted),
    }
    if (diagnostic.path !== undefined) card.path = diagnostic.path
    // A refused override is a real problem with only one certain exit: the
    // value cannot be applied, and the slot it named may not exist any more, so
    // retyping is not always available but clearing always is.
    if (diagnostic.code === 'override.rejected' && diagnostic.path !== undefined) {
      card.options = [{ kind: 'clear', label: 'Clear this override' }]
    }
    // The kit has no error colour. Two exits, and the card carries the one the
    // Tokens tab cannot offer in a click -- acknowledging the consequence --
    // while naming the other, because picking a colour is a value a person
    // types (or accepts from the assistant) rather than a button.
    if (diagnostic.code === 'color.no-destructive') {
      card.title = 'This kit cannot signal an error in colour'
      card.evidence = [
        'no captured colour reads as a red, so there is no `destructive` role',
        'set `color.roles.destructive` in the Tokens tab to give this kit an error colour',
        'or acknowledge below, and `design.md` will prescribe the non-colour error language instead',
      ]
      card.options = [{ kind: 'override', value: 'acknowledged', label: 'Ship without an error colour' }]
    }
    cards.push(card)
  }

  for (const slot of slots) {
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
      editable: true,
      state: cardState(id, slot.path, appliedPaths, accepted),
    })
  }

  // The assistant's suggestions, last in construction order as they are last in
  // sort order. A dismissed one stays in the queue settled rather than
  // vanishing: "the assistant suggested this and I said no" is a decision, and
  // a card that disappears is one the reviewer cannot check they made.
  for (const proposal of proposals) {
    const id = `proposal:${proposal.id}`
    cards.push({
      id,
      kind: 'proposal',
      severity: 'suggestion',
      title: proposal.title,
      detail: proposal.rationale,
      path: proposal.path,
      evidence: [
        `set ${proposal.path} to ${proposal.value}`,
        `the engine says ${proposal.baseValue}`,
        ...proposal.engineNotes,
      ],
      options:
        proposal.status === 'open'
          ? [
              { kind: 'accept-proposal', id: proposal.id, label: `Accept (${proposal.value})` },
              { kind: 'dismiss-proposal', id: proposal.id, label: 'Dismiss' },
            ]
          : [],
      // Typing a different value here would be an override, not an acceptance,
      // and the Tokens tab is where an override is typed. The card offers the
      // suggestion or nothing.
      editable: false,
      state: proposal.status === 'open' ? 'open' : proposal.status === 'accepted' ? 'accepted' : 'dismissed',
      engineNotes: proposal.engineNotes,
      attribution: `${proposal.capability} · ${proposal.model} · ${proposal.promptVersion}`,
      ...(proposal.reoffered === true ? { reoffered: true } : {}),
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
  appliedPaths: ReadonlySet<string>,
  accepted: ReadonlySet<string>,
): CardState {
  // An override settles a card without anyone having to accept it as well:
  // acting on a decision is a stronger answer than agreeing with it. Only an
  // override the engine actually applied counts -- a refused one is a decision
  // that did not land, and a card it settled would be a lie.
  if (path !== undefined && appliedPaths.has(path)) return 'overridden'
  return accepted.has(id) ? 'accepted' : 'open'
}

/** How many cards still want a human. The number on the Review tab. */
export function openCount(cards: readonly DecisionCard[]): number {
  return cards.filter((card) => card.state === 'open').length
}
