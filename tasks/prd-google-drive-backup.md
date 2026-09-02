# PRD: Optional encrypted backup to Google Drive (v1)

## Introduction / Overview

AI Video Cataloger is a local-first app. Everything a user cares about that is
not the media itself — the analyses, tags, faces, places, per-folder settings —
lives in a handful of files under `~/.ai-video-cataloger/` and under each
folder's `.ai-video-cataloger/` sidecar. Today a wiped disk, a lost laptop or a
mistaken `rm -rf` destroys weeks of analysis time and (for API analyzers) real
money. The media files can be re-copied from the camera or the drive; the
catalog cannot be re-created without re-running every analysis.

This PRD specifies an **opt-in, off-by-default** backup feature that copies the
catalog — never the media — to the user's own Google Drive, **always encrypted
client-side**, and restores it in-app. Two destination providers ship in v1
behind **one** backup-destination port:

- **(a) Google OAuth — the default for almost every user.** The app asks for the
  narrow `drive.file` scope only, creates and owns a folder named
  `AI Video Cataloger Backups` in the user's own *My Drive*, and can never see
  any other file in that Drive. No Picker, no Shared Drive on this path.
- **(b) Service-account key — advanced / company use.** The user imports a
  service-account key JSON in Settings; the app writes to **one** company Shared
  Drive folder where that service account is a member with the *Content manager*
  role. Never domain-wide delegation.

The archives are opaque: Google, a Workspace admin and anyone with the file
cannot read them without the AES-256-GCM key that never leaves the user's
Keychain (and the recovery key the user exported once, at enablement).

This document is written to be executed by a junior developer or an agent with
no prior context on the feature. Every requirement is numbered; every story is
sized for one session and carries a verifiable acceptance checklist.

Read before starting: [`../CLAUDE.md`](../CLAUDE.md),
[`../docs/architecture.md`](../docs/architecture.md) (ports list, contract as
the only bridge, renderer bound-actions and zero-networking rules),
[ADR-0002](../docs/decisions/0002-global-catalog-layer.md) (home scope and the
`catalog.lock` advisory lock) and
[ADR-0007](../docs/decisions/0007-credentials-in-keychain.md) (how secrets reach
the macOS Keychain today).

### Owner decisions (binding — do not relitigate)

1. Opt-in, **off by default**. No backup traffic, no OAuth window, no Keychain
   item exists until the user completes the enablement flow.
2. Two destination providers in v1, **one port**: OAuth `drive.file` (default)
   and service-account key → one Shared Drive folder (advanced). Both expose a
   "Test connection" action.
3. Trigger policy: **once per day, only if something changed** since the last
   successful backup. Change detection is a content fingerprint over the
   critical file set, evaluated **on app launch and every hour while the app
   runs** — never after every analysis run and never after every write. Plus a
   manual **"Kopia teraz" / "Back up now"** button. No prompting beyond the
   one-time enablement flow. Missed days catch up on the next launch (one
   catch-up run, not one run per missed day).
4. Scope tiers: **CRITICAL** by default (`catalog.db`, `photos.db`,
   `config.json` with secrets excluded, face crops); **OPTIONAL** behind a
   toggle for regenerable artifacts (photo proxies, read-only-folder mirrors,
   grid thumbs) as a **separate archive series**.
5. Encryption is **always on and not configurable**: AES-256-GCM client-side
   before upload, key generated at enablement, stored in the Keychain, with a
   **mandatory one-time recovery-key export** the user must confirm they saved.
6. Retention: keep the last **N** (default 7) **and** one per week for the last
   **X** weeks (default 8), both configurable; pruning runs after each
   successful upload; the last remaining backup is never deleted.
7. Status lives in the **bottom bar**, next to Terminal / "Rozwiń": small and
   unobtrusive, three states (idle / in progress / failed).
8. Restore ships **in v1, fully in-app**, from Settings > Backup.
9. **CLI parity is mandatory** — the CLI is a public contract in this repo. GUI
   and CLI share the same use-cases.

## Goals

- G-1: A non-technical user turns on backup in under three minutes, without a
  terminal, without a Google Cloud account, and without understanding OAuth.
- G-2: After enablement, a changed catalog is backed up at most once per day
  with **zero** further user interaction and zero prompts.
- G-3: A user who lost their machine can install the app on a new Mac, sign in
  (or import the service-account key), enter nothing but the recovery key when
  the Keychain no longer has the encryption key, pick a backup, and get their
  catalog back — in-app.
- G-4: Google, a Workspace admin, and anyone who obtains the archive learn
  nothing beyond its size and timestamp.
- G-5: A backup can never corrupt the catalog: it reads a consistent snapshot
  through the store's own flush path and never races an analysis job.
- G-6: Everything the GUI can do, the CLI can do, with NDJSON events and
  taxonomy exit codes.
- G-7: The feature is invisible — in the UI, on disk, and in cost — to a user
  who never enables it.

## User Stories

Stories are grouped into phases. **Each story is one session's work and must
land with `pnpm run check` and `pnpm run smoke` green.** Stories that change
user-visible behaviour add their `CHANGELOG.md` line under `[Unreleased]` in the
same commit.

### Phase A — domain, archive and job plumbing (no network, no UI)

#### US-001: Backup domain schema, config keys and error taxonomy

**Description:** As a developer, I need the vocabulary of the feature — its
settings, its states, and its failure modes — to exist as closed zod schemas and
a closed error taxonomy before anything else is built, so no later story invents
an ad-hoc shape.

**Acceptance Criteria:**
- [ ] `core/domain/backup.ts` defines, with zod, closed unions for:
      `BackupProvider = 'google_oauth' | 'service_account'`,
      `BackupTier = 'critical' | 'optional'`,
      `BackupPhase = 'idle' | 'fingerprinting' | 'snapshotting' | 'archiving' |
      'encrypting' | 'uploading' | 'pruning' | 'verifying' | 'downloading' |
      'decrypting' | 'restoring'`,
      `BackupIndicatorState = 'idle' | 'running' | 'failed' | 'disabled'`.
- [ ] The nine new config keys of FR-20 are added to `CONFIG_KEYS`, to
      `configValueSchema` with the documented defaults, and to
      `APP_GLOBAL_CONFIG_KEYS` (all backup settings are app-global, never
      per-folder).
- [ ] The eight new `ErrorCode` members of FR-21 are added to `ERROR_CODES` and
      to **all three** exhaustive maps in `core/contract/http-status.ts`
      (`HTTP_STATUS_BY_ERROR_CODE`, `EXIT_CODE_BY_ERROR_CODE`,
      `LEGACY_ERROR_CODE_BY_ERROR_CODE`) with exactly the values in FR-21.
- [ ] `core/domain/backup.ts` defines the `BackupManifest` schema of FR-6 and a
      `RemoteBackup` schema (`remoteId`, `name`, `tier`, `createdAt`,
      `sizeBytes`, `appVersion`, `schemaVersions`).
- [ ] Unit tests: every config key round-trips through the persisted-string
      form; every new error code has a distinct exit code (no collisions with
      the existing 2–46 range); a probe object with an unknown `tier` fails the
      manifest schema.
- [ ] No route, adapter or UI is added in this story.

#### US-002: Deterministic tar + zstd archive writer and reader

