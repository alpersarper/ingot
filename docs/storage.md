# Storage

The panel stores captures, groups, kits and settings behind one interface:
[`apps/server/src/storage/store.ts`](../apps/server/src/storage/store.ts). SQLite
is the only implementation that ships today. Postgres is the one that follows,
and this document is the contract that makes that a bounded change rather than a
rewrite.

## The shape

```
apps/server/src/storage/
  store.ts          the interface. Routes import only this.
  ids.ts            id and clock factories, injected into adapters
  sqlite/
    index.ts        createSqliteStore -- the adapter
    schema.ts       migrations, applied against PRAGMA user_version
```

`Store` is four repositories plus two operations:

| Member | Holds |
| ------ | ----- |
| `captures` | Capture records, verbatim, with the panel's own tags and screenshot path beside them. |
| `groups` | Named collections and their ordered membership. A group is what a kit is generated from. |
| `kits` | Generated kits, versioned per scope, with the engine's output stored byte for byte. |
| `settings` | Server-side key/value. The pairing token and the LLM API key live here. |
| `importCaptureSet` | One atomic bulk import: group, records, membership. |
| `close` | Release the connection. |

## The three rules

These are what a second adapter has to honour. They are also why the interface
looks the way it does rather than the way better-sqlite3 would have made it look.

**1. Every method is async.** better-sqlite3 is synchronous and would happily
have exposed synchronous methods; every Postgres driver is not. Returning
already-resolved promises from the SQLite adapter costs nothing, and it is the
entire difference between adding a file and rewriting every call site.

**2. No transaction handle crosses the seam.** There is no `store.begin()`.
Work that spans rows is exposed as one named operation -- `importCaptureSet` is
the example -- and each adapter implements it atomically however its driver
prefers: `db.transaction(...)` in SQLite, `BEGIN`/`COMMIT` in Postgres. A generic
`transaction(callback)` would have required better-sqlite3's synchronous
transactions to host awaited callbacks, which it cannot do safely, so the
interface would have had to be shaped around the weaker driver.

**3. Ordering is explicit and total.** Every list method documents its sort and
every sort ends in a tiebreaker that cannot repeat -- `captures.seq` for the
library, `group_captures.position` for a group. This is not tidiness. The engine
guarantees byte-identical output for the same input, and "the same input"
includes the order the captures arrive in; a list method that returned rows in
whatever order the planner chose would silently break the guarantee at the last
step. `apps/server/test/kit-determinism.test.ts` is the alarm.

Identity and time enter through the seam too: adapters take an `IdFactory` and a
`Clock` rather than calling `randomUUID()` or `Date.now()`, so tests pin both.

## Writing a second adapter

1. Implement `Store` in `apps/server/src/storage/<name>/`.
2. Add one line to that adapter's test file:

   ```ts
   describeStoreContract('postgres', () => createPostgresStore({ ... }))
   ```

   `apps/server/test/storage-contract.ts` is written against the interface and
   knows nothing about any implementation. If it passes, the routes work.
3. Select the adapter in `apps/server/src/index.ts`. That is the only file above
   the seam that names an implementation.

Anything the contract suite does not cover is something the interface never
promised. Adding a method to `Store` means adding its cases to the contract in
the same commit.

## What is deliberately not in the database

**Screenshots.** Images live on the data volume under `<INGOT_DATA_DIR>/screenshots`
and only their path is stored -- see `apps/server/src/screenshots.ts`. Full-quality
captures grow fast, and a database carrying them is one nobody can back up or
move. The path is always derived from the capture id and never from caller
input, which is what makes traversal impossible rather than merely filtered.

**Anything the engine produced, re-derived.** A kit stores the exact strings
`serializeTokens()` and `renderDesignMarkdown()` returned. Re-serialising a
parsed tokens document on the way out would produce a file that differs from
what `pnpm skeleton` writes, which is the thing this whole layer exists not to
do.

## The SQLite schema

`apps/server/src/storage/sqlite/schema.ts` holds an append-only list of
migrations applied against `PRAGMA user_version`, so an existing data volume
upgrades in place and a database written by a newer server is refused rather
than corrupted. Never edit a migration that has shipped; add the next one.

Two details worth knowing:

- `captures.seq` is `INTEGER NOT NULL UNIQUE` fed from `MAX(seq) + 1` rather than
  a rowid alias, so a deleted capture's position is never reused and library
  order stays total across deletes.
- `kits.group_id` is `NULL` for a whole-library kit. SQLite treats NULLs as
  distinct in a unique index, so the per-scope version uniqueness needs two
  partial indexes rather than one.
