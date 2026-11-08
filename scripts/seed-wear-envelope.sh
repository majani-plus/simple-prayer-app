#!/usr/bin/env bash
# Seeds a language's REAL envelope (make-watch-envelope.ts) into the Wear app's SharedPreferences
# on a connected Wear emulator, via run-as (debug builds only), and restarts the app.
#
#   ./scripts/seed-wear-envelope.sh <lang en|tr|ar> [adb-serial]
set -euo pipefail
LANG_ARG="${1:?lang: en|tr|ar}"
SERIAL="${2:-}"
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
[ -n "$SERIAL" ] && ADB="$ADB -s $SERIAL"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${TMPDIR:-/tmp}"

bun --preload "$ROOT/scripts/preload-native-mocks.ts" "$ROOT/scripts/make-watch-envelope.ts" \
  --lang "$LANG_ARG" > "$SCRATCH/wear-envelope.json"

# SharedPreferences XML: the JSON needs XML entity escaping only for & < > (quotes live inside
# a text node). python writes the file locally; adb streams it in through run-as.
python3 - "$SCRATCH/wear-envelope.json" "$SCRATCH/wear-envelope.xml" <<'PY'
import sys, html
json_text = open(sys.argv[1]).read().strip()
escaped = html.escape(json_text, quote=False)
open(sys.argv[2], 'w').write(
    "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n"
    "<map>\n"
    f"    <string name=\"envelope\">{escaped}</string>\n"
    "</map>\n"
)
PY

$ADB shell am force-stop app.simpleprayer
$ADB push "$SCRATCH/wear-envelope.xml" /data/local/tmp/wear-envelope.xml >/dev/null
$ADB shell run-as app.simpleprayer mkdir -p shared_prefs
$ADB shell "run-as app.simpleprayer sh -c 'cp /data/local/tmp/wear-envelope.xml shared_prefs/app.simpleprayer.wear.envelope.xml'"
$ADB shell am start -n app.simpleprayer/app.simpleprayer.wear.MainActivity >/dev/null
echo "seeded $LANG_ARG and relaunched"
