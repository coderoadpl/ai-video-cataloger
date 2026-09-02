# ADR-0019: Google Drive backup archive format and authorization scope

Date: 2026-09-03 - Status: accepted

## Context

The backup feature needs one archive format that works for both Google Drive
destinations, survives interrupted uploads and restores, and can be understood
years later without relying on renderer state. It also needs a Drive permission
model that keeps the Google-account path limited to files this app creates.

The PRD selected compressed, encrypted archives and called out the OAuth
`drive.file` scope. The implementation now has enough detail to record the
wire format and the provider boundary as an ADR.

## Decision

1. A backup archive is a tar stream of the selected backup scope, compressed by
   the native `zstd` command and then written through the backup envelope.
2. The backup envelope is framed AES-256-GCM. Format version 2 derives a
   per-archive subkey from the 256-bit recovery key with a random 16-byte salt
   and `HKDF-SHA256`; each encrypted frame uses a 4-byte random nonce prefix
   plus a monotonically increasing frame counter.
3. The manifest is inside the encrypted archive and its key fingerprint is also
   copied into Drive `appProperties`, so list and retention operations can
   identify archives written for the current recovery key without decrypting
   every file.
4. The desktop OAuth destination uses Google Drive `drive.file` only. It creates
   or reuses the app backup folder visible to this app, and it does not support
   Shared Drive folder management on the OAuth path.
5. Shared Drive backups use the service-account destination. That path verifies
   the service account has an organizer or content-manager style role on the
   configured Shared Drive folder before enablement succeeds.

## Consequences

- Restores stream the archive through the same zstd and envelope readers; they
  do not depend on a separate plain-text index.
- Retention can skip archives encrypted with another recovery key and therefore
  cannot delete a previous Mac's unreadable backups after a reinstall.
- OAuth builds require `AVC_GOOGLE_OAUTH_CLIENT_ID` and
  `AVC_GOOGLE_OAUTH_CLIENT_SECRET` at packaging time. A build without them can
  still run, but the Google-account backup destination is unavailable.
- Tests and walkthroughs can point `AVC_GOOGLE_DRIVE_BASE_URL` and
  `AVC_GOOGLE_UPLOAD_BASE_URL` at the fake Drive endpoint while preserving the
  production archive and authorization decisions.
