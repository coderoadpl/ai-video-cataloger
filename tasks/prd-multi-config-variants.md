# PRD: Multi-config analysis variants (v1.2)

## Introduction

Today one video has one analysis. The pipeline writes a single summary per
file, the global index keys `analyses` by `fingerprint` alone, and the
`alreadyIndexed` skip makes a second run on the same content a no-op unless
`--force` overwrites what is there. A user who wants to compare `gemma3:12b`
against `gpt-5.5`, or 3 frames against 8, has to destroy the previous result to
get the new one.

This PRD makes the analysis a **variant**: one video can be processed by more
than one configuration, every variant keeps its own frames, transcript and AI
analysis, all of them are stored and viewable, and exactly one is selected. The
selected variant is what search indexes and what the name-based artifact paths
(`summaries/{base}.json`, `transcripts/{base}.txt`, `frames/{base}/`) show;
the others are reachable from file details.

Owner decisions captured 2026-08-02 — immutable inputs to this PRD, not open
for relitigation:

1. One video can be processed by **more than one configuration**.
2. Each variant keeps its **own frames, transcript and AI analysis**.
3. **All variants are stored and viewable; exactly one is selected.**
4. **Search indexes the selected variant only**; the other variants are visible
   in file details.
5. **Selection lives per file**, with a **per-folder default configuration**.
6. The **CLI stays single-config-per-run** — multiple variants means multiple
   runs.

Ground truth for what must not break: [`parity-inventory.md`](parity-inventory.md)
(INV §n), [`docs/architecture.md`](../docs/architecture.md) Delta 3
(persistence), [ADR-0002](../docs/decisions/0002-global-catalog-layer.md) (the
global index is the canonical store, the folder sidecar is derived).

## Goals

- A file carries N analyses keyed by the configuration that produced them, with
  a stable, content-derived configuration id.
- Running the same file under a *different* configuration adds a variant instead
  of being skipped; running it under the *same* configuration is still skipped
  (and still overwritable with `--force`).
- Identical inputs are computed once: two variants sharing a transcription
  source share one transcript file; two variants sharing a frame setting share
  one frame set. Nothing is duplicated on disk that is byte-identical.
- Search behaviour is unchanged from the user's point of view: one hit per file,
  from the selected variant.
- Existing installations migrate silently: every stored analysis becomes the
  selected variant of a legacy configuration id, with no user action and no
  re-analysis.
- The GUI can switch the selected variant and compare variants side by side.
- The CLI gains variant inspection/selection commands; `process` itself gains no
  matrix mode.

## Domain model

### Configuration identity

A **config descriptor** is the closed, normalized record of everything that can
change an analysis result. Its canonical JSON (keys sorted, no whitespace)
hashed with SHA-256 and truncated to 12 hex characters yields the **configId**,
rendered `cfg_<12hex>`.

Included, per owner decision 5's identity triple:

| Part | Fields |
|---|---|
| Analyzer | `family`, `providerId`, and the family's result-shaping fields: `model`/`modelTag`, `maxImageDetail` (api), `promptStyle` + `reasoningEffort` (harness) |
| Transcription source | `whisper_mode`, plus `whisper_model` (local) or `whisper_api_base_url` + `whisper_api_model` (api); `skip` carries nothing else; a `gemini-native` analyzer carries `native:<providerId>:<model>` because the model returns the transcript itself |
| Frame settings | `frames` (frame count); omitted for the `gemini-native` family, whose path extracts no frames |

Excluded, with the reason each exclusion is safe:

- `apiKeyRef` and any secret — a rotated key must not fork identity, and a
  configId must never be a place a key can leak (INV: keys never appear in
  NDJSON, logs or artifacts).
- `whisper_binary_path` — a machine-local path; including it would give the same
  logical configuration two ids on two machines and break snapshot import.
- `timeout`, `skip_rename`, `faces_enabled`, `ui_language`,
  `gemini_batch_mode` — none of them change the produced description, filename
  or transcript (`gemini_batch_mode` is a delivery mechanism at half price for
  the same model).
