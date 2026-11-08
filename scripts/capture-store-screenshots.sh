#!/usr/bin/env bash
#
# Captures the six App Store / Play screenshots from a booted iOS simulator, for one
# device size, one locale and one appearance. Every frame is a real capture of the real
# app; nothing is composited or retouched.
#
#   ./scripts/capture-store-screenshots.sh <udid> <locale> <theme> <out-dir>
#
#   udid    a BOOTED simulator running a dev build of the app, with Metro up
#   locale  en | ar | tr
#   theme   light | dark
#
# Prerequisites (see docs/screenshots/README.md for the full runbook):
#   * `bunx expo start --dev-client` running
#   * the dev build installed on <udid>, launched once (so migrations have run)
#   * `python3 scripts/seed-screenshot-data.py --udid <udid>` already run
#   * `xcrun simctl privacy <udid> grant location-always app.simpleprayer`
#
# HOW IT REACHES SCREENS WITHOUT TAPPING
# The simulator exposes no accessibility window to AppleScript (D38), so an
# agent can screenshot but cannot tap. Each screen is therefore reached by temporarily
# rewriting src/app/(tabs)/index.tsx — either to `<Redirect href="…" />` (which lands on the
# real route, with the real tab-bar selection and the real presentation) or, for the open
# seal, to the real Today screen with its `openPrayer` pinned. The file is restored from a
# byte-exact backup on exit, including on failure.
#
set -euo pipefail

UDID="${1:?usage: capture-store-screenshots.sh <udid> <locale> <theme> <out-dir>}"
LOCALE="${2:?locale: en|ar|tr}"
THEME="${3:?theme: light|dark}"
OUT="${4:?out dir}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="app.simpleprayer"
INDEX="$ROOT/src/app/(tabs)/index.tsx"
LAYOUT="$ROOT/src/app/_layout.tsx"
WORK="$(mktemp -d)"
SETTLE="${SETTLE:-11}"

case "$LOCALE" in
  en) APPLE_LOCALE="en_GB" ;;
  ar) APPLE_LOCALE="ar_SA" ;;
  tr) APPLE_LOCALE="tr_TR" ;;
  *) echo "unknown locale: $LOCALE" >&2; exit 1 ;;
esac

# Refuse to start unless index.tsx is the real Today screen: the backup taken here is what the
# script restores on exit, so starting from a leftover stand-in would make the damage permanent.
grep -q "const openPrayer = open.day === day ? open.prayer : null;" "$INDEX" || {
  echo "$INDEX is not the pristine Today screen — restore it before capturing." >&2
  exit 1
}
cp "$INDEX" "$WORK/index.orig.tsx"

# The first-run flow redirects away from every screen until it has been completed, and a
# capture run starts from a reset install (that reset is what puts the streak mode back to
# the shipped default). Onboarding is a real screen with its own tests; it is simply not one
# of the six frames, so the redirect is neutralised for the run and restored with the file.
grep -q "if (!onboardingCompleted) router.replace('/onboarding');" "$LAYOUT" || {
  echo "$LAYOUT does not carry the onboarding redirect this script expects." >&2
  exit 1
}
cp "$LAYOUT" "$WORK/layout.orig.tsx"
cp "$ROOT/src/app/(tabs)/qibla.tsx" "$WORK/qibla.orig.tsx"
cp "$ROOT/src/app/settings/reminders.tsx" "$WORK/reminders.orig.tsx"
# The same patched line also pins the location to Istanbul (the set's canonical city — chosen
# because it matches the capture host's timezone family, README §scenario): a fresh container
# has no location, and without one every screen shows the honest empty state instead of times.
sed "s|if (!onboardingCompleted) router.replace('/onboarding');|void onboardingCompleted; require('@/stores/settingsStore').getSettingsActions().setLocation({ latitude: 41.0082, longitude: 28.9784, label: 'Istanbul', countryCode: 'TR', source: 'manual', resolvedAt: 1 }); // TEMP-SCREENSHOT|" \
  "$WORK/layout.orig.tsx" >"$LAYOUT"

restore() {
  cp "$WORK/index.orig.tsx" "$INDEX"
  cp "$WORK/layout.orig.tsx" "$LAYOUT"
  cp "$WORK/qibla.orig.tsx" "$ROOT/src/app/(tabs)/qibla.tsx"
  cp "$WORK/reminders.orig.tsx" "$ROOT/src/app/settings/reminders.tsx"
  echo "restored the four patched files"
}
trap restore EXIT

mkdir -p "$OUT"

