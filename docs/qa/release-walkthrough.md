# Release walkthrough — the mandatory pre-DMG self-QA phase

No DMG is offered to the owner before this phase has run against the **real
packaged app** and its screenshot set has been reviewed. Owner-visible issues
shrink when the proof is empirical: a gate that only reads green in a terminal
has never looked at a badge, a thumbnail or a Polish sentence.

The runner is `scripts/release-walkthrough.mjs`, wrapped by
`pnpm run qa:walkthrough`. It drives the packaged app with Playwright's
`_electron`, captures one screenshot per step, and writes `plan.json` and
`manifest.json` (step, status, duration, screenshot, time-to-window) next to
them.

Every run opens the driven window at **1920x1200** by default — large enough
that the details column never collapses in the captured screenshots — via a
seeded `window-state.json` in the fresh user-data directory. Override it with
`--window-size WxH` (for example `--window-size 1440x900`). Before each
screenshot the runner waits for pending CSS transitions/animations and any
spinner/loading indicator to clear, falling back to a short fixed delay when
that can't be detected, so a shot never lands mid-spinner or mid-fade.

## Isolation

Every run launches with:

- `AI_VIDEO_CATALOGER_USER_DATA_DIR` — a fresh temp user-data directory (the
  packaged app honours the environment variable; `--user-data-dir=` is passed
  as well for development builds).
- `HOME`/`USERPROFILE` — a throwaway temp home unless `--home` names a prepared
  QA home, so the home-scoped catalog, config and models are never the owner's.
- `AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN=1` — the login keychain is never read,
  written or prompted for. Under that flag the composition
  (`apps/server/src/composition.ts`) gives the backup lifecycle and the Drive
  destination a 0600 file-backed secrets store at
  `<home>/.ai-video-cataloger/secrets.json` instead of the Keychain adapter,
  which would otherwise fail every backup call with `keychain_unavailable`. The
  file-backed store is selected only when the variable is set **and** the run
  drives a home other than the account's own one (the account home is read from
  the passwd database, so overriding `HOME` does not hide it), and the
  composition logs a warning whenever it is selected. A packaged build on a
  throwaway home — exactly what this walkthrough drives — therefore gets the
  file store, while an ordinary install on the account's own home cannot be
  argued into it by an environment variable.
- `AVC_GOOGLE_DRIVE_BASE_URL` / `AVC_GOOGLE_UPLOAD_BASE_URL` — pointed at the
  in-memory fake Drive the run starts for itself (see below), so the backup step
  needs no Google account and no network.
- `ui_language: "pl"` — seeded into the home's `.ai-video-cataloger/config.json`
  before launch (merged with whatever else a prepared QA home already has
  there), so every captured screenshot shows production Polish copy instead of
  the English fallback. Reviewing an English capture cannot catch a Polish
  copy defect (W50: the v0.6.12 review ran in English and could not judge
  Polish strings at all).
- `--fixtures` itself — `prepareScratchFixtures` (`scripts/release-walkthrough.mjs`)
  copies the given folder into a scratch temp directory before the app ever
  opens it, so the source folder (which may be a read-only walkthrough
  template in a scratch directory outside the repository) is never
  written to. The scratch copy also gets one planted `broken-photo.jpg` — a
  real JPEG start-of-image marker with no image data — so the photo scan the
  `photos-sidebar` step auto-triggers always has one file whose proxy
  generation fails (W51: the broken-image placeholder had never been
  exercised by a walkthrough run before). The plant sets an old (year-2000)
  mtime: with no surviving EXIF, `capturedAt` falls back to file mtime, and an
  old mtime keeps the row sorted last in every captured-at-DESC photo UI
  instead of shadowing real fixtures as the newest photo (W52).
  Every copied JPEG also gets a per-run marker appended after its EOI marker
  (trailing bytes a decoder ignores — `sips` and `exifr` both still read the
  file), because photos.db keys a photo by the sha256 of its bytes: a prepared
  QA home that already catalogued the source fixtures under their own root
  otherwise re-attaches every byte-identical scratch copy to those rows, which
  keep pointing at the source folder, and the scratch root ends up with nothing
  analyzable under the current-folder scope (W64 — this is what turned the
  v0.6.20 walkthrough red). The whole run shares one marker, so the fixtures'
  intentional duplicate pair stays byte-identical to each other and still earns
  its `Duplikat` badge, and the `.ai-video-cataloger` sidecar is left untouched,
  exactly as the scanner's own walk skips it. One further copy is planted as
  `subfolder/tree-photo.jpg` with a fingerprint of its own: the whole-tree scope
  is offered only while the opened root owns a photo-bearing subfolder
  (`treeScopeAvailable` in `use-photos-analysis.ts`), and the sanctioned fixture
  sets keep their subfolder video-only, so `photos-tree` would have no tree to
  expand.