- Everything not in the descriptor schema: the schema is closed, so a new config
  key is a deliberate decision about identity, never an accident.

Normalization happens before hashing: the legacy aliases `analyzer_backend =
claude|local` fold into their provider descriptors
(`harness:claude-code`, `local:<local_model>`) so a legacy config and its
explicit equivalent produce the **same** configId, and defaults are materialized
so an unset key and its default value never diverge.

### Legacy configuration id

Data written before this feature records only `files.analyzer` and
`files.model`; the transcription source and frame count of those runs were never
persisted. Fabricating a hash from partial data would eventually collide with a
real configuration, so migrated analyses take the reserved sentinel id
`legacy`. Its display label is derived per file from the recorded
`analyzer`/`model` and is shown as "settings partly unknown". Consequence,
accepted: re-running a migrated file with exactly the settings that produced it
creates a second variant that the app cannot tell is a duplicate of the first;
the user can delete either.

### Variant

A variant is `(fingerprint, configId)` plus the analysis payload (final name,
description, transcript, language, tags), the descriptor JSON that produced it,
the analyzer/model actually used, `createdAt`, and — where the adapter reports
them — token usage and estimated cost. `fingerprint` stays the partial content
hash (`FileSystemPort.partialContentHash`), so variants follow the content
across renames and folder moves exactly as analyses do today.

### Selection

Selection is per file, i.e. per fingerprint, resolved in three steps:

1. the file's explicit `selected_config_id`, when the named variant exists;
2. otherwise the viewing folder's default configId, when that variant exists for
   this file;
3. otherwise the newest variant by `createdAt`, ties broken by configId.

The folder default is `folders.default_config_id` when the user set one
explicitly ("make this the folder default"), and otherwise the configId of the
folder's resolved processing configuration (flag > folder > home > default, per
Delta 3). A file's explicit selection is stored once per fingerprint and is
therefore shared by every copy of that content; only the fallback in step 2 is
folder-relative. This follows from "selection lives per file" plus a
content-addressed catalog, and is documented as such in the UI copy.

## User Stories

Phased; each story is one focused implementation session. "Done" for every
story additionally means: `pnpm run check` green, `pnpm run smoke` green, zero
code comments except a non-obvious WHY, no `any`/`as` (except `as const`), and
the [`CHANGELOG.md`](../CHANGELOG.md) line in the same commit when the change is
user-visible.

### Phase A — identity and storage

#### US-701: Config descriptor and configId in the domain
**Description:** As a developer, I need one function that turns a resolved
configuration into a stable id, so every layer names a variant the same way.

**Acceptance Criteria:**
- [ ] `configDescriptorSchema` (zod, closed, `.strict()`) in `core/domain`
  covering exactly the fields listed under "Configuration identity"
- [ ] `configId(descriptor)` = `cfg_` + first 12 hex of SHA-256 over canonical
  JSON with sorted keys; pure, no I/O, no clock
- [ ] Legacy alias folding and default materialization happen in the descriptor
  builder, proven by a test where `analyzer_backend: 'claude'` and the explicit
  `harness:claude-code` provider yield one id
- [ ] Golden-vector test pinning at least six descriptor→id pairs (one per
  analyzer family plus two transcription sources); the vectors are the
  regression net against an accidental identity change
- [ ] Excluded fields proven excluded: changing `timeout`, `skip_rename`,
  `gemini_batch_mode`, `whisper_binary_path` or the API key ref leaves the id
  unchanged
- [ ] `legacy` is a reserved id the builder can never produce

#### US-702: Global index schema v9 — analyses keyed by (fingerprint, configId)
**Description:** As a user, I want my existing catalog to keep working while the
index starts holding several analyses per file.

**Acceptance Criteria:**
- [ ] `GLOBAL_CATALOG_SCHEMA_VERSION` 8 → 9; migration is forward-only, like
  every migration before it, and an older binary opening a v9 database keeps
  failing closed on the version check
