# ADR-0020: Library hide and move-to-trash

Date: 2026-09-03 · Status: accepted · Extends
[ADR-0002](0002-global-catalog-layer.md) (global catalog ownership, read-only
folders), [ADR-0010](0010-analysis-variant-identity-artifacts-and-dedup.md)
(variant artifacts), [ADR-0014](0014-per-observation-face-crops.md) (crop
layout) and [ADR-0016](0016-photos-catalog-foundations.md) (photo artifact
root)

## Context

Kolekcja shows every analyzed video and photo in one feed. Two things a user
cannot do today:

- **Get a file out of the way without losing it.** Test clips, duplicated
  exports, screen recordings and family material a user does not want in a
  browse surface stay in Kolekcja, in the map, in the facet counts and in
  Osoby forever. The only existing removal is `index forget`, which deletes the
  analysis — the expensive part — and leaves the file on disk. That is the
  opposite trade.
- **Delete a file and everything the app derived from it.** Deleting the file
  in Finder leaves the catalog row, its analyses, its face observations, its
  place, its thumbnails and its proxies behind; the app then renders it as
  "Brak pliku" indefinitely. Cleaning up by hand means running `index forget`
  per fingerprint and deleting artifact directories the user has no map of.

Both actions are destructive in different senses, and the interesting design
work is in how differently destructive they are. Hide must be free to undo.
Trash must be impossible to do halfway.

A third constraint comes from where this app runs: catalogued folders live on
external drives and SD cards that are frequently mounted read-only, and the
product already treats a read-only source as a first-class mode
(`docs/architecture.md` Delta 3, ADR-0002 §(f)). A bulk delete that succeeds
for the first eleven files and then discovers root twelve is read-only would
leave the catalog in a state no user can reason about.

## Decision

**D1 — Two separate actions, not one with a flag.** `hide` is a reversible
catalog annotation that touches no file and no artifact. `trash` moves the
file to the macOS Trash and erases every record the app owns for it. They
share a selection vocabulary and nothing else: separate routes, separate CLI
verbs, separate confirmations, separate error paths.

**D2 — Hide lives in the two databases, not in config.**
`catalog.db` `files` gains `hidden_at INTEGER` (nullable, epoch milliseconds,
migration **V17**); `photos.db` `photos` gains the same column (migration
**v7**). Both mirror the existing `missing_at` column's type and nullability
convention, so the stores gain no new value vocabulary.

Config was the obvious alternative and is wrong for four reasons:

- **Config is folder-scoped, hide is fingerprint-scoped.** A hidden file's
  identity is its content fingerprint (ADR-0002); the same content sighted in
  two folders is one row in `files` / `photos` and must be one hide decision.
  `{folder}/.ai-video-cataloger/config.json` cannot express that.
- **The filter has to be SQL.** Kolekcja's browse path is 100% SQL —
  `WHERE`/`ORDER BY`/`LIMIT`/`COUNT(*)` pushed to SQLite, with `total`,
  `mediaTotals` and the composite cursor all derived from the same predicate
  (`docs/architecture.md`, "Library collection feed"). A hide list held outside
  the database would have to be applied after the page was cut, which is
  exactly the bug class W71 fixed for `hideUnavailable`: page size, totals and
  cursor would describe rows the user cannot see.
- **Hide must work on a read-only folder.** A read-only source cannot receive
  a config write at all; the home-scope databases always can. This is the
  requirement that eliminates any per-folder sidecar encoding.
- **Config is a user-editable settings surface.** `config.json` is
  documented, hand-edited and copied between folders; a list of opaque
  fingerprints in it is not settings, and copying it between folders would
  carry hide decisions to unrelated content.

Both columns are indexed (`files(hidden_at)`, `photos(hidden_at)`) because
every Kolekcja page, every facet query and the map snapshot now carry the
predicate.

**D3 — Hide is scoped to the library surfaces, and to those only.** A hidden
file disappears from:

| Surface | Route / store call | Effect |
|---|---|---|
| Kolekcja feed | `GET /api/library/collection` (both legs) | row excluded; `total`, `videoTotal`/`photoTotal`, `mediaTotals` and the composite cursor all computed from the same predicate |
| Search | `GET /api/search`, `GET /api/photos/search` | row excluded |
| Facets | `GET /api/library/facets` | excluded from all five `GROUP BY` queries and from `counts`; the response gains `counts.hidden` so the "Ukryte" chip can carry a number |
| Map / places | `GET /api/catalog/locations` | pin excluded; the coverage caption's catalog-wide total excludes hidden files |
| Osoby | `GET /api/faces/people` | hidden files never count toward `observationCount` / `videoCount` / `photoCount` / `fileCounts`; a person whose every observation sits on hidden files is **omitted from the response**, not deleted |

