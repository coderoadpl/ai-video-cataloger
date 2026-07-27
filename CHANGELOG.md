# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project ships from a branch, not from pull requests, so a released entry
links the **commit** that carried it. Entries under `[Unreleased]` carry no link
— a commit cannot cite its own hash; the release commit adds the links when it
moves them under a version heading. Releases below `0.4.0` predate this file and
are recoverable from git history only. Version `0.5.11` was never cut: the
release history jumps from `0.5.10` to `0.5.12`.

## [Unreleased]

### Added

- The project is licensed `GPL-3.0-only` — `LICENSE` (GPLv3) at the repo root and a root `package.json` declaration, per ADR-0009 (VoiceInk-style: public source, paid convenience builds).

## [0.5.26] - 2026-07-29

### Fixed

- A Gemini batch run killed inside the submit call and resumed against the job
  it finds by display name records the answers under the model that submit used.
  The job model is decided after the re-attach, so the stored file model, the
  per-file usage event and the batch price rates no longer follow a
  configuration that moved in between, and `batch_model_changed` names the drift
  on this path too
  ([`0c6da1e`](https://github.com/chomamateusz/ai-video-cataloger/commit/0c6da1e6)).
- Deleting a credential whose file entry could not be read now also says the
  macOS Keychain still holds the credential when it does, in the CLI and in the
  settings panel: "nothing was removed" alone pointed at the file when the
  locked keychain was what needed unlocking
  ([`4fece52`](https://github.com/chomamateusz/ai-video-cataloger/commit/4fece521)).

## [0.5.25] - 2026-07-29

### Security

- The `media://` read-only mirror scope is no longer one shared root. A
  renderer request can reach
  `~/.ai-video-cataloger/read-only-folders/<folderId>/` only for a folder the
  catalog knows or the folder that is currently open, so the mirrors of every
  other folder — including ones the catalog has never seen — are refused
  instead of served
  ([`d50e189`](https://github.com/chomamateusz/ai-video-cataloger/commit/d50e1898)).

### Fixed

- A re-attached Gemini batch run records its answers under the model the job
  was submitted with: the file's stored model, the per-file usage event and the
  cost rates all name the job's model, not the one the configuration has moved
  to since. A price override stored on the provider is applied only while its
  model still matches the job's
  ([`7304736`](https://github.com/chomamateusz/ai-video-cataloger/commit/7304736b)).
- A batch run that adopts a job whose files another run has already processed
  releases that job's Files API uploads and clears the batch state instead of
  leaving both behind. Such a job is dropped without harvesting — its answers
  would only duplicate rows already in the index
  ([`d7e2524`](https://github.com/chomamateusz/ai-video-cataloger/commit/d7e2524c)).
- An unreadable video no longer aborts the scan of a read-only folder. The
  missing-file reconciliation degrades exactly like the ordinary scan path: the
  file it cannot hash stays marked missing and the folder still lists
  ([`a5fe691`](https://github.com/chomamateusz/ai-video-cataloger/commit/a5fe6912)).
- Thumbnails of a read-only folder appear as soon as its first analysis
  finishes, instead of staying placeholders until the app is restarted. A
  completed analysis earns a file one more thumbnail attempt, now that the home
  mirror it writes to exists
  ([`a5fe691`](https://github.com/chomamateusz/ai-video-cataloger/commit/a5fe6912)).
- The delete-credential copy keeps the keychain warning when a credentials-file
  entry is also unreadable — both the settings notice and the CLI report the
  retained keychain instead of dropping it for the unreadable-entry line
  ([`920abaa`](https://github.com/chomamateusz/ai-video-cataloger/commit/920abaa6)).

## [0.5.24] - 2026-07-29

### Changed

- Listing a folder's records from the global catalog costs a fixed number of
  queries instead of five per file. A 500-file folder — read on every scan of a
  read-only folder, every catalog-tree count and every snapshot export — went
  from 2502 queries to 6; a 10-file folder went from 52 to the same 6
  ([`532e630`](https://github.com/chomamateusz/ai-video-cataloger/commit/532e6306)).

### Fixed

- Thumbnails and extracted frames of a read-only folder are shown in the
  desktop app again. Those artifacts live in the home mirror
  (`~/.ai-video-cataloger/read-only-folders/<folderId>/`), which the `media://`
  scope did not cover, so every request for one was answered with `403` and the
  gallery fell back to placeholders. The mirror root joins the faces root as a
  fixed home scope, and a path that only appears to be inside it — traversal,
  symlink escape, a video smuggled in — is still refused
  ([`664e424`](https://github.com/chomamateusz/ai-video-cataloger/commit/664e424b)).
- Setting a conflicting API key aside no longer writes that key away. Every
  write of a credentials file merges the entries the parser could not read back
  in, and that merge overwrote the value the same call had just archived when
  the target file already held an unreadable entry for the same provider. A
  parsed value now wins over an unparsed one on a key collision, in every write
  ([`4408ed8`](https://github.com/chomamateusz/ai-video-cataloger/commit/4408ed8c)).
- A Gemini batch drive run that finds several unfinished runs for the same root,
  each holding a live batch job, now emits one `batch_orphan_jobs` event naming
  the jobs it is not adopting. It still adopts exactly one; the others are
  collected by re-running the root instead of being silently orphaned
  ([`67de7ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/67de7ea0)).
- Re-attaching to a batch job whose model no longer matches the resolved
  configuration emits one `batch_model_changed` event and records the answers
  under the model the job was bought with, instead of overwriting the run's
  model with one that never produced those answers
  ([`67de7ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/67de7ea0)).
- A Files API delete answered `404` counts as a released upload. Reporting it as
  retained invented a quota leak out of an upload that was already gone
  ([`67de7ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/67de7ea0)).
- `batch_uploads_retained` is a typed drive event in the CLI's NDJSON stream
  like `batch_submitted`, `batch_poll` and `batch_completed`, instead of a
  generic progress line
  ([`67de7ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/67de7ea0)).
- Deleting a credential whose file entry could not be read no longer claims
  "nothing was removed" when the Keychain item was in fact cleared. The CLI and
  the settings panel now name what was cleared and still say the unreadable
  entry was left untouched and has to be fixed by hand
  ([`dc31807`](https://github.com/chomamateusz/ai-video-cataloger/commit/dc318075)).
- The catalog tree shows real pending and processed counts for a read-only
  folder. Those folders carry no marker file, so the counts fell back to
  "unknown"; the tree now reaches the global index through the same path-derived
  folder id `scan` uses, and only when the index actually holds that folder
  ([`dc31807`](https://github.com/chomamateusz/ai-video-cataloger/commit/dc318075)).
- Scanning a read-only folder surfaces the analysis of a file that is back on
  disk after having been recorded as missing. The missing mark is cleared in the
  global index — which is writable even when the folder is not — instead of
  hiding an analysis that is still valid
  ([`dc31807`](https://github.com/chomamateusz/ai-video-cataloger/commit/dc318075)).

## [0.5.23] - 2026-07-29

### Fixed

- `credentials.json` no longer loses an entry the parser could not read. Every
  write — `set`, `delete`, the Keychain migration's cleanup and the stale marker
  — now merges the unparsed entries back verbatim, and the file is removed only
  once no entry of any kind is left. Deleting a provider whose entry is
  unreadable reports that the entry was left untouched and names the file,
  instead of answering "no stored credential" while the plaintext key sits on
  disk
  ([`9402dcd`](https://github.com/chomamateusz/ai-video-cataloger/commit/9402dcd8)).
- `doctor` warns about unreadable credential entries again: the composition
  wrapper around the credentials store dropped `unreadableCredentialEntries` on
  the floor. The wrapper is now typed against the full port so a forgotten
  optional method is a compile error
  ([`9402dcd`](https://github.com/chomamateusz/ai-video-cataloger/commit/9402dcd8)).
- A `set` whose Keychain write succeeded but whose plaintext copy could neither
  be removed nor marked superseded now fails with that message and keeps
  reporting a degraded backend, instead of proceeding as if the copy had been
  marked
  ([`9402dcd`](https://github.com/chomamateusz/ai-video-cataloger/commit/9402dcd8)).
- A folder whose effective analyzer configuration differs from the batch root's
  in any way — a different `apiKeyRef`, output language or timeout, not just a
  different model — is processed interactively instead of being answered with
  the root's settings inside the shared batch job
  ([`5707a50`](https://github.com/chomamateusz/ai-video-cataloger/commit/5707a50a)).
- A Gemini batch run re-attaches to the unfinished run that actually holds a
  submitted job, rather than to the newest unfinished run for the root, so an
  interrupted interactive run over the same root can no longer cause a second
  job to be bought
  ([`5707a50`](https://github.com/chomamateusz/ai-video-cataloger/commit/5707a50a)).
- The `ListBatches` display-name lookup now collects matches across every page
  before choosing the newest by `createTime`; a duplicate name split over a page
  boundary previously re-attached to the older job
  ([`5707a50`](https://github.com/chomamateusz/ai-video-cataloger/commit/5707a50a)).
- A batch job that reports a success state while carrying a job-level error is
  classified as failed
  ([`5707a50`](https://github.com/chomamateusz/ai-video-cataloger/commit/5707a50a)).
- A read-only folder analysed under a path-derived folder id is reported as
  analysed after a restart. Folder-scoped scans now read the global index for
  such folders, so the desktop app no longer shows "Not Tracked" and offers to
  analyse work that is already done
  ([`5707a50`](https://github.com/chomamateusz/ai-video-cataloger/commit/5707a50a)).
- Failed Files API deletions after a batch run emit one
  `batch_uploads_retained` progress event per run naming the count, instead of
  being silent
  ([`5707a50`](https://github.com/chomamateusz/ai-video-cataloger/commit/5707a50a)).

## [0.5.22] - 2026-07-29

### Fixed

- A drive run over a tree that turned read-only after it was first indexed no
  longer dies with a raw `internal` EACCES on
  `.ai-video-cataloger/catalog.ndjson`. The end-of-run snapshot refresh — the
  one that follows a file relocated between folders — now degrades exactly like
  the per-file snapshot write: it counts towards `snapshotSkipped` and emits a
  `catalog_snapshot_skipped` warning, and the run completes
  ([`0ef1a00`](https://github.com/chomamateusz/ai-video-cataloger/commit/0ef1a00f)).
- A `stale` credential entry is never served as a live key. Reading a provider
  whose only file copy is `stale` now reports `keychain_unavailable` when the
  Keychain refuses, and answers "no key" when the Keychain no longer holds the
  item — dropping that superseded copy instead of resurrecting it
  ([`f94ae4d`](https://github.com/chomamateusz/ai-video-cataloger/commit/f94ae4dd)).
- Gemini batch drive runs survive several ways of losing a submitted job. A run
  now re-attaches to the latest unfinished run **of its own root**, so a run over
  another root in between no longer orphans a paid-for batch; the display-name
  lookup walks every page of `ListBatches` instead of only the first; several
  jobs sharing a display name resolve to the newest one with a logged warning;
  and a submit failure that is not a definitive API rejection keeps the persisted
  display name so recovery can still find a job that may exist
  ([`6649571`](https://github.com/chomamateusz/ai-video-cataloger/commit/66495715),
  [`e0b2da9`](https://github.com/chomamateusz/ai-video-cataloger/commit/e0b2da95)).
- A Gemini batch job that reports `done` together with an error is read as
  failed instead of succeeded, a state name without the `JOB_STATE_` prefix is
  understood, an unrecognized state is logged, and a per-request error is mapped
  by its gRPC status string (`UNAUTHENTICATED` / `PERMISSION_DENIED` →
  `provider_auth_failed`, `RESOURCE_EXHAUSTED` → `rate_limited`) as well as by
  the numeric HTTP code
  ([`6649571`](https://github.com/chomamateusz/ai-video-cataloger/commit/66495715)).
- `gemini_batch_mode` is honoured per folder, exactly like the analyzer provider:
  a folder under a batch root can opt out and run interactively, and a folder
  under an interactive root can opt in. The `--gemini-batch` flag still wins over
  every folder key
  ([`6649571`](https://github.com/chomamateusz/ai-video-cataloger/commit/66495715)).
- One malformed entry in `credentials.json` no longer makes the whole file
  unreadable: the bad entry is skipped, every other key keeps working, and
  `doctor` raises a `credential_entry_unreadable` warning naming the provider
  ([`28f0b17`](https://github.com/chomamateusz/ai-video-cataloger/commit/28f0b176)).
- A completed Gemini batch run deletes the files it uploaded to the Files API
  instead of leaving them to expire after 48 hours (best effort — a delete that
  fails is logged, never fatal)
  ([`28f0b17`](https://github.com/chomamateusz/ai-video-cataloger/commit/28f0b176)).
- Cancelling a Gemini batch run stops it at once instead of waiting out the
  current poll backoff, which reaches five minutes
  ([`28f0b17`](https://github.com/chomamateusz/ai-video-cataloger/commit/28f0b176)).
- The whole-tree scope stays available when a tree holds no files on disk but
  the catalog still remembers absent ones, so the absent/forget section is
  reachable for entries search can already find
  ([`28f0b17`](https://github.com/chomamateusz/ai-video-cataloger/commit/28f0b176)).

## [0.5.21] - 2026-07-28

### Added

- **Batch mode for Gemini drive runs** — an opt-in that submits a whole
  `process-drive` run to the Gemini Batch API, billed at **50% of the
  interactive token price**. Turn it on with the `gemini_batch_mode` config
  key, the `--gemini-batch` flag on `process-drive`, or the checkbox in the
  desktop drive-run settings; single-file `process` always stays interactive.
  Uploads still go file by file through the Files API, the run then submits one
  job and waits for it — usually minutes, up to 24 hours by the API's SLA — and
  every answer lands through the normal per-file path (transcript artifacts,
  rename, global catalog, cost event). The run's job name and per-file request
  mapping are persisted and flushed to disk before submission, so a run killed
  mid-flight re-attaches to the job it already paid for instead of submitting a
  second one. Design recorded in
  [ADR-0008](docs/decisions/0008-gemini-batch-drive-runs.md)
  ([`e9c85dc`](https://github.com/chomamateusz/ai-video-cataloger/commit/e9c85dc2),
  [`874bef6`](https://github.com/chomamateusz/ai-video-cataloger/commit/874bef6d),
  [`68489bd`](https://github.com/chomamateusz/ai-video-cataloger/commit/68489bd8),
  [`9033329`](https://github.com/chomamateusz/ai-video-cataloger/commit/90333293),
  [`323a964`](https://github.com/chomamateusz/ai-video-cataloger/commit/323a964b),
  [`9abdeb0`](https://github.com/chomamateusz/ai-video-cataloger/commit/9abdeb0a),
  [`f226c5e`](https://github.com/chomamateusz/ai-video-cataloger/commit/f226c5e9),
  [`640a432`](https://github.com/chomamateusz/ai-video-cataloger/commit/640a4324)).
- NDJSON drive runs gain three additive steps — `batch_submitted` (job name,
  request count), `batch_poll` (job name, state) and `batch_completed` (job
  name, succeeded/failed counts)
  ([`323a964`](https://github.com/chomamateusz/ai-video-cataloger/commit/323a964b)).

## [0.5.20] - 2026-07-28

### Fixed

- **Forget key** in Settings no longer closes the modal the moment the answer
  arrives: the outcome is rendered next to the field as a coloured notice
  (cleared everywhere = success, keychain retained or request failed = warning
  or error), so a Keychain that refused to release the key is finally readable.
  Closing the modal stays the user's action
  ([`e359643`](https://github.com/chomamateusz/ai-video-cataloger/commit/e3596438)).
- A credential migration can no longer overwrite a newer Keychain key with an
  older plaintext one. `credentials.json` entries now record their provenance
  (`{"value": …, "state": "pending" | "stale"}`, a bare string meaning
  "unmarked"); only a `pending` entry — one a degraded write created — wins a
  value conflict, and a `stale` entry is never promoted, not even into a
  Keychain that no longer holds the key. An unmarked conflict leaves the Keychain in charge and moves
  the file value aside to `credentials.json.conflict-<timestamp>` (mode 0600)
  instead of deleting it, and `doctor` raises a new `credential_value_conflict`
  warning naming the provider and that file. Forgetting a key clears those
  archives too
  ([`9c070a7`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c070a77),
  [`eec27aa`](https://github.com/chomamateusz/ai-video-cataloger/commit/eec27aaa)).
- `delete-credential` now attempts the Keychain even when its availability probe
  fails, and distinguishes "no such item" (nothing cleared) from an unreachable
  Keychain (reported as retained), so a key is never announced as gone while the
  Keychain still holds it
  ([`9c070a7`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c070a77)).
- A Keychain read error with no plaintext fallback is reported as the new
  `keychain_unavailable` error (HTTP 503, CLI exit 44) instead of being flattened
  into "no API key stored"; the Settings and prerequisites panels say the login
  keychain is locked (en + pl)
  ([`9c070a7`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c070a77)).
- `doctor` stops reporting a degraded credentials backend once the Keychain
  answers again, including when the migration itself was the operation that
  succeeded
  ([`9c070a7`](https://github.com/chomamateusz/ai-video-cataloger/commit/9c070a77)).
- Saving a credential from Settings while the macOS Keychain is unreachable no
  longer looks frozen: after two seconds the dialog says it is waiting for the
  Keychain and suggests unlocking it, instead of showing only `Saving…` for the
  ~20s the two `security` calls take to time out
  ([`588b43a`](https://github.com/chomamateusz/ai-video-cataloger/commit/588b43a3)).
- The CLI credential prompt writes its question to stderr and decides on raw
  mode from the same stream it gates on (stdin), so `config set-credential
  --json` with stdout redirected no longer mixes the prompt into its NDJSON and
  no longer leaves the terminal echoing the typed key
  ([`a21cda4`](https://github.com/chomamateusz/ai-video-cataloger/commit/a21cda4d)).
- A Gemini native video upload survives a transient chunk failure: a failed
  chunk is retried up to three times with a short backoff, and each retry first
  asks the resumable session how many bytes it already holds, so a half-received
  chunk is resumed rather than sent twice. Non-retryable answers (a rejected key,
  a bad request) still abandon the session immediately. Chunk offsets now advance
  by the bytes actually read, so a short read no longer skips part of the file
  ([`74a2a96`](https://github.com/chomamateusz/ai-video-cataloger/commit/74a2a968)).

## [0.5.19] - 2026-07-28

### Fixed

- Model Manager no longer marks a managed Whisper model `Active` while the
  effective runtime is the system `whisper-cli`, which never reads those files —
  a row could read `Base [Active] · Not downloaded [Download]`. The banner keeps
  naming the runtime actually in use
  ([`119f339`](https://github.com/chomamateusz/ai-video-cataloger/commit/119f339b)).
- The Polish frame-count label declines properly: `1 klatka`, `2 klatki`,
  `5 klatek`, `22 klatki` instead of a fixed `klatek`. The English label now
  also says `1 frame` rather than `1 frames`
  ([`1be0737`](https://github.com/chomamateusz/ai-video-cataloger/commit/1be0737e)).
- `config set ui_language` / `faces_enabled` run outside `$HOME` no longer write
  a per-folder override that nothing reads: these keys are app-wide, so the CLI
  and the API always write them to the home config regardless of the working
  directory, and `config get` reads them back from there. The `config set`
  response names the `scope` it wrote, `config get <key>` carries
  `ignoredFolderValue`, and the CLI prints a `warning:` line naming a stray
  folder override it is ignoring
  ([`54a3280`](https://github.com/chomamateusz/ai-video-cataloger/commit/54a32806)).
- `Nested Databases Detected` no longer blocks re-opening a root the app itself
  analyzed in whole-tree scope. A nested `.ai-video-cataloger` that carries our
  `folder-id` marker is our own lineage: `check` now returns it in the new
  `ownNestedPaths` field and leaves `hasNestedDatabases` false (exit 0), so the
  folder opens. A nested catalog directory without the marker is still foreign
  and still blocks the GUI open and exits `nested_databases_found`
  ([`eadf089`](https://github.com/chomamateusz/ai-video-cataloger/commit/eadf0895)).
- Global search no longer fails with `Response data does not match the contract`
  (exit 10) once a read-only folder has been processed. A folder the app cannot
  write a marker into keeps a stable `path-<hash>` identity, but the contract
  still demanded a UUID; folder ids now travel as a named `folderIdSchema` union
  of both forms, in the contract and in the catalog/snapshot domain schemas
  ([`ff9ee87`](https://github.com/chomamateusz/ai-video-cataloger/commit/ff9ee879)).
- `index forget` on a file inside a read-only folder now exits 0 instead of
  failing with `EACCES` (exit 10) after the global deletion had already
  happened. The folder-local catalog snapshot is skipped when the folder cannot
  be written, and the result says so: the response carries `snapshotSkipped` and
  the human line reads `Forgot <fingerprint> (folder snapshot not updated: the
  folder is not writable)`
  ([`ebcbaaf`](https://github.com/chomamateusz/ai-video-cataloger/commit/ebcbaaf7)).
- The packaged CLI now finds the ffprobe shipped inside the app bundle. Its only
  bundled-ffprobe lookup went through the `@ffprobe-installer/ffprobe` wrapper
  package, which is not staged, so on a machine without a system ffprobe
  `doctor` reported `ffprobe: missing` and every probe/analysis failed. The
  resolver now also looks the binary up by path from its own directory upwards
  through `node_modules`, which reaches
  `Resources/cli/node_modules -> app.asar.unpacked/node_modules`, and
  `verify:package` asserts both bundled binaries are reachable from the staged
  CLI ([`05d9f7a`](https://github.com/chomamateusz/ai-video-cataloger/commit/05d9f7af)).
- A folder watcher that fails while the app is running (for example the watched
  root disappearing) no longer takes the Electron main process down with an
  uncaught error: the watch ends, closes its handle and reports a `read_error`
  to the caller, which drops the dead session
  ([`f7405b9`](https://github.com/chomamateusz/ai-video-cataloger/commit/f7405b9a)).
- Gemini native analysis no longer loads the whole video into memory (twice) to
  upload it: files above the inline cutoff are streamed to the Files API in 8 MB
  chunks straight from disk, so a 300 MB clip peaks at ~40 MB of buffers instead
  of ~900 MB. A file above the Files API 2 GB limit is now refused up front with
  a message naming the limit, instead of failing as an unexplained read error
  after the read was attempted
  ([`404ff9c`](https://github.com/chomamateusz/ai-video-cataloger/commit/404ff9cc)).
- The CLI credential prompts (`config set-credential` and `setup`) no longer
  write the typed key into the terminal at all. They previously relied on the
  ANSI conceal sequence, which only hides the characters visually and leaves the
  key in scrollback, in a copied selection and in any `script`/tmux capture
  ([`0e2831d`](https://github.com/chomamateusz/ai-video-cataloger/commit/0e2831d6)).
- Keychain access runs the absolute `/usr/bin/security` instead of resolving
  `security` on `PATH`, so a shadowing binary earlier in `PATH` can no longer
  see or serve API keys
  ([`6281be6`](https://github.com/chomamateusz/ai-video-cataloger/commit/6281be67)).
- Overlapping writes to the plaintext credentials file no longer collide on a
  shared `credentials.json.tmp`: each write uses its own temporary file and an
  atomic rename, so concurrent saves stop failing with
  `Could not store provider credential` and the file can never be left
  half-written
  ([`8c2a0f8`](https://github.com/chomamateusz/ai-video-cataloger/commit/8c2a0f87)).
- Forgetting a key when the plaintext credentials file cannot be read now
  reports the partial removal (`cleared: keychain`, `retained: file`) instead of
  a bare error that hid the Keychain removal that did happen
  ([`84e07ca`](https://github.com/chomamateusz/ai-video-cataloger/commit/84e07ca6)).
- A key saved while the Keychain was refusing writes is no longer discarded by
  the next migration: when the plaintext file and the Keychain hold different
  values for a provider, the file value wins, is write-verified into the
  Keychain and logged to `credentials-migration.ndjson` as
  `credential_value_conflict` (no secret in the line). An equal or absent file
  value keeps the previous keychain-wins behaviour
  ([`c107c92`](https://github.com/chomamateusz/ai-video-cataloger/commit/c107c927)).
- A transient Keychain failure no longer makes the running app read and write
  API keys from the plaintext file until it is relaunched: every credential
  operation tries the Keychain again, an `unavailable` keychain is re-probed on
  the next access, an incomplete migration is retried, and a key that had to
  fall back to the file is moved into the Keychain as soon as it accepts writes.
  `doctor` reports `degraded` while that is true and returns to `keychain` by
  itself
  ([`0ca4f39`](https://github.com/chomamateusz/ai-video-cataloger/commit/0ca4f39b)).
- Forgetting a provider key now always reaches the Keychain: an earlier keychain
  failure in the same process no longer makes the deletion skip the Keychain and
  report an untouched pair of backends while the key was still stored there. A
  Keychain that refuses the removal is still reported as retained, and a key
  held by both backends now names both as cleared
  ([`56eee4b`](https://github.com/chomamateusz/ai-video-cataloger/commit/56eee4bf)).

## [0.5.18] - 2026-07-28

### Added

- The folder-scope catalog empty state now says how many videos the tree knows
  about in subfolders and offers a one-click switch to whole-tree scope; the
  bare `No videos found` stays when the whole tree is empty
  ([`7901fea`](https://github.com/chomamateusz/ai-video-cataloger/commit/7901fea9)).
- A stored provider key can be forgotten from the app: `DELETE /api/credentials`,
  `ai-video-cataloger config delete-credential <providerId> [--json]`, and a
  **Forget key** action beside the API key field in Settings. Each names the
  backends it cleared and never echoes the key
  ([`6b224ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/6b224ea7)).

### Changed

- Credential deletion answers with the backends it cleared and the ones that
  kept the key: when the Keychain refuses while the plaintext file was cleared,
  CLI and Settings say the removal was partial instead of claiming the key is
  gone, and a keychain that kept the only copy is reported as nothing cleared,
  never as a key that was not stored. `CredentialsStore.delete` and
  `SecretsStore.delete` carry that shape
  ([`6b224ea`](https://github.com/chomamateusz/ai-video-cataloger/commit/6b224ea7),
  [`42c0e13`](https://github.com/chomamateusz/ai-video-cataloger/commit/42c0e135)).
- Model Manager closes from a footer Close button instead of Escape or a
  backdrop click only, every downloaded model carries its own contained
  `Activate` button, and both Delete actions (whisper models and local AI
  tiers) render in the error palette
  ([`5f947e7`](https://github.com/chomamateusz/ai-video-cataloger/commit/5f947e71)).
- The `Not Tracked` status token no longer renders grey-on-grey: its
  `theme.ts` palette entry moves to `#4e4e53` on `#e3e3e6` in light and
  `#c7c7cc` on a 20% tint in dark, which also lifts the search-result and
  absent-file surfaces that share the token
  ([`5f947e7`](https://github.com/chomamateusz/ai-video-cataloger/commit/5f947e71)).
- The terminal panel starts collapsed while it has no output, expands by itself
  on the first line, and stays wherever the user last put it once they toggle
  it by hand
  ([`5f947e7`](https://github.com/chomamateusz/ai-video-cataloger/commit/5f947e71)).

## [0.5.17] - 2026-07-28

### Changed

- The analyzer prompt is now retrieval-graded and shared by every provider:
  descriptions lead with what identifies the clip, the model is told to read the
  text visible in frame (signs, placards, registrations, dates, screens) and
  carry it into the description and the filename, the suggested filename may run
  up to eight kebab-case words and may not use filler like `video`, `clip` or
  `footage`, and tags are search handles (objects, place type, activity, notable
  text). The gemini-native provider reuses the same sections instead of its own
  copy; the `DESCRIPTION` / `FILENAME` / `TAGS` / `TRANSCRIPT` output contract is
  unchanged
  ([`757d57c`](https://github.com/chomamateusz/ai-video-cataloger/commit/757d57ce)).

## [0.5.16] - 2026-07-28

### Changed

- API keys stored in `~/.ai-video-cataloger/credentials.json` migrate into the
  macOS Keychain on first access — written, read back, then removed from the
  file, with one NDJSON line per migrated provider in
  `~/.ai-video-cataloger/credentials-migration.ndjson`. `doctor` (human and
  `--json`) and `config set-credential` now name the backend holding the keys,
  and doctor warns when the Keychain was expected but unreachable. A Keychain
  failure falls back to the plaintext file instead of failing the command
  ([ADR-0007](docs/decisions/0007-credentials-in-keychain.md),
  [`67f1a90`](https://github.com/chomamateusz/ai-video-cataloger/commit/67f1a90a),
  [`7be7def`](https://github.com/chomamateusz/ai-video-cataloger/commit/7be7def8)).

## [0.5.15] - 2026-07-28

### Added

- `doctor` and the readiness payload name the resolved whisper binary and its
  engine (`whisper.cpp` or `openai-whisper (python, CPU)`): dependency statuses
  carry an `engine` field and the readiness transcriber component carries
  `engine` and `binaryPath`
  ([`041f641`](https://github.com/chomamateusz/ai-video-cataloger/commit/041f641d)).
- `process` and `process-drive` accept `--provider <id>` to select a built-in
  analyzer provider by id (`openai`, `claude-code`, `codex`, `cursor-agent`,
  `local`, `gemini`), so harness providers no longer require a config write;
  it cannot be combined with the legacy `--analyzer` backend flag, which now
  rejects unknown values during parsing
  ([`84edb40`](https://github.com/chomamateusz/ai-video-cataloger/commit/84edb40c)).
- The readiness payload names the effective analyzer model, and `doctor` prints
  it as `(model: ...)` — `CLI default` for a harness provider left without a
  configured model, which is when the harness CLI picks the model itself
  ([`ccd1fe5`](https://github.com/chomamateusz/ai-video-cataloger/commit/ccd1fe5d)).

### Fixed

- Readiness for a configured Gemini-native analyzer no longer fails the
  response contract: the readiness analyzer family accepts every analyzer
  family, not just `api`, `harness`, and `local`
  ([`398f9b1`](https://github.com/chomamateusz/ai-video-cataloger/commit/398f9b1e)).
- An empty `~/.ai-video-cataloger/bin` directory is reported as an incomplete
  managed whisper install pointing at
  `ai-video-cataloger models whisper-runtime install`, instead of an absent one
  that silently fell through to a slower system whisper; readiness components
  now carry that `warning` rather than dropping it
  ([`24199c5`](https://github.com/chomamateusz/ai-video-cataloger/commit/24199c52)).

## [0.5.14] - 2026-07-27

### Added

- `pnpm run visual` — a Playwright screenshot suite that compares the layout
  skeletons (default, collapsed sidebar, open terminal, loading) in dark and
  light against darwin baselines committed under `visual/__screenshots__/`; it
  joins no required gate
  ([`6711a72`](https://github.com/chomamateusz/ai-video-cataloger/commit/6711a729)).
- `components/layout/` as a named structural layer, enforced by the
  `web-layouts-are-structure-only` dependency-cruiser rule, a `Container`/
  `AppBar`/`Drawer`/`Toolbar` import ban outside it, and config-regression
  probes ([`bd7759c`](https://github.com/chomamateusz/ai-video-cataloger/commit/bd7759c7),
  [`0b027e7`](https://github.com/chomamateusz/ai-video-cataloger/commit/0b027e78)).

### Changed

- `doc-lint` fails when a tracked `README.md` documents a `pnpm run <script>`
  that the owning `package.json` does not define, so a renamed or dropped script
  can no longer leave a quickstart that lies
  ([`a500173`](https://github.com/chomamateusz/ai-video-cataloger/commit/a5001731)).
- The package manager is pnpm 10 on Node 22.23.1: install with `pnpm install`
  under `nvm use`, dependency lifecycle scripts are blocked except for three
  allowlisted packages, and `lock-lint` now fails closed on a `pnpm-lock.yaml`
  that disagrees with `package.json`
  ([`2eb3eb3`](https://github.com/chomamateusz/ai-video-cataloger/commit/2eb3eb3e),
  [`0706280`](https://github.com/chomamateusz/ai-video-cataloger/commit/0706280d)).

## [0.5.13] - 2026-07-27

### Added

- Read-only folders open in a degraded, index-only mode: the catalog is indexed
  in the home database and the per-folder snapshot write is skipped instead of
  failing the run ([`8dd59e8`](https://github.com/chomamateusz/ai-video-cataloger/commit/8dd59e86),
  [`2f128cf`](https://github.com/chomamateusz/ai-video-cataloger/commit/2f128cf7)).
- The opened folder tree is watched, so files added or removed on disk refresh
  the sidebar without a manual rescan
  ([`7dfd761`](https://github.com/chomamateusz/ai-video-cataloger/commit/7dfd7614)).
- The setup wizard offers the Gemini-native analyzer and skips transcription
  setup for it, since that provider reads the video directly
  ([`6990179`](https://github.com/chomamateusz/ai-video-cataloger/commit/69901798),
  [`454ea53`](https://github.com/chomamateusz/ai-video-cataloger/commit/454ea53e)).

## [0.5.12] - 2026-07-27

### Added

- Gemini-native video analysis: a provider that uploads the video itself
  instead of extracted frames, selectable in Settings → AI Analyzer
  ([`6f7494b`](https://github.com/chomamateusz/ai-video-cataloger/commit/6f7494bf),
  [`5300920`](https://github.com/chomamateusz/ai-video-cataloger/commit/53009205)).

## [0.5.10] - 2026-07-26

### Fixed

- The detail player defaults subtitles on, boxes the video at its true aspect
  and lays the panel out in two columns
  ([`f2f6ad5`](https://github.com/chomamateusz/ai-video-cataloger/commit/f2f6ad53)).
- Force-analyze shows Processing immediately and the tree detail refreshes when
  the run completes ([`120f3c1`](https://github.com/chomamateusz/ai-video-cataloger/commit/120f3c1c)).
- Search results gained a back affordance and 56px thumbnails
  ([`39c21d8`](https://github.com/chomamateusz/ai-video-cataloger/commit/39c21d8c)).
- `doctor` detects a stale CLI shadowing the current one on `PATH` and names the
  shadow in the install flow
  ([`852e697`](https://github.com/chomamateusz/ai-video-cataloger/commit/852e697c)).

## [0.5.9] - 2026-07-26

### Added

- Analyze scope is remembered per folder, and the setup wizard can be re-entered
  from the app ([`8ee1d3b`](https://github.com/chomamateusz/ai-video-cataloger/commit/8ee1d3b7)).
- A run summary dialog replaces the transient skipped chips
  ([`ea17281`](https://github.com/chomamateusz/ai-video-cataloger/commit/ea172811)).
- `health` splits live and ready, and responses travel through one response seam
  ([`0c0817d`](https://github.com/chomamateusz/ai-video-cataloger/commit/0c0817de)).

### Changed

- Contracts are validated with zod 4
  ([`8d411d3`](https://github.com/chomamateusz/ai-video-cataloger/commit/8d411d35)).
- `pnpm run check` gained knip, doc-lint and a coverage ratchet; a local ESLint
  plugin enforces query descriptors and the event-name taxonomy
  ([`6f659b5`](https://github.com/chomamateusz/ai-video-cataloger/commit/6f659b5e),
  [`1790798`](https://github.com/chomamateusz/ai-video-cataloger/commit/1790798d)).
- CI runs on self-hosted workflows with an `ai-review` job
  ([`26cd2b6`](https://github.com/chomamateusz/ai-video-cataloger/commit/26cd2b6a)).

### Fixed

- `ui_language` and `faces_enabled` resolve app-global, so a poisoned per-folder
  config can no longer flip the UI language
  ([`08ec7ce`](https://github.com/chomamateusz/ai-video-cataloger/commit/08ec7ce9)).
- A restored file clears its absent flag through a self-healing absent list
  ([`7b95eaa`](https://github.com/chomamateusz/ai-video-cataloger/commit/7b95eaa4)).
- The canonical row for duplicate files is chosen by a deterministic tie-break
  ([`5874265`](https://github.com/chomamateusz/ai-video-cataloger/commit/58742657)).

## [0.5.8] - 2026-07-25

### Fixed

- Status badge icons align with their labels and the frame gallery is fully
  translated ([`f27d19d`](https://github.com/chomamateusz/ai-video-cataloger/commit/f27d19d9)).

## [0.5.7] - 2026-07-25

### Fixed

- The catalog write lock renews its lease across long jobs and is released when
  a job fails ([`f83232f`](https://github.com/chomamateusz/ai-video-cataloger/commit/f83232fb)).
- Whole-tree analyze is available on a tree that has not been indexed yet
  ([`6c3efa0`](https://github.com/chomamateusz/ai-video-cataloger/commit/6c3efa00)).
- A search result opens its detail view, and Reveal in Finder works across
  folders ([`43014de`](https://github.com/chomamateusz/ai-video-cataloger/commit/43014de3)).
- Absent files are fetched with one tree-scoped query instead of one per folder
  ([`493f23e`](https://github.com/chomamateusz/ai-video-cataloger/commit/493f23e9)).
- The media scheme answers HEAD and returns 416 for an unsatisfiable range
  ([`7619adb`](https://github.com/chomamateusz/ai-video-cataloger/commit/7619adb4)).
- A relocated file keeps the original row chosen by first-seen time rather than
  path sort order ([`22a9c1d`](https://github.com/chomamateusz/ai-video-cataloger/commit/22a9c1d8)).
- UX audit batch: untranslated strings, accessibility labels, plurals and
  tooltips ([`a5e1172`](https://github.com/chomamateusz/ai-video-cataloger/commit/a5e1172d)).

## [0.5.6] - 2026-07-24

### Added

- Reveal in Finder from video, folder and search rows
  ([`8b5a9cd`](https://github.com/chomamateusz/ai-video-cataloger/commit/8b5a9cd3)).
- Absent files appear in tree mode grouped by folder
  ([`181d893`](https://github.com/chomamateusz/ai-video-cataloger/commit/181d8937)).

### Fixed

- Media is served over a standard scheme with HTTP Range support, so seeking
  works in the player ([`c44db2f`](https://github.com/chomamateusz/ai-video-cataloger/commit/c44db2fd)).
- A duplicate clone no longer steals the canonical catalog row
  ([`a25780e`](https://github.com/chomamateusz/ai-video-cataloger/commit/a25780ea)).
- The Settings UI-language switch is written home-scoped and takes effect
  ([`8956914`](https://github.com/chomamateusz/ai-video-cataloger/commit/89569145)).
- Selecting a video in the sidebar clears an active search
  ([`8d5c198`](https://github.com/chomamateusz/ai-video-cataloger/commit/8d5c198c)).

## [0.5.5] - 2026-07-24

### Changed

- The packaged bundle is smaller and ships a sealed ad-hoc signature
  ([`470a23a`](https://github.com/chomamateusz/ai-video-cataloger/commit/470a23a0),
  [`85625e1`](https://github.com/chomamateusz/ai-video-cataloger/commit/85625e14)).

### Fixed

- The window is shown at `whenReady`, removing the black frame at launch
  ([`258d025`](https://github.com/chomamateusz/ai-video-cataloger/commit/258d0250)).

## [0.5.4] - 2026-07-24

### Fixed

- Sidebar round three: rail width, scope selection, thumbnail loading state,
  duplicate detail and badge spacing
  ([`c4d3011`](https://github.com/chomamateusz/ai-video-cataloger/commit/c4d30117)).

## [0.5.3] - 2026-07-24

### Fixed

- The desktop window appears immediately and app composition is deferred behind
  it ([`4bf16b4`](https://github.com/chomamateusz/ai-video-cataloger/commit/4bf16b46)).

## [0.5.2] - 2026-07-24

### Added

- A startup splash and loading skeletons for the sidebar and detail panel
  ([`94619a8`](https://github.com/chomamateusz/ai-video-cataloger/commit/94619a8e)).

### Changed

- Sidebar tree v2: one scroll container, exact per-folder counts and duplicate
  badges ([`23ee22d`](https://github.com/chomamateusz/ai-video-cataloger/commit/23ee22d2)).

## [0.5.1] - 2026-07-24

### Added

- A single-writer catalog lock that names the holding process
  ([`ae13d17`](https://github.com/chomamateusz/ai-video-cataloger/commit/ae13d175),
  [`529290e`](https://github.com/chomamateusz/ai-video-cataloger/commit/529290e8)).
- Lazy folder scanning and windowed lists, with guidance for very large runs
  ([`4d4a308`](https://github.com/chomamateusz/ai-video-cataloger/commit/4d4a308b)).

### Fixed

- Reconciliation covers moved and emptied folders
  ([`40e416e`](https://github.com/chomamateusz/ai-video-cataloger/commit/40e416e5)).
- Forgetting an entry and re-indexing an engine clean up face data
  ([`c2fe478`](https://github.com/chomamateusz/ai-video-cataloger/commit/c2fe478d)).
- Read-only mode disables every mutating action, not just the obvious ones
  ([`c94aca6`](https://github.com/chomamateusz/ai-video-cataloger/commit/c94aca62)).
- Remaining untranslated strings in settings, steps and the people log
  ([`08e4e25`](https://github.com/chomamateusz/ai-video-cataloger/commit/08e4e25b)).

## [0.5.0] - 2026-07-24

### Added

- A sidebar folder tree with scope-aware analyze: per-file live progress, a stop
  control and skip badges
  ([`3ca1322`](https://github.com/chomamateusz/ai-video-cataloger/commit/3ca13224)).
- A coherent setup wizard with a readiness checklist and model pickers
  ([`4b363ef`](https://github.com/chomamateusz/ai-video-cataloger/commit/4b363ef2)).
- Content presentation: detail tags, source-aspect thumbnails, an inline player
  with subtitles and a search dropdown
  ([`f197b24`](https://github.com/chomamateusz/ai-video-cataloger/commit/f197b245)).
- A UI language layer (EN/PL) covering the desktop app and the wizard
  ([`770f98f`](https://github.com/chomamateusz/ai-video-cataloger/commit/770f98fc),
  [`13c78f8`](https://github.com/chomamateusz/ai-video-cataloger/commit/13c78f8a),
  [`12ec358`](https://github.com/chomamateusz/ai-video-cataloger/commit/12ec358f),
  [`3038d9b`](https://github.com/chomamateusz/ai-video-cataloger/commit/3038d9b4)).
- An output-language setting for generated summaries and names
  ([`de1b709`](https://github.com/chomamateusz/ai-video-cataloger/commit/de1b7097)).
- Missing-file reconciliation with an absent-files section in the folder view
  ([`8d5d7e2`](https://github.com/chomamateusz/ai-video-cataloger/commit/8d5d7e2d),
  [`215e97e`](https://github.com/chomamateusz/ai-video-cataloger/commit/215e97e6)).

### Fixed

- Thumbnails are generated at the source aspect ratio
  ([`c9ed26a`](https://github.com/chomamateusz/ai-video-cataloger/commit/c9ed26a2)).
- Whisper hallucinations on near-silent audio are filtered out
  ([`fdae779`](https://github.com/chomamateusz/ai-video-cataloger/commit/fdae7797)).
- A moved file is no longer reported as missing
  ([`66915c2`](https://github.com/chomamateusz/ai-video-cataloger/commit/66915c29)).
- Model selection is scoped per analyzer harness
  ([`11e3b0e`](https://github.com/chomamateusz/ai-video-cataloger/commit/11e3b0e3)).

## [0.4.2] - 2026-07-23

### Added

- The packaged app carries an icon generated from the brand logo
  ([`332c01c`](https://github.com/chomamateusz/ai-video-cataloger/commit/332c01c9)).

### Fixed

- Harness path resolution, the packaged CLI's WASM asset, catalog flushing and
  chip spacing ([`9e90dce`](https://github.com/chomamateusz/ai-video-cataloger/commit/9e90dce8)).

## [0.4.1] - 2026-07-23

### Added

- Analyze a whole folder tree from the desktop app
  ([`d40725a`](https://github.com/chomamateusz/ai-video-cataloger/commit/d40725a4)).

## [0.4.0] - 2026-07-23

### Added

- A home-scoped global catalog: folder identity, content fingerprints, a SQLite
  index and per-folder NDJSON snapshots
  ([`b624b93`](https://github.com/chomamateusz/ai-video-cataloger/commit/b624b938)).
- Global search across the catalog through an FTS4 index, in the CLI and the
  desktop UI ([`03af455`](https://github.com/chomamateusz/ai-video-cataloger/commit/03af455a)).
- Local face grouping: an opt-in ONNX pipeline, a people view and face settings
  ([`19f1564`](https://github.com/chomamateusz/ai-video-cataloger/commit/19f1564c),
  [`7944309`](https://github.com/chomamateusz/ai-video-cataloger/commit/7944309f),
  [`95bd598`](https://github.com/chomamateusz/ai-video-cataloger/commit/95bd5983),
  [`b91cefe`](https://github.com/chomamateusz/ai-video-cataloger/commit/b91cefe8)).
- A whole-drive runner with discovery, resume, backoff and run bookkeeping
  ([`1a938a1`](https://github.com/chomamateusz/ai-video-cataloger/commit/1a938a17)).
- Analyzer tags and GPS capture in the catalog
  ([`dba990f`](https://github.com/chomamateusz/ai-video-cataloger/commit/dba990fa)).
- API keys are stored in the macOS Keychain, falling back to the config file
  ([`3300749`](https://github.com/chomamateusz/ai-video-cataloger/commit/33007496)).

### Fixed

- Forgetting a person deletes its biometric observations instead of only
  unassigning them ([`e375973`](https://github.com/chomamateusz/ai-video-cataloger/commit/e375973a)).
- Snapshot export is atomic, rejects newer-major snapshots and counts malformed
  lines ([`d03f0bc`](https://github.com/chomamateusz/ai-video-cataloger/commit/d03f0bca)).
- A file that cannot be fingerprinted raises a warning event instead of failing
  silently ([`31ce96f`](https://github.com/chomamateusz/ai-video-cataloger/commit/31ce96f4)).
- Global-catalog writes are batched, removing quadratic write amplification on
  large folders ([`64d8e3c`](https://github.com/chomamateusz/ai-video-cataloger/commit/64d8e3c8)).
- Face indexing is resumable and clusters across runs; aligned crop pixels are
  released so memory stays proportional to faces per file
  ([`2e3108a`](https://github.com/chomamateusz/ai-video-cataloger/commit/2e3108a9),
  [`5569638`](https://github.com/chomamateusz/ai-video-cataloger/commit/55696388)).
- The Keychain lookup times out after 10s and falls back to the config file
  ([`47ed4bf`](https://github.com/chomamateusz/ai-video-cataloger/commit/47ed4bff)).
- `whisper-cli` is preferred over CPU python whisper in system resolution
  ([`6570094`](https://github.com/chomamateusz/ai-video-cataloger/commit/6570094b)).
- Local AI requirements are probed only when the local analyzer is chosen
  ([`a499530`](https://github.com/chomamateusz/ai-video-cataloger/commit/a4995302)).
