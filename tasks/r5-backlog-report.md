# R5 standing backlog report

Baseline: local `main` and worktree HEAD both resolved to `69d9a01` before edits.
Every available finding was checked against that baseline. No remote was pushed.
The implementation uses Node 22.23.1. Full check, visual, smoke, Playwright and
Electron were not run, as explicitly excluded from this work session.

## W34 architecture

Main: all three assigned remainder items were open. Unfiltered invalidations
were present in the catalog, models, people, photos, processing, settings and
wizard hooks, plus renderer tests. `lib/saved-toast.ts` and `refresh-toast.ts`
each owned module-level mutable state. `routes/index.tsx` owned feature state,
selection effects, sidebar wiring and dialogs. The excluded W34a work was
already closed by ancestor `07754fe`; it was not reimplemented.

Changes:
- `api-invalidation.ts`, `core/client/queries.ts` and affected renderer hooks:
  invalidate affected query families derived from existing bound descriptors.
  Test-only refresh calls also name their bound query family. No bare
  `invalidateQueries()` call remains under `apps/web/src`.
- `components/ui/SavedToastProvider.tsx`, `SavedSnackbar.tsx`, `main.tsx`,
  `features/settings/use-settings.ts`, `features/wizard/use-wizard.ts`,
  `features/models/use-local-ai.ts`, `use-whisper-models.ts` and
  `features/library/TileMenu.tsx`: saved notifications use React context.
  `lib/saved-toast.ts` is removed. The one retained refresh-error bridge and its
  non-React QueryCache caller are explained in `docs/architecture.md`.
- `routes/index.tsx` mounts `AppLayoutWorkspace.tsx`. Feature-owned wiring lives
  in `features/catalog/use-catalog-workspace.ts`,
  `features/shell/use-analysis-navigation.ts`,
  `features/photos/use-photos-workspace.ts`, `PhotosAnalysisSidebar.tsx`, and
  `features/processing/ProcessingDialogs.tsx`.

RED: nine invalidation cases failed because unrelated cache entries became
invalidated; the notification isolation regression failed because a save in
one shell appeared in another. Both now pass. Existing route tests caught an
extra photo scan after sidebar remounting during extraction; the always-mounted
photo workspace hook preserves the original lifecycle and the regression passes.
Renderer tests adjusted for scoped refreshes: catalog, tree-refresh, details,
settings and use-dictionary. Retained deviation: refresh-toast only, documented.

## CLI timeout

Main: both process flags used `numberOption`/parseInt; config timeout already
rejected values outside 30..600. The silent-clamp description was stale.

Changes: `apps/cli/src/numeric-option.ts` derives validation and the printed
range from `configValueSchema.shape.timeout`; `main.ts` binds the parser to
both commands. `CHANGELOG.md` records the public flag correction.

RED: `test/cli/numeric-bounds.test.ts` proved both commands accepted 900 during
option parsing. They now exit 1 and name 30..600. Upper-bound help parsing and
an actual completed drive invocation with timeout 600 are also checked.
No waiver.

## debug terminal and map

Main: `api-log.ts` redacted credential request bodies only; responses remained
logged. The route subscribed to every API-log update. `MapCanvas.tsx` read the
pin-ref map during render, although screen-cell keys change on zoom/pan.

Changes: `api-log.ts` exports one secret-route prefix policy and redacts both
body directions plus transport errors. `api-log.test.ts` enumerates contract
input/output schemas and secret operations, so a newly added secret-bearing
route outside the policy fails the regression. `AppLayout.tsx` owns the gated
`use-api-log.ts` subscription; the route has none. `MapCanvas.tsx` and
`MapPinPopover.tsx` anchor the popover at the selected geographic point's screen
position. User-visible redaction and anchoring are recorded in `CHANGELOG.md`.

RED: API-log response redaction failed on credentials; the closed-panel test
observed a live subscription. Both now pass. The subscription test also checks
render counts, reopening catch-up and closing again. The map regression also failed against main: zoom replaced the pin while the
popover retained a detached element. It now checks that the anchor remains valid.
Existing AppLayout regressions pass. No waiver.

## GPS backfill

Main: `gps-backfill.ts` never appended failures, ignored coordinate/capture/place
write outcomes, and only resolved places when absent or explicitly requested.
Both video/photo numeric option paths used parseInt. README listed commands
without explaining probing or the missing-dataset behavior.

Changes: `core/server/usecases/gps-backfill.ts` records every failed or
precedence-skipped write with file path and typed error; rejected coordinates
are not used for a place write. Changed coordinates trigger place resolution.
`numeric-option.ts` and `main.ts` bind GPS parsers to the contract schemas.
`README.md` explains ffprobe for missing video capture timestamps and offline
place-dataset requirements. `CHANGELOG.md` and `tasks/parity-inventory.md`
record the public summary/CLI changes.

