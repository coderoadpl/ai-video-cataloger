# ADR-0009: License — GPL-3.0 with VoiceInk-style monetization

Date: 2026-08-01 · Status: accepted (owner decision, 2026-08-01)

## Context

The repository carried no license at all (the PoC's `"license": "MIT"` was
scaffold boilerplate, never a decision; it was removed from the working tree by
the rewrite and scrubbed from history on 2026-08-01 before any publication).
The owner intends to make the repository public and to monetize the app in the
same shape as VoiceInk (github.com/Beingpax/VoiceInk): public source under
GPL-3.0, paid one-time-purchase distribution selling convenience — notarized
signed builds, automatic updates, support — while anyone may build from source.

## Decision

1. The project is licensed **GPL-3.0-only**: the canonical license text lives
   in `LICENSE`, and the root `package.json` declares `"license":
   "GPL-3.0-only"`. Sub-packages inherit the repository license; none declares
   its own.
2. Copyright is held entirely by the company (all code was produced under its
   direction; contributor agreements transferred the PoC-era work). Because the
   company is the sole rights-holder, it retains the ability to dual-license or
   re-license future distributions — this is load-bearing for monetization and
   must be preserved: **outside contributions, if ever accepted, require a CLA
   or copyright assignment first** so the sole-rights-holder property survives.
3. Copyleft is the point, not an accident: a competitor may fork, but a fork
   must remain GPL and cannot use the product name (trademark rights are not
   granted by the GPL). Bundling the GPL build of ffmpeg becomes
   license-consistent rather than a liability.
4. Monetization does not contradict the license: paid tiers sell signed and
   notarized builds, automatic updates and support. License-key/activation
   code, if added, lives in the open source tree like the rest of the app.

## Consequences

- `LICENSE` (GPLv3 full text) ships at the repo root; the README gains a
  license section when the repo goes public.
- Distribution artifacts (DMG) must include the license text and source-access
  notice once distributed publicly.
- The going-public checklist still applies (old-object GC on GitHub before the
  visibility flip; the PoC repo remains private or gets the same scrub).
