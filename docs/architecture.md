# Architecture — AI Video Cataloger (local-first Electron)

Normative reference for this app. This document is a **delta** against the
agentproofarch foundation
([`agentproofarch/docs/architecture.md`](https://github.com/chomamateusz/agentproofarch/blob/main/docs/architecture.md),
read it first — its rules apply here except where this document overrides
them). Provenance: foundation docs as of 2026-07-12; local-first decisions in
[ADR-0001](decisions/0001-local-first-electron.md). Product scope:
[`../tasks/prd-foundation-rewrite.md`](../tasks/prd-foundation-rewrite.md);
behavioral ground truth: [`../tasks/parity-inventory.md`](../tasks/parity-inventory.md).

## Inherited verbatim (not restated here)

Layer discipline and dependency rules, `core/contract` as the only bridge,
`Result<T, AppError>` + closed `ErrorCode` taxonomy with CLI exit codes,
CQRS-partitioned actions, the entire frontend architecture
(routes/features/ui/layout/lib, bound actions, features are islands, layouts are
structure only, no client event bus, visual language only in `theme.ts`), the
server-state policy
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

Concurrent access (GUI + CLI on the same catalog) is mediated by a
home-scoped advisory `catalog.lock` file next to `catalog.db`, not a lock
server. The lock records the owning process (pid/hostname/name) and is
acquired per `lockMode` — `none` (CLI reads), `lazy` (acquire on first
write), or `eager` (acquire at startup) — with a process-alive check that
lets a live peer block and a dead peer's stale lock be taken over. A running
job holds the lease for its whole run; one-off mutations flush without
dropping it. When the lock can't be acquired the renderer drops to a
read-only banner and offers retry. See ADR-0002 Consequences.

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
  by folder id and content fingerprint. A file has one row per fingerprint and
  its analyses are variants keyed by `(fingerprint, configId)`. The `configId`
  is `cfg_` plus the first 12 hex characters of SHA-256 over the normalized,
  key-sorted config descriptor. That closed descriptor includes every
  result-shaping analyzer field, the transcription source, frame count where
  applicable, `output_language`, and `promptVersion`. See
  [ADR-0010](decisions/0010-analysis-variant-identity-artifacts-and-dedup.md).
- **Per-folder sidecar artifacts** — `{folder}/.ai-video-cataloger/config.json`
  stays folder-scoped. `{folder}/.ai-video-cataloger/catalog.ndjson` is a
  derived snapshot written after processing and imported when a marked folder
  is unknown to the local index. Existing per-folder `catalog.db` files remain
  readable for migration but are not the canonical write target. Its
  `videos.status` columns describe the last processing run for each path;
  configuration-specific analysis state is canonical only in the global index.
  Shared inputs live in the content-addressed
  `.ai-video-cataloger/artifacts/frames/{fingerprint}/{framesKey}/` and
  `.ai-video-cataloger/artifacts/transcripts/{fingerprint}/{transcriptKey}.txt|.json`
  trees. Per-variant outputs live in
  `.ai-video-cataloger/variants/{fingerprint}/{configId}/`. The established
  name-based `frames/`, `transcripts/`, and `summaries/` paths remain a
  selected-variant projection, materialized as hard links with a copy fallback
  and re-pointed atomically when selection changes.
- **Home scope** — `~/.ai-video-cataloger/` also holds global model state,
  managed runtime files, whisper models, provider credentials, and the
  append-only spend ledger and read-only mirror below.

Exactly one variant resolves as selected for a file. Resolution uses the
file's explicit `selected_config_id` when that variant exists, then the viewing
folder's default configuration when that variant exists for the file, then the
newest variant by `createdAt` with `configId` as the tie-breaker. A folder's
default is its explicit `folders.default_config_id`, or otherwise the configId
of its resolved processing configuration. Explicit selection is stored per
fingerprint and is therefore shared by duplicate copies of the content; only
the folder-default fallback is folder-relative. Search indexes the resolved
variant only.

A source folder that cannot be written to (write-protected external drive,
`chmod -w`) is not a failure: opening its catalog degrades to an in-memory
repository (`CatalogRepository.writable()` reports it), artifacts are mirrored
to `~/.ai-video-cataloger/read-only-folders/{folderId}/`, renaming is forced
off, the NDJSON snapshot is skipped with a `catalog_snapshot_skipped` warning
per file, and the analysis still lands in the canonical global index. See
[ADR-0002](decisions/0002-global-catalog-layer.md) §(f). Read-only detection is
verified against a real mount, not a simulated one: the `ro-mount` legs of
`pnpm run test:e2e:matrix` build a disk image with `hdiutil`, re-attach it
`-readonly`, and assert index-only mode end to end — Node 22 reports a
rejected recursive directory creation on such a mount as `ENOENT`, so a
permission-simulating fake cannot stand in for one.

A folder analysed read-only can be **materialized** once its mount becomes
writable: `materialize <root>` looks every file up by fingerprint, takes the
selected variant, and replays the writes the writable path would have made —
folder marker and folder row, the content-addressed artifacts and the variant
outputs copied out of the read-only mirror, the date-prefixed rename with the
established `-2` collision suffix, the catalog's `finalName`/`fileName`, the
selected-variant projection, the thumbnail, and the `catalog.ndjson`
snapshot. It re-analyses nothing (its dependencies are the filesystem and the
global catalog, nothing else), applies only the writes that are missing, and
repeats as a no-op. The non-canonical per-folder `catalog.db` is the one
write it does not replay. `finalName` is written to the catalog before the
rename and `fileName` after it, so the canonical copy is reachable by name at
every instant and the reachability sweep can never clear a live analysis.

Existing databases and on-disk artifacts written by the old implementation
must remain readable with no migration.

Processing-config resolution (owner decision 2026-07-17): **explicit CLI
flag > folder config > home config > built-in default**, per key. The home
scope holds global defaults (the wizard and `models use` write there when no
folder is in play); a folder's own config overrides point-wise, preserving
per-folder parity — a folder that sets a key always wins. Three app-global keys
are exempt: `ui_language`, `faces_enabled`, and `gemini_monthly_budget_usd` are
always resolved home-scoped and ignore folder overrides. The GUI Prerequisites modal reads the
configured-readiness section from `/api/readiness` with the selected folder;
the doctor contract stays unchanged.

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
parity-inventory §10) is a main-process adapter. It is registered as a
standard, stream-enabled scheme (not a bare privileged scheme) and serves
`206` partial responses for `Range` requests so video seeking works; the 20MB
size cap applies to images only, not the supported video extensions.

