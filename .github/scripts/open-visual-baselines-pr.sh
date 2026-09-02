#!/usr/bin/env bash
set -euo pipefail

branch=chore/visual-baselines-ci-macos-15
baselines=visual/__screenshots__/ci-macos-15

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

git checkout -B "$branch"
git add -- "$baselines"

if git diff --cached --quiet; then
  echo "No baseline change: the committed ci-macos-15 set already matches this runner."
  exit 0
fi

git commit -m 'chore(visual): regenerate the ci-macos-15 visual baselines'
git push --force origin "$branch"

if [ -n "$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // ""')" ]; then
  echo "Updated the open baselines PR."
  exit 0
fi

gh pr create --base main --head "$branch" \
  --title 'chore(visual): ci-macos-15 visual baselines' \
  --body "$(cat <<'BODY'
Visual baselines rendered by the `visual-baselines` workflow on the hosted
`macos-15` runner (`VISUAL_ENV=ci-macos-15`).

Review the PNGs as product surfaces: they must show the same UI as the
`visual/__screenshots__/darwin/` set, allowing for hosted-runner font and
rasterizer differences. Until this PR is merged the `check` job fails on CI at
the `visual` step, by design — the CI baseline set does not exist yet.

GitHub starts no workflow run for a branch pushed with `GITHUB_TOKEN`, so this
PR has no checks. Close and reopen it to arm `check`, `smoke` and `ai-review`.

See `docs/ci.md` (visual baselines) and `docs/decisions/0005-visual-regression.md` (f).
BODY
)"
