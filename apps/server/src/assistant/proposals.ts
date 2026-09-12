/**
 * The gate between what the model said and what a reviewer is shown.
 *
 * Nothing the assistant proposes reaches the panel without going through here,
 * and what happens here is not a sanity check on the text -- it is the engine
 * being asked the question for real. A candidate is written into a throwaway
 * copy of the kit and the whole of `applyOverrides` runs over it: the value is
 * parsed in the slot's own notation, the interaction shades are re-derived, the
 * control heights are recomputed, and the contrast floor is enforced on every
 * pair the kit puts on screen. Then the result is compared against the same kit
 * without the candidate.
 *
 * That is why this file has no colour maths and no opinion about values in it.
 * The engine is the authority on whether a value can be drawn; asking it is
 * cheap and exact, and a second implementation here would be a slower, wronger
 * copy that would drift the first time a heuristic was tuned.
 *
 * Three outcomes, and the distinction between the second and the third is the
 * point:
 *
 *   - **refused** -- the engine will not take it. It never becomes a card, and
 *     the reason is recorded for the log rather than shown as a suggestion,
 *     because a suggestion the reviewer cannot accept is noise dressed as work.
 *   - **accepted with notes** -- the engine took it and had to move something
 *     to keep its guarantees: a derived shade shifted, a height recomputed, a
 *     contrast adjustment fired. The card says so, because that is a
 *     consequence the reviewer is agreeing to.
 *   - **clean** -- it landed exactly as proposed.
 *
 * Before any of that, one gate that is a human's rather than the engine's: a
 * candidate matching a dismissed suggestion -- same path, same capability,
 * and the engine's answer it was judged against unchanged -- is withheld,
 * because a person already answered it and nothing they were answering has
 * moved. When the answer has moved, the candidate proceeds and is marked as a
 * re-offer, never rendered as new.
 */
import { applyOverrides, planOverrideWrite, readTokenValue, tokenSlots } from '@ingot/engine'
import type { Diagnostic, PristineTokens, TokenOverride, TokensDocument } from '@ingot/engine'

/**
 * Slots no capability may propose a value for, whatever the engine would do
 * with it.
 *
 * Every other guardrail in this file asks the engine "can this be drawn?".
 * This one asks a different question -- "is this the assistant's to decide?" --
 * and the answer is fixed rather than computed, because a consent decision that
 * arrived as a card a reviewer clicked through is not consent.
 */
const NEVER_PROPOSED = new Set(['components.states.error.mode'])

/** A value the model proposed, before the engine has seen it. */
export interface Candidate {
  path: string
  value: string
  title: string
  rationale: string
}

/**
 * A suggestion a human already said no to, as the suppression gate needs it.
 *
 * A dismissal is respected exactly as long as the world it was made in stands:
 * while the engine's answer at the path is still the one the dismissed card
 * recorded, the same kind of suggestion at the same path is withheld. When the
 * answer moves, the dismissal no longer applies -- the same law the kit follows
 * for overrides and conflicts, where a decision holds until the evidence does
 * not. The caller supplies only the dismissals of the capability being run:
 * a dismissed `derive` must not silence a `merge` that happens to share a path.
 */
export interface DismissedSuggestion {
  path: string
  /** The engine's answer the dismissal was made against. */
  baseValue: string
}

/** A candidate the engine will take, with everything a card needs to say. */
export interface CheckedProposal {
  path: string
  /** The value as the engine canonicalised it, which is what would be stored. */
  value: string
  /** The engine's own answer at this path, with the standing review in force. */
  baseValue: string
  title: string
  rationale: string
  /**
   * What applying this would do beyond setting the value.
   *
   * Empty when it lands cleanly. Each entry is the engine's own words -- a
   * diagnostic it raised that the kit does not already carry -- never a
   * restatement of them.
   */
  engineNotes: string[]
  /**
   * True when this suggestion had been dismissed and the engine's answer at
   * its path has since moved. It may come back, but never as though it were
   * new: the panel marks it as a re-offer the evidence reopened.
   */
  reoffered: boolean
}

export interface RefusedProposal {
  path: string
  value: string
  /** The engine's reason, or this file's, when the engine was never reached. */
  reason: string
}

export interface CheckResult {
  accepted: CheckedProposal[]
  refused: RefusedProposal[]
  /**
   * Candidates withheld because a standing dismissal still applies.
   *
   * Not refusals: the engine never judged them, a person did, and the card is
   * withheld out of respect for that answer rather than because the value
   * could not land. Logged, never shown.
   */
  suppressed: RefusedProposal[]
}

/**
 * Run every candidate past the engine.
 *
 * `standing` is the review state as it is now. Each candidate is judged on its
 * own against that state rather than against the previous candidate: two
 * suggestions from one run are two independent offers, and a reviewer who
 * accepts the second without the first must get what the card promised.
 *
 * `dismissed` is the suppression gate, and it lives here -- the one boundary
 * every proposal passes through -- so no capability can re-offer a suggestion
 * a human said no to while the engine's answer it was judged against still
 * stands. It is an additional gate, never a replacement: what survives it is
 * still checked by the engine in full.
 */
