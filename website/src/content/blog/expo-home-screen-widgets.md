---
title: "Native home-screen widgets from an Expo app"
description: "How Simple Prayer draws its widgets with Kotlin RemoteViews on Android and WidgetKit on iOS, all fed by one 14-day snapshot the app writes in TypeScript."
date: "2027-01-26"
tags: [expo, widgets, android, ios, kotlin, swift]
---

Simple Prayer is an Expo app written in TypeScript, but its home-screen widgets are native code:
Kotlin on Android and Swift on iOS. Neither widget runs any of our JavaScript. The app does all the
thinking ahead of time and leaves the widgets a finished list of what to show for the next 14 days.
This post explains that design, the countdown that ticks on the home screen, and what we learned
building it.

## The shape of it

There are three parts.

1. **The app** computes a snapshot in TypeScript, in `src/services/widgetSnapshot.ts`, and hands
   it to a native module as JSON.
2. **On Android**, our own Expo module in `modules/prayer-widgets` stores the snapshot and draws
   the widgets with `RemoteViews`, in Kotlin.
3. **On iOS**, a WidgetKit extension in `targets/widget` reads the snapshot from the App Group and
   draws the widgets with SwiftUI.

We did not use a cross-platform widget library. On Android we first planned to use
`react-native-android-widget`. We dropped it mid-design, because a widget tap there starts a
headless JavaScript runtime. On some phone makers' Android builds, that is the kind of background
work that gets stopped. The documented fallback for that risk was a native receiver, so we made
the native receiver the design. We also chose plain `RemoteViews` over Jetpack Glance (D100).

On iOS, [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) generates the
widget extension into the Xcode project at prebuild. It is only build scaffolding. All the Swift in
`targets/widget` is ours, and it survives `expo prebuild --clean`.

## The snapshot

A widget runs in another process on iOS, and with no JavaScript runtime on Android. If a widget
had to compute prayer times, we would need the prayer-time code three times: in TypeScript, Kotlin
and Swift. Only the TypeScript copy has our tests. So the rule is that native code computes nothing
(D102).

The snapshot covers 14 prayer days. Everything in it is final: times as display strings, already in
12 or 24 hour format, with the right digits for the language; prayer names that already know
Friday; captions; the Hijri date. The day is split into segments. In each segment, the current and
next prayer do not change:

```ts
export interface WidgetSegment {
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
  /** The prayer day this stretch belongs to (Fajr→next Fajr). */
  day: PrayerDay;
  /** The prayer whose window contains this stretch, or `null` (sunrise→Dhuhr, daily). */
  current: Prayer | null;
  /** The next prayer to begin, possibly on the next day; `null` only at the horizon's edge. */
  next: { day: PrayerDay; prayer: Prayer } | null;
}
```

Native code does two things. It finds the segment that contains the current time. And it lays any
taps the app has not seen yet over the day's statuses. That second rule is defined once, as test
cases in `modules/prayer-widgets/contract/overlay-cases.json`. Jest runs them against the
TypeScript. The Kotlin and Swift versions are reviewed against the same file.

The widgets never open the app's database, even on Android, where they share the app's process and
could. Only the app writes to it. Past the 14 days, a widget shows "Times need a refresh." It never
shows an old schedule.

The snapshot has a version number. A widget that finds a version it does not know shows its
"open the app" state instead of guessing.

## Taps

The widget's seal is an "I prayed" button. A tap does not write to the database. It adds the mark to
a small queue in shared storage, and the app reads that queue the next time it runs. This is the
same path a tap on a notification takes (D92). A second tap on the same seal undoes the first.

Only a prayer whose time has started can be marked. Both native tap handlers check this again when
the tap arrives. A widget drawn a moment before a prayer started cannot be used to mark it early
(D108).

One exception came later. When you mark a prayer, your prayer buddies are told. If the tap happened
on a widget, waiting for the next app launch could mean hours. So the widget's own process now sends
the message to the relay itself, from `BuddySender.swift` and `BuddySender.kt`. It sends exactly
what the app would send. The app then reads a small list of what the widget sent, so the same mark
is never sent twice (D180).

## The countdown

The Now widget shows how long is left to pray the current prayer. On iOS this is
`Text(timerInterval:)`, which the system updates every second with no work from the app. On Android we first believed a widget
could not show a live countdown. That was wrong. Android's `Chronometer` view can count down inside
a `RemoteViews` layout, and it ticks in the launcher's own process. The app does no work for it
(D106):

```kotlin
views.setChronometer(
  R.id.countdown,
  android.os.SystemClock.elapsedRealtime() + (target - now),
  null,
  true
)
```

The layout sets `android:countDown="true"` on the view.

