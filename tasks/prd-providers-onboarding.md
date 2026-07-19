# PRD: Analyzer providers, onboarding and managed dependencies (v1.1)

## Introduction

The foundation rewrite (v1, `prd-foundation-rewrite.md`) reproduced the old
app faithfully — including its onboarding gaps: no setup wizard, a default
analyzer that silently requires an authenticated Claude Code CLI, a "bundled"
whisper that nothing actually installs, and no gate stopping a user from
running a pipeline that cannot succeed. v1.1 makes the app usable by a
non-technical person on a fresh Mac (Apple Silicon first), and opens analysis
to any API provider and any agent harness instead of hard-coding two backends.

Owner decisions captured 2026-07-15 (kickoff for this PRD):

1. Code signing / notarization: **deferred to backlog** — right-click→Open is
   an acceptable interim; ship a short "first open" instruction instead.
2. Setup Wizard: **yes, both surfaces** — GUI wizard and a CLI equivalent.
3. Analyzers become three families: **(a) API-standard providers** (bring
   your own key, rough cost signaling), **(b) agent harnesses** (Claude Code,
   Codex, Cursor Agent preconfigured + user-defined custom), **(c) local
   models** (managed Ollama, as today).
4. Dependencies: ffmpeg stays bundled; whisper becomes **managed like the
   Ollama runtime** (app-downloaded with checksum) **or user-pointed** (path
   to an existing/GPU-optimized install); bundling whisper/Ollama into the
   .app is explicitly not the goal (too many machine-specific variants).
5. Prerequisite gate: both surfaces check prerequisites at launch and **do
   not let processing proceed** while the configured analyzer/transcriber is
   unusable — offering Settings or the Wizard instead.
6. macOS only, as before.

## Goals

- A fresh-Mac user reaches a successful first analysis guided entirely by the
  app (wizard → local model download → analyze), with zero terminal use.
- Any OpenAI-compatible API endpoint can act as the analyzer with a
  user-supplied key, with honest cost signaling.
- Any local agent CLI can act as the analyzer through a configurable harness
  definition; Claude Code, Codex and Cursor Agent ship preconfigured.
- Whisper works on a fresh machine via app-managed download, and power users
  can point at their own binary.
- No pipeline run can start against an unconfigured/unavailable backend; the
  failure mode is guidance, not an error dump.

## User Stories

### Phase A — provider architecture (core)

#### US-601: Analyzer provider registry in domain + contract
**Description:** As a developer, I need analyzer configuration to be data
(closed schema), not two hard-coded backends, so all three families fit one
port.

**Acceptance Criteria:**
- [ ] Domain schema for analyzer config: `{ family: 'api' | 'harness' |
  'local', providerId, ...family-specific fields }` (zod, closed unions)
- [ ] API family fields: baseUrl, apiKeyRef (see US-604), model,
  maxImageDetail; harness family fields: command, argsTemplate (placeholders
  `{prompt}`, `{videoDir}`), promptStyle, optional model and reasoningEffort;
  local family unchanged
  (modelTag)
- [ ] Per-folder config keys extended backward-compatibly:
  `analyzer_backend` keeps accepting `claude|local` (legacy aliases mapping
  to harness:claude-code and local) — old config.json files keep working
- [ ] Contract routes: providers list/test (`POST /api/providers/test` runs a
  cheap connectivity/auth check per family), config routes carry the new
  fields
- [ ] Unit tests: schema round-trips, legacy alias mapping

#### US-602: OpenAI-compatible API analyzer adapter
**Description:** As a user, I want to paste any API key (OpenAI, OpenRouter,
compatible endpoints) and analyze without local models or CLIs.

**Acceptance Criteria:**
- [ ] Adapter implements AnalyzerPort over the OpenAI chat-completions
  vision format: frames as base64 image parts + transcript in the prompt,
  same DESCRIPTION:/FILENAME: contract as other analyzers
- [ ] Base URL configurable (default `https://api.openai.com/v1`); model
  name free-text; timeout honored; AbortSignal honored (cancel works)
- [ ] Error mapping: 401 → missing/invalid key (taxonomy), 429 → rate
  limited with retry hint, 4xx/5xx → provider error with body excerpt
- [ ] Works headless via CLI: `--analyzer api` (+ config keys)
- [ ] Tests with a fake HTTP server: request shape, image encoding, error
  mapping, cancellation

#### US-603: Cost signaling for API analysis
**Description:** As a user, I want to know roughly what an analysis costs
before I run it, or at least be told that my provider will charge me.

