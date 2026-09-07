# PRD: "Ta sama osoba?" — pairwise people review (W99)

**Verified base commit: `285a94f`** (W100 and W101 merged). Every code anchor
quoted below — file, symbol, prop list, schema version — was re-read at that
commit. A later change to any quoted site is a change to this document: re-read
the anchor before implementing, and fix the quote in the same PR.

Implementation anchor update: the current base already uses catalog V19 for
thumbnail state and pending crop cleanup. W99 retains V19 and those existing
additions; its additive, idempotent migration also installs the decision table
when opening an existing V19 catalog that lacks it. Both V18 and existing-V19
upgrade paths are covered by lossless migration probes. The current store also
serializes batches and defers competing flushes; W99 still issues no flush
inside a batch. The current `totalsByPerson` selects crop-bearing displayed
exemplars; pair ranking selects its quality exemplars independently through
`selectExemplars`, while the two routes share visible counts and numbering.

Decision record: [ADR-0018](../docs/decisions/0018-unified-people.md) and its
amendment "Pairwise decisions as clustering constraints".
Design: [docs/architecture.md](../docs/architecture.md), "People — pairwise
review and decision constraints (W99)".
Parity note: [tasks/parity-inventory.md](parity-inventory.md), "Post-parity
note — pairwise people decisions (W99)".

## Introduction / Overview

Osoby is built on a clustering pass that is deliberately biased towards
splitting: [ADR-0018](../docs/decisions/0018-unified-people.md) D3 puts the cut
threshold on the conservative side, and its first amendment adds a strong-edge
fraction floor on top. That bias is correct — a false merge poisons a person
and is only undone by another full rebuild, a false split is one merge away —
but it hands the user the bill. After a from-scratch recluster a real library
shows the same individual spread across many cards, and the only repair the app
offers is: find the duplicate cards among hundreds, tick them, press "Scal
wybrane", answer which of the named ones keeps its name (W101), repeat. That is
a tool for fixing three mistakes, not for draining a backlog of them.

This feature turns the repair into a question the app asks. The app already
knows which two people are suspiciously similar — it computed exactly those
similarities when it decided *not* to merge them. So Osoby gains a review flow:
two people side by side, each with its name or index, its file counts and a
contact sheet of crops, and one question — **"Czy to ta sama osoba?"** — with
three answers: **Tak**, **Nie**, **Pomiń**. Keyboard first (`1`, `2`, `3`), one
pair per screen, and an entry point that appears only when the app has
something worth asking about.

Three properties make this more than a faster merge button:

- **The answers persist and they are constraints, not history.** "Tak" merges
  the two people now. "Nie" is a permanent *cannot-link*: those two identities
  are never proposed again, and the next full recluster is forbidden from
  putting them in one cluster. "Pomiń" hides the pair for 30 days. The user's
  work stops being erased by the next rebuild.
- **Because constraints survive a rebuild, names can survive one too.**
  ADR-0018 D6 dropped every name on recluster because "the members behind a
  person id are a different set". With decisions stored, that is testable
  rather than assumed: when an old named person maps one-to-one onto a new
  person, the name is carried; in every other case it is still dropped and
  reported. This PRD revises D6 to exactly that rule.
- **The owner's existing labelled-pairs corpus becomes constraints.** The
  same/different pairs already labelled by hand for the
  [ADR-0018 D4](../docs/decisions/0018-unified-people.md) calibration are, in
  form, the same statements this flow collects. A one-off CLI import turns them
  into decision rows, so the calibration work pays twice.

Everything the GUI can do here, the CLI can do: `faces pairs list`,
`faces pairs decide`, `faces pairs import`, with NDJSON events and the existing
exit-code taxonomy.

This document is written to be executed by an agent with no prior context. It
is split into **Wave A** (domain, contract, server, adapters, CLI — no
renderer) and **Wave B** (renderer and e2e), each listing its routes, schemas
and migrations explicitly, so either wave can be implemented from this document
alone. Every requirement is numbered; every story is sized for one session and
carries a verifiable acceptance checklist.

Read before starting: [`../CLAUDE.md`](../CLAUDE.md),
[`../docs/architecture.md`](../docs/architecture.md) (Delta 3 persistence, the
ports list, contract-as-the-only-bridge, the renderer bound-actions and
zero-networking rules, and the W99 section),
[ADR-0012](../docs/decisions/0012-face-clustering-symmetry-and-recluster.md)
(the split-over-merge asymmetry and the rebuildability invariant),
[ADR-0014](../docs/decisions/0014-per-observation-face-crops.md) (crop layout —
the contact sheet is built from these),
[ADR-0018](../docs/decisions/0018-unified-people.md) (the clusterer, the
strong-edge guard, D6, and the amendment this feature adds),
[ADR-0020](../docs/decisions/0020-library-hide-and-trash.md) (hidden files never
count in Osoby — the same rule binds candidate generation) and
[tasks/prd-unified-people.md](prd-unified-people.md) (the F1–F5 plan this
follows).

### Owner decisions (binding — do not relitigate)

1. **The flow is pairwise, one pair per screen.** Two people side by side,
   the question "Czy to ta sama osoba?", three answers: Tak / Nie / Pomiń.
2. **Candidates come from the embeddings the app already stores** — person
   centroid similarity and cross-exemplar similarity — never from a new model
   pass and never from filename or metadata heuristics.
3. **The entry point appears only when there is something worth asking.** An
   "Ta sama osoba?" control in the Osoby header showing the pending count
   ("Do sprawdzenia: 37"), hidden when the count is zero.
4. **Answers persist in the catalog database** in a new
   `people_pair_decisions` table, keyed on an unordered pair. "Tak" merges
   immediately through the existing merge path. "Nie" is permanent. "Pomiń"
   hides the pair for 30 days.
5. **"Nie" binds future reclusters.** Stored decisions are must-link /
   cannot-link constraints for the rebuild, not just a filter on what the app
   asks next.
6. **Names may be carried across a recluster** when a decided-same component
   maps one-to-one; ADR-0018 D6 is revised, not ignored. Observations that
   carried no identity before the rebuild (unassigned, or indexed since) do not
   break that mapping — see US-A5 and FR-34.
7. **A merge is not undoable.** Backspace undoes a "Nie" or a "Pomiń"; on a
   "Tak" the app says so instead of pretending. "Tak" on two *named* people
   asks for confirmation first.
8. **CLI parity is mandatory:** `faces pairs list` and `faces pairs decide`,
   plus a one-off `faces pairs import` for the labelled-pairs corpus, all with
   NDJSON events and taxonomy exit codes.
9. **No new `ErrorCode`, HTTP status, exit code, database file or on-disk
   directory.**

### Refinements of the binding decisions (with reasons, not re-litigation)

Three points below sharpen decision 4 and the candidate band. They keep the
decisions' intent and are recorded here so the reason is not lost.

- **The decision row is keyed on an unordered pair of *observations*, and
  carries the two person ids as refreshed, non-authoritative columns.** A row
  keyed only on person ids is garbage the moment a recluster re-mints every
  person id — which is the exact event decision 5 says these rows must survive.
  Observation ids (`<fingerprint>:face:<frame>:<detection>`) are deterministic
  and stable across rebuilds, so they are the anchor; the person columns stay
  for candidate exclusion, for the merge re-key and for human-readable output.
  This is the "name pinned to an observation, not to a person id" idea listed
  as the obvious follow-up in
  [tasks/prd-unified-people.md](prd-unified-people.md) risk 4.
- **The upper edge of the candidate band is open, not `clusterCutSimilarity`.**
  The band was described as `[ask_low, cut)` on the reasoning that anything at
  or above the cut is already merged. That is no longer true: ADR-0018's first
  amendment added the strong-edge fraction floor, so two clusters can sit above
  the cut and still be left apart, and the incremental assignment path mints
  people between rebuilds without any linkage test at all. A pair above the cut
  that survives as two people is therefore the *strongest* candidate, not an
  impossible one. The cut stays in the formula as the ranking pivot (the point
  at which the similarity term saturates), and the band is `[ask_low, ∞)`.
- **`ask_low` is a three-level user setting, not a hidden float.** "Only when
  the app believes it has something worth asking" is a taste judgement the
  owner should be able to move without a rebuild, and a closed three-value key
  (`careful` / `standard` / `wide`) keeps `config.json` free of tuning floats.
  It is also what lets the Wave B e2e guarantee a candidate exists by clicking
  a real control instead of pre-seeding state.

## Goals

- **G-1** A user drains a backlog of duplicate people with the keyboard, one
  question per keystroke, without ever hunting for two cards in a grid.
- **G-2** Every answer is permanent: the same question is never asked twice,
  and a "Nie" is not undone by the next full rebuild.
- **G-3** The app asks only about pairs it has real evidence for, ranked so the
  most valuable question comes first, and shows nothing at all when it has no
  evidence.
- **G-4** A user can see *why* the app is asking — six crops per person, the
  counts, the names — and decide in one glance, without opening either person.
- **G-5** A full recluster after a review session preserves the user's
  decisions and, where the mapping is unambiguous, the user's names.
- **G-6** Everything the GUI can do, the CLI can do, with NDJSON events and
  taxonomy exit codes; the existing labelled-pairs corpus imports as decisions.
- **G-7** The feature stays inside the closed taxonomy: no new `ErrorCode`, no
  new HTTP status, no new exit code, no new database file, no new on-disk
  directory.

## User Stories

Stories are grouped into two waves. **Each story is one session's work and must
land with `pnpm run check` and `pnpm run smoke` green.** Every story is
**RED-first**: the test that names the behaviour is written and observed
failing before the code that satisfies it exists. Stories that change
user-visible behaviour add their `CHANGELOG.md` line under `[Unreleased]` in
the same commit. Story numbers are stable identifiers, **not** the landing
order, though the dependency order inside a wave is the numbering order.

---

## WAVE A — domain, contract, server, adapters, CLI (no renderer)

Wave A ships the whole feature except its screen. At the end of Wave A the
owner can drain the backlog from the CLI, and a recluster honours every answer.

**Contract surface added by Wave A** (all in `core/contract/routes.ts`,
registered in `apps/server/src/app.ts`, exposed through `core/client`):

| Route | Method | Input schema | Output schema |
|---|---|---|---|
| `/api/faces/pairs` | GET | `facesPairsInputSchema` | `facesPairsOutputSchema` |
| `/api/faces/pairs/decide` | POST | `facesPairsDecideInputSchema` | `facesPairsDecideOutputSchema` |
| `/api/faces/pairs/undo` | POST | `emptyInputSchema` | `facesPairsUndoOutputSchema` |
| `/api/faces/pairs/import` | POST | `facesPairsImportInputSchema` | `facesPairsImportOutputSchema` |

**Existing contract schemas Wave A changes** (additive fields only, so every
current consumer keeps parsing):

| Schema | Added fields | Consumers that must tolerate them |
|---|---|---|
| `facesMergeOutputSchema` | `decisionsInvalidated: number` | `apps/web/src/features/people/use-people.ts`, `apps/cli/src/main.ts` (`faces merge` human + NDJSON output) |
| `facesReclusterOutputSchema` | `constraintsApplied: { mustLink: number; cannotLink: number }`, `constraintConflicts: number`, `constraintsStale: number`, `nameConflicts: number` | `apps/web/src/features/people/use-people.ts` and the recluster report in `PeopleView.tsx`, `apps/cli/src/main.ts` (`faces recluster`) |

A field added to a zod object is required unless it is optional, so both
schemas and every site that constructs those outputs change together; the
renderer's recluster report and the CLI's human output surface the new numbers
rather than dropping them, and the existing `faces merge` / `faces recluster`
tests are extended rather than left asserting the old shape.

**Database migrations added by Wave A:**

| Database | From | To | Change |
|---|---|---|---|
| `catalog.db` | **V18** | **V19** | new table `people_pair_decisions` + two indexes |
| `photos.db` | **v7** | **v7** | unchanged — decisions live with the identity pool |

**Config key added by Wave A:** `faces_pair_scope` (app-global, home scope,
`careful` / `standard` / `wide`, default `standard`).

**Job kinds added by Wave A:** none. Candidate generation is a synchronous
read; a "Tak" answer reuses the already-serialized merge write path.

---

### US-A1: The decision table, its domain types and the V19 migration

**As** the app, **I want** an unordered-pair decision store anchored on
observations, **so that** an answer outlives the person ids it was given about.

**Scope.**

- `core/domain/people-pairs.ts` (new, pure): `peoplePairDecisionKindSchema`
  (`'same' | 'different' | 'skip'`), `peoplePairDecisionSourceSchema`
  (`'user' | 'import'`), `peoplePairDecisionSchema`, the
  `PeoplePairDecision` type, `orderObservationPair` and `orderPersonPair`
  (canonical unordered ordering: lexicographically smaller id first), and
  `PAIR_REVIEW_SKIP_DAYS = 30` with `pairDecisionIsActive(decision, nowIso)`
  — a `skip` is active **iff `now < decided_at + PAIR_REVIEW_SKIP_DAYS`**, so
  at exactly 30 days it is already inactive; `same` and `different` are always
  active.
- `adapters/db/global-catalog-schema.ts`: the drizzle table and
  `migrateGlobalCatalogSchemaSqlV19`, added to the exported migration list next
  to `migrateGlobalCatalogSchemaSqlV18` (W100's
  `idx_face_observations_fingerprint` index, which took V18), plus the matching
  `if (currentVersion < 19)` branch in `adapters/db/global-catalog.ts`'s
  migration ladder, immediately after the `< 18` one.

  ```sql
  CREATE TABLE IF NOT EXISTS people_pair_decisions (
    obs_a_id TEXT NOT NULL,
    obs_b_id TEXT NOT NULL,
    person_a_id TEXT,
    person_b_id TEXT,
    decision TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (obs_a_id, obs_b_id)
  );
  CREATE INDEX IF NOT EXISTS people_pair_decisions_person_a_idx
    ON people_pair_decisions(person_a_id);
  CREATE INDEX IF NOT EXISTS people_pair_decisions_person_b_idx
    ON people_pair_decisions(person_b_id);
  ```

  **The person columns are nullable.** An anchor observation can be
  unassigned (`personId: null` — the recluster's `unassignedObsIds` and the
  incremental path both produce them), and the columns are declared
  non-authoritative anyway: exclusion (US-A2) and the rebuild resolve anchors
  through the observation table, never through these columns. A null column
  therefore means "this anchor currently belongs to no person", which the
  queue, the CLI output and the import all render as `unassigned` rather than
  treating as an error. `peoplePairDecisionSchema` declares both person fields
  `z.string().min(1).nullable()`.

