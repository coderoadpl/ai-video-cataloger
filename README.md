# AI Video Cataloger

A local-first Electron and CLI app that analyzes, transcribes, summarizes, and renames video files using AI.

## What It Does

1. Extracts frames from videos using FFmpeg
2. Transcribes audio with local Whisper, OpenAI Whisper API, or skip mode
3. Analyzes content with Claude Code CLI or a fully local Ollama model
4. Renames files with descriptive, date-prefixed names

Supported formats: MP4, MOV, AVI, MKV, WebM.

## Privacy

The app itself sends nothing to the cloud. Your data — frames and transcripts —
leaves this machine only if you choose to send it to your own providers: an API
key you enter, or an agent CLI harness you already use (Claude Code, Codex,
Cursor). A fully local Ollama model keeps everything on your Mac.

## What's New in v1.1

- Choose an OpenAI-compatible API, Claude Code, Codex, Cursor Agent, a custom
  agent harness, or a local Ollama model for analysis.
- Use the guided Setup Wizard in the desktop app or run
  `ai-video-cataloger setup` in a terminal.
- Install and use a managed whisper.cpp runtime, or point the app at an
  existing whisper.cpp executable.

## GUI Quick Start

```bash
nvm use          # Node 22.23.1, per .nvmrc — its Corepack activates the pinned pnpm
pnpm install
pnpm run electron:dev
```

The desktop app includes folder browsing, thumbnails, single/batch processing, settings, prerequisites, Whisper model management, local AI model management, native menus, and resumable catalog state.

Package the app:

```bash
pnpm run electron:package
```

The DMG and packaged macOS app are written under `release/`. The `.app` also
stages a standalone CLI at `resources/cli`; for development, use `pnpm run cli`
or the staged `dist/cli/index.js` from this repo.

## First Open on macOS

The app is not yet signed or notarized. After copying it to Applications,
right-click **AI Video Cataloger**, choose **Open**, then confirm **Open**. If
macOS still blocks it, open **System Settings → Privacy & Security**, find the
message about AI Video Cataloger, and choose **Open Anyway**.

## CLI Usage

Stage the CLI bundle:

```bash
pnpm install
pnpm run package:stage
```

Run it directly:

```bash
node dist/cli/index.js doctor
node dist/cli/index.js scan /path/to/videos
node dist/cli/index.js process /path/to/videos/video.mp4 --frames 3 --whisper local --whisper-model base --analyzer claude
node dist/cli/index.js status
```

During development:

```bash
pnpm run cli -- doctor
pnpm run cli -- process ./clip.mp4 --json
```

Core commands:

```text
setup
health
doctor [--json]
check [folder] [--json]
scan <folder> [--json]
search [query] [--tag <name>...] [--person <nameOrId>...] [--place <text>] [--from <iso>] [--to <iso>] [--has-gps|--no-has-gps] [--folder <path>] [--hidden exclude|only|include] [--sort relevance|captured_desc|captured_asc|name_asc] [--limit <n>] [--offset <n>] [--json]
library hide [query] [--tag <name>...] [--person <nameOrId>...] [--place <text>] [--from <iso>] [--to <iso>] [--has-gps|--no-has-gps] [--folder <path>] [--hidden exclude|only|include] [--media all|video|photo] [--fingerprint <id>...] [--of-person <personId>] [--skip-shared] [--json]
library unhide [query] [--tag <name>...] [--person <nameOrId>...] [--place <text>] [--from <iso>] [--to <iso>] [--has-gps|--no-has-gps] [--folder <path>] [--hidden exclude|only|include] [--media all|video|photo] [--fingerprint <id>...] [--of-person <personId>] [--skip-shared] [--json]
library trash [query] [--tag <name>...] [--person <nameOrId>...] [--place <text>] [--from <iso>] [--to <iso>] [--has-gps|--no-has-gps] [--folder <path>] [--hidden exclude|only|include] [--media all|video|photo] [--fingerprint <id>...] [--of-person <personId>] [--skip-shared] [--dry-run] [--yes] [--json]
process <path> [-f number] [-s] [-v] [-t seconds] [-w local|api|skip] [--whisper-model model] [--analyzer claude|local|api] [--provider openai|claude-code|codex|cursor-agent|local|gemini] [--local-model tag] [--json]
process-drive <root> [--gemini-batch] [--skip-faces] [--json]
materialize <root> [--dry-run] [--keep-awake] [--json]
variants list <path> [--json]
variants import-translation <ndjson> [--dry-run] [--no-select] [--json]
variants select <path> --config <configId> [--json]
variants delete <path> --config <configId> [--json]
variants default <folder> (--config <configId>|--clear) [--json]
thumbnail <video-path> [--force] [--json]
thumbnails <root> [--force] [--json]
gps backfill <timeline.json> [--root <path>] [--dry-run] [--tolerance-minutes 30] [--max-visit-hours 36] [--reresolve-places] [--json]
backup now [--tier critical|optional] [--json]
backup status [--test-connection] [--json]
backup list [--tier critical|optional] [--json]
backup restore <remoteId> [--recovery-key] [--yes] [--json]
status [--json]
reset [filename] [--force] [--json]
config get [key] [--json]
config set <key> <value> [--json]
config set-credential <providerId>
config delete-credential <providerId> [--json]
index status|rebuild|forget
tags list|alias|suggest-aliases
faces index|people|name|merge|forget|purge|status|recluster|exemplars
photos scan|status|forget|proxies|process
photos grid-thumbs [--force] [--json]
photos gps backfill <timeline.json> [--root <path>] [--dry-run] [--tolerance-minutes 30] [--max-visit-hours 36] [--reresolve-places] [--json]
photos import-libra <artifacts-dir> --manifest <path> [--dry-run] [--json]
photos search <query> [--limit <n>] [--json]
photos variants list <fingerprint> [--json]
photos variants select <fingerprint> <configId|none> [--json]
photos variants delete <fingerprint> <configId> [--json]
photos variants folder-default <folderId> <configId|none> [--json]
models list|requirements|pull|rm|daemon-stop|use|download|delete|faces status|faces install
models whisper-runtime status|install
```

Config keys: `whisper_model`, `whisper_mode`, `frames`, `timeout`, `skip_rename`, `analyzer_backend`, `local_model`, `gemini_batch_mode`, `output_language`, `tag_language`, `backup_enabled`, `backup_provider`, `backup_include_optional`, `backup_keep_last`, `backup_keep_weekly`, `backup_folder_id`, `backup_shared_drive_id`, `backup_service_account_fingerprint`, `backup_account_email`. `tag_language` follows `output_language` until you set it.

`backup now` runs a backup immediately, ignoring the daily schedule and the
change fingerprint, and streams one `progress` event per backup phase; it exits
`BACKUP_DISABLED` (47) while backup is switched off. `backup status` prints
whether backup is enabled, the provider, the connected account or key
fingerprint, the last success, the next due date, the last error, the retention
settings, and the indicator state; `--test-connection` additionally runs the
destination's connection test.
`backup list` prints remote backup date, tier, size, app version, schema versions,
and remote id; `--json` emits a completed NDJSON event carrying the array.
`backup restore <remoteId>` refuses with `CONFIRMATION_REQUIRED` until `--yes`
is supplied, printing the tier, date, and size that will be overwritten. With
`--yes`, restore streams the same job `started` / `progress` / `completed` /
`error` NDJSON envelopes as other long-running commands and prints a restart
instruction when the swap completes. On a Mac whose Keychain never held the
backup key, add `--recovery-key`: the key is read from the
`AVC_BACKUP_RECOVERY_KEY` environment variable, or, when that is unset, from a
hidden terminal prompt. The key is never passed as a command-line argument, so
it stays out of `ps` output and shell history.

Each file handled by `process` or `process-drive` uses one resolved
configuration; an invocation does not request a configuration matrix. Running
the same content with a different analyzer, transcription source, frame count,
output language, or prompt version adds an analysis variant. Repeating the same
content and configuration is skipped, while `--force` replaces only that
variant.

Use `variants list` to inspect every stored configuration for a video.
`variants select` chooses the variant used by search and by the name-based
artifacts on disk. `variants delete` removes one variant but refuses to remove
the last one. `variants default` sets the preferred configuration for files in
a folder; `--clear` restores the resolved processing configuration as the
folder fallback. A file's explicit selection is shared by duplicate copies of
the same content.

