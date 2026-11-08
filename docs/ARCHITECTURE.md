# Architecture

## Stack

- **Expo SDK 58** (RN 0.88, React 19.3, D187), React Native, TypeScript strict. React Compiler on for device builds (`app.json`), off in Jest.
- **Expo Router** (file-based), native bottom tabs. Deep link: notification tap → Today.
- **State:** Zustand + immer. Settings store persisted to **react-native-mmkv** (synchronous startup reads — no settings flicker).
- **DB:** expo-sqlite + **Drizzle ORM** (typed schema, migrations) for logs/qada/exemptions.
- **Animations:** react-native-reanimated (UI-thread). **Sensors:** expo-location (coarse location, heading API). **Notifications:** expo-notifications (+ notifee only if the Android ongoing notification needs it). **i18n:** i18next + react-i18next + expo-localization.
- **Tip jar:** react-native-purchases (RevenueCat). **Reviews:** expo-store-review.
- No analytics SDKs, no ads. Ever. The one diagnostic exception: **@sentry/react-native** crash
  reporting (on by default, user opt-out in Settings → Support), configured in
  `services/telemetry.ts` to send crash/session diagnostics only — no replay, no breadcrumbs,
  no tracing, no user identity, no PII. The configuration is pinned by `services/telemetry.test.ts`.

## Layout

