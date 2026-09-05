# Architecture — AI Video Cataloger (local-first Electron)

Normative reference for this app. This document is a **delta** against the
agentproofarch foundation architecture; its rules apply here except where this
document overrides them. Provenance: foundation docs as of 2026-07-12;
local-first decisions in
[ADR-0001](decisions/0001-local-first-electron.md). Product scope:
[`../tasks/prd-foundation-rewrite.md`](../tasks/prd-foundation-rewrite.md);
behavioral ground truth: [`../tasks/parity-inventory.md`](../tasks/parity-inventory.md).

## Inherited verbatim (not restated here)

Layer discipline and dependency rules, `core/contract` as the only bridge,
`Result<T, AppError>` + closed `ErrorCode` taxonomy with CLI exit codes,
CQRS-partitioned actions, the entire frontend architecture
(routes/features/ui/layout/lib, bound actions, features are islands, layouts are
structure only, no client event bus, visual language only in `theme.ts`), the
server-state policy
(`server-state.md`), the lint-enforcement method (warn → fix → error, probes
prove rules, suppression policy), wide events over the `@opentelemetry/api`
facade, and the two gates (`check` static, `smoke` runtime; static-green is
not done).

## Delta 1 — local-first: the app IS the server

There is no remote backend and no network dependency for core functionality.
The Hono app from `apps/server` is composed **in-process** by two composition
roots:

| Process | Composition root | Client transport |
|---|---|---|
| Electron main | `apps/desktop` | `fetchImpl := honoApp.request` |
| CLI | `apps/cli` (via the shared `createApp` factory) | same |

`core/contract` + the typed client survive unchanged — zod envelope,
taxonomy, descriptors, CQRS branding all run over Hono's fetch-compatible
`app.request`. The contract stays the single bridge; only the medium changed.
The Electron renderer adapts `DesktopApiBridge.request` to the same fetch
surface. Aborting its `AbortSignal` rejects the renderer-side promise with
`AbortError` and suppresses any later IPC response. The preload request has no
physical cancellation channel, so a request already dispatched to the main
process still completes there; renderer cancellation means local settlement,
not server-side interruption.
The foundation's deployment matrix (Vercel/Docker), public surface
(embeds/headless API), and domain provisioning do not apply and are removed,
not stubbed.

Concurrent access (GUI + CLI on the same catalog) is mediated by a
home-scoped advisory `catalog.lock` file next to `catalog.db`, not a lock
server. The lock records the owning process (pid/hostname/name) and is
acquired per `lockMode` — `none` (CLI reads), `lazy` (acquire on first
write), or `eager` (acquire at startup) — with a process-alive check that
lets a live peer block and a dead peer's stale lock be taken over. A running
job holds the lease for its whole run; one-off mutations flush without
dropping it. A flush that fails to persist keeps its dirty rows in memory and
keeps the lock, because dropping it would let a peer write the file that the
retry is about to overwrite; the failure is reported through
`durabilityStatus()` (`degraded`, `pendingWrites`, `lastErrorCode`), which the
bottom bar, `index status` and `photos status` surface, while the write itself
still reports success. When the lock can't be acquired the renderer drops to a
read-only banner and offers retry. See ADR-0002 Consequences.

## Delta 2 — no identity

Single implicit local user. `AuthPort`, `AuthClientPort`, tenants, members,
`ctx: { identity }` and every identity-related table/rule are stripped — they
were the foundation's walking skeleton, not obligations. Use-cases take their
subject (usually a folder path or video id) directly. Nothing may reintroduce
an identity concept without a new ADR.

## Delta 3 — persistence

SQLite (drizzle) behind repository ports; the composition root picks the
driver (foundation's `DB_DRIVER` pattern). Default driver: **sql.js** (wasm,
via `drizzle-orm/sql-js`) — the old app already ships it, the files are
ordinary SQLite so compatibility is structural, and it avoids native-module
rebuilds in Electron packaging; `better-sqlite3` is the named alternative if
sql.js performance ever hurts (that swap is exactly what the port is for).
Two scopes remain, with catalog ownership revised by
[ADR-0002](decisions/0002-global-catalog-layer.md):

- **Global catalog index** — `~/.ai-video-cataloger/catalog.db` is the
  canonical working store for catalog rows. Folder identity is a UUID marker
  stored inside `{folder}/.ai-video-cataloger/`; paths are attributes that can
  change, not identities. The repository dimension is one global database keyed
  by folder id and content fingerprint. A file has one row per fingerprint and
  its analyses are variants keyed by `(fingerprint, configId)`. The `configId`
  is `cfg_` plus the first 12 hex characters of SHA-256 over the normalized,
  key-sorted config descriptor. That closed descriptor includes every
  result-shaping analyzer field, the transcription source, frame count where
  applicable, `output_language`, `tag_language` when it is pinned, and
  `promptVersion`. See
  [ADR-0010](decisions/0010-analysis-variant-identity-artifacts-and-dedup.md).
- **Per-folder sidecar artifacts** — `{folder}/.ai-video-cataloger/config.json`
  stays folder-scoped. `{folder}/.ai-video-cataloger/catalog.ndjson` is a
  derived snapshot written after processing and imported when a marked folder
  is unknown to the local index. Existing per-folder `catalog.db` files remain
  readable for migration but are not the canonical write target. Its
  `videos.status` columns describe the last processing run for each path;
  configuration-specific analysis state is canonical only in the global index.
  Shared inputs live in the content-addressed
  `.ai-video-cataloger/artifacts/frames/{fingerprint}/{framesKey}/` and
  `.ai-video-cataloger/artifacts/transcripts/{fingerprint}/{transcriptKey}.txt|.json`
  trees. Per-variant outputs live in
  `.ai-video-cataloger/variants/{fingerprint}/{configId}/`. The established
  name-based `frames/`, `transcripts/`, and `summaries/` paths remain a
  selected-variant projection, materialized as hard links with a copy fallback
  and re-pointed atomically when selection changes. Every completed processing
  run leaves that projection materialized for the resolved selected variant,
  and a run's own variant takes selection when the resolved one is an
  index-only record (`legacy`, imported from a pre-variant catalog) with no
  artifacts to project.
- **Home scope** — `~/.ai-video-cataloger/` also holds global model state,
  managed runtime files, whisper models, provider credentials, and the
  append-only spend ledger and read-only mirror below.

**`GET /api/scan` no longer creates a per-folder `catalog.db` (dated
2026-08-03, W34a).** `CatalogRepositoryFactory.open` is a create-if-missing
funnel (schema init + an eager persist), which made `scanFolder`/
`cachedScanFolder` — pure reads — write a legacy `catalog.db` for a folder
never processed before, violating the CQRS split this section otherwise
documents. `openIfExists` is the read-path counterpart: it returns the open
repository when `{folder}/.ai-video-cataloger/catalog.db` already exists on
disk, `null` otherwise, and never creates one; `scanFolder`/`cachedScanFolder`
use it, while `process`/`process-drive`/`status`/`reset` — the paths that
actually own catalog writes — keep calling `open`, unchanged. Folder-identity
marker creation on a first scan (`{folder}/.ai-video-cataloger/folder-id`,
W35a) is a separate, already-sanctioned write and is unaffected. Scan's
`writable` signal for artifact-root resolution still comes from
`CatalogRepository.writable()` whenever a catalog exists — the same signal
`process` uses, so the two never disagree about where a folder's artifacts
live — and falls back to the marker write's own result only for a folder that
has no catalog at all, where the old code would have created one. A read-only
folder that still carries a marker from a writable era therefore stays in
index-only mode instead of reading as untracked. The
hybrid is not fully closed: scanning a folder that already has a legacy
`catalog.db` still rewrites that file on open (`persistWhereWritable` runs
unconditionally inside `open`) — a pre-existing characteristic of the sql.js
adapter, not new here, and out of scope for this pass; only *creating* one
newly is fixed.

`files` and the photos store's `photos` each carry a nullable
`hidden_at INTEGER` (migrations V17 / v7), the browse-visibility annotation
behind Kolekcja's hide action; `hiddenAt` travels in the `catalog.ndjson`
snapshot from `CATALOG_SNAPSHOT_SCHEMA_VERSION` 13 onwards and is never
cleared by a scan, an analysis run or a snapshot import **over an existing
row** — it is excluded from the upsert conflict clause, so only an INSERT of a
row the index does not have carries it. See "Library — hide and
move-to-trash" below and
[ADR-0020](decisions/0020-library-hide-and-trash.md).

Exactly one variant resolves as selected for a file. Resolution uses the
file's explicit `selected_config_id` when that variant exists, then the viewing
folder's default configuration when that variant exists for the file, then the
newest variant by `createdAt` with `configId` as the tie-breaker. A folder's
default is its explicit `folders.default_config_id`, or otherwise the configId
of its resolved processing configuration. Explicit selection is stored per
fingerprint and is therefore shared by duplicate copies of the content; only
the folder-default fallback is folder-relative. Search indexes the resolved
variant only.

Translation imports add a fifth closed video config-descriptor family,
`translation`, whose identity carries `providerId`, `model`, and
`sourceConfigId` together with pinned Polish output/tag languages and the
translation prompt version. `POST /api/variants/import-translation` accepts an
NDJSON path plus dry-run/selection flags; the CLI reaches it only through the
shared typed client. The server validates every non-empty line with zod, skips
invalid rows and missing `(fingerprint, sourceConfigId)` analyses without
aborting valid rows, copies the source transcript verbatim into the new
analysis, normalizes imported tags through `normalizeTagList`, and upserts the
translation variant. All catalog mutations for the entire NDJSON batch are
enclosed in one sql.js transaction. Search-document writes are deferred during
that batch and each affected fingerprint is rebuilt once after its final
selection is known.
Dry runs perform the same parsing, source lookup, identity derivation, and
created/updated classification without artifact or catalog writes.

Translation artifacts are self-contained below
`.ai-video-cataloger/variants/{fingerprint}/{translationConfigId}/`: source
frames are hard-linked into `frames/`, source transcript text/JSON into
`transcript.txt`/`transcript.json`, and source summary/debug outputs retain the
normal per-variant names. `FileSystemPort.copyFile` is the fallback when a hard
link is unavailable. This duplicates directory entries, and sometimes bytes
across filesystems, but keeps translation selection honest and simple: the
existing projection path reads only the translation config directory and does
not need to reconstruct or globally alias the source descriptor's shared
artifact keys.

`files` records where a coordinate came from — `gps_source`
(`camera | timeline | manual`), `gps_accuracy_m`, `gps_interval_kind`
(`visit | activity | path` for a timeline fix), `gps_resolved_at` — and a
capture instant, `captured_at`, always in UTC from the container's
`creation_time`, never a filename. A pure precedence rule
(`manual > camera > timeline`) guards every write, including reprocessing: a
probe that finds no GPS never erases a stored coordinate. `search_documents`
carries a `place` column alongside `tags_text`, ranked between tags and the
final name, so a resolved place name is searchable rather than requiring a
render-time geocode; the renderer never resolves places itself — every place
string it shows comes from the catalog row. The `gps backfill <timeline.json>`
job-backed use case (`core/server/usecases/gps-backfill.ts`) matches each
file's `captured_at` against a parsed Google Timeline export
(`core/domain/timeline.ts`), writes through
`GlobalCatalogStore.applyGeoBackfill` (which re-checks the precedence rule
inside the transaction), and resolves place text through the offline
`PlacesPort` — a nearest-settlement lookup over a versioned, self-generated
GeoNames snapshot, never a render-time geocoder. See
[ADR-0015](decisions/0015-timeline-gps-provenance-and-offline-places.md) for
the schema and the still-pending production dataset.

A source folder that cannot be written to (write-protected external drive,
`chmod -w`) is not a failure: opening its catalog degrades to an in-memory
repository (`CatalogRepository.writable()` reports it), artifacts are mirrored
to `~/.ai-video-cataloger/read-only-folders/{folderId}/`, renaming is forced
off, the NDJSON snapshot is skipped with a `catalog_snapshot_skipped` warning
per file, and the analysis still lands in the canonical global index. See
[ADR-0002](decisions/0002-global-catalog-layer.md) §(f). Read-only detection is
verified against a real mount, not a simulated one: the `ro-mount` legs of
`pnpm run test:e2e:matrix` build a disk image with `hdiutil`, re-attach it
`-readonly`, and assert index-only mode end to end — Node 22 reports a
rejected recursive directory creation on such a mount as `ENOENT`, so a
permission-simulating fake cannot stand in for one.

Artifact-root discovery still returns the writable on-volume root first when
the folder carries a folder marker. Only when no marker is present does it
fall through to the read-only mirror lookups: the catalog folder id when the
folder record is already known, then the current path-derived id, then the
legacy NFD-derived id, and finally the writable root as the last resort. That
keeps a mirror reachable by its stable catalog id after a read-only folder is
renamed or moved, without letting a stale mirror shadow a folder that has
since become writable.

