# Migration assessment: agentproofarch foundation `9b4bcd5` → `3508f06`

Date: 2026-07-24 · Revised: 2026-07-25 (owner decisions) · Status: **COMPLETE
2026-07-25** — phases 0–7 all landed on `rewrite/foundation`; the app is fully
aligned with every foundation rule that has a target here (§3(d)/§6 material
stays out by design, not deferral) ·
Scope: whether and how to migrate this app to the current agentproofarch
foundation. Investigation ran as a multi-agent workflow (baseline
verification + four area catalogs + consolidated impact map); every
load-bearing claim below was re-verified against both repos.

**Owner decisions (2026-07-25):**

1. **Island cores i18n ruling accepted**: cores emit typed dictionary keys;
   web bindings translate through `useDictionary`. Island cores move from
   owner-gated to the main path (Phase 6); record the ruling as a
   `docs/architecture.md` delta before the first core.
2. **SQLite data-conventions ADR accepted**: write the SQLite-flavoured
   equivalent of upstream's data conventions (ISO-8601 text timestamps,
   app-minted UUID text ids, `CHECK` constraints where expressible, cursor
   pagination as contract grammar) as a new app ADR (Phase 3).
3. **zod 3→4: adopt** (owner override of the initial propose-skip; "no
   reason not to"). Peers are already v4-ready — `zod-validation-error@4.0.2`
   and `openai@6.46.0` both declare `zod ^3.25 || ^4.0`. New Phase 5.
4. **CI uses a self-hosted GitHub Actions runner**
   (GitHub-hosted macOS minutes bill at a 10× multiplier on private repos;
   the e2e matrix also wants the local model caches). Phase 7.

## 1. Baseline — where the app forked from

**The app was forked from foundation commit `9b4bcd5`** (merge of foundation
foundation PR #8 "smoke-gate",
2026-07-12 02:29). Evidence:

- App kickoff commit `439d2ae5` ("docs: foundation-rewrite kickoff") is dated
  2026-07-12 21:45; the first foundation commit after `9b4bcd5` is `956cc5c`/
  `3b7a4a4` (Vercel environments) on 2026-07-14 — nothing newer existed at
  kickoff time.
- `docs/architecture.md` states its provenance explicitly: "foundation docs
  as of 2026-07-12".
- File similarity: shared files are consistently closer to `9b4bcd5` than to
  `3508f06` (LCS changed-line counts — `core/domain/result.ts` 0 vs 0
  (byte-identical to baseline), `core/contract/envelope.ts` 0 vs 2,
  `eslint.config.js` 264 vs 426, `.dependency-cruiser.cjs` 106 vs 146,
  `package.json` 67 vs 104, `CLAUDE.md` 94 vs 177).
- Negative markers: no post-baseline foundation artifacts anywhere in the app
  (no knip, no `zod/v4`, no `respond.ts` file, no doc-lint, no
  config-regression probes, no `new:island`/`new:resource` scaffolder, no
  AGENTS.md) and no app commit ever mentions syncing the foundation.

Upstream distance: `9b4bcd5..3508f06` = ~170 commits, 304 files,
~39.9k insertions (2026-07-14 → 2026-07-24).

**Addendum 2026-07-25:** the foundation has since advanced `3508f06..bcb038b`
(+9 commits): a fail-closed **ai-review CI gate** (DECIDE F1, 1809249) with
same-slot retry on cold-start signatures (750f339), an e2e port-guard fix
freeing the port before boot to kill an EADDRINUSE flake (595799c), and a
knip allowance for the `fuser` binary that guard uses (831fa68). Folded into
Phase 7 (ai-review gate + port guard) below; no other section is affected.
App-side claims were re-verified against app HEAD `ce049158` (v0.5.8,
16 commits after the assessment): still no `engines`/`packageManager`/
`.nvmrc`, still zod v3, still exactly 14 `withCatalogWriteLock` call sites.

## 2. What changed upstream (catalog summary)

The range splits into two very different halves:

**Product verticals the app deleted by ADR-0001** — auth (Better Auth, magic
link, TOTP, social, passkeys), tenancy/members aggregate, public read-only
surface + embeds, EmailPort (SES/Mailpit, ADR-0007), Vercel/Neon deployment
matrix (ADR-0003), Docker self-host, domain provisioning (Caddy). Most of
the ~40k inserted lines live here. Obsolete for this app (§6).

**Enforcement and hygiene, built because prose-only architecture decayed** —
this half transfers almost completely:

| Area | Upstream change (commits) | Why upstream did it |
|---|---|---|
| Gates | knip in `check` (34ea303); coverage ratchet; doc-lint with bidirectional docs↔config checks (1f0f7c5, cab62ca); config-regression behavioral probes for lint/depcruise gates (17cff94, efaf043) | ADR-0004 "no exceptions": every documented rule must be mechanically enforced and every enforcer covered by a probe |
| Toolchain | npm major pinned to 10 + `engines`/`packageManager`/`.nvmrc` + lock-lint (ae3fa34) | npm 11 pruned platform-optional lockfile entries, silently breaking builds |
| Lint | local eslint plugin (`query-descriptors-only`, `event-suffix-taxonomy`, `sx-layout-only` + frozen baseline); unused `eslint-disable` = error; closed remaining taxonomy disables (bfd0897, eeb234e, db86e34) | boundaries the syntax selectors could not express; ratchet over big-bang |
| Contract/server | `respond()` extracted to `respond.ts` with error telemetry + cache-control seam (0bb3f63); health split live/ready + deploy attestation (b9a0f9d); slug value object (20aacd5) | one response seam; readiness distinct from liveness |
| Composition | portable island cores — factory + web binding, DOM-free typecheck, `tsconfig.islands.json` (d48c07e, 5f6ab39); ADR-0005 client-state ladder (rungs: pure core → @xstate/store → statechart) | feature logic portable by construction, not by review |
| Authz | default-deny authorization core, capability predicate resolved before any store access (14565a8, 81e6345) | fail-closed by structure |
| Testing | flake doctrine — flake = P1, no rerun-to-green (279fa0c); teardown error sinks (9a75ee8); vertical-slice test layering from the members aggregate (2ab7827) | deterministic gates |
| Docs/process | per-layer CLAUDE.md guardrails (b1a1b21); AGENTS.md; backlog/DEFER register (e97620a); data conventions (timestamptz, native uuid, CHECK constraints, cursor pagination, integer minor units — 036b086, 49dc1c8) | agent-runtime parity; postgres data hygiene |
| Deps | zod 3→4 across the stack (52e927a) | forced by a `@better-auth/passkey` peer dependency |
| Scaffolding | `new:island`, `new:resource` generators (a0865a3, 19552e2, 03af1df) | anchored wiring checklists |

Full per-area catalogs (with per-item classification) were kept in a scratch
directory outside the repository during the investigation.

## 3. Impact map

### (a) Clean adopt — no conflict

1. Config-regression probe **method** (plant illegal fixture → run real
   eslint/depcruise/tsc → assert the named rule fires → sweep). Zero domain
   coupling; the highest value-per-line item in the whole range for this app,
   whose boundary set is *more* custom than upstream's.
2. Unused `eslint-disable` directives as errors; "no rule without a violating
   probe" made mechanical (already claimed by our `CLAUDE.md`, today
   aspirational).