A run therefore never mutates real user data. Analysis needs a configured
analyzer, which a throwaway home does not have: pass `--home` pointing at a
prepared QA home (for example the matrix cache below `AVC_SCRATCH_DIR`), or
`--analyzer local:<model>` (below) to seed one
into the scratch home for this run. Without either the step reports itself
`skipped`, which is a legitimate outcome for a video-only pass — but it is
**not** in `TOLERATED_SKIPS`, so a `--strict` release run fails on it: a
release must prove the analysis half of the checklist, not skip it silently
because a finished run is not evidence that analysis succeeded.

### `--analyzer local:<model>`

Seeds the scratch home's `.ai-video-cataloger/config.json` with
`analyzer_backend: "local"`, `local_model: "<model>"` and `whisper_mode:
"skip"` — the real, honest transcription-less path
(`core/domain/config.ts`), not a fabricated offline whisper setup — before the
app launches, so the analyze step can complete against the **system ollama**
at `http://127.0.0.1:11434` with no external services. It fails fast, before
the app is ever launched, if ollama is not reachable there or `<model>` is not
in `ollama list`:

```bash
curl -s http://127.0.0.1:11434/api/tags | jq '.models[].name'
ollama pull gemma3:4b   # if it's missing
```

A release run must never silently fall back to the claude-CLI default when the
requested local model isn't available — that fallback would drive a real
paid/harness analyzer during an otherwise-offline QA pass and quietly change
what the screenshots prove. `--analyzer` always overwrites
`analyzer_backend`/`local_model`/`whisper_mode` in the driven `--home` (or the
default throwaway home) and drops that home's `analyzer_provider` — the key
Settings writes, which outranks `analyzer_backend` in
`core/server/usecases/config-resolution.ts` — so passing it forces the exact
local model under test regardless of whatever analyzer that home was last
configured with. A folder-scoped analyzer inside the fixtures tree would still
win; release runs point `--fixtures` at a clean fixture set, which has none.

### The backup step

`scripts/fake-drive-server.mjs` is a runnable, in-memory stand-in for the Google
Drive v3 API — token exchange, `drives`/`permissions` reads, `files` list, create
and delete, multipart and resumable uploads, `alt=media` download — sufficient
for the **service-account** destination. `scripts/fake-drive-server.test.ts`
drives the real `GoogleServiceAccountBackupDestination` against it over loopback
HTTP, so the fake is held to the adapter's actual request shapes rather than to a
description of them.

The walkthrough starts it on a random loopback port before launching the app,
generates a throwaway service-account key whose `token_uri` points at it, and the
`backup` step drives the real Settings > Kopia zapasowa flow: the enable switch,
the stepper's service-account provider, the Shared Drive id and key JSON, the
connect, the mandatory recovery-key export (the native save dialog is
stubbed in the Electron main process, the in-app button is clicked for real), the
confirmation checkbox and Finish. The step is `ok` only when the archive list
renders **and** the fake Drive actually holds an archive; the following
`backup-indicator` step closes Settings, switches back to Analysis — the bottom
bar is an Analysis-mode surface, so the indicator does not exist while Library is
on screen — and requires the indicator to render in a state other than `failed`.
Both screenshots are part of the reviewed set.

The step remains valid for builds without `AVC_GOOGLE_OAUTH_CLIENT_ID`: those
builds hide the Google-account destination, and the walkthrough already drives
the service-account path against fake Drive.

Three details of that step are load-bearing and are pinned by
`scripts/release-walkthrough.test.mjs`, which reads the driver's own source:

- The enable switch is **clicked**, never `check()`ed. Its `checked` state comes
  from the server-side backup status and its `onChange` only opens the stepper,
  so Playwright's `check()` fails the step with "Clicking the checkbox did not
  change its state" — the same reason `test/e2e/backup-settings.spec.ts` clicks
  the input. The provider radio is clicked on its `input` for the same reason.