A folder analysed read-only can be **materialized** once its mount becomes
writable: `materialize <root>` looks every file up by fingerprint, takes the
selected variant, and replays the writes the writable path would have made —
folder marker and folder row, the content-addressed artifacts and the variant
outputs copied out of the read-only mirror, the date-prefixed rename with the
established `-2` collision suffix, the catalog's `finalName`/`fileName`, the
selected-variant projection, the thumbnail, and the `catalog.ndjson`
snapshot. It re-analyses nothing (its dependencies are the filesystem and the
global catalog, nothing else), applies only the writes that are missing, and
repeats as a no-op. The non-canonical per-folder `catalog.db` is the one
write it does not replay. `finalName` is written to the catalog before the
rename and `fileName` after it, so the canonical copy is reachable by name at
every instant and the reachability sweep can never clear a live analysis.

`process` and `process-drive` write each completed file's thumbnail at the
tail of `processVideoPipeline`, from the projected variant's first stored
analysis frame, landing it in the same artifact root as the rest of the
projection — the home mirror on a read-only source, the folder itself
otherwise. `thumbnails <root>` backfills the same cover for a whole tree on
demand. Neither introduces a new artifact layout or variant model: both read
ADR-0002's artifact layout and ADR-0010's variant projection rather than
re-deriving them, so no new ADR is needed for this track.

### Grid thumbnails (~512, frame-first)

