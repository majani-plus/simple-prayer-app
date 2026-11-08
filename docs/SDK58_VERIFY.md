# Expo SDK 58 verification (2026-11-07)

SDK 58 landed on `main` in D187. This file records the checks run afterwards, what they changed and
what can only be checked on a real device.

## Results

| Check | Result |
|---|---|
| `bunx expo install --check` | 18 packages behind. 16 patch bumps applied (below). 2 held: see "Accepted findings" |
| `bunx expo-doctor` | 19/20 checks pass. The one failure is the 2 held packages |
| `bun run typecheck` | green |
| `bun run lint` | green |
| `bun run test` | green, 170 suites / 4179 tests. A first run with a Gradle build going at the same time had 11 timeouts; the rerun had none |
| `bun run typecheck:swift` | widget, notify, watch, watch-widget: all ok |
| `bunx expo prebuild --platform android --no-install` | ok |
| Gradle `compileReleaseKotlin`: `:app`, `:prayer-widgets`, `:buddy-nicknames`, `:audio-pause`, `:exact-alarms`, `:notification-dismissal`, `:prayer-marks`, `:qibla-heading`, `:watch-sync`, `:wear` | BUILD SUCCESSFUL (Gradle 9.4.1) |
| Gradle `:wear-face:compileReleaseSources` | ok (resource-only Watch Face Format module, no Kotlin task) |
| `xcodebuild -target SimplePrayerWatch`, `watchsimulator` and `watchos` (device), Release, no signing | BUILD SUCCEEDED (Xcode 27.2) |
| `xcodebuild -target SimplePrayerWatchWidgets`, `watchsimulator`, Release | BUILD SUCCEEDED |
| Patches after a clean `bun install --frozen-lockfile` | adhan, drizzle-orm and expo-notifications all applied |

## Changed

Patch bumps inside SDK 58: `expo` 58.0.23, `expo-asset` 58.0.20, `expo-audio` 58.0.11,
`expo-background-task` 58.0.12, `expo-build-properties` 58.0.12, `expo-constants` 58.0.15,
`expo-dev-client` 58.0.18, `expo-linking` 58.0.16, `expo-router` 58.0.30,
`expo-screen-orientation` 58.0.4, `expo-sharing` 58.0.22, `expo-splash-screen` 58.0.13,
`expo-sqlite` 58.0.15, `expo-task-manager` 58.0.13, `expo-updates` 58.0.21, `jest-expo` 58.0.14.

## Accepted findings

- **`expo-notifications` 58.1.7 (Expo wants ~58.1.8).** Pinned exact because our patch (D146, D165)
  is keyed to that version (D187). Moving it means rebasing the patch onto 58.1.8 and checking the
  diff. That is a separate change.
- **`react-native-safe-area-context` 5.10.1 (Expo wants ~5.11.1).** A minor bump, not a patch, so
  it is out of scope here. Take it with the next dependency pass, after reading its changelog.
- **Building the `SimplePrayerWatch` scheme alone fails.** The scheme also builds the iOS widget
  target for the watch SDK, and `ActivityKit` does not exist there. The watch targets themselves
  build (table above), and EAS builds the `SimplePrayer` scheme for iOS. Nothing to fix.
- **Kotlin deprecation warnings** in `node_modules` (screens, reanimated, gesture-handler,
  safe-area-context) and two in `wear/PrayerTileService.kt:119` (`Image.Builder()`,
  `setResourceId`). Warnings only. The Wear Tiles one is ours; fix it when that file is next
  touched.

## Owed on real devices

These cannot be checked from the CLI:

1. **Android 16 reminders (Xiaomi 15T Pro):** a prayer reminder posts, and `setTimeoutAfter` removes
   it when its window ends (D165).
2. **iOS cold launch from a buddy link:** with the app closed, open a buddy invite link. The app
   should start and land on the buddy flow (UIScene lifecycle, new with RN 0.88).
3. **Sentry on the first EAS build:** source maps (iOS and Android) and the ProGuard mapping upload,
   and a test error shows readable stack traces. Local release builds need
   `SENTRY_DISABLE_AUTO_UPLOAD=true`, because there is no auth token on this machine.
4. **Watch on hardware:** install from TestFlight and open the app and the Smart Stack widget. The
   CLI build proves it compiles, not that it runs.
