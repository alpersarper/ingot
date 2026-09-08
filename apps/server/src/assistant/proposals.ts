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
 */
import { applyOverrides, planOverrideWrite, readTokenValue, tokenSlots } from '@ingot/engine'
import type { Diagnostic, PristineTokens, TokenOverride, TokensDocument } from '@ingot/engine'

/** A value the model proposed, before the engine has seen it. */
export interface Candidate {
  path: string
  value: string
  title: string
  rationale: string
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
}

/**
 * Run every candidate past the engine.
 *
 * `standing` is the review state as it is now. Each candidate is judged on its
 * own against that state rather than against the previous candidate: two
 * suggestions from one run are two independent offers, and a reviewer who
 * accepts the second without the first must get what the card promised.
 */
export function checkProposals(
  pristine: PristineTokens,
  standing: readonly TokenOverride[],
  candidates: readonly Candidate[],
): CheckResult {
  const accepted: CheckedProposal[] = []
  const refused: RefusedProposal[] = []

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

    // The write boundary itself, not an imitation of it: the same call the
    // panel's own override path makes. It decides whether the value parses in
    // this slot, whether it merely restates what the engine already chose, and
    // what the engine's answer for the slot currently is.
    const plan = planOverrideWrite(pristine, standing, { path, value })
    if (plan.outcome === 'refused') {
      refused.push({ path, value, reason: plan.reason })
      continue
    }

    const candidateOverride: TokenOverride = {
      path,
      value: plan.record.value,
      baseValue: plan.record.baseValue,
    }
    const after = applyOverrides(pristine, [...standing, candidateOverride])

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
    })
  }

  return { accepted, refused }
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
