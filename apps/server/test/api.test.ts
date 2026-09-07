/**
 * The API: what it refuses, what it accepts, and what it must never say.
 *
 * The three groups below are the three promises this server makes. Pairing is
 * the only thing between the API and any page in any tab; the LLM key is the
 * one value that goes in and never comes out; and the import-to-kit path is
 * what the panel actually walks.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PAIRING_HEADER } from '../src/pairing'
import { LLM_API_KEY_SETTING } from '../src/routes/settings'
import { createHarness, TEST_TOKEN, body, put } from './harness'
import type { Harness } from './harness'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

async function ghostWarmSet(): Promise<unknown> {
  return JSON.parse(await readFile(`${ROOT}fixtures/ghost-warm/set.json`, 'utf8'))
}

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.close()
})

describe('pairing', () => {
  it('rejects every API call that does not present the token', async () => {
    const paths: Array<[string, RequestInit]> = [
      ['/api/captures', {}],
      ['/api/groups', {}],
      ['/api/kits', {}],
      ['/api/settings', {}],
      ['/api/export/design.md', {}],
      ['/api/captures/import', { method: 'POST', body: '{}' }],
      ['/api/kits', { method: 'POST', body: '{}' }],
    ]
    for (const [path, init] of paths) {
      const response = await harness.raw(path, init)
      expect(response.status, `${init.method ?? 'GET'} ${path}`).toBe(401)
    }
  })

  it('rejects a wrong token, and one of the wrong length', async () => {
    for (const token of ['nope', `${TEST_TOKEN}x`, '']) {
      const response = await harness.raw('/api/captures', { headers: { [PAIRING_HEADER]: token } })
      expect(response.status).toBe(401)
    }
  })

  it('leaves health and pairing open, because a client needs them before it is paired', async () => {
    expect((await harness.raw('/api/health')).status).toBe(200)
    expect((await harness.raw('/api/pairing')).status).toBe(200)
  })

  it('never puts the token in a response body', async () => {
    for (const path of ['/api/health', '/api/pairing']) {
      expect(await (await harness.raw(path)).text()).not.toContain(TEST_TOKEN)
    }
    const verified = await harness.raw('/api/pairing/verify', body({ token: TEST_TOKEN }))
    expect(verified.status).toBe(200)
    expect(await verified.text()).not.toContain(TEST_TOKEN)
  })

  it('verifies a correct token and refuses a wrong one', async () => {
    expect((await harness.raw('/api/pairing/verify', body({ token: TEST_TOKEN }))).status).toBe(200)
    expect((await harness.raw('/api/pairing/verify', body({ token: 'wrong' }))).status).toBe(401)
  })
})

describe('cors', () => {
  it('refuses a cross-origin request from a page that is not the panel', async () => {
    const response = await harness.raw('/api/health', { headers: { origin: 'https://evil.example' } })
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows the configured panel origin and the server\'s own origin', async () => {
    for (const origin of ['http://localhost:5173', 'http://localhost:4310']) {
      const response = await harness.raw('/api/health', { headers: { origin } })
      expect(response.status, origin).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    }
  })

  it('answers a preflight for the panel origin only', async () => {
    const allowed = await harness.raw('/api/captures', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    })
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-headers')).toContain(PAIRING_HEADER)

    const refused = await harness.raw('/api/captures', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    expect(refused.status).toBe(403)
  })
})

describe('settings and the LLM key', () => {
  it('reports absence, then presence, and never the value', async () => {
    expect(await harness.json('/api/settings')).toMatchObject({
      settings: { llm: { configured: false, source: 'none' } },
    })

    const saved = await harness.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmApiKey: 'sk-secret-value' }) })
    expect(saved.status).toBe(200)
    expect(await saved.text()).not.toContain('sk-secret-value')

    // It is really stored -- the point is that it is stored *and* invisible.
    expect(await harness.store.settings.get(LLM_API_KEY_SETTING)).toBe('sk-secret-value')

    const read = await harness.call('/api/settings')
    expect(await read.text()).not.toContain('sk-secret-value')
    expect(await harness.json('/api/settings')).toMatchObject({
      settings: { llm: { configured: true, source: 'settings' } },
    })
  })

  it('clears the key when sent null', async () => {
    await harness.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmApiKey: 'sk-secret-value' }) })
    await harness.call('/api/settings', { method: 'PUT', body: JSON.stringify({ llmApiKey: null }) })
    expect(await harness.store.settings.get(LLM_API_KEY_SETTING)).toBeNull()
  })

  it('refuses to overwrite a key pinned in the environment', async () => {
    const pinned = await createHarness({ INGOT_LLM_API_KEY: 'sk-from-env' })
    try {
      expect(await pinned.json('/api/settings')).toMatchObject({
        settings: { llm: { configured: true, source: 'environment', managedByEnvironment: true } },
      })
      const response = await pinned.call('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ llmApiKey: 'sk-from-panel' }),
      })
      expect(response.status).toBe(409)
      expect(await response.text()).not.toContain('sk-from-env')
    } finally {
      await pinned.close()
    }
  })
})

describe('capture import', () => {
  it('accepts a fixture set verbatim and lists what it stored', async () => {
    const set = (await ghostWarmSet()) as { captures: unknown[] }
    const response = await harness.call('/api/captures/import', body(set))
    expect(response.status).toBe(201)

    const imported = (await response.json()) as { group: { id: string; slug: string; captureCount: number } }
    expect(imported.group.slug).toBe('ghost-warm')
    expect(imported.group.captureCount).toBe(set.captures.length)

    const listed = await harness.json<{ captures: Array<{ id: string }> }>('/api/captures')
    expect(listed.captures).toHaveLength(set.captures.length)
  })

  it('accepts the set wrapped in { set } too, because that is what a paste form sends', async () => {
    const response = await harness.call('/api/captures/import', body({ set: await ghostWarmSet() }))
    expect(response.status).toBe(201)
  })

  it('refuses input that is not a capture set, and says which fields are wrong', async () => {
    const response = await harness.call('/api/captures/import', body({ schemaVersion: 1, id: 'Bad Slug', captures: [] }))
    expect(response.status).toBe(422)
    const failure = (await response.json()) as { error: { details: string[] } }
    expect(failure.error.details.join('\n')).toMatch(/set\.id/)
  })

  it('is idempotent: importing twice does not duplicate anything', async () => {
    const set = (await ghostWarmSet()) as { captures: unknown[] }
    await harness.call('/api/captures/import', body(set))
    await harness.call('/api/captures/import', body(set))

    const listed = await harness.json<{ captures: unknown[] }>('/api/captures')
    expect(listed.captures).toHaveLength(set.captures.length)
  })
})

describe('captures, groups and tags', () => {
  it('creates a capture, tags it, filters by tag, and deletes it', async () => {
    const record = {
      schemaVersion: 1,
      id: 'my-button',
      componentType: 'button',
      sourceUrl: 'https://example.com/',
      capturedAt: '2026-02-11T09:14:22.000Z',
      styles: { backgroundColor: '#3355ff', color: '#ffffff' },
    }
    expect((await harness.call('/api/captures', body({ record }))).status).toBe(201)
    await harness.call('/api/captures/my-button/tags', { method: 'PUT', body: JSON.stringify({ tags: ['Hero'] }) })

    const filtered = await harness.json<{ captures: Array<{ id: string; tags: string[] }> }>('/api/captures?tag=hero')
    expect(filtered.captures.map((capture) => capture.id)).toEqual(['my-button'])
    expect(filtered.captures[0]?.tags).toEqual(['hero'])

    expect((await harness.call('/api/captures/my-button', { method: 'DELETE' })).status).toBe(204)
    expect((await harness.call('/api/captures/my-button')).status).toBe(404)
  })

  it('rejects a capture the engine would reject, before it is stored', async () => {
    const response = await harness.call('/api/captures', body({ record: { schemaVersion: 1, id: 'no-styles' } }))
    expect(response.status).toBe(422)
    expect((await harness.json<{ captures: unknown[] }>('/api/captures')).captures).toHaveLength(0)
  })

  it('assigns captures to a user-made group in the order given', async () => {
    await harness.call('/api/captures/import', body(await ghostWarmSet()))
    const all = await harness.json<{ captures: Array<{ id: string }> }>('/api/captures')
    const [first, second] = [all.captures[1]?.id, all.captures[0]?.id]

    const created = await harness.call('/api/groups', body({ slug: 'my-kit', name: 'My kit' }))
    expect(created.status).toBe(201)
    const { group } = (await created.json()) as { group: { id: string } }

    await harness.call(`/api/groups/${group.id}/captures`, body({ captureIds: [first, second] }))
    const inGroup = await harness.json<{ captures: Array<{ id: string }> }>(`/api/captures?groupId=${group.id}`)
    expect(inGroup.captures.map((capture) => capture.id)).toEqual([first, second])
  })

  it('refuses an unknown group without creating the capture', async () => {
    const record = {
      schemaVersion: 1,
      id: 'stray-button',
      componentType: 'button',
      sourceUrl: 'https://example.com/',
      capturedAt: '2026-02-11T09:14:22.000Z',
      styles: { backgroundColor: '#3355ff', color: '#ffffff' },
    }
    const response = await harness.call('/api/captures', body({ record, groupId: 'no-such-group' }))
    expect(response.status).toBe(404)
    // The 404 is a pure failure: the capture must not have been created.
    expect((await harness.call('/api/captures/stray-button')).status).toBe(404)
  })

  it('refuses a duplicate group slug and an unknown capture id', async () => {
    await harness.call('/api/groups', body({ slug: 'my-kit', name: 'My kit' }))
    expect((await harness.call('/api/groups', body({ slug: 'my-kit', name: 'Again' }))).status).toBe(409)

    const { group } = (await (await harness.call('/api/groups', body({ slug: 'other', name: 'Other' }))).json()) as {
      group: { id: string }
    }
    const response = await harness.call(`/api/groups/${group.id}/captures`, body({ captureIds: ['ghost'] }))
    expect(response.status).toBe(422)
  })
})

describe('kit generation', () => {
  it('generates a kit for a group and returns its tokens', async () => {
    const imported = (await (await harness.call('/api/captures/import', body(await ghostWarmSet()))).json()) as {
      group: { id: string }
    }
    const response = await harness.call('/api/kits', body({ groupId: imported.group.id }))
    expect(response.status).toBe(201)

    const generated = (await response.json()) as {
      kit: { id: string; version: number; setId: string; warningCount: number; captureIds: string[] }
      tokens: { source: { setId: string }; color: { roles: Record<string, unknown> } }
    }
    expect(generated.kit.version).toBe(1)
    expect(generated.kit.setId).toBe('ghost-warm')
    expect(generated.tokens.source.setId).toBe('ghost-warm')
    expect(Object.keys(generated.tokens.color.roles).length).toBeGreaterThan(0)
    // ghost-warm is one of the coherent sets; a warning here means the server
    // fed the engine something the CLI would not have.
    expect(generated.kit.warningCount).toBe(0)
  })

  it('versions successive kits for the same group', async () => {
    const imported = (await (await harness.call('/api/captures/import', body(await ghostWarmSet()))).json()) as {
      group: { id: string }
    }
    await harness.call('/api/kits', body({ groupId: imported.group.id }))
    const second = (await (await harness.call('/api/kits', body({ groupId: imported.group.id }))).json()) as {
      kit: { version: number }
    }
    expect(second.kit.version).toBe(2)
  })

  it('generates a whole-library kit when no group is named', async () => {
    await harness.call('/api/captures/import', body(await ghostWarmSet()))
    const generated = (await (await harness.call('/api/kits', body({}))).json()) as {
      kit: { setId: string; groupId: string | null }
    }
    expect(generated.kit.groupId).toBeNull()
    expect(generated.kit.setId).toBe('library')
  })

  it('refuses to distil nothing, with a message that says what to do', async () => {
    const response = await harness.call('/api/kits', body({}))
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/import a capture set/)
  })

  it('serves the kit as downloadable files, and the library export as the latest kit', async () => {
    await harness.call('/api/captures/import', body(await ghostWarmSet()))
    const generated = (await (await harness.call('/api/kits', body({}))).json()) as { kit: { id: string } }

    const design = await harness.call(`/api/kits/${generated.kit.id}/design.md`)
    expect(design.headers.get('content-type')).toContain('text/markdown')
    expect(design.headers.get('content-disposition')).toContain('library-v1-design.md')
    const designMd = await design.text()
    expect(designMd).toMatch(/^# /)

    const tokens = await harness.call(`/api/kits/${generated.kit.id}/tokens.json`)
    expect(tokens.headers.get('content-type')).toContain('application/json')

    expect(await (await harness.call('/api/export/design.md')).text()).toBe(designMd)
  })

  it('refuses an export before anything has been generated', async () => {
    expect((await harness.call('/api/export/design.md')).status).toBe(409)
  })

  it('never serves a deleted group\'s kit as the library export', async () => {
    const imported = (await (await harness.call('/api/captures/import', body(await ghostWarmSet()))).json()) as {
      group: { id: string }
    }
    await harness.call('/api/kits', body({ groupId: imported.group.id }))
    expect((await harness.call(`/api/groups/${imported.group.id}`, { method: 'DELETE' })).status).toBe(204)

    // No library kit exists, so the library scope must refuse rather than
    // answer with the orphaned group kit.
    expect((await harness.call('/api/export/design.md')).status).toBe(409)
    expect((await harness.call('/api/kits/latest')).status).toBe(404)
  })

  it('survives deleting a group whose kit shares a version with the library kit', async () => {
    const imported = (await (await harness.call('/api/captures/import', body(await ghostWarmSet()))).json()) as {
      group: { id: string }
    }
    const library = (await (await harness.call('/api/kits', body({}))).json()) as {
      kit: { id: string; version: number; scope: string }
    }
    const grouped = (await (await harness.call('/api/kits', body({ groupId: imported.group.id }))).json()) as {
      kit: { id: string; version: number; scope: string }
    }
    expect(library.kit.scope).toBe('library')
    expect(grouped.kit.scope).toBe('group')
    // Both scopes are at version 1: the delete below is the collision case.
    expect([library.kit.version, grouped.kit.version]).toEqual([1, 1])

    expect((await harness.call(`/api/groups/${imported.group.id}`, { method: 'DELETE' })).status).toBe(204)

    // The library export still answers with the library kit, byte for byte.
    const libraryDesign = await harness.call(`/api/kits/${library.kit.id}/design.md`)
    expect(await (await harness.call('/api/export/design.md')).text()).toBe(await libraryDesign.text())

    // Both kits survive and stay distinguishable by scope.
    const { kits } = await harness.json<{
      kits: Array<{ id: string; scope: string; groupId: string | null }>
    }>('/api/kits')
    const orphan = kits.find((kit) => kit.id === grouped.kit.id)
    expect(orphan).toEqual(expect.objectContaining({ scope: 'group', groupId: null }))
    expect(kits.find((kit) => kit.id === library.kit.id)).toEqual(expect.objectContaining({ scope: 'library' }))
  })
})

describe('review: overrides and decisions', () => {
  interface KitResponse {
    kit: { id: string; version: number }
    tokens: {
      radius: { steps: Record<string, { value: number; provenance: { decision: { strategy: string } } } | undefined> }
      color: { roles: Record<string, { value: { hex: string } } | undefined> }
      components: {
        recipes: Array<{
          name: string
          height: {
            value: number
            provenance: { decision: { strategy: string; resolvedConflict?: { value: string; baseValue: string } } }
          }
        }>
      }
      border: {
        width: {
          value: number
          provenance: {
            decision: {
              strategy: string
              resolvedConflict?: { value: string; baseValue: string; engineValue?: string }
            }
          }
        }
      }
      diagnostics: Array<{ code: string; level: string; message: string }>
    }
    designMd: string
    review: {
      overrides: Array<{ path: string; value: string; baseValue: string; note: string }>
      conflicts: Array<{ path: string; baseValue: string; engineValue: string }>
      rejected: Array<{ path: string }>
      accepted: string[]
    }
  }

  async function seed(): Promise<KitResponse> {
    await harness.call('/api/captures/import', body(await ghostWarmSet()))
    return (await (await harness.call('/api/kits', body({}))).json()) as KitResponse
  }

  it('has nothing to say before anyone has reviewed anything', async () => {
    const generated = await seed()
    expect(generated.review).toEqual({ overrides: [], conflicts: [], rejected: [], accepted: [] })
  })

  it('applies an override and turns the tokens, the document and the download together', async () => {
    const generated = await seed()
    const engineRadius = generated.tokens.radius.steps['md']?.value

    const updated = (await (
      await harness.call(
        '/api/reviews/overrides',
        put({ path: 'radius.steps.md', value: '10px', note: 'the captured radius reads timid' }),
      ).then(async (response) => {
        expect(response.status).toBe(200)
        return response
      })
    ).json()) as KitResponse

    expect(updated.tokens.radius.steps['md']?.value).toBe(10)
    expect(updated.tokens.radius.steps['md']?.provenance.decision.strategy).toBe('user-override')
    expect(updated.review.overrides).toEqual([
      expect.objectContaining({ path: 'radius.steps.md', value: '10px', baseValue: `${engineRadius}px` }),
    ])
    expect(updated.designMd).toContain('## 10. User overrides')
    expect(updated.designMd).toContain('the captured radius reads timid')

    // Every download reflects it, without regenerating anything.
    const download = await harness.call(`/api/kits/${generated.kit.id}/design.md`)
    expect(await download.text()).toBe(updated.designMd)
    const tokensFile = await harness.call(`/api/kits/${generated.kit.id}/tokens.json`)
    expect(await tokensFile.text()).toContain('"user-override"')
    const componentFile = await harness.call(`/api/export/components/button.md`)
    expect(await componentFile.text()).toContain('# Button')
    // And the stored kit is untouched: the engine's answer stays on the record.
    const stored = await harness.store.kits.get(generated.kit.id)
    expect(JSON.parse(stored?.tokensJson ?? '{}').radius.steps.md.value).toBe(engineRadius)
  })

  it('refuses an override the engine cannot apply, and does not keep it', async () => {
    await seed()
    const bad = await harness.call('/api/reviews/overrides', put({ path: 'radius.steps.md', value: 'quite round' }))
    expect(bad.status).toBe(422)
    const { overrides } = await harness.json<{ overrides: unknown[] }>('/api/reviews')
    expect(overrides).toEqual([])
  })

  it('leaves a standing override untouched when a later edit is refused', async () => {
    await seed()
    await harness.call('/api/reviews/overrides', put({ path: 'radius.steps.md', value: '10px', note: 'rounder' }))

    // The reviewer re-opens the editor on a working override and mistypes. The
    // refusal must not reach the store: the row is an upsert on (scope, path),
    // so writing first would already have destroyed the decision underneath it.
    const bad = await harness.call('/api/reviews/overrides', put({ path: 'radius.steps.md', value: 'quite round' }))
    expect(bad.status).toBe(422)

    const { overrides } = await harness.json<{
      overrides: Array<{ path: string; value: string; note: string }>
    }>('/api/reviews')
    expect(overrides).toEqual([expect.objectContaining({ path: 'radius.steps.md', value: '10px', note: 'rounder' })])

    // ...and the kit the panel reads back still carries it.
    const latest = await harness.json<KitResponse>('/api/kits/latest')
    expect(latest.tokens.radius.steps['md']?.value).toBe(10)
  })

  it('refuses a candidate that only restates the engine\'s own answer', async () => {
    const generated = await seed()
    const engineRadius = generated.tokens.radius.steps['md']?.value
    const same = await harness.call(
      '/api/reviews/overrides',
      put({ path: 'radius.steps.md', value: `${engineRadius}px` }),
    )
    expect(same.status).toBe(422)
    expect(((await same.json()) as { error: { message: string } }).error.message).toContain('is not an override')
    const { overrides } = await harness.json<{ overrides: unknown[] }>('/api/reviews')
    expect(overrides).toEqual([])
  })

  it('lets a reviewer pin a value another override re-derived away from', async () => {
    const generated = await seed()
    const path = 'components.recipes.button.secondary.height'
    const pristine = generated.tokens.components.recipes.find((entry) => entry.name === 'button.secondary')?.height
      .value

    // Moving the border re-derives every bordered control's height...
    const moved = (await (
      await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '3px' }))
    ).json()) as KitResponse
    const rederived = moved.tokens.components.recipes.find((entry) => entry.name === 'button.secondary')?.height.value
    expect(rederived).not.toBe(pristine)

    // ...so pinning it back to what it was is a real disagreement with what the
    // kit now says, not a restatement of the engine's answer.
    const pinned = await harness.call('/api/reviews/overrides', put({ path, value: `${pristine as number}px` }))
    expect(pinned.status).toBe(200)
    const after = (await pinned.json()) as KitResponse
    expect(after.tokens.components.recipes.find((entry) => entry.name === 'button.secondary')?.height.value).toBe(
      pristine,
    )
    // ...and the engine is not credited with independently choosing it.
    expect(after.tokens.diagnostics.some((entry) => entry.code === 'override.now-agrees')).toBe(false)
  })

  it('lets a reviewer pin a colour shade back to its pre-override value', async () => {
    const generated = await seed()
    const pristineHover = generated.tokens.color.roles['primaryHover']?.value.hex as string

    const moved = (await (
      await harness.call('/api/reviews/overrides', put({ path: 'color.roles.primary', value: '#1155cc' }))
    ).json()) as KitResponse
    expect(moved.tokens.color.roles['primaryHover']?.value.hex).not.toBe(pristineHover)

    const pinned = await harness.call(
      '/api/reviews/overrides',
      put({ path: 'color.roles.primaryHover', value: pristineHover }),
    )
    expect(pinned.status).toBe(200)
    expect(((await pinned.json()) as KitResponse).tokens.color.roles['primaryHover']?.value.hex).toBe(pristineHover)
  })

  it('accepts a reason typed onto an override the evidence has caught up with', async () => {
    const generated = await seed()
    const engineRadius = `${generated.tokens.radius.steps['md']?.value as number}px`

    // A standing override the engine now independently agrees with: the shape a
    // regeneration leaves behind once the captures moved.
    await harness.store.reviews.setOverride(null, {
      path: 'radius.steps.md',
      value: engineRadius,
      baseValue: '4px',
      note: '',
    })

    const edited = await harness.call(
      '/api/reviews/overrides',
      put({ path: 'radius.steps.md', value: engineRadius, note: 'still the right call' }),
    )
    expect(edited.status).toBe(200)

    const { overrides } = await harness.json<{
      overrides: Array<{ path: string; value: string; note: string }>
    }>('/api/reviews')
    // The row survives the edit and carries the reason...
    expect(overrides).toEqual([
      expect.objectContaining({ path: 'radius.steps.md', value: engineRadius, note: 'still the right call' }),
    ])
    // ...and the token is still attributed to the reviewer.
    const body = (await edited.json()) as KitResponse
    expect(body.tokens.radius.steps['md']?.provenance.decision.strategy).toBe('user-override')
    expect(body.designMd).toContain('still the right call')
  })

  it('keeps a standing conflict alive through a note-only edit', async () => {
    await seed()
    // A standing override made against an engine answer that has since moved:
    // the reviewer set 2px back when the engine said 0.5px, and the captures
    // have since brought it to what this kit distils. That is the shape a
    // regeneration leaves behind, and it is what raises a conflict.
    await harness.store.reviews.setOverride(null, {
      path: 'border.width',
      value: '2px',
      baseValue: '0.5px',
      note: '',
    })

    const conflicted = await harness.json<KitResponse>('/api/kits/latest')
    expect(conflicted.review.conflicts.map((entry) => entry.path)).toEqual(['border.width'])

    // The reviewer only types a reason. Annotating is not answering, so the
    // report must survive it.
    const edited = await harness.call(
      '/api/reviews/overrides',
      put({ path: 'border.width', value: '2px', note: 'the hairline reads too thin at this scale' }),
    )
    expect(edited.status).toBe(200)
    const after = (await edited.json()) as KitResponse
    expect(after.review.conflicts.map((entry) => entry.path)).toEqual(['border.width'])
    expect(after.tokens.diagnostics.some((entry) => entry.code === 'override.conflict')).toBe(true)
    expect(after.designMd).toContain('the hairline reads too thin at this scale')

    // ...and the base it is measured against is untouched.
    const { overrides } = await harness.json<{ overrides: Array<{ path: string; baseValue: string }> }>(
      '/api/reviews',
    )
    expect(overrides).toEqual([expect.objectContaining({ path: 'border.width', baseValue: '0.5px' })])
  })

  it('retires a conflict when the reviewer answers it, and records what they answered', async () => {
    const generated = await seed()
    const engineWidth = `${generated.tokens.border.width.value}px`
    await harness.store.reviews.setOverride(null, {
      path: 'border.width',
      value: '2px',
      baseValue: '0.5px',
      note: '',
    })
    expect((await harness.json<KitResponse>('/api/kits/latest')).review.conflicts).toHaveLength(1)

    // Answering it: the reviewer moves the value in response to the new evidence.
    const answered = await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '4px' }))
    expect(answered.status).toBe(200)
    const after = (await answered.json()) as KitResponse

    // The report is retired...
    expect(after.review.conflicts).toEqual([])
    expect(after.tokens.diagnostics.some((entry) => entry.code === 'override.conflict')).toBe(false)
    // ...but not silently: the token says what it answered, and so does the
    // document a consumer reads.
    const decision = after.tokens.border.width.provenance.decision
    expect(decision.strategy).toBe('user-override')
    expect(decision.resolvedConflict).toEqual({ value: '2px', baseValue: '0.5px', engineValue: engineWidth })
    expect(after.designMd).toContain('answered a conflict with new evidence')
    expect(after.designMd).toContain('`border.width` is now 4px')

    // The base is refreshed by the answer, so the card cannot keep nagging
    // against a value the reviewer has already responded to.
    const { overrides } = await harness.json<{ overrides: Array<{ path: string; baseValue: string }> }>(
      '/api/reviews',
    )
    expect(overrides).toEqual([expect.objectContaining({ baseValue: engineWidth })])
  })

  it('keeps the record of an answered conflict through a later note-only edit', async () => {
    const generated = await seed()
    const engineWidth = `${generated.tokens.border.width.value}px`
    await harness.store.reviews.setOverride(null, {
      path: 'border.width',
      value: '2px',
      baseValue: '0.5px',
      note: '',
    })
    // The reviewer answers the conflict by moving the value...
    await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '4px' }))

    // ...and later opens the same token only to write down why. Annotating is
    // not un-answering, so the record of what was answered has to survive it:
    // without it, `tokens.json` and design.md would quietly stop saying that a
    // disagreement was ever resolved.
    const annotated = await harness.call(
      '/api/reviews/overrides',
      put({ path: 'border.width', value: '4px', note: 'the hairline reads too thin at this scale' }),
    )
    expect(annotated.status).toBe(200)
    const after = (await annotated.json()) as KitResponse
    expect(after.tokens.border.width.provenance.decision.resolvedConflict).toEqual({
      value: '2px',
      baseValue: '0.5px',
      engineValue: engineWidth,
    })
    expect(after.designMd).toContain('answered a conflict with new evidence')
    expect(after.designMd).toContain('the hairline reads too thin at this scale')
  })

  it('does not claim a conflict was answered when the evidence had caught up', async () => {
    const generated = await seed()
    const engineWidth = `${generated.tokens.border.width.value}px`
    // A standing override the captures have since arrived at independently:
    // the engine reports convergence here, never a conflict.
    await harness.store.reviews.setOverride(null, {
      path: 'border.width',
      value: engineWidth,
      baseValue: '0.5px',
      note: '',
    })
    const converged = await harness.json<KitResponse>('/api/kits/latest')
    expect(converged.review.conflicts).toEqual([])

    // Changing the value now answers nothing, because nothing was disagreeing.
    const changed = await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '3px' }))
    expect(changed.status).toBe(200)
    const after = (await changed.json()) as KitResponse
    expect(after.tokens.border.width.provenance.decision.resolvedConflict).toBeUndefined()
    expect(after.designMd).not.toContain('answered a conflict with new evidence')
  })

  it('leaves the reviewer\'s reason alone when a write supplies none, and clears it when one says to', async () => {
    await seed()
    await harness.call(
      '/api/reviews/overrides',
      put({ path: 'radius.steps.md', value: '10px', note: 'brand asked for rounder corners' }),
    )

    // What a decision card sends: a value, no statement about the reason. The
    // reason is the reviewer's own writing and design.md prints it, so a write
    // that says nothing about it must not blank it.
    const fromCard = await harness.call('/api/reviews/overrides', put({ path: 'radius.steps.md', value: '8px' }))
    expect(fromCard.status).toBe(200)
    expect((await fromCard.json() as KitResponse).designMd).toContain('brand asked for rounder corners')
    const { overrides } = await harness.json<{ overrides: Array<{ value: string; note: string }> }>('/api/reviews')
    expect(overrides).toEqual([
      expect.objectContaining({ value: '8px', note: 'brand asked for rounder corners' }),
    ])

    // An explicitly empty reason is a statement, and does clear it.
    const cleared = await harness.call(
      '/api/reviews/overrides',
      put({ path: 'radius.steps.md', value: '8px', note: '' }),
    )
    expect((await cleared.json() as KitResponse).designMd).not.toContain('brand asked for rounder corners')
  })

  it('does not claim a conflict was answered when there was none', async () => {
    await seed()
    await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '2px' }))
    const changed = await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '4px' }))
    const after = (await changed.json()) as KitResponse
    expect(after.tokens.border.width.provenance.decision.resolvedConflict).toBeUndefined()
    expect(after.designMd).not.toContain('answered a conflict with new evidence')
  })

  describe('a slot another override re-derived', () => {
    const path = 'components.recipes.input.height'
    const heightOf = (payload: KitResponse): string =>
      `${payload.tokens.components.recipes.find((recipe) => recipe.name === 'input')?.height.value as number}px`
    const decisionOf = (payload: KitResponse) =>
      payload.tokens.components.recipes.find((recipe) => recipe.name === 'input')?.height.provenance.decision

    /** Widen the border, which re-derives every bordered control's height. */
    async function moveTheHeight(): Promise<{ stored: string; rederived: string }> {
      const generated = await seed()
      const widened = await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '3px' }))
      expect(widened.status).toBe(200)
      const rederived = heightOf((await widened.json()) as KitResponse)
      expect(rederived).not.toBe(heightOf(generated))
      return { stored: heightOf(generated), rederived }
    }

    it('records what the reviewer was actually shown, and claims no conflict later', async () => {
      const { rederived } = await moveTheHeight()

      // The reviewer overrides the height the panel is showing them.
      const set = await harness.call('/api/reviews/overrides', put({ path, value: '48px' }))
      expect(set.status).toBe(200)
      expect(((await set.json()) as KitResponse).review.conflicts).toEqual([])

      // What the engine said is recorded from the same document the comparison
      // will later be made against, so the two cannot disagree.
      const { overrides } = await harness.json<{ overrides: Array<{ path: string; baseValue: string }> }>(
        '/api/reviews',
      )
      expect(overrides.find((entry) => entry.path === path)?.baseValue).toBe(rederived)

      // Editing it again answers nothing, because nothing was disagreeing.
      const edited = await harness.call('/api/reviews/overrides', put({ path, value: '50px' }))
      const after = (await edited.json()) as KitResponse
      expect(decisionOf(after)?.resolvedConflict).toBeUndefined()
      expect(after.designMd).not.toContain('answered a conflict with new evidence')
    })

    it('still reports a conflict it has not answered, and records answering it', async () => {
      const { stored, rederived } = await moveTheHeight()
      // A decision carried forward from before the border moved: what it was
      // set against is no longer what the engine says.
      await harness.store.reviews.setOverride(null, { path, value: '48px', baseValue: stored, note: '' })

      const conflicted = await harness.json<KitResponse>('/api/kits/latest')
      expect(conflicted.review.conflicts.map((entry) => entry.path)).toEqual([path])

      const answered = await harness.call('/api/reviews/overrides', put({ path, value: '50px' }))
      const after = (await answered.json()) as KitResponse
      // The report is retired by the answer, and what it answered is kept --
      // a report that simply stopped appearing would be the silent clobbering
      // the conflict mechanism exists to prevent.
      expect(after.review.conflicts).toEqual([])
      expect(decisionOf(after)?.resolvedConflict).toEqual({
        value: '48px',
        baseValue: stored,
        engineValue: rederived,
      })
      expect(after.designMd).toContain('answered a conflict with new evidence')
    })
  })

  describe('the record of an answered conflict', () => {
    const path = 'components.recipes.input.height'
    const decisionOf = (payload: KitResponse) =>
      payload.tokens.components.recipes.find((recipe) => recipe.name === 'input')?.height.provenance.decision
    const heightOf = (payload: KitResponse): string =>
      `${payload.tokens.components.recipes.find((recipe) => recipe.name === 'input')?.height.value as number}px`

    /**
     * A conflict answered while another override is in force.
     *
     * Widening the border re-derives the height, so the answer the reviewer
     * responds to is not the height the stored kit distils -- which is what
     * tells the two numbers apart in what design.md goes on to say.
     */
    async function answerAConflict(): Promise<{ stored: string; answered: string }> {
      const generated = await seed()
      const widened = await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '3px' }))
      const answeredValue = heightOf((await widened.json()) as KitResponse)
      expect(answeredValue).not.toBe(heightOf(generated))

      // A decision carried forward from before the evidence moved.
      await harness.store.reviews.setOverride(null, { path, value: '48px', baseValue: '20px', note: '' })
      const conflicted = await harness.json<KitResponse>('/api/kits/latest')
      expect(conflicted.review.conflicts.map((entry) => entry.path)).toEqual([path])

      const response = await harness.call('/api/reviews/overrides', put({ path, value: '50px' }))
      expect(response.status).toBe(200)
      return { stored: heightOf(generated), answered: answeredValue }
    }

    it('names the answer that was answered, not the one this version distils', async () => {
      const { stored, answered } = await answerAConflict()
      const after = await harness.json<KitResponse>('/api/kits/latest')

      expect(decisionOf(after)?.resolvedConflict).toEqual({
        value: '48px',
        baseValue: '20px',
        engineValue: answered,
      })
      expect(after.designMd).toContain(`the captures then moved to ${answered}`)
      expect(after.designMd).not.toContain(`the captures then moved to ${stored}`)
    })

    it('never reports one path as both answered and in conflict', async () => {
      const { stored } = await answerAConflict()
      // The other override goes away, so the engine's answer for this slot moves
      // back and disagrees with what it said when the conflict was answered.
      const cleared = await harness.call('/api/reviews/overrides?path=border.width', { method: 'DELETE' })
      expect(cleared.status).toBe(200)

      const after = (await cleared.json()) as KitResponse
      expect(after.review.conflicts.map((entry) => entry.path)).toEqual([path])
      expect(after.designMd).toContain('**override.conflict**')
      expect(after.designMd).toContain(stored)
      // One document, one story: the warning above and §10 must not disagree.
      expect(after.designMd).not.toContain('answered a conflict with new evidence')
    })

    it('clears the record when a later value change answered nothing', async () => {
      await answerAConflict()
      const edited = await harness.call('/api/reviews/overrides', put({ path, value: '52px' }))
      const after = (await edited.json()) as KitResponse

      expect(after.review.conflicts).toEqual([])
      expect(decisionOf(after)?.resolvedConflict).toBeUndefined()
      expect(after.designMd).not.toContain('answered a conflict with new evidence')
      const { overrides } = await harness.json<{
        overrides: Array<{ path: string; resolvedConflict?: unknown }>
      }>('/api/reviews')
      expect(overrides.find((entry) => entry.path === path)?.resolvedConflict).toBeUndefined()
    })
  })

  it('refuses a reason longer than a reason', async () => {
    await seed()
    const response = await harness.call(
      '/api/reviews/overrides',
      put({ path: 'radius.steps.md', value: '10px', note: 'x'.repeat(501) }),
    )
    expect(response.status).toBe(400)
    const { overrides } = await harness.json<{ overrides: unknown[] }>('/api/reviews')
    expect(overrides).toEqual([])
  })

  it('refuses an override for a token this kit does not have', async () => {
    await seed()
    const bad = await harness.call('/api/reviews/overrides', put({ path: 'color.roles.tertiary', value: '#ff0000' }))
    expect(bad.status).toBe(422)
  })

  it('will not take an override before there is an engine answer to disagree with', async () => {
    const response = await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '2px' }))
    expect(response.status).toBe(409)
  })

  it('carries the override into a regenerated kit and reports the conflict', async () => {
    const generated = await seed()
    await harness.call('/api/reviews/overrides', put({ path: 'radius.steps.md', value: '10px' }))

    // Pretend the evidence moved: the stored baseValue is what a later
    // distillation is compared against, so rewriting it stands in for a
    // recapture that changed the engine's mind.
    await harness.store.reviews.setOverride(null, {
      path: 'radius.steps.md',
      value: '10px',
      baseValue: '4px',
    })

    const regenerated = (await (await harness.call('/api/kits', body({}))).json()) as KitResponse
    expect(regenerated.kit.version).toBe(generated.kit.version + 1)
    // The override survived the new version...
    expect(regenerated.tokens.radius.steps['md']?.value).toBe(10)
    // ...and the disagreement is reported rather than resolved.
    expect(regenerated.review.conflicts).toEqual([
      expect.objectContaining({ path: 'radius.steps.md', baseValue: '4px' }),
    ])
    expect(regenerated.tokens.diagnostics.some((entry) => entry.code === 'override.conflict')).toBe(true)
  })

  it("clears an override and puts the engine's answer back", async () => {
    const generated = await seed()
    const engineRadius = generated.tokens.radius.steps['md']?.value
    await harness.call('/api/reviews/overrides', put({ path: 'radius.steps.md', value: '10px' }))

    const cleared = (await (
      await harness.call('/api/reviews/overrides?path=radius.steps.md', { method: 'DELETE' })
    ).json()) as KitResponse
    expect(cleared.tokens.radius.steps['md']?.value).toBe(engineRadius)
    expect(cleared.review.overrides).toEqual([])
    expect(cleared.designMd).not.toContain('## 10. User overrides')

    expect((await harness.call('/api/reviews/overrides?path=radius.steps.md', { method: 'DELETE' })).status).toBe(404)
  })

  it('remembers an accepted decision and reopens it', async () => {
    await seed()
    const accepted = (await (
      await harness.call('/api/reviews/decisions', put({ cardId: 'choice:radius.steps.md', state: 'accepted' }))
    ).json()) as KitResponse
    expect(accepted.review.accepted).toEqual(['choice:radius.steps.md'])

    const reopened = (await (
      await harness.call('/api/reviews/decisions', put({ cardId: 'choice:radius.steps.md', state: 'open' }))
    ).json()) as KitResponse
    expect(reopened.review.accepted).toEqual([])
  })

  it("keeps a group's review state and the library's apart", async () => {
    const imported = (await (
      await harness.call('/api/captures/import', body(await ghostWarmSet()))
    ).json()) as { group: { id: string } }
    await harness.call('/api/kits', body({}))
    await harness.call('/api/kits', body({ groupId: imported.group.id }))

    await harness.call('/api/reviews/overrides', put({ path: 'border.width', value: '2px' }))
    await harness.call(
      '/api/reviews/overrides',
      put({ groupId: imported.group.id, path: 'border.width', value: '3px' }),
    )

    const library = await harness.json<{ overrides: Array<{ value: string }> }>('/api/reviews')
    const group = await harness.json<{ overrides: Array<{ value: string }> }>(
      `/api/reviews?groupId=${imported.group.id}`,
    )
    expect(library.overrides.map((entry) => entry.value)).toEqual(['2px'])
    expect(group.overrides.map((entry) => entry.value)).toEqual(['3px'])
  })
})