**Acceptance Criteria:**
- [ ] Token estimator: transcript length + per-image cost heuristic per
  frame count → rough input/output token estimate per video
- [ ] Optional user-editable price fields (per 1M input/output tokens) in
  provider config; when set, the UI/CLI show "~$0.0X per video (estimate)"
- [ ] When prices are unset, both surfaces show the mandatory notice:
  "usage will be charged by your API provider" (before first API run and in
  Settings)
- [ ] Estimates are labeled as rough; never presented as billing truth
- [ ] Unit tests for the estimator and the display gating

#### US-604: API key storage
**Description:** As a user, I want my API key stored sensibly, not in a
per-folder config file that travels with my videos.

**Acceptance Criteria:**
- [ ] Keys live in the home scope (`~/.ai-video-cataloger/credentials.json`,
  chmod 600), NEVER in per-folder config.json; per-folder config stores only
  a provider reference
- [ ] Keys never appear in NDJSON output, logs, debug files, or error
  messages (test: grep the debug log + events after a failing run)
- [ ] CLI: `config set-credential <providerId>` prompts (hidden input) or
  reads env; GUI: password field in Settings/Wizard
- [ ] Documented in README (plain file, not Keychain — deliberate v1.1
  simplicity; Keychain is a named later upgrade)

#### US-605: Agent harness adapter family
**Description:** As a user, I want to use my installed agent CLIs (Claude
Code, Codex, Cursor Agent) or define my own command as the analyzer.

**Acceptance Criteria:**
- [ ] One harness adapter executing a configured command template with arg
  vector (never shell), placeholders `{prompt}`, `{videoDir}`; frames passed
  per promptStyle: `file-urls` (in prompt text) or `dir-access` (harness
  reads the folder)
- [ ] Three built-in definitions shipping as data: `claude-code`
  (`claude --add-dir {videoDir} -p {prompt}` — the existing adapter's
  behavior, including env filtering and the project-history-cleanup quirk,
  becomes this definition), `codex` (`codex exec` non-interactive with
  workspace read access), `cursor-agent` (its non-interactive print mode) —
  exact flags verified against the installed CLIs during implementation, not
  assumed; optional model/reasoningEffort config maps to built-in CLI flags
  where supported
- [ ] Custom harness: user provides name/command/args template in Settings
  (GUI) or config (CLI); validated (command exists) via providers/test
- [ ] Availability detection per harness (binary on PATH + version) feeds
  doctor and the wizard
- [ ] Timeout + cancel kill the child process group
- [ ] Tests: template expansion (no shell injection via filenames/prompt),
  per-harness arg construction, availability detection with fake spawner

### Phase B — managed whisper

#### US-606: Managed whisper.cpp runtime
**Description:** As a fresh-Mac user, I want local transcription to work
without installing anything myself.

**Acceptance Criteria:**
- [ ] Pinned whisper.cpp release (universal/arm64 binary) downloaded on
  demand to `~/.ai-video-cataloger/bin/` with SHA-256 verification —
  same pattern and code shape as the managed Ollama runtime
- [ ] Resolution order becomes: explicit configured path → managed binary →
  system `whisper`; the existing `~/.ai-video-cataloger/bin/whisper`
  location stays canonical (parity with the resolver)
- [ ] `whisper_binary_path` config key (home scope) for user-pointed
  installs (e.g. GPU-optimized builds); Settings + wizard expose it
- [ ] Doctor/prerequisites reflect the three sources (configured / managed /
  system) with install action wired to the managed download
- [ ] CLI: `models whisper-runtime install|status` (naming consistent with
  existing `models` subcommands); GUI: install button in Model Manager /
  wizard
- [ ] Tests: resolution precedence, checksum rejection, download temp+rename

### Phase C — gating and onboarding

#### US-607: Prerequisite gate on both surfaces
**Description:** As a user, I must not be able to start a run that cannot
succeed; the app should point me at the fix instead.

**Acceptance Criteria:**
- [ ] A `readiness` use-case evaluates the CONFIGURED analyzer + transcriber
  (not all backends): available / missing pieces / suggested action —
  cheap (cached per process, refreshed on settings change and on demand)
- [ ] GUI: evaluated at every launch and before every run; when not ready,
  Analyze/batch actions are disabled with an inline explanation and buttons
  to Settings / Setup Wizard; browsing folders/artifacts stays available
