/**
 * The readers: what each capability will accept as an answer.
 *
 * The provider is sent a JSON Schema and honours it, and these run anyway. That
 * is not belt-and-braces for its own sake -- it is the same rule the rest of
 * this server follows about data arriving from somewhere else. A schema a
 * provider enforces is a promise made by a system this process does not
 * control, and the thing on the other end of it is a language model. What
 * crosses into Ingot's own types crosses through a function that says what it
 * requires.
 *
 * Hand-written rather than schema-driven, for the same reason `src/validate.ts`
 * is: the shapes are small, the messages are better, and a validator library
 * whose only job is to re-check a schema the provider already applied would be
 * a dependency earning nothing.
 *
 * A throw here becomes an `LlmError` of kind `unusable` -- reported to the
 * reviewer, not retried. A model that answers in the wrong shape twice is the
 * ordinary case, not a transient one.
 */
import type { Candidate } from './proposals'

/** Longest single field the assistant may put on a card or in the panel. */
const MAX_TEXT = 2000

/** Most proposals one run may produce. The prompts ask for 3; this is the wall. */
const MAX_PROPOSALS = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, field: string, { max = MAX_TEXT } = {}): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`)
  if (value.length > max) throw new Error(`${field} is longer than ${max} characters`)
  return value.trim()
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

/* ------------------------------------------------------- derive and merge -- */

export interface ProposalAnswer {
  proposals: Candidate[]
}

/**
 * Read a proposing capability's answer.
 *
 * Only the four fields a card needs are taken. `merge` also returns `keeps`,
 * the path of the token being kept, and it is deliberately dropped rather than
 * carried: it is an explanation, the rationale already contains it in prose,
 * and a second path on a proposal would be a second thing a reviewer might
 * think the accept button touches.
 */
export function readProposals(value: unknown): ProposalAnswer {
  if (!isRecord(value)) throw new Error('the answer must be an object')
  const raw = array(value['proposals'], 'proposals')
  if (raw.length > MAX_PROPOSALS) {
    throw new Error(`the answer carries ${raw.length} proposals; at most ${MAX_PROPOSALS} are read`)
  }
  return {
    proposals: raw.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`proposals[${index}] must be an object`)
      return {
        path: text(entry['path'], `proposals[${index}].path`, { max: 200 }),
        value: text(entry['value'], `proposals[${index}].value`, { max: 500 }),
        title: text(entry['title'], `proposals[${index}].title`, { max: 200 }),
        rationale: text(entry['rationale'], `proposals[${index}].rationale`),
      }
    }),
  }
}

/* ------------------------------------------------------------------ name -- */

export interface NamedRole {
  path: string
  name: string
  rationale: string
}

export interface Naming {
  kitName: string
  kitDescription: string
  roles: NamedRole[]
}

/** Most roles a naming answer may cover. The prompt asks for 8. */
const MAX_ROLES = 16

export function readNaming(value: unknown): Naming {
  if (!isRecord(value)) throw new Error('the answer must be an object')
  const roles = array(value['roles'], 'roles')
  if (roles.length > MAX_ROLES) throw new Error(`the answer names ${roles.length} roles; at most ${MAX_ROLES} are read`)
  return {
    kitName: text(value['kitName'], 'kitName', { max: 200 }),
    kitDescription: text(value['kitDescription'], 'kitDescription'),
    roles: roles.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`roles[${index}] must be an object`)
      return {
        path: text(entry['path'], `roles[${index}].path`, { max: 200 }),
        name: text(entry['name'], `roles[${index}].name`, { max: 200 }),
        rationale: text(entry['rationale'], `roles[${index}].rationale`),
      }
    }),
  }
}

/* -------------------------------------------------------------- rationale -- */

/**
 * The longest drafted reason.
 *
 * The same bound the override route puts on a reviewer's own note, because it
 * is the same field: a draft that could not be saved as written would be a
 * draft that wastes the reviewer's time at the last step.
 */
const MAX_REASON = 500

export function readRationale(value: unknown): { reason: string } {
  if (!isRecord(value)) throw new Error('the answer must be an object')
  return { reason: text(value['reason'], 'reason', { max: MAX_REASON }) }
}

/* --------------------------------------------------------------------- qa -- */

export interface Answer {
  answer: string
  /** Token paths the answer rests on, as the model cited them. */
  citations: string[]
}

/** Most citations an answer may carry. Beyond this it is citing the whole kit. */
const MAX_CITATIONS = 24

export function readAnswer(value: unknown): Answer {
  if (!isRecord(value)) throw new Error('the answer must be an object')
  const citations = array(value['citations'], 'citations')
  if (citations.length > MAX_CITATIONS) {
    throw new Error(`the answer cites ${citations.length} paths; at most ${MAX_CITATIONS} are read`)
  }
  return {
    answer: text(value['answer'], 'answer', { max: 8000 }),
    citations: citations.map((entry, index) => text(entry, `citations[${index}]`, { max: 200 })),
  }
}