```
src/
  app/                     # Expo Router routes only (router root is src/app) — thin, compose from src/
    _layout.tsx            # root: providers, migrations + hydrate, every sync hook mounted here
    (tabs)/_layout.tsx     # 4 tabs: index(Today), history, qibla, settings
    (tabs)/index.tsx  (tabs)/history.tsx  (tabs)/qibla.tsx  (tabs)/settings.tsx
    qada.tsx               # dedicated qada screen (pushed from Today card)
    onboarding.tsx         # first-run setup (D69): one screen, internal StepId steps, skippable
    city.tsx               # the ONE city picker (D72), presented over whichever screen asked
    settings/              # about, buddies, calculation, exemption, location, reminders, reminder-health
    b/                     # buddy invite deep links: [code].tsx, enter.tsx
  domain/                  # PURE TypeScript. No React/RN imports. Exhaustively unit-tested.
    prayerTimes.ts         # the ONLY adhan caller: day times, windows, current/next prayer
    windows.ts             # window-end markers, isWindowClosed, prayedStatusAt (auto-late, D71)
    travel.ts              # travel combining windows (D116)
    methods.ts             # country→method auto-map (incl. Jafari config); method metadata/labels
    prayerNames.ts         # display names; Friday Dhuhr → Jumu'ah (display only, id stays dhuhr)
    streaks.ts             # soft/hard engines; day closes at next Fajr; exempt bridging
    stats.ts               # breakdowns, completion, totals (unlogged never counts as missed)
    qada.ts                # debt math, backtrack estimation (exemption-aware), pace/projection
    qibla.ts  tilt.ts      # great-circle bearing/distance; device tilt
    hijri.ts               # Intl islamic-umalqura (+ tabular fallback) + user offset
    exemptions.ts          # date-range containment, day classification
    notificationPlan.ts    # pure: (settings, times, logs, now) → list of notifications to schedule
    pendingMarks.ts        # D92 queue rules shared with native (contract-pinned)
    buddies.ts  adhanVoices.ts
    dates.ts               # prayer-day arithmetic (the ONLY place day-boundary logic lives)
  db/
    schema.ts migrations/ queries.ts client.ts   # drizzle; see Data model
  stores/                  # zustand — see "State stores" below
    trackingStore.ts settingsStore.ts buddyStore.ts locationStore.ts tipLedger.ts
  hooks/                   # React glue: usePrayerDay, useTodayDayResolver, use*Sync (side-effect hooks)
  services/                # side-effectful adapters wrapping expo/native APIs
    notifications.ts ongoingNotification.ts widgets.ts widgetSnapshot.ts liveActivity.ts
    watch.ts watchEnvelope.ts pendingMarks.ts buddyRelay.ts buddyPush.ts buddyOutbox.ts
    backgroundRefresh.ts location.ts heading.ts export.ts purchases.ts review.ts telemetry.ts …
  theme/                   # tokens.ts (paper-light + night-paper), typography.ts, useTheme
  components/              # PaperBackground, SectionDivider(◆), Seal, PrayerRow, CountdownHero,
                           # QadaCard, CompassDial, CalendarMonth, DayDetailSheet, StatCards, SettingRow…
  i18n/                    # index.ts + locales/{en,ar,tr}.json
  config/
    reviewTriggers.ts      # tunable thresholds (EAS Update–tunable)
modules/                   # LOCAL Expo modules — native code we own, autolinked, never a patch
                           # of a dependency. Shared rule: none of them ever SCHEDULES a reminder.
  notification-dismissal/  # Android: take a delivered notification out of the tray at a future
                           # instant, with the process gone (D88, PRODUCT_SPEC §11.5)
  exact-alarms/            # Android: read `canScheduleExactAlarms`, open its settings screen (D91)
  prayer-marks/            # the "Prayed" button on the adhan: queue the press, confirm it, undo
                           # it — never write a prayer log natively (D92, PRODUCT_SPEC §11.10)
  audio-pause/             # Android: pause whatever is playing at a prayer's time, with the
                           # process gone — an alarm + audio focus, opt-in (D96, PRODUCT_SPEC §11.11)
  prayer-widgets/          # home-screen widgets: Android RemoteViews renderer + iOS snapshot store
                           # (see "Widgets" below)
  buddy-nicknames/         # puts a buddy's nickname into the push on arrival, natively (D179)
  watch-sync/              # phone↔watch transport: WCSession (iOS) / Wearable Data Layer (Android)
                           # — the envelope down, D92 queue entries up (D127); marks land in the
                           # same per-key queue form the widgets write
targets/                   # iOS extension/watch code, generated into the Xcode project by
                           # @bacons/apple-targets at prebuild — build-time scaffolding, all
                           # runtime code ours
  widget/                  # homescreen/lockscreen widgets + the Live Activity (D100–D104)
  watch/                   # the Apple Watch app (Today + qibla, WCSession client) (D126–D127)
  watch-widget/            # watch complications + Smart Stack (embedded in the watch app)
wear/                      # the Wear OS app: Compose UI, tile, complication data source,
                           # conditional local adhan (D126–D128) — a SEPARATE application under
                           # the same applicationId, wired in by plugins/withWearApp.js
wear-face/                 # the Wear watch face (Watch Face Format, resource-only XML) — its own
                           # applicationId and Play listing by platform rule (D129)
assets/fonts/  assets/audio/  assets/images/
docs/                      # this documentation set (see CLAUDE.md)
store/                     # store listing assets & metadata source (see STORE_LISTINGS.md)
.github/workflows/ci.yml   # typecheck + lint + test on push
```

**Dependency rule:** `src/app/` → `src/components|stores|services` → `src/domain` → (nothing). `db` is called from services/stores, never from components. Domain never imports RN — this keeps it testable in plain Jest and importable from future widget/native-extension code (D26).

## Data model (Drizzle/SQLite)

```
prayer_logs   id, day (YYYY-MM-DD prayer-day), prayer (fajr|dhuhr|asr|maghrib|isha),
              status (prayed|late|missed|exempt), made_up_at (nullable ts),
              logged_at, updated_at        UNIQUE(day, prayer); absence of row = unlogged; index on day
exempt_periods id, start_day, end_day (nullable = open-ended), created_at; index on start_day
qada_debts    prayer PRIMARY KEY, count, updated_at            # current outstanding
qada_events   id, type (tick|add|estimateSet|manualSet|forgive|forgiveUndo),
              prayer (nullable), delta, at, meta(json)         # audit trail; forgiveness archive lives here
settings      → NOT in SQLite; MMKV via zustand persist
```