There are two kinds of countdown (D190). If the current prayer is not marked, the widget counts
down to the end of its time, in strong ink, with seconds. If it is marked, it counts down to the
start of the next prayer, in a muted colour, with hours and minutes only (D198). The two also differ
in words, so neither one depends on colour alone.

The calm countdown cannot use a `Chronometer`, because a `Chronometer` cannot hide seconds. On
Android it is plain text, and a non-waking alarm redraws it each time the minute changes. On iOS,
we measured the system timer styles, and none of them shows only hours and minutes. So the calm
countdown is plain text there too. The widget's timeline gets one entry per minute, up to 120, and
reloads after the last one.

## Transition alarms

A countdown has to stop at zero and switch to the next state. On iOS, the timeline already has an
entry for every segment boundary, so WidgetKit switches on time.

On Android, `TransitionAlarms.kt` sets an alarm one second after the next boundary. When it fires,
the widget is redrawn with the new segment. The alarm is exact when the app has permission for
exact alarms, and inexact when it does not.

## Lessons learned

**A `Chronometer` has no stop.** On a Xiaomi phone, the widget once showed "-00:12:30" instead
of the next prayer (D189). The redraw that should have happened at zero came late. A `Chronometer` in `RemoteViews`
cannot be told to stop at zero. So we made sure a redraw happens at every moment someone can look:

- an exact alarm when allowed;
- a 30-minute `updatePeriodMillis` as a fallback;
- a redraw after the app is updated and after the phone restarts;
- a redraw when the screen turns on and when the phone is unlocked;
- a redraw every time the app comes to the foreground;
- and a `Chronometer` only for a deadline that is still ahead.

There is still a limit. If the system fully stops the app, none of our code runs until it is
opened again.

**On iOS, a backwards range crashes the widget.** `Date()...end` traps if the view is drawn after
`end`. A crashed widget extension draws nothing. Every countdown range is now clamped:

```swift
func countdownRange(to end: Date) -> ClosedRange<Date> {
  min(Date(), end)...end
}
```

**Tinting a stroke shape fills it.** Our first Android rings looked like solid blobs. In
`RemoteViews`, `setColorFilter` on a stroke-only `GradientDrawable` paints it as a filled shape. The
rings are now built from vector arc segments, and borders are two filled shapes stacked. We also set
`forceDarkAllowed=false`, so phone makers' forced dark modes do not change our colours (D106).

**Same data does not mean same picture.** The app skips sending a snapshot that has not changed.
But when the phone switches between light and dark, the data is the same and the colours are not.
The check now includes the resolved light or dark mode (D106).

**Set the layout direction explicitly.** The Arabic widgets use layouts with
`layoutDirection="rtl"` set directly. An inherited direction depends on the launcher and can be
mirrored twice. A fixed one is the same on every launcher (D108).

**Measure the width.** A 2×2 Android widget has about 157dp of inner width. That fits a 32sp
countdown on its own line. It does not fit a 32sp countdown and the seal side by side (D109). On iOS, a
`Text(timerInterval:)` takes all the width it is offered. On the one-row widget it pushed the
caption out, so the timer now has a fixed width (D182).

**Previews are real layouts.** Android's widget picker shows a preview before the app has ever
run. Our previews are small real layouts with sample content, in English, Arabic and Turkish
(D109).

**Test on a device.** Several of these bugs only showed up on a real phone or emulator. Unit tests
covered the snapshot well, but they could not show us a filled ring or a negative clock.

## Read the code

- [src/services/widgetSnapshot.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/services/widgetSnapshot.ts)
- [modules/prayer-widgets/android/src/main/java/expo/modules/prayerwidgets/WidgetRenderer.kt](https://github.com/majani-plus/simple-prayer-app/blob/main/modules/prayer-widgets/android/src/main/java/expo/modules/prayerwidgets/WidgetRenderer.kt)
- [modules/prayer-widgets/android/src/main/java/expo/modules/prayerwidgets/TransitionAlarms.kt](https://github.com/majani-plus/simple-prayer-app/blob/main/modules/prayer-widgets/android/src/main/java/expo/modules/prayerwidgets/TransitionAlarms.kt)
- [modules/prayer-widgets/contract/overlay-cases.json](https://github.com/majani-plus/simple-prayer-app/blob/main/modules/prayer-widgets/contract/overlay-cases.json)
- [targets/widget/Provider.swift](https://github.com/majani-plus/simple-prayer-app/blob/main/targets/widget/Provider.swift)
- [targets/widget/expo-target.config.js](https://github.com/majani-plus/simple-prayer-app/blob/main/targets/widget/expo-target.config.js)
- [docs/DECISIONS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/DECISIONS.md) (D100, D102, D106, D108, D109, D180, D182, D189, D190, D198)
