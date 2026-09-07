/**
 * Provenance: why a token has the value it has.
 *
 * Every token in a tokens document carries one of these. The future panel
 * renders it as "4 of 5 captures at 8px -- runner-up 12px (1)" with a link back
 * to the contributing captures, and uses `competitors` to offer one-click
 * overrides. That is why the record is machine-readable rather than a sentence:
 * the sentence in `summary` is a convenience, `strategy`/`chosen`/`competitors`
 * are the contract.
 */
import { byNumber, byString, chain } from './util/sort'

/**
 * How a token's value was picked.
 *
 * - `dominant-value`  -- the most frequently observed raw value won outright.
 * - `snapped-scale`   -- observed values were snapped onto a base scale and
 *                        this step is where they landed.
 * - `cluster-representative` -- perceptually near-duplicate values were merged
 *                        and the most frequent member represents the cluster.
 * - `role-assignment` -- a colour cluster was assigned a semantic role by the
 *                        role heuristics.
 * - `derived`         -- nothing suitable was observed; the value was computed
 *                        from another token. `derivation` says how.
 * - `sanctioned-default` -- nothing was observed *and* nothing else in the
 *                        document implies the value, so the engine supplied one
 *                        of its own. Kept distinct from `derived` because the
 *                        two carry very different authority: a derived value is
 *                        a consequence of this kit, a sanctioned default is the
 *                        engine's house choice, and a reader is entitled to
 *                        override the second more freely than the first.
 * - `user-override`   -- a human replaced the engine's answer in the panel. It
 *                        is a first-class provenance state rather than an
 *                        annotation, because a distillation is an opinion and
 *                        the reviewer's opinion outranks it. The decision it
 *                        replaced is kept in `supersedes`, and `observed` is
 *                        left as the engine wrote it -- an override changes the
 *                        answer, never the evidence.
 */
export type DecisionStrategy =
  | 'dominant-value'
  | 'snapped-scale'
  | 'cluster-representative'
  | 'role-assignment'
  | 'derived'
  | 'sanctioned-default'
  | 'user-override'

/** A distinct value that was observed, and how often. */
export interface ObservedValue {
  /** The raw string exactly as captured, e.g. `"8px"` or `"#5e6ad2"`. */
  value: string
  /** Number of individual style declarations carrying this value. */
  count: number
  /** Ids of the captures that contributed it, sorted. */
  captureIds: string[]
}

/**
 * The dominant-choice record.
 *
 * `chosenCount` of `totalCount` observations in this decision's population
 * supported `chosen`. `competitors` lists what lost, most popular first, so a
 * reviewer can see how close the call was.
 */
export interface DominantChoice {
  strategy: DecisionStrategy
  /** The winning value, in the same notation as {@link ObservedValue.value}. */
  chosen: string
  chosenCount: number
  totalCount: number
  /**
   * `chosenCount / totalCount`, rounded to 3 decimals. Below ~0.5 the decision
   * is a plurality rather than a majority and is worth surfacing for review.
   */
  confidence: number
  competitors: Array<{ value: string; count: number }>
  /** Human-readable restatement, e.g. `"4 of 5 observations at 8px"`. */
  summary: string
  /** Present when `strategy` is `derived` or `sanctioned-default`. */
  derivation?: Derivation
  /**
   * Present when `strategy` is `user-override`: the decision the reviewer
   * replaced. Keeping it is what lets a later regeneration say "you overrode
   * 8px, and the new evidence says 10px" instead of silently clobbering either
   * side.
   */
  supersedes?: DominantChoice
  /** Present when `strategy` is `user-override`: the reviewer's own reason. */
  note?: string
  /**
   * Present when `strategy` is `user-override` on a token that holds more than
   * one overridable field: what stood in the field this decision set, before it
   * did.
   *
   * `supersedes` is the whole decision that was replaced, and on a multi-field
   * token that decision answers for the token rather than for one field -- a
   * typography step's `chosen` is its font size, whatever field was overridden.
   * Saying "the engine chose 15px" of a line height is exactly the kind of thing
   * the kit must not say, so the field's own prior value is recorded here and is
   * what every surface reads when it names the engine's answer for this field.
   * The replaced decision itself is left intact, because the token's other
   * fields still read it.
   */
  supersededValue?: string
  /**
   * Present when `strategy` is `user-override` on a token that holds more than
   * one overridable field: the fields this decision set.
   *
   * A typography step is one token carrying a size, a line height and a weight,
   * so one provenance record answers for three overridable positions. Without
   * this, setting the size would mark all three as hand-set -- `design.md` would
   * name three overrides for one edit and state an engine answer belonging to a
   * different field. This is the record of what was actually touched, and every
   * surface that labels a value reads it rather than approximating it.
   */
  fields?: string[]
  /**
   * Present when `strategy` is `user-override` and this value was chosen in
   * answer to a standing conflict.
   *
   * Changing an override while fresh evidence disagrees with it retires the
   * `override.conflict` report, because the reviewer has now answered it. That
   * answer is a decision in its own right and is recorded rather than left as a
   * value that merely changed -- the same discipline that keeps `supersedes`.
   */
  resolvedConflict?: ResolvedConflict
}

