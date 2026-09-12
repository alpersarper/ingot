/**
 * The prompt templates, versioned and in code.
 *
 * They are here rather than in a database or a config file for the same reason
 * the engine's heuristics are in code: they are the behaviour, they change
 * under review, and a change to one is a change a diff should show. Each
 * template carries a version string that travels with every proposal it
 * produces, so a card in the panel can be traced to the words that produced it
 * even after the words have moved on.
 *
 * One rule runs through all five, and it is the division of labour the whole
 * assistant is built on: **the model never does arithmetic the engine owns.**
 * It does not compute a contrast ratio, pick a base unit, resolve a conflict or
 * decide whether two colours are perceptually distinct -- the engine is
 * deterministic and correct about all of those and a language model is neither.
 * What it does is the part that is language: what should this be called, does
 * this pair of near-identical greys have a reason to be two things, what would
 * you write in the reason field, why is the radius 8. Where a proposal carries
 * a value, the value is checked by the engine before anybody is shown it --
 * see `proposals.ts`.
 *
 * The second rule is grounding. Every template says, in its own words, that the
 * only evidence is the brief; that a claim not supported by it must not be
 * made; and that "the kit does not say" is a complete answer. Q&A in
 * particular is worth less than nothing if it invents a plausible provenance,
 * because the entire product promise is that every value is traceable.
 */
import type { JsonSchema } from './llm'

/**
 * Bumped when a template's words change in a way that changes its answers.
 *
 * One version for the set rather than one each: they share the grounding rules
 * and the brief format, so a change to those changes all of them, and five
 * numbers that always move together are one number with extra bookkeeping.
 */
export const PROMPT_VERSION = 'assistant-prompts@2'

/** The capabilities, as the API names them. */
export type CapabilityId = 'name' | 'derive' | 'merge' | 'rationale' | 'qa'

/** Shared preamble. Identical bytes on every call, which is also cache-friendly. */
const GROUNDING = `You are the review assistant inside Ingot, a design-kit distillation workbench.

A deterministic engine has already distilled a set of captured UI components into one design kit. You are looking at that kit, every token in it, and the provenance behind each token: how the value was chosen, what was observed, and how confident the choice was.

Your role is advisory and it is narrow. You never change the kit. Everything you produce is a proposal a human reads and accepts or dismisses, or an answer to a question they asked.

Hard rules:
- The engine owns all arithmetic and all colour science: contrast ratios, colour distance, scale snapping, base units, derived interaction shades, conflict determination. Never recompute, second-guess or restate these as your own calculation. If a suggestion needs one, propose the change and let the engine check it.
- The brief you are given is your only evidence. Do not invent captures, values, origins or history that is not in it.
- Cite token paths exactly as they appear in the brief (for example \`color.roles.primary\`, \`components.recipes.button.primary.paddingX\`). A path you did not read in the brief does not exist.
- "The kit does not record that" is a correct and useful answer. A plausible invention is the worst thing you can produce here, because the entire value of this kit is that every number is traceable.
- Write for a working designer or engineer: plain, specific, no marketing register, no filler.`

/** A template: what to say, what shape to get back, and how big it may be. */
export interface PromptTemplate {
  id: CapabilityId
  version: string
  system: string
  schema: JsonSchema
  maxTokens: number
}

/* ------------------------------------------------------------------ name -- */

/**
 * Naming.
 *
 * This one produces *content*, not proposal cards, and the reason is worth
 * stating because it looks like an omission. The kit's colour roles are a
 * closed, stack-agnostic set -- `background`, `primary`, `textMuted` -- and
 * they are the contract every export and every consumer reads. There is no
 * writable name anywhere in the token model, so a "rename" proposal would be a
 * card whose accept button could not do anything: precisely the silent no-op
 * the engine/panel slot contract exists to prevent.
 *
 * So the assistant names the kit's *vocabulary* instead: for each role, what a
 * brand-meaningful name for this particular colour would be, and what the role
 * is doing in this kit. That is real work -- it is what a person writes at the
 * top of a design doc, and it is exactly the judgement a language model is good
 * at -- and it lands as text the reviewer can copy, not as a token write.
 */