- [ ] `analyses` rebuilt (SQLite cannot alter a primary key in place) with
  `PRIMARY KEY (fingerprint, config_id)` and the new columns `config_id`,
  `config_json`, `analyzer`, `model`, `created_at`, `usage_json`; existing rows
  copy over with `config_id = 'legacy'`, `analyzer`/`model`/`created_at`
  backfilled from `files.analyzer`/`files.model`/`files.processed_at`,
  `config_json` NULL
- [ ] `files` gains `selected_config_id TEXT`, backfilled to `'legacy'` for
  every fingerprint that had an analysis and left NULL otherwise
- [ ] `folders` gains `default_config_id TEXT` (NULL)
- [ ] New `analysis_configs (config_id PK, descriptor_json, label, first_seen_at,
  last_used_at)` seeded with the `legacy` sentinel row
- [ ] `search_documents` / `search_documents_fts` shapes are unchanged — one row
  per fingerprint, fed by the selected variant; the backfill is a no-op because
  the migrated legacy variant is the selected one
- [ ] Fixture test: a v8 database captured from the current app migrates to v9
  and every pre-migration search hit, analysis body and tag survives byte-equal
- [ ] Repository port gains `listVariants(fingerprint)`, `getVariant(fingerprint,
  configId)`, `upsertVariant`, `deleteVariant`, `setSelectedVariant`,
  `setFolderDefaultVariant`; `getAnalysis(fingerprint)` keeps its signature and
  answers with the selected variant so existing callers are unaffected

#### US-703: Content-addressed artifact store with cross-variant reuse
**Description:** As a user, I want a second configuration to reuse the frames
and the transcript it did not change, and never to overwrite the first one's
results.

**Acceptance Criteria:**
- [ ] Shared inputs move under the catalog directory, keyed by content and by
  the settings that shaped them:
  `artifacts/frames/{fingerprint}/{framesKey}/frame-NNN.jpg`,
  `artifacts/transcripts/{fingerprint}/{transcriptKey}.txt|.json`
- [ ] Per-variant outputs live at
  `variants/{fingerprint}/{configId}/summary.json|summary.txt|debug.log`
- [ ] `framesKey` hashes the frame count and extraction parameters;
  `transcriptKey` hashes the transcription-source part of the descriptor; a
  `gemini-native` transcript keys as `native:<providerId>:<model>` so it is
  never mistaken for a whisper transcript
- [ ] Reuse is verified, never assumed: an artifact is reused only when the key
  matches, the file exists, and (frames) the available count is at least the
  requested count — mtime is never an input
- [ ] The name-based parity paths (`frames/{base}/`, `transcripts/{base}.txt`,
  `summaries/{base}.txt|.json|-debug.log`, `.ai-video-cataloger/thumbnails/`)
  survive INV §5 unchanged and always project the **selected** variant,
  materialized as hard links with a copy fallback when linking fails (different
  filesystem, unsupported FS)
- [ ] Selection change re-points those paths atomically (temp name + rename);
  a failed re-point leaves the previous projection intact and reports it
- [ ] Read-only folders behave identically inside the existing mirror root
  `~/.ai-video-cataloger/read-only-folders/{folderId}/`
- [ ] Rename co-rename (INV §10) still moves the name-based projection; the
  content-addressed store is unaffected by renames by construction
- [ ] Tests: two configs differing only in analyzer share one transcript file
  and one frame directory (asserted by inode/link count where available, by
  single-write accounting otherwise); two configs differing in frame count keep
  two frame directories

### Phase B — pipeline and selection

#### US-704: Processing writes variants
**Description:** As a user, I want a run under a new configuration to add a
variant, and a run under a configuration I already used to be skipped as before.

**Acceptance Criteria:**
- [ ] The pipeline resolves its descriptor and configId once, before the first
  step, and carries it through every step and every persisted artifact path
- [ ] `alreadyIndexed` becomes per pair: skip when `(fingerprint, configId)`
  already has an analysis; run when the fingerprint has analyses under other
  configIds only
