/**
 * Review state: the overrides and the accepted decisions for one scope.
 *
 * The panel's main loop lives here. A reviewer opens a decision card, disagrees
 * with the engine, types a value; this is where that lands. Three things make
 * the endpoints look the way they do:
 *
 *   - **The server computes `baseValue`, not the client.** It is the engine's
 *     answer at the moment the override was made and it is the whole conflict
 *     mechanism, so it is read from the kit on the server rather than accepted
 *     from a browser that could get it wrong or stale.
 *   - **Every write answers with the whole effective kit.** An override changes
 *     the preview, the docs and every export at once; returning the new kit
 *     means the panel re-renders from one authoritative answer instead of
 *     patching a local copy and hoping it matches.
 *   - **Reviews key on the scope, not on a kit version.** Regenerating carries
 *     them forward, which is what makes an override a standing decision rather
 *     than an annotation on a snapshot.
 */
import { Hono } from 'hono'
import { readTokenValue } from '@ingot/engine'
import type { TokensDocument } from '@ingot/engine'
import { ApiError } from '../errors'
import { effectiveKit } from '../kit'
import type { EffectiveKit } from '../kit'
import type { AppContext, AppEnv } from '../context'
import type { Kit, ReviewScope } from '../storage/store'
import { optionalString, readJsonBody, requireString } from '../validate'

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
    const note = optionalString(body, 'note') ?? ''

    const kit = await latestKit(scope)
    // The engine's own answer, read from the kit as generated -- not from the
    // effective document, which may already carry this very override.
    const base = JSON.parse(kit.tokensJson) as TokensDocument
    const baseValue = readTokenValue(base, path)
    if (baseValue === null) {
      throw ApiError.unprocessable(`this kit has no token at ${path}, so there is nothing to override`)
    }

    await store.reviews.setOverride(scope, { path, value, baseValue, note })
    const effective = await effectiveKit(store, kit)

    // An override the engine refused is a bad request, not a stored value: it
    // would otherwise sit in the database being rejected on every read.
    const rejection = effective.rejected.find((entry) => entry.path === path)
    if (rejection !== undefined) {
      await store.reviews.clearOverride(scope, path)
      throw ApiError.unprocessable(rejection.reason)
    }

    return c.json(kitPayload(effective))
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
    const note = optionalString(body, 'note') ?? ''

    if (state === 'accepted') await store.reviews.acceptDecision(scope, cardId, note)
    else if (state === 'open') await store.reviews.reopenDecision(scope, cardId)
    else throw ApiError.badRequest("state must be 'accepted' or 'open'")

    return c.json(await respond(scope))
  })

  return app
}
