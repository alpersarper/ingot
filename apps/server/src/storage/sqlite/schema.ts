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
    // seq is the insertion order and the library-wide capture order. AUTOINCREMENT
    // rather than plain rowid so a deleted capture's position is never reused,
    // which keeps the order total even across deletes.
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
    // group_id NULL means a whole-library kit. version is unique per scope, but
    // SQLite treats NULLs as distinct in unique indexes, so the two partial
    // indexes below cover the grouped and library scopes separately.
    `CREATE TABLE kits (
       id             TEXT PRIMARY KEY,
       group_id       TEXT REFERENCES groups (id) ON DELETE SET NULL,
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
    `CREATE UNIQUE INDEX kits_group_version ON kits (group_id, version) WHERE group_id IS NOT NULL`,
    `CREATE UNIQUE INDEX kits_library_version ON kits (version) WHERE group_id IS NULL`,
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
