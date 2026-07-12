# PRD: Foundation Rewrite — AI Video Cataloger on agentproofarch (local-first Electron)

## Introduction

Ground-up rewrite of AI Video Cataloger onto the
[agentproofarch](../../agentproofarch/docs/architecture.md) foundation as a
**local-first Electron desktop app**: the app IS the server (no remote
backend), the typed contract is the only bridge between core and every
interface (GUI renderer, CLI), and every layer boundary is machine-enforced.

The product does not change. **v1 = full feature parity** with the current
implementation, byte-for-byte where users or scripts can observe it (NDJSON
events, exit codes, on-disk layout, database files). The authoritative
description of "what exists today" is
[`tasks/parity-inventory.md`](parity-inventory.md) (generated 2026-07-12 from
branch `feat/macos-packaging`, commit `d588195`); this PRD references it as
**INV §n** rather than restating it. The three historical PRDs
(`prd-ai-video-cataloger.md`, `prd-extended-features.md`, `prd-gui-mvp.md`)
remain background context; where they disagree with the inventory, the
inventory (actual behavior) wins.

Architecture constraints were decided before this PRD and are not up for
relitigation here; they are recorded in `docs/architecture.md` (delta against
the foundation) and `docs/decisions/0001-local-first-electron.md`. In short:
Variant B local-first, no auth/identity/multi-tenancy, contract transport via
`fetchImpl := honoApp.request` (in-process), SQLite behind repository ports,
Electron main process = composition root with one typed preload bridge,
CLI first-class, JobsPort at the first real job, telemetry opt-in default OFF,
`npm run check` + `npm run smoke` gates from day one.

## Goals

