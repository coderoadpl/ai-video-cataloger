# CI: dormant by design until the runner is registered

## State

The four PR/`main` workflows (`check`, `smoke`, `e2e`, `ai-review`) target a
self-hosted Apple-silicon Mac and are **dormant by design**: they trigger on
every PR and on `main`, and each dormant job skips under a job name that
states how to arm it. GitHub does not evaluate a job's `name:` expression for
a job its `if:` skipped, so the PR checks list shows that name as the raw
template — `vars.CI_RUNNER_READY == 'true' && 'check' || 'check (dormant:
register the self-hosted macOS runner, then set repository variable
CI_RUNNER_READY=true; see docs/ci.md)'` — with the instruction inside it; once
armed, the job runs and the same expression resolves to plain `check`. Dormant
is deliberate, not breakage — no runner is registered on this repository yet.

## Why not just enable them

An unmatched self-hosted job queues for 24 hours on every PR instead of
failing fast. `ai-review` is fail-closed by construction, so without its token
secret it would report every PR RED instead of skipping. And the `secrets`
context is not available in `jobs.<job_id>.if`, so the gate cannot detect its
own secret directly — hence the repository variables below, which `vars.*`
*can* read from a job-level `if:`.

## Enable, step by step (owner/admin only)

1. Register the runner — see "Runner registration" below (labels
   `self-hosted,macOS,arm64`).
2. **One command arms `check`, `smoke` and `e2e`:**
   ```sh
   gh variable set CI_RUNNER_READY --body true --repo coderoadpl/ai-video-cataloger
   ```
   (or Settings → Secrets and variables → Actions → Variables →
   https://github.com/coderoadpl/ai-video-cataloger/settings/variables/actions)
3. Validate without opening a PR: Actions → `check` → Run workflow
   (`workflow_dispatch`).
4. AI review, additionally: add secret `CLAUDE_CODE_OAUTH_TOKEN_1` (minted via
   `claude setup-token`) at
   https://github.com/coderoadpl/ai-video-cataloger/settings/secrets/actions,
   then:
   ```sh
   gh variable set AI_REVIEW_READY --body true --repo coderoadpl/ai-video-cataloger
   ```
5. Disable again at any time:
   ```sh
   gh variable delete CI_RUNNER_READY --repo coderoadpl/ai-video-cataloger
   ```
   The jobs return to loudly-named skips.

## Runner registration

Mint the registration token at
https://github.com/coderoadpl/ai-video-cataloger/settings/actions/runners/new
(agent accounts get a `404` on this endpoint — it requires repo admin),
download the `osx-arm64` runner package, then:

```sh
./config.sh --url https://github.com/coderoadpl/ai-video-cataloger --token <TOKEN> \
  --labels self-hosted,macOS,arm64 --name mac-owner
./svc.sh install && ./svc.sh start
```

Machine prerequisites: Xcode Command Line Tools, a logged-in real `claude` CLI
and `whisper` + `say` on `PATH` (the `e2e` preflight needs them).

## Required checks

**Unavailable today** — this repository is private on the GitHub Free plan, so
`GET /repos/coderoadpl/ai-video-cataloger/rulesets` answers `403 "Upgrade to
GitHub Pro or make this repository public to enable this feature."`. Even once
armed, CI stays advisory; making `check` / `ai-review` required needs GitHub
Pro or a public repository. When that becomes available, the required
contexts are the armed job names: `check`, `smoke`, `e2e-cli`, `ai-review`.

## The guard is linted

`pnpm run workflow-lint` (part of `pnpm run check`) fails the local gate if a
workflow guards a repository other than the one named in `package.json`'s
`repository.url`, if a self-hosted job's `if:` is missing
`vars.CI_RUNNER_READY == 'true'`, or if a job consuming a
`CLAUDE_CODE_OAUTH_TOKEN` slot is missing `vars.AI_REVIEW_READY == 'true'` in
its `if:`.