- [ ] `--force` keeps meaning "bypass the global-index skip" and now replaces
  the same-pair variant; it never touches the other variants
- [ ] Resume (INV §10) keys on the requested configuration: a partially
  processed file resumes from the artifacts belonging to *its* keys, and an
  analyze step never adopts another variant's frames or transcript
- [ ] `videos.status` in the per-folder `catalog.db` keeps its columns and is
  documented as the state of the **last** run for that path; the canonical
  per-variant state lives in the global index (ADR-0002). No folder-DB schema
  change ships in this feature
- [ ] The first variant of a file is selected automatically; a later variant is
  not (selection is an explicit act, never a side effect of a run)
- [ ] `catalog.ndjson` snapshot version bumps: a record carries
  `analyses: [...variants]` + `selectedConfigId`; the importer still accepts v1
  lines, mapping the single analysis to the `legacy` variant and selecting it
- [ ] Tests: same config twice → one variant, second run skipped; two configs →
  two variants, both intact; `--force` on one pair leaves the other byte-equal;
  resume across a config change does not cross-contaminate

#### US-705: Selection, folder default and search reindex
**Description:** As a user, I want to choose which analysis represents a file
everywhere, and to set a folder's default without touching every file.

**Acceptance Criteria:**
- [ ] `selectVariant(fingerprint, configId)` use-case: validates the variant
  exists (`variant_not_found` otherwise), writes `files.selected_config_id`,
  re-points the name-based projection, and rewrites the file's
  `search_documents` row from the newly selected variant in the same unit of
  work
- [ ] `setFolderDefaultVariant(folderPath, configId | null)`: writes
  `folders.default_config_id`; clearing it restores the "resolved folder
  configuration" fallback
- [ ] Resolution follows the documented three steps; a file whose explicit
  selection points at a deleted variant falls through to the folder default,
  then to the newest
- [ ] `deleteVariant`: refuses to delete the last remaining variant of a file
  (`conflict`), promotes the newest survivor when the deleted one was selected,
  and removes only the artifacts no other variant references
- [ ] `index rebuild` rebuilds the FTS content from selected variants only
- [ ] Search output shape is unchanged, plus `variantCount` per hit
- [ ] Tests: selection changes the search hit's description; deleting the
  selected variant promotes and reindexes; deleting a shared transcript's last
  referencing variant removes the file, an earlier one does not

### Phase C — surfaces

#### US-706: Contract routes and client descriptors
**Acceptance Criteria:**
- [ ] `GET /api/variants` (by `videoPath` or `fingerprint`) returns every
  variant with descriptor, label, `createdAt`, analyzer/model, usage/cost when
  recorded, artifact paths (frames dir, transcript, summary) and `selected`,
  plus the resolved folder default — enough for the compare view without a
  second round trip
- [ ] `POST /api/variants/select`, `POST /api/variants/delete`,
  `POST /api/variants/folder-default`
- [ ] New `ErrorCode` member `variant_not_found` with its exhaustive HTTP status
  (404) and CLI exit-code mapping, per the house rule on the closed union
- [ ] Query/mutation descriptors in `core/client` with hierarchical keys;
  selection and deletion invalidate scan, catalog-folder, search and variants
- [ ] Route/schema tests including the closed-union exhaustiveness check

#### US-707: CLI surface
**Acceptance Criteria:**
- [ ] `variants list <path>` — NDJSON row per variant (`configId`, descriptor,
  `selected`, `createdAt`, analyzer, model, cost when known) under `--json`,
  table for humans
- [ ] `variants select <path> --config <configId>`,
  `variants delete <path> --config <configId>`,
  `variants default <folder> --config <configId>|--clear`
- [ ] `process`/`process-drive` gain no configuration matrix and no repeatable
  `--config`; the single-config-per-run contract is unchanged (owner decision 6)