- Rebuild the app on the foundation's layers (`core/domain → contract →
  server → client`, `adapters/*`, `apps/*`) with lint-enforced boundaries.
- Preserve every user-observable behavior in INV §1–§10: CLI surface, GUI
  surface, data formats, managed runtimes, packaging, error recovery.
- Existing user data keeps working: a folder processed by the old app
  (catalog.db, config.json, artifacts) is readable and resumable by the new
  app with no migration step.
- The parity E2E suite (INV §9, S1–S4) passes against the rewritten app in
  both drivers (CLI + GUI) and both analyzer modes (claude, local).
- `npm run check` and `npm run smoke` are green from the first scaffold
  commit onwards; every lint rule is proven by a violating probe before it
  counts.

## Architectural shape (normative summary — details in docs/)

| Layer | Contents (this app) |
|---|---|
| `core/domain` | Video entity + status union, config schema, model catalogs (whisper models, local-AI hardware tiers), `Result`, closed `ErrorCode` taxonomy absorbing every INV error code |
| `core/contract` | Zod-typed routes for every capability: scan, process, thumbnail, status, reset, config, models (whisper + local AI), doctor, check, jobs; envelope `{ok:true,data}|{ok:false,error}`; CQRS method tags; **the typed preload-bridge interface** (dialogs, reveal-in-Finder, window, menu events) |
| `core/server` | Use-cases (pipeline steps with resume logic, scan, model management, doctor…) + ports: `CatalogRepository` (per-folder factory), `ConfigStore`, `MediaPort` (ffmpeg: probe/frames/audio/thumbnail), `TranscriberPort` (whisper-cpp / openai-api / skip), `AnalyzerPort` (claude-cli / ollama), `LocalAiRuntimePort` (managed Ollama), `ModelDownloadPort`, `JobsPort` (the process pipeline is the first real job) |
| `core/client` | Typed client over injected `fetchImpl` + query/mutation descriptors (bound actions), job-progress poll helpers |
| `adapters/*` | drizzle+SQLite repositories, fluent-ffmpeg, whisper.cpp spawn, OpenAI whisper API, claude CLI spawn, Ollama HTTP client + managed runtime, HuggingFace model downloads, in-process jobs executor |
| `apps/server` | Hono app + composition root factory (shared by desktop main and CLI) |
| `apps/desktop` | Electron main: composition root, preload bridge adapter, menus, `media://` protocol, window/folder stores, packaging |
| `apps/web` | Renderer SPA: React 19 + TanStack Router/Query + MUI theme, features-are-islands, bound actions |
| `apps/cli` | Commander commands over `core/client`, NDJSON events, taxonomy exit codes |

GUI no longer shells out to a staged CLI (INV §8 "CLI Staging" / §10 "CLI
Spawner"): renderer and CLI both consume the same contract; the pipeline runs
as a job in whichever process composed the app (Electron main for GUI, the CLI
process for CLI). Progress = job-status queries polled via TanStack Query.

## User Stories

Phased; each story is one focused implementation session. "Done" for every
story additionally means: `npm run check` green, `npm run smoke` green, zero
code comments except non-obvious WHY, no `any`/`as` (except `as const`).

### Phase 1 — skeleton and gates

#### US-101: Monorepo skeleton with enforced boundaries
**Description:** As a developer, I need the layer skeleton with lint-enforced
boundaries so every later story lands inside guardrails.

**Acceptance Criteria:**
- [ ] Layout per the table above compiles with strict TS (single root
  `package.json`, path-mapped layers like the foundation demo)
- [ ] eslint-plugin-boundaries + dependency-cruiser mirror the foundation's
  layer rules minus auth/tenancy, plus `apps/desktop` rules (only the
  preload adapter and composition root may import `electron`)
- [ ] `npm run check` = typecheck + eslint + depcruise + vitest projects
- [ ] Each boundary rule proven: a temporary violating probe file fails
  `check`, then is removed (commit shows both states)

#### US-102: Runtime gate (smoke)
**Description:** As an agent, I need `npm run smoke` to boot the real
in-process app and drive it through the CLI so static-green can never
masquerade as done.

**Acceptance Criteria:**
- [ ] Smoke verifies installed deps match lockfile, then runs the CLI against
  a temp fixture folder: `doctor --json`, `scan`, `config get/set`,
  `status`, asserting envelope shapes and taxonomy exit codes
- [ ] Uses an isolated temp HOME and temp working folder; never touches real
  user data
- [ ] Runs in seconds, no network

### Phase 2 — core

#### US-201: Domain model and error taxonomy
**Description:** As a developer, I need the domain layer so every other layer
has one vocabulary.

**Acceptance Criteria:**
- [ ] Video entity + status union exactly as INV §5 (`pending` …
  `completed`, `error`; renderer-only `not_tracked` stays client-side)
- [ ] Config schema with INV §7 keys, values, defaults, validation ranges
- [ ] Whisper model catalog and local-AI hardware-tier matrix (INV §6) as
  domain data with support-level logic (`ok` / `insufficient-ram` /
  `unsupported-platform`)
- [ ] Closed `ErrorCode` union absorbing every code in INV §1
  (`FILE_NOT_FOUND`, `INVALID_FILE_TYPE`, `NOT_A_FILE`, `MISSING_API_KEY`,
  `PREREQUISITES_FAILED`, `INVALID_MODEL`, `MODEL_NOT_FOUND`,
  `CONFIRMATION_REQUIRED`, `FORCE_REQUIRED`, `DOWNLOAD_ERROR`,
  `DELETE_ERROR`, `VIDEO_NOT_FOUND`, `RESET_FAILED`, `UNKNOWN_CONFIG_KEY`,
  `INVALID_CONFIG_VALUE`, `FOLDER_NOT_FOUND`, `NOT_A_DIRECTORY`,
  `READ_ERROR`, `NESTED_DATABASES_FOUND`, `THUMBNAIL_ERROR`,
  `PROCESSING_ERROR`, `ANALYSIS_PARSE_FAILED`, `MODEL_NOT_INSTALLED`,
  `OLLAMA_UNAVAILABLE`, `HW_REQUIREMENTS_NOT_MET`, internal) with exhaustive
  exit-code mapping
- [ ] `Result<T, AppError>` everywhere; unit tests for taxonomy exhaustiveness

#### US-202: Contract
**Description:** As a developer, I need the contract so server and clients
have exactly one bridge.

**Acceptance Criteria:**
- [ ] Routes covering every CLI capability in INV §1 (scan, process,
  thumbnail, status, reset, config get/set, models list/download/delete/use/
  requirements/pull/rm/daemon-stop, doctor, check) plus job status/list/cancel
- [ ] Every route: zod request/response schemas, HTTP method carrying the
  CQRS read/write tag, exhaustive ErrorCode→status mapping
- [ ] Preload-bridge interface (`DesktopBridge`): folder picker, reveal in
  Finder, window controls, app version, folder store (current/recent),
  menu-event subscription — typed here, implemented only in `apps/desktop`
- [ ] Envelope + taxonomy shared with the foundation pattern verbatim

#### US-203: Ports and use-cases — catalog, scan, config, safety
**Description:** As a user, I want folder scanning, status, config and nested-DB
safety to behave exactly as today.

**Acceptance Criteria:**
- [ ] `CatalogRepository` port with per-folder factory; drizzle schema
  byte-compatible with INV §5 (`videos`, `config` tables; config.json is the
  live config store, table exists for compat)
- [ ] Scan use-case returns INV §1 `scan` result shape (metadata, ffprobe
  duration, partial content hash, artifact presence, summary counts;
  hash-based fallback matching for renamed files)
- [ ] Status grouping, reset-all/reset-single semantics incl. force rules
- [ ] Config get/set with INV §7 validation and defaults
- [ ] Nested-DB check with INV §1 `check` skip rules
- [ ] Unit tests per use-case at the core layer (in-memory/fake adapters)

#### US-204: Ports and use-cases — pipeline with resume
**Description:** As a user, I want the five-step pipeline with resume and
smart retry so interrupted or failed work continues where it left off.

**Acceptance Criteria:**
- [ ] Steps: frames → audio → transcribe → analyze → rename, persisting
  status after each (INV §1 process, §10 resume rules incl. artifact
  inspection on error retry, existing-transcript skip, temp-audio cleanup)
- [ ] Analyzer resolution precedence: flag > per-folder config > default;
  local analyzer default timeout bump to 300 only when not explicit
- [ ] Rename: kebab-case slug, `YYYY-MM-DD_slug.ext` from mtime, `-2`/`-3`
  conflict suffixes, artifact co-rename set exactly as INV §10
- [ ] Analysis contract: `DESCRIPTION:`/`FILENAME:` parser, kebab
  normalization, `ANALYSIS_PARSE_FAILED` on missing filename, description
  fallback to first 500 chars, summary JSON as source of truth + generated
  TXT, debug log written before parsing
- [ ] Pipeline runs as the first real `JobsPort` job with typed step progress
  (step id, percentage, current/total) queryable via contract
- [ ] Unit tests: resume from every status, error-retry artifact inspection,
  conflict renames, parser edge cases

#### US-205: Typed client and descriptors
**Description:** As a developer, I need bound actions so both the renderer and
the CLI consume the same partition.

**Acceptance Criteria:**
- [ ] `core/client` typed client over injected `fetchImpl`; zod-parses the
  envelope, returns `Result`, descriptors throw `ApiError`
- [ ] Query/mutation descriptors for every route; queries as nouns, commands
  as verbs; keys hierarchical per foundation server-state policy
- [ ] Job-progress polling helper (`refetchInterval` function form, stops on
  terminal status)
- [ ] Unit tests via injectable `fetchImpl`

### Phase 3 — adapters

#### US-301: SQLite adapter (drizzle)
- [ ] Per-folder `catalog.db` + home-scope DB for global model state
  (INV §1 `models list` home-DB semantics, §5 home layout)
- [ ] Opens existing old-app databases unchanged (fixture test with a db file
  produced by the old code)
- [ ] Composition root picks the driver (`DB_DRIVER`-equivalent)

#### US-302: ffmpeg media adapter
- [ ] Bundled-first resolution (`ffmpeg-static`, `@ffprobe-installer`),
  system fallback, fluent-ffmpeg configured once (INV §6)
- [ ] Frames at even offsets, mono-16k WAV audio, 128×72 thumbnail at 25%
  duration, probe metadata

#### US-303: Whisper transcriber adapters
- [ ] whisper.cpp adapter: binary resolution bundled → system (INV §6),
  transcript to `transcripts/{base}.txt`
- [ ] OpenAI API adapter with 401/429/413 mapping; `skip` mode
- [ ] Whisper model store: HF downloads with temp-file rename, progress,
  `--force`, delete; storage paths incl. legacy `.pt` detection (INV §6)

#### US-304: Analyzer adapters
- [ ] claude-cli adapter: `claude --add-dir <dir> -p <prompt>`, filtered env
  (INV §4 env-filter), project-history cleanup quirk, verbose streaming
- [ ] ollama adapter: ensure-runtime, model-installed precheck, base64
  frames, shared response contract (INV §10)

#### US-305: Managed Ollama runtime adapter
- [ ] Pinned version + SHA256, resolution order (system 11434 → managed
  state file → download/extract/start), random port 9000–9999,
  `OLLAMA_HOST`/`OLLAMA_MODELS` env, probe loop, SIGTERM stop of managed
  only, state/log files — all per INV §6
- [ ] Pull/rm via streaming HTTP API with INV error mapping

### Phase 4 — apps

#### US-401: In-process server and composition roots
- [ ] Hono app mounting the contract; `createApp(config)` factory returns
  `{ honoApp, jobs, dispose }`
- [ ] Desktop main and CLI both compose it and inject
  `fetchImpl := honoApp.request` into the typed client
- [ ] Wide-event middleware per foundation observability doc; exporter wired
  only behind explicit opt-in (default OFF, no Sentry without consent)

#### US-402: CLI app — full surface
- [ ] Every command/flag/default/exit code and NDJSON event stream in INV §1
  reproduced exactly (`started`/`progress`/`completed`/`error` shapes,
  bare raw-data lines where they exist today, `--json` flag placement)
- [ ] Human output preserved at the level the e2e suite and README examples
  observe (spinners/colors may differ visually, wording of parse-sensitive
  lines may not)
- [ ] Interactive menu (INV §1 "Interactive Menu Behavior") is NOT ported —
  it is unwired dead code today (see Open Questions)
- [ ] Command tests ported from `test/commands/**` (INV §9) and green

#### US-403: Electron main — composition root and platform adapters
- [ ] Preload bridge implementing the contract's `DesktopBridge` (INV §3
  channels), trusted-sender checks, absolute-path validation
- [ ] `media://` protocol with the full INV §10 security model (extension
  allowlist, folder scope, realpath escape rejection, 20 MB cap, 403s)
- [ ] Menus + shortcuts per INV §10; folder store (max 10 recent) and
  window state persistence per INV §5
- [ ] CLI-spawner machinery deleted; jobs run in-process

#### US-404: Renderer — shell, catalog, details
- [ ] App layout with resizable/collapsible sidebar + terminal-log panel
  (sizes/defaults per INV §2), header, folder bar with recent dropdown
- [ ] Video list: thumbnails via `media://`, status badges incl.
  `not_tracked`, metadata, selection surviving rename via content hash
- [ ] Details panel: metadata card, status info/actions
  (analyze/continue/retry), artifacts (summary card, frame gallery,
  transcript, collapsible full analysis)
- [ ] Features-are-islands + bound actions + MUI theme; each screen verified
  in the running app
- [ ] Renderer hook/component tests ported where behavior survives
  (catalog selection, terminal ring buffer)

#### US-405: Renderer — processing flows
- [ ] Single analyze, batch analyze-all with sequential continue-past-failure
  semantics, progress overlay + batch toolbar driven by job polling
  (step labels/percentages per INV §1 process events)
- [ ] Cancel with confirmation dialogs (single vs batch wording per INV §2),
  batch summary dialog, nested-DB blocking dialog
- [ ] Terminal-log panel fed by the job/event stream (ANSI-free structured
  lines, JSON visibility toggle, 5000-line ring buffer, copy/clear,
  auto-scroll rules per INV §2)

#### US-406: Renderer — settings, models, prerequisites
- [ ] Settings modal: per-folder config load/save, unsaved-change tracking,
  controls and conditional visibility per INV §2/§7
- [ ] Model Manager: whisper list/download/activate/delete with progress and
  disk usage; Local AI section with machine summary, tier badges,
  pull/delete progress
- [ ] Prerequisites modal driven by doctor query with INV §2 states

### Phase 5 — packaging and parity proof

#### US-501: macOS packaging
- [ ] electron-builder config per INV §8 minus CLI staging (appId,
  productName, dmg/dir arm64, entitlements, hardened runtime, dark mode)
- [ ] CLI ships as before for `npm link`/dev usage; decide packaged-CLI story
  per Open Questions
- [ ] Packaged .app launches and processes a real video fully locally

#### US-502: E2E parity suite
- [ ] Port `test/e2e` scenarios S1–S4 + preflight (INV §9) onto the new app;
  CLI driver and GUI driver both green; `E2E_ANALYZER=local` variant green
- [ ] Old-data compat scenario: folder with old-app catalog.db + artifacts
  resumes and displays correctly

## Functional Requirements

- FR-1: Every capability in INV §1 must be reachable via contract routes,
  the CLI, and (where the GUI exposes it today) the renderer.
- FR-2: CLI NDJSON output must be event-for-event, field-for-field
  compatible with INV §1 (including bare raw-data lines and `--json`
  placement quirks); exit codes must match INV per command.
- FR-3: On-disk layouts (per-folder and home, INV §5) must be preserved
  exactly; the new app must read data written by the old app.
- FR-4: The error taxonomy is closed and exhaustive; the contract maps it to
  HTTP statuses and the CLI to exit codes; renderer renders `ApiError`
  without re-mapping.
- FR-5: The renderer must not import electron, spawn processes, touch `fetch`
  directly, or hold clients/ports — bound actions only (lint-enforced).
- FR-6: The pipeline must be resumable per INV §10 in both interfaces, and
  concurrent GUI+CLI use of the same folder must be no worse than today.
- FR-7: The managed Ollama runtime lifecycle must follow INV §6 exactly
  (never touch a user-owned daemon; SIGTERM managed only).
- FR-8: All model downloads must be resumable-safe (temp file + rename) with
  progress reporting through the job/event mechanism.
- FR-9: Telemetry and error reporting default OFF; enabling requires an
  explicit user action; core functionality must work with zero network.
- FR-10: `npm run check` and `npm run smoke` gate every story; a new lint
  rule counts only after a probe file proved it fails the gate.

## Non-Goals

- No new product features beyond parity (no watch folders, no recursive
  scan, no editing artifacts in-app, no export).
- No auth, identity, accounts, or multi-tenancy of any kind.
- No remote backend, no deployment targets (Vercel/Docker matrix does not
  apply), no public API surface.
- No Windows/Linux/Intel-mac support beyond what exists today (macOS arm64
  primary; local AI remains Apple-Silicon-only per INV §6).
- No websockets/streaming transport — polling per foundation policy; revisit
  only if token-streaming UX demands it (then typed closed-union events).
- No cache persistence, no global state libraries, no client event bus.
- Interactive CLI menu is not ported (dead code today) unless the owner
  overrules (Open Questions).

## Technical Considerations

- **DB driver**: drizzle over a synchronous SQLite driver; current app uses
  sql.js (wasm). Choose sql.js-compatible reading of existing files vs
  better-sqlite3 (native rebuild for Electron) in the scaffold ADR; the
  file-format compat test (US-301) is the gate either way.
- **Known old-app quirks — deliberate deviations** (fix-forward, each noted
  in docs and release notes; everything else is bug-for-bug parity):
  1. `process` ignores per-folder `frames`/`whisper_mode`/`whisper_model`/
     `skip_rename` config (INV §7) while the GUI saves them → the rewrite
     honors all config keys with flag > config > default precedence.
  2. Progress step id `analyzing_with_claude` fires even for the local
     analyzer (INV §1) → keep the id for NDJSON compat, fix the human label.
  3. `renameVideo` leaves `original_path` stale (INV §10) → keep observable
     behavior (hash fallback matching) but store consistently.
  4. Duplicated statement in `config.ts` (INV §10) — irrelevant post-rewrite.
  5. The old CLI exits uniformly 1 on every error; the rewrite exits with
     distinct taxonomy exit codes (all nonzero) per the kickoff constraint
     "error taxonomy with CLI exit codes". Scripts testing `!= 0` keep
     working; scripts comparing `== 1` on specific failures would not —
     judged acceptable, NDJSON `code` remains the precise discriminator.
  6. `created_at`/`updated_at` in `status`/`scan` output are normalized to
     ISO-8601 (`2026-07-12T10:11:12.000Z`) instead of the raw SQLite value
     (`2026-07-12 10:11:12`, space-separated, no zone). The domain `Video`
     schema mandates `z.string().datetime()`, so the whole contract carries
     RFC-3339 timestamps; SQLite's `datetime('now')` is already UTC, so this
     is a lossless format normalization, not a value change. Scripts diffing
     the exact string see the new format; scripts parsing a date accept both.
- **Foundation reuse**: copy configs/patterns from `agentproofarch/demo`
  (eslint boundaries setup, local eslint plugin with probe-proven rules,
  depcruise mirror, vitest projects, theme.ts discipline, query policies)
  rather than reinventing; adapt scope names to this repo's layers.
- **Ports rule**: a port only where a second implementation or platform
  difference exists — transcriber (3 modes), analyzer (2 backends), media
  (bundled/system), runtime (system/managed), repository (per-folder/home,
  driver choice). No port theater around zod/query-core/OTel facade.

## Success Metrics

- `npm run check` + `npm run smoke` green on every story merge.
- E2E parity suite green: 4 scenarios × 2 drivers × 2 analyzer modes.
- A folder cataloged with the old app opens, resumes, and displays correctly
  in the new app with zero migration.
- Packaged .app processes a video 100% locally (network unplugged) after
  models are downloaded.
- Old scripts consuming `--json` NDJSON output run unmodified against the
  new CLI.

## Open Questions

1. **Packaged-CLI story**: today the .app stages a standalone CLI under
   `resources/cli` (INV §8) though the GUI no longer needs it post-rewrite.
   Keep shipping it inside the .app (users may `npm link` separately), or
   drop it from the bundle? Default until answered: keep bundling (strict
   parity).
2. **Interactive CLI menu**: unwired dead code today — confirm dropping it
   permanently (removes inquirer dependency), or wire it back as designed in
   `prd-extended-features.md` US-015/016?
3. **Terminal-log fidelity**: without a spawned CLI there is no raw stdout;
   proposed replacement is structured job/event lines with the same panel
   affordances. Confirm this satisfies "parity" for the terminal panel.
4. **Whisper model checksum**: downloads currently have no checksum
   verification (INV §6). Add SHA verification (deviation) or keep parity?
   Default: add it (safety fix, invisible to happy path).
