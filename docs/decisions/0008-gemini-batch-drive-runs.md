# ADR-0008: Gemini drive runs can go through the Batch API

Date: 2026-07-28 · Status: accepted (owner greenlit 2026-07-28) · Refines
[architecture.md §Ports](../architecture.md#ports-complete-list-for-this-app)
`AnalyzerPort` (the `gemini-native` family) and the drive-run state recorded by
[ADR-0002](0002-global-catalog-layer.md).

## Context

The `gemini-native` analyzer sends the whole video to Gemini as one modality
and gets back the description plus a timestamped transcript in a single
`generateContent` call. That call is billed at interactive rates. The Gemini
**Batch API** runs the same requests against the same models for **50% of the
interactive price**, with a published SLA of "up to 24 hours" — the owner's
measured archive run (115 clips / 95 min, `~/repositories/claude-tmp/gemini-video-chat/notatka-kurs-przetwarzanie-wideo-ai.md`
§4.1) completed in ~4 minutes on Flash and cost $1.76 instead of $3.52.

Cataloguing a drive is exactly the workload batch pricing exists for: hundreds
of files, no human waiting on any single answer. The uploads are already the
slow part and are already a separate step — a file lives 48 h in the Files API
and can be attached to any number of jobs without re-transfer.

What batch mode costs us is the one property the current drive loop is built
on: **linear per-file progress**. A batch job answers all requests at once,
minutes to hours after submission, and a run that is killed mid-flight must
re-attach to the job it already paid for instead of submitting a second one.

## Decision

**1. Batch mode is opt-in, per drive run, and gemini-native only.**
Config key `gemini_batch_mode` (folder-scoped, home fallback, default
`false`), CLI flag `--gemini-batch` on `process-drive`, and a checkbox in the
desktop drive-run settings. The three names are one taxonomy: config
`gemini_batch_mode` → contract `geminiBatch` → CLI `--gemini-batch`. The flag
wins over the config value, exactly like `--frames` / `--timeout`.

Single-file `process` stays interactive in every case. One file has a human
waiting on it, and a 24 h SLA for one answer is not a feature.

A run that asks for batch mode while the resolved provider is not
`gemini-native` fails closed with `invalid_config_value` naming the provider,
rather than silently running interactively at full price.

**2. Uploads are unchanged; the batch is built on top of them.** Each
candidate file goes through the existing streamed resumable Files API upload
with its chunk-level retry and offset re-query, then the existing `ACTIVE`
poll. The batch request set is one `generateContent` request per file — the
same retrieval prompt as interactive mode, `TRANSCRIPT` section included — so
a batch answer parses through exactly the same code as an interactive answer.

**3. The request set travels inline, not as a JSONL file.** The Batch API
accepts an inline `input_config.requests.requests[]` array capped at 20 MB per
request, or a JSONL file uploaded through the Files API. Our requests carry a
`file_uri` reference, never video bytes: a request serialises to ≈2.4 KB
(prompt ≈1.8 KB + file reference + metadata key). 20 MB therefore holds on the
order of 8,000 files, well past any single catalog folder tree we have seen,
and inline keeps the whole lifecycle in two endpoints instead of four (no
input file to upload, no responses file to download and stream-parse, no
second 48 h TTL to reason about). A request set that would exceed the safe
inline budget (18 MB, margin for the envelope) is refused with a
`provider_error` naming the limit and the file count — an honest boundary
beats a silent truncation, and JSONL input stays a documented later upgrade
whose cost is now known.

**4. The batch job's identity is persisted before submission.** The drive-run
record gains a `batch` object (one `batch_json` TEXT column, schema v8):

```
{ displayName, jobName, state: 'preparing' | 'submitted' | 'completed' | 'failed',
  model, requests: [{ key, videoPath, fileName, fileUri }] }
```

`displayName` is derived from the run id (`avc-drive-<runId>`) and written,
with the full request mapping, **before** the submit call. The job name is
written the moment the submit response returns. A run interrupted between
those two writes is not lost: re-attach lists the account's batches and
matches the display name it already persisted, which is why the display name
is derived rather than random.

**5. An interrupted batch run re-attaches; it never resubmits.** Starting a
batch drive run over a root whose latest run is unfinished and carries a
`batch` state re-adopts that run id, that mapping and that job, and jumps
straight to polling. Only a run whose persisted state is `preparing` *and*
whose display name matches no batch on the account submits — because in that
case nothing was ever submitted. The persist is followed by an explicit
catalog **flush**: the sql.js store buffers writes until one, and a run killed
while waiting for the job would otherwise wake up with nothing to re-attach to
and pay for a second job. Measured live before the flush existed — the resumed
run submitted `batches/kuo7…` while `batches/pr9u…` was still running.

**6. Expiry is per-file honesty, not a crash.** The Files API holds an upload
for 48 h and a batch job is not eternal either. A re-attach whose job answers
`404`, `JOB_STATE_EXPIRED`, or whose per-request errors name a missing file
turns into per-file failures with the existing taxonomy (`provider_error`),
recorded in the run summary; the batch state is cleared so the next run
uploads and submits fresh. The run itself completes.

**7. Failure mapping.** A per-request error inside a *completed* batch is a
per-file failure (`provider_error`, or `rate_limited` / `provider_auth_failed`
when the status says so) and the other files still land. A *job-level*
`JOB_STATE_FAILED` / `JOB_STATE_CANCELLED` is a run-level failure: the run
summary is emitted, the job name is cleared from the state, and re-running the
same root submits a **new** batch. The consecutive-failure abort that guards
the interactive loop does not apply to result mapping — the money is already
spent, so every answer that did come back is written to disk.

**8. Batch pricing is a distinct mode in the pricing table, never a silent
reuse of interactive rates.** `geminiNativeModelPricing(model, mode)` takes
`'interactive' | 'batch'`; batch multiplies both published rates by
`GEMINI_BATCH_PRICE_MULTIPLIER` (0.5). A provider config that carries explicit
`pricePerMTokens*` overrides is halved the same way. The per-file usage event
carries `pricingMode`, so a cost line in the log names which rate produced it.

**9. Events are additive, and the drive panel stops pretending.** Three new
`ProcessJobStep` values — `batch_submitted` (job name, request count),
`batch_poll` (job name, state, attempt), `batch_completed` (job name,
succeeded/failed counts). Existing steps keep their meaning; `folder-started`
still opens a folder during the upload pass and `folder-done` closes it during
the mapping pass, with the wait in between. The desktop drive panel renders
"batch submitted — awaiting results (N of M)" instead of a linear bar it
cannot honestly draw, and the copy says results usually arrive in minutes but
may take up to 24 hours.

## Consequences

- A batch drive run has two passes over the tree: upload/plan, then map. Files
  already in the global index are still skipped in the first pass and never
  reach the batch.
- A folder whose effective config resolves to a different analyzer (or a
  different Gemini model) than the run root is processed interactively inside
  the first pass. One job, one model — mixing them would break the mapping.
- A file that appears *after* a batch was submitted cannot join that job. A
  re-attached run processes it interactively, at full price for that one file,
  rather than leaving it silently unprocessed.
- `batch_poll` uses capped exponential backoff (5 s → 5 min) and does not
  block on the 24 h ceiling: cancelling the job cancels the run, and quitting
  the app leaves a re-attachable run behind.
- Result mapping prefers the `metadata.key` the API echoes and falls back to
  request order when it does not — the API has been observed to drop the
  metadata key, and order is documented to be stable.
- The 50% saving applies to tokens only. Uploads, retries and the local
  pipeline cost the same.
