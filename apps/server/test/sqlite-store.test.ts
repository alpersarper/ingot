/**
 * The SQLite adapter, held to the storage contract, plus the two things that
 * are specifically SQLite's problem: migrating a file on the volume, and
 * refusing a database written by a newer server.
 */
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../src/storage/sqlite/schema'
import { countingIdFactory, steppingClock } from '../src/storage/ids'
import { createSqliteStore } from '../src/storage/sqlite'
import { describeStoreContract, record } from './storage-contract'

const temporaries: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ingot-sqlite-'))
  temporaries.push(dir)
  return dir
}

afterAll(async () => {
  for (const dir of temporaries) await rm(dir, { recursive: true, force: true })
})

describeStoreContract('sqlite', () =>
  createSqliteStore({ file: ':memory:', idFactory: countingIdFactory(), clock: steppingClock() }),
)

describe('sqlite adapter', () => {
  it('persists across reopens of the same file', async () => {
    const file = join(await tempDir(), 'ingot.db')
    const open = (): ReturnType<typeof createSqliteStore> =>
      createSqliteStore({ file, idFactory: countingIdFactory(), clock: steppingClock() })

    const first = open()
    await first.captures.upsert({ record: record('c-one'), tags: ['hero'] })
    await first.close()

    const second = open()
    expect((await second.captures.get('c-one'))?.tags).toEqual(['hero'])
    await second.close()
  })

  it('stamps the schema version so a volume can be migrated in place', async () => {
    const file = join(await tempDir(), 'ingot.db')
    const store = createSqliteStore({ file, idFactory: countingIdFactory(), clock: steppingClock() })
    await store.close()

    const raw = new Database(file)
    expect(raw.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    raw.close()
  })

  it('refuses a database written by a newer server rather than corrupting it', async () => {
    const file = join(await tempDir(), 'ingot.db')
    const raw = new Database(file)
    raw.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    raw.close()

    expect(() => createSqliteStore({ file, idFactory: countingIdFactory(), clock: steppingClock() })).toThrow(
      /newer than this server understands/,
    )
  })

  it('takes ids and timestamps from its injected factories', async () => {
    const store = createSqliteStore({
      file: ':memory:',
      idFactory: countingIdFactory('grp'),
      clock: steppingClock('2026-03-01T00:00:00.000Z'),
    })
    const group = await store.groups.create({ slug: 'warm', name: 'Warm', description: 'Warm things.' })
    expect(group.id).toBe('grp-0001')
    expect(group.createdAt).toBe('2026-03-01T00:00:00.000Z')
    await store.close()
  })
})
