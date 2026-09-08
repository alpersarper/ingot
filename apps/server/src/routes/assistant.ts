/**
 * The assistant endpoints.
 *
 * Everything here sits behind the same two guards as the rest of the API -- the
 * pairing token and the CORS lock, both applied in `app.ts` before a request
 * reaches this file -- plus one guard nothing else needs: a server-side rate
 * limit. The reason is in `src/assistant/rate-limit.ts`; the short version is
 * that these are the only routes where a copied pairing token costs the user
 * money rather than privacy.
 *
 * The shape of this file follows one rule, which is the whole of deliverable 2:
 * **there is no path from a model's answer to a token that does not go through
 * a person.** `POST /suggest` runs a capability and stores what the engine
 * would accept; it changes nothing. `POST /proposals/:id/accept` is a separate
 * request, made by a click, and it writes through `planOverrideWrite` and
 * `store.reviews.setOverride` -- the same two calls the Tokens editor makes,
 * with `suggestedBy` set so the kit can say where the value came from.
 * `dismiss` writes nothing to the kit at all.
 *
 * The other rule is that no failure on this path is allowed to be a 500 with a
 * provider's message in it. Every `LlmError` is translated below into a status
 * and a sentence that has already been through redaction, and the untranslated
 * case is a bug rather than a leak: `app.ts` returns nothing of an unexpected
 * error's message.
 */
import { Hono } from 'hono'
import { asPristine, planOverrideWrite } from '@ingot/engine'
import type { TokensDocument } from '@ingot/engine'
import { ApiError } from '../errors'
import { effectiveKit, toEngineOverride } from '../kit'
import { kitPayload, scopeFrom } from './reviews'
import { LlmError } from '../assistant/llm'
import { rateLimit } from '../assistant/rate-limit'
import { PROPOSING_CAPABILITIES } from '../assistant/prompts'
import type { AppContext, AppEnv } from '../context'
import type { Kit, ReviewScope } from '../storage/store'
import { optionalNullableString, readJsonBody, requireString } from '../validate'

/**
 * The longest question the panel will forward.
 *
 * A bound at the boundary rather than a bound in the browser: the browser is
 * the part that could have been replaced, and an unbounded question is an
 * unbounded bill.
 */
const QUESTION_MAX = 1000