- [ ] `process` NDJSON deltas, additive only: the `completed` payload gains
  `configId` and `selectedConfigId`; `catalog_index_skipped` gains `configId`
  and the reason value `variant_exists`; a new verbose-only progress step
  `artifact_reused` reports `{ kind: 'frames' | 'transcript', configId,
  sourceConfigId }`
- [ ] Exit codes for the new commands come from the existing taxonomy;
  `variant_not_found` gets its own nonzero code
- [ ] Command tests cover each subcommand's envelope and exit code; `smoke`
  drives `variants list` on the temp fixture folder

#### US-708: GUI — variant switcher in file details
**Acceptance Criteria:**
- [ ] The details panel lists the file's variants as a switcher (label =
  analyzer + model / transcription source / frames; the legacy variant reads
  "settings partly unknown"), with the selected one badged
- [ ] Switching **previews**: frames, transcript, summary and tags in the panel
  follow the previewed variant; the selection is only written by the explicit
  "Use as selected" action, whose copy states that it changes search results and
  the files on disk
- [ ] "Analyze" states which configuration will run and whether it will create a
  new variant or re-run an existing one; a run under an existing configuration
  keeps requiring the existing force/reset affordances
- [ ] A folder-level action sets the current configuration as the folder default
- [ ] Search results badge a file that has more than one variant
- [ ] Feature-island rules hold: bound actions only, no inline query keys, copy
  through `useDictionary` with `en`/`pl` parity, decision logic in the island
  core emitting typed dictionary keys
- [ ] Component tests: switcher renders N variants, preview does not mutate,
  select mutates once and invalidates

#### US-709: GUI — compare view
**Acceptance Criteria:**
- [ ] A compare view shows two or more variants of one file in parallel columns:
  descriptor header, frame gallery (reusing `FrameGallery`), transcript, summary
  description, tags, and cost/duration when recorded
- [ ] The page shape is a skeleton in `components/layout/` per ADR-0004 —
  structure only, no copy, content through `ReactNode` slots; the feature does
  not grow its own page grid
- [ ] Each column carries the same "Use as selected" action as the switcher
- [ ] No text diffing, no scoring, no ranking in v1 — the comparison is the
  user's to make
- [ ] The dev gallery (`apps/web/gallery.html`) renders the compare skeleton in
  isolation with fixture variants, and `pnpm run visual` gains its darwin
  baselines (ADR-0005; still outside `check` and `smoke`)

### Phase D — migration proof and documentation

#### US-710: Migration and end-to-end proof
**Acceptance Criteria:**
- [ ] Fixture-driven proof that a pre-feature installation (v8 global index +
  per-folder `catalog.db` + name-based artifacts + a v1 `catalog.ndjson`) opens,
  migrates, searches, resumes and renames with no user action and no
  re-analysis, and that its single analysis reads as the selected `legacy`
  variant
- [ ] E2E: analyze a file under configuration A, then under configuration B →
  two variants, one shared transcript when the transcription source matches,
  independent summaries, search hitting only the selected one; switch selection
  → search follows and the name-based artifacts re-point
- [ ] `test:e2e:matrix` gains one real-provider cell producing a second variant
  of an already analyzed file and asserting reuse of the existing transcript

#### US-711: Documentation
**Acceptance Criteria:**
- [ ] `docs/architecture.md` Delta 3 updated first (docs-first house rule):
  analyses keyed by `(fingerprint, configId)`, the content-addressed artifact
  store, the selection resolution rule, the per-folder default
- [ ] New ADR recording the three decisions this PRD makes: the identity
  function and its exclusions, the artifact-layout option chosen over its
  alternatives, and the per-pair dedup/skip rule
- [ ] README: the `variants` commands, the new NDJSON fields, the on-disk
  additions under `.ai-video-cataloger/`
- [ ] `CHANGELOG.md` entries land per story, not in one lump at the end

## Functional Requirements

- FR-1: A configuration id is a pure function of the closed config descriptor;
  the same logical configuration yields the same id on any machine, in any
  process, forever (golden vectors are the contract).
