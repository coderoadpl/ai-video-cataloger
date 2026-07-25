# Manual QA Test Checklists — AI Video Cataloger

**Version under test:** v0.5.7 (branch `rewrite/foundation`)
**Author role:** Manual QA (ISTQB-informed). Suites are risk-ordered; each case is
independently executable.
**Platform:** macOS (Electron desktop app + `ai-video-cataloger` CLI).

## 1. Scope & environment

### In scope
Desktop app (catalog sidebar tree, analysis, search, media playback, faces,
settings, setup wizard, startup) and the CLI contract (NDJSON events, taxonomy
exit codes). Catalog integrity across file moves/deletions, and the single-writer
catalog lock shared between GUI and CLI.

### Out of scope
Real provider accuracy of AI summaries/transcripts (covered by
`npm run test:e2e:matrix`), packaged-bundle shape (`npm run verify:package`),
and unit/integration gates (`npm run check` / `npm run smoke`).

### Environment matrix
Run the SMOKE suite on every column of a release build; run FEATURE suites on at
least one representative column plus the specifically-called-out variants.

| Axis | Values |
|---|---|
| Install state | fresh install (empty HOME, no config) · upgrade over previous version (existing catalog DB + config) |
| macOS appearance | Light · Dark |
| UI language | English (EN) · Polish (PL) |
| Folder size | S (1–20 videos) · M (~200) · L (2,000–5,000, deep tree) |
| Drive type | internal SSD · external/USB · unplugged-mid-run (negative) |
| Chip / build | Apple Silicon (local models available) · Intel (local disabled, API/harness only) |

### Reference data sets
- **S-clean**: 5 short MP4s, mixed portrait/landscape, one non-faststart (moov at end).
- **S-edge**: empty folder; a folder with one silent/no-speech clip; a folder with
  unreadable permissions; a folder with unicode/NFD/emoji/very-long filenames.
- **M-tree**: ~200 videos across 3 levels, with 2 byte-identical duplicates in
  different subfolders.
- **L-tree**: 2k–5k videos, ≥4 levels deep, on an external drive.

### Conventions
- **Labels** below are the real shipped strings from `apps/web/src/i18n/dictionary.ts`,
  shown as **EN (PL)** where they differ.
- "Analyzed" = status Completed; "unanalyzed" = Pending/Not Tracked.
- CLI runs assume the binary resolves to `ai-video-cataloger` and `cwd` = the
  catalog folder unless `AVC_WORKING_DIRECTORY` is noted.

---

## 2. Smoke suite (SMK) — 10–15 min pre-release pass

Blocking gate: any FAIL here stops the release. Run on the packaged build.

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| SMK-01 | P1 | Packaged build installed; app not running | 1. Launch app (cold). 2. Watch first paint. | Window appears **immediately** with the branded splash (brand mark + app name + spinner), theme-correct, **no white flash**; splash is replaced by skeletons then the real UI. |
| SMK-02 | P1 | App open, fresh install | 1. Observe first-run. 2. After setup, open **Settings** and use **Run Setup Wizard (Uruchom kreatora konfiguracji)**. | Setup Wizard **Setup Wizard (Kreator konfiguracji)** opens or is reachable on first-run; the Settings affordance reopens it anytime without clearing config; welcome screen renders in the active UI language with no `key.path` leaks. |
| SMK-03 | P1 | App open | 1. Click **Open Folder (Otwórz folder)**. 2. Pick S-clean. | Sidebar lists all detected videos; folder header shows exact counts (e.g. `5 pending · 0 done` / `5 oczekuje · 0 gotowe`), never "about". |
| SMK-04 | P1 | Folder open, analyzer configured | 1. Select one Pending video. 2. Click **Analyze Video (Analizuj film)**. | Terminal streams per-step progress; on completion status flips to **Completed (Ukończony)**; Summary, Transcript, frames appear. |
| SMK-05 | P1 | ≥1 analyzed video | 1. Click a video row. | Detail view opens with tags, **Video Information (Informacje o filmie)**, and inline player. |
| SMK-06 | P1 | ≥1 analyzed video with audio | 1. In detail, press play. | Video plays inline (frame advances); if segments exist a subtitle track is present. |
| SMK-07 | P1 | ≥1 analyzed video | 1. Click the search box **Search catalog (Szukaj w katalogu)**. 2. Type a term from a known summary. 3. Enter. | Results list shows the match; clicking a result opens its detail. |
| SMK-08 | P2 | App open | 1. Open **Settings (Ustawienia)**. 2. Toggle **App language (Język aplikacji)** EN↔PL. 3. Save. | UI switches language **live** without restart. |
| SMK-09 | P2 | Terminal available | 1. Run `ai-video-cataloger health --json` in the folder. | One `started` + one `completed` NDJSON line; exit code 0. |
| SMK-10 | P2 | App open, a folder with a **Whole tree** scope chosen | 1. Cmd+Q / quit. 2. Relaunch. | App reopens to the last folder; no crash; sidebar width preserved; the **This folder / Whole tree** scope is restored per folder (not reset to This folder). |
| SMK-11 | P3 | Dark mode enabled at OS level before launch | 1. Launch. | Splash, skeletons, and full UI render in dark theme end-to-end. |
| SMK-12 | P3 | Folder open | 1. Right-click a video row. | Context menu with **Reveal in Finder (Pokaż w Finderze)** appears and reveals the file. |

