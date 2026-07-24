#!/usr/bin/env bash
set -euo pipefail

# Classifies one token-slot attempt into pass | fail | infra | skip and writes it
# to $GITHUB_OUTPUT as `outcome`. Fail-closed: only a structured_output that
# parses to an explicit verdict counts; anything else (empty output, non-JSON,
# missing verdict, crashed/rate-limited attempt) is treated as an infra failure
# so the gate stays RED and the next slot may be tried. Inputs arrive as env
# (RAW, TRY_OUTCOME) — never interpolated into the script — so PR-controlled
# model text cannot inject shell.

raw="${RAW:-}"
try_outcome="${TRY_OUTCOME:-}"

emit() {
  echo "outcome=$1" >> "$GITHUB_OUTPUT"
  echo "slot outcome: $1"
}

if [ "$try_outcome" = "skipped" ] || [ "$try_outcome" = "cancelled" ]; then
  emit skip
  exit 0
fi

if [ -z "$raw" ]; then
  emit infra
  exit 0
fi

verdict="$(printf '%s' "$raw" | jq -r 'if type == "object" then (.verdict // "") else "" end' 2>/dev/null || true)"

case "$verdict" in
  PASS) emit pass ;;
  FAIL) emit fail ;;
  *) emit infra ;;
esac