RED: five new GPS cases failed for processing_error/not_found writes,
precedence rejection, stale place on rerun and failed place writes. CLI cases
failed for upper/lower bounds and trailing text. They now pass. CLI boundary
coverage includes both media types. No waiver.

## honesty pack

1. NFC probe: open on main; the lint rule existed but had no violating probe.
   `config-regression/lint-gates.test.ts` now creates a violating NFC fixture
   and asserts the canonicalPath diagnostic. Running the fixture through ESLint
   first exited 1 with `no-restricted-syntax`; the regression suite passes.
2. Nearest settlement: open. `adapters/places/index.ts` returned from the first
   nonempty ring. The old widening test did not exercise competing rings.
   `places.test.ts` now places a farther row in the first ring and a nearer row
   in the next: RED selected Farcorner, GREEN selects Nearnext. The resolver
   compares the candidates across its existing five-ring search extent.
3. Real Google Timeline fixture: INCOMPLETE. Main's `core/domain/timeline.test.ts`
   constructs its own array examples; no verified exporter-produced fixture for
   that supported shape is available in the tracked tree or supplied assignment.
   Public compatibility examples were found, but their provenance did not
   establish an actual export of the supported format. A fixture source was
   requested. No synthetic substitute or parser behavior change was committed.
4. Thumbnail fake: partially open. On main the filesystem-backed branch already
   matched the real ffmpeg adapter; the no-filesystem branch incorrectly treated
   every unforced call as cached. `test/server/usecases/test-fakes.ts` now tracks
   generated paths in that branch. `core/server/usecases/media-fake.test.ts`
   failed RED on the first unforced generation and now verifies generate,
   cached skip and force regeneration with and without the filesystem fake.
   Existing thumbnail use-case and CLI tests remained green after the fix.
5. Language documentation: open. Main's descriptor builder includes tag_language
   when either language is pinned, while `docs/architecture.md` said only the tag
   language. The sentence is corrected. The historical `CHANGELOG.md` entry now
   describes the previous English tag instruction and the switch to inherited
   pinned output language, consistent with the tag-language change `7fe2947`.
   No new Unreleased entry was added for this pack.

## faces-write claims

Main: `claimFacesWrite` emitted waiting before trying the resource and mapped
all claim failures to cancellation without retaining the error. The existing
contended-resource assertion was valid, but lacked a free-resource counterpart.

Changes: `core/server/ports.ts`, `adapters/jobs/index.ts` and the jobs fake expose
an optional contention callback; `process-drive.ts` reports waiting through it
and retains claim failures in the faces summary. Cancellation follows the abort
signal. `tasks/parity-inventory.md` and `CHANGELOG.md` record the event semantics.

RED: `process-drive-faces.test.ts` failed for the free claim and for
processing_error/not_found claims. All now pass, alongside the existing real
contention case. `adapters/jobs/jobs.test.ts` also checks callback invocation and
failed-report cleanup. No waiver.

## W21 notes

The assignment contains identifiers but omits the seven observation texts.
Searches of tracked tasks/docs and available audit history did not recover
those identifiers. Their main status cannot be honestly inferred from a title.
A source was requested. The following are explicitly waived for this batch,
pending the actual observations; none is claimed fixed or already closed:

- W21-8: waived — observation and reproducible symptom unavailable.
- W21-9: waived — observation and reproducible symptom unavailable.
- W21-10: waived — observation and reproducible symptom unavailable.
- W21-11: waived — observation and reproducible symptom unavailable.
- W21-12: waived — observation and reproducible symptom unavailable.
- W21-13: waived — observation and reproducible symptom unavailable.
- W21-14: waived — observation and reproducible symptom unavailable.

No production code, tests or changelog claims were invented for these notes.

## Validation

Permitted validation only: `pnpm exec tsc --noEmit -p .`, ESLint on all changed
and added TypeScript/JavaScript files, and targeted Vitest suites. The feature
regressions for models, wizard, processing, people, photos and library passed
398 tests across 31 files. Catalog/details/settings/dictionary and the restored
photo-sidebar lifecycle passed 111 tests across six files. The NFC lint-gate
suite, AppLayout, map, thumbnail use-case/CLI and jobs tests also passed.
Final changed-test and route verification passed 118 tests across 18 files.
The final typecheck passed; ESLint passed on all 53 then-touched code files.
The map suite then passed all 19 tests, including the detached-anchor regression;
its touched-file ESLint checks and the final typecheck passed.

Full `pnpm run check` acceptance remains unverified by explicit instruction.
No visual, smoke, Playwright, Electron, real-provider or private-face-fixture
run was attempted. No on-disk layout was changed. The Timeline fixture is the
remaining incomplete supplied finding; the seven unspecified W21 notes are
accounted for individually above.
