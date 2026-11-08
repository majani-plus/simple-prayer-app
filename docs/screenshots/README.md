# Store screenshots — what each file is, and how it was made

Every PNG under this directory is a **real capture of the real app** running on an iOS
simulator. Nothing is composited, retouched, or drawn in an image editor. The data on screen is
seeded (`scripts/seed-screenshot-data.py`) but internally consistent: the streak, the calendar,
the percentages, the qada count and its projected clear date all agree with one another because
the app computed every one of them from the same seeded log.

Regenerate the whole set with the runbook at the bottom of this file.

---

## Layout

```
docs/screenshots/
  <locale>/<theme>/<size>/NN-<screen>.png     72 device captures
  graphics/play-feature-graphic-1024x500.png  Play feature graphic
  phase-a-ios-today.png                       NOT a store asset — the M0 scaffold record
```

- **locale** — `en`, `ar`, `tr` (the three release languages).
- **theme** — `light` (paper) and `dark` (night paper).
- **size** — `6.5/` is the SLOT name, not the capture device: one set serves both stores through
  the composed 1242×2688 store screens (`scripts/build-store-screens.py`, which scales the
  capture into its frame). The 2026-08 set was captured on the **iPhone 17 Pro** simulator
  (1206×2622); the older 6.7"/6.1" trees were deliberately deleted (one size ships).
