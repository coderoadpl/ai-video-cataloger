# ADR-0001: Local-first Electron rewrite on the agentproofarch foundation

Date: 2026-07-12 · Status: accepted (owner-decided at kickoff)

## Context

AI Video Cataloger exists as a working Electron + CLI app (branch
`feat/macos-packaging`; full behavioral inventory in
[`../../tasks/parity-inventory.md`](../../tasks/parity-inventory.md)) built
ad hoc: the GUI spawns a staged copy of the CLI and scrapes its NDJSON
output, services are a flat folder with no enforced boundaries, and no gate
proves the app actually runs. The owner decided to rebuild it ground-up on
the agentproofarch foundation, keeping the product identical (v1 = full
parity) — the rewrite is an architecture change, not a product change. The
domain (local AI models operating on the user's files) is why this is a
desktop app: everything must work with zero network once models are
downloaded.

Owner decisions fixed at kickoff (constraints, not open questions):

## Decision

1. **Variant B local-first** — the app IS the server. No remote backend; core
   functionality has no network dependency. The foundation's deployment
   matrix and public-surface layer are removed.
2. **No auth at all** — single implicit local user. Identity,
   `AuthPort`/`AuthClientPort` and multi-tenancy are stripped from the
   skeleton. Kept: layers, contract as the only bridge, error taxonomy with
   CLI exit codes, `Result` everywhere.
3. **Transport without network** — keep `core/contract` + the typed client;
   inject `fetchImpl := honoApp.request` so the whole typed client (zod
   envelope, taxonomy, descriptors, CQRS branding) runs in-process. The
   contract stays the single bridge; only the medium changes.
4. **SQLite via drizzle** behind the existing repository-port pattern; the
   composition root picks the driver. Per-folder catalog databases and the
   home scope are preserved byte-compatible with the old app.
5. **Electron shape (t3code model)** — `apps/desktop` main process =
   composition root; platform capabilities go through one typed preload
   bridge (`DesktopBridge`) declared in `core/contract`; bridge = port,
   preload = adapter. Renderer = `apps/web` (React 19 + TanStack
   Router/Query + MUI) following the foundation frontend architecture
   verbatim.
6. **CLI stays first-class** (`apps/cli`) — agent-first: every capability
   invocable headlessly with `--json` + taxonomy exit codes; it is also the
   test harness (smoke, e2e parity). The NDJSON event stream of the old CLI
   is a public contract and is preserved exactly.
7. **Jobs in-process** — the main process is a resident executor; the
   foundation's `JobsPort` pattern applies at the first real job, which the
   pipeline is from day one. Progress via job-status polling (TanStack
   Query); no event bus.
8. **Telemetry opt-in, default OFF** — OTel facade + wide events per the
   foundation, but nothing leaves the process without explicit user consent.
9. **Gates from day one** — `npm run check` and `npm run smoke` copied and
   adapted from the foundation demo; every lint rule proven by a violating
   probe; static-green is not done.

Further owner decisions at PRD interview (2026-07-12): full feature parity as
v1 scope; rewrite from scratch on branch `rewrite/foundation` in this repo
(old code as reference); MUI per the foundation demo replaces Radix UI; all
existing analyzer backends and transcription modes carry over.

## Consequences

- Two composition roots (Electron main, CLI) share one `createApp` factory;
  the GUI→CLI spawning layer and CLI staging into the .app disappear.
- The repository pattern gains a per-folder factory dimension the foundation
  did not have (one catalog DB per working folder).
- Auth-related foundation docs (ADR-0001/0002 there, identity sections) are
  intentionally not carried over; reintroducing identity requires a new ADR
  here.
- Old-app quirks are kept bug-for-bug except four deliberate deviations
  listed in the PRD (config keys honored by `process`, human label for the
  local-analyzer progress step, consistent `original_path` updates, whisper
  download checksums).
- Radix UI components are not migrated; the renderer is rebuilt on MUI with
  `theme.ts` as the only visual language.