export function checkProposals(
  pristine: PristineTokens,
  standing: readonly TokenOverride[],
  candidates: readonly Candidate[],
  dismissed: readonly DismissedSuggestion[],
): CheckResult {
  const accepted: CheckedProposal[] = []
  const refused: RefusedProposal[] = []
  const suppressed: RefusedProposal[] = []

  // The kit as it stands, which every candidate's consequences are measured
  // against. Computed once: it is the same document for all of them.
  const before = applyOverrides(pristine, standing).tokens
  const beforeDiagnostics = new Set(before.diagnostics.map(code))
  const beforeFailures = new Set(failingPairs(before))
  const paths = new Set(tokenSlots(before).map((slot) => slot.path))
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const { path, value } = candidate

    // Two candidates for one path in one answer is the model contradicting
    // itself. Neither is more right than the other, so the first is taken and
    // the second is refused rather than silently overwriting it.
    if (seen.has(path)) {
      refused.push({ path, value, reason: 'the assistant proposed two values for this token in one answer' })
      continue
    }
    seen.add(path)

    if (!paths.has(path)) {
      refused.push({ path, value, reason: 'this kit has no such token, so there is nothing to override' })
      continue
    }

    // The one slot the assistant may never write. Shipping a kit that cannot
    // signal an error in colour is an informed-consent decision: it is answered
    // by a person who was shown the consequence, and a card offering to make it
    // on their behalf would be exactly the consent this slot exists to obtain.
    // The prompt says so too; this is the part that is a guarantee.
    if (NEVER_PROPOSED.has(path)) {
      refused.push({
        path,
        value,
        reason: 'this is a decision only a person may make; the assistant may propose the error colour itself, never the choice to ship without one',
      })
      continue
    }

    // The write boundary itself, not an imitation of it: the same call the
    // panel's own override path makes. It decides whether the value parses in
    // this slot, whether it merely restates what the engine already chose, and
    // what the engine's answer for the slot currently is.
    const plan = planOverrideWrite(pristine, standing, { path, value })
    if (plan.outcome === 'refused') {
      refused.push({ path, value, reason: plan.reason })
      continue
    }

    // The dismissal check is made against `plan.record.baseValue` -- the
    // engine's own current answer for the path, read by `planOverrideWrite`
    // from the baseline -- and against the answer the dismissed card recorded,
    // which the same call produced when that card was made. One measurement on
    // both sides, so "the evidence moved" is the engine's judgement and never a
    // string comparison this file invented.
    const priors = dismissed.filter((entry) => entry.path === path)
    if (priors.some((entry) => entry.baseValue === plan.record.baseValue)) {
      suppressed.push({
        path,
        value,
        reason: 'a suggestion here was dismissed and the engine\'s answer has not changed since',
      })
      continue
    }

    const candidateOverride: TokenOverride = {
      path,
      value: plan.record.value,
      baseValue: plan.record.baseValue,
    }
    // The simulation is of the accept transition, and accepting upserts on
    // the path: a standing override there is replaced, never sat beside. Two
    // same-path entries would each read the other as the engine's fresh
    // answer and manufacture a conflict that accepting can never create.
    const after = applyOverrides(pristine, [
      ...standing.filter((override) => override.path !== path),
      candidateOverride,
    ])

    const rejection = after.report.rejected.find((entry) => entry.path === path)
    if (rejection !== undefined) {
      refused.push({ path, value, reason: rejection.reason })
      continue
    }

    // A pair that passed before and does not pass now is the one consequence
    // that is never worth offering. The engine adjusts what it can; a failure
    // that survives its adjustment means this value cannot be drawn legibly in
    // this kit, whatever the rationale says.
    const opened = failingPairs(after.tokens).filter((pair) => !beforeFailures.has(pair))
    if (opened.length > 0) {
      refused.push({
        path,
        value,
        reason: `applying it would leave ${
          opened.length === 1 ? 'a contrast pair' : `${opened.length} contrast pairs`
        } below the floor (${opened.join(', ')})`,
      })
      continue
    }

    const landed = readTokenValue(after.tokens, path)
    if (landed === null) {
      refused.push({ path, value, reason: 'the engine could not read the token back after writing it' })
      continue
    }

    const engineNotes = after.tokens.diagnostics
      .filter((diagnostic) => !beforeDiagnostics.has(code(diagnostic)))
      // `override.applied` is the engine noting that an override exists, which
      // is the thing the card is already about.
      .filter((diagnostic) => diagnostic.code !== 'override.applied')
      .map((diagnostic) => diagnostic.message)

    // The engine took the value and then moved it -- a snapped length, a shade
    // pinned to a gamut pole. The card must show what would actually be in the
    // kit, not what was asked for.
    if (landed !== plan.record.value) {
      engineNotes.unshift(`the engine writes this as ${landed} rather than ${plan.record.value}`)
    }

    accepted.push({
      path,
      value: plan.record.value,
      baseValue: plan.record.baseValue,
      title: candidate.title,
      rationale: candidate.rationale,
      engineNotes,
      reoffered: priors.length > 0,
    })
  }

  return { accepted, refused, suppressed }
}

/** A diagnostic's identity for set membership: code, path and message together. */
function code(diagnostic: Diagnostic): string {
  return `${diagnostic.code} ${diagnostic.path ?? ''} ${diagnostic.message}`
}

/** Pairs the kit puts on screen that do not meet their floor, as `fg on bg`. */
function failingPairs(tokens: TokensDocument): string[] {
  return tokens.color.contrast
    .filter((pair) => !pair.passes)
    .map((pair) => `${pair.foreground} on ${pair.background}`)
}
