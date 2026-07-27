# ADR-0009: License — Elastic License 2.0 with VoiceInk-style monetization

Date: 2026-08-01 · Status: accepted (owner decision, 2026-08-01) · History: the
first same-day revision of this ADR chose GPL-3.0; the owner superseded it with
ELv2 hours later, before any publication or distribution, once the planned
license-key-gated features were weighed (no third party ever received the
GPL-licensed code, so no GPL grant survives).

## Context

The repository carried no license at all (the PoC's `"license": "MIT"` was
scaffold boilerplate, never a decision; it was scrubbed from history on
2026-08-01 before any publication). The owner intends to make the repository
public and to monetize the app in the VoiceInk shape — public source, paid
one-time-purchase distribution selling the notarized build (updates and
support optionally) — **and additionally wants the option of paid,
license-key-gated functionality whose code is public but not free to unlock**.
GPL-3.0 cannot express that last requirement: it forbids added restrictions
and permits anyone to strip a license check and redistribute the un-gated
build. Elastic License 2.0 expresses it directly.

## Decision

1. The project is licensed **Elastic License 2.0** (SPDX: `Elastic-2.0`): the
   canonical license text lives in `LICENSE`, and the root `package.json`
   declares `"license": "Elastic-2.0"`. Sub-packages inherit the repository
   license; none declares its own.
2. What ELv2 grants everyone: use, copy, modify, redistribute — free of
   charge, including building the app from source. What it withholds: (a)
   providing the software to third parties as a hosted/managed service, (b)
   **moving, changing, disabling or circumventing license-key functionality**,
   (c) removing licensing/copyright notices. This is the legal footing for
   future paid features: their code may live in the public tree behind a
   license key, and stripping the key is a license violation.
3. Copyright is held entirely by the company. Because the company is the sole
   rights-holder it may dual-license and sell exceptions; **outside
   contributions, if ever accepted, require a CLA or copyright assignment
   first** so that property survives.
4. ELv2 is source-available, not OSI open source. Public copy uses the terms
   "public source" / "fair source", never "open source" — the landing and
   README must respect this distinction.
5. Trademark is not granted; forks cannot use the product name. The brand is
   protected separately from the license.

## Consequences

- `LICENSE` (ELv2) ships at the repo root; the README gains a license section
  when the repo goes public.
- Distribution artifacts (DMG) include the license text.
- If license-key gating ships, the gating code is honest to the license: the
  key check may be open, and ELv2 §"license key" is what makes bypassing it a
  violation — no obfuscation theater required.
- The going-public checklist still applies (old-object GC on GitHub before the
  visibility flip; the PoC repo remains private or gets the same scrub).
