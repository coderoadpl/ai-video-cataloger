# PRD: Library hide and move-to-trash (W88)

Decision record: [ADR-0020](../docs/decisions/0020-library-hide-and-trash.md).
Design: [docs/architecture.md](../docs/architecture.md) Delta 3 and
"Library — hide and move-to-trash";
[docs/architecture-photos.md](../docs/architecture-photos.md) §3a, §7.

## Introduction / Overview

Kolekcja is the app's browse surface: everything ever analyzed, video and
photo, in one feed. Two operations are missing from it, and both are about
taking something *out* of that feed.

**Hide** is reversible and touches nothing on disk. A hidden file vanishes
from Kolekcja, from search, from the map and from Osoby, while the file, its
analyses, its tags and its face observations all stay exactly where they are.
A "Ukryte" filter lists the hidden files and restores them. Hide works on a
folder mounted read-only, because it is a row in the app's own databases and
never a write to the user's folder.

**Move to Trash** is terminal on the app's side. The file goes to the macOS
Trash — through `shell.trashItem` in the desktop app, through a Finder-backed
move in the CLI, never through `rm` — and every record the app derived from it
is erased: the catalog row, every analysis variant, tags, face observations
(a person left with zero observations is deleted and the remaining people's
centroids and exemplars are refreshed), GPS and place, thumbnails, proxies,
photo artifacts, the per-folder sidecar artifacts and the folder's snapshot
entry. It is **all-or-nothing before the batch starts**: the existence and
writability of every affected root is checked *before* the first file moves,
and an offline or read-only root refuses the whole operation with a clear
message and zero changes. If the macOS Trash later refuses an individual file,
the failed file keeps its records and artifacts, remaining files are not
attempted, and the caller receives a failed job with partial counts.

Both actions are driven from a real multi-select in Kolekcja (Cmd-click,
Shift-click, "Zaznacz wszystko" over the whole current filter result, an
action bar with the count) and from a person card's ⋮ menu in Osoby. Both have
full CLI parity, because the CLI is a public contract in this repo.

This document is written to be executed by an agent with no prior context. It
is split into **Wave A** (domain, contract, server, adapters, CLI — no
renderer) and **Wave B** (renderer and e2e), each of which lists its contract
routes and database migrations explicitly, so the two can be implemented from
this document alone. Every requirement is numbered; every story is sized for
one session and carries a verifiable acceptance checklist.

Read before starting: [`../CLAUDE.md`](../CLAUDE.md),
[`../docs/architecture.md`](../docs/architecture.md) (Delta 3 persistence, the
Library query-surface rules, the ports list, contract-as-the-only-bridge, the
renderer bound-actions and zero-networking rules),
[`../docs/architecture-photos.md`](../docs/architecture-photos.md) (§3 artifact
layout, §5 shared identity, §7 contract/CLI/jobs),
[ADR-0002](../docs/decisions/0002-global-catalog-layer.md) (global catalog
ownership, read-only folders, artifact roots),
[ADR-0010](../docs/decisions/0010-analysis-variant-identity-artifacts-and-dedup.md)
(variant artifacts and the name-based projection),
[ADR-0014](../docs/decisions/0014-per-observation-face-crops.md) (crop layout),
[ADR-0016](../docs/decisions/0016-photos-catalog-foundations.md) (photo
artifact root) and
[ADR-0020](../docs/decisions/0020-library-hide-and-trash.md) (this feature).

### Owner decisions (binding — do not relitigate)

1. **Both actions ship.** Hide and move-to-trash are one feature, two verbs.
2. **Hide:** the file disappears from Kolekcja, search, map/places and Osoby.
   A person whose files are all hidden disappears from the Osoby grid; hidden
   files never count. The file and its analyses stay. A "Ukryte" filter lists
   hidden files with "Przywróć". It works on read-only folders. It is
   persisted in the catalog database (`videos`/`files`) and the photos
   database (`photos`).
3. **Trash:** the file is moved to the macOS Trash — `shell.trashItem` in the
   Electron composition, an equivalent Finder-backed move in the CLI, **never**
   `rm`. Every record disappears (see FR-40). All-or-nothing per folder root;
   writability of every affected root is checked **before** the first move; a
   offline or read-only root fails closed with a clear message and zero
   changes, reusing the root probing the app already has. A strong
   confirmation states the count and the roots and is gated by a checkbox.
4. **Selection in Kolekcja:** Cmd-click / Shift-click; "Zaznacz wszystko"
   selects the **whole current filter result** (a server-side scope, not only
   the loaded tiles); an action bar shows the count and the two actions.
5. **Person shortcuts:** a person card's ⋮ menu gets "Ukryj pliki tej osoby"
   and "Przenieś do Kosza pliki tej osoby". The dialog states "N plików, w
   tym M z innymi osobami" when shared files exist, omits that clause when
   none exist, and offers "pomiń pliki z innymi osobami" — default **on** for
   trash, **off** for hide.
6. **CLI parity is mandatory:** `library hide`, `library unhide`,
   `library trash`, each accepting a fingerprint list, a filter or a person,
   with NDJSON events and taxonomy exit codes; `--dry-run` for trash.
7. **Folder watch:** a trashed file must not resurrect, and a hidden file must
   survive rescans.

## Goals

- **G-1** A user removes a file from Kolekcja in two clicks and brings it back
  in two clicks, without the app touching the file.
- **G-2** A user deletes a file and everything the app derived from it in one
  confirmed action, and finds the file in the macOS Trash afterwards.
- **G-3** A bulk trash over a catalog that spans external drives either
  completes, refuses before moving anything, or fails loudly with exact partial
  counts while leaving the failed and not-attempted entries intact.
- **G-4** Hiding never fails because a folder is read-only, an SD card is
  write-protected, or a drive is unplugged.
- **G-5** Selecting "Zaznacz wszystko" acts on the whole filter result at
  catalog scale, without the renderer fetching every page.
- **G-6** Everything the GUI can do, the CLI can do, with NDJSON events and
  taxonomy exit codes.
- **G-7** The feature stays inside the closed taxonomy: any new error kind has
  explicit HTTP and CLI mappings, and no new database file or on-disk directory
  is introduced.
- **G-8** A rescan (folder watcher, `scan`, `index rebuild`, `photos scan`)
  never resurrects a trashed file and never un-hides a hidden one.

## User Stories

Stories are grouped into two waves. **Each story is one session's work and
must land with `pnpm run check` and `pnpm run smoke` green.** Every story is
**RED-first**: the test that names the behaviour is written and observed
failing before the code that satisfies it exists. Stories that change
user-visible behaviour add their `CHANGELOG.md` line under `[Unreleased]` in
the same commit. Story numbers are stable identifiers, **not** the landing
order: where a story depends on a later-numbered one, its heading says so.
Wave A lands US-A1 → **US-A3** → US-A2 → US-A4 → US-A5 → US-A6 → … , because
US-A2's use-cases consume US-A3's resolver and US-A3's resolver consumes the
store predicate US-A1 lands with the columns. Because "one session's work"
means `check` green at the end of *every* story, a story never ships a test
that asserts the next story's shape: US-A1's key-set drift test therefore
excludes `hidden` until US-A4 adds it to `collectionInputSchema` and removes
the exclusion in the same commit.

---

## WAVE A — domain, contract, server, adapters, CLI (no renderer)

**Contract routes added in this wave** (all zod, all in
`core/contract/routes.ts`, all registered in `API_ROUTES` **and** `API_PATHS`):

| Route | Method + path | Input | Output |
|---|---|---|---|
| `librarySelectionPreview` | `POST /api/library/selection/preview` | `librarySelectionPreviewInputSchema` | `librarySelectionPreviewOutputSchema` |
| `libraryHide` | `POST /api/library/hide` | `libraryHideInputSchema` | `libraryHideOutputSchema` |
| `libraryUnhide` | `POST /api/library/unhide` | `libraryUnhideInputSchema` | `libraryUnhideOutputSchema` |
| `libraryTrash` | `POST /api/library/trash` | `libraryTrashInputSchema` | `libraryTrashOutputSchema` |

Every one of those schemas is written out field by field below: the three
selection-only inputs in US-A3, the hide/unhide output in US-A2, the trash
input and its output union in US-A9, the preview output in US-A3.
`libraryTrash` deliberately does **not** return `jobAcceptedOutputSchema`: a
`dryRun` call answers with a plan that no job envelope can carry, so the output
is a two-member discriminated union whose `job` member carries the same `jobId`
field `jobAcceptedOutputSchema` does.

**Contract routes changed in this wave** (additive only):
`GET /api/search` and `GET /api/library/collection` gain `hidden`;
`GET /api/library/facets` gains `counts.hidden`;
`GET /api/photos/search` gains `hidden`.

**Database migrations in this wave:**

| Store | Version | Statements |
|---|---|---|
| `catalog.db` | **V17** | `ALTER TABLE files ADD COLUMN hidden_at INTEGER`; `CREATE INDEX IF NOT EXISTS files_hidden_at_idx ON files(hidden_at)` |
| `photos.db` | **v7** | `ALTER TABLE photos ADD COLUMN hidden_at INTEGER`; `CREATE INDEX IF NOT EXISTS photos_hidden_at_idx ON photos(hidden_at)` |
| snapshot | `CATALOG_SNAPSHOT_SCHEMA_VERSION` **12 → 13** | the `record.file` payload gains `hiddenAt: number \| null` |

(The current versions are `GLOBAL_CATALOG_SCHEMA_VERSION = 16`,
`PHOTOS_SCHEMA_VERSION = 6`, `CATALOG_SNAPSHOT_SCHEMA_VERSION = 12`; confirm
them before writing the migration and use *next*, not literally V17/v7, if
another wave landed first.)

---

### US-A1: Selection scope vocabulary, the two hidden columns and the store predicate

**Description:** As a developer, I need the feature's vocabulary — how a
selection is expressed, and where "hidden" is stored — to exist as closed zod
schemas and schema migrations before any behaviour is built, so no later story
invents an ad-hoc shape. The column and the predicate that reads it land in
the **same** story: a `hidden_at` column no store query can filter on is dead
weight, and US-A3's resolver needs the predicate the moment it resolves a
`filter` scope.

**Acceptance Criteria:**
- [ ] `core/domain/library-selection.ts` defines, with zod, the closed
      discriminated union `librarySelectionScopeSchema` on `kind`:
      `{ kind: 'fingerprints', fingerprints: string[] }` (min 1, max 5000),
      `{ kind: 'filter', filter: librarySelectionFilterSchema }`,
      `{ kind: 'person', personId: string, skipSharedWithOtherPeople: boolean }`.
