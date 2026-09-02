# ADR-0017: CI runs on GitHub-hosted macOS runners

Date: 2026-09-02 · Status: **accepted** · Supersedes decision 4 and Phase 7 of
[the migration plan](../../tasks/migration-agentproofarch.md) (CI on a
self-hosted Mac runner) and the dormancy gating documented in
[docs/ci.md](../ci.md).

## Context

The self-hosted decision was taken on 2026-07-25 under one binding fact: the
repository was **private**, where GitHub-hosted macOS minutes bill at a 10×
multiplier. A dedicated Mac was the only way to run arm64 gates at zero
marginal cost, and the workflows grew the machinery that a runner-that-does-not-
exist-yet forces: `vars.CI_RUNNER_READY` / `vars.AI_REVIEW_READY` arming
switches, job names that carried their own enable instructions, and fork-head
exclusions protecting the owner's machine from untrusted code.

That fact is gone. The repository is **public**, so standard GitHub-hosted
runners — including `macos-15`, which is Apple silicon — are free for it, and
the runner was never actually registered: every gate has been dormant since it
was written, and not one has ever run. The migration also finished on the
`macos-15` image's terms anyway (pnpm via `packageManager`, Node pinned by
`.nvmrc`, no service containers, sql.js instead of a database).

Keeping the self-hosted plan would mean maintaining a machine, its LaunchAgent,
its toolchain and its security posture in order to obtain something the hosted
runners now give away.

## Decision

1. **All gate workflows run on `runs-on: macos-15`.** No `self-hosted` label
   exists in this repository, and no runner will be registered.
2. **The dormancy gating is deleted.** `vars.CI_RUNNER_READY` and
   `vars.AI_REVIEW_READY` are gone, along with the job names that were
   expressions. Job names are literals — `check`, `smoke`, `e2e-cli`,
   `ai-review`, `visual-baselines` — because a required status check is matched
   by its rendered name.
3. **`ai-review` stays fail-closed, and a missing secret is now a red gate
   rather than a skip.** `CLAUDE_CODE_OAUTH_TOKEN_1` is an organization secret
   available to this repository; when it is absent or unusable, the gate reports
   RED. The fork-head exclusion is dropped: the runner is disposable, so a fork
   PR simply runs without a secret and fails closed like any other unusable
   token.
4. **The visual gate keeps per-environment baselines.** The hosted image is not
   the machine that authored the darwin baselines and cannot reproduce them
   pixel-for-pixel. `VISUAL_ENV` (`local-darwin` by default, `ci-macos-15` on
   CI) selects the baseline directory; no tolerance was widened and the gate was
   not made report-only. See [ADR-0005](0005-visual-regression.md) (f).
5. **The CLI e2e suite leaves the per-PR gates and becomes dispatch-only.** It
   drives real videos through a logged-in `claude` CLI and local `whisper`, then
   asserts keywords a model produced. An ephemeral runner has neither tool, and
   the assertion is nondeterministic — under the flake doctrine that
   disqualifies it as a required check. It keeps its workflow
   (`workflow_dispatch`, `macos-15`) for a machine that carries the tools.
6. **Packaging, the DMG, `verify:package`, `qa:walkthrough` and
   `test:e2e:matrix` stay owner-machine release steps**, outside CI, exactly as
   before: they need signing material, real providers, model caches and a human
   reviewing screenshots.

## Consequences

- No runner to install, patch, unlock or watch; a compromised PR can no longer
  reach a machine the owner owns.
- Required status checks become possible for the first time (public repository →
  rulesets are available), with the contexts `check`, `smoke` and `ai-review`.
- The visual gate needs a bootstrap: `check` fails on CI at the `visual` step
  until the `visual-baselines` workflow's PR lands the `ci-macos-15` PNGs. That
  failure is the honest one — the gate says "I have no baseline for this
  environment" instead of quietly passing. The sequence is written down in
  [docs/ci.md](../ci.md).
- Two baseline sets now have to be re-rendered when a UI change is intentional:
  the local darwin set (in the change's own commit) and the hosted set (through
  the `visual-baselines` workflow). Only the local one is a local-gate concern,
  so the everyday loop is unchanged.
- macOS runner images move (Xcode, fonts, Chromium). A font-driven repaint will
  surface as a red `visual` step with no code change; it is re-baselined
  deliberately through the same workflow, never by relaxing the comparison.
- The e2e suite loses its (never-exercised) automatic trigger. Nothing regresses
  in practice — it had never run — but it must now be dispatched by hand before
  a release, alongside `test:e2e:matrix`.
