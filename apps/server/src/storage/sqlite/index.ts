/**
 * The SQLite adapter: the one implementation of `Store` that ships today.
 *
 * better-sqlite3 is synchronous, so every method here is `async` purely to
 * satisfy the interface. That is the point -- see the seam rules in
 * `../store.ts`. Nothing in this file leaks upward: routes never see a
 * `Statement`, a `Database`, or a row.
 */
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import type { CaptureRecord } from '@ingot/engine'
import { migrate } from './schema'
import type {
  Capture,
  CaptureInput,
  CapturePatch,
  CaptureQuery,
  CaptureRepository,
  CaptureSetImport,
  Clock,
  Group,
  GroupInput,
  GroupPatch,
  GroupRepository,
  IdFactory,
  ImportResult,
  Kit,
  KitInput,
  KitRepository,
  KitSummary,
  OverrideInput,
  ProposalInput,
  ProposalRepository,
  ReviewRepository,
  ReviewScope,
  SettingsRepository,
  StoredDecision,
  StoredOverride,
  StoredProposal,
  Store,
} from '../store'

export interface SqliteStoreOptions {
  /** File path, or `:memory:` for an ephemeral database (tests). */
  file: string
  idFactory: IdFactory
  clock: Clock
}

interface CaptureRow {
  id: string
  record_json: string
  screenshot_path: string | null
  created_at: string
  updated_at: string
}

interface GroupRow {
  id: string
  slug: string
  name: string
  description: string
  origin: string
  created_at: string
  updated_at: string
  capture_count: number
}

interface KitRow {
  id: string
  group_id: string | null
  scope: string
  version: number
  set_id: string
  name: string
  engine_version: string
  capture_ids: string
  tokens_json: string
  design_md: string
  warning_count: number
  created_at: string
}

interface OverrideRow {
  path: string
  value: string
  base_value: string
  note: string
  resolved_value: string | null
  resolved_base: string | null
  resolved_engine: string | null
  suggested_by: string | null
  created_at: string
  updated_at: string
}

interface ProposalRow {
  id: string
  capability: string
  prompt_version: string
  model: string
  path: string
  value: string
  base_value: string
  title: string
  rationale: string
  engine_notes: string
  status: string
  created_at: string
  updated_at: string
}

interface DecisionRow {
  card_id: string
  state: string
  note: string
  created_at: string
  updated_at: string
}

/**
 * The library scope has no group row to key on, so it gets a reserved key.
 *
 * Reserved rather than nullable: a NULL in a primary key is not a value SQLite
 * will match on with `=`, and a scope column that is sometimes NULL is a query
 * every future adapter has to remember to special-case.
 */
const LIBRARY_SCOPE_KEY = 'library'

function scopeKey(scope: ReviewScope): string {
  return scope === null ? LIBRARY_SCOPE_KEY : scope
}