**Description:** As a developer, I need to pack a set of files into one
byte-deterministic archive and unpack it again, using **no new native
dependency**, so backups are reproducible and inspectable with standard tools
after decryption.

**Acceptance Criteria:**
- [ ] `adapters/backup/tar.ts` implements a minimal **ustar** writer and reader
      (regular files and directories only; long paths via the `prefix` field;
      no symlinks, no hard links, no extended headers).
- [ ] The writer is deterministic: entries are emitted in sorted path order,
      `uid`/`gid`/`uname`/`gname` are zeroed, `mtime` is taken from the
      manifest's `created_at` (not from disk), mode is `0644` for files and
      `0755` for directories. Packing the same input twice yields identical
      bytes.
- [ ] Compression uses **zstd from `node:zlib`**
      (`createZstdCompress` / `createZstdDecompress`, level 10). Justification
      recorded in Technical Considerations: the pinned Node 22.23.1 ships zstd
      natively, so zstd costs **zero** new dependencies and no native build —
      the gzip fallback the owner allowed is therefore not needed.
- [ ] Streaming end to end: the writer never buffers a whole file, and the
      reader never buffers a whole archive. Memory stays bounded on a 5 GB
      input (test asserts peak RSS growth < 256 MB).
- [ ] The reader rejects: a path escaping the archive root (`..`, absolute
      paths, `//`), an entry whose header checksum is wrong, and a truncated
      archive — each with `backup_integrity_failed`.
- [ ] Tests: golden-vector round trip (fixture tree → archive → extract → byte
      equality), determinism test, each rejection case, and a
      `tar -tzf`-equivalent cross-check that GNU/BSD `tar` can list the
      decompressed archive.

#### US-003: AES-256-GCM archive envelope and key lifecycle

**Description:** As a user, I want everything that leaves my machine to be
unreadable to anyone but me, and I want to be able to get my data back if this
Mac is gone.

**Acceptance Criteria:**
- [ ] `adapters/backup/envelope.ts` implements the framed envelope of FR-7:
      cleartext header (`AVCBAK1` magic, format version, 4-byte random nonce
      prefix, frame size, frame count placeholder) followed by AES-256-GCM
      frames of 8 MiB, each with nonce = `noncePrefix || uint64(frameIndex)` and
      AAD = `magic || formatVersion || uint64(frameIndex) || uint8(isLastFrame)`.
- [ ] Decryption **verifies each frame's auth tag before emitting its
      plaintext**; a flipped bit, a dropped frame, a reordered frame, a
      truncated stream and a wrong key each fail with
      `backup_encryption_failed` and produce **no** partial output file.
- [ ] Key lifecycle: `crypto.randomBytes(32)` generated at enablement, stored
      base64 in the Keychain under account `backup.encryption_key`
      (service `com.ai-video-cataloger.app`, per ADR-0007).
- [ ] Recovery-key rendering: the 32 bytes render as 26 upper-case Crockford
      base32 characters in five dash-separated groups plus a 4-character
      checksum; a helper parses that string back to the key and rejects a
      single-character typo via the checksum.
- [ ] The key is never written to `credentials.json`, never logged, never put
      in an NDJSON event, never sent to the renderer over the contract, and
      never included in an archive. Test: run an enablement + a backup with
      logging at maximum verbosity, then grep the debug log, the NDJSON stream,
      the manifest and the archive bytes for the key material — zero hits.
- [ ] Tests use an injected fake `SecretsStore`; no test touches a real
      keychain (keychain fixture hygiene, `CLAUDE.md`).

#### US-004: Consistent snapshot of the critical file set

**Description:** As a user, I want a backup taken while I am using the app to be
a *valid* database, not a half-written file.

**Acceptance Criteria:**
- [ ] `GlobalCatalogStore` and `PhotosStore` gain
      `snapshotTo(targetPath: string): Promise<Result<{ sizeBytes: number;
      schemaVersion: number }, AppError>>`.
- [ ] The sql.js implementation reuses the store's **own** persistence path: it
      takes the `HomeLock` write lock, calls `flush()`, then writes
      `client.export()` to `${targetPath}.tmp`, `fsyncSync`, `renameSync` — the
      same sequence `persistDatabase` uses — and releases the lock. It **never**
      copies `catalog.db` / `photos.db` with a raw `cp`, and it never reads the
      file while another process may be mid-`rename`.
- [ ] If the store is not currently open in this process, `snapshotTo` opens it
      read-only under the same lock, exports, and closes.
- [ ] `sqlite integrity_check` (executed through sql.js on the snapshot) is run
      on every snapshot before it enters the archive; a failure aborts the
      backup with `backup_integrity_failed` and leaves no remote artifact.
- [ ] `core/server/usecases/backup-scope.ts` returns the **critical** file set
      exactly as FR-3 defines it and the **optional** file set exactly as FR-4
      defines it, with FR-5's exclusions applied.
- [ ] Tests: a snapshot taken while a writer holds the lease blocks and then
      succeeds; a snapshot of a store with 25+ un-flushed mutations contains
      those mutations; `credentials.json`, `catalog.lock` and `*.tmp` are absent
      from both sets.

#### US-005: Change fingerprint and the once-a-day trigger decision

**Description:** As a user, I want the app to back up when something actually
changed, not on every analysis and not every hour.

**Acceptance Criteria:**
- [ ] `core/server/usecases/backup-fingerprint.ts` computes the FR-8
      fingerprint: full SHA-256 of the two database snapshots' *stored* bytes,
      plus `path + size + mtimeMs` for every other critical file, hashed in
      sorted path order into one hex digest.
- [ ] `core/server/usecases/backup-schedule.ts` exports a **pure** function
      `decideBackup(state, now)` returning
      `{ action: 'run' | 'skip', reason: 'not-enabled' | 'no-change' |
      'too-soon' | 'due' | 'catch-up' | 'blocked-by-job' }`.
- [ ] Rules, tested exhaustively with a fake clock: run when enabled **and**
      `now - lastSuccessAt >= 24h` **and** `fingerprint !== lastSuccessFingerprint`;
      `catch-up` when `lastSuccessAt` is more than 48h old and the fingerprint
      differs (still exactly **one** run, never one per missed day);
      `no-change` when the fingerprint matches regardless of elapsed time;
      `blocked-by-job` per FR-13.
- [ ] The scheduler is evaluated on app launch and on a 1-hour interval timer
      while the app runs — nowhere else. A unit test proves no evaluation is
      triggered by a completed analysis job.
- [ ] Backup state (last success timestamp, last fingerprint, last error code,
      last archive name) persists to `~/.ai-video-cataloger/backup-state.json`
      (mode `0600`), **not** to `config.json`; a corrupt state file is treated
      as "never backed up" and does not crash launch.

#### US-006: The backup destination port, a fake destination, and the backup job

**Description:** As a developer, I need the whole pipeline runnable end to end
against an in-memory destination before any Google code exists.

**Acceptance Criteria:**
- [ ] `core/server/ports.ts` gains `BackupDestinationPort` with exactly:
      `describe()`, `test()`, `ensureFolder()`, `list()`, `upload()`,
      `download()`, `remove()` — all returning `Result<T, AppError>`, all
      accepting an `AbortSignal` where they do I/O.