---

## 3. Feature suites

### 3.1 TREE — sidebar catalog tree (scope, counts, duplicates)

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| TREE-01 | P1 | M-tree open, Whole tree scope | 1. Scroll from top to bottom of the tree. | **One** scroll container for the whole tree; no nested inner scroll regions, no windowing spacer gaps. |
| TREE-02 | P2 | M-tree open | 1. Inspect indentation of nested folders/videos. | Indent guide lines drawn per depth level; alignment consistent. |
| TREE-03 | P2 | M-tree open | 1. Click the root folder row's collapse toggle. | Root collapses/expands like any node. |
| TREE-04 | P1 | Folder with mixed statuses | 1. Read a folder header. | Exact counts `X pending · Y done` (`X oczekuje · Y gotowe`); unmarked folders show `N videos` (`N filmy/filmów`, PL-pluralized). No "about". |
| TREE-05 | P1 | M-tree with 2 duplicates in subfolders | 1. Locate the clone. | Clone shows **Duplicate (Duplikat)** badge with tooltip `Duplicate of <path>` (`Duplikat pliku <path>`); folder header duplicates segment counts them separately, e.g. `… · 1 duplicate`. |
| TREE-06 | P1 | Duplicate present, app just launched | 1. Trigger a re-scan / Analyze All. 2. Quit and relaunch. | Duplicate badge is **stable** across re-run and restart (does not flip to Pending). |
| TREE-07 | P2 | Scope = This folder, root has subfolders | 1. Set scope **This folder (Ten folder)**. | Shows a **flat** root-level video list with its own count; no subtree. |
| TREE-08 | P2 | Scope toggle | 1. Set scope **Whole tree (Całe drzewo)**. | Shows the full tree. |
| TREE-09 | P2 | Folder with no subfolders containing videos | 1. Inspect scope toggle. | Toggle disabled with tooltip **This folder has no subfolders with videos. (Ten folder nie ma podfolderów z filmami.)**; flat list shown. |
| TREE-10 | P1 | Fresh markerless tree (never analyzed) | 1. Open it, Whole tree scope. | Analyze-all is still offered as **Analyze All (up to N) (Analizuj wszystko (do N))** even without prior markers. |
| TREE-11 | P2 | Duplicate + original in different folders | 1. Click the clone row, then the original row. | Single global selection: only the clicked path highlights; detail follows the actually-clicked row. |
| TREE-12 | P3 | L-tree on external drive | 1. Open; expand several deep folders. | Lazy scan; windowed rendering stays responsive at 2k–5k rows; no freeze. |
| TREE-13 | P3 | Empty folder (S-edge) | 1. Open it. | **No videos found (Nie znaleziono filmów)**; no crash, no phantom counts. |

