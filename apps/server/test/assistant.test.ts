/**
 * The assistant: what it advises, what it refuses, and what it must never leak.
 *
 * The suite is in two halves and the second one is the important one.
 *
 * The **pipeline** half proves the promise the feature is built around: a model
 * answer becomes a proposal only if the engine would take the value, a proposal
 * becomes a token only when a person accepts it, and dismissing writes nothing
 * to the kit. There is deliberately no test that the assistant writes a token,
 * because there is no code path that could.
 *
 * The **security** half is the captain's list, one test each. Each of them
 * fails loudly if the property stops holding, and each is written against the
 * behaviour rather than the implementation: a response-surface scan rather than
 * a check that a particular field is absent, a forced auth failure rather than
 * a unit test of the redactor, a real burst rather than a check that a limiter
 * exists.
 *
 * Everything runs against a scripted provider (`harness.llm`) -- no network, no
 * key, no cost. What is faked is only ever the model's answer; the engine
 * checks, the redaction, the rate limiter and the override write path are all
 * the real ones.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REDACTION_MARKER } from '../src/assistant/redact'
import { LLM_API_KEY_SETTING, LLM_MODEL_SETTING } from '../src/assistant/settings-keys'
import { createHarness, body } from './harness'
import type { Harness } from './harness'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** A key shaped like a real one, so a shape warning does not muddy a test. */
const KEY = 'sk-ant-api03-TESTKEYTESTKEYTESTKEYTESTKEY'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.close()
})

async function importAndGenerate(): Promise<void> {
  const set = JSON.parse(await readFile(`${ROOT}fixtures/ghost-warm/set.json`, 'utf8')) as unknown
  const imported = await harness.json<{ group: { id: string } }>('/api/captures/import', body(set))
  await harness.call('/api/kits', body({ groupId: imported.group.id }))
  // Every assistant call in this suite is about the library scope, which the
  // import also feeds, so the group id never has to be threaded through.
  await harness.call('/api/kits', body({ groupId: null }))
}

async function storeKey(key = KEY): Promise<void> {
  await harness.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmApiKey: key }) })
}

/* --------------------------------------------------------------- absence -- */

describe('graceful absence', () => {
  it('reports that it is not set up, without failing, when no key is stored', async () => {
    const status = await harness.json<{ assistant: { configured: boolean; source: string; model: string } }>(
      '/api/assistant',
    )
    expect(status.assistant.configured).toBe(false)
    expect(status.assistant.source).toBe('none')
    // The model is still reported: the setup screen says what it will ask, and
    // "which model" is not a question that needs a key to answer.
    expect(status.assistant.model).toBe('claude-sonnet-5')
  })

  it('leaves every other panel feature working with no key at all', async () => {
    await importAndGenerate()
    expect((await harness.call('/api/kits/latest')).status).toBe(200)
    expect((await harness.call('/api/export/design.md')).status).toBe(200)
    expect((await harness.call('/api/reviews')).status).toBe(200)
    expect(
      (await harness.call('/api/reviews/overrides', {
        method: 'PUT',
        body: JSON.stringify({ groupId: null, path: 'border.width', value: '3px' }),
      })).status,
    ).toBe(200)
  })

  it('refuses an assistant call with no key, as something the user can fix', async () => {
    await importAndGenerate()
    const response = await harness.call('/api/assistant/suggest', body({ capability: 'derive' }))
    // 409 rather than 401: a 401 on this API means "not paired", and a missing
    // Anthropic key must not log the user out of their own panel.
    expect(response.status).toBe(409)
    expect((await response.json() as { error: { message: string } }).error.message).toContain('every other feature')
  })
})

/* -------------------------------------------------------------- pipeline -- */

