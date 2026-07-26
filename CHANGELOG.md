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

### Fixed

- Forgetting a provider key now always reaches the Keychain: an earlier keychain
  failure in the same process no longer makes the deletion skip the Keychain and
  report an untouched pair of backends while the key was still stored there. A
  Keychain that refuses the removal is still reported as retained, and a key
  held by both backends now names both as cleared.

## [0.5.18] - 2026-07-28

### Added

- The folder-scope catalog empty state now says how many videos the tree knows
  about in subfolders and offers a one-click switch to whole-tree scope; the
  bare `No videos found` stays when the whole tree is empty
  ([`b1bd860`](https://github.com/chomamateusz/ai-video-cataloger/commit/b1bd8600)).
- A stored provider key can be forgotten from the app: `DELETE /api/credentials`,
  `ai-video-cataloger config delete-credential <providerId> [--json]`, and a
  **Forget key** action beside the API key field in Settings. Each names the
  backends it cleared and never echoes the key
  ([`3696634`](https://github.com/chomamateusz/ai-video-cataloger/commit/36966341)).

### Changed

- Credential deletion answers with the backends it cleared and the ones that
  kept the key: when the Keychain refuses while the plaintext file was cleared,
  CLI and Settings say the removal was partial instead of claiming the key is
  gone, and a keychain that kept the only copy is reported as nothing cleared,
  never as a key that was not stored. `CredentialsStore.delete` and
  `SecretsStore.delete` carry that shape
  ([`3696634`](https://github.com/chomamateusz/ai-video-cataloger/commit/36966341),
  [`6f59eb3`](https://github.com/chomamateusz/ai-video-cataloger/commit/6f59eb37)).
- Model Manager closes from a footer Close button instead of Escape or a
  backdrop click only, every downloaded model carries its own contained
  `Activate` button, and both Delete actions (whisper models and local AI
  tiers) render in the error palette
  ([`c5145c2`](https://github.com/chomamateusz/ai-video-cataloger/commit/c5145c2b)).
- The `Not Tracked` status token no longer renders grey-on-grey: its
  `theme.ts` palette entry moves to `#4e4e53` on `#e3e3e6` in light and
  `#c7c7cc` on a 20% tint in dark, which also lifts the search-result and
  absent-file surfaces that share the token
  ([`c5145c2`](https://github.com/chomamateusz/ai-video-cataloger/commit/c5145c2b)).
- The terminal panel starts collapsed while it has no output, expands by itself
  on the first line, and stays wherever the user last put it once they toggle
  it by hand
  ([`c5145c2`](https://github.com/chomamateusz/ai-video-cataloger/commit/c5145c2b)).

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
  ([`c779068`](https://github.com/chomamateusz/ai-video-cataloger/commit/c779068d)).

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
  [`587d2eb`](https://github.com/chomamateusz/ai-video-cataloger/commit/587d2eb7),
  [`0be0931`](https://github.com/chomamateusz/ai-video-cataloger/commit/0be0931c)).

## [0.5.15] - 2026-07-28

### Added

- `doctor` and the readiness payload name the resolved whisper binary and its
  engine (`whisper.cpp` or `openai-whisper (python, CPU)`): dependency statuses
  carry an `engine` field and the readiness transcriber component carries
  `engine` and `binaryPath`
  ([`1c16eed`](https://github.com/chomamateusz/ai-video-cataloger/commit/1c16eedb)).
- `process` and `process-drive` accept `--provider <id>` to select a built-in
  analyzer provider by id (`openai`, `claude-code`, `codex`, `cursor-agent`,
  `local`, `gemini`), so harness providers no longer require a config write;
  it cannot be combined with the legacy `--analyzer` backend flag, which now
  rejects unknown values during parsing
  ([`bc0fe3e`](https://github.com/chomamateusz/ai-video-cataloger/commit/bc0fe3e0)).
- The readiness payload names the effective analyzer model, and `doctor` prints
  it as `(model: ...)` — `CLI default` for a harness provider left without a
  configured model, which is when the harness CLI picks the model itself
  ([`2cbaa5a`](https://github.com/chomamateusz/ai-video-cataloger/commit/2cbaa5a5)).

### Fixed

- Readiness for a configured Gemini-native analyzer no longer fails the
  response contract: the readiness analyzer family accepts every analyzer
  family, not just `api`, `harness`, and `local`
  ([`115657e`](https://github.com/chomamateusz/ai-video-cataloger/commit/115657ea)).
- An empty `~/.ai-video-cataloger/bin` directory is reported as an incomplete
  managed whisper install pointing at
  `ai-video-cataloger models whisper-runtime install`, instead of an absent one
  that silently fell through to a slower system whisper; readiness components
  now carry that `warning` rather than dropping it
  ([`b58ea86`](https://github.com/chomamateusz/ai-video-cataloger/commit/b58ea867)).

## [0.5.14] - 2026-07-27

### Added

- `pnpm run visual` — a Playwright screenshot suite that compares the layout
  skeletons (default, collapsed sidebar, open terminal, loading) in dark and
  light against darwin baselines committed under `visual/__screenshots__/`; it
  joins no required gate
  ([`beb5ad7`](https://github.com/chomamateusz/ai-video-cataloger/commit/beb5ad76)).
- `components/layout/` as a named structural layer, enforced by the
  `web-layouts-are-structure-only` dependency-cruiser rule, a `Container`/
  `AppBar`/`Drawer`/`Toolbar` import ban outside it, and config-regression
  probes ([`f1a624c`](https://github.com/chomamateusz/ai-video-cataloger/commit/f1a624c4),
  [`24a932b`](https://github.com/chomamateusz/ai-video-cataloger/commit/24a932b9)).

### Changed

- `doc-lint` fails when a tracked `README.md` documents a `pnpm run <script>`
  that the owning `package.json` does not define, so a renamed or dropped script
  can no longer leave a quickstart that lies
  ([`ce2a272`](https://github.com/chomamateusz/ai-video-cataloger/commit/ce2a2723)).
- The package manager is pnpm 10 on Node 22.23.1: install with `pnpm install`
  under `nvm use`, dependency lifecycle scripts are blocked except for three
  allowlisted packages, and `lock-lint` now fails closed on a `pnpm-lock.yaml`
  that disagrees with `package.json`
  ([`2149503`](https://github.com/chomamateusz/ai-video-cataloger/commit/21495031),
  [`5d3f273`](https://github.com/chomamateusz/ai-video-cataloger/commit/5d3f273f)).

## [0.5.13] - 2026-07-27

### Added

- Read-only folders open in a degraded, index-only mode: the catalog is indexed
  in the home database and the per-folder snapshot write is skipped instead of
  failing the run ([`e117349`](https://github.com/chomamateusz/ai-video-cataloger/commit/e117349a),
  [`6d9b0d9`](https://github.com/chomamateusz/ai-video-cataloger/commit/6d9b0d96)).
- The opened folder tree is watched, so files added or removed on disk refresh
  the sidebar without a manual rescan
  ([`64a4f12`](https://github.com/chomamateusz/ai-video-cataloger/commit/64a4f125)).
- The setup wizard offers the Gemini-native analyzer and skips transcription
  setup for it, since that provider reads the video directly
  ([`895a119`](https://github.com/chomamateusz/ai-video-cataloger/commit/895a119d),
  [`2526982`](https://github.com/chomamateusz/ai-video-cataloger/commit/25269822)).

## [0.5.12] - 2026-07-27

### Added

- Gemini-native video analysis: a provider that uploads the video itself
  instead of extracted frames, selectable in Settings → AI Analyzer
  ([`b000331`](https://github.com/chomamateusz/ai-video-cataloger/commit/b0003315),
  [`1408252`](https://github.com/chomamateusz/ai-video-cataloger/commit/14082524)).

## [0.5.10] - 2026-07-26

### Fixed

- The detail player defaults subtitles on, boxes the video at its true aspect
  and lays the panel out in two columns
  ([`ba67a9b`](https://github.com/chomamateusz/ai-video-cataloger/commit/ba67a9b8)).
- Force-analyze shows Processing immediately and the tree detail refreshes when
  the run completes ([`e9373b5`](https://github.com/chomamateusz/ai-video-cataloger/commit/e9373b59)).
- Search results gained a back affordance and 56px thumbnails
  ([`37dc644`](https://github.com/chomamateusz/ai-video-cataloger/commit/37dc644d)).
- `doctor` detects a stale CLI shadowing the current one on `PATH` and names the
  shadow in the install flow
  ([`a7aa671`](https://github.com/chomamateusz/ai-video-cataloger/commit/a7aa671e)).

## [0.5.9] - 2026-07-26

### Added

- Analyze scope is remembered per folder, and the setup wizard can be re-entered
  from the app ([`51a3839`](https://github.com/chomamateusz/ai-video-cataloger/commit/51a38391)).
- A run summary dialog replaces the transient skipped chips
  ([`f563fa5`](https://github.com/chomamateusz/ai-video-cataloger/commit/f563fa56)).
- `health` splits live and ready, and responses travel through one response seam
  ([`5a0db8b`](https://github.com/chomamateusz/ai-video-cataloger/commit/5a0db8b3)).

### Changed

- Contracts are validated with zod 4
  ([`71ad5b1`](https://github.com/chomamateusz/ai-video-cataloger/commit/71ad5b15)).
- `pnpm run check` gained knip, doc-lint and a coverage ratchet; a local ESLint
  plugin enforces query descriptors and the event-name taxonomy
  ([`7634d55`](https://github.com/chomamateusz/ai-video-cataloger/commit/7634d556),
  [`680c3b5`](https://github.com/chomamateusz/ai-video-cataloger/commit/680c3b58)).
- CI runs on self-hosted workflows with an `ai-review` job
  ([`bfea9b2`](https://github.com/chomamateusz/ai-video-cataloger/commit/bfea9b22)).

### Fixed

- `ui_language` and `faces_enabled` resolve app-global, so a poisoned per-folder
  config can no longer flip the UI language
  ([`611be64`](https://github.com/chomamateusz/ai-video-cataloger/commit/611be64c)).
- A restored file clears its absent flag through a self-healing absent list
  ([`5639f23`](https://github.com/chomamateusz/ai-video-cataloger/commit/5639f23f)).
- The canonical row for duplicate files is chosen by a deterministic tie-break
  ([`e84b717`](https://github.com/chomamateusz/ai-video-cataloger/commit/e84b717b)).

## [0.5.8] - 2026-07-25

### Fixed

- Status badge icons align with their labels and the frame gallery is fully
  translated ([`0180eda`](https://github.com/chomamateusz/ai-video-cataloger/commit/0180eda5)).

## [0.5.7] - 2026-07-25

### Fixed

- The catalog write lock renews its lease across long jobs and is released when
  a job fails ([`346bffc`](https://github.com/chomamateusz/ai-video-cataloger/commit/346bffca)).
- Whole-tree analyze is available on a tree that has not been indexed yet
  ([`895dafc`](https://github.com/chomamateusz/ai-video-cataloger/commit/895dafcc)).
- A search result opens its detail view, and Reveal in Finder works across
  folders ([`dfa7da9`](https://github.com/chomamateusz/ai-video-cataloger/commit/dfa7da90)).
- Absent files are fetched with one tree-scoped query instead of one per folder
  ([`19122d6`](https://github.com/chomamateusz/ai-video-cataloger/commit/19122d6c)).
- The media scheme answers HEAD and returns 416 for an unsatisfiable range
  ([`4635a22`](https://github.com/chomamateusz/ai-video-cataloger/commit/4635a221)).
- A relocated file keeps the original row chosen by first-seen time rather than
  path sort order ([`6da397b`](https://github.com/chomamateusz/ai-video-cataloger/commit/6da397b1)).
- UX audit batch: untranslated strings, accessibility labels, plurals and
  tooltips ([`9978068`](https://github.com/chomamateusz/ai-video-cataloger/commit/9978068f)).

## [0.5.6] - 2026-07-24

### Added

- Reveal in Finder from video, folder and search rows
  ([`a9f7e55`](https://github.com/chomamateusz/ai-video-cataloger/commit/a9f7e559)).
- Absent files appear in tree mode grouped by folder
  ([`b4c123c`](https://github.com/chomamateusz/ai-video-cataloger/commit/b4c123ce)).

### Fixed

- Media is served over a standard scheme with HTTP Range support, so seeking
  works in the player ([`894b232`](https://github.com/chomamateusz/ai-video-cataloger/commit/894b2326)).
- A duplicate clone no longer steals the canonical catalog row
  ([`9eff27c`](https://github.com/chomamateusz/ai-video-cataloger/commit/9eff27c3)).
- The Settings UI-language switch is written home-scoped and takes effect
  ([`bda7ace`](https://github.com/chomamateusz/ai-video-cataloger/commit/bda7acee)).
- Selecting a video in the sidebar clears an active search
  ([`edbeb58`](https://github.com/chomamateusz/ai-video-cataloger/commit/edbeb58b)).

## [0.5.5] - 2026-07-24

### Changed

- The packaged bundle is smaller and ships a sealed ad-hoc signature
  ([`a4e4c41`](https://github.com/chomamateusz/ai-video-cataloger/commit/a4e4c412),
  [`624bc93`](https://github.com/chomamateusz/ai-video-cataloger/commit/624bc932)).

### Fixed

- The window is shown at `whenReady`, removing the black frame at launch
  ([`bb03367`](https://github.com/chomamateusz/ai-video-cataloger/commit/bb03367c)).

## [0.5.4] - 2026-07-24

### Fixed

- Sidebar round three: rail width, scope selection, thumbnail loading state,
  duplicate detail and badge spacing
  ([`1371836`](https://github.com/chomamateusz/ai-video-cataloger/commit/1371836a)).

## [0.5.3] - 2026-07-24

### Fixed

- The desktop window appears immediately and app composition is deferred behind
  it ([`072b5de`](https://github.com/chomamateusz/ai-video-cataloger/commit/072b5ded)).

## [0.5.2] - 2026-07-24

### Added

- A startup splash and loading skeletons for the sidebar and detail panel
  ([`7173807`](https://github.com/chomamateusz/ai-video-cataloger/commit/71738071)).

### Changed

- Sidebar tree v2: one scroll container, exact per-folder counts and duplicate
  badges ([`153e750`](https://github.com/chomamateusz/ai-video-cataloger/commit/153e7506)).

## [0.5.1] - 2026-07-24

### Added

- A single-writer catalog lock that names the holding process
  ([`1de387b`](https://github.com/chomamateusz/ai-video-cataloger/commit/1de387b3),
  [`3e685b7`](https://github.com/chomamateusz/ai-video-cataloger/commit/3e685b70)).
- Lazy folder scanning and windowed lists, with guidance for very large runs
  ([`0fe706e`](https://github.com/chomamateusz/ai-video-cataloger/commit/0fe706e2)).

### Fixed

- Reconciliation covers moved and emptied folders
  ([`f1ce261`](https://github.com/chomamateusz/ai-video-cataloger/commit/f1ce261e)).
- Forgetting an entry and re-indexing an engine clean up face data
  ([`0ebb436`](https://github.com/chomamateusz/ai-video-cataloger/commit/0ebb4364)).
- Read-only mode disables every mutating action, not just the obvious ones
  ([`45f4f5b`](https://github.com/chomamateusz/ai-video-cataloger/commit/45f4f5bd)).
- Remaining untranslated strings in settings, steps and the people log
  ([`c343c68`](https://github.com/chomamateusz/ai-video-cataloger/commit/c343c685)).

## [0.5.0] - 2026-07-24

### Added

- A sidebar folder tree with scope-aware analyze: per-file live progress, a stop
  control and skip badges
  ([`6dfd77a`](https://github.com/chomamateusz/ai-video-cataloger/commit/6dfd77a6)).
- A coherent setup wizard with a readiness checklist and model pickers
  ([`6901f51`](https://github.com/chomamateusz/ai-video-cataloger/commit/6901f511)).
- Content presentation: detail tags, source-aspect thumbnails, an inline player
  with subtitles and a search dropdown
  ([`7e49f63`](https://github.com/chomamateusz/ai-video-cataloger/commit/7e49f637)).
- A UI language layer (EN/PL) covering the desktop app and the wizard
  ([`1be3025`](https://github.com/chomamateusz/ai-video-cataloger/commit/1be3025d),
  [`fefd4e1`](https://github.com/chomamateusz/ai-video-cataloger/commit/fefd4e1b),
  [`141bdfd`](https://github.com/chomamateusz/ai-video-cataloger/commit/141bdfdf),
  [`bc8e4ac`](https://github.com/chomamateusz/ai-video-cataloger/commit/bc8e4ac5)).
- An output-language setting for generated summaries and names
  ([`787d7f5`](https://github.com/chomamateusz/ai-video-cataloger/commit/787d7f5d)).
- Missing-file reconciliation with an absent-files section in the folder view
  ([`c060823`](https://github.com/chomamateusz/ai-video-cataloger/commit/c0608235),
  [`abf483e`](https://github.com/chomamateusz/ai-video-cataloger/commit/abf483e0)).

### Fixed

- Thumbnails are generated at the source aspect ratio
  ([`4901f26`](https://github.com/chomamateusz/ai-video-cataloger/commit/4901f26e)).
- Whisper hallucinations on near-silent audio are filtered out
  ([`e970a21`](https://github.com/chomamateusz/ai-video-cataloger/commit/e970a217)).
- A moved file is no longer reported as missing
  ([`ea0c2ce`](https://github.com/chomamateusz/ai-video-cataloger/commit/ea0c2ce2)).
- Model selection is scoped per analyzer harness
  ([`1278e89`](https://github.com/chomamateusz/ai-video-cataloger/commit/1278e89c)).

## [0.4.2] - 2026-07-23

### Added

- The packaged app carries an icon generated from the brand logo
  ([`380cff5`](https://github.com/chomamateusz/ai-video-cataloger/commit/380cff5b)).

### Fixed

- Harness path resolution, the packaged CLI's WASM asset, catalog flushing and
  chip spacing ([`9d0c09d`](https://github.com/chomamateusz/ai-video-cataloger/commit/9d0c09d6)).

## [0.4.1] - 2026-07-23

### Added

- Analyze a whole folder tree from the desktop app
  ([`0c3e3ba`](https://github.com/chomamateusz/ai-video-cataloger/commit/0c3e3ba5)).

## [0.4.0] - 2026-07-23

### Added

- A home-scoped global catalog: folder identity, content fingerprints, a SQLite
  index and per-folder NDJSON snapshots
  ([`ccc548d`](https://github.com/chomamateusz/ai-video-cataloger/commit/ccc548dd)).
- Global search across the catalog through an FTS4 index, in the CLI and the
  desktop UI ([`91cc269`](https://github.com/chomamateusz/ai-video-cataloger/commit/91cc269a)).
- Local face grouping: an opt-in ONNX pipeline, a people view and face settings
  ([`1631c1e`](https://github.com/chomamateusz/ai-video-cataloger/commit/1631c1e1),
  [`7421336`](https://github.com/chomamateusz/ai-video-cataloger/commit/7421336f),
  [`ec5cc5f`](https://github.com/chomamateusz/ai-video-cataloger/commit/ec5cc5fa),
  [`b2fa7da`](https://github.com/chomamateusz/ai-video-cataloger/commit/b2fa7da3)).
- A whole-drive runner with discovery, resume, backoff and run bookkeeping
  ([`279f3ad`](https://github.com/chomamateusz/ai-video-cataloger/commit/279f3ad0)).
- Analyzer tags and GPS capture in the catalog
  ([`e8a717b`](https://github.com/chomamateusz/ai-video-cataloger/commit/e8a717bd)).
- API keys are stored in the macOS Keychain, falling back to the config file
  ([`5995f06`](https://github.com/chomamateusz/ai-video-cataloger/commit/5995f066)).

### Fixed

- Forgetting a person deletes its biometric observations instead of only
  unassigning them ([`858ad75`](https://github.com/chomamateusz/ai-video-cataloger/commit/858ad757)).
- Snapshot export is atomic, rejects newer-major snapshots and counts malformed
  lines ([`4ba07bd`](https://github.com/chomamateusz/ai-video-cataloger/commit/4ba07bd2)).
- A file that cannot be fingerprinted raises a warning event instead of failing
  silently ([`861aaa1`](https://github.com/chomamateusz/ai-video-cataloger/commit/861aaa17)).
- Global-catalog writes are batched, removing quadratic write amplification on
  large folders ([`4e5a2ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/4e5a2ea9)).
- Face indexing is resumable and clusters across runs; aligned crop pixels are
  released so memory stays proportional to faces per file
  ([`7995a13`](https://github.com/chomamateusz/ai-video-cataloger/commit/7995a137),
  [`73a554a`](https://github.com/chomamateusz/ai-video-cataloger/commit/73a554a1)).
- The Keychain lookup times out after 10s and falls back to the config file
  ([`497d5d5`](https://github.com/chomamateusz/ai-video-cataloger/commit/497d5d55)).
- `whisper-cli` is preferred over CPU python whisper in system resolution
  ([`687545c`](https://github.com/chomamateusz/ai-video-cataloger/commit/687545c2)).
- Local AI requirements are probed only when the local analyzer is chosen
  ([`39331ed`](https://github.com/chomamateusz/ai-video-cataloger/commit/39331ed3)).
