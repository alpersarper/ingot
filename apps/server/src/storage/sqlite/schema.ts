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
  [
    // Review state: what a human decided about a scope, not about one kit
    // version. Regenerating a kit has to carry overrides forward -- that is the
    // whole point of an override -- so these rows key on the scope and outlive
    // every kit generated for it.
    //
    // scope_key is the group id, or the literal 'library' for the whole-library
    // scope. A plain TEXT key rather than a foreign key to groups: the library
    // scope has no row to point at, and the rows outlive the kits they were made
    // against, which is the guarantee an override exists for -- regenerating
    // carries it forward.
    //
    // The durability stops there. Deleting a group and importing the same set
    // again mints a fresh group id, so the old rows key on an id nothing refers
    // to any more: they are orphaned rather than reattached, and nothing cleans
    // them up. Matching on the slug instead would silently bind one review's
    // decisions to a different import, which is not a trade this schema makes.
    `CREATE TABLE token_overrides (
       scope_key  TEXT NOT NULL,
       -- Dotted token path, e.g. components.recipes.button.primary.paddingX.
       path       TEXT NOT NULL,
       -- The replacement, in the engine's own decision notation.
       value      TEXT NOT NULL,
       -- What the engine said when the override was made. Comparing this with
       -- what the engine says now is how a conflict is detected.
       base_value TEXT NOT NULL,
       note       TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (scope_key, path)
     )`,
    // Decision cards a reviewer has accepted. Only acceptances are stored: an
    // open card is the absence of a row, and an overridden one is derived from
    // token_overrides, so there is one place a state can be wrong instead of
    // three that can disagree.
    `CREATE TABLE decision_reviews (
       scope_key  TEXT NOT NULL,
       -- Stable card id derived from the kit's own content, so an acceptance
       -- survives regeneration. Three forms, one per source of card:
       -- conflict:<path>, diag:<code>:<path>#<ordinal> -- the ordinal
       -- separates several diagnostics sharing one code and path -- and
       -- choice:<path>.
       card_id    TEXT NOT NULL,
       state      TEXT NOT NULL CHECK (state IN ('accepted')),
       note       TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (scope_key, card_id)
     )`,
  ],
  [
    // What retired a standing conflict, when one did. Changing an override
    // while fresh evidence disagrees with it answers the `override.conflict`
    // report, and the answer is a decision of its own: without these the report
    // would simply stop appearing, which is the silent clobbering the whole
    // conflict mechanism exists to prevent. They are NULL together on an
    // override that answered nothing; a note-only edit leaves them alone,
    // because annotating is not answering; and any later value change with no
    // conflict standing against it clears them, because that value retired
    // nothing and must not inherit a retirement it had no part in.
    `ALTER TABLE token_overrides ADD COLUMN resolved_value TEXT`,
    `ALTER TABLE token_overrides ADD COLUMN resolved_base TEXT`,
  ],
  [
    // The engine's answer the reviewer actually responded to. Without it the
    // only engine value on hand is the one the *current* kit distils, which
    // after another regeneration is a number nobody ever answered -- and
    // `design.md` said it had been. NULL on a record written before this
    // column, which reads as "the engine moved" rather than naming a value.
    `ALTER TABLE token_overrides ADD COLUMN resolved_engine TEXT`,
  ],
  [
    // Where an accepted value came from, when the reviewer did not think of it
    // themselves. NULL is the ordinary case and means exactly that -- the
    // reviewer typed it -- rather than "unknown"; the only other value is
    // 'assistant', an override the assistant proposed and a person accepted.
    // The decision is still the reviewer's, so nothing about how the row is
    // applied depends on this: it is what the kit is able to say about itself.
    `ALTER TABLE token_overrides ADD COLUMN suggested_by TEXT`,
    // The assistant's standing proposals. Review state, not kit state: nothing
    // in this table reaches an export, and an accepted proposal becomes an
    // ordinary token_overrides row through the same write path a reviewer's own
    // edit takes. There is deliberately no path from here into a kit that does
    // not go through that table.
    //
    // Keyed on scope_key like the rest of the review state, with the same
    // durability and the same limits -- see the note on token_overrides.
    // Dismissed rows are kept rather than deleted: a kept dismissal suppresses
    // the same suggestion -- same path, same capability -- while the engine's
    // answer it recorded in base_value still stands, and when the evidence
    // moves the suggestion may return, marked as a re-offer rather than new.
    `CREATE TABLE assistant_proposals (
       id             TEXT PRIMARY KEY,
       scope_key      TEXT NOT NULL,
       -- Which capability produced it: derive, merge.
       capability     TEXT NOT NULL,
       -- The prompt template version and the model that answered, so a card
       -- that turns out to be bad can be traced to the words that produced it.
       prompt_version TEXT NOT NULL,
       model          TEXT NOT NULL,
       path           TEXT NOT NULL,
       value          TEXT NOT NULL,
       -- The engine's own answer at that path when the proposal was checked.
       base_value     TEXT NOT NULL,
       title          TEXT NOT NULL,
       rationale      TEXT NOT NULL,
       -- JSON array: what the engine said applying it would also do. Recorded
       -- at check time, because it is a statement about the kit the reviewer
       -- was shown rather than about whatever the kit is when it is next read.
       engine_notes   TEXT NOT NULL,
       status         TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'dismissed')),
       -- 1 when a dismissed proposal stood at this path and the engine's
       -- answer has moved since: the card returns marked, never as new.
       reoffered      INTEGER NOT NULL DEFAULT 0,
       created_at     TEXT NOT NULL,
       updated_at     TEXT NOT NULL
     )`,
    `CREATE INDEX assistant_proposals_scope ON assistant_proposals (scope_key, created_at, id)`,
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
