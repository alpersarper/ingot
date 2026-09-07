/**
 * The storage contract, as a test suite.
 *
 * This file is the executable half of the promise in `src/storage/store.ts`:
 * SQLite today, Postgres later, adapter swap not rewrite. It is written against
 * the `Store` interface and knows nothing about any implementation, so the day
 * a Postgres adapter appears its whole test suite is
 *
 *   describeStoreContract('postgres', () => createPostgresStore({ ... }))
 *
 * and anything that suite does not cover is something the interface never
 * promised. Adding a method to `Store` means adding its cases here first.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureRecord } from '@ingot/engine'
import type { Store } from '../src/storage/store'

/** A minimal valid capture record. Distillation quality is not the point here. */
export function record(id: string, overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    schemaVersion: 1,
    id,
    componentType: 'button',
    sourceUrl: 'https://example.com/pricing',
    capturedAt: '2026-02-11T09:14:22.000Z',
    styles: { color: '#ffffff', backgroundColor: '#3355ff', paddingTop: '8px', paddingLeft: '16px' },
    ...overrides,
  }
}

/** Every adapter must pass this. See the file header. */
export function describeStoreContract(name: string, createStore: () => Store | Promise<Store>): void {
  describe(`${name} store contract`, () => {
    let store: Store

    beforeEach(async () => {
      store = await createStore()
    })

    afterEach(async () => {
      await store.close()
    })

    describe('captures', () => {
      it('stores a record verbatim and reads it back unchanged', async () => {
        const original = record('btn-primary', { notes: 'the one on the pricing page' })
        const saved = await store.captures.upsert({ record: original })

        expect(saved.id).toBe('btn-primary')
        expect(saved.record).toEqual(original)
        // Byte-for-byte, not merely deep-equal: the engine's determinism rests
        // on getting back exactly what it was given.
        expect(JSON.stringify((await store.captures.get('btn-primary'))?.record)).toBe(JSON.stringify(original))
      })

      it('replaces a capture on re-upsert rather than duplicating it', async () => {
        await store.captures.upsert({ record: record('btn-primary'), tags: ['brand'] })
        const replaced = await store.captures.upsert({
          record: record('btn-primary', { sourceUrl: 'https://example.com/signup' }),
        })

        expect(replaced.record.sourceUrl).toBe('https://example.com/signup')
        expect((await store.captures.list())).toHaveLength(1)
        // A recapture is a newer measurement of the same element, so the user's
        // own annotations survive it.
        expect(replaced.tags).toEqual(['brand'])
      })

      it('lists captures in insertion order', async () => {
        for (const id of ['c-one', 'c-two', 'c-three']) await store.captures.upsert({ record: record(id) })
        expect((await store.captures.list()).map((capture) => capture.id)).toEqual(['c-one', 'c-two', 'c-three'])
      })

      it('keeps insertion order stable across a delete and a later insert', async () => {
        for (const id of ['c-one', 'c-two']) await store.captures.upsert({ record: record(id) })
        await store.captures.delete('c-one')
        await store.captures.upsert({ record: record('c-three') })
        expect((await store.captures.list()).map((capture) => capture.id)).toEqual(['c-two', 'c-three'])
      })

      it('normalises tags and filters by them', async () => {
        await store.captures.upsert({ record: record('c-one'), tags: ['Brand', ' brand ', 'Hero'] })
        await store.captures.upsert({ record: record('c-two'), tags: ['hero'] })

        expect((await store.captures.get('c-one'))?.tags).toEqual(['brand', 'hero'])
        expect((await store.captures.list({ tag: 'brand' })).map((c) => c.id)).toEqual(['c-one'])
        expect((await store.captures.list({ tag: 'hero' })).map((c) => c.id)).toEqual(['c-one', 'c-two'])
        expect(await store.captures.tags()).toEqual([
          { tag: 'brand', captureCount: 1 },
          { tag: 'hero', captureCount: 2 },
        ])
      })

      it('filters by component type', async () => {
        await store.captures.upsert({ record: record('c-one', { componentType: 'button' }) })
        await store.captures.upsert({ record: record('c-two', { componentType: 'input' }) })
        expect((await store.captures.list({ componentType: 'input' })).map((c) => c.id)).toEqual(['c-two'])
      })

      it('patches tags and the screenshot path without touching the record', async () => {
        const original = record('c-one')
        await store.captures.upsert({ record: original })
        const patched = await store.captures.update('c-one', { tags: ['hero'], screenshotPath: 'c-one.png' })

        expect(patched?.tags).toEqual(['hero'])
        expect(patched?.screenshotPath).toBe('c-one.png')
        expect(patched?.record).toEqual(original)
      })

      it('reports a miss rather than inventing a capture', async () => {
        expect(await store.captures.get('nope')).toBeNull()
        expect(await store.captures.update('nope', { tags: [] })).toBeNull()
        expect(await store.captures.delete('nope')).toBe(false)
      })
    })

    describe('groups', () => {
      it('creates, reads by id and slug, updates and deletes', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        expect(await store.groups.getBySlug('warm')).toEqual(group)
        expect((await store.groups.update(group.id, { name: 'Warmer' }))?.name).toBe('Warmer')
        expect(await store.groups.delete(group.id)).toBe(true)
        expect(await store.groups.get(group.id)).toBeNull()
      })

      it('appends captures and keeps membership order', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        for (const id of ['c-one', 'c-two', 'c-three']) await store.captures.upsert({ record: record(id) })

        await store.groups.addCaptures(group.id, ['c-three', 'c-one'])
        await store.groups.addCaptures(group.id, ['c-two'])

        // Group order is membership order, not library order: it is what the
        // engine sees, so the group owns it.
        expect(await store.groups.captureIds(group.id)).toEqual(['c-three', 'c-one', 'c-two'])
        expect((await store.captures.list({ groupId: group.id })).map((c) => c.id)).toEqual([
          'c-three',
          'c-one',
          'c-two',
        ])
      })

      it('ignores a capture already in the group', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        await store.captures.upsert({ record: record('c-one') })

        expect(await store.groups.addCaptures(group.id, ['c-one'])).toEqual(['c-one'])
        expect(await store.groups.addCaptures(group.id, ['c-one'])).toEqual([])
        expect(await store.groups.captureIds(group.id)).toEqual(['c-one'])
      })

      it('drops memberships when a capture is deleted, and keeps captures when a group is', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        for (const id of ['c-one', 'c-two']) await store.captures.upsert({ record: record(id) })
        await store.groups.addCaptures(group.id, ['c-one', 'c-two'])

        await store.captures.delete('c-one')
        expect(await store.groups.captureIds(group.id)).toEqual(['c-two'])

        await store.groups.delete(group.id)
        expect(await store.captures.get('c-two')).not.toBeNull()
      })

      it('reports group counts', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        await store.captures.upsert({ record: record('c-one') })
        await store.groups.addCaptures(group.id, ['c-one'])
        expect((await store.groups.get(group.id))?.captureCount).toBe(1)
        expect(await store.groups.removeCapture(group.id, 'c-one')).toBe(true)
        expect((await store.groups.get(group.id))?.captureCount).toBe(0)
      })
    })

    describe('importCaptureSet', () => {
      it('creates the group, upserts every record, and appends them in order', async () => {
        const result = await store.importCaptureSet({
          slug: 'ghost-warm',
          name: 'Ghost warm',
          description: 'Warm editorial UI.',
          records: [record('c-one'), record('c-two')],
        })

        expect(result.group.slug).toBe('ghost-warm')
        expect(result.group.origin).toBe('import')
        expect(result.created).toEqual(['c-one', 'c-two'])
        expect(result.replaced).toEqual([])
        expect(await store.groups.captureIds(result.group.id)).toEqual(['c-one', 'c-two'])
      })

      it('is idempotent: re-importing refreshes records without duplicating membership', async () => {
        const first = await store.importCaptureSet({
          slug: 'ghost-warm',
          name: 'Ghost warm',
          description: 'Warm editorial UI.',
          records: [record('c-one'), record('c-two')],
        })
        const second = await store.importCaptureSet({
          slug: 'ghost-warm',
          name: 'Ghost warm, revised',
          description: 'Revised.',
          records: [record('c-one', { notes: 'recaptured' }), record('c-three')],
        })

        expect(second.group.id).toBe(first.group.id)
        expect(second.group.name).toBe('Ghost warm, revised')
        expect(second.created).toEqual(['c-three'])
        expect(second.replaced).toEqual(['c-one'])
        expect(await store.groups.captureIds(first.group.id)).toEqual(['c-one', 'c-two', 'c-three'])
        expect((await store.captures.get('c-one'))?.record.notes).toBe('recaptured')
      })
    })

    describe('kits', () => {
      const kitInput = {
        setId: 'warm',
        name: 'Warm',
        engineVersion: '0.2.0',
        captureIds: ['c-one'],
        tokensJson: '{"schemaVersion":2}\n',
        designMd: '# Warm\n',
        warningCount: 0,
      }

      it('versions kits per scope, starting at 1', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })

        const first = await store.kits.create({ ...kitInput, groupId: group.id })
        const second = await store.kits.create({ ...kitInput, groupId: group.id })
        const library = await store.kits.create({ ...kitInput, groupId: null })

        expect([first.version, second.version]).toEqual([1, 2])
        // The library scope has its own version line: a library kit is not
        // version 3 of somebody's group.
        expect(library.version).toBe(1)
      })

      it('returns the highest version per scope from latest()', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        await store.kits.create({ ...kitInput, groupId: group.id })
        const newest = await store.kits.create({ ...kitInput, groupId: group.id, designMd: '# Warm v2\n' })

        expect((await store.kits.latest(group.id))?.id).toBe(newest.id)
        expect(await store.kits.latest(null)).toBeNull()
      })

      it('stores the engine output byte for byte', async () => {
        const kit = await store.kits.create({ ...kitInput, groupId: null })
        const read = await store.kits.get(kit.id)
        expect(read?.tokensJson).toBe(kitInput.tokensJson)
        expect(read?.designMd).toBe(kitInput.designMd)
        expect(read?.captureIds).toEqual(['c-one'])
      })

      it('keeps a deleted group\'s kit as an orphaned group kit, never the library\'s', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        const library = await store.kits.create({ ...kitInput, groupId: null })
        const grouped = await store.kits.create({ ...kitInput, groupId: group.id })
        expect(library.scope).toBe('library')
        expect(grouped.scope).toBe('group')

        // Both scopes sit at version 1, so this delete is also the collision
        // case: it must not trip the library scope's version uniqueness.
        expect(await store.groups.delete(group.id)).toBe(true)

        const orphan = await store.kits.get(grouped.id)
        expect(orphan?.groupId).toBeNull()
        expect(orphan?.scope).toBe('group')

        expect((await store.kits.latest(null))?.id).toBe(library.id)
        expect((await store.kits.list({ groupId: null })).map((kit) => kit.id)).toEqual([library.id])
      })

      it('never surfaces an orphaned group kit as the latest library kit', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        await store.kits.create({ ...kitInput, groupId: group.id })
        await store.groups.delete(group.id)

        expect(await store.kits.latest(null)).toBeNull()
        expect(await store.kits.list({ groupId: null })).toEqual([])
      })

      it('lists kits without their payloads, scoped', async () => {
        const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
        await store.kits.create({ ...kitInput, groupId: group.id })
        await store.kits.create({ ...kitInput, groupId: null })

        expect(await store.kits.list()).toHaveLength(2)
        expect((await store.kits.list({ groupId: group.id })).map((kit) => kit.groupId)).toEqual([group.id])
        expect((await store.kits.list({ groupId: null })).map((kit) => kit.groupId)).toEqual([null])
        expect(Object.keys((await store.kits.list())[0] ?? {})).not.toContain('tokensJson')
      })
    })

    describe('reviews', () => {
      it('stores an override per scope and lists it in path order', async () => {
        await store.reviews.setOverride('group-1', {
          path: 'radius.steps.md',
          value: '10px',
          baseValue: '6px',
          note: 'rounder',
        })
        await store.reviews.setOverride('group-1', {
          path: 'color.roles.primary',
          value: '#1155cc',
          baseValue: '#0f7a5a',
        })

        const overrides = await store.reviews.overrides('group-1')
        expect(overrides.map((entry) => entry.path)).toEqual(['color.roles.primary', 'radius.steps.md'])
        expect(overrides[1]).toMatchObject({ value: '10px', baseValue: '6px', note: 'rounder' })
        // A missing note is an empty string, never undefined: the interface
        // promises a string and an adapter that returns null breaks a caller.
        expect(overrides[0]?.note).toBe('')
      })

      it('keeps the library scope and a group scope apart', async () => {
        await store.reviews.setOverride(null, { path: 'border.width', value: '2px', baseValue: '1px' })
        await store.reviews.setOverride('group-1', { path: 'border.width', value: '3px', baseValue: '1px' })

        expect((await store.reviews.overrides(null)).map((entry) => entry.value)).toEqual(['2px'])
        expect((await store.reviews.overrides('group-1')).map((entry) => entry.value)).toEqual(['3px'])
      })

      it('replaces an override in place, keeping when the decision was first made', async () => {
        const first = await store.reviews.setOverride('group-1', {
          path: 'border.width',
          value: '2px',
          baseValue: '1px',
        })
        const second = await store.reviews.setOverride('group-1', {
          path: 'border.width',
          value: '3px',
          baseValue: '1px',
          note: 'thicker still',
        })

        expect(await store.reviews.overrides('group-1')).toHaveLength(1)
        expect(second.value).toBe('3px')
        expect(second.note).toBe('thicker still')
        expect(second.createdAt).toBe(first.createdAt)
        expect(second.updatedAt >= first.updatedAt).toBe(true)
      })

      it('clears an override and reports whether there was one', async () => {
        await store.reviews.setOverride('group-1', { path: 'border.width', value: '2px', baseValue: '1px' })
        expect(await store.reviews.clearOverride('group-1', 'border.width')).toBe(true)
        expect(await store.reviews.clearOverride('group-1', 'border.width')).toBe(false)
        expect(await store.reviews.overrides('group-1')).toEqual([])
      })

      it('records and reopens an accepted decision, by card id', async () => {
        await store.reviews.acceptDecision('group-1', 'diag:spacing.low-fit:', 'the base unit is right')
        await store.reviews.acceptDecision('group-1', 'choice:radius.steps.md')

        const decisions = await store.reviews.decisions('group-1')
        expect(decisions.map((entry) => entry.cardId)).toEqual(['choice:radius.steps.md', 'diag:spacing.low-fit:'])
        expect(decisions.every((entry) => entry.state === 'accepted')).toBe(true)

        expect(await store.reviews.reopenDecision('group-1', 'choice:radius.steps.md')).toBe(true)
        expect(await store.reviews.reopenDecision('group-1', 'choice:radius.steps.md')).toBe(false)
        expect((await store.reviews.decisions('group-1')).map((entry) => entry.cardId)).toEqual([
          'diag:spacing.low-fit:',
        ])
      })

      it('survives the group that owned it being deleted and re-created', async () => {
        const group = await store.groups.create({ slug: 'ghost-warm', name: 'Ghost', description: 'Warm.' })
        await store.reviews.setOverride(group.id, { path: 'border.width', value: '2px', baseValue: '1px' })
        await store.groups.delete(group.id)
        // Overrides are a standing decision about a scope, not a row hanging off
        // a group, so deleting the group does not silently discard the review.
        expect(await store.reviews.overrides(group.id)).toHaveLength(1)
      })
    })

    describe('settings', () => {
      it('reads back what it stored, and reports a miss as null', async () => {
        expect(await store.settings.get('llm.apiKey')).toBeNull()
        await store.settings.set('llm.apiKey', 'sk-secret')
        expect(await store.settings.get('llm.apiKey')).toBe('sk-secret')
        await store.settings.set('llm.apiKey', 'sk-newer')
        expect(await store.settings.get('llm.apiKey')).toBe('sk-newer')
        expect(await store.settings.delete('llm.apiKey')).toBe(true)
        expect(await store.settings.get('llm.apiKey')).toBeNull()
      })
    })
  })
}