/**
 * The conflict an override was chosen in answer to.
 *
 * Read together with the decision's own `chosen` and `supersedes`: the reviewer
 * held `value`, set back when the engine said `baseValue`; the captures then
 * moved to what `supersedes` records, and `chosen` is how they answered.
 */
export interface ResolvedConflict {
  /** The override value the reviewer abandoned. */
  value: string
  /** The engine's answer at the time they set that abandoned value. */
  baseValue: string
}

/** How a value was computed when it could not be observed. */
export interface Derivation {
  /** Stable identifier for the algorithm, e.g. `"oklch-lightness-offset"`. */
  method: string
  /** Token paths this value was computed from, e.g. `["color.roles.primary"]`. */
  from: string[]
  /** The exact operation, e.g. `"L += 0.04 (dark mode hover lift)"`. */
  detail: string
}

/** The full provenance attached to a token. */
export interface Provenance {
  /** Every capture that contributed evidence, sorted. */
  captureIds: string[]
  /** Every distinct raw value seen, most frequent first. */
  observed: ObservedValue[]
  decision: DominantChoice
}

/** An input to {@link tally}: one observation of one value. */
export interface Contribution {
  value: string
  captureId: string
}

/**
 * Group contributions by value into a deterministic, frequency-ordered list.
 *
 * Ordering: count descending, then value ascending by byte order. The byte-order
 * tie-break is what makes an even split reproducible rather than
 * insertion-ordered.
 */
export function tally(contributions: readonly Contribution[]): ObservedValue[] {
  const byValue = new Map<string, Set<string>>()
  const counts = new Map<string, number>()

  for (const { value, captureId } of contributions) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
    let ids = byValue.get(value)
    if (!ids) {
      ids = new Set()
      byValue.set(value, ids)
    }
    ids.add(captureId)
  }

  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      count,
      captureIds: [...(byValue.get(value) ?? [])].sort(byString),
    }))
    .sort(chain<ObservedValue>((a, b) => byNumber(b.count, a.count), (a, b) => byString(a.value, b.value)))
}

/** Sorted union of the capture ids across a set of observed values. */
export function captureIdsOf(observed: readonly ObservedValue[]): string[] {
  const ids = new Set<string>()
  for (const entry of observed) for (const id of entry.captureIds) ids.add(id)
  return [...ids].sort(byString)
}

function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * Build a {@link DominantChoice} for `chosen` given the full observed tally.
 *
 * `chosen` need not be the most frequent value -- the caller may have applied
 * an ordering rule such as "closest to the median" -- but it must be one of the
 * observed values; a value nobody observed goes through {@link derive} or
 * {@link sanction} instead.
 */