3. Flake doctrine (flake = P1, rerun-to-green forbidden, one Playwright retry
   with trace).
4. Error-taxonomy hardening: normalize infrastructure exceptions once at the
   composition edge (our `core/domain/result.ts` is byte-identical to the
   baseline; this only reinforces it).
5. Backlog/DEFER register discipline (import none of upstream's items).
6. Slug-style value-object pattern — as a pattern only; no app identifier
   needs it today.
7. Restricted-syntax additions (non-const `as`, React.FC/forwardRef bans) —
   verified already present in our `eslint.config.js`; no-op, listed so it is
   not re-litigated.

### (b) Adopt with adaptation — app files named

8. **`respond.ts` extraction + telemetry + cache-control** → extract from
   `apps/server/src/app.ts` (inline `respond` at ~line 64). **Must keep our
   output-schema validation, which upstream's 25-line `respond.ts` does not
   have.** Drop tenant/public-cache args; keep `no-store` on errors.
9. **Health live/ready split** → `core/contract/routes.ts`,
   `apps/server/src/app.ts`, `apps/cli/src/main.ts` (`doctor`). Map: live =
   process/Hono; ready = catalog DB opens + sql.js wasm + lock acquirable-or-
   owned + provider config. Skip `VERCEL_*`/`EXPECTED_SHA` attestation.
10. **npm 10 pin + lock-lint** → `package.json` (`engines`,
    `packageManager`), new `.nvmrc`, `scripts/smoke.ts`. Verified: we have
    none of these today, local node is v25, and our lockfile carries
    platform-optional entries (`@ffprobe-installer/darwin-arm64`,
    `onnxruntime-node`) that `electron-builder.config.js` references as
    string-literal paths — upstream's npm-11 failure mode with a worse blast
    radius. Note: our smoke's existing drift check compares the installed
    tree; upstream's lock-lint validates the lockfile resolves under npm 10 —
    different failures, keep both.
11. **knip** → new `knip.jsonc` with a curated entry list (see hotspot 3),
    then into `check`.
12. **doc-lint (bidirectional docs↔config)** → new script; must cover the
    load-bearing ADR claims (FTS4-not-FTS5, global index canonical, faces
    excluded from snapshots, single-writer lock). Drop Vercel/Neon manifests.
13. **Coverage ratchet** → `vitest.config.ts`; first threshold = measured
    current, never upstream's numbers.
14. **Local eslint plugin + `query-descriptors-only`** → new plugin dir;
    `defineQuery`/`defineMutation` exist (`core/client/queries.ts`) but
    nothing forces features through them.
15. **`event-suffix-taxonomy`** → forward-only for new unions;
    `apps/desktop/src/{channels,ipc,preload}.ts` audited but not renamed
    (renames change the IPC contract — own phase with GUI e2e if ever).
16. **Island-core purity + `tsconfig.islands.json`** → new
    `apps/web/src/features/*/core/` dirs (we have zero today — greenfield,
    not a rename), `eslint.config.js`, `.dependency-cruiser.cjs`. The
    i18n-in-cores ruling (hotspot 2) is owner-accepted 2026-07-25.
17. **Vertical-slice checklist** (members aggregate as template) → for the
    next app aggregate; replace tenant-isolation assertions with
    global-catalog scope + lock ownership + faces-privacy assertions.
18. **CI workflows** (SHA-pinned actions, `npm ci`, check/smoke/e2e split) →
    new `.github/workflows/*` (we only have `landing.yml`); macOS runner for
    Electron + onnxruntime darwin-arm64.
19. **Per-layer CLAUDE.md guardrails + AGENTS.md** → copy the neutral layer
    sections only; roughly half of each upstream file is tenant/auth/Neon
    prose that must be stripped first.
20. **jsdom deterministic-timeout stabilizations** → our web test infra
    already has the layering; adopt the timeout fixes only.

### (c) Conflicts with an app ADR/feature — calls

| Upstream change | Collides with | Call |
|---|---|---|
| Data conventions: `timestamptz`, native `uuid` PKs, CHECK mandates, migration packages (036b086) | **ADR-0002** — these are drizzle-**pg** column builders; sql.js/SQLite has neither, and we have no migration runner (schema evolution = `global-catalog-schema.ts` + snapshot rebuild, ADR-0002's stated recovery story) | **propose-skip** the pg-typed rules; **propose-adopt** cursor pagination as contract grammar (whole-drive lists over 1–2 TB will need it); **owner-accepted 2026-07-25**: write the SQLite-flavoured equivalent as an app ADR (Phase 3) |
| `new:resource` scaffolder | ADR-0002 + catalog lock — a generated repository-per-aggregate bypasses the `withCatalogWriteLock` funnel by construction | **propose-skip** the generator; adopt its anchored manual checklist idea |
| ADR-0005 rungs 2/3 (`@xstate/store`, statecharts, transition tables) | No board-style transition domain; closest analogue (scan/lock lifecycle) is server-enforced; adds deps we don't have | **propose-adopt rung 1 only** (pure cores); **needs-owner-ADR** before rung 2/3 |
| Capability predicates / `decide(identity, capability)` | ADR-0001 (no identity) — but the *ordering rule* (guard resolves before any store access, fail closed) is isomorphic to `withCatalogWriteLock` | **propose-adopt the ordering + a lock-wrapper probe** (see hotspot 4); propose-skip identity content |
| zod 3→4 (52e927a) | Our `zod ^3.25.76` pin; upstream moved for a passkey peer dep we don't have; blast radius = 63 files importing zod across `core/{domain,contract,client}`, adapters, apps, smoke, tests | **adopt — owner decision 2026-07-25** (Phase 5); peers verified v4-ready (`zod-validation-error@4.0.2`, `openai@6.46.0` both accept `zod ^4`); upstream 52e927a is the mechanical template |
| `sx-layout-only` + frozen baseline | `RAW_COLOR_BAN` + theme-only visuals already achieve the goal; a baseline-driven layout rewrite invalidates the gallery screenshot set | **needs-owner-ADR** for wholesale adopt; default skip |
| Shared env module `core/server/config.ts` | Name collision: our `core/domain/config.ts` = user settings, `core/server/usecases/config.ts` exists; upstream contents are Neon/Vercel-shaped; env is read in 9 app files | **propose-adopt the principle** as `core/server/env.ts`; skip the contents; must preserve the `AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN` override used by gates |
| Wholesale copy of upstream `eslint.config.js` / `.dependency-cruiser.cjs` | Deletes `web-i18n` + `web-gallery` element types, their four allow-list grants, and the dual composition roots | **merge rule-by-rule, never file-by-file** (standing rule for every future sync) |

### (d) Obsolete — no target in this app

Auth/identity/tenancy/members; public surface + embeds + open CORS + public
caching; Vercel/Neon matrix, promotion runbook, deploy attestation,
`smoke:remote`; Docker/compose self-host; EmailPort/SES/Mailpit (ADR-0007);
cookie/CSRF/session-poisoning smoke assertions; Postgres operational doctrine
(transactions lint, checkpointed backfills, transactional outbox);
`pg.Pool` teardown sink (keep only the generalization: sink/await late async
teardown so an sql.js store torn down mid-write never leaves a stale lock);
domain provisioning; integer-minor-units money convention.

## 4. Hotspot collision analysis (all verified in code)

1. **ADR-0002 global catalog vs upstream data conventions — hard conflict,
   mostly skip.** `timestamptz`/native-`uuid` are pg-only builders; CHECK/
   migration-package language assumes a runner we don't have. Portable
   pieces: cursor pagination (adopt at contract level) and "cross-row
   invariants enforced by the store, not the caller" — which for us reads
   "the write lock is the invariant" and becomes the hotspot-4 probe.
2. **web-i18n vs upstream lint rules — soft conflict, sequencing matters.**
   Upstream has no i18n layer, so the collision is by omission: any verbatim
   allow-list copy silently deletes the `web-i18n` grants into `web-main`,
   `web-gallery`, `web-features`, `web-ui` (verified at eslint.config.js
   lines 191/254/271/294/315). Guard with a **positive** probe (a
   `components/ui` file importing `i18n/` must pass). Island cores: a pure
   core cannot call the `useDictionary` React hook — decide "cores emit typed
   keys; web bindings translate" **before** the first core exists (today:
   zero cores, so forward-only).
3. **Gallery vite entry vs knip/build assumptions — live conflict.**
   `gallery.html` is a dev-server/screenshot entry, not a build output (no
   `rollupOptions.input` in vite config), so knip will flag
   `apps/web/src/gallery/main.tsx`, all four `scripts/*.mjs`, and
   `electron-builder.config.js` as dead. All must be `knip.jsonc` entries.
   Dual-root rules are already handled (eslint.config.js:459 lists both
   `main.tsx` files) — every adopted rule with a hardcoded `main.tsx` path
   must take the pair.
4. **Catalog lock vs upstream patterns — no conflict; the free win.**
   Upstream's authorize-first structure maps onto `withCatalogWriteLock`
   (14 hand-wrapped call sites in `apps/server/src/app.ts`, enforced today
   by review only). Adopt: a config-regression probe / route-table test
   asserting every mutating route is lock-wrapped — a forgotten wrapper is a
   silent multi-writer corruption of the canonical catalog. Also: `ready`
   should report "catalog opens and lock acquirable-or-owned"; assert no
   stale lock after mid-write teardown.
5. **Packaged-CLI staging + Electron packaging vs toolchain changes — npm
   pin urgent.** `electron-builder.config.js` reads platform-optional
   lockfile entries as literal paths; a lock regenerated under npm 11 can
   strip them and ship a green `check` with a broken `electron:package`.
   knip needs the curated entry/ignore list before it can gate;
   `ffmpeg-static`/`@ffprobe-installer` (require-in-try + literal packaging
   paths) and `onnxruntime-node` (dynamic import + esbuild-external) are the
   false-positive candidates to prove, not blanket-ignore.

## 5. Migration plan — phases

Every phase leaves `check` + `smoke` green. `test:e2e:matrix` only where
packaging or CLI↔GUI parity is touched; `test:e2e:gui` where renderer/IPC
changes; `test:e2e:cli` where the staged bundle changes.

### Phase 0 — Toolchain pin (do first regardless of the rest) — **DONE 2026-07-25** (lock regenerated under npm 10; optional entries verified)
- **Scope:** `package.json` (`engines.node 22.x`, `engines.npm >=10 <11`,
  `packageManager npm@10.x`, `lock-lint` script), new `.nvmrc`,
  `scripts/smoke.ts` (lock-lint next to the existing tree-drift check),
  `CLAUDE.md` (flake-doctrine paragraph).
- **Effort:** S · **Risk:** low-med. What breaks: local node is v25 —
  anyone with `engine-strict=true` must switch to node 22; lock-lint may
  fail immediately if the lock was last written by npm 11 — that failure is
  the finding; regenerate under npm 10 inside this phase.
- **Verify:** `check`; `npx -y npm@10 ls --all --package-lock-only`;
  `smoke`; `test:e2e:cli` (staged bundle depends on the optional entries the
  pin protects).
- **Rollback:** revert the three fields + `.nvmrc`; keep the regenerated
  lock either way.

### Phase 1 — Response seam + health/ready split — **DONE 2026-07-25** (respond.ts keeps output-schema validation + error telemetry seam + no-store on errors; live/ready split with new `unavailable` code, doctor surfaces both; tenant/public-cache args and VERCEL_*/EXPECTED_SHA attestation skipped)
- **Scope:** new `apps/server/src/respond.ts` (extracted, keeps
  output-schema validation, adds error telemetry + `no-store` on errors),
  `apps/server/src/observability.ts`, `core/contract/routes.ts` (live vs
  ready, both carry version), `apps/server/src/app.ts`,
  `apps/cli/src/main.ts` (`doctor` surfaces live/ready), `apps/desktop`
  version wiring.
- **Effort:** S-M · **Risk:** low. What breaks: every response passes the
  new seam — mistakes are total but compile-visible and covered by route
  tests; contract changes recompile client + CLI + web.
- **Verify:** `check`, `smoke` (health/ready + taxonomy exit codes),
  `test:e2e:gui` if readiness UI changes.
- **Rollback:** inline `respond` back; single-file revert.

### Phase 2 — Config-regression probes for existing boundaries — **DONE 2026-07-25** (new `config` vitest project under `config-regression/`; `lint-gates.test.ts` plants illegal fixtures into the real tree and runs the real eslint/depcruise, asserting the named rule fires for AS_BAN, no-explicit-any, core→adapters, CLI→core/server, renderer axios/fetch/electron, cross-feature islands, query-hook type-args, RAW_COLOR_BAN, plus depcruise no-frameworks-in-core + severity table, and POSITIVE grants — components/ui→i18n and gallery→features must pass; `catalog-lock.test.ts` is the hotspot-4 structural probe: every mutating route is lock-wrapped or a named no-write exception, anti-vacuous + no-stale-allowlist + planted-violation detector; fixtures gitignored and always swept; no rule was found unenforced)
- **Scope:** new `config-regression/` vitest project + gitignored killed
  fixtures; probes: layer allow-lists, `web-i18n` positive grants,
  `web-gallery` second root, `RAW_COLOR_BAN`, query bans, `AS_BAN`,
  depcruise severities, and the **lock-wrapper probe** (mutating route
  touching a store write without `withCatalogWriteLock*` must fail).
- **Effort:** M · **Risk:** low (additive). Expect 1–2 probes to reveal an
  unenforced rule — that is the payoff; fix `eslint.config.js` in-phase.
- **Verify:** `check`. No e2e.
- **Rollback:** delete the directory + vitest project entry.

### Phase 3 — Gate breadth: knip, coverage, doc-lint — **DONE 2026-07-25** (curated `knip.jsonc`: desktop main/preload + CLI-source + gallery.html/gallery main.tsx + electron-builder.config.js + all `scripts/*.{ts,mjs}` + e2e specs/preflight + `**/*.test` as entries; files/deps/unlisted/unresolved/binaries/duplicates = error, exports/types = warn; macOS system binaries `caffeinate`/`sips`/`iconutil`/`say` in `ignoreBinaries`; packaging-critical `ffmpeg-static`/`@ffprobe-installer`/`onnxruntime-node` PROVEN referenced via string-literal require/dynamic-import, never ignored. knip found + fixed: dead `apps/server/src/index.ts` barrel deleted, unused `react-router`/`@tanstack/react-virtual`/`zod-validation-error` deps dropped, `playwright` import in `build-app-icon.mjs` retargeted to `@playwright/test`, aliased duplicate export `whisperModelDeleteInputSchema` made a distinct schema. `scripts/doc-lint.ts`: 8 prose-relied enforcer ids asserted present in eslint/depcruise + 7 bidirectional ADR claims (FTS4-not-FTS5, global-index-canonical, faces-excluded-from-snapshot, single-writer-lock, plus ADR-0003 ISO-8601 timestamps / app-minted UUID ids / cursor-grammar) each checked doc-side AND code-side + dead-link + delimiter scans. Coverage ratchet in `vitest.config.ts` at first measured floor stmts 79 / branches 80 / funcs 73 / lines 79 (v8; config-project `hookTimeout` raised to match its 120s `testTimeout` under instrumentation). New `docs/decisions/0003-sqlite-data-conventions.md`. Wired `knip` + `doc-lint` + `test:coverage` into `check`. check + smoke + verify:package all green.)
- **Scope:** new `knip.jsonc` (entries: `scripts/*.mjs`,
  `apps/web/src/gallery/main.tsx`, `electron-builder.config.js`, e2e specs,
  unit tests; files/dependencies/unlisted/unresolved/duplicates = error,
  exports/types = warn), coverage at measured-current in
  `vitest.config.ts`, new `scripts/doc-lint.ts` covering the ADR-0002
  claims, `check` chain. Docs-first companion: write
  `docs/decisions/0003-sqlite-data-conventions.md` (owner-accepted —
  ISO-8601 text timestamps, app-minted UUID text ids, `CHECK` where
  expressible, cursor pagination as contract grammar for future list
  endpoints) so doc-lint guards it from day one.
- **Effort:** M · **Risk:** med. What breaks: knip's first run flags the
  packaging-critical deps (hotspot 5) — resolve by proving each reference,
  never blanket-ignoring; a wrong ignore is how packaging silently rots.
- **Verify:** `check`; `smoke`; **`test:e2e:matrix` once at phase end** —
  the only cheap proof nothing knip-pruned was packaging-critical.
- **Rollback:** remove the three commands from `check`, keep configs
  un-gated.

### Phase 4 — Local eslint plugin (forward-only) — **DONE 2026-07-25** (new `eslint-plugin-avc/` wired into `eslint.config.js`. `query-descriptors-only` (adapted to the app's `@core/client` alias + `apps/web/src/api.ts` binding; forward-compatible with island `core/index.ts`/`index.web.ts` seams for Phase 6) enabled across `apps/web/**` and turned OFF in web test files (MSW + real client). `event-suffix-taxonomy` scoped to `apps/web/src/features/*/core/events.ts` — FORWARD-ONLY: no such file exists yet, and the desktop `channels/ipc/preload` IPC contract was left unrenamed per scope. `reportUnusedDisableDirectives: 'error'` enabled globally; the sweep found ZERO existing `eslint-disable` directives, so none needed removal. Each rule ships RuleTester unit tests under a new `eslint-plugin` vitest project AND a negative probe in `config-regression/lint-gates.test.ts` that plants a violating fixture into the real tree and asserts the named rule fires (`avc/query-descriptors-only` on an inline query object; `avc/event-suffix-taxonomy` on an imperative event name), plus a positive probe that a spread imported descriptor stays green. web-i18n/web-gallery grants untouched; all real renderer query hooks already spread `actions.*` descriptors so nothing existing was flagged. check + smoke green under the pinned Node 22.)
- **Scope:** new `eslint-plugin-avc/` with rule unit tests + violating
  probes: `query-descriptors-only`; `event-suffix-taxonomy` scoped to new
  unions only (desktop IPC files audited, not renamed).
- **Effort:** M · **Risk:** med — concentrated entirely in the
  retroactive-rename option, which this phase excludes (IPC renames = own
  phase + GUI e2e, if the owner ever wants them).
- **Verify:** `check` (plugin tests + probes); `test:e2e:gui` if any event
  name moved (should be none).
- **Rollback:** drop the plugin from `eslint.config.js`.

### Phase 5 — zod 3→4 (owner-decided 2026-07-25) — **DONE 2026-07-25** (zod bumped `^3.25.76`→`^4.4.3`, lock regenerated under npm 10 — only zod entries moved, no platform-optional pruning; `eslint-plugin-react-compiler` keeps a nested zod 3. Mechanical sweep over 13 source/config files following 52e927a: `z.record(v)`→`z.record(z.string(), v)` at the 8 single-arg sites (routes `data`, both desktop-bridge `headers`, whisper-runtime `annotations`, smoke `packages`, distribution.test `scripts`, wizard-home-readiness + setup.test config records); `z.string().url()`→`z.url()` at 4 sites (routes file url, providers api baseUrl ×2, config whisper_api_base_url); `z.string().datetime()`→`z.iso.datetime()` at 11 sites (routes, domain Video created/updatedAt, global-catalog ×5, faces createdAt, sql-js normalizer). App-specific zod-4 break beyond the template: `z.ZodIssueCode.custom`→`'custom'` in providers `argsTemplate` superRefine (×2). NO email sites exist. Message-string review: NO test/smoke/e2e/parity assertion is pinned to zod default message text — every error assertion targets the AppError `ErrorCode` taxonomy or custom messages (`argsTemplate must contain {prompt}`, `Unsupported placeholder:…`, commander `Invalid whisper mode:…`), all preserved; the 3 `flatten()` touchpoints (http.ts, app.ts, readiness.ts) keep their shape (zod-4 `flatten()` output unchanged) and feed `details`, which nothing asserts on textually. `zod-validation-error` confirmed gone (dropped by knip in Phase 3, zero source imports). Gates: check (829 unit, coverage floors stmts 79.33/branches 80.52/funcs 73.68/lines 79.33 held) + smoke + test:e2e:cli (8/8) all green under pinned Node 22. Kept as ONE sweep commit for the single-revert rollback story.)
- **Scope:** `package.json` (`zod ^4.x`; lock regenerated under npm 10 —
  hence after Phase 0), then the mechanical sweep over the 63 files
  importing zod, following upstream 52e927a as the template:
  `z.record(v)` → `z.record(z.string(), v)`; deprecated string formats →
  top-level (`z.string().email()/url()` → `z.email()/z.url()`,
  `z.string().datetime()` → `z.iso.datetime()` — 10 call sites, includes
  the domain `Video` timestamp schema); error-shape touchpoints
  (`issues`/`flatten()` assertions in tests and `scripts/smoke.ts`).
  `zod-validation-error` stays at ^4 (peer-compatible).
- **Effort:** M · **Risk:** med. What breaks: validation **message strings**
  can change between zod majors — the NDJSON error output is a public
  contract, so any smoke/parity assertion pinned to exact message text will
  surface it; that is the review focus, not the type-level changes
  (compile-visible). Runs after Phases 2–3 so probes + coverage are already
  in place as the safety net.
- **Verify:** `check`, `smoke`, `test:e2e:cli` (NDJSON error envelopes),
  **`test:e2e:matrix` once** (error-shape parity across providers).
- **Rollback:** single revert of the version bump + sweep commit; keep the
  sweep as one commit for exactly this reason.

### Phase 6 — Island cores, rung 1 (mainlined 2026-07-25) — **DONE 2026-07-25** (docs-first: the accepted i18n ruling — "cores emit typed dictionary keys; web bindings translate through `useDictionary`" — landed as a `docs/architecture.md` delta in its own commit before any core. Two features only: `apps/web/src/features/catalog/core/` (moved the already-pure `catalog-tree-model` / `catalog-tree-rows` / `catalog-video` with their tests, plus a `createCatalogCore` factory barrel) and `apps/web/src/features/processing/core/` (extracted the drive-event reduction + progress model + pure helpers out of `use-processing.ts`: `reduceDriveEvent` returns a typed `DriveMessage` key union + counts + effects that the binding translates via the dictionary, so log output stays byte-identical; `toProgressModel` emits a step KEY the binding resolves to a label). Each feature has a single web binding `index.web.ts` that injects the bound `api.ts` descriptors into `createXCore` and re-exports the seam; `use-catalog-tree.ts` and `use-processing.ts` consume the binding (descriptors flow through the ISLAND_WEB_BINDING seam the Phase-4 plugin accepts). `tsconfig.islands.json` (ES2023 lib, no DOM, types node) + `typecheck:islands` wired into `check` — cores compile DOM-free (proven green). Island rules added rule-by-rule, web-i18n/web-gallery grants untouched: a new `web-island-core` boundaries element (placed before `web-features`) allowed only its own core + `core-{domain,contract,client}`; `web-features` granted its own `web-island-core`; a per-file `no-restricted-imports` block bans React/MUI/TanStack/i18n and every parent-relative escape; depcruise mirrors with `island-core-is-portable` + `island-core-no-frameworks`. Config-regression extended: NEGATIVE probes (a core importing `react` fires `no-restricted-imports`/"pure TypeScript"; a core reaching i18n fires the portability ban; behavioral depcruise fires `island-core-no-frameworks` + `island-core-is-portable`) and a POSITIVE probe (an `index.web.ts` importing its own `core/index.ts` passes boundaries + no-restricted-imports). No xstate — rung 1 is plain TS; event-suffix-taxonomy stays forward-only (probe-covered from Phase 4). Behavior unchanged: all 834 unit tests pass with assertions untouched (catalog/processing renderer tests only moved, not edited). Gates: `check` (incl. `typecheck:islands`, coverage floors held stmts 79.41/branches 80.55/funcs 73.74/lines 79.41) + `smoke` green under pinned Node 22.)
- **Scope:** docs first — record the accepted i18n ruling ("cores emit
  typed dictionary keys; web bindings translate") as a
  `docs/architecture.md` delta; then `apps/web/src/features/{catalog,processing}/core/`
  (two features, not eleven), `tsconfig.islands.json` + `typecheck:islands`,
  island-purity lint/depcruise rules, `api.ts` bindings, `new:island`
  scaffolder adapted to TanStack Router + typed-i18n key bindings.
- **Effort:** L · **Risk:** high. Catalog is the most entangled feature
  (lock status, tree, absent files, snapshots). No xstate deps — rung 1 is
  plain TS; rungs 2/3 still need their own ADR.
- **Verify:** `check` (incl. islands typecheck), `test:e2e:gui`,
  `test:e2e:matrix` (catalog is the parity surface).
- **Rollback:** cores are additive — revert bindings, delete `core/` dirs,
  drop `typecheck:islands`; cheap if each feature is its own commit.

### Phase 7 — CI on a self-hosted Mac runner (decision recorded 2026-07-25) — **DONE 2026-07-25** (four new SHA-pinned workflows under `.github/workflows/`, all `runs-on: [self-hosted, macOS, arm64]`, all guarded to the canonical repository and non-fork (`pull_request.head.repo.full_name == github.repository`) so a fork head never executes on the self-hosted runner. `check.yml`/`smoke.yml`/`e2e.yml` each `actions/setup-node` off `node-version-file: .nvmrc` (node 22 → npm 10, preserving the platform-optional lock entries) then `npm ci`; check runs `npm run check` + advisory `npm audit`, smoke runs `npm run smoke` (no DB service — local-first sql.js), e2e runs `npm run test:e2e:cli` only (the on-demand real-provider `matrix` suite stays out of CI; cli e2e drives the staged CLI and isolates state via `AVC_HOME_DIRECTORY`, using the runner's configured analyzer and transcription tools). Per-workflow `concurrency` cancels superseded runs so the single runner never queues behind stale work. `ai-review.yml` adapted from the foundation gate (1809249 + 750f339): fail-closed, PASS-only-green, slot 1→2→3 failover with a single same-slot cold-start retry (claude-code#23265), verdict posted as one sticky PR comment, five helper scripts copied verbatim into `.github/scripts/`; prompt retargeted to this app's doctrine (core purity incl. island cores, renderer bound-actions, comment doctrine, zod-parse/Result/no-`any`/no-`as`, single-writer-lock wrapping) and diffs against `origin/rewrite/foundation`; runs only on non-draft same-repo PRs (self-hosted cannot fail-closed-by-skip a fork the way a disposable hosted runner does). **Port guard (595799c) intentionally omitted + fuser NOT added to knip `ignoreBinaries`**: our GUI e2e launches Electron directly against the static built bundle and the cli e2e drives the staged binary — nothing binds a fixed socket, so there is no vite-dev-server EADDRINUSE surface for the guard to protect (the plan gated it exactly on that condition). All Vercel/Neon/Docker/mailpit/postgres/visual template jobs skipped (no target here). Repo-side config verified: `knip` project globs never reach `.github/**` and `doc-lint` only scans tracked `.md`, so both stay green with the new files. Gates: `check` (834 unit, coverage floors held stmts 79.41/branches 80.55/funcs 73.74/lines 79.41) + `smoke` (PASS) green under pinned Node 22. Runner registration remained an operator handoff outside the repository.)
- **Scope:** new `.github/workflows/{check,smoke,e2e}.yml`, SHA-pinned
  actions, `npm ci`, repo guards; jobs target a **dedicated self-hosted Mac**
  (labels `self-hosted, macOS, ARM64`) instead of GitHub-hosted
  macOS (10× minute multiplier on private repos; native arm64 +
  Electron/onnxruntime + the persistent `avc-e2e-matrix-home` cache all
  favor local). Runner installed as a user LaunchAgent; workflows must
  remain safe for a self-hosted runner (no fork PRs, repo guards, no
  secrets beyond what the runner already holds). Candidate from the
  2026-07-25 upstream addendum: the fail-closed ai-review gate (F1,
  1809249 + 750f339 cold-start retry) — adopt once check/smoke workflows
  are stable; and the e2e port-guard pattern (595799c) if the GUI e2e ever
  flakes on EADDRINUSE against the vite dev-server port.
- **Effort:** M · **Risk:** med — runner availability (machine asleep =
  queued jobs), workspace hygiene between runs (temp HOME isolation the
  smoke already provides), not correctness.
- **Verify:** the workflows themselves; matrix nightly only, never per-PR.
- **Rollback:** delete the workflow files, unregister the runner.

**Ordering rationale:** 0 protects the dependency graph everything else
builds on; 2 precedes 3–5 so new rules and the zod sweep land on
probe-backed, coverage-measured ground; 1 is independent and front-loads
visible value; 5 before 6 keeps the zod sweep off freshly extracted cores;
7 last because CI only pays once the local gates are worth running
remotely.

## 6. No-go list

- Everything in §3(d) — no target after ADR-0001.
- **pg-typed data conventions** (`timestamptz`, native `uuid`, CHECK/
  migration packages, backfill checkpoints, transactional outbox) —
  mechanically impossible or targetless on sql.js.
- **`new:resource` scaffolder** — bypasses the single-writer lock funnel by
  construction; contradicts ADR-0002.
- **`sx-layout-only` frozen baseline** — invalidates the gallery screenshot
  set; `RAW_COLOR_BAN` + theme-only already achieve the goal (owner may
  overrule via ADR).
- **Wholesale copying** of upstream `eslint.config.js` /
  `.dependency-cruiser.cjs` / per-layer CLAUDE.md / `core/server/config.ts`
  — each deletes or collides with app-owned boundaries (web-i18n,
  web-gallery, dual roots, user-settings config naming). Rule-by-rule,
  stripped, renamed (`core/server/env.ts`) respectively.
- ADR-0005 rungs 2/3, `first-feature.md`'s resource chain,
  `island-graduation.md` examples, foundation `backlog.md` items — reference
  material, not imports.

## 7. Recommendation

**Migrate now, full alignment: phases 0–7.** (Original 2026-07-24
recommendation was partial — phases 0–4 with island cores and CI deferred;
the 2026-07-25 owner decisions resolved every open question, so the full
path is now unblocked. "Full alignment" means every foundation rule that
has a target in this app; the §3(d)/§6 material stays out because it has no
target, is technically impossible on sql.js, or contradicts an app ADR —
not because it is deferred.)

The product half of the upstream range is exactly what ADR-0001 deleted, and
the flagship data conventions cannot exist on sql.js. But the enforcement
half was authored because prose-only architecture decayed — and this app has
a **larger** custom boundary surface than upstream (web-i18n, web-gallery,
Electron/desktop, local-first adapters, single-writer lock) protected by
**fewer** mechanical checks.

Concretely the app gains:

- **Phase 0:** immunity to the npm-11 lockfile-pruning failure that would
  ship a green `check` with a broken `electron:package` (our packaging reads
  the platform-optional lock entries as literal paths).
- **Phase 2:** the single best item in the range — the lock-wrapper probe.
  The single-writer invariant currently lives in reviewers' memory across 14
  hand-wrapped routes; a forgotten wrapper is silent catalog corruption.
  Plus probes that turn the i18n/gallery/query/color boundaries from
  conventions into failures.
- **Phase 1:** `doctor` gains a true local-first readiness answer ("catalog
  opens, lock acquirable") behind one response seam that keeps our stricter
  output-schema validation.
- **Phase 3:** doc-lint guards the load-bearing ADR claims (FTS4, canonical
  index, faces privacy, single writer); knip + coverage close dead-code and
  regression blind spots with a curated, packaging-aware config.
- **Phase 4:** descriptor provenance enforced (the seam exists, unforced),
  event taxonomy gets a home without touching the IPC contract.

- **Phase 5:** dependency parity with upstream on zod 4 while the peer
  graph is already there, with probes + coverage as the net and the NDJSON
  error contract as the one watched surface.
- **Phase 6:** catalog/processing logic becomes portable by construction —
  the app's most valuable feature code stops being welded to React — under
  the accepted "cores emit keys, bindings translate" ruling.
- **Phase 7:** independent verification of every gate on the machine that
  can actually build the package (arm64, Electron, onnxruntime, model
  caches), at zero minute cost.

Phases 0–4 ≈ S+S/M+M+M+M, all additive, each independently revertible, none
touching ADR-0001/0002 territory; phase 5 is one revertible sweep; phase 6
is additive files behind a docs-first delta; phase 7 is workflow files plus
a runner registration. After phase 7 the app is fully aligned with the
current foundation's applicable ruleset.
