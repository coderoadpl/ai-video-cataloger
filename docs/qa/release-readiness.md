# Release readiness checklist

The ordered pre-release pass. It ends **before** the version bump: cutting a
version, tagging and publishing are the owner's call and are not part of this
document. A step whose command is red stops the release; a step that is
legitimately not applicable is recorded with its reason, never silently
skipped. Rerunning a red gate until it passes is forbidden
([flake doctrine](../../CLAUDE.md)).

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
| Self-QA walkthrough | `pnpm run qa:walkthrough` | no `failed` step, and every `skipped` step's note explains a deliberate absence |
| Screenshot review | — | the full checklist in [release-walkthrough.md](release-walkthrough.md), including the photo grid and photo detail shots |

A release that ships photo changes runs the walkthrough against a `--home`
whose photos DB has a scanned root, so `photos-grid` and `photo-detail` produce
real screenshots instead of honest skips.

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
- The Photos tab pages: the grid loads its first page and "Load more" appends
  the next until the count matches `total`.
- Duplicates are read-only everywhere (the detail pane's "also at" list); no
  surface offers deletion of a source file.

## Out of scope here

The version bump, the tag, the DMG publish and the release notes themselves.
This checklist ends with a build the owner can be handed.