### 3.2 ANALYSIS — single / batch / tree runs, stop, force

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| ANL-01 | P1 | One Pending video | 1. **Analyze Video (Analizuj film)**. | Runs to Completed; button shows **Analyzing… (Analizowanie…)** while active; frames/transcript/summary populate. |
| ANL-02 | P1 | Root with several Pending | 1. Click **Analyze All (N) (Analizuj wszystko (N))**. | Batch processes each; per-file live status refresh in the sidebar; terminal shows `[current/total] Processing: <file>`. |
| ANL-03 | P1 | Whole tree scope, multiple folders | 1. Click Analyze All (whole tree). | Terminal streams per-folder lines `→ path (n file(s))` and `✓ path: d done, s skipped, f failed`, ending with a **run summary** (`=== Drive run complete: … ===`); on completion a **Folder Analysis Complete (Analiza folderu ukończona)** dialog shows folders/analyzed/skipped/failed counts. Rows carry **no** transient Skipped chip. |
| ANL-04 | P1 | Batch running | 1. Click **Stop (Stop)**. 2. Confirm **Stop Batch (Zatrzymaj wsad)**. | Batch stops after current file; already-processed keep results; message `Batch processing cancelled. Processed X of Y`. |
| ANL-05 | P1 | Single run active | 1. Click Stop. 2. Confirm **Cancel Analysis (Anuluj analizę)**. | Current analysis cancels; video may be left Incomplete with resume hint. |
| ANL-06 | P2 | An Incomplete video (interrupted) | 1. Select it. | Shows **Processing Incomplete (Przetwarzanie nieukończone)** with step-specific hint and **Continue Analysis (Kontynuuj analizę)**. |
| ANL-07 | P2 | An already-analyzed video | 1. Re-open detail. | No duplicate reprocessing offered; can retry only via explicit action. |
| ANL-08 | P1 | Duplicate video selected | 1. Open its detail. | **Duplicate block**: badge, **Original file (Plik oryginalny)** link (selects canonical in tree), explanation, and a **secondary** **Analyze anyway (Analizuj mimo to)** — **no primary Analyze** button. |
| ANL-09 | P2 | Duplicate detail | 1. Click **Analyze anyway**. | Runs `process` with `force`; the clone is analyzed on its own. |
| ANL-10 | P2 | Aggregate count uncertain (unindexed tree) | 1. Inspect tree Analyze-all label. | Shows **up to N** (`do N`) rather than an exact count. |
| ANL-11 | P2 | No-speech / silent clip (S-edge) | 1. Analyze it. | Completes; transcript is empty or minimal — **no hallucinated speech text** injected. |
| ANL-12 | P2 | Analyzer not configured (fresh) | 1. Try to analyze. | Readiness notice **Processing setup is incomplete (Konfiguracja przetwarzania jest niepełna)** with actions, not a raw error. |
| ANL-13 | P3 | Failed run (e.g. bad API key) | 1. Analyze. | Status **Error (Błąd)**; **Retry Analysis (Ponów analizę)** offered; terminal shows `Error: <message>`. |
| ANL-14 | P3 | Batch running | 1. Confirm both Analyze buttons. | Both Analyze buttons disabled while any run is active. |

### 3.3 SEARCH — dropdown, results, cross-folder

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| SRCH-01 | P2 | ≥1 recent search + tags exist | 1. Focus the search box. | Dropdown shows **Top tags (Najczęstsze tagi)** and **Recent searches (Ostatnie wyszukiwania)** with per-item delete (**Remove <label> / Usuń <label>**). |
| SRCH-02 | P2 | Recent searches present | 1. Click a recent-search delete (×). | That entry is removed from the list. |
| SRCH-03 | P1 | Analyzed videos across ≥2 folders | 1. Search a common term. | Results span folders; count shown as **N result(s) (N wyniki/wyników)**. |
| SRCH-04 | P1 | Search results shown | 1. Click a result from a different folder. | Opens that video's **detail** view (not just highlights the folder). |
| SRCH-05 | P1 | Search active with results | 1. Click a video in the sidebar. | Search is **cleared** and the detail view renders for the selected sidebar video. |
| SRCH-06 | P2 | Search a term with no matches | 1. Search gibberish. | **No results found (Brak wyników)**; no crash. |
| SRCH-07 | P3 | Search result whose drive is unplugged | 1. Search; inspect row. | Row annotated **drive not connected (dysk niepodłączony)** / **file missing (brak pliku)** as applicable. |
| SRCH-08 | P3 | Search result row | 1. Right-click a result row. | Context menu **Reveal in Finder (Pokaż w Finderze)**; reveals across folders. |

### 3.4 MEDIA — player, subtitles, thumbnails

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| MED-01 | P1 | Analyzed faststart MP4 | 1. Open detail, play. | Plays inline; `readyState ≥ 3`; `currentTime` advances. |
| MED-02 | P1 | **Non-faststart** video (moov at end) | 1. Open detail, play, then seek. | Plays **and seeks** correctly (server streams HTTP 206 partial content). Regression guard for the media-scheme fix. |
| MED-03 | P1 | **Unanalyzed** video | 1. Select it, play. | Plays inline just like an analyzed one (no analysis required to preview). |
| MED-04 | P2 | Video with transcript segments | 1. Play, enable captions. | Subtitle track present and synced. |
| MED-05 | P2 | Video without transcript | 1. Open detail. | No subtitle track; player still works. |
| MED-06 | P1 | Videos still generating thumbnails | 1. Watch sidebar rows. | Thumbnail box is a **square 56px** container; a theme-consistent **shimmer** shows while generating. |
| MED-07 | P1 | Portrait video | 1. Inspect its thumbnail. | Frame contained at **true aspect**, upright and centered inside the 56px box (not stretched/cropped square). |
| MED-08 | P2 | Video whose thumbnail generation failed | 1. Inspect its row. | Placeholder film icon shown **only** on failure/no-thumb — not as a loading state. |
| MED-09 | P3 | Range request semantics | 1. `curl -I` and `curl -r 0-1` the media URL (via devtools/CLI). | HEAD returns correct headers; out-of-range yields 416; valid range yields 206. |