- [ ] CLI: `process` refuses to start with `prerequisites_failed` +
  actionable message naming the missing piece and pointing at the wizard
  command (the v1 prereq gate extends to the new families)
- [ ] doctor gains the configured-analyzer view while keeping its legacy
  all-backends output (NDJSON compat preserved)
- [ ] Tests: each family's unready states produce the right guidance; ready
  states pass through

#### US-608: GUI Setup Wizard
**Description:** As a new user, I want a guided first launch that leaves me
with a working configuration.

**Acceptance Criteria:**
- [ ] Auto-opens on first launch (flag in home scope) and reachable anytime
  from Help menu + from the gate's "Open Setup Wizard" action
- [ ] Steps: welcome → analyzer choice (Local recommended on Apple Silicon
  with RAM-based model suggestion / API with key + cost notice / harness
  with detected-installed badges) → transcription choice (managed whisper
  download / own path / API / skip) → downloads run inline with progress
  (jobs) → final readiness check → done
- [ ] Every step validates before advancing (providers/test); skippable with
  explicit "configure later" (gate then keeps processing disabled)
- [ ] Follows the foundation frontend architecture (feature island, bound
  actions, MUI theme); component tests per step with MSW

#### US-609: CLI wizard
**Description:** As a CLI user, I want the same guided setup in the
terminal.

**Acceptance Criteria:**
- [ ] `ai-video-cataloger setup` — interactive prompts mirroring the GUI
  wizard steps (readline; no new prompt dependency unless needed), writing
  the same config/credentials
- [ ] Non-interactive mode: `setup --analyzer local --local-model ... --yes`
  for scripted setup; `--json` emits NDJSON progress for downloads
- [ ] Idempotent re-run adjusts existing config
- [ ] e2e-style CLI test driving the non-interactive path on a temp HOME

### Phase D — distribution polish

#### US-610: DMG + first-open instructions
**Acceptance Criteria:**
- [ ] `electron:package` produces the DMG (target already configured);
  README gains a "first open on macOS" section (right-click → Open /
  Privacy & Security → Open Anyway)
- [ ] Backlog task recorded for Developer ID signing + notarization
  (deferred by owner decision — requires Apple Developer account)

### Phase E — configuration-matrix e2e (owner-mandated 2026-07-17)

#### US-611: Full real E2E configuration matrix (owner: "real, complete —
not cheap"; runs on demand after a work batch, never in the gates)

**Description:** As the owner, I want EVERY analyzer/transcription
configuration exercised end-to-end with the REAL thing — real managed
runtimes, real model downloads, real inference, real API calls, real agent
CLIs — so wiring bugs like "managed runtime unreachable from the analyzer"
or "wizard writes a scope nothing reads" cannot ship again.

**Acceptance Criteria:**
- [ ] New Playwright project `matrix` (`test/e2e/matrix.spec.ts`), invoked
  by `npm run test:e2e:matrix` — deliberately NOT part of `check`/`smoke`/
  the parity projects; documented in CLAUDE.md as the batch-end/pre-release
  suite.
- [ ] Analyzer cells, all REAL, each driving the full pipeline on a sample
  video and asserting user-observable results (catalog status, rename,
  summary content, NDJSON/UI states):
  - **local-managed**: real managed Ollama runtime (downloaded/started by
    the app on its dynamic port) + real vision model (`gemma3:4b` as the
    matrix model — smallest supported tier) + real inference; also asserts
    the no-model intermediate state fails as `model_not_installed`, never
    unreachable/wrong-port
  - **local-system**: system daemon path (existing S1-local coverage,
    folded into the matrix)
  - **api**: real OpenAI-compatible round-trip through the api adapter
    against Ollama's native `/v1` endpoint (default: local daemon +
    `gemma3:4b`, dummy key — Ollama ignores auth; real inference, real
    protocol). `E2E_API_BASE_URL`/`E2E_API_KEY`/`E2E_API_MODEL` switch the
    same cell to a real cloud provider when the owner supplies a key
    (per-call cost accepted then); 401-mapping stays unit-covered
  - **harness × 3**: real `claude`, real `codex`, real `cursor-agent`
    non-interactive invocations, one cell each
- [ ] Transcription cells, all REAL: managed whisper.cpp (app-installed
  binary + real model), configured-path binary, OpenAI whisper API (real
  key), and skip — crossed with at least one analyzer each rather than the
  full cross-product where redundant.
- [ ] Wizard→folder GUI cell: fresh app HOME → wizard completes a REAL
  working configuration → open a folder → readiness gate reflects the
  choices → a real process run succeeds.
