# Architecture — AI Video Cataloger (local-first Electron)

Normative reference for this app. This document is a **delta** against the
agentproofarch foundation
([`../../agentproofarch/docs/architecture.md`](../../agentproofarch/docs/architecture.md),
read it first — its rules apply here except where this document overrides
them). Provenance: foundation docs as of 2026-07-12; local-first decisions in
[ADR-0001](decisions/0001-local-first-electron.md). Product scope:
[`../tasks/prd-foundation-rewrite.md`](../tasks/prd-foundation-rewrite.md);
behavioral ground truth: [`../tasks/parity-inventory.md`](../tasks/parity-inventory.md).

## Inherited verbatim (not restated here)

Layer discipline and dependency rules, `core/contract` as the only bridge,
`Result<T, AppError>` + closed `ErrorCode` taxonomy with CLI exit codes,
CQRS-partitioned actions, the entire frontend architecture
(routes/features/ui/lib, bound actions, features are islands, no client event
bus, visual language only in `theme.ts`), the server-state policy
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

Concurrent access (GUI + CLI on the same folder) is mediated by the shared
SQLite files, as in the old app — no daemon, no lock server.

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
  by folder id and content fingerprint.
- **Per-folder sidecar artifacts** — `{folder}/.ai-video-cataloger/config.json`
  stays folder-scoped. `{folder}/.ai-video-cataloger/catalog.ndjson` is a
  derived snapshot written after processing and imported when a marked folder
  is unknown to the local index. Existing per-folder `catalog.db` files remain
  readable for migration but are not the canonical write target.
- **Home scope** — `~/.ai-video-cataloger/` also holds global model state,
  managed runtime files, whisper models, and provider credentials.

Existing databases and on-disk artifacts written by the old implementation
must remain readable with no migration.

Processing-config resolution (owner decision 2026-07-17): **explicit CLI
flag > folder config > home config > built-in default**, per key. The home
scope holds global defaults (the wizard and `models use` write there when no
folder is in play); a folder's own config overrides point-wise, preserving
per-folder parity — a folder that sets a key always wins. The GUI
Prerequisites modal reads the configured-readiness section from
`/api/readiness` with the selected folder; the doctor contract stays
unchanged.

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
parity-inventory §10) is a main-process adapter.

The old GUI shelled out to a staged CLI and parsed NDJSON; that machinery is
deleted. Renderer and CLI are peers on the same contract.

Renderer user-facing copy lives in a typed dictionary layer (`apps/web/src/i18n`,
lint boundary `web-i18n`): `en`/`pl` dictionaries with structural parity, and a
`useDictionary` hook that reads the effective `ui_language` config value so a
config change re-renders every consumer without a restart. `web-i18n` may import
`web-api` and `core-*`; `web-features` and `web-main` may consume it.

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
  home-scope repository — drizzle.
- `ConfigStore` — per-folder `config.json` (schema in `core/domain`).
- `CredentialsStore` — home-scoped provider secrets in
  `~/.ai-video-cataloger/credentials.json`; per-folder configuration contains
  provider references only. The JSON adapter enforces owner-only mode (`0600`).
- `MediaPort` — probe/frames/audio/thumbnail. Adapters: bundled
  ffmpeg-static, system ffmpeg (platform difference is real).
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
- `AnalyzerPort` — three families behind one port (v1.1,
  `tasks/prd-providers-onboarding.md`): OpenAI-compatible API adapter
  (BYO base URL + key; credentials live in the home scope only), a
  data-driven agent-harness adapter (Claude Code / Codex / Cursor Agent
  built-ins + user-defined, with optional built-in model/reasoning-effort
  flags), and the local ollama adapter. Legacy config
  values `claude|local` remain valid aliases.
- `LocalAiRuntimePort` — system Ollama / managed pinned runtime. Analyzer
  execution starts the runtime on demand through this port and receives the
  resolved daemon base URL, including the managed runtime's dynamic port.
- `ModelDownloadPort` — HuggingFace whisper models; Ollama pulls go through
  the runtime port.
- `JobsPort` — in-process executor (see Delta 5).
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

`npm run check` — typecheck, eslint (boundaries + local plugin), depcruise
mirror, vitest projects. `npm run smoke` — lockfile drift check, boot the
real in-process app, drive doctor/scan/config/status through the CLI in an
isolated temp HOME + temp folder, assert envelope shapes and taxonomy exit
codes. Both green = done; every new lint rule proves itself with a violating
probe before it counts.

Changing this architecture means changing this document (and, for the frozen
constraints, ADR-0001) first, then the code.