- [ ] `hiddenScopeSchema = z.enum(['exclude', 'only', 'include'])` is defined
      in the **same domain module** and re-exported from `core/contract`.
      `core/domain` may not import `core/contract` (the dependency-cruiser rule
      `core-domain-depends-on-nothing`) and `librarySelectionFilterSchema`
      carries a `hidden` field, so the domain module is the only possible home;
      the contract's three `hidden` parameters (US-A4) use the re-export.
- [ ] `librarySelectionFilterSchema` carries exactly the **set-defining**
      fields of `collectionInputSchema` — `query?`, `tags`, `people`, `place?`,
      `from?`, `to?`, `hasGps`, `folderId?`, `media`, `hideUnavailable`,
      `hidden` — and nothing else. It is a **JSON body** schema, not a query
      string, so it declares `z.array(z.string())` and `z.boolean().nullable()`
      directly instead of reusing the contract's query-string coercion helpers
      (`csvList`, `queryBooleanTriState`), which exist to parse comma-separated
      strings out of a URL.
- [ ] A drift test compares `keys(librarySelectionFilterSchema) − exclusions`
      with `keys(collectionInputSchema) − exclusions`, the exclusion list being
      subtracted from **both** key sets before the comparison, with the explicit
      exclusion list `['sort', 'limit', 'cursor', 'hidden']` — `sort` orders a
      page and does not define the set; `limit` and `cursor` page it; `hidden`
      is a **temporary** entry, because `collectionInputSchema` gains its own
      `hidden` parameter only in US-A4, which deletes that entry from the list
      in the same commit — and fails on any key present in one and absent from
      the other. Field-for-field type
      equality is *not* asserted, because the two schemas parse different
      transports. The test file lives in **`core/contract/`** (e.g.
      `core/contract/library-selection-drift.test.ts`), because it has to
      import both schemas at once and only `core/contract` may import
      `core/domain`: a test under `core/domain` or `core/server` importing
      `collectionInputSchema` violates `core-domain-depends-on-nothing` and
      `core-server-pure` in `.dependency-cruiser.cjs`.
- [ ] `catalog.db` migration **V17** adds `files.hidden_at` (nullable
      `INTEGER`, epoch milliseconds) and the index; `photos.db` migration
      **v7** adds `photos.hidden_at` and the index.
- [ ] `CatalogFile` and the photo record type gain `hiddenAt: number | null`;
      `CATALOG_SNAPSHOT_SCHEMA_VERSION` becomes 13 and the snapshot line
      schema carries `hiddenAt`.
- [ ] `GlobalCatalogStore` gains `setHidden(fingerprints, hiddenAt | null)` —
      one transaction, returning changed/unchanged counts, never moving an
      already-set `hidden_at` — and `CatalogSearchFilters` gains
      `hidden: 'exclude' | 'only' | 'include'` (default `'exclude'`) pushed
      down to SQL in **both** branches of `GlobalCatalogStore.search`, the
      FTS-match branch and the plain browse branch, so the rows, the totals and
      the composite cursor agree.
- [ ] `PhotosStore` gains the same two things: `setPhotosHidden` with the same
      transaction and the same counts, and `hidden` on the `collectionPage`
      and `searchPhotos` filters, pushed down to SQL.
- [ ] **The upsert conflict clause must not carry `hiddenAt`.**
      `GlobalCatalogStore.upsertFile` writes its incoming record's `missingAt`
      — and every other mutable column — inside
      `onConflictDoUpdate({ set: … })`. Adding `hiddenAt` to `CatalogFile`
      without a rule would therefore let `scan`, `process`, `materialize` and a
      snapshot import over an existing row silently clear a hide. The rule:
      the **INSERT** path (a brand-new row, which includes a snapshot import
      into an index that does not know the fingerprint) carries `hiddenAt` from
      the record, so the `index forget` → `index rebuild` round trip preserves
      it; the conflict `set` clause **omits `hiddenAt` entirely**; the only
      statement that ever moves the column is `setHidden`.
      `PhotosStore.upsertPhoto` follows the same rule with `setPhotosHidden`.
- [ ] RED tests: (a) a catalog seeded at V16 and a photos store seeded at v6
      migrate with every existing row reading `hidden_at IS NULL` and every
      other table byte-identical (lossless-migration probe); (b) a v12
      snapshot imports with `hiddenAt === null`; (c) a v13 snapshot
      round-trips `hiddenAt` through export → import **into an empty index**
      (the INSERT path); (d) `upsertFile` of a record whose `hiddenAt` is
      `null` over an already-hidden row leaves `hidden_at` set, and the same
      for `upsertPhoto`; (e) the key-set drift test against the exclusion list
      above; (f) `setHidden` and `setPhotosHidden` move `hidden_at` and report
      changed/unchanged, and each of the three `hidden` values returns
      exactly the visible set, exactly the hidden set and both, from
      `GlobalCatalogStore.search` in **each** of its two branches and from
      `PhotosStore.collectionPage` and `PhotosStore.searchPhotos`.
- [ ] The hidden-column migration story introduces no `ErrorCode`;
      `core/domain/domain-model.test.ts` stays green unchanged.
- [ ] Changelog: none (no user-visible behaviour yet: no route, no command and
      no surface reaches the new column, whose default predicate is
      `'exclude'` over a table in which nothing is hidden).

---

### US-A2: Hide and unhide use-cases

**Requires US-A1 and US-A3 landed first.** The stores' `setHidden` /
`setPhotosHidden` and the `hidden` predicate are US-A1's; `libraryHide` and
`libraryUnhide` resolve a `librarySelectionScope` through the shared resolver
US-A3 builds. The implementation order in Wave A is therefore
US-A1 → **US-A3** → US-A2 → US-A4 → US-A5 → …; the numbering here is stable
for cross-references and is not the landing order. This story adds no store
method and no SQL: it is the two use-cases and their output schema.

**Description:** As a user, I want to hide files so they leave my browse
surfaces without anything being deleted, and to bring them back.

**Acceptance Criteria:**
- [ ] `core/server/usecases/library-hide.ts` exposes `libraryHide` and
      `libraryUnhide`, both `Result<LibraryHideOutput, AppError>`, both
      resolving a `librarySelectionScope` through the shared resolver of
      US-A3.
- [ ] `libraryHideOutputSchema = z.object({ requested, changed, unchanged,
      videos, photos })` — all non-negative integers, `videos + photos ===
      changed` — and `libraryUnhideOutputSchema` is that same shape.
      One neutral vocabulary for both verbs: "already hidden" and "already
      visible" are the same `unchanged` fact seen from two directions, so
      neither output invents a verb-specific field name.
- [ ] Hiding is idempotent: hiding an already-hidden file counts under
      `unchanged` and does not move `hidden_at`; unhiding a visible file is the
      same no-op. That is US-A1's `setHidden` guarantee, surfaced in the
      output — the use-case does not re-implement it with a read-then-write.
- [ ] Hide succeeds on a folder whose root is read-only — the use-case never
      touches the filesystem. A RED test proves it with the in-memory FS fake
      configured to fail every write.
- [ ] RED tests: hide of a mixed video+photo fingerprint list; unhide;
      idempotency; read-only folder; a `filter`-kind scope hides exactly the
      rows the same filter returns from `libraryCollection` (asserted by
      running both).
- [ ] Changelog (Added): one line naming hide/unhide as catalog operations.

---

### US-A3: Selection scope resolution and the preview route

**Requires US-A1 landed first** (the resolver reads the `hidden` predicate
US-A1 pushed into the stores) and **lands before US-A2**, which consumes this
resolver.

**Description:** As a developer, I need one resolver that turns any selection
scope into a fingerprint list plus the facts the confirmation dialogs need, so
the GUI, the CLI, hide and trash all agree about what "the selection" is.

**Acceptance Criteria:**
- [ ] `core/server/usecases/library-selection.ts` exposes
      `resolveLibrarySelection(deps, scope)` returning one entry per selected
      **fingerprint**, shaped
      `{ fingerprint, media, hiddenAt: number | null, sightings: [{ folderId,
      rootPath, path }] }` with **at least one** sighting. One entry cannot
      carry a single `folderId`/path: a fingerprint sighted from several
      folders is one `photos` row and many `photo_paths` rows (and one `files`
      row that a relocation can repoint), while FR-44 trashes *every* sighting
      — so the affected-root set of US-A7 is the **union of `rootPath` over
      every sighting of every entry**, and the trash job's per-file loop walks
      sightings, not entries.
- [ ] `hiddenAt` is part of the resolver's output, not a second query: the
      preview's `hiddenCount` / `visibleCount` (and the renderer's choice
      between "Ukryj" and "Przywróć zaznaczone") are computed from it.
- [ ] The `'filter'` kind resolves through the **same store queries**
      `libraryCollection` uses, with paging removed, so the result is exactly
      the current filter's result set — never the loaded page. A test asserts
      that a filter matching more than one page resolves to every matching
      fingerprint.