export function assistantRoutes(context: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { store, assistant, assistantLimiter } = context

  /** The kit an assistant call is about: the latest one for the scope. */
  async function latestKit(scope: ReviewScope): Promise<Kit> {
    const kit = await store.kits.latest(scope)
    if (!kit) {
      throw ApiError.conflict(
        'there is no kit for that scope yet; generate one before asking the assistant about it',
      )
    }
    return kit
  }

  /**
   * Status. Deliberately *not* rate-limited and deliberately free.
   *
   * The panel asks this on every load to decide whether to render the
   * assistant or its setup state, and a status call that could be rate-limited
   * out would make the assistant look broken exactly when a user is being told
   * how to set it up. It reaches no provider and spends nothing.
   */
  app.get('/', async (c) => {
    const scope = scopeFrom(c.req.query('groupId'))
    const limit = assistantLimiter.state()
    return c.json({
      assistant: {
        ...(await assistant.status()),
        rateLimit: { max: limit.max, windowMs: limit.windowMs, remaining: limit.remaining },
      },
      proposals: await store.proposals.list(scope),
    })
  })

  // Everything below this line spends the user's API credit, and everything
  // below it is counted. Registered as one middleware rather than per route so
  // that adding a capability cannot accidentally add an uncounted endpoint.
  app.use('/suggest', rateLimit(assistantLimiter))
  app.use('/ask', rateLimit(assistantLimiter))
  app.use('/name', rateLimit(assistantLimiter))
  app.use('/rationale', rateLimit(assistantLimiter))

  app.post('/suggest', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const capability = requireString(body, 'capability')
    if (!(PROPOSING_CAPABILITIES as readonly string[]).includes(capability)) {
      throw ApiError.badRequest(
        `capability must be one of ${PROPOSING_CAPABILITIES.join(', ')}; naming, rationale drafting and questions are answered on their own routes because they do not change the kit`,
      )
    }

    const kit = await latestKit(scope)
    const effective = await effectiveKit(store, kit)
    const result = await run(() =>
      assistant.suggest({
        scope,
        capability: capability as 'derive' | 'merge',
        tokens: effective.tokens,
        overrides: effective.overrides,
        pristine: asPristine(JSON.parse(kit.tokensJson) as TokensDocument),
        standing: effective.overrides.map(toEngineOverride),
      }),
    )

    return c.json({
      proposals: result.proposals,
      // How many the engine would not take. The values themselves are not
      // returned: a reviewer cannot act on them, and showing a rejected
      // suggestion invites someone to type it in by hand.
      refusedCount: result.refused.length,
      model: result.model,
    })
  })

  app.post('/ask', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const question = requireString(body, 'question')
    if (question.length > QUESTION_MAX) {
      throw ApiError.badRequest(`question must be at most ${QUESTION_MAX} characters; that one is ${question.length}`)
    }

    const effective = await effectiveKit(store, await latestKit(scope))
    return c.json(
      await run(() =>
        assistant.ask({ tokens: effective.tokens, overrides: effective.overrides, question }),
      ),
    )
  })

  app.post('/name', async (c) => {
    const body = c.req.header('content-type')?.includes('application/json') ? await readJsonBody(c.req.raw) : {}
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const effective = await effectiveKit(store, await latestKit(scope))
    return c.json({
      naming: await run(() => assistant.name({ tokens: effective.tokens, overrides: effective.overrides })),
    })
  })

  app.post('/rationale', async (c) => {
    const body = await readJsonBody(c.req.raw)
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const path = requireString(body, 'path')

    const effective = await effectiveKit(store, await latestKit(scope))
    if (!effective.overrides.some((entry) => entry.path === path)) {
      // Drafting a reason for a value nobody overrode would be drafting a
      // defence of the engine's own answer, which is what provenance already
      // is. Refused before a request is spent.
      throw ApiError.unprocessable(`there is no override at ${path}, so there is no decision to explain`)
    }

    return c.json(
      await run(() =>
        assistant.rationale({ tokens: effective.tokens, overrides: effective.overrides, path }),
      ),
    )
  })

  /**
   * Accept one proposal.
   *
   * Not rate-limited: it reaches no provider, it is a click a human made, and a
   * reviewer working through their queue must never be told to come back later.
   *
   * The value stored is the one on the proposal -- already canonicalised by the
   * engine when the card was made -- and it is written through the ordinary
   * write boundary, so everything that applies to a reviewer's own override
   * applies here: the redundancy refusal, the conflict bookkeeping, the
   * `baseValue` recorded from the baseline. If the kit has moved since the card
   * was made and the value is no longer applicable, this is where that is
   * found out, and it is reported rather than forced.
   */
  app.post('/proposals/:id/accept', async (c) => {
    const body = c.req.header('content-type')?.includes('application/json') ? await readJsonBody(c.req.raw) : {}
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const proposal = await store.proposals.get(scope, c.req.param('id'))
    if (!proposal) throw ApiError.notFound('no such assistant proposal')
    if (proposal.status !== 'open') {
      throw ApiError.conflict(`that proposal was already ${proposal.status}`)
    }

    const kit = await latestKit(scope)
    const standing = await store.reviews.overrides(scope)
    const plan = planOverrideWrite(
      asPristine(JSON.parse(kit.tokensJson) as TokensDocument),
      standing.map(toEngineOverride),
      {
        path: proposal.path,
        value: proposal.value,
        // The assistant's rationale becomes the reviewer's reason only where
        // they have not written one. Their own words are never overwritten by a
        // draft, and `design.md` prints whichever is there.
        ...(standing.some((entry) => entry.path === proposal.path && entry.note !== '')
          ? {}
          : { note: proposal.rationale.slice(0, 500) }),
        suggestedBy: 'assistant',
      },
    )
    if (plan.outcome === 'refused') throw ApiError.unprocessable(plan.reason)

    await store.reviews.setOverride(scope, plan.record)
    const resolved = await store.proposals.resolve(scope, proposal.id, 'accepted')

    return c.json({ ...kitPayload(await effectiveKit(store, kit)), proposal: resolved })
  })

  /** Dismiss one proposal. Writes nothing to the kit, by construction. */
  app.post('/proposals/:id/dismiss', async (c) => {
    const body = c.req.header('content-type')?.includes('application/json') ? await readJsonBody(c.req.raw) : {}
    const scope = scopeFrom(optionalNullableString(body, 'groupId'))
    const proposal = await store.proposals.get(scope, c.req.param('id'))
    if (!proposal) throw ApiError.notFound('no such assistant proposal')
    if (proposal.status === 'accepted') {
      throw ApiError.conflict('that proposal was already accepted; clear the override to undo it')
    }
    return c.json({ proposal: await store.proposals.resolve(scope, proposal.id, 'dismissed') })
  })

  return app
}

/**
 * Run one assistant call, translating provider failure into an API error.
 *
 * Every message that reaches a client from here has already been through
 * redaction inside the client implementation -- an `LlmError` is constructed
 * from `describeError`, never from a raw SDK error. This function chooses the
 * status; it does not build the sentence, precisely so there is no second place
 * where a provider's own words could be assembled into a response.
 */
async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof LlmError)) throw error
    switch (error.kind) {
      case 'auth':
        // 409 rather than 401: 401 on this API means "not paired", and the
        // panel sends an unpaired user back to the first-run screen. A bad
        // Anthropic key must not log anybody out of their own panel.
        throw ApiError.conflict(error.message)
      case 'rate-limit':
        throw new ApiError(429, 'upstream_rate_limited', error.message)
      case 'invalid-request':
      case 'unusable':
        throw ApiError.unprocessable(error.message)
      case 'unavailable':
        throw ApiError.upstream(error.message)
    }
  }
}
