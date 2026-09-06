# ADR-0018: Unified people — one face pipeline across photos and videos

Date: 2026-09-02 · Status: accepted · Supersedes in part
[ADR-0012](0012-face-clustering-symmetry-and-recluster.md) (clustering algorithm)
and corrects [docs/architecture-photos.md](../architecture-photos.md) §5

## Context

[ADR-0016](0016-photos-catalog-foundations.md) decided that photos and videos
share **one** identity pool: the `people` and `face_observations` tables in
`catalog.db`, with a `media` discriminator (schema V11).
[docs/architecture-photos.md](../architecture-photos.md) §5 then wrote that
decision down as if it had been built — "`faces index` covers both media;
`photos process` auto-chains the faces pass". **It was never built.** The
statement is false and this ADR is the record of correcting it.

### What the code actually does

The faces pipeline is video-only end to end. Sites are as of `940dce3`:

| Site | Video-only behaviour |
|---|---|
| `adapters/db/global-catalog.ts:1126` `listFaceIndexCandidates` | walks `folders`/`files`; a photo fingerprint can never become a candidate |
| `core/server/usecases/faces.ts:454` `runFacesIndexPass` → `:574` `indexCandidate` | joins `folder.currentPath` + `file.fileName`, calls `media.extractFrames` and `media.probe` on that path |
| `core/server/usecases/faces.ts:852` `indexDetection` | `media: FaceObservation['media'] = 'video'` — the default is the only value ever passed |
| `core/server/usecases/faces.ts:644` `runFacesExemplarsPass` | resolves every observation through `listAnalyzedFileLocations` and re-detects with `{ kind: 'video-timestamp' }`; a `ph_`-prefixed fingerprint has no location and lands in `filesUnavailable` |
| `adapters/db/global-catalog.ts:1325` `faceStatus` | `staleVersionFiles` counts `face_index_state` rows, a video-only table; `filesIndexed` mixes both media into one number that reads as "videos" |
| `adapters/db/global-catalog.ts:2191` collection person filter | `EXISTS (SELECT 1 FROM face_observations o WHERE o.fingerprint = f.fingerprint …)` — the join is against `files`, so it is structurally video-only |
| `core/server/usecases/collection.ts:163` `photoUnsupportedFiltersActive` | a non-empty `people` filter **disables the photo leg of the feed entirely** |
| `adapters/db/global-catalog.ts:830` `listLibraryFacets` | counts people over *all* observations including photos — so the Osoby facet promises a count the person filter then refuses to deliver |
| `core/server/usecases/photos.ts:999` `photosDetail` / `PhotosDetailOutput` | no `people` field; `listPeopleForFile` is called only from `core/server/usecases/search.ts:293` (video detail) |
| `core/server/ports.ts:660` / `adapters/db/photos-store.ts:375` `listPhotoFaceIndexCandidates` | exists, is tested, is exported — **and is called by no use-case** |
| `apps/web/src/features/people/PeopleView.tsx` | no media chips, no per-medium counts, no recluster action |

What a user sees: Osoby offers person chips whose counts include photos,
clicking one silently drops every photo from Kolekcja, and no photo ever shows
who is in it.

### Imported photo observations

`core/server/usecases/photo-import-libra.ts:290` writes the imported provider's
face records straight into the shared pool with `media: 'photo'`,
`personId: null`, `cropPath: null`, `frameTsS: 0`, and marks each source photo
complete via `completePhotoFaceIndex(fingerprint, FACE_ENGINE_VERSION)`. An
installation that ran that import therefore holds photo observations that no
native pass produced.

Whether those vectors came from the same checkpoint as the app's own embedder
is not the deciding question, and is not something the app can verify per
install. The properties of the imported rows that settle it are these:

- **No crops.** `crop_path` is NULL for every imported row.
  [ADR-0014](0014-per-observation-face-crops.md) makes the per-observation crop
  the thing a person card is built from, and the only repair path
  (`faces exemplars`) re-detects through video timestamps, so it cannot repair
  a photo row. A cluster made only of imported photo observations is a person
  with no face to show.