- [ ] The resolver forwards `filter.hidden` to the store predicate US-A1
      added (`CatalogSearchFilters.hidden` and the photo stores' `hidden`),
      so a scope built from the "Ukryte" view resolves to hidden files rather
      than to nothing. It is the resolver's only use of that field: nothing
      here re-reads `hidden_at` after the rows come back.
      RED test: a `filter` scope with `hidden: 'only'` resolves to exactly the
      hidden set, with `'exclude'` to exactly the visible set and with
      `'include'` to both, over a seeded mix of video and photo rows.
- [ ] The `'person'` kind resolves to every file carrying an observation of
      that person. `skipSharedWithOtherPeople: true` drops every file that also
      carries an observation whose `person_id` is **non-null and different**
      from the scoped person; an unassigned observation (`person_id IS NULL`)
      is not "another recognized person" and never causes a skip. The preview
      computes `sharedWithOtherPeople` before that skip is applied, so the
      dialog can state the total files, the shared files that will be skipped
      by default for trash, and the files that will actually move.
- [ ] `librarySelectionPreviewInputSchema`, `libraryHideInputSchema` and
      `libraryUnhideInputSchema` are each exactly
      `z.object({ scope: librarySelectionScopeSchema })`;
      `libraryTrashInputSchema` is that plus `confirm` and `dryRun` (US-A9).
      No route invents a second way to name a selection.
- [ ] `POST /api/library/selection/preview` returns
      `{ total, videoCount, photoCount, hiddenCount, visibleCount,
      sharedWithOtherPeople, roots: [{ folderId, displayName, currentPath,
      fileCount, writable, online }] }`. `writable` comes from
      `FileSystemPort.isWritable` — the non-mutating `access(W_OK)` probe.
      `total`, `videoCount`, `photoCount`, `hiddenCount` and `visibleCount`
      count **fingerprints** (`hiddenCount + visibleCount === total`), while a
      root's `fileCount` counts the **sightings** under that root, so the
      roots' `fileCount` values sum to the sighting count, which is ≥ `total`.
      The copy in the dialogs states the fingerprint count.
- [ ] An empty scope is `validation`: `fingerprints: []` fails the schema's
      `min(1)`, and a filter or a `person` scope that resolves to zero files is
      `validation` from the resolver. Never an empty success for trash.
- [ ] An unknown `personId` is `not_found`. A `fingerprints` scope in which
      **any** entry is unknown to both the catalog store and the photos store
      is also `not_found`, with the unknown fingerprints listed in `details`,
      and resolves to nothing — partial resolution is not offered, because a
      bulk trash that silently acts on seven of ten named files is exactly the
      outcome this feature exists to prevent.
- [ ] RED tests: multi-page filter resolution; person with and without
      `skipSharedWithOtherPeople`; a photo fingerprint sighted from two folders
      resolving to **one** entry with **two** sightings, whose preview lists
      both roots; a preview over a read-only root reporting
      `writable: false` **without** writing anything (the FS fake asserts zero
      write calls).
- [ ] Changelog: none (internal route consumed by the next stories; add the
      line in US-A5 where the user-visible command lands).

---

### US-A4: Every library surface honours `hidden`

**Description:** As a user, I want a hidden file to be gone from Kolekcja,
search, the map and Osoby, and to be listed only by the "Ukryte" filter.

**Acceptance Criteria:**
- [ ] `searchInputSchema` and `collectionInputSchema` gain
      `hidden: hiddenScopeSchema` (default `'exclude'`);
      `photosSearchInputSchema` gains the same.
- [ ] The same commit deletes `'hidden'` from the exclusion list of US-A1's
      key-set drift test, leaving `['sort', 'limit', 'cursor']`: from here on
      `librarySelectionFilterSchema` and `collectionInputSchema` are held to
      the same `hidden` field, and dropping it from either one turns the test
      red.
- [ ] `libraryCollection` applies it to **both** legs, and `total`,
      `videoTotal`, `photoTotal`, `mediaTotals` and the composite cursor are
      all computed from the same predicate — a test asserts a hidden file
      changes every one of those numbers together (the W71 `hideUnavailable`
      invariant, restated for `hidden`).
- [ ] The predicate is pushed into SQL in **every** store method that feeds a
      library surface, never applied after the rows come back:
      `GlobalCatalogStore.search` — the single method
      (`core/server/ports.ts`, `search(input: CatalogSearchInput)`) that backs
      **both** `search` (`core/server/usecases/search.ts`) and the video
      leg of `libraryCollection` (`core/server/usecases/collection.ts`); there
      is no `searchFiles` and no `collectionPage` on the catalog store. The
      predicate enters through `CatalogSearchFilters.hidden` (US-A1, where it
      is already applied in **both** of that method's branches, the FTS-match
      branch and the plain browse branch, so `total` and the composite cursor
      agree with the rows) — this story only routes the new contract parameter
      into it, and likewise into `PhotosStore.collectionPage` and
      `PhotosStore.searchPhotos`, which US-A1 also already filters. The three
      methods still to be taught the predicate here are
      `GlobalCatalogStore.listLibraryFacets` (all five `GROUP BY` queries and
      the `counts` block),
      `GlobalCatalogStore.listLocations` and
      `PhotosStore.listPhotoLocations` — every photo-side method keeps its
      existing name.
- [ ] `listLibraryFacets` gains `counts.hidden`. That count spans both media
      while the method reads only `catalog.db`, so `libraryFacets` gains a
      `photos: PhotosStore` dependency — `LibraryFacetsDeps` is
      `{ globalCatalog, fs }` today — and adds a new `PhotosStore.countHidden()`
      to the catalog-side count.
- [ ] `catalogLocations` excludes hidden files from the pins **and** from the
      catalog-wide total the coverage caption is measured against, on both of
      its legs (`globalCatalog.listLocations()` and
      `photos.listPhotoLocations()`).
- [ ] `facesPeople` computes `observationCount`, `videoCount`, `photoCount`
      and `fileCounts` (`{ video, photo }`, the distinct-fingerprint counts
      W84 added) over visible files only and **omits** a person whose every
      observation sits on hidden files. All four come from the same filtered
      observation list in `personView`, so one filter moves them together.
      It reads `globalCatalog.listFaceObservations()`, whose photo rows carry `ph_*`
      fingerprints that `catalog.db` cannot resolve to a `photos.hidden_at`, so
      the hidden set is assembled in the use-case from two new store methods —
      `GlobalCatalogStore.listHiddenFingerprints()` and
      `PhotosStore.listHiddenFingerprints()` — and applied to the observation
      list. `FacesDeps` already carries `photos`, so no dependency is added
      here.
- [ ] The `people` row is not deleted: unhiding restores the same `personId`,
      name and exemplars — asserted by a hide → assert-absent → unhide →
      assert-identical test.
- [ ] Analysis surfaces are untouched: `GET /api/scan`,
      `GET /api/catalog-tree`, `GET /api/catalog-tree/folder`,
      `GET /api/photos/tree`, `GET /api/photos/list`, `GET /api/status`,
      `GET /api/variants` and `GET /api/index/status` return a hidden file
      exactly as before — one pinning test per route.
- [ ] `hidden: 'only'` returns exactly the hidden set; `'include'` returns
      both.
- [ ] RED tests for each bullet, plus a real-store test in
      `apps/server/src/collection-real-stores.test.ts` covering the mixed
      video+photo case against `SqlJsPhotosStore`.
- [ ] Changelog (Changed): one line naming the surfaces a hidden file leaves
      and the `hidden` parameter on the three list routes.

---

### US-A5: `library hide` / `library unhide` CLI

**Description:** As a CLI user, I want the same hide and unhide the GUI will
get, with NDJSON events and taxonomy exit codes.

**Acceptance Criteria:**
- [ ] `avc library hide` and `avc library unhide` accept exactly one scope,
      and the flag names are taken from the `search` command as it exists today
      (`apps/cli/src/main.ts`), not invented:
      - **fingerprint scope** — `--fingerprint <fp>`, repeatable.
      - **filter scope** — a positional `[query]`, `--tag <name>` (repeatable,
        AND semantics), `--person <nameOrId>` (repeatable, OR semantics),
        `--place <text>`, `--from <iso>`, `--to <iso>`, `--has-gps` /
        `--no-has-gps`, `--folder <path>`, plus the two flags this wave adds
        **on the library commands only**: `--media <all|video|photo>` and
        `--hidden <exclude|only|include>`, which map to
        `librarySelectionFilterSchema`'s `media` and `hidden`.
        There is no `--query`, no `--tags` and no `--people`: `search` has
        never had them and the CLI surface is a public contract.
        `--media` is **library-only**. `avc search` calls `GET /api/search`,
        whose `searchInputSchema`/`searchOutputSchema` are video-only
        (`searchOutputSchema.results` is an array of the video
        `searchResultSchema`), so `search` has no medium to choose between and
        this wave does not give it one; `media` lives in
        `collectionInputSchema` and in `librarySelectionFilterSchema`.
      - **person scope** — `--of-person <personId>`, with `--skip-shared`.
        Deliberately *not* `--person`, which already means "narrow the filter
        to this person" in the filter scope; one flag cannot carry both "narrow
        the result" and "this whole command is about this person".
      Two scopes at once, or none, is `validation` (exit 2).
- [ ] Filter flag names, value parsing and defaults mirror `avc search`
      exactly. The drift test compares the two option sets **restricted to the
      flags `search` actually declares** — today `[query]`, `--tag`,
      `--person`, `--place`, `--from`, `--to`, `--has-gps`/`--no-has-gps`,
      `--folder`, `--sort`, `--limit`, `--offset`, `--json` — with two explicit
      exclusion lists: `search`'s ordering and paging flags (`--sort`,
      `--limit`, `--offset`), which are not part of a selection — `--json` is
      not excluded, both sides declare it — and
      the **library-only** flags the library commands add on top
      (`--media`, `--fingerprint`, `--of-person`, `--skip-shared`, and on
      `library trash` also `--dry-run` and `--yes`), which `search` must not be
      expected to declare. `--hidden` is on **neither** list: this wave adds it
      to `search` too, so the test asserts both sides declare it.
- [ ] `avc search` gains exactly one flag — `--hidden <exclude|only|include>`,
      default `exclude`; `--hidden only` and `--hidden include` list hidden
      files. It does **not** gain `--media`: `GET /api/search` returns video
      results only.
- [ ] `--json` emits the established NDJSON envelope with command names
      `library_hide` / `library_unhide`; human mode prints a one-line summary.
- [ ] Exit codes: success 0; empty/ambiguous scope 2; unknown `--of-person`
      id or unknown `--fingerprint` 5.
- [ ] Smoke leg: hide a fingerprint through the CLI, assert the envelope shape,
      that a following `search` no longer returns it and that
      `search --hidden only` does, then unhide and assert it is back in the
      default listing.
- [ ] Changelog (Added): one line for `library hide` / `library unhide`, one
      for the new `search --hidden` flag.

---

### US-A6: `TrashPort` and its two adapters

**Description:** As a developer, I need one port for "move this file to the
macOS Trash", with the Electron and the CLI mechanism behind it, so no
use-case knows which host it runs in and no code path can reach for `rm`.

**Acceptance Criteria:**
- [ ] `core/server/ports.ts` declares
      `TrashPort { moveToTrash(path: string): Promise<Result<void, AppError>> }`.
- [ ] `apps/desktop/src/composition.ts` supplies `shell.trashItem`, wired the
      same way `openExternal` and `saveFile` already are (config field →
      `apps/server/src/composition.ts` → deps) — and, exactly like
      `openExternal`, as a **call-site wrapper**:
      `moveToTrash: (targetPath: string) => shell.trashItem(targetPath)`, never
      `moveToTrash: shell.trashItem`. A captured reference cannot be replaced
      afterwards, and the e2e trash leg (US-B6) stubs this native surface by
      patching `shell.trashItem` in the Electron main process through
      `app.evaluate` once the app has already booted.