- A successful connect advances the stepper to the recovery-key step, which
  unmounts the connect step **and its success alert with it**, so the step waits
  for the recovery-key export control rather than for
  `backup-connection-report`. When either wait fails, the step reports the
  stepper's own error alert as its note. The stepper's "Test connection" button
  lives on the connect step, which the successful connect leaves, and the
  destination is only configured by that connect, so the walkthrough does not
  drive it.
- The archive assertion counts the objects the fake Drive holds that carry a
  manifest `tier` app-property. The folder created at connect and the transient
  `connection-test.bin` probe are not archives, and counting them would let an
  enablement that uploaded nothing pass.
- Finishing the stepper only **enqueues** the first backup
  (`core/server/usecases/backup-enablement.ts`), and the section's archive query
  answers once, while that job is still uploading, so the list stays on its
  "no backup yet" copy. The step therefore waits until the fake Drive actually
  holds the archive, then closes and reopens Settings with the real controls,
  which re-enables the query against the finished destination — that reopened
  section is what the `backup` screenshot shows.

Because the fake Drive is in-memory and re-ported every run, the runner clears
every `backup_*` config key and the file-backed `secrets.json` in the driven home
before launch — environment setup, not a stand-in for the flow: every click in
the stepper is still real.

### The analyze step's outcome

The step maps to the analysis's **real** result, read from the UI state it
already drives (the `analysis-error-card` testid and `detail-layout`'s
`data-video-status` attribute), never from timing:

- Analysis reaches `completed` with no error card → `ok`, and the note names
  the analyzed file.
- Analysis ends in error (the `analysis-error-card` renders) → `failed` — not
  `ok`, not `skipped` — with the card's message as the note.
- No analyzer configured in the driven home (the Analyze button is disabled)
  → `skipped`, with the UI's own disabled-reason text as the note. This skip
  is not tolerated: release runs must provide an analyzer via `--home` or
  `--analyzer`.

The following Library search derives its default query from the filename shown
after that analysis completes, so a Polish analyzer rename cannot invalidate a
hard-coded English query. `--query <text>` remains available as an explicit
override. The search step requires a matching Library tile rather than treating
the no-results state as evidence. Before `library-preview`, the runner clears
and submits the empty search so the overlay and its `Otwórz w Analizie` action
are exercised against the unfiltered collection rather than skipped because
the preceding filter is still active. Clearing ends with a real `Escape`
keypress and a wait for the `MuiAutocomplete-popper` to be hidden: the
suggestion popper re-opens on focus with the empty query, and left open it
covers the grid and intercepts the preview tile click.

## Procedure

1. Build the bundle under test:

   ```bash
   pnpm run electron:package
   ```

2. Check the bundle shape (still outside the normal gates):

   ```bash
   pnpm run verify:package
   ```

3. Set `AVC_SCRATCH_DIR` to a scratch directory outside the repository, then
   run the walkthrough against the built `.app` and a fixture folder of sample
   videos, archiving the finished set as part of the same command:

   ```bash
   pnpm run qa:walkthrough -- \
     --app "release/mac-arm64/AI Video Cataloger.app" \
     --fixtures "$AVC_SCRATCH_DIR/avc-walkthrough-fixtures" \
     --home "$AVC_SCRATCH_DIR/avc-e2e-matrix-home" \
     --strict \
     --analyzer local:gemma3:4b \
     --archive-to "$AVC_SCRATCH_DIR/avc-release-shots/<version>/"
   ```

   `--analyzer local:gemma3:4b` requires the system ollama running at its
   default port; check first with `curl -s http://127.0.0.1:11434/api/tags`.
   Release runs always pass it: `--strict` now makes an unconfigured analyzer
   a hard failure (see "The analyze step's outcome" above), so the analyzer
   must be real and reachable, not left to whatever `--home` happened to have
   configured last.

   `pnpm run qa:walkthrough -- --help` lists every option;
   `--dry-run` validates the inputs (including, with `--analyzer`, that ollama
   is reachable and the model is installed) and writes `plan.json` without
   launching the app. Release runs add `--strict`: any step that reports
   `skipped` turns the exit code non-zero instead of leaving it to a reviewer
   to notice in the manifest — **except** the tolerated-skips allowlist
   (`TOLERATED_SKIPS` in `scripts/release-walkthrough.mjs`):

   - `first-run-wizard` — the wizard's dismissal is persisted to the home, so
     it never fires again once a prepared QA home has opened it before; a
     home reused across walkthrough runs (as `--home` recommends) will
     legitimately skip this every time after the first.
   - `library-preview` — depends on the Library already holding a tile left
     over from a previous scan into that home; a home whose most recent scan
     was into a different folder can legitimately have nothing to preview.

   Every other `skipped` step (no analyzer configured, no photos catalogued,
   no subfolders in the fixture tree, …) still turns `--strict` non-zero: a
   tolerated skip is reported in the summary and the manifest exactly like
   before, it just does not fail the run. `--archive-to <dir>` copies the
   finished set (`plan.json`, `manifest.json`, every PNG) to `<dir>` before
   the process exits — run it **before any worktree cleanup**; a set that
   only exists inside a worktree does not survive the worktree being removed.

