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
Two scopes, both preserved from the old app byte-for-byte
(parity-inventory §5):

- **Per-folder catalog** — `{folder}/.ai-video-cataloger/catalog.db` via a
  `CatalogRepository` *factory* keyed by folder path (the foundation assumed
  one database; this app opens one per working folder, plus config.json
  alongside it).
- **Home scope** — `~/.ai-video-cataloger/` for global model state, managed
  runtime files, whisper models.

Existing databases and on-disk artifacts written by the old implementation
must remain readable with no migration.

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

## Ports (complete list for this app)

- `CatalogRepository` (per-folder factory) + home-scope repository — drizzle.
- `ConfigStore` — per-folder `config.json` (schema in `core/domain`).
- `MediaPort` — probe/frames/audio/thumbnail. Adapters: bundled
  ffmpeg-static, system ffmpeg (platform difference is real).
- `TranscriberPort` — whisper.cpp (configured path / managed download /
  system) / OpenAI API / skip. The managed whisper binary follows the same
  pinned-release + SHA-256 pattern as the Ollama runtime (v1.1).
- `AnalyzerPort` — three families behind one port (v1.1,
  `tasks/prd-providers-onboarding.md`): OpenAI-compatible API adapter
  (BYO base URL + key; credentials live in the home scope only), a
  data-driven agent-harness adapter (Claude Code / Codex / Cursor Agent
  built-ins + user-defined), and the local ollama adapter. Legacy config
  values `claude|local` remain valid aliases.
- `LocalAiRuntimePort` — system Ollama / managed pinned runtime.
- `ModelDownloadPort` — HuggingFace whisper models; Ollama pulls go through
  the runtime port.
- `JobsPort` — in-process executor (see Delta 5).
- `DesktopBridge` (client-side port) — preload adapter in `apps/desktop`.

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
