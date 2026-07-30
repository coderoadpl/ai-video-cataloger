# ADR-0016: Photo cataloging foundations — separate DB, shared identity, home-root artifacts

Date: 2026-07-30 · Status: accepted

## Context

Wave 1 of the photos feature (see
[docs/architecture-photos.md](../architecture-photos.md) and
`tasks/prd-photos.md`) lays the foundation every later wave builds on:
scanning a photo folder tree, fingerprinting content, extracting EXIF, and
storing the result durably. Several structural decisions had to be made
before any of that code could be written.

## Decision

- **A separate `~/.ai-video-cataloger/photos.db`**, on the same drizzle-over-sql.js
  driver stack as `catalog.db`, rather than nullable-everything video tables.
  Persistence is batch-checkpointed (500 files per persist) instead of the
  video catalog's per-25-mutation auto-flush, because a 50k-photo scan would
  otherwise perform thousands of full-database rewrites.
- **`ph_` + first 16 hex of a full-content SHA-256** as the photo fingerprint.
  Photos are read in full anyway for EXIF, and a full-content hash removes
  the one real collision risk video's partial hash doesn't have: burst-mode
  RAWs sharing near-identical headers and sizes. The `ph_` prefix keeps photo
  fingerprints self-evidently distinct from unprefixed video fingerprints in
  every shared surface (NDJSON events, the faces identity store).
- **Photo artifacts (Wave 2+) live under one home-root, fingerprint-addressed
  directory** (`~/.ai-video-cataloger/photo-artifacts/`), a deliberate
  deviation from ADR-0002's per-folder sidecar convention: the `media://`
  scope only ever needs one additional static root, duplicate photos across
  folders never duplicate their proxy, and Wave 1 writes nothing under any
  photo folder at all — a read-only-root probe enforces this from day one.
- **A shared `HomeLock`** (`adapters/db/home-lock.ts`), extracted from
  `SqlJsGlobalCatalogStore`'s previously-private, per-instance lock methods:
  one process-wide lock owner with a single lease counter, injected into both
  `SqlJsGlobalCatalogStore` and `SqlJsPhotosStore`. Two stores sharing one
  lock file with independent per-instance lease counts was a confirmed
  corruption path once a second store existed in the same process.
- **`catalog.db` schema V11** adds a single `media` column
  (`face_observations.media`, default `'video'`) — a one-statement migration,
  no table rebuild, no FK change (the existing `files(fingerprint)` FK on
  `face_observations` is already inert text; `PRAGMA foreign_keys` has never
  been enabled in this codebase). It ships in Wave 1, ahead of any photo face
  detection, so the riskiest schema change lands first and smallest, with its
  own lossless-migration probe.
- **No new `ErrorCode` members.** Photos reuse the existing taxonomy
  (`not_a_directory`, `folder_not_found`, `read_error`, `catalog_locked`,
  `internal`); photo-specific detail lives in NDJSON progress-step names
  (`photo-file`, `photo-file-skipped`, `photo-exif-failed`,
  `photo-run-summary`), not in the three exhaustive public-contract maps.
- **One config namespace.** Photos read the same `ConfigKey` values already
  resolved for video (analyzer family, provider, model, languages);
  per-media provider overrides are deferred.

## Consequences

- Every wave after this one composes on top of an already-shared lock, an
  already-migrated `catalog.db`, and an already-indexed `photos.db` — Wave 2
  (proxies, browse) adds exactly one new `media://` root and no new lock or
  migration mechanics.
- `jobResultSchema`'s union has no shared discriminator across its twelve
  pre-existing members, so every photo job result schema carries a required
  `media: z.literal('photo')` literal and is placed ahead of the loosest
  absorbing candidates in the union — verified by a round-trip/rejection
  test — rather than migrating the whole union to a `z.discriminatedUnion`
  and touching every existing job's public envelope shape.

See [docs/architecture-photos.md](../architecture-photos.md) for the full
schema, the duplicate-ownership rules, and the wave plan.
