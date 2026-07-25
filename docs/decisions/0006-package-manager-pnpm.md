# ADR-0006: Package manager — npm → pnpm, on Node 22.23.1

Date: 2026-07-27 · Status: accepted (standing delegation, migration round-2
decision 3) · Adopts the foundation's ADR-0009
(`agentproofarch/docs/decisions/0009-package-manager-pnpm.md`) after the spike
that decision made a precondition. Builds on
[ADR-0001](0001-local-first-electron.md) §9 (gates from day one) and
[architecture.md §Gates](../architecture.md#gates).

## Context

The foundation's supply-chain argument is adopted whole and is not re-derived
here: pnpm ≥10 does not execute dependency install scripts, a
`minimumReleaseAge` cooldown declines to be the first machine to install a
fresh version, the strict non-hoisted layout makes the resolver enforce
declared dependencies, and the content-addressable store makes cold installs
cheap. It hardens **installation**; a compromised package's runtime code still
runs when the app imports it.

What this app had that the foundation does not is a set of **literal-path
couplings to `node_modules`**:

- `electron-builder.config.js` names `node_modules/ffmpeg-static/ffmpeg`,
  `node_modules/@ffprobe-installer/darwin-arm64/ffprobe`,
  `node_modules/sql.js/dist/sql-wasm.wasm` and the `onnxruntime-node` darwin
  binding directly, in both `files` and `asarUnpack`;
- the staged CLI (`scripts/build-packaged-cli.mjs`, the `afterPack` symlink)
  resolves `onnxruntime-node` out of the packaged `node_modules`;
- round 1 had already been burned once on this exact ground — a bare npm 11
  install silently pruned platform-optional lock entries and shipped a green
  `check` with a broken `electron:package`, which is why the repo carried an
  npm-10 pin and a lock-lint written in npm-10 semantics.

pnpm's strict layout changes precisely that ground: top-level packages become
symlinks into `node_modules/.pnpm`, and transitive platform packages are not at
the top level at all. So the decision was conditioned on evidence, not on the
upstream argument.

## Decision

1. **Adopt pnpm with the default (strict, symlinked) layout.** No
   `node-linker=hoisted`, no `shamefully-hoist`. The sanctioned-deviation branch
   of the migration plan is not taken: the packaging ladder is green on the
   strict layout, so there is nothing to trade for.

2. **The toolchain pin is `packageManager: pnpm@10.34.5`** (current stable of
   the 10 line) plus `engines.pnpm: ">=10 <11"`. `engines` is not advisory here
   the way `engines.npm` was — pnpm enforces its own `engines.pnpm`, and a stale
   global pnpm on `PATH` is rejected before it can write anything (observed: a
   global pnpm 7.27.1 refused with `ERR_PNPM_UNSUPPORTED_ENGINE`). The version
   bumps like any other dependency, in a reviewed PR that passes both gates.

3. **Node stays on the 22 line, but the pin becomes exact: `22.23.1`**
   (`.nvmrc`; `engines.node: "22.x"`). This is a deviation from the foundation's
   Node 24 and it is evidence-driven, in both halves.

   The old Node pin was never about Node: it existed only to pick the npm major
   bundled with it. With npm gone the constraint inverts — Corepack is what
   activates the pinned pnpm, and Corepack is versioned with Node. The spike's
   open item was that **Node 22.12.0 bundles Corepack 0.29.4, which rejects
   pnpm's current signing key** (`Error: Cannot find matching keyid: …` on any
   `corepack pnpm` invocation). That is a property of *that* Node patch, not of
   the 22 line: **Node 22.23.1 (Latest LTS Jod) bundles Corepack 0.34.6, which
   activates the pin cleanly** — `pnpm --version` → `10.34.5`, exit 0, no flags,
   no shim. Which is why the floating `.nvmrc` value `22` is replaced by an
   exact one: "some Node 22" is not a toolchain, and a stale local 22.12.x is
   exactly the machine that cannot activate the pin.

   Node 24 was then evaluated on its merits, and **`check` goes red on it**:

   | Runtime | Statements | Branches | Functions | Lines | `check` |
   |---|---|---|---|---|---|
   | Node 22.23.1 | 80.94% | 81.68% (5358/6559) | 75.95% | 80.94% | PASS |
   | Node 24.18.0 | 81.00% | **77.60%** (5087/6555) | 75.55% | 81.00% | **FAIL** (branch floor 80) |

   Same commit, same 137 files / 980 tests all passing, essentially the same
   branch denominator — 271 branches that V8 on Node 22 reports as taken are
   reported as untaken by V8 on Node 24, and `@vitest/coverage-v8` 3.2.7 relays
   that verbatim. The two ways to take Node 24 today are to lower the branch
   floor to 77 (weakening a gate to pass it, which the house rules forbid) or to
   upgrade to vitest 4 (a major-version migration that has nothing to do with
   package managers). Neither belongs in this change, so the bump is deferred,
   not rejected: **revisit trigger — the vitest 4 upgrade.** Bump `.nvmrc` to 24
   in that PR and re-measure the floor there.

   Everything else in the stack was exercised on the pinned 22.23.1 by the
   ladder below: pnpm 10, tsx, esbuild, electron-builder 26, Electron 37,
   onnxruntime-node and the DMG build. The packaged CLI's esbuild target stays
   `node22`, which is now doubly right — it runs on **Electron's** Node.

