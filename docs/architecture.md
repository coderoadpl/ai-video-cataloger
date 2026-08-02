# Architecture — AI Video Cataloger (local-first Electron)

Normative reference for this app. This document is a **delta** against the
agentproofarch foundation
([`agentproofarch/docs/architecture.md`](https://github.com/chomamateusz/agentproofarch/blob/main/docs/architecture.md),
read it first — its rules apply here except where this document overrides
them). Provenance: foundation docs as of 2026-07-12; local-first decisions in
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
dropping it. When the lock can't be acquired the renderer drops to a
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

Exactly one variant resolves as selected for a file. Resolution uses the
file's explicit `selected_config_id` when that variant exists, then the viewing
folder's default configuration when that variant exists for the file, then the
newest variant by `createdAt` with `configId` as the tie-breaker. A folder's
default is its explicit `folders.default_config_id`, or otherwise the configId
of its resolved processing configuration. Explicit selection is stored per
fingerprint and is therefore shared by duplicate copies of the content; only
the folder-default fallback is folder-relative. Search indexes the resolved
variant only.

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
must remain readable with no migration.

Processing-config resolution (owner decision 2026-07-17): **explicit CLI
flag > folder config > home config > built-in default**, per key. The home
scope holds global defaults (the wizard and `models use` write there when no
folder is in play); a folder's own config overrides point-wise, preserving
per-folder parity — a folder that sets a key always wins. Three app-global keys
are exempt: `ui_language`, `faces_enabled`, and `gemini_monthly_budget_usd` are
always resolved home-scoped and ignore folder overrides. The GUI Prerequisites modal reads the
configured-readiness section from `/api/readiness` with the selected folder;
the doctor contract stays unchanged.

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
and redistributed: Kolekcja, Zdjęcia, Osoby and Mapa become a horizontal
subnav inside Library (no catalog sidebar there); the folder workspace and its
Zdjęcia face become a Filmy/Zdjęcia toggle inside Analysis. The sidebar is
**medium-aware**: it follows `analysisMedia`, rendering `CatalogSidebar` for
Filmy and `PhotosSidebar` for Zdjęcia, and the rail heading follows it too
(Filmy/Zdjęcia) — `DetailsPanel` and the terminal are unchanged. The Zdjęcia
sidebar with zero scanned roots shows an honest empty state with a scan CTA,
never the video list. The toggle itself lives in the top bar,
next to the Biblioteka/Analiza switcher, so it stays visible regardless of
scroll position inside the Analysis workspace; it renders only while
`mode === 'analysis'`. Search exists only inside the Library's
Kolekcja surface — it reuses the single `searchQuery` contract that already
powers the library grid, no new endpoint or search-specific query shape. The
Analysis details pane keeps its video player and variant tools exactly as
before; this rewrite touches only how a user reaches that pane, not what it
renders.

**Browse purification and the preview overlay.** Library and Map are
strictly read-only: Library's Zdjęcia surface hides the analyze/re-run/
variant-picker actions and folder scanning, Library's Osoby surface hides the
faces-index build (moved to Analysis → Zdjęcia, see below), and a Map video
pin opens a preview instead of jumping into the Analysis workspace. The
preview is a new island, `features/preview/`, rendering a selected-variant-
only overlay (player, description, tags, place, capture date) fed exclusively
by the existing `searchQuery` and `catalogLocations` contracts — no new
endpoint, no per-item detail route, video-only in this wave (a `kind:'photo'`
union member is a later extension). It carries a discreet "Otwórz w Analizie"
escape hatch that calls the same `openInAnalysis` routing `routes/index.tsx`
already uses for the Library↔Analysis bridge, completing both directions of
that bridge. The FolderBar and the terminal strip render only in Analysis
mode — Library browses the cross-folder catalog without a current folder, so
neither affordance applies there. The faces-index maintenance action lives
exclusively in Analysis → Zdjęcia, at the `PhotosWorkspace` top strip
(`FacesIndexAction`, backed by the extracted `use-faces-index` hook that
`usePeople` also consumes, so the indexing behavior stays single-sourced);
Library's Osoby view keeps only curation (rename/merge/forget).

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
(substring semantics, debounced), a date range with quick presets sourced from
the year facet, and a three-state has-GPS toggle. Every chip label — including
the has-GPS, date-range and folder chips — is built in `core/` from dictionary
parts passed in, so no English string can leak out of the pure layer. The count header always
states `{shown} of {total}` from the same `searchQuery` response — a filtered
view can never pretend to be the whole catalog.

**Grouping is date or folder, decided in `core/`, not in the toggle handler.**
`features/library/core/folder-groups.ts` emits the same `Section` shape
`grid-rows.ts` already accepts from day-grouping, keyed by `folder.folderId`,
labeled by `displayName`, ordered by `displayName`; an offline folder's badge
applies to the whole section. Sort-within-section (captured newest/oldest,
name; relevance only while a text query is active) is a tested matrix, not an
improvised JSX branch — grouping and sort are independent axes (e.g.
group-by-date with `sort=name` is legal).

**Both tile↔folder connections are first-class.** A tile's primary click and
its context menu (open in folder view, reveal in Finder, copy path) are the
tile→folder direction; a folder header's "Show in Library" action and a
file-level "Show in Library" context-menu/details-pane action are the
folder→tile direction, seeding `filters.folderId` (rendered as a removable
chip) and, for the file-level action, scrolling the grid to that file's row —
`grid-rows.ts` answers "row index of this fingerprint" as a pure, tested
function, never a pixel measurement. Per the cross-feature-import ban, the
catalog and details features never import from `features/library`: they
receive plain `onShowInLibrary(folderPath, fingerprint | null)` callbacks
wired in `routes/index.tsx`, exactly like `openSearchResult` today.

The folder→tile direction resolves `filters.folderId` against the folder facet
the shell already loads, matching on the canonicalized path — a catalogued
folder's persisted id is the `randomUUID` written into its marker file, so a
path hash is never a substitute for it. `derivedFolderId(folderPath)` stays
only as the fallback for a folder the catalog has never seen (and for the
read-only folders whose id genuinely is that hash), where any id would match
nothing anyway. Per the cross-feature-import ban, `VideoList`/`CatalogSidebar`/`DetailsPanel` never
import from `features/library`: they take a plain
`onShowInLibrary(folderPath, fingerprint | null)` callback, wired once in
`routes/index.tsx`, which derives the seed and switches to the Library mode's
Kolekcja surface.

**Library is the default mode once the catalog is non-empty.** Initial mode
resolution is persisted preference (localStorage, the `useScopePreference`
pattern) → `'library'` if the catalog already has ≥1 file → `'analysis'`; an
empty catalog always opens on Analysis, since the folder-open CTA there is the
honest first-run surface. Photos in Library, saved searches, multi-select,
keyboard grid navigation and an in-Library details pane remain out of scope.

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
`query`, `from`, `to`, `tags` apply to both video and photo (photos carry
variant tags in their own FTS). `people`, `place`, `hasGps`, `folderId` are
video-only concepts today — when any of them is set, the photo source
contributes **zero rows** rather than silently ignoring the filter, so a
Library user filtering by person never sees an unfiltered photo sneak into
the page pretending to satisfy a filter it cannot express. `media: 'video' |
'photo'` short-circuits the other source entirely (its offset never
advances). `total` is `videoTotal + photoTotal` for the active filter set;
`videoTotal`/`photoTotal` ride along so the UI can label media chips with
honest per-media counts without a second round trip.

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
following the `searchQuery`/`photosListQuery` pattern; the renderer
consumption (grid, media chip, subnav, placeholders) is out of scope for this
track.

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

## Delta 5 — long-running work

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

## Delta 6 — observability

OTel facade + wide events per the foundation, but this is a privacy-sensitive
local app: **telemetry is opt-in, default OFF**; error reporting (Sentry)
only behind explicit user consent. With consent absent (the default), no
exporter is registered and the facade no-ops — zero network. The wide-event
middleware still runs (annotations are free); the composition root decides
whether anything leaves the process.

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
  event; GPS still comes from metadata. Budget-capped smoke bench (real key,
  11-clip subset, flash vs flash-lite, $0.096 total) recorded at
  `~/repositories/claude-tmp/wf-mg1/bench-report.md`.
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
- `FaceEnginePort` — face detect/align/embed/crop lifecycle behind the faces
  feature; ONNX Runtime adapter (darwin-only binding). The drive job composes it (and
  `ModelDownloadPort`) optionally, so a composition without a face engine degrades to a
  reported skip instead of a failure.
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
  its server state so the sidebar tree and counts follow the disk.
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
violating probe before it counts. `pnpm run workflow-lint` holds the CI
workflow guards to this repository's slug and keeps every self-hosted job
behind its arming variable ([docs/ci.md](ci.md)).

The package manager is pnpm, pinned by `packageManager` and activated through
Corepack; dependency install scripts are off by default and the exceptions are
named in `pnpm-workspace.yaml` ([ADR-0006](decisions/0006-package-manager-pnpm.md)).

Changing this architecture means changing this document (and, for the frozen
constraints, ADR-0001) first, then the code.