### 3.5 FACES — opt-in, index, people ops, privacy

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| FACE-01 | P1 | Fresh install, faces off | 1. Open People. | **Face grouping is off (Grupowanie twarzy jest wyłączone)** with copy pointing to Settings; nothing indexed. |
| FACE-02 | P1 | Settings open | 1. Enable **Enable local face grouping (Włącz lokalne grupowanie twarzy)**. | Opt-in saved; helper reads all-on-device / deletable-anytime (**…grupowanie twarzy jest opcjonalne…**). |
| FACE-03 | P2 | Faces on, models missing | 1. Open People. | **Face grouping models are not installed (Modele grupowania twarzy nie są zainstalowane)** + **Install models (Zainstaluj modele)**. |
| FACE-04 | P1 | Faces on, models installed, folder analyzed | 1. Click **Index faces (Indeksuj twarze)**. | Indexing runs; groupings appear; log line **Face grouping index is updated (Indeks grupowania twarzy został zaktualizowany)**. |
| FACE-05 | P2 | ≥1 grouping | 1. Rename a grouping. | **Display name (Nazwa wyświetlana)** persists; affected files re-synced. |
| FACE-06 | P2 | ≥2 groupings | 1. Select two, **Merge selected (Scal wybrane)**. | Confirm dialog; observations moved into target; source removed. |
| FACE-07 | P1 | 1 grouping | 1. Delete a face grouping, confirm. | Grouping, observations (incl. embeddings), and exemplar crops deleted (per confirm copy). **Verify on disk**: crop files for that person are gone. |
| FACE-08 | P1 | Face data present | 1. **Delete all face data (Usuń wszystkie dane twarzy)**, confirm. | All groupings + crops wiped. **Verify**: `ai-video-cataloger faces status --json` returns `people:0, observations:0`; crop directory empty. |
| FACE-09 | P1 | Entry with faces, then forget the catalog entry | 1. Forget a cataloged video that had face observations. | Face observations/crops tied to that entry are cleaned up (faces hygiene on forget) — no orphaned embeddings. |
| FACE-10 | P2 | Re-index after engine change | 1. Re-run indexing. | Stale-version observations re-indexed; `faces status` stale count returns to 0. |
| FACE-11 | P1 | Any faces workflow | 1. Monitor network during index. | **Privacy**: no outbound network calls for face processing (all local). |

### 3.6 SETTINGS + WIZARD — languages, models, readiness

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| SET-01 | P1 | App open | 1. Settings → switch **App language (Język aplikacji)** EN→PL, Save. 2. Restart. | Switch applies **live** and **survives restart** (home-scoped, not folder-scoped). |
| SET-02 | P2 | Settings | 1. Change **Description language (Język opisów)**. | Saved; affects generated descriptions/filenames; tags stay English (per helper). |
| SET-03 | P2 | Settings | 1. Change **Frame Count (Liczba klatek)** / **Transcription Mode (Tryb transkrypcji)** / **Whisper Model (Model Whisper)**. | Values persist; folder-override hint shown where applicable. |
| SET-04 | P1 | Fresh wizard | 1. Walk the wizard steps. | Step order: Welcome → **Language (Język)** at **position 2** → Analyzer → Transcription → Downloads → Readiness → Done. |
| SET-05 | P1 | Wizard Analyzer step | 1. Try Local / API / Agent harness. | Model pickers validated; on Intel, local shows Apple-Silicon warning and API/harness offered. |
| SET-06 | P1 | Wizard Readiness step | 1. Reach **Final check (Końcowy test)**. | Full checklist with **green checks**; failures offer **GUI-actionable fixes** (e.g. **Fix in Transcription / Back to Analyzer**); **no CLI command strings** shown. |
| SET-07 | P2 | Wizard Welcome | 1. Read privacy copy. | Honest copy: app sends nothing to cloud by itself; data leaves only via user-chosen API/harness. |
| SET-08 | P2 | PL UI active | 1. Spot-check wizard, settings, people, terminal. | **No mixed-language views** on main surfaces; no untranslated EN leftovers, no raw i18n keys. |
| SET-09 | P3 | Model Manager | 1. Open **Models (Modele)**; download/activate/delete a whisper model. | Actions reflected with terminal log lines; disk usage shown. |
| SET-10 | P3 | Harness analyzer picker | 1. Enter a custom model id. | Marked **Unvalidated (Niezweryfikowany)**; passed as-is. |

### 3.7 CATALOG INTEGRITY — absent files, reveal, relocation