- "day" is the **prayer day** (Fajr→next Fajr; Isha logged after midnight belongs to the prior date). All day-boundary logic in `domain/dates.ts` only.
- Streaks/stats computed via queries + pure functions; nothing denormalized (cache best-streak later only if profiling demands).
- Widgets (D26 → delivered as D100–D104): the db and MMKV deliberately STAY in the app's own
  container — no other process ever opens them (D102). The app pushes a versioned, fully-resolved
  snapshot (`src/services/widgetSnapshot.ts` → `services/widgets.ts` → `modules/prayer-widgets`)
  and the widgets only parse, select a precomputed segment, and overlay the D92 queue
  (contract-pinned in `modules/prayer-widgets/contract/`). iOS extension code lives in
  `targets/widget/` (generated into the Xcode project by `@bacons/apple-targets` at prebuild);
  generated native color tables come from `scripts/generate-widget-palette.ts` and are
  drift-tested against `src/theme/tokens.ts` (five outputs since Milestone V: the widget target,
  both watch targets, the widgets module, and the Wear app).
- Watches (D126–D129): the same snapshot, one wrapper further out — `services/watchEnvelope.ts`
  adds the qibla bearing + labels and the Wear alert plan around the UNCHANGED snapshot, and
  `services/watch.ts` ships it through `modules/watch-sync` on the same debounced hook the
  widgets use. The watch surfaces parse, select a segment, and overlay their own optimistic
  pending marks under the same `overlay-cases.json` rules; every tap crosses back as a D92 queue
  entry and drains through `trackingStore.toggleStatus`. Native never writes the log, anywhere.

## State stores (`src/stores/`)

| Store | Holds | Persistence |
|---|---|---|
| `trackingStore` | `dayRecords` (per day), `exemptPeriods`, `debts`, `revision`, `hydrated` | **A mirror of SQLite**, never the source of truth. zustand + immer |
| `settingsStore` | every `AppSettings` field (`domain/types.ts`) | MMKV via zustand `persist` (`simple-prayer-times.settings`) |
| `buddyStore` | pairs, nicknames, today's buddy marks, invite | MMKV (`simple-prayer-times.buddies`); kept apart so it never reaches widgets' lock-screen data |
| `locationStore` | location-request flow state only (the location itself is in settings) | none |
| `tipLedger` | tip count, prompt dismissed | MMKV (`simple-prayer-times.support`), no hook |

- **`revision`** is bumped by every tracking mutation or cache drop (`refreshDay`, `hydrate`,
  `invalidateDays`, exemption changes). Derived selectors (`streakSummary`, `statsFor`,
  `qadaProgress`) cache through `memoised()` keyed on it plus `todayDay` and the exemption flag.
  Subscribers treat it as "something changed".
- **Side effects never live in components.** Each one is a store `subscribe` listener inside a
  `use*Sync` hook mounted once in `src/app/_layout.tsx`: notifications, the Android ongoing
  notification, widgets + Live Activity + watch, buddy relay, review prompt.
- **Adding a setting:** field on `AppSettings` → default in `createDefaultSettings()` → validate
  in `sanitizeSettings()` → `selectSettings()` → action + selector hook. Missing fields default
  through `sanitizeSettings` on merge, so no persist-version bump unless a field changes meaning.

## Prayer log write path (a seal tap)

All synchronous, on the JS thread, inside the press handler:

1. `PrayerSeal.handleFacePress` / pill option → `handlePick` → `onPick` (through memoised `PrayerRow`).
2. `TodayScreen.handlePick` (`(tabs)/index.tsx`): close the seal; a direct `prayed` after the
   window shut is rewritten to `late` (`windows.prayedStatusAt` / `travel.travelPrayedStatusAt`);
   `confirmHaptic()` fires **before** the write.
3. `trackingStore.toggleStatus` (same status again = unlogged) → `setStatus`: guards (valid day,
   not future, not exempt) → **one transaction**: `queries.setPrayerStatus` (unlogged deletes the
   row) + `commitDebtChange` (qada) → `set(debts)` → `refreshDay()` re-reads the day, writes
   `dayRecords[day]`, `revision++`. Any DB error → `attempt()` returns `false`, store unchanged.
