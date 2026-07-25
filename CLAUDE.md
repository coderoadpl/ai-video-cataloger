# ai-video-cataloger — repo map for agents (branch: rewrite/foundation)

Ground-up rewrite on the agentproofarch foundation
(`~/repositories/agentproofarch`). Read before designing anything:

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
  with the renderer phase) + dependency-cruiser + vitest.
- `pnpm run smoke` = installed-tree check → lockfile lint → boot the real
  in-process app in a temp HOME/folder → drive doctor/scan/config/status
  through the CLI → assert envelope shapes and taxonomy exit codes.

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

## On-demand real-provider suite

- `pnpm run test:e2e:matrix` = batch-end/pre-release real-provider suite. It
  uses the persistent `~/repositories/claude-tmp/avc-e2e-matrix-home` cache,
  exercises managed/system/API/harness analyzers and every transcription
  source, fails on unavailable legs unless `E2E_MATRIX_ALLOW_SKIP=1` is set,
  and is intentionally outside `check`, `smoke`, and parity. Run it after a
  completed work batch and before a release; never add it to a normal gate.
- `pnpm run visual` = screenshot comparison of the layout skeletons against the
  darwin baselines in `visual/__screenshots__/`
  ([ADR-0005](docs/decisions/0005-visual-regression.md)). It builds and previews
  the `apps/web/visual.html` harness — no Electron, no server, no analysis run —
  and is deliberately outside `check` and `smoke` until the owner arms it.
  `scripts/gallery-shots.mjs` stays a capture-only dev tool, never a second
  baseline store.
- `pnpm run verify:package` = packaged-bundle shape check (single darwin
  onnxruntime binding, no non-darwin artifacts); run it on the built bundle
  before a release, also outside the normal gates.

## House rules

- No `any`, no `as` (except `as const`); zod-parse at every boundary;
  use-cases return `Result<T, AppError>`, nothing throws across a boundary.
- New error kinds: extend the closed `ErrorCode` union + exhaustive HTTP
  status and CLI exit-code mappings.
- Renderer: bound actions only — no `electron`/`ipcRenderer`/`fetch`, no
  inline query keys, no global state libs; visual language only in `theme.ts`.
- Zero code comments except a non-obvious WHY.
- Parity first: user-observable behavior (NDJSON events, exit codes, on-disk
  layout, DB files) must match `tasks/parity-inventory.md`; the four
  sanctioned deviations are listed in the PRD's Technical Considerations.
- Docs first: architecture changes edit `docs/` before code.
- Dev component gallery is a QA tool, not shipped: `apps/web/src/gallery` +
  `apps/web/gallery.html` render components in isolation, and
  `scripts/gallery-shots.mjs` captures reference screenshots.
