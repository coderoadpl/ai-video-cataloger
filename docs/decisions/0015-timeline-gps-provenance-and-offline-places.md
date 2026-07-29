# ADR-0015: GPS provenance, a UTC capture-time key, and place search — schema first

Date: 2026-07-29 · Status: accepted (schema and domain landed; backfill CLI,
offline place resolution and GUI honesty deferred — see Consequences)

## Context

The catalog stores `gps_lat`/`gps_lon` (3752 catalogued files, 110 with camera
GPS) with no record of where a coordinate came from, and no capture time at
all. A 13-year Google Timeline export can fill the other 3642 files' locations
by matching each file's capture instant against timeline intervals (`visit`,
`activity`, `timelinePath`), but three properties of the real data make a
naive "just copy the nearest point" backfill actively harmful:

1. Timeline-derived coordinates are approximate — a `visit` is a concrete
   place, but `activity`/`timelinePath` endpoints can be kilometres off for a
   moving camper. Written without a marker, an approximation is
   indistinguishable from the 110 camera-measured rows and a later
   reprocessing pass could silently replace a measured coordinate with a worse
   one.
2. Filenames like `DJI_20250901113511` carry the *local* wall clock;
   `creation_time` in the container is UTC. Matching on the filename's clock
   against UTC interval boundaries is wrong by the local UTC offset.
3. A resolved place name is useless if it never reaches the full-text index —
   the owner explicitly rejected turning places into tags (11 679 existing
   tags, 72% singletons already).

## Decision

1. **Coordinates carry provenance now, before any backfill exists to abuse
   it.** `files` gains `gps_source` (`camera | timeline | manual`),
   `gps_accuracy_m`, `gps_interval_kind` (`visit | activity | path`) and
   `gps_resolved_at`. A pure function, `acceptsGpsWrite`, enforces
   `manual > camera > timeline` precedence on every write path, including
   `upsertFile` — which today unconditionally overwrites `gps_lat`/`gps_lon`
   with whatever the probe returns, including `null`. That bug (a probe that
   finds no GPS erases a stored coordinate) is fixed as a side effect of
   adding the precedence rule: a `null` incoming coordinate is now always
   rejected.
2. **The matching key is the container's UTC `creation_time`, never the
   filename's local clock.** `MediaProbe` gains `createdAtUtc`, read from
   `format.tags.creation_time` (falling back to the first stream tag of the
   same name), rejecting values before 2000-01-01 (QuickTime/Unix epoch
   sentinels) and normalising to `Date.prototype.toISOString()`. The pure
   matching algorithm (`core/domain/timeline.ts`) never looks at a filename.
3. **Place text is a first-class, separately-schema'd search column, added
   now even though nothing resolves it yet in this wave.** `search_documents`
   gains `place`, the fts4 virtual table is dropped and recreated with it, and
   `weightedSearchScore` ranks a place hit at 55 — between tags (45) and the
   final name (70). Adding the column in the same migration that adds
   provenance means the irreversible part (schema + index rebuild) does not
   have to wait for the offline place resolver to exist.
4. **Never a render-time geocoder.** Per
   [ADR-0001](0001-local-first-electron.md), place names will be resolved
   from a versioned offline GeoNames snapshot, downloaded once and checksummed
   like the whisper/face models — not designed in this pass; see
   Consequences.

## Consequences

- Migration V10 (`GLOBAL_CATALOG_SCHEMA_VERSION` 9→10, snapshot v11) is
  one-way: reopening a v10 database with an older binary fails closed
  (`snapshot_incompatible`), exactly like every prior migration.
- `acceptsGpsWrite` is exercised by a full truth table
  (`core/domain/global-catalog.test.ts`) and by store-level precedence tests
  (`adapters/db/global-catalog.test.ts`, P1/P2): a camera row is never
  overwritten by a timeline write, and a `null` probe result no longer erases
  a stored coordinate.
- The pure interval-matching algorithm (containment beats tolerance; kind
  order `visit > activity > path`; per-kind accuracy formulas; the
  `filenameLocalTimestamp` skew counter that never becomes the matching key)
  is fully implemented and unit-tested in `core/domain/timeline.ts`, ready to
  be driven by a backfill use case.
- **Deferred, in the scope-shrink order the design spec names**: the
  `gps backfill` CLI/job that drives the matching algorithm end-to-end against
  a real timeline export; the offline GeoNames dataset, generator script and
  `PlacesPort` adapter (so `place` stays empty until a follow-up wave); GUI
  pin/badge honesty (measured vs approximate) on the W14 map and details
  panel; and the closer's real-data validation run, which needs the CLI
  command to exist. Each is additive on top of the schema landed here and does
  not require another migration.
- **Rejected**, per the design spec: tags for places; Google Places /
  Nominatim / any render-time geocoder; Google `placeID`s; a single pin style
  for measured and approximate locations.
