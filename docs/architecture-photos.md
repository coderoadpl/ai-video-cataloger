# Architecture delta — Photos catalog

Delta against [`docs/architecture.md`](../../ai-video-cataloger/docs/architecture.md)
(which is itself a delta on the agentproofarch foundation). Everything not
overridden here applies verbatim: layer discipline, contract-as-only-bridge,
`Result<T, AppError>`, closed `ErrorCode` taxonomy, jobs/NDJSON/exit codes,
path canonicalization (NFC at the three seams, `canonicalPath` only), the
renderer architecture, the two gates.

Companion PRD: `prd-photos.md`. The original owner constraints established a
separate photos DB, shared machinery, no file mutation in v1 and content hash
as the join key. The 2026-08-15 owner decision supersedes the separate Library
Photos tab: Kolekcja is the single analyzed-only browse surface, while scanned
but unanalyzed photos remain reachable only in Analysis → Zdjęcia.

Revision 2 (2026-07-30): incorporates the design-challenge review
(`design-challenge.md`). Every accepted/rebutted finding is recorded in the
**Decisions log** at the end; sections below are already rewritten to the
final design.

## 1. The photos database

`~/.ai-video-cataloger/photos.db` — same driver stack as the catalog
(drizzle over sql.js behind a repository port), opened by the same
composition roots.

Why separate (beyond the owner decision): the video `files` table is shaped
by processing-run semantics (`processed_at NOT NULL`, duration, rename
lifecycle) that photos do not have; separation lets the photo schema be
honest instead of nullable-everything, keeps the 65k-row photo workload out
of every video query plan, and makes "delete my photo index" a file deletion.

### 1a. Persistence strategy (sql.js at 50k rows) — DECIDED

sql.js persists by serializing the **whole database** to disk
(`persistDatabase` → `client.export()`, `adapters/db/global-catalog.ts`), and
the catalog store auto-flushes every 25 mutations
(`AUTO_FLUSH_MUTATION_COUNT`). Copied verbatim, a 50k-photo scan would
perform ~2 000 full-file rewrites — unacceptable write amplification
(challenge B1). The decision:

- **Keep sql.js.** A native driver (better-sqlite3) reopens the darwin-arm64
  packaging problem this app deliberately avoided; an external NDJSON
  checkpoint file creates a second source of truth. Both rejected.
- **Checkpointing is per batch, not per file.** The photos store exposes an
  explicit batch-write API: pipeline use-cases group work into **batches of
  500 files**, mutate in memory, and trigger exactly **one persist per
  batch** (plus one final persist). The per-25-mutations auto-flush does not
  apply inside a batch. Resume granularity is therefore the batch: an
  interrupted scan repeats at most the current batch's work — and the scan
  fast path (§ scan, size+mtime match) makes repeating a batch nearly free.
- Envelope: photos.db carries no blobs (embeddings live in `catalog.db`,
  proxies on disk); 50k rows ≈ tens of MB, ~100 persists per full scan ≈
  single-digit GB written per full-library scan. Acceptable.
- Interactive single-row writes (e.g. `variants select`, later waves) keep
  the catalog's auto-flush behaviour.

The PRD's resumability AC (Story 5.1) is rewritten to match: *checkpoint per
batch of 500, resume repeats at most one batch*.

**Wave 5 amendment — the batch is the unit of *cheap* work only.** Repeating a
scan batch is nearly free (the size+mtime fast path), but repeating 500 paid
vision calls or 500 RAW decodes is not. `PhotosStore.checkpoint()` persists
in place without ending the batch or releasing the write lock, and the
pipelines call it where the work is irreplaceable: after every analyzer batch
(≤12 photos) in `runPhotoProcess`, and every 50 generated proxies in
`runPhotoProxiesPass`. The store batch structure, the NDJSON contract and the
scan cadence are unchanged.

### 1c. Root-scope query plans at 50k — MEASURED, DECIDED

`scopeForRoot`'s `current_path` range **OR** an `EXISTS` over `photo_paths`
plans as `SCAN photos`, and that is deliberate. Measured on 50 000 photos in
sql.js: rewriting the `EXISTS` into a non-correlated `IN (SELECT … FROM
photo_paths …)` does yield an index-only `MULTI-INDEX OR` plan, and it wins
hard when the root is a small slice of a big library (1 000 of 50 000: 2 ms vs
38 ms for `photos status`) — but it loses just as hard in the common
single-root case where the scope *is* the library (44 ms vs 7 ms for status,
46 ms vs 1.3 ms for a grid page, because the scan short-circuits on `LIMIT`).
Both forms sit inside the PRD's 100 ms target, so the common case keeps the
scan.

What Wave 5 does change: schema V2 adds `idx_photos_current_path` and
`idx_photos_proxy_state_path` (replacing `idx_photos_proxy_state`, whose key
is a prefix of it), which removes the 50 000-row temp B-tree sort from both
candidate listings, and `listSightingsUnderRoot` stops reading every path row
in the database into JS and uses the `idx_photo_paths_path` range instead.
`adapters/db/photos-store-scale.test.ts` pins all of it with
`EXPLAIN QUERY PLAN`, not with a stopwatch.

### 1b. Locking — shared home-lock owner — DECIDED

The advisory `catalog.lock` currently lives inside
`SqlJsGlobalCatalogStore` as **instance** state: `heldLock` + `leaseCount`
per store object, and `releaseWriteLock()` unlinks the lock file when *that
instance's* lease count reaches zero (`adapters/db/global-catalog.ts`,
`takeWriteLock`/`releaseWriteLock`). Same-pid re-entry is adopted (EEXIST →
`existing.pid === process.pid` → adopt), so a second store in the same
process adopts the same lock file — and then unlinks it on its own release
while the first store still holds leases. Two stores sharing one lock file
with per-instance lease counters is a confirmed corruption path (challenge
B4).

Decision: **one process-wide lock owner, shared by injection.** A
`HomeLock` object (extracted from the current private lock methods into
`adapters/db/home-lock.ts`) owns `lockPath`, `heldLock`, the exit handler
and a **single lease counter**; both `SqlJsGlobalCatalogStore` and
`SqlJsPhotosStore` receive the same instance from the composition root and
delegate `takeWriteLock` / `acquireLease` / `releaseLease` /
`releaseWriteLock` / `snapshot` to it. The file is unlinked only when the
*global* lease count is zero. Two lock files with an acquisition order were
rejected: they add deadlock orderings for zero benefit when both stores live
in the same process by construction. External-process semantics are
unchanged (same lock file, same stale-takeover rules).

