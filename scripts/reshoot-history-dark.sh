#!/usr/bin/env bash
# One-slot re-shoot: the DARK-theme History frame (the website's "If you miss a day" band).
# The original frame caught the dev client's refresh banner mid-reload (owner, 2026-08-28).
# Same staging and restore discipline as capture-store-screenshots.sh, one slot, dark theme.
#
#   ./scripts/reshoot-history-dark.sh <udid>
set -euo pipefail
UDID="${1:?usage: reshoot-history-dark.sh <udid>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="app.simpleprayer"
INDEX="$ROOT/src/app/(tabs)/index.tsx"
LAYOUT="$ROOT/src/app/_layout.tsx"
WORK="$(mktemp -d)"
SETTLE="${SETTLE:-13}"

grep -q "const openPrayer = open.day === day ? open.prayer : null;" "$INDEX" || {
  echo "$INDEX is not the pristine Today screen — restore it before capturing." >&2; exit 1; }
cp "$INDEX" "$WORK/index.orig.tsx"
cp "$LAYOUT" "$WORK/layout.orig.tsx"

restore() {
  cp "$WORK/index.orig.tsx" "$INDEX"
  cp "$WORK/layout.orig.tsx" "$LAYOUT"
  echo "restored the two patched files"
}
trap restore EXIT

sed "s|if (!onboardingCompleted) router.replace('/onboarding');|void onboardingCompleted; require('@/stores/settingsStore').getSettingsActions().setLocation({ latitude: 41.0082, longitude: 28.9784, label: 'Istanbul', countryCode: 'TR', source: 'manual', resolvedAt: 1 }); // TEMP-SCREENSHOT|" \
  "$WORK/layout.orig.tsx" >"$LAYOUT"

cat >"$INDEX" <<'EOF'
import { LogBox } from 'react-native';
LogBox.ignoreAllLogs(true);
/* TEMPORARY — screenshot capture. scripts/reshoot-history-dark.sh restores this file. */
import { Redirect } from 'expo-router';

export default function TodayScreen() {
  return <Redirect href="/history" />;
}
EOF

xcrun simctl location "$UDID" set 41.0082,28.9784 >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" clear >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" override \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 \
  --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
xcrun simctl ui "$UDID" appearance dark >/dev/null 2>&1

for LANG in en tr ar; do
  case "$LANG" in
    en) APPLE_LOCALE="en_GB" ;;
    ar) APPLE_LOCALE="ar_SA" ;;
    tr) APPLE_LOCALE="tr_TR" ;;
  esac
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 1
  xcrun simctl launch "$UDID" "$BUNDLE_ID" \
    -AppleLanguages "($LANG)" -AppleLocale "$APPLE_LOCALE" >/dev/null 2>&1
  sleep "$SETTLE"
  # ALWAYS launch twice: the OS layout-direction flag persists from whatever locale ran LAST
  # (an en frame once shipped mirrored because the previous run ended on Arabic).
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 1
  xcrun simctl launch "$UDID" "$BUNDLE_ID" \
    -AppleLanguages "($LANG)" -AppleLocale "$APPLE_LOCALE" >/dev/null 2>&1
  sleep "$SETTLE"
  OUT="$ROOT/docs/screenshots/$LANG/dark/6.5/02-history.png"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT" >/dev/null 2>&1
  echo "  → $LANG/dark/6.5/02-history.png"
done
# Leave the simulator in light appearance, per the capture runbook's last rule.
xcrun simctl ui "$UDID" appearance light >/dev/null 2>&1
echo HISTORY_DARK_DONE
