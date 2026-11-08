#!/usr/bin/env bash
# Runs the full screenshot matrix (3 locales × 2 themes) against one booted simulator.
# Thin driver around capture-store-screenshots.sh; see docs/screenshots/README.md.
set -uo pipefail
UDID="${1:?usage: run-capture-matrix.sh <udid>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for LOC in en tr ar; do
  for TH in light dark; do
    "$ROOT/scripts/capture-store-screenshots.sh" "$UDID" "$LOC" "$TH" \
      "$ROOT/docs/screenshots/$LOC/$TH/6.5" || echo "FAILED $LOC $TH"
  done
done
echo MATRIX_DONE
