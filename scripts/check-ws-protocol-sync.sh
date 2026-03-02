#!/usr/bin/env bash
# Verify ws-protocol types stay in sync between duel-server and Angular front-end.
# Run: bash scripts/check-ws-protocol-sync.sh (from project root)
# Exit code 0 = in sync, 1 = diverged.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE="$ROOT/duel-server/src/ws-protocol.ts"
COPY="$ROOT/front/src/app/pages/pvp/duel-ws.types.ts"

if ! diff -q "$SOURCE" "$COPY" > /dev/null 2>&1; then
  echo "ERROR: ws-protocol files are out of sync!"
  echo "  Source: duel-server/src/ws-protocol.ts"
  echo "  Copy:   front/src/app/pages/pvp/duel-ws.types.ts"
  echo ""
  diff --unified=3 "$SOURCE" "$COPY" || true
  exit 1
fi

echo "OK: ws-protocol files are in sync."