Alongside the 128x72 cover, `process`/`process-drive` and `photos proxies`
also generate a second, ~512px square, center-cropped "grid" thumbnail —
`GRID_THUMBNAIL_EDGE` in `core/server/usecases/shared.ts` — landing as a
`.grid.jpg` sibling of the existing cover: `<catalogDirectory>/thumbnails/
<base>.grid.jpg` for videos, `photo-artifacts/thumbs/<fingerprint>.grid.jpg`
for photos. `MediaPort.thumbnailFromFrame` gains an optional
`fit: 'inside' | 'cover'` (default `'inside'`, today's behaviour); `'cover'`
scales to fill and center-crops, implemented once in the ffmpeg adapter and
reused for both videos and photos. `thumbnails <root>` backfills the grid
cover for the same tree as the small one (counters
`gridGenerated`/`gridSkipped`/`gridFailed`, additive to the existing
summary); a new `photos grid-thumbs` job/route backfills every existing
photo proxy the same way. `search`/`/api/search` results and
`photosList`/`photosDetail`/`photosSearch` gain `gridThumbnailPath`/
`gridThumbPath` (existence-only in `'existing'` mode; generated only when an
acceptable source exists in `'ensure'` mode) — additive fields, old
consumers keep parsing.

Existence alone never satisfies the grid-thumbnail pass — only resolution and
provenance do (owner rule, W28). The small 128x72 cover (or any source whose
short edge is below `GRID_THUMBNAIL_EDGE`) is never an acceptable grid
source: two thumbnail sizes exist by design (a sidebar-scale cover and a
512px library grid), and the generator refuses to fake the second by
upscaling the first. `generateGridThumbnail` (`core/server/usecases/
thumbnail.ts`) takes a priority-ordered list of candidate sources — the
stored analysis frame first, then a source-video seek when the drive is
reachable for videos; the photo proxy first, then the original photo when
the drive is reachable for photos — probes each with `MediaPort.probe` and
picks the first whose short edge meets the floor. When none qualifies, any
existing `.grid.jpg` is deleted rather than left stale, and the search/photo
list rows report `null` for it rather than a path to a file that is not
there. The library and photo tiles then fall back to the small cover and
render it `object-fit: contain` — at its own size, letterboxed inside the
tile — where a real grid thumbnail is rendered `cover`: a source too small
for the grid is shown honestly small, never crop-upscaled. Because the
check re-probes the current best source on every pass (not just at
first-generation time), an already-generated grid thumb that was built from
what was then the only source but a better one has since become reachable
gets regenerated even without `--force`; a fallback (non-primary) source
always regenerates, bypassing the normal exists-skip.

Existing databases and on-disk artifacts written by the old implementation
must remain readable with no migration. The Library's Kolekcja surface
triggers this same backfill pass (`force: false`) once per catalog folder
per app session, the moment it becomes active
(`features/library/use-thumbnails-backfill.ts`) — it is a trigger, not a new
algorithm: the existing non-forced pass already regenerates any grid thumb
whose winning source is a fallback (see above), this just makes sure the
pass actually runs so pre-existing blurry tiles get swept without the owner
running `thumbnails` by hand.

**Photo counterpart, wired in W39.** `enqueuePhotoGridThumbs`/
`runPhotoGridThumbsPass` (`core/server/usecases/photos.ts`) and the
`POST /api/photos/grid-thumbs` route existed since the grid-thumbnail work
above shipped, but nothing in the renderer ever called it — the video
trigger's photo counterpart was a systemic gap, not a design choice. The
Kolekcja now fires the same trigger shape
(`features/library/use-photo-thumbnails-backfill.ts`, mirroring
`use-thumbnails-backfill.ts`): once per app session, `force: false`,
background priority, the moment Kolekcja is active and at least one photo
root is visible. Unlike the video trigger there is one call, not one
per root — `runPhotoGridThumbsPass` sweeps every photo proxy in the catalog
in a single pass, it takes no root parameter, so a second per-root call
would just re-walk the same set. No new generation logic: the existing pass
already regenerates a missing `.grid.jpg` and self-heals a stale one exactly
like the video pass does, once it actually runs. The trigger follows the
accepted job to a terminal state and invalidates both photo and
`libraryCollection` query scopes after every terminal outcome, including
completion, failure, cancellation, a disappeared job, or a polling error.
Invalidation is a cheap reconciliation step: limiting it to successful
completion could leave a collection tile with stale null image paths after a
server restart. Renderer teardown aborts the renderer-side status promise and
its pending delay, so the poller cannot issue another fetch or invalidate
queries after unmount.

Expanded sub-folder rows in the catalog tree get the same foreground
thumbnail priority as the root list, scoped to the windowed-visible range
(`CatalogTree.tsx`): every expanded folder's videos used to land in one
`'background'` burst regardless of scroll position, so a visible row could
queue for minutes behind an off-screen folder's whole video list on the
shared 4-way ffmpeg thumbnail queue (`adapters/ffmpeg/index.ts`, strict
two-tier foreground-then-background FIFO). The videos inside the current
windowed range now go through a second `useThumbnailGeneration` call with
`'viewport-first'`, off-screen rows stay `'background'`.

Processing-config resolution (owner decision 2026-07-17): **explicit CLI
flag > folder config > home config > built-in default**, per key. The home
scope holds global defaults (the wizard and `models use` write there when no
folder is in play); a folder's own config overrides point-wise, preserving
per-folder parity — a folder that sets a key always wins. Three app-global keys
are exempt: `ui_language`, `faces_enabled`, and `gemini_monthly_budget_usd` are
always resolved home-scoped and ignore folder overrides. The GUI Prerequisites modal reads the
configured-readiness section from `/api/readiness` with the selected folder;
the doctor contract stays unchanged.

Analyzer output-language resolution happens when each provider request is
built. `output_language: 'auto'` resolves to the effective app-global
`ui_language`, with `en` as the fallback when that value is absent; the same
resolved language governs auto description, filename, and tag instructions
for video and photo prompts. Explicit output and tag language values keep
their existing prompt semantics. Configuration descriptors, variant labels,
and NDJSON retain the literal `auto` token, so request-time resolution never
changes variant identity. The global `analyses` and photo `photo_analyses`
rows additionally record nullable `resolved_output_language` and
`resolved_tag_language` provenance. A non-forced run with an automatic
dimension is current only when that stored language matches the language
resolved from the current UI configuration; explicit dimensions are
unaffected. Rows migrated without provenance retain `null` and are treated as
current to avoid an unexpected one-time mass re-analysis. The CLI uses the
same server config resolution and therefore follows the configured app UI
language too.

Config write scope (owner decision 2026-08-03, closing the W35b 2.3 gap): the
GUI never creates a per-folder override — the owner's doctrine is one
effective value at a time, no per-folder inheritance to reason about. Settings
and the setup wizard both read folder-effective config (a folder's override,
if any, wins in the read they show) but write every key home-scoped, and on
save they also clear a same-key folder override of the currently open folder
via the new `configUnset` contract action (`DELETE /api/config`,
`core/server/usecases/config.ts`'s `unsetConfig`, backed by
`ConfigStore.delete`) — otherwise a stale override would keep shadowing the
value the user just changed and the GUI save would look ignored. Folder-scope
config remains a **CLI-only** surface from here on: `config set --folder`
(`apps/cli`) is unchanged and stays the only sanctioned way to create a
per-folder override, for the pro/parity workflows that still want one; the CLI
does not gain a matching `config unset` command since it was never the gap
being closed.

### Path canonicalization

NFC is the one canonical Unicode normalization form for every path and file
name that crosses into the catalog layer. Canonicalization happens at exactly
three boundaries — the contract's input schemas (`core/contract/routes.ts`),
the Node filesystem adapter's output (`adapters/fs/index.ts`), and the global
catalog store's row mappers (`adapters/db/global-catalog.ts`) — never
scattered across use-cases; a lint rule (`no-restricted-syntax` on
`.normalize('NFC')`) enforces that the helper, `canonicalPath` in
`core/domain/paths.ts`, is the only call site. Folder identity
(`derivedFolderId`) hashes the canonical form, so an NFC and an NFD spelling
of the same folder always resolve to the same id and the same read-only
mirror. This matters because macOS on-disk names can be NFD (measured: an
exFAT-mounted external drive returns NFD from `readdir`, matching Nordic and
Polish diacritics in real folder names) while the catalog always stores NFC —
without canonicalization, a raw string comparison between a catalog row's
`currentPath` and a filesystem-derived path silently matches zero rows. Both
macOS APFS and exFAT lookups are normalization-insensitive (`stat`/`open`
succeed for either form of the same path), so handing an NFC path to the
filesystem is always safe on the platforms this product targets; a
non-macOS target would have to revisit the filesystem-adapter boundary.

## Delta 4 — Electron shape (t3code model)

`apps/desktop` (main process) is a composition root, nothing else. Platform
capabilities go through **one typed preload bridge** whose interface
(`DesktopBridge`) lives in `core/contract`: bridge = port, preload = adapter.
Surface: folder picker, reveal-in-Finder, window controls, folder/window
persistence, menu events, app version (parity-inventory §3).

The renderer is `apps/web` and follows the foundation frontend architecture
verbatim, with desktop-specific bans (lint-enforced): no `electron` import,
no `ipcRenderer`, no `process` access; the bridge is consumed like any bound
dependency wired in `api.ts`. The `media://` protocol with its security model
(extension allowlist, folder scoping, realpath-escape rejection, size cap —
parity-inventory §10) is a main-process adapter. It is registered as a
standard, stream-enabled scheme (not a bare privileged scheme) and serves
`206` partial responses for `Range` requests so video seeking works; the 20MB
size cap applies to images only, not the supported video extensions.

`catalogMediaRoots` also admits, per catalogued folder path, that folder's own
`.ai-video-cataloger` sidecar directory as an image root (§media, Library
spec). A writable, non-current catalog folder keeps its thumbnails beside the
video rather than in the home mirror (that mirror exists only for read-only
sources); without this root, a Library or search thumbnail from any catalog
folder other than the one currently open rendered blank. This is a deliberate,
bounded widening of renderer-readable disk — from "current folder + read-only
mirror" to "every catalogued folder's sidecar" — because the sidecar holds
only app-generated artifacts (thumbnails/frames/notes); the video files
themselves stay unreachable through this root (extension allowlist unchanged).

`MediaRoot` carries an explicit `grants: 'images' | 'media'` (default
`'images'` when unset): the sidecar/mirror/photo-artifacts roots above stay
`'images'`, but `catalogMediaRoots` also adds the catalogued folder path
itself, tagged `grants: 'media'` — the one root video resolution honors from
`extraRoots`. A catalogued folder's own videos are exactly what Library
preview plays, whether or not that folder is the one currently open; every
other rule is unchanged (extension allowlist, the 20MB image cap, realpath
escape rejection) and non-catalogued disk stays unreachable through
`media://` regardless of scope.

The old GUI shelled out to a staged CLI and parsed NDJSON; that machinery is
deleted. Renderer and CLI are peers on the same contract.

Packaged (non-dev) renderer loads carry a `Content-Security-Policy` response
header (`apps/desktop/src/csp.ts`) with no remote origin in any directive:
`connect-src`/`img-src` are pinned to `'self'` plus `media:` (the app's own
`media://` protocol, not a remote scheme) and `data:`/`blob:`. The two
relaxations are `style-src 'unsafe-inline'` (required by emotion/MUI's
runtime style injection) and `worker-src blob:` (Vite/MUI worker shims); both
are recorded, with rationale, in
[ADR-0013](decisions/0013-map-view-and-tile-privacy.md), which also records
the preconditions for ever loading a remote map tile. The Vite dev server is
exempt (HMR websocket + eval'd modules need it) — the header is registered
only for production loads.

The terminal panel (`components/ui/TerminalLog.tsx`) has a persisted **Raw**
mode (`avc.terminalRawMode` in `localStorage`, the same precedent as
`avc.sidebarWidth`): friendly mode shows the translated job lines only, raw
mode renders each line's attached NDJSON-shaped payload and interleaves a
capped ring buffer of every renderer→server request/response. That buffer is
captured once, at the single `fetchImpl` seam `api.ts` passes to
`createApiClient` — wrapping there (`api-log.ts`, `instrumentFetch`) sees every
bound action without a per-component tap. The panel itself starts collapsed on
every launch and only opens from the header button or the `View` menu; it no
longer auto-expands on the first line.

Renderer user-facing copy lives in a typed dictionary layer (`apps/web/src/i18n`,
lint boundary `web-i18n`): `en`/`pl` dictionaries with structural parity, and a
`useDictionary` hook that reads the effective `ui_language` config value so a
config change re-renders every consumer without a restart. `web-i18n` may import
`web-api` and `core-*`; `web-features` and `web-main` may consume it.

### Two-mode information architecture

The app has exactly two persisted top-bar modes, switched by a segmented
control: **Biblioteka** (cross-folder browse over the catalog index) and
**Analiza** (folder-centric work surface). `ViewNav`'s five tabs are retired
and redistributed: Kolekcja, Osoby and Mapa become a horizontal
subnav inside Library (no catalog sidebar there); the folder workspace and its
Zdjęcia face become a Filmy/Zdjęcia toggle inside Analysis. The sidebar is
**medium-aware**: it follows `analysisMedia`, rendering `CatalogSidebar` for
Filmy and `PhotosSidebar` for Zdjęcia, and the rail heading follows it too
(Filmy/Zdjęcia) — `DetailsPanel` and the terminal are unchanged.

**The Analysis sidebar mirrors the real hierarchy: folder, then medium, then
scope/content — top to bottom, in that order.** The top bar itself only carries
app identity, the Biblioteka/Analiza switcher and the Settings/Models/
Prerequisites actions; Open Folder (with its recent-folders menu) and the
Filmy/Zdjęcia toggle both live inside the Analysis sidebar instead, above the
"Ten folder"/"Całe drzewo" scope toggle and its list. The folder identity block
(icon, name, path and the Open Folder control) is one shared component,
`components/ui/SidebarFolderPanel.tsx`,
consumed by both `CatalogSidebar` and `PhotosSidebar` so the two media never
duplicate that markup; each sidebar renders its own `AnalysisMediaToggle`
directly below it, hard-set to its own medium (`videos` for `CatalogSidebar`,
`photos` for `PhotosSidebar`) with the `onSelect` callback wired back to
`analysisMedia`. `AppHeader` keeps no folder or medium state at all.

**The Filmy/Zdjęcia toggle is a processing-mode switch over the same current
folder — it never changes which folder is open.** The photos surface scopes
to `currentFolder`: the "Ten folder" scope lists the photos of the current
folder, and a current folder that is not yet a scanned photo root **auto-starts
the photo scan the moment Zdjęcia becomes active (W44)** — the same behaviour
Filmy already has via `useCatalog`'s always-on scan query, so the two media
never diverge on "do I have to click something to see my folder's content".
`features/photos/use-photos-auto-scan.ts` is a standalone effect hook wired in
`routes/index.tsx` (not inside `usePhotosAnalysis`, which stays a pure
derivation/query layer with no side effects of its own): it watches
`folderState`, and the moment it reads `'unscanned'` for the active folder —
once the photo-roots query has actually resolved, so it never fires against a
stale "not a root yet" read while `photosTree` is still loading — it calls
`scanFolder()` exactly once per folder per session, tracked in a `useRef` set
so neither a re-render nor toggling away to Filmy and back re-fires it; a
folder scanned earlier in the session, or already a known root, is untouched.
`PhotosSidebar`'s former "Skanuj ten folder" CTA is gone — the unscanned state
now renders the same honest "indexing…" caption plus a progress bar while the
auto-fired job is busy, with no click required and no independent folder
picker for photos. A folder that comes back with zero photos still lands on
the ordinary empty state (`photos.emptyNoPhotos`) once the scan completes,
because a photo run always writes a `photo_runs` row (and hence a root)
regardless of how many photos it found — scanning empty is still scanning;
`sidebarSections` therefore drops a photo-less "Ten folder" section the same
way the "Wszystkie foldery" scope already drops an empty root, so an
automatically scanned video-only folder reads as "no photos here" instead of a
bare folder header over nothing. Because the scan is no longer a click, its
failure needs its own exit: a scan that ends in an error (unmounted drive,
deleted folder) replaces the "indexing…" caption with the error strip; retry
remains available from the open-folder dropdown, so the once-per-folder ref
does not leave that folder permanently captioned as indexing until restart.
Nothing was added to the heavy-artifact path: the auto-fired job is the very
same `photo_scan` the CTA used to fire, so it still chains its usual proxies
pass over the photos it just indexed and nothing else — no extra RAW work was
introduced, it is only reached without a click now. A manual re-scan remains
available as a secondary action in the sidebar's open-folder dropdown; the
primary toolbar row is reserved for analysis. `photos forget` deletes the
forgotten root's `photo_runs` provenance as well as its photo membership,
immediately removing that root from `photoRootPaths` and revoking reveal
authorization for it.
Photo artifacts live next to the photos database under the home directory, so
an auto-scan of a read-only mount reads the tree and indexes it without ever
writing to the mount; unreadable subfolders are reported as skipped rather
than failing the run.
The photo-roots table (ADR-0016) remains an internal storage detail
used to answer "is the current folder a known photo root"; it is never
surfaced as a user-facing root list or picker.

**"Całe drzewo" renders the current folder's collapsible subtree, never the
home registry of photo roots (W62).** `PhotosTree.tsx` mirrors
`CatalogTree.tsx`'s architecture — the current root and its subfolders are
collapsible rows (root expanded by default, children collapsed), each carrying its own
photo/analysed counts, with photo rows nested under the folder they live in.
Two shared pieces were extracted downward rather than duplicated:
`components/ui/use-windowed-list.ts` (moved out of `features/catalog`, plain
row-height virtualization with no feature-specific data) and
`components/ui/TreeRowGuides.tsx` (the connector-line rendering, parameterized
over `{ depth, isLast, ancestorContinues }` instead of the video-specific
`TreeRow` union). `features/photos/PhotoRow.tsx` was pulled out of
`PhotosSidebar.tsx` so the flat "Ten folder" list and the new tree render the
exact same row (badges, thumbnail, testids) instead of two copies.

At 50k-photo scale, a client-side derivation from the full paginated photo
list is not honest — so the tree is server-summarized like `catalogTree`:
`GET /api/photos/tree/folders` (`photosFolderTree` usecase) returns one entry
per **directory that directly contains a photo** (`photo_folders` joined to
the union of owner rows and `photo_paths`, counting distinct fingerprints per
`folder_id` — cheap, no filesystem walk, no full-photo payload) with
`photoCount`/`analysedCount`, tagged with the owning root
(longest-prefix match over `photosTree`'s existing root list, same rule as
`ownerRootFor`). The client (`features/photos/core/photos-tree-model.ts`)
filters those summaries through `buildPhotoTreeForRoot` before rendering, so
entries belonging to every other registered root stay registered — their
analyzed photos remain browsable in Library → Kolekcja — but cannot enter the
Analysis sidebar. It synthesizes every zero-count
intermediate ancestor directory purely from the relative-path segments — the
same `ensure()`/`finalize()` shape as
`catalog-tree-model.ts`, kept as a separate small module rather than a shared
generic since photos carry no pending/processed duality. Expanding a folder
lazily fetches its **direct, non-recursive, fingerprint-distinct** photos via
`GET /api/photos/tree/folder?folder=<path>` (`photosTreeFolder` usecase,
`PhotosStore.listPhotosInFolder` — an exact owner-or-sighting `folder_id`
match, deduplicated by fingerprint, unlike
`photosList`'s root-prefix scope which is recursive), mirroring
`catalogTreeFolder`'s per-folder lazy fetch. Folder scope ("Ten folder") uses
that same exact-folder endpoint for its flat direct-photo list. The scope
toggle is shared with videos and disables "Całe drzewo" when the derived
current-root tree has no children.

The sidebar's primary action uses the shared video wording "Analizuj wszystko
(N)". `N` is derived from direct photo/analysed counts for "Ten folder" and
aggregated current-root counts for "Całe drzewo". Direct runs submit only the
pending direct-photo fingerprints; subtree runs submit the current root, so
neither path can process another registered root. Folder progress appears only
for subtree runs whose pending photos span multiple folders.

Because tree-selected rows come from a query decoupled from
`usePhotosAnalysis`'s direct-folder `items` list, two read paths that used to
assume "the selected fingerprint is always in `items`" needed a real fix, not
a workaround: single-photo analysis derives the owner root from
`state.detail?.ownerPath` — the
already-fetched per-fingerprint detail — instead of searching `items`, which
is both more correct and simpler. `PhotosWorkspace`'s detail pane and
`PhotoViewer` fall back to `detailToListItem(state.detail)`
(`features/photos/core/detail-to-item.ts`) when the selection isn't in
`items`; prev/next viewer navigation still orders off `items`, so it has no
next/previous for a photo selected from deeper in the tree than the flat list
has paginated to — a known, accepted gap, not a silent wrong-photo bug.

Opening a
folder keeps whichever medium (Filmy/Zdjęcia) was already selected in
Analysis — it no longer forces Filmy, refining the folder-open behaviour
recorded in the `[0.6.7]` changelog entry, which forced the Filmy view on
every folder open regardless of the medium already active. Search exists only
inside the Library's Kolekcja surface — it reuses the single `searchQuery`
contract that already powers the library grid, no new endpoint or
search-specific query shape. The Analysis details pane keeps its video player
and variant tools exactly as before; this rewrite touches only how a user
reaches that pane, not what it renders. Details/analysis panes carry no
accordions or chevrons anywhere — `ArtifactsSection`'s "Pełna analiza AI"
section (the one collapsible left in the app) is now a plain, always-expanded
`Paper` block like its siblings; the pane scrolls instead.

**The primary analyze button names itself honestly (W44).** `StatusActions`
(video details pane) and `PhotoDetailPane` (photos) both drive their button
label off `analysisPlan.key` (`newVariant` vs `existingVariant`), which only
distinguishes "current settings match an existing variant" from "they don't"
— it says nothing about whether the file has ever been analyzed at all. A
file with zero variants always has `key: 'newVariant'` too, so the button used
to read "Analizuj jako nowy wariant" / "Utworzy nowy wariant" even for a
video that had never been analyzed once, implying a choice between variants
that does not exist yet. `StatusActions` now takes an explicit
`variantCount` (`variants.data?.variants.length ?? 0` from `useVariants`):
when it is zero the button reads the plain `dictionary.details.analyzeAction`
("Analizuj") and drops the variant-creation caption entirely, falling back to
the ordinary `analyzeHint`; once at least one variant exists, the button keeps
its prior "Analizuj jako nowy wariant" / "Wznów wariant" behaviour unchanged.
`PhotoDetailPane`'s analyze button already only renders while `analysis ===
null` (i.e. before any variant exists) and was already labelled with the bare
`dictionary.photos.analyzeAction` ("Analizuj") for that state — there is no
"analyze as a new variant" affordance in the photos pane to begin with, so no
change was needed there beyond confirming the existing label is correct.

**Notice idiom: persistent state is a `Paper` section, `Alert` is transient
(W45).** A file's status — interrupted processing, a failed run, being a
duplicate — is true for as long as the file is in that state, not a one-off
message reacting to something the user just did; `StatusActions`'s
`isIncomplete`/`error` branches and `VideoDetails`'s `DuplicateDetail` render
that as the same `Paper variant="outlined" sx={{ p: 2, flexDirection:
'column', gap: 1 }}` section idiom as `MetadataCard` and `VariantSwitcher`,
with a header row (small status icon in the matching `theme.palette.status.*`
token + a plain `Typography variant="h2"`) carrying the semantic weight
instead of a tinted background. `Alert` (with its assertive `role="alert"`
live region — the wrong semantics for a block that is permanently present
whenever the file is in that state) stays reserved for messages that really
are transient reactions to a user action: `VariantSwitcher`'s `actionError`,
`ReadinessNotice`, and modal/wizard alerts are unchanged. W50 finished the
sweep across the photos surfaces on the same test — does this block stay on
screen for as long as a state holds, or does it react to one action? — so
`PhotoDetailPane`'s "not analysed yet" strip, `PhotosScopeToolbar`'s
proxies-pending strip and `VariantSwitcher`'s `loadError` (which never clears
itself: it occupies the panel until a retry succeeds) are `Paper` sections
too, with their action as a neutral outlined button. The
duplicate notice's canonical path is a one-line monospace copy field
(`CodeSnippetField`, `components/ui/`: ellipsis overflow, full path in
`title`, a copy button with copied-feedback) rather than a link, with
"Analizuj mimo to" and "Przejdź do oryginału" (canonical navigation, now a
button, reusing the existing `onNavigateToCanonical` wiring) as two
equal-weight secondary actions below it. `VariantSwitcher` hides itself
entirely below two variants — a single variant is not a choice, so there is
no "1 wariant" line — and its "Wybrany" marker is the same `StatusBadge`
(`token="completed"`) vocabulary used everywhere else state is shown, not a
plain filled `Chip` that reads as a button. Its folder-default action is
removed from the UI (the `setFolderDefaultVariant` mutation and
`useCurrentAsFolderDefault` stay wired in `use-variants.ts` for a future
call site; the mechanism is dormant pending a parity decision, not deleted).
Button language is exactly two styles app-wide — filled primary and neutral
outlined with the divider-colored border also used by the header's
Settings/Models buttons — enforced structurally by a `MuiButton` `variants`
entry in `theme.ts` keyed on `{ variant: 'outlined', color: 'primary' }` so
any default-color outlined button renders neutral without every call site
passing `color="inherit"`.

**Browse purification and the preview overlay.** Library and Map are
strictly read-only: Kolekcja is the single analyzed-only browse surface for
both videos and photos, Library's Osoby surface hides the
faces-index build (moved to Analysis → Zdjęcia, see below), and a Map video
pin opens a preview instead of jumping into the Analysis workspace. The
preview is a new island, `features/preview/`, rendering a selected-variant-
only overlay (player, description, tags, place, capture date) fed exclusively
by the existing `searchQuery` and `catalogLocations` contracts — no new
endpoint, no per-item detail route, video-only in this wave (a `kind:'photo'`
union member is a later extension). It carries a discreet "Otwórz w Analizie"
escape hatch that calls the same `openInAnalysis` routing `routes/index.tsx`
already uses for the Library↔Analysis bridge, completing both directions of
that bridge. The Analysis sidebar (and with it `FolderBar`) and the terminal
strip render only in Analysis mode — Library browses the cross-folder catalog
without a current folder, so neither affordance applies there. The faces-index
maintenance action lives
exclusively in Analysis → Zdjęcia, at the `PhotosWorkspace` top strip
(`FacesIndexAction`, backed by the extracted `use-faces-index` hook that
`usePeople` also consumes, so the indexing behavior stays single-sourced);
Library's Osoby view keeps only curation (rename/merge/forget). Despite that
placement, the current face pipeline indexes analyzed catalog videos only:
the action is gated by the current root's analyzed-video count and its English
and Polish copy names videos rather than photos. Photo candidates and image
proxies exist at the storage boundary, but people-filter collection queries
and exemplar source reconstruction remain video-only, so merely feeding those
candidates into `facesIndex` would expose an incomplete photo capability.

### Island cores (ADR-0005 rung 1) and i18n

A feature's decision/selector logic lives in a portable, DOM-free, React-free
island core at `apps/web/src/features/<name>/core/` — a factory over its
dependencies (`createCatalogCore` / `createProcessingCore`), following the
foundation's rung-1 shape (pure TypeScript; no state library). The single web
binding `apps/web/src/features/<name>/index.web.ts` injects the bound
server-read descriptors from `api.ts` and re-exports the seam; view hooks
consume the binding, never `core/` construction. Cores may import `core-*`
contracts through the `@core/*` alias and their own core directory, nothing
else — enforced by `typecheck:islands` (`tsconfig.islands.json`, ES2023 lib
without DOM), the ESLint island-purity bans, and the depcruise
`island-core-is-portable` / `island-core-no-frameworks` rules.

**i18n ruling (owner-accepted 2026-07-25): cores emit typed dictionary keys;
the feature's web side translates through `useDictionary`.** A pure core
cannot call the `useDictionary` React hook, so it never holds translated
strings. Instead a core exposes labels and log lines as a typed, closed key
union (e.g. the processing core's `DriveMessage`:
`{ kind: 'folderDone'; path; filesDone; … }` and a step key), and the
feature's view hooks and components — which may import `web-i18n`, while the
core never does — resolve each key against the effective dictionary. This
keeps the core locale-free and portable while the translated output stays
byte-identical to the pre-extraction renderer.

**No scaffolder, and one half of the seam is deferred.** The foundation
generates a new island with `pnpm run new:island`, and its rung-1 template ships
**both** halves of the seam: an inbound `core/events.ts` intent union with a
typed stub `send`, plus `core/selectors.ts`. We have no generator — two islands
do not earn one, and a template nobody runs rots — so the seam is written by
hand and the rules, not a template, are what hold it: `typecheck:islands`, the
island-purity bans and the depcruise pair above. Our rung-1 cores ship the
**read half** (selectors/descriptors out, plus the typed dictionary keys of the
i18n ruling) and deliberately have **no event union**: with no client machine
behind the seam, an inbound `send` would be a stub forwarding to nothing, and
writes go through mutation descriptors in the view (invalidation → refetch). The
naming rule for the day one arrives is already armed —
`avc/event-suffix-taxonomy` runs on `features/*/core/events.ts`, so the first
core to graduate to rung 2 gets an intent-suffixed union or a red `check`.

### Renderer structure (delta on the foundation's frontend diagram)

```
apps/web/src/
  main.tsx           composition root: providers + router wiring only
  api.ts             binds core/client actions + the DesktopBridge once
  AppLayout.tsx      the stateful shell composition (ADR-0004): modal state,
                     menu events, collapse + sidebar-width persistence,
                     translated labels — renders components/layout/AppShell
  routes/            route components — thin: wire features into AppLayout
  features/<name>/   feature folders (islands), core/ = the island core
  components/layout/ page skeletons: structure only → theme, components/ui, lib
                     (no core, features, routes, api, TanStack, i18n)
  components/ui/     presentational primitives → theme, lib, i18n
  i18n/              typed en/pl dictionaries + useDictionary
  lib/               pure TS utilities → no react
  theme.ts           the entire visual language (MUI theme)
```

The `map` feature (`features/map/`) plots catalogued GPS coordinates on an
offline vector basemap; its island core (`features/map/core/**`) is a
DOM-free Web Mercator projection + grid-clustering module. `features/details`
reaches map data (coordinates, jump-to-map) through route-supplied props only,
never through a cross-feature import — the route (`routes/index.tsx`) owns the
`catalogLocations` query and passes the derived slice down. See
[ADR-0013](decisions/0013-map-view-and-tile-privacy.md) for why the map ships
zero map-tile networking.

### Library — one query surface, not two

The `library` main view (`features/library/`) browses the whole video catalog
instead of the currently-open folder. It is additive on the existing
`searchQuery` route/use-case rather than a parallel endpoint: `query` becomes
optional, and structured filters (`tags`, `people`, `place`, `from`/`to`,
`hasGps`, `folderId`) plus `sort` and a `thumbnails: 'ensure' | 'existing'`
mode arrive alongside it — the CLI's `search`, the global search box and
Library all speak the same contract, so there is no drift between "search
results" and "library items". `thumbnails: 'existing'` short-circuits the
use-case before the `generateThumbnail` fallback: a Library page must never
fan out ffmpeg runs for a couple hundred tiles.

**With a text query, relevance ranking is the same bounded exception the old
search always was**: the FTS match set (typically small) loads into JS,
scores and sorts there, then slices. **Without a query, ordering and paging
are 100% SQL** (`captured_desc` default; `total` from a same-`WHERE`
`COUNT(*)`) — the load-all-and-filter pattern the house rules ban on hot read
paths never runs for a filterless or query-less browse. The tag filter reuses
the `listLocations` variant-selection COALESCE precedent (selected config →
folder default → newest), so a filter honors the same variant a user actually
sees, not whichever one is newest. Migration V12 adds the indexes
(`files.captured_at`, `files.folder_id`, `files.place_name`,
`file_tags.tag_id`, `face_observations.person_id`, `analyses.fingerprint`)
this depends on.

The grid island (`features/library/core/**`) is its own DOM-free core — not an
import of, and not a copy-paste of, the `photos` feature's day-grouping/
windowing types, per the cross-feature-import ban; it follows the same
algorithm class (group by local capture day, window visible rows) over its
own `LibraryItem` contract type.

**Facets are computed server-side, whole-catalog, never from a loaded page.**
`GET /api/library/facets` runs five `GROUP BY` queries (tags, people, places,
capture years, folders) plus one counts query directly against the store — the tag
facet joins `file_tags` through the same selected-variant COALESCE resolution
as `listLocations` and `search`, now extracted into one shared SQL-string
constant (`SELECTED_ANALYSIS_CONFIG_ID_SQL` in
`adapters/db/global-catalog.ts`) so the three call sites cannot drift. The
folder facet carries each catalogued folder's persisted id, current path and
file count; `online` is the one field the store cannot answer — online/offline
is a filesystem fact, not a catalog fact — so the `library-facets` use-case
stats every folder's path and derives `counts.offlineFolders` from the result,
the same pattern `catalogLocations` and `search` already use for a row's
`online` flag. Facets describe the whole catalog, not the currently active filter set
— recomputing per-filter-set is out of scope (recorded as a known
simplification: it sidesteps a combinatorial recompute and keeps the facets
query cacheable behind a fixed, argument-less query key).

**Filtering is a pure reducer, not ad hoc component state.**
`features/library/core/filter-state.ts` owns the filter shape (`tags`,
`personIds`, `place`, `from`/`to`, `hasGps`, `folderId`), its add/remove/clear
actions, the chip-list projection the filter bar renders, the mapping to the
`searchQuery` contract fields, and the localized empty-state sentence naming
the active chips — all arithmetic here is unit-tested, none of it lives in
JSX. `FilterBar.tsx` is controls only: MUI `Autocomplete` fed by the facets
query for tags/people (options carry counts), a free-text place `Autocomplete`
(substring semantics, debounced), a single-select folder `Autocomplete` fed by
the same folder facet (options carry per-folder counts, one folder active at a
time), a date range with quick presets sourced from the year facet, and a
three-state has-GPS toggle. Every chip label — including the has-GPS,
date-range and folder chips — is built in `core/` from dictionary parts passed
in, so no English string can leak out of the pure layer. The count header
always states `{shown} of {total}` from the same `searchQuery` response — a
filtered view can never pretend to be the whole catalog.

**Grouping is date or folder, decided in `core/`, not in the toggle handler.**
`features/library/core/folder-groups.ts` emits the same `Section` shape
`grid-rows.ts` already accepts from day-grouping, keyed by `folder.folderId`,
labeled by `displayName`, ordered by `displayName`; an offline folder's badge
applies to the whole section. Sort-within-section (captured newest/oldest,
name; relevance only while a text query is active) is a tested matrix, not an
improvised JSX branch — grouping and sort are independent axes (e.g.
group-by-date with `sort=name` is legal).

**Date grouping reads capture metadata only, and says so.** A section's day
comes from `capturedAt` — the container's recording timestamp for a video, EXIF
(or, for photos only, the file mtime the EXIF reader falls back to) for a
photo — never from a filename or from analysis time. A file whose capture
metadata is missing lands in one trailing section labeled "Bez daty nagrania" /
"No recording date", not "no date": the analyzed video's renamed file already
carries a `YYYY-MM-DD` prefix, and that prefix is derived from the file's mtime
(`datePrefix` in `core/server/usecases/final-name.ts`), so a flat "no date"
label contradicts a filename the same screen is showing. Videos never fall back
to mtime for `capturedAt`, and this section label is the honest statement of
that rule rather than an invitation to add such a fallback.

**The tile→folder direction is the only cross-surface folder connection left.**
A tile's primary click and its context menu (open in folder view, reveal in
Finder, copy path) resolve a tile to its Analysis folder. The former
folder→tile direction — a folder header's "Show in Library" action and a
file-level "Show in Library" context-menu/details-pane action, seeding
`filters.folderId` from outside Library — is removed (W38): the Analysis
sidebars and the details pane no longer offer any "jump to Library scoped to
this folder" affordance. Filtering Library by folder is now done entirely
inside Library itself, through the Folder facet described above, which
dispatches `setFolder` directly from the facet's own `folderId`/`displayName`
— no seed, no cross-feature callback threading through `routes/index.tsx`,
and no scroll-to-fingerprint behavior (that was specific to the removed
file-level action). `deriveLibrarySeed` and `LibrarySeed`'s `'folder'` variant
were deleted as dead plumbing once their only callers — the removed
buttons — were gone; `LibrarySeed` now only carries `'tag'` and `'person'`
variants (see below).

**Library is the default mode once the catalog is non-empty.** Initial mode
resolution is persisted preference (localStorage, the `useScopePreference`
pattern) → `'library'` if the catalog already has ≥1 file → `'analysis'`; an
empty catalog always opens on Analysis, since the folder-open CTA there is the
honest first-run surface. Photos in Library, saved searches, multi-select,
keyboard grid navigation and an in-Library details pane remain out of scope.

A person→tile direction reuses the same seed mechanism: `LibrarySeed` gains a
`{ kind: 'person', personId, label }` variant that dispatches the existing
`addPerson` filter action (the chip already carries its own `displayName`, so
no new facet lookup is needed), wired from a `PeopleView` person card's body
click and its "Search in Library" menu item, through `routes/index.tsx`, to
Library's Kolekcja surface — there is no photos-only person view; a person's
photos and videos share the one Library query surface like everything else
here.

An offline or missing tile now always opens the preview instead of doing
nothing on click — `libraryPreviewDetail` never stats the file for an offline
or missing tile, so every field it renders in that case (path, size,
duration, transcript, people) comes straight from the catalog row and needs
no live filesystem access.

**Distinguishing *why* a tile is unreachable.** A `folder.online === false` row
now carries `offlineReason: 'drive-disconnected' | 'file-missing'` alongside
it (`search`/`collection`'s shared `SearchResult.folder` shape), computed by
a pure classifier in `core/server/usecases/shared.ts`
(`classifyOfflineFolder`): a `currentPath` under `/Volumes/<name>` is
`'drive-disconnected'` iff that volume root does not exist on disk; every
other path (the boot volume, which this darwin-only product always treats as
mounted) is `'file-missing'` — the folder itself was deleted while its drive
stayed connected, the "avc-bench ghosts" case. The classifier only runs when
`online` is already `false`, so it costs nothing on the hot path. `LibraryGrid`
(both the per-tile badge and the folder-section header), `LibraryVideoPane` and
`BrowsePreview` switch their existing offline/missing copy — `library.offlineFolderBadge` /
`library.missingBadge`, `preview.offline` / `preview.missing` — on this
discriminant instead of hard-coding the drive-disconnected wording for every
offline row; no new dictionary strings were added. `MapPinPopover` and
`catalogLocations`/`libraryFacets` keep their coarser online/offline-only
signal for this wave — only the Library and browse-preview surfaces the bug
report named carry the distinction.

**One offline label per tile (W39).** The folder-level offline caption above
already subsumes the per-file `missing` chip whenever the two coincide — a
file that is itself flagged `missing` inside a folder that is already
`offline` used to render both, duplicating the same "Brak pliku" text on one
tile. `LibraryGrid`'s per-file missing badge now only renders when
`item.folder.online` is true; an offline folder's caption is always the
single source of truth for that tile, and the per-file chip still renders
normally once the folder itself is reachable and only the file is missing.

**Aspect-ratio indicator on grid tiles (W39).** Library/Kolekcja tiles keep
their square cover crop, but a non-landscape source now gets a
small bottom-right icon: portrait (`height > width`) or extreme panorama
(`width / height >= 2.4`); plain landscape and square sources get nothing,
by design (the common case should stay quiet). The pure classifier lives in
`apps/web/src/lib/aspect-ratio-indicator.ts`
(`aspectRatioIndicatorKind`), rendered by the shared
`components/ui/AspectRatioIndicator.tsx` from already-resolved
`width`/`height` — never a per-tile probe. Photos already carried EXIF
`width`/`height` on every list row (`photoListItemSchema`); videos did not:
`process`'s `recordGlobalCatalog` already calls `MediaPort.probe` for
duration and GPS, so its `width`/`height` are now also persisted onto the
global catalog `files` row (migration v13, two nullable `INTEGER` columns,
backfilled to `null` on upgrade) and surfaced on `searchResultSchema`
(and by extension `collectionVideoItemSchema`) — no new I/O on the read
path, no per-tile ffprobe. A file processed before this migration simply
shows no indicator until it is reprocessed, which is the honest answer for
"unknown dimensions" rather than a synthesized default.

**Player fields for an online tile.** For a tile whose folder is online,
`libraryPreviewDetail` also returns `transcriptSegments` (`{ start, end,
text }[]`, nullable) and the source `width`/`height`/`rotation` (nullable),
so the `LibraryVideoPane` and `BrowsePreview` players can render an in-player
subtitles track and letterbox portrait video exactly like the details player
does. It also returns `analysis` (`{ label, createdAt }`, nullable) for the
selected variant, so a video carries the same provenance line the photo viewer
already showed. Segments are
derived the same way `core/server/usecases/scan.ts` derives them for the
per-folder scan view — reading the on-disk `transcript.txt` /
`transcript.json` artifacts through `filterTranscript` — rather than persisted
in the global catalog DB, so the two views stay in sync without a schema
migration; `width`/`height`/`rotation` come from a fresh `MediaPort.probe`
call, mirroring `resolveThumbnailPath`'s existing on-demand-generation
pattern for a single fingerprint rather than a list. All four fields are
`null` whenever the tile is offline/missing, keeping that path exactly as
zero-I/O as before.

### Library collection feed — unified video+photo browse

`GET /api/library/collection` (`core/server/usecases/collection.ts`) is one
new server route, not a client-side merge of `searchQuery` + `photosSearch`:
`photosSearch` has neither `total` nor filters nor sort, so the server
changes were needed anyway, and a client-side merge would force the renderer
to over-fetch and re-sort every page and re-implement the merge a second
time. It accepts everything `searchQuery` does (minus `thumbnails`, which
this route never generates) plus `media: 'all' | 'video' | 'photo'` (default
`'all'`), `limit` (default 50, max 200) and an opaque `cursor`.

**Composite-offset cursor, not true keyset.** `cursor` is base64url JSON
`{ v: 1, video: number, photo: number }` — one offset per source,
zod-parsed on entry (invalid → `validation`). A page fetches up to `limit`
rows from each source at its own offset (each already in the requested
order — `globalCatalog.search` with `thumbnails: 'existing'` semantics for
video, the `PhotosStore.collectionPage` port for photos), k-way merges them,
takes the first `limit`, and the next cursor is the old offsets plus however
many items from each source actually made it into the page — never the full
over-fetched batch. This gives the same page stability as today's
offset-paged single-media endpoints (no load-all, at most 2×`limit` rows
materialized per page) without reworking either store's FTS into true
keyset pagination — reworking `GlobalCatalogStore.search` and the photos FTS
for marginal gain was rejected as out of scope for a merge feature.

**Ordering.** Browse (no query): `captured_desc` (default) / `captured_asc` /
`name_asc`, pushed down to SQL in both stores; items with `capturedAt ===
null` sort **after** all dated items in both `captured_desc` and
`captured_asc` (`p.captured_at IS NULL` first in `ORDER BY`, mirroring the
video store's existing nulls-last rule) — verified in
`core/server/usecases/collection.test.ts`, not assumed. A tie (equal
`capturedAt`) breaks video-before-photo, then by fingerprint; the comparator
(`compareCollectionItems`) is a pure, exhaustively tested function, not
inline merge-loop arithmetic. Search (`query` present): `relevance` — the
two FTS engines' bm25 scores are not numerically comparable across separate
SQLite databases, so the merge is **positional**, not score-calibrated: each
source's already-ranked rows are interleaved by `sourceOffset + rowIndex`
(a global round-robin over each source's own rank order), video first on a
tie. This is documented here and in the route's contract description as an
honest limitation, not silently glossed over; true cross-DB score
calibration is out of scope for one session.

**Filter semantics, stated once instead of silently diverging per media.**
`query`, `from`, `to`, `tags`, and `folderId` apply to both video and photo
(photos carry variant tags in their own FTS). A selected catalog folder ID
resolves to its canonical path, then to the path-derived photo-folder ID
before `PhotosStore.collectionPage` applies a membership predicate: a photo
belongs to a folder when that folder owns its identity row or contains a
sighting of the same fingerprint. This matches the photo tree, which counts a
distinct fingerprint once per folder membership, while an unfiltered
collection still counts the photo identity only once across all sightings.
The path-derived ID bridges writable video-folder UUIDs and photo folders
without changing the route contract. `people`, `place`, and `hasGps` remain
video-only — when
any of them is set, the photo source contributes **zero rows** rather than
silently ignoring the filter, so a Library user filtering by person never
sees an unfiltered photo sneak into the page pretending to satisfy a filter
it cannot express. `media: 'video' |
'photo'` short-circuits the other source's page rows entirely (its offset
never advances). `total` remains the total for the selected `media` page and
the existing `videoTotal`/`photoTotal` fields remain the selected request's
source totals. The additive `mediaTotals: { all, video, photo }` object is
computed from the same query and non-media filters with the media selection
removed, so all three chip labels stay stable without a second renderer round
trip.

**`hideUnavailable` — pushed down to SQL so counts stay truthful (W71).**
A catalog spanning external drives renders every item from an unplugged
volume as a grey placeholder, so `collectionInputSchema` carries an additive
`hideUnavailable` flag (query boolean, default `false`). It is **not** a
renderer-side `Array.filter`: dropping rows after the page was cut would
leave `total`, `mediaTotals` and the composite cursor describing rows the
user cannot see. Instead the flag resolves to store-level predicates, so
page size, `total`, `mediaTotals` and `nextCursor` all describe the same set
the grid renders.

Availability is not a single column. A video is unavailable when its
**folder** is offline (`FileSystemPort.exists` on `folders.current_path` —
the same probe that drives the "Dysk niepodłączony" badge) or when its own
row is flagged missing (`files.missing_at`). Only the folder half needs the
filesystem, and there are orders of magnitude fewer folders than files, so
`libraryCollection` resolves the offline set once per request from
`GlobalCatalogStore.listFolders` and passes it to the store as
`CatalogSearchFilters.excludeFolderIds`, alongside `excludeMissing` for the
row flag — never one `exists` call per row.

A photo is unavailable when `photos.missing_at` is set
(`PhotosStore.collectionPage` gains the same `excludeMissing`). A photo on
an unplugged drive is deliberately **not** hidden: its grid thumbnail and
proxy live in the local artifacts root, so it still renders and still opens
in the viewer, and the grid never badges it as offline. The filter hides
exactly what the grid marks unavailable and nothing else.

**Analyzed-only photo source (W60), asymmetric with browse on purpose.**
Videos already appear in Kolekcja only once analyzed (`globalCatalog.search`
reads the catalog's `files` table, populated at analysis completion, never at
scan time). `PhotosStore.collectionPage` now applies the same rule
explicitly: both its match (FTS) and browse (plain `WHERE`) branches require
`EXISTS (SELECT 1 FROM photo_analyses pa WHERE pa.fingerprint = p.fingerprint)`,
so a scanned-but-never-analyzed photo — which does get a `photo_search_documents`
row at scan time via `syncPhotoSearchDocument`, with an empty description —
never reaches Kolekcja, matching the video side and this feature's own intent
(a unified feed of *analyzed* media). This is scoped to `collectionPage`
only: `GET /api/photos/list` (`PhotosStore.listPhotosPage`) and
`GET /api/photos/tree` both intentionally keep listing every scanned photo
regardless of analysis state for Analysis → Zdjęcia and non-renderer clients —
browsing and picking a photo to analyze is their job, and narrowing either to
analyzed-only would make an unanalyzed photo unreachable from the UI. Verified
in `core/server/usecases/collection.test.ts` (a
scanned-not-analyzed photo is absent from the feed and does not count toward
`photoTotal`; an analyzed one is present) and against the real
`SqlJsPhotosStore` in `apps/server/src/collection-real-stores.test.ts`.

`PhotosStore.collectionPage` (`adapters/db/photos-store.ts`) is SQL-pushed
and variant-aware exactly like `searchPhotos`: it reads `photo_search_documents`,
which `syncPhotoSearchDocument` already keeps in sync with the selected
variant on every write, so a filter or sort by tag/description honors the
resolved variant, not an arbitrary one. Browse mode pushes `WHERE`/`ORDER
BY`/`LIMIT`/`OFFSET`/`COUNT(*)` to SQLite; match mode reuses the same
JS-scored, load-all-then-slice FTS approach `searchPhotos` already uses (no
real `bm25()` push-down in the sql.js FTS5 build) — an accepted, pre-existing
bound, not a new one introduced here.

`core/client/queries.ts` (`libraryCollectionQuery`) and `apps/web/src/api.ts`
(`actions.libraryCollection`) wire the route with a registered query key,
following the `searchQuery`/`photosListQuery` pattern.

**Renderer consumption (W55).** `useLibrary` (`apps/web/src/features/library/`)
calls `actions.libraryCollection` instead of `actions.search`, accumulating
pages by `nextCursor` and de-duplicating merged items by fingerprint — the
cursor-world regression test for the offset-merge bug class fixed in
[#74](https://github.com/coderoadpl/ai-video-cataloger--archive/pull/74). The
held cursor is stamped with the query/filter/sort/media request key it was
issued for, so a key change drops it in the same render that starts the new
request — a page-2 cursor is never replayed against a different result set —
while the already-loaded items stay on screen (`keepPreviousData`) until the
new first page lands. `LibraryItem` is now the route's discriminated
`video | photo` union; `LibraryGrid`, `TileMenu` and the day/folder grouping
helpers in `features/library/core` branch on `item.media` exhaustively rather
than assuming a video shape. Filter chips still request `media: 'all'` by
default; `FilterBar` renders Wszystko/Filmy/Zdjęcia chips from the route's
`mediaTotals`, so every chip always carries the total for the current search,
tags, dates, and other non-media filters regardless of the selected media.
The view also shows an inline notice — naming the active
video-only filter chip(s) — whenever one of `people`/`place`/`hasGps` is set
while `media === 'all'`, matching the server's "photo source contributes zero
rows" semantics above. A folder-only filter keeps matching photos visible and
does not show that notice. Folder grouping and the
relevance sort option are disabled (with a tooltip) whenever the loaded page
actually mixes photos in (`photoTotal > 0`) or, for relevance, whenever
`media` isn't a single medium — both because neither operation is meaningful
across the two shapes (photos carry no `folder`, and the two FTS engines'
scores are not comparable, per the Ordering note above). Every tile — video or
photo — opens the same fullscreen `LibraryMediaViewer` (W69): one shell owning
the modal, the "Otwórz w analizie" action, the prev/next arrows, the keyboard
bindings and the filename/date caption, with two per-medium panes plugged into
its stage and details slots. `LibraryPhotoPane` fetches `photosDetail` to show
description, scene, quality, tags, capture date and humanized analysis
provenance beside the image; `LibraryVideoPane` fetches `libraryPreview` to
show description, tags, transcript, path, duration, size, place, coordinates,
people, capture date and analysis provenance beside the player. The arrows walk
the whole filtered, sorted collection in grid order, so a mixed list steps
across both media types. The old centered `BrowsePreview` dialog is no longer
reachable from Kolekcja; it survives only as the map's video popover.
The viewer's "Otwórz w analizie" action
resolves against `GET /api/photos/tree`'s roots (`ownerPhotoRootFor`, a `features/library/core`
copy of the photos feature's `ownerRootFor` — the two features are lint-enforced
islands, so small pure helpers are duplicated rather than cross-imported,
matching the pre-existing `day-groups.ts`/`grid-rows.ts` split) — never a
video-shaped `folder.currentPath` join.

### Library — hide and move-to-trash (W88)

Kolekcja gains two removal verbs with deliberately different weights, decided
in [ADR-0020](decisions/0020-library-hide-and-trash.md) and specified in
[tasks/prd-library-hide-and-trash.md](../tasks/prd-library-hide-and-trash.md).

**Hide is a column, not a config entry.** `catalog.db` `files` and `photos.db`
`photos` each carry a nullable `hidden_at INTEGER` (epoch milliseconds,
mirroring the existing `missing_at` convention), added by migrations **V17**
and **v7** and indexed. It lives in the databases because the predicate has to
be pushed to SQL — `total`, `mediaTotals` and the composite cursor are all
derived from the same `WHERE` as the returned rows, exactly as W71 required for
`hideUnavailable` — because hide is fingerprint-scoped and a per-folder
`config.json` cannot express one decision shared by every sighting of the same
content, and because a read-only source cannot receive a config write at all
while the home-scope databases always can.

**Hide is scoped to the library surfaces.** A hidden file leaves
`GET /api/library/collection` (both legs), `GET /api/search`,
`GET /api/photos/search`, `GET /api/library/facets` (every facet, every count,
plus the new `counts.hidden`), `GET /api/catalog/locations` (pins *and* the
catalog-wide total the coverage caption is measured against) and
`GET /api/faces/people` — where hidden files never count and a person whose
every observation sits on hidden files is omitted from the response, the
`people` row surviving untouched so unhiding restores the same card, name and
exemplars. It does **not** leave the Analysis surfaces (`scan`,
`catalog-tree*`, `photos/tree`, `photos/list`, `status`, `variants`,
`index/status`) or the backup scope: Analysis is the filesystem-truth view, and
hiding there would strip a file from the surface whose job is to show what
exists and silently shrink the not-yet-analyzed counts that drive the run
buttons. `searchInputSchema`, `collectionInputSchema` and
`photosSearchInputSchema` each carry a `hidden` tri-state
(`exclude` default / `only` / `include`), so the "Ukryte" view is the same
query surface as every other filter rather than a second endpoint. The
predicate is SQL in every store method that feeds those routes — on the
catalog store `search` (the one method behind both `GET /api/search` and the
video leg of the collection feed; the predicate arrives on
`CatalogSearchFilters` and must be applied in both its FTS-match and its
browse branch), `listLibraryFacets` and `listLocations`; on the photos store
`collectionPage`, `searchPhotos` and `listPhotoLocations`. Two surfaces cannot express it in one store: `counts.hidden`
spans both media, so `libraryFacets` gains a `photos` dependency and a
`PhotosStore.countHidden()`; and face observations for photos live in
`catalog.db` under `ph_*` fingerprints that `catalog.db` cannot join to
`photos.hidden_at`, so `facesPeople` assembles the hidden set from
`listHiddenFingerprints()` on both stores.

**Trash goes through a port, never through `rm`.** `TrashPort.moveToTrash`
has two real implementations — `shell.trashItem` supplied by the Electron
composition root alongside the existing `openExternal`/`saveFile` host
capabilities, and a Finder-backed `osascript` move for the CLI and headless
compositions — so a CLI delete lands in the same macOS Trash, with the same
"Put Back", as a GUI delete. The Electron wiring supplies a call-site wrapper
(`(targetPath) => shell.trashItem(targetPath)`), as `openExternal` already
does, not a captured reference: the e2e trash leg stubs that native surface in
the main process after boot, and a captured reference cannot be replaced. The
Finder adapter (`adapters/fs/finder-trash.ts`) passes the path through the
script's `argv` — `execFile('osascript', ['-e', 'on run argv', '-e', 'tell
application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e',
'end run', '--', path])` — never interpolated into the AppleScript source,
where a `"` in a file name is an injection; it calls `node:child_process`
directly, as `apps/desktop/src/cli-install.ts` already does for its own
`osascript` call, because the repo has no generic command-runner port and adds
none. `FileSystemPort.deleteFile`/`deletePath` stay the
mechanism for the app's own artifacts, whose recovery path is regeneration,
and are never applied to a user's media file.

**All-or-nothing per folder root.** The selection is resolved to a fingerprint
list, then to the set of affected roots (the owning folder plus the parent
directory of every selected file); each is probed with the non-mutating
`FileSystemPort.isWritable` (`access(W_OK)` — the same probe
`materialize --dry-run` uses to report a still-read-only mount without
touching it). Any failure returns `target_read_only` with the offending roots
in `details` and **zero** moves, row changes and artifact deletions. The probe
runs twice — synchronously before the job envelope is issued, so the refusal
reaches the dialog rather than a failed background job, and again at the top of
the job body, so a drive unmounted between confirm and start aborts before the
first move. A failure mid-run stops at that file and leaves the remainder
untouched; partial best-effort progress is not a supported outcome.

**What a trash erases** is the closed checklist in ADR-0020 D7: the `files`
row with its GPS/place/capture columns, every analysis variant, `file_tags`,
the search document and its FTS row, `face_observations` and
`face_index_state` with affected people recomputed (a person left with zero
observations is deleted); for a photo, every `photo_paths` sighting and the
`photos`/`photo_analyses`/`photo_file_tags`/`photo_search_documents`/
`photo_face_index_state` rows **plus** that photo's `face_observations` rows in
`catalog.db`, since the identity pool is shared (ADR-0016); the per-observation
crop directory, the photo proxy/thumb/grid-thumb/variant artifacts, and — under
the video artifact root, which is the folder's own `.ai-video-cataloger/` when
writable and `~/.ai-video-cataloger/read-only-folders/{folderId}/` otherwise —
the content-addressed frames and transcripts, the per-variant outputs, the
thumbnails and the full name-based projection `artifactPaths()` produces
(`frames/<base>/`, `transcripts/<base>.txt` **and** `.json`,
`summaries/<base>.txt`/`.json`/`-debug.log`). The row deletions reuse the
existing ports rather than new SQL, and the two media use different ones: a
video is `forgetEntry` alone (it already removes the observations, recomputes
the affected people and returns the crop paths), a photo is
`deleteFaceObservationsForFile` plus `PhotosStore.deletePhoto` — `forgetEntry`
no-ops on a fingerprint with no `files` row. The shared `tags`
vocabulary, `drive_runs`, the spend ledger and the non-canonical legacy
per-folder `catalog.db` are deliberately left alone.

**Two invariants the folder watcher makes load-bearing.** A trashed file must
not resurrect. Two paths lead back: the `catalog.ndjson` snapshot import for a
marked folder unknown to the local index (Delta 3), closed by re-exporting the
snapshot for every affected writable folder on *every* exit path — success,
mid-run failure, cancellation; and a rescan started while the batch is
half-processed, when a file's rows are already deleted but its bytes are still
on disk, closed by adding `library_trash` to `folder-watch.ts`'s
`RUN_JOB_KINDS` (so the watcher holds refreshes until the run settles) and by
the trash job acquiring the debounced photo scan's `photo-scan:<root>` resource
key for every affected root before its first move — that key does not collide
with the job's own `library-trash`, and it is built from the resolved root the
way `enqueuePhotoScan` builds it, or the two never match. A photo scan
requested while the claim is held is refused with `conflict`, not queued
(`enqueue` fails closed on a busy `resourceKey`; only `acquireResource`
waits), and it runs from the watcher's single post-settle refresh.

A hidden file must survive rescans, and structurally rather than by convention:
every rescan and analysis path reaches the row through `upsertFile` /
`upsertPhoto`, whose conflict `set` clause **omits** `hiddenAt`, so an UPDATE
can never clear it while an INSERT still carries it. `scan`, `process`,
`process-drive`, `materialize`, `photos scan`, `photos process`,
`photos import-libra` and `index rebuild` are all covered by that one rule, and
`CATALOG_SNAPSHOT_SCHEMA_VERSION` goes 12 → 13 so `hiddenAt` round-trips
through the snapshot instead of being lost by an import.

**Hide is synchronous, trash is a job.** Hide and unhide are one `UPDATE` per
store inside one transaction and return directly. Trash is unbounded I/O, so
it runs as a `library_trash` job with the literal `resourceKey:
'library-trash'` (global — a trash can span roots, so a per-root key could not
serialize two overlapping runs), cancellable through the existing
`JobsPort.cancel` with the abort check between files. Its result schema
carries a required literal `kind: 'library_trash'` and sits before the
absorbing members of `jobResultSchema`'s untagged union, per the challenge-B5
rule in [docs/architecture-photos.md](architecture-photos.md) §7.

**Selection is a server-side scope.** `POST /api/library/hide`,
`/api/library/unhide`, `/api/library/trash` and
`/api/library/selection/preview` all take one closed discriminated union,
declared in `core/domain` (with `hiddenScopeSchema`, which the contract
re-exports) — an explicit fingerprint list, the current filter (exactly the
set-defining fields of `collectionInputSchema`: everything except `sort`,
`limit` and `cursor`), or a person (optionally skipping files that also carry
an observation assigned to a *different* person; unassigned faces do not
count). "Zaznacz wszystko" projects to the `filter` variant, so the renderer
never enumerates pages to act on a filter result. The shared resolver answers
with one entry per fingerprint carrying `hiddenAt` and every sighting of that
fingerprint (`folderId`, root path, file path), because trash removes all of
them and each contributes a root to the writability check. The preview route answers the
two confirmation dialogs with counts, the shared-with-other-people count and
the affected roots' writability in one round trip. `POST /api/library/trash`
answers with a `kind`-discriminated union rather than `jobAcceptedOutputSchema`
— a `plan` for `dryRun: true`, a `{ kind: 'job', jobId }` for a confirmed run —
because a dry run's plan does not fit in a job envelope.

**One confirmation dialog, extracted downward.** Kolekcja's action bar and a
person card in Osoby open the same trash confirmation, and the renderer's
features are lint-enforced islands, so the component lives in
`components/ui/dialogs/` beside `CancelConfirmationDialog` and
`DriveSummaryDialog`: props-only, copy from `useDictionary()`, no query and no
mutation of its own, prop types declared locally because `components/ui` may
not import `core/`. Each feature runs its own `librarySelectionPreview` and
`libraryTrash` calls and maps the preview output onto those props. This is the
same island rule that made `ownerPhotoRootFor` a duplicated pure helper above,
resolved the other way: a whole destructive dialog is worth extracting, a
three-line path helper is not.

**No new taxonomy.** `confirmation_required` (409 / 18) covers a trash without
confirmation, `target_read_only` (409 / 46) the read-only refusal,
`validation`, `not_found` and `unavailable` the rest. Feature specificity
lives in NDJSON progress-step names (`library-trash-preflight`,
`library-trash-file`, `library-trash-artifacts`, `library-trash-summary`) and
job-result fields, following the precedent
[docs/architecture-photos.md](architecture-photos.md) §7 set for photos.

### Offset pagination — sanctioned ADR-0003 deviation (dated 2026-08-03)

`GET /api/search`, `GET /api/photos/list` and `GET /api/photos/search` still
paginate with raw `offset`/`limit` (`searchInputSchema`,
`photosListInputSchema`, `photosSearchInputSchema` in
`core/contract/routes.ts`), not the opaque cursor
[ADR-0003 §(d)](decisions/0003-sqlite-data-conventions.md) requires for list
endpoints. This is a named, reviewed exception, not silent drift: the CLI and
renderer both call these routes as their live wire contract, so rewriting
them is a breaking change out of scope here. `GET /api/library/collection`
above already paginates with an opaque cursor and is the intended eventual
replacement once every caller has migrated onto it — see the ADR-0003
addendum for the full per-route rationale and the `doc-lint` rule that fails
`check` if a fourth offset-paginated list route is added without being named
there.

### The layout layer (page skeletons)

Decided in [ADR-0004](decisions/0004-layout-layer.md), adopting the foundation's
ADR-0011 with four app rulings. `components/layout/` is the one legal home for a
component that owns a page's **shape** — the 100vh column, the resizable sidebar
rail, the content region, the terminal drawer. Content arrives through
`ReactNode` slots; non-happy branches (the readiness/degraded banner slot, the
collapsed-sidebar rail) render *inside* the skeleton so the content region never
jumps between a pending and a loaded render; resize **limits** are exported from
the skeleton while the current size arrives as a prop and its persistence stays
in the composition. Our stricter ruling: **skeletons carry no i18n** — structure
has no copy, and every visible string arrives as a slot, the same seam the island
cores use.

**(a) Layouts are structure only.** `components/layout/**` imports `theme.ts`,
`components/ui/` and `lib/` and nothing else in the app: no `core/**`, no
`adapters/**`, no `features/**`, no `routes/**`, no `api.ts`, no `i18n/`, no
TanStack.
— **TYPE**: n/a (an import edge is not a type) · **LINT**:
`web-layouts-are-structure-only` (dependency-cruiser) plus the `web-layout`
`boundaries` element type · **TEST**: `config-regression/lint-gates.test.ts`
plants a layout fixture importing a feature and asserts the named rule fires ·
**REVIEW+AI**: n/a (mechanically covered).

**(b) Features consume layouts; they do not define them.** A page skeleton — a
component owning a page grid or a page-level max-width — may be defined only
under `components/layout/`. This is a claim about the content of a file, not an
edge in the graph, so the mechanical half is incomplete by construction.
— **TYPE**: n/a · **LINT**: partial only — `MUI_SKELETON_BAN`
(`no-restricted-imports`) forbids `Container`/`AppBar`/`Drawer`/`Toolbar`
outside `components/layout/**`, which is a proxy, not the rule · **TEST**: the
MUI-ban probe (violating fixture outside the layer fires; the same import inside
the layer does not) · **REVIEW+AI**: owns the rest — flag a feature growing its
own page grid or max-width instead of consuming a skeleton.

**Structural `sx` tier** (NORMATIVE WHEN TRIGGERED, same trigger as upstream —
*the first duplicated page skeleton outside `components/layout/`*): reserving
`display`, `grid*`, `flex*` on containers, `position: sticky|fixed`, `width` and
`maxWidth` for `components/layout/**` and `theme.ts`, on a per-file,
shrink-only, stale-erroring baseline. Not switched on: the tier has never run
against a real codebase anywhere. Rule (b)'s mechanical half closes when it does.

**Visual specs** per skeleton and per state land with the visual-regression
suite (migration plan P2), not here.

### Layout-truth verification (dump-and-measure)

`getComputedStyle` assertions in a jsdom vitest run (`flexGrow`, `width: auto`,
…) prove intent, not geometry: jsdom has no layout engine, so a passing
structural assertion can still ship a wrapped label or an overflowing split
button — exactly what happened to `FolderBar` before the W42 fix (commit
`0d8ed43`) and what W43's sidebar visual surfaces now pin. For any
layout-touching change (flex/grid sizing, min/max width, wrapping), structural
`sx` assertions are necessary but not sufficient; verify the rendered geometry
before calling it done:

1. Render the component in the jsdom vitest project as usual and serialize its
   emotion-generated styles plus the container's HTML (e.g. `container.innerHTML`
   and the `<style>` tags emotion inserted) to a fixture file.
2. Load that fixture in a real layout engine and measure it —
   `pnpm exec node` driving headless Chromium (Playwright) against the
   serialized HTML, reading `getBoundingClientRect()` on the elements the
   change touches (no wrap, no overflow, expected pixel widths at the
   viewport(s) the change targets).
3. Treat mismatches as the bug, not the test.

**Caveat**: run step 2 with `pnpm exec node` (not bare `node`) — headless
Chromium needs the workspace's Playwright install on the resolved `PATH`/module
graph, and a bare `node` invocation from outside the workspace silently uses a
different (or missing) browser binary. For the surfaces this now pins as
baselines, `pnpm run visual` (ADR-0005) is the committed, repeatable version of
this technique; dump-and-measure is the ad hoc form for a change too small or
too early to justify a new visual surface.

## Delta 5 — long-running work

Encrypted backup recovery keys retain the full 256 bits generated for
AES-256-GCM. The recovery rendering therefore uses 52 Crockford-base32 data
characters plus a 4-character checksum. This is a deliberate correction to
the backup PRD's US-003 wording, which asks 26 base32 characters to round-trip
32 bytes; 26 base32 characters can encode only 130 bits and cannot satisfy the
same story's 256-bit key requirement.

The archive envelope is format version 2: the 40-byte header carries a
16-byte random salt, and every frame is encrypted under
`HKDF-SHA256(masterKey, salt, info='AVCBAK2')` rather than under the Keychain
key itself, so the 4-byte random nonce prefix plus frame counter can never
repeat a (key, nonce) pair across archives. `decryptBackupEnvelope` still reads
the 24-byte version 1 header, whose frames are keyed with the master key
directly.

Every archive records the fingerprint of the key that encrypted it, in the
manifest and in the destination's `appProperties`. Retention only ever prunes
archives carrying the current key's fingerprint, so a reinstalled Mac with a
freshly minted key can never delete the archives it cannot read; enablement
refuses with `recovery_key_required` when the destination already holds
archives written under another key, unless the caller imported that key
(`POST /api/backup/recovery-key/import`) or acknowledged that they stay
unreadable.

`POST /api/backup/recovery-key/import` verifies the pasted key against the
destination before it is written to the Keychain: a key whose fingerprint
matches none of the archives already there is refused with
`recovery_key_mismatch`, and a key already stored on this Mac is replaced only
while no archive in the destination carries its fingerprint, so a wrong but
checksum-valid paste cannot wedge enablement. `GET /api/backup/status` carries
`recoveryKeyFingerprint`, which is how the stepper decides whether the archives
in the destination were written under the key this Mac holds.

Backup surfaces deviate from the PRD in six recorded places. (a) The
enablement flow reaches the destination through
`BackupDestinationPort.connect`, and the service-account path resolves — or
creates — the `AI Video Cataloger Backups` folder inside the configured Shared
Drive, instead of asking the user for a folder id as the runbook implies.
(b) The recovery-key ceremony is per-process state: `POST /api/backup/enable`
refuses with `recovery_key_required` unless the key was exported **and**
confirmed in the same app session, which is also what makes an abandoned
stepper leave `backup_enabled: false`. (c) `GET /api/backup/status` carries the
running app's supported schema versions, so the backup list can disable a row
written by a newer app without a second route. (d) The restore relaunch is
triggered from the renderer through `desktopBridge.app.relaunch()` — a native
surface behind the preload bridge — because the restore job completes inside
the in-process server. (e) `AVC_GOOGLE_DRIVE_BASE_URL` and
`AVC_GOOGLE_UPLOAD_BASE_URL` override the Drive endpoints so e2e can drive a
local fake Google; unset, the real endpoints apply. (f) The status route
carries the whole Settings > Backup readout (enablement, provider, retention,
last success, next due, indicator state, and whether this Mac holds a recovery
key), which is what both the bottom-bar indicator and `avc backup status`
render.

A Google-account connection is a single in-flight operation per server:
`POST /api/backup/connect` refuses a second concurrent call with `conflict`,
aborts on client disconnect, and `POST /api/backup/connect/cancel` aborts the
loopback listener so closing the stepper cannot leave a five-minute pending
request behind. A build without a Google OAuth client id fails
`connect` with `backup_destination_error` before any browser opens.

The Electron main process (and the CLI process, for its lifetime) is a
resident executor. The foundation's `JobsPort` pattern applies **in-process**
at the first real job — which exists on day one: the processing pipeline
(frames → audio → transcribe → analyze → rename). Model downloads and Ollama
pulls are jobs too. Progress = job-status queries polled via TanStack Query
(CQRS holds; the poll helper stops on terminal status). No event bus, no
websockets; revisit only if token-streaming UX demands more, and then as a
typed closed-union event stream, never stringly.

The managed Ollama daemon outlives CLI and GUI processes by design; only the explicit daemon-stop use-case terminates it.

The CLI maps job progress to the NDJSON event stream
(`started`/`progress`/`completed`/`error`) exactly as the old app emitted it
— that stream is a public, script-consumed contract (parity-inventory §1).

A drive run owns the faces pass. Face identity is catalog-global — every embedding is
classified against all people in the index — so face indexing cannot be a per-file step
inside the processing pipeline; it is a root-scoped pass that runs once, at the end of a
completed `process_drive` job, when `faces_enabled` is on. The pass is the same
use-case the standalone `faces index` command runs, reported through the same progress
steps, and it is best effort: a missing model, an unavailable engine, `--skip-faces`, a
cancelled job or a failing pass produces a `faces_pass_skipped` event and a `faces`
block in the run summary, never a failed run. Runs that end early (consecutive-failure
abort, budget cap, failed batch job) skip the pass; the resumed run indexes everything.
ADR-0011.

Face identity is rebuildable without re-extraction: every observation keeps its
embedding, so `faces recluster` recomputes all people and assignments from the stored
vectors alone — no frame extraction, no detector, no `FACE_ENGINE_VERSION` bump (a
version bump means the *extraction* changed and purges observations; a clustering-rule
change never does). The rebuild is a replace: person ids are re-minted, owner-set names
follow the plurality of their old observations, and exemplar crops stay attached to the
observation that produced them. ADR-0012.

A face crop belongs to the observation it was cut from, not to the person that observation
currently belongs to: indexing writes one crop per detected face under
`faces/obs/<fingerprint>/`, and the up-to-five exemplars a person shows — at most one per
file, best quality first — are chosen at read time by a pure function over that person's
observations. Identity can therefore be rebuilt as often as the thresholds change without
ever costing the catalog a photograph, and `faces exemplars` exists only to repair catalogs
indexed before this rule (or crops deleted off disk). ADR-0014.

Face identity spans **media**, not files of one kind: a person is the same person whether
the evidence is a video frame or a photograph, so the faces pass has a photo leg that
detects over `photo-artifacts/proxies/<fingerprint>.jpg` through the engine's image-path
input, and every people surface — the Osoby list, the person card, the collection person
filter, the facet counts, the media detail panes and `faces exemplars` — answers for both
media or answers for neither. The person filter narrowing the library to videos while the
Osoby facet counts photos is a contradiction, not a limitation. Identity rebuild is
deterministic agglomerative average-linkage over cosine similarity on a sparse neighbour
graph, calibrated by a repo benchmark script against a user-supplied reference partition
and cut on the conservative side of the measured optimum (split rather than merge); the
greedy per-observation assignment stays as the *incremental* path, cheap to be wrong on
precisely because the rebuild exists. ADR-0018.

People payloads keep observation counts because grouping quality is about detected face
frames, but the Osoby card and person-media panel also need distinct file counts per
medium so a person seen in many frames of one clip still reads as one video. Media chips
count people, not observations or files.

Osoby folds unnamed people whose total observation count is below the user's persisted
minimum-observation threshold into one visually distinct `Inne` tile at the end of the
grid; named people are always promoted into the main grid, and opening `Inne` only changes
the Osoby grid scope, leaving the shared people query, Library people facets and search
filters untouched.

## Delta 6 — observability

OTel facade + wide events per the foundation, but this is a privacy-sensitive
local app: **telemetry is opt-in, default OFF**; error reporting (Sentry)
only behind explicit user consent. With consent absent (the default), no
exporter is registered and the facade no-ops — zero network. The wide-event
middleware still runs (annotations are free); the composition root decides
whether anything leaves the process.

The same split applies to failure text: an `AppError.message` is user-facing
copy and never carries a resolved executable path, a temp directory or any
other internal filesystem location (v0.6.12 showed a `.../cmux-cli-shims/claude`
path in the details panel). The analyzer command runner writes the full
diagnostic — command, args, exit code, stderr — to the process's stderr, which
the terminal log already surfaces, and returns a plain sentence to the caller.

## Delta 7 — configured readiness

Processing readiness is a core use-case over the configured analyzer and
transcriber only. It returns the selected provider/mode, their availability,
the missing pieces, and setup guidance through `GET /api/readiness`. Media
dependencies remain in the existing process prerequisite gate so the v1
refusal behavior stays intact.

Local-model installed state comes from the reachable Ollama daemon when one
exists. When no daemon is reachable, read-only status checks fall back to the
managed models directory's Ollama manifests without starting the daemon.

Readiness results are cached by resolved folder within each CLI or Electron
main process. The composition root owns that cache and wraps both `ConfigStore`
and `CredentialsStore` so every successful write invalidates it, including
writes outside the settings route. Callers can also request a refresh; the GUI
does so immediately before each run. Doctor embeds this configured view while
retaining its legacy dependency array, `allAvailable` meaning, and exit code.
Folderless onboarding requests use an explicit home readiness scope so the
desktop process working directory can never masquerade as a higher-precedence
folder. Desktop composition passes one canonical home path to persistence,
managed runtimes, and its working-directory fallback.

## Ports (complete list for this app)

- `CatalogRepository` (global catalog index with folder-id dimension) +
  home-scope repository — drizzle. `GlobalCatalogStore.listLocations()` —
  every catalog file that carries GPS coordinates, plus the catalog-wide file
  total the map's coverage caption is measured against.
- `ConfigStore` — per-folder `config.json` (schema in `core/domain`).
- `CredentialsStore` — home-scoped provider secrets; per-folder configuration
  contains provider references only. The primary backend is the macOS Keychain
  (`SecretsStore`, service `com.ai-video-cataloger.app`, account = the
  `apiKeyRef`), with `~/.ai-video-cataloger/credentials.json` (owner-only mode
  `0600`) as the fallback for non-darwin hosts, explicit opt-outs, and any
  environment where `security` cannot run. Keys left in the file migrate into
  the Keychain on first access — write, read back, then remove from the file —
  and doctor names the live backend. Decided in
  [ADR-0007](decisions/0007-credentials-in-keychain.md).
- `SecretsStore` — OS keychain items behind `/usr/bin/security`; the second
  implementation is the fake command runner the gates inject instead of a real
  keychain.
- `MediaPort` — probe/frames/audio/thumbnail/thumbnail-from-frame. Adapters:
  bundled ffmpeg-static, system ffmpeg (platform difference is real). A
  thumbnail is generated by downscaling the selected variant's first stored
  analysis frame; seeking the source is the fallback for files with no stored
  frame. The frame path needs no access to the video, which is what makes
  covers available on an index-only mirror and inside a read-only drive run.
- `TranscriberPort` — whisper.cpp (configured path / managed / system) /
  OpenAI API / skip. Official whisper.cpp v1.9.1 publishes no standalone
  macOS executable, so the primary managed runtime pins the Homebrew arm64
  Sequoia bottles for whisper.cpp, its matching ggml ABI, and libomp. It
  authenticates anonymously to GHCR, validates each OCI manifest, verifies
  every blob SHA-256, extracts the executable, dylibs, and ggml backends into
  a versioned home-scope directory, rewrites Mach-O install names to
  `@loader_path`, and ad-hoc signs every modified image. The canonical
  home-scope wrapper sets the ggml backend path. The official source tarball
  remains an explicit fallback when bottle installation fails and CMake and
  Clang are available.
- `WhisperRuntimePort` — configured / managed / system whisper.cpp resolution
  plus managed bottle installation with source fallback; the configured path
  always wins and the canonical managed executable remains
  `~/.ai-video-cataloger/bin/whisper`.
- `AnalyzerPort` — four families behind one port (v1.1,
  `tasks/prd-providers-onboarding.md`): OpenAI-compatible API adapter
  (BYO base URL + key; credentials live in the home scope only), a
  data-driven agent-harness adapter (Claude Code / Codex / Cursor Agent
  built-ins + user-defined, with optional built-in model/reasoning-effort
  flags), the local ollama adapter, and the `gemini-native` adapter
  (`adapters/gemini`). Legacy config values `claude|local` remain valid
  aliases. The `gemini-native` family sends the whole video to the Gemini
  Files API as one modality (1fps frames + full audio) and takes a native
  processing path that **skips frame extraction and Whisper** — the model
  returns the description and a timestamped transcript in one call, and
  `usageMetadata` (tokens + est cost per file) is surfaced as an NDJSON
  event; GPS still comes from metadata. A budget-capped smoke bench recorded
  in a scratch directory outside the repository validated this path.
- `AnalyzerBatchPort` — the Gemini **Batch API** half of the same adapter,
  used only by `process_drive` and only when batch mode is on
  ([ADR-0008](decisions/0008-gemini-batch-drive-runs.md)): per-file uploads
  stay the streamed Files API path, the run's requests are submitted inline as
  one job at **half the interactive token price**, and each answer is mapped
  back through the ordinary per-file completion path (parse, rename, transcript
  artifacts, global catalog, NDJSON events). The job name and the per-file
  request mapping live in the drive-run record before submission, so an
  interrupted run re-attaches instead of paying twice.
- `LocalAiRuntimePort` — system Ollama / managed pinned runtime. Analyzer
  execution starts the runtime on demand through this port and receives the
  resolved daemon base URL, including the managed runtime's dynamic port.
- `ModelDownloadPort` — HuggingFace whisper models; Ollama pulls go through
  the runtime port.
- `JobsPort` — in-process executor (see Delta 5).
- `BackupDestinationPort` — one port for both Google Drive destinations
  (`drive.file` OAuth, service-account Shared Drive) plus the in-memory fake
  the gates use: `describe`, `connect`, `test`, `ensureFolder`, `list`,
  `upload`, `download`, `remove`. Enablement calls `connect` through the port,
  so no use-case, route, CLI command or component branches on
  `backup_provider`; the composition root is the only place the provider is
  read. All Drive traffic, crypto and filesystem work stay in the main
  process / in-process server — the renderer keeps its zero-networking posture
  and reaches the feature only through contract routes.
- `FileSavePort` — a native save dialog supplied by the Electron composition
  root; the recovery-key export writes the key document through it in the main
  process and returns only a fingerprint and a path, so key material never
  crosses the contract. Compositions without a window (CLI, gates) return
  `unavailable`.
- `FaceEnginePort` — face detect/align/embed/crop lifecycle behind the faces
  feature; ONNX Runtime adapter (darwin-only binding). The drive job composes it (and
  `ModelDownloadPort`) optionally, so a composition without a face engine degrades to a
  reported skip instead of a failure.
- `TrashPort` — `moveToTrash(path)`, the only way a user's media file leaves
  its folder. Two real implementations and a real platform difference between
  them: the Electron composition root supplies `shell.trashItem`, the CLI and
  headless compositions supply a Finder-backed `osascript` move, and a
  composition with neither returns `unavailable`. `rm`/`unlink` and
  `FileSystemPort.deleteFile`/`deletePath` are never applied to a media file;
  they stay the mechanism for the app's own regenerable artifacts. See
  [ADR-0020](decisions/0020-library-hide-and-trash.md).
- `ProvidersPort` — analyzer-provider listing and credential/connectivity
  test, routed across the same three analyzer families.
- `FileSystemPort` — fs primitives incl. `partialContentHash` (ADR-0002(c))
  and a non-mutating `isWritable` (`access(W_OK)`) that lets a dry run report
  a still-read-only mount without touching it; Node adapter in production,
  in-memory fake in tests.
- `FolderWatcherPort` — recursive watch of the opened folder tree. The Node
  adapter (`adapters/fs/folder-watcher.ts`) wraps `fs.watch` with
  `recursive: true` (FSEvents on macOS), drops `.ai-video-cataloger` paths and
  debounces bursts so an in-flight file copy produces one change, not
  hundreds; the memory driver gets an inert implementation. The
  `watchCatalogFolder` use-case holds the refresh while an analysis run
  (`process` / `process_drive`) is active and emits a single coalesced refresh
  once the run settles. Electron main subscribes through `App.watchFolder` and
  forwards `folder:changed` over the preload bridge; the renderer invalidates
  its server state so the sidebar tree and counts follow the disk. Photo-mode
  changes also queue a debounced photo scan. A failed or externally locked
  scan retains that pending change and retries it with capped exponential
  backoff until one scan succeeds, so no second filesystem event is required
  and a persistent failure cannot become an infinite hot loop.
- `DesktopBridge` (client-side port) — preload adapter in `apps/desktop`.

Harness commands are always spawned directly from an argument vector. The
only template substitutions are `{prompt}` and `{videoDir}`; no shell parses
either configured arguments or user/video-derived text. Harness processes run
in their own process group so timeout and job cancellation terminate the full
group. All harnesses receive the same filtered environment. Built-in-only
lifecycle behavior, including Claude Code project-history cleanup, is metadata
on the built-in definition rather than a separate adapter. Provider tests run
the configured command's version invocation; doctor exposes those harness
availability results separately from its legacy dependency list so optional
harnesses do not change the existing `allAvailable` meaning or CLI exit code.
OpenAI Whisper API transcription can override the compatible base URL and
model while keeping credentials in the home-scope provider credential store.

Port rule unchanged: no port without a second implementation or platform
difference; zod, `@tanstack/query-core` and `@opentelemetry/api` remain
vocabulary, never wrapped.

## Gates

`pnpm run check` — typecheck, eslint (boundaries + local plugin), depcruise
mirror, the shipped renderer bundle build, vitest projects. The renderer build
is part of `check` because the bundler's resolution is the only authority on
the renderer's real module graph: `core/domain` is in that graph, and a Node
builtin reaching it fails the build by name-import and is silently
externalized otherwise, so `apps/web/vite.config.ts` refuses any builtin in the
client graph outright. `pnpm run smoke` — installed-tree check (every
declared dependency linked, every native asset the packaged bundle reads as a
literal path materialized), `lock-lint` under pnpm frozen-lockfile semantics,
boot the real in-process app, drive doctor/scan/config/status through the CLI
in an isolated temp HOME + temp folder, assert envelope shapes and taxonomy
exit codes. Both green = done; every new lint rule proves itself with a
violating probe before it counts.

`scripts/` is a dev-tooling directory, never a source layer: the depcruise rule
`no-scripts-in-shipped-code` forbids `core/**`, `adapters/**` and `apps/**` from
importing it. A script is an entry file, and an entry file's module-level
`import.meta.url === process.argv[1]` guard becomes always-true once esbuild
folds it into the single-file packaged CLI, so the script's `main()` runs as a
side effect of every command. Logic a shipped layer needs lives in `core` or in
the owning app; `scripts/build-packaged-cli.mjs` verifies the staged bundle from
a realpath-resolved directory (a symlinked temp root disarms exactly that guard)
and fails on a non-zero exit or on unexpected stderr, and
`scripts/build-packaged-cli.test.ts` re-asserts it inside `check`. `pnpm run workflow-lint` holds the CI
workflow guards to this repository's slug, keeps every job name a literal the
ruleset can match, and refuses a `self-hosted` runner label
([docs/ci.md](ci.md), [ADR-0017](decisions/0017-hosted-ci-runners.md)).

The package manager is pnpm, pinned by `packageManager` and activated through
Corepack; dependency install scripts are off by default and the exceptions are
named in `pnpm-workspace.yaml` ([ADR-0006](decisions/0006-package-manager-pnpm.md)).

Changing this architecture means changing this document (and, for the frozen
constraints, ADR-0001) first, then the code.
