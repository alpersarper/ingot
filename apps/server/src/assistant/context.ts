/**
 * What leaves this machine.
 *
 * Every assistant call sends exactly one thing besides the prompt template and
 * the user's own question: the brief built here. It is written as one function
 * so that the answer to "what does Ingot send to Anthropic" is a file somebody
 * can read rather than a survey of call sites, and so that the README's privacy
 * note can be checked against code instead of against memory.
 *
 * What goes in:
 *
 *   - the kit's identity -- set id, name, how many captures, which origins
 *     contributed and how many each, which component types were captured;
 *   - every overridable token: its path, kind, current value, and the
 *     provenance behind it (strategy, the dominant-choice summary, the raw
 *     values observed and how often);
 *   - the contrast pairs the engine guarantees, with their ratios;
 *   - the diagnostics the engine raised;
 *   - the reviewer's standing overrides -- path, value and their own reason.
 *
 * What never goes in, and the reason each is absent rather than merely
 * unnecessary:
 *
 *   - **The API key.** It is a header on the request, handled by the SDK, and
 *     it is not in this data at any point.
 *   - **The pairing token.** Nothing here reads it.
 *   - **Capture records.** The raw captures carry full CSS declarations, DOM
 *     context and source URLs. A kit is a distillation of them, and the
 *     distillation is what the assistant is being asked about, so the records
 *     themselves have no reason to travel.
 *   - **Screenshots.** They never leave the volume; the assistant is not shown
 *     images at all.
 *   - **Any other server state.** No settings, no other groups, no other kits.
 *     The brief is built from one tokens document and one review state, both
 *     passed in.
 *
 * Origins are the one judgement call, and they are in on purpose: "eleven
 * captures from stripe.com and three from linear.app" is a large part of what
 * makes a naming or merge suggestion sensible rather than generic, and it is
 * already in every `design.md` the user exports. The privacy note says so.
 */
import { originOf, tokenSlots } from '@ingot/engine'
import type { StoredOverride } from '../storage/store'
import type { TokenSlot, TokensDocument } from '@ingot/engine'

/**
 * How many distinct observed values to send per token.
 *
 * The tail of an observation list is a long list of one-off values, and a model
 * that reads thirty of them is paying for thirty of them. The top few are what
 * carry the shape of the decision.
 */
const OBSERVED_LIMIT = 4

/** One writable position, as the assistant is shown it. */
export interface BriefSlot {
  path: string
  group: string
  kind: string
  value: string
  /** measured, derived, filled, adjusted or overridden -- the engine's own word. */
  origin: string
  strategy: string
  /** The dominant-choice sentence, verbatim from the token's provenance. */
  decision: string
  /** The most-observed raw values, `"8px x 12"` style. Empty when nothing was observed. */
  observed: string[]
}

export interface KitBrief {
  set: {
    id: string
    name: string
    description: string
    captureCount: number
    origins: Array<{ origin: string; captureCount: number }>
    componentTypes: Array<{ type: string; count: number }>
  }
  colorMode: 'light' | 'dark'
  slots: BriefSlot[]
  contrast: Array<{ foreground: string; background: string; ratio: number; passes: boolean }>
  diagnostics: Array<{ level: string; code: string; path?: string; message: string }>
  overrides: Array<{ path: string; value: string; reason: string }>
}

/** Build the brief. Pure: the same kit and review state give the same bytes. */
export function kitBrief(tokens: TokensDocument, overrides: readonly StoredOverride[]): KitBrief {
  return {
    set: {
      id: tokens.source.setId,
      name: tokens.source.name,
      description: tokens.source.description,
      captureCount: tokens.source.captureCount,
      origins: tokens.source.origins.map((entry) => ({ ...entry })),
      componentTypes: tokens.source.componentTypes.map((entry) => ({ ...entry })),
    },
    colorMode: tokens.color.mode,
    slots: tokenSlots(tokens).map(briefSlot),
    contrast: tokens.color.contrast.map((pair) => ({
      foreground: pair.foreground,
      background: pair.background,
      ratio: pair.ratio,
      passes: pair.passes,
    })),
    diagnostics: tokens.diagnostics.map((diagnostic) => ({
      level: diagnostic.level,
      code: diagnostic.code,
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
      message: diagnostic.message,
    })),
    overrides: overrides.map((entry) => ({ path: entry.path, value: entry.value, reason: entry.note })),
  }
}

function briefSlot(slot: TokenSlot): BriefSlot {
  const decision = slot.provenance.decision
  return {
    path: slot.path,
    group: slot.group,
    kind: slot.kind,
    value: slot.value,
    origin: originOf(slot),
    strategy: decision.strategy,
    decision: decision.summary,
    observed: slot.provenance.observed
      .slice(0, OBSERVED_LIMIT)
      .map((entry) => `${entry.value} x ${entry.count}`),
  }
}

/**
 * The brief as the model reads it.
 *
 * JSON rather than prose: it is already structured data, and a model asked to
 * cite `color.roles.primary` does better when it has seen that string than when
 * it has seen a sentence about the primary colour. Indented, because the
 * savings from minifying are small and a readable payload is a payload a person
 * can check against the privacy note.
 */
export function renderBrief(brief: KitBrief): string {
  return JSON.stringify(brief, null, 1)
}
