# ADR-0007: Provider API keys live in the macOS Keychain

Date: 2026-07-28 · Status: accepted (owner decision 2026-07-19) · Supersedes
the v1.1 simplification recorded in `tasks/prd-providers-onboarding.md`
("plain file, not Keychain — Keychain is a named later upgrade"). Refines
[architecture.md §Ports](../architecture.md#ports-complete-list-for-this-app)
`CredentialsStore`.

## Context

Provider API keys (`openai`, `gemini`, and every future `apiKeyRef`) were
written to `~/.ai-video-cataloger/credentials.json`, owner-only mode `0600`.
Mode `0600` protects against *other user accounts*, which a single-user Mac
does not have. It does not protect against what actually reads a home
directory on this machine: dependency install scripts, agent CLIs, backup and
cloud-sync clients, crash reporters, and any process the owner runs. A
plaintext key that pays per token is the one secret in this app with a direct
financial blast radius.

The macOS Keychain solves exactly that: encryption at rest keyed to the login
password, per-item ACLs, lock semantics owned by the OS, and no plaintext copy
on disk for a sync client to pick up.

## Decision

**1. The Keychain is the primary store; the JSON file is the fallback.**
`CredentialsStore` keeps its shape. `KeychainCredentialsStore` decorates the
existing `JsonCredentialsStore` and resolves keys from a `SecretsStore` port
first. Nothing above the port knows which backend answered.

**2. The adapter shells out to `/usr/bin/security`, no native module.**
`find-generic-password` / `add-generic-password` / `delete-generic-password`,
service `com.ai-video-cataloger.app`, account = the `apiKeyRef`. A native
binding (`keytar` and friends) would add a per-arch prebuilt binary to the
notarized bundle, a rebuild against every Electron ABI, and an install script
in a repo whose package manager refuses install scripts by default
([ADR-0006](0006-package-manager-pnpm.md)). `security` ships with macOS and
costs one `execFile`.

**3. Migration is lazy, idempotent, write-verified, and retried.** The first
credential access in a process migrates whatever `credentials.json` still holds,
and an incomplete pass is attempted again on the next access instead of being
remembered as done. Per
provider: write the Keychain, read it back, and only after the readback matches
remove that entry from the file. A failed write or a mismatched readback leaves
the file entry untouched, so the sequence is never lossy — worst case the key
stays where it already was and doctor keeps asking for the migration. When the
Keychain already holds the *same* value, the file copy is dead weight and is
removed without rewriting the Keychain. When the two disagree, the **file value
wins**: after this migration exists, a file entry can only be created by a
`set` that had to fall back, so it is the newer key — it is write-verified into
the Keychain, the file entry is removed, and the line is logged as a value
conflict. Until such a pending entry is promoted, `get` answers from the file,
because that is the newest value the app was given. Each resolved provider
appends one NDJSON line to
`~/.ai-video-cataloger/credentials-migration.ndjson` — provider id, direction,
outcome, timestamp, never the secret.

**4. A Keychain failure degrades to the file store per operation, it never
fails a run and it never locks the process out.** Availability is `darwin` +
not disabled + `security` runs at all; only the structural verdicts
(`unsupported`, `disabled`) are cached, an `unavailable` probe is retried on the
next access. Beyond the probe, every operation attempts the Keychain and falls
back to the file store on its own failure (locked keychain, no default keychain,
timeout — the adapter kills `security` after 10s), so a single transient failure
never makes the rest of the process blind to a key the Keychain still holds.
`degraded` is therefore a *report*, not a gate: the backend reads `degraded`
while the last Keychain operation failed or a plaintext entry is still waiting
to be migrated, and returns to `keychain` on its own once the Keychain answers
again — no relaunch. A write that fell back to the file marks the migration
pending, so the next successful Keychain access promotes it and removes the
plaintext copy. Analysis must not die because a keychain is locked.
`AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN=1` opts out explicitly (both
gates set it, so `check` and `smoke` never touch the developer's login
keychain); `AI_VIDEO_CATALOGER_KEYCHAIN=<path>` points the adapter at a
specific keychain file, which is how the empirical check runs against a
throwaway keychain instead of the login one.

**5. The backend is visible.** `doctor` (human and `--json`) names the backend
that holds credentials and its reason, warns when the Keychain was expected but
unreachable, and keeps warning for every key still sitting in plaintext.
`config set-credential --json` reports the backend it wrote to.

**6. Secrets stay out of everything observable.** No secret in an event, an
error message, a log line, or the migration audit — the house rule the gemini
adapter already lives by, extended to the Keychain path. The one unavoidable
exposure is documented below.

## Consequences

- `add-generic-password` takes the password as an argv element (`-w <secret>`),
  and the adapter always runs the absolute `/usr/bin/security`, never a `PATH`
  lookup. The secret is therefore briefly visible in this process's own argv.
  Accepted: the window is milliseconds and the observer would already need to be
  running as the same user, who can read the plaintext file this ADR removes.
  `security -i` (commands read from stdin, secret never in argv) was measured
  against a throwaway keychain on 2026-07-28 and rejected: the same failing
  `add-generic-password` exits **0** under `-i` while the argv form exits 45, and
  `-i` blocks indefinitely on a locked keychain. A write whose failure the
  adapter cannot see is a worse defect than the argv window.
- Deleting a credential removes it from both backends, so an old plaintext copy
  cannot resurrect a key the user believes is gone. That deletion is
  user-facing (`DELETE /api/credentials`, `config delete-credential`, the
  Settings **Forget key** action) and it answers with the backends it cleared
  and the ones that kept the key: a Keychain that refuses while the file was
  cleared is reported as a partial removal, never as a key that is gone.
- The fallback file is written through a per-write temporary name
  (`credentials.json.<pid>.<random>.tmp`) and an atomic `rename`, so overlapping
  writers can never truncate each other's temporary file or land a half-written
  `credentials.json` — the shared `.tmp` name that preceded this made every
  concurrent write but one fail on `rename`. What remains is a read-modify-write
  **lost update**: two writers that overlap on *different* providers both start
  from the same snapshot, and the later `rename` wins, so one of the two entries
  is dropped (the winning file is always valid, never corrupt). Locking the file
  is out of proportion for a store the user writes by hand, one key at a time,
  from a single app; the Keychain — the primary store — has no such window
  because `security` writes one item, not a document.
- Non-darwin platforms and explicit opt-outs keep the exact prior behavior:
  the `0600` JSON file. Nothing about the file store changed.
- Unit tests never reach a real keychain; they inject a fake command runner.

## Alternatives rejected

- **`keytar` / native N-API binding** — bundle weight, ABI rebuilds, install
  scripts; see decision 2.
- **Electron `safeStorage`** — main-process only. The CLI is a first-class
  entry point with no Electron around it, and `safeStorage` stores its master
  key in the Keychain anyway; this would be the same protection behind a door
  half the app cannot open.
- **Encrypting `credentials.json` with an app passphrase** — moves the problem
  to storing the passphrase, i.e. back to a plaintext file.
- **Keeping the plaintext file** — the status quo this ADR exists to end.
