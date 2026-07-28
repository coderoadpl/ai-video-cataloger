# Release walkthrough — the mandatory pre-DMG self-QA phase

No DMG is offered to the owner before this phase has run against the **real
packaged app** and its screenshot set has been reviewed. Owner-visible issues
shrink when the proof is empirical: a gate that only reads green in a terminal
has never looked at a badge, a thumbnail or a Polish sentence.

The runner is `scripts/release-walkthrough.mjs`, wrapped by
`pnpm run qa:walkthrough`. It drives the packaged app with Playwright's
`_electron`, captures one screenshot per step, and writes `plan.json` and
`manifest.json` (step, status, duration, screenshot, time-to-window) next to
them.

Every run opens the driven window at **1920x1200** by default — large enough
that the details column never collapses in the captured screenshots — via a
seeded `window-state.json` in the fresh user-data directory. Override it with
`--window-size WxH` (for example `--window-size 1440x900`). Before each
screenshot the runner waits for pending CSS transitions/animations and any
spinner/loading indicator to clear, falling back to a short fixed delay when
that can't be detected, so a shot never lands mid-spinner or mid-fade.

## Isolation

Every run launches with:

- `AI_VIDEO_CATALOGER_USER_DATA_DIR` — a fresh temp user-data directory (the
  packaged app honours the environment variable; `--user-data-dir=` is passed
  as well for development builds).
- `HOME`/`USERPROFILE` — a throwaway temp home unless `--home` names a prepared
  QA home, so the home-scoped catalog, config and models are never the owner's.
- `AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN=1` — the login keychain is never read,
  written or prompted for.

A run therefore never mutates real user data. Analysis needs a configured
analyzer, which a throwaway home does not have: pass `--home` pointing at a
prepared QA home (for example the
`~/repositories/claude-tmp/avc-e2e-matrix-home` cache used by
`pnpm run test:e2e:matrix`) when the analysis step must actually run. Without
it the step reports itself `skipped`, which is a legitimate outcome — a silent
pass is not.

## Procedure

1. Build the bundle under test:

   ```bash
   pnpm run electron:package
   ```

2. Check the bundle shape (still outside the normal gates):

   ```bash
   pnpm run verify:package
   ```

3. Run the walkthrough against the built `.app` and a fixture folder of sample
   videos:

   ```bash
   pnpm run qa:walkthrough -- \
     --app "release/mac-arm64/AI Video Cataloger.app" \
     --fixtures ~/repositories/claude-tmp/avc-walkthrough-fixtures \
     --home ~/repositories/claude-tmp/avc-e2e-matrix-home
   ```

   `pnpm run qa:walkthrough -- --help` lists every option;
   `--dry-run` validates the inputs and writes `plan.json` without launching
   the app.

4. Review the screenshot set (see below) before writing a single word of the
   handoff message.

The steps captured, in order: `launch` (with time-to-window), `first-run-wizard`,
`open-folder`, `tree-expand`, `select-video`, `analyze`, `search`, `settings`,
`wizard`.

## Review the screenshots

A `failed` step is a P1 — fix it or pull the release; a re-run to green without
a diagnosis is forbidden ([flake doctrine](../../CLAUDE.md)). A `skipped` step is
accepted only when its note explains a deliberate absence (no subfolders in the
fixture tree, no analyzer in this home).

Read every screenshot against the sensitivities that have burned us before:

- **Status badges** — icon inset and label padding symmetrical, no clipped text,
  the same height across pending/completed/error/duplicate.
- **Thumbnails** — real frames where a video was analyzed, the placeholder (not a
  broken image, not a permanent shimmer) elsewhere; portrait clips are not
  stretched.
- **Scrollbars** — no double scrollbar in the sidebar or the details panel, no
  horizontal scrollbar on a long filename.
- **Empty states** — an empty folder, an unanalyzed video and an empty search
  result each say something, and never render a bare panel.
- **Polish copy** — with the UI language set to PL, no `key.path` leaks, no
  English fallback sentence, no clipped label in a narrower Polish string.
- **Layout** — the modal set (settings, wizard) is centred and fully inside the
  window at the walkthrough's window size (1920x1200 by default).

The manual suites in [manual-test-checklists.md](manual-test-checklists.md) stay
the deeper pass; this walkthrough is the always-run floor beneath them.