4. Subscribers react: `notifications.clearForPrayer` at once + debounced reschedule; widget /
   Live Activity / watch sync (400 ms debounce, deduped on snapshot JSON); buddy `pull()`; review scan.

Marks made outside the app (notification button, widget, watch) are queued natively (D92) and
drained through `services/pendingMarks.ts` → `toggleStatus` — the same path. Native never writes the log.

## Prayer times

- `domain/prayerTimes.ts` is the only module that constructs adhan objects: `computeDayTimes`,
  `getPrayerWindows` (Fajr ends at sunrise; Isha ends at next Fajr), `getNextPrayer`,
  `getCurrentPrayer` (null in the sunrise→Dhuhr gap, D71), `getCurrentPrayerDay`.
- Methods and parameters: `domain/methods.ts` (`resolveMethod`, `buildParameters`, country map).
- Day boundary: `domain/dates.ts` (`prayerDayForInstant`: before Fajr belongs to the previous day).
- Screens get it through `hooks/usePrayerDay.ts`, which arms a timer for the next boundary
  (+500 ms, in 10-minute chunks) and recomputes on foreground. The store's own "today" comes from
  `hooks/useTodayDayResolver.ts`.
- Jumu'ah is a display name only (`domain/prayerNames.ts`); the prayer id stays `dhuhr`.

## Widgets

TypeScript computes everything; native code parses, selects a segment, overlays pending taps (D102).

- **Snapshot** (`services/widgetSnapshot.ts`, version 1, 14 days): days with five prayers
  (times, window ends, captions, status) plus `segments[]`, a half-open walk
  fajr → sunrise → (gap: current null, next dhuhr) → dhuhr → asr → maghrib → isha → next Fajr.
  `services/widgets.ts` `syncWidgets` dedupes on the JSON and writes it; `hooks/useWidgetSync.ts`
  triggers on startup (+2 s), foreground, store changes, language/appearance (400 ms debounce);
  `services/backgroundRefresh.ts` also syncs headlessly (~60 min).
- **Android** (`modules/prayer-widgets/android`, RemoteViews in our own module, D100): four
  providers — `NowWidgetProvider` 2×2, `NowStripWidgetProvider` 4×1, `ScheduleWidgetProvider` 4×2,
  `ScheduleListWidgetProvider` 4×4 — all call `WidgetRenderer.renderAll`. `SnapshotStore`
  (SharedPreferences) holds the JSON; `Snapshot.segmentAt(now)` selects; `PendingQueue` overlays
  taps; `WidgetTapReceiver` takes a seal tap (a prayed toggle only). `TransitionAlarms` arms one
  alarm at the next segment boundary at the end of every render; `TransitionReceiver` redraws on it
  and on boot / time / timezone change. The countdown is a `Chronometer` in count-down mode.
- **iOS** (`targets/widget/`): `Provider.swift` builds one timeline entry per segment start for the
  next 36 h from App Group UserDefaults (`SPWidgetSnapshot`, written by
  `modules/prayer-widgets/ios/WidgetSnapshotStore.swift`); `NowWidget` (small, medium strip,
  lock-screen accessories), `Widgets.swift` (schedule), `PrayerActivityWidget` (Live Activity,
  D104), `MarkPrayedIntent` / `PendingOverlay` / `BuddySender` for taps. Countdowns use
  `Text(timerInterval:countsDown:)`.
- **Contracts:** `modules/prayer-widgets/contract/` pins the shared overlay rules for TS, Kotlin and
  Swift; the snapshot version is pinned across all three by `widgetSnapshot.test.ts`.

## app.json / app.config.ts (the boilerplate matters)

- name "Simple Prayer", slug simple-prayer, scheme simpleprayer,
  ios.bundleIdentifier / android.package `app.simpleprayer`.