export function decide(
  strategy: Exclude<DecisionStrategy, 'derived' | 'sanctioned-default' | 'user-override'>,
  chosen: string,
  observed: readonly ObservedValue[],
  options: { unit?: string } = {},
): DominantChoice {
  const total = observed.reduce((sum, entry) => sum + entry.count, 0)
  const winner = observed.find((entry) => entry.value === chosen)
  const chosenCount = winner?.count ?? 0
  const competitors = observed
    .filter((entry) => entry.value !== chosen)
    .map((entry) => ({ value: entry.value, count: entry.count }))

  const unit = options.unit ?? 'observation'
  const summary =
    total === 0
      ? `no observations supported ${chosen}`
      : `${chosenCount} of ${pluralise(total, unit)} at ${chosen}` +
        (competitors.length > 0 && competitors[0]
          ? ` (runner-up ${competitors[0].value}, ${competitors[0].count})`
          : '')

  return {
    strategy,
    chosen,
    chosenCount,
    totalCount: total,
    confidence: total === 0 ? 0 : Math.round((chosenCount / total) * 1000) / 1000,
    competitors,
    summary,
  }
}

/** Build a {@link DominantChoice} for a value that was computed, not observed. */
export function derive(chosen: string, derivation: Derivation): DominantChoice {
  return {
    strategy: 'derived',
    chosen,
    chosenCount: 0,
    totalCount: 0,
    confidence: 0,
    competitors: [],
    summary: `derived: ${derivation.detail}`,
    derivation,
  }
}

/**
 * Build a {@link DominantChoice} for a value the engine supplied outright.
 *
 * Use this only when the captures are silent *and* no other token implies the
 * answer -- nothing in a capture set describes a focus ring or a badge. Emitting
 * a stated default is better than emitting nothing, because silence is what
 * makes two consumers of the same kit ship two different products; labelling it
 * as a default is what stops the reader mistaking it for evidence.
 */
export function sanction(chosen: string, derivation: Derivation): DominantChoice {
  return {
    strategy: 'sanctioned-default',
    chosen,
    chosenCount: 0,
    totalCount: 0,
    confidence: 0,
    competitors: [],
    summary: `sanctioned default: ${derivation.detail}`,
    derivation,
  }
}

/**
 * Build a {@link DominantChoice} for a value a human set by hand.
 *
 * The engine's own decision is carried in `supersedes` rather than thrown away:
 * the panel needs it to report a conflict when fresh evidence disagrees with an
 * override, and `design.md` needs it to say what the kit would have chosen. An
 * override never rewrites `observed` -- the evidence is what it is.
 *
 * `fields` and `supersededValue` are given only for a token that holds several
 * overridable fields: which of them this decision set, and what stood in it
 * before. Omitting them means the decision answers for the whole token, which is
 * what every single-valued token needs -- there, `supersedes.chosen` is already
 * the engine's answer for the one value in play.
 */
export function userOverride(
  chosen: string,
  supersedes: DominantChoice,
  options: {
    note?: string
    resolvedConflict?: ResolvedConflict
    fields?: readonly string[]
    supersededValue?: string
  } = {},
): DominantChoice {
  const { note, resolvedConflict, fields, supersededValue } = options
  // What the engine said for the field this decision is about, which on a
  // multi-field token is not what the replaced decision's own `chosen` says.
  const replaced = supersededValue ?? supersedes.chosen
  const decision: DominantChoice = {
    strategy: 'user-override',
    chosen,
    chosenCount: 0,
    totalCount: 0,
    confidence: 0,
    competitors: [],
    summary:
      resolvedConflict === undefined
        ? `user override: ${chosen} (the engine chose ${replaced})`
        : `user override: ${chosen} (the engine chose ${replaced}); chosen in answer to the conflict against ${resolvedConflict.value}, which was set when the engine said ${resolvedConflict.baseValue}`,
    supersedes,
  }
  if (note !== undefined && note !== '') decision.note = note
  if (resolvedConflict !== undefined) decision.resolvedConflict = resolvedConflict
  if (fields !== undefined) decision.fields = [...fields].sort(byString)
  if (supersededValue !== undefined) decision.supersededValue = supersededValue
  return decision
}

/** Assemble a {@link Provenance} from an observed tally and a decision. */
export function provenance(observed: readonly ObservedValue[], decision: DominantChoice): Provenance {
  return { captureIds: captureIdsOf(observed), observed: [...observed], decision }
}