describe('per-component markdown', () => {
  it('serves one component, standalone, and refuses an unknown one', async () => {
    await harness.call('/api/captures/import', body(await ghostWarmSet()))
    const generated = (await (await harness.call('/api/kits', body({}))).json()) as { kit: { id: string } }

    const response = await harness.call(`/api/kits/${generated.kit.id}/components/button.md`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(response.headers.get('content-disposition')).toContain('button.md')
    const text = await response.text()
    expect(text).toContain('# Button')
    expect(text).toContain('## 4. Custom properties')

    expect((await harness.call(`/api/kits/${generated.kit.id}/components/carousel.md`)).status).toBe(404)
  })
})

describe('screenshots', () => {
  // A 1x1 PNG. The point is the path, not the pixels.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  it('stores the image on the volume and only its path in the database', async () => {
    await harness.call('/api/captures/import', body(await ghostWarmSet()))
    const [capture] = (await harness.json<{ captures: Array<{ id: string }> }>('/api/captures')).captures
    const id = capture?.id ?? ''

    const stored = await harness.call(`/api/captures/${id}/screenshot`, {
      method: 'PUT',
      body: PNG,
      headers: { 'content-type': 'image/png' },
    })
    expect(stored.status).toBe(200)
    expect(((await stored.json()) as { capture: { screenshotPath: string } }).capture.screenshotPath).toBe(`${id}.png`)

    const served = await harness.call(`/api/captures/${id}/screenshot`)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true)
  })

  it('refuses a body that is not an image type it stores', async () => {
    await harness.call('/api/captures/import', body(await ghostWarmSet()))
    const [capture] = (await harness.json<{ captures: Array<{ id: string }> }>('/api/captures')).captures
    const response = await harness.call(`/api/captures/${capture?.id}/screenshot`, {
      method: 'PUT',
      body: 'not an image',
      headers: { 'content-type': 'text/plain' },
    })
    expect(response.status).toBe(400)
  })
})