# --- dev-only chrome, kept out of the frames -----------------------------------------------
# The dev client's native bundle predates the eight adhan sound files (they are declared in
# app.json and land in the next build), so `expo-notifications` warns at schedule time and
# LogBox draws a toast across the bottom of the screen — over the tab bar, in every frame.
# It is a development artefact, not a defect: a production build has the files. Screenshots
# must not show dev chrome, so LogBox is silenced in the stand-in that is already being
# written here, and disappears with it when the file is restored.
LOGBOX_OFF="import { LogBox } from 'react-native';
LogBox.ignoreAllLogs(true);
"

write_index() { # write_index <<<'file body' — prepends the LogBox preamble
  { printf '%s\n' "$LOGBOX_OFF"; cat; } >"$INDEX"
}

# --- the six index.tsx stand-ins ---------------------------------------------------------
redirect() {
  write_index <<EOF
/* TEMPORARY — M10 screenshot capture. scripts/capture-store-screenshots.sh restores this file. */
import { Redirect } from 'expo-router';

export default function TodayScreen() {
  return <Redirect href="$1" />;
}
EOF
}

seal_open() {
  sed "s|const openPrayer = open.day === day ? open.prayer : null;|const openPrayer: Prayer \| null = 'fajr'; // TEMP-SCREENSHOT|" \
    "$WORK/index.orig.tsx" | write_index
  grep -q "TEMP-SCREENSHOT" "$INDEX" || { echo "seal-open patch did not apply" >&2; exit 1; }
}

buddies_on() {
  # Buddy mode (D174) draws its avatars from `useBuddiesByPrayer`, whose state lives in MMKV and
  # cannot be seeded from `seed-screenshot-data.py` the way the SQLite history is. So the hook's
  # answer is pinned instead — the same move `qibla_aligned` makes with the heading: a real state
  # of the real screen, rendered by the real component, reached without a second device.
  #
  # Nothing native is touched. Buddy mode stays switched OFF in the app; only the row's display is
  # substituted, so `expo-secure-store` is never called and an older dev client runs this fine.
  sed "s|const buddiesByPrayer = useBuddiesByPrayer(today.day);|const buddiesByPrayer = { fajr: [{ pairId: 'a'.repeat(32), icon: 'crescent' as const, color: 'ocean' as const, nickname: 'Amina', lang: 'en', notify: true, pending: false, addedAt: 0 }], dhuhr: [{ pairId: 'b'.repeat(32), icon: 'star' as const, color: 'brick' as const, nickname: 'Yusuf', lang: 'en', notify: true, pending: false, addedAt: 0 }, { pairId: 'a'.repeat(32), icon: 'crescent' as const, color: 'ocean' as const, nickname: 'Amina', lang: 'en', notify: true, pending: false, addedAt: 0 }], asr: [{ pairId: 'b'.repeat(32), icon: 'star' as const, color: 'brick' as const, nickname: 'Yusuf', lang: 'en', notify: true, pending: false, addedAt: 0 }], maghrib: [], isha: [] }; // TEMP-SCREENSHOT|" \
    "$WORK/index.orig.tsx" | write_index
  grep -q "TEMP-SCREENSHOT" "$INDEX" || { echo "buddies patch did not apply" >&2; exit 1; }
}

qibla_aligned() {
  # The simulator has no magnetometer, so `useHeading` never yields and the dial sits in its
  # "turn to find it" state forever. Pinning the heading to the qibla bearing shows the aligned
  # state a user reaches by turning the phone — a real state of the real screen, not a mock.
  redirect "/qibla"
  sed -i '' "s|const heading = compass.heading;|const heading = 152; // TEMP-SCREENSHOT: pinned to the Istanbul qibla bearing|" \
    "$ROOT/src/app/(tabs)/qibla.tsx"
  # With a heading pinned, the screen must not also report that the device has no compass —
  # that footer is true of a simulator and false of the phone this frame depicts. Suppressing
  # it keeps the frame internally consistent rather than advertising "no compass in this device".
  sed -i '' "s|) : compass.status === 'unavailable' ? (|) : false ? ( // TEMP-SCREENSHOT|" \
    "$ROOT/src/app/(tabs)/qibla.tsx"
  # The DIAL is driven by a Reanimated shared value, not by the `heading` above it, so pinning
  # only the latter produced a frame that claimed alignment in words while the Makkah badge sat
  # at its raw bearing — the owner spotted it. Pin the shared value to the same bearing so the
  # dial rotates Makkah under the needle and the picture agrees with the sentence.
  sed -i '' "s|import { useIsFocused }|import { useSharedValue } from 'react-native-reanimated';\
import { useIsFocused }|" "$ROOT/src/app/(tabs)/qibla.tsx"
  sed -i '' "s|heading={compass.sharedHeading}|heading={useSharedValue(152)} // TEMP-SCREENSHOT|" \
    "$ROOT/src/app/(tabs)/qibla.tsx"
  grep -q "TEMP-SCREENSHOT" "$ROOT/src/app/(tabs)/qibla.tsx" || {
    echo "qibla heading patch did not apply" >&2; exit 1; }
}