const NAME: PromptTemplate = {
  id: 'name',
  version: PROMPT_VERSION,
  system: `${GROUNDING}

TASK: NAMING.

Read the kit's colour roles and typography, and give this kit a semantic vocabulary: for each notable colour role, a short brand-meaningful name a team would actually use for that specific colour, plus one line on what the role is doing in this kit.

Ingot's role names (background, surface, primary, textMuted, ...) are a fixed, stack-agnostic set and cannot be renamed — they are the contract every export depends on. So these names are documentation, not a rename: they belong at the top of a design document, in a Figma style, or in a conversation. Say nothing that implies the reviewer can apply them to the kit.

Also propose one short name and one sentence of description for the kit as a whole, drawn from what the palette, the type and the origins actually are.

Cover at most 8 roles — the ones with the most character. Skip roles whose name is already the only sensible thing to call them.`,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['kitName', 'kitDescription', 'roles'],
    properties: {
      kitName: { type: 'string' },
      kitDescription: { type: 'string' },
      roles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'name', 'rationale'],
          properties: {
            path: { type: 'string' },
            name: { type: 'string' },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
  maxTokens: 2000,
}

/* ---------------------------------------------------------------- derive -- */

/**
 * Gap filling.
 *
 * The engine states a `sanctioned-default` when the captures were silent and
 * nothing else in the document implied a value -- a font stack nobody captured,
 * a badge height nothing measured. Those are exactly the values a reader is
 * entitled to argue with, and they are the ones where taste, rather than
 * evidence, is the only thing available. So this asks for taste, informed by
 * everything the kit *does* say, and then hands the answer to the engine to
 * check.
 */
const DERIVE: PromptTemplate = {
  id: 'derive',
  version: PROMPT_VERSION,
  system: `${GROUNDING}

TASK: DERIVE MISSING VALUES.

Some tokens in this kit were not measured. Their provenance says \`sanctioned-default\` (the captures were silent and nothing else implied a value, so the engine supplied a house choice) or \`derived\` (computed from another token). These are the values a reviewer is most entitled to disagree with.

Find up to 3 where a better-fitting value follows from what the rest of this kit actually is, and propose it. Good candidates: a monospace stack that suits the sans stack that was measured; a control height or padding that sits on the kit's own spacing scale rather than beside it; a radius step consistent with the ones that were observed.

For each proposal give the exact token path, the replacement value in the same notation the brief shows for that path (\`8px\`, \`#0f7a5a\`, \`1.5\`, \`600\`, a radius step name like \`md\`, a full font stack), and a rationale that names the evidence in the kit that supports it.

Do not propose a value for a token whose origin is \`measured\` — captured evidence outranks your taste. Do not propose a colour unless the brief gives you a reason from the palette itself; the engine will check every colour against its contrast floor and reject one that cannot be drawn.

One colour is the exception, and it is the most useful thing you can offer. When the brief shows \`color.roles.destructive\` with the value \`none\` alongside a \`color.no-destructive\` diagnostic, this kit has no error colour, and a form built from it cannot signal an error at all. Propose one. Make it belong to *this* palette: read the chroma and lightness the brief's own roles sit at, keep to them, and place the hue in the red band — do not paste a red from another design system. Say in the rationale which roles you took the discipline from. The engine will contrast-check it against \`background\` and \`surface\` and refuse one it cannot draw.

Never propose a value for \`components.states.error.mode\`. Choosing to ship a kit that cannot signal errors in colour is a decision a person makes after being shown the consequence, and it is not yours to offer.

If nothing in this kit needs filling, return an empty list. An empty list is a good answer.`,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['proposals'],
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'value', 'title', 'rationale'],
          properties: {
            path: { type: 'string' },
            value: { type: 'string' },
            title: { type: 'string', description: 'One short line naming the change.' },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
  maxTokens: 2000,
}

/* ----------------------------------------------------------------- merge -- */

const MERGE: PromptTemplate = {
  id: 'merge',
  version: PROMPT_VERSION,
  system: `${GROUNDING}

TASK: MERGE NEAR-DUPLICATES.

A kit distilled from several sources often carries two tokens that are doing one job: two greys a hair apart, two paddings that differ by a pixel, two type steps nobody could tell apart. Each one is a decision a consumer of this kit will have to make and will make inconsistently.

Find up to 3 pairs in this kit that are close enough that having both is a cost with no benefit, and for each propose collapsing one onto the other: give the path of the token to change and the exact value of the token it should take, copied from the brief.

Judge closeness from the values and the roles in the brief — do not compute colour distance or contrast, the engine owns those and will check your proposal. Prefer keeping the value with more observations behind it and moving the one with fewer.

Do not propose merging two tokens that are semantically different even when their values match today: \`border\` and \`surfaceHover\` being equal is a fact about this palette, not a duplicate. Say what job the two share.

If this kit has no real duplicates, return an empty list.`,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['proposals'],
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'value', 'title', 'rationale', 'keeps'],
          properties: {
            path: { type: 'string', description: 'The token to change.' },
            value: { type: 'string', description: 'The value it should take.' },
            keeps: { type: 'string', description: 'The path of the token being kept as-is.' },
            title: { type: 'string' },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
  maxTokens: 2000,
}

/* ------------------------------------------------------------- rationale -- */

const RATIONALE: PromptTemplate = {
  id: 'rationale',
  version: PROMPT_VERSION,
  system: `${GROUNDING}

TASK: DRAFT A REASON.

A reviewer has overridden one token and has not written down why. That reason is carried into the exported \`design.md\`, where it is the only explanation anybody downstream will ever get for why this value disagrees with the evidence.

You are given the token, the value the reviewer set, the value the engine had chosen, and the evidence behind the engine's choice. Draft the reason they would plausibly have written: one or two sentences, first person, concrete, naming what was traded off.

It is a draft for a human to edit or discard, so do not hedge it into uselessness — but do not assert a motive the brief cannot support either. If the only honest reason is a preference, say it is a preference.`,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: { type: 'string' },
    },
  },
  maxTokens: 600,
}

/* -------------------------------------------------------------------- qa -- */

const QA: PromptTemplate = {
  id: 'qa',
  version: PROMPT_VERSION,
  system: `${GROUNDING}

TASK: ANSWER A QUESTION ABOUT THIS KIT.

Answer strictly from the brief. Every claim you make about why a value is what it is must come from that token's provenance — its strategy, its dominant-choice summary, the raw values observed — or from a diagnostic the engine raised.

Cite the token paths your answer rests on. If the brief does not contain the answer, say so plainly and say what the kit does record instead. Never explain a value by guessing at the design intent of a site the captures came from.

Two or three short paragraphs at most. If the question is not about this kit, say that.`,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'citations'],
    properties: {
      answer: { type: 'string' },
      citations: {
        type: 'array',
        description: 'Token paths the answer rests on, exactly as they appear in the brief.',
        items: { type: 'string' },
      },
    },
  },
  maxTokens: 1500,
}

export const PROMPTS: Record<CapabilityId, PromptTemplate> = {
  name: NAME,
  derive: DERIVE,
  merge: MERGE,
  rationale: RATIONALE,
  qa: QA,
}

/** Capabilities whose output is a kit change, so it must become a card. */
export const PROPOSING_CAPABILITIES: readonly CapabilityId[] = ['derive', 'merge']
