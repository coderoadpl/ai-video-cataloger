#!/usr/bin/env bash
#
# Run the e2e video suite against ANY git ref (main, a PR branch, a sha),
# while the suite itself always comes from the current checkout.
#
#   scripts/e2e-videos.sh                 # current checkout's build
#   scripts/e2e-videos.sh main            # build main in a worktree, test it
#   scripts/e2e-videos.sh poc/weronika/folder-scanning-fixes bbb,sintel
#
# Second argument optionally narrows the sample set (E2E_SAMPLES).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
REF="${1:-}"
SAMPLES="${2:-}"

run_suite() {
  local cli_dist="$1"
  # Empty E2E_SAMPLES means "all samples" (see samples.ts selectedSamples).
  # Cross-ref runs exercise the CLI project (the GUI build belongs to the
  # current checkout, not the ref under test).
  ( cd "$ROOT" && \
    E2E_CLI_DIST="$cli_dist" E2E_SAMPLES="$SAMPLES" \
    npx playwright test --config test/e2e/playwright.config.ts --project=cli )
}

if [[ -z "$REF" ]]; then
  ( cd "$ROOT" && npm run build )
  run_suite "$ROOT/dist/index.js"
  exit 0
fi

SAFE_REF="${REF//[\/:]/-}"
WT="$ROOT/.e2e-worktrees/$SAFE_REF"

cleanup() { git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup EXIT

mkdir -p "$ROOT/.e2e-worktrees"
cleanup
git -C "$ROOT" worktree add --force "$WT" "$REF"

echo "== Building $REF in $WT =="
( cd "$WT" && npm ci --no-audit --no-fund && npm run build )

run_suite "$WT/dist/index.js"