4. **Dependency install scripts stay off; three packages earned an exception**,
   named in `pnpm-workspace.yaml`'s `onlyBuiltDependencies`. Each was added only
   after it broke something, and the failure is recorded here so a future
   reviewer can re-derive the entry rather than trust it:

   | Package | Its script | Failure without the entry |
   |---|---|---|
   | `ffmpeg-static` | `postinstall` downloads the platform ffmpeg binary | `require('ffmpeg-static')` resolved to a path that does not exist, so `adapters/ffmpeg` had no ffmpeg, the e2e helper threw, and `electron-builder`'s `node_modules/ffmpeg-static/ffmpeg` `files`/`asarUnpack` entries matched nothing |
   | `@ffprobe-installer/darwin-arm64` | `postinstall` is `chmod u+x ffprobe` | the 18 MB binary ships inside the tarball but non-executable; spawning it failed with `permission denied` |
   | `electron` | `postinstall` downloads the Electron runtime | `require('electron')` threw `Electron failed to install correctly`, breaking `electron:package`, `electron:dev` and the GUI e2e leg |

   The spike report's "zero allowlist entries needed" did **not** survive a
   clean-room reinstall: the spike measured a `node_modules` tree that npm had
   already populated, so the three missing artifacts were still on disk. The
   evidence here comes from `rm -rf node_modules` before every install.

   Notably absent, and deliberately so: `esbuild` (verified working — modern
   esbuild ships its binary in a platform-optional package, not a script),
   `onnxruntime-node` (its darwin binding is inside the tarball),
   `unrs-resolver` (same pattern; `lint` is green), `msw` (its script prints a
   banner) and `electron-winstaller` (a Windows-only transitive of
   electron-builder we never target).

5. **The literal-path couplings survive the strict layout, unchanged.**
   `electron-builder.config.js` was not edited by this migration.
   Electron Builder detects `pm=pnpm`, walks the linked production tree and
   copies through the symlinks, so the packaged bundle contains a real flat
   `node_modules`. The proof is not the absence of an error — it is
   `verify:package` on the built bundle plus the packaged CLI running from the
   staged `.app`.

6. **A 3-day cooldown is on**: `minimumReleaseAge: 4320` (minutes) in
   `pnpm-workspace.yaml`. **Override procedure**: an urgent security patch
   younger than the cooldown is taken by lowering `minimumReleaseAge` — or
   adding a scoped `minimumReleaseAgeExclude` entry — **in a reviewed pull
   request**, never by a local flag and never silently; the lowering and its
   revert are both in the diff. The cost is accepted explicitly: the setting
   that blocks a worm's first hours also blocks this morning's fix for a
   critical advisory.