- [ ] `adapters/backup/memory-destination.ts` implements it in memory
      (the port's second implementation for test composition).
- [ ] `core/server/usecases/backup-run.ts` implements the pipeline: fingerprint
      → snapshot → archive → encrypt → upload → prune → record state, reporting
      one `JobProgress` per phase of `BackupPhase`.
- [ ] `enqueueBackup` adds `JobKind` `'backup'` with `resourceKey: 'backup'`,
      dedupes a second concurrent backup with `conflict`, and enforces the FR-13
      admission gate against analysis / import / recluster job kinds.
- [ ] Cancellation works: aborting the job stops the upload, deletes the local
      staging directory and any partially uploaded remote object, and leaves
      `backup-state.json` unchanged.
- [ ] Staging happens in `~/.ai-video-cataloger/backup-staging/{jobId}/`, is
      deleted on success, failure and cancellation, and a leftover staging
      directory from a crashed run is deleted at the next launch.
- [ ] Tests drive the full pipeline against the memory destination: a critical
      backup, an optional backup, a cancelled backup, a failing upload
      (`backup_destination_error`), and a full disk during staging.

#### US-007: Retention and pruning

**Description:** As a user, I want my Drive not to fill up, and I never want to
be left with zero backups.

**Acceptance Criteria:**
- [ ] `core/server/usecases/backup-retention.ts` exports a **pure**
      `selectForDeletion(backups, { keepLast, keepWeekly }, now)`.
- [ ] Rule: keep the newest `keepLast` (default 7) **and** the newest backup in
      each of the last `keepWeekly` (default 8) ISO weeks; delete everything
      else. The two sets are unioned, never intersected.
- [ ] The `critical` and `optional` series are pruned **independently**; an
      optional archive never counts toward the critical series' quota.
- [ ] `selectForDeletion` never returns the only remaining backup of a series,
      even when it is older than every retention window.
- [ ] Pruning runs only **after** a successful upload; a failed prune is a
      warning event, never a failed backup.
- [ ] Table-driven tests over at least 12 scenarios, including: fewer backups
      than `keepLast`, several backups in one week, an 18-month-old lone
      backup, `keepLast: 1` + `keepWeekly: 0`, and a series whose only member is
      today's.

### Phase B — the two Google destinations

#### US-008: Google OAuth destination (`drive.file`, loopback + PKCE)

**Description:** As a normal user, I want to click "Connect Google Drive", pick
my account in my normal browser, and be done — without giving the app access to
the rest of my Drive.

**Acceptance Criteria:**
- [ ] `adapters/backup/google-oauth-destination.ts` implements
      `BackupDestinationPort` over the Drive v3 REST API using only the
      `https://www.googleapis.com/auth/drive.file` scope. No other scope is
      requested anywhere in the codebase (test greps the source for
      `auth/drive` and asserts the single value).
- [ ] The flow is the **Desktop-app installed-client** flow: the main process
      starts an HTTP listener on `127.0.0.1` on an ephemeral port, opens the
      consent URL in the **system browser** (`shell.openExternal`), and receives
      the code on the loopback redirect. PKCE (`S256`) is mandatory; `state` is
      32 random bytes and is verified.
- [ ] The listener binds to `127.0.0.1` only (never `0.0.0.0`), accepts exactly
      one request, times out after 5 minutes with `backup_auth_required`, and is
      closed in a `finally`.
- [ ] On success the app creates (or re-finds) a folder named
      **`AI Video Cataloger Backups`** in the user's **My Drive**, stores its id
      in `backup_folder_id`, and stores the account e-mail in
      `backup_account_email` for display. No Picker, no `driveId`, no
      `supportsAllDrives` on this path.
- [ ] The refresh token is stored in the Keychain under account
      `backup.google.refresh_token`. Access tokens live in memory only and are
      refreshed on `401`.
- [ ] `test()` performs a real `files.list` limited to the app folder plus a
      1 KB round-trip upload/delete, and reports account e-mail, folder name and
      remaining Drive quota.
- [ ] Revocation from the Google account is the user's off-switch: a refresh
      that returns `invalid_grant` sets the indicator to `failed` with
      `backup_auth_required` and the Settings panel offers "Reconnect" — the app
      never silently re-prompts.
- [ ] Error mapping: `401`/`invalid_grant` → `backup_auth_required`;
      `403 storageQuotaExceeded` → `backup_quota_exceeded`; `403 rateLimit` and
      `429` → `rate_limited` with the `Retry-After` hint; other `4xx`/`5xx` →
      `backup_destination_error` with a body excerpt (never the token).
- [ ] Resumable uploads are used for anything over 5 MB, with resume-on-retry
      and exponential backoff (5 attempts, full jitter).
- [ ] All tests run against a local fake Google endpoint; **no test performs a
      real OAuth flow or a real network call**.

#### US-009: Service-account destination (one Shared Drive folder)

**Description:** As an advanced/company user, I want backups to land in a
company Shared Drive folder without any human signing in.

**Acceptance Criteria:**
- [ ] `adapters/backup/google-service-account-destination.ts` implements the
      same port using a service-account key JSON: signed JWT assertion →
      `oauth2/token` → access token, `drive.file` scope, `supportsAllDrives:
      true`, `driveId` = the configured Shared Drive.
- [ ] The key JSON is validated (`type: 'service_account'`, `client_email`,
      `private_key`, `token_uri`) and stored **whole** in the Keychain under
      account `backup.service_account.key`. Only the Shared Drive id
      (`backup_shared_drive_id`) and a key fingerprint
      (`backup_service_account_fingerprint` = `sha256:` + first 12 hex of the
      SHA-256 of `client_email + private_key_id`) go into `config.json`.
- [ ] **Domain-wide delegation is never used**: the token request carries no
      `sub` claim. A lint-level probe test asserts the assertion payload has no
      `sub` field.
- [ ] Writes target exactly one folder inside the configured Shared Drive; the
      adapter refuses to operate if that folder id is not inside
      `backup_shared_drive_id` (`validation`).
- [ ] `test()` verifies the service account is a member of the Shared Drive with
      at least the *Content manager* role, and reports the drive name, the
      folder name, and the service-account e-mail; a member with a lower role
      fails with an actionable message naming the required role.
- [ ] Same error mapping and resumable-upload behaviour as US-008 (shared
      helper module, not duplicated).
- [ ] Composition picks the destination from `backup_provider`; every use-case
      and both surfaces are provider-agnostic (test: the same use-case test
      suite runs against both adapters with a fake HTTP layer).

### Phase C — restore

#### US-010: In-app restore (download → decrypt → verify → pre-restore backup → swap → relaunch)

**Description:** As a user who lost their catalog, I want to pick a backup from
a list and get my data back, with no chance of ending up with nothing.

**Acceptance Criteria:**
- [ ] `core/server/usecases/backup-restore.ts` runs as job kind `'restore'`,
      resource key `'backup'`, and executes exactly these steps in order:
      1. refuse if any job holds the catalog lock or any FR-13 job kind is
         queued/running → `restore_refused`;
      2. refuse if the archive's `schemaVersions` exceed the running app's
         supported versions → `snapshot_incompatible`, with a message naming the
         app version that wrote the archive;
      3. download to `~/.ai-video-cataloger/backup-staging/{jobId}/`;
      4. decrypt (frame-by-frame, US-003);
      5. extract and verify **every** `sha256` in `manifest.json` and run
         `integrity_check` on each database → `backup_integrity_failed` on any
         mismatch, before anything is touched;
      6. take a **local pre-restore backup** of the current critical set into
         `~/.ai-video-cataloger/pre-restore/{ISO-timestamp}/` (plain, unencrypted,
         local only) and verify it is readable;
      7. swap files in with `rename` per file after closing the stores;
      8. write the restore outcome to `backup-state.json`;
      9. relaunch.
- [ ] Any failure before step 7 leaves the machine byte-identical to before the
      restore. A failure **during** step 7 leaves a marker file that, on the next
      launch, offers to roll back from the pre-restore directory.
- [ ] Relaunch: the desktop app calls `app.relaunch()` + `app.exit(0)`; the CLI
      prints the "restart the app" instruction and exits `0`.
- [ ] Schema migration: after the swap, the restored databases are migrated by
      the app's **normal** forward-only migration path on first open. Documented
      constraint: sql.js migrations are forward-only and
      `migrateGlobalCatalog` **rejects** a database newer than
      `GLOBAL_CATALOG_SCHEMA_VERSION`, which is why step 2 refuses up-front
      rather than failing mid-restore.
- [ ] The pre-restore directory is pruned to the newest 3 entries on launch.
- [ ] Tests: a full round trip (backup → wipe home → restore → identical
      catalog rows), each refusal path, a corrupted archive, a truncated
      download, a newer-schema archive, and a crash injected between two file
      renames in step 7 followed by a successful rollback.

### Phase D — surfaces

#### US-011: CLI parity — `backup now | list | restore | status`

**Description:** As a scripting user, I want every backup capability from the
terminal, with the NDJSON events and exit codes this repo treats as a public
contract.

**Acceptance Criteria:**
- [ ] `avc backup now [--tier critical|optional] [--json]` enqueues a backup and
      streams job progress; one `progress` event per `BackupPhase` with
      `percentage`, plus `started` / `completed` / `error`.
- [ ] `avc backup list [--tier ...] [--json]` prints date, tier, size, app
      version, schema versions and remote id; human mode prints an aligned table,
      `--json` a single `completed` event carrying the array.
- [ ] `avc backup restore <remoteId> [--yes] [--json]` runs US-010; without
      `--yes` it exits `confirmation_required` (18) and prints exactly what will
      be overwritten.
- [ ] `avc backup status [--json] [--test-connection]` prints enabled/disabled,
      provider, account/drive, last success, next due, last error, retention
      settings, and the current indicator state. `--test-connection` additionally
      runs the destination's `test()`.
- [ ] Exit codes come from `EXIT_CODE_BY_ERROR_CODE` only; a smoke assertion
      covers `backup_disabled` (47) from `backup now` on a fresh home.
- [ ] Secrets never appear in any output mode; the `--json` stream is valid
      NDJSON (one object per line) in every path including errors.
- [ ] `pnpm run smoke` gains a leg: fresh temp HOME → `backup status --json`
      reports `enabled: false` → `backup now` exits 47 with the taxonomy shape.
- [ ] `apps/cli/README.md` documents the four commands; `doc-lint` stays green.

#### US-012: Settings > Backup — enablement, provider choice, tiers, retention, recovery key

**Description:** As a user, I want one place to turn backup on, choose where it
goes, and see that it is working.

**Acceptance Criteria:**
- [ ] A new **Backup** section in `SettingsModal` (`data-testid="settings-backup"`),
      collapsed/disabled-looking until enabled, containing: the on/off switch,
      the provider radio (Google account / Service account — advanced), a
      "Connect" or "Import key JSON" action, "Test connection", the optional-tier
      toggle, the two retention number fields, "Kopia teraz", the last-backup
      line, and the backup list of US-014.
- [ ] The enablement flow is a single stepper that cannot be skipped: choose
      provider → connect / import key → **export recovery key** → confirm saved →
      first backup runs. Turning the switch on without completing the stepper is
      impossible; abandoning it leaves `backup_enabled: false` and no Keychain
      items.
- [ ] Recovery-key export uses the native save dialog **from the main process**
      (a sanctioned native surface): the renderer shows only the key's
      fingerprint and the "I saved my recovery key" checkbox; the key material
      never crosses the contract into the renderer. The "Finish" button stays
      disabled until the file was written **and** the checkbox is checked.
- [ ] All actions are **bound actions** from a `features/settings` hook; the
      renderer performs no `fetch`, no `ipcRenderer`, no networking; query keys
      are declared in `core/client/queries.ts`.
- [ ] Visual language only through `theme.ts`; no inline hex colours.
- [ ] PL and EN dictionary keys exist for every string (see US-015); no literal
      user-facing text in the component.
- [ ] **Real-UI verification:** `test/e2e/backup-settings.spec.ts` launches the
      packaged Electron app with an isolated HOME and drives the flow with real
      clicks and keystrokes — open Settings, open Backup, choose the service
      account provider, paste a fixture key, click "Test connection" against a
      local fake Google endpoint, complete the recovery-key step through the
      real button (the native save dialog stubbed in the main process via
      `app.evaluate`, the in-app button still clicked for real), and assert the
      section reports "connected" and `backup_enabled: true` **in the UI**. No
      pre-seeded app state stands in for a user action.

#### US-013: Bottom-bar backup indicator

**Description:** As a user, I want to know at a glance that my catalog is safe,
without a single popup.

**Acceptance Criteria:**
- [ ] A small indicator renders in the bottom bar's `terminalActions` slot, to
      the **left** of the Raw/Copy/Clear/Rozwiń buttons, sized like those buttons
      and using the same `grey.400` idle treatment — visually subordinate to the
      Terminal controls.
- [ ] Three states plus hidden: **hidden** when backup is disabled; **idle** —
      a small cloud/check glyph with the last backup date in the tooltip;
      **in progress** — a 16px spinner plus the current phase label;
      **failed** — a warning glyph in `warning.main`, and clicking it opens
      Settings > Backup scrolled to the error.
- [ ] The indicator never occupies more than 160px, never wraps the bar, and
      never renders when the terminal is hidden.
- [ ] It reads state through a bound action polling `GET /api/backup/status`
      (60s while idle, 2s while a backup job is running); no client event bus,
      no global state library.
- [ ] **Real-UI verification (two parts):** (a) `visual/surfaces.spec.ts` gains
      three surfaces — `shell-backup-idle`, `shell-backup-running`,
      `shell-backup-failed` — with committed darwin baselines produced by
      `pnpm run visual --update-snapshots`; (b) an e2e assertion in
      `test/e2e/backup-settings.spec.ts` clicks the failed indicator for real and
      asserts the Settings Backup section is open and showing the error.

#### US-014: Backup list and in-app restore UI

**Description:** As a user, I want to see my backups and restore one, in the app.

**Acceptance Criteria:**
- [ ] Settings > Backup lists remote backups sorted newest first, showing
      **date, tier, size, app version**, with a "Restore" button per row and an
      explicit tier filter.
- [ ] A row whose `schemaVersions` exceed this app's supported versions is shown
      disabled with "requires app version ≥ X" — the reason, not a dead button.
- [ ] "Restore" opens a confirmation dialog naming exactly what will be
      overwritten, that a pre-restore backup will be taken, and that the app will
      relaunch; the confirm button requires a second, deliberate click.
- [ ] During restore the dialog shows the phase and progress and cannot be
      dismissed; on failure it shows the taxonomy message and states that
      nothing was changed.
- [ ] Restore attempted while an analysis job runs shows the `restore_refused`
      message naming the blocking job — it does not silently queue.
- [ ] **Real-UI verification:** `test/e2e/backup-restore.spec.ts` drives a full
      round trip against the local fake Google endpoint with real clicks — run a
      backup from the UI, delete a catalog row out of band, click Restore,
      confirm, wait for the app to relaunch, and assert **in the UI** that the
      row is back. The catalog.db read via sql.js is a secondary invariant only.

#### US-015: Dictionary, documentation and owner runbook

**Description:** As a Polish-speaking user and as the owner setting this up for
the first time, I want the feature to be fully translated and the one-time
Google setup written down for a non-developer.

**Acceptance Criteria:**
- [ ] Every user-facing string has a PL and an EN key in
      `apps/web/src/i18n/dictionary.ts` under a `backup` group, including
      "Kopia teraz" / "Back up now", every phase label, every error message for
      the eight new error codes, and every runbook-referencing hint.
- [ ] `docs/architecture.md` gains `BackupDestinationPort` to the ports list and
      a short delta describing the backup job, the snapshot path and the
      renderer's continued zero-networking posture — **edited before** the code
      lands, per the docs-first rule.
- [ ] A new ADR records the format decision (tar + native zstd + framed
      AES-256-GCM, `drive.file` only, no Shared Drive on the OAuth path).
- [ ] `docs/qa/release-walkthrough.md` gains a backup step (enable against the
      fake endpoint, run, list, restore) and `README.md` documents the four CLI
      commands and every new config key; `doc-lint` stays green.
- [ ] The **Owner setup runbook** (appendix of this PRD) is copied into
      `docs/qa/backup-setup-runbook.md` and kept in sync.
- [ ] `CHANGELOG.md` carries the feature's `[Unreleased]` lines.

## Functional Requirements

### Enablement and providers

- **FR-1:** Backup is off by default. With `backup_enabled: false` the app makes
  **no** network request, creates **no** Keychain item, writes **no**
  `backup-state.json`, and shows **no** bottom-bar indicator.
- **FR-2:** Both destinations implement one `BackupDestinationPort`. No
  use-case, route, CLI command or UI component may branch on
  `backup_provider`; the only place the provider is read is the composition
  root that selects the adapter.

### Scope

- **FR-3:** The **critical** tier contains exactly:
  1. `~/.ai-video-cataloger/catalog.db` — via `snapshotTo` (never a raw copy);
  2. `~/.ai-video-cataloger/photos.db` — via `snapshotTo`, when it exists;
  3. `~/.ai-video-cataloger/config.json` — the home-scope (app-global) config;
  4. `{folder}/.ai-video-cataloger/config.json` for **every** folder present in
     the catalog's `folders` table, archived as
     `folders/{folderId}/config.json` with the folder's absolute path recorded
     in the manifest;
  5. `~/.ai-video-cataloger/faces/obs/**` — the face crops.
- **FR-4:** The **optional** tier (toggle `backup_include_optional`, default
  off) contains exactly:
  1. `~/.ai-video-cataloger/photo-artifacts/proxies/**`;
  2. `~/.ai-video-cataloger/photo-artifacts/thumbs/**` (including
     `*.grid.jpg`);
  3. `~/.ai-video-cataloger/read-only-folders/**` (mirrored frames, audio and
     variant outputs).
  It is uploaded as a **separate archive series** with its own retention; a
  critical backup never waits for it.
- **FR-5:** These are **never** archived, in any tier:
  `~/.ai-video-cataloger/credentials.json`, any Keychain item, `catalog.lock`,
  `*.tmp`, `backup-staging/`, `pre-restore/`, the spend ledger, whisper models,
  managed runtime binaries, and any media file. A test asserts the archive
  member list against an explicit allow-list.

### Archive format

- **FR-6:** Every archive contains a top-level `manifest.json`:
  `{ formatVersion: 1, tier, createdAt (ISO 8601 UTC), appVersion,
  schemaVersions: { globalCatalog, photos }, contentFingerprint,
  totalBytes, files: [{ path, sizeBytes, sha256 }], folders: [{ folderId,
  path }] }`. Restore verifies **every** `sha256` before touching anything.
- **FR-7:** The uploaded object is
  `header || frame₀ || frame₁ || … || frameₙ`, each frame an independent
  AES-256-GCM message over at most 8 MiB of the zstd-compressed tar stream, as
  specified in US-003. The header is cleartext and carries no secret and no
  user-identifying data.
- **FR-8:** The **change fingerprint** is the SHA-256 over, in sorted path
  order: the full SHA-256 of each database snapshot's bytes, and
  `path|size|mtimeMs` for every other critical file. It is stored in
  `backup-state.json` on every successful backup and is what "something
  changed" means.
- **FR-9:** Remote object name:
  `avc-{tier}-{YYYYMMDD}T{HHMMSS}Z.avcbak`. Drive `appProperties` carry
  `tier`, `createdAt`, `appVersion`, `schemaGlobalCatalog`, `schemaPhotos` so
  `list()` needs no download.

### Scheduling and jobs

- **FR-10:** The trigger is evaluated on app launch and every 60 minutes while
  the app runs — nowhere else. A backup runs when enabled **and** at least 24h
  have passed since the last success **and** the fingerprint changed.
- **FR-11:** A manual "Kopia teraz" / `avc backup now` ignores the 24h rule and
  the fingerprint rule and always runs.
- **FR-12:** Missed days produce exactly **one** catch-up run at the next
  launch, never a queue of runs.
- **FR-13:** The backup job's `resourceKey` is `'backup'`. It is **admitted only
  when** no job of kind `process`, `process_drive`, `photo_scan`,
  `photo_process`, `photo_import_libra`, `faces_index`, `faces_recluster`,
  `faces_exemplars`, `materialize`, `thumbnails`, `gps_backfill` or
  `photo_gps_backfill` is queued or running, and while a backup or restore job
  is queued or running those kinds are refused with `conflict`. A scheduled
  backup blocked this way is **deferred** to the next hourly tick (reason
  `blocked-by-job`); a manual backup returns `conflict` immediately.
- **FR-14:** The snapshot phase additionally holds the store's `HomeLock` write
  lock for its whole duration, so no writer can interleave with an export.
- **FR-15:** Cancelling a backup deletes the staging directory and any partial
  remote object, and leaves `backup-state.json` untouched.

### Retention and restore

- **FR-16:** Retention keeps the newest `backup_keep_last` (default 7) **union**
  the newest backup of each of the last `backup_keep_weekly` (default 8) ISO
  weeks, per series. The last remaining backup of a series is never deleted.
- **FR-17:** Pruning runs after each successful upload only; a prune failure is
  reported as a warning and does not fail the backup.
- **FR-18:** Restore is refused (`restore_refused`, HTTP 423) while any job
  holds the catalog lock or any FR-13 kind is active, and refused
  (`snapshot_incompatible`) when the archive's schema versions exceed the
  running app's.
- **FR-19:** Restore always takes a local, unencrypted pre-restore copy of the
  current critical set into `~/.ai-video-cataloger/pre-restore/{timestamp}/`
  and verifies it before swapping a single file.

### Configuration and taxonomy

- **FR-20:** New config keys, all **app-global** (home scope,
  `~/.ai-video-cataloger/config.json`), added to `CONFIG_KEYS` and
  `APP_GLOBAL_CONFIG_KEYS`:

  | Key | Type | Default | Meaning |
  |---|---|---|---|
  | `backup_enabled` | boolean | `false` | master switch |
  | `backup_provider` | `google_oauth \| service_account` | `google_oauth` | which destination adapter |
  | `backup_include_optional` | boolean | `false` | also back up regenerable artifacts |
  | `backup_keep_last` | int 1–90 | `7` | retention: newest N |
  | `backup_keep_weekly` | int 0–52 | `8` | retention: one per week for X weeks |
  | `backup_folder_id` | string | `''` | remote folder id (both providers) |
  | `backup_shared_drive_id` | string | `''` | Shared Drive id (service account only) |
  | `backup_service_account_fingerprint` | string | `''` | `sha256:` + 12 hex, display/verification only |
  | `backup_account_email` | string | `''` | connected account, display only |

  Runtime state — `lastSuccessAt`, `lastFingerprint`, `lastErrorCode`,
  `lastArchiveName`, `lastRestoreAt` — lives in
  `~/.ai-video-cataloger/backup-state.json` (mode `0600`), **not** in
  `config.json`.

- **FR-21:** New `ErrorCode` members with their exhaustive mappings (existing
  exit codes stop at 46):

  | Code | HTTP | Exit | Legacy | Raised when |
  |---|---|---|---|---|
  | `backup_disabled` | 409 | 47 | `BACKUP_DISABLED` | any backup action while `backup_enabled: false` |
  | `backup_auth_required` | 401 | 48 | `BACKUP_AUTH_REQUIRED` | no/expired/revoked credentials for the destination |
  | `backup_destination_error` | 502 | 49 | `BACKUP_DESTINATION_ERROR` | Drive returned an error we cannot classify |
  | `backup_quota_exceeded` | 507 | 50 | `BACKUP_QUOTA_EXCEEDED` | Drive storage quota exhausted |
  | `backup_encryption_failed` | 500 | 51 | `BACKUP_ENCRYPTION_FAILED` | encrypt/decrypt failed, wrong key, bad auth tag |
  | `backup_integrity_failed` | 422 | 52 | `BACKUP_INTEGRITY_FAILED` | manifest hash mismatch, bad tar, failed `integrity_check` |
  | `restore_refused` | 423 | 53 | `RESTORE_REFUSED` | catalog lock held or a conflicting job is active |
  | `recovery_key_required` | 409 | 54 | `RECOVERY_KEY_REQUIRED` | the Keychain has no encryption key and the user has not supplied the recovery key |

  `backup_quota_exceeded` introduces HTTP 507 to this codebase; update the
  status-map test's allowed-status set accordingly.

- **FR-22:** Keychain items, service `com.ai-video-cataloger.app` (ADR-0007):
  `backup.encryption_key`, `backup.google.refresh_token`,
  `backup.service_account.key`. Nothing else. The OAuth **client id** and the
  non-confidential Desktop-client secret Google issues are build-time constants
  in the main process, never in the Keychain, never in the renderer bundle.

### Boundaries

- **FR-23:** All network I/O for this feature happens in the Electron main
  process / the in-process server. The renderer keeps its zero-networking CSP:
  no `fetch`, no `ipcRenderer`, no Google SDK in the renderer bundle. The
  renderer-bundle build in `check` fails if a Node builtin reaches the renderer
  graph, and a test asserts no `googleapis`-shaped module is in that graph.
- **FR-24:** Secrets never cross the contract into the renderer — not the
  encryption key, not the recovery key, not tokens, not the service-account
  JSON. The renderer receives fingerprints, e-mails and states only.
- **FR-25:** GUI and CLI call the **same** use-cases; no backup logic lives in
  `apps/desktop`, `apps/web` or `apps/cli` beyond composition and presentation.
- **FR-26:** No `any`, no `as` (except `as const`); zod-parse at every boundary
  including every Google API response; use-cases return `Result<T, AppError>`
  and nothing throws across a boundary.
- **FR-27:** Zero code comments except a non-obvious WHY (crypto framing
  rationale and the loopback-listener lifetime are the two expected WHYs).

## Non-Goals

- **NG-1:** Any cloud other than Google Drive (no Dropbox, iCloud, S3, WebDAV).
- **NG-2:** Per-file or continuous sync. This is a periodic whole-catalog
  archive, not a sync engine.
- **NG-3:** Backing up while the app is closed. **No launchd agent in v1.**
- **NG-4:** Sharing or restoring another person's backups; multi-user or team
  catalogs.
- **NG-5:** Shared Drive on the OAuth path. Shared Drives are the
  service-account path only.
- **NG-6:** Backing up the media files themselves.
- **NG-7:** Key escrow, key rotation, or server-side re-encryption. One key,
  generated once, recoverable only from the user's exported recovery key.
- **NG-8:** Google Picker, Drive folder browsing, or any UI that lists files the
  app did not create.
- **NG-9:** Partial/selective restore (e.g. photos only). Restore is
  whole-tier.
- **NG-10:** Backing up the spend ledger, whisper models or managed runtimes —
  all regenerable or re-downloadable.
- **NG-11:** Bandwidth throttling in v1 (see Open Questions).

## Design Considerations

- **DC-1: The feature must be invisible until wanted.** A user who never enables
  backup sees one extra section in Settings and nothing else — no indicator, no
  onboarding step, no wizard page, no toast.
- **DC-2: The indicator is furniture, not an announcement.** It lives in the
  bottom bar beside the Terminal controls, matches their size and their
  `grey.400` idle tone, and only becomes coloured (`warning.main`) when
  something failed. It never animates when idle. Hover reveals the last backup
  date; that is the whole idle affordance.
- **DC-3: Exactly one prompt, ever.** The enablement stepper is the only moment
  the app asks the user for anything about backup. Failures surface in the
  indicator and in Settings — never as a modal, never as a notification.
- **DC-4: The recovery key is a ceremony, on purpose.** It is exported to a file
  through the native save dialog, its fingerprint is shown, and the user must
  tick "I saved my recovery key" before "Finish" enables. This is the one place
  the design is deliberately slower than necessary.
- **DC-5: Advanced means hidden.** The service-account path sits behind a
  radio labelled "Service account (advanced)" with a one-line explanation and a
  link to the runbook. A normal user never reads the words "Shared Drive".
- **DC-6: Restore must feel safe.** The confirmation dialog names what will be
  overwritten and states that a local pre-restore copy is taken first. Failure
  copy always ends with "nothing on your Mac was changed" when that is true.
- **DC-7: Visual language only in `theme.ts`.** No inline colours, no new
  spacing constants outside the theme. PL and EN keys for every string; PL is
  the owner's primary language and gets a real translation, not a machine one.
- **DC-8: Phase labels are human.** "Preparing snapshot", "Compressing",
  "Encrypting", "Uploading 42%" — not `snapshotting`, not `phase 3/7`.

## Technical Considerations

- **TC-1: zstd over gzip, decided.** The pinned toolchain is Node 22.23.1
  (`.nvmrc`), whose `node:zlib` exposes `createZstdCompress` /
  `createZstdDecompress` natively (zstd landed in Node 22.15.0). zstd therefore
  adds **no** native dependency, no build step and no packaging risk, while
  compressing a SQLite catalog materially better and faster than gzip at
  comparable memory. The owner's gzip fallback is not exercised. Verify the
  symbol at composition time and fail closed with `internal` if a future Node
  drops it.
- **TC-2: No new npm dependency.** The ustar writer/reader is ~200 lines of
  deterministic TypeScript in `adapters/backup/tar.ts`; the Drive REST calls use
  `fetch`; JWT signing for the service account uses `node:crypto`. This avoids
  the `googleapis` dependency tree entirely and keeps `minimumReleaseAge` and
  `onlyBuiltDependencies` untouched. Tar stays the container so a decrypted
  archive is inspectable with the system `tar`.
- **TC-3: Consistent snapshot is the whole ballgame.** `catalog.db` and
  `photos.db` are sql.js databases persisted by `persistDatabase` as
  *write-temp → fsync → rename*, with up to 25 mutations batched in memory
  before a flush. A raw `cp` of `catalog.db` can therefore capture a file that
  is both stale (un-flushed mutations) and mid-rename. `snapshotTo` must take
  the `HomeLock` write lock, `flush()`, then `client.export()` into the staging
  directory using the same temp+fsync+rename sequence.
- **TC-4: Forward-only migrations.** `migrateGlobalCatalog` refuses a database
  whose `schema_meta` version exceeds `GLOBAL_CATALOG_SCHEMA_VERSION`, and
  `PHOTOS_SCHEMA_VERSION` behaves the same. That is why the manifest records
  both schema versions and why restore refuses a newer archive **before**
  downloading anything heavy. Restoring an *older* archive is fine: the normal
  migration path runs on first open after the swap.
- **TC-5: Job resourcing.** `JobsPort.enqueue` dedupes on `(kind, resourceKey)`
  and `acquireResource(key)` is the existing cross-job mutual-exclusion
  primitive (see `'faces-write'` in `process-drive.ts`). Backup uses
  `resourceKey: 'backup'` for dedupe **and** `acquireResource('catalog-write')`
  around its snapshot phase, and the FR-13 admission gate for the coarse
  guarantee that a backup and an analysis never run together.
- **TC-6: OAuth client type.** A **Desktop app** OAuth client with a loopback
  redirect (`http://127.0.0.1:{ephemeral}`) plus PKCE `S256` is Google's current
  recommendation for installed apps; the out-of-band (`urn:ietf:wg:oauth:2.0:oob`)
  flow is discontinued and must not be used. The system browser is used
  (`shell.openExternal`), never an embedded webview — an embedded webview is
  both against Google's policy and a security regression.
- **TC-7: `drive.file` semantics.** The scope grants access only to files the
  app created or the user explicitly opened with it. That is exactly what we
  need, and it means the app **cannot** enumerate or delete anything else in the
  user's Drive — including its own folder if the user moves the backups
  elsewhere. `list()` therefore queries by parent folder id **and** tolerates a
  missing folder by re-creating it and reporting the reset in the UI.
- **TC-8: Service accounts have no storage quota of their own.** A service
  account can only write into a **Shared Drive** (the drive's quota applies),
  which is why the advanced path requires a Shared Drive id and a *Content
  manager* membership. Writing to a user's My Drive with a service account is
  impossible without domain-wide delegation, which is out of scope by owner
  decision.
- **TC-9: Renderer stays zero-networking.** Loopback listener, browser launch,
  token exchange, Drive HTTP, crypto and filesystem work all live in the main
  process / server composition. The renderer only calls contract routes through
  bound actions.
- **TC-10: Contract routes** (all zod-parsed, CQRS-branded):
  `POST /api/backup/enable`, `POST /api/backup/disable`,
  `POST /api/backup/connect` (starts the OAuth flow / accepts the key JSON),
  `POST /api/backup/test`, `GET /api/backup/status`, `GET /api/backup/list`,
  `POST /api/backup/run` → `{ jobId }`, `POST /api/backup/restore` → `{ jobId }`,
  `POST /api/backup/recovery-key/export` (main process writes the file; returns
  fingerprint + path only), `POST /api/backup/recovery-key/confirm`.
- **TC-11: Tests never touch the network or a real keychain.** A local fake
  Google endpoint (Hono app in `test/fixtures/fake-google/`) backs every adapter
  test; `SecretsStore` is faked. Any scenario that could raise a macOS
  SecurityAgent dialog is forbidden in automated runs (keychain fixture hygiene,
  `CLAUDE.md`).
- **TC-12: Flake doctrine applies.** Uploads in tests are deterministic against
  the fake endpoint; no test sleeps waiting for a real network. A retry that
  turns a backup test green is a P1, not a rerun.
- **TC-13: SIL classification.** AI Video Cataloger is **SIL-1** (local
  product). The backup destination is the *user's own* Drive or the *user's own*
  company Shared Drive; the project holds no hosting tokens, no server-side
  credentials and no user data. No SIL-2/3 obligation is created by this feature.
  The OAuth client id belongs to a Google Cloud project the owner controls and
  is not a secret.
- **TC-14: Versioning.** Every merged PR in this feature bumps the patch
  version per the owner's versioning policy.

## Success Metrics

- **SM-1:** A non-technical user completes enablement (provider → connect →
  recovery key → first backup) in **under 3 minutes**, measured on the owner's
  own walkthrough, without opening a terminal.
- **SM-2:** A daily incremental-in-spirit run (critical tier, ~150 MB catalog)
  completes in **under 4 minutes** on a 20 Mbit upstream link, and the app stays
  responsive throughout (no renderer frame drop attributable to the job).
- **SM-3:** **Zero** plaintext bytes leave the machine: an automated test
  captures the uploaded stream and asserts that neither the SQLite magic
  (`SQLite format 3`), nor any known tag string from the fixture catalog, nor
  the string `manifest.json` appears in the uploaded bytes.
- **SM-4:** A **full restore rehearsal** (fresh HOME → restore → identical
  catalog) passes in `test:e2e:matrix` and is executed manually before every
  release that touches this feature.
- **SM-5:** Backup never blocks work: across a 30-run soak, zero backups
  overlapped an analysis job and zero analyses were refused because of a backup
  taking longer than 5 minutes.
- **SM-6:** For a user who never enables backup: zero network requests, zero
  Keychain items, zero new files on disk — asserted by a smoke leg.
- **SM-7:** Retention keeps the archive count at exactly `min(available, N ∪
  weekly)` across a simulated 6-month timeline, and never reaches zero.

## Open Questions

1. **Google OAuth app verification — "external" vs "internal".** If the OAuth
   client is published as an **external** app for public users, does Google
   require verification (and possibly a CASA security assessment) for the
   `drive.file` scope, or does `drive.file` stay in the non-sensitive tier that
   only needs the unverified-app screen? If verification is required, do we ship
   with the "unverified app" warning, restrict to Testing mode (100 users), or
   register the OAuth client as **internal** to the owner's Workspace and
   document a bring-your-own-client-id path for everyone else? This decision
   changes the enablement copy and possibly the runbook. **Owner decision
   needed before US-008 ships.**
2. **Bandwidth throttling.** Should the upload be rate-limited (a configurable
   ceiling, or an automatic backoff when the machine is on a metered/hotspot
   connection)? v1 currently uploads at full speed, which on a slow uplink could
   make a video call unpleasant for the duration. Options: no throttle (v1 as
   written), a fixed configurable KB/s cap, or "pause while on battery /
   metered".
3. **Keychain unavailable, especially headless CLI.** `SecretsStore` reports
   `unsupported` (non-darwin), `disabled`
   (`AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN=1`) or `unavailable` (locked keychain,
   `security` cannot run — e.g. an SSH session with no GUI login). What should
   `avc backup now` do then? Candidates: (a) fail with
   `keychain_unavailable`/`recovery_key_required` and stop — safest, breaks
   automation; (b) accept the recovery key from an environment variable
   (`AVC_BACKUP_RECOVERY_KEY`) for headless runs — enables cron-style use, puts
   key material in the environment; (c) fall back to the existing `0600`
   `credentials.json` file, consistent with how API keys already degrade, but
   weaker for an encryption key. **Owner decision needed before US-011 ships.**
4. Should the **optional** tier be size-capped (e.g. skip and warn above 20 GB)
   rather than uploading an arbitrarily large proxy set?
5. Should a **failed** backup be retried before the next hourly tick (e.g. one
   retry after 15 minutes), or is "try again in an hour" enough?
6. Should the app **detect and adopt** an existing `AI Video Cataloger Backups`
   folder created by the same account on another Mac (multi-machine, same
   Google account), or keep one folder per machine? Adoption makes restore
   across machines trivial but lets two machines prune each other's archives.

---

## Appendix — Owner setup runbook (for a non-developer)

This appendix is the one-time setup the **owner** (not the end user) performs.
Copy it to `docs/qa/backup-setup-runbook.md` in US-015 and keep the two in sync.
Everything below happens in a web browser. Nothing here requires a terminal.

### Part 1 — Provider (a): the Google sign-in path (what almost everyone uses)

You are creating the "app identity" that the sign-in window shows to users. You
do this once, for the whole app.

1. Open <https://console.cloud.google.com/> and sign in with the Google account
   that should own this app identity.
2. Top-left, click the project dropdown → **New project**. Name it
   `ai-video-cataloger` and click **Create**. Wait for the notification, then
   make sure the project selector shows `ai-video-cataloger`.
3. In the search bar type **Google Drive API**, open it, and click **Enable**.
   (This only says "this project is allowed to talk to Drive"; it grants no
   access to anyone's files.)
4. In the left menu go to **APIs & Services → OAuth consent screen**.
   - If your account belongs to a Google Workspace organisation, you can choose
     **Internal** — the simplest option, but then only people in your
     organisation can turn on backup.
   - Otherwise choose **External**. This is the path for public users. See
     Open Question 1 — the owner must confirm whether Google requires
     verification before we publish; while unverified, users will see a
     "Google hasn't verified this app" screen and must click *Advanced →
     Go to AI Video Cataloger*.
5. Fill in: **App name** `AI Video Cataloger`, **User support email** (yours),
   **Developer contact email** (yours). Skip the logo. Click **Save and
   continue**.
6. On the **Scopes** step click **Add or remove scopes**, search for
   `drive.file`, and tick exactly this one:
   `https://www.googleapis.com/auth/drive.file` — *"See, edit, create and delete
   only the specific Google Drive files you use with this app."*
   **Do not add any other Drive scope.** Save and continue.
7. On **Test users** (External only, while unverified) add the e-mail addresses
   that may use backup before publication — your own at minimum.
8. Left menu → **Credentials** → **Create credentials** → **OAuth client ID**.
   - **Application type: Desktop app** (this is important — it enables the
     loopback redirect the app uses).
   - Name it `AI Video Cataloger desktop`.
   - Click **Create**. You will see a **Client ID** and a **Client secret**.
9. Copy both into the developer handoff note. For a Desktop client, Google
   treats the secret as **not confidential** — it ships inside the app and is
   protected by PKCE instead. It is still not something to post publicly.
10. Done. The end user's experience is now: click **Connect Google Drive** in
    Settings → their normal browser opens → they pick their Google account →
    they see the one `drive.file` permission → they click Allow → the browser
    says "you can close this tab". The app then creates a folder called
    **AI Video Cataloger Backups** in their own Drive and uses only that folder.

**How a user turns backup off for good:** <https://myaccount.google.com/permissions>
→ **AI Video Cataloger** → **Remove access**. The app notices at the next run
and shows "reconnect needed". Their existing backup files stay in their Drive
until they delete the folder themselves.

### Part 2 — Provider (b): the service-account path (company Shared Drive)

Use this only when backups must land in a **company** Shared Drive without
anyone signing in. It requires a Google Workspace with Shared Drives.

1. In the same Cloud project: **IAM & Admin → Service accounts → Create service
   account**.
2. Name it `avc-backup`. Description: `Writes AI Video Cataloger backups`.
   Click **Create and continue**, then **Done** — **do not grant it any project
   role**; it needs none.
3. Open the new service account → **Keys** tab → **Add key → Create new key →
   JSON** → **Create**. A `.json` file downloads. **This file is a password.**
   Store it in the company password manager and delete it from Downloads once
   imported.
4. Copy the service account's e-mail address — it looks like
   `avc-backup@ai-video-cataloger.iam.gserviceaccount.com`.
5. Open <https://drive.google.com/> → **Shared drives** → open (or create) the
   Shared Drive that should hold the backups, e.g. `Company Backups`.
6. Inside it, create a folder named **`AI Video Cataloger Backups`**.
7. At the top of the Shared Drive click **Manage members** → paste the service
   account e-mail → set the role to **Content manager** → **Send**. (Content
   manager can add and delete files, which pruning requires. *Contributor* is
   not enough — it cannot delete.)
8. Get the Shared Drive id: open the Shared Drive and copy the last part of the
   browser address, `https://drive.google.com/drive/folders/<THIS-PART>`.
9. In the app: **Settings → Backup → Service account (advanced)** → paste the
   Shared Drive id → **Import key JSON** and select the file from step 3 →
   **Test connection**. A green result names the drive, the folder and the
   service account. A red result naming the role means step 7 was not applied
   to the *drive*, only to a folder.

**What is deliberately not done here:** no domain-wide delegation, no
organisation-wide admin consent, no access to anyone's personal My Drive. The
service account can see exactly one Shared Drive folder, and the archives it
writes there are encrypted — a Workspace admin browsing that folder sees only
opaque `.avcbak` files.

### Part 3 — What every user must not lose

At enablement the app writes a **recovery key** file and makes the user confirm
they saved it. Without that key — and without the original Mac's Keychain — the
backups are permanently unreadable. That is the point of the design, and it is
also the one way a user can genuinely lose their data. Say it plainly in
support: **the recovery key is the backup of the backup.**
