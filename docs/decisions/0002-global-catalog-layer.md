# ADR-0002: Global catalog index as canonical store, per-folder snapshot as backup

Date: 2026-07-20 · Status: accepted (owner-decided) · Amended 2026-07-22 to match the
implementation · Amended 2026-07-27 with §(f) read-only folders

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
- Full-text search (FTS4; see the rationale in (a)) and, later, face embeddings
  need one real, indexed database — not many small files scanned linearly.

## Decision

### (a) Global SQLite index is canonical; per-folder snapshot is derived

A single global SQLite database in the home scope
(`~/.ai-video-cataloger/`, the path already owned by desktop/CLI composition)
becomes the **canonical working store** for catalog rows (the `videos` table of
`adapters/db/schema.ts`, extended with a folder dimension) and for search
indexes (FTS, later embeddings). All reads and writes in `CatalogRepository`
(`core/server/ports.ts`) target the global index.

The full-text index is **FTS4**, not FTS5 (`search_documents_fts` in
`adapters/db/global-catalog-schema.ts`). The store runs on `sql.js` (SQLite
compiled to WebAssembly); the bundled `sql.js` build ships with FTS3/FTS4
enabled but not the FTS5 module, so FTS4 is the empirically available full-text
option in this runtime. A separate `search_documents` shadow table holds the
raw column values and a stable `docid`, keeping ranking and snippet generation
independent of FTS5-only features.

Each folder keeps a **derived NDJSON snapshot**
(`{folder}/.ai-video-cataloger/catalog.ndjson`, one video row per line) written
after processing. The snapshot is a backup and interchange format, not the
source of truth: it lets a drive carry its own catalog to another machine and
lets the index be rebuilt if lost.

This **inverts** the naive sidecar-canonical alternative (per-folder DB is
truth, global is optional cache). The inversion is deliberate: whole-drive and
offline-drive search need one queryable DB (constraints above); a single write
path removes GUI/CLI reconciliation; full-text search and embeddings require a real DB, not
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
SHA-256 over the **first and last 1 MiB** of the file, **truncated to the first
16 hex characters** of the digest (`FileSystemPort.partialContentHash`,
`adapters/fs/index.ts` — `hash.digest('hex').substring(0, 16)`). The 16-hex
(64-bit) truncation keeps fingerprints short as table keys while remaining
collision-safe for a personal catalog. The fingerprint is stable across
machines and cheap on multi-GB files: a moved or renamed video keeps its catalog
entry; re-encodes and truncations get a new identity. If the file cannot be
hashed (unreadable window, size read failure) the adapter yields `null` and the
file is not indexed — the process pipeline emits a `catalog_index_skipped`
warning event rather than recording it.

### (d) Snapshot import and conflict resolution

On encountering a folder whose `folderId` (from the marker file) is unknown to
the global index, the layer **imports the folder's NDJSON snapshot** into the
index — this is how a drive from another machine, or a rebuilt index, recovers
its catalog.

The `files` table's **primary key is the fingerprint alone** (not
`folderId` + `fileHash`); `folderId` is a plain column
(`adapters/db/global-catalog-schema.ts`). One row therefore exists per distinct
content, regardless of how many folders hold a copy. **Duplicate-content
semantics** follow from this: identical content in two folders resolves to one
`files` row, recorded under whichever folder processed or imported it last (the
upsert overwrites `folderId`); the same content encountered in another folder is
detected as already-indexed by fingerprint and **skipped** there rather than
duplicated.

When an imported row and an existing indexed row collide (same fingerprint), the
row with the newer `processed_at` wins (`newerWins`,
`core/domain/global-catalog.ts`). This is a **last-writer-wins** rule and is
only sound under the **single-user assumption** already fixed by ADR-0001 (one
implicit local user, no identity): there is no second actor whose concurrent
edit could be silently lost, so a coarse timestamp comparison is sufficient and
no merge or vector-clock machinery is warranted.

The NDJSON snapshot carries **only** the folder header and its file/analysis
records. It does **not** carry `tag_aliases` or `drive_runs` rows; those live
solely in the global index. Recovery caveat: rebuilding the index purely from
snapshots restores files, analyses, and tags but not tag-alias mappings or
drive-run bookkeeping, which are re-derived by re-running rather than restored.

### (e) Privacy stance for the future faces feature

The faces feature is now implemented. Face embeddings and labels are: computed
and stored **100% locally** (in the global index, never sent anywhere,
consistent with the default-OFF telemetry of `docs/architecture.md` Delta 6);
**opt-in**; individually **deletable**; and **excluded from the NDJSON snapshot
and every export/interchange path**. Faces data never leaves the machine and
never travels with a drive.