- [ ] `adapters/fs/finder-trash.ts` implements the CLI/headless mechanism.
      **The path never enters the AppleScript source text.** Interpolating it
      into the script (`… POSIX file "<path>"`) is an injection: a file name
      containing `"` or `\` terminates or escapes the AppleScript string
      literal, and a crafted name can append statements. The script therefore
      takes the path through `argv`, and the exact vector is:

      ```
      execFile('osascript', [
        '-e', 'on run argv',
        '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
        '-e', 'end run',
        '--', absolutePath,
      ])
      ```

      never a shell (`exec`, `sh -c`, string concatenation), and the `--`
      terminator keeps a path beginning with `-` out of `osascript`'s own
      option parsing.
- [ ] There is **no generic command-runner port** in this repo — the only one
      is `AnalyzerCommandRunner` in `adapters/analyzers/`, which is
      analyzer-shaped (prompt/stdout/timeout) and is not the right seam. The
      precedent for a one-off `osascript` call is
      `apps/desktop/src/cli-install.ts` (`execFileAsync('osascript', […])`):
      an **adapter** may import `node:child_process` directly, which is
      exactly what `adapters/fs/finder-trash.ts` is. The module takes an
      injectable runner — `(file: string, args: readonly string[]) =>
      Promise<{ code: number; stderr: string }>`, defaulting to the
      `node:child_process` `execFile` — so the gates can assert the vector
      without spawning anything. No new port is added to
      `core/server/ports.ts` beyond `TrashPort` itself.
- [ ] A composition with neither returns `unavailable` from every call; the
      gates inject an in-memory fake that records paths.
- [ ] Artifact deletion is split into its own module:
      `core/server/usecases/library-trash-artifacts.ts` is the **only** module
      of this feature that calls `FileSystemPort.deleteFile` / `deletePath`,
      and it never receives a media path — its inputs are a fingerprint and the
      artifact roots. That makes the guard syntactic instead of a data-flow
      analysis nobody can lint: an eslint `no-restricted-syntax` rule (or the
      equivalent `boundaries` restriction) forbids any `deleteFile` /
      `deletePath` call inside `core/server/usecases/library-trash.ts`. Per the
      repo rule the probe — one such call added to `library-trash.ts` —
      must be observed failing before the rule is accepted.
- [ ] RED tests: the desktop adapter forwards the exact path; the Finder
      adapter builds the expected argument vector and surfaces a non-zero exit
      as an `AppError`; the null composition returns `unavailable`; and the
      injection probe — a path containing both `"` and `'` (and a leading `-`)
      arrives as the **last** element of the recorded `argv`, byte-identical to
      the input, while **none** of the `-e` script elements contains any part
      of the path.
- [ ] Changelog: none (no user-visible surface yet).

---

### US-A7: The trash use-case — pre-flight, records, artifacts, snapshot

**Description:** As a user, I want a confirmed trash to move my files to the
macOS Trash and erase everything the app derived from them, or to change
nothing at all.

**Acceptance Criteria:**
- [ ] `core/server/usecases/library-trash.ts` exposes `libraryTrashPreflight`
      (synchronous, returns the plan) and `runLibraryTrash` (the job body).
- [ ] **Pre-flight** resolves the scope, derives the affected roots as the
      union over **every sighting of every resolved entry** (US-A3) — the
      sighting's owning folder root **and** the parent directory of its file —
      probes each for existence and writability, and returns `target_offline`
      (409 / exit 58) or `target_read_only` (409 / exit 46) naming the
      offending roots in `details` when any fails — with zero writes, zero
      moves and zero row changes.
- [ ] The job body re-runs the same probe before the first move and aborts the
      whole run if the answer changed (a drive unmounted between confirm and
      start).
- [ ] Per resolved fingerprint, in order: `TrashPort.moveToTrash` once per
      **sighting** path (FR-44); if every move succeeds, delete the database
      records of FR-40 inside one transaction per store; flush `catalog.db` and
      `photos.db`; then delete the artifacts of FR-41. A Trash failure stops at
      that fingerprint, leaves its rows and artifacts intact, reports the
      original `AppError` inside a `library_trash_incomplete` summary, and
      never continues to the next one.
- [ ] `catalog.ndjson` is re-exported for every affected writable folder whose
      rows changed on **every** exit path — a clean batch, a batch that stopped
      after earlier successes, and a cancelled batch — in a `finally`-shaped
      step, not only on success. The already-processed files have had their
      rows deleted, so a snapshot left un-rewritten keeps the `index forget` →
      `index rebuild` resurrection path open for exactly the files the run
      *did* delete. RED test: cancel after file 2 of 5, then assert the
      re-exported snapshot no longer names the two trashed fingerprints and
      still names the other three.
