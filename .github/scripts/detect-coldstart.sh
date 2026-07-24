#!/usr/bin/env bash
set -euo pipefail

# Detects the claude-code#23265 cold-start signature in the CLI execution log:
# a result event that errored while costing nothing, i.e. the model was never
# actually called. That signature — and only that — earns a same-slot retry;
# every other infra failure keeps the failover/RED path. Fail-safe default is
# false: a missing, empty or unparsable log is NOT a cold start, so the gate
# behaves exactly as it does without this step. A rejected credential (401 /
# invalid bearer token) is also an errored zero-cost result — the model is never
# reached — so the result text is checked too: retrying a dead token in the same
# slot can only fail again and only delays failover. The path arrives as env
# (EXEC_LOG) — never interpolated into the script.

exec_log="${EXEC_LOG:-}"
cold_start=false

if [ -n "$exec_log" ] && [ -f "$exec_log" ]; then
  cold_start="$(jq -r '
    [ (if type == "array" then .[] else . end)
      | select(type == "object" and .type == "result") ]
    | last
    | (. != null and .is_error == true and .total_cost_usd == 0
       and (((.result // "") | tostring)
            | test("authenticat|invalid bearer|unauthorized|\\b401\\b"; "i") | not))
  ' "$exec_log" 2>/dev/null || echo false)"
fi

case "$cold_start" in
  true) ;;
  *) cold_start=false ;;
esac

echo "cold_start=$cold_start" >> "$GITHUB_OUTPUT"
echo "cold-start signature (claude-code#23265): $cold_start"
