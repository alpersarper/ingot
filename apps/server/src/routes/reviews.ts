/**
 * Review state: the overrides and the accepted decisions for one scope.
 *
 * The panel's main loop lives here. A reviewer opens a decision card, disagrees
 * with the engine, types a value; this is where that lands. Three things make
 * the endpoints look the way they do:
 *
 *   - **A candidate is judged before it is stored.** The engine decides whether
 *     an override is applicable, on a throwaway document. Storing first and
 *     compensating on refusal would let a mistyped edit destroy the override
 *     already standing at that path.
 *   - **This route determines nothing.** Whether a candidate is redundant,
 *     whether a conflict was standing, what the engine's answer was when the
 *     override was made, whether a write retired anything: every one of those is
 *     a question about which of the three kit documents was consulted, and
 *     `planOverrideWrite` answers all of them at once. What comes back is the
 *     row to persist. The route stores it and does not second-guess a field of
 *     it -- an approximation here is how `design.md` came to announce
 *     disagreements that were never reported.
 *   - **The engine's answer is read on the server, never taken from the
 *     client.** A browser could get it wrong or stale, and it is the whole
 *     conflict mechanism.
 *   - **Every write answers with the whole effective kit.** An override changes
 *     the preview, the docs and every export at once; returning the new kit
 *     means the panel re-renders from one authoritative answer instead of
 *     patching a local copy and hoping it matches.
 *   - **Reviews key on the scope, not on a kit version.** Regenerating carries
 *     them forward, which is what makes an override a standing decision rather
 *     than an annotation on a snapshot.
 */
import { Hono } from 'hono'
import { asPristine, planOverrideWrite } from '@ingot/engine'
import type { TokensDocument } from '@ingot/engine'
import { ApiError } from '../errors'
import { effectiveKit, toEngineOverride } from '../kit'
import type { EffectiveKit } from '../kit'
import type { AppContext, AppEnv } from '../context'
import type { Kit, ReviewScope } from '../storage/store'
import { optionalNullableString, optionalString, readJsonBody, requireString } from '../validate'

/**
 * The longest reason the panel will carry into `design.md`.
 *
 * A reason is a sentence explaining a decision, and it is rendered in a table
 * cell in the kit's primary deliverable. Bounding it at the boundary keeps one
 * paste of a whole document out of every reader's `design.md`.
 */
const NOTE_MAX = 500

/**
 * The reason this write supplies, or `undefined` when it supplies none.
 *
 * The distinction is the point. A write with no `note` at all -- answering a
 * conflict from its card, taking a runner-up in one click -- is not a statement
 * about the reason, so whatever the reviewer already wrote stands; the Tokens
 * editor keeps it by prefilling, and the two paths have to agree. An explicitly
 * empty note is a statement, and clears it.
 */
function reviewerNote(body: Record<string, unknown>): string | undefined {
  const note = optionalString(body, 'note')
  if (note !== undefined && note.length > NOTE_MAX) {
    throw ApiError.badRequest(`note must be at most ${NOTE_MAX} characters; that one is ${note.length}`)
  }
  return note
}

/** `groupId` absent, empty or `library` means the whole-library scope. */
export function scopeFrom(value: string | null | undefined): ReviewScope {
  return value === undefined || value === null || value === '' || value === 'library' ? null : value
}

/**
 * The panel's view of a kit: the kit, its effective tokens, and the review
 * state that produced them. One payload, because they are only ever true
 * together.
 */
export function kitPayload(effective: EffectiveKit): Record<string, unknown> {
  const { tokensJson: _tokens, designMd: _design, ...summary } = effective.kit
  return {
    kit: summary,
    tokens: effective.tokens,
    designMd: effective.designMd,
    review: {
      overrides: effective.overrides,
      conflicts: effective.report.conflicts,
      rejected: effective.report.rejected,
      accepted: effective.accepted,
    },
  }
}

export function reviewRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store } = context

  /** The kit a review applies to: the latest one for the scope. */
  async function latestKit(scope: ReviewScope): Promise<Kit> {
    const kit = await store.kits.latest(scope)
    if (!kit) {
      throw ApiError.conflict(
        'there is no kit for that scope yet; generate one before reviewing it — an override needs an engine answer to disagree with',
      )
    }
    return kit
  }

  async function respond(scope: ReviewScope): Promise<Record<string, unknown>> {
    return kitPayload(await effectiveKit(store, await latestKit(scope)))
  }

  app.get('/', async (c) => {
    const scope = scopeFrom(c.req.query('groupId'))
    const kit = await store.kits.latest(scope)
    // Reading review state before a kit exists is not an error: the panel asks
    // on load, and "nothing decided yet" is a real answer.
    return c.json({
      overrides: await store.reviews.overrides(scope),
      decisions: await store.reviews.decisions(scope),
      kitId: kit?.id ?? null,
    })
  })

  app.put('/overrides', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const path = requireString(body, 'path')
    const value = requireString(body, 'value')
    const submittedNote = reviewerNote(body)

    const kit = await latestKit(scope)
    const base = asPristine(JSON.parse(kit.tokensJson) as TokensDocument)
    const standing = await store.reviews.overrides(scope)

    // One call, and the row it hands back is stored verbatim. The engine picks
    // the document each question is asked of -- the stored distillation with
    // every *other* standing override replayed -- decides whether this write is
    // an override at all, whether it moved the value or only its reason, and
    // whether it answered a conflict, then reports `baseValue` and the record of
    // what was answered. None of that is recomputed here, because two ideas of
    // "the engine's current answer" is exactly the drift this seam removes.
    const plan = planOverrideWrite(base, standing.map(toEngineOverride), {
      path,
      value,
      // An absent note leaves the standing reason alone; an empty one clears it.
      ...(submittedNote === undefined ? {} : { note: submittedNote }),
    })

    // An override the engine refuses is a bad request, not a stored value -- and
    // the judgement has come *before* the write. `setOverride` upserts on
    // (scope, path), so persisting first would already have destroyed whatever
    // override was standing there, and the compensating delete would then take
    // the rest: a typo in an edit would silently discard a decision that was
    // working. Nothing is written unless the engine accepted it.
    if (plan.outcome === 'refused') throw ApiError.unprocessable(plan.reason)

    await store.reviews.setOverride(scope, plan.record)
    return c.json(kitPayload(await effectiveKit(store, kit)))
  })

  app.delete('/overrides', async (c) => {
    const scope = scopeFrom(c.req.query('groupId'))
    const path = c.req.query('path')
    if (path === undefined || path === '') throw ApiError.badRequest('path must be a non-empty query parameter')
    const removed = await store.reviews.clearOverride(scope, path)
    if (!removed) throw ApiError.notFound(`no override at ${path}`)
    return c.json(await respond(scope))
  })

  app.put('/decisions', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const cardId = requireString(body, 'cardId')
    const state = requireString(body, 'state')
    const note = reviewerNote(body) ?? ''

    if (state === 'accepted') await store.reviews.acceptDecision(scope, cardId, note)
    else if (state === 'open') await store.reviews.reopenDecision(scope, cardId)
    else throw ApiError.badRequest("state must be 'accepted' or 'open'")

    return c.json(await respond(scope))
  })

  return app
}