- [ ] Record removal reuses the existing ports rather than hand-written SQL,
      and the two media use **different** calls, because the existing methods
      already differ:
      - **Video** — `GlobalCatalogStore.forgetEntry(fingerprint)` and nothing
        else on the catalog side. It already deletes the `files`, `analyses`,
        `file_tags`, search-document/FTS, `face_index_state` **and
        `face_observations`** rows, already runs `recomputeAffectedPersons`
        for the affected people, and already returns `cropPaths` — which is
        the list the artifact module (US-A6) then deletes. Calling
        `deleteFaceObservationsForFile` as well would be a second pass over
        rows that are already gone.
      - **Photo** — `GlobalCatalogStore.deleteFaceObservationsForFile(fingerprint)`
        for the `catalog.db` half (it deletes the observations, runs
        `recomputeAffectedPersons` and returns that photo's `cropPaths`),
        then `PhotosStore.deletePhoto` for the `photos.db` half, catalog
        first. `forgetEntry` is **not** used for a photo: a `ph_*`
        fingerprint has no `files` row, so `forgetEntry` returns
        `{ deleted: false, folderId: null, cropPaths: [] }` and deletes
        nothing — including the observations, which would then be orphaned.
      A RED test pins both halves: `forgetEntry` over a photo fingerprint
      returns `deleted: false` (so the photo path may not rely on it), and a
      photo trash leaves zero `face_observations` rows in `catalog.db` for
      that fingerprint.
- [ ] A photo trash deletes the photo's `face_observations` rows from
      **`catalog.db`** as well as its rows from `photos.db`, and recomputes
      the affected people in the same pass; a person left with zero
      observations is deleted, the rest get refreshed centroids and
      `exemplar_count`.
- [ ] `--dry-run` / `dryRun: true` performs the resolution, the root
      derivation and the root probe, returns the plan described by
      `libraryTrashPlanSchema` (US-A9) — counts, hidden/visible/shared splits,
      roots with their online/writable state, and the artifact paths that would
      be removed — writes nothing and never enqueues a job. Asserted with an FS
      fake that fails every write and a `TrashPort` fake that fails every call.
- [ ] RED tests, one per checklist item in ADR-0020 D7, plus: an all-or-nothing
      test where root 2 of 3 is read-only and the assertion is that root 1's
      files are still on disk and still in the catalog; a test that a
      `trashItem` failure on file 4 of 10 leaves file 4's records intact and
      files 5–10 untouched; a flush-order test proving both stores flush after
      record deletion and before artifact deletion.
- [ ] Changelog: none (the surface lands in US-A9).

---

### US-A8: The `library_trash` job and its result schema

**Description:** As a developer, I need trash to run as a cancellable,
observable job like every other long operation in this app.

**Acceptance Criteria:**
- [ ] `JobKind` gains `'library_trash'` (in `core/server/ports.ts` **and**
      `core/contract/routes.ts`'s job-kind enum); `resourceKey` is the literal
      `'library-trash'`, so two trash runs never interleave, and the run also
      holds `catalog-write` plus `photo-scan:<root>` resources while mutating
      records.
- [ ] `jobProgressStepSchema` gains `library-trash-preflight`,
      `library-trash-file`, `library-trash-artifacts`,
      `library-trash-summary`.
- [ ] `libraryTrashSummarySchema` carries a **required literal**
      `kind: z.literal('library_trash')`, is placed **before** the absorbing
      members of `jobResultSchema`'s untagged union, and a round-trip test
      asserts deep equality through `jobResultSchema` **and** that every other
      member rejects the sample (the challenge-B5 rule of
      `docs/architecture-photos.md` §7).
- [ ] The summary reports `filesTrashed`, `videosTrashed`, `photosTrashed`,
      `analysesDeleted`, `observationsDeleted`, `peopleDeleted`,
      `artifactPathsDeleted`, `snapshotsRewritten`, `filesFailed`,
      `filesNotAttempted`, `roots`.
- [ ] The run is cancellable through the existing `JobsPort.cancel`; the abort
      check sits between files, never mid-file.
- [ ] RED tests: job-kind exhaustiveness; the union round-trip; a cancelled
      run leaves the not-yet-processed files fully intact.
- [ ] Changelog: none (the surface lands in US-A9).

---

### US-A9: `POST /api/library/trash` and `library trash` CLI

**Description:** As a CLI user, I want to move a selection to the Trash, to
preview it first, and to be refused without an explicit confirmation.

**Acceptance Criteria:**
- [ ] `libraryTrashInputSchema = z.object({ scope: librarySelectionScopeSchema,
      confirm: z.boolean().default(false), dryRun: z.boolean().default(false) })`;
      `confirm: false` with `dryRun: false` returns `confirmation_required`
      (409 / exit 18) and changes nothing.
- [ ] The output is a **discriminated union on `kind`**, because a dry run's
      answer is a plan and a confirmed run's answer is a job envelope, and a
      plan does not fit in `jobAcceptedOutputSchema`:

      ```
      libraryTrashPlanSchema = z.object({
        kind: z.literal('plan'),
        total, videoCount, photoCount, hiddenCount, visibleCount,
        sharedWithOtherPeople,
        roots: z.array(z.object({
          folderId, displayName, currentPath, fileCount, writable, online,
        })),
        artifactPaths: z.array(z.string()),
      })

      libraryTrashOutputSchema = z.discriminatedUnion('kind', [
        libraryTrashPlanSchema,
        z.object({ kind: z.literal('job'), jobId: z.string() }),
      ])
      ```

      `dryRun: true` yields the `plan` member; a confirmed run yields the `job`
      member, whose `jobId` is the same value `jobAcceptedOutputSchema` would
      have carried. A zod test asserts each member parses its own sample and
      rejects the other's.
- [ ] The route runs the pre-flight synchronously and returns `target_offline`
      or `target_read_only` before any job is enqueued; only a clean pre-flight
      yields the `job` member.
- [ ] `avc library trash` accepts the same three scope forms as
      `library hide`, plus `--dry-run` and `--yes`. Without `--yes` and
      without `--dry-run` it calls the route with `confirm: false,
      dryRun: true`, prints the returned plan — the count, the roots and their
      writability — and then exits with `confirmation_required` (18) without
      changing anything. `--dry-run`, including `--dry-run --yes`, prints the
      same plan and exits 0 without moving files.
- [ ] `--json` emits NDJSON with command name `library_trash`, the job's
      progress events, and the summary; human mode prints the plan and then a
      one-line summary.
- [ ] Exit codes: success 0; empty/ambiguous scope 2; unknown person or
      fingerprint 5; no trash mechanism 8; missing confirmation 18; read-only
      root 46; offline root 58; incomplete trash run 59.
- [ ] Smoke leg covers only the paths that change nothing.
      `scripts/smoke.ts` spawns the real CLI as a child process, so no fake
      `TrashPort` can be injected into it and a real `--yes` run there would
      move a fixture into the runner's own Trash. Smoke therefore asserts two
      things, both over the fingerprint `seedSmokeVariant` already seeds
      (smoke runs no `process`, so that seeded row is the only video the
      catalog holds): `library trash --dry-run --json` returns the `plan`
      envelope and leaves the fixture on disk, and `library trash` without `--yes` and
      without `--dry-run` exits 18 with the fixture file and its catalog row
      untouched.
- [ ] The confirmed path is a **vitest** leg in `apps/server`, driving
      `createApp(config, deps)` with a recording in-memory `TrashPort`: it
      asserts the summary shape, the recorded paths, and that a following
      `GET /api/search` (default `hidden`) and `GET /api/library/collection`
      no longer return the fingerprint.
- [ ] Changelog (Added): one line for `library trash` naming `--dry-run`,
      `--yes`, the macOS Trash mechanism and the all-or-nothing rule.

---

### US-A10: Rescan invariants

**Description:** As a user, I want a trashed file to stay gone and a hidden
file to stay hidden, no matter how many times the folder watcher fires.

**Acceptance Criteria:**
- [ ] `hidden_at` is never **cleared** by `scan`, `process`, `process-drive`,
      `materialize`, `photos scan`, `photos process`, `photos import-libra` or
      `index rebuild` over an existing row. The mechanism is the conflict-clause
      rule of US-A1 — `hiddenAt` absent from every `onConflictDoUpdate({ set })`
      — not per-caller discipline, so a future caller cannot regress it. One RED
      test per path: hide a file, run the path, assert `hidden_at` unchanged.
- [ ] A trashed fingerprint is absent from the folder's re-exported
      `catalog.ndjson`; `index rebuild` (which imports the snapshot for an
      unknown marked folder) does not re-create the row. RED test: trash →
      `index forget` the folder → `index rebuild` → assert absent.
- [ ] A `photos scan` over the folder after a photo trash does not re-create
      the `photos` row (the file is gone from disk) and does not re-create the
      artifacts.
- [ ] A hidden file that is re-analyzed stays hidden and its new variant is
      still hidden from Kolekcja.
- [ ] `'library_trash'` joins `RUN_JOB_KINDS` in
      `core/server/usecases/folder-watch.ts`, which today holds only
      `['process', 'process_drive', 'photo_process']`. Without it a filesystem
      change under a watched root — which a trash *causes*, on every file it
      moves — fires a refresh mid-batch. RED test in `folder-watch.test.ts`: a
      change event during a `running` `library_trash` job produces no refresh
      until the job leaves `running`/`queued`, then exactly one.
- [ ] Holding the watcher is necessary but not sufficient. The debounced photo
      scan takes `resourceKey: 'photo-scan:<root>'`
      (`core/server/usecases/photos.ts`), which does **not** collide with the
      trash job's `'library-trash'`, and backup/restore use their own admission
      checks. Before its first move the trash job therefore acquires
      `catalog-write` and `photo-scan:<root>` for **every** affected root
      through `JobsPort.acquireResource(key, signal)` and holds the returned
      releases until the batch ends. Backup, restore, video processing and
      photo processing also treat `library_trash` as a conflicting catalog
      writer, so none can replace or rewrite the stores mid-run.
- [ ] The key is built the same way `enqueuePhotoScan` builds it
      (`core/server/usecases/photos.ts`): `photo-scan:${deps.fs.resolve(root)}`,
      from the **resolved** root. Passing the raw root through would produce a
      key that never matches the scan's and the claim would protect nothing;
      a RED test asserts the two keys are equal for a root given in
      non-canonical form.
- [ ] The observable result is stated, because `JobsPort.acquireResource` and
      `JobsPort.enqueue` behave differently on a busy key
      (`adapters/jobs/index.ts`): `enqueue` with a busy `resourceKey` **does
      not queue**, it returns `conflict` immediately, while
      `acquireResource` waits. RED test: with a `library_trash` job running
      and holding `photo-scan:<root>`, `enqueuePhotoScan({ root })` resolves
      to `{ ok: false, error.code: 'conflict' }` and no `photo_scan` job is
      created; after the trash job settles and releases the claim, the
      watcher's single post-settle refresh enqueues the scan and it runs. The
      assertion is "the scan never runs while the trash runs", not "the scan
      is queued behind the trash".
- [ ] Changelog: none (invariant tests only).

---

## WAVE B — renderer and e2e

**Contract routes added in this wave:** none. **Database migrations in this
wave:** none. Wave B consumes exactly the Wave A contract.

**Client wiring** (`core/client/queries.ts` + `apps/web/src/api.ts`): bound
actions `librarySelectionPreview`, `libraryHide`, `libraryUnhide`,
`libraryTrash`, each with a registered query/mutation key — no inline query
keys anywhere, no `fetch`, no `electron` import in the renderer.

**Dictionaries:** every string in this wave lands in **both** `pl` and `en` in
`apps/web/src/i18n/dictionary.ts`; Polish plurals go through the existing
`plPlural` helper. No English string may be constructed inside
`features/library/core/**` — pure code receives dictionary parts as arguments,
per the established `filter-state.ts` rule.

---

### US-B1: Selection state as a pure reducer

**Description:** As a developer, I need selection arithmetic — toggle, range,
select-all-in-filter, clear — to be a tested pure module, not component state.

**Acceptance Criteria:**
- [ ] `apps/web/src/features/library/core/selection.ts` owns
      `LibrarySelectionState` = `{ mode: 'items', fingerprints: Set<string>,
      anchor: string | null } | { mode: 'all-in-filter', excluded: Set<string> }`
      and its reducer actions (`toggle`, `extendTo`, `selectAllInFilter`,
      `clear`, `removeResolved`).
- [ ] `extendTo` computes the range over the **flattened rendered item
      order** (the same order `grid-rows.ts` produces), so a Shift-click
      spanning day or folder sections selects everything between the anchor
      and the target inclusive.
- [ ] A projection `selectionScopeOf(state, filters, media)` produces the
      contract's `librarySelectionScope`: `'fingerprints'` in `items` mode,
      `'filter'` in `all-in-filter` mode. `sort` is **not** a parameter — it
      orders a page and does not define the selected set, and
      `librarySelectionFilterSchema` has no `sort` field (US-A1).
- [ ] A projection `selectionCountLabel(counts, dictionaryParts)` builds the
      action-bar label from dictionary parts only.
- [ ] RED unit tests: toggle idempotency; range across sections; range
      backwards (target before anchor); `all-in-filter` count equals the
      collection response `total`; changing the filter clears the selection.
- [ ] Changelog: none (pure module, no user-visible surface yet).

---

### US-B2: Multi-select and the action bar in Kolekcja

**Description:** As a user, I want to pick several tiles with Cmd-click and
Shift-click, select the whole filter result, and see what I have selected.

**Acceptance Criteria:**
- [ ] Plain click still opens `LibraryMediaViewer`. Cmd-click toggles a tile.
      Shift-click extends from the anchor. Escape clears the selection.
- [ ] `LibraryGrid` renders a visible selected state on a tile (visual
      language from `theme.ts` only) and an `aria-selected` attribute.
- [ ] An action bar appears whenever the selection is non-empty, showing the
      count, "Zaznacz wszystko" (which switches to the whole current filter
      result and shows the collection `total`, **not** the loaded count),
      "Wyczyść zaznaczenie", "Ukryj" and "Przenieś do Kosza".
- [ ] The "Ukryj" action calls `actions.libraryHide` with the projected scope
      and invalidates the collection, facets, locations and people queries on
      success.
- [ ] Changing any filter, the query, the sort or the media chip clears the
      selection.
- [ ] `apps/web/src/features/library/library.test.tsx` covers: Cmd-click
      selection, Shift-click range, select-all switching the count to `total`,
      Escape clearing, and the hide call carrying a `'filter'` scope after
      select-all.
- [ ] `pnpm run visual` baselines updated in a second commit for the action
      bar and the selected-tile state (land the change, re-baseline, review,
      commit the PNGs).
- [ ] Changelog (Added): one line for multi-select and the action bar.

---

### US-B3: The "Ukryte" filter and "Przywróć"

**Description:** As a user, I want one place that lists what I hid, and a way
to bring it back.

**Acceptance Criteria:**
- [ ] `FilterBar` gains an "Ukryte" toggle whose count comes from
      `counts.hidden` on the facets response; activating it sets
      `hidden: 'only'` on the collection request and the count header states
      the hidden total.
- [ ] In the hidden view every tile's menu carries "Przywróć" and the action
      bar's hide action is replaced by "Przywróć zaznaczone"; both call
      `actions.libraryUnhide`.
- [ ] Leaving the hidden view returns to `hidden: 'exclude'`; the toggle's
      state is not persisted across app restarts (it is a view, not a
      preference).
- [ ] `TileMenu` gains "Ukryj" / "Przywróć" for a single tile, above the
      existing "Otwórz w analizie" / reveal / copy-path items, separated from
      them.
- [ ] The empty hidden view states, in a full sentence, that nothing is
      hidden — built in `core/filter-state.ts` from dictionary parts.
- [ ] Renderer tests for each bullet; `visual` baselines updated for the new
      chip.
- [ ] Changelog (Added): one line for the Ukryte filter and Przywróć.

---

### US-B4: The trash confirmation dialog

**Description:** As a user, I want to be told exactly what a trash will do
before it does it, and to have to say so explicitly.

**Acceptance Criteria:**
- [ ] **The dialog is a props-only component in
      `apps/web/src/components/ui/dialogs/`** (precedent:
      `CancelConfirmationDialog.tsx`, `DriveSummaryDialog.tsx`), not a file
      under `features/library/`. US-B5 puts the same dialog on a person card,
      and `.dependency-cruiser.cjs`'s `web-features-are-islands` rule forbids
      `features/people/**` importing `features/library/**`; the sanctioned
      cross-feature move is to extract downward into `components/ui`.
      It receives the counts, the roots with their `writable` flag, the
      checkbox state and `onConfirm` as props and owns no server state: each
      feature runs its own `librarySelectionPreview` query and `libraryTrash`
      mutation and passes the result down. Its prop types are declared locally
      — `web-ui-presentational` forbids `components/ui` importing `core/`, so
      the contract's preview output is mapped to props at the feature edge —
      and its copy comes from `useDictionary()`, as the two precedents do.
- [ ] Clicking "Przenieś do Kosza" opens that dialog fed by
      `actions.librarySelectionPreview`, stating: the file count (split into
      videos and photos), the list of affected folder roots with their display
      names, and a sentence naming what is erased (analyses, tags, faces,
      places, thumbnails and proxies) and where the files go (macOS Trash).
- [ ] The destructive button is disabled until an explicit checkbox is
      ticked; the dialog follows the existing destructive-action pattern used
      by Osoby's purge/recluster confirmations.
- [ ] If the preview reports any offline root, the dialog shows the offline
      refusal instead of the confirm button; if every root is online but any
      root has `writable: false`, it shows the read-only refusal. Both name the
      roots and keep the destructive button unreachable.
- [ ] Confirming calls `actions.libraryTrash` with `confirm: true`, shows the
      job's progress through the existing job-status surface, and on success
      invalidates the collection, facets, locations, people, photos, scan and
      catalog-tree queries and clears the selection. On failure it still
      invalidates visibility consumers but keeps the selection and shows the
      incomplete counts when present.
- [ ] A `target_offline` or `target_read_only` response from the route renders
      the same refusal copy as the preview path (the race where the drive
      unmounted or became read-only between preview and confirm).
- [ ] Renderer tests for: the counts and roots in the copy, the checkbox gate,
      the read-only refusal, and the post-success invalidation. The first three
      are props-driven and belong beside the component
      (`components/ui/dialogs/*.test.tsx`, as `DriveSummaryDialog.test.tsx`
      does); the invalidation is wiring and is asserted in
      `features/library/library.test.tsx`.
- [ ] Changelog (Added): one line for move-to-trash from Kolekcja.

---

### US-B5: Person shortcuts in Osoby

**Description:** As a user, I want to hide or trash everything a person
appears in, from that person's card.

**Acceptance Criteria:**
- [ ] A person card's ⋮ menu gains "Ukryj pliki tej osoby" and "Przenieś do
      Kosza pliki tej osoby", below the existing rename / forget / search
      items.
- [ ] Both open a dialog fed by `librarySelectionPreview` with a `'person'`
      scope, stating "N plików, w tym M z innymi osobami" when `M > 0` and
      omitting the shared clause when `M === 0` (Polish plurals via
      `plPlural`; the English string states the same facts).
- [ ] Both dialogs offer "pomiń pliki z innymi osobami", checked by **default
      for trash** and unchecked by **default for hide**; toggling it re-runs
      the preview so the stated count always matches what will happen.
- [ ] The trash dialog is **the same component** US-B4 put in
      `components/ui/dialogs/` — Osoby imports it from there, never from
      `features/library/` (`web-features-are-islands`) — so the checkbox gate,
      the root list and the read-only refusal are inherited, not re-authored.
      This story adds only the person-scope wiring: Osoby runs its own
      `librarySelectionPreview` and `libraryTrash` calls and passes the result
      into the shared props.
- [ ] Hiding every file of a person removes that person's card from the grid
      on the next fetch; unhiding from Kolekcja's "Ukryte" view brings the
      same card back with its name intact.
- [ ] Renderer tests for each bullet, including the differing defaults.
- [ ] Changelog (Added): one line for the person-card shortcuts.

---

### US-B6: e2e on the real UI

**Description:** As a maintainer, I need proof that the real app does this,
driven by real clicks.

**Acceptance Criteria:**
- [ ] `test/e2e/library-hide-trash.spec.ts` follows the doctrine of
      `test/e2e/open-folder.spec.ts`: isolated temp HOME and user-data
      directory, real fixture folder, the wizard dismissed by a real click,
      every in-app interaction a real click or keystroke.
- [ ] **The catalog is seeded, not analyzed.** Kolekcja lists analysed files
      only, and running a real analyzer inside this spec would make it a
      provider test. The spec therefore seeds exactly as
      `test/e2e/library.spec.ts` already does: under the isolated HOME it
      opens `SqlJsGlobalCatalogStore({ homeDirectory })` and
      `SqlJsPhotosStore({ homeDirectory })` directly, writes the fixture media
      files, and inserts the folder, file/photo and analysis rows. That is an
      **analysis-result fixture**, not a substitute for a user flow: the flow
      under test — select, hide, restore, trash — is driven entirely by real
      clicks, and nothing the spec asserts is pre-seeded.
- [ ] The seed also creates the artifact directories the trash leg asserts
      the absence of, so "the artifact directories are gone" has something to
      check: under the isolated HOME's app root,
      `<HOME>/.ai-video-cataloger/faces/obs/<fingerprint>/` with a crop file,
      `<HOME>/.ai-video-cataloger/photo-artifacts/thumbs/<fingerprint>.jpg`, and under the fixture
      folder's `.ai-video-cataloger/`, `artifacts/frames/<fingerprint>/` with
      a frame file. Each is asserted to exist **before** the trash and to be
      absent after.
- [ ] The spec is registered in the two places a new e2e spec has to be
      registered, because `test/e2e/playwright.config.ts` has one project per
      spec and no default project picks a stray file up:
      - `test/e2e/playwright.config.ts` gains
        `{ name: 'library-hide-trash', testMatch: /library-hide-trash\.spec\.ts/ }`.
        The existing `{ name: 'library', testMatch: /library\.spec\.ts/ }`
        entry needs no change: its pattern requires the literal
        `library.spec.ts`, which `library-hide-trash.spec.ts` does not contain;
      - `package.json` gains `"test:e2e:library-hide-trash": "pnpm run
        electron:build && playwright test --config
        test/e2e/playwright.config.ts --project=library-hide-trash"`,
        matching the shape of the existing `test:e2e:library`.
      The script is listed in `CLAUDE.md`'s e2e section; if it is also written
      into a tracked `README.md`, `doc-lint` requires the `package.json`
      script to exist, so the two land in the same commit.
- [ ] **Hide leg:** open Kolekcja over the seeded fixture, Cmd-click two
      tiles, click "Ukryj", assert both tiles disappear from the grid and the
      count header drops; click the "Ukryte" chip, assert both are listed.
      Clicking the chip is a filter change, which clears the selection (FR-52),
      so the two tiles are then **re-selected for real** — Cmd-click on each, or
      one click on "Zaznacz wszystko" — before "Przywróć zaznaczone" is
      clicked and both are asserted back in the default view. Secondary invariant, only
      after the UI assertions: `catalog.db` read via sql.js shows `hidden_at`
      set and then cleared.
- [ ] **Person leg:** the seed additionally inserts one `people` row with a
      generic name and one `face_observations` row per seeded file pointing at
      it, so the Osoby grid has a card. Faces are off by default and
      `GET /api/faces/people` answers `faces_disabled` until they are on, so
      the spec turns them on through the **real settings switch** — open
      Settings, click `getByTestId('faces-enabled-switch')`, save, wait for the
      saved snackbar, exactly as `test/e2e/people.spec.ts` does — never by
      seeding a config file. From that person card's ⋮, run "Ukryj
      pliki tej osoby" and assert the card leaves the Osoby grid; restore from
      Kolekcja's hidden view and assert the card returns with the same name.
- [ ] **Trash leg:** `shell.trashItem` is patched in the Electron **main**
      process via `app.evaluate` to record the path and unlink the file — the
      sanctioned native-surface stub — while every in-app control (the tile
      selection, the action-bar button, the checkbox, the destructive button)
      is clicked for real. The stub replaces `shell.trashItem` after boot, which
      only works because the composition wraps the call rather than capturing
      the reference (US-A6). Assert: the tile disappears, the file is no longer
      at its path, the recorded path equals the fixture path, and the artifact
      directories for that fingerprint are gone. Secondary invariant, after the
      UI assertions: `catalog.db` read via sql.js has no `files`, `analyses` or
      `face_observations` row for that fingerprint. The macOS Trash itself is
      **not** asserted — the run uses an isolated HOME and the stub unlinks
      instead of trashing. No pre-seeding of `folder-store.json`, no
      `desktopBridge.folder.setCurrent`, no CLI call mid-test.
- [ ] **Read-only leg** goes in `test/e2e/ro-mount-matrix.spec.ts`, which is a
      **CLI-only** spec (it drives `runCli`, it never launches Electron), so it
      asserts the CLI half: a real `hdiutil` read-only image is mounted, a
      `library trash --yes` is attempted over a selection spanning it, and the
      assertions are exit code 46, the offending root named in the error
      payload, and the writable root's files untouched on disk and in the
      catalog. The dialog's refusal copy is covered by the renderer test in
      US-B4, not here. That spec must be run from a normal, unsandboxed shell:
      `hdiutil create` fails with `Device not configured` under an agent Bash
      sandbox (CLAUDE.md, "On-demand real-provider suite").
- [ ] `pnpm run qa:walkthrough` gains a hide/restore step with its screenshot,
      and [docs/qa/release-walkthrough.md](../docs/qa/release-walkthrough.md)
      documents what the reviewer must see.
- [ ] Changelog: none (test-only), except the walkthrough line, which is an
      operational-procedure change and does get one.

---

## Functional Requirements

### Hide semantics

- **FR-1** `catalog.db` `files` and `photos.db` `photos` each carry a
  nullable `hidden_at INTEGER` (epoch milliseconds); non-null means hidden.
- **FR-2** Hide and unhide never read or write the user's folder, never
  require it to be online, and never require it to be writable.
- **FR-3** Hide is fingerprint-scoped: one decision per content identity,
  shared by every sighting of that content, in line with ADR-0002.
- **FR-4** Hide is idempotent in both directions; re-hiding does not move
  `hidden_at`, and unhiding a visible file is a no-op reported as such.
- **FR-5** A hidden file is excluded from `GET /api/library/collection` (both
  legs), `GET /api/search`, `GET /api/photos/search`,
  `GET /api/library/facets` (all facets and all counts),
  `GET /api/catalog/locations` (pins and the catalog-wide total) and
  `GET /api/faces/people` (counts and person visibility).
- **FR-6** A hidden file is **not** excluded from `GET /api/scan`,
  `GET /api/catalog-tree`, `GET /api/catalog-tree/folder`,
  `GET /api/catalog-tree/absent`, `GET /api/photos/tree`,
  `GET /api/photos/list`, `GET /api/status`, `GET /api/check`,
  `GET /api/variants`, `GET /api/index/status`, or the backup scope.
- **FR-7** `GET /api/library/collection`'s `total`, `videoTotal`,
  `photoTotal`, `mediaTotals` and `nextCursor` are all derived from the same
  `hidden` predicate as the returned rows.
- **FR-8** `GET /api/library/facets` gains `counts.hidden`, the count of
  hidden files across both media.
- **FR-9** `GET /api/faces/people` computes `observationCount`, `videoCount`,
  `photoCount` and `fileCounts` over visible files only, and omits a person
  whose every observation sits on a hidden file; the `people` row, its name,
  its centroid and its exemplars are untouched, and unhiding restores the card
  unchanged.
- **FR-10** `hidden` is a tri-state (`exclude` default / `only` / `include`)
  on `searchInputSchema`, `collectionInputSchema` and
  `photosSearchInputSchema`.
- **FR-11** `hidden_at` survives every rescan and re-analysis path: `scan`,
  `process`, `process-drive`, `materialize`, `photos scan`, `photos process`,
  `photos import-libra`, `index rebuild`.
- **FR-12** `hiddenAt` round-trips through `catalog.ndjson`
  (`CATALOG_SNAPSHOT_SCHEMA_VERSION` 13); a version-12 snapshot imports as
  `null`.

### Selection

- **FR-20** A selection is expressed as one closed discriminated union:
  `fingerprints`, `filter`, or `person`.
- **FR-21** A `filter` scope is resolved server-side through the same store
  queries `libraryCollection` uses, with paging removed; the renderer never
  enumerates pages to act on a filter result.
- **FR-22** A `person` scope optionally drops every file that also carries an
  observation whose `person_id` is non-null and different from the scoped
  person (`skipSharedWithOtherPeople`). An unassigned observation is not
  "another recognized person" and never causes a skip; the same predicate
  defines `sharedWithOtherPeople`.
- **FR-23** `POST /api/library/selection/preview` reports `total`,
  `videoCount`, `photoCount`, `hiddenCount`, `visibleCount`,
  `sharedWithOtherPeople` and, per affected root, `folderId`, `displayName`,
  `currentPath`, `fileCount`, `writable`, `online`. The five counts count
  fingerprints (`hiddenCount + visibleCount === total`); a root's `fileCount`
  counts the sightings under that root (FR-26).
- **FR-24** An empty or ambiguous scope is `validation`. An unknown
  `personId`, or a `fingerprints` scope containing **any** entry unknown to
  both stores, is `not_found` with the unknown values in `details` and resolves
  to nothing — partial resolution is never offered. Neither case is ever a
  silent empty success for trash.
- **FR-25** `fingerprints` scopes are capped at 5000 entries; a larger
  selection must be expressed as a `filter`.
- **FR-26** `resolveLibrarySelection` returns one entry per fingerprint,
  shaped `{ fingerprint, media, hiddenAt, sightings: [{ folderId, rootPath,
  path }] }` with at least one sighting. A single `folderId`/path per entry
  cannot express a fingerprint sighted from several folders, which FR-44
  requires trash to handle in full; the affected-root set is the union of
  `rootPath` over every sighting, and `hiddenAt` is what the preview's
  `hiddenCount`/`visibleCount` are computed from. Confirmed trash enqueues the
  previewed fingerprint list rather than the original filter or person scope.

### Trash

- **FR-30** The media file is moved to the macOS Trash through `TrashPort`.
  `shell.trashItem` backs the Electron composition; a Finder-backed
  `osascript` move backs the CLI/headless composition; a composition with
  neither returns `unavailable`.
- **FR-31** `rm`, `unlink`, `FileSystemPort.deleteFile` and
  `FileSystemPort.deletePath` are never applied to a user's media file. They
  remain the mechanism for the app's own artifacts (FR-41).
- **FR-32** Before the first move, every affected root — the owning folder
  root and the parent directory of every **sighting** of every selected
  fingerprint (FR-26) — is probed for existence and then with the
  non-mutating `FileSystemPort.isWritable`.
- **FR-33** If any root is offline, the operation returns `target_offline`
  (HTTP 409, exit 58). If any online root is not writable, it returns
  `target_read_only` (HTTP 409, exit 46). Both name the offending roots, and
  zero files, rows and artifacts have changed.
- **FR-34** The probe runs twice: synchronously before the job envelope is
  returned, and again at the top of the job body.
- **FR-35** A failure mid-run stops at the failing file, returns
  `library_trash_incomplete` (HTTP 409, exit 59) with the partial summary,
  leaves the failed file's records and artifacts intact, and leaves every
  remaining file untouched.
- **FR-36** Trash requires `confirm: true` (GUI checkbox, CLI `--yes`);
  otherwise `confirmation_required` (409 / exit 18) with zero changes.
- **FR-37** `dryRun: true` / `--dry-run` returns `libraryTrashPlanSchema` —
  counts, `hiddenCount`, `visibleCount`, `sharedWithOtherPeople`, roots with
  their online/writable state, artifact paths — writes nothing and enqueues no
  job, even when `--yes` is also present. `POST /api/library/trash`'s output is
  therefore `libraryTrashOutputSchema`, a `kind`-discriminated union of that
  plan and a `{ kind: 'job', jobId }` member, not `jobAcceptedOutputSchema`.
- **FR-38** Trash runs as a `library_trash` job with the literal
  `resourceKey: 'library-trash'`, cancellable through `JobsPort.cancel`, with
  the abort check between files. The job acquires `catalog-write` and
  `photo-scan:<root>` resource claims for the duration, and backup, restore,
  video processing and photo processing admission treat `library_trash` as a
  conflicting catalog writer.
- **FR-39** `libraryTrashSummarySchema` carries a required literal
  `kind: 'library_trash'` and is ordered before the absorbing members of
  `jobResultSchema`'s untagged union.
- **FR-40** Records erased per trashed fingerprint — `catalog.db`: the `files`
  row (with its GPS, place, capture, dimension, `missing_at` and `hidden_at`
  columns), every `analyses` row, every `file_tags` row, the
  `search_documents` row and its FTS row, every `face_observations` row, the
  `face_index_state` row, with affected people recomputed and a person left
  with zero observations deleted. `photos.db`: every `photo_paths` sighting,
  the `photos` row, `photo_analyses`, `photo_analysis_errors`,
  `photo_file_tags`, `photo_search_documents` and its FTS row,
  `photo_face_index_state` — plus the photo's `face_observations` rows in
  `catalog.db`. The mechanism is the existing ports, not new SQL, and the two
  media call different ones: a **video** is
  `GlobalCatalogStore.forgetEntry(fingerprint)` alone, which already deletes
  the `face_observations` rows, already recomputes the affected people and
  already returns the `cropPaths`; a **photo** is
  `GlobalCatalogStore.deleteFaceObservationsForFile(fingerprint)` (same
  recomputation, same `cropPaths`) followed by `PhotosStore.deletePhoto`.
  `forgetEntry` is never used on a photo fingerprint: without a `files` row it
  returns `deleted: false` and deletes nothing. Record deletion happens only
  after every sighting of that fingerprint has moved to the Trash, and both
  stores are flushed before artifact deletion starts.
- **FR-41** Artifacts erased per trashed fingerprint —
  `~/.ai-video-cataloger/faces/obs/<fingerprint>/`;
  `~/.ai-video-cataloger/photo-artifacts/proxies/<fingerprint>.jpg`,
  `thumbs/<fingerprint>.jpg`, `thumbs/<fingerprint>.grid.jpg`,
  `variants/<fingerprint>/`; and, under the video artifact root (the folder's
  `.ai-video-cataloger/` when writable, otherwise
  `~/.ai-video-cataloger/read-only-folders/{folderId}/`),
  `artifacts/frames/<fingerprint>/`, `artifacts/transcripts/<fingerprint>/`,
  `variants/<fingerprint>/`, `thumbnails/<base>.jpg`,
  `thumbnails/<base>.grid.jpg`, and the name-based projection
  (`artifactPaths()` in `core/server/usecases/shared.ts`)
  `frames/<base>/`, `transcripts/<base>.txt`, **`transcripts/<base>.json`**,
  `summaries/<base>.json`, `summaries/<base>.txt`,
  `summaries/<base>-debug.log`. `photo-artifacts/variants/<fingerprint>/` has
  no writer in the current code and is deleted only if present. Video cleanup
  visits the writable sidecar, known folder-id mirror, current path-derived
  mirror and supported legacy mirror, and skips the name-based projection when
  another file in the same folder shares the same stem.
- **FR-42** `catalog.ndjson` is re-exported for every affected writable folder
  whose rows changed on every exit path — success, mid-run failure and
  cancellation — so a later snapshot import cannot resurrect a record the run
  already deleted.
- **FR-43** Not touched by trash: the shared `tags` vocabulary and its
  aliases, `drive_runs`, the spend ledger, and the non-canonical legacy
  `{folder}/.ai-video-cataloger/catalog.db`.
- **FR-44** Trashing a fingerprint with several sightings removes every
  sighting and every sighted file; all of their roots enter the writability
  check of FR-32.

### Surfaces

- **FR-50** Kolekcja supports Cmd-click toggle, Shift-click range over the
  rendered order, Escape to clear; a plain click still opens the viewer.
- **FR-51** "Zaznacz wszystko" selects the whole current filter result as a
  server-side scope; the action bar shows the collection `total`, not the
  loaded count.
- **FR-52** Any change to the query, filters, sort or media chip clears the
  selection.
- **FR-53** The action bar shows the count, "Zaznacz wszystko", "Wyczyść
  zaznaczenie", "Ukryj" (or "Przywróć zaznaczone" in the hidden view) and
  "Przenieś do Kosza".
- **FR-54** `FilterBar` carries an "Ukryte" toggle whose count comes from
  `counts.hidden`; it is a view, not a persisted preference.
- **FR-55** `TileMenu` carries a single-tile "Ukryj" / "Przywróć".
- **FR-56** The trash dialog states the count (split by medium), the affected
  roots, what is erased and where the files go, and gates its destructive
  button behind an explicit checkbox.
- **FR-57** A person card's ⋮ menu carries "Ukryj pliki tej osoby" and
  "Przenieś do Kosza pliki tej osoby"; both dialogs state the total and omit
  the shared-files clause when it is zero, or state how many files include
  other recognized people when it is nonzero. They offer "pomiń pliki z innymi
  osobami", defaulting on for trash and off for hide, re-previewing on toggle.
- **FR-58** Every string ships in both `pl` and `en`; Polish plurals go
  through `plPlural`; no English string is constructed inside
  `features/library/core/**`.

### CLI

- **FR-60** `avc library hide`, `avc library unhide` and `avc library trash`
  each accept exactly one scope: `--fingerprint` (repeatable), the filter
  scope, or `--of-person <personId>` (with `--skip-shared`). The person scope
  is `--of-person`, not `--person`, because `--person` is already a filter flag
  meaning "narrow to this person".
- **FR-61** The filter scope's flags are `avc search`'s existing flags, in
  name, parsing and defaults: a positional `[query]`, `--tag` (repeatable),
  `--person` (repeatable), `--place`, `--from`, `--to`,
  `--has-gps`/`--no-has-gps` and `--folder`, plus `--media <all|video|photo>`
  and `--hidden <exclude|only|include>`, which map to
  `librarySelectionFilterSchema`'s `media` and `hidden`. `search`'s ordering
  and paging flags (`--sort`, `--limit`, `--offset`) are not part of a
  selection scope, and `--media` exists on the library commands only (FR-65).
- **FR-62** `avc library trash` accepts `--dry-run` and `--yes`.
- **FR-63** NDJSON command names are `library_hide`, `library_unhide`,
  `library_trash`; progress steps are `library-trash-preflight`,
  `library-trash-file`, `library-trash-artifacts`, `library-trash-summary`.
- **FR-64** Exit codes: 0 success; 2 empty/ambiguous scope; 5 unknown person
  or fingerprint; 8 no trash mechanism available; 18 missing confirmation; 46
  a read-only root; 58 an offline root; 59 an incomplete trash run.
- **FR-65** `avc search` gains exactly one flag: `--hidden
  <exclude|only|include>` (default `exclude`). It does **not** gain `--media`.
  `avc search` calls `GET /api/search`, whose `searchInputSchema` has no
  `media` field and whose `searchOutputSchema` returns video
  `searchResultSchema` rows only, so there is no medium for the flag to
  select; `media` is a `collectionInputSchema` and
  `librarySelectionFilterSchema` field, and on the CLI it exists only in the
  filter scope of `library hide|unhide|trash` (FR-61). No `avc library
  collection` command exists and none is added by this wave; the CLI's listing
  surface for hidden videos is `search --hidden`, and for photos it is the
  library commands' own filter scope.

### Taxonomy and boundaries

- **FR-70** New `ErrorCode` values extend the closed union only with explicit
  HTTP and CLI mappings and exhaustive tests.
- **FR-71** No new database file and no new on-disk directory is introduced.
- **FR-72** The renderer reaches the feature only through bound actions and
  registered query keys; no inline query keys, no `fetch`, no `electron`
  import, and visual language only from `theme.ts`.
- **FR-73** Use-cases return `Result<T, AppError>`; nothing throws across a
  boundary; no `any`, no `as` except `as const`; every boundary zod-parses.
- **FR-74** The trash confirmation dialog shared by Kolekcja and Osoby lives in
  `apps/web/src/components/ui/dialogs/`, is props-only, and is never imported
  across features: `features/people/**` importing `features/library/**` is
  forbidden by `web-features-are-islands`, and `components/ui` importing
  `core/` is forbidden by `web-ui-presentational`, so the dialog's prop types
  are local and each feature maps the contract's preview output onto them.

## Non-Goals

- Restoring a trashed file from inside the app. The macOS Trash and Finder's
  "Put Back" are the recovery path; the app ships no undo for trash.
- Hiding a whole folder, a tag or a date range as a persistent rule. Hide is
  per file; the selection can come from a filter, but what is stored is the
  set of files.
- Hiding in the Analysis surfaces (folder tree, photo tree, status counts).
  See ADR-0020 D3.
- Non-macOS trash mechanisms. This product is darwin-only.
- Garbage-collecting tags that lose their last file.
- Rewriting the non-canonical legacy per-folder `catalog.db` on trash.
- Keyboard grid navigation (arrow-key selection, Cmd+A, Cmd+Backspace
  shortcuts) — the wave ships mouse-driven selection plus Escape only.
- Bulk re-analysis, bulk retag or bulk move from the action bar.
- A trash/hide surface in Analysis, in the map popover or in the photo viewer
  beyond the tile menu.
- Any change to how `hideUnavailable` behaves; it is an independent axis and
  composes with `hidden` without interacting.

## Design Considerations

- **The two actions never look alike.** Hide is an ordinary action in the
  action bar and the tile menu, with no confirmation — it is one click to
  undo. Trash is a destructive action: error colouring, a dialog, a checkbox,
  and an explicit statement of what is erased. The visual distance between
  them is the main defence against a mis-click.
- **The confirmation states facts, not warnings.** Count, roots, what is
  erased, where the files go. No "are you sure?" without content.
- **The read-only refusal is not an error toast.** It replaces the confirm
  button inside the dialog, names the roots, and leaves the user in the dialog
  with the option to cancel or narrow the selection — the same place they made
  the decision.
- **The hidden view is a filter, not a mode.** It reuses the same grid, the
  same tiles and the same viewer; only the chip state and the two per-tile
  actions differ. That keeps `docs/architecture.md`'s "one query surface, not
  two" true.
- **Selection is visible on the tile, not only in the bar.** A user who
  scrolled away from the action bar must still be able to see what is
  selected.
- **The person dialogs re-preview on toggle.** The stated count must always be
  the count that will be acted on; a stale number in a destructive dialog is
  worse than a spinner.

## Technical Considerations

- **The `hidden` predicate is SQL, everywhere.** Kolekcja's browse path is
  100% SQL and its `total`, `mediaTotals` and composite cursor are computed
  from the same `WHERE`; a post-page filter would reintroduce the bug class
  W71 fixed for `hideUnavailable`. Both `hidden_at` columns are indexed.
- **Two databases, one operation.** A photo's identity rows live in
  `catalog.db` while the rest of it lives in `photos.db` (ADR-0016). A photo
  trash therefore writes to both stores; the transaction boundary is per store.
  The file moves first, then the catalog/photo rows are deleted, then both
  stores flush before app-owned artifacts are removed.
- **`isWritable` is the sanctioned read-only probe.** `access(W_OK)`,
  non-mutating, already used by `materialize --dry-run`, but ENOENT is first
  interpreted through an existence probe so an unplugged root or stale sighting
  is reported as offline rather than read-only. Passing the writability probe
  does not prove the volume supports the macOS Trash; that remains an honest
  per-file `library_trash_incomplete` failure if `trashItem` later refuses.
- **`resourceKey: 'library-trash'` is global, not per root.** A trash can span
  roots, so a per-root key could not serialize two overlapping runs.
- **One trash dialog, extracted downward.** Kolekcja and Osoby show the same
  confirmation, and features are islands: the component lives in
  `components/ui/dialogs/`, takes props and a dictionary, and holds no query
  or mutation, so neither feature imports the other (FR-74).
- **The job-result union is untagged.** `libraryTrashSummarySchema` needs a
  required literal discriminator and a position before the absorbing members,
  with a round-trip test — the challenge-B5 rule from
  `docs/architecture-photos.md` §7.
- **Snapshot version bump is load-bearing.** Without it, a snapshot import
  after a hide would silently clear `hidden_at`, and a snapshot export after a
  trash would keep the resurrection path open.
- **Parity:** hide and trash are post-parity capabilities; the old app had
  neither, and no behaviour in `tasks/parity-inventory.md` changes. The four
  sanctioned deviations in `tasks/prd-foundation-rewrite.md`'s Technical
  Considerations are untouched. The two additive columns and the snapshot
  version bump introduce no new database file and no new on-disk directory —
  recorded as a note in the parity inventory.
- **Privacy:** this is a public repository. No fixture, test name, screenshot,
  changelog line, error message or documentation example may carry a real
  library path, volume name, personal name, handle, home-directory path or run
  statistic. Fixtures use generated content under a temp home.
- **Comments:** default zero. Only a non-obvious *why* the code cannot
  express. Re-read the diff comment-by-comment before committing.

## Success Metrics

- **SM-1** Hiding 1000 files from a filter scope completes in under two
  seconds on a catalog-scale database, measured in a store test, and Kolekcja's
  first page after it returns within its existing budget.
- **SM-2** A trash spanning a writable and a read-only root changes nothing —
  asserted on disk and in both databases by the CLI-driven `ro-mount` matrix
  leg, which must be run from a normal, unsandboxed shell because `hdiutil
  create` fails with `Device not configured` under an agent Bash sandbox.
- **SM-3** After a trash, `GET /api/search`, `GET /api/library/collection`,
  `GET /api/library/facets`, `GET /api/catalog/locations` and
  `GET /api/faces/people` all report the fingerprint as absent,
  and no file under any artifact root references it — asserted by a single
  sweep test.
- **SM-4** After hide → `scan` → `process` → `index rebuild`, the file is
  still hidden.
- **SM-5** After trash → folder-watch refresh → `scan` → `index rebuild`, the
  file has not returned.
- **SM-6** `pnpm run check` and `pnpm run smoke` green at the end of every
  story; `test:e2e:matrix` green at the end of each wave.
- **SM-7** Zero new `ErrorCode`, HTTP status or exit-code entries in the diff
  (grep-assertable).

## Open Questions

1. **Does hide belong in Analysis after all?** This PRD and ADR-0020 D3 scope
   hide to the library surfaces and leave the Analysis folder/photo trees
   showing everything on disk. If the owner wants a hidden file to also drop
   out of the Analysis tree, that is a different feature (it would change the
   "not yet analyzed" counts that drive the run buttons) and needs its own
   decision.
2. **Duplicate sightings on trash.** FR-44 trashes every sighting of a
   fingerprint, because "every record disappears" cannot be honoured while one
   copy remains. The alternative — trash only the selected copy and keep the
   records for the remaining sighting — is defensible and was not chosen.
   Owner confirmation wanted.
3. **Trash from the hidden view.** Assumed available (a hidden file can be
   trashed). If the owner wants the hidden view to be hide-only, the action
   bar there loses one button.
4. **Keyboard shortcuts.** No shortcut is bound for hide or trash (Escape
   clears the selection, that is all). Cmd+A for select-all and Cmd+Backspace
   for trash are the obvious candidates and are deliberately out of scope
   until the mouse flow is proven.
5. **What the CLI does about a Finder-backed move on a machine where the
   Finder is not running** (a pure SSH session). `osascript` will fail; the
   command surfaces the failure as an `AppError` and the run stops. Whether a
   fallback is wanted — and it cannot be `rm` — is unresolved.
6. **`counts.hidden` scope.** It counts hidden files across the whole catalog,
   matching the rest of the facets, which are whole-catalog and not
   filter-relative. A user in a filtered view will therefore see a chip count
   larger than what the hidden view shows for that filter. Consistent with the
   existing facet rule, possibly surprising; flagged rather than special-cased.