4. Hand the archived set to an **independent reviewer** — someone other than
   whoever ran step 3 — and have them work the checklist below against the
   archived PNGs, not against a description of them. This reviewer has
   authority to fail the release: a release does not proceed on the release
   agent's own "looks correct" verdict.

## Real UI, not synthetic events

Every step drives the real UI: `open-folder` stubs the native folder-picker
dialog at the Electron main-process boundary (the one sanctioned stub point)
and then clicks the real Open Folder button, so its screenshots show the
actual empty→populated transition. `settings` clicks the header's Settings
button and `wizard` clicks "Run Setup Wizard" inside the opened Settings
modal — both are real in-app controls, so this run has no menu-event
shortcuts (`webContents.send('menu:...')`) left to document as an exception.
If a future step needs a macOS menu-bar-only action with no in-app
equivalent, add it back deliberately and record the WHY here.

The steps captured, in order: `launch` (with time-to-window), `first-run-wizard`,
`mode-switch`, `mode-analysis`, `open-folder`, `tree-expand`, `select-video`,
`analyze`, `search`, `library-preview`, `library-hide-restore`, `photos-sidebar`,
`analysis-photos`, `photos-tree`, `photos-tree-analyze`,
`collection-photo-analyzed`, `collection-photo-viewer`, `people`,
`settings`, `backup`, `backup-indicator`, `wizard`.
That list is also declared in the driver as `WALKTHROUGH_STEPS` and asserted on
every recorded step, so a step added, dropped or reordered without updating this
document's list and the reviewer checklist below stops the run.
`mode-switch`, `mode-analysis` and `search` drive the two-mode switcher: the
workspace steps run in Analysis mode, while `search` and the collection photo
steps switch to Library first. `library-preview` clicks a Kolekcja tile, asserts the
fullscreen media viewer and its player render for a video tile, then follows
the "Otwórz w Analizie" escape hatch and asserts it lands in the Analysis
details panel with the file selected. `library-hide-restore` selects two
Kolekcja tiles, hides them, opens the `Ukryte` view, restores them, and
captures the restored default collection. `photos-sidebar` switches
Analysis to Zdjęcia and captures the sidebar state (folder header, scope
toggle, badge rows) before any row is clicked. `analysis-photos` then clicks
the first sidebar row that does not carry the `proxyFailed` badge (the analyze
strip only renders once `proxyState` is `done`, and the planted broken photo
is always `failed`) and asserts the workspace detail (`photos-analysis-detail`)
and the analyze strip render, and that the video list is never visible in the
photos sidebar.

`people` opens Biblioteka > Osoby and captures the unified people surface. It is
`ok` in two shapes, and the note says which one the run produced: the media
filter rendered with its Polish `Wszystko` / `Filmy` / `Zdjęcia` chips, or — when
the fixture set yielded no face groupings — one of the honest empty states
(`people-empty-state`, `people-disabled-state`, `people-no-models-state`) with
its Polish copy. A face-less fixture is a legitimate release run; a surface that
renders neither the chips nor an empty state, loses the `Osoby` heading, or shows
a bare empty panel is a `failed` step, never a skip.

