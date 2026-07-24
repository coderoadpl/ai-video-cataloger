# ADR-0003: SQLite data conventions (timestamps, ids, constraints, pagination)

Date: 2026-07-25 · Status: accepted (owner-decided 2026-07-25)

## Context

The agentproofarch foundation ships a Postgres data-conventions ADR
(`timestamptz`, native `uuid` primary keys, `CHECK` mandates, integer minor
units, cursor pagination, migration packages). None of the pg column builders
exist on this app's store: the global catalog index is `sql.js` (SQLite
compiled to WebAssembly, ADR-0002), there is no migration runner (schema
evolution is `adapters/db/global-catalog-schema.ts` plus snapshot rebuild), and
there is no money domain. The portable half of the upstream convention — stable
serialization of time and identity, store-enforced invariants, and a pagination
grammar that survives a 1–2 TB drive — still applies and was previously
enforced only by review. This ADR records the SQLite-flavoured equivalent so
`scripts/doc-lint.ts` guards it mechanically from day one.

## Decision

### (a) Timestamps are ISO-8601 text

Every timestamp column is a SQLite `text` column holding an **ISO-8601** string
(`new Date().toISOString()`), never a numeric epoch and never a pg
`timestamptz`. The canonical columns — `first_seen_at`, `last_seen_at`,
`processed_at`, `started_at`, `finished_at` in
`adapters/db/global-catalog-schema.ts` — are all `text`, and the values are
minted at the use-case edge (`core/server/usecases/folder-identity.ts`,
`process-drive.ts`, `catalog-index.ts`) with `toISOString()`. Text ISO-8601
sorts lexicographically in the same order as chronologically, so range scans and
`ORDER BY` need no conversion, and the snapshot NDJSON carries the identical
string with no timezone ambiguity.

### (b) Identifiers are app-minted UUID text

Row identities that cross a boundary — `folder_id`, `run_id` — are **app-minted
UUID `text`** primary keys, generated with `randomUUID()` at the use-case edge
(`core/server/usecases/folder-identity.ts` mints `folderId`;
`process-drive.ts` mints `runId`), never database-assigned. SQLite has no native
`uuid` type, so the id is a `text` primary key. Minting in the app (not the DB)
keeps identity available before the write, keeps the two composition roots
(`apps/desktop`, `apps/cli`) from depending on insert-order, and lets the id
ride into the folder marker and the NDJSON snapshot unchanged. Autoincrement
integer keys (`tag_id`) stay purely local to the index and never appear in a
snapshot or contract.

### (c) CHECK constraints where expressible

Cross-row and cross-column invariants are enforced by the **store**, not the
caller, wherever SQLite can express them as a `CHECK` constraint or a
`NOT NULL`/`UNIQUE`/foreign-key declaration. Where an invariant cannot be a
column constraint (multi-statement atomicity, the single-writer rule) it is
enforced by the `withCatalogWriteLock` funnel (ADR-0002, hotspot 4), not by
scattering validation across call sites. "Where expressible" is deliberate:
this is a floor, not a mandate to contort logic into SQL.

### (d) Cursor pagination is the list-endpoint contract grammar

Any future list endpoint over catalog rows (whole-drive search, filtered video
lists) paginates by **opaque cursor**, never `offset`/`limit`. A cursor encodes
the last-seen sort key so a 1–2 TB result set pages deterministically while rows
are inserted or deleted concurrently under the write lock. This is recorded now
as contract grammar so the first list endpoint is built cursor-first; no
offset-paginated list endpoint may be added.

## Consequences

- `scripts/doc-lint.ts` asserts (a) and (b) against the schema and the minting
  sites, so a column that drifts to an integer timestamp or a DB-assigned id
  fails `check`.
- Recovery from an NDJSON snapshot restores ISO-8601 times and UUID ids
  verbatim (ADR-0002 §(d)), because both are already text.
- The cursor-grammar rule (d) has no code to guard yet — it is a forward
  contract; doc-lint keeps the promise recorded so the first list endpoint
  honours it.