The old GUI shelled out to a staged CLI and parsed NDJSON; that machinery is
deleted. Renderer and CLI are peers on the same contract.

Renderer user-facing copy lives in a typed dictionary layer (`apps/web/src/i18n`,
lint boundary `web-i18n`): `en`/`pl` dictionaries with structural parity, and a
`useDictionary` hook that reads the effective `ui_language` config value so a
config change re-renders every consumer without a restart. `web-i18n` may import
`web-api` and `core-*`; `web-features` and `web-main` may consume it.

### Island cores (ADR-0005 rung 1) and i18n

A feature's decision/selector logic lives in a portable, DOM-free, React-free
island core at `apps/web/src/features/<name>/core/` — a factory over its
dependencies (`createCatalogCore` / `createProcessingCore`), following the
foundation's rung-1 shape (pure TypeScript; no state library). The single web
binding `apps/web/src/features/<name>/index.web.ts` injects the bound
server-read descriptors from `api.ts` and re-exports the seam; view hooks
consume the binding, never `core/` construction. Cores may import `core-*`
contracts through the `@core/*` alias and their own core directory, nothing
else — enforced by `typecheck:islands` (`tsconfig.islands.json`, ES2023 lib
without DOM), the ESLint island-purity bans, and the depcruise
`island-core-is-portable` / `island-core-no-frameworks` rules.

**i18n ruling (owner-accepted 2026-07-25): cores emit typed dictionary keys;
the feature's web side translates through `useDictionary`.** A pure core
cannot call the `useDictionary` React hook, so it never holds translated
strings. Instead a core exposes labels and log lines as a typed, closed key
union (e.g. the processing core's `DriveMessage`:
`{ kind: 'folderDone'; path; filesDone; … }` and a step key), and the
feature's view hooks and components — which may import `web-i18n`, while the
core never does — resolve each key against the effective dictionary. This
keeps the core locale-free and portable while the translated output stays
byte-identical to the pre-extraction renderer.

**No scaffolder, and one half of the seam is deferred.** The foundation
generates a new island with `pnpm run new:island`, and its rung-1 template ships
**both** halves of the seam: an inbound `core/events.ts` intent union with a
typed stub `send`, plus `core/selectors.ts`. We have no generator — two islands
do not earn one, and a template nobody runs rots — so the seam is written by
hand and the rules, not a template, are what hold it: `typecheck:islands`, the
island-purity bans and the depcruise pair above. Our rung-1 cores ship the
**read half** (selectors/descriptors out, plus the typed dictionary keys of the
i18n ruling) and deliberately have **no event union**: with no client machine
behind the seam, an inbound `send` would be a stub forwarding to nothing, and
writes go through mutation descriptors in the view (invalidation → refetch). The
naming rule for the day one arrives is already armed —
`avc/event-suffix-taxonomy` runs on `features/*/core/events.ts`, so the first
core to graduate to rung 2 gets an intent-suffixed union or a red `check`.

