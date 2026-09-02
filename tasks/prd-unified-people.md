# Unified people: faces across photos and videos — phased plan F1–F5

Decision record: [ADR-0017](../docs/decisions/0017-unified-people.md).
Design: [docs/architecture-photos.md](../docs/architecture-photos.md) §5a,
[docs/architecture.md](../docs/architecture.md) Delta 5.
Target release: **v0.6.25**.

Every phase is its own PR and its own version bump (repo versioning policy:
no two differing builds share a version string). Every phase is **RED-first**:
the test that names the defect is written and observed failing before the code
that fixes it exists. Every phase ends on `pnpm run check` **and**
`pnpm run smoke` green.

---

## The exact list of video-only code sites

These are the sites this plan changes. Line numbers are as of `940dce3`.

| # | Site | Today | Phase |
|---|---|---|---|
| 1 | `adapters/db/global-catalog.ts:1126` `listFaceIndexCandidates` | walks `folders`/`files`; photos can never be candidates | F1 (left alone — the photo leg uses `listPhotoFaceIndexCandidates` instead) |
| 2 | `core/server/ports.ts:660` / `adapters/db/photos-store.ts:375` `listPhotoFaceIndexCandidates` | correct, tested, **called by nothing** | F1 (gains its caller) |
| 3 | `adapters/db/photos-store.ts:398` | skips any photo whose `photo_face_index_state.engine_version >= FACE_ENGINE_VERSION` — i.e. every photo an import pre-marked complete | F1 (unchanged code; the migration clears the rows) |
| 4 | `core/server/usecases/faces.ts:454` `runFacesIndexPass` | video candidate loop only | F1 (gains a photo leg) |
| 5 | `core/server/usecases/faces.ts:574` `indexCandidate` | `fs.join(folder.currentPath, file.fileName)` + `media.extractFrames` + `media.probe` | F1 (a sibling `indexPhotoCandidate` over the proxy) |
| 6 | `core/server/usecases/faces.ts:852` `indexDetection` | `media: FaceObservation['media'] = 'video'` default is the only value ever passed | F1 (photo leg passes `'photo'`; the default is deleted so the argument is explicit) |
| 7 | `core/server/usecases/faces.ts:644` `runFacesExemplarsPass` | resolves via `listAnalyzedFileLocations` and re-detects `{ kind: 'video-timestamp' }`; `ph_` fingerprints become `filesUnavailable` | F3 |
| 8 | `adapters/db/global-catalog.ts:1325` `faceStatus` | `staleVersionFiles` reads the video-only `face_index_state`; `filesIndexed` silently unions both media | F1 |
| 9 | `adapters/db/global-catalog.ts:2191` collection person filter | `EXISTS (… face_observations o WHERE o.fingerprint = f.fingerprint …)` joined against `files` | F3 |
| 10 | `core/server/usecases/collection.ts:163` `photoUnsupportedFiltersActive` | a non-empty `people` filter disables the entire photo leg of the feed | F3 |
| 11 | `adapters/db/global-catalog.ts:830` `listLibraryFacets` | counts people over all observations incl. photos — a promise #9/#10 refuse to keep | F3 (becomes honest once #9/#10 land; add the pinning test) |
| 12 | `core/server/usecases/photos.ts:999` `photosDetail` / `PhotosDetailOutput` | no `people` field | F3 |
| 13 | `core/server/usecases/search.ts:293` | `listPeopleForFile` called only for video detail | F3 (reference; the photos counterpart mirrors it) |
| 14 | `core/domain/faces.ts:15` `FACE_CLUSTERING`, `:261` `classifyFace`, `:284` `findNewClusterSeed`, `:335` `clusterFaceObservations` | greedy centroid assignment, order-dependent, no merging | F2 |
| 15 | `apps/web/src/features/people/PeopleView.tsx` | no media chips, no per-medium counts, no recluster action, person card shows crops only | F3 |
| 16 | `core/contract/routes.ts:2028` `facesStatusOutputSchema` | no per-medium counters | F1 (additive fields only) |
| 17 | `docs/architecture-photos.md` §5 | claimed unified indexing that does not exist | **F0 (this PR)** |

---

## F1 — Native photo face indexing, completion state, counters

**Goal.** A photo root can be face-indexed, producing observations with native
geometry and crops; photo observations that arrived through an import without
crops are gone.

**Scope.**

- `catalog.db` **V16** + `photos.db` **v6** migration: dump every
  `face_observations` row with `media='photo'` to
  `~/.ai-video-cataloger/backups/face-observations-photo-libra-<timestamp>.ndjson`,
  delete those rows, delete their `photo_face_index_state` rows. One-shot and
  version-gated; `FACE_ENGINE_VERSION` stays 2.
