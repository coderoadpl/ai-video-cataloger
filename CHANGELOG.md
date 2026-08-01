# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project ships from a branch, not from pull requests, so a released entry
links the **commit** that carried it. Entries under `[Unreleased]` carry no link
— a commit cannot cite its own hash; the release commit adds the links when it
moves them under a version heading. Releases below `0.4.0` predate this file and
are recoverable from git history only. Version `0.5.11` was never cut: the
release history jumps from `0.5.10` to `0.5.12`.

## [Unreleased]

### Added

- `GET /api/library/collection` merges videos and photos into one paged, filterable, sortable feed (composite-offset cursor, `media: all|video|photo`, honest positional cross-media relevance and video-only-filter semantics documented in `docs/architecture.md`); wired through `core/client/queries.ts` (`libraryCollectionQuery`) and `apps/web/src/api.ts` (`actions.libraryCollection`). `PhotosStore` gains a SQL-pushed, variant-aware `collectionPage` method.
- Video processing and the `thumbnails` backfill pass now also generate a second, ~512px square, center-cropped "grid" thumbnail (`<base>.grid.jpg` sibling of the existing 128x72 thumbnail) from the stored analysis frame only, never the source file; `search` and `/api/search` results gain a `gridThumbnailPath` field (existence-only unless a frame is already stored). The `thumbnails` pass summary gains `gridGenerated`/`gridSkipped`/`gridFailed` counters.
- Photo proxies now also generate a grid thumbnail sibling (`thumbs/<fingerprint>.grid.jpg`) from the freshly written proxy; `photosList`/`photosDetail`/`photosSearch` gain a `gridThumbPath` field, and the proxies pass summary gains a `gridFailed` counter. A new `photos grid-thumbs` CLI command and `POST /api/photos/grid-thumbs` route backfill grid thumbnails for every existing proxy.
- Browse preview: clicking a Library tile or a map video pin opens a selected-variant preview (player, description, tags, place, capture date) with a discreet "Open in Analysis" escape hatch.
- `photos gps backfill <timeline.json>` and `POST /api/photos/gps/backfill` match photo capture times against a Google Timeline export using the same matcher and precedence rules as the video backfill, resolve places offline through the shared places dataset, and push resolved place text into the photo search index (a photo's place is now searchable in the Photos tab). Rows whose capture time rests on an assumed timezone (`exif_local_assumed`/`file_mtime`) match with a tolerance widened to at least 180 minutes; the summary reports how many matches relied on that widening.
- The map now plots photo pins alongside video pins on the same canvas, with an All/Videos/Photos filter and honest per-media coverage captions ("N of M catalogued photos have location"); clicking a photo pin opens it in the Photos tab. `GET /api/catalog/locations` gains `totalPhotos`/`locatedPhotos` and a `media` marker per location; existing video-only consumers are unaffected (the video counts keep their prior meaning, and old envelopes without the new fields still parse).
- The Photos grid pages beyond its first 200 photos with a "Load more" control,
  so a large library is fully browsable instead of silently truncated.
- The photos database gains schema version 2 (indexes on `photos.current_path`
  and `(proxy_state, current_path)`), migrated in place on open.
- `pnpm run test:e2e:matrix` gains three photo legs: `photos-real-decode`
  (scan → real `sips` proxy/thumb decode → status → search), `photos-local-analysis`
  (a real local analyzer over the generated proxies) and the opt-in
  `photos-raw-sample` (`E2E_PHOTOS_SAMPLE_RAW`).
- `pnpm run qa:walkthrough` captures three photo steps — `photos-tab`,
  `photos-grid`, `photo-detail` — and skips them with a named reason when the
  QA home has no catalogued photos.
- [docs/qa/release-readiness.md](docs/qa/release-readiness.md) records the
  ordered pre-release pass (gates → e2e → packaged app → docs → real-data sanity).
- `photos status` reports a new `facesIndexed` count (foundational plumbing for photo faces indexing landing in a follow-up wave); the underlying `FaceObservation` record and its storage now carry a `media: 'video' | 'photo'` marker so photo-sourced face observations can share the same people pool as video ones.
- Photo search: `avc photos search "<query>"`, `/api/photos/search` and a search
  box in the Photos tab query file names, descriptions, tags and places over the
  photos index; file-name search works before any analysis has run.
- Photo analysis variants are inspectable and selectable: `avc photos variants
  list|select|delete|folder-default`, `/api/photos/variants*`, and a variant
  picker with description, scene/quality and tag chips in the Photos detail pane;
  the search index always follows the resolved selection.
- Photo cataloging foundations: `avc photos scan|status|forget` and `/api/photos/scan|status|forget` index photos (jpg/jpeg/png/heic/arw/dng) into a new `~/.ai-video-cataloger/photos.db` by full-content `ph_` fingerprint, with EXIF capture time/camera/GPS extraction at scan and a cancellable, batch-resumable `photo_scan` job.
- A Map view plots every catalogued video that carries GPS coordinates on an offline basemap, clustering nearby pins and opening the video from a pin; it always states its coverage ("110 of 3752 catalogued files have location") and shows an explicit empty state when no file carries GPS. The map downloads nothing: no map tiles are ever requested, and the geographic outline ships with the app.
- `GET /api/catalog/locations` returns every catalog file that carries GPS coordinates together with the catalog-wide file total, so a client can state its own coverage honestly.
- The video details panel shows the recorded coordinates of a catalogued file and a jump-to-map action.
- `faces recluster [--dry-run]` rebuilds every person and every face assignment from the embeddings already stored in the catalog — no frame extraction, no detector and no `FACE_ENGINE_VERSION` bump — reporting people before/after, observations that changed owner, owner-set names carried or dropped, and people left without an exemplar; `--dry-run` computes the same report and writes nothing.
- `thumbnails <root>` generates every missing catalog thumbnail under a folder tree by downscaling the analysis frame the selected variant already stored — no source video is opened, so it works on an index-only mirror of a read-only mount — reporting `thumbnails_scanning`/`thumbnails_file`/`thumbnails_done` NDJSON events and `generated`/`skipped`/`fromFrame`/`fromSource`/`failed` counts with per-file `failures`; a second run is a no-op and `--force` regenerates everything.
- `process` and `process-drive` write each completed file's thumbnail during the run (one downscale of the frame already on disk), so a finished drive run leaves a catalog with covers instead of generating them lazily on first display; on a read-only source the cover lands in the home mirror and the source tree stays untouched.
- Terminal panel gains a persisted Raw mode that shows each log line's attached raw job payload and interleaves a capped (500-entry) ring buffer of every renderer→server request/response, captured once at the `apps/web/src/api.ts` fetch seam.
- Tag language is now configurable (`tag_language`, folder- or home-scoped): tags are generated in that language regardless of the language spoken in the clip. Unset, it follows `output_language`. The analyzer prompt also demands ASCII transliteration, so pinned non-English tags stay kebab-case.
- `tags suggest-aliases [--json]` proposes tag merges from the existing catalog — normalisation (diacritics, case, separators), English and Polish plurals, a curated Polish irregular lexicon, and single-character spelling variants (`fiord`/`fjord`) — with file counts and a rule label per proposal; it never writes, and each proposal is applied by hand with `tags alias <from> <to>`.
- Catalogued coordinates now record where they came from — `camera`, `timeline` or `manual` — together with an accuracy in metres and, for a timeline-sourced fix, which interval kind (`visit`/`activity`/`path`) produced it; a probe that finds no GPS no longer erases a coordinate already stored for that file.
- `search_documents` gains a `place` column (rebuilt into the full-text index on upgrade), so a resolved place name is searchable and ranks between tags and the final name; nothing populates it yet in this wave.
- Media probing extracts the container's `creation_time` (`MediaProbe.createdAtUtc`), normalised to UTC, and a processed file records it as its capture instant (`captured_at`, source `container`) — the matching key for a Google Timeline GPS backfill, never the filename's local clock.
- `faces exemplars [--dry-run] [--limit <n>]` fills missing face photographs by decoding each missing observation's own frame, re-detecting it against the stored box and cutting the crop — a repair pass for catalogs indexed before crops became per-observation, reporting planned/written crops, unreachable files, detections that no longer match, and people still without a photograph.
- `gps backfill <timeline.json> [--root <path>] [--dry-run] [--tolerance-minutes 30] [--max-visit-hours 36] [--reresolve-places]` fills empty catalog coordinates from a Google Timeline export, matching each file's UTC `captured_at` against the export's `visit`/`activity`/`timelinePath` intervals; camera- and manually-sourced rows are never touched, a second run is a no-op, and `--dry-run` computes and reports every count (matches by interval kind, an accuracy bucket histogram, place resolution) without writing.
- The map's pin popover and the video details panel now draw a measured location (camera GPS) differently from an approximate one (timeline fix): a hollow pin with an accuracy halo sized to its `gps_accuracy_m`, plus a `Measured (camera)` / `Approximate (…) ±m` badge and, where resolved, a place line — never a single pin style for both.
- The offline place resolver (`PlacesPort` / `GeoNamesPlacesAdapter`) resolves the nearest settlement, region and country for a coordinate from a versioned, self-generated GeoNames snapshot with no network call; the production dataset itself is not yet published, so every backfill run currently reports `places.skippedNoDataset` for every row until that follow-up ships (ADR-0015).
- Photo proxies and thumbnails: `avc photos proxies <root> [--force]` and `/api/photos/proxies` generate a ≤1280px JPEG proxy and ≤320px thumbnail per photo fingerprint under `~/.ai-video-cataloger/photo-artifacts/` — RAW (ARW/DNG) via embedded-preview extraction with a full-decode sips fallback, never writing inside the photo folder; `photos scan` chains the pass automatically, an artifact that has gone missing from disk is regenerated on the next pass without `--force`, and per-file failures are reported, never fatal.
- `/api/photos/tree|list|detail` expose scanned roots, paged photo listings and per-photo detail to clients.
- A Photos tab browses the photo catalog: a root picker over scanned folders, a windowed thumbnail grid grouped by capture day with duplicate and missing badges, a proxy-based viewer with keyboard arrow navigation, and a detail pane showing EXIF basics, capture provenance and every path a photo was sighted at.
- Photo vision analysis: `avc photos process <root> [--force] [--batch-size N]`
  and `/api/photos/process` run description, tags, scene and quality over photo
  proxies through the configured analyzer (api / harness / local / gemini-native),
  batching ~12 photos per call with an automatic 12→6→1 split on malformed
  responses; results are variants keyed by a photo `cfg_` config id, and each
  row records the actual batch size that produced it.
- Photo analysis runs honour the monthly `gemini_monthly_budget_usd` cap with
  the same pause-and-resume semantics as drive runs; `photos status` counts
  analysed photos.
- `GET /api/search` and `search` (client/CLI) accept an optional `query` alongside structured filters — `tags` (AND, alias-expanded), `people` (OR, by id), `place` (substring), `from`/`to` (captured-at range), `hasGps`, `folderId` — plus `sort` (`relevance`/`captured_desc`/`captured_asc`/`name_asc`) and `thumbnails` (`ensure`/`existing`); the response gains a `total` reflecting the full filtered match count, independent of the returned page. The CLI gains repeatable `--tag`/`--person` and the matching `--place`/`--from`/`--to`/`--has-gps`/`--no-has-gps`/`--folder`/`--sort` flags, with person names resolved against `faces people` and unknown folders/names reported as validation errors.
- `media://` now also admits the `.ai-video-cataloger` sidecar directory of every catalogued folder (not only the currently open one and its read-only mirror), so a Library or search thumbnail generated for a folder that isn't the open one resolves instead of rendering blank; the sidecar's video-extension files stay unreachable through this root.
- A Library tab browses every catalogued video regardless of folder: a debounced search box over a virtualized, date-grouped grid (existing thumbnails only, never generated on demand), with an honest empty-catalog state distinct from a no-match state and a "Load more" page sentinel; opening a tile reuses the existing search-result folder-open path.
- `GET /api/library/facets` computes whole-catalog tag, person, place, capture-year and folder facets (plus GPS/capture-date/missing/offline-folder counts) server-side over the same selected-variant SQL join as search and locations, so a client can render filter options without loading a page and pretending it knows the whole catalog.
- The Library tab gains an always-visible filter bar (tag/person/place/date-range/has-GPS chips, an honest `{shown} of {total}` count, and a no-match message that names every active filter) plus a date/folder grouping toggle with a sort control, so a browse can be scoped without leaving Library.
- "Show in Library" now works in both directions: a Library tile's context menu opens its folder/processing context (open in folder view, reveal in Finder, copy path), and the current folder header, a Videos-list row, and the details panel's location row each gain a "Show in Library" action that scopes Library to that folder (removable chip) and, for a specific file, scrolls the grid to it.
- Library becomes the default view on launch once the catalog holds at least one file (an empty catalog still opens on Videos); the last active view is persisted and always wins over that default. `ViewNav` now orders Library directly after Videos.

### Changed

- Photo analysis and proxy generation now checkpoint the photos database inside a store batch — after every analyzer batch and every 50 generated proxies — so an interrupted run loses at most one analyzer batch of paid analysis instead of up to 500 photos' worth.
- `photos scan`'s reconcile pass reads the sightings under a root through the path index instead of loading every path row in the database into memory.
- All faces-writing jobs (`faces index`, `faces recluster`, `faces exemplars`) and the drive run's inline faces pass now serialize under a single `faces-write` resource; a concurrent request returns `conflict` instead of racing the shared people pool, and the drive run reports a new `faces_waiting` progress step while it waits its turn.
- Global catalog schema v11: `face_observations` gains a `media` column (default `video`) preparing the shared face-identity pool for photos.
- Global catalog schema v12: adds `idx_files_captured_at`, `idx_files_folder_id`, `idx_files_place_name`, `idx_file_tags_tag_id`, `idx_face_observations_person`, and `idx_analyses_fingerprint` indexes, so date, folder, tag and person lookups seek an index instead of scanning `files`, `file_tags` and `face_observations`. On the 3752-file reference catalog a person lookup drops from 2297 ms to 3 ms and a folder lookup from 0.28 ms to 0.03 ms.
- The advisory catalog home lock is now a single shared owner across all catalog stores in a process; disposing or flushing one store no longer releases the lock while another still holds a lease.
- The packaged desktop renderer is served with a Content-Security-Policy that permits no remote origin, so no renderer code path — present or future — can reach the network without an explicit, documented policy change (ADR-0013).
- Face clustering no longer makes founding an identity harder than joining one: the auto-assign floor rises to 0.50, matching the new-cluster floor, and a new identity needs two mutually similar observations instead of three (ADR-0012).
- Exemplar crops are sampled across files — at most one per file until a person has five — so a person spanning many folders is verifiable instead of showing five near-duplicates from one day; `faces people` now returns every stored exemplar path.
- Face indexing now stores a crop for every detected face, keyed by the observation (`faces/obs/<fingerprint>/<frame>-<detection>.jpg`) instead of by the person that claimed it, and the up-to-five exemplars a person shows — at most one per file, best quality first — are chosen when the people list is read. A rebuilt identity therefore always has a photograph and always spreads it across the files it spans; previously a `faces recluster` could leave hundreds of nameless, photo-less people (ADR-0014). `faces recluster`'s `personsWithoutExemplar` counts the people the list actually shows without a photograph rather than the people holding no crop at all, so the number it reports — and the `faces exemplars` hint it triggers — matches what the owner sees.
- `thumbnail <video-path>` and the GUI's lazy generation prefer the stored analysis frame over re-decoding the video, so a cover can be produced for a file whose drive is detached or mounted read-only, and an existing thumbnail is reported as skipped without starting ffmpeg.
- The terminal panel no longer auto-expands on the first job output; it stays collapsed until opened from the header button or the `View` menu.
- `tag_language` joins the analysis config descriptor, so pinning it (or having `output_language` pinned) produces a new `configId`; runs with `output_language` and `tag_language` both `auto` keep their existing configIds. Previously tags followed whatever language was narrated in the video, which split one concept into per-language tags.
- `photos status` counts proxied and proxy-failed photos; `photos forget` deletes the forgotten photos' proxy and thumbnail artifacts.
- The `media://` protocol serves the static photo-artifacts root; photo source folders are never exposed to the renderer.
- `pnpm run check` fails on a direct `.normalize('NFC')` call outside `core/domain/paths.ts` and test files, so path canonicalization stays at the three boundaries that own it.
- Search now follows `tag_aliases` in both directions: a merged-away term still finds the files that carry its canonical tag, and the canonical term also matches text occurrences of its aliases. Quoted phrases stay literal and literal hits still outrank alias hits.
- Two-mode UI: a Library/Analysis switcher in the top bar replaces the five-tab view navigation; Library groups Collection/Photos/People/Map behind a subnav, Analysis groups the folder workspace behind a Videos/Photos toggle, and each mode remembers its own state.
- Browse surfaces are strictly read-only: Library Photos hides analyze/variant actions and folder scanning, Library People hides the faces-index build (now in Analysis > Photos), and map video pins open the preview instead of the folder workspace.
- The folder bar and the terminal strip render only in Analysis mode; the Library browses the cross-folder catalog without a current folder.
- The Analysis Videos/Photos media toggle moves from the workspace content into the top bar, next to the Library/Analysis switcher, so it is always visible while in Analysis mode.
- The Library search box's bottom margin doubles (8px → 16px) so it no longer crowds the filter bar beneath it.

### Removed

- The global top-bar search and its full-screen results view; search now lives in the Library's Collection toolbar with the same recent-searches and top-tags suggestions.

### Fixed

- Folders whose names carry diacritics are no longer silently skipped: every path entering the catalog is canonicalized to NFC at the contract, filesystem and store boundaries, so a path handed in as NFD (the on-disk form on macOS) matches the NFC rows the catalog stores. In a real-world catalog this recovered affected analyzed files that `faces index` had reported as a successful zero-file run.
- `faces index <root>` no longer reports success over an empty set: a root that does not exist fails with `folder_not_found`, and an existing root with no catalog folders under it fails with `drive_root_empty` (exit 39), matching `materialize` and `process-drive`; a root whose files are all already indexed still succeeds and now reports the folders and analyzed files it saw.
- A read-only mirror created before path canonicalization keeps its frames and thumbnails: the mirror id derived from the old decomposed folder name is rebuilt and used when no canonical mirror exists, so a diacritic folder is not silently re-mirrored from scratch.
- A second person could never be founded once the unassigned pool held more than one identity: the new-cluster seed demanded that *all* candidate observations be mutually similar, so a mixed pool always returned nothing and every good detection was absorbed by the first person in a real-world catalog.
- `faces recluster` no longer leaves people the owner cannot recognise: in a real-world catalog nearly every rebuilt identity had no crop because crops existed only for the exemplars of the single person that had been glued together at index time.
- `driveRunSummarySchema` carries `snapshotSkipped` through the completed `process-drive` job payload instead of stripping it.
- A corrupted stored variant descriptor or usage JSON in the global catalog surfaces as `read_error` (`READ_ERROR`, exit 28) instead of an untyped `internal` error.
- Settings and the setup wizard only render the amber Gemini privacy warning when the selected analyzer is Gemini (native video); it no longer appears under Claude, local, or OpenAI-compatible API selections.
- The `harness-cursor-agent × skip` e2e matrix leg now probes cursor-agent with a trivial invocation (not just `status`) before running the full pipeline, so an authenticated but usage-exhausted CLI self-skips instead of failing the leg.
- `tags alias` re-points existing aliases at the new canonical tag instead of leaving them pointing at the deleted tag row, so chained merges (`dogs` → `psy`, then `psy` → `pieski`) keep resolving and no longer resurrect the merged-away tag on the next ingest.
- One undecodable or very short video no longer kills a whole face-indexing pass: `faces index` and the faces pass chained into `process-drive` record the file in a `faces_file_failed` event and in the `faces` summary block (`filesFailed`, `failureCodes`, `aborted`), keep going, and exit 0 with partial results; only five consecutive failures of the same class abort the pass (`DRIVE_RUN_ABORTED`, exit 40).
- Asking for more frames than a clip contains is no longer an error: frame extraction returns the frames ffmpeg actually wrote — and fails typed only when none did — and an RGB decode that seeks past the last frame falls back to the extracted frame image instead of failing with `Decoded RGB frame size mismatch: expected 15925248, got 0`.
- `listLocations` resolves the selected variant (explicit selection, then folder default, then newest) instead of joining every stored variant, so a file with more than one analysis variant no longer produces a duplicate map pin, an inflated "located files" count, and a nondeterministic final name.
- The API-log terminal seam no longer records the plaintext body of a `POST /api/credentials` request, so an entered provider API key never lands in the debug terminal's Raw view or on the clipboard via Copy.
- `photos scan` no longer treats an unreadable subtree (permission change, flaky mount) as "gone": a folder that fails to list is reported via a new `photo-folder-skipped` event, counted in the summary's new `folderReadErrors`, and excluded from the reconcile pass, so its photos keep their sightings instead of being wrongly marked missing.
- `photosVariantsSelect`, `photosVariantsDelete` and `photosVariantsFolderDefault` now flush `photos.db` under the same write-lock wrapper that already flushes the global catalog, so a variant selection survives an app quit instead of depending on the un-awaited `dispose()` at shutdown.

## [0.6.3] - 2026-07-29

### Added

- `pnpm run test:e2e:matrix` gains two `ro-mount` legs that build an `hdiutil` disk image, re-attach it read-only, and assert index-only mode against a real read-only filesystem: detection and zero writes to the mount (never skippable on macOS), then a full drive run whose artifacts land in `~/.ai-video-cataloger/read-only-folders/`
  ([`5565fae`](https://github.com/coderoadpl/ai-video-cataloger/commit/5565fae)).
- `materialize <root>` applies an existing catalog to a now-writable drive without re-analysis: it looks each file up by fingerprint, applies the selected variant's final name, artifacts, projection and snapshot only where they are missing, resolves name collisions with the established numeric suffix, reports files it cannot place, is a no-op on a second run, previews everything with `--dry-run`, and exits `TARGET_READ_ONLY` (46) when the target is still mounted read-only
  ([`6a22887`](https://github.com/coderoadpl/ai-video-cataloger/commit/6a22887)).
- `process-drive` builds the people index itself when `faces_enabled=true`: a completed run indexes faces over its own root in one pass, reports `faces_scanning`/`faces_done` NDJSON events and a `faces` block in `run-summary`, and accepts `--skip-faces` to opt one run out
  ([`c22b43d`](https://github.com/coderoadpl/ai-video-cataloger/commit/c22b43d)).
- `pnpm run workflow-lint` (part of `pnpm run check`) fails when a workflow guards a repository other than the one in `package.json`, when a self-hosted job is missing its `CI_RUNNER_READY` arming variable, or when a job consumes a `CLAUDE_CODE_OAUTH_TOKEN` slot without `AI_REVIEW_READY`
  ([`e565287`](https://github.com/coderoadpl/ai-video-cataloger/commit/e565287)).

### Changed

- CI workflows (`check`, `smoke`, `e2e`, `ai-review`) now name the current repository, trigger on `main` instead of the retired `rewrite/foundation`, and stay dormant until the owner registers the self-hosted macOS runner and sets the `CI_RUNNER_READY` repository variable (`ai-review` additionally needs `CLAUDE_CODE_OAUTH_TOKEN_1` and `AI_REVIEW_READY`); a dormant job skips under a name that states the enable step instead of queueing on a runner that does not exist. See [docs/ci.md](docs/ci.md)
  ([`e565287`](https://github.com/coderoadpl/ai-video-cataloger/commit/e565287)).
- `pnpm run check` now builds the shipped renderer bundle and fails when any Node builtin reaches the renderer module graph, closing the gap that let `electron:build:renderer` break on a green `main`
  ([`ec6447b`](https://github.com/coderoadpl/ai-video-cataloger/commit/ec6447b)).

### Fixed

- Read-only exFAT/fskit folders enter index-only mode when Node 22 masks recursive directory creation failures as `ENOENT`
  ([`5ffddfd`](https://github.com/coderoadpl/ai-video-cataloger/commit/5ffddfd)).
- A drive run that cannot index faces — models not installed, engine unavailable, `--skip-faces`, cancelled or failed pass — now says so in the run summary and in a `faces_pass_skipped` NDJSON event instead of finishing silently with an empty people index
  ([`c22b43d`](https://github.com/coderoadpl/ai-video-cataloger/commit/c22b43d)).
- A completed `process` run again writes the established `frames/{base}/`, `transcripts/{base}.*` and `summaries/{base}.*` files next to the video when the file was first catalogued by a pre-variant install: the selected-variant projection is now materialized on every completed run, and a freshly processed variant takes selection from an index-only `legacy` record that has no artifacts to project
  ([`e8abb26`](https://github.com/coderoadpl/ai-video-cataloger/commit/e8abb26)).

## [0.6.2] - 2026-08-04

### Added

- The Setup Wizard now includes a Faces step for enabling local face detection and recognition before scanning
  ([`970c5080`](https://github.com/chomamateusz/ai-video-cataloger/commit/970c5080)).
- The landing site now includes an English blog carrying the analyzer benchmark write-up and a getting-started walkthrough
  ([`2a0a280e`](https://github.com/chomamateusz/ai-video-cataloger/commit/2a0a280e)).

### Changed

- Gates refuse to run on the wrong Node
  ([`6d47349e`](https://github.com/chomamateusz/ai-video-cataloger/commit/6d47349e)).
- `scripts/release-walkthrough.mjs` now opens the driven window at a configurable size (`--window-size`, default 1920x1200) so the details column no longer collapses in captured screenshots, and waits for pending transitions/spinners to settle before each screenshot
  ([`0119e002`](https://github.com/chomamateusz/ai-video-cataloger/commit/0119e002)).

### Fixed

- Duplicate detection now clears unreachable canonical analyses when neither their source file nor variant artifacts remain, so present copies return to pending and can elect a new canonical on analysis
  ([`a1ec5a3b`](https://github.com/chomamateusz/ai-video-cataloger/commit/a1ec5a3b)).
- Variant selection now returns to details from comparison, keeps unrelated controls responsive while name-based artifacts refresh in the background, and enables the folder-default action whenever the selected configuration differs from the stored default
  ([`c09522d6`](https://github.com/chomamateusz/ai-video-cataloger/commit/c09522d6)).
- GUI Analyze All runs now skip files marked as duplicates, report duplicate skips separately, and reserve duplicate analysis for the explicit Analyze anyway action
  ([`dd5a0e1e`](https://github.com/chomamateusz/ai-video-cataloger/commit/dd5a0e1e)).
- GUI analysis completion now follows renamed files in the catalog and details view, refreshes variants by fingerprint, and offers a retry when variant loading fails
  ([`5775760e`](https://github.com/chomamateusz/ai-video-cataloger/commit/5775760e)).
- Known folders render cached catalog rows before filesystem reconciliation, thumbnails generate in a bounded parallel priority queue, and loaded analysis variants are reused when switching
  ([`6a993533`](https://github.com/chomamateusz/ai-video-cataloger/commit/6a993533)).
- Settings now show compact sourced values, place Gemini budget feedback by its model, preserve credential-save destinations, and omit empty spend; analysis details no longer collapse at supported window sizes, duplicate Gemini descriptors, or misalign frame-free comparisons
  ([`90396ebf`](https://github.com/chomamateusz/ai-video-cataloger/commit/90396ebf)).
- Landing header section links now return to the locale-specific home page from
  blog routes, and the benchmark article uses a concise title with its former
  title retained as the visible subtitle
  ([`0f39e8b3`](https://github.com/chomamateusz/ai-video-cataloger/commit/0f39e8b3)).

## [0.6.1] - 2026-08-03

### Fixed

- Whisper transcripts are filtered before storage and analysis to remove probable no-speech segments, reviewed silence-tail hallucinations, and degenerate sentence loops across local and API backends
  ([`6a986ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/6a986ea6)).
- Transcription language is now configurable (`whisper_language`, default `auto`); previously no language was passed to any whisper backend and each fell back to an English-leaning default, causing intermittent misdecoding of non-English narration
  ([`0970657`](https://github.com/chomamateusz/ai-video-cataloger/commit/0970657e)).

## [0.6.0] - 2026-08-03

### Added

- Settings expose the Gemini monthly budget cap alongside a read-only readout of this month's estimated Gemini spend and the number of analyses behind it
  ([`8a9eb13`](https://github.com/chomamateusz/ai-video-cataloger/commit/8a9eb13f)).
- File details can compare every analysis variant side by side, including configuration, frames, transcript, summary, tags, duration and recorded cost, and select a variant from its comparison column
  ([`4f2e7c6`](https://github.com/chomamateusz/ai-video-cataloger/commit/4f2e7c64)).
- File details can preview and explicitly select analysis variants, show whether Analyze creates or replaces a variant, set the current configuration as the folder default, and badge multi-variant search results
  ([`0e74679`](https://github.com/chomamateusz/ai-video-cataloger/commit/0e74679d)).
- `variants list|select|delete|default` CLI commands inspect and manage analysis variants; process NDJSON identifies configurations and reports verbose artifact reuse
  ([`a17b7af`](https://github.com/chomamateusz/ai-video-cataloger/commit/a17b7af7)).
- Variant contract routes expose comparison-ready analysis descriptors and artifact paths, with client descriptors for listing, selection, deletion, and folder defaults
  ([`b2c182c`](https://github.com/chomamateusz/ai-video-cataloger/commit/b2c182c1)).
- Gemini native choices in the setup wizard and settings disclose before selection that the entire video and audio leave the Mac, how Google receives and retains the file, that the model creates the transcript, and the duration-based ballpark cost
  ([`439652f`](https://github.com/chomamateusz/ai-video-cataloger/commit/439652f3)).
- Gemini analyses show per-file and drive-run cost estimates, append them to a local monthly spend ledger, and pause resumable drive runs at a configured soft budget
  ([`b670895`](https://github.com/chomamateusz/ai-video-cataloger/commit/b670895f)).
- The packaged app honors `AI_VIDEO_CATALOGER_USER_DATA_DIR` and the keychain
  environment variables for fully isolated test runs
  ([`77c5a19`](https://github.com/chomamateusz/ai-video-cataloger/commit/77c5a193)).
- Duplicate chips appear in folder scope, not only Whole-tree
  ([`3e790ef`](https://github.com/chomamateusz/ai-video-cataloger/commit/3e790ef3)).
- `pnpm run qa:walkthrough` drives a packaged build through launch, folder open, tree, analysis, search, settings and wizard against an isolated user-data directory, home and disabled keychain, capturing one screenshot per step; the release procedure now requires this self-QA pass and a review of its screenshots before a DMG is offered (`docs/qa/release-walkthrough.md`)
  ([`8d61177`](https://github.com/chomamateusz/ai-video-cataloger/commit/8d611774)).
- The project is licensed `Elastic-2.0` — `LICENSE` (ELv2) at the repo root and a root `package.json` declaration, per ADR-0009 (public source, paid convenience builds, license-key-gated features permitted)
  ([`086394c`](https://github.com/chomamateusz/ai-video-cataloger/commit/086394c8)).

### Changed

- The entity gate was reverted after three failed measured iterations, and fabrication control moves to a future verification pass
  ([`25a7bae`](https://github.com/chomamateusz/ai-video-cataloger/commit/25a7bae4)).
- Analysis prompt version 3 adds a concrete-attribute floor for filenames and tags when no entity is verifiable
  ([`07166c5`](https://github.com/chomamateusz/ai-video-cataloger/commit/07166c5a)).
- The gemini-native entity gate now applies one evidence rule across descriptions, filenames, and tags with attribute-based fallbacks, addressing the c11 blind-judge regression
  ([`424062c`](https://github.com/chomamateusz/ai-video-cataloger/commit/424062c4)).
- Selecting an analysis variant now refreshes its name-based artifacts and search document together; folder defaults resolve from the full processing configuration, and deletion promotes the newest survivor while retaining shared artifacts until their final reference is removed
  ([`d452e8e`](https://github.com/chomamateusz/ai-video-cataloger/commit/d452e8ef)).
- Processing deduplicates and force-replaces per content/configuration pair; completion and skip NDJSON name the configuration, and folder snapshots preserve every variant plus the selected configuration
  ([`d2c7c4b`](https://github.com/chomamateusz/ai-video-cataloger/commit/d2c7c4b9)).
- Name-based artifacts under `frames/`, `transcripts/`, and `summaries/` project the selected analysis variant
  ([`a69d68a`](https://github.com/chomamateusz/ai-video-cataloger/commit/a69d68a5)).
- The global catalog index uses schema version 9 and stores analyses by content fingerprint and configuration
  ([`74a3120`](https://github.com/chomamateusz/ai-video-cataloger/commit/74a31202)).
- The gemini-native prompt gates named entities on legible evidence
  ([`1ba611c`](https://github.com/chomamateusz/ai-video-cataloger/commit/1ba611c7)).
- The packaged app no longer accepts the in-memory DB driver
  ([`0d55a10`](https://github.com/chomamateusz/ai-video-cataloger/commit/0d55a103)).
- Processing flags passed explicitly to `process` and `process-drive` now
  override setup configuration, while unpassed flags defer to configured values
  instead of applying their CLI defaults
  ([`335e544`](https://github.com/chomamateusz/ai-video-cataloger/commit/335e5448)).
- The processing command help now distinguishes `--force` from a catalog reset,
  and the CLI documentation states that resumable drive runs with per-file
  failures exit 0 and identifies the summary and NDJSON failure counts
  ([`335e544`](https://github.com/chomamateusz/ai-video-cataloger/commit/335e5448)).

### Fixed

- A Gemini native upload whose final response is lost now completes from the server-confirmed state instead of failing with `read_error`
  ([`f8abc50`](https://github.com/chomamateusz/ai-video-cataloger/commit/f8abc506)).
- An incomplete credential migration retries on a cooldown instead of re-running on every command
  ([`f68d87d`](https://github.com/chomamateusz/ai-video-cataloger/commit/f68d87d2)).
- The keychain path configured by `AI_VIDEO_CATALOGER_KEYCHAIN` is validated before writes, so a bogus path can no longer send API keys to the login keychain
  ([`10c10ab`](https://github.com/chomamateusz/ai-video-cataloger/commit/10c10abd)).
- Search results show real thumbnails for folders indexed via the CLI
  ([`ae56d10`](https://github.com/chomamateusz/ai-video-cataloger/commit/ae56d105)).

## [0.5.26] - 2026-07-29

### Fixed

- A Gemini batch run killed inside the submit call and resumed against the job
  it finds by display name records the answers under the model that submit used.
  The job model is decided after the re-attach, so the stored file model, the
  per-file usage event and the batch price rates no longer follow a
  configuration that moved in between, and `batch_model_changed` names the drift
  on this path too
  ([`73e6d18`](https://github.com/chomamateusz/ai-video-cataloger/commit/73e6d180)).
- Deleting a credential whose file entry could not be read now also says the
  macOS Keychain still holds the credential when it does, in the CLI and in the
  settings panel: "nothing was removed" alone pointed at the file when the
  locked keychain was what needed unlocking
  ([`b315241`](https://github.com/chomamateusz/ai-video-cataloger/commit/b3152417)).

## [0.5.25] - 2026-07-29

### Security

- The `media://` read-only mirror scope is no longer one shared root. A
  renderer request can reach
  `~/.ai-video-cataloger/read-only-folders/<folderId>/` only for a folder the
  catalog knows or the folder that is currently open, so the mirrors of every
  other folder — including ones the catalog has never seen — are refused
  instead of served
  ([`67da149`](https://github.com/chomamateusz/ai-video-cataloger/commit/67da1493)).

### Fixed

- A re-attached Gemini batch run records its answers under the model the job
  was submitted with: the file's stored model, the per-file usage event and the
  cost rates all name the job's model, not the one the configuration has moved
  to since. A price override stored on the provider is applied only while its
  model still matches the job's
  ([`175cf93`](https://github.com/chomamateusz/ai-video-cataloger/commit/175cf937)).
- A batch run that adopts a job whose files another run has already processed
  releases that job's Files API uploads and clears the batch state instead of
  leaving both behind. Such a job is dropped without harvesting — its answers
  would only duplicate rows already in the index
  ([`79432d8`](https://github.com/chomamateusz/ai-video-cataloger/commit/79432d83)).
- An unreadable video no longer aborts the scan of a read-only folder. The
  missing-file reconciliation degrades exactly like the ordinary scan path: the
  file it cannot hash stays marked missing and the folder still lists
  ([`3168770`](https://github.com/chomamateusz/ai-video-cataloger/commit/31687708)).
- Thumbnails of a read-only folder appear as soon as its first analysis
  finishes, instead of staying placeholders until the app is restarted. A
  completed analysis earns a file one more thumbnail attempt, now that the home
  mirror it writes to exists
  ([`3168770`](https://github.com/chomamateusz/ai-video-cataloger/commit/31687708)).
- The delete-credential copy keeps the keychain warning when a credentials-file
  entry is also unreadable — both the settings notice and the CLI report the
  retained keychain instead of dropping it for the unreadable-entry line
  ([`e6daf79`](https://github.com/chomamateusz/ai-video-cataloger/commit/e6daf790)).

## [0.5.24] - 2026-07-29

### Changed

- Listing a folder's records from the global catalog costs a fixed number of
  queries instead of five per file. A 500-file folder — read on every scan of a
  read-only folder, every catalog-tree count and every snapshot export — went
  from 2502 queries to 6; a 10-file folder went from 52 to the same 6
  ([`127cd9c`](https://github.com/chomamateusz/ai-video-cataloger/commit/127cd9c7)).

### Fixed

- Thumbnails and extracted frames of a read-only folder are shown in the
  desktop app again. Those artifacts live in the home mirror
  (`~/.ai-video-cataloger/read-only-folders/<folderId>/`), which the `media://`
  scope did not cover, so every request for one was answered with `403` and the
  gallery fell back to placeholders. The mirror root joins the faces root as a
  fixed home scope, and a path that only appears to be inside it — traversal,
  symlink escape, a video smuggled in — is still refused
  ([`39b5914`](https://github.com/chomamateusz/ai-video-cataloger/commit/39b59140)).
- Setting a conflicting API key aside no longer writes that key away. Every
  write of a credentials file merges the entries the parser could not read back
  in, and that merge overwrote the value the same call had just archived when
  the target file already held an unreadable entry for the same provider. A
  parsed value now wins over an unparsed one on a key collision, in every write
  ([`138c44a`](https://github.com/chomamateusz/ai-video-cataloger/commit/138c44a0)).
- A Gemini batch drive run that finds several unfinished runs for the same root,
  each holding a live batch job, now emits one `batch_orphan_jobs` event naming
  the jobs it is not adopting. It still adopts exactly one; the others are
  collected by re-running the root instead of being silently orphaned
  ([`30b4da8`](https://github.com/chomamateusz/ai-video-cataloger/commit/30b4da82)).
- Re-attaching to a batch job whose model no longer matches the resolved
  configuration emits one `batch_model_changed` event and records the answers
  under the model the job was bought with, instead of overwriting the run's
  model with one that never produced those answers
  ([`30b4da8`](https://github.com/chomamateusz/ai-video-cataloger/commit/30b4da82)).
- A Files API delete answered `404` counts as a released upload. Reporting it as
  retained invented a quota leak out of an upload that was already gone
  ([`30b4da8`](https://github.com/chomamateusz/ai-video-cataloger/commit/30b4da82)).
- `batch_uploads_retained` is a typed drive event in the CLI's NDJSON stream
  like `batch_submitted`, `batch_poll` and `batch_completed`, instead of a
  generic progress line
  ([`30b4da8`](https://github.com/chomamateusz/ai-video-cataloger/commit/30b4da82)).
- Deleting a credential whose file entry could not be read no longer claims
  "nothing was removed" when the Keychain item was in fact cleared. The CLI and
  the settings panel now name what was cleared and still say the unreadable
  entry was left untouched and has to be fixed by hand
  ([`ef6a06b`](https://github.com/chomamateusz/ai-video-cataloger/commit/ef6a06b3)).
- The catalog tree shows real pending and processed counts for a read-only
  folder. Those folders carry no marker file, so the counts fell back to
  "unknown"; the tree now reaches the global index through the same path-derived
  folder id `scan` uses, and only when the index actually holds that folder
  ([`ef6a06b`](https://github.com/chomamateusz/ai-video-cataloger/commit/ef6a06b3)).
- Scanning a read-only folder surfaces the analysis of a file that is back on
  disk after having been recorded as missing. The missing mark is cleared in the
  global index — which is writable even when the folder is not — instead of
  hiding an analysis that is still valid
  ([`ef6a06b`](https://github.com/chomamateusz/ai-video-cataloger/commit/ef6a06b3)).

## [0.5.23] - 2026-07-29

### Fixed

- `credentials.json` no longer loses an entry the parser could not read. Every
  write — `set`, `delete`, the Keychain migration's cleanup and the stale marker
  — now merges the unparsed entries back verbatim, and the file is removed only
  once no entry of any kind is left. Deleting a provider whose entry is
  unreadable reports that the entry was left untouched and names the file,
  instead of answering "no stored credential" while the plaintext key sits on
  disk
  ([`e50a7a9`](https://github.com/chomamateusz/ai-video-cataloger/commit/e50a7a9a)).
- `doctor` warns about unreadable credential entries again: the composition
  wrapper around the credentials store dropped `unreadableCredentialEntries` on
  the floor. The wrapper is now typed against the full port so a forgotten
  optional method is a compile error
  ([`e50a7a9`](https://github.com/chomamateusz/ai-video-cataloger/commit/e50a7a9a)).
- A `set` whose Keychain write succeeded but whose plaintext copy could neither
  be removed nor marked superseded now fails with that message and keeps
  reporting a degraded backend, instead of proceeding as if the copy had been
  marked
  ([`e50a7a9`](https://github.com/chomamateusz/ai-video-cataloger/commit/e50a7a9a)).
- A folder whose effective analyzer configuration differs from the batch root's
  in any way — a different `apiKeyRef`, output language or timeout, not just a
  different model — is processed interactively instead of being answered with
  the root's settings inside the shared batch job
  ([`7f1f175`](https://github.com/chomamateusz/ai-video-cataloger/commit/7f1f1752)).
- A Gemini batch run re-attaches to the unfinished run that actually holds a
  submitted job, rather than to the newest unfinished run for the root, so an
  interrupted interactive run over the same root can no longer cause a second
  job to be bought
  ([`7f1f175`](https://github.com/chomamateusz/ai-video-cataloger/commit/7f1f1752)).
- The `ListBatches` display-name lookup now collects matches across every page
  before choosing the newest by `createTime`; a duplicate name split over a page
  boundary previously re-attached to the older job
  ([`7f1f175`](https://github.com/chomamateusz/ai-video-cataloger/commit/7f1f1752)).
- A batch job that reports a success state while carrying a job-level error is
  classified as failed
  ([`7f1f175`](https://github.com/chomamateusz/ai-video-cataloger/commit/7f1f1752)).
- A read-only folder analysed under a path-derived folder id is reported as
  analysed after a restart. Folder-scoped scans now read the global index for
  such folders, so the desktop app no longer shows "Not Tracked" and offers to
  analyse work that is already done
  ([`7f1f175`](https://github.com/chomamateusz/ai-video-cataloger/commit/7f1f1752)).
- Failed Files API deletions after a batch run emit one
  `batch_uploads_retained` progress event per run naming the count, instead of
  being silent
  ([`7f1f175`](https://github.com/chomamateusz/ai-video-cataloger/commit/7f1f1752)).

## [0.5.22] - 2026-07-29

### Fixed

- A drive run over a tree that turned read-only after it was first indexed no
  longer dies with a raw `internal` EACCES on
  `.ai-video-cataloger/catalog.ndjson`. The end-of-run snapshot refresh — the
  one that follows a file relocated between folders — now degrades exactly like
  the per-file snapshot write: it counts towards `snapshotSkipped` and emits a
  `catalog_snapshot_skipped` warning, and the run completes
  ([`fe495c9`](https://github.com/chomamateusz/ai-video-cataloger/commit/fe495c97)).
- A `stale` credential entry is never served as a live key. Reading a provider
  whose only file copy is `stale` now reports `keychain_unavailable` when the
  Keychain refuses, and answers "no key" when the Keychain no longer holds the
  item — dropping that superseded copy instead of resurrecting it
  ([`6f4b7ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/6f4b7ea8)).
- Gemini batch drive runs survive several ways of losing a submitted job. A run
  now re-attaches to the latest unfinished run **of its own root**, so a run over
  another root in between no longer orphans a paid-for batch; the display-name
  lookup walks every page of `ListBatches` instead of only the first; several
  jobs sharing a display name resolve to the newest one with a logged warning;
  and a submit failure that is not a definitive API rejection keeps the persisted
  display name so recovery can still find a job that may exist
  ([`873f407`](https://github.com/chomamateusz/ai-video-cataloger/commit/873f4070),
  [`e6b6684`](https://github.com/chomamateusz/ai-video-cataloger/commit/e6b6684b)).
- A Gemini batch job that reports `done` together with an error is read as
  failed instead of succeeded, a state name without the `JOB_STATE_` prefix is
  understood, an unrecognized state is logged, and a per-request error is mapped
  by its gRPC status string (`UNAUTHENTICATED` / `PERMISSION_DENIED` →
  `provider_auth_failed`, `RESOURCE_EXHAUSTED` → `rate_limited`) as well as by
  the numeric HTTP code
  ([`873f407`](https://github.com/chomamateusz/ai-video-cataloger/commit/873f4070)).
- `gemini_batch_mode` is honoured per folder, exactly like the analyzer provider:
  a folder under a batch root can opt out and run interactively, and a folder
  under an interactive root can opt in. The `--gemini-batch` flag still wins over
  every folder key
  ([`873f407`](https://github.com/chomamateusz/ai-video-cataloger/commit/873f4070)).
- One malformed entry in `credentials.json` no longer makes the whole file
  unreadable: the bad entry is skipped, every other key keeps working, and
  `doctor` raises a `credential_entry_unreadable` warning naming the provider
  ([`14a7844`](https://github.com/chomamateusz/ai-video-cataloger/commit/14a7844a)).
- A completed Gemini batch run deletes the files it uploaded to the Files API
  instead of leaving them to expire after 48 hours (best effort — a delete that
  fails is logged, never fatal)
  ([`14a7844`](https://github.com/chomamateusz/ai-video-cataloger/commit/14a7844a)).
- Cancelling a Gemini batch run stops it at once instead of waiting out the
  current poll backoff, which reaches five minutes
  ([`14a7844`](https://github.com/chomamateusz/ai-video-cataloger/commit/14a7844a)).
- The whole-tree scope stays available when a tree holds no files on disk but
  the catalog still remembers absent ones, so the absent/forget section is
  reachable for entries search can already find
  ([`14a7844`](https://github.com/chomamateusz/ai-video-cataloger/commit/14a7844a)).

## [0.5.21] - 2026-07-28

### Added

- **Batch mode for Gemini drive runs** — an opt-in that submits a whole
  `process-drive` run to the Gemini Batch API, billed at **50% of the
  interactive token price**. Turn it on with the `gemini_batch_mode` config
  key, the `--gemini-batch` flag on `process-drive`, or the checkbox in the
  desktop drive-run settings; single-file `process` always stays interactive.
  Uploads still go file by file through the Files API, the run then submits one
  job and waits for it — usually minutes, up to 24 hours by the API's SLA — and
  every answer lands through the normal per-file path (transcript artifacts,
  rename, global catalog, cost event). The run's job name and per-file request
  mapping are persisted and flushed to disk before submission, so a run killed
  mid-flight re-attaches to the job it already paid for instead of submitting a
  second one. Design recorded in
  [ADR-0008](docs/decisions/0008-gemini-batch-drive-runs.md)
  ([`0288e1a`](https://github.com/chomamateusz/ai-video-cataloger/commit/0288e1af),
  [`2ef0091`](https://github.com/chomamateusz/ai-video-cataloger/commit/2ef0091c),
  [`9525155`](https://github.com/chomamateusz/ai-video-cataloger/commit/95251559),
  [`4c239b5`](https://github.com/chomamateusz/ai-video-cataloger/commit/4c239b5d),
  [`8d2514d`](https://github.com/chomamateusz/ai-video-cataloger/commit/8d2514df),
  [`bb02669`](https://github.com/chomamateusz/ai-video-cataloger/commit/bb026694),
  [`d67f004`](https://github.com/chomamateusz/ai-video-cataloger/commit/d67f004d),
  [`20f715e`](https://github.com/chomamateusz/ai-video-cataloger/commit/20f715ec)).
- NDJSON drive runs gain three additive steps — `batch_submitted` (job name,
  request count), `batch_poll` (job name, state) and `batch_completed` (job
  name, succeeded/failed counts)
  ([`8d2514d`](https://github.com/chomamateusz/ai-video-cataloger/commit/8d2514df)).

## [0.5.20] - 2026-07-28

### Fixed

- **Forget key** in Settings no longer closes the modal the moment the answer
  arrives: the outcome is rendered next to the field as a coloured notice
  (cleared everywhere = success, keychain retained or request failed = warning
  or error), so a Keychain that refused to release the key is finally readable.
  Closing the modal stays the user's action
  ([`b379411`](https://github.com/chomamateusz/ai-video-cataloger/commit/b3794111)).
- A credential migration can no longer overwrite a newer Keychain key with an
  older plaintext one. `credentials.json` entries now record their provenance
  (`{"value": …, "state": "pending" | "stale"}`, a bare string meaning
  "unmarked"); only a `pending` entry — one a degraded write created — wins a
  value conflict, and a `stale` entry is never promoted, not even into a
  Keychain that no longer holds the key. An unmarked conflict leaves the Keychain in charge and moves
  the file value aside to `credentials.json.conflict-<timestamp>` (mode 0600)
  instead of deleting it, and `doctor` raises a new `credential_value_conflict`
  warning naming the provider and that file. Forgetting a key clears those
  archives too
  ([`9c42037`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c420374),
  [`bb36129`](https://github.com/chomamateusz/ai-video-cataloger/commit/bb361297)).
- `delete-credential` now attempts the Keychain even when its availability probe
  fails, and distinguishes "no such item" (nothing cleared) from an unreachable
  Keychain (reported as retained), so a key is never announced as gone while the
  Keychain still holds it
  ([`9c42037`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c420374)).
- A Keychain read error with no plaintext fallback is reported as the new
  `keychain_unavailable` error (HTTP 503, CLI exit 44) instead of being flattened
  into "no API key stored"; the Settings and prerequisites panels say the login
  keychain is locked (en + pl)
  ([`9c42037`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c420374)).
- `doctor` stops reporting a degraded credentials backend once the Keychain
  answers again, including when the migration itself was the operation that
  succeeded
  ([`9c42037`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c420374)).
- Saving a credential from Settings while the macOS Keychain is unreachable no
  longer looks frozen: after two seconds the dialog says it is waiting for the
  Keychain and suggests unlocking it, instead of showing only `Saving…` for the
  ~20s the two `security` calls take to time out
  ([`387d33e`](https://github.com/chomamateusz/ai-video-cataloger/commit/387d33ea)).
- The CLI credential prompt writes its question to stderr and decides on raw
  mode from the same stream it gates on (stdin), so `config set-credential
  --json` with stdout redirected no longer mixes the prompt into its NDJSON and
  no longer leaves the terminal echoing the typed key
  ([`5e87b26`](https://github.com/chomamateusz/ai-video-cataloger/commit/5e87b268)).
- A Gemini native video upload survives a transient chunk failure: a failed
  chunk is retried up to three times with a short backoff, and each retry first
  asks the resumable session how many bytes it already holds, so a half-received
  chunk is resumed rather than sent twice. Non-retryable answers (a rejected key,
  a bad request) still abandon the session immediately. Chunk offsets now advance
  by the bytes actually read, so a short read no longer skips part of the file
  ([`dbecb18`](https://github.com/chomamateusz/ai-video-cataloger/commit/dbecb182)).

## [0.5.19] - 2026-07-28

### Fixed

- Model Manager no longer marks a managed Whisper model `Active` while the
  effective runtime is the system `whisper-cli`, which never reads those files —
  a row could read `Base [Active] · Not downloaded [Download]`. The banner keeps
  naming the runtime actually in use
  ([`2a4f543`](https://github.com/chomamateusz/ai-video-cataloger/commit/2a4f5439)).
- The Polish frame-count label declines properly: `1 klatka`, `2 klatki`,
  `5 klatek`, `22 klatki` instead of a fixed `klatek`. The English label now
  also says `1 frame` rather than `1 frames`
  ([`2b4fb45`](https://github.com/chomamateusz/ai-video-cataloger/commit/2b4fb45f)).
- `config set ui_language` / `faces_enabled` run outside `$HOME` no longer write
  a per-folder override that nothing reads: these keys are app-wide, so the CLI
  and the API always write them to the home config regardless of the working
  directory, and `config get` reads them back from there. The `config set`
  response names the `scope` it wrote, `config get <key>` carries
  `ignoredFolderValue`, and the CLI prints a `warning:` line naming a stray
  folder override it is ignoring
  ([`136aa4d`](https://github.com/chomamateusz/ai-video-cataloger/commit/136aa4d5)).
- `Nested Databases Detected` no longer blocks re-opening a root the app itself
  analyzed in whole-tree scope. A nested `.ai-video-cataloger` that carries our
  `folder-id` marker is our own lineage: `check` now returns it in the new
  `ownNestedPaths` field and leaves `hasNestedDatabases` false (exit 0), so the
  folder opens. A nested catalog directory without the marker is still foreign
  and still blocks the GUI open and exits `nested_databases_found`
  ([`5a04db6`](https://github.com/chomamateusz/ai-video-cataloger/commit/5a04db67)).
- Global search no longer fails with `Response data does not match the contract`
  (exit 10) once a read-only folder has been processed. A folder the app cannot
  write a marker into keeps a stable `path-<hash>` identity, but the contract
  still demanded a UUID; folder ids now travel as a named `folderIdSchema` union
  of both forms, in the contract and in the catalog/snapshot domain schemas
  ([`e754b62`](https://github.com/chomamateusz/ai-video-cataloger/commit/e754b62b)).
- `index forget` on a file inside a read-only folder now exits 0 instead of
  failing with `EACCES` (exit 10) after the global deletion had already
  happened. The folder-local catalog snapshot is skipped when the folder cannot
  be written, and the result says so: the response carries `snapshotSkipped` and
  the human line reads `Forgot <fingerprint> (folder snapshot not updated: the
  folder is not writable)`
  ([`84ebbbc`](https://github.com/chomamateusz/ai-video-cataloger/commit/84ebbbcf)).
- The packaged CLI now finds the ffprobe shipped inside the app bundle. Its only
  bundled-ffprobe lookup went through the `@ffprobe-installer/ffprobe` wrapper
  package, which is not staged, so on a machine without a system ffprobe
  `doctor` reported `ffprobe: missing` and every probe/analysis failed. The
  resolver now also looks the binary up by path from its own directory upwards
  through `node_modules`, which reaches
  `Resources/cli/node_modules -> app.asar.unpacked/node_modules`, and
  `verify:package` asserts both bundled binaries are reachable from the staged
  CLI ([`317c467`](https://github.com/chomamateusz/ai-video-cataloger/commit/317c467a)).
- A folder watcher that fails while the app is running (for example the watched
  root disappearing) no longer takes the Electron main process down with an
  uncaught error: the watch ends, closes its handle and reports a `read_error`
  to the caller, which drops the dead session
  ([`91f15e3`](https://github.com/chomamateusz/ai-video-cataloger/commit/91f15e3c)).
- Gemini native analysis no longer loads the whole video into memory (twice) to
  upload it: files above the inline cutoff are streamed to the Files API in 8 MB
  chunks straight from disk, so a 300 MB clip peaks at ~40 MB of buffers instead
  of ~900 MB. A file above the Files API 2 GB limit is now refused up front with
  a message naming the limit, instead of failing as an unexplained read error
  after the read was attempted
  ([`60917ec`](https://github.com/chomamateusz/ai-video-cataloger/commit/60917ec5)).
- The CLI credential prompts (`config set-credential` and `setup`) no longer
  write the typed key into the terminal at all. They previously relied on the
  ANSI conceal sequence, which only hides the characters visually and leaves the
  key in scrollback, in a copied selection and in any `script`/tmux capture
  ([`e47fab4`](https://github.com/chomamateusz/ai-video-cataloger/commit/e47fab45)).
- Keychain access runs the absolute `/usr/bin/security` instead of resolving
  `security` on `PATH`, so a shadowing binary earlier in `PATH` can no longer
  see or serve API keys
  ([`0aa12ae`](https://github.com/chomamateusz/ai-video-cataloger/commit/0aa12ae6)).
- Overlapping writes to the plaintext credentials file no longer collide on a
  shared `credentials.json.tmp`: each write uses its own temporary file and an
  atomic rename, so concurrent saves stop failing with
  `Could not store provider credential` and the file can never be left
  half-written
  ([`183d8f4`](https://github.com/chomamateusz/ai-video-cataloger/commit/183d8f48)).
- Forgetting a key when the plaintext credentials file cannot be read now
  reports the partial removal (`cleared: keychain`, `retained: file`) instead of
  a bare error that hid the Keychain removal that did happen
  ([`90d503e`](https://github.com/chomamateusz/ai-video-cataloger/commit/90d503ef)).
- A key saved while the Keychain was refusing writes is no longer discarded by
  the next migration: when the plaintext file and the Keychain hold different
  values for a provider, the file value wins, is write-verified into the
  Keychain and logged to `credentials-migration.ndjson` as
  `credential_value_conflict` (no secret in the line). An equal or absent file
  value keeps the previous keychain-wins behaviour
  ([`b26b0e6`](https://github.com/chomamateusz/ai-video-cataloger/commit/b26b0e6c)).
- A transient Keychain failure no longer makes the running app read and write
  API keys from the plaintext file until it is relaunched: every credential
  operation tries the Keychain again, an `unavailable` keychain is re-probed on
  the next access, an incomplete migration is retried, and a key that had to
  fall back to the file is moved into the Keychain as soon as it accepts writes.
  `doctor` reports `degraded` while that is true and returns to `keychain` by
  itself
  ([`4400231`](https://github.com/chomamateusz/ai-video-cataloger/commit/4400231e)).
- Forgetting a provider key now always reaches the Keychain: an earlier keychain
  failure in the same process no longer makes the deletion skip the Keychain and
  report an untouched pair of backends while the key was still stored there. A
  Keychain that refuses the removal is still reported as retained, and a key
  held by both backends now names both as cleared
  ([`995f5bc`](https://github.com/chomamateusz/ai-video-cataloger/commit/995f5bc9)).

## [0.5.18] - 2026-07-28

### Added

- The folder-scope catalog empty state now says how many videos the tree knows
  about in subfolders and offers a one-click switch to whole-tree scope; the
  bare `No videos found` stays when the whole tree is empty
  ([`1bb0e41`](https://github.com/chomamateusz/ai-video-cataloger/commit/1bb0e41f)).
- A stored provider key can be forgotten from the app: `DELETE /api/credentials`,
  `ai-video-cataloger config delete-credential <providerId> [--json]`, and a
  **Forget key** action beside the API key field in Settings. Each names the
  backends it cleared and never echoes the key
  ([`cf85e81`](https://github.com/chomamateusz/ai-video-cataloger/commit/cf85e81f)).

### Changed

- Credential deletion answers with the backends it cleared and the ones that
  kept the key: when the Keychain refuses while the plaintext file was cleared,
  CLI and Settings say the removal was partial instead of claiming the key is
  gone, and a keychain that kept the only copy is reported as nothing cleared,
  never as a key that was not stored. `CredentialsStore.delete` and
  `SecretsStore.delete` carry that shape
  ([`cf85e81`](https://github.com/chomamateusz/ai-video-cataloger/commit/cf85e81f),
  [`83be32b`](https://github.com/chomamateusz/ai-video-cataloger/commit/83be32bb)).
- Model Manager closes from a footer Close button instead of Escape or a
  backdrop click only, every downloaded model carries its own contained
  `Activate` button, and both Delete actions (whisper models and local AI
  tiers) render in the error palette
  ([`a724771`](https://github.com/chomamateusz/ai-video-cataloger/commit/a7247717)).
- The `Not Tracked` status token no longer renders grey-on-grey: its
  `theme.ts` palette entry moves to `#4e4e53` on `#e3e3e6` in light and
  `#c7c7cc` on a 20% tint in dark, which also lifts the search-result and
  absent-file surfaces that share the token
  ([`a724771`](https://github.com/chomamateusz/ai-video-cataloger/commit/a7247717)).
- The terminal panel starts collapsed while it has no output, expands by itself
  on the first line, and stays wherever the user last put it once they toggle
  it by hand
  ([`a724771`](https://github.com/chomamateusz/ai-video-cataloger/commit/a7247717)).

## [0.5.17] - 2026-07-28

### Changed

- The analyzer prompt is now retrieval-graded and shared by every provider:
  descriptions lead with what identifies the clip, the model is told to read the
  text visible in frame (signs, placards, registrations, dates, screens) and
  carry it into the description and the filename, the suggested filename may run
  up to eight kebab-case words and may not use filler like `video`, `clip` or
  `footage`, and tags are search handles (objects, place type, activity, notable
  text). The gemini-native provider reuses the same sections instead of its own
  copy; the `DESCRIPTION` / `FILENAME` / `TAGS` / `TRANSCRIPT` output contract is
  unchanged
  ([`b12d8e4`](https://github.com/chomamateusz/ai-video-cataloger/commit/b12d8e43)).

## [0.5.16] - 2026-07-28

### Changed

- API keys stored in `~/.ai-video-cataloger/credentials.json` migrate into the
  macOS Keychain on first access — written, read back, then removed from the
  file, with one NDJSON line per migrated provider in
  `~/.ai-video-cataloger/credentials-migration.ndjson`. `doctor` (human and
  `--json`) and `config set-credential` now name the backend holding the keys,
  and doctor warns when the Keychain was expected but unreachable. A Keychain
  failure falls back to the plaintext file instead of failing the command
  ([ADR-0007](docs/decisions/0007-credentials-in-keychain.md),
  [`500a0e7`](https://github.com/chomamateusz/ai-video-cataloger/commit/500a0e7f),
  [`7d36370`](https://github.com/chomamateusz/ai-video-cataloger/commit/7d363700)).

## [0.5.15] - 2026-07-28

### Added

- `doctor` and the readiness payload name the resolved whisper binary and its
  engine (`whisper.cpp` or `openai-whisper (python, CPU)`): dependency statuses
  carry an `engine` field and the readiness transcriber component carries
  `engine` and `binaryPath`
  ([`c69d9f3`](https://github.com/chomamateusz/ai-video-cataloger/commit/c69d9f3a)).
- `process` and `process-drive` accept `--provider <id>` to select a built-in
  analyzer provider by id (`openai`, `claude-code`, `codex`, `cursor-agent`,
  `local`, `gemini`), so harness providers no longer require a config write;
  it cannot be combined with the legacy `--analyzer` backend flag, which now
  rejects unknown values during parsing
  ([`c2b9a6b`](https://github.com/chomamateusz/ai-video-cataloger/commit/c2b9a6b5)).
- The readiness payload names the effective analyzer model, and `doctor` prints
  it as `(model: ...)` — `CLI default` for a harness provider left without a
  configured model, which is when the harness CLI picks the model itself
  ([`8ff73d8`](https://github.com/chomamateusz/ai-video-cataloger/commit/8ff73d87)).

### Fixed

- Readiness for a configured Gemini-native analyzer no longer fails the
  response contract: the readiness analyzer family accepts every analyzer
  family, not just `api`, `harness`, and `local`
  ([`8b53afd`](https://github.com/chomamateusz/ai-video-cataloger/commit/8b53afd6)).
- An empty `~/.ai-video-cataloger/bin` directory is reported as an incomplete
  managed whisper install pointing at
  `ai-video-cataloger models whisper-runtime install`, instead of an absent one
  that silently fell through to a slower system whisper; readiness components
  now carry that `warning` rather than dropping it
  ([`51cd626`](https://github.com/chomamateusz/ai-video-cataloger/commit/51cd6263)).

## [0.5.14] - 2026-07-27

### Added

- `pnpm run visual` — a Playwright screenshot suite that compares the layout
  skeletons (default, collapsed sidebar, open terminal, loading) in dark and
  light against darwin baselines committed under `visual/__screenshots__/`; it
  joins no required gate
  ([`453e15c`](https://github.com/chomamateusz/ai-video-cataloger/commit/453e15c0)).
- `components/layout/` as a named structural layer, enforced by the
  `web-layouts-are-structure-only` dependency-cruiser rule, a `Container`/
  `AppBar`/`Drawer`/`Toolbar` import ban outside it, and config-regression
  probes ([`6deecdc`](https://github.com/chomamateusz/ai-video-cataloger/commit/6deecdcc),
  [`9058063`](https://github.com/chomamateusz/ai-video-cataloger/commit/9058063f)).

### Changed

- `doc-lint` fails when a tracked `README.md` documents a `pnpm run <script>`
  that the owning `package.json` does not define, so a renamed or dropped script
  can no longer leave a quickstart that lies
  ([`8e4832a`](https://github.com/chomamateusz/ai-video-cataloger/commit/8e4832a3)).
- The package manager is pnpm 10 on Node 22.23.1: install with `pnpm install`
  under `nvm use`, dependency lifecycle scripts are blocked except for three
  allowlisted packages, and `lock-lint` now fails closed on a `pnpm-lock.yaml`
  that disagrees with `package.json`
  ([`977e0ec`](https://github.com/chomamateusz/ai-video-cataloger/commit/977e0ec9),
  [`fe5abdb`](https://github.com/chomamateusz/ai-video-cataloger/commit/fe5abdbc)).

## [0.5.13] - 2026-07-27

### Added

- Read-only folders open in a degraded, index-only mode: the catalog is indexed
  in the home database and the per-folder snapshot write is skipped instead of
  failing the run ([`f93cf33`](https://github.com/chomamateusz/ai-video-cataloger/commit/f93cf33d),
  [`eef7ac9`](https://github.com/chomamateusz/ai-video-cataloger/commit/eef7ac9a)).
- The opened folder tree is watched, so files added or removed on disk refresh
  the sidebar without a manual rescan
  ([`e5308b9`](https://github.com/chomamateusz/ai-video-cataloger/commit/e5308b9f)).
- The setup wizard offers the Gemini-native analyzer and skips transcription
  setup for it, since that provider reads the video directly
  ([`dd58ce2`](https://github.com/chomamateusz/ai-video-cataloger/commit/dd58ce2a),
  [`a7679a9`](https://github.com/chomamateusz/ai-video-cataloger/commit/a7679a91)).

## [0.5.12] - 2026-07-27

### Added

- Gemini-native video analysis: a provider that uploads the video itself
  instead of extracted frames, selectable in Settings → AI Analyzer
  ([`6fcd43a`](https://github.com/chomamateusz/ai-video-cataloger/commit/6fcd43ae),
  [`2b96575`](https://github.com/chomamateusz/ai-video-cataloger/commit/2b96575f)).

## [0.5.10] - 2026-07-26

### Fixed

- The detail player defaults subtitles on, boxes the video at its true aspect
  and lays the panel out in two columns
  ([`bc0dc5d`](https://github.com/chomamateusz/ai-video-cataloger/commit/bc0dc5d7)).
- Force-analyze shows Processing immediately and the tree detail refreshes when
  the run completes ([`09f9c00`](https://github.com/chomamateusz/ai-video-cataloger/commit/09f9c000)).
- Search results gained a back affordance and 56px thumbnails
  ([`3dfb974`](https://github.com/chomamateusz/ai-video-cataloger/commit/3dfb974a)).
- `doctor` detects a stale CLI shadowing the current one on `PATH` and names the
  shadow in the install flow
  ([`7014d4e`](https://github.com/chomamateusz/ai-video-cataloger/commit/7014d4ec)).

## [0.5.9] - 2026-07-26

### Added

- Analyze scope is remembered per folder, and the setup wizard can be re-entered
  from the app ([`5f81160`](https://github.com/chomamateusz/ai-video-cataloger/commit/5f811606)).
- A run summary dialog replaces the transient skipped chips
  ([`de898ac`](https://github.com/chomamateusz/ai-video-cataloger/commit/de898aca)).
- `health` splits live and ready, and responses travel through one response seam
  ([`8cfbb2c`](https://github.com/chomamateusz/ai-video-cataloger/commit/8cfbb2c3)).

### Changed

- Contracts are validated with zod 4
  ([`d265f2e`](https://github.com/chomamateusz/ai-video-cataloger/commit/d265f2ec)).
- `pnpm run check` gained knip, doc-lint and a coverage ratchet; a local ESLint
  plugin enforces query descriptors and the event-name taxonomy
  ([`8b5bbba`](https://github.com/chomamateusz/ai-video-cataloger/commit/8b5bbba0),
  [`f1e8d7d`](https://github.com/chomamateusz/ai-video-cataloger/commit/f1e8d7d8)).
- CI runs on self-hosted workflows with an `ai-review` job
  ([`12bdbdf`](https://github.com/chomamateusz/ai-video-cataloger/commit/12bdbdfb)).

### Fixed

- `ui_language` and `faces_enabled` resolve app-global, so a poisoned per-folder
  config can no longer flip the UI language
  ([`b8820c2`](https://github.com/chomamateusz/ai-video-cataloger/commit/b8820c2c)).
- A restored file clears its absent flag through a self-healing absent list
  ([`15f06a6`](https://github.com/chomamateusz/ai-video-cataloger/commit/15f06a67)).
- The canonical row for duplicate files is chosen by a deterministic tie-break
  ([`0ca4a9b`](https://github.com/chomamateusz/ai-video-cataloger/commit/0ca4a9bb)).

## [0.5.8] - 2026-07-25

### Fixed

- Status badge icons align with their labels and the frame gallery is fully
  translated ([`7bbaac7`](https://github.com/chomamateusz/ai-video-cataloger/commit/7bbaac77)).

## [0.5.7] - 2026-07-25

### Fixed

- The catalog write lock renews its lease across long jobs and is released when
  a job fails ([`c2dc5b6`](https://github.com/chomamateusz/ai-video-cataloger/commit/c2dc5b67)).
- Whole-tree analyze is available on a tree that has not been indexed yet
  ([`4386f9f`](https://github.com/chomamateusz/ai-video-cataloger/commit/4386f9f8)).
- A search result opens its detail view, and Reveal in Finder works across
  folders ([`debd583`](https://github.com/chomamateusz/ai-video-cataloger/commit/debd583e)).
- Absent files are fetched with one tree-scoped query instead of one per folder
  ([`ba9b91b`](https://github.com/chomamateusz/ai-video-cataloger/commit/ba9b91bc)).
- The media scheme answers HEAD and returns 416 for an unsatisfiable range
  ([`f8113f1`](https://github.com/chomamateusz/ai-video-cataloger/commit/f8113f14)).
- A relocated file keeps the original row chosen by first-seen time rather than
  path sort order ([`9068f55`](https://github.com/chomamateusz/ai-video-cataloger/commit/9068f550)).
- UX audit batch: untranslated strings, accessibility labels, plurals and
  tooltips ([`10b47b0`](https://github.com/chomamateusz/ai-video-cataloger/commit/10b47b0f)).

## [0.5.6] - 2026-07-24

### Added

- Reveal in Finder from video, folder and search rows
  ([`b797cdb`](https://github.com/chomamateusz/ai-video-cataloger/commit/b797cdb8)).
- Absent files appear in tree mode grouped by folder
  ([`273d196`](https://github.com/chomamateusz/ai-video-cataloger/commit/273d196d)).

### Fixed

- Media is served over a standard scheme with HTTP Range support, so seeking
  works in the player ([`8c4ebe4`](https://github.com/chomamateusz/ai-video-cataloger/commit/8c4ebe45)).
- A duplicate clone no longer steals the canonical catalog row
  ([`0eff6de`](https://github.com/chomamateusz/ai-video-cataloger/commit/0eff6de1)).
- The Settings UI-language switch is written home-scoped and takes effect
  ([`31ea1b5`](https://github.com/chomamateusz/ai-video-cataloger/commit/31ea1b5f)).
- Selecting a video in the sidebar clears an active search
  ([`2cb32a0`](https://github.com/chomamateusz/ai-video-cataloger/commit/2cb32a0e)).

## [0.5.5] - 2026-07-24

### Changed

- The packaged bundle is smaller and ships a sealed ad-hoc signature
  ([`567c715`](https://github.com/chomamateusz/ai-video-cataloger/commit/567c7153),
  [`418648e`](https://github.com/chomamateusz/ai-video-cataloger/commit/418648e0)).

### Fixed

- The window is shown at `whenReady`, removing the black frame at launch
  ([`d7614b1`](https://github.com/chomamateusz/ai-video-cataloger/commit/d7614b12)).

## [0.5.4] - 2026-07-24

### Fixed

- Sidebar round three: rail width, scope selection, thumbnail loading state,
  duplicate detail and badge spacing
  ([`0625abd`](https://github.com/chomamateusz/ai-video-cataloger/commit/0625abd0)).

## [0.5.3] - 2026-07-24

### Fixed

- The desktop window appears immediately and app composition is deferred behind
  it ([`c5f5c0e`](https://github.com/chomamateusz/ai-video-cataloger/commit/c5f5c0eb)).

## [0.5.2] - 2026-07-24

### Added

- A startup splash and loading skeletons for the sidebar and detail panel
  ([`731da27`](https://github.com/chomamateusz/ai-video-cataloger/commit/731da274)).

### Changed

- Sidebar tree v2: one scroll container, exact per-folder counts and duplicate
  badges ([`55b6ad2`](https://github.com/chomamateusz/ai-video-cataloger/commit/55b6ad25)).

## [0.5.1] - 2026-07-24

### Added

- A single-writer catalog lock that names the holding process
  ([`f619f29`](https://github.com/chomamateusz/ai-video-cataloger/commit/f619f291),
  [`893e4f6`](https://github.com/chomamateusz/ai-video-cataloger/commit/893e4f6a)).
- Lazy folder scanning and windowed lists, with guidance for very large runs
  ([`b4a19a5`](https://github.com/chomamateusz/ai-video-cataloger/commit/b4a19a5e)).

### Fixed

- Reconciliation covers moved and emptied folders
  ([`6c4767d`](https://github.com/chomamateusz/ai-video-cataloger/commit/6c4767d9)).
- Forgetting an entry and re-indexing an engine clean up face data
  ([`53933ef`](https://github.com/chomamateusz/ai-video-cataloger/commit/53933ef3)).
- Read-only mode disables every mutating action, not just the obvious ones
  ([`8e3670e`](https://github.com/chomamateusz/ai-video-cataloger/commit/8e3670e8)).
- Remaining untranslated strings in settings, steps and the people log
  ([`8c1a64d`](https://github.com/chomamateusz/ai-video-cataloger/commit/8c1a64da)).

## [0.5.0] - 2026-07-24

### Added

- A sidebar folder tree with scope-aware analyze: per-file live progress, a stop
  control and skip badges
  ([`1bd1f6b`](https://github.com/chomamateusz/ai-video-cataloger/commit/1bd1f6bc)).
- A coherent setup wizard with a readiness checklist and model pickers
  ([`592867d`](https://github.com/chomamateusz/ai-video-cataloger/commit/592867df)).
- Content presentation: detail tags, source-aspect thumbnails, an inline player
  with subtitles and a search dropdown
  ([`5c8bb05`](https://github.com/chomamateusz/ai-video-cataloger/commit/5c8bb056)).
- A UI language layer (EN/PL) covering the desktop app and the wizard
  ([`fe7252a`](https://github.com/chomamateusz/ai-video-cataloger/commit/fe7252ab),
  [`9235f67`](https://github.com/chomamateusz/ai-video-cataloger/commit/9235f676),
  [`eb983e0`](https://github.com/chomamateusz/ai-video-cataloger/commit/eb983e04),
  [`999a3d6`](https://github.com/chomamateusz/ai-video-cataloger/commit/999a3d6b)).
- An output-language setting for generated summaries and names
  ([`c4765e4`](https://github.com/chomamateusz/ai-video-cataloger/commit/c4765e47)).
- Missing-file reconciliation with an absent-files section in the folder view
  ([`c72e6bc`](https://github.com/chomamateusz/ai-video-cataloger/commit/c72e6bcf),
  [`99ddeb2`](https://github.com/chomamateusz/ai-video-cataloger/commit/99ddeb2c)).

### Fixed

- Thumbnails are generated at the source aspect ratio
  ([`a85bf23`](https://github.com/chomamateusz/ai-video-cataloger/commit/a85bf234)).
- Whisper hallucinations on near-silent audio are filtered out
  ([`9c6c35d`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c6c35d1)).
- A moved file is no longer reported as missing
  ([`a9b12ee`](https://github.com/chomamateusz/ai-video-cataloger/commit/a9b12eee)).
- Model selection is scoped per analyzer harness
  ([`938b76f`](https://github.com/chomamateusz/ai-video-cataloger/commit/938b76ff)).

## [0.4.2] - 2026-07-23

### Added

- The packaged app carries an icon generated from the brand logo
  ([`a53ea0b`](https://github.com/chomamateusz/ai-video-cataloger/commit/a53ea0b5)).

### Fixed

- Harness path resolution, the packaged CLI's WASM asset, catalog flushing and
  chip spacing ([`8b5fff4`](https://github.com/chomamateusz/ai-video-cataloger/commit/8b5fff4d)).

## [0.4.1] - 2026-07-23

### Added

- Analyze a whole folder tree from the desktop app
  ([`249b9b0`](https://github.com/chomamateusz/ai-video-cataloger/commit/249b9b02)).

## [0.4.0] - 2026-07-23

### Added

- A home-scoped global catalog: folder identity, content fingerprints, a SQLite
  index and per-folder NDJSON snapshots
  ([`6833161`](https://github.com/chomamateusz/ai-video-cataloger/commit/68331616)).
- Global search across the catalog through an FTS4 index, in the CLI and the
  desktop UI ([`744b885`](https://github.com/chomamateusz/ai-video-cataloger/commit/744b8855)).
- Local face grouping: an opt-in ONNX pipeline, a people view and face settings
  ([`dbcc5fd`](https://github.com/chomamateusz/ai-video-cataloger/commit/dbcc5fd1),
  [`a232969`](https://github.com/chomamateusz/ai-video-cataloger/commit/a232969f),
  [`a7ba8bf`](https://github.com/chomamateusz/ai-video-cataloger/commit/a7ba8bf6),
  [`209f398`](https://github.com/chomamateusz/ai-video-cataloger/commit/209f3981)).
- A whole-drive runner with discovery, resume, backoff and run bookkeeping
  ([`7afcecc`](https://github.com/chomamateusz/ai-video-cataloger/commit/7afcecc9)).
- Analyzer tags and GPS capture in the catalog
  ([`c3f69fc`](https://github.com/chomamateusz/ai-video-cataloger/commit/c3f69fcd)).
- API keys are stored in the macOS Keychain, falling back to the config file
  ([`2e7682a`](https://github.com/chomamateusz/ai-video-cataloger/commit/2e7682a0)).

### Fixed

- Forgetting a person deletes its biometric observations instead of only
  unassigning them ([`7ad0156`](https://github.com/chomamateusz/ai-video-cataloger/commit/7ad01567)).
- Snapshot export is atomic, rejects newer-major snapshots and counts malformed
  lines ([`4854893`](https://github.com/chomamateusz/ai-video-cataloger/commit/4854893b)).
- A file that cannot be fingerprinted raises a warning event instead of failing
  silently ([`7311f32`](https://github.com/chomamateusz/ai-video-cataloger/commit/7311f32a)).
- Global-catalog writes are batched, removing quadratic write amplification on
  large folders ([`6d61c59`](https://github.com/chomamateusz/ai-video-cataloger/commit/6d61c59b)).
- Face indexing is resumable and clusters across runs; aligned crop pixels are
  released so memory stays proportional to faces per file
  ([`0096970`](https://github.com/chomamateusz/ai-video-cataloger/commit/0096970b),
  [`0238e50`](https://github.com/chomamateusz/ai-video-cataloger/commit/0238e508)).
- The Keychain lookup times out after 10s and falls back to the config file
  ([`9376f92`](https://github.com/chomamateusz/ai-video-cataloger/commit/9376f925)).
- `whisper-cli` is preferred over CPU python whisper in system resolution
  ([`1180650`](https://github.com/chomamateusz/ai-video-cataloger/commit/11806500)).
- Local AI requirements are probed only when the local analyzer is chosen
  ([`dee91a2`](https://github.com/chomamateusz/ai-video-cataloger/commit/dee91a20)).