### Renderer structure (delta on the foundation's frontend diagram)

```
apps/web/src/
  main.tsx           composition root: providers + router wiring only
  api.ts             binds core/client actions + the DesktopBridge once
  AppLayout.tsx      the stateful shell composition (ADR-0004): modal state,
                     menu events, collapse + sidebar-width persistence,
                     translated labels — renders components/layout/AppShell
  routes/            route components — thin: wire features into AppLayout
  features/<name>/   feature folders (islands), core/ = the island core
  components/layout/ page skeletons: structure only → theme, components/ui, lib
                     (no core, features, routes, api, TanStack, i18n)
  components/ui/     presentational primitives → theme, lib, i18n
  i18n/              typed en/pl dictionaries + useDictionary
  lib/               pure TS utilities → no react
  theme.ts           the entire visual language (MUI theme)
```

### The layout layer (page skeletons)

Decided in [ADR-0004](decisions/0004-layout-layer.md), adopting the foundation's
ADR-0011 with four app rulings. `components/layout/` is the one legal home for a
component that owns a page's **shape** — the 100vh column, the resizable sidebar
rail, the content region, the terminal drawer. Content arrives through
`ReactNode` slots; non-happy branches (the readiness/degraded banner slot, the
collapsed-sidebar rail) render *inside* the skeleton so the content region never
jumps between a pending and a loaded render; resize **limits** are exported from
the skeleton while the current size arrives as a prop and its persistence stays
in the composition. Our stricter ruling: **skeletons carry no i18n** — structure
has no copy, and every visible string arrives as a slot, the same seam the island
cores use.

**(a) Layouts are structure only.** `components/layout/**` imports `theme.ts`,
`components/ui/` and `lib/` and nothing else in the app: no `core/**`, no
`adapters/**`, no `features/**`, no `routes/**`, no `api.ts`, no `i18n/`, no
TanStack.
— **TYPE**: n/a (an import edge is not a type) · **LINT**:
`web-layouts-are-structure-only` (dependency-cruiser) plus the `web-layout`
`boundaries` element type · **TEST**: `config-regression/lint-gates.test.ts`
plants a layout fixture importing a feature and asserts the named rule fires ·
**REVIEW+AI**: n/a (mechanically covered).

**(b) Features consume layouts; they do not define them.** A page skeleton — a
component owning a page grid or a page-level max-width — may be defined only
under `components/layout/`. This is a claim about the content of a file, not an
edge in the graph, so the mechanical half is incomplete by construction.
— **TYPE**: n/a · **LINT**: partial only — `MUI_SKELETON_BAN`
(`no-restricted-imports`) forbids `Container`/`AppBar`/`Drawer`/`Toolbar`
outside `components/layout/**`, which is a proxy, not the rule · **TEST**: the
MUI-ban probe (violating fixture outside the layer fires; the same import inside
the layer does not) · **REVIEW+AI**: owns the rest — flag a feature growing its
own page grid or max-width instead of consuming a skeleton.

**Structural `sx` tier** (NORMATIVE WHEN TRIGGERED, same trigger as upstream —
*the first duplicated page skeleton outside `components/layout/`*): reserving
`display`, `grid*`, `flex*` on containers, `position: sticky|fixed`, `width` and
`maxWidth` for `components/layout/**` and `theme.ts`, on a per-file,
shrink-only, stale-erroring baseline. Not switched on: the tier has never run
against a real codebase anywhere. Rule (b)'s mechanical half closes when it does.

**Visual specs** per skeleton and per state land with the visual-regression
suite (migration plan P2), not here.

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

A drive run owns the faces pass. Face identity is catalog-global — every embedding is
classified against all people in the index — so face indexing cannot be a per-file step
inside the processing pipeline; it is a root-scoped pass that runs once, at the end of a
completed `process_drive` job, when `faces_enabled` is on. The pass is the same
use-case the standalone `faces index` command runs, reported through the same progress
steps, and it is best effort: a missing model, an unavailable engine, `--skip-faces`, a
cancelled job or a failing pass produces a `faces_pass_skipped` event and a `faces`
block in the run summary, never a failed run. Runs that end early (consecutive-failure
abort, budget cap, failed batch job) skip the pass; the resumed run indexes everything.
ADR-0011.

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
- `CredentialsStore` — home-scoped provider secrets; per-folder configuration
  contains provider references only. The primary backend is the macOS Keychain
  (`SecretsStore`, service `com.ai-video-cataloger.app`, account = the
  `apiKeyRef`), with `~/.ai-video-cataloger/credentials.json` (owner-only mode
  `0600`) as the fallback for non-darwin hosts, explicit opt-outs, and any
  environment where `security` cannot run. Keys left in the file migrate into
  the Keychain on first access — write, read back, then remove from the file —
  and doctor names the live backend. Decided in
  [ADR-0007](decisions/0007-credentials-in-keychain.md).
