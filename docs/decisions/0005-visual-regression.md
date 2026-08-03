# ADR-0005: Visual regression — Playwright screenshots over the built renderer

Date: 2026-07-27 · Status: **armed into `check` (2026-08-03, owner mandate,
W43)** — see (d) below for what changed and why. Adopts the foundation's
ADR-0008
(`agentproofarch/docs/decisions/0008-visual-regression.md`) with the
app-specific rulings below. Builds on [ADR-0004](0004-layout-layer.md) (the
layout layer, whose skeletons are the surfaces screenshotted here) and the flake
doctrine in [CLAUDE.md](../../CLAUDE.md).

## Context

`pnpm run check` proves behaviour and `pnpm run test:e2e:parity` proves the
packaged journeys, but neither can see appearance: a theme token, an MUI upgrade
or a stray `sx` value repaints the whole shell without failing an assertion.
ADR-0004 extracted the chrome into `components/layout/AppShell.tsx` precisely so
that shape has one owner — and a structural owner with no pixel gate is an
owner nobody checks.

The foundation's context, its design center (determinism before coverage) and
its rejected alternatives (Storybook + Lost Pixel, SaaS diffing services) all
transfer unchanged. This document is a **delta**: what we adopt verbatim, and
what this app decides for itself.

## Adopted verbatim from foundation ADR-0008

1. **Playwright `toHaveScreenshot()`, baselines committed in-repo.** PNGs under
   `visual/__screenshots__/{platform}/{projectName}/`, reviewed in the diff that
   changes them. No new runtime, no new service, no hosting decision.
2. **A separate suite, structurally isolated from the required gates.** The
   specs live in `visual/` with their own `visual/playwright.visual.config.ts`
   (`pnpm run visual`), not in `test/e2e/`. `check`, `smoke` and the e2e
   projects therefore cannot go red because a screenshot moved — the isolation
   is a directory, not a filter someone can forget to apply.
3. **Determinism levers, verbatim.** `animations: 'disabled'` plus
   `reducedMotion: 'reduce'`; fixed viewport 1280×800, `deviceScaleFactor: 1`,
   `scale: 'css'`; `locale: 'en-US'` and `timezoneId: 'UTC'`; `caret: 'hide'`;
   `maxDiffPixels: 0` **and** `threshold: 0` (Playwright's default `threshold`
   of 0.2 would let a uniform theme shift repaint the image at zero differing
   pixels); `retries: 0`, because a retry that turns a screenshot green is the
   rerun-to-green the flake doctrine bans; `workers: 1` and
   `fullyParallel: false`.
4. **Only genuinely stable surfaces are screenshotted.** Thumbnails, durations
   derived from a real probe, job timestamps, scan progress and anything a
   real analysis run produces are excluded by construction — the harness never
   runs one.
5. **The rejected alternatives stay rejected**, for the same reasons: no
   Storybook stack as a test dependency, no third-party diffing service inside a
   gate this repo has to be able to ship without.

## Our rulings

### (a) Darwin baselines are the platform truth

The foundation renders baselines **inside linux CI** and makes a mac run write
nothing, because its gate runs on `ubuntu-latest` and screenshot bytes follow the
OS font stack and rasterizer. The principle is "render where the gate runs"; its
linux letter is a fact about that repo's runner, not about screenshots.

This is a **mac-only Electron app**: it is built, packaged, gated and shipped on
darwin, and the CI runner is (will be) the owner's mac. Rendering the baselines
on linux would compare the product against a rasterizer no user and no gate ever
sees. So the platform truth is inverted, mechanically, not by a README plea:

- snapshot paths stay platform-scoped
  (`visual/__screenshots__/{platform}/{projectName}/…`), so a run on another
  platform cannot overwrite the darwin baselines;
- `ignoreSnapshots` is on for every non-darwin platform, so such a run — with or
  without `--update-snapshots` — writes nothing at all.

Until the self-hosted runner is registered (OWNER, tracked in
[the migration plan](../../tasks/migration-agentproofarch-v2.md) decision 6),
baselines are authored on the same machine that runs the gates. That is the
same rasterizer, which is the whole of the ADR's requirement.

### (b) The suite drives the built renderer against fixtures, never live Electron

`pnpm run visual` runs `vite build` + `vite preview` over a dedicated harness
entry (`apps/web/visual.html` → `apps/web/src/visual/`) and screenshots the
result. Three consequences, all deliberate:

- **Built, not dev-server.** The bytes under test come from the same Vite
  production pipeline the packaged app ships, so a build-only regression
  (minifier, CSS ordering, asset inlining) is inside the gate's reach.
- **No Electron, no server, no analysis run.** The packaged journeys stay in
  `test:e2e:gui`; the real-provider matrix stays in `test:e2e:matrix`. A visual
  suite that booted the desktop app would inherit every source of nondeterminism
  those suites exist to tolerate.
- **No network at all.** The harness mounts the real `QueryClientProvider` and
  disables every query in its composition root, so no request is issued and no
  response can vary. Every visible string is either a slot prop the harness
  fixes or the EN dictionary, which `useUiLanguage` returns whenever the config
  query has no data — the harness's steady state, not a race.