- userInterfaceStyle "automatic"; splash + icon in paper palette; locales config for ar/tr.
- **iOS infoPlist (localized via `locales`):**
  - `NSLocationWhenInUseUsageDescription` — "Your approximate location is used to calculate prayer times and the Qibla direction. It is never sent to us — only to your phone's own map service, to name your city." (+ ar/tr translations in `locales/*.json`). It must NOT say the position never leaves the device: `resolveAutoLocation` reverse-geocodes the coarse fix through `CLGeocoder`/Android `Geocoder`, both of which are network services. Guarded by `src/__tests__/privacyClaims.test.ts`.
  - `NSMotionUsageDescription` only if compass path requires it (verify; heading API usually doesn't).
  - `UIBackgroundModes` — none unless required; keep the manifest minimal (privacy story).
  - No `NSLocationAlwaysAndWhenInUseUsageDescription` and no `NSLocationAlwaysUsageDescription` — we never request Always (D31, research). The autolinked `expo-location` config plugin injects **both** by default, so `app.json` must list the plugin explicitly with `locationAlwaysPermission: false` and `locationAlwaysAndWhenInUsePermission: false`. Guarded by `src/__tests__/privacyClaims.test.ts`.
- **Android:** permissions limited to `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM` (adhan-time precision — **and it must be asked for**: on Android 14+ it is denied by default for anything targeting API 33+, so declaring it only makes it requestable. `modules/exact-alarms` + `services/exactAlarms` do the asking, D91 / PRODUCT_SPEC §11.9), `VIBRATE`, `RECEIVE_BOOT_COMPLETED` (reschedule after reboot), foreground-service perms only if the ongoing notification requires them. **`USE_EXACT_ALARM` is settled and NOT declared** — Play halts the release of any app declaring it that is not categorised as a clock or a calendar, and we are Lifestyle (D91). Explicitly blocklist everything else. Notification channels per type (adhan / pre-reminder / nudge / persistent) so users get OS-level control.
- Plugins: expo-router, expo-notifications (sound assets), expo-localization, expo-font, expo-sqlite, react-native-mmkv config as needed.
- `extra`: none secret. No .env with secrets in repo; RevenueCat public API keys go in app config (they are publishable), anything sensitive via EAS secrets.

## Conventions

- TypeScript strict; no `any` in domain; exhaustive switch on status enums.
- **Documentation discipline (D33):** every `src/domain` module gets a header comment stating its contract + JSDoc on exported functions (the semantics ARE the product — day boundary, streaks, qada math). Components get a one-line purpose comment only where non-obvious. `docs/ARCHITECTURE.md` updated whenever structure changes; `docs/PRODUCT_SPEC.md` updated whenever behavior decisions change (with a DECISIONS.md entry).
- i18n: no hardcoded user-facing strings outside `src/i18n/locales/*`; keys namespaced (`today.`, `qada.`, `settings.`…). Arabic copy authored, not machine-mirrored; numerals via locale-aware formatter.
- Times displayed via a single `formatTime` util respecting locale + 12/24h.
- Tests colocated `*.test.ts` next to domain modules; component tests in `__tests__/`.
- Commits: small, self-contained, imperative mood; every commit leaves the internal task board consistent with the code.

## Notification scheduling design

`domain/notificationPlan.ts` computes, purely, the full desired schedule for the next ~5 days
(5 prayers × up to 3 notification kinds, capped under iOS's 64-slot limit with nudges prioritized
for the nearest days). `services/notifications.ts` diffs desired-vs-scheduled and applies.
Reschedule triggers: app foreground, settings change, location change, log action (cancels that
prayer's nudge), boot (Android), background fetch where available. Exempt days produce no
reminders. The reminder-health screen renders the live scheduled list from the OS as ground truth.

## Package manager & CI

- **bun** is the package manager and script runner (NOT npm/yarn/pnpm): `bun install`, `bun run <script>`, `bunx <cli>` (e.g. `bunx create-expo-app`, `bunx expo start`, `bunx eas build`). Commit `bun.lock`. Jest still runs through the normal `bun run test` script (Jest under Node — do not use `bun test` runner, it's a different test framework).
- GitHub Actions on push to main: `oven-sh/setup-bun` → `bun install --frozen-lockfile` → `bun run typecheck` → `bun run lint` → `bun run test`. Keep under ~5 min. EAS builds are manual/scripted, not on every push.