- A photo leg in the faces index pass: candidates from
  `listPhotoFaceIndexCandidates(root)`, detection over
  `photo-artifacts/proxies/<fingerprint>.jpg` via `{ kind: 'image-path' }`,
  obsIds `<ph_fingerprint>:face:1:<n>`, crops under `faces/obs/ph_<hex>/`,
  proxy dimensions recorded, `completePhotoFaceIndex` on every photo the
  detector actually ran over (including zero-face photos), `resourceKey:
  'faces-write'`.
- `photos process` auto-chains the photo faces leg best-effort (ADR-0011
  semantics: skip event, never a failed run).
- New NDJSON steps for the photo leg only; **no new `ErrorCode`, HTTP status
  or exit code.**
- `facesStatus` gains additive `videosIndexed`, `photosIndexed`,
  `stalePhotoFiles`; existing fields keep their meaning.

**RED-first tests.**

1. Migration probe: seed a catalog at V15 holding `media='photo'` rows plus
   `photo_face_index_state` rows; assert post-migration that the rows are
   gone, the backup file exists and round-trips, video rows and crops are
   untouched, and every other table is byte-identical (lossless-migration
   probe, ADR-0016 D3 precedent).
2. `listPhotoFaceIndexCandidates` returns the previously-completed photos
   again after the migration.
3. Photo indexing use-case test with a fake `FaceEnginePort`: asserts
   `media: 'photo'`, obsId frame index 1, a written crop path under
   `faces/obs/ph_…/`, recorded proxy dimensions, and `completePhotoFaceIndex`
   called for a photo where the detector found **zero** faces.
4. `indexDetection` loses its `'video'` default — a compile-level RED: the
   video call site must name `'video'` explicitly.
5. `facesStatus` per-medium counters over a mixed pool.
6. Smoke leg: `avc faces index <photo root>` against the in-process app,
   asserting the envelope shape and exit code.

**Changelog (`[Unreleased]` → Added / Changed).** "`faces index` and
`photos process` now detect faces in photos themselves, over the photo proxy,
writing one crop per observation like the video pass; photo face observations
that arrived through `photos import-libra` are dropped on first open (backed
up under `~/.ai-video-cataloger/backups/`) because they carry no crops and
foreign geometry" + "`GET /api/faces/status` reports `videosIndexed`,
`photosIndexed` and `stalePhotoFiles` alongside the existing counters".

**Exit criteria.** `check` + `smoke` green; a real photo root indexes end to
end with crops on disk.

---

## F2 — Agglomerative clustering + calibration benchmark

**Goal.** Replace the greedy rebuild with a deterministic, calibrated one.

**Scope.**

- `core/domain/faces.ts`: `clusterFaceObservations` becomes agglomerative
  average-linkage over cosine similarity on a sparse neighbour graph (edges at
  cosine ≥ `reviewBandMin`, non-edges scored 0), cut at a new calibrated
  `FACE_CLUSTERING.clusterCutSimilarity`. Deterministic: input sorted by
  `obsId`, every tie broken on the smallest member `obsId`. Pure domain code,
  no I/O, no ports.
- `classifyFace` (incremental assignment) is **unchanged**. `findNewClusterSeed`
  is deleted only if the rebuild subsumes it; if the incremental path still
  needs seeding, it keeps it and the ADR-0012 symmetry invariant stands.
- `scripts/faces-benchmark.ts` (TypeScript, run the way the repo's other
  scripts are): sweeps the cut threshold and reports **purity, completeness,
  pairwise F1, cluster-count and wall-clock** per threshold.
  - *fixture mode* (default, deterministic): synthetic embeddings under
    `scripts/__fixtures__/faces-benchmark/`, exercised by unit tests so the
    metric implementations themselves are gated by `check`.
  - *real-data mode* (`--corpus <dir> --catalog <path>`): reads a
    user-supplied reference partition (per-observation records with
    embeddings, an observation → identity assignment map, and the cluster
    list) plus the app's own native observations, matches reference
    observation → native observation by photo (source content hash → `ph_`
    fingerprint) **and** bbox IoU ≥ `EXEMPLAR_BBOX_MIN_IOU`, and reports
    unmatched counts on both sides honestly. Never in `check`, never in
    `smoke`. The corpus directory is supplied by the operator and lives
    outside the repo.
  - also emits a stratified same/different pair sample (equal counts per 0.02
    band across 0.30–0.70) for the user to label, and scores a candidate
    threshold against the returned labels.
