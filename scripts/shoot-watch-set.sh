#!/usr/bin/env bash
# Seeds a language's envelope into the watch simulator's app group and captures the Today (and,
# for en, the qibla) frame. Companion to make-watch-envelope.ts; see docs/screenshots/README.md.
# The watch sim must be freshly erased (or never phone-paired-synced): the app replays WCSession's
# last received context at activation, which overrides a seeded envelope — by design.
set -euo pipefail
UDID="${1:?usage: shoot-watch-set.sh <watch-udid> <group-container-path>}"
GROUP="${2:?path to the group.app.simpleprayer AppGroup container}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${TMPDIR:-/tmp}"

for LANG in en tr ar; do
  bun --preload "$ROOT/scripts/preload-native-mocks.ts" "$ROOT/scripts/make-watch-envelope.ts" \
    --lang "$LANG" > "$SCRATCH/envelope-$LANG.json"
  python3 - "$GROUP" "$SCRATCH/envelope-$LANG.json" <<'PY'
import plistlib, sys, pathlib
group, src = sys.argv[1], sys.argv[2]
prefs = pathlib.Path(group) / 'Library' / 'Preferences'
prefs.mkdir(parents=True, exist_ok=True)
p = prefs / 'group.app.simpleprayer.plist'
data = plistlib.load(open(p, 'rb')) if p.exists() else {}
data['SPWatchEnvelope'] = open(src).read()
plistlib.dump(data, open(p, 'wb'))
PY
  xcrun simctl terminate "$UDID" app.simpleprayer.watchkitapp >/dev/null 2>&1 || true
  xcrun simctl launch "$UDID" app.simpleprayer.watchkitapp >/dev/null
  sleep 4
  mkdir -p "$ROOT/docs/screenshots/$LANG/watch"
  xcrun simctl io "$UDID" screenshot --type=png "$ROOT/docs/screenshots/$LANG/watch/today.png" >/dev/null
  echo "  → $LANG/watch/today.png"
  if [ "$LANG" = "en" ]; then
    xcrun simctl terminate "$UDID" app.simpleprayer.watchkitapp >/dev/null 2>&1 || true
    xcrun simctl launch "$UDID" app.simpleprayer.watchkitapp -SPQibla >/dev/null
    sleep 5
    xcrun simctl io "$UDID" screenshot --type=png "$ROOT/docs/screenshots/en/watch/qibla.png" >/dev/null
    echo "  → en/watch/qibla.png"
  fi
done
echo WATCH_SET_DONE
