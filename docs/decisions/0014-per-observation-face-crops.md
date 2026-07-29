# ADR-0014: Face crops belong to observations, exemplars are chosen at read time

Date: 2026-07-29 · Status: accepted · Refines [ADR-0012](0012-face-clustering-symmetry-and-recluster.md)

## Context

Field evidence from a real-world catalog showed many observations but only a handful of
stored crops, all attached to one over-merged identity. Rebuilding that identity produced
many distinct people, including the dominant subjects of the source material, but left
nearly all of them without an exemplar. The existing crops had been written at index time
for the one identity that existed then; the rebuilt identities inherited no photographed
observation, so the GUI showed nameless, photo-less rows that a human could not recognise,
name or merge.

Crops were a **person-scoped, index-time** artifact (`crop_path` written only when an
observation is assigned at index time and only while the person still has fewer than
`FACE_LIMITS.maxExemplarsPerPerson` crops); identity is a **derived, rebuildable**
property. Recluster re-derives identity and by design (ADR-0012,
`FacesReclusterDeps` has no `media`/`faceEngine`) cannot cut a single pixel. ADR-0012
accepted this and only reported `personsWithoutExemplar` — the field data shows the
report is not enough.

## Decision

Crops are written for every quality-passing detection at index time, keyed by
observation (`faces/obs/<fingerprint>/<frame>-<detection>.jpg`), independent of any
person; exemplar choice (≤5 per person, ≤1 per file, best quality first) moves into the
pure `selectExemplars`, so cross-file diversity is a property of the *view* and survives
every rebuild by construction. Recluster is unchanged and keeps its compile-time
no-media guarantee. `faces exemplars [--dry-run] [--limit]` repairs catalogs indexed
before this ADR (and crops deleted off disk) by decoding each missing observation's own
frame, re-detecting it, and cutting the crop — guarded by an IoU check
(`EXEMPLAR_BBOX_MIN_IOU = 0.5`) against the stored box so a drifted detection is skipped
rather than shown as the wrong face. `FACE_ENGINE_VERSION` stays 2.

## Alternatives rejected

- **Bump `FACE_ENGINE_VERSION` to 3 so `faces index` re-crops the catalog.** Purges every
  observation (`listFaceIndexCandidates` + `deleteFaceObservationsForFile`) and pays the
  full re-extraction plus re-embedding. Same reasoning as ADR-0012 §"engine
  version". The version stays 2 and a test pins it.
- **Let recluster write crops (chain extraction into it).** Destroys the W12
  compile-time guarantee (`FacesReclusterDeps = Pick<FacesDeps, 'config' | 'fs' |
  'globalCatalog'>`) that makes "recluster never touches media" a type error rather than
  a promise, and makes the fast rebuild an hour-long job.
- **`faces recluster --with-exemplars` chaining the backfill.** Keeps the type
  separation but hides an hour-long media pass behind a command whose whole selling
  point is that it is instant and offline-safe. Instead: recluster's human line ends
  with a hint when `personsWithoutExemplar > 0`, and the owner chooses. No chaining
  anywhere — not from `recluster`, not from `process-drive`.
- **Keep person-scoped crop directories and *move* files on recluster.** Renaming
  many JPEGs per rebuild to preserve a naming convention nobody reads; crop paths are
  absolute in the DB, so moving them is pure risk for zero information.
- **Backfill by re-extracting 6 frames per file with `media.extractFrames`** (zero port
  change). Costs 6 ffmpeg seeks per file where 1–2 frames are needed → ~3–6× the wall
  time on a representative catalog, plus temp-file churn. Rejected in favour of widening `align`
  to accept a `FaceFrameInput`, which needs one decode per needed frame.

## Consequences

Index pays one JPEG encode and a small amount of disk per observation and in exchange loses the deferred crop
machinery (`nextCropPath`, `shouldStoreExemplar`, `ObservationContext`,
`persistedContext`, `releaseCropPixels`) and holds aligned pixels for one detection
instead of one file. Legacy person-scoped crop files stay valid and are never migrated,
so a pre-ADR catalog carries both layouts. `AlignedFaceCrop` now names its source frame
(`frame: FaceFrameInput`) instead of assuming a JPEG on disk, which is what lets the
repair pass decode one frame per crop instead of six. No `ErrorCode`, HTTP status, exit
code or progress step is added.