This ships in Wave 1, because both stores exist in every composed process
from Wave 1 on.

### Schema v1 (`adapters/db/photos-schema.ts`)

```sql
CREATE TABLE schema_meta (version INTEGER PRIMARY KEY);

CREATE TABLE photo_folders (
  folder_id     TEXT PRIMARY KEY,        -- same derivedFolderId convention (hash of canonical path)
  current_path  TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  default_config_id TEXT
);

CREATE TABLE photos (
  fingerprint   TEXT PRIMARY KEY,        -- ph_<16hex>, see §2
  folder_id     TEXT NOT NULL,           -- OWNER folder = folder of current_path (see Duplicates)
  file_name     TEXT NOT NULL,
  current_path  TEXT NOT NULL,           -- canonical NFC; attribute, not identity
  ext           TEXT NOT NULL,           -- closed union: jpg|jpeg|png|heic|arw|dng
  size          INTEGER NOT NULL,
  width         INTEGER, height INTEGER, orientation INTEGER,
  camera_make   TEXT, camera_model TEXT, lens TEXT,
  iso           INTEGER, f_number REAL, exposure_time REAL,
  exif_rating   INTEGER,                 -- stored + shown; never searched, never written back
  captured_at   TEXT,                    -- UTC
  captured_at_source TEXT,               -- exif_offset|exif_gps_time|exif_local_assumed|file_mtime
  gps_lat REAL, gps_lon REAL,
  gps_source TEXT, gps_accuracy_m REAL, gps_interval_kind TEXT, gps_resolved_at TEXT,
  place_name TEXT, place_region TEXT, place_country TEXT,
  place_country_code TEXT, place_distance_m REAL, place_dataset TEXT,
  discovered_at TEXT NOT NULL,
  exif_read_at  TEXT,
  proxy_state   TEXT NOT NULL DEFAULT 'pending',  -- pending|done|failed|not_needed
  proxy_width   INTEGER, proxy_height INTEGER,    -- recorded at proxy time; bbox mapping needs them
  thumb_state   TEXT NOT NULL DEFAULT 'pending',  -- pending|done|failed
  missing_at    INTEGER,                 -- epoch ms; set when NO sighting of the content remains
  selected_config_id TEXT
);
CREATE INDEX idx_photos_folder      ON photos(folder_id);
CREATE INDEX idx_photos_captured_at ON photos(captured_at);
CREATE INDEX idx_photos_proxy_state ON photos(proxy_state);

CREATE TABLE photo_paths (               -- every sighting of the content, incl. current_path
  fingerprint  TEXT NOT NULL,
  current_path TEXT NOT NULL,
  folder_id    TEXT NOT NULL,
  size         INTEGER NOT NULL,         -- with mtime_ms: the re-scan fast path (skip re-hash)
  mtime_ms     REAL NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (fingerprint, current_path)
);
CREATE INDEX idx_photo_paths_folder ON photo_paths(folder_id);
CREATE INDEX idx_photo_paths_path   ON photo_paths(current_path);

CREATE TABLE photo_analysis_configs (    -- same shape as analysis_configs
  config_id TEXT PRIMARY KEY, descriptor_json TEXT, label TEXT NOT NULL,
  first_seen_at TEXT NOT NULL, last_used_at TEXT NOT NULL
);

CREATE TABLE photo_analyses (            -- variants, same key discipline as video
  fingerprint TEXT NOT NULL, config_id TEXT NOT NULL,
  description TEXT, scene TEXT, quality TEXT,   -- scene/quality: closed unions from the prompt contract
  language TEXT, analyzer TEXT, model TEXT,
  batch_size INTEGER,                    -- provenance: ACTUAL batch size this row was produced at (§4)
  created_at TEXT NOT NULL, usage_json TEXT,
  PRIMARY KEY (fingerprint, config_id)
);
CREATE INDEX idx_photo_analyses_config ON photo_analyses(config_id);

CREATE TABLE photo_tags (tag_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE photo_tag_aliases (alias TEXT PRIMARY KEY, tag_id INTEGER NOT NULL);
CREATE TABLE photo_file_tags (
  fingerprint TEXT NOT NULL, config_id TEXT NOT NULL, tag_id INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, config_id, tag_id)
);

CREATE TABLE photo_search_documents (
  docid INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL, description TEXT NOT NULL,
  tags_text TEXT NOT NULL, place TEXT NOT NULL DEFAULT ''
);
CREATE VIRTUAL TABLE photo_search_documents_fts USING fts4(
  content="photo_search_documents",
  file_name, description, tags_text, place, tokenize=unicode61);

CREATE TABLE photo_runs (                -- resumable pipeline runs, drive_runs analogue
  run_id TEXT PRIMARY KEY, root TEXT NOT NULL, stage TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT,
  files_total INTEGER NOT NULL, files_done INTEGER NOT NULL,
  files_skipped INTEGER NOT NULL, files_failed INTEGER NOT NULL,
  last_activity_at TEXT NOT NULL, batch_json TEXT
);

CREATE TABLE photo_face_index_state (    -- per-photo faces completion (see §5)
  fingerprint TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL, engine_version INTEGER NOT NULL
);
CREATE INDEX idx_photo_face_index_engine ON photo_face_index_state(engine_version);
```

**Indexes are part of the schema, in v1** (challenge B2 — the video catalog
declares none anywhere and gets away with it at a few thousand rows; 50k
photos with per-day grouping and per-folder filtering does not). Adding one
later is a migration; declaring them now is free. A schema test asserts
their presence in `sqlite_master` so a refactor cannot drop them silently.

**No `ON DELETE CASCADE` / FK clauses.** SQLite ships with
`PRAGMA foreign_keys = OFF` and nothing in this codebase enables it (the
only pragma ever set is `defer_foreign_keys` inside the V9 migration), so
declared cascades would be documentation pretending to be behaviour
(challenge C5). Deletion is **explicit and ordered in the store**, exactly
as the catalog does today (`forgetEntry`): children first
(`photo_face_index_state`, `photo_file_tags`, `photo_analyses`,
`photo_search_documents` + FTS, `photo_paths`), then the `photos` row, then
the on-disk artifacts (§3).

Migration/versioning from day one: `schema_meta` starts at 1 and the store
adapter carries the same `createPhotosSchemaSqlV1` / `migratePhotosSchemaSqlVn`
ladder pattern as `global-catalog-schema.ts` — the first shipped wave already
runs the migrator on open, so v2 is an append, never a rework. No `legacy`
sentinel exists here: there is no pre-variant photo data, so
`photo_analyses` is variant-keyed from birth.