`variants import-translation <ndjson>` validates one translation interchange
object per line and upserts Polish variants keyed by the source configuration,
translator provider, and model. Tags use the same ASCII transliteration and
normalization as live analysis. The imported variant becomes selected unless
`--no-select` is present; `--dry-run` reports created, updated, skipped, and
invalid counts without changing the catalog or artifacts. In `--json` mode the
command emits one progress envelope per input row followed by the completed
summary envelope.

`tags suggest-aliases` proposes tag merges (normalisation, English and Polish
plurals, spelling variants) with file counts and never writes anything; apply
one with `tags alias <from> <to>`. Search follows aliases in both directions,
so after merging `dogs` into `psy` a search for either term finds the same
files. Quoted phrases are matched literally and are not expanded.

`search` accepts an agent-grade filter set without a text query — a bare
`search --tag beach --json` browses the catalog by filter alone. `--tag` and
`--person` are repeatable (AND across tags, OR across people); `--tag` follows
aliases the same way a text query does. `--person` accepts a display name
(resolved case-insensitively against `faces people`, erroring on zero or
multiple matches) or a raw `person-…` id. `--place` matches a case-insensitive
substring over the place name/region/country; `--from`/`to` bound `captured_at`
(ISO date or datetime). `--has-gps`/`--no-has-gps` filter on GPS presence;
`--folder <path>` restricts results to a folder the catalog already knows
(an unrecognised path is a validation error, same taxonomy as every other
`search` failure — no new error or exit codes). `--hidden` defaults to
`exclude`; use `--hidden only` to list hidden videos and `--hidden include` to
mix hidden and visible videos. `--sort` defaults to
`relevance` when a text query is present and to `captured_desc` otherwise; the
`--json` envelope's `completed` payload always carries `total` (the full
filtered match count, independent of `--limit`/`--offset`) alongside
`results[].capturedAt`/`results[].place`.

`library hide` and `library unhide` apply the same filter flags as `search` and
can also select by `--fingerprint`, `--media`, or `--of-person`. Exactly one
selection scope is required. `library trash` previews the selected files with
`--dry-run`; moving files to the macOS Trash requires `--yes` and refuses the
whole selection when any affected root is unavailable or not writable. JSON
mode streams the normal NDJSON `started`, row/progress, `completed`, and
`error` envelopes; missing confirmation exits as `CONFIRMATION_REQUIRED` (18).

In `--json` mode, a successful `process` completion adds `configId` and
`selectedConfigId` to its `completed.data`. A `catalog_index_skipped` progress
event adds `configId`; an existing variant reports `reason: "variant_exists"`.
Verbose processing can emit `artifact_reused` with `kind` (`frames` or
`transcript`), `configId`, and `sourceConfigId`. `variants list --json` writes
one NDJSON row per variant with `configId`, `descriptor`, `selected`,
`createdAt`, analyzer, model, and `estimatedCostUsd` when known, followed by its
normal `completed` envelope. The per-folder `catalog.ndjson` snapshot records
an `analyses` array with nullable resolved output/tag-language provenance and
`selectedConfigId`; older variant rows without that provenance and older
single-analysis snapshots remain importable.

`--gemini-batch` (config key `gemini_batch_mode`) sends a whole `process-drive`
run to the Gemini Batch API at half the interactive token price; results
usually arrive in minutes but the API allows up to 24 hours, and a run killed
mid-flight re-attaches to the same job on the next run
([ADR-0008](docs/decisions/0008-gemini-batch-drive-runs.md)).

With `faces_enabled=true`, a completed `process-drive` run builds the people index
itself: after the last folder is analysed it runs one face-indexing pass over the same
root, emitting `faces_scanning` and `faces_done` NDJSON events and a `faces` block in
`run-summary` (`ran`, `skippedReason`, `filesIndexed`, `observationsAdded`,
`peopleCreated`). `--skip-faces` turns that pass off for one run. When the pass cannot
run — models not installed, engine unavailable, run cancelled, pass failed — the run
still succeeds and says so through a `faces_pass_skipped` event and the same summary
block; `ai-video-cataloger faces index <root>` builds the index afterwards
([ADR-0011](docs/decisions/0011-faces-pass-in-drive-runs.md)). A file that cannot be
decoded is reported and skipped rather than stopping the pass; it stops only after five
consecutive failures of the same kind (`DRIVE_RUN_ABORTED`, exit 40), and a run with
skipped files still exits 0.