- FR-2: An analysis is uniquely identified by `(fingerprint, configId)`; nothing
  in the system may hold "the analysis of a file" without naming a configId,
  except the selected-variant accessor.
- FR-3: Byte-identical inputs are stored once. Two variants sharing a
  transcription source share one transcript file; two variants sharing frame
  settings share one frame set; deletion removes an artifact only when no
  remaining variant references it.
- FR-4: Search indexes exactly one variant per file — the selected one. Search
  output shape stays as it is today apart from the additive `variantCount`.
- FR-5: Selection is per file with the documented three-step resolution;
  changing it is an explicit user act that re-points the name-based artifact
  projection and rewrites the file's search document in one unit of work.
- FR-6: Existing data migrates without user action, without re-analysis and
  without loss: one stored analysis becomes the selected `legacy` variant.
- FR-7: On-disk parity holds — the name-based paths of INV §5 keep their names
  and their meaning (they show the selected variant); every new path is additive
  under `.ai-video-cataloger/`.
- FR-8: NDJSON changes are additive: new fields on existing events, new reason
  values, one new progress step. No event is removed, renamed or reshaped.
- FR-9: The CLI processes one configuration per run. Multiple variants are
  produced by multiple runs.
- FR-10: The skip rule is per pair: same content + same configuration is
  skipped, same content + different configuration runs. `--force` replaces the
  addressed pair only.
- FR-11: Secrets never enter a configId, a descriptor JSON, a variant label or a
  variant artifact path.
- FR-12: Every new lint rule or contract exhaustiveness check proves itself with
  a violating probe before it counts; `check` + `smoke` gate every story.

## Non-Goals

- **No multi-config-per-run CLI**: no repeated `--config`, no matrix flag, no
  "run all configured variants" mode, in `process` or `process-drive`.
- **No auto-selection heuristics in v1**: no scoring, no ranking, no "best
  variant" recommendation, no automatic promotion beyond the deterministic
  fallback when the selected variant disappears.
- No text diffing or side-by-side highlighting in the compare view.
- No per-variant face indexing, tags-per-variant search, or per-variant
  thumbnails: faces and thumbnails stay per file, tags follow the selected
  variant.
- No variant history/versioning beyond the current variant per configId — a
  `--force` re-run replaces, it does not append a revision.
- No cross-machine sync or export of variants beyond the existing
  `catalog.ndjson` snapshot.
- No configuration presets/named profiles UI in v1; a configuration is named by
  what it is, not by a user-chosen label.
- No backwards migration from schema v9.

## Technical Considerations

- **Artifact layout — options considered.** (A) *Content-addressed store plus a
  selected-variant projection at the legacy names* — chosen: it keeps INV §5
  paths meaningful for scripts and for the rename co-rename set, and makes reuse
  a lookup rather than a copy; its cost is maintaining the projection on every
  selection change and a hard-link fallback to copy. (B) *Variant-scoped
  directories only, legacy names left to the first variant* — cheaper, but
  `summaries/{base}.json` would stop being "the file's analysis" the moment a
  second variant was selected, which quietly breaks every external consumer.
  (C) *No sharing, each variant re-extracts and re-transcribes* — rejected
  against the owner requirement and because whisper is the expensive step.
- **Global-index dedup — options considered.** (1) *Skip on `(fingerprint,
  configId)`* — chosen. (2) *Skip on fingerprint, as today* — would force
  `--force` for every second configuration, and `--force` overwrites, which is
  exactly what this feature exists to stop. (3) *Prompt/ask* — impossible in a
  non-interactive NDJSON contract. Consequence to document: because `files` stays
  one row per fingerprint, variants attach to content, so a duplicate copy in
  another folder shows the same variant set.
- **The `legacy` sentinel is a one-way door**: once migrated data is labelled
  `legacy` it can never be re-derived into a real configId (the inputs were never
  recorded). This is why the migration records the per-file `analyzer`/`model` it
  does have into the variant row, so the label stays informative.