describe('the proposal pipeline', () => {
  it('turns a model answer the engine accepts into an open proposal, and changes nothing yet', async () => {
    await importAndGenerate()
    await storeKey()

    const before = await harness.json<{ tokens: { border: { width: { value: number } } } }>('/api/kits/latest')
    harness.llm.reply({
      proposals: [
        {
          path: 'border.width',
          value: '2px',
          title: 'Thicken the hairline',
          rationale: 'Every observed border was a hairline, but the kit is warm and 2px reads better on paper.',
        },
      ],
    })

    const result = await harness.json<{ proposals: Array<{ id: string; path: string; status: string }> }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]).toMatchObject({ path: 'border.width', status: 'open' })

    // Nothing has changed in the kit: a proposal is a suggestion, and there is
    // no code path from one to a token that does not go through a person.
    const after = await harness.json<{
      tokens: { border: { width: { value: number } } }
      review: { overrides: unknown[] }
    }>('/api/kits/latest')
    expect(after.tokens.border.width.value).toBe(before.tokens.border.width.value)
    expect(after.review.overrides).toEqual([])
  })

  it('never offers a value the engine would refuse', async () => {
    await importAndGenerate()
    await storeKey()

    harness.llm.reply({
      proposals: [
        // Not a token this kit has.
        { path: 'color.roles.invented', value: '#ff0000', title: 'A new role', rationale: 'Why not.' },
        // Not a length.
        { path: 'border.width', value: 'quite thick', title: 'Thicker', rationale: 'Vibes.' },
      ],
    })

    const result = await harness.json<{ proposals: unknown[]; refusedCount: number }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    expect(result.proposals).toEqual([])
    expect(result.refusedCount).toBe(2)
    // Refusals are logged rather than shown: a card whose accept button is
    // guaranteed to fail is worse than no card at all.
    expect(harness.logs.some((line) => line.includes('proposal refused'))).toBe(true)
  })

  it('applies an accepted proposal through the ordinary override path, with its own provenance', async () => {
    await importAndGenerate()
    await storeKey()

    harness.llm.reply({
      proposals: [
        {
          path: 'border.width',
          value: '2px',
          title: 'Thicken the hairline',
          rationale: 'The kit is warm and editorial; a hairline disappears on paper stock.',
        },
      ],
    })
    const suggested = await harness.json<{ proposals: Array<{ id: string }> }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    const id = suggested.proposals[0]?.id ?? ''

    const accepted = await harness.json<{
      tokens: {
        border: { width: { value: number; provenance: { decision: { strategy: string; suggestedBy?: string } } } }
      }
      review: { overrides: Array<{ path: string; value: string; note: string }> }
      proposal: { status: string }
    }>(`/api/assistant/proposals/${id}/accept`, body({}))

    expect(accepted.proposal.status).toBe('accepted')
    expect(accepted.tokens.border.width.value).toBe(2)
    // The decision is the reviewer's -- the strategy says so -- and where the
    // candidate came from is recorded beside it rather than instead of it.
    expect(accepted.tokens.border.width.provenance.decision.strategy).toBe('user-override')
    expect(accepted.tokens.border.width.provenance.decision.suggestedBy).toBe('assistant')
    expect(accepted.review.overrides).toHaveLength(1)
    expect(accepted.review.overrides[0]?.note).toContain('editorial')

    // And it is a real override in every export, not a special case.
    const design = await (await harness.call('/api/export/design.md')).text()
    expect(design).toContain('proposed by the Ingot assistant')
  })

  it('records nothing in the kit when a proposal is dismissed', async () => {
    await importAndGenerate()
    await storeKey()

    harness.llm.reply({
      proposals: [{ path: 'border.width', value: '2px', title: 'Thicker', rationale: 'Reads better.' }],
    })
    const suggested = await harness.json<{ proposals: Array<{ id: string }> }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    const id = suggested.proposals[0]?.id ?? ''

    const dismissed = await harness.json<{ proposal: { status: string } }>(
      `/api/assistant/proposals/${id}/dismiss`,
      body({}),
    )
    expect(dismissed.proposal.status).toBe('dismissed')

    const kit = await harness.json<{ review: { overrides: unknown[] } }>('/api/kits/latest')
    expect(kit.review.overrides).toEqual([])
    // The dismissal itself is kept -- review state, not kit state. A kept
    // dismissal suppresses the same suggestion while the engine's answer is
    // unchanged; when the evidence moves it may return, marked as a re-offer.
    expect((await harness.store.proposals.list(null)).map((entry) => entry.status)).toEqual(['dismissed'])
  })

  it('withholds a dismissed suggestion on a re-run while the engine\'s answer is unchanged', async () => {
    await importAndGenerate()
    await storeKey()

    harness.llm.reply({
      proposals: [{ path: 'border.width', value: '2px', title: 'Thicker', rationale: 'Reads better.' }],
    })
    const first = await harness.json<{ proposals: Array<{ id: string }> }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    await harness.call(`/api/assistant/proposals/${first.proposals[0]?.id ?? ''}/dismiss`, body({}))

    // The model proposes the very same thing again about the very same kit. A
    // person already answered it, and nothing they were answering has moved.
    harness.llm.reply({
      proposals: [{ path: 'border.width', value: '2px', title: 'Thicker', rationale: 'Reads better.' }],
    })
    const second = await harness.json<{ proposals: unknown[]; refusedCount: number }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    expect(second.proposals).toEqual([])
    // Withheld, not refused: the engine never judged it, a human did.
    expect(second.refusedCount).toBe(0)
    expect(harness.logs.some((line) => line.includes('withheld'))).toBe(true)

    const state = await harness.json<{ proposals: Array<{ path: string; status: string }> }>('/api/assistant')
    expect(state.proposals.map((entry) => `${entry.path}:${entry.status}`)).toEqual(['border.width:dismissed'])

    // A different capability at the same path is a different kind of
    // suggestion, and the dismissal does not silence it.
    harness.llm.reply({
      proposals: [{ path: 'border.width', value: '2px', title: 'One border', rationale: 'Two widths, one look.' }],
    })
    const merged = await harness.json<{ proposals: Array<{ path: string; status: string; reoffered?: boolean }> }>(
      '/api/assistant/suggest',
      body({ capability: 'merge' }),
    )
    expect(merged.proposals).toHaveLength(1)
    expect(merged.proposals[0]?.reoffered).toBeUndefined()
  })

  it('re-offers a dismissed suggestion when the engine\'s answer moves, marked as such', async () => {
    await importAndGenerate()
    await storeKey()

    const path = 'components.recipes.button.secondary.height'
    const candidate = { path, value: '44px', title: 'A taller secondary', rationale: 'A 44px target reads calmer.' }

    harness.llm.reply({ proposals: [candidate] })
    const first = await harness.json<{ proposals: Array<{ id: string; reoffered?: boolean }> }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    expect(first.proposals[0]?.reoffered).toBeUndefined()
    await harness.call(`/api/assistant/proposals/${first.proposals[0]?.id ?? ''}/dismiss`, body({}))

    // The kit has not moved, so the dismissal holds.
    harness.llm.reply({ proposals: [candidate] })
    const held = await harness.json<{ proposals: unknown[] }>('/api/assistant/suggest', body({ capability: 'derive' }))
    expect(held.proposals).toEqual([])

    // A wider border re-derives every bordered control's height, so the
    // engine's answer at the path is no longer the one the dismissal was made
    // against -- the world the reviewer said no in has changed.
    await harness.call('/api/reviews/overrides', {
      method: 'PUT',
      body: JSON.stringify({ groupId: null, path: 'border.width', value: '3px' }),
    })

    harness.llm.reply({ proposals: [candidate] })
    const reoffered = await harness.json<{
      proposals: Array<{ path: string; status: string; reoffered?: boolean }>
    }>('/api/assistant/suggest', body({ capability: 'derive' }))
    expect(reoffered.proposals).toHaveLength(1)
    // Back, but never as though it were new: the card says what changed.
    expect(reoffered.proposals[0]).toMatchObject({ path, status: 'open', reoffered: true })
  })

  it('refuses to accept the same proposal twice', async () => {
    await importAndGenerate()
    await storeKey()
    harness.llm.reply({
      proposals: [{ path: 'border.width', value: '2px', title: 'Thicker', rationale: 'Reads better.' }],
    })
    const suggested = await harness.json<{ proposals: Array<{ id: string }> }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    const id = suggested.proposals[0]?.id ?? ''

    expect((await harness.call(`/api/assistant/proposals/${id}/accept`, body({}))).status).toBe(200)
    expect((await harness.call(`/api/assistant/proposals/${id}/accept`, body({}))).status).toBe(409)
  })

  it('replaces only the re-run capability\'s open queue and keeps what was decided', async () => {
    await importAndGenerate()
    await storeKey()

    harness.llm.reply({
      proposals: [
        { path: 'border.width', value: '2px', title: 'Thicker', rationale: 'One.' },
        { path: 'radius.steps.md', value: '10px', title: 'Rounder', rationale: 'Two.' },
      ],
    })
    const first = await harness.json<{ proposals: Array<{ id: string; path: string }> }>(
      '/api/assistant/suggest',
      body({ capability: 'derive' }),
    )
    const kept = first.proposals.find((entry) => entry.path === 'border.width')?.id ?? ''
    await harness.call(`/api/assistant/proposals/${kept}/accept`, body({}))

    // A merge run leaves the still-open derive card alone: clearing is
    // capability-scoped, so one capability's fresh reading never silently
    // destroys another's unreviewed cards.
    harness.llm.reply({
      proposals: [{ path: 'radius.steps.sm', value: '3px', title: 'One small radius', rationale: 'Merge.' }],
    })
    await harness.call('/api/assistant/suggest', body({ capability: 'merge' }))

    const afterMerge = await harness.store.proposals.list(null)
    expect(afterMerge.map((entry) => `${entry.capability}:${entry.path}:${entry.status}`).sort()).toEqual([
      'derive:border.width:accepted',
      'derive:radius.steps.md:open',
      'merge:radius.steps.sm:open',
    ])

    harness.llm.reply({
      proposals: [{ path: 'radius.steps.lg', value: '16px', title: 'Rounder still', rationale: 'Three.' }],
    })
    await harness.call('/api/assistant/suggest', body({ capability: 'derive' }))

    const proposals = await harness.store.proposals.list(null)
    // The accepted derive survives; the untouched open one from the first
    // derive run does not, because it was a reading of a kit that has since
    // moved -- while the merge card, which the derive re-run has no business
    // touching, is still there to be worked through.
    expect(proposals.map((entry) => `${entry.capability}:${entry.path}:${entry.status}`).sort()).toEqual([
      'derive:border.width:accepted',
      'derive:radius.steps.lg:open',
      'merge:radius.steps.sm:open',
    ])
  })

  it('offers a proposal at an overridden token without a phantom conflict', async () => {
    await importAndGenerate()
    await storeKey()

    // A standing override at the very path the model will target.
    await harness.call('/api/reviews/overrides', {
      method: 'PUT',
      body: JSON.stringify({ groupId: null, path: 'border.width', value: '2px' }),
    })

    harness.llm.reply({
      proposals: [{ path: 'border.width', value: '3px', title: 'Thicker still', rationale: 'A bolder frame.' }],
    })
    const result = await harness.json<{
      proposals: Array<{ path: string; baseValue: string; engineNotes: string[] }>
      refusedCount: number
    }>('/api/assistant/suggest', body({ capability: 'derive' }))

    expect(result.refusedCount).toBe(0)
    expect(result.proposals).toHaveLength(1)
    // The base value is still the engine's own answer, not the override's.
    expect(result.proposals[0]?.baseValue).toBe('1px')
    // Accepting upserts on the path, replacing the standing override, so no
    // conflict between the two can ever exist and the card must not claim one.
    expect(result.proposals[0]?.engineNotes.join('\n')).not.toContain('still in force')
  })

  it('still reports a genuine consequence when the proposal targets an overridden token', async () => {
    await importAndGenerate()
    await storeKey()

    await harness.call('/api/reviews/overrides', {
      method: 'PUT',
      body: JSON.stringify({ groupId: null, path: 'color.roles.primary', value: '#136f54' }),
    })

    // A pure black primary leaves its darker-walked hover and active shades
    // nowhere to go, which the engine says out loud -- the consequence half of
    // the card, which losing the phantom conflict must not lose with it.
    harness.llm.reply({
      proposals: [
        { path: 'color.roles.primary', value: '#000000', title: 'Ink primary', rationale: 'Match the text.' },
      ],
    })
    const result = await harness.json<{
      proposals: Array<{ engineNotes: string[] }>
      refusedCount: number
    }>('/api/assistant/suggest', body({ capability: 'derive' }))

    expect(result.refusedCount).toBe(0)
    expect(result.proposals).toHaveLength(1)
    const notes = result.proposals[0]?.engineNotes ?? []
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.join('\n')).not.toContain('still in force')
  })

  it('grounds an answer in the kit and names any citation that does not resolve', async () => {
    await importAndGenerate()
    await storeKey()

    harness.llm.reply({
      answer: 'The base border width is a hairline because every capture that drew a line drew one.',
      citations: ['border.width', 'color.roles.nonexistent'],
    })
    const answer = await harness.json<{
      answer: string
      citations: Array<{ path: string; value: string; decision: string }>
      unresolved: string[]
    }>('/api/assistant/ask', body({ question: 'Why is the border 1px?' }))

    expect(answer.citations).toHaveLength(1)
    expect(answer.citations[0]?.path).toBe('border.width')
    // The citation carries the token's own dominant-choice record, so the panel
    // shows the evidence rather than the model's summary of it.
    expect(answer.citations[0]?.decision).not.toBe('')
    expect(answer.unresolved).toEqual(['color.roles.nonexistent'])
  })

  it('will not draft a reason for a value nobody overrode', async () => {
    await importAndGenerate()
    await storeKey()
    const response = await harness.call('/api/assistant/rationale', body({ path: 'border.width' }))
    expect(response.status).toBe(422)
    // Refused before a request is spent: there was no call to the provider.
    expect(harness.llm.calls).toHaveLength(0)
  })

  it('reports an unusable answer without retrying and without quoting it back', async () => {
    await importAndGenerate()
    await storeKey()
    // `proposals` missing entirely: the reader throws, and the throw is a
    // report rather than a retry.
    harness.llm.reply({ nonsense: true })
    const response = await harness.call('/api/assistant/suggest', body({ capability: 'derive' }))
    expect(response.status).toBe(422)
    expect(harness.llm.calls).toHaveLength(1)
  })
})

