# Release readiness checklist

The ordered pre-release pass. It ends **before** the version bump: cutting a
version, tagging and publishing are the owner's call and are not part of this
document. A step whose command is red stops the release; a step that is
legitimately not applicable is recorded with its reason, never silently
skipped. Rerunning a red gate until it passes is forbidden
([flake doctrine](../../CLAUDE.md)).

## 0. Versioning and release cadence

The patch version is bumped with practically every merged PR (at minimum
every wave); no two differing builds may ever share a version string
(owner decision 2026-08-02).

Releases are not rationed: every merged wave that changes user-visible
behaviour ships as a patch release (owner decision 2026-09-06). There is no
batching of waves into a bigger release and no waiting for a milestone — a big
step lands, a release follows.

A release cycle is three stages, in order, and none of them is optional:

1. **Gates** — `pnpm run check` and `pnpm run smoke` green (section 1).
2. **Pre-release e2e** — `pnpm run test:e2e:prerelease` green, plus the parity
   and, at a batch end or before a DMG handoff, the real-provider matrix
   (section 2).
3. **Package and hand off** — `pnpm run electron:package`,
   `pnpm run verify:package`, the strict `qa:walkthrough`, the independent
   screenshot review (section 3), then the version bump, publish and a real
   install of the published artifact.

The cycle ends at an installed, launched build — a published artifact nobody
installed is not a finished release.

## 1. The two gates

| Step | Command | Pass condition |
|---|---|---|
| Static + unit gate | `pnpm run check` | typecheck, eslint (incl. boundaries and the renderer Node-builtin ban), dependency-cruiser, the renderer bundle build, doc-lint and vitest all green |
| Installed-tree gate | `pnpm run smoke` | installed-tree check, lockfile lint, and the real in-process app driven through the CLI (doctor/scan/config/status, photos scan/status/forget/proxies/search/variants) all green |

On a loaded machine, export `AVC_GATE_TIMEOUT_FACTOR=3` before running the
static + unit gate so Vitest test, hook, teardown, and CLI subprocess budgets
scale together.

## 2. End-to-end suites

| Step | Command | Pass condition |
|---|---|---|
| Parity e2e | `pnpm run test:e2e:parity` | the CLI and GUI projects agree on the parity scenarios |
| Mandatory pre-DMG e2e | `pnpm run test:e2e:prerelease` | every included e2e suite green before `pnpm run electron:package`, with no skipped test outside the runner's allowlist (the people legs need `E2E_FACES_SAMPLE_PHOTOS` and `E2E_FACES_PAIR_SAMPLES`) |
| Real-provider matrix | `pnpm run test:e2e:matrix` | every leg green. Run it from a **normal, unsandboxed shell** (`hdiutil` fails under an agent sandbox) and in a low-load window |

Under the flake doctrine, a red suite is a P1 bug, never rerun-to-green.

A **large UI wave runs `pnpm run test:e2e:prerelease` before the merge**, not
only `check` and `smoke` (owner decision 2026-09-07): the suites that drive the
real Electron UI are the only ones that see a broad UI change break a real flow,
and finding that after the merge costs a second wave. The pre-release suite
fails closed on unexpected skips, so the people legs need both
`E2E_FACES_SAMPLE_PHOTOS` and `E2E_FACES_PAIR_SAMPLES` set to run at all; an
unset variable makes the run red, it does not quietly shrink the suite.

### A red gate is a stop

A red gate stops the work; it is never answered with a blind re-run
(owner decision 2026-09-07).

- A red caused by the change: fix the change (or the gate, if the gate is the
  wrong one) and run it again.
- A red caused by the environment — host load, a network or provider outage, a
  missing fixture — is re-run **only after the cause is removed**, and the cause
  and its removal are recorded with the run. Waiting for the 1-minute load
  average to drop before a heavy gate, or exporting
  `AVC_GATE_TIMEOUT_FACTOR`, is such a removal; re-running the same command on
  the same loaded host is not.
- A run the Playwright retry turned green is flaky-flagged and needs a filed P1
  before the merge.