7. **`lock-lint` is retargeted, not retired.** It stops asking "does
   `package-lock.json` still resolve under npm 10" and starts asking the
   frozen-lockfile question every install path now asks. `scripts/lock-lint.mjs`
   fails closed on two states: a **missing** `pnpm-lock.yaml`, and a lockfile
   that no longer agrees with `package.json`. The missing-lockfile arm is not
   redundant — `pnpm install --frozen-lockfile --lockfile-only` exits **0** when
   there is no lockfile at all, so the bare pnpm command alone would not fail
   closed. `pnpm-lock.yaml` is committed; `package-lock.json` is deleted.

8. **`smoke`'s drift step becomes an installed-tree check.** npm's version was
   "does `node_modules/.package-lock.json` match `package-lock.json`", which
   existed to catch npm 11 pruning platform-optional entries. pnpm cannot prune
   that way, and the lockfile half of the question is now `lock-lint`'s. What
   remains is the half that actually shipped the round-1 bug: `smoke` asserts
   that every declared dependency is linked into `node_modules`, and that every
   native asset the packaged bundle reads as a literal path is materialized and
   (for the three binaries) executable. That makes the `onlyBuiltDependencies`
   list self-guarding — deleting an entry turns `smoke` red with the asset name.

9. **Every install path moves together.** The three self-hosted workflows
   (`check`, `smoke`, `e2e`) install with `pnpm install --frozen-lockfile`,
   cache the pnpm store via `actions/setup-node`'s `cache: pnpm`, and get pnpm
   from `pnpm/action-setup` pinned by full commit SHA
   (`b906affcce14559ad1aafd4ab0e942779e9f58b1`, v4.3.0) per the SHA-pin
   convention — with no `version:` input, so `packageManager` stays the single
   source of the version. `npm audit` becomes `pnpm audit --prod`, still
   advisory. `scripts/stage-cli.sh` and `scripts/e2e-videos.sh` install with
   pnpm. `landing/` was already on pnpm; its action is now SHA-pinned too.

10. **The npm-10 pin story is retired.** `engines.npm`, `packageManager:
    npm@10.9.2`, "regenerate with `npx -y npm@10 install`" and the whole
    npm-11-prunes-platform-optionals paragraph in `CLAUDE.md` describe a problem
    that no longer exists. What replaces it is smaller: pin the package manager,
    let `engines.pnpm` reject the wrong one, and let `smoke` prove the native
    assets are on disk.

## Evidence — the proof ladder

Every rung ran on Node 22.23.1 with pnpm 10.34.5 activated by that Node's
bundled Corepack, against a `node_modules` deleted and reinstalled with
`pnpm install --frozen-lockfile`.

| Rung | Result |
|---|---|
| `pnpm install --frozen-lockfile` on an empty `node_modules` | PASS, 8.5 s |
| `pnpm run check` (typecheck ×2, lint, depcruise, knip, doc-lint, vitest + coverage) | PASS — 137 files / 980 tests, branches 81.68% over the 80 floor |
| `pnpm run smoke` | PASS, 7.7 s |
| `pnpm run electron:package` **including the DMG** | PASS — `AI Video Cataloger-0.5.13-arm64.dmg` (174 MB) + blockmap, exit 0 |
| `pnpm run verify:package` | PASS — one darwin onnxruntime binding, zero non-darwin artifacts, packaged CLI resolves `onnxruntime-node`, `codesign --verify --deep --strict` exit 0, sealed resources |
| packaged CLI from the staged `.app` in a temp `HOME` | PASS — `--version` → `0.5.13` exit 0; `doctor` exit 0 with `ffmpeg: available` / `ffprobe: available` |
| `drive-gui × local-system × skip` @gui leg vs local system Ollama (`gemma3:4b`) | PASS, 27.9 s |

The spike's untested rung is closed: DMG creation succeeds outside a sandbox.
Its `hdiutil: create failed - Device not configured` was a sandbox artifact, not
a pnpm one.

Electron Builder logged `detected workspace root for project using packageManager
field pm=pnpm`, flattened the linked tree, and shipped the literal-path assets
as real files: `app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg` (executable),
`app.asar.unpacked/node_modules/@ffprobe-installer/darwin-arm64/ffprobe`
(executable), the darwin onnxruntime binding, and `cli/node_modules` symlinked to
the unpacked tree. It also warned that it did not bundle the seven **non**-darwin
`@ffprobe-installer` platform packages — the correct outcome for a mac-only
build, and the transitive-platform-binary behaviour to keep in mind if this app
ever targets a second platform.