- **Composite-key migration in SQLite** is a table rebuild, and the app's driver
  is sql.js (Delta 3): the rebuild must run inside one transaction with foreign
  keys deferred, and the fixture test must open the result with the same driver
  the app ships, not a native one.
- **Selection and the FTS row must not drift.** The single most likely bug class
  here is a selection write that does not reach `search_documents`. The
  use-case, not the callers, owns both writes, and the test asserts through the
  search route rather than through the repository.
- **Descriptor drift.** `configDescriptorSchema` is `.strict()`, so a new config
  key does not silently join the identity; the exhaustiveness test over
  `CONFIG_KEYS` fails until the new key is explicitly classified as
  identity-bearing or not.
- **Cost/usage fields** are recorded when the adapter reports them (the
  `gemini-native` and API families do); they are display data on the variant, not
  part of its identity.

## Parity and CHANGELOG implications

Parity (INV):

- §5 on-disk layout: name-based artifact paths keep their names and now mean
  "the selected variant"; `artifacts/` and `variants/` are additive subtrees
  inside `.ai-video-cataloger/`. Per-folder `catalog.db` schema is untouched.
- §1 NDJSON/exit codes: additive only — new fields on `completed` and
  `catalog_index_skipped`, one new progress step, one new error code with its
  own exit code. Existing events keep their shapes; consumers ignoring unknown
  steps and fields are unaffected.
- §10 resume and rename: unchanged in observable behaviour, re-keyed internally
  to the running configuration.
- **One sanctioned deviation** to record next to the existing list in the
  foundation PRD's Technical Considerations: the global-index skip is now
  per `(content, configuration)` instead of per content. A script that relied on
  "second run of the same file is always a no-op" sees a run when the
  configuration changed. `--force` semantics narrow correspondingly.

CHANGELOG (`[Unreleased]`, one factual line per behaviour-visible story commit):

- Added — several analyses per file keyed by configuration; `variants
  list|select|delete|default` CLI commands; variant switcher and compare view in
  file details; `configId`/`selectedConfigId` on process completion.
- Changed — the global-index skip is evaluated per configuration, not per file;
  global catalog index schema version 9; name-based artifacts under
  `frames/`, `transcripts/` and `summaries/` project the selected variant.
- Nothing under Fixed: this feature adds capability, it does not repair one.

## Success Metrics

- The same video analyzed under two configurations yields two variants, one
  shared transcript when the transcription source matches, and two independent
  summaries — verified in the e2e suite and once by hand in the packaged app.
- A pre-feature installation opens after the upgrade with identical search
  results, identical file details and zero re-analysis.
- Selecting a different variant changes the search hit and the on-disk
  `summaries/{base}.json` within one user action.
- `pnpm run check` + `pnpm run smoke` green on every story commit;
  `test:e2e:matrix` green at the end of the batch.
- No configId appears in any log, event or artifact alongside a credential
  (grep assertion in the existing secret-leak test).

## Open Questions

1. **`output_language` and identity.** It is not in the owner's identity triple,
   but two runs differing only in output language produce different descriptions
   and filenames and would collide under one configId. Recommendation: include
   it in the descriptor. Needs an explicit owner ruling because it widens the
   immutable requirement.
2. **Prompt version.** A change to the analysis prompt template changes results
   under an unchanged configId, making old and new variants incomparable.
   Recommendation: add a `promptVersion` integer to the descriptor, bumped by
   hand when the template changes. Cost: every existing variant becomes a
   different configId at the bump, which is the honest outcome but a visible one.
3. **Variant cap.** Should a file's variant count be capped (say 10) with the
   oldest unselected one evicted, or is unbounded growth acceptable given that
   frames and transcripts are shared? Recommendation: no cap in v1, revisit if
   disk complaints appear.
4. **Per-folder default scope.** The folder default is proposed as a global-index
   attribute of the folder. The alternative is a `default_config_id` key in the
   folder's `config.json`, which travels with the folder to another machine.
   Recommendation: index attribute in v1 (no new config key, no new precedence
   interaction), snapshot it later if portability is wanted.