- **Foreign geometry.** The bboxes are in the exporting tool's own proxy space,
  and neither those proxies nor their dimensions are recorded on the row. They
  cannot be re-cut from `photo-artifacts/proxies/<fingerprint>.jpg`, whose
  generation pipeline is a different one.
- **Foreign alignment.** The same checkpoint is not the same vector: an
  exporting tool aligns and quality-gates with its own code before the
  embedder. Nothing in the repo proves the two alignment paths agree, and an
  identity pool is only as good as the assumption that every vector in it was
  produced the same way.
- **Foreign observation numbering.** The importer translates the provider's own
  per-photo face numbering into `<fingerprint>:face:1:<n>` in the provider's
  detection order. A native pass renumbers by its own detection order, so the
  two schemes collide rather than merge.
- **Pre-marked complete.** Because `photo_face_index_state` already carries
  `FACE_ENGINE_VERSION`, `listPhotoFaceIndexCandidates`
  (`adapters/db/photos-store.ts:398`) would skip every one of those photos the
  moment a native pass exists.

### Calibration evidence

A cut threshold cannot be guessed, and there is no ground-truth face corpus in
the repo. The evidence available to calibrate against is whatever partition a
user can supply — typically the output of some other clustering tool over their
own photos, with a handful of manual corrections on top.

That is worth using and dangerous to trust. Maximising agreement with a
machine-made partition selects for the algorithm that produced it, which may be
the very greedy assigner this ADR replaces. So the benchmark treats a supplied
partition as a **reference partition**, never as truth, and the deciding
evidence is a small pair sample the user labels by hand (D4 below).

## Decision

**D1 — Native photo face indexing.** A photo leg of the faces pass detects,
aligns, embeds and crops from `photo-artifacts/proxies/<fingerprint>.jpg`
using the existing `FaceEnginePort` `{ kind: 'image-path' }` input
(`core/server/ports.ts:936`), writes observations with `media: 'photo'`, frame
index **1** (per `docs/architecture-photos.md` §5 / `parseFaceObsId`), crops under
`faces/obs/ph_<hex>/` (per ADR-0014), records the proxy dimensions on the
observation, and marks completion through the already-existing
`PhotosStore.completePhotoFaceIndex`. Candidate discovery uses the
already-existing `listPhotoFaceIndexCandidates`, which stops being dead code.
`FACE_ENGINE_VERSION` stays **2**: extraction did not change for video, and
bumping it would purge every video observation to solve a photo problem.

**D2 — Imported photo observations are dropped, not reconciled.** A one-shot
migration deletes every `face_observations` row with `media = 'photo'` (at
migration time these are, by construction, exactly the imported rows — no
native photo row can exist yet) and clears the matching
`photo_face_index_state` rows so the photos re-enter the candidate set.
Before deleting, the migration dumps the full rows to
`~/.ai-video-cataloger/backups/face-observations-photo-libra-<timestamp>.ndjson`
so the delete is reversible by hand. `catalog.db` goes to **V16**, `photos.db`
to **v6**. Deliberately *not* `faces purge`: purge destroys the video
embeddings too and leaves completion state untouched — never purge before a
recluster.

**D3 — Clustering becomes agglomerative average-linkage over cosine
similarity**, replacing the greedy centroid assigner
(`core/domain/faces.ts:335` `clusterFaceObservations`, `:261` `classifyFace`,
`:284` `findNewClusterSeed`). Properties this ADR binds:

- **Deterministic.** Input is sorted by `obsId`; every tie — equal linkage
  score, equal cluster size — breaks on the lexicographically smallest member
  `obsId`. Two runs over the same observations produce byte-identical person
  ids and membership.
- **Sparse by construction.** The candidate edge set is every pair with cosine
  ≥ `FACE_CLUSTERING.reviewBandMin` (0.36), computed in chunked blocks so the
  full N×N matrix is never materialized. Average linkage treats a non-edge
  pair as similarity **0**, a documented lower bound: it can only make a merge
  look worse than it is, which is exactly the split-rather-than-merge bias this
  product wants.