| ID | Pri | Preconditions | Steps | Expected |
|---|---|---|---|---|
| CAT-01 | P1 | Processed video, tree scope | 1. Delete the file on disk. 2. Re-run analyze on the tree. | Tree shows **Previously cataloged, now absent (Wcześniej skatalogowane, obecnie nieobecne)** section, grouped by folder. |
| CAT-02 | P2 | Absent section present | 1. Expand it. | Lazy-loads on expand; entries show **Last seen <date> (Ostatnio widziano <date>)**. |
| CAT-03 | P1 | Absent entry present | 1. Click **Forget (Zapomnij)**, confirm. | Entry removed from catalog (and its analysis/search data). |
| CAT-04 | P1 | Move a processed file to a sibling folder, re-run | 1. Move file. 2. Re-run tree analyze. | File is **relocated** (not marked missing, not re-analyzed); catalog points at the new location. |
| CAT-05 | P1 | Byte-identical copy exists elsewhere; original still on disk | 1. Re-run drive analyze. | Original keeps the canonical row; the copy stays a **Duplicate** — the clone does **not** steal the canonical row/flip to Pending. |
| CAT-06 | P2 | Two identical files, ambiguous origin | 1. Re-run. | Canonical chosen by **first-seen**, deterministic across re-runs (not path-sort). |
| CAT-07 | P2 | Reveal from various rows | 1. Right-click video (flat/tree/search) and folder rows → Reveal. | Cross-folder reveal opens Finder at the file/folder. |
| CAT-08 | P2 | Reveal a file outside all catalog folders | 1. Trigger reveal on an out-of-scope path. | Error toast **Could not reveal this file: it is outside every known catalog folder. (Nie można pokazać tego pliku…)** — no crash. |
| CAT-09 | P3 | Empty a whole folder (delete all its videos), re-run | 1. Re-run tree. | Reconciliation marks the folder's files absent; folder header reflects it. |

### 3.8 CONCURRENCY — GUI + CLI catalog lock

Error contract: a blocked writer fails with code **CATALOG_LOCKED** (exit **43**,
HTTP 423), carrying `{ pid, processName: 'gui'|'cli' }`.

| ID | Pri | Preconditions | Steps (exact commands) | Expected |
|---|---|---|---|---|
| LOCK-01 | P1 | GUI running a drive/batch job on folder F | 1. In terminal: `ai-video-cataloger process <F>/clip.mp4 --json`. | Fails with `error(CATALOG_LOCKED)`; exit code **43**; message includes the **PID** and process name of the GUI holder. |
| LOCK-02 | P1 | CLI holds the lock (a long `process-drive` running) | 1. In GUI, open F and start an analyze. | GUI shows a foreign-lock banner **Catalog locked by cli PID <pid> (Katalog zablokowany przez cli PID <pid>)** with **Retry (Ponów)**. |
| LOCK-03 | P1 | GUI **idle** (open but no job) on F | 1. Run `ai-video-cataloger config set output_language en --json` (a write). | Succeeds — an idle GUI holds **no** lock; exit 0. |
| LOCK-04 | P1 | A job crashes / process killed mid-run | 1. Start `process-drive`, `kill -9` it. 2. Immediately retry a write. | Stale lease is released/expired; the new writer acquires the lock (lock survives normal jobs but releases on failure). |
| LOCK-05 | P2 | Lock held by CLI, then CLI finishes | 1. Let `process-drive` complete. 2. Click **Retry** in the GUI banner. | Banner clears; GUI proceeds. |
| LOCK-06 | P2 | Two CLI writers race | 1. Start `process-drive <F>`. 2. In another shell `ai-video-cataloger reset --force`. | Second fails CATALOG_LOCKED / exit 43 with the first's PID. |

### 3.9 CLI SUITE — command families, NDJSON, exit codes

Every `--json` run emits newline-delimited JSON: a `started` object, zero+
`progress`, then `completed` (or `error`). Error objects carry `code`
(SCREAMING_SNAKE) and set the mapped exit code.