- **watch/** — Apple Watch captures (416×496, Series 11 46mm simulator), staged by
  `scripts/make-watch-envelope.ts` + `scripts/shoot-watch-set.sh`: a REAL envelope from the real
  TypeScript builders is seeded into the watch app group and the real watch app renders it. The
  watch simulator must be freshly erased if a paired phone ever synced it — the app replays
  WCSession's last received context at activation, which overrides a seeded envelope by design.

The status bar's radios and battery are normalised (`xcrun simctl status_bar … override`) so the
six frames match each other. The **clock is deliberately left real** rather than set to Apple's
marketing 9:41: the Today screen shows a live countdown to the next prayer, and a frozen clock
would contradict it on the face of the screenshot ("9:41" beside "Dhuhr 1:13 pm · in 1 h 40 m").
Nothing else is overridden; every app pixel is what the app drew.

---

## The capture slots (2026-08 set)

Captures are inputs; the UPLOAD set is the composed one in `docs/store-screens/` and its slot
plan lives in `docs/STORE_SCREENS.md` (eight screens: today, watch, history, qibla, reminders,
travel, qada, pledge). Raw capture files per locale/theme:

| File | Screen | Note |
|---|---|---|
| `01-today-seal.png` | Today, the Fajr seal expanded into Missed · Late · Prayed | Prayed sits last — in the seal's own place (the 2026-08-21 order) |
| `02-history.png` | History: month calendar + streak + completion | |
| `03-qibla.png` | Qibla, aligned (green dial) | heading pinned to Istanbul's bearing |
| `04-reminders.png` | Settings → Reminders, voices open | |
| `05-qada.png` | Qada: 52 owed, 46 made up, projected clear date | |
| `07-travel.png` | Today with the travel banner (light only) | the website's travel band + store slot 06 |

### Localized captions

Authored, not machine-translated, and using the same words the app itself uses (`kaza
namazları`, `قضاء الفوائت`) so the listing and the product never disagree.

| # | Türkçe | العربية |
|---|---|---|
| 1 | Namazını iki dokunuşla işaretle | سجّل صلاتك بنقرتين |
| 2 | Sıradaki vakti her zaman bil | اعرف دائمًا موعد الصلاة القادمة |
| 3 | Bütün ayın tek bakışta | شهرك كله في لمحة |
| 4 | Kıbleyi gönül rahatlığıyla bul | اتّجه إلى القبلة بثقة |
| 5 | Kaza namazlarını usulca tamamla | اقضِ فوائتك برفق |
| 6 | Reklam yok. Hesap yok. Bütün özellikler ücretsiz. | بلا إعلانات. بلا حساب. كل الميزات مجانية. |

---

## Website-only captures, outside the store narrative

The marketing site imports these same trees for its feature bands, and it needs one screen the
store slots above do not cover. Numbered from 07 deliberately, so nothing here is mistaken for a
store slot.

| # | File | Screen | Wanted by |
|---|---|---|---|
| 7 | `07-travel.png` | **NOT SHOT YET.** Today with travel mode on: the quiet travel banner under the countdown, prayer rows below it unchanged. Turn it on from Today's ⋯ → "I'm travelling" → "Until I end it". | `website/src/components/Landing.astro` — the travel band |

`07-travel.png` is needed in all three locales, `light/6.5/`, like its siblings. Until it exists the
band renders a labelled placeholder ("App screenshot coming soon"), so the copy is already live;
dropping the three files in and replacing the three `null`s in `Landing.astro`'s `bandShots` is the
whole remaining job — the band's title, body and alt text are authored in all three languages.

---

## What is on the screen, and why it is believable

The seed tells one consistent story rather than a flattering one:

- **A 46-day streak, which is also the all-time best** — someone on their best run, not a saint.
  Relaxed (soft) streak mode, the default.
- **~4½ months of history**, mostly prayed with a steady sprinkle of *late*, occasional misses,
  and six broken days further back (which is why 46 is the best run rather than 140).
- **93 % completed · 86 % on time** over the last 7 days — good, not perfect.
- **52 prayers still to make up**, of which **46 were made up in the last 30 days**, which is what
  produces the projected clear date the qada screen shows. Neither zero nor theatrical.
- **Today: Fajr prayed, the rest still upcoming.** These are captures taken mid-morning, and the
  app is honest about a prayer whose time has not come — so four rows read *upcoming* and their
  seals are locked. That is the true state of the app at 09:41; do not "fix" it by logging future
  prayers.
- **Istanbul** (41.0082, 28.9784), so the times on screen — Fajr 4:35, Dhuhr 1:13 pm, Asr 4:59 pm,
  Maghrib 8:04 pm, Isha 9:33 pm — are the correct Diyanet times for 19 August 2026 in the
  simulator host's own timezone (Europe/Istanbul, +03). Picking a city in the host timezone is
  deliberate: `AppLocation.timeZone` is currently unused (see D39), so any
  other city would have rendered its times shifted into device time and the screenshot would have
  been quietly wrong.

Two things on screen come from a simulator that cannot do the real thing:

- **The compass.** iOS simulators have no magnetometer, so the capture run injects a fixed
  152° heading through the existing `HeadingService` seam — the same bearing the app itself
  computes for Istanbul, i.e. the aligned state a real user gets by turning. Everything drawn
  (the dial, the needle, the green aligned state, the accuracy dots) is the app's own rendering.
- **The location fix.** The city is written into the settings store rather than resolved from a
  simulated GPS fix, for the timezone reason above.

## Known cosmetic notes for whoever composes the store frames

- **Slot 6 (`06-pledge`) is a mid-scroll state.** Settings is a scrolling list, and the pledge
  card lives in the last group, so the top ~12 % of the frame shows the tail of the group above
  it running under the status bar. Put the caption band there; it is exactly the area a caption
  covers. (There is no scroll position that puts the pledge under the status bar *and* keeps the
  group above it out of frame — the content is simply taller than the screen.)
- **Slot 3 (`03-history`) on 6.1"** clips the last line of the stats card at the tab bar. The
  calendar and the streak card — the two things the slot is for — are fully in frame.

---

## Getting these into the stores

**App Store Connect.** Upload the `6.7` set (1290 × 2796) — that is the size Apple's iPhone
screenshot slot for the 6.9″/6.7″ class takes, and the only iPhone set that is actually required;
ASC scales it down for smaller devices. Upload the `6.1` set (1179 × 2556) as well **if** the
ASC media manager still offers a slot that accepts it at submission time (Apple has been
collapsing the smaller iPhone slots; confirm in the media manager rather than trusting this
file). Screenshots are per-localization: `en` goes on the English listing, `ar` on Arabic, `tr`
on Turkish. Ship the **light** set as the primary six; keep the **dark** set for a seasonal
refresh or for the two Play "night paper" slots — mixing them inside one six-frame run breaks
the visual rhythm.

**Google Play.** ⚠️ **These raw captures are the wrong aspect ratio for Play as-is.** Play caps a
phone screenshot's long side at twice its short side; 2796 ÷ 1290 = 2.17 and 2556 ÷ 1179 = 2.17
both exceed it. Compose the Play frames instead — the usual marketing treatment of a caption band
plus the device frame on a paper ground, exported at 1080 × 1920 (9:16) — using these PNGs as the
device content. Same six, same order, same captions.

**Play feature graphic.** `graphics/play-feature-graphic-1024x500.png` is generated, not drawn:
the mark comes from the same geometry the app icon is built from, the ground is the app's own
`assets/images/paper-noise.png` tile over `#ECE1C5`, and the type is real Lora (the app's
typeface) converted to outlines with fontTools so it needs no installed font. Re-render it with

```
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \
  uv run --with cairosvg --with fonttools python3 scripts/generate-brand-assets.py --feature-only
```

Editing it by hand is a mistake — change `feature_graphic()` in that script instead.

---

## Runbook — reproducing the whole set

Nothing here is committed as app state: the capture needs three temporary local changes, and the
run is only valid if all three are reverted afterwards.

1. **Metro** — `bunx expo start --dev-client`, and a dev build installed on each simulator
   (`xcrun simctl install <udid> …/Build/Products/Debug-iphonesimulator/SimplePrayerTimes.app`).
2. **Permission** — `xcrun simctl privacy <udid> grant location-always app.simpleprayer`.
   Without it the compass never starts and slot 4 shows "Looking for your heading".
3. **Temporary local changes** (all reverted at the end of the run):
   - `src/screenshotSeed.ts` — a throwaway module that pins the location to Istanbul, marks the
     qada wizard complete, calls `syncPermission()` so the compass may start, and silences the
     dev LogBox toast. Imported from `src/app/_layout.tsx`.
   - `src/services/heading.ts` — `getHeadingService()` returns a fake adapter emitting 152°.
   - `src/app/(tabs)/settings.tsx` — the settings `ScrollView` gets `contentOffset={{x:0,y:5000}}`
     so slot 6 lands on the pledge.
4. **Launch each simulator once** (so migrations run), then seed:
   `python3 scripts/seed-screenshot-data.py --udid <udid>`.
5. **Capture**, once per locale × theme × device:
   `./scripts/capture-store-screenshots.sh <udid> <locale> <theme> docs/screenshots/<locale>/<theme>/<size>`
   The script swaps `src/app/(tabs)/index.tsx` between six stand-ins to reach each screen (the
   simulator exposes no accessibility window, so an agent can screenshot but cannot tap — D38) and
   restores it from a byte-exact backup on exit, including on failure. It refuses to start if
   `index.tsx` is not the pristine Today screen.
6. **Revert** the three temporary changes and confirm with `bun run typecheck && bun run lint &&
   bun run test`, plus `git status` being clean apart from `docs/screenshots/`.
7. Leave the simulator in **light** appearance and with no forced language.

---

## Runbook — the Wear OS set (`<locale>/wear/`)

454×454 round-emulator captures (Play's 1:1 Wear slot takes them as-is). Requires a Wear AVD
(API 33+; both `Wear_OS_Large_Round` 454px and `Wear_OS_Small_Round` 384px were verified) and a
debug build — `adb run-as` only works on debuggable installs.

1. `cd android && ./gradlew :wear:assembleDebug`, then
   `adb install -r wear/build/outputs/apk/debug/wear-debug.apk`.
2. Seed a locale's REAL envelope and relaunch: `./scripts/seed-wear-envelope.sh <en|tr|ar>
   [adb-serial]` (builds the envelope with make-watch-envelope.ts, writes it into the app's
   SharedPreferences via run-as, force-stops and relaunches). First launch asks the
   notifications permission — tap Allow once.
3. Capture: `adb exec-out screencap -p > out.png`. The seal tap and undo are plain
   `input tap`; the qibla page is a right-edge→left swipe (NEVER from the left edge — that is
   the system back gesture). Clear `shared_prefs/app.simpleprayer.wear.pending.xml` (run-as)
   between locales so pending-mark overlays don't leak into the next set.
4. The tile: `adb shell am broadcast -a com.google.android.wearable.app.DEBUG_SURFACE --es
   operation add-tile --ecn component app.simpleprayer/app.simpleprayer.wear.PrayerTileService`,
   then swipe left from the face. The Manuscript face: install
   `wear-face/build/outputs/apk/debug/wear-face-debug.apk`, then the same broadcast with
   `--es operation set-watchface --es watchFaceId app.simpleprayer.face`; ambient is
   `input keyevent KEYCODE_SLEEP`, wake with KEYCODE_WAKEUP.
5. The tile and face read the SAME seeded envelope, so one seed serves all three surfaces.