- [ ] **Big-artifact caching**: model/runtime downloads land in a persistent
  matrix cache (`~/repositories/claude-tmp/avc-e2e-matrix-home/`), reused
  across runs — first run pays the downloads (~4 GB), later runs are
  minutes; per-test folder state stays isolated per run.
- [ ] Preflight per cell: a cell whose environmental leg is missing (no API
  key, CLI not installed/authenticated) FAILS LOUDLY with the reason —
  never silently skips to green; an explicit `E2E_MATRIX_ALLOW_SKIP` env
  exists for machines that genuinely lack a leg.
- [ ] A summary table is printed at the end: cell × result × duration.

## Functional Requirements

- FR-1: Analyzer configuration is a closed, versioned schema covering the
  three families; legacy `claude|local` values keep working unmodified.
- FR-2: The pipeline treats all analyzer families identically behind
  AnalyzerPort (same DESCRIPTION/FILENAME contract, timeout, cancel, debug
  log).
- FR-3: API keys never leave the home scope and never appear in any output
  or artifact.
- FR-4: Every network download (whisper binary, models) is
  checksum-verified where a checksum exists and uses temp+rename.
- FR-5: Neither surface starts a pipeline whose configured backend is
  unavailable; the refusal names the missing piece and links the fix.
- FR-6: The wizard can take a fresh Apple-Silicon Mac to a successful fully
  local analysis with no terminal interaction.
- FR-7: All v1 parity guarantees (NDJSON, exit codes, on-disk layout)
  remain intact; new commands/routes are additive.

## Non-Goals

- No Windows/Linux; no Intel-Mac local AI (unchanged).
- No bundling of whisper/Ollama binaries inside the .app (managed downloads
  instead — owner decision; too many machine-specific variants).
- No Keychain integration in v1.1 (named upgrade).
- No live billing integration or exact cost accounting — estimates and
  notices only.
- No signing/notarization in v1.1 (backlog, needs Apple Developer account).
- No streaming token UX for API analysis (poll-based progress stays).

## Technical Considerations

- Harness definitions are data, so the three built-ins and custom entries
  share one adapter — no per-harness code paths beyond the definition table.
  Verify exact non-interactive invocations against the owner's installed
  CLIs (claude, codex, cursor-agent) during implementation; do not trust
  training-data flags.
- The API adapter should reuse the existing filtered-env/spawn-free HTTP
  path (fetch with AbortSignal), not a vendor SDK, to keep the dependency
  surface flat (openai package is already present for whisper API — decide
  once, document in the architecture delta).
- Readiness caching must not reintroduce the stale-cache class of bugs
  (audit lesson): cache per process with explicit invalidation on config
  writes.
- Architecture delta update (docs first): AnalyzerPort adapter list, managed
  whisper runtime, readiness use-case, credentials store location.

## Success Metrics

- Fresh macOS user test: DMG → right-click open → wizard → local analysis
  succeeds without terminal (manually verified per release).
- `setup --yes` scripted on a temp HOME yields a ready `doctor`/readiness
  state and a passing `process` run.
- All three built-in harnesses pass `providers/test` on the owner's machine.
- v1 parity e2e suite stays green throughout.

## Resolved Questions (owner, 2026-07-15)

1. API family scope: **OpenAI-compatible only** in v1.1 (Anthropic reachable
   via OpenRouter/proxies); native Anthropic adapter is a later option.
2. Cost table: **editable price fields only**, no built-in price table.
3. Prerequisite gate frequency: **every launch + before every run**, cached
   per process with invalidation on settings writes.
4. Managed whisper source: official whisper.cpp releases turned out to ship
   **no macOS binaries** (source only — verified against live releases), so
   the resolution is the **Homebrew `whisper-cpp` bottle from ghcr.io**
   (prebuilt arm64, anonymously downloadable without brew, pinned version +
   sha256 from the formula), with extracted dylib install-names rewritten to
   `@loader_path` so the binary runs without a Homebrew installation.
   The source-build path remains as a fallback when build tools exist.
5. Implementation starts immediately (parallel to the owner's v1 review).
6. (2026-07-17, resolving the audit-loop owner items) Config scope
   precedence: **flag > folder > home > default** per key; wizard and
   `models use` write home-scope global defaults; folder config overrides
   point-wise. GUI Prerequisites reads configured-readiness from
   `/api/readiness` with the selected folder; doctor contract unchanged.