The matrix's photo legs are `photos-real-decode` (scan → real `sips` proxy and
thumb decode → status → search; never skippable on darwin),
`photos-local-analysis` (a real local analyzer over the generated proxies; skips
with a named reason when the model is not installed) and `photos-raw-sample`
(opt-in: set `E2E_PHOTOS_SAMPLE_RAW` to a real RAW file to prove the embedded
preview path). `E2E_MATRIX_ALLOW_SKIP=1` is permitted **only** for legs with a
recorded environmental reason (no API key, an exhausted agent-CLI plan), and the
skipped legs are named in the release notes to the owner.

## 3. The packaged app

The Google-account backup destination is a build-time secret: export
`AVC_GOOGLE_OAUTH_CLIENT_ID` and `AVC_GOOGLE_OAUTH_CLIENT_SECRET` **before**
`pnpm run electron:package`. A bundle built without them still runs, but
Settings hides the Google-account destination during new backup setup and leaves
the service-account destination as the only path. Record that the variables were
present, not their values, in the release notes handed to the owner. The
walkthrough's own `backup` step exercises the **service-account** destination
against the in-memory fake Drive it starts for itself, so it proves the
enablement flow without either variable and without a Google account; the OAuth
path stays a manual check.

| Step | Command | Pass condition |
|---|---|---|
| Build | `pnpm run electron:package` | the bundle builds |
| Bundle shape | `pnpm run verify:package` | a single darwin onnxruntime binding, no non-darwin artifacts |
| Self-QA walkthrough | `pnpm run qa:walkthrough -- --strict --analyzer local:gemma3:4b --archive-to "$AVC_SCRATCH_DIR/avc-release-shots/<version>/" ...` | no `failed` step, no `skipped` step, and the set is archived outside the worktree |
| Screenshot review | — | an **independent reviewer** (not the agent that ran the walkthrough) works the full checklist in [release-walkthrough.md](release-walkthrough.md) against the archived set, including the sidebar geometry, Kolekcja photo viewer and completed-analysis shots; that reviewer has authority to fail the release |

A release that ships photo changes runs the walkthrough against a `--home`
whose photos DB has a scanned root, so the Analysis photos and Kolekcja photo
steps produce real screenshots instead of honest skips. Release runs use `--strict`: a `skipped`
step means the `--home` is not fully provisioned for this release's scope, and
`--strict` turns that into a non-zero exit instead of a note a reviewer could miss.
The set is archived **before** the release worktree is cleaned up
(`--archive-to`): a screenshot set that only lives in a worktree does not
survive the worktree being removed.

Release runs also pass `--analyzer local:gemma3:4b` (the system ollama must be
running at its default port — check first with
`curl -s http://127.0.0.1:11434/api/tags`): the `analyze` step's outcome is now
mapped from the real UI result (`ok` only when analysis reaches `completed`,
`failed` when it ends in error), and its `skipped` outcome (no analyzer
configured) is not in `TOLERATED_SKIPS`, so `--strict` fails the run without a
real analyzer; see [release-walkthrough.md](release-walkthrough.md).

## 4. Docs and changelog

- Every behaviour-visible change of the cycle has its `CHANGELOG.md` line under
  `[Unreleased]`; the release commit moves them under the version heading and
  adds the commit links.
- `README.md` documents every `photos` verb the CLI accepts (`doc-lint` enforces
  that a documented `pnpm run` script exists, not that prose is accurate — read
  it).
- `docs/architecture.md` / `docs/architecture-photos.md` match what shipped; an
  architecture change edits docs before code, so a mismatch here is a defect.
- en/pl dictionary parity is enforced by the dictionary test in `check`; a new
  UI string with no Polish counterpart cannot reach this point.

## 5. Scale sanity on real data

- `avc photos status <root>` on a real library answers immediately and its
  counts agree with the folder.
- Analysis → Zdjęcia pages its scanned-photo sidebar until the loaded count
  matches `total`; Kolekcja remains analyzed-only.
- Duplicates are read-only everywhere (the detail pane's "also at" list); no
  surface offers deletion of a source file.

## Out of scope here

The version bump, the tag, the DMG publish and the release notes themselves.
This checklist ends with a build the owner can be handed.
