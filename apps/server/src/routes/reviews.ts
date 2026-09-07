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
 *   - **Two different baselines, for two different questions.** `baseValue` is
 *     the engine's answer in the *pristine* distillation, because that is what a
 *     later regeneration is compared against; it must not start tracking other
 *     overrides. It is refreshed only by a write that moves the value: a
 *     conflict is retired by the reviewer responding to it, and adding a reason
 *     is not a response. Whether a candidate is redundant is asked of the *effective*
 *     document instead -- every other override replayed, this path's own left
 *     out -- because that is the value the reviewer is looking at, and replaying
 *     an override re-derives the heights and shades that depend on it.
 *   - **The server computes both, not the client.** They are read from the kit
 *     on the server rather than accepted from a browser that could get them
 *     wrong or stale.
 *   - **Every write answers with the whole effective kit.** An override changes
 *     the preview, the docs and every export at once; returning the new kit
 *     means the panel re-renders from one authoritative answer instead of
 *     patching a local copy and hoping it matches.
 *   - **Reviews key on the scope, not on a kit version.** Regenerating carries
 *     them forward, which is what makes an override a standing decision rather
 *     than an annotation on a snapshot.
 */
import { Hono } from 'hono'
import { applyOverrides, canonicalOverrideValue, overrideRejection, readTokenValue } from '@ingot/engine'
import type { ResolvedConflict, TokensDocument } from '@ingot/engine'
import { ApiError } from '../errors'
import { effectiveKit, toEngineOverride } from '../kit'
import type { EffectiveKit } from '../kit'
import type { AppContext, AppEnv } from '../context'
import type { Kit, ReviewScope } from '../storage/store'
import { optionalString, readJsonBody, requireString } from '../validate'

/**
 * The longest reason the panel will carry into `design.md`.
 *
 * A reason is a sentence explaining a decision, and it is rendered in a table
 * cell in the kit's primary deliverable. Bounding it at the boundary keeps one
 * paste of a whole document out of every reader's `design.md`.
 */
const NOTE_MAX = 500

function reviewerNote(body: Record<string, unknown>): string {
  const note = optionalString(body, 'note') ?? ''
  if (note.length > NOTE_MAX) {
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
      conflicts: effective.conflicts,
      rejected: effective.rejected,
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
    const scope = scopeFrom(optionalString(body, 'groupId') ?? null)
    const path = requireString(body, 'path')
    const value = requireString(body, 'value')
    const note = reviewerNote(body)

    const kit = await latestKit(scope)
    // The engine's own answer, read from the kit as generated -- not from the
    // effective document, which may already carry this very override.
    const base = JSON.parse(kit.tokensJson) as TokensDocument
    const baseValue = readTokenValue(base, path)
    if (baseValue === null) {
      throw ApiError.unprocessable(`this kit has no token at ${path}, so there is nothing to override`)
    }

    // What the reviewer is actually looking at: the standing decisions for every
    // *other* path replayed, so a dependent height or interaction shade carries
    // its re-derived value rather than the stored one. This path's own override
    // is left out, because the question is what the engine says without it.
    const standing = await store.reviews.overrides(scope)
    const others = standing.filter((entry) => entry.path !== path).map(toEngineOverride)
    const baseline = others.length === 0 ? base : applyOverrides(base, others).tokens

    // An override the engine refuses is a bad request, not a stored value -- and
    // the judgement has to come *before* the write. `setOverride` upserts on
    // (scope, path), so persisting first would already have destroyed whatever
    // override was standing there, and the compensating delete would then take
    // the rest: a typo in an edit would silently discard a decision that was
    // working. Nothing is written unless the engine would accept it.
    //
    // Editing an override the reviewer already owns is judged as an edit: a new
    // reason on an unchanged value, or the same value on one the evidence has
    // since caught up with, is a decision they already made and must not be
    // refused -- still less deleted.
    const existing = standing.find((entry) => entry.path === path)
    const rejection = overrideRejection(baseline, { path, value }, existing === undefined ? 'create' : 'edit')
    if (rejection !== undefined) throw ApiError.unprocessable(rejection)

    // Did the reviewer move the value, or only annotate it? Asked of the
    // canonical forms, because "10 px" and "10px" are one value and only the
    // engine knows that.
    const changed =
      existing === undefined ||
      canonicalOverrideValue(base, path, existing.value) !== canonicalOverrideValue(base, path, value)

    // `baseValue` is refreshed only by a write that moves the value. A conflict
    // is retired by the reviewer *responding* to it, and annotating is not a
    // response: refreshing on a note-only edit would silently drop a standing
    // `override.conflict` the reviewer never meant to answer.
    const record = existing === undefined || changed ? baseValue : existing.baseValue

    // ...and when a value change does answer a standing conflict, what it
    // answered is kept, so the report does not merely go quiet.
    const answered: ResolvedConflict | undefined =
      existing !== undefined && changed && existing.baseValue !== baseValue
        ? { value: existing.value, baseValue: existing.baseValue }
        : undefined

    await store.reviews.setOverride(scope, {
      path,
      value,
      baseValue: record,
      note,
      ...(answered === undefined ? {} : { resolvedConflict: answered }),
    })
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
    const scope = scopeFrom(optionalString(body, 'groupId') ?? null)
    const cardId = requireString(body, 'cardId')
    const state = requireString(body, 'state')
    const note = reviewerNote(body)

    if (state === 'accepted') await store.reviews.acceptDecision(scope, cardId, note)
    else if (state === 'open') await store.reviews.reopenDecision(scope, cardId)
    else throw ApiError.badRequest("state must be 'accepted' or 'open'")

    return c.json(await respond(scope))
  })

  return app
}
