# Migration to agentproofarch @ cf247d1 — round 2

Status: IN PROGRESS (started 2026-07-27). Baseline: round 1 completed
2026-07-25 against foundation `bcb038b` (`tasks/migration-agentproofarch.md`).
This round covers the 112-commit foundation delta `bcb038b..cf247d1`.

Doctrine unchanged from round 1: the foundation is normative unless this app's
specifics demand a deviation, and every deviation is written down with its
reason. Decisions below were made under the owner's standing delegation
("niektóre decyzje muszą być nasze własne"); items needing the owner are
flagged OWNER.

## Foundation delta inventory

| Change | What it is |
|---|---|
| ADR-0008 | Visual regression: Playwright `toHaveScreenshot()`, determinism levers (animations off, fixed viewport, DSF 1, caret hide, `maxDiffPixels: 0` + `threshold: 0`, `retries: 0`, `workers: 1`), platform-scoped committed baselines rendered on the CI platform, separate non-required suite; Storybook and SaaS diffing rejected |
| ADR-0009 | npm → pnpm: dependency lifecycle scripts blocked by default, `onlyBuiltDependencies` allowlist (minimal, evidence-earned), `minimumReleaseAge` 3 days, strict non-hoisted layout, lock-lint retargeted to frozen-lockfile semantics, Node 22 → 24, Corepack |
| ADR-0010 | Tenant-creation policy (`TENANT_CREATION` env-derived grant row) |
| ADR-0011 | Layout layer: `components/layout/` as a named structural element (page skeletons, structure only, slots, non-happy states inside the skeleton), `AppShell` split from the stateful composition, `web-layouts-are-structure-only` depcruise rule + config-regression probe, visual spec per skeleton on the ADR-0008 harness, structural `sx` tier NORMATIVE WHEN TRIGGERED |
| ADR-0004 upd | `ai-review` is now a required check on `main-gates`; SHA-pin comment conventions widened; production ruleset dismisses stale approvals |
| Conventions | CHANGELOG.md (Keep a Changelog) + docs travel with behaviour-visible changes, in the same PR; Docusaurus `website/` published to Pages; `quickstart-probe` gates that the documented fresh-clone flow is true; smoke hardening; scaffolder template updates |
| US-020/DR | Vercel Domains adapter, k3d DR-acceptance workflow, self-host docs |

## Decisions for this app