/* ------------------------------------------------------- what is sent out -- */

describe('what leaves the machine', () => {
  it('sends the kit and its provenance, and nothing else this server holds', async () => {
    await importAndGenerate()
    await storeKey()
    harness.llm.reply({ proposals: [] })
    await harness.call('/api/assistant/suggest', body({ capability: 'derive' }))

    const sent = `${harness.llm.calls[0]?.system ?? ''}\n${harness.llm.calls[0]?.messages.map((m) => m.content).join('\n') ?? ''}`

    // The kit is there, with its provenance.
    expect(sent).toContain('border.width')
    expect(sent).toContain('"decision"')

    // The secrets are not, and neither is anything the kit is not made of.
    expect(sent).not.toContain(KEY)
    expect(sent).not.toContain(harness.context.pairingToken)
    // No raw capture records: a capture carries full CSS declarations and a
    // `capturedAt`, and the assistant is asked about the distillation.
    expect(sent).not.toContain('"capturedAt"')
    expect(sent).not.toContain('"styles"')
  })
})

/* -------------------------------------------------------------- security -- */

describe('the API key never comes out', () => {
  it('is absent from every response the API will produce', async () => {
    await importAndGenerate()
    await storeKey()
    await harness.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmModel: 'claude-opus-5' }) })
    harness.llm.reply({ proposals: [] })
    await harness.call('/api/assistant/suggest', body({ capability: 'derive' }))

    // A scan of the surface rather than a check of one field: the promise is
    // about every response, so the test walks every response.
    const paths = [
      '/api/health',
      '/api/pairing',
      '/api/settings',
      '/api/assistant',
      '/api/captures',
      '/api/captures/tags',
      '/api/groups',
      '/api/kits',
      '/api/kits/latest',
      '/api/reviews',
      '/api/export/design.md',
      '/api/export/tokens.json',
      '/api/export/components/button-primary.md',
    ]
    for (const path of paths) {
      const response = await harness.call(path)
      const text = await response.text()
      expect(text, `${path} body`).not.toContain(KEY)
      // Headers too: a key echoed into a header would pass a body scan.
      expect(JSON.stringify([...response.headers]), `${path} headers`).not.toContain(KEY)
    }

    // And it really is stored -- the point is that it is stored *and* invisible.
    expect(await harness.store.settings.get(LLM_API_KEY_SETTING)).toBe(KEY)
  })

  it('has no read endpoint: set, replace and delete exist, and nothing returns it', async () => {
    await storeKey()
    expect(await harness.store.settings.get(LLM_API_KEY_SETTING)).toBe(KEY)

    // Replace.
    await storeKey('sk-ant-api03-SECONDKEYSECONDKEYSECONDKEY')
    expect(await harness.store.settings.get(LLM_API_KEY_SETTING)).toBe('sk-ant-api03-SECONDKEYSECONDKEYSECONDKEY')

    // Delete, by its own endpoint and by the PUT-null form the panel uses.
    const deleted = await harness.json<{ removed: boolean }>('/api/settings/llm-key', { method: 'DELETE' })
    expect(deleted.removed).toBe(true)
    expect(await harness.store.settings.get(LLM_API_KEY_SETTING)).toBeNull()
    await storeKey()
    await harness.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmApiKey: null }) })
    expect(await harness.store.settings.get(LLM_API_KEY_SETTING)).toBeNull()

    // There is no GET that returns it, under any spelling.
    for (const path of ['/api/settings/llm-key', '/api/settings/key', '/api/assistant/key']) {
      expect((await harness.call(path)).status, path).toBe(404)
    }
  })

  it('redacts the key from a provider error, in the log and in the response', async () => {
    await importAndGenerate()
    await storeKey()

    // What a provider SDK actually does on an auth failure: build an error out
    // of the request that failed, headers included. Nothing in this test
    // redacts it -- the assistant's own path has to.
    harness.llm.fail(
      new Error(
        `401 Unauthorized: {"type":"error","error":{"message":"invalid x-api-key"}} (request headers: {"x-api-key":"${KEY}"})`,
      ),
    )

    const response = await harness.call('/api/assistant/suggest', body({ capability: 'derive' }))
    const text = await response.text()

    expect(text).not.toContain(KEY)
    expect(harness.logs.join('\n')).not.toContain(KEY)
    // A silently stripped key reads as a message that never had one, and then
    // nobody notices when the stripping stops working. The marker is the thing
    // a person greps for and this test asserts on.
    expect(harness.logs.join('\n')).toContain(REDACTION_MARKER)
  })

  it('redacts a truncated key too, because half a key is still a key', async () => {
    await importAndGenerate()
    await storeKey()
    harness.llm.fail(new Error(`invalid x-api-key: ${KEY.slice(0, 24)}...`))

    await harness.call('/api/assistant/suggest', body({ capability: 'derive' }))
    const logged = harness.logs.join('\n')
    expect(logged).not.toContain(KEY.slice(0, 24))
    expect(logged).toContain(REDACTION_MARKER)
  })
})