- **Split rather than merge.** The cut threshold is chosen on the conservative
  (higher) side of the benchmark optimum. A false merge poisons a person and
  is only undone by another full rebuild; a false split is one `faces merge`
  away — the ADR-0012 asymmetry argument is unchanged and now governs the cut
  instead of the assign floor.
- **Incremental assignment keeps the greedy path.** Live indexing (a scan, a
  drive run) still assigns each new observation against existing person
  centroids; agglomerative clustering is the *rebuild* algorithm, and the
  rebuild is what makes the incremental path's mistakes cheap.

**D4 — The threshold is calibrated by a repo script, on evidence, before it is
written into `core/domain/faces.ts`.** `scripts/faces-benchmark.ts` (see
[tasks/prd-unified-people.md](../../tasks/prd-unified-people.md) F2) runs the
new clusterer over a corpus at a sweep of thresholds and reports **purity,
completeness and pairwise F1** at each. It has two modes:

- *fixture mode* — small synthetic embedding fixtures committed under
  `scripts/__fixtures__/`, run by the unit tests, so the metric code itself is
  gated by `check`;
- *real-data mode* — points at a user-supplied reference partition and the
  app's own native observations, matching reference observations to native
  detections by photo (source content hash → `ph_` fingerprint) and **bbox IoU
  ≥ 0.5** (reusing `EXEMPLAR_BBOX_MIN_IOU`, `core/domain/faces.ts:37`); never
  part of `check`.

Because a supplied reference partition may itself be machine-made, real-data
mode also emits a stratified pair sample (equal counts per 0.02 similarity band
across 0.30–0.70) for the user to label same/different. The chosen threshold
must (a) sit at or above the pairwise-F1 optimum against the reference
partition and (b) produce **zero** user-labelled different-person pairs inside
a merged cluster. If (a) and (b) disagree, (b) wins.

**D5 — Full from-scratch recluster is a GUI action on Osoby, with a dry run.**
`POST /api/faces/recluster` and `faces recluster` already exist and already
serialize on `resourceKey: 'faces-write'`; the missing piece is the surface.
Osoby gets a destructive-action affordance that runs `--dry-run` first, shows
the report (people before/after, observations reassigned, largest clusters,
`personsWithoutExemplar`, `namesDropped`), and only then offers the real run.

**D6 — Names are not recovered.** *(Revised by the amendment "Pairwise
decisions as clustering constraints", D12: a name is now carried when the old
named person maps one-to-one and total onto exactly one new person. Everything
below still holds in every other case.)* ADR-0012's plurality name transfer is
dropped for this rebuild: after a full re-mint the members behind a person id
are a different set, and carrying the old label over hides that change behind a
familiar name. Every person after the rebuild is unnamed and is named again
deliberately, from the person cards. `namesDropped` still reports what was
lost.

**D7 — Every people surface becomes media-agnostic.** The person filter joins
photos as well as videos, the Osoby facet counts stay honest against it, the
person card lists photos and videos together, photo detail carries a `people`
field, and `faces exemplars` repairs photo crops through
`{ kind: 'image-path' }` on the proxy instead of reporting `filesUnavailable`.
Osoby gains Wszystko / Filmy / Zdjęcia chips with the same wording, ordering
and counting semantics as Kolekcja's (`apps/web/src/features/library/FilterBar.tsx:271`).

**D8 — Counters tell the truth per medium.** `facesStatusOutputSchema`
(`core/contract/routes.ts:2028`) gains additive per-medium counts
(`videosIndexed`, `photosWithFaces`, `photosProcessed`, `stalePhotoFiles`)
alongside the existing fields, which keep their current meaning; `filesIndexed`
now documents the union rather than a video-only count.

## Alternatives rejected