**`photos-tree` / `photos-tree-analyze` / `collection-photo-analyzed` /
`collection-photo-viewer` (W60/W63/W64).** These steps exercise the W57 folder tree
end-to-end, closing the gap the
v0.6.17 independent review found (B1/B2): every earlier photo step drives the
"Ten folder" flat list, so the collapsible root→subfolders→photo-rows tree
that only renders in the whole-tree scope (`PhotosSidebar.tsx`,
`state.scope === 'tree'`) had never been clicked, screenshotted, or used to
select a photo.
- `photos-tree` clicks the "Całe drzewo" scope toggle (`scope-tree`, the shared
  `AnalyzeScopeToggle` the videos sidebar also uses since W62; a build whose
  root owns no photo-bearing subfolder renders it disabled and the step reports
  `skipped`), waits for a `photos-tree-root-row`, expands that root and the
  first `photos-tree-folder-row` if either is collapsed (a row click toggles,
  and the tree opens its root expanded, so an unconditional click would
  collapse what it meant to open), selects the first photo row the tree
  renders that is neither already analysed nor proxy-failed
  (`photos-sidebar-row`, the same testid the flat list uses — the tree reuses
  `PhotoRow`; the detail pane offers a single-photo "Analizuj" only for such a
  photo, and the fixtures deliberately plant an unloadable one), and asserts
  that "Analizuj" is enabled for the tree-selected photo — the exact affordance
  W57 made reachable (a photo the flat list has never paginated to can now
  still be analyzed). The button is always located **inside**
  `photos-analysis-detail`: the sidebar toolbar's folder-wide "Analizuj folder"
  carries the same `photos-analyze-action` testid, so an unscoped locator
  resolves to two elements and Playwright's strict mode rejects every action on
  it. A run whose tree holds only analysed or proxy-failed photos reports
  `skipped`, so the QA home must keep at least one unanalyzed photo.
- `photos-tree-analyze` clicks that enabled "Analizuj" and waits for the
  tree-selected photo's own row (`.Mui-selected`, so a badge that predates the
  run on some other row can never stand in for it) to carry the
  `photos-sidebar-badge-analysed` badge (or, on a real failure, the
  `photos-job-error` alert) — the outcome comes from that DOM state, never from
  a fixed delay, matching the W54 doctrine the `analyze` step already follows
  for videos.