- `core/domain/global-catalog.ts`: `GLOBAL_CATALOG_SCHEMA_VERSION` 18 → **19**.
- `core/server/ports.ts` — `GlobalCatalogStore` gains:
  `listPeoplePairDecisions()`, `recordPeoplePairDecision(decision)` (upsert on
  the observation pair; a later decision replaces an earlier one for the same
  pair), `deletePeoplePairDecision(obsAId, obsBId)`,
  `latestUserPeoplePairDecision()` (the single most recent row **with
  `source = 'user'`** by `decided_at`, ties broken on the canonical pair key,
  for undo — an imported corpus row is never undoable by a keystroke), and
  `deletePeoplePairDecisionsForObservations(obsIds)`.
- **`deletePeoplePairDecisionsForObservations` and US-A6's
  `deleteDecisionsAnchoredOnObservations(db, obsIds)` are one implementation,
  not two paths.** The private store helper is the body; the port method is that
  helper exposed on `GlobalCatalogStore` as the seam a unit test can call
  directly. The three observation-deleting writes of US-A6 call the **helper**
  (they are already inside the store and inside their own transaction), never
  the port method, so there is exactly one deletion query and adding a fourth
  deletion path means calling the same helper.
- Every write goes through the existing `write()` funnel, so the sql.js flush
  and the catalog write lock behave exactly as for the other faces writes.

**Acceptance criteria.**

- [ ] A catalog seeded at V18 opens at V19 with the table present, every other
      table byte-identical, and the migration re-runnable (open twice, no
      second migration, no duplicate rows) — the pattern of
      `adapters/db/global-catalog.test.ts`'s "migrates a v10 catalog to the
      current version losslessly" probe (which dumps a named table list before
      and after and compares row-for-row), **not** the V15→V16 test next to it,
      which is a lossy back-up-and-drop case and the wrong template here.
- [ ] `recordPeoplePairDecision` normalizes the pair: recording `(b, a)` after
      `(a, b)` updates one row, never inserts a second.
- [ ] `pairDecisionIsActive` is exhaustively unit-tested for `skip` at 29 days
      (**active**), at exactly 30 days (**inactive** — the boundary belongs to
      the expired side) and at 31 days (**inactive**), and for `same` /
      `different` at an arbitrary age (**active**).
- [ ] `deletePeoplePairDecisionsForObservations` removes a row when *either*
      anchor is in the list.
- [ ] `pnpm run check` and `pnpm run smoke` green.

**RED-first.** The migration probe is written against V18 and observed failing
with "no such table: people_pair_decisions" before the schema change lands.

---

### US-A2: Candidate generation as pure domain code

**As** the app, **I want** a deterministic function that turns people,
observations and decisions into a ranked question queue, **so that** the
ranking is testable without a database.

**Scope.** `core/domain/people-pairs.ts` gains:

- Constants: `PAIR_REVIEW_ASK_LOW_BY_SCOPE = { careful: 0.5, standard: 0.44,
  wide: 0.34 }`, `PAIR_REVIEW_PREFILTER_MARGIN = 0.1`,
  `PAIR_REVIEW_DEFAULT_LIMIT = 200`, `PAIR_REVIEW_MAX_LIMIT = 1000`,
  `PAIR_REVIEW_CROPS_PER_PERSON = 6`.