- **Backfill crops for the imported observations instead of re-detecting.**
  Would need the exporting tool's proxies (not in the app's artifact tree), its
  bbox space and a trusted alignment equivalence — three unverifiable
  assumptions to save one detection pass over photos whose proxies are already
  on disk.
- **Bump `FACE_ENGINE_VERSION` to 3 to force the photo rebuild.** Purges and
  re-extracts every *video* observation to fix a photo-only defect; ADR-0012
  rejected the same move for the same reason.
- **Keep the greedy assigner and only re-tune its thresholds.** The greedy
  assigner's outcome depends on observation order and on centroids that drift
  as they absorb members; no threshold makes it deterministic or
  order-independent, and a reference partition produced by a greedy assigner
  would then be measuring its own family.
- **HDBSCAN / DBSCAN.** Density-based clustering leaves a noise class the
  product has no surface for, and its parameters are less legible to a user
  than a single cosine cut.
- **Complete linkage.** Splits harder than the product wants and is dominated
  by single high-quality outliers within a person; average linkage with the
  non-edge-as-zero rule already carries the conservative bias.
- **A separate photo identity pool.** Rejected in
  `docs/architecture-photos.md` §5 and nothing here changes that: one person
  is one person across media.

## Migration of existing data

Ordered, and the order is load-bearing:

1. `catalog.db` V16 + `photos.db` v6 land together with the F1 code. On first
   open, the migration dumps and deletes the `media='photo'` observations and
   clears their `photo_face_index_state` rows.
2. The photo faces pass runs over the photo root. Every photo is a candidate
   again; observations are written with native geometry and crops. People are
   assigned incrementally by the existing greedy path, which is expected to be
   wrong at the seams — that is what step 3 is for.
3. `faces recluster --dry-run` from Osoby; the user reads the report.
4. `faces recluster` for real. All person ids are re-minted; all names are
   gone (D6 — revised by the amendment "Pairwise decisions as clustering
   constraints", D12: from that amendment on, a name whose person maps
   one-to-one onto exactly one new person is carried, and only the ambiguous
   cases lose theirs. On this first migration there are no decisions yet and no
   names worth carrying, so the step reads as written).
5. The user renames the people that matter.

`faces purge` is never part of this sequence.

## Rollback

- **F1 (indexing) reverts cleanly**: revert the commit, and the photo leg
  stops producing observations. The already-written photo observations are
  ordinary rows; `faces recluster` on the reverted build ignores nothing and
  still works, because clustering reads embeddings, not media.
- **The V16/v6 migration does not revert**, which is why it dumps to
  `backups/face-observations-photo-libra-<timestamp>.ndjson` first. Restoring
  is a manual re-import of that file; the app ships no command for it, because
  the rows it deletes are the ones this ADR establishes are unusable.
- **F2 (clustering) reverts by reverting the algorithm commit and running
  `faces recluster` again** — the observations and their embeddings are
  untouched by any clustering change (ADR-0012's rebuildability invariant
  holds, and it is the reason this ADR can be aggressive about the algorithm).
- **F3 (UI) reverts independently** of F1/F2; the routes it consumes stay
  additive.

## Consequences

- Person ids change once more, and this time every name is dropped by design.
  Names are re-applied from the person cards.
- Recluster stops being O(N × clusters) and becomes O(edges) over a sparse
  neighbour graph, with a chunked block pass to find those edges. At catalog
  scale — tens of thousands of observations of 128 floats — the edge pass is
  the cost driver; the F2 benchmark must report wall-clock time, and if a full
  rebuild exceeds ten minutes the sanctioned fallback is a random-projection
  banding prefilter before the block pass — never a lower `reviewBandMin`.
- The Osoby facet count and the person filter agree for the first time.
- `faces exemplars` gains a photo path and stops reporting healthy photo
  fingerprints as `filesUnavailable`.
- No new `ErrorCode`, HTTP status or CLI exit code. New NDJSON progress step
  names for the photo faces leg only, per `docs/architecture-photos.md` §7's
  precedent.
