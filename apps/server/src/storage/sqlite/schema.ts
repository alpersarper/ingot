/**
 * The SQLite schema, as an ordered list of migrations.
 *
 * Migrations are append-only and are applied inside one transaction against
 * `PRAGMA user_version`, so an existing data volume upgrades in place. Never
 * edit a migration that has shipped -- add the next one.
 */
import type { Database } from 'better-sqlite3'

/**
 * Statements per schema version. Index 0 takes the database from user_version 0
 * to 1, index 1 from 1 to 2, and so on.
 */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE settings (
       key        TEXT PRIMARY KEY,
       value      TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    // seq is the insertion order and the library-wide capture order, fed from
    // MAX(seq) + 1 on insert. A new row always sorts after every live row, so
    // the order of live rows stays total across deletes; the seq of a deleted
    // maximum row may be reused, which is fine because seq orders live rows
    // rather than naming a row for all time.
    `CREATE TABLE captures (
       id              TEXT PRIMARY KEY,
       seq             INTEGER NOT NULL UNIQUE,
       component_type  TEXT NOT NULL,
       source_url      TEXT NOT NULL,
       captured_at     TEXT NOT NULL,
       -- The engine's capture record, verbatim as it arrived. The columns above
       -- are denormalised copies for querying; this is the source of truth.
       record_json     TEXT NOT NULL,
       -- Path on the data volume, relative to the screenshot root. Images never
       -- live in the database.
       screenshot_path TEXT,
       created_at      TEXT NOT NULL,
       updated_at      TEXT NOT NULL
     )`,
    `CREATE INDEX captures_component_type ON captures (component_type)`,
    `CREATE TABLE capture_tags (
       capture_id TEXT NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
       tag        TEXT NOT NULL,
       PRIMARY KEY (capture_id, tag)
     )`,
    `CREATE INDEX capture_tags_tag ON capture_tags (tag)`,
    `CREATE TABLE groups (
       id          TEXT PRIMARY KEY,
       slug        TEXT NOT NULL UNIQUE,
       name        TEXT NOT NULL,
       description TEXT NOT NULL,
       origin      TEXT NOT NULL CHECK (origin IN ('import', 'manual')),
       created_at  TEXT NOT NULL,
       updated_at  TEXT NOT NULL
     )`,
    `CREATE TABLE group_captures (
       group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
       capture_id TEXT NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
       -- Append-only within a group. This is the order captures are handed to
       -- the engine in, so it is what makes a group's kit reproducible.
       position   INTEGER NOT NULL,
       PRIMARY KEY (group_id, capture_id)
     )`,
    `CREATE UNIQUE INDEX group_captures_position ON group_captures (group_id, position)`,
    // scope, not group_id, is what defines whether a kit distils one group or
    // the whole library. group_id is ON DELETE SET NULL, so a deleted group's
    // kit survives as an orphaned group kit: group_id becomes NULL, scope stays
    // 'group', and the kit never turns into the library's. Version uniqueness
    // keys on scope; SQLite treats NULLs as distinct in unique indexes, so
    // orphaned group kits never collide with each other.
    `CREATE TABLE kits (
       id             TEXT PRIMARY KEY,
       group_id       TEXT REFERENCES groups (id) ON DELETE SET NULL,
       scope          TEXT NOT NULL CHECK (scope IN ('group', 'library')),
       version        INTEGER NOT NULL,
       set_id         TEXT NOT NULL,
       name           TEXT NOT NULL,
       engine_version TEXT NOT NULL,
       capture_ids    TEXT NOT NULL,
       tokens_json    TEXT NOT NULL,
       design_md      TEXT NOT NULL,
       warning_count  INTEGER NOT NULL,
       created_at     TEXT NOT NULL
     )`,
    `CREATE UNIQUE INDEX kits_group_version ON kits (group_id, version) WHERE scope = 'group'`,
    `CREATE UNIQUE INDEX kits_library_version ON kits (version) WHERE scope = 'library'`,
  ],
]

/** The schema version this build of the server expects. */
export const SCHEMA_VERSION = MIGRATIONS.length

/** Bring a database up to {@link SCHEMA_VERSION}, from empty or from any older version. */
export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `database schema is version ${current}, newer than this server understands (${SCHEMA_VERSION}); ` +
        'upgrade the server or start from a fresh data volume',
    )
  }
  if (current === SCHEMA_VERSION) return

  db.exec('BEGIN')
  try {
    for (let version = current; version < SCHEMA_VERSION; version += 1) {
      for (const statement of MIGRATIONS[version] ?? []) db.exec(statement)
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
