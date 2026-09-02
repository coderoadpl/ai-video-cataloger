# CI: GitHub-hosted macOS runners

## State

Every workflow runs on GitHub-hosted runners. The repository is public, so
`macos-15` — Apple silicon, the architecture the packaged app targets — is free
for it and no self-hosted runner exists or will be registered
([ADR-0017](decisions/0017-hosted-ci-runners.md)).

| Workflow | Job (= status-check context) | Trigger | Runner |
|---|---|---|---|
| `check.yml` | `check` | PR, push to `main`, dispatch | `macos-15` |
| `smoke.yml` | `smoke` | PR, push to `main`, dispatch | `macos-15` |
| `ai-review.yml` | `ai-review` | PR (opened / synchronize / ready_for_review / reopened) | `macos-15` |
| `e2e.yml` | `e2e-cli` | dispatch only | `macos-15` |
| `visual-baselines.yml` | `visual-baselines` | dispatch only | `macos-15` |
| `landing.yml` | `deploy` | `landing/**` changes | `ubuntu-latest` |

There is no arming variable and no dormant state: a gate either runs or fails.
The former `CI_RUNNER_READY` / `AI_REVIEW_READY` repository variables are gone,
and `pnpm run workflow-lint` fails `check` if either is ever reintroduced.

## Secrets and variables — what actually exists

- **`CLAUDE_CODE_OAUTH_TOKEN_1`** — organization secret, available to this
  repository. It is what `ai-review` reviews with. `ai-review` is fail-closed:
  if the secret is missing, empty or unusable, the job is **RED**, never
  skipped. `..._2` and `..._3` are optional failover slots the workflow already
  supports; when they are absent, only slot 1 is attempted.
- **`FIREBASE_SERVICE_ACCOUNT_AI_VIDEO_CATALOGER`** — repository secret used
  only by `landing.yml`.
- **`GITHUB_TOKEN`** — the per-run token. `ai-review` posts its verdict comment
  with it; `visual-baselines` pushes its branch and opens its PR with it.
- **No repository variables are used by any workflow.**

A fork PR receives no secrets. That makes `ai-review` red on fork PRs by
construction, which is the fail-closed contract, not a bug: the runner is
disposable, so nothing is protected by skipping such a run.

## Required checks (ruleset)

The repository is public, so branch rulesets are available (they were not on the
private Free plan). The ruleset on `main` — 0 required approvals, required
status checks — names these contexts, which are exactly the literal job names:

- `check`
- `smoke`
- `ai-review`

`e2e-cli` is deliberately **not** required — it drives real videos through a
logged-in `claude` CLI and local `whisper` and asserts keywords a model
produced, so it belongs to the on-demand family with `pnpm run test:e2e:matrix`,
not to a gate the flake doctrine has to trust. Dispatch it by hand before a
release, from a machine that carries those tools.

Job names must stay literal for this to hold: a required check is matched by the
rendered name, so a name built from an expression would silently stop matching.
`workflow-lint` enforces that.

## Visual baselines — one bootstrap, then normal life

`pnpm run visual` compares screenshots byte-exactly (`maxDiffPixels: 0`,
`threshold: 0`, [ADR-0005](decisions/0005-visual-regression.md)). Screenshot
bytes follow the machine's font stack and rasterizer, so the hosted runner
cannot reproduce the baselines the owner rendered locally. Both sets are
therefore kept, selected by `VISUAL_ENV`:

| `VISUAL_ENV` | Baseline directory | Where |
|---|---|---|
| unset / `local-darwin` | `visual/__screenshots__/darwin/` | the owner's machine (`pnpm run check`) |
| `ci-macos-15` | `visual/__screenshots__/ci-macos-15/` | the `check` job |

Any other value is rejected outright — a run never silently compares against a
foreign baseline set.

**Bootstrap sequence** (once, and again whenever the runner image repaints the
UI):

1. Actions → `visual-baselines` → *Run workflow*. It renders the surfaces on
   `macos-15` with `--update-snapshots` and opens
   `chore/visual-baselines-ci-macos-15` as a PR with the generated PNGs.
2. Review those PNGs as product surfaces — they must show the same UI as the
   `darwin` set, allowing for font and rasterizer differences.
3. GitHub starts no workflow run for a branch pushed with `GITHUB_TOKEN`, so
   that PR arrives with no checks. **Close and reopen it** to trigger `check`,
   `smoke` and `ai-review`.
4. Merge it. From that commit on, `check` is green on CI and a real repaint
   turns it red.

Until step 4, the `check` job **fails** at the `visual` step on every run. That
is the designed behaviour: the gate reports that it has no baseline for this
environment rather than passing on tolerance. Nothing about the local gate
changes — with `VISUAL_ENV` unset it keeps comparing against the darwin set.

When a UI change is intentional, the local baselines are re-rendered in the same
change (`pnpm run visual --update-snapshots`, no `--`) and the hosted ones
through the `visual-baselines` workflow after that change lands on `main`.

## Running a workflow by hand

```sh
gh workflow run check --repo coderoadpl/ai-video-cataloger
gh workflow run visual-baselines --repo coderoadpl/ai-video-cataloger
gh run list --repo coderoadpl/ai-video-cataloger --limit 10
```

## The workflows are linted

`pnpm run workflow-lint` (part of `pnpm run check`) fails the local gate if a
workflow guards a repository other than the one named in `package.json`'s
`repository.url`, if any job targets a `self-hosted` runner, if a job name is
computed from an expression instead of being a literal, or if a workflow reads
`vars.CI_RUNNER_READY` or `vars.AI_REVIEW_READY`.