- `docs/architecture-photos.md` §5's "covers both media" claim becomes true
  when F1 lands; until then the section carries the dated correction this ADR
  installs.
- **Parity:** faces are a post-parity capability — `tasks/parity-inventory.md`
  has no faces section and the old app had none. Nothing here touches the four
  sanctioned deviations in the PRD's Technical Considerations, the NDJSON
  event grammar, exit codes or the on-disk layout of video artifacts.
- **Changelog:** this commit is documentation only and carries no
  `CHANGELOG.md` line, per the repo rule that a changelog entry travels with a
  behaviour-visible change. The lines each of F1–F5 must land are enumerated
  in [tasks/prd-unified-people.md](../../tasks/prd-unified-people.md).

## Amendment: scale and bridge controls

Date: 2026-09-02 · Status: accepted

The F2 implementation keeps D3's agglomerative average-linkage decision but
changes the in-memory representation and adds two quality controls:

- Pair sums are stored in typed-array open-addressing tables keyed by numeric
  cluster ids, and the benchmark prepares the sparse similarity edge set once
  before sweeping threshold candidates. This avoids string-keyed `Map` growth
  as the limiting factor for large native catalogs.
- A merge between two established clusters now also requires a strong-edge
  fraction of at least `FACE_CLUSTER_MIN_STRONG_FRACTION`, where strong edges
  are cross-cluster observation pairs whose cosine similarity is at or above
  `FACE_CLUSTERING.clusterCutSimilarity`. The default is `0.30`: small clusters
  still merge by average linkage alone, while two clusters with at least three
  members each need broad support from cut-clearing cross pairs before the
  rebuild treats them as one identity. The benchmark sweeps this value as the
  strong-fraction calibration axis; the old density sweep CLI flag is renamed
  to `--strong-fractions`.
- `FACE_QUALITY.minScore` remains the storage floor, so crops and telemetry
  still include borderline detections. `FACE_IDENTITY_MIN_SCORE` is the higher
  identity floor; observations below it do not join existing identities, seed
  new identities, or participate in full reclustering.

## Amendment: calibration lessons

Date: 2026-09-03 · Status: accepted

Calibrating the benchmark against a real, human-supplied reference partition
surfaced three lessons that change how future calibration runs must be read:

- **A reference partition is a hint, not ground truth.** Any partition
  produced by another clustering run — even with manual corrections layered
  on top — carries that run's own biases, most commonly over-splitting one
  identity into several. Purity, completeness and "identities spanned"
  computed against such a partition are dominated by the reference's own
  splitting, not by the candidate algorithm's errors. These metrics are
  useful for spotting large regressions, never for picking a final
  threshold.
- **The trustworthy acceptance metric is the human-labelled pair set.** A
  small sample of pairs labelled "same person" / "different person" by a
  human is the only signal that is not contaminated by another algorithm's
  choices. The acceptance bar is zero labelled-different pairs merged, with
  the split rate (labelled-same pairs left apart) reported alongside it as
  the cost of that bar. This is complemented, not replaced, by a human visual
  check of the largest resulting clusters — a contact-sheet sample that
  includes the lowest-score and smallest-box tails, not just a random draw —
  before concluding that a large cluster is a merge error rather than one
  identity with many observations.
- **Tightening the merge criterion fragments real identities well before it
  fixes a genuinely mixed cluster.** Raising the strong-edge fraction or
  moving toward complete linkage first splits identities that have a wide
  spread of poses, lighting or crop quality — the visual check catches this
  as a person now scattered across many small clusters — long before it
  breaks the rare cluster that actually mixes two people. A quality-gate
  change is therefore justified by the visual audit of its effect on cluster
  counts and composition, never by movement in the reference-partition
  metrics alone.

## Amendment: pairwise decisions as clustering constraints

Date: 2026-09-06 · Status: accepted · **Revises D6**

