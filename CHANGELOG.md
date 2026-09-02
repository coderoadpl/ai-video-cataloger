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

- Osoby has Wszystko / Filmy / Zdjęcia chips that narrow the person list and its
  per-person counts, and a person card opens a grid of that person's photos and
  videos in the shared Kolekcja media viewer.
- Photo detail shows the people detected in the photo, the way video detail
  already did; `GET /api/photos/detail` gained an additive `people` field and
  `GET /api/faces/people` gained additive `videoCount` and `photoCount`.
- Encrypted critical and optional backup archives can now run through the scheduled backup job pipeline with independent retention and crash-safe local staging.
- The CLI can now list remote encrypted backups and restore one after explicit confirmation.
- Google Drive backup destinations now support either desktop OAuth with `drive.file` access or a service account restricted to one configured Shared Drive folder.
- `faces recluster --dry-run` can print benchmark metrics from supplied reference-partition and labelled-pairs files, and Osoby now requires a dry-run report before starting a full people recluster.
- `faces index` and `photos process` now detect faces in photos themselves,
  over the photo proxy, writing one crop per observation like the video pass;
  photo face observations that arrived through `photos import-libra` are
  dropped on first open (backed up under
  `~/.ai-video-cataloger/backups/`) because they carry no crops and foreign
  geometry.
- A privacy-lint gate now runs in `check`, and `AVC_SCRATCH_DIR` replaces the previous fixed scratch-directory convention.
- CI gates (`check`, `smoke`, `ai-review`) run on GitHub-hosted `macos-15` runners with literal job names and no arming variables, `e2e-cli` and the new `visual-baselines` workflow are dispatch-only, and the visual gate selects its baseline set with `VISUAL_ENV` (`local-darwin` by default, `ci-macos-15` on CI). See [docs/ci.md](docs/ci.md)
- `variants import-translation` bulk-upserts Polish analysis variants from NDJSON with dry-run, optional selection, normalized tags, copied source transcripts and selectable source artifacts.

### Changed

- Face identity rebuild (`faces recluster`) now uses deterministic agglomerative average-linkage clustering over stored embeddings instead of order-dependent greedy centroid assignment; the cut threshold is biased towards splitting a person rather than merging two (ADR-0018).
- `scripts/faces-benchmark.ts` sweeps recluster thresholds against supplied reference partitions and labelled pairs, reporting pairwise precision/recall/F1, purity, completeness, zero-different-pair thresholds and a conservative selected threshold.
- `GET /api/faces/status` reports `videosIndexed`, `photosIndexed` and
  `stalePhotoFiles` alongside the existing counters.
- The AI review gate has a 90-turn budget and reads large diffs in grouped
  `git diff` calls, always returning a verdict.

### Fixed

- Read-only folder artifacts remain reachable after a registered source folder
  is renamed or moved.
- Backup database snapshots now stop waiting on a foreign catalog lock after a bounded deadline and honor job cancellation while waiting.
- Backup archives now fail with `backup_integrity_failed` if a file changes size while it is being streamed into the tar archive.
- Backup retention pruning now lists and deletes only the completed run's archive tier.
- Google OAuth backup now verifies a saved Drive folder id and recreates the app backup folder when the saved folder is missing or trashed.
- Google Drive resumable uploads now retry `rateLimitExceeded` and `userRateLimitExceeded` 403 responses consistently with Drive error mapping.
- Filtering Kolekcja by a person no longer hides every photo, so the person
  counts in the Osoby facet and the results now agree.
- `faces exemplars` repairs a photo observation's crop from the photo proxy
  instead of reporting the photo as unavailable.
- Photo scans now count unreadable file contents as failed candidates and continue indexing the remaining files.
- PHOTO LIBRA geo imports now join through manifest md5 values when artifact paths no longer match scanned paths.

## [0.6.24] - 2026-09-01

### Changed

