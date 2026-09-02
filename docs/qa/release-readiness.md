# Release readiness checklist

The ordered pre-release pass. It ends **before** the version bump: cutting a
version, tagging and publishing are the owner's call and are not part of this
document. A step whose command is red stops the release; a step that is
legitimately not applicable is recorded with its reason, never silently
skipped. Rerunning a red gate until it passes is forbidden
([flake doctrine](../../CLAUDE.md)).

## 0. Versioning policy

The patch version is bumped with practically every merged PR (at minimum
every wave); no two differing builds may ever share a version string
(owner decision 2026-08-02).

## 1. The two gates

| Step | Command | Pass condition |
|---|---|---|
| Static + unit gate | `pnpm run check` | typecheck, eslint (incl. boundaries and the renderer Node-builtin ban), dependency-cruiser, the renderer bundle build, doc-lint and vitest all green |
| Installed-tree gate | `pnpm run smoke` | installed-tree check, lockfile lint, and the real in-process app driven through the CLI (doctor/scan/config/status, photos scan/status/forget/proxies/search/variants) all green |

## 2. End-to-end suites

| Step | Command | Pass condition |
|---|---|---|
| Parity e2e | `pnpm run test:e2e:parity` | the CLI and GUI projects agree on the parity scenarios |
| Real-provider matrix | `pnpm run test:e2e:matrix` | every leg green. Run it from a **normal, unsandboxed shell** (`hdiutil` fails under an agent sandbox) and in a low-load window |

The matrix's photo legs are `photos-real-decode` (scan → real `sips` proxy and
thumb decode → status → search; never skippable on darwin),
`photos-local-analysis` (a real local analyzer over the generated proxies; skips
with a named reason when the model is not installed) and `photos-raw-sample`
(opt-in: set `E2E_PHOTOS_SAMPLE_RAW` to a real RAW file to prove the embedded
preview path). `E2E_MATRIX_ALLOW_SKIP=1` is permitted **only** for legs with a
recorded environmental reason (no API key, an exhausted agent-CLI plan), and the
skipped legs are named in the release notes to the owner.

## 3. The packaged app

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