The split-over-merge bias decided in D3 and tightened by the strong-edge
fraction floor is working as designed, and the bill it produces is the one the
asymmetry argument said it would: a rebuilt library holds many cards that are
one person. The repair the app offered was a two-card selection and "Scal
wybrane", which does not scale past a handful of mistakes. This amendment adds
the missing half of the asymmetry: a cheap way to *state* that two identities
are one, and a store that makes the statement outlive the rebuild that
prompted it. It is specified in
[tasks/prd-people-pair-review.md](../../tasks/prd-people-pair-review.md).

**D9 — A user answer about a pair of people is stored as a durable
constraint.** `catalog.db` gains `people_pair_decisions` (schema **V19**;
`photos.db` is untouched at v7): one row per unordered pair, carrying a
decision of `same`, `different` or `skip`, a decision time, and a source. The
row is keyed on an unordered pair of **observation ids**, not person ids,
because D5's rebuild re-mints every person id and an id-keyed row would be
meaningless the moment the constraint is most needed; the two person ids are
kept as refreshed, non-authoritative columns for candidate exclusion, merge
re-keying and human-readable output. The anchor of each side is the **first
entry of the contact sheet** the review card showed — the highest-quality
observation of that person *that has a crop*, which is the crop the user was
actually looking at. It is defined as the sheet selector's own output rather
than as "the top exemplar", because a face observation's crop path is nullable
and a quality-only exemplar pick can therefore name an observation the sheet
never displayed. A person with no crop at all is shown as a placeholder and
anchored on its top exemplar, which is as much as the card claimed.
`same` merges the two people immediately through the existing merge path;
`different` is permanent; `skip` suppresses the pair for 30 days.

**D10 — Candidates are generated from the stored embeddings, on demand, and
ranked by expected value.** Two people are proposed when their centroid cosine
similarity is at or above a band floor, or when their centroids are near that
floor and their best cross-exemplar pair clears
`FACE_CLUSTERING.clusterCutSimilarity`. The band has **no upper bound**: the
strong-edge fraction floor added by this ADR's first amendment, and the greedy
incremental assignment path D3 deliberately kept, both leave pairs above the
cut sitting as two people, so such a pair is the strongest candidate rather
than an impossible one. Ranking is a similarity weight that saturates at the
cut, multiplied by the log sizes of both people, so the question that unites
the most observations with the best evidence is asked first. The band floor is
a three-level user setting (`faces_pair_scope`: `careful` / `standard` /
`wide`), not a hidden float, because how eagerly the app should ask is a taste
judgement the owner must be able to move without a rebuild.

**D11 — A full recluster is a constrained clustering.** `same` decisions are
**must-link** pairs, pre-unioned before the agglomerative loop so the initial
clusters are the must-link components; `different` decisions are
**cannot-link** pairs that reject any merge whose union would contain both
endpoints. `skip` is never a constraint. Determinism is unchanged: input sorted
by `obsId`, ties on the smallest member `obsId`, must-link components ordered
by their smallest member. A cannot-link pair that already sits inside a
must-link component is a **conflict**, and the must-link wins — not because it
is newer (an imported `different` can easily post-date a `same`), but because a
`same` answer has already been **materialized as a merge**: the observations
sit in one person on disk, and honouring the cannot-link would make the rebuild
contradict the state the user is looking at. The conflict is counted and
reported rather than silently resolved, so the contradiction is visible and can
be corrected by re-deciding the pair. Constraints naming an observation that no
longer exists are ignored and counted as stale. The cost is bounded by the
number of decisions, not by the number of observations: each cluster carries
only the constrained observation indices it holds.