`lock-lint` fail-closed probe — desync, observe red, restore:

| Lockfile state | `pnpm run lock-lint` | `pnpm run smoke` |
|---|---|---|
| in sync | exit 0, "OK — pnpm-lock.yaml is present and resolves under frozen-lockfile semantics" | PASS |
| `package.json` gained a dependency the lockfile lacks | exit 1, `ERR_PNPM_OUTDATED_LOCKFILE … 1 dependencies were added: left-pad@^1.3.0` | FAIL |
| `pnpm-lock.yaml` moved away | exit 1, "pnpm-lock.yaml is missing; nothing pins the dependency tree" | — |
| restored | exit 0, `pnpm-lock.yaml` byte-identical (`shasum` unchanged before and after) | PASS |

The installed-tree arm was probed the same way: deleting the ffmpeg binary turned
`smoke` red with `ffmpeg-static binary is missing or not executable at …`, and
restoring it turned it green.

`pnpm import` reproduced the npm lockfile's resolutions exactly — spot-checked
against `package-lock.json` at `HEAD` (electron 37.10.3, typescript 5.9.3,
eslint 9.39.5, vite 7.3.6, knip 6.29.0, tsx 4.23.0, esbuild 0.28.1,
onnxruntime-node 1.27.0, electron-builder 26.15.3), the migration changed no
dependency version.

## Alternatives considered

- **`node-linker=hoisted` as our sanctioned deviation (rejected).** This was the
  migration plan's fallback if the strict layout broke packaging. It did not:
  the three failures the strict install produced were all *blocked install
  scripts*, which a hoisted layout would not have fixed either. Flattening the
  tree would have given up the phantom-dependency guarantee for nothing.
- **Node 22 with a Corepack shim (rejected as unnecessary).** The spike's
  fallback was to keep 22 and document a standalone-Corepack workaround. Moving
  the pin forward inside the same LTS line, to a Node whose *bundled* Corepack
  already accepts pnpm's key, gets the same result with no workaround to
  document, forget or rot.
- **Node 24 with the branch floor lowered to 77 (rejected).** It is the shortest
  path to the foundation's Node, and it is exactly the move the gates exist to
  forbid: the floor is a ratchet, and re-measuring it downward on a runtime that
  reports coverage more pessimistically buys alignment by giving up 271
  branches' worth of protection.
- **Adding `onlyBuiltDependencies` entries pre-emptively from pnpm's "ignored
  build scripts" warning (rejected).** That warning names eight packages; three
  of them actually matter here. Trusting the warning would have re-enabled
  install-time execution for `msw`, `esbuild`, `unrs-resolver`,
  `onnxruntime-node` and `electron-winstaller` for no gate that needed it, which
  is how the allowlist quietly becomes npm again.

## Consequences

- **`pnpm` is the only supported invocation.** `npm install` in this repo now
  produces a second lockfile and a hoisted tree that no gate describes; the
  `packageManager` pin plus `engines.pnpm` is what stops it being an accident.
- **The allowlist is a standing review obligation.** Three entries is the whole
  budget until a gate earns a fourth. A package added because an install printed
  a warning is a regression, not a fix.
- **Corepack is load-bearing locally, not in CI.** CI gets pnpm from
  `pnpm/action-setup`, so a future Node line that unbundles Corepack changes the
  local setup instructions only. Locally the rule is `nvm use` first: an older
  Node 22 patch cannot activate the pin, and a global pnpm outside `>=10 <11` is
  refused by `engines.pnpm`.
- **This app is one Node line behind the foundation on purpose**, with the
  reason and the revisit trigger in §3. That gap is a tracked deviation, not
  drift.
- **The cooldown delays urgent patches too** — see the override procedure in §6.
- **`smoke` now fails on a `node_modules` that was never installed**, where it
  used to fail on one that had drifted. Both are the same class of red: run
  `pnpm install`.