- `collection-photo-analyzed` switches to Biblioteka → Kolekcja and reads the
  `library-media-photo` chip's rendered `Zdjęcia (N)` count, asserting `N >= 1`
  — proving W55's actual payoff (an analyzed photo reaching the unified feed),
  which the W60 collection filter (see architecture doc, "Analyzed-only photo
  source") now requires; before that filter this chip could show >0 with zero
  analyzed photos underneath, per the same review finding.
- `collection-photo-viewer` keeps the Zdjęcia chip selected, clicks the first
  analyzed photo tile in Kolekcja and asserts the shared media viewer opens.
  This replaces the retired Library → Zdjęcia tab/grid/detail steps.

None of these four are in `TOLERATED_SKIPS`: like `analyze`, a release run
must prove them, not skip them — the walkthrough always runs with
`--analyzer` (see below), so they can genuinely complete.

The photo steps need a home whose photos DB already has a scanned root —
`--home` pointing at a QA home that has run `photos scan`. Without one,
`photos-sidebar`, `analysis-photos`, `photos-tree` and the collection photo
steps report `skipped` with "no photos catalogued in this home",
which is a legitimate outcome for a video-only review pass and a missing
proof for a release that ships photo changes.

## Review the screenshots (independent reviewer, authority to fail)

This step is performed by someone other than the agent that ran the
walkthrough, against the **archived** set from step 3 above, not a live
worktree. It is a gate, not a courtesy pass: a reviewer who finds a violation
below fails the release and sends it back — they do not "note it for later" or
accept the release agent's own assessment of its own screenshots.

A `failed` step is a P1 — fix it or pull the release; a re-run to green without
a diagnosis is forbidden ([flake doctrine](../../CLAUDE.md)). A `skipped` step is
accepted only when its note explains a deliberate absence (no subfolders in the
fixture tree, no analyzer in this home).

Read every screenshot against the sensitivities that have burned us before:

- **Sidebar geometry** — the folder split button (Open Folder + the recent-folders
  dropdown caret) never wraps its label under the caret and the caret never
  swallows the row; the sidebar tree/list never overlaps the details column;
  no row's badge or thumbnail is clipped by the sidebar's right edge.
- **Status badges** — icon inset and label padding symmetrical, no clipped text,
  the same height across pending/completed/error/duplicate.
- **Thumbnails** — real decoded frames appear when a folder opens, even before
  analysis; not-yet-analysed rows are signalled by the absent status badge and
  the "not analysed yet" details copy, not by placeholder art. Portrait clips
  are not stretched.
- **Scrollbars** — no double scrollbar in the sidebar or the details panel, no
  horizontal scrollbar on a long filename.
- **Empty states** — an empty folder, an unanalyzed video and an empty search
  result each say something, and never render a bare panel.
- **Polish copy** — with the UI language set to PL, no `key.path` leaks, no
  English fallback sentence, no clipped label in a narrower Polish string.
- **Layout** — the modal set (settings, wizard) is centred and fully inside the
  window at the walkthrough's window size (1920x1200 by default).
- **Kolekcja photos** — after `photos-tree-analyze`, the unified Kolekcja
  Zdjęcia chip reports at least one analyzed photo, its tiles remain square
  and evenly gapped, and `collection-photo-viewer` shows a real image from
  `media://local/` rather than a broken element.
- **Zdjęcia sidebar** — does the Zdjęcia sidebar show the folder header
  ("Ten folder"/"Całe drzewo" scope toggle), photo count badges
  (Przeanalizowane / Duplikat / Podgląd nieudany / Brak EXIF / Brak pliku) and a
  selection highlight?
- **Zdjęcia sidebar empty state** — with a fresh home, does the Zdjęcia
  sidebar show its own empty scan CTA, and never fall back to the video list?
- **Unanalysed video tile** — the `open-folder` screenshot is taken right
  after the folder opens, before the `analyze` step runs; with a fixtures
  folder holding 2+ videos (the runner's manifest note flags a fixtures
  folder with fewer), does at least one video row show the honest
  not-yet-analysed state, distinct from completed/error, in both this shot
  and the `search`/`select-video` shots taken later for the videos the
  `analyze` step never touched?
- **Completed analysis (the `analyze` step's hard evidence, W54)** — in the
  `analyze` screenshot, does the selected video show the **Ukończony** badge
  (not Błąd, not still-processing) next to the error/duplicate slot; a real
  decoded frame thumbnail (never a placeholder or broken image) for that
  video; and a description with tags visible in the details panel?
- **Populated Biblioteka** — in the `search` screenshot, does the Biblioteka
  hold more than 0 `plików`, and does the search return a real hit for the
  analyzed video rather than an empty-state panel?
- **Kolekcja hide/restore** — in the `library-hide-restore` screenshot, are the
  selected files back in the default Kolekcja view after visiting `Ukryte`, with
  no stale bulk action bar left over and no English fallback in the hide/restore
  controls?
- **Photos folder tree (W57/W60/W64)** — in the `photos-tree` screenshot, does the
  "Całe drzewo" scope render the collapsible tree (the root row and the
  expanded `subfolder` row the runner plants a photo into, each carrying an
  `analysed/total` count), not the flat "Ten folder" list; is a tree row
  visibly selected; and does the detail pane's "Analizuj" button read as
  enabled (not greyed out) for that tree-selected photo?
- **Tree-selected single-photo analysis (W60)** — in the `photos-tree-analyze`
  screenshot, does the selected photo's sidebar row carry the **Przeanalizowane**
  ("analysed") badge, with no error alert, proving the tree-selection ->
  single-photo-analyze path actually completes?
- **Kolekcja shows the analyzed photo (W55 payoff, W60)** — in the
  `collection-photo-analyzed` screenshot, does the Zdjęcia media chip in
  Biblioteka → Kolekcja read `Zdjęcia (N)` with `N >= 1`, and does the
  timeline itself show a photo tile (not just an incremented chip with an
  empty grid)?
- **Osoby** — in the `people` screenshot, does Biblioteka > Osoby render the
  `Osoby` heading with its Polish subtitle, and either the
  `Wszystko` / `Filmy` / `Zdjęcia` chips above a people grid whose cards are
  evenly gapped with unclipped names and counts, or an empty state that names
  the reason in Polish and offers the matching action? A bare panel, an English
  fallback sentence or a `key.path` leak fails the release.
- **Kopia zapasowa enabled (F14)** — in the `backup` screenshot, does Settings >
  Kopia zapasowa show the connected destination, the last-backup readout and a
  non-empty archive list in Polish, with no error alert; and in
  `backup-indicator`, does the bottom bar carry the backup indicator once
  Settings is closed?

The manual suites in [manual-test-checklists.md](manual-test-checklists.md) stay
the deeper pass; this walkthrough is the always-run floor beneath them.
