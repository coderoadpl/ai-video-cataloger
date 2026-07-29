# ADR-0011: A completed drive run indexes its own faces

Date: 2026-08-04 · Status: accepted · Refines
[architecture.md Delta 5](../architecture.md#delta-5--long-running-work) and the
`FaceEnginePort` entry in
[architecture.md §Ports](../architecture.md#ports-complete-list-for-this-app).

## Context

`faces_enabled=true` reads as "faces on for the run", but it only gated the standalone
`faces index <root>` command and the doctor row: `process_drive` never called it. In a
real-world catalog, many analysed files with `faces_enabled=true` still left
`face_index_state` and `face_observations` empty — the stated intent, "faces ON
should just produce faces", was silently unmet by the main product path.

## Decision

A **completed** `process_drive` run indexes faces over its own root as its last step,
inside the same job, using the same `faces index` use-case the standalone command runs.
The pass is reported through the existing NDJSON progress steps and a new `faces` block
in `run-summary`. A new `--skip-faces` flag opts a single run out; the standalone
`faces index <root>` command is unchanged.

The pass never fails a drive run. A missing model, an unavailable engine, `--skip-faces`,
a cancelled job, or a failing pass produces a `faces_pass_skipped` event and a `faces`
block naming the reason — the run's analysis result still stands.

## Alternatives rejected

- **(a) Inline per-file extraction inside `processVideoPipeline`.** Face identity is
  catalog-global by construction: `indexDetection` classifies every embedding against
  `globalCatalog.listPeople()` — every person in the index, not the folder — and
  `runFacesIndex` seeds its working set from `listUnassignedFaceObservations()`, which is
  global too. A per-file step would either cluster against a partial world (wrong
  answers) or still need a second global pass at the end (no simplification).
- **(b) Document the two-pass reality and leave `process_drive` alone.** This keeps the
  observed failure: `faces_enabled=true` still produces no faces by default, and
  documentation alone leaves the main product path lying about what "faces on" does.

## Consequences

- A drive run with faces on costs an extra ~6-frame extraction per newly analysed video
  — the same cost as running `faces index` by hand today; `--skip-faces` is the escape
  hatch for a run that cannot afford it.
- The pass reuses `listFaceIndexCandidates(root)`, which selects catalog files at or
  below the root with a selected analysis and a stale-or-absent `face_index_state`. It is
  therefore idempotent and resumable by construction — re-running it, or running it after
  an earlier drive run over the same root, only indexes what is still outstanding.
- Faces stay out of folder snapshots and out of every export path
  ([ADR-0002 §e](0002-global-catalog-layer.md)); this change does not add face data to
  the snapshot writer, and `scripts/doc-lint.ts` asserts that in both directions.
- Nothing is written into the source folder: frames land in
  `fs.tempDirectory()/ai-video-cataloger/faces/<fingerprint>` and exemplar crops under
  `~/.ai-video-cataloger/faces/<personId>/`, so read-only sources
  ([ADR-0002 §f](0002-global-catalog-layer.md)) index normally. The candidate loop also
  now deletes its own per-file temp frame directory once a file's observations are
  stored, best effort — a manual, occasional command's tmp residue becomes a routine
  outcome once every faces-on drive run produces it.
- The pass needs no `JobsPort`: it runs inline inside `process_drive`, under the same
  catalog write lock the drive job already holds
  (`withCatalogWriteLockForJob`, `apps/server/src/app.ts`), instead of contending with it
  as a second job would.
- The drive-run NDJSON contract gains three typed events
  (`faces_scanning`, `faces_done`, `faces_pass_skipped`) and a `faces` block in
  `run-summary` (`ran`, `skippedReason`, `filesIndexed`, `observationsAdded`,
  `peopleCreated`, `error`); no `ErrorCode`, HTTP status, or CLI exit code changes — the
  faces pass never turns into a drive-run error, and `faces_disabled` (409 / exit 41)
  keeps its current meaning for the standalone command only.
- Runs that end before the final pass — the consecutive-failure abort, the Gemini budget
  pause, a failed batch job — skip the faces pass entirely; `state.faces` stays absent
  from the summary. Those runs are meant to be resumed, and the resumed run indexes
  everything its predecessors analysed.
- `faces_enabled` stays home-scoped and is resolved once per run, at the root — a
  per-folder override cannot poison it.
- `doctor` needs no change: its faces dependency row and its
  "Run: ai-video-cataloger models faces install" warning stay true under this decision.
