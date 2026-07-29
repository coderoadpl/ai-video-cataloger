# ADR-0013: GPS map view — no remote tiles, an offline basemap, and a renderer CSP

Date: 2026-07-29 · Status: accepted

## Context

The catalog extracts `gps_lat`/`gps_lon` from video metadata (110 of 3752
files in the real catalog carry it) and the search route already returns a
`gps` field, but no GUI surface shows it: no map, no coordinates anywhere.
This app is a SIL-1 local-first product (`~/repositories/CLAUDE.md`,
[ADR-0001](0001-local-first-electron.md)): its value proposition is "your
footage never leaves the machine". Every mainstream map library's default
answer to "show a map" is remote raster tiles, and today the renderer has no
`Content-Security-Policy` at all (`apps/desktop/src/main.ts` sets none,
`apps/web/index.html` has no meta CSP) — so "the renderer cannot reach the
network" has so far been true only because our code happens not to try.

## Decision

1. **No remote tiles in v1, and no Settings opt-in toggle.** The renderer
   performs zero network requests for the map. A tile session is not merely
   "coarse location": a map view emits a sequence of `z/x/y` requests to a
   third party that, taken together, reconstructs where the user's home,
   holidays and family are — from a machine whose IP identifies the
   household. An opt-in toggle would still require writing, reviewing,
   testing and CSP-widening a second tile-loading render path for a v1 whose
   job is "show me where my located clips are"; shipping no network map code
   means there is nothing to leak and nothing to get wrong in a later
   refactor.
2. **Geographic context comes from a checked-in, offline vector basemap**:
   Natural Earth 1:110m land + country outlines (public domain), converted by
   `scripts/generate-basemap.mjs` into a flat ring list
   (`apps/web/src/features/map/basemap/land-110m.json`, ~60–90 KB), rendered
   as SVG `<path>`s. This is one static data file, not a tile store or a
   basemap engine; a blank scatter plot would be dishonest UX once the data
   exists to do better, and bundling raster tile pyramids (gigabytes) is
   correctly rejected as overkill for the same reason this single small file
   is not.
3. **No map library.** `maplibre-gl` (~200 KB gzip) requires WebGL and blob-URL
   web workers, which fights the CSP being added, and exists to render
   tiles — the one thing v1 does not do. `leaflet`/`react-leaflet` (~45 KB
   gzip) is a raster-tile layer manager; without a tile layer it would be
   used at ~5%, while still importing its own CSS (colors outside
   `theme.ts`, against house rules) and DOM-mutating lifecycle. What v1
   actually needs — a Web Mercator projection, grid clustering, and a
   pan/zoom viewport reducer — is a ~200-line, dependency-free, DOM-free
   island core (`apps/web/src/features/map/core/**`), unit-tested without a
   renderer. **If remote tiles are ever adopted, MapLibre GL JS (BSD-3,
   actively maintained, no vendor telemetry) is the pick, not Leaflet and not
   a proprietary SDK.**
4. **Packaged renderer loads gain a Content-Security-Policy** with no remote
   origin in any directive (`apps/desktop/src/csp.ts`,
   `apps/desktop/src/main.ts`, production loads only — the Vite dev server is
   exempt because HMR needs a websocket and eval'd modules). `connect-src` and
   `img-src` are pinned to `'self'` plus `media:` (the app's own `media://`
   protocol) and `data:`/`blob:`; `object-src`, `frame-src` and `base-uri` are
   `'none'`. Two relaxations are recorded here rather than as code comments:
   `style-src 'unsafe-inline'` (emotion/MUI's runtime style injection) and
   `worker-src blob:` (Vite/MUI worker shims). The privacy promise becomes
   machine-enforced instead of policy-only, and no new origin is granted, so
   no origin needs justifying.
5. **Detail-surface coordinates are read from the same locations query**,
   keyed by `contentHash`/fingerprint, rather than by extending
   `scanVideoSchema`. `scanVideoSchema` has no `gps` field, and adding one
   would require filling it on both scan paths — the cached global-catalog
   path (which has `gpsLat`/`gpsLon`) and the local-repository path (whose
   `Video` domain type has no GPS columns at all, i.e. a per-folder SQLite
   migration) — which is disproportionate for a v1 read. The documented
   limitation: a video never written to the global catalog shows no
   coordinates, which is truthful — they have not been extracted yet.

**Preconditions for ever loading remote tiles**: a superseding ADR, a
Settings toggle defaulting to OFF, an explicit CSP origin added in the same
commit naming the host, visible in-app attribution naming that host, and a
graceful tile-less fallback retained.

## Consequences

- The map is honest about its own coverage (`"110 of 3752 catalogued files
  have location"`) but cannot show streets or place names; reverse geocoding
  stays out of scope.
- The CSP change can white-screen a packaged build if widened carelessly —
  `pnpm run qa:walkthrough` (mandatory before any DMG handoff) is the check,
  and the CSP commit is kept separable from the map feature so a revert of
  one does not have to take the other.
- Visual regression does not gain a map surface this wave (baselines are
  owner-armed, and the map's pixels depend on the basemap data and on
  `ResizeObserver` geometry — exactly the kind of surface that produces a
  flaky baseline). `MapCanvas` exposes an unused `initialViewport` prop now so
  a future deterministic `map-empty`/`map-pins` surface is a one-file change.

## Alternatives rejected

- **Opt-in tiles in v1** — a real privacy surface and a second render path for
  no v1 benefit; deferred behind the preconditions above.
- **Bundling a raster basemap** — gigabytes, for a "where are my 110 clips"
  v1.
- **Leaflet / MapLibre without a tile layer** — dependency weight for ~5%
  usage, plus colors escaping `theme.ts` and jsdom quirks in component tests.
- **An eslint rule banning URL literals in `features/map`** — considered and
  rejected as unenforceable noise (a tile URL can be assembled from
  fragments); the CSP is the real, machine-checked gate. Its guard is proved
  by a test that temporarily adds a tile origin to the policy and confirms
  the CSP test goes red before removing it.
- **Server-side pin clustering** — clustering is a viewport concern (screen
  pixels at the current zoom), not a catalog concern, so it lives in the
  island core, not the adapter.
