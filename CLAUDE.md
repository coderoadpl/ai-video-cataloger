# ai-video-cataloger — repo map for agents (branch: rewrite/foundation)

Ground-up rewrite on the agentproofarch foundation. Read before designing
anything:

- `docs/architecture.md` — normative architecture, written as a **delta**
  against the foundation's `docs/architecture.md` (foundation rules apply
  unless overridden there).
- `docs/decisions/0001-local-first-electron.md` — frozen kickoff constraints;
  do not relitigate.
- `tasks/prd-foundation-rewrite.md` — v1 scope (full parity), phased stories.
- `tasks/parity-inventory.md` — exhaustive behavioral inventory of the old
  app; the parity ground truth. Old PRDs (`tasks/prd-*.md`) are background.

## Layout

| Path | Contents |
|---|---|
| `core/domain` `core/contract` `core/server` `core/client` | pure TS layers per the foundation; contract is the only bridge |
| `adapters/` | db (drizzle/sqlite), ffmpeg, whisper, claude-cli, ollama (+ managed runtime), jobs |
| `apps/server` | Hono app + `createApp` composition factory |
| `apps/desktop` | Electron main = composition root, preload bridge adapter, `media://`, menus |
| `apps/web` | renderer SPA (React 19, TanStack Router/Query, MUI) — foundation frontend rules verbatim |
| `apps/cli` | commander over `core/client`; NDJSON events + taxonomy exit codes (public contract) |
| Legacy app | removed after parity was proven; see git history |

## The two gates

- `pnpm run check` = typecheck + eslint (boundaries; the local plugin joins
  with the renderer phase) + dependency-cruiser + the renderer bundle build
  (`electron:build:renderer`, which refuses any Node builtin in the renderer
  module graph) + vitest + `pnpm run visual` (Playwright screenshot comparison
  against the baselines of the current `VISUAL_ENV`, as required by
  [ADR-0005](docs/decisions/0005-visual-regression.md)(d) and (f)).
- `pnpm run smoke` = installed-tree check → lockfile lint → boot the real
  in-process app in a temp HOME/folder → drive doctor/scan/config/status
  through the CLI → assert envelope shapes and taxonomy exit codes.

`pnpm run visual` (screenshot comparison of the layout skeletons, including the
sidebar surfaces, against the baselines in `visual/__screenshots__/` —
[ADR-0005](docs/decisions/0005-visual-regression.md)) builds and previews the
`apps/web/visual.html` harness — no Electron, no server, no analysis run — and
is now part of `check` (W43). An intentional
UI change is a two-step commit: land the change, run
`pnpm run visual --update-snapshots` (no `--` — pnpm 10 forwards the literal
`--` and Playwright then silently ignores the flag), review and commit the
PNGs.
The baseline set is chosen by `VISUAL_ENV` (ADR-0005(f)): unset or
`local-darwin` → `__screenshots__/darwin/` (the local default, nothing changes
for a local run), `ci-macos-15` → `__screenshots__/ci-macos-15/`, rendered on
the hosted runner by the `visual-baselines` workflow and reviewed in its own PR;
any other value is rejected. Re-baselining CI is a workflow dispatch, never a
tolerance change.
`scripts/gallery-shots.mjs` stays a capture-only dev tool, never a second
baseline store.

`doc-lint` also holds the docs to the toolchain: every `pnpm run <script>` a
tracked `README.md` documents must exist in the `package.json` that owns that
README, so a renamed or dropped script turns `check` red instead of leaving a
quickstart that lies.

**Done = check green AND smoke green.** Never weaken lint to get there; every
new lint rule must first fail on a violating probe file.

The package manager is **pnpm**, pinned by `packageManager` (`pnpm@10.34.5`)
and `engines.pnpm` (`>=10 <11`), on **Node 22.23.1** (`.nvmrc`), whose bundled
Corepack 0.34.6 activates that pin — Node 24 is deferred because V8 there
reports branch coverage ~4 points lower and trips the ratchet floor, and older
Node 22 patches ship a Corepack that rejects pnpm's signing key; both are
recorded in [ADR-0006](docs/decisions/0006-package-manager-pnpm.md). Switch to
the pin with `nvm use` before touching dependencies; a stale global pnpm is
rejected by `engines.pnpm`. Dependency install scripts do **not** run: the
three that earned an exception (`ffmpeg-static`,
`@ffprobe-installer/darwin-arm64`, `electron`)
are named in `pnpm-workspace.yaml`'s `onlyBuiltDependencies`, which also carries
the `minimumReleaseAge` cooldown. `pnpm run lock-lint` fails closed on a missing
`pnpm-lock.yaml` or one that no longer agrees with `package.json`, and `smoke`
runs it plus the installed-tree check that every native asset
`electron-builder.config.js` and the staged CLI read as a literal path is
materialized — the round-1 lesson (a green `check` with a broken
`electron:package`) now has a gate that names it.

**Flake doctrine: the gates are deterministic; a flake is a P1 bug, never
rerun-to-green.** A red gate means the commit is wrong or the gate is wrong —
one of them gets fixed; rerunning a red job until it passes is forbidden.
Playwright runs with exactly one retry (`retries: 1`) and
`trace: 'on-first-retry'` as diagnostic capture only — any run the retry turned
green is flaky-flagged and requires a filed P1 before merging, never a silent
re-run.

