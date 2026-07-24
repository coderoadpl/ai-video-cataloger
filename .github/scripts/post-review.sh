#!/usr/bin/env bash
set -euo pipefail

# Posts the review verdict to the PR as a single sticky comment (edit-last, else
# create) so repeated pushes update one comment instead of spamming. Best-effort:
# invoked with continue-on-error so a GitHub API hiccup can never flip a real
# PASS to RED. All model-derived text arrives as env and is parsed with jq —
# never interpolated into the shell.

pick=""
for pair in "${O1:-}|${OUT1:-}" "${O1R:-}|${OUT1R:-}" "${O2:-}|${OUT2:-}" "${O3:-}|${OUT3:-}"; do
  oc="${pair%%|*}"
  js="${pair#*|}"
  if [ "$oc" = "pass" ] || [ "$oc" = "fail" ]; then
    pick="$js"
    break
  fi
done

body_file="$(mktemp)"
{
  printf '%s\n\n' '<!-- ai-review-gate -->'
  if [ -z "$pick" ]; then
    printf '## AI review: RED (could not run)\n\n'
    printf 'The gate could not obtain a verdict from any available token slot '
    printf '(rate-limit / auth / network / timeout). Per fail-closed doctrine '
    printf 'this blocks the merge. Re-run the job once capacity returns, or wire '
    printf 'an additional `CLAUDE_CODE_OAUTH_TOKEN_2` / `_3` slot.\n'
  else
    verdict="$(printf '%s' "$pick" | jq -r '.verdict // "UNKNOWN"')"
    summary="$(printf '%s' "$pick" | jq -r '.summary // ""')"
    printf '## AI review: %s\n\n%s\n' "$verdict" "$summary"
    issues="$(printf '%s' "$pick" | jq -r 'if (.blocking_issues | type) == "array" then (.blocking_issues[] | "- " + .) else empty end' 2>/dev/null || true)"
    if [ -n "$issues" ]; then
      printf '\n**Blocking issues**\n\n%s\n' "$issues"
    fi
  fi
} > "$body_file"

gh pr comment "$PR" --edit-last --body-file "$body_file" 2>/dev/null \
  || gh pr comment "$PR" --body-file "$body_file"