- The chosen threshold is written into `FACE_CLUSTERING` with the measured
  numbers quoted in the phase's PR; it sits **at or above** the pairwise-F1
  optimum against the reference partition, and it must admit **zero**
  user-labelled different-person pairs into one cluster. If the two criteria
  disagree, the user-labelled criterion wins.

**RED-first tests.**

1. Determinism: the same observations in shuffled input order produce
   identical person ids and membership. (RED against today's greedy assigner,
   which is order-dependent — this test is the proof the algorithm changed.)
2. Two well-separated synthetic identities never merge at the chosen
   threshold; one identity with a bridging mid-similarity observation does not
   chain two people together (average linkage vs single linkage).
3. Non-edge-as-zero: a pair below `reviewBandMin` contributes 0 and cannot
   raise a cluster's average linkage.
4. Benchmark metric unit tests over fixtures with a hand-computed purity,
   completeness and pairwise F1.
5. Scale guard: a synthetic pool of tens of thousands of observations clusters
   within the declared time budget, with the sparse edge pass never
   materializing the full matrix (assert peak allocation shape, not wall
   time, so the test is not a flake).

**Changelog (Changed).** "Face identity rebuild (`faces recluster`) now uses
deterministic agglomerative average-linkage clustering over the stored
embeddings instead of order-dependent greedy centroid assignment; the cut
threshold is calibrated against a real photo corpus and biased towards
splitting a person rather than merging two (ADR-0017)."

**Exit criteria.** `check` + `smoke` green; benchmark report attached to the
PR; wall-clock for a full rebuild at catalog scale recorded. If it exceeds ten
minutes, the sanctioned fallback is a random-projection banding prefilter —
never a lower `reviewBandMin`.

---

## F3 — UI and the media-agnostic people surfaces

**Goal.** Osoby and Kolekcja tell one consistent story about people.

**Scope.**

- **Osoby media chips**: Wszystko / Filmy / Zdjęcia, same wording, order,
  count-suffix format and toggle semantics as
  `apps/web/src/features/library/FilterBar.tsx:271`; the chip narrows the
  person list and the per-person counts.
- **Person card** lists photos and videos together, each with its medium
  visible; exemplar crops may come from either medium.
- **Person filter works for photos**: `adapters/db/global-catalog.ts:2191`
  gains a photos counterpart in `PhotosStore` and
  `core/server/usecases/collection.ts:163` stops treating `people` as a
  photo-disabling filter. `place` / `hasGps` stay as they are — this phase
  fixes people only, and says so.
- **People in photo detail**: `PhotosDetailOutput` gains `people`, sourced the
  same way `core/server/usecases/search.ts:293` sources it for video.
- **`faces exemplars` covers both media**: a `ph_` fingerprint resolves to its
  proxy and re-detects with `{ kind: 'image-path' }` instead of counting as
  `filesUnavailable`.
- **Recluster from Osoby** (ADR-0017 D5): a destructive-action affordance that
  runs `--dry-run` first, shows the report (people before/after, observations
  reassigned, largest clusters, `personsWithoutExemplar`, `namesDropped`), and
  only then offers the real run. Names are **not** recovered; the dialog says
  so before the user confirms.
- Polish and English dictionary entries for every new string; no raw colors,
  no MUI skeletons outside `components/layout`, island boundaries respected.

**RED-first tests.**