Deletion is real: `forgetPerson` (`adapters/db/global-catalog.ts`) **deletes**
the person's `face_observations` rows — embeddings and bounding boxes included —
together with the person row and its exemplar crops, so a "forget" removes the
biometric data rather than leaving it as unassigned observations that could
re-cluster. `purgeFaces` clears all people and observations.

### (f) Read-only folders run in degraded index-only mode

A read-only source folder (a chmod -w directory, a write-protected or
foreign-owned external drive) must still be catalogable: the global index is the
canonical store, so nothing about a drive pass needs the folder to be writable.
Every write into the folder is therefore optional and degrades instead of
failing the pass.

- **Catalog open never writes eagerly.** `openSqlJsDatabase`
  (`adapters/db/sql-js.ts`) does not create `{folder}/.ai-video-cataloger/` and
  does not persist an empty database as a side effect of opening. It loads the
  bytes of an existing `catalog.db` when one is there, starts empty when not,
  and treats an `EACCES`/`EROFS`/`EPERM` on the write probe as **degraded**: the
  repository stays in memory for the process lifetime and every later persist is
  a no-op rather than a throw. `CatalogRepository.writable()`
  (`core/server/ports.ts`) exposes that state so use-cases can branch on it
  instead of discovering it through an exception. Writability is decided once per
  folder, at open, and cached with the repository.
- **Identity.** With no marker file writable, `resolveFolderIdentity`
  (`core/server/usecases/folder-identity.ts`) falls back to the deterministic
  path-derived id `path-<fnv1a32-hex>`, which is stable for as long as the folder
  keeps its path.
- **Artifacts mirror into the home scope.** Frames, transcripts, summaries, the
  analyzer debug log, and thumbnails are written to
  `~/.ai-video-cataloger/read-only-folders/{folderId}/` — the same
  `frames/`, `transcripts/`, `summaries/`, `thumbnails/` layout the folder would
  have carried, under the home scope this ADR already owns. `ArtifactRoot`
  (`core/server/usecases/artifact-root.ts`) is the single seam: the write path
  picks the folder root or the mirror from `CatalogRepository.writable()`; read
  paths with no repository handle (search thumbnails, the `thumbnail` command)
  discover it from the folder — marker present means in-folder, otherwise the
  mirror if it exists.
- **Renaming is off.** Files on a read-only folder cannot be renamed, so
  degraded mode forces `skip_rename`; the run is index-only by construction.
- **Snapshot skipped, index written.** The NDJSON snapshot of §(a) cannot be
  written, so it is skipped per file with a `catalog_snapshot_skipped` warning
  event and a `snapshotSkipped` count on the drive-run summary. The analysis
  itself still lands in the global index, which is what makes the folder
  searchable.

Consequences: a read-only folder whose path changes (remount at another mount
point) gets a new `folderId` and a new mirror directory, because there is no
marker to ride inside it — the derived artifacts are re-created, but the
analyses are not recomputed, since resume is keyed by content fingerprint in the
global index (§c). The mirror is derived data with the same standing as the
in-folder `frames/`/`summaries/` directories: deleting it costs re-extraction,
never catalog rows. Two distinct read-only folders whose paths collide under
FNV-1a would share a mirror; the window is a 32-bit hash over a personal
machine's folder paths, and the failure mode is mixed derived artifacts, not
mixed catalog rows.

## Alternatives considered

- **Central-DB-only (global index, no per-folder snapshot).** Rejected: no
  portability — a drive carried to another machine arrives with no catalog; and
  no recovery path if the single index is lost or corrupted. The snapshot is the
  backup and the interchange unit.
- **Sidecar-canonical (per-folder DB is truth; status quo of Delta 3).**
  Rejected: does not scale to whole-drive search (linear open of many DBs), does
  not support offline-drive search, forces GUI/CLI reconciliation across
  divergent sidecars, and gives full-text search and embeddings no single DB to index.

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
- Backward compatibility: there is **no one-time legacy importer**. Existing
  per-folder `catalog.db` files are not read into the global index by a dedicated
  migration; legacy folders are absorbed lazily when they are re-processed or the
  index is rebuilt (fingerprints re-derived, snapshots imported on first sight of
  an unknown `folderId`).
- The single global index is the new single point of failure; the per-folder
  NDJSON snapshots are its recovery source, so snapshot writes must be durable
  (written atomically via temp-file + rename) and follow catalog mutations. The
  snapshot omits `tag_aliases`/`drive_runs` (see (d)), so recovery from snapshots
  alone does not restore those.
- Search (FTS4) and the faces feature are built on one indexed store without a
  further storage-model decision.

Changing this decision means editing this ADR and `docs/architecture.md`
Delta 3 first, then the code.