The harness is a composition root of its own (`web-visual` in the `boundaries`
element table), allowed to reach `components/layout`, `components/ui`,
`features/*` presentational parts, `lib`, `theme` and `i18n` — and denied
`api.ts` and `routes/`, so it cannot grow a data path. A `config-regression`
probe holds that line.

### (c) Surfaces: the layout skeletons and their states, in both themes, EN only

The screenshotted set is exactly ADR-0004's ground — the `AppShell` chrome with
its slots filled by fixture content, and the states the skeleton owns:

| Surface | What it pins |
|---|---|
| `shell-default` | header, sidebar rail at its default width, content region, collapsed terminal drawer |
| `shell-sidebar-collapsed` | the collapsed rail and its expand affordance (ADR-0004 §c: a skeleton state, not a caller branch) |
| `shell-terminal-open` | the terminal drawer at its default height with fixture log lines |
| `shell-loading` | the non-happy branch inside the skeleton: banner slot, `SidebarSkeleton`, `DetailsSkeleton` |
| `catalog-sidebar-narrow` / `catalog-sidebar-wide` | `CatalogSidebar` (video list, badges, the `SidebarFolderPanel` split button) at a 260px stress width and the 440px default width |
| `photos-sidebar-narrow` / `photos-sidebar-wide` | `PhotosSidebar` (badge chips, thumbnails, the same split button) at the same two widths |

Each renders in **dark and light** (two Playwright projects driving
`prefers-color-scheme` through the real `ThemeModeProvider`): we are dark-first,
but both are product surfaces and a token that only breaks in light is exactly
the regression this gate exists to catch. **EN only** — Polish copy is behaviour
and rides `test:e2e:parity`; re-baselining every skeleton per locale would buy
font-metric noise, not coverage.

The sidebar surfaces render `CatalogSidebar`/`PhotosSidebar` directly (not
through the full `AppShell`, since the split-button regression they pin lives
inside the sidebar's own `SidebarFolderPanel` header) inside a fixed-width
panel `Box` that mirrors `AppShell`'s sidebar chrome. The narrow width (260px)
is deliberately **below** `SIDEBAR_MIN_SIZE` (280px, `AppShell.tsx`): it is a
stress width, not a resize the shell's own panel would ever produce, chosen
because that is exactly where the W42 split-button regression showed up (the
label segment lost its `fullWidth` sizing and wrapped under the dropdown
segment). The wide width is `SIDEBAR_DEFAULT_SIZE` (440px).

### (d) Armed into `check` (2026-08-03, owner mandate, W43)

`pnpm run visual` now joins `check` (`pnpm run check` runs it last, after
`test:coverage`). This reverses the original non-required posture: the owner
ordered it after a visually broken button (the same `FolderBar` split-button
regression fixed in W42, commit `0d8ed43`) shipped through three gates — DOM-only
structural tests stayed green over broken geometry, a release agent self-graded
screenshots "looks correct" incorrectly, and the screenshots that would have
shown the break were deleted with the worktree before anyone could review them.
`check` was the only required gate positioned to have caught it, so it is the
gate that now runs the suite.

The self-hosted-runner CI-job path described in the original version of this
ADR (non-required job first, then a green run history, then a ruleset edit) is
superseded: there is still no CI runner, `check` runs on the same darwin
machine that authors the baselines regardless of CI, and the owner chose
immediate safety over that staged rollout. It is still reverted the moment it
flakes — a flaky required gate is a P1, and an enforcer that cannot be trusted
is worse than no enforcer; the flake doctrine in
[CLAUDE.md](../../CLAUDE.md) and the `retries: 0` / `workers: 1` determinism
levers above are what keep that reversion rare.

### (e) `scripts/gallery-shots.mjs` keeps its round-1 role

The gallery capture script stays a **dev QA tool**: it captures specimens for a
human to look at, it does not compare, and it is **not** a second baseline
store. There is one screenshot engine in this repo and it is this suite. The two
harnesses do not overlap: the gallery renders components in isolation at
`deviceScaleFactor: 2` for inspection; the visual suite renders page skeletons at
`deviceScaleFactor: 1` for comparison.

## Consequences

- `pnpm run visual` rebuilds the harness bundle on every run
  (`reuseExistingServer: false`): a stale preview server serving yesterday's
  bundle is the one way this suite could go green while lying.
- An intentional UI change is a two-step commit: land the change, run
  `pnpm run visual --update-snapshots`, commit the PNGs. The reviewer sees the
  before/after in the diff.
- `visual/` is excluded from `eslint` and from `tsc`, exactly as `test/` is —
  Playwright suites are configured, not typechecked, in this repo. The harness
  *sources* under `apps/web/src/visual/` are fully linted and typechecked like
  any other renderer code, and excluded from the coverage ratchet like the
  gallery.
- macOS font or Chromium updates will one day redraw a baseline with no code
  change. That is the known cost of exactness; it surfaces as a red
  **non-required** run, is re-baselined deliberately, and is the reason (d)
  keeps the check out of the gates.