| ID | Pri | Command | Expected NDJSON / exit |
|---|---|---|---|
| CLI-01 | P1 | `ai-video-cataloger health --json` | `started` + `completed`; exit 0. |
| CLI-02 | P1 | `ai-video-cataloger doctor --json` | Lists dependencies; exit 0 if all available, else **PREREQUISITES_FAILED** exit **15**. |
| CLI-03 | P1 | `ai-video-cataloger scan <folder> --json` | Raw scan payload with `summary.total`; exit 0. |
| CLI-04 | P1 | `ai-video-cataloger status --json` | Summary counts (completed/inProgress/pending/error); exit 0. |
| CLI-05 | P1 | `ai-video-cataloger process <video> --json` | `started` → `progress`* → `completed`; exit 0 on success. |
| CLI-06 | P1 | `ai-video-cataloger process ./missing.mp4 --json` | `error` code **FILE_NOT_FOUND**, exit **11**. |
| CLI-07 | P2 | `ai-video-cataloger process ./notes.txt --json` | `error` **INVALID_FILE_TYPE**, exit **12**. |
| CLI-08 | P1 | `ai-video-cataloger process-drive <root> --json` | Drive events `run-started` / `folder-started` / `folder-done` / `run-summary`; exit 0. |
| CLI-09 | P2 | `ai-video-cataloger process-drive ./nope --json` | `error` **FOLDER_NOT_FOUND**, exit **26**. |
| CLI-10 | P2 | `ai-video-cataloger process-drive <file.mp4> --json` | `error` **NOT_A_DIRECTORY**, exit **27**. |
| CLI-11 | P1 | `ai-video-cataloger search "<term>" --json` | Raw results payload + count; exit 0. |
| CLI-12 | P2 | `ai-video-cataloger check <folder> --json` | Reports nested DBs; exit **29** (NESTED_DATABASES_FOUND) if any, else 0. |
| CLI-13 | P2 | `ai-video-cataloger config get --json` / `config set <key> <value> --json` | get echoes effective values; set confirms; unknown key → **UNKNOWN_CONFIG_KEY** exit **24**. |
| CLI-14 | P2 | `ai-video-cataloger reset --json` (no `--force`) | **FORCE_REQUIRED** exit **19**; with `--force` clears records, exit 0. |
| CLI-15 | P2 | `ai-video-cataloger index status --json` / `index rebuild --json` | status shows DB path + counts; rebuild reports reconciled/imported; exit 0. |
| CLI-16 | P3 | `ai-video-cataloger index forget <fingerprint> --json` | `deleted:true` if present else "No catalog entry"; exit 0. |
| CLI-17 | P2 | `ai-video-cataloger models list --json` / `models download <name> --json` | list enumerates whisper + local AI; download streams then completes; invalid model → **INVALID_MODEL** exit **16**. |
| CLI-18 | P2 | `ai-video-cataloger tags list --json` / `tags alias <from> <to> --json` | list returns tags+counts; alias reports remapped files; exit 0. |
| CLI-19 | P1 | `ai-video-cataloger faces status --json` | enabled/models/people/observations counts; exit 0. |
| CLI-20 | P2 | `ai-video-cataloger faces index <root> --json` | `started` → progress → `completed` with indexed/observations/people; exit 0 (or **FACES_DISABLED** exit **41** when off). |
| CLI-21 | P1 | `ai-video-cataloger faces forget <personId> --json` (no `--force`) | Reports force required; with `--force` deletes person + crops, exit 0. |
| CLI-22 | P1 | `ai-video-cataloger faces purge --force --json` | Wipes all people/observations/crops; exit 0. **Privacy verification anchor.** |
| CLI-23 | P3 | `ai-video-cataloger setup --analyzer local --transcription skip --yes --json` | Non-interactive setup; emits progress + completed; exit 0. |
| CLI-24 | P3 | `ai-video-cataloger process <video>` on a locked catalog | **CATALOG_LOCKED** exit **43** with holder PID (see LOCK-01). |

**Negative/boundary CLI extras:** run any command with an unknown flag →
commander usage error; run `process-drive` on an empty dir → **DRIVE_ROOT_EMPTY**
exit **39**; a fatal uncaught error → `Fatal error: …` on stderr, exit **1**.

---

## 4. Regression pack (REG) — one case per bug fixed this session

Each case reproduces the original defect and asserts the fixed behavior. Derived
from the owner findings ledger and fix commits since `89e6a6e3`.

