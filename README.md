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
search <query> [--json]
process <path> [-f number] [-s] [-v] [-t seconds] [-w local|api|skip] [--whisper-model model] [--analyzer claude|local] [--local-model tag] [--json]
process-drive <root> [--json]
thumbnail <video-path> [--force] [--json]
status [--json]
reset [filename] [--force] [--json]
config get [key] [--json]
config set <key> <value> [--json]
config set-credential <providerId>
index status|rebuild|forget
tags list|alias
faces index|people|name|merge|forget|purge|status
models list|requirements|pull|rm|daemon-stop|use|download|delete|faces status|faces install
models whisper-runtime status|install
```

Config keys: `whisper_model`, `whisper_mode`, `frames`, `timeout`, `skip_rename`, `analyzer_backend`, `local_model`.

OpenAI-compatible analyzers use `analyzer_provider` JSON configuration. API
credentials are deliberately stored as a plain owner-readable file at
`~/.ai-video-cataloger/credentials.json` (mode `0600`), never alongside video
folders. Store one with `ai-video-cataloger config set-credential <providerId>`;
the command prompts without echo or reads `AI_VIDEO_CATALOGER_API_KEY`
(`OPENAI_API_KEY` is also accepted for provider `openai`). macOS Keychain is a
named future upgrade.

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
    ├── folder-id          # UUID marker identifying this folder
    ├── catalog.ndjson     # derived snapshot, re-imported when the folder is unknown
    └── config.json
```

The canonical catalog now lives home-scoped at `~/.ai-video-cataloger/catalog.db`
(per [ADR-0002](docs/decisions/0002-global-catalog-layer.md)); the per-folder
`catalog.ndjson` is a derived snapshot, and legacy per-folder `catalog.db`
files stay readable for migration. Home-scope runtime and model files also
live under `~/.ai-video-cataloger/`.

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

E2E:

```bash
pnpm run test:e2e:cli
pnpm run test:e2e:gui
pnpm run test:e2e:parity
```

`test:e2e:cli` only runs the CLI project. The GUI and parity projects build Electron and launch the desktop app.

Visual regression:

```bash
pnpm run visual
```

The visual suite builds the renderer harness (`apps/web/visual.html`), previews
it, and compares the layout skeletons against the darwin baselines committed in
`visual/__screenshots__/`. It joins no gate — see
[ADR-0005](docs/decisions/0005-visual-regression.md). Re-baseline an intentional
UI change with `pnpm run visual --update-snapshots` and commit the PNGs.