`ai-video-cataloger faces recluster [--dry-run]` rebuilds every person and every
assignment from the embeddings already stored in the catalog — no video is opened and no
model runs, so tuning the clustering thresholds costs minutes instead of a full
re-index. It reports people before/after, how many observations changed owner, and which
owner-set names it could not carry. Person ids change on every rebuild; names follow the
plurality of their observations ([ADR-0012](docs/decisions/0012-face-clustering-symmetry-and-recluster.md)).

`ai-video-cataloger faces exemplars [--dry-run] [--limit <n>]` fills in missing face
photographs: for every person that a rebuild left without one, it decodes exactly the frame
the observation came from, re-detects the face, and stores the crop next to the
observation. Catalogs indexed from this version on never need it — indexing already crops
every detected face — so it is a repair tool for older catalogs and for crops deleted off
disk. It reports how many crops it planned and wrote, how many files it could not reach, and
how many people still have no photograph
([ADR-0014](docs/decisions/0014-per-observation-face-crops.md)).

A completed `process-drive` run exits 0 even when individual files fail. This
partial-success behavior keeps drive runs resumable — and `materialize`
follows the same rule: the human run summary shows `failed=N`, while `--json`
reports the count in the `folder-done` and `run-summary` NDJSON events.

`materialize <root>` applies an already-cataloged drive to disk without
re-analysis: a drive analysed read-only (a write-protected mount, or a mirror
of one — see `read-only-folders/` below) records its analyses in the global
catalog but never renames anything on disk. Once the drive is remounted
writable, `materialize` walks it exactly like `process-drive` discovers it,
computes each file's fingerprint, looks up the **selected** variant in the
global catalog, and replays only the writes that are still missing: the
folder marker and folder row, the content-addressed artifacts and variant
outputs, the date-prefixed rename (`YYYY-MM-DD_slug.ext`, with the same `-2`,
`-3`, … numeric suffix on a name collision — never an overwrite), the
catalog's `finalName`/`fileName`, the selected-variant projection, the
thumbnail, and the folder's `catalog.ndjson` snapshot. It never calls an
analyzer. A file with no catalog entry, no stored variant, or no derivable
final name is reported and skipped, not analyzed — as is a duplicate whose
canonical copy already exists elsewhere; skip reasons are `not_in_catalog`,
`no_variant`, `no_final_name`, `fingerprint_unavailable`, and `duplicate`.
Every write is applied only when missing, so a second `materialize` run over
the same root is a no-op. `--dry-run` computes and reports the identical plan
— every operation it would perform — without touching disk. NDJSON events are
`run-started`, `folder-started`, `materialize_file`, `file-skipped`,
`folder-done`, and `run-summary`. A target still mounted read-only exits with
`TARGET_READ_ONLY` (46) instead of silently doing nothing. Because artifacts
are found through the catalog's folder id rather than the current path, the
drive does not have to return to the exact mount path it was analysed at.

`thumbnails <root>` fills in the covers a catalog is missing. It walks the
tree exactly like `process-drive` discovers it, treats a file as ready when
its projected `summaries/<name>.json` is on disk, and writes
`.ai-video-cataloger/thumbnails/<name>.jpg` by downscaling the analysis frame
the selected variant already stored — the source video is never opened, so
the command works on an index-only mirror of a read-only mount. A file with
no stored frame (a Gemini-native analysis) falls back to a 25% seek of the
source. A second run is a no-op; `--force` regenerates everything. NDJSON
events are `thumbnails_scanning`, `thumbnails_file` and `thumbnails_done`,
and the completion payload carries `generated`, `skipped`, `fromFrame`,
`fromSource`, `failed` and per-file `failures`. Per-file failures do not
change the exit code.

`process` and `process-drive` write each file's cover as they go, from the
same frame, so a finished run leaves a browsable catalog instead of
generating covers lazily on first display. With a non-default `frames`
setting the cover is the first analysis frame — `duration/(frames+1)` — not
necessarily the 25% mark.

