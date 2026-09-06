/**
 * The storage seam.
 *
 * Everything above this file talks to `Store`; nothing above it knows SQLite
 * exists. The panel ships on SQLite because it runs on one machine in one
 * container, but the deployed product runs on Postgres, and the point of this
 * interface is that the move is a new file under `storage/`, not a rewrite of
 * the routes.
 *
 * Three rules keep that promise honest, and they are the reason the shapes
 * below look the way they do. `docs/storage.md` is the long form.
 *
 * 1. **Every method is async.** SQLite through better-sqlite3 is synchronous and
 *    would happily expose sync methods; Postgres cannot. Returning promises
 *    from a synchronous adapter costs nothing and is the whole difference
 *    between "swap the adapter" and "await everything, everywhere, forever".
 *
 * 2. **No transaction handle crosses the seam.** There is no `store.begin()`.
 *    Multi-row work is exposed as one named operation -- {@link Store.importCaptureSet}
 *    is the example -- which each adapter implements atomically in whatever way
 *    its driver prefers. A generic `transaction(cb)` would have forced
 *    better-sqlite3's synchronous transactions to host awaited callbacks, which
 *    it cannot do safely.
 *
 * 3. **Ordering is explicit and total.** Every list method documents its sort,
 *    and every sort ends in a tiebreaker that cannot repeat. The engine is
 *    deterministic; a kit built from rows the database returned in an arbitrary
 *    order would throw that away at the last step.
 *
 * Identity and time also enter through this seam only: adapters take an
 * {@link IdFactory} and a {@link Clock} rather than calling `randomUUID` or
 * `Date.now` themselves, which is what lets the tests pin both.
 */
import type { CaptureRecord } from '@ingot/engine'

/** Mints stable, unique ids. Injected so tests can make them predictable. */
export type IdFactory = () => string

/** Returns the current instant as an ISO 8601 UTC string. Injected, same reason. */
export type Clock = () => string

/**
 * One stored capture.
 *
 * `record` is exactly the engine's input shape -- `schemas/capture-record.schema.json`
 * -- and is stored verbatim, byte for byte as it arrived. That is not tidiness:
 * `distill()` is only byte-deterministic if it is handed back what it was given,
 * so the server must not normalise, reorder or re-serialise a record on the way
 * through. Everything the panel adds lives beside the record, never inside it.
 */
