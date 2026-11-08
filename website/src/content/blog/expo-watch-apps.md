---
title: "One Expo repo, three watch surfaces"
description: "How Simple Prayer ships an Apple Watch app, a Wear OS app and a Wear OS watch face from one Expo project, without any prayer logic on the wrist."
date: "2026-11-08"
order: 5
tags: [expo, watchos, wear-os, architecture]
---

Simple Prayer runs on three watch surfaces: an Apple Watch app with complications, a Wear OS app with a tile, and a Wear OS watch face. All three live in the same Expo repository as the phone app, and none of them calculates a prayer time. The phone does the work and sends the watch a finished, versioned package of data, which we call the envelope. The watch only draws it. This post explains how that fits together, and what Google Play rejected along the way.

## The three surfaces

**Apple Watch.** The watch app is in `targets/watch/` and its complications are in `targets/watch-widget/`. Both are SwiftUI, and `@bacons/apple-targets` generates them into the Xcode project at prebuild, like the phone's widgets in `targets/widget/`. There is no Apple watch face to build: watchOS has no API for third-party faces, so on Apple the watch app and its complications are all there is (D126).

**Wear OS app.** The Wear app is in `wear/`. It is Kotlin and Compose for Wear OS, with a Today screen, a qibla screen, a tile and a complication data source. Play pairs it with the phone app by package name, so both use `app.simpleprayer`. Its version codes sit in a separate 900-million block, so they never collide with the phone's.

**Wear OS watch face.** The face is in `wear-face/`. It is written in Watch Face Format, which is declarative XML with no code at all. It is a separate application, `app.simpleprayer.face`, with its own Play listing (D129).

## Keeping native modules alive through prebuild

Expo's prebuild generates `android/` from config, and `--clean` deletes it first, so anything added there by hand is lost. That is why `wear/` and `wear-face/` live at the repository root, and a small config plugin, `plugins/withWearApp.js`, connects them to the generated project on every prebuild.

Both of its edits check before they write, so a second prebuild adds nothing:

```js
if (!mod.modResults.contents.includes("include ':wear'")) {
  mod.modResults.contents +=
    "include ':wear'\n" +
    "project(':wear').projectDir = new File(rootProject.projectDir, '../wear')\n";
}
```

The second edit adds the Kotlin Compose compiler plugin to the root `build.gradle`. The Compose compiler must match the Kotlin version exactly. The plugin reads that version from React Native's own version catalog (`node_modules/react-native/gradle/libs.versions.toml`), so an SDK upgrade moves both together.

## The watches do no prayer math

The project has one rule for every native surface: no domain logic in Swift or Kotlin (D102). Prayer times, the day boundary at Fajr and the status rules live in TypeScript, in `src/domain/`, with unit tests.

A standalone watch app would have to calculate prayer times and the Fajr-to-Fajr day again in Swift and again in Kotlin. The owner declined that on 2026-08-27 (D127). Instead, the phone builds an envelope in `src/services/watchEnvelope.ts`:

```ts
export interface WatchEnvelope {
  version: typeof WATCH_ENVELOPE_VERSION;
  snapshot: WidgetSnapshot;
  qibla: WatchQibla | null;
  alerts: WatchAlerts;
}
```

- `snapshot` is the same 14-day timeline the home-screen widgets draw, with every time, status and label already formatted. The watch can keep working for two weeks without the phone.
- `qibla` holds the bearing to the Kaaba and the compass's words, already translated.
- `alerts` holds the adhan notifications the Wear app may post by itself, as final text from the same translation keys the phone uses.

The envelope wraps the widget snapshot instead of changing it, so the widget contract stays untouched.

Both layers carry a version number, and every reader checks both. In TypeScript, `parseWatchEnvelope` returns `null` for any version it does not know. The Kotlin reader in `wear/` and the Swift reader in `targets/watch/` do the same. A `null` envelope means the watch shows a message bundled in the watch app, such as "Open Simple Prayer on your phone.", instead of guessing at a format it does not understand.

The Apple Watch qibla complication follows the same rule. It draws a north-up map with the Makkah mark at the envelope's bearing, not a needle, because a complication's process reads no sensors (D133).

There are two small exceptions, and D127 names them. The system draws live countdowns and the qibla degree readout, because those numbers change every second or with every turn of the wrist. Everything else is text the phone wrote.

## Getting the envelope to the wrist

The transport is a local Expo module, `modules/watch-sync`. Its JavaScript surface is small: `pushEnvelope(json)`, `clearEnvelope()` and two questions about whether a watch is paired.

- On iOS it uses WatchConnectivity. The envelope goes down with `updateApplicationContext`, which keeps only the latest value. Marks from the watch come back with `transferUserInfo`.
- On Android it uses the Wearable Data Layer. The envelope is a data item at `/simpleprayer/envelope`, and marks come back at `/simpleprayer/marks/<id>`.

A mark made on the wrist does not write to the prayer log. It goes into the same queue that the phone's "I prayed" notification button and the widgets use (D92). The app drains that queue through `trackingStore.toggleStatus` the next time it runs, so the log has one way in. Until then, the watch shows the mark as an optimistic overlay. It drops the overlay when a newer envelope agrees with it.

