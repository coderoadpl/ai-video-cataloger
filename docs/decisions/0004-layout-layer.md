# ADR-0004: The layout layer — page skeletons for this renderer

Date: 2026-07-27 · Status: accepted (standing delegation, migration plan
decision 1) · Adopts the foundation's ADR-0011
(`agentproofarch/docs/decisions/0011-layout-layer.md`) with the app-specific
rulings below. Builds on [ADR-0001](0001-local-first-electron.md) (frozen
kickoff constraints) and the renderer i18n ruling in
[architecture.md §Island cores](../architecture.md#island-cores-adr-0005-rung-1-and-i18n).

## Context

This app exhibits the exact defect the foundation ADR names, in both halves:

- `apps/web/src/features/shell/AppShell.tsx` was the **stateful chrome living
  in a feature** — modal state, Electron menu events, sidebar/terminal collapse,
  the folder-error snackbar, the nested-database dialog. Features are islands
  (`web-features-are-islands`), so nothing but `routes/index.tsx` could legally
  consume the chrome of the whole app.
- `apps/web/src/components/ui/AppLayout.tsx` was the **page skeleton living in
  `components/ui/`** — the 100vh column, the resizable sidebar rail, the content
  region, the terminal drawer. It survived `web-ui-presentational` only because
  it holds no server state, and it broke the spirit of the presentational layer
  by owning the shape of the one and only page.

The renderer therefore had no legal home for "the skeleton of a page", exactly
as the foundation recorded. Everything else in that ADR's context transfers
unchanged, so this document is a **delta**: it records what we adopt verbatim
and what this app decides for itself.

## Adopted verbatim from foundation ADR-0011

1. **`components/layout/` is a named structural element of `apps/web`**, on the
   same footing as `components/ui/` and `lib/`: page skeletons, structure only.
   Grid, flex, spacing, sizing, position and the region borders live there;
   content arrives through `ReactNode` slots; a skeleton never fetches, never
   names a domain type and never reads a route param.
2. **Rule (a) — layouts are structure only.** `components/layout/**` may import
   `theme.ts`, `components/ui/` and `lib/` and nothing else in the app: no
   `core/**`, no `adapters/**`, no `features/**`, no `routes/**`, no `api.ts`,
   no TanStack. Enforced by the dependency-cruiser rule
   `web-layouts-are-structure-only`, its `boundaries` element type
   (`web-layout`) and a `config-regression/` probe.
3. **Rule (b) — features consume layouts, they do not define them**, and it is
   honestly weaker: a claim about the content of a file, not an edge in the
   graph. Its mechanical tier is `n/a` until the structural `sx` tier triggers;
   review owns it until then.
4. **The shell is split, not relabelled** — chrome skeleton in
   `components/layout/AppShell.tsx`, the stateful half a thin composition
   beside `main.tsx`.
5. **The rejected alternatives stay rejected**: no speculative primitive
   catalog (we extract the shell and nothing else, see §Survey), no second
   screenshot engine, no golden-image harness.

## Our rulings

### (a) Skeletons carry no i18n — structure has no copy

`components/layout/**` may not import `i18n/`, and the depcruise rule lists
`apps/web/src/i18n` alongside `features`, `routes` and `api.ts`. Every visible
string — the sidebar heading, the show/hide affordances, the terminal title and
its JSON/copy/clear/collapse actions — arrives as a slot the composition fills
with translated nodes. This is the same seam as the round-1 island-core ruling
(cores emit typed keys; the web side translates): a skeleton is as portable as
a core, and copy is not structure. It is stricter than the foundation, whose
rule (a) is silent on i18n.

### (b) Resizable sizes are structure; persistence is not

The sidebar and terminal size **limits** (`SIDEBAR_MIN_SIZE`,
`SIDEBAR_MAX_SIZE`, `SIDEBAR_DEFAULT_SIZE`, and the terminal trio) are exported
from the skeleton — they are the page's shape. The **current** size arrives as a
prop (`sidebarWidth`, `terminalHeight`) with an `onResize` callback; reading and
writing `localStorage` stays in the composition. A skeleton that persisted its
own width would own user state, and the same skeleton could not then be
rendered twice (gallery, visual specs) without fighting over one storage key.

### (c) Non-happy branches render inside the skeleton

Loading, empty, degraded/read-only and error surfaces are states *of* the page.
Concretely: the readiness/degraded **banner has a `banner` slot above the
content region** instead of being prepended to the caller's content node, so the
content region's width and scroll container never change between a pending and
a loaded render. The collapsed-sidebar rail is likewise a skeleton state, not a
branch the caller assembles.

### (d) The optional MUI import ban is adopted

We render on MUI, so the foundation's *optional* closing technique for rule (b)
is cheap and we take it: `no-restricted-imports` forbids `Container`, `AppBar`,
`Drawer` and `Toolbar` from `@mui/material` (and their deep-import paths)
everywhere in `apps/web` except `components/layout/**`. It is not part of the
portable artifact and it does not close rule (b) — a `Box` with a `maxWidth` is
still a page skeleton — but it stops the most common way a feature grows one.
The ban lands green: no renderer file imports those four today, so the probe
fixture is its only violation.

### (e) The structural `sx` tier stays NORMATIVE WHEN TRIGGERED

Same design and the **same trigger as upstream**: the first case of a duplicated
page skeleton outside `components/layout/`. Nothing is switched on now — the
tier has never run against a real codebase, and turning an unproven mechanism
into a mandatory gate is exactly what this repo's probe discipline exists to
prevent. When it fires, `eslint-plugin-avc` gains the structural key category
with a per-file, shrink-only, stale-erroring baseline, and rule (b)'s
mechanical half closes with it.

## Survey — what was extracted, and what was deliberately not

The shell and media-detail view are the extracted skeletons. The renderer was
surveyed for repeated page-shape patterns (`Container`, page-level `maxWidth`,
centred cards) and the result remains small:

| Pattern | Occurrences | Ruling |
|---|---|---|
| App chrome (100vh column, sidebar rail, content region, terminal drawer) | 1, and it is the shell | extracted → `components/layout/AppShell.tsx` |
| Media detail (responsive padding, 1180px cap, flexible content + 440px preview, below-content region) | 2 (`VideoDetails`, `PhotosWorkspace`) | extracted → `components/layout/MediaDetailLayout.tsx`; translated, domain-aware content stays in each feature |
| Centred card page (`display: grid; placeItems: center` + a `maxWidth` `Paper`) | 1 (`RootErrorFallback.tsx`) | **not** extracted — one occurrence names nothing; the second one is the trigger |
| Other padded content pages (`p: 3–4` + column flex + a content `maxWidth`) | 2 (`DetailsPanel`, `PeopleView`), with different paddings and max widths | **not** extracted — they are not the media-detail skeleton, and unifying them would be a redesign |
| `Container` / `AppBar` / `Drawer` / `Toolbar` | 0 | nothing to move; the ban in (d) keeps it that way |

The foundation rejected a seven-primitive catalog as one app's output; the same
reasoning forbids us inventing primitives no feature needs.

## Consequences

- `components/layout/AppShell.tsx` holds the chrome skeleton;
  `apps/web/src/AppLayout.tsx` (beside `main.tsx`) is the stateful composition
  that owns modal state, menu events, collapse state, sidebar-width persistence
  and every translated label, and renders the skeleton.
  `features/shell/` keeps its hooks (`use-shell.ts`, `use-menu-events.ts`) —
  they are server/bridge state, not chrome — and `components/ui/AppLayout.tsx`
  is gone.
- `components/layout/MediaDetailLayout.tsx` holds the shared video/photo detail
  shape. It receives pre-rendered main, media and optional below-content slots
  plus test attributes; it does not import features, contracts, i18n or query
  state. The media slot is visually first at narrow widths and becomes the
  fixed 440px right column at large widths.
- `routes/index.tsx` renders `AppLayout`; the route stays thin and unchanged in
  behaviour. Every route is pixel-equivalent: this is a structural refactor.
- The enforcement matrix for rule (a): **TYPE** n/a (an import edge is not a
  type) · **LINT** `web-layouts-are-structure-only` (dependency-cruiser) plus
  the `web-layout` boundaries element · **TEST** the `config-regression` probe
  (a fixture importing a feature from a layout turns `check` red, by rule name)
  · **REVIEW+AI** n/a (mechanically covered). For rule (b): **TYPE** n/a ·
  **LINT** the MUI ban of (d) only, which is a proxy, not the rule · **TEST**
  the MUI-ban probe · **REVIEW+AI** owns the rest until (e) triggers.
- `web-layouts-are-structure-only` and `MUI_SKELETON_BAN` join doc-lint's
  promised-enforcer manifest in the same commit as the rules, so deleting
  either fails `check` instead of silently unmaking this ADR.
- **Honest note on colour.** The foundation's skeletons take colour from styled
  atoms exported by `theme.ts`; this renderer has no atom layer, so the
  skeleton names MUI theme *tokens* (`background.paper`, `divider`,
  `grey.900`) inline through `sx`. Raw colour literals remain banned everywhere
  outside `theme.ts` (`RAW_COLOR_BAN`), so the skeleton still survives a theme
  swap — but the claim "no colour in the skeleton" would be false here, and is
  not made.
- **A residual stays open and named**: nothing mechanical stops a feature from
  growing a page skeleton out of `Box` and `maxWidth` until the structural tier
  triggers. That is a REVIEW+AI-tier rule, documented as such.
- Visual specs per skeleton and per state are ADR-0008's ground and land with
  the visual suite in P2 of the migration plan
  ([`../../tasks/migration-agentproofarch-v2.md`](../../tasks/migration-agentproofarch-v2.md)),
  not here; the skeleton's states are covered by component tests today.