1. **ADR-0011 layout layer → ADOPT (adapted).** Our tree exhibits the exact
   defect the ADR names: `features/shell/AppShell.tsx` is the stateful chrome
   living in a feature, and `components/ui/AppLayout.tsx` is a page skeleton
   living in `ui/`. Plan: `apps/web/src/components/layout/` with the
   structure-only rule (`web-layouts-are-structure-only` in dependency-cruiser
   + boundaries entry + a config-regression probe that a violating fixture
   turns `check` red); split the shell into a chrome skeleton
   (`components/layout/AppShell.tsx`: sidebar rail region, content region,
   terminal drawer region, widths, slots, no server state) and a thin stateful
   composition beside `main.tsx`; relocate/absorb `components/ui/AppLayout.tsx`.
   App-specific rulings: (a) skeletons carry **no i18n** — structure has no
   copy; slots deliver translated content (consistent with the round-1 island
   i18n ruling); (b) the resizable sidebar/terminal sizes are structure —
   current width arrives as a prop, persistence stays in the composition;
   (c) non-happy branches (loading skeletons, empty states, degraded/read-only
   banners' *placement*) render inside the skeleton. The structural `sx` tier
   stays NORMATIVE WHEN TRIGGERED, same trigger as upstream (first duplicated
   page skeleton outside `components/layout/`). The optional MUI import ban
   (`Container`/`AppBar`/`Drawer`/`Toolbar` outside layout) is adopted — we
   render on MUI, it closes rule (b) cheaply.
2. **ADR-0008 visual regression → ADOPT (adapted).** One screenshot engine:
   a new `visual/` Playwright suite with `toHaveScreenshot()` and the
   determinism levers verbatim. App-specific rulings: (a) **darwin baselines
   are the platform truth** — this is a mac-only Electron app and the CI runner
   is (will be) the owner's mac; until the self-hosted runner is registered,
   baselines are authored on the same machine that runs the gates, which is
   the same rasterizer — the ADR's "render where the gate runs" principle,
   not its linux letter; (b) the suite drives the built renderer bundle
   (vite build + preview) with MSW-style fixtures, not live Electron — the
   packaged-app journeys stay in e2e; (c) surfaces: layout skeletons and
   their states first (AppShell chrome, status/empty states) — only
   deterministic surfaces, no thumbnails/timestamps; (d) the check is
   **non-required** (not in `check`/`smoke`), exactly as upstream, until the
   owner arms it (OWNER); (e) `scripts/gallery-shots.mjs` keeps its round-1
   role — dev QA tool, not a gate, and NOT a second baseline store (it
   captures, it does not compare).
3. **ADR-0009 pnpm → SPIKE FIRST, decide by evidence (our ADR-0006).** The
   supply-chain rationale is strong and owner-approved upstream, but this app
   has hard packaging couplings the foundation does not: `electron-builder`
   config reads literal `node_modules` paths (`onnxruntime-node`,
   `@ffprobe-installer/darwin-arm64`), asarUnpack + the packaged-CLI staging,
   and the round-1 npm-10 lock-lint machinery. pnpm's strict symlinked layout
   changes exactly that ground. Spike on an **isolated worktree**: Corepack
   pnpm pin, lockfile import, minimal `onlyBuiltDependencies`
   (evidence-earned), then the full ladder — `check`, `smoke`,
   `electron:package`, `verify:package`, packaged CLI in temp HOME, one real
   e2e leg. Decision tree: green → ADOPT (lock-lint retargeted to pnpm
   frozen-lockfile, `minimumReleaseAge` 3 days, toolchain story rewritten,
   CI workflows updated, Node 24 bump evaluated in the same spike); packaging
   breaks on the strict layout → evaluate `node-linker: hoisted` as **our
   sanctioned deviation** (keeps script-blocking + cooldown + one lockfile;
   gives up strict layout; the foundation forbids it for itself, an Electron
   app may trade it for packaging determinism — documented honestly); both
   fail → REJECT for now in ADR-0006 with the evidence and a revisit trigger.
   No blind adoption: the round-1 lesson (npm-11 silently pruning
   platform-optional lock entries) lives in this exact ground.
   **RESOLVED 2026-07-27 → ADOPT strict**
   ([ADR-0006](../docs/decisions/0006-package-manager-pnpm.md)). The whole
   ladder is green on the default linked layout, DMG included; no
   `node-linker` deviation. Three `onlyBuiltDependencies` entries earned their
   place (`ffmpeg-static`, `@ffprobe-installer/darwin-arm64`, `electron`). The
   Node 24 half of the decision is **deferred with evidence**: V8 on 24 reports
   branch coverage ~4 points lower and trips the ratchet floor, so the pin moves
   to Node 22.23.1 (whose bundled Corepack accepts pnpm's key) and Node 24
   rides along with the vitest 4 upgrade.
4. **ADR-0010 tenant policy → REJECT (N/A).** Local-first, no auth, no
   tenants. Recorded here; no code.
5. **US-020 Vercel adapter / DR-acceptance / self-host docs → REJECT (N/A).**
   No server deployment target.
6. **ai-review as required check → ADOPT, BLOCKED-ON-OWNER.** The workflow
   shipped in round 1; making it required needs the self-hosted runner
   registered (owner action, reminder 2026-07-29) and a ruleset edit (OWNER).
7. **Changelog discipline → ADOPT.** Root `CHANGELOG.md` (Keep a Changelog),
   one factual line per behaviour-visible change in the same commit; enforced
   by review convention (not a gate), mirrored in the PR template. Backfilled
   from the v0.4.0..v0.5.13 release history at release granularity.
8. **Docusaurus docs site → OWNER decision, out of scope this round.** Our
   public surface is the landing page; a published docs site is a product
   call (hosting, audience).
9. **Quickstart-probe → ADAPT (minimal).** The analogous ground is already
   gated (`verify:package`, packaged CLI in temp HOME). Adopt only a doc-lint
   extension asserting README-documented commands exist in `package.json`
   scripts — the smallest probe that catches the drift class.
10. **Scaffolder/template deltas → ADOPT where our scaffolds drifted** from
    the rung-1 island seam doctrine; verify, sync, nothing speculative.
    **RESOLVED 2026-07-27 → NO CODE, ONE DOC SYNC.** What was checked:
    (a) we have no scaffolder — `new:island` / `new:resource` / `scripts/templates`
    do not exist here, and none was built (two islands do not earn a generator);
    (b) the foundation's island template delta across `bcb038b..cf247d1` is a
    single commit (`685d704`, the pnpm migration) touching `new-island.ts`,
    `island-index.ts.tpl`, `island-index.web.store.ts.tpl`,
    `island-selectors.ts.tpl` and `page.tsx.tpl` — every hunk is `npm run` →
    `pnpm run` prose, so **no doctrine moved**; (c) the rung-1 seam our docs
    promise was compared field by field against the current templates:
    factory-over-deps core (`create<X>Core`) ✓, descriptors injected at the one
    web binding `index.web.ts` ✓, colocated node-only core test ✓, DOM-free
    portability via `tsconfig.islands.json` ✓, `index.web.ts` never imported
    backwards by `api.ts` ✓; (d) the one standing difference is our round-1
    ruling that a rung-1 core carries **no inbound event union** (the foundation
    scaffolds `core/events.ts` with a stubbed `send` at rung 1) plus our i18n
    typed-key ruling, which the foundation's templates are silent about — both
    were undocumented in `docs/architecture.md` §Island cores and are now
    written down there, with the `avc/event-suffix-taxonomy` rule named as the
    enforcement waiting for the first rung-2 graduation.

## Phases

- **P0** — this plan; Todoist board entry. DONE with this commit.
- **P1** — layout layer (decision 1): our ADR-0004-layout-layer + architecture
  delta first, then the extraction/split, rule + probe, tests, gates.
- **P2** — visual suite (decision 2): our ADR-0005-visual-regression, config +
  specs + darwin baselines, `pnpm run visual`, docs. DONE 2026-07-27: eight
  baselines (four skeleton states × dark/light) under
  `visual/__screenshots__/darwin/`, green twice from a clean build.
- **P3** — pnpm spike on an isolated worktree → evidence report → ADR-0006 →
  adopt/deviate/reject per the tree above. May run parallel to P1 (separate
  worktrees; the M1/L1 shared-worktree collision is the standing lesson).
- **P4** — conventions: CHANGELOG.md + PR template line, doc-lint README
  probe, scaffolder sync, doc updates. DONE 2026-07-27 except the PR-template
  line, which is moot here: we ship from a branch, so the convention lives in
  `CLAUDE.md` and `CHANGELOG.md`'s own header instead.
- **P5** — full audit (check + smoke + matrix subset + verify:package +
  packaged-CLI), release, docs sync, status flip to COMPLETE here.

Every phase runs impl → independent empirical review (journeys + screenshots
on the built app) → gates under the pinned toolchain. House rules apply
verbatim: zero code comments, no commit footers, flake = P1.
