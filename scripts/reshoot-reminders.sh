#!/usr/bin/env bash
# One-slot re-shoot: 04-reminders WITH a live adhan notification banner in frame.
# The banner is a REAL notification (simctl push of the app's own copy), not a composite;
# notification permission is pre-granted with applesimutils. Companion to
# capture-store-screenshots.sh — same staging, same restore discipline, one slot.
#
#   ./scripts/reshoot-reminders.sh <udid> <push-payload-dir>
set -euo pipefail
UDID="${1:?usage: reshoot-reminders.sh <udid> <payload-dir>}"
PAYLOADS="${2:?dir holding en.json tr.json ar.json}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="app.simpleprayer"
INDEX="$ROOT/src/app/(tabs)/index.tsx"
LAYOUT="$ROOT/src/app/_layout.tsx"
REMINDERS="$ROOT/src/app/settings/reminders.tsx"
WORK="$(mktemp -d)"
SETTLE="${SETTLE:-11}"

grep -q "const openPrayer = open.day === day ? open.prayer : null;" "$INDEX" || {
  echo "$INDEX is not the pristine Today screen — restore it before capturing." >&2; exit 1; }
cp "$INDEX" "$WORK/index.orig.tsx"
cp "$LAYOUT" "$WORK/layout.orig.tsx"
cp "$REMINDERS" "$WORK/reminders.orig.tsx"

restore() {
  cp "$WORK/index.orig.tsx" "$INDEX"
  cp "$WORK/layout.orig.tsx" "$LAYOUT"
  cp "$WORK/reminders.orig.tsx" "$REMINDERS"
  echo "restored the three patched files"
}
trap restore EXIT

sed "s|if (!onboardingCompleted) router.replace('/onboarding');|void onboardingCompleted; require('@/stores/settingsStore').getSettingsActions().setLocation({ latitude: 41.0082, longitude: 28.9784, label: 'Istanbul', countryCode: 'TR', source: 'manual', resolvedAt: 1 }); // TEMP-SCREENSHOT|" \
  "$WORK/layout.orig.tsx" >"$LAYOUT"

cat >"$INDEX" <<'EOF'
import { LogBox } from 'react-native';
LogBox.ignoreAllLogs(true);
/* TEMPORARY — screenshot capture. scripts/reshoot-reminders.sh restores this file. */
import { Redirect } from 'expo-router';

export default function TodayScreen() {
  return <Redirect href="/settings/reminders" />;
}
EOF
sed -i '' "s|const \[voiceOpen, setVoiceOpen\] = useState(false);|const [voiceOpen, setVoiceOpen] = useState(true); // TEMP-SCREENSHOT|" "$REMINDERS"

xcrun simctl location "$UDID" set 41.0082,28.9784 >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" clear >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" override \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 \
  --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
xcrun simctl ui "$UDID" appearance light >/dev/null 2>&1

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
  # Arabic needs the second launch for RTL (the first only writes the OS flag).
  if [ "$LANG" = "ar" ]; then
    xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
    sleep 1
    xcrun simctl launch "$UDID" "$BUNDLE_ID" \
      -AppleLanguages "($LANG)" -AppleLocale "$APPLE_LOCALE" >/dev/null 2>&1
    sleep "$SETTLE"
  fi
  xcrun simctl push "$UDID" "$PAYLOADS/$LANG.json" >/dev/null
  sleep 1.6
  OUT="$ROOT/docs/screenshots/$LANG/light/6.5/04-reminders.png"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT" >/dev/null 2>&1
  echo "  → $LANG/light/6.5/04-reminders.png"
done
echo REMINDERS_RESHOOT_DONE
