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

- `npm run check` = typecheck + eslint (boundaries; the local plugin joins
  with the renderer phase) + dependency-cruiser + vitest.
- `npm run smoke` = lockfile drift → boot the real in-process app in a temp
  HOME/folder → drive doctor/scan/config/status through the CLI → assert
  envelope shapes and taxonomy exit codes.

**Done = check green AND smoke green.** Never weaken lint to get there; every
new lint rule must first fail on a violating probe file.

## On-demand real-provider suite

- `npm run test:e2e:matrix` = batch-end/pre-release real-provider suite. It
  uses the persistent `~/repositories/claude-tmp/avc-e2e-matrix-home` cache,
  exercises managed/system/API/harness analyzers and every transcription
  source, fails on unavailable legs unless `E2E_MATRIX_ALLOW_SKIP=1` is set,
  and is intentionally outside `check`, `smoke`, and parity. Run it after a
  completed work batch and before a release; never add it to a normal gate.

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