Selected-variant resolution is the video rule verbatim: explicit
`selected_config_id` > folder default > newest by `created_at` with
`config_id` tiebreak. Search indexes the resolved variant only.

### Duplicates — ownership rules (DECIDED, challenge C1)

PHOTO LIBRA showed the same content at many paths is the norm (SD card +
Lightroom + backup). One row per fingerprint; `photo_paths` records every
sighting. The previously-undefined cases are now defined:

1. **Owner folder.** `photos.folder_id`/`current_path` name the **owner
   sighting**: the first-seen path, re-pointed automatically (newest
   surviving sighting by `last_seen_at`, path as tiebreak) whenever the
   owner path disappears at re-scan or via `forget`.
2. **Folder-default variant resolution uses the owner folder only.** A
   fingerprint sighted in folders A and B resolves through A's default iff A
   owns it. Deterministic, cheap, and the detail pane shows which folder is
   the owner.
3. **`photos forget <root>`** deletes all sightings under `root`. For each
   affected fingerprint: if sightings survive elsewhere → re-point owner per
   rule 1, keep the row and all enrichment; if none survive → delete the row
   (explicit-order delete above), its artifacts, and — once Wave 4 exists —
   its `face_observations` in `catalog.db` (same app-level delete `faces
   forget` performs today).
4. **Counts.** `photos status` reports **both** numbers, named honestly:
   `photos` (unique fingerprints) and `paths` (sightings — the Finder
   number). The grid shows unique photos with a duplicate badge; the detail
   pane lists all paths. A root scope selects every fingerprint sighted under
   that root **plus** every photo whose owner path is under it, so a photo
   whose last sighting vanished still reports as `missing` there instead of
   disappearing from its own root's counts.
5. **Edited in place.** A path whose content changed carries a new
   fingerprint. The sighting under the old fingerprint is deleted as the new
   one is written — one path is never two sightings — and the superseded
   fingerprint goes through the same reconcile pass as a vanished path:
   re-pointed to a surviving duplicate, or kept and marked `missing_at`.
6. **Artifact ownership** is dissolved entirely by §3: artifacts are
   fingerprint-addressed in a single home root, so no folder owns them and
   forgetting a folder never orphans another folder's proxy.

## 2. Photo fingerprint

`ph_` + first 16 hex of SHA-256 over the **full file contents**.

Decisions and rationale:

- **Full-content, not `partialContentHash`.** Video uses size + first/last
  1MB (`adapters/fs/index.ts`) because videos are GB-scale. Photos are
  2–60MB; a full read is roughly the cost of the EXIF read we do anyway, and
  it removes the one real collision risk photos have that videos don't:
  burst-mode RAWs from the same camera share byte-identical headers and
  near-identical sizes, exactly the region a partial hash samples. PHOTO
  LIBRA's md5-of-full-content joined 65k files across three reorganizations
  without one collision or one orphan — that property is worth the read.
- **SHA-256/16hex, not md5** — consistency with the app's existing hashing
  vocabulary (`core/domain/sha256.ts`, configIds, folder ids); md5 in the
  reference scripts was incidental. The PHOTO LIBRA manifests are reference
  material only, never imported, so there is no md5-compat constraint.
- **`ph_` prefix** — photo fingerprints appear in shared spaces (the
  faces identity store §5, `faces/obs/<fingerprint>/` crop directories,
  NDJSON events). The prefix makes the media kind self-evident, guarantees a
  photo can never collide with a 16-hex video fingerprint, and gives future
  tooling a free discriminator. Videos keep their existing unprefixed form —
  their fingerprints are persisted history.
- Implementation: `FileSystemPort` gains `fullContentHash(path)` (streamed,
  second implementation in the test fake `test/server/usecases/test-fakes.ts`
  — the port rule is satisfied by the same pair that satisfies it today).

## 3. Artifact layout — home-root, fingerprint-addressed (REVISED)

**Deviation from ADR-0002, deliberate:** photo artifacts never live in a
sidecar tree inside the photo folder. All of them live under one home root:

```
~/.ai-video-cataloger/photo-artifacts/
  proxies/{fingerprint}.jpg            # long edge ≤1280, quality ~82
  thumbs/{fingerprint}.jpg             # long edge ≤320
  thumbs/{fingerprint}.grid.jpg        # 512 square, center-cropped, frame-first (proxy-derived)
  variants/{fingerprint}/{configId}/analysis.json
```

`thumbs/{fingerprint}.grid.jpg` is the photo half of the video/photo-shared
grid-thumbnail feature (`docs/architecture.md`, "Grid thumbnails"): the same
`GRID_THUMBNAIL_EDGE` (512) square cover generated via
`MediaPort.thumbnailFromFrame({ fit: 'cover' })` reading the already-written
proxy — one implementation of "square center-crop" shared with videos, zero
changes to `PhotoMediaPort`/sips. `runPhotoProxiesPass` generates it
best-effort right after a proxy lands `done` (a grid failure is counted in
the pass summary's `gridFailed` and never flips `proxyState`/`thumbState`);
a new `photos grid-thumbs` job/route (`POST /api/photos/grid-thumbs`, job
kind `photo_grid_thumbs`) walks `photo-artifacts/proxies/*.jpg` and
backfills the grid sibling for every fingerprint found, independent of any
particular root. `photosList`/`photosDetail`/`photosSearch` resolve
`gridThumbPath` the same way they resolve `thumbPath` — an `fs.exists`
check, no new state column.

Three reasons, in order of force (challenge B3 + C1):

1. **`media://` scope stays one root.** The protocol handler admits paths
   only under the current *video* folder, the faces root, and
   `read-only-folders/{id}` children derived from the **video** catalog
   (`apps/desktop/src/media-scope.ts`, `apps/desktop/src/main.ts`). Sidecar
   photo proxies would be unreachable, and per-photo-folder widening would
   make every browsed photo folder a renderer-readable filesystem root. One
   static home root means `MediaProtocolDeps` grows exactly one entry
   (`photoArtifactsRoot`, alongside the existing faces root) in Wave 2 — no
   dynamic folder wiring, no widened surface.
2. **Duplicate ownership dissolves.** Content-addressed by fingerprint →
   one proxy regardless of how many folders sight the content, and
   forgetting any folder never deletes another folder's artifact (§1
   Duplicates rule 5).
3. **v1 writes literally nothing inside a photo folder.** The PRD's safety
   promise ("no photo file is opened for write") strengthens to "no write
   under the photo root at all" — trivially testable with a read-only
   fixture, and photos on read-only SD cards are a primary use case anyway.