- `buildPeoplePairCandidates(input)` where `input` carries the visible people
  (person id, display name, centroid, observation count, file counts), their
  `visibleObservations` (`FaceObservationSummary` — obs id, person id, quality,
  crop path, fingerprint, media; **no embedding**, per W100's projection),
  `anchorObservations` (the same shape over the **full** observation set, hidden
  files included, used only to resolve a decision's anchors onto person ids),
  `exemplarEmbeddings` (a `ReadonlyMap<string, Float32Array>` covering exactly
  the exemplar `obsId`s, so the cross-exemplar channel has vectors without the
  input carrying an embedding per observation), the active decisions, `askLow`,
  `cut`
  (`FACE_CLUSTERING.clusterCutSimilarity`) and `limit`. It returns
  `{ candidates, pending, truncated }`.
- `selectPairReviewCrops(observations)` — the contact sheet selector.

**Ranking and filtering rules (all unit-tested).**

- A pair is a candidate when `centroidSimilarity >= askLow`, **or** when
  `centroidSimilarity >= askLow - PAIR_REVIEW_PREFILTER_MARGIN` and the best
  cross-exemplar similarity between the two people is `>= cut`. The second
  channel catches a person whose poses pull the two centroids apart; the
  prefilter bounds the exemplar work.
- Cross-exemplar similarity is computed only over each person's exemplars
  (`selectExemplars`, at most `FACE_LIMITS.maxExemplarsPerPerson` each), never
  over all observations.
- Excluded: any pair with an active decision whose two anchors sit in these two
  people (in either order); a pair where the two people are the same person; a
  person with zero visible observations.
- **Exclusion resolves anchors over the *full* observation set — hidden files
  included — and falls back to the stored person columns when an anchor no
  longer exists.** Visibility (ADR-0020) decides which people and which crops
  are *candidates*; it must never decide whether an answer counts. If the
  anchor's own file is hidden while its person stays visible, resolving over
  the visible set alone would lose the mapping and the app would ask a
  question the user already answered — a G-2 violation.
  `buildPeoplePairCandidates` therefore takes two observation collections:
  `visibleObservations` (ranking, counts, contact sheets) and
  `anchorObservations` (the full set, used only to map a decision's two anchors
  onto two person ids).
- `expectedValue = similarityWeight × log2(1 + countA) × log2(1 + countB)`,
  where `similarityWeight = min(1, max(0, (similarity - askLow) / (cut -
  askLow)))` and `similarity` is the larger of the centroid and best-exemplar
  similarity. A pair at or above the cut saturates at `similarityWeight = 1`.
- Sort: `expectedValue` descending, then `similarity` descending, then
  `personAId` ascending, then `personBId` ascending. Fully deterministic.
- `pending` is the number of candidates before the `limit` slice; `truncated`
  is `pending > limit`.

**Contact-sheet rule (`selectPairReviewCrops`).** The selector is defined over
the person's observations **that have a crop path** — `cropPath` is
`string | null` on `ExemplarCandidate` / `FaceObservationSummary`
(`core/domain/faces.ts`), and an observation with no crop cannot be shown — and
returns up to `PAIR_REVIEW_CROPS_PER_PERSON` of them, chosen for diversity
rather than for quality alone, because ADR-0018's calibration amendment is
explicit that a contact sheet of the top-quality crops hides exactly the tail
that reveals a mixed cluster: at most one crop per fingerprint while
alternatives exist, then three from the highest-quality end, one from the
median, and two from the lowest-quality end; ties broken on `obsId`. (The
quality tail is the whole rule; the "smallest box" half of ADR-0018's visual
audit is not available here, because the projection this route reads —
`FaceObservationSummary` — carries no bbox.) **The returned list is ordered
highest-quality first.**

**The decision anchor is the first entry of this selector's output, and that is
the only definition of it.** `selectExemplars` (`core/domain/faces.ts`) sorts on
quality alone and is *not* restricted to crop-bearing observations, so its first
entry can be an observation the contact sheet never showed — the exact case
`personView` in `core/server/usecases/faces.ts` already has to handle when it
filters `totals.exemplars` down to the ones with a non-null `cropPath`. Defining
the anchor as `selectExemplars(...)[0]` and the sheet as a crop-bearing
selection would leave the two silently disagreeing whenever the top-quality
observation has no crop. One selector, one rule: the anchor is
`selectPairReviewCrops(observations)[0]`, so ADR-0018 D9's "the crop the user
was looking at" is literally true by construction rather than by an alignment
that can drift.

Fewer than six crop-bearing observations yields fewer crops; zero yields an
empty list and the card falls back to the existing placeholder gradient — and a
person in that state has no anchor from this selector, which US-A4 step 2
handles explicitly.

**Acceptance criteria.**

- [ ] Two people whose centroids sit exactly at `askLow` produce a candidate;
      at `askLow - 0.001` with no strong exemplar pair they do not.
- [ ] A pair with a `different` decision on any observation pair spanning the
      two people is absent from the output.
- [ ] The same pair stays absent when the anchor observation's file is hidden
      while both people remain visible — the anchor is resolved over
      `anchorObservations`, not over `visibleObservations`.
- [ ] A `skip` decided 29 days ago suppresses the pair; the same decision at 31
      days does not.
- [ ] Ranking: given three synthetic pairs with hand-computed expected values,
      the output order is exact, and shuffling the input people leaves it
      unchanged.
- [ ] `selectPairReviewCrops` prefers distinct fingerprints, includes the
      lowest-quality observation when six or more exist, and is deterministic.
- [ ] `selectPairReviewCrops` returns only crop-bearing observations, orders
      them highest-quality first, and — given a set whose highest-quality
      observation has `cropPath: null` — puts the highest-quality
      **crop-bearing** one first, which is therefore a different observation from
      `selectExemplars(...)[0]` over the same set (FR-5).
- [ ] Scale guard: 3000 synthetic people with five exemplars each produce a
      capped queue while visiting each unordered pair exactly once (asserted by
      a counting callback, not by wall time).

**RED-first.** The ranking and exclusion tests are written against a stub that
returns an unranked list and observed failing.

---

### US-A3: `GET /api/faces/pairs`, the `faces_pair_scope` config key

**As** a user, **I want** the app to tell me how many questions it has,
**so that** the entry point can appear only when it is worth appearing.

**Scope.**

- `core/domain/config.ts`: `faces_pair_scope` added to `CONFIG_KEYS`, to
  `APP_GLOBAL_CONFIG_KEYS`, to `configValueSchema`
  (`z.enum(['careful', 'standard', 'wide']).default('standard')`; `configSchema`
  is the transform over it and needs no edit of its own), and to
  `configDescriptions` ("How eagerly Osoby proposes people to compare"); the
  matching entry in `core/domain/config-descriptor.ts` is `'excluded'`, like
  `faces_enabled`, because it shapes no analysis output and must not move
  `configId`.
- **Adding a `ConfigKey` touches eight files, not two.** The rule is *mirror
  `faces_enabled` in the eight files below* — `grep -rn faces_enabled` is how to
  **find** the config plumbing, not a set-equality test: `faces_enabled` is also
  named in the doctor, the wizard, `use-faces-index.ts`, `smoke.ts` and a long
  tail of tests, none of which have any business knowing about
  `faces_pair_scope`. The checklist is the authority, so the work is
  implementable from this document:

  | File | What to add |
  |---|---|
  | `core/domain/config.ts` | the `configValueSchema` field, `CONFIG_KEYS`, `APP_GLOBAL_CONFIG_KEYS`, `configDescriptions` |
  | `core/domain/config-descriptor.ts` | `faces_pair_scope: 'excluded'` |
  | `core/contract/routes.ts` | all **three** config response schemas — raw (`z.string().nullable()`), effective (`z.string()`), sources (`z.enum(['folder', 'home', 'default'])`) |
  | `core/server/usecases/shared.ts` | the parse `switch` case, the null-defaults map, the `stringifyConfigDefault` map |
  | `core/server/usecases/config-resolution.ts` | the sources map default (`'default'`) |
  | `apps/web/src/features/settings/settings-model.ts` | `draftFromStored`'s raw object (`config.faces_pair_scope ?? defaults.faces_pair_scope`) |
  | `apps/web/src/test/config-response.ts` | the renderer fixture's key list |
  | `README.md` (the package documenting `config set`) | the key, documented for the reader (review-enforced; `doc-lint` does not check config keys) |

  Adding the key to `CONFIG_KEYS` widens `ConfigKey`, and the four maps typed
  against it fail the typecheck until they are updated: `configDescriptions`
  (`Record<ConfigKey, string>`), `config-descriptor.ts`'s map
  (`satisfies Record<ConfigKey, 'identity' | 'excluded'>`), `shared.ts`'s
  `emptyStoredConfig` and `storedDefaults`, and `config-resolution.ts`'s
  `defaultSources`. The compiler stops there. The
  three `routes.ts` schemas are plain `z.object` literals, so a forgotten key is
  **silently stripped** from the config responses; `draftFromStored` is a plain
  object literal fed to `safeParse`, so a forgotten key silently falls back to
  the schema default and the control looks stuck. Wave A therefore also adds a
  test asserting that `GET /api/config` returns `faces_pair_scope` in all three
  response shapes, and Wave B one asserting the control renders the persisted
  value — the two gaps the compiler will not close. The `README.md` line has no
  gate at all: `scripts/doc-lint.ts` checks `pnpm run <script>` references, ADR
  claim markers, offset pagination and leaked delimiters, never config keys, so
  that row is enforced by review.
- `core/server/usecases/faces-pairs.ts` (new): `facesPairs(deps, input)` —
  guards on `ensureFacesEnabled`, assembles the same *visible* people set
  `facesPeople` assembles (hidden fingerprints from both stores removed,
  people with zero visible observations dropped, per ADR-0020), loads both
  observation sets (`visibleObservations` and the unfiltered
  `anchorObservations`) and the active decisions, resolves `askLow` from
  `faces_pair_scope`, calls `buildPeoplePairCandidates`, and re-anchors every
  crop path through the existing `reanchorFaceCropPath`.
- **The observation load is W100's embedding-free projection, not a full
  observation read.** W100 split `GlobalCatalogStore.listFaceObservations` from
  `listFaceObservationSummaries()` (`core/server/ports.ts`), whose
  `FaceObservationSummary` carries `obsId`, `fingerprint`, `quality`,
  `cropPath`, `personId` and `media` and **no embedding**, precisely so the
  Osoby surfaces stop paging every embedding in to answer a counting question;
  `totalsByPerson()` (`core/domain/faces.ts`) turns that projection into per
  person counts, file counts and `selectExemplars` output. `facesPairs` builds
  on the same two: both observation sets are `FaceObservationSummary[]`, the
  counts and contact sheets come from `totalsByPerson`, and the anchors are
  resolved on `personId`. Re-reading the full observation rows here would undo
  W100's fix on the busiest people surface.
- **Embeddings enter only where the ranking needs them.** Centroids come from
  `listPeople()` (`Person.centroid`), which is already loaded. Cross-exemplar
  cosines need real vectors, so the route resolves the exemplar `obsId`s from
  `totalsByPerson` first and loads **only those** embeddings — at most
  `FACE_LIMITS.maxExemplarsPerPerson` (5) per person — passing them to the
  domain function as a plain `ReadonlyMap<string, Float32Array>`, which keeps
  `buildPeoplePairCandidates` pure and keeps the read bounded by people rather
  than by observations.
- Contract:

  ```ts
  export const facesPairsInputSchema = z.object({
    limit: z.coerce.number().int().positive().max(PAIR_REVIEW_MAX_LIMIT)
      .default(PAIR_REVIEW_DEFAULT_LIMIT),
  });

  export const facesPairPersonSchema = z.object({
    personId: z.string().min(1),
    displayName: z.string().nullable(),
    fallbackIndex: z.number().int().nonnegative(),
    observationCount: z.number().int().nonnegative(),
    fileCounts: z.object({
      video: z.number().int().nonnegative(),
      photo: z.number().int().nonnegative(),
    }).strict(),
    cropPaths: z.array(z.string().min(1)).max(PAIR_REVIEW_CROPS_PER_PERSON),
  });

  export const facesPairCandidateSchema = z.object({
    a: facesPairPersonSchema,
    b: facesPairPersonSchema,
    similarity: z.number(),
    centroidSimilarity: z.number(),
    bestObservationSimilarity: z.number(),
    expectedValue: z.number(),
    aboveClusterCut: z.boolean(),
    survivorIfSame: z.string().min(1),
  });

  export const facesPairsOutputSchema = z.object({
    scope: z.enum(['careful', 'standard', 'wide']),
    askLow: z.number(),
    clusterCut: z.number(),
    pending: z.number().int().nonnegative(),
    truncated: z.boolean(),
    candidates: z.array(facesPairCandidateSchema),
  });
  ```

- **`fallbackIndex` is the index `facesPeople` assigns**, not a position in the
  pair queue, and the assignment order matters. `core/server/usecases/faces.ts`
  does `people.value.map((person, index) => personView(person,
  totals.get(person.personId), currentCatalogDir, index)).filter((person) =>
  person.observationCount > 0)` — **map first, filter second**, so the index is
  the person's position in `listPeople()` order **including** the people the
  zero-visible-observation filter then drops. A route that builds the visible
  list first and numbers it afterwards produces different numbers than the grid
  for every person that follows a dropped one. Do **not** re-derive the
  numbering: extract `facesPeople`'s builder into a shared helper in
  `core/server/usecases/faces.ts` — the map-then-filter pipeline over
  `listPeople()`, the `totalsByPerson` map built from the visible
  `FaceObservationSummary` set, and the catalog directory — and have both
  `facesPeople` and `facesPairs` call it, so there is one numbering and no way
  for the two routes to disagree.
- **The rendered label is `fallbackIndex + 1`.** `PeopleView.tsx` passes
  `person.fallbackIndex` to `dictionary.people.personName`, which is
  `` `Osoba ${index + 1}` `` / `` `Person ${index + 1}` ``, so the person the
  API reports as `fallbackIndex: 6` is the card labelled "Osoba 7". US-A7's CLI
  label prints `Person <fallbackIndex + 1>` for exactly that reason — the same
  arithmetic, so the CLI names the card the user sees.
- The number **shifts after a merge** — every person past the merged-away one
  moves down — which is why a spec identifies a pair by `data-person-id` and not
  by the label (US-B2, US-B5).
- **`survivorIfSame` is the person id FR-25 keeps by default**, computed on the
  server from the same rule the decide route applies when no
  `survivorPersonId` is given (named wins; then more observations; then the
  lexicographically smaller `personId`). It exists so the named-versus-named
  confirmation dialog (US-B3) can *preselect* the surviving name without the
  renderer re-deriving the direction rule — one rule, one place, and no way for
  the dialog to promise a different outcome than the route delivers. On a
  named/named pair the dialog may move the selection, and then it sends
  `survivorPersonId` explicitly; everywhere else `survivorIfSame` is the
  outcome.
- `apps/server/src/app.ts`: `app.get(API_ROUTES.facesPairs.path, …)` parsing
  `queryInput(context)`, exactly like `libraryCollection`.

**Acceptance criteria.**

- [ ] With faces disabled, every `/api/faces/pairs*` route answers
      `faces_disabled` — HTTP **409**, CLI exit **41** — the existing mapping,
      with no new error kind.
- [ ] A person whose every file is hidden never appears in a candidate, and
      hiding one of two files leaves the person present with reduced counts —
      the ADR-0020 rule, pinned by a test.
- [ ] `faces_pair_scope=careful` returns a strict subset of the `standard`
      queue over the same catalog; `wide` a superset.
- [ ] `pending` counts the whole queue and `truncated` is true when it exceeds
      `limit`, while `candidates` never exceeds `limit`.
- [ ] Crop paths in the response resolve under the current catalog directory
      after the catalog has been moved (the `reanchorFaceCropPath` case).
- [ ] For every candidate, each side's `fallbackIndex` equals the
      `fallbackIndex` `GET /api/faces/people` reports for the same
      `personId` over the same catalog — asserted by a test that calls both
      routes over a catalog that **contains at least one person with zero
      visible observations positioned before the candidates in `listPeople()`
      order**, because that is the only fixture in which a
      filter-then-number implementation differs from the map-then-filter one.
- [ ] `survivorIfSame` equals the `survivingPersonId` that
      `POST /api/faces/pairs/decide` with `same` and **no** `survivorPersonId`
      returns for that pair, over the named/unnamed, unnamed/unnamed and
      equal-size cases.
- [ ] `GET /api/config` reports `faces_pair_scope` in the raw, effective and
      sources shapes.
- [ ] Budget: over a catalog of 3000 people the route answers in under 400 ms
      on the reference machine, measured in the scale test as a recorded
      number, not asserted as a wall-clock threshold. If the budget is missed,
      the sanctioned fallback is a composition-owned in-memory candidate cache
      keyed by a people-revision token — never a smaller band.

---

### US-A4: `POST /api/faces/pairs/decide` and the undo route

**As** a user, **I want** my answer applied at once, **so that** the next
question is asked against the corrected state.

**Scope.** `core/server/usecases/faces-pairs.ts`:

- `facesPairsDecide(deps, { personAId, personBId, decision, survivorPersonId })`:
  1. Reject `personAId === personBId` with `validation` (the generator never
     emits a self-pair, the CLI can be typed one), then resolve both people;
     an unknown id → the existing `not_found`. Faces disabled → the existing
     `faces_disabled` (HTTP 409, CLI exit 41), like every other faces route.
  2. Resolve the two **anchors** through the *same* selector the contact sheet
     uses: the anchor is `selectPairReviewCrops(observations)[0]` — the
     highest-quality **crop-bearing** observation, ties on `obsId` — so the
     anchor is by construction the first crop of the sheet the user was looking
     at, and D9's sentence holds without a second rule to keep aligned. The
     ordered fallback chain, because `cropPath` is nullable and a person can
     legitimately have none:
     1. `selectPairReviewCrops(visible)[0]` — the person's **visible**
        observations, the same set the contact sheet was built from.
     2. `selectPairReviewCrops(all)[0]` — its full observation set, when every
        crop-bearing observation sits in a hidden file (reachable only from the
        CLI, where no contact sheet was shown).
     3. `selectExemplars(all)[0]` — when the person has observations but **no**
        crop at all. The card showed a placeholder gradient in that case, so
        there is no crop to point at; a top-quality observation is still a
        stable, deterministic anchor, and the review card told the user exactly
        as much as this anchor claims.
     A person with no observations at all is a `validation` error — it cannot be
     a party to a decision. (This is the *write* side only. US-A2's exclusion
     reads an already-stored row's anchors over the **unfiltered**
     `anchorObservations`, so hiding the file behind an anchor keeps the pair
     suppressed instead of resurrecting it; the two rules are about different
     moments, not in conflict.)
  3. `different` / `skip` → record the row (`source: 'user'`), no merge.
  4. `same` → **merge first, record second, both inside the same
     `withCatalogWriteLock` section and the same store transaction — the
     transaction is `GlobalCatalogStore.withBatch`** (`core/server/ports.ts`;
     `BEGIN` / `ROLLBACK` / `COMMIT` in `adapters/db/global-catalog.ts`, the
     same wrapper `library-trash.ts` uses, and re-entrant, so nesting the
     merge's own writes inside it is safe). The merge is the part that can
     fail; a row written before it would leave a `same` decision with no merge
     behind it — the pair excluded from the queue while the two people stay
     apart, and must-linked by the next rebuild. A failed merge therefore
     writes **no** row and the route returns the merge's own error unchanged.
     (The person-column re-key happens inside `mergePeople`'s write — US-A6 —
     not as a second pass here.)
     - **The merge inside the batch is `deps.globalCatalog.mergePeople(...)`,
       never the `facesMerge` use-case.** W101 made `facesMerge`
       (`core/server/usecases/faces.ts`) call `deps.globalCatalog.flush()`
       immediately after `mergePeople`, and a flush inside an open batch is
       fatal: `flush()` → `persist()` → `persistDatabase()` →
       `client.export()`, and sql.js implements `export()` by closing and
       reopening the database handle, which **rolls the open
       `BEGIN TRANSACTION` back**; `withBatch`'s later `COMMIT` then has no
       transaction to commit and the decision row and the merge are both lost.
       The two guards `facesMerge` adds over the store call —
       `ensureFacesEnabled` and the self-merge `validation` — are already
       performed by `facesPairsDecide` step 1, so calling the store method
       directly loses nothing. The same rule binds
       `faces pairs import --apply-merges` (US-A7): it merges through
       `deps.globalCatalog.mergePeople(...)` inside its batch, never through
       `facesMerge`.
     - **No `flush()` is issued between `BEGIN` and `COMMIT`.** Durability is
       the caller's job: `withCatalogWriteLock` in `apps/server/src/app.ts`
       flushes both stores after `run()` returns, which is exactly where the
       batch has already committed. The rule generalizes — any use-case that
       opens a `withBatch` must call store methods, not the flushing
       use-cases layered over them.

     Two ordering facts the implementation depends on:
     - **The anchors are resolved in step 2, before the merge**, because after
       it the merged-away person no longer exists and its exemplar list cannot
       be recomputed. The row's anchors are the two observations the user was
       actually looking at, one from each of the two pre-merge people.
     - **The recorded `same` row carries the survivor's id in both person
       columns.** That is not a degenerate row: FR-1's key is the observation
       pair, the person columns are the refreshed non-authoritative copy, and
       after a merge both anchors genuinely belong to the survivor. FR-7's
       "delete a row whose person columns become equal" is scoped to
       `different` rows only and never touches this one.
  5. Return the updated `pending` count and, for a merge, the merge output.
- **Merge direction is derived by default and overridable through the API.**
  The API accepts either pair member as `survivorPersonId`, regardless of names.
  The GUI offers the override only for named/named pairs. The derived survivor is the named one; if both or
  neither are named, the one with more observations; ties on the
  lexicographically smaller `personId`. That is the rule `survivorIfSame`
  (US-A3) publishes, and it is what the route applies when the caller says
  nothing.
- **The optional `survivorPersonId` is the override.** W101 stopped guessing
  here: "Scal wybrane" now *asks* which name wins whenever two or more selected
  people are named (`mergeNameChoice` radio in
  `apps/web/src/features/people/PeopleView.tsx`, over
  `mergeNameChoices(selected)` from
  `apps/web/src/features/people/core/merge-target.ts`). The pair flow aligns
  rather than reintroducing a silent pick: `survivorPersonId` is optional, and
  when present must be `personAId` or `personBId` — anything else is a
  `validation` error and writes no row. When it is absent the derived rule
  applies unchanged to every caller that omits the override.
- **The derived rule is not `defaultMergeTarget`.** That helper tiebreaks on
  *selection order* (its `reduce` keeps the incumbent on an equal
  `observationCount`), which is meaningless for a server-generated pair; the
  route tiebreaks on the lexicographically smaller `personId` so the same
  catalog always yields the same survivor. The renderer therefore never calls
  `defaultMergeTarget` in this flow — it reuses `mergeNameChoices` for the radio
  options and the server's `survivorIfSame` for the preselection (US-B3).
- `facesPairsUndo(deps)`: takes the single most recent decision row **whose
  `source` is `'user'`** — an `import` row is invisible to undo, so Backspace
  can never delete a corpus constraint the user never saw. A `same` row is
  **not** undone — the output carries `undone: false` and
  `reason: 'merge_not_undoable'`, a successful envelope rather than an error,
  so no new `ErrorCode` or exit code is introduced. A `different` or `skip` row
  is deleted and the output carries the pair that returns to the queue. Undo is
  one step, never a stack: after a `merge_not_undoable` refusal the renderer
  disables the undo control until the next `different` or `skip` answer,
  because every further Backspace would hit the same `same` row and would never
  reach the `different` recorded before it.
- Contract:

  ```ts
  export const facesPairsDecideInputSchema = z.object({
    personAId: z.string().min(1),
    personBId: z.string().min(1),
    decision: peoplePairDecisionKindSchema,
    survivorPersonId: z.string().min(1).optional(),
  });

  export const facesPairsDecideOutputSchema = z.object({
    decision: peoplePairDecisionKindSchema,
    personAId: z.string().min(1),
    personBId: z.string().min(1),
    merge: facesMergeOutputSchema.nullable(),
    survivingPersonId: z.string().min(1).nullable(),
    pending: z.number().int().nonnegative(),
  });

  export const facesPairsUndoOutputSchema = z.object({
    undone: z.boolean(),
    reason: z.enum(['none_to_undo', 'merge_not_undoable']).nullable(),
    personAId: z.string().min(1).nullable(),
    personBId: z.string().min(1).nullable(),
    pending: z.number().int().nonnegative(),
  });
  ```

- Both POST routes run inside `withCatalogWriteLock`, as `facesMerge` already
  does, and it is that wrapper — not the use-case — that flushes; the merge
  write itself (`GlobalCatalogStore.mergePeople`) is unchanged code.

**Acceptance criteria.**

- [ ] `decide` with `personAId === personBId` fails with `validation` (HTTP
      400, the taxonomy's existing mapping) and writes no row.
- [ ] `same` on an unnamed 3-observation person and a named 9-observation
      person returns `survivingPersonId` equal to the **named** person's
      `personId`, that person holds 12 observations and the name, and the
      unnamed id is gone. The assertion is on the surviving **id**, not on
      "someone carries the name": `mergePeople`
      (`adapters/db/global-catalog.ts`) copies `from.displayName` onto the
      target when the target is unnamed, so a merge in the wrong direction also
      leaves a person carrying the name and a name-only assertion passes on it.
- [ ] `same` with `survivorPersonId` naming the *smaller*, unnamed person of a
      named/unnamed pair keeps that id as `survivingPersonId` — the override
      beats the derived rule — and the surviving person carries the name.
- [ ] `same` with a `survivorPersonId` that is neither `personAId` nor
      `personBId` fails with `validation`, performs no merge and writes no row.
- [ ] `same` on two unnamed people keeps the larger; on an equal-size pair it
      keeps the lexicographically smaller id.
- [ ] `different` writes one row and the same pair is absent from the next
      `GET /api/faces/pairs`, before and after a process restart.
- [ ] For a person whose highest-quality observation sits in a hidden file, the
      recorded anchor equals the first crop `GET /api/faces/pairs` returned for
      that person; for a person with no visible observations (CLI-only path)
      the anchor is `selectPairReviewCrops` over its full set.
- [ ] For a person whose highest-quality observation has `cropPath: null` while
      a lower-quality one has a crop, the recorded anchor is the **crop-bearing**
      one and equals the first entry of that person's `cropPaths` in
      `GET /api/faces/pairs` — the case a `selectExemplars(...)[0]` anchor gets
      wrong.
- [ ] For a person whose observations all have `cropPath: null`, the decision
      still records an anchor (`selectExemplars` over the full set), the pair
      renders with the placeholder gradient, and no error is returned.
- [ ] Deciding the same pair twice updates one row rather than inserting two,
      and the later decision wins.
- [ ] Undo after `different` restores the pair to the queue; undo after `same`
      returns `undone: false, reason: 'merge_not_undoable'` with HTTP 200 and
      changes nothing; undo on an empty table returns `none_to_undo`.
- [ ] With only `source: 'import'` rows in the table, undo returns
      `none_to_undo` and deletes nothing; a later `source: 'user'` row is the
      one undo takes even when an import row is newer.
- [ ] Deciding `same` on a pair that a `different` row already covers succeeds
      and replaces the row — a correction path exists.
- [ ] A `same` whose merge fails (injected store failure) leaves
      `people_pair_decisions` untouched and returns the merge's error; the
      pair is still offered by the next `GET /api/faces/pairs`.
- [ ] The `same` path issues **no `flush()` between `BEGIN` and `COMMIT`**:
      against a fake `GlobalCatalogStore` whose `withBatch` increments a batch
      depth around the operation and whose `flush()` returns a failure while
      that depth is greater than zero, `POST /api/faces/pairs/decide` with
      `same` still succeeds. The fakes in
      `test/server/usecases/test-fakes.ts` and
      `apps/server/src/test-support/in-memory-deps.ts` currently run `withBatch`
      as a bare `operation()` with no depth tracking, so the counter is added
      there. The same probe covers `faces pairs import --apply-merges`. This is
      the test that fails if either path is re-pointed at `facesMerge`.

---

### US-A5: Constrained recluster and name carrying

**As** a user, **I want** a rebuild to honour what I already told the app,
**so that** a review session is not thrown away by the next recluster.

**Scope.**

- `core/domain/faces.ts`: `FaceClusteringOptions` gains
  `constraints?: { mustLink: readonly (readonly [string, string])[]; cannotLink:
  readonly (readonly [string, string])[] }` (observation-id pairs).
  - **Must-link** pairs are pre-unioned before the agglomerative loop, so the
    initial clusters are the must-link components rather than singletons.
    Components are ordered by their smallest member `obsId`; determinism is
    unchanged.
  - **Cannot-link** pairs forbid a merge: a candidate merge whose union would
    contain both endpoints of a cannot-link pair is rejected and the next
    candidate is taken. Each cluster carries the small set of constrained
    observation indices it holds, so the check is proportional to the number of
    constraints, not to cluster size.
  - A cannot-link pair that already sits inside one must-link component is a
    **conflict**: the must-link wins (it is the statement the user made about
    the identity, and a "Tak" has already been materialized as a merge), and
    the pair is counted and returned rather than silently dropped.
  - Constraints referencing an observation that no longer exists are ignored
    and counted.
- `core/server/usecases/faces.ts` `runFacesReclusterPass` loads the active
  decisions and maps `same` → must-link and `different` → cannot-link (`skip`
  is never a constraint) before calling the clusterer.
- **The person columns are refreshed inside the store write that replaces the
  people, not by a follow-up pass.** `GlobalCatalogStore.replaceFaceClustering`
  (`adapters/db/global-catalog.ts`) already deletes every person, writes the new
  ones and re-points every observation in one transaction; re-reading each
  decision row's two anchors from the new assignments and writing the resulting
  person ids happens in that same write, exactly as US-A6 requires of every
  other decision-touching write. An anchor the rebuild left in
  `unassignedObsIds` writes `null`, which neither deletes the row nor weakens
  the constraint at the *next* rebuild. Doing it afterwards would open a window
  in which the rows point at person ids the store has already deleted, and a
  crash inside that window would leave them there permanently.
- **Name carrying (revises ADR-0018 D6).** For each pre-rebuild person `P` with
  a name, let `S(P)` be its observations that still exist. The name is carried
  to new person `Q` when the map is one-to-one and total on both sides: every
  member of `S(P)` is a member of `Q`, and every member of `Q` that existed
  before the rebuild **and was assigned to some person then** belonged to `P`.
  Otherwise the name is dropped and reported. Two old named people landing in
  one new person drop both names and count as a name conflict.
- **Previously unassigned observations are exempt from the second half of the
  test.** An observation that existed before the rebuild with `personId = null`
  — the previous rebuild's `unassignedObsIds`, and anything the incremental
  path never placed — carried no identity, so absorbing it into `Q` cannot mean
  the name now points at a different set of people. Without the exemption the
  common case (a named person that simply gains a few stragglers) would lose
  its name for no reason. Freshly indexed observations are exempt for the same
  reason.
- `facesReclusterOutputSchema` gains `constraintsApplied: { mustLink: number;
  cannotLink: number }`, `constraintConflicts: number`, `constraintsStale:
  number` and `nameConflicts: number`; `namesCarried` (already present, always
  `0` today) becomes real and `namesDropped` keeps listing the rest.

**Acceptance criteria.**

- [ ] Two synthetic identities the clusterer merges at the chosen threshold
      stay apart when a cannot-link pair spans them; the run reports
      `cannotLink: 1`.
- [ ] Two synthetic clusters the clusterer leaves apart become one when a
      must-link pair spans them, and the merged cluster's centroid is the
      centroid of the union.
- [ ] Determinism holds with constraints: shuffled input, identical person ids
      and membership.
- [ ] A must-link component containing a cannot-link pair produces
      `constraintConflicts: 1`, keeps the component, and does not throw.
- [ ] A named person whose observations land intact in exactly one new person
      keeps its name (`namesCarried: 1`, `namesDropped: []`); the same person
      split across two new people loses it and is listed in `namesDropped`.
- [ ] A named person that keeps all its observations **and absorbs an
      observation that was unassigned before the rebuild** still keeps its name
      (`namesCarried: 1`); replacing that observation with one that belonged to
      a different person before the rebuild drops the name instead.
- [ ] A dry run reports the same constraint and name numbers as the real run
      over the same input and writes nothing.
- [ ] Decision rows survive the rebuild with refreshed person columns and the
      same anchors.
- [ ] A rebuild that leaves one anchor unassigned writes `null` into that
      person column, keeps the row, and the same constraint is still applied
      by the next rebuild.

---

### US-A6: Decision hygiene across merge, forget, purge and trash

**As** the app, **I want** decision rows to never outlive their subject,
**so that** the queue cannot be poisoned by rows about people or observations
that no longer exist.

**Scope.** Inside the existing transactions, never as a follow-up pass:

- `GlobalCatalogStore.mergePeople`'s result type (`core/server/ports.ts`)
  gains `decisionsInvalidated: number` alongside `movedObservations` and
  `affectedFingerprints`, so the count comes out of the same write that
  produced it and neither `facesMerge` nor the decide route needs a second
  query to report it.
- `mergePeople` re-keys `person_a_id` / `person_b_id` from the merged-away id
  to the surviving id. A `different` row whose two person columns are **made**
  equal by that re-key is **deleted** and counted, because an explicit merge is
  the newer and stronger statement; the count is returned as
  `decisionsInvalidated` on the merge output and surfaced by `faces merge` and
  by the decide route. The deletion belongs to this path alone: an import that
  *finds* a `different` pair already inside one person keeps its row (FR-7,
  US-A7).
- **Three** store writes delete face observations, and each one must delete the
  decision rows anchored on them. Naming only two of them would leave a live
  hole, so all three are listed:
  - `GlobalCatalogStore.forgetPerson` (`adapters/db/global-catalog.ts`) — the
    `faces forget <person>` path.
  - `GlobalCatalogStore.deleteFaceObservationsForFile` — the **photos** leg of
    the W88 trash flow (`core/server/usecases/library-trash.ts`
    `deletePhotoRecords`) and the stale-engine re-index path in
    `core/server/usecases/faces.ts` (both the video and the photo candidate
    handlers call it when `previousEngineVersion < FACE_ENGINE_VERSION`).
  - `GlobalCatalogStore.forgetEntry` (`adapters/db/global-catalog.ts`,
    declared in `core/server/ports.ts`) — the **videos** leg of the W88 trash
    flow
    (`library-trash.ts` `deleteVideoRecords`) and `forgetCatalogEntry`
    (`core/server/usecases/catalog-index.ts`). This is the one an
    "observations are deleted by `deleteFaceObservationsForFile`" reading
    misses: `forgetEntry` deletes a file's `face_observations` rows directly.
  The deletion is **one store-level private helper**
  (`deleteDecisionsAnchoredOnObservations(db, obsIds)`) invoked inside each of
  those three writes, before the observation rows go, so a fourth deletion path
  added later has one obvious thing to call and cannot silently forget it. It is
  the same code the US-A1 port method
  `deletePeoplePairDecisionsForObservations` exposes — the port method is the
  test seam over this helper, not a second deletion path, and these three writes
  call the helper directly.
- Without this, a trashed video or a forgotten fingerprint would leave a row
  whose anchors are gone: FR-16 would fall back to the stored person columns,
  the pair would stay excluded from the queue **forever with no evidence behind
  it**, and every later rebuild would count it in `constraintsStale`.
- `purgeFaces` clears `people_pair_decisions` entirely; `faces purge` already
  destroys the evidence the decisions were made about.
- A `FACE_ENGINE_VERSION` bump therefore **loses decisions** (FR-8a): the
  re-index path re-extracts and re-mints observation ids, so the anchors cease
  to exist and the rows go with them. That is correct behaviour, not a defect,
  but it is user-visible and the bump's changelog line must say so.
- Hide is *not* in this list: hiding never deletes an observation, and a hidden
  person simply stops producing candidates (US-A3).
- `shouldMergePeople` (`core/domain/faces.ts`, currently exported and called
  from no production site) must consult the cannot-link set if it is ever
  wired into a live auto-merge path; the guard is specified here so the
  omission is a deliberate, documented gap rather than a discovered bug.

**Acceptance criteria.**

- [ ] After `faces merge A → B`, a decision that referenced `A` references `B`,
      with unchanged anchors and `decided_at`.
- [ ] A `different` decision between `A` and `B` is deleted by an explicit
      `faces merge A → B` and reported as `decisionsInvalidated: 1`.
- [ ] `faces forget` on a person removes every decision anchored on its
      observations and leaves unrelated rows untouched.
- [ ] Trashing a **photo** whose observation anchors a decision removes the row
      in the same store write as the observation
      (`deleteFaceObservationsForFile`).
- [ ] Trashing a **video** whose observation anchors a decision removes the row
      in the same store write as the observation (`forgetEntry`) — the case a
      `deleteFaceObservationsForFile`-only implementation gets wrong.
- [ ] `forget <fingerprint>` removes the decision rows anchored on that file
      and leaves rows anchored on other files untouched.
- [ ] Re-indexing a file whose `previousEngineVersion` is older than
      `FACE_ENGINE_VERSION` removes the decision rows anchored on it, and a
      following `faces recluster` reports `constraintsStale: 0` rather than
      counting the vanished anchors forever (FR-8a).
- [ ] `faces purge --force` leaves `people_pair_decisions` empty.
- [ ] Hiding every file of a person leaves its decision rows intact, and
      unhiding restores the same suppression behaviour in the queue.
- [ ] Hiding only the file behind a `different` decision's anchor, while both
      people stay visible, keeps the pair suppressed in
      `GET /api/faces/pairs`.

---

### US-A7: `faces pairs` CLI and the labelled-pairs import

**As** the owner, **I want** the whole flow from the CLI, **so that** a backlog
can be drained, scripted and audited without the GUI, and so that the pairs
already labelled by hand become constraints.

**Scope.** `apps/cli/src/main.ts`, under the existing `faces` command:

- `faces pairs list [--limit <n>] [--json]` — NDJSON `faces_pairs_list`
  started/completed; human output is one line per pair: rank, both person
  labels, observation counts, similarity, and a marker when the pair is above
  the cluster cut. The label is the `displayName` when there is one, otherwise
  **`Person <fallbackIndex + 1>`** — the `+ 1` is not cosmetic: the renderer's
  `personName` dictionary entry is `` `Osoba ${index + 1}` ``, so `Person 7`
  and "Osoba 7" name the same card and a CLI printing the raw `fallbackIndex`
  would be off by one against every screenshot. The CLI's messages are English,
  like `faces merge` and `faces name`; "Osoba N" is renderer copy only. An
  anchor with no current person prints `unassigned`.
- `faces pairs decide <personAId> <personBId> <same|different|skip> [--json]` —
  NDJSON `faces_pairs_decide`; human output states the decision and, for
  `same`, the surviving person and the moved observation count. The CLI exposes
  **no** survivor override: `survivorPersonId` is the GUI's named/named
  affordance (FR-26), and a scripted correction is `faces merge` in the wanted
  direction.
- `faces pairs import <path> [--apply-merges] [--dry-run] [--json]` — NDJSON
  `faces_pairs_import` started/completed. It reads the labelled-pairs corpus in
  the format `apps/cli/src/faces-benchmark.ts`
  already parses (`readLabelledPairs`: a JSON array of
  `{ left, right, verdict }` or a CSV of `left,right,verdict` where `verdict`
  is `same` / `different` / `unsure` / `not_face`, and `left` / `right` are
  **observation ids**). `same` becomes a must-link row, `different` a
  cannot-link row, `unsure` and `not_face` are skipped and counted. Rows are
  written with `source: 'import'`. The import **does not merge** by default —
  a corpus of hundreds of `same` labels would otherwise fire hundreds of
  merges in one command; `--apply-merges` opts in, and the constraints take
  effect at the next recluster either way. Those merges go through
  `deps.globalCatalog.mergePeople(...)` inside the import's own `withBatch`,
  never through the `facesMerge` use-case, for the reason US-A4 step 4 spells
  out: `facesMerge` flushes, and a sql.js flush inside an open batch rolls the
  transaction back. `--dry-run` reports the counts and writes nothing. A pair
  naming an unknown observation is skipped and counted
  as `unresolved` — "unknown observation", never "unassigned observation": an
  observation that exists but belongs to no person is imported normally, with
  a `null` person column.
- **A pair whose two observations already sit in one person is imported, and
  the count says which kind it was.** One number for both verdicts is
  unreadable, so it is split:
  - a `same` verdict there is `alreadyTogether` — the corpus agrees with the
    current partition and the row is a must-link the next rebuild will honour
    for free;
  - a `different` verdict there is **`conflicting`** — the corpus says the app
    has put two people into one card. That is the single most valuable row in
    the file and it is **kept**, even though its two person columns are equal
    at import time: the next rebuild reads it as a cannot-link and splits the
    two observations apart, which is precisely the report the corpus is making.
  This is not the row FR-7 deletes. FR-7 fires only when an **explicit merge
  makes** a `different` row's columns equal — a newer, stronger user statement
  overriding an older one. An import makes no such statement; it observes a
  pre-existing state. FR-7 is scoped accordingly.
- **The corpus id namespace is the native one, and the import does not
  translate.** `readLabelledPairs` returns whatever ids the file holds; the
  benchmark's `matchReferenceToNative` (`core/domain/faces-benchmark.ts`) is
  what remaps a *reference* corpus's `left` / `right` onto native `obsId`s, and
  it runs inside the benchmark script, not here. The import therefore accepts
  **native `obsId`s only**: a reference-keyed corpus resolves nothing and is
  reported as `unresolved` on every row. That is loud rather than silent — an
  `imported: 0, unresolved: 412` report is unmistakable — and remapping is
  **out of scope for W99**. If it is ever wanted, the shape is an
  `--reference <path>` option that runs the benchmark's existing matcher over
  the reference file first and imports the remapped pairs; it is listed as an
  open question, not built.
- Exit codes: the existing taxonomy only. `not_found` for an unknown person id
  in `decide`; `validation` for a malformed corpus file, and for a `decide`
  whose two person ids are equal.

**The file never reaches the server.** `readLabelledPairs` is promoted to an
export of `apps/cli/src/faces-benchmark.ts`, the CLI parses the path with it,
and the already-parsed array is posted to `POST /api/faces/pairs/import`. The
server therefore never opens an arbitrary filesystem path, and the contract
stays the only bridge — the same rule every other command follows. A parse
failure is a CLI-side `validation` error before any request is made.

```ts
export const facesPairsImportInputSchema = z.object({
  pairs: z.array(labelledPairSchema).min(1),
  applyMerges: z.boolean().default(false),
  dryRun: z.boolean().default(false),
}).strict();

export const facesPairsImportOutputSchema = z.object({
  dryRun: z.boolean(),
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  alreadyTogether: z.number().int().nonnegative(),
  conflicting: z.number().int().nonnegative(),
  merges: z.number().int().nonnegative(),
  decisionsInvalidated: z.number().int().nonnegative(),
});
```

`labelledPairSchema` is the existing schema in `core/domain/faces-benchmark.ts`
(re-exported from `@core/domain/index.js`), so the corpus format has exactly
one definition. `imported` counts rows written, `skipped` counts `unsure` and
`not_face` verdicts, `unresolved` counts pairs naming an observation that does
not exist (and therefore every row of a reference-keyed corpus),
`alreadyTogether` counts imported **`same`** pairs whose two observations
already share a person, `conflicting` counts imported **`different`** pairs
whose two observations already share a person — the corpus reporting a mixed
person — `merges` counts the merges `--apply-merges` performed (`0` without the
flag and on a dry run) and `decisionsInvalidated` propagates the US-A6 count
from those merges. `alreadyTogether` and `conflicting` are subsets of
`imported`, not alternatives to it; the human output prints `conflicting` on its
own line because it names work the next recluster will do.

**Acceptance criteria.**

- [ ] `smoke` gains a leg that runs `faces pairs list --json` against the
      in-process app and asserts the envelope shape and exit code on an empty
      catalog (`pending: 0`, `candidates: []`, exit 0).
- [ ] `faces pairs list` labels an unnamed person `Person <fallbackIndex + 1>`,
      the same number the Osoby grid renders as "Osoba N" for that
      `personId` — asserted against `GET /api/faces/people` over the same
      catalog, not against a hard-coded string.
- [ ] `faces pairs decide <a> <b> different --json` emits one started and one
      completed NDJSON line and exits 0; the same command with an unknown
      person id emits an error line and exits with the `not_found` code the
      taxonomy already maps.
- [ ] `faces pairs import` over a fixture corpus with one `same`, one
      `different`, one `unsure` and one row naming a missing observation
      reports `imported: 2, skipped: 1, unresolved: 1, merges: 0` and writes
      exactly two rows; `--dry-run` reports the same numbers and writes none.
- [ ] A corpus row naming an observation that exists but currently belongs to
      no person is `imported`, not `unresolved`, and its person column is
      `null`.
- [ ] A `same` row whose two observations already share a person is `imported`
      and counted in `alreadyTogether`; a `different` row whose two
      observations already share a person is `imported` and counted in
      `conflicting`, is **kept** in the table with both person columns equal,
      and the next `faces recluster --dry-run` reports it under `cannotLink`
      and splits the two observations apart — the FR-7 deletion never fires on
      an import.
- [ ] A corpus keyed on reference observation ids reports `imported: 0` with
      `unresolved` equal to the row count and writes nothing — the import does
      not guess a mapping.
- [ ] `faces pairs import --apply-merges` merges the `same` pairs and reports
      `merges` (plus any `decisionsInvalidated`); without the flag the people
      are untouched, `merges: 0`, and the next `faces recluster --dry-run`
      reports `mustLink` covering them.
- [ ] A malformed corpus file fails in the CLI with `validation` before any
      request is issued.
- [ ] `README.md` (the package that owns the CLI) documents the three
      subcommands — review-enforced; `doc-lint` checks `pnpm run <script>`
      references, ADR claim markers, offset pagination and leaked delimiters,
      not CLI subcommands, so there is no gate to lean on here.

**Changelog (Wave A, `[Unreleased]` → Added).**

- "Osoby can be reviewed pair by pair: the app proposes two people it believes
  may be the same, and the answer is stored — `same` merges them, `different`
  is a permanent constraint honoured by later rebuilds, `skip` hides the pair
  for 30 days."
- "`faces pairs list`, `faces pairs decide` and `faces pairs import` expose the
  pairwise people review from the CLI, including a one-off import of a labelled
  same/different pairs corpus."
- "`faces recluster` honours stored pairwise decisions as clustering
  constraints and carries a name across the rebuild when the old person maps
  one-to-one onto a new one."
- "`config set faces_pair_scope careful|standard|wide` tunes how eagerly Osoby
  proposes people to compare."

---

## WAVE B — renderer and e2e

Wave B adds no route and no migration. It consumes the Wave A contract through
bound actions and query hooks only.

**Renderer files:** `apps/web/src/features/people/PeopleView.tsx` (header
control and the review mode), `apps/web/src/features/people/PairReview.tsx`
(new), `apps/web/src/features/people/use-people-pairs.ts` (new),
`apps/web/src/api.ts` (`facesPairs`, `facesPairsDecide`, `facesPairsUndo`),
`apps/web/src/i18n/dictionary.ts` (PL + EN),
`apps/web/src/features/settings` (the scope control).

---

### US-B1: The "Ta sama osoba?" entry point in the Osoby header

**As** a user, **I want** to see at a glance that the app has questions,
**so that** I only enter the flow when it is worth entering.

**Scope.** A button next to "Scal wybrane" in the Osoby header
(`data-testid="people-pair-review-open"`), labelled with the pending count —
PL "Do sprawdzenia: 37" / EN "To review: 37" — and gated on exactly two rules,
which do not overlap.

**It must not collide with W100's two person-card entry points.** A click on a
person card's body (`people-card-body`) now leaves Osoby entirely and opens
Kolekcja filtered by that person (`onOpenInCollection`), and the card's
overflow menu carries "Podgląd plików" (`people-preview-files`, opening
`PersonMediaPanel`) next to "Szukaj w kolekcji" (`people-search-library`). The
review entry point is therefore a **header** control, not a card affordance and
not a menu item: it belongs to the grid as a whole, it is reachable with no
person selected, and it adds nothing to the card's click surface.

- **Presence** — rendered only when faces are enabled and `pending > 0`. Both
  are statements that there is nothing to ask; a disabled control promising
  zero questions is noise.
- **Enablement** — present but **disabled with the neighbouring
  `people-merge-selected`'s lock props**. That button reads
  `disabled={mergePlan === null || people.isBusy || mutationsBlocked}` and
  `title={lockReason}` (`PeopleView.tsx`): copy all of it **but the selection
  gate `mergePlan === null`**, which is W101's "at least two people ticked"
  rule and has no meaning for a control that opens a server-generated queue.
  The badge therefore carries `disabled={people.isBusy || mutationsBlocked}`
  and `title={lockReason}`. The two conditions have different explanations and
  only one of them has a tooltip:
  `lockReason` is `catalogLock.disabledReason` (passed down from
  `apps/web/src/routes/index.tsx`) and covers the **read-only catalog** only —
  `mutationsBlocked` is `lockReason !== undefined`, and the same string is
  already shown in the `people-read-only` alert. A **running faces job** blocks
  through `people.isBusy` with **no tooltip at all**; the `people-active-job`
  alert above the grid is what explains it. Copying the neighbour's props
  verbatim is the whole requirement — no new tooltip, no new alert. Hiding the
  control instead would make a queue the user can see the size of vanish for a
  reason nothing states.

Model readiness is deliberately *not* a gate: the queue is read from stored
embeddings and an answer is a database write, so nothing in the flow needs a
model loaded. The badge always shows the **uncapped** `pending`: the count is
exact and cheap, so there is no reason to round it to "200+" when the queue
slice is capped. The count comes from `use-people-pairs.ts`, a query hook over
`actions.facesPairs`; no inline query keys.

**Acceptance criteria.**

- [ ] With `pending: 0`, and with faces disabled, the control is absent from
      the DOM, not merely disabled.
- [ ] With `pending: 37` it renders the count in both dictionaries; with
      `pending: 437`, `truncated: true` and `limit: 200` it renders 437 — the
      cap changes the queue slice, never the badge.
- [ ] With `pending: 37` and a `lockReason` present the control is **rendered
      and disabled**, carrying that `lockReason` as its `title`, exactly like
      `people-merge-selected` in the same header.
- [ ] With `pending: 37`, no `lockReason`, no running job and **fewer than two
      people ticked**, the control is **enabled** — it does not inherit
      `people-merge-selected`'s `mergePlan === null` selection gate.
- [ ] With `pending: 37`, no `lockReason` and a running faces job
      (`people.isBusy`), the control is **rendered and disabled with no
      tooltip**, and `people-active-job` is the surface that explains it —
      matching `people-merge-selected` rather than inventing a second
      explanation.
- [ ] Renderer test drives it through the real button, not through the hook.

---

### US-B2: The review card — two people, two contact sheets, one question

**As** a user, **I want** everything I need to answer in one screen,
**so that** I never open a person to decide.

**Scope.** `PairReview.tsx`, rendered as a full-surface mode of Osoby
(`data-testid="people-pair-review"`) with a back control, mirroring the
existing folded-people mode — **the back control reuses the existing
`people-back-main` testid**, because it is the same "leave this sub-surface"
affordance and `PeopleView` renders it only for the folded mode today
(`foldedOpen`); review mode and folded mode are mutually exclusive, so exactly
one `people-back-main` is ever mounted. Opening the review surface closes the
fold, as switching the media filter already does — no new router route. The
Osoby header (title, sort, "Scal wybrane" and the "Ta sama osoba?" badge) stays
mounted above it, as it does in folded mode, so the badge count stays live while
answers land. Contents:

- The question as the heading (`data-testid="people-pair-review-question"`):
  "Czy to ta sama osoba?" / "Is this the same person?", with a **session
  progress** counter (`data-testid="people-pair-review-position"`), plus a
  one-line note when `truncated` is true: "pokazujemy pierwsze 200" / "showing
  the first 200".
- **The counter is defined exactly, because the queue is refetched after every
  answer.** US-B3 invalidates the queue on each answer, so the answered pair
  leaves the refetched slice and the current pair is always `candidates[0]`; a
  naive "1 z `candidates.length`" would read "1 z N", then "1 z N-1" — the
  badge's information, twice, with a denominator that also moves when a "Tak"
  reorders the ranking. The counter is therefore **work done this session**,
  not a position in a list:
  - `answeredThisSession` is a renderer counter, reset to `0` when the review
    surface opens, incremented by every answer the route accepted, and
    **decremented by a successful undo** (a refused `merge_not_undoable` undo
    changes nothing). It can never go below `0`, because undo is unavailable at
    `0` (US-B3).
  - The denominator is counted over the **renderer's working list**, not over
    `candidates.length` as the route returned it. The two differ in exactly one
    case: after an undo the renderer keeps the restored pair at the head of the
    queue (US-B3), and when the slice was truncated that pair may lie outside
    the refetched slice, making the working list one longer. Define
    `queueLength` as the length of the list the renderer is actually walking —
    the refetched `candidates` plus the restored pair when it is not already in
    them — and read the denominator off that.
  - The label is `answeredThisSession + 1` of
    `answeredThisSession + queueLength` — PL "`{n}` z `{total}`" / EN
    "`{n}` of `{total}`" — so the numerator counts up as the user works and the
    denominator only moves when the server queue does.
  - It renders nothing when the working list is empty; the empty state replaces
    the card.
  The header badge stays the **only** "how many are left" number, `pending`,
  uncapped; the counter is "how far you have got"; the `truncated` note is what
  explains why the denominator can be smaller than the badge.
- Two person panels side by side (`data-testid="people-pair-review-person-a"`
  and `-person-b`), each with: the name or the fallback "Osoba N" label used by
  the grid today, the file counts in the existing `personFileCountLabel`
  wording, and a contact sheet of up to six crops laid out as a grid, one
  `data-testid="people-pair-review-crop"` per crop inside its own panel; a
  person with no crops falls back to the existing placeholder gradient and
  glyph.
- Three buttons — Tak / Nie / Pomiń (`people-pair-review-same`,
  `people-pair-review-different`, `people-pair-review-skip`) — with their key
  hints (`1`, `2`, `3`), and an undo control
  (`people-pair-review-undo`) labelled with `Backspace`.
- A one-line caption under "Nie" stating that the answer is permanent:
  "Zapamiętamy, że to różne osoby" / "We will remember these are different
  people".
- Empty state when the queue drains
  (`data-testid="people-pair-review-empty"`): "Na razie nie ma o co pytać" /
  "Nothing to review right now", with the back control.
- All strings in both dictionaries; no raw colours; visual language from
  `theme.ts` only; island boundaries respected.

**Testids added by Wave B** — the complete list, so a spec can be written from
this document alone: `people-pair-review-open` (US-B1),
`people-pair-review`, `people-pair-review-question`,
`people-pair-review-position`, `people-pair-review-person-a`,
`people-pair-review-person-b`, `people-pair-review-crop` (repeated inside each
panel), `people-pair-review-same`, `people-pair-review-different`,
`people-pair-review-skip`, `people-pair-review-undo`,
`people-pair-review-empty` (US-B2), `people-pair-review-confirm` and
`people-pair-review-confirm-accept`, `people-pair-review-not-undoable`
(US-B3), `settings-faces-pair-scope` with `settings-faces-pair-scope-careful`
/ `-standard` / `-wide` (US-B4). The back control is the existing
`people-back-main`; no other existing testid is renamed.

**One non-testid attribute is added:** `people-pair-review-person-a` and
`-person-b` each render `data-person-id={person.personId}`, mirroring what
`people-card` already does. It is what lets a spec name the pair it answered
across a merge and a relaunch, since the "Osoba N" fallback label is a position
that shifts when a person disappears (US-A3, US-B5).

**Acceptance criteria.**

- [ ] Renderer test: given two candidates, the first pair's names, counts and
      six crop images render; answering advances to the second pair.
- [ ] A person with three observations renders three crops, not six padded
      slots.
- [ ] With three candidates the counter reads "1 z 3"; after one answer that
      drops the pair from the refetched queue it reads "2 z 3", and after the
      third it is replaced by the empty state — the numerator counts answers,
      the denominator holds still.
- [ ] The review surface is added to the `apps/web/visual.html` harness as its
      own skeleton case, and **both** baseline sets are produced, or `check`
      goes red on CI ([ADR-0005](../docs/decisions/0005-visual-regression.md)(f)):
      (a) locally, land the change then run `pnpm run visual
      --update-snapshots` and commit the reviewed `__screenshots__/darwin/`
      PNGs; (b) dispatch the `visual-baselines` workflow to render the
      `__screenshots__/ci-macos-15/` PNGs on the hosted runner and merge that
      baseline PR. Re-baselining CI is a workflow dispatch, never a tolerance
      change.

---

### US-B3: Keyboard, confirmation and undo

**As** a user, **I want** to answer with one keystroke, **so that** a backlog of
hundreds is drainable.

**Scope.**

- `1` = Tak, `2` = Nie, `3` = Pomiń, `Backspace` = undo the last answer. The
  listener is scoped to the review surface and ignores the event when the
  focused element is an input, a textarea or inside an open dialog, and while a
  decision mutation is in flight.
- **Confirmation only when both people are named, and it asks which name
  wins.** "Tak" on two named people opens a confirm dialog
  (`data-testid="people-pair-review-confirm"`, its accept button
  `people-pair-review-confirm-accept`) that states both names and that one name
  will survive. It **reuses W101's name-choice control verbatim**: the
  `dictionary.people.mergeNameChoice` label over a `RadioGroup` whose options
  are `mergeNameChoices([a, b])` from
  `apps/web/src/features/people/core/merge-target.ts` — the same helper and the
  same copy "Scal wybrane" uses in `PeopleView.tsx`, so the two merge paths ask
  one question in one wording. Accepting sends the selected id as
  `survivorPersonId`. In every other case "Tak" applies immediately with no
  dialog and no `survivorPersonId`.
- **The preselection is read from the candidate, never re-derived.** The radio
  opens on the person whose `personId` equals the candidate's `survivorIfSame`
  (US-A3). The renderer does **not** re-implement FR-25's `displayName` /
  `observationCount` / `personId` ordering, and does **not** call
  `defaultMergeTarget`, whose tiebreak is selection order rather than the
  smaller `personId`: a second copy of the rule is a second thing to keep in
  sync, and the failure mode is a dialog that promises one name and a merge
  that keeps the other.
- **Undo is scoped to this session's answers.** While
  `answeredThisSession === 0` the `people-pair-review-undo` control is
  **disabled** and `Backspace` calls no action at all — on a freshly opened
  surface (or after undoing back to zero) there is nothing on this screen to
  reverse. Without that gate the keystroke would delete the most recent stored
  `different` or `skip` from a previous session or from a
  `faces pairs decide` run — an answer the user never saw here — and drive the
  counter to `-1`. The route itself is unchanged and stays as US-A4 specifies
  ("the most recent `source: 'user'` row"): the CLI exposes no undo, so with
  this gate the route is only ever reached with a session answer behind it, and
  the renderer needs no session bookkeeping on the server.
- Undo of a `same` answer is not supported: the app shows a plain message
  (`data-testid="people-pair-review-not-undoable"`) — "Scalenia nie da się
  cofnąć" / "A merge cannot be undone" — instead of attempting it, driven by
  the route's `reason: 'merge_not_undoable'`, and the undo control goes
  disabled until the next "Nie" or "Pomiń" answer.
- An undone pair is shown immediately as the current pair — the renderer keeps
  the pair the undo route returned at the head of the queue rather than
  re-entering wherever the refreshed ranking places it, so Backspace visibly
  reverses the last keystroke.
- After each answer the pair queue is refreshed through the bound action, and
  a `same` answer also invalidates the people query so the grid behind the
  review mode is consistent when the user returns.
- The US-B2 `answeredThisSession` counter moves with the same events: `+1` on
  every accepted answer, `-1` on a successful undo, unchanged on a refused
  (`merge_not_undoable`) undo, reset to `0` when the surface is opened.

**Acceptance criteria.**

- [ ] Renderer test: pressing `1`, `2`, `3` calls the decide action with
      `same`, `different`, `skip` respectively, through real key events.
- [ ] Keystrokes inside the rename dialog's text field do not answer the
      question.
- [ ] `1` on a named/named pair opens `people-pair-review-confirm` and does not
      call the action until `people-pair-review-confirm-accept` is clicked;
      `1` on a named/unnamed pair calls it immediately.
- [ ] The confirm dialog preselects the person the candidate's
      `survivorIfSame` points at, including the case where that is person
      **B** — a renderer that always preselects A passes a one-sided fixture
      and fails this one — and accepting without touching the radio calls the
      decide action with `survivorPersonId` equal to that same id.
- [ ] Selecting the other named person in the dialog's radio and accepting
      calls the decide action with `survivorPersonId` equal to **that** id, not
      to `survivorIfSame`.
- [ ] On a freshly opened review surface (`answeredThisSession === 0`)
      `people-pair-review-undo` is disabled and `Backspace` calls **no** action —
      asserted with a spy on the undo action, not only on the disabled
      attribute — and the counter never reads a negative numerator.
- [ ] `Backspace` after "Nie" shows that same pair again as the current pair
      and the counter returns to its pre-answer reading ("2 z 3" → "1 z 3");
      after "Tak" it renders `people-pair-review-not-undoable`, leaves the
      queue and the counter unchanged and disables `people-pair-review-undo`
      until the next "Nie" or "Pomiń".
- [ ] Every new string exists in both dictionaries (the dictionary parity test
      covers this).

---

### US-B4: The review-scope control in Ustawienia

**As** a user, **I want** to say how eagerly the app should ask,
**so that** the flow is useful both for a first pass and for a tidy library.

**Scope.** A three-option control in the Osoby section of Ustawienia bound to
`faces_pair_scope`: "Ostrożnie" / "Standardowo" / "Szeroko" (EN "Careful" /
"Standard" / "Wide"), with a one-line explanation that a wider scope asks about
less similar people. Testids follow the existing `people-sort` toggle-group
pattern: the group is `settings-faces-pair-scope` and each option carries
`settings-faces-pair-scope-careful`, `-standard` and `-wide`.

**It is a draft control, like every other control in the modal.** Selecting an
option calls `patch({ faces_pair_scope: … })` on the `settings-model.ts` draft
and writes **nothing**; the value reaches the config only when the user clicks
`settings-save`, which is also what closes the modal. The pair queue is
therefore invalidated **on save** (when `changedKeys` contains
`faces_pair_scope`), never on selection — an on-change write would both
contradict the modal's cancel affordance and refetch the queue for a value the
user may discard. `draftFromStored` and `draftFromEffective` carry the key like
`faces_enabled`, so the control reflects the persisted value on mount.

**Acceptance criteria.**

- [ ] Renderer test: selecting "Szeroko" patches the draft and calls **no**
      config mutation; clicking `settings-save` writes `faces_pair_scope=wide`
      through the bound action once and invalidates the pair queue.
- [ ] Selecting "Szeroko" and then clicking `settings-cancel` leaves the
      persisted value unchanged and does not refetch the queue.
- [ ] The control reflects the persisted value on mount.
- [ ] Both dictionaries carry the three labels and the explanation.

---

### US-B5: e2e on the real UI

**As** the repo, **I want** the flow proven by real clicks, **so that** the
gate matches the CLAUDE.md e2e doctrine.

**Scope.** `test/e2e/people-pairs.spec.ts`, following
`test/e2e/people.spec.ts`: isolated home and user-data directory, the setup
wizard dismissed through the real UI, face model artifacts required (the spec
skips with a named reason when they are absent, exactly as `people.spec.ts`
does), and a fixture set supplied through `E2E_FACES_PAIR_SAMPLES`.

**The fixture is defined by its outcome, not by its contents.** "Photos of two
distinguishable people" guarantees nothing: two genuinely different people
usually sit *below* 0.34, so a `wide` scope would find no candidate at all. The
fixture requirement is therefore stated as an outcome: after the faces pass
over `E2E_FACES_PAIR_SAMPLES`, `GET /api/faces/pairs` at scope `wide` must
offer **at least two candidate pairs, at least one of which shares no person
with the top-ranked pair** — in practice two individuals, each photographed in
varied poses and lighting so the conservative cut splits each into more than
one card (four cards, hence a disjoint pair), which is exactly the situation
this feature exists for. The spec asserts the count precondition immediately
after the pass, reading `people-pair-review-open`'s count, with a named failure
message ("E2E_FACES_PAIR_SAMPLES produced fewer than two reviewable pairs at
scope 'wide' — the fixture must contain people the conservative cut splits");
the disjointness half is asserted later, by the walk that looks for such a
pair, with its own named failure message. A fixture that does not meet either
half is a **failure, not a skip**; only a missing fixture directory or missing
model artifacts skip, exactly as `people.spec.ts` does.

The whole run is real interaction: open the folder through the header button
with the native dialog stubbed in the Electron main process (the only
sanctioned stub), **then the photos analysis pass**, then **one** visit to
Ustawienia, then the faces pass, then Osoby.

**The photos pass is not optional.** Faces are detected on the photo proxies
that pass produces ([tasks/prd-unified-people.md](prd-unified-people.md), "Open
risks" item 5: a photo whose proxy is not `done` is invisible to the faces
pass), so without it the
faces pass finds nothing, no people exist and the two-pair precondition fails
for a reason that has nothing to do with the fixture. `test/e2e/people.spec.ts`
already shows the exact shape: click `analysis-media-photos`, assert its
`aria-pressed` is `'true'`, then wait for `photos-sidebar-unscanned` to be
**hidden** before touching settings. The spec copies it verbatim, between
opening the folder and opening Ustawienia.

**The settings visit is a single draft edit, saved once.** Ustawienia is a
draft surface: every control calls `patch(...)` on the in-memory draft and
nothing is written until `settings-save`, which also **closes the modal**
(`test/e2e/people.spec.ts` shows the shape: switch → `settings-save` →
`saved-snackbar` → modal hidden). A spec that saved after the faces switch and
then clicked the scope control would be clicking into a closed modal. The
order is therefore exactly:

1. `open-settings-button`, await `settings-modal` visible.
2. `faces-enabled-switch` (only when its `input[type="checkbox"]` is not
   already checked, as `people.spec.ts` does).
3. `settings-faces-pair-scope-wide` — this is what makes the fixture produce
   candidates without pre-seeding any app-owned state.
4. `settings-save`, await `saved-snackbar` visible and `settings-modal` hidden.

**The settings visit must happen while the folder is open.** `save()` in
`apps/web/src/features/settings/use-settings.ts` returns early when
`folder === null`, so a settings visit before the folder is picked would write
nothing and fail silently — the stated order already satisfies this, and the
worker should know why it is not free to reorder.

Then run the faces pass with `people-index` and reach Osoby through
`mode-library` and `subnav-people` — every one of those testids already exists
in `test/e2e/people.spec.ts`, as does `people-card`, which the merge assertion
counts.

**The grid fold must be opened before any `people-card` is counted.** The Osoby
grid hides people below a minimum-observation threshold behind
`people-other-tile`, and the default threshold is **10 observations**
(`PEOPLE_MIN_OBSERVATION_OPTIONS`, default `10`, in `PeopleView.tsx`). A pair
fixture is a few dozen photos, so nearly every person is folded and a naive
`people-card` count is `0` both before and after a merge — an assertion that
passes for the wrong reason. The spec therefore first drags the threshold to
its lowest option through the **real** control: focus the
`people-threshold-slider` thumb and press `Home` (index 0 = threshold 1),
asserting the folded tile is gone before counting cards. (Opening
`people-other-tile` is the equivalent alternative; the spec picks one and the
PRD does not care which, as long as no `people-card` count happens while the
fold is active.)

**Both person panels carry the person id.**
`people-pair-review-person-a` and `-person-b` render
`data-person-id={person.personId}`, the same attribute
`people-card` already carries in `PeopleView.tsx`. Without it a spec cannot
name the pair it answered: the fallback label "Osoba N" is a *position*
(`fallbackIndex`, US-A3) and shifts for every person after a merge removes one,
so "the pair answered Nie" would be unidentifiable after the "Tak".

**The relaunch is a second `launch(workdir)`, nothing more.** The helper mints a
fresh `--user-data-dir` and reuses the same isolated home through
`AVC_HOME_DIRECTORY`, which is where `catalog.db` — and therefore
`people_pair_decisions` — lives, so the decisions survive and the window state
does not. The wizard is dismissed again by the same helper. **No folder is
re-opened**: Osoby and the pairs route are home-scope and the library mode has
no folder gate, so `mode-library` → `subnav-people` is reachable straight after
the relaunch. What does *not* survive is `localStorage` — including the
people-threshold the first leg dragged — which is exactly why the relaunch leg
asserts the badge and the queue walk and **never** a `people-card` count.

**The Osoby header — and therefore `people-pair-review-open` — stays mounted
while the review surface is open**, exactly as it stays mounted in the
folded-people mode: review mode replaces the grid, not the header. The badge is
therefore live during the flow and a "Nie" drops it by exactly one, while
`people-pair-review-position` — the session progress counter defined in US-B2 —
advances its numerator and holds its denominator; the spec asserts both.

Assertions, UI first:

- [ ] With the threshold already dragged to its lowest option and
      `people-other-tile` gone, `people-pair-review-open` appears on the Osoby
      grid with a count greater than zero; the spec records that count as
      `badgeBefore` and the `people-card` count as `cardsBefore`.
- [ ] Clicking it opens `people-pair-review` with both person panels showing at
      least one `people-pair-review-crop` each;
      `people-pair-review-position` reads "1 z N", where `N` is the working-list
      length at open (`answeredThisSession` is `0` and nothing has been undone
      yet, so it is `candidates.length`; the fixture is far below the cap, so
      `truncated` is `false` and the undo below cannot change it). The spec
      captures both panels' `data-person-id` as `firstPairIds`.
- [ ] Pressing `2` (Nie) advances to the next pair,
      `people-pair-review-position` reads **"2 z N"** — the same denominator —
      and the `people-pair-review-open` badge reads `badgeBefore - 1`.
- [ ] Pressing `Backspace` brings the first pair back as the current pair
      (both `data-person-id` values equal `firstPairIds`), the position returns
      to **"1 z N"** and the badge returns to `badgeBefore`.
- [ ] Pressing `2` again commits the "Nie". The spec then **walks forward with
      `3` (Pomiń) until the current pair's two `data-person-id` values are both
      outside `firstPairIds`**, and presses `1` (Tak) only on that pair. The
      walk is the point: pressing `1` on a pair that shares a person with
      `firstPairIds` would merge one of them away, and the relaunch check below
      — "the queue never shows `firstPairIds`" — would then hold for the trivial
      reason the PRD itself rejects for "Tak" pairs, while `cardsBefore - 1`
      still passes and detects nothing. If the walk reaches
      `people-pair-review-empty` without finding a disjoint pair it fails with a
      named message ("no candidate pair disjoint from the first pair — the
      fixture must produce at least one, see the fixture precondition"), never
      a skip. Returning through `people-back-main`, the grid holds
      `cardsBefore - 1` `people-card` elements — a count that is only meaningful
      because the fold was opened first.
- [ ] Secondary invariant only, after the UI assertions: `catalog.db` read
      through sql.js holds **exactly one** `people_pair_decisions` row with
      `decision = 'same'`, **at least one** with `decision = 'different'`, and
      any number of `skip` rows — the walk's length is fixture-dependent, so
      pinning the `skip` count would make the assertion a fixture hash.
- [ ] **Persistence across a relaunch is asserted on the `different`, not on
      the `same`:** after relaunching the app and reopening the review surface,
      (a) the badge equals the count recorded just before the relaunch, and
      (b) walking the reopened queue with `3` (Pomiń) until
      `people-pair-review-empty` appears never shows a pair whose two
      `data-person-id` values are `firstPairIds` in either order. `Pomiń` is
      used for the walk because it is the only answer that neither merges nor
      writes a permanent constraint. (A "Tak" pair is trivially absent — one of
      its two people no longer exists — so it proves nothing about the decision
      store.) The relaunch walk is **shorter than the first session's**: every
      pair the first walk skipped carries a `skip` row and stays suppressed for
      30 days, so it is absent here too. The walk therefore asserts what it
      never sees, never a queue length.
- [ ] Immediately after reopening the review surface post-relaunch,
      `people-pair-review-undo` is disabled and `Backspace` does nothing —
      `answeredThisSession` is `0` again, and the answers of the previous
      session are not reachable from this screen (US-B3).

**Changelog (Wave B, `[Unreleased]` → Added).**

- "Osoby has a 'Ta sama osoba?' review view: two people side by side with
  contact sheets, answered with Tak / Nie / Pomiń or the keys 1 / 2 / 3, and a
  header badge showing how many questions are pending."
- "Ustawienia can set how eagerly Osoby proposes people to compare
  (Ostrożnie / Standardowo / Szeroko)."

---

## Functional Requirements

### Decisions and storage

- **FR-1** A decision is one row in `catalog.db`'s `people_pair_decisions`,
  keyed on the unordered pair of **anchor observation ids**
  (`PRIMARY KEY (obs_a_id, obs_b_id)`, canonical order = lexicographically
  smaller first), carrying the two person ids at decision time, the decision,
  an ISO-8601 `decided_at` and a source (`user` | `import`). The two person
  columns are **nullable**: an anchor that currently belongs to no person
  stores `null`, and every reader renders that as `unassigned`.
- **FR-2** The decision kinds are exactly `same`, `different`, `skip`. No other
  value is accepted at any boundary.
- **FR-3** Recording a decision for a pair that already has one **replaces**
  it; the later decision wins and `decided_at` moves.
- **FR-4** `same` and `different` never expire. A `skip` is active exactly
  while `now < decided_at + PAIR_REVIEW_SKIP_DAYS` (30 days); at or after that
  instant it is inactive and its pair returns to the queue.
- **FR-5** The anchor of each side of a decision is the first entry of
  `selectPairReviewCrops` over that person's observations at decision time —
  the highest-quality observation **that has a crop path**, ties on `obsId` —
  taken over its visible observations, falling back to its full set. It is by
  construction the first crop of the contact sheet the answer was given on. Only
  when the person has no crop-bearing observation at all does the anchor fall
  back to `selectExemplars(...)[0]`, because `cropPath` is nullable and that
  person's card showed a placeholder rather than a sheet.
- **FR-6** The person columns are refreshed — never authoritative. Every merge
  re-keys them and every recluster rewrites them from the anchors, in both cases
  **inside the same store write** that changes the people
  (`mergePeople`, `replaceFaceClustering`), never as a follow-up pass; an anchor
  the rebuild left unassigned is written as `null`. The row itself is never
  deleted for a null column: the constraint still binds the next rebuild.
- **FR-7** A `different` row whose two person columns **are made** equal by an
  explicit merge is deleted and counted as `decisionsInvalidated`: the merge is
  the newer and stronger user statement. The rule is scoped to that event only.
  A `different` row **imported** with its two person columns already equal is
  kept (FR-39) — it is the corpus reporting a mixed person, and the next
  rebuild honours it as a cannot-link — and so is a row a recluster happens to
  refresh into equal columns, which the *next* rebuild is meant to undo.
- **FR-8** A decision row anchored on a deleted observation is deleted in the
  same store write that deletes the observation. There are **three** such
  writes on `GlobalCatalogStore` and all three are in scope: `forgetPerson`,
  `deleteFaceObservationsForFile` (the photos trash leg and the stale-engine
  re-index path) and **`forgetEntry`** (the videos trash leg and
  `forget <fingerprint>`). `purgeFaces` clears the table.
- **FR-8a** A `FACE_ENGINE_VERSION` bump is a **decision-losing** event. The
  re-index path calls `deleteFaceObservationsForFile` for every file whose
  `previousEngineVersion` is older, so every decision anchored on a re-extracted
  file is dropped by FR-8 — correctly, because the observation ids are re-minted
  and the old anchors no longer name anything. The bump's own changelog line
  must state that stored "ta sama osoba?" answers about re-indexed files are
  lost. No migration, no backfill and no "re-anchor onto the nearest new
  observation" heuristic: the app never invents a statement the user did not
  make.
- **FR-9** Hiding files never deletes a decision row.
- **FR-10** `catalog.db` goes **V18 → V19**; `photos.db` stays at **v7**.

### Candidate generation

- **FR-11** Candidates are computed from stored embeddings only: person
  centroids and the exemplar observations' embeddings. No model runs, no
  filesystem read, no filename or metadata heuristic.
- **FR-12** A pair qualifies when `centroidSimilarity >= askLow`, or when
  `centroidSimilarity >= askLow - 0.1` and the best cross-exemplar similarity
  is at least `FACE_CLUSTERING.clusterCutSimilarity`.
- **FR-13** `askLow` comes from `faces_pair_scope`:
  `careful` 0.50, `standard` 0.44 (default), `wide` 0.34.
- **FR-14** The band has no upper bound. A pair at or above the cluster cut is
  eligible and ranks first, because the strong-edge fraction floor and the
  incremental assignment path both leave such pairs unmerged.
- **FR-15** Ranking is
  `similarityWeight × log2(1 + countA) × log2(1 + countB)`, with
  `similarityWeight = clamp01((similarity - askLow) / (cut - askLow))`, sorted
  descending and tie-broken deterministically on similarity then person ids.
- **FR-16** A pair with an active decision spanning the two people, in either
  order, is excluded. The two anchors are resolved over the **full**
  observation set (hidden files included), with the stored person columns as
  the fallback for an anchor that no longer exists; hiding files therefore
  never resurrects an answered question.
- **FR-17** Only *visible* people are candidates: hidden fingerprints from both
  stores are removed first and a person with zero visible observations is
  dropped, exactly as `GET /api/faces/people` does (ADR-0020).
- **FR-18** Named-vs-named pairs are eligible and are shown with both names.
- **FR-19** The queue is capped at `limit` (default 200, maximum 1000);
  `pending` reports the uncapped count and `truncated` reports the overflow.
- **FR-20** Generation runs on demand when the view opens and after every
  answer; it is never a background job and never a scheduled pass.
- **FR-21** The contact sheet is at most six of the person's **crop-bearing**
  observations, chosen for diversity — at most one per fingerprint while
  alternatives exist, then three high-quality, one median, two from the
  low-quality tail — deterministically, ordered highest-quality first, with crop
  paths re-anchored to the current catalog directory. Its first entry is the
  decision anchor (FR-5).

### The review flow

- **FR-22** The entry point renders only when faces are enabled and
  `pending > 0`, showing the uncapped `pending` count verbatim; it is hidden,
  not disabled, in both of those cases. When it is rendered it carries exactly
  `people-merge-selected`'s **lock** props — `disabled` while `people.isBusy ||
  mutationsBlocked` and `title={lockReason}` — so a read-only catalog disables
  it with the lock reason as its tooltip and a running faces job disables it
  with none, explained by the existing `people-active-job` alert. It is never
  hidden for either. It does **not** inherit that button's `mergePlan === null`
  selection gate, which is W101's two-people-ticked rule. Model readiness is
  not a gate.
- **FR-23** The review surface shows one pair at a time, both people's name or
  fallback index, both file counts and both contact sheets, plus a session
  progress counter reading `answeredThisSession + 1` of
  `answeredThisSession + queueLength` — where `answeredThisSession` is reset
  when the surface opens, incremented by every accepted answer and decremented
  by a successful undo, and `queueLength` is the length of the renderer's
  working list (the refetched `candidates` plus a restored undone pair that the
  truncated slice no longer contains) — and, when the slice is capped, a note
  saying so. The counter is not a "remaining" count; the header badge's uncapped
  `pending` is the only one.
- **FR-24** Answers are `1` = Tak, `2` = Nie, `3` = Pomiń, `Backspace` = undo;
  the same three answers are available as buttons.
- **FR-25** "Tak" merges immediately, and the merge direction is **derived by
  default, overridable only on a named/named "Tak"**. The derived survivor is
  the named person; if both or neither are named, the one with more
  observations; ties on the lexicographically smaller `personId`. That value is
  published as the candidate's `survivorIfSame`. `facesPairsDecideInputSchema`
  carries an optional `survivorPersonId`, which must equal `personAId` or
  `personBId` (anything else is `validation`, with no merge and no row); when it
  is absent the derived rule applies. The renderer sends it only from the
  named/named confirmation (FR-26); the CLI and the import never send it.
- **FR-26** "Tak" on two named people requires an explicit confirmation, and
  that confirmation is where the surviving name is **chosen**: the dialog
  reuses W101's `mergeNameChoice` radio over `mergeNameChoices([a, b])`
  (`apps/web/src/features/people/core/merge-target.ts`), preselected on
  `survivorIfSame`, and sends the selection as `survivorPersonId`. The renderer
  never re-derives the direction rule and never calls `defaultMergeTarget`,
  whose tiebreak is selection order rather than the smaller `personId`. No
  other answer is confirmed.
- **FR-27** Undo removes the most recent `source: 'user'` row when it is a
  `different` or a `skip`, and returns that pair to the queue as the
  **current** pair, ahead of whatever the refreshed ranking would put first.
  Imported rows are never undoable. The undo control is **disabled and
  `Backspace` inert while `answeredThisSession === 0`**, so an answer given in
  an earlier session or through `faces pairs decide` is never reachable from a
  keystroke and the counter cannot go negative. Undo of a `same` answer is
  refused with a plain message and the undo control is disabled until the next
  `different` or `skip`; the route reports the refusal as a successful
  envelope, not an error.
- **FR-28** Keystrokes are ignored while a text field is focused, while a
  dialog is open and while a decision is in flight.

### Recluster constraints

- **FR-29** A full recluster loads the active decisions and applies `same` as
  must-link and `different` as cannot-link over observation ids; `skip` is
  never a constraint.
- **FR-30** Must-link pairs are pre-unioned before the agglomerative loop;
  cannot-link pairs reject any merge whose union would contain both endpoints.
- **FR-31** Determinism is unchanged: sorted input, ties on the smallest member
  `obsId`, must-link components ordered by their smallest member.
- **FR-32** A cannot-link pair inside a must-link component is a reported
  conflict; the must-link wins.
- **FR-33** A constraint naming a missing observation is ignored and counted as
  stale.
- **FR-34** A name is carried to a new person when the map from the old named
  person is one-to-one and total on both sides over surviving observations —
  observations that were unassigned before the rebuild, and observations
  indexed since it, are exempt from the "belonged to the old person" half of
  the test; otherwise the name is dropped. Two old names landing in one new
  person drop both and count as a name conflict. This revises ADR-0018 D6.
- **FR-35** `facesReclusterOutputSchema` reports `constraintsApplied`,
  `constraintConflicts`, `constraintsStale`, `nameConflicts`, a real
  `namesCarried` and the existing `namesDropped`; a dry run reports the same
  numbers as the real run and writes nothing.
- **FR-36** Decision rows survive a recluster with their anchors intact and
  their person columns refreshed; an anchor the rebuild left unassigned
  refreshes to `null` and the row survives.

### CLI

- **FR-37** `faces pairs list [--limit <n>] [--json]` prints the ranked queue,
  NDJSON in `--json` mode, exit 0 on an empty queue. An unnamed person is
  labelled `Person <fallbackIndex + 1>`, matching the "Osoba N" the grid shows
  for the same `personId`.
- **FR-38** `faces pairs decide <personAId> <personBId> <same|different|skip>
  [--json]` applies one decision with the same semantics as the GUI, including
  the merge on `same`. It sends no `survivorPersonId`, so the derived FR-25
  direction always applies; a correction is `faces merge` in the wanted
  direction.
- **FR-39** `faces pairs import <path> [--apply-merges] [--dry-run] [--json]`
  imports a labelled-pairs corpus in the format
  `apps/cli/src/faces-benchmark.ts` already parses, mapping `same` and
  `different` to decisions with `source: 'import'`, skipping `unsure` and
  `not_face`, and reporting `imported`, `skipped`, `unresolved`,
  `alreadyTogether`, `conflicting`, `merges` and `decisionsInvalidated`. The
  corpus is read in the **native `obsId`** namespace; a reference-keyed corpus
  is reported as `unresolved` on every row and is not remapped (remapping is a
  non-goal for W99). A pair whose two observations already share a person is
  imported either way — counted `alreadyTogether` when `same`, `conflicting`
  when `different`, and in the `different` case kept despite the equal person
  columns, because FR-7 covers merges only. The CLI parses the file with the
  now-exported `readLabelledPairs` and posts the parsed array; the server never
  opens a caller-supplied path. It does not merge unless `--apply-merges` is
  given.
- **FR-40** Every `faces pairs` command emits the repo's NDJSON envelope shape
  and exits with the existing taxonomy codes.

### Taxonomy and boundaries

- **FR-41** No new `ErrorCode`, HTTP status or CLI exit code. "Cannot undo a
  merge" and "nothing to undo" are successful envelopes with a `reason` field.
- **FR-42** No new job kind: candidate generation is a synchronous read and a
  `same` answer reuses the already-serialized merge write path under
  `withCatalogWriteLock`.
- **FR-43** No new database file, no new on-disk directory, no new artifact
  kind. Crops are the ADR-0014 crops already on disk.
- **FR-44** No new NDJSON progress step: nothing here runs as a job.
- **FR-45** The renderer touches the app only through bound actions and query
  hooks, with no inline query keys, no `fetch`, no `electron` import, and every
  string in both dictionaries.

## Non-Goals

- **Undoing a merge.** The observations move and the merged-away person id is
  deleted; reconstructing it is a rebuild, not an undo. The app says so.
- **Bulk "merge everything above X".** The whole point is that the user's
  judgement, not a threshold, resolves the band the clusterer refused to
  resolve. A bulk action would recreate the false merges ADR-0012 avoids.
- **Automatic merging from the queue.** Nothing in this feature merges without
  an answer.
- **Observation-level review** ("is this crop the right person?"). A wrongly
  assigned single crop is a different problem with a different surface.
- **Splitting a person.** The queue only ever unites; a mixed person is still
  repaired by a recluster with constraints.
- **Three-or-more-way grouping screens.** Every question is one pair.
- **Name suggestion or propagation.** Names are typed by the user, and carried
  across a rebuild only under FR-34.
- **Changing the clusterer, the embedder, the thresholds or the strong-edge
  floor.** Wave A adds constraints to the existing algorithm and nothing else.
- **A background or scheduled generator.** No job kind, no timer.
- **`faces pairs undo` in the CLI.** Undo exists for the keyboard flow; a CLI
  correction is `faces pairs decide` with the other verdict.
- **Cross-media distinctions.** A person is a person; the queue does not filter
  by video or photo.

## Design Considerations

- **The question is the heading, not a label.** The screen exists to ask one
  thing, so "Czy to ta sama osoba?" is the largest text on it, and the two
  panels are visually symmetric — nothing suggests one side is the "real" one,
  because the merge direction is derived, not chosen.
- **Six crops, chosen for spread, not for beauty.** ADR-0018's calibration
  amendment is explicit that a top-quality sample hides the tail that reveals a
  mixed identity. The contact sheet deliberately includes the low-score crops,
  which is also what makes a "Nie" trustworthy.
- **"Nie" must read as permanent before it is pressed.** The caption under it
  states the consequence in one line; there is no confirmation dialog, because
  a dialog on every second keystroke would make the flow unusable and the undo
  key already covers a slip.
- **"Tak" is not styled as destructive.** It is the productive answer. The only
  friction is the named/named confirmation, where the loss (one of two names)
  is real and invisible.
- **Counts, not percentages.** "Do sprawdzenia: 37" tells the user how much
  work is left; a similarity percentage would invite arguing with the score
  instead of looking at the faces.
- **One "remaining" number, one "done" number, and the cap is honest.** The
  header badge is the exact uncapped backlog ("Do sprawdzenia: 437"); the
  counter on the card is session progress ("3 z 200" = three answered, two
  hundred loaded), which is why its denominator does not shrink as the badge
  does. Two numbers that both counted down would be the same fact twice, and
  after a "Tak" reordered the ranking they would disagree. A capped slice says
  so in one line, so a long backlog never looks finished and no number on the
  screen is a rounded lie.
- **Empty is a real state.** "Na razie nie ma o co pytać" is the resting state
  of a tidy library and appears both when the flow drains and when it never had
  anything.
- **No motion between pairs.** Answers are keystrokes at speed; an animation
  between cards would fight the input rate.

## Technical Considerations

- **Anchors are the durable identity.** Person ids are re-minted by every
  rebuild; observation ids are deterministic from fingerprint, frame index and
  detection index. Anchoring on observations is what makes FR-29 possible at
  all, and it is the same idea the unified-people plan listed as the follow-up
  to ADR-0018 D6's cost.
- **Constraint cost is bounded by decisions, not by observations.** Cannot-link
  checks are performed against the small set of constrained observation indices
  each cluster carries; a catalog with a few thousand decisions adds a few
  thousand set memberships to a rebuild that already visits millions of pairs.
- **Candidate generation cost is the pair pass over people, not over
  observations.** `GET /api/faces/people` already reads the same
  embedding-free `listFaceObservationSummaries()` projection W100 introduced, so
  the new route's read is not new; the only vectors it adds are the exemplar
  embeddings (at most five per person) it needs for the cross-exemplar channel.
  The added compute is `P²/2` centroid cosines plus at most 25 exemplar cosines
  per prefiltered pair. The budget is US-A3's 400 ms at 3000 people, and the
  sanctioned fallback if it is missed is a composition-owned in-memory cache
  keyed by a people-revision token — never a narrower band, because a narrower
  band is a product change disguised as an optimization.
- **The merge write is reused, not reimplemented.** "Tak" calls the existing
  `GlobalCatalogStore.mergePeople`, so centroid recomputation, search-document
  sync, affected fingerprints and the write lock are unchanged behaviour. It
  does *not* call the `facesMerge` use-case, whose post-W101 `flush()` would
  roll back the batch the decision row shares with the merge; the guards
  `facesMerge` adds are already applied by the decide route.
- **Zod at every boundary, `Result<T, AppError>` throughout, no `any`, no `as`
  except `as const`.** The decision kind and source are zod enums shared by the
  domain, the contract, the store and the CLI.
- **The V19 migration is additive and reversible in practice**: reverting the
  code leaves an unused table, and no existing row is touched. It is therefore
  unlike the V16 migration and needs no backup dump.
- **Privacy.** Person ids, crop paths, counts and any real-library numbers stay
  out of the repository. Tests use synthetic embeddings and fixture catalogs;
  the e2e fixture directory is supplied through an environment variable and
  lives outside the repo, as `people.spec.ts` already requires.
- **Parity.** Faces are a post-parity capability;
  [tasks/parity-inventory.md](parity-inventory.md) carries a note for the new
  table. Nothing here touches the NDJSON event grammar for existing steps, the
  exit-code taxonomy, the on-disk layout of video artifacts or the four
  sanctioned deviations in
  [tasks/prd-foundation-rewrite.md](prd-foundation-rewrite.md).
- **Changelog.** Wave A and Wave B each land their own `[Unreleased]` lines,
  quoted above, in the same commit as the behaviour. This planning document
  adds none: the repo rule scopes changelog entries to behaviour-visible
  changes.
- **Versioning.** Each wave is its own PR and its own patch bump, per the repo
  versioning policy.

## Success Metrics

- **M-1** Answering `k` questions with "Tak" reduces the person count reported
  by `faces status` by exactly `k`, with no other person count change.
- **M-2** A question answered once is never asked again: after answering every
  pair in the queue, `GET /api/faces/pairs` returns `pending: 0`, and it still
  returns `pending: 0` after an app restart.
- **M-3** A full `faces recluster` after a review session reports
  `constraintsApplied` equal to the number of active `same` and `different`
  decisions, `constraintConflicts: 0` on a consistent decision set, and leaves
  every "Nie" pair in separate people.
- **M-4** A named person that the rebuild maps one-to-one keeps its name;
  `namesCarried` is non-zero on a catalog where such a mapping exists, and
  `namesDropped` names every other one.
- **M-5** Importing the labelled-pairs corpus writes one decision per `same` or
  `different` label whose two observation ids exist, and zero rows for
  `unsure`, for `not_face` and for any label naming an unknown observation.
- **M-6** From the keyboard, a pair is answerable without touching the mouse
  and without any dialog, except on a named/named "Tak".

## Open Questions

1. **Should a "Nie" between two people also constrain their *members*?** Today
   the constraint is between two anchor observations, which is the statement
   the user actually made about two contact sheets. A stronger reading — every
   observation of A cannot link to every observation of B — would bind the
   rebuild harder but would encode a claim about crops the user never saw.
   Starting narrow is deliberate; widening is a later decision with evidence
   from `constraintConflicts` and from the visual audit ADR-0018's calibration
   amendment requires.
2. **Should the queue prefer pairs whose answer unblocks more pairs?** A
   transitive gain term (answering A–B implies A–C) would rank higher-leverage
   questions first, at the cost of a much less legible ranking. Deferred until
   the flat expected-value ranking has been used on a real backlog.
3. **Should `skip` age out at 30 days or at the next recluster?** 30 days is
   the binding decision; a rebuild arguably invalidates the reason for
   skipping. Revisit only with a concrete complaint.
4. **Does the default `standard` band want re-calibrating against the
   labelled-pairs corpus?** The benchmark can score an `askLow` candidate the
   same way it scores the cut. Worth doing once the corpus has been imported as
   decisions, and explicitly not a blocker for either wave.
5. **Should `faces pairs import` learn `--reference <path>`?** W99 imports
   native `obsId`s only and reports a reference-keyed corpus as `unresolved` on
   every row. The remap already exists — `matchReferenceToNative` in
   `core/domain/faces-benchmark.ts`, used by the benchmark script — so the
   option is a thin wrapper over it: read the reference file, match, import the
   remapped pairs. It is left out of W99 because a silent geometric match
   turning into permanent cannot-link constraints deserves its own review of
   the match's precision, not a flag added in passing.