describe('rate limiting', () => {
  it('429s a burst, so a copied pairing token cannot become a spend loop', async () => {
    const limited = await createHarness({ INGOT_ASSISTANT_RATE_LIMIT: '3', INGOT_ASSISTANT_RATE_WINDOW_MS: '60000' })
    try {
      const set = JSON.parse(await readFile(`${ROOT}fixtures/ghost-warm/set.json`, 'utf8')) as unknown
      await limited.call('/api/captures/import', body(set))
      await limited.call('/api/kits', body({ groupId: null }))
      await limited.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmApiKey: KEY }) })

      const statuses: number[] = []
      for (let attempt = 0; attempt < 5; attempt += 1) {
        limited.llm.reply({ proposals: [] })
        statuses.push((await limited.call('/api/assistant/suggest', body({ capability: 'derive' }))).status)
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429])

      // The window is a window, not a wall: it reopens.
      limited.advance(60_000)
      limited.llm.reply({ proposals: [] })
      expect((await limited.call('/api/assistant/suggest', body({ capability: 'derive' }))).status).toBe(200)
    } finally {
      await limited.close()
    }
  })

  it('counts every capability against one budget, and says how long to wait', async () => {
    const limited = await createHarness({ INGOT_ASSISTANT_RATE_LIMIT: '2', INGOT_ASSISTANT_RATE_WINDOW_MS: '30000' })
    try {
      const set = JSON.parse(await readFile(`${ROOT}fixtures/ghost-warm/set.json`, 'utf8')) as unknown
      await limited.call('/api/captures/import', body(set))
      await limited.call('/api/kits', body({ groupId: null }))
      await limited.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmApiKey: KEY }) })

      limited.llm.reply({
        proposals: [
          { path: 'border.width', value: '2px', title: 'Thicker', rationale: 'Reads better.' },
          { path: 'radius.steps.md', value: '10px', title: 'Rounder', rationale: 'Softer.' },
        ],
      })
      const suggested = await limited.json<{ proposals: Array<{ id: string }> }>(
        '/api/assistant/suggest',
        body({ capability: 'derive' }),
      )
      limited.llm.reply({ kitName: 'Warm', kitDescription: 'A warm kit.', roles: [] })
      await limited.call('/api/assistant/name', body({}))

      // A third call of any kind is over budget: one budget, not one per route.
      const refused = await limited.call('/api/assistant/ask', body({ question: 'Why is the radius 8?' }))
      expect(refused.status).toBe(429)
      expect(refused.headers.get('Retry-After')).not.toBeNull()

      // Accepting and dismissing a proposal are not counted: they reach no
      // provider, and a reviewer working through their queue must never be
      // told to come back later. Neither is the status call the panel loads by.
      const [toAccept, toDismiss] = suggested.proposals
      expect((await limited.call(`/api/assistant/proposals/${toAccept?.id ?? ''}/accept`, body({}))).status).toBe(200)
      expect((await limited.call(`/api/assistant/proposals/${toDismiss?.id ?? ''}/dismiss`, body({}))).status).toBe(200)
      expect((await limited.call('/api/assistant')).status).toBe(200)

      // And the budget still stands for anything that would reach a provider.
      expect((await limited.call('/api/assistant/suggest', body({ capability: 'derive' }))).status).toBe(429)
    } finally {
      await limited.close()
    }
  })
})