Regenerating is idempotent; deletion happens only in the explicit-order
forget path. No name-based projection exists for photos (that machinery
exists for video because the old app's users script against
`summaries/{name}`; photos have no such contract and never rename, so the
projection would be dead weight).

**Proxy pipeline** (`PhotoMediaPort`, Wave 2): for ARW/DNG, extract the
embedded JPEG preview (~1280–1616px in Sony ARW — the PHOTO LIBRA-proven
cheap path) by TIFF/IFD parse; fall back to full RAW decode via
`/usr/bin/sips` (present on every macOS; darwin-only is already this
product's platform per the onnx faces binding and Keychain). JPEG/HEIC/PNG:
decode + downscale (sips). `ExifPort` (metadata) is a separate pure-JS
parser adapter — no exiftool, no Homebrew assumption; both ports get
in-memory fakes for the gates, and the real-provider legs live in the e2e
matrix with a real ARW fixture.

The renderer never receives an original RAW/HEIC: `media://` serves the
proxy/thumb artifacts (~300KB JPEGs, comfortably inside the
extension-allowlist and 20MB cap). Originals stream only for jpg/png "view
original", and only when the owning folder is reachable under the existing
scope rules. `ALLOWED_EXTENSIONS` (`media-scope.ts`) stays as-is — no
`.heic`/`.arw` is ever served.

## 4. Analyzer input, prompt identity, batching

**Input shape**: one photo = one proxy image. No 3-frames mosaic — the video
prompt's frame triplet models time, which a still doesn't have. `AnalyzeInput`
is not reused; a sibling `AnalyzePhotosInput` goes through the same
`AnalyzerPort` implementations:

```ts
interface AnalyzePhotosInput {
  batch: { fingerprint: string; proxyPath: string }[];  // 1..N
  outputLanguage; tagLanguage; provider; timeoutSeconds; signal; verbose;
}
// → Result<{ perPhoto: { fingerprint; rawResponse }[]; usage? }, AppError>
```

**Prompt**: a photo-specific template (description ≤2 sentences, tags,
`scene` and `quality` closed unions — the shape PHOTO LIBRA's describe-run
proved parseable at scale) with its own `photoPromptVersion` integer —
a constant in the photo prompt module, bumped by hand like the video one;
it is **not** a `ConfigKey`.

**Identity**: a **photo config descriptor** — closed zod schema, distinct
from the video descriptor: `{ kind: 'photo', family, providerId,
model/modelTag/maxImageDetail/promptStyle/reasoningEffort per family,
output_language, tag_language?, photoPromptVersion }`. No whisper fields, no
`frames`. Hashed with the same `canonicalJson` + `cfg_<12hex>` scheme; the
`kind` discriminator guarantees a photo config and a video config never
share an id even for the same provider. **The video descriptor
(`configDescriptorShape`, `.strict()`, no `kind`) is untouched** — adding
`kind: 'video'` to it would rehash every existing `cfg_` id (challenge C4).
Stored in `photo_analysis_configs`; the two config spaces never mix because
the two DBs never mix.

**One config namespace (DECIDED, challenge C3).** v1 photos read the **same**
stored config values as video (`CONFIG_IDENTITY_CLASSIFICATION` /
`ConfigKey` are a closed shared space): the analyzer family, provider,
model and languages you configured for video are what photos use, resolved
flag > folder > home > default. Per-media provider overrides ("cheap local
for photos, API for video") are a v2 config-schema change, not smuggled in
now. Batch size is a **pipeline constant (default 12, per-family clamps)
overridable by the CLI flag `--batch-size`**, never a `ConfigKey`, never
stored.

**Batching** (the economics lesson: ~100 photos/min in batches of 12 vs
per-file calls):

- Batch size is **excluded from config identity** — but honestly this time
  (challenge B6): the `gemini_batch_mode` analogy is wrong (that knob
  changes delivery of an identical prompt; batch size changes the prompt —
  12 images share one context window). The design therefore states plainly:
  **photo descriptions are not byte-reproducible across batch sizes**, and
  the **actual** batch size each row was produced at is recorded as
  provenance in `photo_analyses.batch_size` — including rows produced by
  split-retries (a 12→6→1 cascade writes 1, not 12). What the config id
  asserts is the semantic contract (model, prompt, languages), not byte
  equality.
- Response contract: one JSON array, each element carrying an `index` echo;
  the parser zod-validates per element. A malformed array or count mismatch
  **splits the batch** (12 → 6+6 → … → singles) before any photo is marked
  failed; a single-photo failure is that photo's failure. NDJSON stays
  per-photo (`photo_started`/`photo_completed`), so scripts never see
  batching.
- `AnalyzerBatchPort` (Gemini Batch API, half price) applies to photo runs
  exactly as to drive runs: `photo_runs.batch_json` holds the job mapping for
  re-attach. Batch-API delivery for photo runs is deferred past Wave 3;
  `photo_runs.batch_json` stays null until then.

**Budget (challenge B8).** The monthly budget guard is currently private to
`core/server/usecases/process-drive.ts` (`geminiMonthlyBudget`,
`pauseForBudget`). A 50k-photo run is the largest spend event this product
can produce; Wave 3 **extracts the guard into shared use-case code** and the
photo pipeline honours it with identical pause/resume semantics and NDJSON
events. "Photos are uncapped" was rejected.

## 5. Faces: shared identity — DECIDED

**Decision: one identity pool. People and face observations for photos live
in the existing global `catalog.db` tables (`people`, `face_observations`),
not in `photos.db`.** The same person on a video and on a photo is one
`person_id`, one display name, one exemplar set.

Weighed honestly:

- *For per-DB separation*: cleaner ownership, no cross-DB migration.
  Rejected because it makes the stated goal structurally impossible — two
  person spaces can only be reconciled by a cross-DB matching layer that is
  clustering re-implemented badly (`clusterFaceObservations`,
  `core/domain/faces.ts`, is a greedy single-pass assigner; two pools would
  be two different algorithms' outputs), and every People-UI operation
  (name, merge, forget) would need a twin.
- *For a third shared identity DB*: symmetric, but migrating the existing
  `people`/`face_observations` out of `catalog.db` breaks ADR-0011/12/14
  invariants, existing catalogs, and `faces recluster` for zero user-visible
  gain. Rejected.
- *Chosen*: `catalog.db` already **is** the catalog-global identity store
  ("face identity is catalog-global", Delta 5). Photos join it. The
  embeddings are comparable by construction — same engine, same
  `FACE_ENGINE_VERSION`, same thresholds, and PHOTO LIBRA ran this exact
  engine over stills successfully. `faces recluster` (ADR-0012) then rebuilds
  people from the union pool with zero new mechanism.

Mechanics:

- `catalog.db` migration **V11** is a **single statement** (challenge C5):
  `ALTER TABLE face_observations ADD COLUMN media TEXT NOT NULL DEFAULT
  'video'`. The declared `files(fingerprint)` FK stays in place as inert
  text — `PRAGMA foreign_keys` is never enabled in this codebase, so it has
  never fired, and a full-table rebuild to drop an unenforced constraint
  would be pure risk. App-level deletes (`faces forget/purge`,
  `deleteFaceObservationsForFile`) already do the real work.
  `ph_`-prefixed fingerprints make provenance auditable even without the
  column; the column exists for query planning and honest UI counts.
  **V11 ships in Wave 1** with its lossless-migration probe — the riskiest
  change lands first, smallest, validated before any photo investment
  (challenge D3).
- Photo observations: detector runs on the **proxy** (PHOTO LIBRA-proven
  sufficient at 1280px); `frame_ts_s` is NULL; **obsIds use frame index 1**
  — `parseFaceObsId` (`core/domain/faces.ts`) requires
  `<fingerprint>:face:<frameIndex>:<detectionIndex>` with indices matching
  `/^[1-9][0-9]*$/`, so index 0 would silently break exemplar backfill and
  crop-path resolution (challenge C2). Bbox is proxy-space with the proxy
  dimensions recorded in `bbox_json` (and in `photos.proxy_width/height`);
  crops under `faces/obs/ph_<hex>/` per ADR-0014.
- Per-photo completion state lives in `photos.db`
  (`photo_face_index_state`) so the photos pipeline owns its own progress;
  the identity data itself is never split.
- `faces index` covers both media; `photos process` auto-chains the faces
  pass best-effort exactly like `process-drive` (ADR-0011 semantics:
  skip event, never a failed run). Exemplar selection (read-time, pure
  function) now naturally mixes media — a person's best crops may be photos.
- **Mutual exclusion**: every job that writes `people`/`face_observations`
  (faces index legs — video and photo — and `faces_recluster`) declares the
  same `resourceKey: 'faces-write'` so the `JobsPort` serializes them; a
  recluster can never rebuild people while a photo faces pass inserts
  observations (challenge C6).
- No AI naming. The People feature stays the only naming surface.

## 6. GPS and places

Reuse, not duplication: the timeline parser (`core/domain/timeline.ts`), the
precedence rule (`manual > camera > timeline`; a probe that finds nothing
never erases), the provenance columns, and the offline `PlacesPort` are
shared code paths; the photo backfill use-case writes through a
`PhotosStore.applyGeoBackfill` that re-checks precedence in-transaction,
mirroring `GlobalCatalogStore.applyGeoBackfill`. EXIF GPS lands at scan time
as `gps_source='camera'` — photos are *better* timeline subjects than video
(EXIF capture instants are denser and more precise), which is why
`captured_at_source` distinguishes `exif_local_assumed`: the backfill widens
its match tolerance for assumed-timezone instants instead of trusting them
blindly.

Map: `listLocations()` grows a photos counterpart in the photos store; the
route merges both with a `media` discriminator; the map island core is
geometry-only and needs no change beyond a marker kind.

**Wave 4b implementation notes (as shipped):**

- Tolerance widening is exact: `toleranceMs = max(input.toleranceMinutes, 180)
  * 60_000` applies only to `capturedAtSource` in
  `{'exif_local_assumed', 'file_mtime'}`; precise sources
  (`exif_offset`, `exif_gps_time`) always use the flag value unmodified. The
  pass summary's `assumedWidened` counter increments only for a photo whose
  widened tolerance differed from the flag value *and* which matched — it is
  not a count of every assumed-timezone photo considered.
- No GUI flow for the photo backfill either — CLI (`avc photos gps backfill
  <timeline.json>`) and route (`POST /api/photos/gps/backfill`) only, mirroring
  the video backfill's own GUI-less precedent (§7).
- `GET /api/catalog/locations` merge shape: `totalFiles`/`locatedFiles` keep
  their video-only meaning; `totalPhotos`/`locatedPhotos` are new,
  independent counters (photo-only); `locations` interleaves both media
  (video rows first, each list internally ordered by fingerprint), each
  entry carrying `media: 'video' | 'photo'` (defaulted `'video'` so a
  pre-4b envelope still parses) and — for photo rows only — a nullable
  `thumbPath` resolved through the same `photoThumbPath` convention the
  photo catalog already uses, so the map's photo pin popover can show a
  thumbnail without a cross-feature import into `features/photos/`.

## 7. Contract, CLI, jobs

- **Routes** (all zod, all in `core/contract/routes.ts`):
  `POST /api/photos/scan|proxies|grid-thumbs|process|gps/backfill` → job envelope;
  `GET /api/photos/status|search|tree|detail|locations`;
  `POST /api/photos/forget`; variants:
  `GET /api/photos/variants`, `POST /api/photos/variants/select|delete|folder-default`.
  Faces routes stay `/api/faces/*` (shared identity, shared surface).
  `GET /api/library/collection` (`docs/architecture.md`, "Library collection
  feed") is the one video+photo merge route; it reads photos through a new
  `PhotosStore.collectionPage` port method, not through `photosSearch` or a
  new photo-only route.
- **Job results are discriminated (challenge B5).** `jobResultSchema` is an
  untagged `z.union` of stripping object schemas — first-success wins, so a
  photo summary sharing keys with `gpsBackfillSummarySchema` or
  `thumbnailsSummarySchema` would be parsed as the video variant and its
  photo counters silently dropped. Every photo job result schema therefore
  carries a **required literal `media: z.literal('photo')`** (no existing
  member has a `media` key, so no existing schema can absorb it), photo
  members are placed **before** the absorbing candidates in the union, and
  a dedicated test round-trips every photo result sample through
  `jobResultSchema` asserting deep equality and asserting every non-photo
  member rejects the sample. Migrating the whole union to
  `z.discriminatedUnion` was rejected: the twelve existing members share no
  discriminator key, and adding one would change public envelope shapes for
  every existing job.
- **CLI**: `avc photos scan|status|proxies|process|search|forget|variants …`,
  `avc photos gps backfill <timeline.json>` — commander sub-tree in
  `apps/cli/src/main.ts`, NDJSON events named `photos_*`, same taxonomy exit
  codes. `faces index` silently gains photo coverage (CHANGELOG line).
  `--tolerance-minutes`/`--max-visit-hours` default to **30/36**, mirroring
  the video `gps backfill` command's actual flag defaults byte-for-byte
  (the wave 4b spec's draft default of 90 minutes was never the video CLI's
  real default and was not carried over).
- **Jobs**: `photo_scan`, `photo_proxies`, `photo_grid_thumbs`, `photo_process`
  on the existing in-process `JobsPort`, with **resource keys** per the
  established convention (`faces-index:${root}`, `thumbnails:${root}`):
  `photo-scan:${root}`, `photo-proxies:${root}`, `photo-process:${root}`,
  and the root-independent `photo-grid-thumbs` (the backfill walks
  `photo-artifacts/proxies/*.jpg` directly, not a scanned root) —
  plus `'faces-write'` on every faces-writing leg (§5). `photo_runs`
  provides drive-run-style resumability at **batch granularity** (§1a);
  progress polled via the existing job routes. Long photo jobs are
  cancellable through the existing `JobsPort.cancel` — the PRD carries an
  explicit cancellation AC.
- **No new `ErrorCode` members (challenge B7).** The taxonomy
  (`core/domain/errors.ts`) is media-agnostic; photos reuse
  `invalid_file_type`, `thumbnail_error`, `read_error`, `processing_error`,
  `not_a_directory`, `folder_not_found` etc. Photo specificity lives where
  it is free: NDJSON **progress step / warning event names**
  (`photo-exif-failed`, `photo-proxy-failed` as per-file warning steps), not
  in three public-contract expansions (HTTP map + exit map + legacy map,
  all compiler-exhaustive) that no caller would branch on.
- **Analysis scope, revised (W56).** `POST /api/photos/process`'s `root` is
  now **optional** and it gains an optional `fingerprints: string[]`: a
  single-photo run (the detail pane's own "Analizuj") passes the photo's
  owner root plus `fingerprints: [fingerprint]`, narrowing
  `listAnalysisCandidates`' result to that one fingerprint before it enters
  the existing 12→6→1 cascade — batch-of-one needed no new batching
  machinery. Omitting `root` means "every scanned root": `runPhotoProcess`
  resolves the target list via `PhotosStore.listRoots()` and loops the
  existing per-root body (extracted as `runPhotoProcessForRoot`)
  sequentially inside **one job**, aggregating candidates/analysed/failed
  across roots into a single `PhotoProcessSummary` (`root`/`configId` turn
  nullable — an all-roots run has no single root, and folder-level analyzer
  overrides mean roots can carry different config ids). The chosen design is
  "extend the job", not "chain one job per root client-side": the abort
  check the per-root loop already had between store batches now also gates
  the loop between roots, so `JobsPort.cancel` cancels the whole run with no
  client-side chaining logic, and `photo-analysis-scanning`'s existing
  `data` bag gains `rootIndex`/`rootsTotal` so the renderer can show "root X
  of Y" without a new progress-step enum member (`jobProgressSchema.data` is
  already an open `z.record`). `resourceKey` stays `photo-process:${root}`
  per root and becomes a literal `photo-process:*all-roots*` for the
  all-roots job, so an all-roots run and a single-root run never collide.

## 8. Renderer

`features/photos/` is an independent Analysis island:
`PhotosSidebar`/`PhotosWorkspace` mount as the Analysis media toggle's
Zdjęcia face (`docs/architecture.md`'s two-mode IA delta), controlled by one
`active` flag. Island core owns sidebar ordering, selection and typed photo
records; the web binding injects bound descriptors from `api.ts`. Photo
browsing in Library belongs to `features/library/`, where Kolekcja consumes
the analyzed-only `GET /api/library/collection` union. Map photo actions route
to Kolekcja with its Zdjęcia media chip selected. Copy remains in the typed
`i18n` en/pl dictionary and thumbnails resolve through `media://`.
Boundaries plugin: `photos` obeys the same element types as existing
features — no new lint rules needed, the existing ones already fence it
(verified: wildcard feature rules in `eslint.config.js`,
`tsconfig.islands.json` glob).

The Analysis media toggle's Zdjęcia face is `PhotosSidebar` (navigation,
scope, badges, folder actions) + `PhotosWorkspace` (photo detail: proxy
preview, EXIF, provenance, description/tags, variant picker, analyze strip),
both consuming one lifted `use-photos-analysis.ts` hook instance
(`usePhotosAnalysis`; root/scope/selection
state and the analysis-only queries — `photosDetail`, `photosVariants`,
`photosStatus` — live at the route). `PhotosSidebar` shows a folder header
(root name, path), a `'folder' | 'all'` scope toggle now
owned by `PhotosScopeToolbar` (folder-level actions: Zeskanuj, Przetwórz, the
proxies-pending affordance) filling the sidebar's `toolbar` slot, and
thumbnail rows carrying badges derived from `photoBadges` (`analysed`,
`duplicate`, `proxyFailed`, `exifMissing`, `missing`) — parity with
`CatalogSidebar`/`VideoList`. With zero scanned roots it renders an honest
empty state with a scan CTA, never falling back to the video list.
`PhotosWorkspace` mounts `FacesIndexAction` at its top (unchanged
active/folder/addLine/lockReason semantics, supplied by the route via a
`topStrip` slot to keep the cross-feature import at the route composition
root, not inside `features/photos/`), shows a placeholder
(`photos-workspace-empty`) when nothing is selected, and otherwise the
selected photo's proxy preview (click reopens the existing `PhotoViewer`
overlay, prev/next following the sidebar's current item order via
`flattenOrder`/`adjacentFingerprint` over `sidebarSections`) plus
`PhotoDetailPane` with its Analysis actions and variant picker.

**Two independent analyze actions, both surfaced by `usePhotosAnalysis` (W56).**
`PhotosScopeToolbar`'s "Przetwórz" stays root-wide: under the `'folder'` scope
it targets `selectedRoot`; under `'all'` it now targets *every* scanned root
(the process request omits `root` entirely), replacing the earlier behaviour
of quietly falling back to the selected photo's owner folder. `analyzeSelectedPhoto`,
wired only to `PhotoDetailPane`'s own "Analizuj" strip inside `PhotosWorkspace`,
always scopes to the selected photo's owner root plus `fingerprints:
[selectedFingerprint]`, regardless of which scope the sidebar is in, and is
gated by its own `canAnalyzeSelectedPhoto` rather than the toolbar's `canAnalyze`.
Both actions share the same job-tracking state (`activeJobLabel`,
`analyzeProgress`, `processingFingerprints`, cancel) — only one process job
can run at a time, so there is nothing to disambiguate between them at
render time. The event handler that turns job progress into `analyzeProgress`/
`processingFingerprints` is one function (`handleAnalyzeSnapshot`) shared by
both actions; it also reads the new `rootIndex`/`rootsTotal` fields off
`photo-analysis-scanning` events to compose an honest "root X of Y —
analyzing A of B" label (`analyzeProgressAllRoots`) whenever a run spans more
than one root, and per-photo badges (`photosSidebar.badgeAnalyzing`) already
key off `processingFingerprints`, so a single-photo run reports exactly one
photo as in-flight with no separate badge plumbing.

## 9. Shared vs duplicated — the ledger

| Machinery | Verdict |
|---|---|
| Config resolution (flag > folder > home > default), credentials, providers | shared as-is (one namespace, §4) |
| Analyzer adapters (4 families), spend ledger, budget guard | shared; new `analyzePhotos` entry point per adapter; budget guard extracted in Wave 3 |
| Config-descriptor hashing (`canonicalJson`, `cfg_`) | shared helper; **separate photo descriptor schema**; video descriptor untouched |
| Faces engine, models, clustering, recluster, People UI | shared; identity store shared (§5) |
| Places dataset/port, timeline parser, precedence rule | shared |
| Jobs, NDJSON event framing, exit taxonomy | shared; error taxonomy reused, never extended for photos |
| Home lock | shared **object** (`HomeLock`), injected into both stores (§1b) |
| Path canonicalization, folder identity | shared |
| Artifact placement | **photo-specific**: home-root fingerprint-addressed (§3), deliberate ADR-0002 deviation |
| DB store, schema ladder, search FTS, tags, variants tables | **duplicated by design** in `photos.db` (owner decision; §1 rationale) |
| Thumbnail/proxy generation | photo-specific port (stills ≠ ffmpeg frames) |
| Renderer feature, search index, tab | separate (owner decision) |

Rule of thumb applied throughout: share **behavior** (engines, resolution
rules, identity conventions), separate **state** (photo rows never in the
video store) — with the single deliberate exception of face identity, where
the behavior *is* the shared state.

## 10. Import-libra — one-shot PHOTO LIBRA import (wave-w29)

`photos import-libra <artifacts-dir> --manifest <path> [--dry-run]`
(`core/server/usecases/photo-import-libra.ts`, `POST
/api/photos/import-libra`) is a one-shot, job-backed, idempotent bulk-load of
a completed PHOTO LIBRA session's descriptions, faces and GPS matches into
the app's photos catalog *without re-paying analysis*. It is intentionally
built from existing ports only — no new `PhotosStore`/`GlobalCatalogStore`
methods — because every write it needs (`recordPhotoAnalysis`,
`upsertFaceObservation`, `applyPhotoGeoBackfill`, `completePhotoFaceIndex`)
already exists and is already an idempotent upsert.

**Join.** The artifacts key rows by `md5` (a manifest.ndjson entry maps
`md5 <-> path`, relative to whatever drive the PHOTO LIBRA session ran
against); the app keys rows by the `ph_`-prefixed SHA-256 fingerprint
computed at `photos scan` time. The import never invents a mapping: for each
manifest entry it takes the currently scanned `photos.listRoots()`, tries
`<root>/<manifest path>` (NFC-normalized) against `PhotosStore
.getSightingByPath`, first hit wins, and records `md5 -> fingerprint` only on
a match. `geo.ndjson` entries carry a `path` directly and go through the same
per-root lookup, no manifest needed. Every unmatched entry is counted per
artifact (`manifest.unmatched`, `descriptions.unmatched`, `faces.unmatched`,
`geo.unmatched`) and never guessed — the user must run `photos scan` against
the same mount the manifest was built from first.

**Descriptions/tags → an `imported` photo config descriptor.**
`photoConfigDescriptorShape.family` gains a fifth member, `'imported'`,
alongside the four live analyzer families — a descriptor that structurally
cannot carry any analyzer field (`model`/`modelTag`/`maxImageDetail`
/`promptStyle`/`reasoningEffort` all rejected by the same superRefine that
enforces the live families' required fields) and whose `providerId` is
pinned to the literal `'photo-libra'`. `buildImportedPhotoConfigDescriptor()`
is a zero-argument, fully deterministic builder (`output_language: 'pl'` —
honest, not `'auto'`, since the imported `descPl` field is Polish text; a
frozen `PHOTO_LIBRA_IMPORT_PROMPT_VERSION`), so every import run produces the
same `cfg_` id and reruns are pure upserts. Libra's `scene`/`quality`
vocabularies are translated onto the app's closed `PHOTO_SCENES`/
`PHOTO_QUALITIES` unions through an explicit finite dictionary (documented in
`core/domain/photo-libra-import.ts`), never a fuzzy guess; an unmapped value
falls back to `'other'`.

**Default-selection safety.** The imported variant's `photo_analyses
.created_at` is pinned to a fixed epoch sentinel
(`IMPORTED_PHOTO_VARIANT_CREATED_AT`), not the real import wall-clock time.
`resolveSelectedPhotoAnalysis`'s fallback (no explicit/folder-default
selection → most recent `created_at` wins) means the imported variant is
selected by default only when it is the *only* variant for a photo — any
live analysis, run before or after the import, is strictly newer and always
wins, regardless of run order. This is the concrete mechanism behind "selected
by default only where no live analysis exists."

**Faces → the shared identity pool, unassigned.** libra's `obsId` scheme
(`<md5>:face:<n>`) is translated to the app's scheme with the fingerprint
substituted and frame index pinned to **1** (§5/C2): `<fingerprint>:face:1
:<n>`. Observations are written via the existing `GlobalCatalogStore
.upsertFaceObservation` with `media: 'photo'`, `personId: null` — imported
identities are never auto-assigned from libra's own `people.json`/
`face-assignments.json`; the existing clustering/`faces recluster` pass is
the only path that assigns them, per the no-AI-naming policy (§5). A face
entry missing `bbox` or `embedding` (both optional in the libra schema,
absent when libra detected zero faces in a photo) is skipped, never padded
with placeholder geometry. Every fingerprint libra actually ran face
detection against — whether or not it found a face — is marked via
`PhotosStore.completePhotoFaceIndex(fingerprint, FACE_ENGINE_VERSION)`, so it
is not re-queued by a future live photo faces pass.

**GPS → `source: 'timeline'` only, never `'camera'`.** libra's own `source`
field (`visit`/`activity`/`path`/`exif`/`null`) is honestly narrowed: only
the three values that are literally `TimelineIntervalKind` members map
through (`mapLibraGeoIntervalKind`) to a `GeoBackfillLocation` with
`source: 'timeline'`, written through the existing `PhotosStore
.applyPhotoGeoBackfill` (which re-checks `manual > camera > timeline`
precedence in-transaction, §6 — imported GPS can never clobber a photo's own
scanned EXIF). libra's `exif`-sourced and unsourced rows are **not**
imported: the app's own `photos scan` EXIF pass is the sole authority for
`gps_source = 'camera'`, and claiming that provenance for a value the app
never independently verified would be dishonest, not merely redundant.
libra's `confidence` (`high`/`medium`/`low`) maps to a declared accuracy
radius (50m/150m/500m) via `accuracyMForLibraConfidence`; an unrecognised
confidence is skipped (`geo.skippedUnsupportedSource`), never defaulted. A
`geo.ndjson` row libra emitted for a photo it could not place carries
`lat`/`lon` as `null` — a valid, expected shape, so it parses cleanly and is
counted in `geo.skippedUnsupportedSource`, never in `geo.invalidLines`, which
is reserved for genuinely malformed artifact lines.

**Idempotency and dry-run.** Every mutating call the pass makes
(`recordPhotoAnalysis`, `upsertFaceObservation`, `applyPhotoGeoBackfill`,
`completePhotoFaceIndex`) is already an upsert keyed on stable identity, so
re-running the import is a no-op beyond the precedence rules above (a
`geo.written` on the first run becomes `geo.unchanged` on the second).
`--dry-run` short-circuits every store write and reports the same
matched/unmatched counts the real run would produce.

## Wave plan (final, resequenced per challenge D)

1. **Wave 1 — Foundations**: `catalog.db` V11 (`media` column) + probe,
   `HomeLock` extraction, `photos.db` schema v1 (indexed), full-content
   fingerprint, scan + EXIF, `photos scan|status|forget` CLI/API skeleton,
   smoke leg. (Full spec: `wave-1-spec.md`.)
2. **Wave 2 — Proxies & browse**: `PhotoMediaPort` (RAW preview extraction,
   sips fallback), proxies + thumbs into `photo-artifacts/`, `media://`
   photo root, and the now-retired Library Photos grid/viewer/detail pane.
3. **Wave 3 — Analysis & search**: photo descriptor + batched analysis,
   variants, budget-guard extraction, FTS search + tags, tab search.
4. **Wave 4 — Faces & places**: photo faces pass into the shared pool,
   GPS timeline backfill + places, map markers.
5. **Wave 5 — Scale & release**: 50k perf targets, e2e-matrix photos leg,
   `qa:walkthrough` steps, release readiness.

Gate mechanics every wave must respect (challenge D1–D2): knip fails on
**unwired files** (`knip.jsonc` `"files": "error"`) — each wave lands its
adapters/routes already consumed by a composition root in the same commit;
the coverage ratchet (statements 79 / branches 80 / functions 73 / lines 79,
`vitest.config.ts`) is a hard floor — each wave carries its own tests, with
renderer logic in `features/photos/core/` precisely so it is testable.

---

## Decisions log (challenge disposition)

| Finding | Verdict | Decision |
|---|---|---|
| B1 sql.js write amplification | **Accepted** | Keep sql.js; explicit per-batch persist (500 files), resume = batch; PRD 5.1 AC rewritten. Native driver and NDJSON-checkpoint branches rejected (§1a). |
| B2 zero indexes | **Accepted** | Indexes declared in schema v1 + `sqlite_master` test (§1). |
| B3 `media://` 403s photo proxies | **Accepted, stronger mechanism** | Not `read-only-folders/{folderId}` mirroring as the challenge suggested — a single fingerprint-addressed `photo-artifacts/` home root (§3). Fixes B3 and dissolves C1's artifact-ownership hole in one move; one static root added to the scope in Wave 2. |
| B4 shared `catalog.lock` corruption | **Accepted** | Shared `HomeLock` object with one global lease counter, injected into both stores; ships Wave 1 (§1b). Two-lock-files alternative rejected. |
| B5 `jobResultSchema` silent absorption | **Accepted (minimal form)** | Required `media: 'photo'` literal on every photo result + union placement + round-trip/rejection test. Full `discriminatedUnion` migration **rebutted**: the 12 existing members share no key; adding one changes public envelope shapes for existing jobs (§7). |
| B6 batch size vs identity | **Accepted, option (a)** | Batch size stays out of identity; actual per-row `batch_size` provenance recorded (split-retries included); doc now states photo descriptions are not byte-reproducible (§4). |
| B7 photo error codes | **Accepted** | Zero new `ErrorCode` members; reuse existing codes; photo specificity in NDJSON step names (§7). |
| B8 budget guard unreachable | **Accepted** | Wave 3 extracts `pauseForBudget` into shared code; photo runs capped identically; PRD AC added (§4). |
| C1 duplicate-fingerprint ownership | **Accepted** | Owner-sighting rules 1–5 defined (§1 Duplicates): owner folder = current_path's folder, deterministic re-pointing, forget semantics, dual counts, fingerprint-addressed artifacts. |
| C2 obs frame index 0 trap | **Accepted** | Photo obsIds use frame index **1** — stated in §5 with the `parseFaceObsId` rationale. |
| C3 one config namespace | **Accepted** | Documented as a v1 product decision (§4); batch size = pipeline constant + `--batch-size` flag, not a `ConfigKey`; `photoPromptVersion` = module constant. |
| C4 video descriptor churn | **Accepted** | Stated explicitly: video descriptor untouched, no `kind: 'video'` (§4). |
| C5 FK cascades inert | **Accepted** | Cascades removed from the photos schema; explicit ordered deletes; V11 shrinks to a single `ALTER TABLE` (no `face_observations` rebuild) (§1, §5). |
| C6 missing pieces | **Accepted** | `proxy_width/height`, `thumb_state`, reconcile semantics (missing_at set only when zero sightings remain; unmounted folder = paths kept, photos marked missing at next scan of that root), cancellation AC, resource keys incl. `faces-write` mutual exclusion, EXIF **keywords dropped from v1** (rating kept, display-only) (§1, §5, §7, PRD). |
| D1–D2 knip / coverage per wave | **Accepted** | Every wave wires new files into a composition root in the same commit; per-wave test budget in the PRD (§ Wave plan). |
| D3 V11 last is backwards | **Accepted** | V11 + probe moved into Wave 1; with C5 it is a one-statement migration (§5, Wave plan). |
| D4 W3 depends on W2 proxies for all formats | **Accepted (already in AC)** | Wave 2 ships proxies for all formats, not just RAW. |
