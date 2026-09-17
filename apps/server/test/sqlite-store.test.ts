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
import { SCHEMA_VERSION, migrateTo } from '../src/storage/sqlite/schema'
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

  /**
   * The v5 shape, written by hand.
   *
   * Migration 6 rebuilds `kits` to admit the `selection` scope, and a rebuild
   * is the one migration shape that can lose rows. Running it against a
   * database that already holds kits is the only way to know it does not --
   * a fresh database rebuilds an empty table and proves nothing. The DDL below
   * is a copy of what shipped precisely because it must not follow the current
   * schema when that changes again.
   */
  function writeV5Database(file: string): void {
    const raw = new Database(file)
    // The real migration ladder, stopped one step short of the rebuild. The old
    // DDL is never copied into this file, so the row below really was written by
    // the shape that shipped.
    migrateTo(raw, 5)
    raw.exec(`
      INSERT INTO groups VALUES ('g1', 'warm', 'Warm', 'Warm things.', 'import', 'then', 'then');
      INSERT INTO kits VALUES ('k1', 'g1', 'group', 1, 'warm', 'Warm', '0.2.0', '["c-one"]', '{}', '# Warm', 0, 'then');
      INSERT INTO kits VALUES ('k2', NULL, 'library', 1, 'library', 'Lib', '0.2.0', '["c-one"]', '{}', '# Lib', 0, 'then');
    `)
    raw.close()
  }

  it('rebuilds the kits table in place without losing a kit', async () => {
    const file = join(await tempDir(), 'ingot.db')
    writeV5Database(file)

    const store = createSqliteStore({ file, idFactory: countingIdFactory(), clock: steppingClock() })
    const kits = await store.kits.list()
    expect(kits.map((kit) => [kit.id, kit.scope, kit.version])).toEqual([
      ['k2', 'library', 1],
      ['k1', 'group', 1],
    ])
    // The payloads came through the copy byte for byte, which is the whole risk
    // a table rebuild carries.
    expect((await store.kits.get('k1'))?.designMd).toBe('# Warm')
    // And the upgraded table admits what it was rebuilt for, in the library's
    // lineage: the next version after the library kit that was already there.
    const selection = await store.kits.create({
      groupId: null,
      scope: 'selection',
      setId: 'selection',
      name: 'Selected captures',
      engineVersion: '0.2.0',
      captureIds: ['c-one'],
      tokensJson: '{}',
      designMd: '# Sel',
      warningCount: 0,
    })
    expect(selection.version).toBe(2)
    await store.close()
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