- `SecretsStore` — OS keychain items behind `/usr/bin/security`; the second
  implementation is the fake command runner the gates inject instead of a real
  keychain.
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
- `AnalyzerPort` — four families behind one port (v1.1,
  `tasks/prd-providers-onboarding.md`): OpenAI-compatible API adapter
  (BYO base URL + key; credentials live in the home scope only), a
  data-driven agent-harness adapter (Claude Code / Codex / Cursor Agent
  built-ins + user-defined, with optional built-in model/reasoning-effort
  flags), the local ollama adapter, and the `gemini-native` adapter
  (`adapters/gemini`). Legacy config values `claude|local` remain valid
  aliases. The `gemini-native` family sends the whole video to the Gemini
  Files API as one modality (1fps frames + full audio) and takes a native
  processing path that **skips frame extraction and Whisper** — the model
  returns the description and a timestamped transcript in one call, and
  `usageMetadata` (tokens + est cost per file) is surfaced as an NDJSON
  event; GPS still comes from metadata. Budget-capped smoke bench (real key,
  11-clip subset, flash vs flash-lite, $0.096 total) recorded at
  `~/repositories/claude-tmp/wf-mg1/bench-report.md`.
- `AnalyzerBatchPort` — the Gemini **Batch API** half of the same adapter,
  used only by `process_drive` and only when batch mode is on
  ([ADR-0008](decisions/0008-gemini-batch-drive-runs.md)): per-file uploads
  stay the streamed Files API path, the run's requests are submitted inline as
  one job at **half the interactive token price**, and each answer is mapped
  back through the ordinary per-file completion path (parse, rename, transcript
  artifacts, global catalog, NDJSON events). The job name and the per-file
  request mapping live in the drive-run record before submission, so an
  interrupted run re-attaches instead of paying twice.
- `LocalAiRuntimePort` — system Ollama / managed pinned runtime. Analyzer
  execution starts the runtime on demand through this port and receives the
  resolved daemon base URL, including the managed runtime's dynamic port.
- `ModelDownloadPort` — HuggingFace whisper models; Ollama pulls go through
  the runtime port.
- `JobsPort` — in-process executor (see Delta 5).
- `FaceEnginePort` — face detect/align/embed/crop lifecycle behind the faces
  feature; ONNX Runtime adapter (darwin-only binding). The drive job composes it (and
  `ModelDownloadPort`) optionally, so a composition without a face engine degrades to a
  reported skip instead of a failure.
- `ProvidersPort` — analyzer-provider listing and credential/connectivity
  test, routed across the same three analyzer families.
- `FileSystemPort` — fs primitives incl. `partialContentHash` (ADR-0002(c))
  and a non-mutating `isWritable` (`access(W_OK)`) that lets a dry run report
  a still-read-only mount without touching it; Node adapter in production,
  in-memory fake in tests.
- `FolderWatcherPort` — recursive watch of the opened folder tree. The Node
  adapter (`adapters/fs/folder-watcher.ts`) wraps `fs.watch` with
  `recursive: true` (FSEvents on macOS), drops `.ai-video-cataloger` paths and
  debounces bursts so an in-flight file copy produces one change, not
  hundreds; the memory driver gets an inert implementation. The
  `watchCatalogFolder` use-case holds the refresh while an analysis run
  (`process` / `process_drive`) is active and emits a single coalesced refresh
  once the run settles. Electron main subscribes through `App.watchFolder` and
  forwards `folder:changed` over the preload bridge; the renderer invalidates
  its server state so the sidebar tree and counts follow the disk.
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

`pnpm run check` — typecheck, eslint (boundaries + local plugin), depcruise
mirror, vitest projects. `pnpm run smoke` — installed-tree check (every
declared dependency linked, every native asset the packaged bundle reads as a
literal path materialized), `lock-lint` under pnpm frozen-lockfile semantics,
boot the real in-process app, drive doctor/scan/config/status through the CLI
in an isolated temp HOME + temp folder, assert envelope shapes and taxonomy
exit codes. Both green = done; every new lint rule proves itself with a
violating probe before it counts.

The package manager is pnpm, pinned by `packageManager` and activated through
Corepack; dependency install scripts are off by default and the exceptions are
named in `pnpm-workspace.yaml` ([ADR-0006](decisions/0006-package-manager-pnpm.md)).

Changing this architecture means changing this document (and, for the frozen
constraints, ADR-0001) first, then the code.