reminders_voices() {
  # The adhan selector is closed by default; opening it needs a tap this environment cannot
  # deliver. The four recitations are the point of the frame.
  redirect "/settings/reminders"
  sed -i '' "s|const \[voiceOpen, setVoiceOpen\] = useState(false);|const [voiceOpen, setVoiceOpen] = useState(true); // TEMP-SCREENSHOT|" \
    "$ROOT/src/app/settings/reminders.tsx"
  grep -q "TEMP-SCREENSHOT" "$ROOT/src/app/settings/reminders.tsx" || {
    echo "reminders voice patch did not apply" >&2; exit 1; }
}

travel_on() {
  # The travel banner (D115): its state is derived (`isTravelingOn`) from settings this
  # environment cannot tap into being. Pinning the derivation and the banner's two dates shows
  # the exact frame a traveller sees the moment they turn it on — a real state of the real
  # screen. Slot 07 is a website capture (docs/screenshots/README.md, "Website-only captures").
  sed "s|const traveling = day !== null && isTravelingOn(day, travel);|const traveling = day !== null; // TEMP-SCREENSHOT|" \
    "$WORK/index.orig.tsx" | write_index
  # The render site ALSO guards on travel.startDay (never set in this environment) — relax it,
  # and feed the banner today's own day as its since-day, open-ended.
  sed -i '' "s|{traveling && day !== null && travel.startDay !== null ? (|{traveling \&\& day !== null ? (|" "$INDEX"
  sed -i '' "s|sinceDay={travel.startDay}|sinceDay={day}|" "$INDEX"
  sed -i '' "s|untilDay={travel.endDay}|untilDay={null}|" "$INDEX"
  grep -q "sinceDay={day}" "$INDEX" || { echo "travel patch did not apply" >&2; exit 1; }
  grep -q "untilDay={null}" "$INDEX" || { echo "travel untilDay patch did not apply" >&2; exit 1; }
}

relaunch() {
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 1
  xcrun simctl launch "$UDID" "$BUNDLE_ID" \
    -AppleLanguages "($LOCALE)" -AppleLocale "$APPLE_LOCALE" >/dev/null 2>&1
  sleep "$SETTLE"
}

shoot() {
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$1.png" >/dev/null 2>&1
  echo "  → $OUT/$1.png"
}

# --- a clean, uniform status bar (app pixels untouched) ----------------------------------
# Deliberately NOT Apple's marketing 9:41: the Today screen shows a live countdown to the next
# prayer, and a frozen clock would contradict it ("9:41" beside "Dhuhr 1:13 pm · in 1 h 40 m").
# The real clock is left alone; only the radios and the battery are normalised.
# `override` MERGES with whatever is already overridden, so a previously pinned time would
# survive an override that simply omits `--time`. Clear first.
# The simulator's own simulated GPS defaults to Apple's Cupertino/San Francisco fix, and the
# app's location refresh can land AFTER the Istanbul pin and repaint the frame with shifted
# times (it did, once, mid-matrix). Pinning the simulated location closes the race for good.
xcrun simctl location "$UDID" set 41.0082,28.9784 >/dev/null 2>&1 || true

xcrun simctl status_bar "$UDID" clear >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" override \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 \
  --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true

xcrun simctl ui "$UDID" appearance "$THEME" >/dev/null 2>&1

# A first launch in a new language only WRITES the OS layout-direction flag; React Native
# reads it at startup, so Arabic needs a second launch before the layout is actually RTL.
relaunch

echo "capturing $LOCALE/$THEME → $OUT"

seal_open;           relaunch; shoot "01-today-seal"
redirect "/history"; relaunch; shoot "02-history"
qibla_aligned;       relaunch; shoot "03-qibla"
reminders_voices;    relaunch; shoot "04-reminders"
cp "$WORK/qibla.orig.tsx" "$ROOT/src/app/(tabs)/qibla.tsx"
cp "$WORK/reminders.orig.tsx" "$ROOT/src/app/settings/reminders.tsx"
redirect "/qada";    relaunch; shoot "05-qada"

# Slot 07 (travel) exists for the website's travel band and is a light-theme capture only.
if [ "$THEME" = "light" ]; then
  travel_on;         relaunch; shoot "07-travel"
fi

# Slot 08: buddy mode (D174). Two buddies on three of the five rows, and two rows with nothing on
# them — because "nothing arrived" is a normal state and the frame should not imply otherwise.
buddies_on;          relaunch; shoot "08-buddies"

echo "done: $OUT"