1. Collection test: a person filter with `media=all` returns photo rows.
   (RED against today's silent photo drop.)
2. Facet consistency test: for every person the Osoby facet counts, the person
   filter returns at least that many items across both media — the exact
   contradiction #11 encodes today.
3. Photo detail returns `people` for a photo with an assigned observation.
4. `faces exemplars` writes a crop for a photo observation and reports
   `filesUnavailable: 0` for a healthy photo.
5. Renderer tests: chips render with server counts, chip selection narrows the
   list, recluster dialog requires the dry-run report before enabling the
   destructive confirm.
6. `pnpm run visual` baselines updated as the sanctioned two-step commit
   (land the change, then `pnpm run visual --update-snapshots`, review and
   commit the PNGs).

**Changelog (Added / Fixed).** "Osoby has Wszystko / Filmy / Zdjęcia chips and
person cards list photos and videos together" · "Filtering Kolekcja by a
person no longer hides every photo, so the person counts in the facet and the
results now agree" · "Photo detail shows the people detected in the photo" ·
"`faces exemplars` repairs photo crops from the photo proxy instead of
reporting the photo as unavailable" · "A full identity rebuild can be started
from Osoby, dry run first; it drops all names by design".

---

## F4 — Migration run order on an existing catalog

**Goal.** Move an existing catalog onto the new pipeline, once, in the only
order that is safe. This is an operational procedure, not a code change; it
adds no changelog line.

1. Install the F1–F3 build. First open runs the V16 / v6 migration; confirm
   the backup file exists and round-trips, and that the `media='photo'`
   observation count drops to zero.
2. `avc faces index <photo root>` (or Analiza → Zdjęcia). Watch
   `photosIndexed` climb. A catalog whose photos and videos live under
   different roots needs one run per root (see risk 6).
3. `scripts/faces-benchmark.ts` in real-data mode over the freshly-indexed
   catalog, pointed at the operator's reference-partition directory outside
   the repo; the operator labels the emitted pair sample; the report picks the
   cut.
4. `faces recluster --dry-run` from Osoby; read people-before/after, largest
   clusters and `personsWithoutExemplar`.
5. `faces recluster` for real. Every person id is re-minted; every name is
   gone.
6. Rename the people that matter from the person cards.

**Never** `faces purge` at any point: it destroys embeddings and leaves
completion state stale, so the next pass believes the work is done.

**Rollback at each step** is ADR-0017's rollback section; the only
non-revertible step is 1, which is why it writes the backup first.

---

## F5 — Gates, review, release v0.6.25

- `pnpm run check` and `pnpm run smoke` green on the release commit.
- `pnpm run test:e2e:matrix` (real-provider suite, unsandboxed shell) with the
  photo faces legs exercised.
- `pnpm run verify:package` on the built bundle.
- `pnpm run qa:walkthrough` over the packaged app plus the screenshot review
  in [docs/qa/release-walkthrough.md](../docs/qa/release-walkthrough.md);
  the walkthrough gains an Osoby step that exercises the media chips.
- UI review of Osoby: chips, person card density, the recluster
  destructive-action dialog and its Polish copy.
- Version bump to **0.6.25**; the release commit moves the `[Unreleased]`
  entries under the version heading and adds the commit links.

---

## Open risks

1. **A reference partition may be machine-made.** If the partition a user
   supplies is another clusterer's output with only a few manual corrections,
   maximising agreement with it selects for the algorithm being replaced.
   *Mitigation:* the user-labelled pair sample is the deciding criterion
   (ADR-0017 D4); the reference partition is reported as agreement, not as
   accuracy.
2. **Native detection will not reproduce an imported observation set.**
   Different proxies, different alignment, possibly different detector recall
   on the same photo. The IoU matcher will leave unmatched observations on
   both sides; the benchmark must report them rather than silently dropping
   them, or the metrics are computed on a biased subset.
3. **Rebuild cost at catalog scale.** Tens of thousands of observations mean
   the sparse edge pass dominates. The ten-minute budget and the banding
   fallback are declared in F2; if both miss, the phase stops and the decision
   goes back to the user, rather than the threshold being relaxed to make it
   fast.
4. **Every person id changes and every name is dropped.** Cheap on a catalog
   with few names, expensive on one where many people have been named. A
   durable name anchor (a name pinned to an observation, not to a person id)
   is the obvious follow-up and is deliberately **out of scope** here.
5. **Photo proxies are the detection substrate.** A photo whose proxy failed
   (`proxy_state != 'done'`) is invisible to the faces pass, exactly as
   `listPhotoFaceIndexCandidates` already filters. That is correct, and it
   means proxy failures now cost faces too.
6. **`faces index` scoping.** `facesIndexInputSchema` takes one `root`; a
   catalog whose photos and videos live under different roots needs two runs.
   Not changed here; called out so it is not discovered as a bug.
7. **The migration is not revertible by the app.** Only by hand, from the
   NDJSON dump. Accepted: the rows it deletes are the ones ADR-0017 D2
   establishes are unusable.

---

## Parity and changelog notes

- **Parity.** Faces are a post-parity capability: `tasks/parity-inventory.md`
  contains no faces section and the old app had none. Nothing in F1–F5 touches
  the NDJSON event grammar for existing steps, the exit-code taxonomy, the
  on-disk layout of video artifacts or the four sanctioned deviations in
  [tasks/prd-foundation-rewrite.md](prd-foundation-rewrite.md)'s Technical
  Considerations. New NDJSON steps for the photo faces leg are additive, per
  the ADR-0016 §7 precedent that photo specificity lives in step names rather
  than in the closed `ErrorCode` union.
- **Changelog.** Each of F1–F3 lands its own `[Unreleased]` lines, quoted
  above, **in the same commit** as the behaviour they describe. F4 is an
  operational procedure and adds no line. F5's release commit moves the
  accumulated entries under `## [0.6.25]` and adds the commit links. This F0
  documentation PR adds no `CHANGELOG.md` line: the repo rule scopes changelog
  entries to behaviour-visible changes, and documentation-only commits have no
  precedent in the file.