/** Tags are compared and stored in one normal form so `?tag=` is predictable. */
function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const tag of tags) {
    const trimmed = tag.trim().toLowerCase()
    if (trimmed !== '') seen.add(trimmed)
  }
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function createSqliteStore(options: SqliteStoreOptions): Store {
  const db: Db = new Database(options.file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)

  const { idFactory, clock } = options

  const readTags = db.prepare<[string], { tag: string }>(
    'SELECT tag FROM capture_tags WHERE capture_id = ? ORDER BY tag',
  )
  const clearTags = db.prepare<[string]>('DELETE FROM capture_tags WHERE capture_id = ?')
  const insertTag = db.prepare<[string, string]>(
    'INSERT OR IGNORE INTO capture_tags (capture_id, tag) VALUES (?, ?)',
  )

  function hydrate(row: CaptureRow): Capture {
    return {
      id: row.id,
      record: JSON.parse(row.record_json) as CaptureRecord,
      screenshotPath: row.screenshot_path,
      tags: readTags.all(row.id).map((tag) => tag.tag),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  function hydrateGroup(row: GroupRow): Group {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      origin: row.origin === 'import' ? 'import' : 'manual',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      captureCount: row.capture_count,
    }
  }

  function hydrateKit(row: KitRow): Kit {
    return {
      id: row.id,
      groupId: row.group_id,
      scope: row.scope === 'library' ? 'library' : 'group',
      version: row.version,
      setId: row.set_id,
      name: row.name,
      engineVersion: row.engine_version,
      captureIds: JSON.parse(row.capture_ids) as string[],
      tokensJson: row.tokens_json,
      designMd: row.design_md,
      warningCount: row.warning_count,
      createdAt: row.created_at,
    }
  }

  const GROUP_COLUMNS = `g.id, g.slug, g.name, g.description, g.origin, g.created_at, g.updated_at,
       (SELECT COUNT(*) FROM group_captures gc WHERE gc.group_id = g.id) AS capture_count`

  const getGroupRow = db.prepare<[string], GroupRow>(`SELECT ${GROUP_COLUMNS} FROM groups g WHERE g.id = ?`)
  const getCaptureRow = db.prepare<[string], CaptureRow>(
    'SELECT id, record_json, screenshot_path, created_at, updated_at FROM captures WHERE id = ?',
  )

  /** Insert or replace one capture. Synchronous so transactions can wrap it. */
  function upsertCapture(input: CaptureInput): { capture: Capture; existed: boolean } {
    const now = clock()
    const record = input.record
    const existing = getCaptureRow.get(record.id)
    const recordJson = JSON.stringify(record)

    if (existing) {
      db.prepare(
        `UPDATE captures
            SET component_type = ?, source_url = ?, captured_at = ?, record_json = ?,
                screenshot_path = COALESCE(?, screenshot_path), updated_at = ?
          WHERE id = ?`,
      ).run(
        record.componentType,
        record.sourceUrl,
        record.capturedAt,
        recordJson,
        input.screenshotPath ?? null,
        now,
        record.id,
      )
    } else {
      const nextSeq =
        (db.prepare<[], { next: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM captures').get()?.next ?? 1)
      db.prepare(
        `INSERT INTO captures (id, seq, component_type, source_url, captured_at, record_json,
                               screenshot_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        nextSeq,
        record.componentType,
        record.sourceUrl,
        record.capturedAt,
        recordJson,
        input.screenshotPath ?? null,
        now,
        now,
      )
    }

    if (input.tags !== undefined) {
      clearTags.run(record.id)
      for (const tag of normaliseTags(input.tags)) insertTag.run(record.id, tag)
    }

    const row = getCaptureRow.get(record.id)
    if (!row) throw new Error(`capture ${record.id} vanished during upsert`)
    return { capture: hydrate(row), existed: existing !== undefined }
  }

  /** Append capture ids to a group, skipping ones already present. Synchronous. */
  function appendToGroup(groupId: string, captureIds: readonly string[]): string[] {
    const member = db.prepare<[string, string], { one: number }>(
      'SELECT 1 AS one FROM group_captures WHERE group_id = ? AND capture_id = ?',
    )
    const insert = db.prepare<[string, string, number]>(
      'INSERT INTO group_captures (group_id, capture_id, position) VALUES (?, ?, ?)',
    )
    let position =
      db.prepare<[string], { next: number }>(
        'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM group_captures WHERE group_id = ?',
      ).get(groupId)?.next ?? 1
    const added: string[] = []
    for (const captureId of captureIds) {
      if (member.get(groupId, captureId)) continue
      insert.run(groupId, captureId, position)
      position += 1
      added.push(captureId)
    }
    return added
  }

  const captures: CaptureRepository = {
    async list(query: CaptureQuery = {}) {
      const conditions: string[] = []
      const params: unknown[] = []
      let from = 'captures c'
      // A group query orders by membership position; everything else by the
      // library-wide insertion sequence. Both are unique, so both are total.
      let order = 'c.seq'

      if (query.groupId !== undefined) {
        from = 'captures c JOIN group_captures gc ON gc.capture_id = c.id'
        conditions.push('gc.group_id = ?')
        params.push(query.groupId)
        order = 'gc.position'
      }
      if (query.componentType !== undefined) {
        conditions.push('c.component_type = ?')
        params.push(query.componentType)
      }
      if (query.tag !== undefined) {
        conditions.push('EXISTS (SELECT 1 FROM capture_tags t WHERE t.capture_id = c.id AND t.tag = ?)')
        params.push(query.tag.trim().toLowerCase())
      }

      const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
      const rows = db
        .prepare<unknown[], CaptureRow>(
          `SELECT c.id, c.record_json, c.screenshot_path, c.created_at, c.updated_at
             FROM ${from}${where} ORDER BY ${order}`,
        )
        .all(...params)
      return rows.map(hydrate)
    },

    async get(id) {
      const row = getCaptureRow.get(id)
      return row ? hydrate(row) : null
    },

    async upsert(input) {
      return db.transaction(() => upsertCapture(input).capture)()
    },

    async update(id, patch: CapturePatch) {
      const existing = getCaptureRow.get(id)
      if (!existing) return null
      return db.transaction(() => {
        const now = clock()
        if (patch.record !== undefined) {
          if (patch.record.id !== id) {
            throw new Error(`capture record id ${patch.record.id} does not match ${id}`)
          }
          db.prepare(
            `UPDATE captures SET component_type = ?, source_url = ?, captured_at = ?, record_json = ?, updated_at = ?
              WHERE id = ?`,
          ).run(
            patch.record.componentType,
            patch.record.sourceUrl,
            patch.record.capturedAt,
            JSON.stringify(patch.record),
            now,
            id,
          )
        }
        if (patch.screenshotPath !== undefined) {
          db.prepare('UPDATE captures SET screenshot_path = ?, updated_at = ? WHERE id = ?').run(
            patch.screenshotPath,
            now,
            id,
          )
        }
        if (patch.tags !== undefined) {
          clearTags.run(id)
          for (const tag of normaliseTags(patch.tags)) insertTag.run(id, tag)
          db.prepare('UPDATE captures SET updated_at = ? WHERE id = ?').run(now, id)
        }
        const row = getCaptureRow.get(id)
        return row ? hydrate(row) : null
      })()
    },

    async delete(id) {
      return db.prepare('DELETE FROM captures WHERE id = ?').run(id).changes > 0
    },

    async tags() {
      return db
        .prepare<[], { tag: string; captureCount: number }>(
          'SELECT tag, COUNT(*) AS captureCount FROM capture_tags GROUP BY tag ORDER BY tag',
        )
        .all()
    },
  }

  const groups: GroupRepository = {
    async list() {
      return db
        .prepare<[], GroupRow>(`SELECT ${GROUP_COLUMNS} FROM groups g ORDER BY g.slug`)
        .all()
        .map(hydrateGroup)
    },

    async get(id) {
      const row = getGroupRow.get(id)
      return row ? hydrateGroup(row) : null
    },

    async getBySlug(slug) {
      const row = db.prepare<[string], GroupRow>(`SELECT ${GROUP_COLUMNS} FROM groups g WHERE g.slug = ?`).get(slug)
      return row ? hydrateGroup(row) : null
    },

    async create(input: GroupInput) {
      const now = clock()
      const id = idFactory()
      db.prepare(
        'INSERT INTO groups (id, slug, name, description, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, input.slug, input.name, input.description, input.origin ?? 'manual', now, now)
      const row = getGroupRow.get(id)
      if (!row) throw new Error(`group ${id} vanished during create`)
      return hydrateGroup(row)
    },

    async update(id, patch: GroupPatch) {
      const existing = getGroupRow.get(id)
      if (!existing) return null
      db.prepare('UPDATE groups SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
        patch.name ?? existing.name,
        patch.description ?? existing.description,
        clock(),
        id,
      )
      const row = getGroupRow.get(id)
      return row ? hydrateGroup(row) : null
    },

    async delete(id) {
      return db.prepare('DELETE FROM groups WHERE id = ?').run(id).changes > 0
    },

    async addCaptures(groupId, captureIds) {
      return db.transaction(() => appendToGroup(groupId, captureIds))()
    },

    async removeCapture(groupId, captureId) {
      return (
        db.prepare('DELETE FROM group_captures WHERE group_id = ? AND capture_id = ?').run(groupId, captureId)
          .changes > 0
      )
    },

    async captureIds(groupId) {
      return db
        .prepare<[string], { capture_id: string }>(
          'SELECT capture_id FROM group_captures WHERE group_id = ? ORDER BY position',
        )
        .all(groupId)
        .map((row) => row.capture_id)
    },
  }

  const KIT_SUMMARY_COLUMNS = `id, group_id, scope, version, set_id, name, engine_version, capture_ids,
       '' AS tokens_json, '' AS design_md, warning_count, created_at`

  const kits: KitRepository = {
    async list(query = {}) {
      const hasScope = 'groupId' in query
      // The library scope is selected by the scope column, never by group_id
      // being NULL: an orphaned group kit also has a NULL group_id.
      const where = hasScope ? (query.groupId === null ? "WHERE scope = 'library'" : 'WHERE group_id = ?') : ''
      const params = hasScope && query.groupId !== null && query.groupId !== undefined ? [query.groupId] : []
      const rows = db
        .prepare<unknown[], KitRow>(
          `SELECT ${KIT_SUMMARY_COLUMNS} FROM kits ${where} ORDER BY created_at DESC, version DESC, id DESC`,
        )
        .all(...params)
      return rows.map((row): KitSummary => {
        const { tokensJson: _tokens, designMd: _design, ...summary } = hydrateKit(row)
        return summary
      })
    },

    async get(id) {
      const row = db.prepare<[string], KitRow>('SELECT * FROM kits WHERE id = ?').get(id)
      return row ? hydrateKit(row) : null
    },

    async latest(groupId) {
      const row =
        groupId === null
          ? db.prepare<[], KitRow>("SELECT * FROM kits WHERE scope = 'library' ORDER BY version DESC LIMIT 1").get()
          : db
              .prepare<[string], KitRow>('SELECT * FROM kits WHERE group_id = ? ORDER BY version DESC LIMIT 1')
              .get(groupId)
      return row ? hydrateKit(row) : null
    },

    async create(input: KitInput) {
      return db.transaction(() => {
        const scope = input.groupId === null ? 'library' : 'group'
        const nextVersion =
          (input.groupId === null
            ? db
                .prepare<[], { next: number }>(
                  "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM kits WHERE scope = 'library'",
                )
                .get()?.next
            : db
                .prepare<[string], { next: number }>(
                  'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM kits WHERE group_id = ?',
                )
                .get(input.groupId)?.next) ?? 1
        const id = idFactory()
        db.prepare(
          `INSERT INTO kits (id, group_id, scope, version, set_id, name, engine_version, capture_ids,
                             tokens_json, design_md, warning_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.groupId,
          scope,
          nextVersion,
          input.setId,
          input.name,
          input.engineVersion,
          JSON.stringify(input.captureIds),
          input.tokensJson,
          input.designMd,
          input.warningCount,
          clock(),
        )
        const row = db.prepare<[string], KitRow>('SELECT * FROM kits WHERE id = ?').get(id)
        if (!row) throw new Error(`kit ${id} vanished during create`)
        return hydrateKit(row)
      })()
    },
  }

  const OVERRIDE_COLUMNS =
    'path, value, base_value, note, resolved_value, resolved_base, resolved_engine, suggested_by, created_at, updated_at'

  const PROPOSAL_COLUMNS =
    'id, capability, prompt_version, model, path, value, base_value, title, rationale, engine_notes, status, created_at, updated_at'

  const reviews: ReviewRepository = {
    async overrides(scope) {
      return db
        .prepare<[string], OverrideRow>(
          `SELECT ${OVERRIDE_COLUMNS} FROM token_overrides WHERE scope_key = ? ORDER BY path`,
        )
        .all(scopeKey(scope))
        .map(hydrateOverride)
    },

    async setOverride(scope, input: OverrideInput) {
      const now = clock()
      // created_at survives a replacement: editing a value the reviewer already
      // set is the same decision revised, not a new one.
      db.prepare(
        `INSERT INTO token_overrides
           (scope_key, path, value, base_value, note, resolved_value, resolved_base, resolved_engine, suggested_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (scope_key, path) DO UPDATE SET
           value = excluded.value,
           base_value = excluded.base_value,
           note = excluded.note,
           resolved_value = excluded.resolved_value,
           resolved_base = excluded.resolved_base,
           resolved_engine = excluded.resolved_engine,
           suggested_by = excluded.suggested_by,
           updated_at = excluded.updated_at`,
      ).run(
        scopeKey(scope),
        input.path,
        input.value,
        input.baseValue,
        input.note ?? '',
        input.resolvedConflict?.value ?? null,
        input.resolvedConflict?.baseValue ?? null,
        input.resolvedConflict?.engineValue ?? null,
        input.suggestedBy ?? null,
        now,
        now,
      )
      const row = db
        .prepare<[string, string], OverrideRow>(
          `SELECT ${OVERRIDE_COLUMNS} FROM token_overrides WHERE scope_key = ? AND path = ?`,
        )
        .get(scopeKey(scope), input.path)
      if (!row) throw new Error(`override ${input.path} vanished during write`)
      return hydrateOverride(row)
    },

    async clearOverride(scope, path) {
      return db.prepare('DELETE FROM token_overrides WHERE scope_key = ? AND path = ?').run(scopeKey(scope), path)
        .changes > 0
    },

    async decisions(scope) {
      return db
        .prepare<[string], DecisionRow>(
          'SELECT card_id, state, note, created_at, updated_at FROM decision_reviews WHERE scope_key = ? ORDER BY card_id',
        )
        .all(scopeKey(scope))
        .map(hydrateDecision)
    },

    async acceptDecision(scope, cardId, note) {
      const now = clock()
      db.prepare(
        `INSERT INTO decision_reviews (scope_key, card_id, state, note, created_at, updated_at)
         VALUES (?, ?, 'accepted', ?, ?, ?)
         ON CONFLICT (scope_key, card_id) DO UPDATE SET
           note = excluded.note,
           updated_at = excluded.updated_at`,
      ).run(scopeKey(scope), cardId, note ?? '', now, now)
      const row = db
        .prepare<[string, string], DecisionRow>(
          'SELECT card_id, state, note, created_at, updated_at FROM decision_reviews WHERE scope_key = ? AND card_id = ?',
        )
        .get(scopeKey(scope), cardId)
      if (!row) throw new Error(`decision ${cardId} vanished during write`)
      return hydrateDecision(row)
    },

    async reopenDecision(scope, cardId) {
      return (
        db.prepare('DELETE FROM decision_reviews WHERE scope_key = ? AND card_id = ?').run(scopeKey(scope), cardId)
          .changes > 0
      )
    },
  }

  const proposals: ProposalRepository = {
    async list(scope) {
      return db
        .prepare<[string], ProposalRow>(
          `SELECT ${PROPOSAL_COLUMNS} FROM assistant_proposals WHERE scope_key = ? ORDER BY created_at, id`,
        )
        .all(scopeKey(scope))
        .map(hydrateProposal)
    },

    async get(scope, id) {
      const row = db
        .prepare<[string, string], ProposalRow>(
          `SELECT ${PROPOSAL_COLUMNS} FROM assistant_proposals WHERE scope_key = ? AND id = ?`,
        )
        .get(scopeKey(scope), id)
      return row ? hydrateProposal(row) : null
    },

    async create(scope, input: ProposalInput) {
      const id = idFactory()
      const now = clock()
      db.prepare(
        `INSERT INTO assistant_proposals
           (id, scope_key, capability, prompt_version, model, path, value, base_value, title, rationale, engine_notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      ).run(
        id,
        scopeKey(scope),
        input.capability,
        input.promptVersion,
        input.model,
        input.path,
        input.value,
        input.baseValue,
        input.title,
        input.rationale,
        JSON.stringify(input.engineNotes ?? []),
        now,
        now,
      )
      const row = db
        .prepare<[string], ProposalRow>(`SELECT ${PROPOSAL_COLUMNS} FROM assistant_proposals WHERE id = ?`)
        .get(id)
      if (!row) throw new Error(`proposal ${id} vanished during create`)
      return hydrateProposal(row)
    },

    async resolve(scope, id, status) {
      const changed = db
        .prepare('UPDATE assistant_proposals SET status = ?, updated_at = ? WHERE scope_key = ? AND id = ?')
        .run(status, clock(), scopeKey(scope), id).changes
      if (changed === 0) return null
      const row = db
        .prepare<[string], ProposalRow>(`SELECT ${PROPOSAL_COLUMNS} FROM assistant_proposals WHERE id = ?`)
        .get(id)
      return row ? hydrateProposal(row) : null
    },

    async clearOpen(scope) {
      return db
        .prepare(`DELETE FROM assistant_proposals WHERE scope_key = ? AND status = 'open'`)
        .run(scopeKey(scope)).changes
    },
  }

  const settings: SettingsRepository = {
    async get(key) {
      return db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null
    },
    async set(key, value) {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, value, clock())
    },
    async delete(key) {
      return db.prepare('DELETE FROM settings WHERE key = ?').run(key).changes > 0
    },
  }

  return {
    captures,
    groups,
    kits,
    reviews,
    proposals,
    settings,

    async importCaptureSet(input: CaptureSetImport): Promise<ImportResult> {
      return db.transaction(() => {
        const now = clock()
        let groupRow = db
          .prepare<[string], GroupRow>(`SELECT ${GROUP_COLUMNS} FROM groups g WHERE g.slug = ?`)
          .get(input.slug)
        if (!groupRow) {
          const id = idFactory()
          db.prepare(
            'INSERT INTO groups (id, slug, name, description, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(id, input.slug, input.name, input.description, 'import', now, now)
          groupRow = getGroupRow.get(id)
        } else {
          // Re-importing the same set is how a user refreshes it, so the group's
          // own metadata follows the incoming set rather than going stale.
          db.prepare('UPDATE groups SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
            input.name,
            input.description,
            now,
            groupRow.id,
          )
        }
        if (!groupRow) throw new Error(`group ${input.slug} vanished during import`)

        const created: string[] = []
        const replaced: string[] = []
        for (const record of input.records) {
          const result = upsertCapture({ record })
          ;(result.existed ? replaced : created).push(result.capture.id)
        }
        appendToGroup(
          groupRow.id,
          input.records.map((record) => record.id),
        )

        const refreshed = getGroupRow.get(groupRow.id)
        if (!refreshed) throw new Error(`group ${input.slug} vanished during import`)
        return { group: hydrateGroup(refreshed), created, replaced }
      })()
    },

    async close() {
      db.close()
    },
  }
}

function hydrateOverride(row: OverrideRow): StoredOverride {
  const stored: StoredOverride = {
    path: row.path,
    value: row.value,
    baseValue: row.base_value,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.resolved_value !== null && row.resolved_base !== null) {
    stored.resolvedConflict = {
      value: row.resolved_value,
      baseValue: row.resolved_base,
      ...(row.resolved_engine === null ? {} : { engineValue: row.resolved_engine }),
    }
  }
  // NULL is "the reviewer wrote it", not "unknown", so anything else is read
  // strictly: a value this build does not know is dropped rather than passed
  // upward as a provenance claim nothing can explain.
  if (row.suggested_by === 'assistant') stored.suggestedBy = 'assistant'
  return stored
}

function hydrateProposal(row: ProposalRow): StoredProposal {
  return {
    id: row.id,
    capability: row.capability,
    promptVersion: row.prompt_version,
    model: row.model,
    path: row.path,
    value: row.value,
    baseValue: row.base_value,
    title: row.title,
    rationale: row.rationale,
    engineNotes: JSON.parse(row.engine_notes) as string[],
    status: row.status as StoredProposal['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function hydrateDecision(row: DecisionRow): StoredDecision {
  return {
    cardId: row.card_id,
    state: 'accepted',
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