OpenAI-compatible analyzers use `analyzer_provider` JSON configuration. API
credentials live in the macOS Keychain (service `com.ai-video-cataloger.app`,
account = the provider id), never alongside video folders. Store one with
`ai-video-cataloger config set-credential <providerId>`; the command prompts
without echo or reads `AI_VIDEO_CATALOGER_API_KEY` (`OPENAI_API_KEY` is also
accepted for provider `openai`). Keys left over in the older plaintext file
`~/.ai-video-cataloger/credentials.json` move into the Keychain on first
access. Where the Keychain is unavailable — another platform, a locked or
missing keychain, `AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN=1` — that file (mode
`0600`) stays the fallback and nothing fails; `ai-video-cataloger doctor` names
the backend in use. `AI_VIDEO_CATALOGER_KEYCHAIN=<path>` points the adapter at a
specific keychain file instead of the login keychain, which is how a throwaway
keychain is exercised without touching the developer's own.

Forget a stored key with `ai-video-cataloger config delete-credential
<providerId>` or the **Forget key** button beside the API key field in Settings.
Both clear every backend that holds it and say which ones they cleared; if the
Keychain refuses (locked, no default keychain) while the file was cleared, the
answer says so instead of claiming the key is gone. The key itself is never
echoed. See [ADR-0007](docs/decisions/0007-credentials-in-keychain.md).

For Claude analysis, install Claude Code CLI and authenticate it:

```bash
npm install -g @anthropic-ai/claude-code
```

For OpenAI Whisper API transcription, set `OPENAI_API_KEY` and run `process --whisper api`.

## Fully Local Mode

Frame extraction, transcription, and AI analysis can run on-machine. If Ollama is already running on port 11434, the app uses it. Otherwise it downloads a pinned managed Ollama runtime into `~/.ai-video-cataloger/` and starts it on a private port. Stop the managed runtime with:

```bash
node dist/cli/index.js models daemon-stop
```

Local AI workflow:

```bash
node dist/cli/index.js models requirements
node dist/cli/index.js models pull gemma3:12b
node dist/cli/index.js process ./clip.mp4 --analyzer local --local-model gemma3:12b
```

In the GUI, choose Settings -> AI Analyzer -> Local (Ollama), then use the Models manager.

Apple Silicon hardware tiers:

| Model | Download | Min RAM | Notes |
|---|---:|---:|---|
| `gemma3:4b` | 3.3 GB | 8 GB | Compact tier |
| `gemma3:12b` | 8.1 GB | 16 GB | Default/recommended |
| `gemma3:27b` | 17 GB | 32 GB | Largest Gemma tier |
| `qwen2.5vl:7b` | 6.0 GB | 16 GB | Alternate vision model |

Intel Macs are unsupported for local AI; use the Claude backend there.

## Output Layout

```text
your-videos/
├── 2026-07-13_descriptive-name.mp4
├── frames/
│   └── descriptive-name/
│       ├── frame-001.jpg
│       ├── frame-002.jpg
│       └── frame-003.jpg
├── transcripts/
│   └── descriptive-name.txt
├── summaries/
│   └── descriptive-name.txt
└── .ai-video-cataloger/
    ├── artifacts/
    │   ├── frames/{fingerprint}/{framesKey}/frame-NNN.jpg
    │   └── transcripts/{fingerprint}/{transcriptKey}.txt|.json
    ├── variants/{fingerprint}/{configId}/
    │   ├── summary.txt
    │   ├── summary.json
    │   └── debug.log
    ├── folder-id          # UUID marker identifying this folder
    ├── catalog.ndjson     # derived snapshot, re-imported when the folder is unknown
    └── config.json
```

Frames and transcripts are content-addressed so configurations that use the
same inputs share them. The top-level `frames/`, `transcripts/`, and
`summaries/` names remain the compatibility view of the selected variant; the
app re-points them atomically with hard links where supported and copies as a
fallback. For read-only source folders, the same additions live under
`~/.ai-video-cataloger/read-only-folders/{folderId}/`.

The canonical catalog now lives home-scoped at `~/.ai-video-cataloger/catalog.db`
(per [ADR-0002](docs/decisions/0002-global-catalog-layer.md)); the per-folder
`catalog.ndjson` is a derived snapshot, and legacy per-folder `catalog.db`
files stay readable for migration. Home-scope runtime and model files also
live under `~/.ai-video-cataloger/`.

