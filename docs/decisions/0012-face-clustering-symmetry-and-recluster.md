# ADR-0012: Face identities are founded on the same evidence they are joined on

Date: 2026-07-29 · Status: accepted · Refines [ADR-0011](0011-faces-pass-in-drive-runs.md)

## Context

Field evidence from a real-world catalog showed detections from clearly distinct people
collapsing into one identity. High-quality observations stuck to that one magnet while
the remaining observations stayed orphaned instead of founding another identity.

Two independent mechanisms caused this, both in `core/domain/faces.ts`:

- `findNewClusterSeed` collected every orphan with enough supporters into one `members`
  array and then demanded that **all** collected candidates be mutually similar. Once the
  orphan pool held support for two different real people, the all-pairs check failed and
  the function returned `[]` — forever, for every subsequent detection, since the pool
  only grows. The first person was founded while the pool was still single-identity; from
  then on no second identity could ever be founded.
- `autoAssignSimilarity` (0.45 on one observation) was cheaper to satisfy than
  `newClusterSimilarity` (0.50 on three observations): joining was strictly easier than
  founding, so once a magnet existed it kept absorbing anything above 0.45 while nothing
  strong enough to found a rival ever accumulated.

## Decision

- **Symmetric thresholds** (`core/domain/faces.ts`): `autoAssignSimilarity` rises to 0.50
  (from 0.45) and `newClusterMinObservations` drops to 2 (from 3), so
  `newClusterSimilarity === autoAssignSimilarity` by construction — founding an identity
  never demands more evidence than joining one. SFace cosine similarity separates same
  person (~0.4–0.6) from different people (~0.1–0.3); OpenCV's own `FaceRecognizerSF`
  reference threshold is 0.363. 0.50 sits a full band above the different-person mass with
  headroom, deliberately on the conservative side of 0.45, because a false merge is
  unrecoverable without a full rebuild (and poisons the centroid, attracting more wrong
  faces — exactly what the real-world catalog shows), while a false split is one `faces merge` away.
  `newClusterMinObservations: 2` is the only remaining asymmetry and it is on *count*, not
  *similarity*: one corroborating observation is the minimum that stops a single spurious
  detection from minting an identity, and it costs nothing — a lone orphan is never
  discarded, it stays unassigned and founds a person the moment a second observation
  matches it. `reviewBandMin` (0.36, OpenCV's floor) and `autoAssignMargin` (0.05, a
  tie-break between candidate people) are unchanged.
- **`findNewClusterSeed` seeds one coherent group.** Rewritten as a greedy search: rank
  candidates by supporter count, grow the best-supported candidate's group only while every
  new member stays pairwise-similar to the group so far, and return the first group that
  clears `newClusterMinObservations`. A mixed orphan pool now yields the best-supported
  identity instead of nothing.
- **`faces recluster [--dry-run]`** recomputes every person and every assignment from the
  embeddings already stored in `face_observations.embedding` — no frame extraction, no
  detector, no model. This is the affordability enabler for threshold tuning: a full
  re-index of a large catalog is expensive; a recluster is fast. It is **replace, not
  patch**: every existing person row is deleted and replaced by the clusters the algorithm
  produces, un-gluing the magnet by construction. Person ids are re-minted deterministically
  from each cluster's seed observation — reusing the plurality old person's id was rejected
  because it looks stable while silently changing membership. Owner-set names are carried
  by plurality of the old observations each new cluster inherited; a name is claimed by at
  most one new cluster, and `namesDropped` reports names no cluster could claim. Exemplar
  crops are per-observation and are never touched or renumbered — recluster has no aligned
  pixels and no detector, so a freshly un-glued person can start with no exemplar
  (`personsWithoutExemplar`).
- **`FACE_ENGINE_VERSION` stays 2.** It gates *extraction*; a clustering-rule change does
  not change a single stored embedding, so bumping it would purge every observation and
  buy back the extraction cost recluster exists to eliminate.
- **Exemplar sampling is per-file, not first-encountered** (`FACE_LIMITS.maxExemplarsPerFile:
  1`): at most one exemplar crop is stored per file until a person has five, so a person
  spanning many folders is verifiable by the owner instead of showing five near-duplicate
  crops from one day.

## Alternatives rejected

- **A dedicated `faces split` command.** It needs the same clustering machinery on a
  subset and leaves the rest of the catalog on the old thresholds; recluster does the
  whole job with the same code, and the owner prefers a single rebuild path.
- **Bumping `FACE_ENGINE_VERSION` to force a clean rebuild.** Purges every observation and
  incurs the full re-extraction cost that recluster exists to avoid.
- **Keeping 0.45 and only fixing the seeding.** 0.45 sits inside the tail of the
  different-person band for SFace, and a false merge is unrecoverable while a false split
  is one `faces merge` away.
- **Reusing the plurality old person's id on rebuild.** Produces a stable-looking id with
  silently changed membership — worse for an owner reasoning about "person-123" than an id
  that visibly changed.

## Consequences

Person ids change on every recluster and names survive only by plurality (`namesDropped`
tells the owner what to re-apply). Crops are per-observation and stay where they are, so
freshly un-glued people can start with no exemplar. Recluster is O(N × clusters) in memory
and touches no video, no detector, and no `FACE_ENGINE_VERSION`; no `ErrorCode`, HTTP
status, CLI exit code, or progress step is added. A person seen in one file now has one
exemplar crop instead of five near-duplicates.