export interface Capture {
  /** The record's own id. Stable across recaptures, so provenance survives one. */
  id: string
  record: CaptureRecord
  /**
   * Path of the screenshot on the data volume, relative to the screenshot root,
   * or `null`. The image itself is never in the database -- see
   * `src/screenshots.ts`. The engine never reads it: `record.screenshot` stays
   * `null`, because a non-null value there fails capture validation.
   */
  screenshotPath: string | null
  /** Free-form user tags, sorted, deduplicated, lowercase. */
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** What a caller supplies to create or replace a capture. */
export interface CaptureInput {
  record: CaptureRecord
  tags?: string[]
  screenshotPath?: string | null
}

/** Field-wise patch. An omitted field is left alone; `record` is replaced whole. */
export interface CapturePatch {
  record?: CaptureRecord
  tags?: string[]
  screenshotPath?: string | null
}

export interface CaptureQuery {
  /** Restrict to one group, in that group's own capture order. */
  groupId?: string
  componentType?: string
  tag?: string
}

/**
 * A named collection of captures: an imported set, or one the user assembled.
 *
 * A group is what a kit is generated from, which is why it carries the three
 * fields the engine's `CaptureSet` needs. `slug` becomes `tokens.source.setId`,
 * so it is held to the engine's slug rule.
 */
export interface Group {
  id: string
  /** Lowercase slug. Unique. Becomes the distilled set id. */
  slug: string
  name: string
  description: string
  /** `import` for a group created by a bulk import, `manual` for a user's own. */
  origin: 'import' | 'manual'
  createdAt: string
  updatedAt: string
  /** Number of captures currently in the group. */
  captureCount: number
}

export interface GroupInput {
  slug: string
  name: string
  description: string
  origin?: 'import' | 'manual'
}

export interface GroupPatch {
  name?: string
  description?: string
}

/**
 * One generated kit: the engine's output frozen with the inputs that produced it.
 *
 * `tokensJson` and `designMd` are stored as the exact strings the engine
 * emitted rather than as a re-serialised object, so a download is a byte-for-byte
 * copy of what `pnpm skeleton` would have written for the same captures.
 */
export interface Kit {
  id: string
  /** The group this kit distils, or `null` for a whole-library kit. */
  groupId: string | null
  /** 1-based, monotonic within `groupId`. Kits are versioned, never overwritten. */
  version: number
  /** Set id handed to the engine; `tokens.source.setId` in the output. */
  setId: string
  name: string
  engineVersion: string
  /** Capture ids in the exact order they were handed to the engine. */
  captureIds: string[]
  /** `serializeTokens()` output, verbatim. */
  tokensJson: string
  /** `renderDesignMarkdown()` output, verbatim. */
  designMd: string
  /** Count of `warning`-level diagnostics, denormalised so lists need no parse. */
  warningCount: number
  createdAt: string
}

/** A kit without its two large payloads, for listing. */
export type KitSummary = Omit<Kit, 'tokensJson' | 'designMd'>

export interface KitInput {
  groupId: string | null
  setId: string
  name: string
  engineVersion: string
  captureIds: string[]
  tokensJson: string
  designMd: string
  warningCount: number
}

export interface CaptureRepository {
  /**
   * Captures, oldest insertion first.
   *
   * With `groupId`, the group's own membership order instead. Both orders are
   * total: insertion sequence and membership position are unique per row.
   */
  list(query?: CaptureQuery): Promise<Capture[]>
  get(id: string): Promise<Capture | null>
  /**
   * Insert, or replace the capture with this record's id.
   *
   * Replacement is the deliberate behaviour for a recapture of the same
   * element: the id is stable, so the second capture is a newer measurement of
   * the same thing, not a second thing. Group membership and tags survive it.
   */
  upsert(input: CaptureInput): Promise<Capture>
  update(id: string, patch: CapturePatch): Promise<Capture | null>
  /** Removes the capture and its group memberships. Returns false if unknown. */
  delete(id: string): Promise<boolean>
  /** Every tag in use, sorted, with how many captures carry it. */
  tags(): Promise<Array<{ tag: string; captureCount: number }>>
}

export interface GroupRepository {
  /** Groups, by slug. */
  list(): Promise<Group[]>
  get(id: string): Promise<Group | null>
  getBySlug(slug: string): Promise<Group | null>
  create(input: GroupInput): Promise<Group>
  update(id: string, patch: GroupPatch): Promise<Group | null>
  /** Removes the group and its memberships. The captures themselves stay. */
  delete(id: string): Promise<boolean>
  /**
   * Appends captures, in the order given, skipping ones already in the group.
   * Membership positions are append-only, so a group's capture order is stable
   * for as long as nothing is removed from it. Returns the ids actually added.
   */
  addCaptures(groupId: string, captureIds: string[]): Promise<string[]>
  removeCapture(groupId: string, captureId: string): Promise<boolean>
  /** Capture ids in membership order. */
  captureIds(groupId: string): Promise<string[]>
}

export interface KitRepository {
  /**
   * Kits, newest first.
   *
   * `groupId: null` selects whole-library kits specifically; omitting the query
   * returns every kit.
   */
  list(query?: { groupId?: string | null }): Promise<KitSummary[]>
  get(id: string): Promise<Kit | null>
  /** The highest-versioned kit for this scope, or `null` if none exists. */
  latest(groupId: string | null): Promise<Kit | null>
  /** Assigns the next version within `groupId` and stores the kit. */
  create(input: KitInput): Promise<Kit>
}

/**
 * Server-side key/value settings.
 *
 * This is where the pairing token and the LLM API key live. Both are secrets
 * that must never reach the browser, which is a property of the routes above
 * rather than of this interface -- see `src/routes/settings.ts`. The interface
 * itself is deliberately dumb.
 */
export interface SettingsRepository {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<boolean>
}

/** What a bulk import did, reported per capture so the panel can say so. */
export interface ImportResult {
  group: Group
  /** Capture ids that did not exist before. */
  created: string[]
  /** Capture ids that replaced an existing record. */
  replaced: string[]
}

/** A capture set as it arrives for import: the engine's `CaptureSet` shape. */
export interface CaptureSetImport {
  slug: string
  name: string
  description: string
  records: CaptureRecord[]
}

export interface Store {
  readonly captures: CaptureRepository
  readonly groups: GroupRepository
  readonly kits: KitRepository
  readonly settings: SettingsRepository
  /**
   * Import a whole capture set atomically: create or reuse the group, upsert
   * every record, and append them all to the group in the order given.
   *
   * This is the shape rule 2 in the file header is about. It exists as one
   * operation rather than as a loop the routes write inside a transaction
   * handle, because a transaction handle is the thing a Postgres adapter cannot
   * be given for free.
   */
  importCaptureSet(input: CaptureSetImport): Promise<ImportResult>
  close(): Promise<void>
}