It does **not** affect the Analysis surfaces — `GET /api/scan`,
`GET /api/catalog-tree*`, `GET /api/photos/tree`, `GET /api/photos/list` — nor
`GET /api/variants`, `GET /api/status`, `GET /api/index/status` or the backup
scope. Analysis is the filesystem-truth view: it lists what is on disk so the
user can analyze, re-analyze and inspect it. Hiding a file there would make it
unreachable from the surface whose entire job is to show what exists, and
would silently shrink the "not yet analyzed" counts that drive the run
buttons. Hide is a *browse* decision, and Kolekcja's "Ukryte" filter is the
one place a hidden file is listed and restored.

**D4 — The person row survives, the person card does not.** Omitting a person
from `/api/faces/people` is a read-time projection over visible observations.
Nothing is deleted, no centroid is recomputed, no name is lost: unhiding the
files brings the same `personId`, the same name and the same exemplars back.
The alternative — deleting the person when its files are hidden — would make
hide irreversible for names, which contradicts D1.

**D5 — Trash means the macOS Trash, through a port with two
implementations.** `TrashPort.moveToTrash(path)` is the only way a file leaves
its folder:

- **Electron composition** (`apps/desktop/src/composition.ts`) supplies
  `shell.trashItem`, alongside the existing `openExternal` and `saveFile` host
  capabilities. This is the surface the GUI uses.
