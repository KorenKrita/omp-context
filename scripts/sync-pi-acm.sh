#!/usr/bin/env bash
# sync-pi-acm.sh — Sync only pi-context ACM code.
# OMP ACM is published exclusively by omp-context's declarative sync command.
set -euo pipefail

PI_CTX="${1:?Usage: sync-pi-acm.sh <path-to-pi-context>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Syncing pi-context → packages/pi-plugin/src/acm/"
cp "$PI_CTX/src/index.ts" "$ROOT/packages/pi-plugin/src/acm/tools.ts"
cp "$PI_CTX/src/lib.ts" "$ROOT/packages/pi-plugin/src/acm/lib.ts"
echo "✓ Pi ACM sync complete."
