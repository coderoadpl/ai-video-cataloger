#!/usr/bin/env bash
#
# Stage the CLI for packaging: compiled dist/ plus PRODUCTION-ONLY
# node_modules, so the Electron app ships a self-contained engine in
# resources/cli (spawned with Electron's own Node via ELECTRON_RUN_AS_NODE).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
STAGE="$ROOT/.cli-stage"

rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/pnpm-workspace.yaml" "$STAGE/"
cp -R "$ROOT/dist" "$STAGE/dist"

# pnpm-workspace.yaml travels with the manifest because its onlyBuiltDependencies
# is what materializes the ffmpeg/ffprobe binaries the staged CLI spawns.
( cd "$STAGE" && pnpm install --prod --frozen-lockfile )

echo "Staged CLI: $(du -sh "$STAGE" | cut -f1)"
