# ADR-0002: Global catalog index as canonical store, per-folder snapshot as backup

Date: 2026-07-20 · Status: accepted (owner-decided)

## Context

Today the working store is per-folder: each folder holds
`{folder}/.ai-video-cataloger/catalog.db` (a SQLite file) plus `config.json`,
opened through `SqlJsCatalogRepositoryFactory` (`adapters/db/sql-js.ts`) keyed
by resolved folder path. This is the "sidecar-canonical" model recorded in
`docs/architecture.md` Delta 3: the database that travels with the media is the
source of truth. It works for the v1 process/scan flow but does not support the
product's next step — searching, filtering, and (later) faces across an entire
drive without touching every folder.

The concrete constraints that force a decision now:

- Media lives on external 1–2 TB drives. Whole-drive search cannot mean opening
  hundreds of sidecar databases on demand.
- Drives are frequently offline. The user must still search and browse catalog
  metadata for a disconnected drive.
- Two composition roots (`apps/desktop`, `apps/cli`) write concurrently. A
  single canonical write path avoids reconciling divergent sidecars.
- Full-text search (FTS5) and, later, face embeddings need one real, indexed
  database — not many small files scanned linearly.

## Decision

### (a) Global SQLite index is canonical; per-folder snapshot is derived

A single global SQLite database in the home scope
(`~/.ai-video-cataloger/`, the path already owned by desktop/CLI composition)
becomes the **canonical working store** for catalog rows (the `videos` table of
`adapters/db/schema.ts`, extended with a folder dimension) and for search
indexes (FTS5, later embeddings). All reads and writes in `CatalogRepository`
(`core/server/ports.ts`) target the global index.

Each folder keeps a **derived NDJSON snapshot**
(`{folder}/.ai-video-cataloger/catalog.ndjson`, one video row per line) written
after processing. The snapshot is a backup and interchange format, not the
source of truth: it lets a drive carry its own catalog to another machine and
lets the index be rebuilt if lost.

This **inverts** the naive sidecar-canonical alternative (per-folder DB is
truth, global is optional cache). The inversion is deliberate: whole-drive and
offline-drive search need one queryable DB (constraints above); a single write
path removes GUI/CLI reconciliation; FTS5 and embeddings require a real DB, not
sidecar files. NDJSON (not a second SQLite file) is the snapshot because it is
append-friendly, diff-friendly, forward-compatible, and trivially
re-importable; a sidecar DB would reintroduce two canonical stores.

### (b) Folder identity via a UUID marker file

Folder identity is a UUID written once to
`{folder}/.ai-video-cataloger/folder-id` and never derived from the folder's
path or mount point. Paths change (rename, remount at a different mount point,
different machine); the marker rides inside the folder. The global index keys
each folder's rows by this `folderId`, so a renamed or remounted folder resolves
to the same catalog without rescanning.

### (c) File identity via content fingerprint

A video's identity is a content fingerprint, not its path: file **size** plus a
SHA-256 over the **first and last 1 MiB** of the file. This is the standardized
form of the existing `FileSystemPort.partialContentHash`
(`adapters/fs/index.ts`), stored as `videos.file_hash` and already used by
`scanFolder` (`core/server/usecases/scan.ts`) as the fallback match after
path match (`findVideoByPath` → `findVideoByHash`). The global layer fixes the
window at 1 MiB (today's adapter hashes 64 KiB windows) so a fingerprint is
stable across machines and cheap on multi-GB files: a moved or renamed video
keeps its catalog entry; re-encodes and truncations get a new identity.

### (d) Snapshot import and conflict resolution

On encountering a folder whose `folderId` (from the marker file) is unknown to
the global index, the layer **imports the folder's NDJSON snapshot** into the
index — this is how a drive from another machine, or a rebuilt index, recovers
its catalog. When an imported row and an existing indexed row collide (same
`folderId` + `fileHash`), the row with the newer `processed_at` wins
(`processed_at` = the catalog `updated_at` timestamp on `videoSchema`,
`core/domain/video.ts`). This is a **last-writer-wins** rule and is only sound
under the **single-user assumption** already fixed by ADR-0001 (one implicit
local user, no identity): there is no second actor whose concurrent edit could
be silently lost, so a coarse timestamp comparison is sufficient and no merge
or vector-clock machinery is warranted.

### (e) Privacy stance for the future faces feature

This layer enables — but does not yet implement — a faces feature. When built,
face embeddings and labels are: computed and stored **100% locally** (in the
global index, never sent anywhere, consistent with the default-OFF telemetry of
`docs/architecture.md` Delta 6); **opt-in**; individually **deletable**; and
**excluded from the NDJSON snapshot and every export/interchange path**. Faces
data never leaves the machine and never travels with a drive. This is recorded
here as a consequence the data layer must keep open, not as work in this ADR.

## Alternatives considered

- **Central-DB-only (global index, no per-folder snapshot).** Rejected: no
  portability — a drive carried to another machine arrives with no catalog; and
  no recovery path if the single index is lost or corrupted. The snapshot is the
  backup and the interchange unit.
- **Sidecar-canonical (per-folder DB is truth; status quo of Delta 3).**
  Rejected: does not scale to whole-drive search (linear open of many DBs), does
  not support offline-drive search, forces GUI/CLI reconciliation across
  divergent sidecars, and gives FTS5/embeddings no single DB to index.

## Consequences

- `docs/architecture.md` Delta 3 is revised: the per-folder `catalog.db` is no
  longer canonical. The `CatalogRepository` factory dimension keyed by folder
  path becomes a `folderId`-keyed dimension within one global database; the
  sidecar becomes the NDJSON snapshot writer. `ConfigStore` folder/home scopes
  (`core/server/ports.ts`) are unaffected — config resolution
  (`resolveConfigValues`) still layers folder over home per key.
- A `folderId` marker and a snapshot-writer step join the write path; scan gains
  an unknown-`folderId` import branch. The fingerprint window changes from 64
  KiB to 1 MiB in `partialContentHash`; existing rows keep their stored hash and
  are re-fingerprinted lazily on next scan.
- Backward compatibility: existing per-folder `catalog.db` files are read once
  and imported into the global index; they are not written to after migration.
- The single global index is the new single point of failure; the per-folder
  NDJSON snapshots are its recovery source, so snapshot writes must be durable
  and must follow every catalog mutation.
- Search (FTS5) and the faces feature become buildable on one indexed store
  without a further storage-model decision.

Changing this decision means editing this ADR and `docs/architecture.md`
Delta 3 first, then the code.
