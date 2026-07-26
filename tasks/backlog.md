# Backlog

## Distribution

- [ ] Sign the macOS app with a Developer ID certificate and submit it for
  Apple notarization. This requires an Apple Developer account and is deferred
  from v1.1 by the owner decision in US-610.

## Audit ledger — round 4 (2026-07-29)

Round 4 closed the three batch-precision items the round-3 audit had left
neither fixed nor parked: `folderTakesBatch` compared only the analyzer family
and model, `latestUnfinishedDriveRun` answered with a single row, and the
`ListBatches` display-name lookup returned the first page that matched. All
three now have pinning tests ([ADR-0008](../docs/decisions/0008-gemini-batch-drive-runs.md)
decision 5 and its consequences were rewritten to match).

Deliberately open after this round — each is a decision, not an oversight:

- [ ] **`credentials.json` lost update.** Two writers that overlap on
  *different* providers both start from the same snapshot and the later rename
  wins, dropping one entry. Locking a file the user edits by hand, one key at a
  time, from a single app is out of proportion; the Keychain — the primary
  store — has no such window. Recorded in
  [ADR-0007](../docs/decisions/0007-credentials-in-keychain.md) consequences.
- [ ] **Tree folder counts stay "unknown" for a folder with no marker.**
  `catalogTree`'s per-folder pending/processed counts still resolve the folder
  id from the marker only, so a read-only folder reports unknown counts even
  though its per-video statuses now come from the global index. Falling back to
  the path-derived id there would also change the counts of *writable*
  folders that were never processed, from "unknown" to "all pending" — a tree
  semantics change that needs its own decision.
- [ ] **Retained Files API uploads are reported, not retried.** A failed
  post-batch DELETE now raises one `batch_uploads_retained` event per run; the
  48 h TTL remains the only backstop. Retrying deletions inside a run that is
  already finished buys little for the quota it costs.
- [ ] **A broken `AI_VIDEO_CATALOGER_KEYCHAIN` file is indistinguishable from a
  locked one.** `security` collapses both into the same failure, so the adapter
  reports `keychain_unavailable` either way. Accepted in ADR-0007 rather than
  guessed at; the variable is a development affordance, never part of a shipped
  run.
- [ ] **The terminal log has no `warning` line type.** Best-effort degradation
  notices (`catalog_snapshot_skipped`, `batch_uploads_retained`) render at
  `info` with the warning carried by the copy. Adding a level means a palette
  entry and new visual baselines.