- Kolekcja now opens every tile — video or photo — in one fullscreen media
  viewer: the video player replaces the centered dialog, the right-hand panel
  carries description, tags, transcript, path, duration, size, capture date and
  analysis provenance, and the prev/next arrows walk the current filtered
  collection across both media types
  ([`63acd7a`](https://github.com/coderoadpl/ai-video-cataloger/commit/63acd7a8f6cfdc1d64cd1e37fef301504724a786)).

### Added

- Kolekcja has a "Ukryj niedostępne" / "Hide unavailable" toggle that hides
  items on a disconnected drive or with a missing file; the choice persists
  across restarts, and `GET /api/library/collection` gained the additive
  `hideUnavailable` query parameter that keeps totals, chip counts and
  pagination consistent with what the grid shows
  ([`f506625`](https://github.com/coderoadpl/ai-video-cataloger/commit/f5066256900ad222d699fa75d540cf71bc388c61)).
- `GET /api/library/preview` now returns the selected variant's analysis
  provenance (`analysis: { label, createdAt }`, nullable)
  ([`63acd7a`](https://github.com/coderoadpl/ai-video-cataloger/commit/63acd7a8f6cfdc1d64cd1e37fef301504724a786)).

### Fixed

- Unanalyzed photos and videos no longer show a redundant status badge in
  Analysis detail headers, while analyzed badges remain unchanged
  ([`fd34294`](https://github.com/coderoadpl/ai-video-cataloger/commit/fd34294682d1b4fdc6ecdbd783e655be9a6a04c9)).
- Analyzing status badges now inset their spinner by the shared chip-icon
  spacing
  ([`fd34294`](https://github.com/coderoadpl/ai-video-cataloger/commit/fd34294682d1b4fdc6ecdbd783e655be9a6a04c9)).
- The photo analysis variant selector was verified to have no automatic-open or
  focus-stealing path
  ([`fd34294`](https://github.com/coderoadpl/ai-video-cataloger/commit/fd34294682d1b4fdc6ecdbd783e655be9a6a04c9)).

## [0.6.23] - 2026-08-16

### Changed

- The release walkthrough now derives its default Library query from the
  analyzed fixture filename, requires a matching result, and clears that query
  before exercising the preview overlay and its Analysis action
  ([`d2d0db8`](https://github.com/coderoadpl/ai-video-cataloger/commit/d2d0db82615f089ecdfcb60f4175dc4bc6e81f5c)).
- The release walkthrough now dismisses the Library search suggestions with a
  single real `Escape` keypress after clearing the query and waits for the
  popper to disappear, so it can no longer intercept the preview tile click
  ([`b5d596d`](https://github.com/coderoadpl/ai-video-cataloger/commit/b5d596d76a4afb7bf8372a1aa18db89af6ad17be),
  [`c25c98f`](https://github.com/coderoadpl/ai-video-cataloger/commit/c25c98f800fde38cb61b5df4df5f1295f99f0d67)).

### Fixed

- Pressing `Escape` over the Library search suggestions now closes them; the
  popper reopens when the field is focused again or the query is emptied by
  typing or the clear button
  ([`c25c98f`](https://github.com/coderoadpl/ai-video-cataloger/commit/c25c98f800fde38cb61b5df4df5f1295f99f0d67)).
- Tag and suggested-filename normalization now share NFD-based diacritic
  transliteration, including Polish `ł` and common non-decomposing Latin
  characters, so normalized tag values now retain their ASCII letters (for
  example, `jeżowak` becomes `jezowak`); catalog and photo-store migrations
  recover remaining Unicode tag rows, merge normalization collisions, and
  rebuild their search indexes without changing CLI, NDJSON, or contract
  shapes
  ([`d2d0db8`](https://github.com/coderoadpl/ai-video-cataloger/commit/d2d0db82615f089ecdfcb60f4175dc4bc6e81f5c)).

## [0.6.22] - 2026-08-16

**Note:** this build was merged and tagged but never published; `v0.6.23`
supersedes it. The tag stays unpublished and this section stays as history.

### Changed

- Video and photo detail panes now consume shared metadata-row, status-card,
  and variant-control primitives, keeping row typography, neutral status-card
  treatment, and control-caption spacing aligned across both media (W68b)
  ([`f1d49bf`](https://github.com/coderoadpl/ai-video-cataloger/commit/f1d49bf0c45409cf3124012cc09160a3d83638f4)).
- Analyzed photo details now present description, scene, and quality in an
  outlined Description card while keeping clickable tags separate, and both
  photo provenance and video output-language captions use humanized language
  names (W68b)
  ([`f1d49bf`](https://github.com/coderoadpl/ai-video-cataloger/commit/f1d49bf0c45409cf3124012cc09160a3d83638f4)).
- Automatic analysis-language provenance now says that it follows the app
  language in both English and Polish instead of claiming language detection
  (W68b)
  ([`f1d49bf`](https://github.com/coderoadpl/ai-video-cataloger/commit/f1d49bf0c45409cf3124012cc09160a3d83638f4)).
- Analyzer `output_language: auto` now follows the configured app UI language
  for video descriptions, filenames, tags, and photo descriptions without
  changing stored variant identity (Wave D: N2)
  ([`7c818f9`](https://github.com/coderoadpl/ai-video-cataloger/commit/7c818f9ccd76656397a9de2798ebed06cfedabd9)).
- The Kolekcja photo viewer now shows description, scene, quality, tags,
  humanized analysis provenance, and an action that opens the photo in
  Analysis (N9)
  ([`6f95b0a`](https://github.com/coderoadpl/ai-video-cataloger/commit/6f95b0a60fdcc8960e292911eecfa3e0c115ef31)).
- Analysis → Photos now automatically rescans the current open folder after
  debounced filesystem changes and refreshes its photo tree and sidebar when
  the scan completes (N14)
  ([`126338d`](https://github.com/coderoadpl/ai-video-cataloger/commit/126338dc75255cec6bd2668ee1106c74524c5840)).

### Removed

- The manual "Rescan current folder" entry has been removed from the Photos
  open-folder menu because current-folder changes now trigger an automatic
  rescan (N14)
  ([`126338d`](https://github.com/coderoadpl/ai-video-cataloger/commit/126338dc75255cec6bd2668ee1106c74524c5840)).

### Fixed

- Photo analysis now accepts comma- or semicolon-separated string tags from
  local models as validated non-empty tag arrays, and its prompt explicitly
  requires JSON array syntax (Wave L)
  ([`9560e02`](https://github.com/coderoadpl/ai-video-cataloger/commit/9560e02ecbfe67d52d8a5d227aafe37952c82d80)).
- Single-photo analyzer responses that fail parsing now receive one fresh
  analysis-and-parse attempt, while multi-photo parse failures continue
  through recursive batch splitting
  ([`ddd956b`](https://github.com/coderoadpl/ai-video-cataloger/commit/ddd956bd529ddbe5794f12303b2f96d3d066d758)).
- Persisted photo-response parsing failures now render as localized English or
  Polish guidance while retaining the original diagnostic message in storage
  ([`ddd956b`](https://github.com/coderoadpl/ai-video-cataloger/commit/ddd956bd529ddbe5794f12303b2f96d3d066d758)).
- Failed photo analyses now persist across restarts, appear in photo badges
  and detail retry cards with sanitized messages, and produce honest per-file,
  partial-run, and all-failed reporting
  ([`ce7ceb6`](https://github.com/coderoadpl/ai-video-cataloger/commit/ce7ceb61149f85e1705cd68ab85eb04d34baf2c2)).
- Photo analysis now retries a retryable single-photo processing failure
  exactly once before persisting the failure, without changing batch
  split-retry accounting
  ([`ce7ceb6`](https://github.com/coderoadpl/ai-video-cataloger/commit/ce7ceb61149f85e1705cd68ab85eb04d34baf2c2)).
- Kolekcja folder filtering now follows photo membership through either
  ownership or sightings while unfiltered totals still count each photo
  identity once
  ([`ebfc808`](https://github.com/coderoadpl/ai-video-cataloger/commit/ebfc808dc86a898080ab84bb93fc1715799255d1)).
- Automatic video and photo analyses now record resolved output and tag
  languages and rerun the same variant after the UI language changes, while
  explicit languages and migrated rows without provenance remain unaffected
  ([`ebfc808`](https://github.com/coderoadpl/ai-video-cataloger/commit/ebfc808dc86a898080ab84bb93fc1715799255d1)).
- Folder snapshots now round-trip resolved video output and tag languages, so
  an auto-language variant recovered from a snapshot reruns after the UI
  language changes while older snapshot rows retain legacy-null freshness
  semantics
  ([`de1ab47`](https://github.com/coderoadpl/ai-video-cataloger/commit/de1ab47ba44cebc2425cdf6e0b67118a776424fb)).
- `photos forget` now removes forgotten scan-root provenance, revoking both
  root listing and reveal authorization
  ([`ebfc808`](https://github.com/coderoadpl/ai-video-cataloger/commit/ebfc808dc86a898080ab84bb93fc1715799255d1)).
- A watched photo rescan that fails under an external catalog lock now retains
  the pending change and retries with bounded backoff without requiring
  another filesystem event
  ([`ebfc808`](https://github.com/coderoadpl/ai-video-cataloger/commit/ebfc808dc86a898080ab84bb93fc1715799255d1)).
- Photo grid-thumbnail backfill now invalidates photo and collection queries
  after every terminal or polling outcome, including a disappeared job
  ([`ebfc808`](https://github.com/coderoadpl/ai-video-cataloger/commit/ebfc808dc86a898080ab84bb93fc1715799255d1)).
- Electron renderer transport now rejects a pending bridge request with
  `AbortError` when its signal aborts, allowing polling teardown to settle
  without post-unmount effects while the already-dispatched main-process
  request finishes independently
  ([`de1ab47`](https://github.com/coderoadpl/ai-video-cataloger/commit/de1ab47ba44cebc2425cdf6e0b67118a776424fb)).
- Face-index controls and English and Polish copy now accurately gate and
  describe the current video-only pipeline instead of promising photo-face
  indexing
  ([`ebfc808`](https://github.com/coderoadpl/ai-video-cataloger/commit/ebfc808dc86a898080ab84bb93fc1715799255d1)).
- Analysis copy now uses coherent terminology and American English spelling
  across language selection, readiness, status, cancellation, wizard, badge,
  and Library surfaces
  ([`0d1dbf1`](https://github.com/coderoadpl/ai-video-cataloger/commit/0d1dbf1186555557ae425b8a3af4378ab425efbe)).
- Polish photo-tree, Gemini spend, analysis summary, and terminal counts now
  use count-aware numeral forms, with correct English singular and plural
  summary wording
  ([`0d1dbf1`](https://github.com/coderoadpl/ai-video-cataloger/commit/0d1dbf1186555557ae425b8a3af4378ab425efbe)).
- Video and photo scope toggles now explain whether they are disabled because
  analysis is busy or because the active medium has no subfolders
  ([`0d1dbf1`](https://github.com/coderoadpl/ai-video-cataloger/commit/0d1dbf1186555557ae425b8a3af4378ab425efbe)).
- Map descriptions and accessibility labels now cover both videos and photos,
  including media-neutral cluster counts
  ([`0d1dbf1`](https://github.com/coderoadpl/ai-video-cataloger/commit/0d1dbf1186555557ae425b8a3af4378ab425efbe)).
- Kolekcja now refreshes photo tiles after the queued grid-thumbnail backfill
  actually completes, so a tile mounted before generation does not retain a
  filename placeholder when its thumbnail exists (N1)
  ([`97063e3`](https://github.com/coderoadpl/ai-video-cataloger/commit/97063e31840bd1016ad8e3014cd99a451f102a54)).
- Biblioteka's Folder filter now returns matching videos and photos without a
  photos-hidden notice; people, place, and GPS filters remain video-only (N10)
  ([`97063e3`](https://github.com/coderoadpl/ai-video-cataloger/commit/97063e31840bd1016ad8e3014cd99a451f102a54)).
- "Show in Finder" now admits Kolekcja photos under registered photo roots
  while preserving the existing path-scope guard (N7)
  ([`6f95b0a`](https://github.com/coderoadpl/ai-video-cataloger/commit/6f95b0a60fdcc8960e292911eecfa3e0c115ef31)).
- Kolekcja's Wszystko, Filmy, and Zdjęcia chips now keep stable totals for the
  active non-media filters when the media selection changes (N8)
  ([`6f95b0a`](https://github.com/coderoadpl/ai-video-cataloger/commit/6f95b0a60fdcc8960e292911eecfa3e0c115ef31)).
- Photo analysis provenance now renders configured provider names and
  localized English, Polish, and automatic output-language labels while
  title-casing unknown provider IDs (N6)
  ([`64b880a`](https://github.com/coderoadpl/ai-video-cataloger/commit/64b880ac7c10ec6040b136850c91f7ce073769e5)).
- Analysis wording, photo variant-picker labeling, and fingerprint-distinct
  photo tree counts now stay coherent across Polish analysis surfaces and
  duplicate sightings (N11)
  ([`64b880a`](https://github.com/coderoadpl/ai-video-cataloger/commit/64b880ac7c10ec6040b136850c91f7ce073769e5)).
- In-progress photo rows now keep their normal thumbnail placeholder and show
  the same orange analyzing status-badge treatment as video rows (N13)
  ([`64b880a`](https://github.com/coderoadpl/ai-video-cataloger/commit/64b880ac7c10ec6040b136850c91f7ce073769e5)).

## [0.6.21] - 2026-08-16

### Changed

- Video and photo detail panes now share one responsive media-detail layout:
  the preview leads on narrow screens, becomes a fixed-width right column on
  large screens, and the existing video detail test IDs and status attributes
  remain intact (W68a)
  ([`8c7c940`](https://github.com/coderoadpl/ai-video-cataloger/commit/8c7c940ea3b95a0c089b64fe78909b9e65b2f2b9)).
- Photo details now match the video header and metadata-card patterns with a
  filename/path/status header, shared status badges, icon-led photo metadata,
  and clickable tags that open the matching Library search (W68a)
  ([`8c7c940`](https://github.com/coderoadpl/ai-video-cataloger/commit/8c7c940ea3b95a0c089b64fe78909b9e65b2f2b9)).
- Analysis now uses one neutral outlined empty-state pattern for videos and
  photos when a folder is open but no file is selected, with medium-specific
  copy when that folder contains no files of the active medium. The full
  welcome and onboarding view now appears only when no folder is open (W66)
  ([`5787425`](https://github.com/coderoadpl/ai-video-cataloger/commit/5787425f5118119b0eda08f8deedbc9b6278c451)).
- The Analysis → Photos face-index action now lives with the photo-analysis
  actions in the sidebar and stays disabled with an explanatory tooltip until
  the current root contains analyzed photos, instead of floating above the
  main-pane empty state (W66)
  ([`5787425`](https://github.com/coderoadpl/ai-video-cataloger/commit/5787425f5118119b0eda08f8deedbc9b6278c451)).

### Fixed

- Face-index failures now pass through the analyzer-error formatter before
  localized failure copy is composed, so an empty catalog root no longer
  exposes raw English server text or its filesystem path (W66)
  ([`5787425`](https://github.com/coderoadpl/ai-video-cataloger/commit/5787425f5118119b0eda08f8deedbc9b6278c451)).

## [0.6.20] - 2026-08-15

### Changed

- Analysis → Photos now mirrors the videos scope model: "This folder" keeps
  the direct-photo list, while "Whole tree" shows only the current folder's
  collapsible subtree and is disabled when that folder has no subfolders. The
  global tree of every registered photo root no longer appears in this
  sidebar; those roots remain registered and available in the Library (W62)
  ([`3540c5e`](https://github.com/coderoadpl/ai-video-cataloger/commit/3540c5ed81fcaa8eb5642997de656d40bc503656)).
- The photos sidebar's primary action is now "Analyze All (N)", with `N`
  counting pending photos in the current direct-folder or subtree scope. It
  processes exactly that scope, while manual rescan moved to the open-folder
  dropdown and photo-run cancellation now uses photo-specific copy (W62)
  ([`3540c5e`](https://github.com/coderoadpl/ai-video-cataloger/commit/3540c5ed81fcaa8eb5642997de656d40bc503656)).

### Removed

- Biblioteka no longer has a separate Zdjęcia browse tab: Kolekcja is the
  single analyzed-only timeline for videos and photos, while scanned but
  unanalyzed photos remain available in Analiza → Zdjęcia (W63)
  ([`d76a56f`](https://github.com/coderoadpl/ai-video-cataloger/commit/d76a56f353204c4a07cd59b6b5a3364fc39e55d4)).

### Fixed

- Analysis → Photos, "Whole tree" scope: the root folder's own photos now
  render as rows instead of a permanent "Scanning folder…" placeholder when
  that folder's contents were already fetched by the "This folder" scope
  (W65)
  ([`635d292`](https://github.com/coderoadpl/ai-video-cataloger/commit/635d292e153607e3dc53097300d5243733226d26)).
- The sidebar media/scope toggle row no longer truncates its labels at narrow
  sidebar widths: "Videos"/"Photos" rendered as "Vide…"/"Pho…" at 260 px in
  both the videos and photos sidebars, and now every label renders in full in
  English and Polish (W62)
  ([`3540c5e`](https://github.com/coderoadpl/ai-video-cataloger/commit/3540c5ed81fcaa8eb5642997de656d40bc503656)).
- `pnpm run qa:walkthrough` passes again on the W62 photos scope model: its
  photos steps drive the shared "This folder"/"Whole tree" toggle instead of
  the removed "Wszystkie" one, and every photo it copies into the per-run
  scratch fixtures now gets a unique content fingerprint (the intentional
  duplicate pair excepted, and one copy planted in a subfolder so the
  whole-tree scope exists), so a prepared QA home can no longer key the copies
  back to the source folder and leave the run with nothing to analyze (W64)
  ([`612dcd7`](https://github.com/coderoadpl/ai-video-cataloger/commit/612dcd7a5d52c7d4c60e718290776137ceefdf21)).

## [0.6.19] - 2026-08-15

### Changed

- The photo details "Analiza" row now reads as human copy instead of raw
  provenance: the provider and output-language tokens of the stored variant
  label are translated through the dictionary (the model tag stays verbatim)
  and the analysis timestamp is formatted in the UI locale instead of being
  printed as an ISO string. The stored label itself is unchanged
  ([`e7a2d51`](https://github.com/coderoadpl/ai-video-cataloger/commit/e7a2d51bfd6c05d4d30b537827dcf8ee21d5f629)).
- The landing page download button now points at this repository's GitHub
  Releases (`coderoadpl/ai-video-cataloger`); the separate
  `chomamateusz/ai-video-cataloger-releases` distribution repo is retired now
  that this repository is public
  ([`c550a59`](https://github.com/coderoadpl/ai-video-cataloger/commit/c550a598174de083279a5d4b85aff80b35565856)).

## [0.6.18] - 2026-08-04

### Fixed

- Biblioteka → Kolekcja no longer lists a photo that was scanned but never
  analyzed: `PhotosStore.collectionPage` now requires a `photo_analyses` row
  in both its browse and search-match branches, matching the video side
  (which already only surfaces analyzed files) and the release's own W55
  Added entry. The Library → Zdjęcia browse tab and the Analysis photos
  sidebar/tree are unaffected — browsing and picking a photo to analyze
  intentionally still lists every scanned photo (W60)
  ([`889a2e7`](https://github.com/coderoadpl/ai-video-cataloger/commit/889a2e744f26c06808eafd2bda61c55980fe94a6)).
- The release walkthrough now exercises the W57 photos folder tree
  end-to-end instead of leaving it entirely unscreenshotted: three new steps
  (`photos-tree`, `photos-tree-analyze`, `collection-photo-analyzed`) switch
  the Zdjęcia sidebar to "Wszystkie", expand a folder row, select a photo
  from the tree and assert its single-photo "Analizuj" is enabled, run that
  analysis to completion, and then assert the analyzed photo reaches
  Biblioteka → Kolekcja (W60)
  ([`889a2e7`](https://github.com/coderoadpl/ai-video-cataloger/commit/889a2e744f26c06808eafd2bda61c55980fe94a6)).

## [0.6.17] - 2026-08-04

### Added

- Biblioteka → Kolekcja now surfaces analyzed photos alongside videos: it
  reads `GET /api/library/collection` with cursor-based pagination instead of
  video-only `GET /api/search`, groups every item into one shared
  capture-day timeline, and adds Wszystko/Filmy/Zdjęcia media chips carrying
  the per-medium totals the current request actually counted (W55). When a
  video-only filter (people, place, GPS, folder) is active while the media
  filter is "Wszystko", photos
  are hidden server-side and an inline notice names the active filter;
  folder grouping and relevance sort are disabled with a tooltip whenever
  photos are mixed into the results or the media filter isn't a single
  medium. Photo tiles open a dedicated photo viewer and route "Otwórz w
  analizie" to the photo's owning scanned root
  ([`4c5e2c3`](https://github.com/coderoadpl/ai-video-cataloger/commit/4c5e2c3e2a4c27dd719db4a3f2c0d24f766d865b)).

### Changed

- The photos sidebar's "Wszystkie" scope now renders a full collapsible
  folder tree (roots → subfolders → photo rows, each with photo/analysed
  counts, root expanded and children collapsed by default) instead of a flat
  per-root photo list, matching the videos catalog tree; two new read-only
  endpoints back it (`GET /api/photos/tree/folders` for the folder summary,
  `GET /api/photos/tree/folder` for a folder's direct photos on expand) so it
  stays honest at large photo counts instead of deriving from the full
  paginated list client-side (W57)
  ([`147e645`](https://github.com/coderoadpl/ai-video-cataloger/commit/147e6456f76dd0c8284fe98aad3c6c1a547c6824)).
- Photo analysis scope split into two independent actions: the photo detail
  pane's "Analizuj" now analyzes only the selected photo (`POST
  /api/photos/process` gains an optional `fingerprints[]`), and the sidebar
  toolbar's "Przetwórz" under the "Wszystkie" scope now processes every
  scanned root sequentially in one job with an honest "root X of Y" progress
  label and clean mid-sequence cancellation, instead of silently falling back
  to the selected photo's owner folder (`root` on `POST /api/photos/process`
  is now optional; omitting it means every scanned root) (W56)
  ([`218f843`](https://github.com/coderoadpl/ai-video-cataloger/commit/218f8433172810891ab16d0baef73d6f80793051)).

### Fixed

- The details panel's "completed" status copy now names only the artifacts
  the selected variant actually has (summary is always promised; transcript
  and frames are named only when present), instead of unconditionally
  promising all three even for a whisper-skip variant with no transcript or
  a native variant with no frames (W58)
  ([`3c9f15e`](https://github.com/coderoadpl/ai-video-cataloger/commit/3c9f15e1c548e721a87922ef3109282263649e09)).
- `RefreshSnackbar` and `RootErrorFallback` now sanitize `ApiError` messages
  through the existing analyzer-error formatter before rendering them,
  instead of interpolating the raw server message, so a background-refresh
  toast or the crash fallback screen can no longer leak an absolute
  filesystem path (W58)
  ([`3c9f15e`](https://github.com/coderoadpl/ai-video-cataloger/commit/3c9f15e1c548e721a87922ef3109282263649e09)).
- The photo detail pane's single-photo "Analizuj" now resolves the selected
  photo's owner root from the already-fetched photo detail when the selection
  is not in the currently loaded page of the flat list, instead of staying
  disabled — reachable for the first time now that the folder tree can select
  a photo the flat list has not paginated to (W57)
  ([`147e645`](https://github.com/coderoadpl/ai-video-cataloger/commit/147e6456f76dd0c8284fe98aad3c6c1a547c6824)).
- W59 silent-failure fix wave: People "Install models" failures now set the
  same `mutationError` Snackbar as every other People mutation instead of
  logging to the terminal only; Photos scan/generate-proxies/analyze now
  submit their job request only after the busy guard passes (a thunk instead
  of an eagerly-evaluated promise) and each has distinct start/success/failure
  log labels instead of reusing the page title or action name for all three;
  a Stop click that lands before a drive/single-video run has an assigned job
  id is now honoured once the job starts (instead of silently doing nothing
  while the run proceeds), and every programmatic cancel now surfaces a
  cancel-request failure instead of swallowing it; the Wizard's UI-language
  dropdown surfaces a failed config write via the existing validation alert
  instead of silently reverting the selection; the Library tile menu's
  "Reveal in Finder" now shows the same reveal-failed toast as every other
  reveal entry point, and "Copy path" confirms success and surfaces a failed
  clipboard write instead of doing nothing either way; the catalog-lock
  banner's Retry button now appends the mutation failure to the banner text
  instead of discarding it; the desktop menu's "Install Command Line Tool…"
  and "Learn More" actions now show an error dialog on failure instead of
  silently doing nothing; a folder-watch start failure is now logged instead
  of dropped as an unhandled rejection; and the `folder:removeRecent` IPC
  handler now rejects on invalid input instead of resolving as a silent
  no-op
  ([`140c9e2`](https://github.com/coderoadpl/ai-video-cataloger/commit/140c9e20141108346115f728ab9e3658820a60c1)).

## [0.6.16] - 2026-08-03

### Fixed

- `scripts/release-walkthrough.mjs`'s `analyze` step now maps its outcome to
  the real result read from the driven UI (the `analysis-error-card` testid
  and `detail-layout`'s `data-video-status` attribute) instead of reporting
  `ok` whenever the run merely finished: `completed` with no error card is
  `ok` (naming the analyzed file), an error card is `failed`, and no analyzer
  configured is `skipped` with the UI's own disabled-reason text — a skip that
  is not in `TOLERATED_SKIPS`, so a `--strict` release run must provide a real
  analyzer (W54; the previous mapping left the completed-analysis half of the
  release checklist without evidence for four releases)
  ([`392efd5`](https://github.com/coderoadpl/ai-video-cataloger/commit/392efd54a3fecdc35a59e40957e753dfbbd699f6)).

### Added

- `pnpm run qa:walkthrough -- --analyzer local:<model>` seeds the scratch
  home's `config.json` with a real local analyzer (`analyzer_backend: local`,
  the given `local_model`, and no `analyzer_provider`) and `whisper_mode: skip`
  before launch, so the `analyze` step can complete offline against the system
  ollama with exactly the requested model; it fails fast, before the app
  launches, if ollama is unreachable or the model isn't installed, so a release
  run never silently falls back to the claude-CLI default
  ([`392efd5`](https://github.com/coderoadpl/ai-video-cataloger/commit/392efd54a3fecdc35a59e40957e753dfbbd699f6)).

## [0.6.15] - 2026-08-03

**Note:** this build was merged and tagged but its publication was blocked by
the independent reviewer; `v0.6.16` supersedes it. The tag stays unpublished
and this section stays as history.

### Fixed

- Photos and Library day-group section headers (`10 sierpnia 2026` / `10 August
  2026`) now render through a locale-aware formatter instead of the raw
  `YYYY-MM-DD` group key; the ISO string still drives grouping and sort order
  ([`d851c13`](https://github.com/coderoadpl/ai-video-cataloger/commit/d851c135b362987ccdc92cbc98199912f36c1fc6)).
- The Polish "failed previews" counter on the photos status strip now declines
  correctly for 1/2-4/5+ (`1 nieudany podgląd`, `3 nieudane podglądy`, `5
  nieudanych podglądów`) instead of always using the plural-many form; three
  more counters found in the same sweep (the map cluster label, the photo
  duplicate-copies badge and the large-folder-tree warning) had the same
  always-plural-many bug and were fixed the same way
  ([`d851c13`](https://github.com/coderoadpl/ai-video-cataloger/commit/d851c135b362987ccdc92cbc98199912f36c1fc6)).
- The "Wymagania" (Prerequisites) header button now uses the same neutral
  outlined style as "Ustawienia"/"Modele" instead of a bare text button
  ([`d851c13`](https://github.com/coderoadpl/ai-video-cataloger/commit/d851c135b362987ccdc92cbc98199912f36c1fc6)).
- `scripts/release-walkthrough.mjs`'s `open-folder` step now waits for the
  video list to settle before reading the row count, closing a race where the
  reported count could be stale relative to the captured screenshot
  ([`d851c13`](https://github.com/coderoadpl/ai-video-cataloger/commit/d851c135b362987ccdc92cbc98199912f36c1fc6)).

## [0.6.14] - 2026-08-03

**Note:** this build was merged and tagged but its publication was blocked by
the independent reviewer; `v0.6.15` supersedes it. The tag stays unpublished
and this section stays as history.

### Fixed

- Stored analysis error strings (including legacy pre-W50 messages that leak
  an absolute filesystem path) now render through a single renderer-side
  formatter at every error display site — catalog sidebar rows and tree, the
  details status card, the photos sidebar and grid, Library, Map, People,
  Settings, the model manager, the prerequisites modal, the absent-files
  section, the refresh toast and the root error fallback — instead of the raw
  string; known analyzer failure shapes map to a localized message (en/pl) and
  unknown strings pass through with any absolute path stripped, including
  quoted and parenthesised ones, while URLs are left intact
  ([`38ba860`](https://github.com/coderoadpl/ai-video-cataloger/commit/38ba86064c9fd2897dcffc23cc9b48ccee728cb4)).
- The Zdjęcia sidebar's scope toggle no longer clips "Wszystkie" behind an
  ellipsis at the narrow (260px) sidebar width; both the media and scope
  toggles now fit their full labels on one row
  ([`38ba860`](https://github.com/coderoadpl/ai-video-cataloger/commit/38ba86064c9fd2897dcffc23cc9b48ccee728cb4)).
- Photo capture dates and the absent-files "last seen" date now format using
  the active UI language's locale instead of English or the host locale, and
  the photo detail pane's "Data wykonania" field now formats the timestamp
  instead of showing the raw ISO string
  ([`38ba860`](https://github.com/coderoadpl/ai-video-cataloger/commit/38ba86064c9fd2897dcffc23cc9b48ccee728cb4)).
- The Library's no-match empty state no longer repeats the search query in
  both the title and the body sentence with inconsistent quote styles; the
  body now names only the active filter chips
  ([`38ba860`](https://github.com/coderoadpl/ai-video-cataloger/commit/38ba86064c9fd2897dcffc23cc9b48ccee728cb4)).
- A video that was never successfully analyzed no longer shows a competing
  "variants load error" card alongside its processing-failed card; the
  variant switcher now treats a not-yet-analyzed video as the empty state
  ([`38ba860`](https://github.com/coderoadpl/ai-video-cataloger/commit/38ba86064c9fd2897dcffc23cc9b48ccee728cb4)).
- The setup wizard's step labels ("Analizator" / "Transkrypcja") no longer
  touch each other in the stepper at the wizard's default width
  ([`38ba860`](https://github.com/coderoadpl/ai-video-cataloger/commit/38ba86064c9fd2897dcffc23cc9b48ccee728cb4)).
- `scripts/release-walkthrough.mjs` now runs every walkthrough against a
  scratch copy of `--fixtures` (never mutating the source) with a planted
  unloadable photo, so the release walkthrough exercises the broken-image
  placeholder; `docs/qa/release-walkthrough.md` gained matching checklist
  bullets for the broken-image placeholder and an unanalyzed video tile
  ([`38ba860`](https://github.com/coderoadpl/ai-video-cataloger/commit/38ba86064c9fd2897dcffc23cc9b48ccee728cb4)).
- `pnpm run qa:walkthrough`'s planted `broken-photo.jpg` now gets a year-2000
  mtime instead of a current one, so it no longer sorts first (newest) in the
  Analysis Photos sidebar and shadows the real fixtures; the `analysis-photos`
  step also now selects the first sidebar row without a `proxyFailed` badge
  instead of always clicking the first row, so `--strict` no longer fails on
  every run
  ([`c096a88`](https://github.com/coderoadpl/ai-video-cataloger/commit/c096a88dfef1670a2dd2a65093753e5ef2d9beff)).

## [0.6.13] - 2026-08-03

**Note:** this build was merged and tagged but its publication was blocked by
the independent reviewer; `v0.6.14` supersedes it. The tag stays unpublished
and this section stays as history.

### Fixed

- The photos grid tile now always renders as a square, cover-filled thumbnail
  (the duplicate/proxy-failed badges anchor to it correctly) instead of
  letterboxing an uncropped image inside the square slot whenever a
  512px grid thumbnail had not been generated yet
  ([`71d7fdd`](https://github.com/coderoadpl/ai-video-cataloger/commit/71d7fdd7353481f866df3d23708f6b8ee3ac1ebb)).
- A photo tile whose thumbnail image fails to load now falls back to the
  named `PlaceholderTile`, matching video thumbnail behavior, instead of
  showing the browser's native broken-image icon
  ([`71d7fdd`](https://github.com/coderoadpl/ai-video-cataloger/commit/71d7fdd7353481f866df3d23708f6b8ee3ac1ebb)).
- The Zdjęcia sidebar's scope toggle ("Ten folder" / "Wszystkie foldery")
  truncates its label with an ellipsis instead of wrapping onto extra lines
  at narrow sidebar widths
  ([`71d7fdd`](https://github.com/coderoadpl/ai-video-cataloger/commit/71d7fdd7353481f866df3d23708f6b8ee3ac1ebb)).
- The "Not analysed yet" photo notice, the "Could not load analysis variants"
  notice and the photos proxies-pending strip are now a neutral `Paper`
  section (matching the W45 video details idiom) instead of a tinted `Alert`,
  since all three are persistent state, not a one-off reaction to a user
  action
  ([`71d7fdd`](https://github.com/coderoadpl/ai-video-cataloger/commit/71d7fdd7353481f866df3d23708f6b8ee3ac1ebb)).
- A failed video no longer shows its "An error occurred during processing."
  status line twice — once as a bare caption, once inside the "Processing
  Failed" section — and that section no longer leaks the raw resolved
  command path (e.g. a temp shim directory) into the user-facing message;
  the full diagnostic (command, args, stderr) always goes to the terminal
  log instead. An analyzer command that cannot be spawned at all now reports
  the reason ("Command not found.", "Command is not executable.") instead of
  Node's raw `spawn <resolved path> ENOENT`
  ([`71d7fdd`](https://github.com/coderoadpl/ai-video-cataloger/commit/71d7fdd7353481f866df3d23708f6b8ee3ac1ebb)).
- `pnpm run qa:walkthrough --strict` no longer fails on the `first-run-wizard`
  and `library-preview` steps, which can legitimately skip on any prepared
  QA home reused across runs; every other skip still fails the run
  ([`71d7fdd`](https://github.com/coderoadpl/ai-video-cataloger/commit/71d7fdd7353481f866df3d23708f6b8ee3ac1ebb)).
- `pnpm run qa:walkthrough` now seeds the driven home's UI language to
  Polish before launch, so its screenshots show production Polish copy
  instead of the English fallback
  ([`71d7fdd`](https://github.com/coderoadpl/ai-video-cataloger/commit/71d7fdd7353481f866df3d23708f6b8ee3ac1ebb)).

## [0.6.12] - 2026-08-03

**Note:** this build was merged and tagged but its publication was blocked by
the independent reviewer; `v0.6.13` supersedes it. The tag stays unpublished
and this section stays as history.

### Added

- `pnpm run qa:walkthrough` gained an `--archive-to <dir>` flag that copies
  the finished screenshot set (`plan.json`, `manifest.json`, every PNG) to a
  directory outside the worktree before the process exits, so a release
  screenshot set survives a worktree cleanup
  ([`7025800`](https://github.com/coderoadpl/ai-video-cataloger/commit/7025800db605a7f1ad180fc71cb1f42b92aa3ded)).

### Changed

- `pnpm run visual` now joins `pnpm run check` (runs last) and its darwin
  baselines cover the `CatalogSidebar`/`PhotosSidebar` skeletons — including
  the `SidebarFolderPanel` split button — at a 260px stress width and the
  440px default width, in both themes
  ([`7025800`](https://github.com/coderoadpl/ai-video-cataloger/commit/7025800db605a7f1ad180fc71cb1f42b92aa3ded)).
- The release walkthrough procedure now requires an independent reviewer
  (never the agent that ran the walkthrough) to work the screenshot checklist
  against the archived set, with authority to fail the release
  ([`7025800`](https://github.com/coderoadpl/ai-video-cataloger/commit/7025800db605a7f1ad180fc71cb1f42b92aa3ded)).
- Entering Analysis → Zdjęcia for a folder that has never been photo-scanned
  now auto-starts the scan immediately, showing the normal scan progress in
  the sidebar, instead of gating on a "Skanuj ten folder" button click — the
  same always-on behavior Filmy already has. The scan fires once per folder
  per session; a folder with no photos lands on the honest "no photos here"
  sidebar state once the scan completes, and a scan that fails (unmounted
  drive, deleted folder) shows the error with a "Skanuj folder" retry action
  instead of an indexing caption that never ends
  ([`39e83dc`](https://github.com/coderoadpl/ai-video-cataloger/commit/39e83dcd8339a54cfedfbe2dd8cff5052db79c46)).
- The video details pane's primary analyze button reads just "Analizuj" (and
  drops the "Utworzy nowy wariant." helper line) when the file has zero
  analysis variants, instead of "Analizuj jako nowy wariant"; once at least
  one variant exists the button keeps its prior label and helper text
  ([`39e83dc`](https://github.com/coderoadpl/ai-video-cataloger/commit/39e83dcd8339a54cfedfbe2dd8cff5052db79c46)).
- The details pane's "Przetwarzanie nieukończone" and "Plik zduplikowany"
  notices are now plain `Paper` sections with a status-colored header icon
  instead of tinted `Alert` backgrounds, matching the rest of the pane; the
  duplicate notice's canonical path is a one-line monospace copy field with a
  copy button instead of a link, alongside a new "Przejdź do oryginału"
  button next to "Analizuj mimo to". The "Przetwarzanie..." resume button is
  now the same filled primary button (disabled with a spinner) as the
  pending-video analyze button, instead of a ghost outlined button that read
  as dead while disabled. The "Warianty analizy" section now hides itself
  entirely when a file has fewer than two variants (a single variant is not a
  choice), drops the "Ustaw bieżącą konfigurację jako domyślną folderu"
  button from the UI (the mechanism stays wired for a later parity decision),
  and shows the selected variant as a status badge instead of a plain filled
  chip. Outlined buttons app-wide now render with a neutral border/text
  instead of primary blue by default, so "blue outlined" is no longer a third
  button style alongside filled-primary and neutral-outlined
  ([`9121f10`](https://github.com/coderoadpl/ai-video-cataloger/commit/9121f1028728efef4e202d993e1a9793fb5c3e18)).

### Fixed

- FolderBar's split button (shared by both the video and photos sidebars)
  no longer renders with the "Otwórz folder" segment squeezed to a sliver
  and the `▾` dropdown segment stretched across the width; the main segment
  now grows to fill the available width and the dropdown stays a fixed
  narrow cap
  ([`0d8ed43`](https://github.com/coderoadpl/ai-video-cataloger/commit/0d8ed437db926263618b65f1c752e321ea1f4a00)).
- A photo-scanned folder with zero photos now shows the honest "no photos"
  empty state instead of a bare, unlabeled section header with nothing
  under it
  ([`f33e860`](https://github.com/coderoadpl/ai-video-cataloger/commit/f33e860d75600e02b999731acbb987c68bad853a)).
- The setup wizard's language step now seeds the output-language dropdown
  from the currently open folder's effective config instead of always
  reading the home-scope default, so it stops proposing English when the
  folder already has a different output language configured
  ([`f33e860`](https://github.com/coderoadpl/ai-video-cataloger/commit/f33e860d75600e02b999731acbb987c68bad853a)).
- Library tiles for an unavailable file no longer render dimmed relative to
  their siblings when the containing folder is also offline; every
  unavailable tile now gets the same full-opacity treatment as a plain
  offline-folder tile, with a single badge
  ([`f33e860`](https://github.com/coderoadpl/ai-video-cataloger/commit/f33e860d75600e02b999731acbb987c68bad853a)).
- Settings and the setup wizard now write every config key home-scoped
  (the W35b settings-flatten pass covered reads only; a save from either
  surface used to write folder-scoped for any key that wasn't one of the
  three app-global ones, silently creating a per-folder override the owner
  doctrine bans). Both surfaces still read folder-effective config, and
  saving a key that has an existing folder override for the open folder now
  also clears that override (a new `configUnset` contract action,
  `DELETE /api/config`), so the value just saved takes effect immediately
  instead of continuing to be shadowed. `config set --folder` in the CLI is
  unchanged and stays the only way to create a per-folder override
  ([`3db5ad8`](https://github.com/coderoadpl/ai-video-cataloger/commit/3db5ad88e354e5cc2115b715a0c451227a335a7c)).
- Grid thumbnails (`.grid.jpg`) now generate for every completed file, not
  only ones whose selected variant has a projected frames directory: the
  backfill pass, search/library "ensure" mode, and the post-analysis
  pipeline step all now try a projected frame, then a staged-but-unprojected
  frame from the artifact store, then a source-video seek, before giving up.
  Previously a completed native-Gemini variant (which never projects a
  frames directory) could never get a grid thumbnail and the library grid
  fell back to stretching the legacy 128x72 cover
  ([`67862fc`](https://github.com/coderoadpl/ai-video-cataloger/commit/67862fc462749022e641af0473c867a0d70cd874)).

## [0.6.11] - 2026-08-03

### Fixed

- Photo scan no longer indexes the app's own video-analysis artifact
  directories (`frames/`, `transcripts/`, `summaries/`, everywhere the
  artifact layout creates them — every dot-directory was already skipped).
  A scan also reconciles away any photo that was already indexed under one
  of these directories in a prior run, dropping the `photos.db` row instead
  of marking it merely missing
  ([`182aeef`](https://github.com/coderoadpl/ai-video-cataloger/commit/182aeef96f1ea2300c120229c7c2449b5447d01a)).
- The sidebar's recents dropdown (`▾` next to Otwórz folder) gained a
  "Wyczyść ostatnie" action at the bottom, restoring the clear-recents entry
  lost when W37b moved Open Folder into the sidebar; recent-folder paths are
  now also NFC-normalized before comparison/storage and deduplicated at
  render time, so two on-disk spellings of the same accented path no longer
  produce duplicate rows
  ([`182aeef`](https://github.com/coderoadpl/ai-video-cataloger/commit/182aeef96f1ea2300c120229c7c2449b5447d01a)).
- Both media sidebars are now condensed per the owner's layout: a full-width
  "Otwórz folder" button (with the recents split-button) leads, the folder
  identity block sits underneath it, and the medium toggle (Filmy/Zdjęcia)
  sits in one 50/50 row together with the scope toggle (Ten
  folder/Całe drzewo for videos, Ten folder/Wszystkie foldery for photos)
  ([`182aeef`](https://github.com/coderoadpl/ai-video-cataloger/commit/182aeef96f1ea2300c120229c7c2449b5447d01a)).
- The in-progress row of a whole-tree ("Całe drzewo") batch run now shows the
  analyzing spinner/label instead of the misleading "Nieukończony" badge —
  `analyzingPath` is now populated during a drive run from the per-file
  progress event's path, not only during a single-folder batch
  ([`182aeef`](https://github.com/coderoadpl/ai-video-cataloger/commit/182aeef96f1ea2300c120229c7c2449b5447d01a)).
- Clicking a duplicate video in the sidebar again opens its own detail view
  (own path/name/size, a "przejdź do oryginału" link to the canonical file,
  and a force re-analyze action) instead of jumping straight to the
  canonical's detail. Root cause: the video registry's stale-rename cleanup
  treated two simultaneously-existing files sharing a content hash (a real
  duplicate pair) the same as an old path superseded by a rename, deleting
  one entry from the registry; it now only drops an existing entry when that
  entry's own path is absent from the just-registered batch. The rename-follow
  effect was the second half of the jump: a duplicate living in a lazily
  loaded tree subfolder is absent from the tree query's payload, so the
  selection was re-pointed at the canonical file that shares its content hash;
  a selection still known to the video registry is now left alone
  ([`182aeef`](https://github.com/coderoadpl/ai-video-cataloger/commit/182aeef96f1ea2300c120229c7c2449b5447d01a)).

## [0.6.10] - 2026-08-03

### Added

- Library and Zdjęcia grid tiles now show a small bottom-right aspect-ratio
  indicator for portrait (`height > width`) and extreme panorama
  (`width / height >= 2.4`) sources; plain landscape and square tiles show
  nothing. `searchResultSchema` (and `collectionVideoItemSchema` with it)
  gains nullable `width`/`height`, backed by a new global-catalog schema
  version 13 (`files.width`/`files.height`, populated from the
  `MediaPort.probe` call `process` already makes); photo tiles already
  carried EXIF dimensions
  ([`aebb94c`](https://github.com/coderoadpl/ai-video-cataloger/commit/aebb94c7fed7ad97888471a83b508c0825beccc3)).
- The Library photos surface now triggers the existing (previously unwired)
  `photos grid-thumbs` backfill once per app session, background priority,
  the moment a photo root is visible — mirroring the video grid-thumbnail
  backfill trigger, so legacy/stale photo `.grid.jpg` thumbnails self-heal
  the same way stale video ones already did
  ([`aebb94c`](https://github.com/coderoadpl/ai-video-cataloger/commit/aebb94c7fed7ad97888471a83b508c0825beccc3)).

### Fixed

- `LibraryGrid`'s per-file "Brak pliku" chip no longer renders on top of an
  already-offline folder's own offline caption — a missing file inside an
  offline folder now shows exactly one missing-file label, not two
  ([`aebb94c`](https://github.com/coderoadpl/ai-video-cataloger/commit/aebb94c7fed7ad97888471a83b508c0825beccc3)).

## [0.6.9] - 2026-08-03

### Added

- Five new clicked-GUI end-to-end legs (`test:e2e:settings`, `test:e2e:photos`,
  `test:e2e:people`, `test:e2e:library`, `test:e2e:map`), each its own
  Playwright project outside `check`/`smoke`: the Settings modal round-trip
  (change, save, reopen to confirm persistence), the current-folder Photos
  surface (real folder open, scan, grid thumbnails, analyze affordance),
  People (real face-model artifacts, real indexing, rename via the card
  menu), Library (real analyze, same-session search, subtitled preview), and
  Map (honest empty state on a no-GPS home)
  ([`e1e841f`](https://github.com/coderoadpl/ai-video-cataloger/commit/e1e841f3e4ea50ea438ea7cf6e7094811aeff60b)).
- The Library search filters gain a Folder facet, alongside Tagi/Osoby/
  Miejsce/daty/GPS: a folder autocomplete with per-folder match counts from
  the same facets endpoint the other filters use, a removable "Folder: …"
  chip, and combinable with the text query and every other filter
  (`FilterBar`, `library/core/filter-state.ts`'s pre-existing `folderId`
  filter and chip plumbing). No contract change: `searchInputSchema` already
  accepted `folderId`
  ([`e1ec765`](https://github.com/coderoadpl/ai-video-cataloger/commit/e1ec765b00eb50aef37547d27977dd63e6264b41)).
- The server composition edge (`apps/server/src/app.ts`) now registers a
  Hono `onError` handler: a route handler that throws an unmodelled error
  returns the standard `{ ok: false, error }` contract envelope (`internal`,
  HTTP 500) instead of Hono's bare-text default response
  ([`7b41ab1`](https://github.com/coderoadpl/ai-video-cataloger/commit/7b41ab112ca2f00497695d5cd112aa294fd020bf)).
- `scripts/doc-lint.ts` fails `check` if any new list-route input schema in
  `core/contract/routes.ts` adds an `offset` field without being named in a
  reviewed ADR-0003 deviation list; `searchInputSchema`,
  `photosListInputSchema` and `photosSearchInputSchema` are the three named,
  documented exceptions (see the ADR-0003 addendum)
  ([`7b41ab1`](https://github.com/coderoadpl/ai-video-cataloger/commit/7b41ab112ca2f00497695d5cd112aa294fd020bf)).
- New renderer lint rules: `window.localStorage`/`window.sessionStorage`
  member access is banned outside `apps/web/src/lib/persistent-storage.ts`
  (the designated persistence helper) and a dated list of pre-existing call
  sites; bare `process`/`ipcRenderer` globals are banned across the renderer.
  `test/**` is now linted (`any` banned everywhere; `as`-casts on parsed CLI
  NDJSON payloads allowed under a dated exception scoped to `test/cli`)
  ([`7b41ab1`](https://github.com/coderoadpl/ai-video-cataloger/commit/7b41ab112ca2f00497695d5cd112aa294fd020bf)).
- `FOUNDATION.md` records the upstream agentproofarch fork point and points
  to `docs/architecture.md` for the delta
  ([`7b41ab1`](https://github.com/coderoadpl/ai-video-cataloger/commit/7b41ab112ca2f00497695d5cd112aa294fd020bf)).

### Removed

- Every "Pokaż w Bibliotece"/"Show in Library" button and context-menu item
  is gone — the Analysis sidebar folder header (both the video and photos
  sidebars), the video tile right-click menu, and the video details
  metadata card no longer offer it; folder-scoped Library navigation is now
  done through the new Folder search facet instead. `deriveLibrarySeed` and
  its `LibrarySeed` `'folder'` seed kind, the only remaining callers of that
  removed affordance, are deleted as dead plumbing
  ([`e1ec765`](https://github.com/coderoadpl/ai-video-cataloger/commit/e1ec765b00eb50aef37547d27977dd63e6264b41)).

### Changed

- `vitest.config.ts` coverage thresholds (the `check` ratchet floor) raised
  to the currently measured levels: statements/lines 86%, branches 83%,
  functions 81%
  ([`7b41ab1`](https://github.com/coderoadpl/ai-video-cataloger/commit/7b41ab112ca2f00497695d5cd112aa294fd020bf)).
- The Analysis sidebar now reflects the real hierarchy top to bottom: the
  folder identity block (name, path and Open Folder with its recent-folders
  menu) sits at the top of the sidebar, above the
  Filmy/Zdjęcia medium toggle, above the existing "Ten folder"/"Całe drzewo"
  scope toggle and its content. Both moved out of the top bar, which now only
  carries app identity, the Biblioteka/Analiza switcher and Settings/Models/
  Prerequisites. The two media sidebars share one folder-identity component
  (`SidebarFolderPanel`) instead of duplicating that markup
  ([`92cbbf0`](https://github.com/coderoadpl/ai-video-cataloger/commit/92cbbf04caea968503304cbacad569b4e1cfaeb9)).
- Every accordion/chevron in the details and analysis panes is gone —
  including "Pełna analiza AI" — in favor of plain, always-expanded sections;
  the pane scrolls instead
  ([`92cbbf0`](https://github.com/coderoadpl/ai-video-cataloger/commit/92cbbf04caea968503304cbacad569b4e1cfaeb9)).

### Fixed

- `GET /api/scan` no longer creates `{folder}/.ai-video-cataloger/catalog.db`
  for a folder it only reads: the read path now opens the legacy per-folder
  catalog only if it already exists (`CatalogRepositoryFactory.openIfExists`),
  while the write flows (process/process-drive/status/reset) still create it
  as before. The folder-identity marker write on a first scan is unchanged
  ([`7b41ab1`](https://github.com/coderoadpl/ai-video-cataloger/commit/7b41ab112ca2f00497695d5cd112aa294fd020bf)).
- Silent-failure fixes across desktop and web: `folder:setCurrent` now returns
  an explicit ok/error result instead of resolving silently on an invalid path
  (surfaced via the folder-error snackbar); the wizard's language step, the
  shell's folder picker/clear-recent actions, and an Analyze click during a
  running batch no longer swallow failures — each now surfaces an inline error
  or terminal notice instead of a silent no-op; model download/activate/delete,
  forgetting an absent file, photo scan/analyze/proxy jobs, photo variant
  selection, and the faces index job now surface an inline error alongside the
  terminal log instead of terminal-only; the photo Analyze action disables with
  a reason instead of no-op when the target folder hasn't been scanned; the
  folder-error snackbar no longer dismisses on an outside click (autoHides
  after 8s or an explicit dismiss); and "Clear Recent" in the folder menu no
  longer wipes the currently open folder, only the recent-folders list
  ([`6a916e1`](https://github.com/coderoadpl/ai-video-cataloger/commit/6a916e1cd12f5effa031f5c5f3deb84e0911c754)).
- Library tiles, the folder-group header and the browse preview now say
  "file missing"/"brak pliku" instead of "drive not connected"/"dysk
  niepodłączony" when a catalogued folder was deleted while its drive stayed
  mounted (the "avc-bench ghosts" case) — a new `offlineReason` field on the
  `search`/`collection` contract's folder shape, backed by a pure classifier
  that checks whether the folder's `/Volumes/<name>` root still exists,
  distinguishes it from an actually-unmounted drive
  ([`8dfadb2`](https://github.com/coderoadpl/ai-video-cataloger/commit/8dfadb2c87930e177e1a89e29b93858d64582841)).
- Settings gives real editors back to transcription language, the Whisper
  API base URL and model, and the analyzer timeout instead of the flat
  read-only list the settings-flatten pass left them in; the read-only list
  itself is gone since every effective value now has an editor. A language
  set to a BCP-47 code outside `auto`/`en`/`pl` stays visible and selected in
  the language selects instead of rendering blank
  ([`9b41138`](https://github.com/coderoadpl/ai-video-cataloger/commit/9b411383b5498df022a6e47388707e18435efb17)).
- Frame extraction now clears stale `frame-NNN.jpg` files left by a previous,
  larger extraction before writing new ones, and the frames gallery only
  lists canonical, non-empty frame files, so a video re-analyzed with fewer
  frames no longer shows leftover or broken thumbnails from an earlier run
  ([`9b41138`](https://github.com/coderoadpl/ai-video-cataloger/commit/9b411383b5498df022a6e47388707e18435efb17)).

## [0.6.8] - 2026-08-02

### Added

- A person card opens the Library filtered to that person, from the card
  itself and from its actions menu.
  ([`878585f`](https://github.com/coderoadpl/ai-video-cataloger/commit/878585f55a66991cc456e7042d6d39a6109153bc)).

### Fixed

- Opening or scanning a folder no longer reports the app's own nested catalog
  databases as foreign; scanning now writes the folder identity marker that
  only analysis wrote before.
  ([`c3bc987`](https://github.com/coderoadpl/ai-video-cataloger/commit/c3bc98778610d456dfb8d4c92b9523151fd99d54)).
- Whole-tree analysis now refreshes the sidebar tree and the details pane
  after every finished file, and the selected file follows its analysis
  rename instead of showing a stale "not tracked" state.
  ([`c3bc987`](https://github.com/coderoadpl/ai-video-cataloger/commit/c3bc98778610d456dfb8d4c92b9523151fd99d54)).
- Transcript subtitles render again in the analysis player (the packaged
  content-security policy blocked the `data:` track); the player now builds
  the subtitle track as a `blob:` object URL instead.
  ([`c3bc987`](https://github.com/coderoadpl/ai-video-cataloger/commit/c3bc98778610d456dfb8d4c92b9523151fd99d54)).
- Library preview now plays catalogued videos that live outside the currently
  open folder; `media://` video resolution previously ignored the extra
  catalog-folder roots that image resolution already honored.
  ([`c3bc987`](https://github.com/coderoadpl/ai-video-cataloger/commit/c3bc98778610d456dfb8d4c92b9523151fd99d54)).
- Library preview now renders subtitles (the player had no text track at
  all) and letterboxes a portrait 9:16 source correctly instead of showing a
  square-cropped poster; `GET /api/library/preview` gains
  `transcriptSegments`/`width`/`height`/`rotation` for the currently online
  tile.
  ([`1b736e8`](https://github.com/coderoadpl/ai-video-cataloger/commit/1b736e8802bfb01e0edfd2fa547576c302ed8eb8)).
- The existing-thumbnails backfill that regenerates blurry old Library grid
  tiles now runs once per session for every distinct folder that actually
  contributed a visible tile to the Kolekcja grid, not only for whichever
  folder happened to be open in Analysis; a Library session with tiles from
  several catalogued folders previously left every folder but the open one
  blurry.
  ([`1b736e8`](https://github.com/coderoadpl/ai-video-cataloger/commit/1b736e8802bfb01e0edfd2fa547576c302ed8eb8)).

### Changed

- The Filmy/Zdjęcia toggle keeps the current folder — the photos surface now
  scopes to the open folder and offers to scan it, instead of keeping its own
  list of photo roots. Refines the `[0.6.7]` Open Folder behaviour: opening a
  folder while Zdjęcia is active now stays on Zdjęcia and re-scopes to the new
  folder, instead of forcing Filmy. The "Wszystkie foldery" scope still browses
  every scanned photo root, including from a folder that was never scanned for
  photos.
  ([`c3bc987`](https://github.com/coderoadpl/ai-video-cataloger/commit/c3bc98778610d456dfb8d4c92b9523151fd99d54)).
- `pnpm run qa:walkthrough` gained `--strict`, which exits 1 on any `skipped`
  step (release runs now use it); the walkthrough's `open-folder`, `settings`
  and `wizard` steps now drive the real Open Folder button and header Settings
  control instead of seeding `folder-store.json` or sending synthetic
  `menu:showSettings`/`menu:showSetupWizard` events, and the GUI e2e drivers
  (`test/e2e/drivers/gui-driver.ts`, `drive-matrix.spec.ts`, `matrix.spec.ts`)
  likewise pick folders via a stubbed native dialog and a real Open Folder
  click, and configure the whisper mode through the real Settings modal
  instead of shelling `avc config set`.
  ([`44ac9bc`](https://github.com/coderoadpl/ai-video-cataloger/commit/44ac9bc97e62e2149659f289abd57e607756c30c)).
- The tree "previously catalogued, now absent" section is hidden when empty;
  the full AI analysis panel opens by default and shows an expand
  affordance.
  ([`878585f`](https://github.com/coderoadpl/ai-video-cataloger/commit/878585f55a66991cc456e7042d6d39a6109153bc)).
- Library tiles for offline or missing files now open the preview instead of
  doing nothing on click.
  ([`878585f`](https://github.com/coderoadpl/ai-video-cataloger/commit/878585f55a66991cc456e7042d6d39a6109153bc)).
- Sub-folder sidebar thumbnails visible in the current scroll window are now
  generated as promptly as root-level ones, and existing low-resolution
  Library grid thumbnails are regenerated once per folder per session instead
  of staying blurry forever.
  ([`878585f`](https://github.com/coderoadpl/ai-video-cataloger/commit/878585f55a66991cc456e7042d6d39a6109153bc)).
- Settings shows one flat set of effective values with no inheritance
  vocabulary, and the analyzer model / reasoning-effort selects show their
  default instead of rendering blank.
  ([`878585f`](https://github.com/coderoadpl/ai-video-cataloger/commit/878585f55a66991cc456e7042d6d39a6109153bc)).
- Re-running the setup wizard starts from the current settings instead of
  defaults, and the local analyzer is no longer labelled recommended.
  ([`878585f`](https://github.com/coderoadpl/ai-video-cataloger/commit/878585f55a66991cc456e7042d6d39a6109153bc)).

## [0.6.7] - 2026-08-02

### Fixed

- Open Folder now always switches the analysis view to Videos and shows the
  newly picked folder, even when the app was last left on Analysis > Photos or
  in Library mode; previously the folder store updated silently while the UI
  stayed on the old photos sidebar. `pnpm run test:e2e:open-folder` drives the
  real header button through a packaged-style Electron launch to cover this
  ([`bdddcaa`](https://github.com/coderoadpl/ai-video-cataloger/commit/bdddcaa392d5a387f3bfb727f5cbfe572f5af85e)).

## [0.6.6] - 2026-08-02

### Added

- `pnpm run promote-home -- --source <homeDirectory> [--target <homeDirectory>]
  [--dry-run] [--yes]` promotes a catalog home (e.g. a batch run's
  `.ai-video-cataloger/`) into the real app home: backs up the existing home to
  a timestamped sibling first (never deletes it), carries over the existing
  home's `photos.db` verbatim when the source has none, refuses when both have
  one, refuses to re-promote an already-promoted identical source, and keeps
  every target entry the source does not provide (`credentials.json`,
  `photo-artifacts/`, `models/`, …) while naming in the plan what the source
  overwrites. See
  [docs/qa/consolidation-runbook.md](docs/qa/consolidation-runbook.md)
  ([`17e07a0`](https://github.com/coderoadpl/ai-video-cataloger/commit/17e07a04805d9345836d02f58b54b5936830a4fa)).
- `GET /api/library/preview?fingerprint=` returns file size, duration, the selected variant's transcript and the observed people for a video, backing a read-only Library preview info panel that now shows everything the Analysis details view shows (transcript, description, tags, place, coordinates, capturedAt, file name/path, duration/size, people) for the selected variant, with no variant picker. `GlobalCatalogStore` gains `listPeopleForFile`
  ([`6885607`](https://github.com/coderoadpl/ai-video-cataloger/commit/68856076489cc8b12ca1362ccb9e7b03cbb55960)).

### Fixed

- Grid-thumbnail generation is now resolution-and-provenance aware: it never treats the small 128x72 cover (or any source below the 512px grid floor) as an acceptable source, prefers the stored analysis frame, falls back to a source-video/original-photo seek when the drive is reachable and the frame is degraded, and otherwise removes a stale `.grid.jpg` rather than upscale it. An already-generated grid thumb is regenerated once a better source becomes reachable, even without `--force`.
- Library and photo tiles render the small cover `contain` (honestly small, letterboxed) when no grid thumbnail exists, instead of crop-upscaling a 128px cover into the 168px tile, and a search row no longer reports a `gridThumbnailPath` for a grid thumb that was not produced
  ([`6885607`](https://github.com/coderoadpl/ai-video-cataloger/commit/68856076489cc8b12ca1362ccb9e7b03cbb55960)).

## [0.6.5] - 2026-08-02

### Added

- `photos import-libra <artifacts-dir> --manifest <path> [--dry-run]` CLI command and `POST
  /api/photos/import-libra` route one-shot import descriptions, faces (shared `catalog.db`
  pool, unassigned) and timeline-sourced GPS from a PHOTO LIBRA session into the photos
  catalog without re-paying analysis, joining artifacts to already-scanned photos by manifest
  path/md5 and never guessing an unmatched entry. Imported descriptions land as a new `family:
  'imported'` photo config descriptor (`providerId: 'photo-libra'`) that can never collide with
  or outrank a live analyzer variant
  ([`0184dcb`](https://github.com/coderoadpl/ai-video-cataloger/commit/0184dcb229c852339d87c870ba9ba76fcdcef737)).

### Fixed

- Photo analysis toolbar progress no longer freezes at "Analizowanie 0 z 0…": the caption is now derived from the same `photo_process` job event stream as the detail-pane banner, instead of a static label captured once when the job started. The total is seeded from the `photo-analysis-scanning` candidate count, so the caption reads the real candidate total while the first analyzer batch is still running, and it is cleared when the job settles so a later scan or proxy job no longer inherits the finished analyze count.
- Photo analysis sidebar rows now show a per-photo in-flight spinner while their fingerprint is part of the batch currently being sent to the analyzer (new `photo-analysis-batch-started` job progress step), and the photo list/status refresh incrementally as each photo completes or fails, instead of only once when the whole job finishes.
- Photo analysis gains a cancel action (mirroring video processing's cancel-with-confirmation flow) wired to the same `POST /api/jobs/cancel` job-cancel path. A cancelled photo job is logged as a user cancellation instead of "unknown error"
  ([`2cbd0e1`](https://github.com/coderoadpl/ai-video-cataloger/commit/2cbd0e17f9e3cf9bbfa181a78de365297f4c78e5)).

## [0.6.4] - 2026-08-02

### Added

- Versioning policy: the patch version is bumped with practically every merged
  PR (at minimum every wave); no two differing builds may ever share a version
  string. See [docs/qa/release-readiness.md](docs/qa/release-readiness.md)
  ([`6bdbcd2`](https://github.com/coderoadpl/ai-video-cataloger/commit/6bdbcd2)).
- `GET /api/library/collection` merges videos and photos into one paged, filterable, sortable feed (composite-offset cursor, `media: all|video|photo`, honest positional cross-media relevance and video-only-filter semantics documented in `docs/architecture.md`); wired through `core/client/queries.ts` (`libraryCollectionQuery`) and `apps/web/src/api.ts` (`actions.libraryCollection`). `PhotosStore` gains a SQL-pushed, variant-aware `collectionPage` method
  ([`c4e9970`](https://github.com/coderoadpl/ai-video-cataloger/commit/c4e9970)).
- Video processing and the `thumbnails` backfill pass now also generate a second, ~512px square, center-cropped "grid" thumbnail (`<base>.grid.jpg` sibling of the existing 128x72 thumbnail) from the stored analysis frame only, never the source file; `search` and `/api/search` results gain a `gridThumbnailPath` field (existence-only unless a frame is already stored). The `thumbnails` pass summary gains `gridGenerated`/`gridSkipped`/`gridFailed` counters
  ([`c4e9970`](https://github.com/coderoadpl/ai-video-cataloger/commit/c4e9970)).
- Photo proxies now also generate a grid thumbnail sibling (`thumbs/<fingerprint>.grid.jpg`) from the freshly written proxy; `photosList`/`photosDetail`/`photosSearch` gain a `gridThumbPath` field, and the proxies pass summary gains a `gridFailed` counter. A new `photos grid-thumbs` CLI command and `POST /api/photos/grid-thumbs` route backfill grid thumbnails for every existing proxy
  ([`c4e9970`](https://github.com/coderoadpl/ai-video-cataloger/commit/c4e9970)).
- Browse preview: clicking a Library tile or a map video pin opens a selected-variant preview (player, description, tags, place, capture date) with a discreet "Open in Analysis" escape hatch
  ([`9439c96`](https://github.com/coderoadpl/ai-video-cataloger/commit/9439c96)).
- `photos gps backfill <timeline.json>` and `POST /api/photos/gps/backfill` match photo capture times against a Google Timeline export using the same matcher and precedence rules as the video backfill, resolve places offline through the shared places dataset, and push resolved place text into the photo search index (a photo's place is now searchable in the Photos tab). Rows whose capture time rests on an assumed timezone (`exif_local_assumed`/`file_mtime`) match with a tolerance widened to at least 180 minutes; the summary reports how many matches relied on that widening
  ([`da13229`](https://github.com/coderoadpl/ai-video-cataloger/commit/da13229)).
- The map now plots photo pins alongside video pins on the same canvas, with an All/Videos/Photos filter and honest per-media coverage captions ("N of M catalogued photos have location"); clicking a photo pin opens it in the Photos tab. `GET /api/catalog/locations` gains `totalPhotos`/`locatedPhotos` and a `media` marker per location; existing video-only consumers are unaffected (the video counts keep their prior meaning, and old envelopes without the new fields still parse)
  ([`da13229`](https://github.com/coderoadpl/ai-video-cataloger/commit/da13229)).
- The Photos grid pages beyond its first 200 photos with a "Load more" control,
  so a large library is fully browsable instead of silently truncated
  ([`32fee09`](https://github.com/coderoadpl/ai-video-cataloger/commit/32fee09)).
- The photos database gains schema version 2 (indexes on `photos.current_path`
  and `(proxy_state, current_path)`), migrated in place on open
  ([`0154152`](https://github.com/coderoadpl/ai-video-cataloger/commit/0154152)).
- `pnpm run test:e2e:matrix` gains three photo legs: `photos-real-decode`
  (scan → real `sips` proxy/thumb decode → status → search), `photos-local-analysis`
  (a real local analyzer over the generated proxies) and the opt-in
  `photos-raw-sample` (`E2E_PHOTOS_SAMPLE_RAW`)
  ([`75149c0`](https://github.com/coderoadpl/ai-video-cataloger/commit/75149c0)).
- `pnpm run qa:walkthrough` captures three photo steps — `photos-tab`,
  `photos-grid`, `photo-detail` — and skips them with a named reason when the
  QA home has no catalogued photos
  ([`75149c0`](https://github.com/coderoadpl/ai-video-cataloger/commit/75149c0)).
- [docs/qa/release-readiness.md](docs/qa/release-readiness.md) records the
  ordered pre-release pass (gates → e2e → packaged app → docs → real-data sanity)
  ([`75149c0`](https://github.com/coderoadpl/ai-video-cataloger/commit/75149c0)).
- `photos status` reports a new `facesIndexed` count (foundational plumbing for photo faces indexing landing in a follow-up wave); the underlying `FaceObservation` record and its storage now carry a `media: 'video' | 'photo'` marker so photo-sourced face observations can share the same people pool as video ones
  ([`3a9de31`](https://github.com/coderoadpl/ai-video-cataloger/commit/3a9de31)).
- Photo search: `avc photos search "<query>"`, `/api/photos/search` and a search
  box in the Photos tab query file names, descriptions, tags and places over the
  photos index; file-name search works before any analysis has run
  ([`1685437`](https://github.com/coderoadpl/ai-video-cataloger/commit/1685437)).
- Photo analysis variants are inspectable and selectable: `avc photos variants
  list|select|delete|folder-default`, `/api/photos/variants*`, and a variant
  picker with description, scene/quality and tag chips in the Photos detail pane;
  the search index always follows the resolved selection
  ([`1685437`](https://github.com/coderoadpl/ai-video-cataloger/commit/1685437)).
- Photo cataloging foundations: `avc photos scan|status|forget` and `/api/photos/scan|status|forget` index photos (jpg/jpeg/png/heic/arw/dng) into a new `~/.ai-video-cataloger/photos.db` by full-content `ph_` fingerprint, with EXIF capture time/camera/GPS extraction at scan and a cancellable, batch-resumable `photo_scan` job
  ([`bd946d5`](https://github.com/coderoadpl/ai-video-cataloger/commit/bd946d5)).
- A Map view plots every catalogued video that carries GPS coordinates on an offline basemap, clustering nearby pins and opening the video from a pin; it always states its coverage ("110 of 3752 catalogued files have location") and shows an explicit empty state when no file carries GPS. The map downloads nothing: no map tiles are ever requested, and the geographic outline ships with the app
  ([`27f2cb1`](https://github.com/coderoadpl/ai-video-cataloger/commit/27f2cb1)).
- `GET /api/catalog/locations` returns every catalog file that carries GPS coordinates together with the catalog-wide file total, so a client can state its own coverage honestly
  ([`27f2cb1`](https://github.com/coderoadpl/ai-video-cataloger/commit/27f2cb1)).
- The video details panel shows the recorded coordinates of a catalogued file and a jump-to-map action
  ([`27f2cb1`](https://github.com/coderoadpl/ai-video-cataloger/commit/27f2cb1)).
- `faces recluster [--dry-run]` rebuilds every person and every face assignment from the embeddings already stored in the catalog — no frame extraction, no detector and no `FACE_ENGINE_VERSION` bump — reporting people before/after, observations that changed owner, owner-set names carried or dropped, and people left without an exemplar; `--dry-run` computes the same report and writes nothing
  ([`3ce711d`](https://github.com/coderoadpl/ai-video-cataloger/commit/3ce711d)).
- `thumbnails <root>` generates every missing catalog thumbnail under a folder tree by downscaling the analysis frame the selected variant already stored — no source video is opened, so it works on an index-only mirror of a read-only mount — reporting `thumbnails_scanning`/`thumbnails_file`/`thumbnails_done` NDJSON events and `generated`/`skipped`/`fromFrame`/`fromSource`/`failed` counts with per-file `failures`; a second run is a no-op and `--force` regenerates everything
  ([`01a70d2`](https://github.com/coderoadpl/ai-video-cataloger/commit/01a70d2)).
- `process` and `process-drive` write each completed file's thumbnail during the run (one downscale of the frame already on disk), so a finished drive run leaves a catalog with covers instead of generating them lazily on first display; on a read-only source the cover lands in the home mirror and the source tree stays untouched
  ([`01a70d2`](https://github.com/coderoadpl/ai-video-cataloger/commit/01a70d2)).
- Terminal panel gains a persisted Raw mode that shows each log line's attached raw job payload and interleaves a capped (500-entry) ring buffer of every renderer→server request/response, captured once at the `apps/web/src/api.ts` fetch seam
  ([`c09af23`](https://github.com/coderoadpl/ai-video-cataloger/commit/c09af23)).
- Tag language is now configurable (`tag_language`, folder- or home-scoped): tags are generated in that language regardless of the language spoken in the clip. Unset, it follows `output_language`. The analyzer prompt also demands ASCII transliteration, so pinned non-English tags stay kebab-case
  ([`83ed0f8`](https://github.com/coderoadpl/ai-video-cataloger/commit/83ed0f8)).
- `tags suggest-aliases [--json]` proposes tag merges from the existing catalog — normalisation (diacritics, case, separators), English and Polish plurals, a curated Polish irregular lexicon, and single-character spelling variants (`fiord`/`fjord`) — with file counts and a rule label per proposal; it never writes, and each proposal is applied by hand with `tags alias <from> <to>`
  ([`8f377b7`](https://github.com/coderoadpl/ai-video-cataloger/commit/8f377b7)).
- Catalogued coordinates now record where they came from — `camera`, `timeline` or `manual` — together with an accuracy in metres and, for a timeline-sourced fix, which interval kind (`visit`/`activity`/`path`) produced it; a probe that finds no GPS no longer erases a coordinate already stored for that file
  ([`950d513`](https://github.com/coderoadpl/ai-video-cataloger/commit/950d513)).
- `search_documents` gains a `place` column (rebuilt into the full-text index on upgrade), so a resolved place name is searchable and ranks between tags and the final name; nothing populates it yet in this wave
  ([`950d513`](https://github.com/coderoadpl/ai-video-cataloger/commit/950d513)).
- Media probing extracts the container's `creation_time` (`MediaProbe.createdAtUtc`), normalised to UTC, and a processed file records it as its capture instant (`captured_at`, source `container`) — the matching key for a Google Timeline GPS backfill, never the filename's local clock
  ([`950d513`](https://github.com/coderoadpl/ai-video-cataloger/commit/950d513)).
- `faces exemplars [--dry-run] [--limit <n>]` fills missing face photographs by decoding each missing observation's own frame, re-detecting it against the stored box and cutting the crop — a repair pass for catalogs indexed before crops became per-observation, reporting planned/written crops, unreachable files, detections that no longer match, and people still without a photograph
  ([`aad0d0c`](https://github.com/coderoadpl/ai-video-cataloger/commit/aad0d0c)).
- `gps backfill <timeline.json> [--root <path>] [--dry-run] [--tolerance-minutes 30] [--max-visit-hours 36] [--reresolve-places]` fills empty catalog coordinates from a Google Timeline export, matching each file's UTC `captured_at` against the export's `visit`/`activity`/`timelinePath` intervals; camera- and manually-sourced rows are never touched, a second run is a no-op, and `--dry-run` computes and reports every count (matches by interval kind, an accuracy bucket histogram, place resolution) without writing
  ([`8bb6231`](https://github.com/coderoadpl/ai-video-cataloger/commit/8bb6231)).
- The map's pin popover and the video details panel now draw a measured location (camera GPS) differently from an approximate one (timeline fix): a hollow pin with an accuracy halo sized to its `gps_accuracy_m`, plus a `Measured (camera)` / `Approximate (…) ±m` badge and, where resolved, a place line — never a single pin style for both
  ([`8bb6231`](https://github.com/coderoadpl/ai-video-cataloger/commit/8bb6231)).
- The offline place resolver (`PlacesPort` / `GeoNamesPlacesAdapter`) resolves the nearest settlement, region and country for a coordinate from a versioned, self-generated GeoNames snapshot with no network call; the production dataset itself is not yet published, so every backfill run currently reports `places.skippedNoDataset` for every row until that follow-up ships (ADR-0015)
  ([`8bb6231`](https://github.com/coderoadpl/ai-video-cataloger/commit/8bb6231)).
- Photo proxies and thumbnails: `avc photos proxies <root> [--force]` and `/api/photos/proxies` generate a ≤1280px JPEG proxy and ≤320px thumbnail per photo fingerprint under `~/.ai-video-cataloger/photo-artifacts/` — RAW (ARW/DNG) via embedded-preview extraction with a full-decode sips fallback, never writing inside the photo folder; `photos scan` chains the pass automatically, an artifact that has gone missing from disk is regenerated on the next pass without `--force`, and per-file failures are reported, never fatal
  ([`c013901`](https://github.com/coderoadpl/ai-video-cataloger/commit/c013901)).
- `/api/photos/tree|list|detail` expose scanned roots, paged photo listings and per-photo detail to clients
  ([`c013901`](https://github.com/coderoadpl/ai-video-cataloger/commit/c013901)).
- A Photos tab browses the photo catalog: a root picker over scanned folders, a windowed thumbnail grid grouped by capture day with duplicate and missing badges, a proxy-based viewer with keyboard arrow navigation, and a detail pane showing EXIF basics, capture provenance and every path a photo was sighted at
  ([`c013901`](https://github.com/coderoadpl/ai-video-cataloger/commit/c013901)).
- Photo vision analysis: `avc photos process <root> [--force] [--batch-size N]`
  and `/api/photos/process` run description, tags, scene and quality over photo
  proxies through the configured analyzer (api / harness / local / gemini-native),
  batching ~12 photos per call with an automatic 12→6→1 split on malformed
  responses; results are variants keyed by a photo `cfg_` config id, and each
  row records the actual batch size that produced it
  ([`6128c50`](https://github.com/coderoadpl/ai-video-cataloger/commit/6128c50)).
- Photo analysis runs honour the monthly `gemini_monthly_budget_usd` cap with
  the same pause-and-resume semantics as drive runs; `photos status` counts
  analysed photos
  ([`6128c50`](https://github.com/coderoadpl/ai-video-cataloger/commit/6128c50)).
- `GET /api/search` and `search` (client/CLI) accept an optional `query` alongside structured filters — `tags` (AND, alias-expanded), `people` (OR, by id), `place` (substring), `from`/`to` (captured-at range), `hasGps`, `folderId` — plus `sort` (`relevance`/`captured_desc`/`captured_asc`/`name_asc`) and `thumbnails` (`ensure`/`existing`); the response gains a `total` reflecting the full filtered match count, independent of the returned page. The CLI gains repeatable `--tag`/`--person` and the matching `--place`/`--from`/`--to`/`--has-gps`/`--no-has-gps`/`--folder`/`--sort` flags, with person names resolved against `faces people` and unknown folders/names reported as validation errors
  ([`17df854`](https://github.com/coderoadpl/ai-video-cataloger/commit/17df854)).
- `media://` now also admits the `.ai-video-cataloger` sidecar directory of every catalogued folder (not only the currently open one and its read-only mirror), so a Library or search thumbnail generated for a folder that isn't the open one resolves instead of rendering blank; the sidecar's video-extension files stay unreachable through this root
  ([`17df854`](https://github.com/coderoadpl/ai-video-cataloger/commit/17df854)).
- A Library tab browses every catalogued video regardless of folder: a debounced search box over a virtualized, date-grouped grid (existing thumbnails only, never generated on demand), with an honest empty-catalog state distinct from a no-match state and a "Load more" page sentinel; opening a tile reuses the existing search-result folder-open path
  ([`17df854`](https://github.com/coderoadpl/ai-video-cataloger/commit/17df854)).
- `GET /api/library/facets` computes whole-catalog tag, person, place, capture-year and folder facets (plus GPS/capture-date/missing/offline-folder counts) server-side over the same selected-variant SQL join as search and locations, so a client can render filter options without loading a page and pretending it knows the whole catalog
  ([`637c8b3`](https://github.com/coderoadpl/ai-video-cataloger/commit/637c8b3)).
- The Library tab gains an always-visible filter bar (tag/person/place/date-range/has-GPS chips, an honest `{shown} of {total}` count, and a no-match message that names every active filter) plus a date/folder grouping toggle with a sort control, so a browse can be scoped without leaving Library
  ([`637c8b3`](https://github.com/coderoadpl/ai-video-cataloger/commit/637c8b3)).
- "Show in Library" now works in both directions: a Library tile's context menu opens its folder/processing context (open in folder view, reveal in Finder, copy path), and the current folder header, a Videos-list row, and the details panel's location row each gain a "Show in Library" action that scopes Library to that folder (removable chip) and, for a specific file, scrolls the grid to it
  ([`637c8b3`](https://github.com/coderoadpl/ai-video-cataloger/commit/637c8b3)).
- Library becomes the default view on launch once the catalog holds at least one file (an empty catalog still opens on Videos); the last active view is persisted and always wins over that default. `ViewNav` now orders Library directly after Videos
  ([`637c8b3`](https://github.com/coderoadpl/ai-video-cataloger/commit/637c8b3)).
- "Pokaż w Bibliotece" from the photos sidebar preselects the root in the Library Zdjęcia surface
  ([`a68d888`](https://github.com/coderoadpl/ai-video-cataloger/commit/a68d888)).

### Changed

- Analysis → Zdjęcia workspace now opens the selected photo's detail (preview, EXIF, provenance, tags, variant picker, analyze) driven by the photos sidebar; folder actions (Zeskanuj, Przetwórz, podglądy) moved to the sidebar toolbar
  ([`73e9e39`](https://github.com/coderoadpl/ai-video-cataloger/commit/73e9e39)).
- `qa:walkthrough`'s `analysis-photos` step verifies the photos sidebar and detail workspace
  ([`73e9e39`](https://github.com/coderoadpl/ai-video-cataloger/commit/73e9e39)).
- Photo analysis and proxy generation now checkpoint the photos database inside a store batch — after every analyzer batch and every 50 generated proxies — so an interrupted run loses at most one analyzer batch of paid analysis instead of up to 500 photos' worth
  ([`0154152`](https://github.com/coderoadpl/ai-video-cataloger/commit/0154152)).
- `photos scan`'s reconcile pass reads the sightings under a root through the path index instead of loading every path row in the database into memory
  ([`0154152`](https://github.com/coderoadpl/ai-video-cataloger/commit/0154152)).
- All faces-writing jobs (`faces index`, `faces recluster`, `faces exemplars`) and the drive run's inline faces pass now serialize under a single `faces-write` resource; a concurrent request returns `conflict` instead of racing the shared people pool, and the drive run reports a new `faces_waiting` progress step while it waits its turn
  ([`3a9de31`](https://github.com/coderoadpl/ai-video-cataloger/commit/3a9de31)).
- Global catalog schema v11: `face_observations` gains a `media` column (default `video`) preparing the shared face-identity pool for photos
  ([`bd946d5`](https://github.com/coderoadpl/ai-video-cataloger/commit/bd946d5)).
- Global catalog schema v12: adds `idx_files_captured_at`, `idx_files_folder_id`, `idx_files_place_name`, `idx_file_tags_tag_id`, `idx_face_observations_person`, and `idx_analyses_fingerprint` indexes, so date, folder, tag and person lookups seek an index instead of scanning `files`, `file_tags` and `face_observations`. On the 3752-file reference catalog a person lookup drops from 2297 ms to 3 ms and a folder lookup from 0.28 ms to 0.03 ms
  ([`2eda683`](https://github.com/coderoadpl/ai-video-cataloger/commit/2eda683)).
- The advisory catalog home lock is now a single shared owner across all catalog stores in a process; disposing or flushing one store no longer releases the lock while another still holds a lease
  ([`bd946d5`](https://github.com/coderoadpl/ai-video-cataloger/commit/bd946d5)).
- The packaged desktop renderer is served with a Content-Security-Policy that permits no remote origin, so no renderer code path — present or future — can reach the network without an explicit, documented policy change (ADR-0013)
  ([`27f2cb1`](https://github.com/coderoadpl/ai-video-cataloger/commit/27f2cb1)).
- Face clustering no longer makes founding an identity harder than joining one: the auto-assign floor rises to 0.50, matching the new-cluster floor, and a new identity needs two mutually similar observations instead of three (ADR-0012)
  ([`3ce711d`](https://github.com/coderoadpl/ai-video-cataloger/commit/3ce711d)).
- Exemplar crops are sampled across files — at most one per file until a person has five — so a person spanning many folders is verifiable instead of showing five near-duplicates from one day; `faces people` now returns every stored exemplar path
  ([`3ce711d`](https://github.com/coderoadpl/ai-video-cataloger/commit/3ce711d)).
- Face indexing now stores a crop for every detected face, keyed by the observation (`faces/obs/<fingerprint>/<frame>-<detection>.jpg`) instead of by the person that claimed it, and the up-to-five exemplars a person shows — at most one per file, best quality first — are chosen when the people list is read. A rebuilt identity therefore always has a photograph and always spreads it across the files it spans; previously a `faces recluster` could leave hundreds of nameless, photo-less people (ADR-0014). `faces recluster`'s `personsWithoutExemplar` counts the people the list actually shows without a photograph rather than the people holding no crop at all, so the number it reports — and the `faces exemplars` hint it triggers — matches what the owner sees
  ([`aad0d0c`](https://github.com/coderoadpl/ai-video-cataloger/commit/aad0d0c)).
- `thumbnail <video-path>` and the GUI's lazy generation prefer the stored analysis frame over re-decoding the video, so a cover can be produced for a file whose drive is detached or mounted read-only, and an existing thumbnail is reported as skipped without starting ffmpeg
  ([`01a70d2`](https://github.com/coderoadpl/ai-video-cataloger/commit/01a70d2)).
- The terminal panel no longer auto-expands on the first job output; it stays collapsed until opened from the header button or the `View` menu
  ([`c09af23`](https://github.com/coderoadpl/ai-video-cataloger/commit/c09af23)).
- `tag_language` joins the analysis config descriptor, so pinning it (or having `output_language` pinned) produces a new `configId`; runs with `output_language` and `tag_language` both `auto` keep their existing configIds. Previously tags followed whatever language was narrated in the video, which split one concept into per-language tags
  ([`83ed0f8`](https://github.com/coderoadpl/ai-video-cataloger/commit/83ed0f8)).
- `photos status` counts proxied and proxy-failed photos; `photos forget` deletes the forgotten photos' proxy and thumbnail artifacts
  ([`c013901`](https://github.com/coderoadpl/ai-video-cataloger/commit/c013901)).
- The `media://` protocol serves the static photo-artifacts root; photo source folders are never exposed to the renderer
  ([`c013901`](https://github.com/coderoadpl/ai-video-cataloger/commit/c013901)).
- `pnpm run check` fails on a direct `.normalize('NFC')` call outside `core/domain/paths.ts` and test files, so path canonicalization stays at the three boundaries that own it
  ([`a651ae8`](https://github.com/coderoadpl/ai-video-cataloger/commit/a651ae8)).
- Search now follows `tag_aliases` in both directions: a merged-away term still finds the files that carry its canonical tag, and the canonical term also matches text occurrences of its aliases. Quoted phrases stay literal and literal hits still outrank alias hits
  ([`8f377b7`](https://github.com/coderoadpl/ai-video-cataloger/commit/8f377b7)).
- Two-mode UI: a Library/Analysis switcher in the top bar replaces the five-tab view navigation; Library groups Collection/Photos/People/Map behind a subnav, Analysis groups the folder workspace behind a Videos/Photos toggle, and each mode remembers its own state
  ([`144bc84`](https://github.com/coderoadpl/ai-video-cataloger/commit/144bc84)).
- Browse surfaces are strictly read-only: Library Photos hides analyze/variant actions and folder scanning, Library People hides the faces-index build (now in Analysis > Photos), and map video pins open the preview instead of the folder workspace
  ([`9439c96`](https://github.com/coderoadpl/ai-video-cataloger/commit/9439c96)).
- The folder bar and the terminal strip render only in Analysis mode; the Library browses the cross-folder catalog without a current folder
  ([`9439c96`](https://github.com/coderoadpl/ai-video-cataloger/commit/9439c96)).
- The Analysis Videos/Photos media toggle moves from the workspace content into the top bar, next to the Library/Analysis switcher, so it is always visible while in Analysis mode
  ([`b666588`](https://github.com/coderoadpl/ai-video-cataloger/commit/b666588)).
- The Library search box's bottom margin doubles (8px → 16px) so it no longer crowds the filter bar beneath it
  ([`b666588`](https://github.com/coderoadpl/ai-video-cataloger/commit/b666588)).
- `photosList` items now carry `analysed` and `exifReadAt`
  ([`a68d888`](https://github.com/coderoadpl/ai-video-cataloger/commit/a68d888)).

### Removed

- The standalone photos dashboard in Analysis (root dropdown, scan button and filename search there); browsing and search over photos live in the Library's Zdjęcia surface
  ([`73e9e39`](https://github.com/coderoadpl/ai-video-cataloger/commit/73e9e39)).
- The global top-bar search and its full-screen results view; search now lives in the Library's Collection toolbar with the same recent-searches and top-tags suggestions
  ([`144bc84`](https://github.com/coderoadpl/ai-video-cataloger/commit/144bc84)).

### Fixed

- The unified library collection feed now orders and merges both media legs in
  the catalog stores' binary collation and breaks capture-date ties by file
  name, so a `name_asc` or `captured_*` feed is no longer interleaved in an
  order neither leg produced (uppercase names previously sank below lowercase
  ones)
  ([`8c50c31`](https://github.com/coderoadpl/ai-video-cataloger/commit/8c50c31)).
- The Electron desktop app now honors `AVC_HOME_DIRECTORY` when set (matching
  the CLI's existing override), instead of always resolving its home
  directory from the OS user profile
  ([`8c50c31`](https://github.com/coderoadpl/ai-video-cataloger/commit/8c50c31)).
- `photos forget` now also deletes a forgotten fingerprint's grid thumbnail
  artifact; it previously deleted only the proxy and small thumbnail, leaking
  the `.grid.jpg` sibling on disk
  ([`8c50c31`](https://github.com/coderoadpl/ai-video-cataloger/commit/8c50c31)).
- Library → Zdjęcia grid tiles now render the 512px grid thumbnail
  (falling back to the small thumbnail) instead of the small thumbnail, and
  the Analysis → Zdjęcia sidebar rows now render the small thumbnail instead
  of the 512px grid thumbnail: the two surfaces had the consumption inverted
  ([`c7ec6f5`](https://github.com/coderoadpl/ai-video-cataloger/commit/c7ec6f5)).
- Library → Osoby mutation failures (rename, merge, forget, delete all face
  data) now surface via a dismissible alert on the People surface itself,
  instead of only a terminal line that Library mode keeps hidden
  ([`c7ec6f5`](https://github.com/coderoadpl/ai-video-cataloger/commit/c7ec6f5)).
- `GET /api/library/collection` in match (query) mode now honors an explicit
  non-relevance `sort` for the photo side instead of always ranking photos by
  FTS score, so a query with `sort=captured_asc|captured_desc|name_asc`
  merges videos and photos in one consistent order instead of merging a
  score-ordered photo stream against a date-ordered video stream
  ([`c7ec6f5`](https://github.com/coderoadpl/ai-video-cataloger/commit/c7ec6f5)).
- A nested photo root (e.g. scanning both `~/Pictures` and `~/Pictures/2024`)
  no longer duplicates the child photos in the "all folders" sidebar sections,
  and the owning root used for Analyze in the "all folders" scope now resolves
  to the deepest matching root instead of the first (typically parent) one
  ([`c7ec6f5`](https://github.com/coderoadpl/ai-video-cataloger/commit/c7ec6f5)).
- Load-more pagination in Photos, the Photos analysis sidebar, and the Library
  no longer re-appends the same page when a completed job or focus refetch
  refreshes the currently loaded offset: each offset is now merged into the
  loaded list at most once, so rows can no longer be duplicated and "has more"
  can no longer flip false while later pages remain unloaded
  ([`df91db4`](https://github.com/coderoadpl/ai-video-cataloger/commit/df91db4)).
- Analysis with Zdjęcia active now shows the photos sidebar (folder header, scope toggle, badge rows, honest empty state) instead of the video list
  ([`a68d888`](https://github.com/coderoadpl/ai-video-cataloger/commit/a68d888)).
- The Library → Zdjęcia detail pane's "Otwórz w Analizie" escape hatch now
  switches to Analysis → Zdjęcia with the photo's root and the photo itself
  selected, instead of switching to Analysis → Filmy with the photo's folder
  opened as a video folder and nothing selected
  ([`c7ec6f5`](https://github.com/coderoadpl/ai-video-cataloger/commit/c7ec6f5)).
- Folders whose names carry diacritics are no longer silently skipped: every path entering the catalog is canonicalized to NFC at the contract, filesystem and store boundaries, so a path handed in as NFD (the on-disk form on macOS) matches the NFC rows the catalog stores. In a real-world catalog this recovered affected analyzed files that `faces index` had reported as a successful zero-file run
  ([`a651ae8`](https://github.com/coderoadpl/ai-video-cataloger/commit/a651ae8)).
- `faces index <root>` no longer reports success over an empty set: a root that does not exist fails with `folder_not_found`, and an existing root with no catalog folders under it fails with `drive_root_empty` (exit 39), matching `materialize` and `process-drive`; a root whose files are all already indexed still succeeds and now reports the folders and analyzed files it saw
  ([`a651ae8`](https://github.com/coderoadpl/ai-video-cataloger/commit/a651ae8)).
- A read-only mirror created before path canonicalization keeps its frames and thumbnails: the mirror id derived from the old decomposed folder name is rebuilt and used when no canonical mirror exists, so a diacritic folder is not silently re-mirrored from scratch
  ([`a651ae8`](https://github.com/coderoadpl/ai-video-cataloger/commit/a651ae8)).
- A second person could never be founded once the unassigned pool held more than one identity: the new-cluster seed demanded that *all* candidate observations be mutually similar, so a mixed pool always returned nothing and every good detection was absorbed by the first person in a real-world catalog
  ([`3ce711d`](https://github.com/coderoadpl/ai-video-cataloger/commit/3ce711d)).
- `faces recluster` no longer leaves people without recognisable exemplars: in a real-world catalog nearly every rebuilt identity had no crop because crops existed only for the exemplars of the single identity that had been glued together at index time
  ([`aad0d0c`](https://github.com/coderoadpl/ai-video-cataloger/commit/aad0d0c)).
- `driveRunSummarySchema` carries `snapshotSkipped` through the completed `process-drive` job payload instead of stripping it
  ([`cd2b2d2`](https://github.com/coderoadpl/ai-video-cataloger/commit/cd2b2d2)).
- A corrupted stored variant descriptor or usage JSON in the global catalog surfaces as `read_error` (`READ_ERROR`, exit 28) instead of an untyped `internal` error
  ([`cd2b2d2`](https://github.com/coderoadpl/ai-video-cataloger/commit/cd2b2d2)).
- Settings and the setup wizard only render the amber Gemini privacy warning when the selected analyzer is Gemini (native video); it no longer appears under Claude, local, or OpenAI-compatible API selections
  ([`477ed91`](https://github.com/coderoadpl/ai-video-cataloger/commit/477ed91)).
- The `harness-cursor-agent × skip` e2e matrix leg now probes cursor-agent with a trivial invocation (not just `status`) before running the full pipeline, so an authenticated but usage-exhausted CLI self-skips instead of failing the leg
  ([`441580a`](https://github.com/coderoadpl/ai-video-cataloger/commit/441580a)).
- `tags alias` re-points existing aliases at the new canonical tag instead of leaving them pointing at the deleted tag row, so chained merges (`dogs` → `psy`, then `psy` → `pieski`) keep resolving and no longer resurrect the merged-away tag on the next ingest
  ([`8f377b7`](https://github.com/coderoadpl/ai-video-cataloger/commit/8f377b7)).
- One undecodable or very short video no longer kills a whole face-indexing pass: `faces index` and the faces pass chained into `process-drive` record the file in a `faces_file_failed` event and in the `faces` summary block (`filesFailed`, `failureCodes`, `aborted`), keep going, and exit 0 with partial results; only five consecutive failures of the same class abort the pass (`DRIVE_RUN_ABORTED`, exit 40)
  ([`e8c8549`](https://github.com/coderoadpl/ai-video-cataloger/commit/e8c8549)).
- Asking for more frames than a clip contains is no longer an error: frame extraction returns the frames ffmpeg actually wrote — and fails typed only when none did — and an RGB decode that seeks past the last frame falls back to the extracted frame image instead of failing with `Decoded RGB frame size mismatch: expected 15925248, got 0`
  ([`e8c8549`](https://github.com/coderoadpl/ai-video-cataloger/commit/e8c8549)).
- `listLocations` resolves the selected variant (explicit selection, then folder default, then newest) instead of joining every stored variant, so a file with more than one analysis variant no longer produces a duplicate map pin, an inflated "located files" count, and a nondeterministic final name
  ([`18b8fb9`](https://github.com/coderoadpl/ai-video-cataloger/commit/18b8fb9)).
- The API-log terminal seam no longer records the plaintext body of a `POST /api/credentials` request, so an entered provider API key never lands in the debug terminal's Raw view or on the clipboard via Copy
  ([`18b8fb9`](https://github.com/coderoadpl/ai-video-cataloger/commit/18b8fb9)).
- `photos scan` no longer treats an unreadable subtree (permission change, flaky mount) as "gone": a folder that fails to list is reported via a new `photo-folder-skipped` event, counted in the summary's new `folderReadErrors`, and excluded from the reconcile pass, so its photos keep their sightings instead of being wrongly marked missing
  ([`dc97ef4`](https://github.com/coderoadpl/ai-video-cataloger/commit/dc97ef4)).
- `photosVariantsSelect`, `photosVariantsDelete` and `photosVariantsFolderDefault` now flush `photos.db` under the same write-lock wrapper that already flushes the global catalog, so a variant selection survives an app quit instead of depending on the un-awaited `dispose()` at shutdown
  ([`6547821`](https://github.com/coderoadpl/ai-video-cataloger/commit/6547821)).
- Library tiles now load the 512px grid thumbnail when it exists, falling back to the small thumbnail
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- Offline/no-thumbnail Library and Photos tiles render as full square tiles with a deterministic gradient and centered name
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- "Load more" in the Library keeps the scroll position and no longer flashes the no-results state
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- People exemplar crops recorded under a previous home directory resolve against the current home (fixes 403 avatars)
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- People cards without an exemplar show an initials avatar; Delete moved into a per-card overflow menu behind the existing confirmation
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- People filter options show display names ("Person N" for unnamed) instead of raw ids; tag filter options are ordered by count
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- Preview overlay shows a localized capture date and uses the thumbnail as the video poster
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- Analysis detail pane shows a "Select a video from the list" prompt instead of the full onboarding welcome screen once a folder with videos is open
  ([`b492d76`](https://github.com/coderoadpl/ai-video-cataloger/commit/b492d76)).
- The Photos sidebar's badges (Ukończony/Completed, Duplikat, Brak EXIF, Podgląd nieudany, Brak pliku) now render through the same `StatusBadge` component as the video status badge, each with a fitting icon, matching the video list's exact "Completed"/"Ukończony" wording instead of a separate "Analysed" label
  ([`77c2df7`](https://github.com/coderoadpl/ai-video-cataloger/commit/77c2df7)).
- Library and Photos placeholder tiles (no thumbnail) render a vertically centered composition — disk icon, middle-ellipsized filename, and an offline caption when the owning folder is offline — over a low-saturation duotone gradient from a single cool hue family with a subtle 1px border, replacing the corner "offline" pill for that case; the light theme tints the tiles pale with dark text and the dark theme keeps deep tiles with white text (`apps/web/src/components/ui/PlaceholderTile.tsx`, shared by `LibraryGrid` and `PhotoGrid`)
  ([`77c2df7`](https://github.com/coderoadpl/ai-video-cataloger/commit/77c2df7)).
- The photo detail pane's Analyze action targets the owning folder of the currently selected photo instead of the sidebar's (possibly unrelated) `selectedRoot` when the "Wszystkie foldery" (all folders) scope is active, so it no longer silently analyzes the wrong — or a stale — folder; the sidebar's Analyze button is disabled whenever no target folder resolves instead of being clickable with no effect
  ([`77c2df7`](https://github.com/coderoadpl/ai-video-cataloger/commit/77c2df7)).
- Photos sidebar rows show the capture date localized (medium date, short time) instead of the raw ISO timestamp
  ([`77c2df7`](https://github.com/coderoadpl/ai-video-cataloger/commit/77c2df7)).

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
