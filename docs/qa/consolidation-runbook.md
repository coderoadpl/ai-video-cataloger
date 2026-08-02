# Catalog home consolidation runbook

How to move a catalog built up on a separate machine or drive (a batch run, a
review copy) into the real app home at `~/.ai-video-cataloger/` without losing
whatever is already there. Driven by `pnpm run promote-home`
(`scripts/promote-home.ts`); read this before running it against a real home.

## What "home" means

The app home is everything under `{homeDirectory}/.ai-video-cataloger/`:
`catalog.db` (the global catalog index, [ADR-0002](../decisions/0002-global-catalog-layer.md)),
`photos.db` (the photo catalog), `config.json`, `credentials.json`, the
`faces/obs/{fingerprint}/` crop tree, whisper models and the managed runtime,
and the append-only spend ledger. `homeDirectory` defaults to `os.homedir()`
and is overridable with `AVC_HOME_DIRECTORY`, the same variable the CLI reads
(`apps/cli/src/main.ts`).

Promotion installs the source's tree over the target's, but never silently
drops target state the source cannot replace:

- every entry the source's `.ai-video-cataloger/` provides (`catalog.db`,
  `faces/`, and whatever else it carries) overwrites the target's copy — the
  old copy stays in the backup;
- every entry the target has and the source does not (`credentials.json`,
  `photo-artifacts/`, `models/`, `runtime/`, `onboarding.json`, …) is copied
  back out of the backup into the promoted home, so a promotion never costs
  the owner their keys, downloaded models or photo artifacts;
- `photos.db` is decided by its own rule, below.

Both lists are printed in the plan (`kept from the target: …` /
`overwritten by the source: …`) before anything is written, so the operator
sees which of their files the source is about to shadow.

## The `photos.db` exception

A batch/run catalog is usually built by pointing the CLI at a drive of videos
and photos that is not the owner's `~/Pictures`. Its `photos.db` — if it has
one at all — is not the one the owner wants as their real photo catalog. The
owner's local `photos.db` (their actual `~/Pictures` scans) must survive the
promotion **verbatim**. So:

| Source has `photos.db` | Target has `photos.db` | Outcome |
|---|---|---|
| no | no | nothing to carry; target stays without one |
| no | yes | target's `photos.db` is carried over unchanged (the common case) |
| yes | no | source's `photos.db` becomes the new one |
| yes | yes | **refused** — merging two photo catalogs is out of scope for this tool; the run stops before touching anything |

A carried `photos.db` keeps its `photo-artifacts/` tree (proxies, thumbnails,
grid thumbnails) by the rule above — the rows say `proxyState: done` and the
files are still there, so the Photos tab is not left pointing at artifacts
that the promotion deleted.

There is no flag to force the last case. Reconciling two non-empty
`photos.db` files is a real feature, not a promotion detail, and isn't built.

## Preflight

Before anything is written, `promote-home` reads both homes read-only (it
copies each `.db` file it inspects into a scratch temp directory before
opening it, so inspection never mutates the source or the target) and
computes a plan:

- `catalog.db` must exist at the source. Its schema version is compared
  against `GLOBAL_CATALOG_SCHEMA_VERSION`; newer-than-supported aborts with no
  writes (an older, migratable version is fine — the real app migrates it in
  place the next time it opens the promoted home, exactly as it would for any
  other catalog.db it opens).
- The same check runs for `photos.db` against `PHOTOS_SCHEMA_VERSION`, when a
  `photos.db` is present at all.
- Row counts (`folders`/`files`/`analyses`/photos) are read back for the
  operator to sanity-check before confirming.
- If the target already carries a promotion marker
  (`.ai-video-cataloger/promoted-from.json`) recording this exact source
  (same source path, same `catalog.db` size+mtime fingerprint), the run is
  refused as already-promoted. Re-running the identical promotion twice is a
  no-op guard, not a hard error path meant to be worked around.

## Backup

If the target already has a `.ai-video-cataloger/` directory, it is renamed
(never deleted) to a timestamped sibling —
`.ai-video-cataloger.backup-{ISO-timestamp}` — before the source is installed.
A first-time promotion into an empty target skips the backup step (there is
nothing to back up) and says so.

## Running it

```bash
pnpm run promote-home -- --source /path/to/run-home --dry-run
pnpm run promote-home -- --source /path/to/run-home --yes
```

- `--source <homeDirectory>` is required: the parent of the `.ai-video-cataloger/`
  directory you're promoting (e.g. the root of a copied run home).
- `--target <homeDirectory>` defaults to `AVC_HOME_DIRECTORY` or `os.homedir()`.
- `--dry-run` prints the full plan (backup path or "nothing to back up",
  schema versions and counts for both catalogs, the `photos.db` decision, the
  kept/overwritten entry lists) and writes nothing.
- Without `--dry-run`, the plan is still printed, but nothing is written
  unless `--yes` is also passed — there is no silent, no-confirmation path
  that mutates the real home.

## Crop-path portability

Face crop paths are stored as absolute paths under
`{homeDirectory}/.ai-video-cataloger/faces/obs/{fingerprint}/`. A catalog
built under one home directory and promoted into another therefore carries
crop paths that still say the old home's path. This already works: every read
path re-anchors a stored crop path onto the *current* store's own
`databasePath()` (`reanchorFaceCropPath` in `core/server/usecases/faces.ts`,
matched on the `/.ai-video-cataloger/` marker), so a promoted catalog's face
crops resolve correctly as long as the crop files themselves travelled with
the promoted tree — which a full-tree copy guarantees.
`scripts/promote-home.test.ts` covers this with a fixture: a source catalog
whose stored crop path is anchored to a third, unrelated home directory,
promoted into a fresh target, and read back through `facesPeople`.

## Post-promotion repair checklist

None of these run automatically — the promoted catalog's rows are correct,
but derived artifacts (thumbnails, place names, face clustering) may be stale
or missing for anything the source catalog hadn't finished. Run what applies,
reusing the existing commands:

```bash
# Grid thumbnails for any photo missing one
pnpm run cli -- photos grid-thumbs

# GPS backfill + place resolution, video and photos, once a Timeline export
# and the GeoNames dataset are available
pnpm run cli -- gps backfill <timeline.json>
pnpm run cli -- photos gps backfill <timeline.json>

# Face clustering, if the source catalog had pending observations
pnpm run cli -- faces recluster
pnpm run cli -- faces exemplars
```

`promote-home` prints this same list, tailored to what the promoted catalog's
counts suggest is pending, at the end of a successful (non-dry-run) run.
