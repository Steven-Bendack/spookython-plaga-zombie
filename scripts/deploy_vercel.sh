#!/usr/bin/env bash
# Deploy the Vercel preview from a clean copy outside git (avoids "Blocked"
# deployments when the commit author is not a member of the Vercel team).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Folder name = Vercel project name.
OUT="${TMPDIR:-/tmp}/plaga-zombie-manta"
rm -rf "$OUT" && mkdir -p "$OUT/src"
cp "$ROOT/app.py" "$ROOT/requirements.txt" "$ROOT/vercel.json" "$OUT/"
cp -r "$ROOT/src/engine" "$OUT/src/"
git -C "$ROOT" rev-parse --short=12 HEAD > "$OUT/src/engine/COMMIT"
cp -r "$ROOT/src/web" "$OUT/public"
find "$OUT" -name "__pycache__" -type d -prune -exec rm -rf {} +
cd "$OUT" && npx -y vercel@latest deploy --prod --yes --scope "${VERCEL_SCOPE:-usandovercel}"