The module loads with `requireOptionalNativeModule`, so in Jest, on the web or in an older build every call does nothing.

## Notifications: different on each platform

The owner's condition for watch-local reminders was that they must never cause a duplicate buzz. "If that's not possible then don't do it" (D128).

On iOS it is not possible: a local watch notification cannot check, when it fires, whether the phone is nearby. The phone's own notifications already appear on the watch, with their "I prayed" button, which runs on the phone. So the Apple Watch schedules nothing.

On Wear OS, code can run when an alarm fires. The Wear app sets alarms from the envelope's `alerts`, and when one fires it asks for connected nodes:

```kotlin
fun phoneIsInRange(context: Context): Boolean =
  runCatching {
    Tasks.await(
      com.google.android.gms.wearable.Wearable.getNodeClient(context).connectedNodes,
      5, TimeUnit.SECONDS
    ).isNotEmpty()
  }.getOrDefault(true)
```

If the phone is connected, the watch posts nothing, because the phone's notification is already on the wrist. If the phone is away, the watch posts the adhan itself. An unknown answer counts as "in range", because a missed buzz is better than a double one.

## The face, and why it is a separate app

Since 2026-01-14, watch faces built on the old Wear APIs can no longer be installed (D129). Watch Face Format is the only way to ship a new face. A Watch Face Format face is resources only, and Play does not accept one inside an app bundle (`docs/WATCH_RUNBOOK.md`). So the face cannot be part of the Wear app.

The fix is a separate Gradle application in `wear-face/` that ships no code:

- The manifest sets `android:hasCode="false"`.
- `minifyEnabled true` is set for both debug and release. This is how Google's own samples keep the empty stub `classes.dex` out of the package.
- `shrinkResources` stays off. Only the Watch Face Format runtime refers to the face's drawables, fonts and XML, and the shrinker cannot see those references.

A face with no code still needs prayer data. It gets it from the Wear app's complication data source. The face's slots name `PrayerComplicationService` as their provider, and they are locked so the user cannot swap them out:

```xml
<DefaultProviderPolicy
  primaryProvider="app.simpleprayer/app.simpleprayer.wear.PrayerComplicationService"
  defaultSystemProvider="DAY_OF_WEEK"
  defaultSystemProviderType="SHORT_TEXT" />
```

The complication sends numbers, and the system draws the countdown from them. This means the countdown on the face is never a pushed string that has gone out of date (D129).

## The Play review rejection, and the fix

The Wear app itself was rejected in review. Play's text for version 900000005, received on 2026-09-15, was:

> **Wear font size:** Your app must conform to the font size set by the user in System Settings. Please ensure that text and controls are not cut off by screen edges

> **Background not black:** Your app does not use a black background for all apps and tiles

The screenshot showed the Today screen at a large font size. The Hijri date was cut off at both edges, and the seal, the button you tap to mark a prayer, was cut off at the bottom. The background was the app's dark brown.

An earlier build had already raised small text to the Wear OS quality checklist's floors of 12sp and 10sp and let the screen grow taller (D164). That was not enough: on a 192dp round screen the Today hero did not fit even at the default font size. "You can scroll to it" does not satisfy a reviewer, or the app's own rule that nothing stands between the user and the tap.

The fix in D170 has two parts:

1. **The canvas is pure black.** The cards, lines and gold keep their colours.
2. **The hero drops lines, never type size, until the seal fits on the first screen.** A `SubcomposeLayout` measures each layout against the real screen height at the wearer's font size. The full layout comes first. Then the Arabic name line above a Latin prayer name goes. Then the Hijri date moves from the top to below the seal. Scrolling is the last resort.

The Arabic line repeats the line under it, so it goes first. The date moves before the seal because a date is looked up and the seal is reached for.

It was checked on 192dp and 227dp emulators, at font scales from 1.0 to 1.24 (the largest step the API 37 emulator offered), in English, Turkish and Arabic. No combination needed to scroll. The fix went into Wear build 900000007, which was sent back to Play for review.

## Read the code

- [src/services/watchEnvelope.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/services/watchEnvelope.ts): the envelope and its version check
- [modules/watch-sync/index.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/modules/watch-sync/index.ts): the transport's JavaScript surface
- [plugins/withWearApp.js](https://github.com/majani-plus/simple-prayer-app/blob/main/plugins/withWearApp.js): wiring `wear/` and `wear-face/` into prebuild
- [wear/src/main/java/app/simpleprayer/wear/Alerts.kt](https://github.com/majani-plus/simple-prayer-app/blob/main/wear/src/main/java/app/simpleprayer/wear/Alerts.kt): the Wear app's conditional adhan
- [wear-face/build.gradle](https://github.com/majani-plus/simple-prayer-app/blob/main/wear-face/build.gradle) and [wear-face/src/main/res/raw/watchface.xml](https://github.com/majani-plus/simple-prayer-app/blob/main/wear-face/src/main/res/raw/watchface.xml): the face
- [docs/DECISIONS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/DECISIONS.md): D126 to D129, D133, D164 and D170