**D12 — Names may now be carried across a rebuild; D6 is revised.** D6 dropped
every name because "after a full re-mint the members behind a person id are a
different set, and carrying the old label over hides that change behind a
familiar name". That reasoning stands — and it is now *testable* instead of
assumed. A name is carried when the map from the old named person to a new
person is one-to-one and total on both sides over surviving observations: every
surviving observation of the old person is a member of the new one, and every
observation of the new one that existed before the rebuild **and belonged to
some person** belonged to the old one. Observations that existed but were
**unassigned** before the rebuild (`personId = null` — the previous rebuild's
`unassignedObsIds`, and anything the incremental path never placed) are exempt
from that test: they carried no identity, so absorbing them cannot mean the old
label now names a different set of people. Newly indexed observations joining
the person are exempt for the same reason. In that case the member set is not a
different set, which was exactly D6's condition. Every other case still drops
the name and reports it: a person split
across two new people, and two old names landing in one new person (a name
conflict, where the app must not pick). `namesCarried` stops being permanently
zero, `namesDropped` keeps listing the rest, and the recluster report gains
`constraintsApplied`, `constraintConflicts`, `constraintsStale` and
`nameConflicts`.

**D13 — The labelled-pairs corpus is an input, not only a metric.** The
same/different pairs D4 asks the user to label are, in form, exactly the
statements D9 stores: an unordered pair of observation ids with a verdict. A
one-off `faces pairs import` writes them as decisions with `source: 'import'`
(`unsure` and `not_face` are skipped and counted), so calibration labelling
pays twice — once as the acceptance metric D4 requires, once as constraints
that bind every later rebuild. The import does not merge by default: a corpus
of hundreds of `same` labels would otherwise fire hundreds of merges in one
command, and the constraints take effect at the next recluster either way. The
corpus is read in the **native observation-id** namespace: D4's benchmark
script is what maps a reference partition's ids onto native ones, and the
import does not repeat that match, because a geometric guess turning into a
permanent cannot-link is a stronger act than scoring a metric. A `different`
label whose two observations already sit in one person is the most valuable row
in such a file — the corpus reporting a mixed person — and is kept and counted,
not discarded as redundant.

### Alternatives rejected

- **Keying decisions on person ids alone**, as the shortest reading of the
  feature suggests. Every id is re-minted by D5's rebuild, so the rows would be
  stale exactly when D11 needs them, and a `same` row would degenerate into a
  self-pair with no way to express the constraint.
- **Lowering the cut or the strong-edge floor instead of asking.** The first
  amendment's calibration lesson is explicit that moving those knobs fragments
  real identities long before it fixes a mixed cluster; the knob that is
  actually missing is the user's answer, not a smaller number.
- **A bulk "merge everything above X" action.** That is the greedy assigner D3
  replaced, wearing a button, and it reintroduces exactly the false merges the
  asymmetry argument exists to avoid.
- **Undoable merges.** A merge moves observations and deletes a person id;
  restoring it is a rebuild, not an undo. The flow says so and offers undo for
  `different` and `skip` only.
- **Widening a `different` decision to every member pair of the two people.**
  It would bind the rebuild harder, but it encodes a claim about crops the user
  never saw. The narrow reading — the two anchors the user compared — is what
  the user actually stated.
- **A background generator or a scheduled pass.** The queue is a synchronous
  read over data already loaded by the Osoby surface; a job kind would add an
  event grammar and a failure mode for no gain.

### Consequences

- One new table and one additive migration (`catalog.db` V18 → V19); no new
  database file, artifact kind, `ErrorCode`, HTTP status, exit code, job kind
  or NDJSON step.
- The migration path in this ADR's "Migration of existing data" section gains a
  step 6 after step 5: the pairwise review is where the duplicates the
  conservative cut left behind are resolved, and from then on step 4's rebuild
  no longer discards that work.
- `faces recluster` stops being purely destructive of user effort. Names
  survive an unambiguous rebuild, and every answered pair survives every
  rebuild.
- The rebuild's output is no longer a function of the embeddings alone. Two
  installations with identical observations and different decision sets produce
  different partitions — intended, and the reason the report names the
  constraints it applied.
- **Parity:** unchanged. Faces remain a post-parity capability;
  [tasks/parity-inventory.md](../../tasks/parity-inventory.md) carries a note
  for the new table.
- **Changelog:** this amendment is documentation only and carries no
  `CHANGELOG.md` line. The lines each wave must land are enumerated in
  [tasks/prd-people-pair-review.md](../../tasks/prd-people-pair-review.md).
