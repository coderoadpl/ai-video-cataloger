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
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/"
cp -R "$ROOT/dist" "$STAGE/dist"

# Production deps only; postinstall scripts must run (ffmpeg-static downloads
# its binary in one).
( cd "$STAGE" && npm ci --omit=dev --no-audit --no-fund )

echo "Staged CLI: $(du -sh "$STAGE" | cut -f1)"