| ID | Pri | Bug (original) | Repro | Expected (fixed) |
|---|---|---|---|---|
| REG-01 | P2 | Status badge icon had no left inset (`.MuiChip-icon` override matched nothing). | Inspect Completed/Pending/Duplicate badges in light + dark. | Icon left inset ≈ **8px** on every status glyph badge, both themes. |
| REG-02 | P1 | Thumbnails rendered stretched/square-cropped, no loading state. | View portrait + generating videos. | **56px square** box, frame at **true aspect** upright; **shimmer** while generating; placeholder **only** on failure. |
| REG-03 | P1 | Tree nested a windowed scroll per folder; approximate counts; root not collapsible. | Scroll M-tree; read headers; collapse root. | **One** scroll container; indent guides; root collapsible; **exact** counts (no "about"); duplicates segment in header. |
| REG-04 | P1 | Duplicate clone showed Pending + primary Analyze; badge unstable. | Open clone detail; re-run; restart. | Duplicate badge stable; detail shows **Duplicate block** with canonical link + secondary **Analyze anyway**, no primary Analyze. |
| REG-05 | P1 | `relocateResumedFile` let a byte-identical clone rewrite the canonical row → clone flipped Duplicate→Pending after a tree run. | Have original + subfolder clone; run `process-drive`. | Canonical row untouched while original exists on disk; clone stays **Duplicate** after the run. |
| REG-06 | P2 | Both a clone and its original highlighted; detail followed the wrong row. | Click clone then original. | Selection keyed on on-disk path; only clicked row highlights; detail matches. |
| REG-07 | P2 | Scope toggle didn't drive the view; disabled state had no tooltip. | Toggle This folder / Whole tree; open a subfolder-less folder. | This folder = flat root list w/ own count; Whole tree = tree; disabled + tooltip when no subfolders. |
| REG-08 | P1 | Whole-tree analyze unavailable on unindexed/markerless trees. | Open a never-analyzed tree. | Analyze All offered as **up to N**. |
| REG-09 | P2 | Subfolder video click didn't open detail; no single global selection. | Click a subfolder video. | Opens its detail; one global selection across the tree. |
| REG-10 | P2 | Search box had no focus dropdown; recent searches not deletable. | Focus search box. | Dropdown with Top tags + Recent searches (each deletable). |
| REG-11 | P1 | Clicking a search result didn't open detail; reveal failed across folders. | Click a cross-folder result; reveal it. | Result opens detail; reveal works across folders. |
| REG-12 | P1 | Selecting a sidebar video while searching left the main area on results. | With search active, click a sidebar video. | Search cleared; detail renders. |
| REG-13 | P2 | Sidebar width fixed at ~280px, not resizable/persistent. | Drag the sidebar handle; restart. | Default ~**440px**, drag-resizable (280–640), width persists across restart. |
| REG-14 | P1 | Startup showed a white flash before paint. | Cold-launch the packaged app (warm cache). | Window visible **immediately** with branded splash + skeletons, no white flash. Measure ms-to-window. |
| REG-15 | P1 | UI-language switch wrote folder-scoped, so it never applied/persisted. | Settings EN→PL, Save, restart. | Applies **live** and survives restart (home-scoped write). |
| REG-16 | P2 | Wizard had no Language step / wrong order. | Open wizard. | **Language** step at **position 2**; no mixed-language main surfaces (PL spot-check). |
| REG-17 | P1 | Non-faststart videos (moov at end) failed to demux — only faststart played. | Play + seek a non-faststart clip; play an unanalyzed clip. | Both play inline (`readyState≥3`, time advances) via HTTP Range (206); subtitle track present when segments exist. |
| REG-18 | P1 | Absent (deleted-but-cataloged) files never surfaced in **tree** mode. | Delete a processed file; run tree analyze. | Absent section appears in tree mode, grouped by folder, lazy on expand; **Forget** removes entry. |
| REG-19 | P2 | Absent-files query wasn't tree-scoped (wrong grouping/duplication). | Trigger absent section on a multi-folder tree. | Single tree-scoped query; each folder's absent entries listed once under the tree. |
| REG-20 | P1 | Catalog lock leaked / didn't survive jobs / didn't release on failure. | Run a job (lock held); crash a job; then write. | During a job, CLI write → CATALOG_LOCKED + PID; GUI banner on foreign lock; idle GUI holds no lock; lease releases on failure. |
| REG-21 | P2 | No Reveal-in-Finder context menu. | Right-click video (flat/tree/search) and folder rows. | Context menu with Reveal in Finder; invalid path → error toast. |
| REG-22 | P1 | Wizard readiness exposed CLI command strings / lacked GUI fixes. | Reach Readiness with a gap. | Full checklist, green checks, **GUI-actionable** fixes, **no CLI strings**, validated model pickers, honest privacy copy. |
| REG-23 | P2 | Whisper hallucinated speech on near-silent/no-speech audio. | Analyze a silent clip. | Transcript empty/minimal — hallucinated text filtered out. |
| REG-24 | P1 | Faces data (embeddings/crops) leaked after forget / engine re-index. | Forget an entry with faces; re-index after engine change. | Observations + crops cleaned on forget; stale-version files re-indexed; `faces status` counts consistent. |
| REG-25 | P2 | Moved files were incorrectly marked missing. | Move a processed file within the tree; re-run. | File relocated, not marked missing, not re-analyzed. |
| REG-26 | P2 | Read-only mode didn't cover all mutating actions. | Enter read-only (foreign lock) and try each mutating action. | Every mutating action is blocked/guarded while read-only. |
| REG-27 | P3 | Per-file NDJSON + live sidebar refresh missing during tree/batch runs. | Run a tree/batch analyze; watch terminal + sidebar. | Per-file NDJSON lines during the run, run summary at end, per-file live status refresh in the sidebar. |
| REG-28 | P1 | A legacy folder config carried an app-global `ui_language` (v0.4.x); dictionary read home (EN) while Settings read the folder override (PL), so saving EN "never applied". | Seed a folder whose `.ai-video-cataloger/config.json` has `{"ui_language":"pl"}` while home is EN; open the app; open Settings; switch EN↔PL and Save. | App language follows **home**; Settings reflects the same value; saving flips it live; the next folder write strips the app-global key from the folder config. |
| REG-29 | P1 | A processed file deleted then restored from Trash stayed listed under **Previously cataloged, now absent** because folder-scope analyze never reconciled presence. | Delete a processed file; run (it enters the absent section); restore it from Trash; refresh / run again. | The absent list self-heals: the restored file's `missing_at` is cleared and the absent section is empty for it — no whole-tree run required. |
| REG-30 | P2 | A transient **Skipped** chip shared the row badge slot with durable Completed/Duplicate, and no run summary surfaced skipped counts. | Run **Analyze All** where some files are skipped. | Rows show **no** Skipped chip; a **Folder Analysis Complete** dialog reports folders/analyzed/skipped/failed; terminal lines unchanged. |
| REG-31 | P2 | The duplicate detail **Analyze anyway** button had no top margin, touching the original-file link. | Open a duplicate detail block. | Clear top margin separates **Analyze anyway** from the canonical link. |
| REG-32 | P3 | No way to reopen the Setup Wizard after first run without clearing config. | Open **Settings** → **Run Setup Wizard**. | Wizard opens with pre-filled state; config is not cleared. |
| REG-33 | P3 | The **This folder / Whole tree** scope reset to This folder on relaunch. | Choose Whole tree for a folder; quit and relaunch. | Scope is restored per folder from localStorage. |

