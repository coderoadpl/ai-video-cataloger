#!/usr/bin/env bash
set -euo pipefail

# Prints the CLI's own last `result` event for a slot attempt that produced no
# verdict. The action masks EVERY failed run that carried a --json-schema behind
# "--json-schema was provided but Claude did not return structured_output"
# (base-action/src/run-claude-sdk.ts throws that before the branch that would
# report the real error), so an auth rejection, a rate limit and a network drop
# all surface as the same schema-shaped lie. This is the only place the
# underlying message reaches the log. Diagnostic only: callers run it with
# continue-on-error so it can never move the gate, and a missing or unparsable
# log is reported, not fatal. `.result` is model-authored, PR-influenced text:
# every emitted line is prefixed so an embedded newline followed by `::` cannot
# reach column 0, where the runner would execute it as a workflow command
# (::add-mask::, ::error::) against the job's own log. The path arrives as env
# (EXEC_LOG) — never interpolated into the script.

exec_log="${EXEC_LOG:-}"

if [ -z "$exec_log" ] || [ ! -f "$exec_log" ]; then
  echo "no execution log at '${exec_log:-<unset>}'"
  exit 0
fi

{
  jq -r '
    [ (if type == "array" then .[] else . end)
      | select(type == "object" and .type == "result") ]
    | last
    | if . == null then "no result event in execution log"
      else "subtype=\(.subtype) is_error=\(.is_error) num_turns=\(.num_turns) cost=\(.total_cost_usd)\nresult=\(.result)"
      end
  ' "$exec_log" 2>/dev/null || echo "execution log is not parsable JSON"
} | sed 's/^/  | /'