**e2e drives the real UI.** Every in-app
interaction in an e2e spec/script is a real click/keystroke. Native macOS
surfaces (dialogs, menu bar) are the only sanctioned stub point, patched in
the Electron main process via `app.evaluate` while the in-app control that
triggers them is still clicked for real. Environment setup (temp
HOME/userData, fixtures, onboarding flag, window-state) stays allowed;
pre-seeding app-owned state that stands in for a user flow (`folder-store.json`
faking a pick, `desktopBridge.folder.setCurrent`+`reload()`, shelling a CLI
config command mid-GUI-test) is forbidden. Assert outcomes on the UI first; a
direct data read (catalog.db via sql.js) is only a secondary invariant. CLI
specs testing the CLI surface itself are exempt. Reference:
`test/e2e/open-folder.spec.ts`.

## On-demand real-provider suite

- `pnpm run test:e2e:matrix` = batch-end/pre-release real-provider suite. It
  uses a persistent cache below a scratch directory outside the repository
  (`AVC_SCRATCH_DIR`, defaulting to `~/.ai-video-cataloger-scratch`),
  exercises managed/system/API/harness analyzers and every transcription
  source, plus two `ro-mount` legs that mount a real read-only `hdiutil` image
  and assert index-only mode (the detection leg is never skippable on macOS),
  fails on unavailable legs unless `E2E_MATRIX_ALLOW_SKIP=1` is set, and is
  intentionally outside `check`, `smoke`, and parity. Run it after a completed
  work batch and before a release; never add it to a normal gate. It must be
  run from a normal (unsandboxed) shell — `hdiutil create` fails with `Device
  not configured` under an agent Bash sandbox.
- `pnpm run verify:package` = packaged-bundle shape check (single darwin
  onnxruntime binding, no non-darwin artifacts); run it on the built bundle
  before a release, also outside the normal gates.
- `pnpm run qa:walkthrough` = scripted self-QA pass over the packaged app
  (launch, open folder, tree, analysis, search, settings, wizard) that captures
  one screenshot per step into a timestamped directory, with an isolated
  user-data directory, an isolated home and the keychain disabled. Mandatory
  before any DMG handoff, together with the screenshot review listed in
  [docs/qa/release-walkthrough.md](docs/qa/release-walkthrough.md); never part
  of `check` or `smoke`.
- `pnpm run test:e2e:open-folder` = builds Electron and drives the real header
  "Open Folder" button through Playwright `_electron` (dialog stubbed in the
  main process, not the `desktopBridge.folder.setCurrent` shortcut the other
  GUI drivers use) to prove the picked folder lands in the analysis view on the
  medium already in use — videos from a fresh install, photos from a
  photos-analysis session; outside `check` and `smoke`.

## House rules

- No `any`, no `as` (except `as const`); zod-parse at every boundary;
  use-cases return `Result<T, AppError>`, nothing throws across a boundary.
- New error kinds: extend the closed `ErrorCode` union + exhaustive HTTP
  status and CLI exit-code mappings.
- Renderer: bound actions only — no `electron`/`ipcRenderer`/`fetch`, no
  inline query keys, no global state libs; visual language only in `theme.ts`.
- Zero code comments except a non-obvious WHY.
- Public-repository privacy: never put owner-private data in repo artifacts,
  including names or handles, local paths, home-directory paths, scratch paths,
  volume names, personal library facts or run statistics, or private
  tooling-session names or contents; use generic product language. Every worker
  prompt that can produce repo artifacts must carry this rule verbatim.
- Parity first: user-observable behavior (NDJSON events, exit codes, on-disk
  layout, DB files) must match `tasks/parity-inventory.md`; the four
  sanctioned deviations are listed in the PRD's Technical Considerations.
- Docs first: architecture changes edit `docs/` before code.
- The changelog travels with the change: a behaviour-visible change — a new or
  changed capability, CLI command, event, exit code, config key, gate or
  operational procedure — adds one factual line to
  [`CHANGELOG.md`](CHANGELOG.md) (Keep a Changelog) **in the same commit**, under
  `[Unreleased]`. Entries there carry no link — a commit cannot cite its own hash
  — and the release commit adds the commit links as it moves them under the
  version heading; we ship from a branch, so commits, not PRs, are the citation.
  Pure refactors, test-only and comment-only changes do not. This is enforced by
  review, not by a gate — no script can tell a user-visible change from an
  internal one.
- Dev component gallery is a QA tool, not shipped: `apps/web/src/gallery` +
  `apps/web/gallery.html` render components in isolation, and
  `scripts/gallery-shots.mjs` captures reference screenshots.
- **Keychain fixture hygiene.** Never
  run `security` against a fixture keychain without supplying its password
  (`unlock-keychain -p` first, or the trailing-path form with the item's
  password known) because a password-less open queues a GUI SecurityAgent
  dialog. Wrap every `security` invocation in a timeout because FIFO fixtures
  can hang it indefinitely. End every round by killing
  leftover `security` processes and deleting FIFO fixtures. Any scenario that
  intentionally can raise a GUI prompt: warn the operator BEFORE the run, never
  fire it unattended.
- **Versioning policy.** The patch version is
  bumped with practically every merged PR (at minimum every wave); no two
  differing builds may ever share a version string. See
  [docs/qa/release-readiness.md](docs/qa/release-readiness.md).