---

## 5. Exploratory charters (SBTM)

Session-based; timebox each 30–45 min. Record: setup, notes, bugs, follow-ups.

| ID | Mission | Areas | Risks | Timebox |
|---|---|---|---|---|
| EXP-01 | **Concurrency abuse** — hammer the catalog lock from GUI + multiple CLI writers simultaneously. | lock lease, PID reporting, banner/retry, read-only guard | deadlock, stale lease, double-write corruption | 45 min |
| EXP-02 | **Huge/deep trees** — open L-tree (2k–5k, ≥4 deep), expand aggressively, analyze-all, scroll. | lazy scan, windowing, exact counts, memory | freeze, count drift, OOM | 45 min |
| EXP-03 | **Hostile filenames** — unicode/NFD, emoji, RTL, spaces, very long (>200 chars), duplicate-looking names. | scan, thumbnails, reveal, rename, search | mojibake, path resolution, reveal failures | 40 min |
| EXP-04 | **Interrupted runs & power loss** — kill app/process mid-analyze, mid-index, mid-download; force-quit; simulate crash. | resume/continue, lock release, DB consistency, partial artifacts | corrupt DB, orphaned lock, stuck Incomplete | 45 min |
| EXP-05 | **Offline / external drives** — unplug drive mid-run, mid-playback, mid-search; reconnect at a different mount. | absent files, relocation, search offline annotation, media scheme | ghost entries, wrong "missing", playback hang | 40 min |
| EXP-06 | **Upgrade paths** — install previous version, build a catalog + faces + config, upgrade to v0.5.7. | schema/snapshot migration, config carry-over, badge stability | data loss, snapshot_incompatible, reset needed | 45 min |
| EXP-07 | **Privacy — faces data lifecycle on disk** — enable faces, index, name/merge, forget, purge; inspect on-disk crops/embeddings + network. | opt-in gating, forget/purge completeness, no network | leftover crops/embeddings after purge, outbound calls | 45 min |

---

## 6. Bug reporting convention

**Where to file:** the project's Todoist board (section = status). Add a
clickable link to any related PR/commit; never paste bare IDs.

**Severity (impact):**
- **S1 Blocker** — data loss/corruption, crash on launch, catalog lock deadlock,
  privacy leak (faces data or network egress), release-blocking.
- **S2 Major** — a core flow broken (analyze/search/playback) with no workaround.
- **S3 Minor** — feature works with a workaround; wrong counts; i18n leak.
- **S4 Trivial** — cosmetic (spacing, minor copy).

**Priority (fix order):** P1 fix now (blocks release) · P2 this cycle · P3 backlog.

**Required repro fields:**
1. Title (area + symptom).
2. Build/version (v0.5.7 + commit), OS + appearance, UI language, chip.
3. Environment-matrix column (install state, folder size, drive type).
4. Preconditions / data set (e.g. S-edge, M-tree).
5. Exact steps (numbered) — include the exact CLI command where relevant.
6. Expected vs actual.
7. Evidence: screenshot/screen-recording; for CLI, the full NDJSON output + exit
   code (`echo $?`); relevant terminal/log lines.
8. Severity + Priority + suspected area (tree/analysis/search/media/faces/
   settings/wizard/catalog/concurrency/cli).
9. Regression? link the REG-ID it maps to, if any.