- **CLI / headless server composition** supplies a Finder-backed move, so a
  CLI trash lands in the same Trash, with the same "Put Back" metadata, as a
  GUI trash. The path is passed to the script through `argv`, never
  interpolated into the AppleScript source — a file name containing `"` or `\`
  would otherwise terminate the string literal, which is an injection, not a
  formatting bug. The vector is fixed:

  ```
  execFile('osascript', [
    '-e', 'on run argv',
    '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
    '-e', 'end run',
    '--', absolutePath,
  ])
  ```

  It lives in `adapters/fs/finder-trash.ts` and calls `node:child_process`
  directly, as `apps/desktop/src/cli-install.ts` already does for its own
  `osascript` call. There is no generic command-runner port to route it
  through — the only runner in the repo is the analyzer-shaped
  `AnalyzerCommandRunner` in `adapters/analyzers/` — and none is introduced:
  an adapter is the layer allowed to touch `node:child_process`, and the
  module takes an injectable runner so the gates can assert the vector without
  spawning anything.
- A composition with neither (the gates, a non-darwin host) returns
  `unavailable`.

`rm`, `unlink`, `fs.deleteFile` and `fs.deletePath` are **never** used on a
user's media file. They remain the mechanism for the app's own artifacts (D7),
which the user never sees and whose recovery path is regeneration, not the
Trash. The port rule holds: two real implementations, and the platform
difference between them is real.

**D6 — All-or-nothing before a batch, fail-closed after partial progress.** A
preview resolves the selection to a list of fingerprints each carrying **every
one of its sightings** (D10), then to the set of folder roots those sightings
live under (the video `folders.current_path`, each photo sighting's owner
folder, plus the parent directory of every sighted file). Every root is probed
for existence first and writability second. An offline root is reported as
`target_offline` (HTTP 409, exit code 58); an online but unwritable root is
reported as `target_read_only` (HTTP 409, exit code 46). In both cases the
offending roots are carried in `details`, and **zero** files move, **zero** rows
change, **zero** artifacts are deleted.

The probe runs twice: once synchronously before the job is accepted, so the
user gets the refusal in the dialog rather than as a failed background job,
and once at the top of the job itself, so a drive unmounted between confirm
and start aborts before the first move rather than halfway through. A
successful probe still cannot make `TrashPort` infallible: a file can vanish,
the macOS Trash can refuse a volume, or a native adapter can fail per file. If
that happens after earlier files moved, the job stops, leaves the failed file's
records and artifacts intact, leaves every not-yet-attempted file untouched,
and returns `library_trash_incomplete` with the partial summary (HTTP 409,
exit code 59). The GUI keeps the dialog open and the CLI exits non-zero while
printing the moved, failed and not-attempted counts.

Why all-or-nothing per root rather than best-effort per file: a bulk delete's
value is that the user does not have to check the result. A run that quietly
skips the eleven files on the unplugged drive teaches the user to re-check
everything, which is worse than a refusal they can act on.

**D7 — "Every record" is a closed checklist, not a phrase.** Trashing one
fingerprint first moves every sighting of the media file to the macOS Trash.
Only after every sighting move succeeds does the app delete the records below,
flush `catalog.db` and `photos.db`, then remove the app-owned artifacts. A
failed move leaves that fingerprint's records and artifacts intact, so a crash
or a rejected Trash operation cannot leave a catalog with no row for a file
that still sits in place.

*`catalog.db` (a video, via the existing `GlobalCatalogStore.forgetEntry`):*

- [ ] `files` row — and with it `gps_lat`/`gps_lon`, `gps_source`,
      `place_name`/`place_region`/`place_country`/`place_country_code`,
      `captured_at`, `width`/`height`, `hidden_at`, `missing_at`
- [ ] `analyses` rows — every variant, including translation variants
- [ ] `file_tags` rows
- [ ] `search_documents` row and its FTS row
- [ ] `face_observations` rows and `face_index_state` row
- [ ] affected people recomputed: centroid and `exemplar_count` refreshed;
      a person left with **zero** observations is deleted

The mechanism already exists and is not re-implemented, but the two media call
**different** existing methods, because the existing methods already differ:

- A **video** is `GlobalCatalogStore.forgetEntry(fingerprint)` and nothing
  else on the catalog side. It already covers every row on the list above —
  `files`, `analyses`, `file_tags`, the search document and its FTS row, the
  `face_observations` rows and the `face_index_state` row — already runs the
  affected-person recomputation, and already returns the `cropPaths` the
  artifact step then deletes. Adding a
  `deleteFaceObservationsForFile` call after it would re-walk rows that are
  already gone.
- A **photo** is `GlobalCatalogStore.deleteFaceObservationsForFile(fingerprint)`
  for the catalog half — it deletes the observations, runs the same
  recomputation and returns the same `cropPaths` — and
  `PhotosStore.deletePhoto` for the `photos.db` half. `forgetEntry` is not
  usable there: a `ph_*` fingerprint has no `files` row, so `forgetEntry`
  returns `deleted: false` and deletes nothing at all, observations included.

*`photos.db` (a photo, via `PhotosStore.deletePhoto` over every sighting):*

- [ ] `photo_paths` sighting rows — all of them, for every folder that sighted
      the fingerprint
- [ ] `photos` row
- [ ] `photo_analyses` and `photo_analysis_errors` rows
- [ ] `photo_file_tags` rows
- [ ] `photo_search_documents` row and its FTS row
- [ ] `photo_face_index_state` row
- [ ] plus, in **`catalog.db`**, the photo's `face_observations` rows and the
      affected-person recomputation, through
      `deleteFaceObservationsForFile(fingerprint)` — never through
      `forgetEntry`, which no-ops on a fingerprint with no `files` row. The
      photo's identity data lives in the shared pool (ADR-0016), so a photo
      trash is a two-database operation

*Artifacts under the home root (deleted outright, never through the Trash):*

- [ ] `~/.ai-video-cataloger/faces/obs/<fingerprint>/` (video) or
      `faces/obs/ph_<hex>/` (photo) — the whole per-observation crop directory
- [ ] `~/.ai-video-cataloger/photo-artifacts/proxies/<fingerprint>.jpg`
- [ ] `~/.ai-video-cataloger/photo-artifacts/thumbs/<fingerprint>.jpg` and
      `<fingerprint>.grid.jpg`
- [ ] `~/.ai-video-cataloger/photo-artifacts/variants/<fingerprint>/` — no
      writer produces this directory in the current code (`photo-artifacts.ts`
      resolves proxies and thumbs only); it is on the checklist as *delete if
      present*, so an older installation's leftovers do not survive a trash

*Artifacts under the video artifact root — the folder's own
`.ai-video-cataloger/` when writable, otherwise
`~/.ai-video-cataloger/read-only-folders/{folderId}/`:*

- [ ] `artifacts/frames/<fingerprint>/` (every `framesKey`)
- [ ] `artifacts/transcripts/<fingerprint>/` (every `transcriptKey`)
- [ ] `variants/<fingerprint>/` (every `configId`)
- [ ] `thumbnails/<base>.jpg` and `thumbnails/<base>.grid.jpg`
- [ ] the name-based selected-variant projection, the full set `artifactPaths()`
      in `core/server/usecases/shared.ts` produces: `frames/<base>/`,
      `transcripts/<base>.txt`, `transcripts/<base>.json`,
      `summaries/<base>.txt`, `summaries/<base>.json`,
      `summaries/<base>-debug.log`; these name-based paths are skipped when
      another `files` row in the same folder has the same stem

Video artifact cleanup enumerates every possible owned root for each sighting:
the writable sidecar, the known folder-id read-only mirror, the current
path-derived read-only mirror and the supported legacy read-only mirror.

*Per-folder sidecar state:*

- [ ] `{folder}/.ai-video-cataloger/catalog.ndjson` is **re-exported** for
      every affected writable folder whose rows changed, on every exit path —
      a clean batch, a batch that stopped on a later failure, and a cancelled
      batch — so the snapshot never carries a record whose rows the run has
      already deleted

Deliberately **not** touched: the shared `tags` vocabulary (a tag that loses
its last file stays in the alias/vocabulary tables — tags are catalog-wide and
cheap, and reference-counted deletion would fight `tags alias`), `drive_runs`
history, the spend ledger, and the non-canonical legacy
`{folder}/.ai-video-cataloger/catalog.db` (which `index forget` also leaves
alone; it is a read-only migration source, not a write target).

**D8 — A trashed file cannot resurrect; a hidden file survives every
rescan.** These are the two invariants the folder watcher makes load-bearing,
because a change under a watched root triggers a rescan seconds after the
action.

- *Resurrection* has two paths, not one. The first is the folder's
  `catalog.ndjson` snapshot, imported when a marked folder is unknown to the
  local index (`docs/architecture.md` Delta 3); re-exporting it after every
  changed writable folder (D7) closes it. The second is concurrent catalog
  mutation while a destructive batch is in progress. Two things close it:
  `'library_trash'` joins `RUN_JOB_KINDS` in
  `core/server/usecases/folder-watch.ts`, so the watcher holds refreshes for
  the duration and emits once after the run settles; and the trash job acquires
  `catalog-write` plus `photo-scan:<root>` for every affected root through
  `JobsPort.acquireResource` before its first move and holds them for the
  whole batch. Backup, restore, video processing and photo processing treat
  `library_trash` as a conflicting catalog writer, so a restore cannot dispose
  the stores mid-run and a processor cannot reinsert a row while trash is
  deleting it. `scan` cannot resurrect a *completed* file, because its bytes
  are no longer at its path.
- *Hide survival* means `hidden_at` is never cleared implicitly — and the
  guarantee is structural, not a rule each caller must remember. `scan`,
  `process`, `process-drive`, `materialize`, `photos scan`, `photos process`
  and `index rebuild` all reach the row through `upsertFile` / `upsertPhoto`,
  whose `onConflictDoUpdate({ set: … })` clause today writes every mutable
  column of the incoming record, `missing_at` included. `hiddenAt` is therefore
  excluded from that `set` clause: an INSERT (a row the index does not yet
  have, which is what a snapshot import into a forgotten folder is) carries
  `hiddenAt` from the record, an UPDATE never touches it, and the only
  statement that moves the column is `setHidden` / `setPhotosHidden`.
  `CATALOG_SNAPSHOT_SCHEMA_VERSION` goes **12 → 13** so `hiddenAt` survives the
  export → import round trip instead of being lost.

**D9 — Trash keeps failures in the closed error taxonomy.** The taxonomy
carries the expected refusals:
`confirmation_required` (409 / 18) for a trash without confirmation,
`target_read_only` (409 / 46) for an online unwritable root,
`target_offline` (409 / 58) for an unplugged or stale root, `validation` (400 /
2) for an empty or malformed selection scope, `not_found` (404 / 5) for an
unknown person or fingerprint, and `unavailable` (503 / 8) for a composition
with no trash mechanism. `library_trash_incomplete` (409 / 59) is the explicit
partial-progress error: it carries the same `libraryTrashSummarySchema` in
`details.summary` that a successful job returns, so HTTP clients, the renderer
and the CLI can show moved, failed and not-attempted counts without treating a
partial batch as success.

**D10 — Selection scope is a server-side concept.** "Zaznacz wszystko" cannot
mean "the tiles currently loaded": Kolekcja pages at 200 items and a filter
can match thousands. Hide, unhide and trash therefore accept a discriminated
selection scope — an explicit fingerprint list, the current filter (the same
fields `GET /api/library/collection` accepts), or a person — and resolve it on
the server, inside the same store queries the feed uses. The renderer never
enumerates a filter result to act on it.

The resolver's output is one entry per fingerprint carrying `hiddenAt` and a
non-empty list of sightings (`folderId`, root path, file path), not a single
folder and path: a fingerprint is one row and many sightings (ADR-0002,
ADR-0016 §1), trash removes every one of them (D7), and the preview's
hidden/visible split has to come from the same pass rather than a second
query. A confirmed trash enqueues the previewed fingerprint list, not the
original filter or person scope, so a watcher rescan or another writer cannot
add newly matching files to the destructive target set after the user has
confirmed the count.

**D11 — Hide is synchronous; trash is a job.** Hide and unhide are one
`UPDATE` per store inside one transaction, fast at catalog scale, and return
their result directly. Trash is unbounded I/O — one `trashItem` per file plus
artifact-tree deletions — so it runs as a `library_trash` job with
`resourceKey: 'library-trash'` (global, so two trash runs never interleave),
cancellable through the existing `JobsPort.cancel`, with progress polled
through the existing job routes. The offline/read-only pre-flight (D6) stays
synchronous, before the job envelope is returned, and job admission treats
`library_trash` as a catalog-writing conflict for backup, restore and
processing work.

**D12 — The confirmation is strong and states the blast radius.** The GUI
dialog names the count, lists the affected folder roots, says the files go to
the macOS Trash (and that the app's analyses, tags, faces and thumbnails for
them are erased), and gates the destructive button behind an explicit
checkbox. The CLI equivalent is `--yes`; without it the command prints the plan
and exits `confirmation_required` (18), changing nothing. `--dry-run` always
wins over `--yes`: it reports the same plan — counts, hidden/visible/shared
splits, roots with online/writable state, and the artifact paths that would be
removed — and writes nothing.

That plan does not fit in a job envelope, so `POST /api/library/trash` returns
a `kind`-discriminated union rather than `jobAcceptedOutputSchema`: a `plan`
member for `dryRun: true`, and a `job` member carrying the same `jobId` for a
confirmed run. Splitting the plan onto a second route was the alternative; one
route with one union keeps "what would happen" and "make it happen" on the same
input schema, so a client cannot preview one selection and act on another.

Kolekcja and Osoby show that same dialog, and the renderer's features are
lint-enforced islands: `web-features-are-islands` forbids
`features/people/**` from importing `features/library/**`. Sharing therefore
extracts **downward** — the dialog is a props-only component under
`components/ui/dialogs/`, beside `CancelConfirmationDialog` and
`DriveSummaryDialog`, holding no query and no mutation, so each feature keeps
its own `librarySelectionPreview` and `libraryTrash` wiring and only the
presentation is shared. `web-ui-presentational` additionally bars
`components/ui` from importing `core/`, so the dialog's props are locally
declared and the contract's preview output is mapped onto them at the feature
edge. Duplicating the dialog per feature was the alternative and was rejected:
two copies of a destructive confirmation drift, and the read-only refusal is
the one screen that must never differ between the two entry points.

**D13 — The person shortcuts default differently on purpose.** A person card's
⋮ menu offers "Ukryj pliki tej osoby" and "Przenieś do Kosza pliki tej osoby".
Both dialogs state how many of the selected files also contain other
recognized people, and both offer "pomiń pliki z innymi osobami". It defaults
**on for trash** and **off for hide**, because the two mistakes are not
comparable: a hidden file that should not have been hidden is one click from
coming back, while a trashed file that also held someone else's face is
recoverable only from the OS Trash, by hand, with its analyses gone. The
default follows the reversibility, not consistency between the two dialogs.

## Alternatives rejected

- **One action with a `permanent` flag.** Collapses two different consent
  levels into one control; the confirmation copy, the error paths and the
  reversibility are all different, and a shared control would make the safe
  action carry the dangerous one's ceremony.
- **Hide as a reserved tag** (e.g. `#ukryte`). Tags are analysis output,
  normalized, aliased, translated and user-visible in the facet list; a
  reserved tag would leak into the tag facet, into search documents and into
  the analyzer's own vocabulary, and `tags alias` could rename it.
- **Hide in `config.json` / a home-scope JSON list.** Rejected in D2 — wrong
  scope, wrong layer for a SQL predicate, and impossible on a read-only
  folder.
- **A soft-delete `trashed_at` column instead of erasing rows.** Would keep
  the analyses of a file the user asked to delete, defeating the purpose, and
  would leave every query in the app carrying a second exclusion predicate
  forever. The reversibility the user asked for is hide; trash is deliberately
  terminal on the app side, with the OS Trash as the only undo.
- **`fs.unlink` / `rm` for the media file.** No undo, no Finder "Put Back",
  and it makes an accidental bulk selection unrecoverable. `shell.trashItem`
  exists precisely for this.
- **Best-effort trash that skips unwritable roots.** Rejected in D6.
- **Deleting a person whose files are all hidden.** Rejected in D4 — makes a
  reversible action irreversible for names.
- **Renderer-side selection of "everything in the filter".** Rejected in
  D10 — would require fetching every page to act on the result, and would
  silently act on a stale page set.

## Migration of existing data

1. `catalog.db` **V17** adds `files.hidden_at` (nullable) and its index;
   `photos.db` **v7** adds `photos.hidden_at` (nullable) and its index. Both
   are pure `ALTER TABLE ADD COLUMN` + `CREATE INDEX`: existing rows read
   `NULL`, meaning visible, so an upgraded installation looks exactly as it
   did.
2. `CATALOG_SNAPSHOT_SCHEMA_VERSION` 12 → 13. A v12 snapshot imports with
   `hiddenAt` absent → `null`; a v13 snapshot read by an older build fails the
   existing version check, which is the established behaviour for a snapshot
   from the future.
3. No data is rewritten, moved, backed up or deleted by either migration.

## Rollback

- **Hide data survives a forward-compatible rollback, but 0.6.28 is not
  forward-compatible with these database versions.** The migrations are
  additive columns, so a build that is allowed to open `catalog.db` V17 and
  `photos.db` v7 can ignore them and show every hidden file as visible;
  reapplying the feature restores the same hidden set because the columns were
  never cleared. A stock 0.6.28-era build has future-version guards and refuses
  those databases instead of opening them. Rolling back to that build requires
  restoring pre-migration databases from backup or using a compatibility build
  that intentionally lowers the supported metadata after dropping or ignoring
  the additive columns.
- **Trash does not revert.** The file is in the OS Trash (recoverable by the
  user, by hand, via Finder "Put Back") and the records are gone. This is why
  D12 makes the confirmation strong, D6 keeps failed moves record-intact, and
  `library_trash_incomplete` makes any partial batch visible to the caller: the
  rollback story is the user's, not the app's.

## Consequences

- Every Kolekcja page, facet query, map snapshot and Osoby listing carries one
  more predicate. Both new columns are indexed, and the browse path stays 100%
  SQL — no load-all-and-filter is introduced.
- `GET /api/library/facets` gains `counts.hidden`; `GET /api/faces/people` can
  now return fewer people than the catalog holds, which is a read projection
  and not a data change.
- Three contract inputs gain a `hidden` tri-state (`exclude` default, `only`,
  `include`) — `searchInputSchema`, `collectionInputSchema` and
  `photosSearchInputSchema` — so the "Ukryte" view is the same query surface as
  everything else, per `docs/architecture.md`'s "one query surface, not two".
  `hiddenScopeSchema` itself is declared in `core/domain` and re-exported from
  `core/contract`, because the domain's selection-filter schema needs it and
  `core/domain` may not import `core/contract`.
- One new port (`TrashPort`), one new job kind (`library_trash`), four new
  contract routes, four new NDJSON progress steps, and two trash-specific
  error codes (`target_offline`, `library_trash_incomplete`) mapped through
  HTTP and CLI taxonomy (D9).
- `libraryFacets` gains a `photos: PhotosStore` dependency, because
  `counts.hidden` spans both media while `listLibraryFacets` reads only
  `catalog.db`.
- The job-result union gains `libraryTrashSummarySchema`, which — per
  `docs/architecture-photos.md` §7's challenge-B5 rule — carries a **required
  literal discriminator** (`kind: 'library_trash'`) and is placed before the
  absorbing members of the untagged union, with a round-trip test asserting
  every other member rejects the sample.
- **Parity:** hide and trash are post-parity capabilities — the old app had
  neither, and `tasks/parity-inventory.md` describes no such behaviour. No
  parity-inventory behaviour changes; the note added there records that the
  two additive columns and the snapshot version bump introduce no new database
  file and no new on-disk directory. The four sanctioned deviations in the
  PRD's Technical Considerations are untouched.
- **Changelog:** this commit is documentation only and carries no
  `CHANGELOG.md` line, per the repo rule that a changelog entry travels with a
  behaviour-visible change. The lines each wave must land are enumerated in
  [tasks/prd-library-hide-and-trash.md](../../tasks/prd-library-hide-and-trash.md).