describe('the existing guards still cover it', () => {
  it('refuses every assistant route without the pairing token', async () => {
    const paths: Array<[string, RequestInit]> = [
      ['/api/assistant', {}],
      ['/api/assistant/suggest', { method: 'POST', body: '{}' }],
      ['/api/assistant/ask', { method: 'POST', body: '{}' }],
      ['/api/assistant/name', { method: 'POST', body: '{}' }],
      ['/api/assistant/rationale', { method: 'POST', body: '{}' }],
      ['/api/assistant/proposals/whatever/accept', { method: 'POST', body: '{}' }],
      ['/api/assistant/proposals/whatever/dismiss', { method: 'POST', body: '{}' }],
    ]
    for (const [path, init] of paths) {
      expect((await harness.raw(path, init)).status, `${init.method ?? 'GET'} ${path}`).toBe(401)
    }
  })

  it('refuses an assistant request from an origin that is not the panel', async () => {
    const refused = await harness.call('/api/assistant/suggest', {
      method: 'POST',
      body: '{}',
      headers: { origin: 'https://evil.example' },
    })
    expect(refused.status).toBe(403)
  })
})

describe('the model setting', () => {
  it('defaults, stores a choice, and refuses to be edited when the environment pins it', async () => {
    expect((await harness.json<{ settings: { llm: { model: string } } }>('/api/settings')).settings.llm.model).toBe(
      'claude-sonnet-5',
    )
    await harness.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmModel: 'claude-opus-5' }) })
    expect(await harness.store.settings.get(LLM_MODEL_SETTING)).toBe('claude-opus-5')

    const pinned = await createHarness({ INGOT_LLM_MODEL: 'claude-haiku-4-5' })
    try {
      const settings = await pinned.json<{ settings: { llm: { model: string; modelManagedByEnvironment: boolean } } }>(
        '/api/settings',
      )
      expect(settings.settings.llm.model).toBe('claude-haiku-4-5')
      expect(settings.settings.llm.modelManagedByEnvironment).toBe(true)
      const response = await pinned.call('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ llmModel: 'claude-opus-5' }),
      })
      expect(response.status).toBe(409)
    } finally {
      await pinned.close()
    }
  })
})