## Promoting a Catalog Home

Moving a catalog built up elsewhere (a batch run, a review copy) into the real
app home:

```bash
pnpm run promote-home -- --source /path/to/run-home --dry-run
pnpm run promote-home -- --source /path/to/run-home --yes
```

It backs up the existing home first (never deletes it), carries over the
existing home's `photos.db` verbatim when the source has none, refuses to
guess when both have one, and keeps every entry the source does not provide
(credentials, photo artifacts, downloaded models). See
[docs/qa/consolidation-runbook.md](docs/qa/consolidation-runbook.md).

## Development

The rewrite follows the agentproofarch layout:

```text
core/domain       pure domain types, config, model catalogs, Result/AppError
core/contract     zod routes, envelopes, HTTP and CLI exit mappings, desktop bridge contract
core/server       use-cases and ports
core/client       typed client descriptors and fetch client
adapters          sql.js/drizzle, ffmpeg, whisper, analyzers, Ollama runtime, jobs, fs
apps/server       Hono app and createApp composition factory
apps/desktop      Electron main/preload composition root
apps/web          React 19 renderer
apps/cli          Commander CLI over the same in-process Hono app
test/cli          CLI parity tests
test/e2e          Playwright parity scenarios
```

Gates:

```bash
pnpm run check
pnpm run smoke
```

`AVC_GATE_TIMEOUT_FACTOR` (default `1`) multiplies every vitest test/hook
timeout and every CLI-suite spawn timeout at once, for the case where the gates
share the machine with other heavy work; a non-numeric or non-positive value
falls back to `1`. It buys headroom on a loaded machine — it never excuses a red
gate, which stays a P1 under the flake doctrine.

CI runs on GitHub-hosted `macos-15` runners: `check`, `smoke` and `ai-review` on
every PR and on `main`, `e2e-cli` and `visual-baselines` on demand
([ADR-0017](docs/decisions/0017-hosted-ci-runners.md)). `pnpm run workflow-lint`
(part of `pnpm run check`) keeps the workflow guards pointed at this repository,
the job names literal and no `self-hosted` label in the tree. See
[docs/ci.md](docs/ci.md).

E2E:

```bash
pnpm run test:e2e:cli
pnpm run test:e2e:gui
pnpm run test:e2e:parity
pnpm run test:e2e:library-hide-trash
```

`test:e2e:cli` only runs the CLI project. The GUI and parity projects build Electron and launch the desktop app.

Every e2e scenario runs against an isolated home, so the local-whisper samples
would otherwise find no model there. Preflight downloads the `base` ggml model
once into a persistent scratch cache (`$AVC_SCRATCH_DIR`, defaulting to
`~/.ai-video-cataloger-scratch`) under `whisper-models/`, and each isolated home
links it in; the developer's real home is never read. Delete the cached file to
force a re-download.

Visual regression:

```bash
pnpm run visual
```

The visual suite builds the renderer harness (`apps/web/visual.html`), previews
it, and compares the layout skeletons against the darwin baselines committed in
`visual/__screenshots__/`. It joins no gate — see
[ADR-0005](docs/decisions/0005-visual-regression.md). Re-baseline an intentional
UI change with `pnpm run visual --update-snapshots` and commit the PNGs.

Pre-release self-QA:

```bash
pnpm run qa:walkthrough -- --app "release/mac-arm64/AI Video Cataloger.app" --fixtures ~/videos
```

Every DMG handoff first drives the packaged app through this scripted
walkthrough — launch, open folder, tree, video and photo analysis, unified
Kolekcja browse/viewer, settings and wizard — and the screenshot set it captures is
reviewed before the build is offered. The run is isolated: a temp user-data
directory, a temp home and a disabled keychain. See
[docs/qa/release-walkthrough.md](docs/qa/release-walkthrough.md); the ordered
pre-release pass around it is
[docs/qa/release-readiness.md](docs/qa/release-readiness.md).

## License

Elastic License 2.0 — public source ("fair source"), not OSI open source.
You may use, modify and build from source freely; you may not offer the app
as a managed service or circumvent license-key functionality. See
[LICENSE](LICENSE) and [ADR-0009](docs/decisions/0009-license-elv2-voiceink-model.md).
