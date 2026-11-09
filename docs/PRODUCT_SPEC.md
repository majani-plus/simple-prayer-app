# Simple Prayer — Product Specification

> The authoritative product spec. Every decision here was made explicitly by the owner
> during the scoping phase (Aug 2026). Do not silently deviate. If a contradiction or gap is found,
> record it in the internal task board under Known Issues and (only if truly blocking) ask the user.

**One-liner:** A free, beautiful, fast, ad-free prayer times + prayer tracking app.
**Positioning:** *"Everything Pillars promised, kept free."* No ads ever, no account, no tracking, local-first.
**Platforms:** iOS + Android (feature parity is a hard requirement — Android is NOT second-class).
**Name:** Simple Prayer · bundle ID `app.simpleprayer` · domain simpleprayer.app (owned).
**Languages:** English, Arabic (full RTL), Turkish. Device-language default, in-app override.
**Design principle:** simple, fast, smooth, straight to the point; everything obvious and intuitive.

---

## 1. Structure — 4 tabs

Today · History · Qibla · Settings. (The design mockup's Quran tab was an exploration artifact — explicitly cut.)

**On a tablet, a foldable, or any wide window (D123–D125).** The four tabs are the same four at every
size — none merges, moves or disappears, whatever the shape of the screen. What changes is how much
each one lays out at once, decided by **window width alone** (never by device): under 600pt the phone
layout, unchanged; 600–839 the same single column, centred and held to a 600pt measure; from 840 up
each of Today, History and Qibla opens into **two panes** divided by a vertical ◆ rule, while Settings
and every sub-screen keep the centred column. Because it reads the live window, a foldable's hinge, an
iPad rotation and a Split View drag are all the same event, and the panes mirror themselves in Arabic.

Per tab, at ≥840pt:

- **Today** — the reward loop keeps the leading pane, composed exactly as it is on a phone. The
  trailing pane is the glance: a live qibla dial, then this month's calendar, then the record (the
  dial leads because it is the one thing there anybody wants an answer from at a glance; the record is
  omitted for someone who has never logged, so a wide screen never presents a table of zeros).
- **History** — the month and the stats lead; the day detail becomes a **standing panel** instead of a
  bottom sheet (§8 already allowed either), showing today until a day is chosen.
- **Qibla** — the instrument leads (header, calligraphy, status pill, and a dial grown to its pane);
  the figures, guidance, calibration and accuracy follow in the trailing pane.

---

## 2. Today tab (design 2a — see docs/DESIGN.md)

- **Header row:** Hijri date + Gregorian date (e.g. "16 Muharram · July 2") left; streak counter right ("24 *day streak*").
- **Next-prayer hero:** Arabic calligraphy name (Amiri), Latin name + time, "in 2 hours 7 minutes" countdown (live), reminder pill button toggling that prayer's reminder ("Reminder on" / "Remind me").
- **Five prayer rows** (Fajr, Dhuhr, Asr, Maghrib, Isha): name + Arabic name, time, status caption. **Three emphasis tiers (D66, supersedes D58's "unlogged only"):** the CURRENT prayer's row — the one whose window contains now — holds the primary emphasis **whether or not it is logged** (larger, brighter card, border; deadline caption "now · until 8:47 pm" while unlogged — Fajr: "now · until sunrise 6:14 am", after sunrise just "now" — and the status word once logged). The NEXT prayer's row gains a subtle secondary treatment ("next ·" word + faint ring beside its accent countdown, on the quiet card) **only once the current prayer is logged**, animated in at that moment. All other rows stay quiet. The hero speaks the same state: **DUE** (current unlogged — its name, "until {time}" and "{duration} left to pray", accent register) vs **WAITING** (current logged — the next prayer, its start time and "prayed · in {duration}"), both counting to the same instant, distinguished in place by an inline seal-echo glyph plus the wording and colour of lines every mode renders — the three modes are layout-identical, so switching never reflows the screen (D67). After Isha the current row is yesterday's Isha and no row is "next"; exempt days have neither tier.
- **The seal interaction (signature, amended by D58, D75):** each row has a 48px round seal on the right showing current status. **On the CURRENT prayer** (window open, status unlogged/prayed, not exempt): a single tap marks it prayed and the same tap undoes it — 1 tap to log; Late/Missed are not offered because an open window cannot yet be late or missed. There is no long-press: congregation tracking was removed (D75). **On past prayers**: tap → seal morphs into a 160px oval with three options: ✓ Prayed · 🕐 Late · ✕ Missed. Tap an option → collapses back with the new status. Tap the same status again → returns to unlogged. Tap the open seal's face again → closes without change. Footer hint: "tap the seal when you pray · tap again to undo". History's DayDetail keeps the full pill for every editable prayer.
- **Seal states:** prayed = filled gold circle + check; late = filled burnt-orange + clock; missed = outlined red-brown + ✕; unlogged past = dashed outline + dot; **unlogged current = dashed accent outline + ghosted check ("tap to complete")**; **future = thin solid faint ring + small dot (dormant)**; exempt = neutral filled (see §6).
- **Friday (D77):** the midday prayer is named **"Jumu’ah · Dhuhr"** (ar "الجمعة · الظهر", tr "Cuma · Öğle") — both names, because Jumu'ah replaces Dhuhr only for whoever prays it in congregation; a woman at home, a traveller or anyone who cannot reach a masjid prays Dhuhr. Display only: the prayer's identity stays `dhuhr` everywhere, and Friday-ness follows the **prayer day** (Fajr→Fajr), never the wall clock. Named at occurrence surfaces (Today rows and hero, History day detail, reminder list, ongoing notification); Settings, qada and per-prayer stats name the slot and stay "Dhuhr".
- **Qada card** (see §7): compact card below the prayer list, visible only when qada debt > 0.
- **Yesterday card (D98):** a quiet card between the prayer rows and the qada card — "Yesterday · {n} prayers not marked" — opening yesterday in **History's own day sheet** (the same `DayDetail`, same seals, same made-up conversion), for the person who fills in last night's prayers in the morning. An offer, never an audit: it renders only while yesterday still has an unmarked prayer (an exempt yesterday has none) **and** the user has logged something in the last 7 days, so a non-logger never sees it. It says "not marked", never "missed", and is gone the moment it is used or the day rolls over.
- Future prayers show "upcoming" and their seal is disabled until the prayer time arrives (loggable from adhan time onward; past prayers of today always loggable).

## 3. Prayer times engine

- **adhan-js**, fully offline. No network needed for any core feature, ever.
- **Method auto-selection by country** (from location reverse-geocode / locale fallback): Turkey→Turkey (Diyanet), US/CA→NorthAmerica (ISNA), SA→UmmAlQura, EG→Egyptian, PK/IN/BD/AF→Karachi, UK→MoonsightingCommittee, AE→Dubai, KW→Kuwait, QA→Qatar, SG→Singapore, IR→Tehran, fallback→MuslimWorldLeague. Shown transparently as "Auto (Diyanet)". Manual override always available.
- **Jafari/Shia** method included (Tehran/Leva-style: Fajr 17.7°, Isha 14°, Maghrib +4° or equivalent adhan-js Tehran config).
- **Asr madhab:** Auto (default; Hanafi in PK/IN/BD/AF, Shafi elsewhere and for the Shia methods, D209) / Shafi / Hanafi. **High-latitude rule:** middle of the night / seventh / twilight angle.
- **Per-prayer minute offsets** (−30…+30 min each) for matching local mosque / Fazilet-style temkin calendars. Settings shows the named authority + any offsets.
- **Day boundary:** the prayer day runs Fajr→next Fajr. Isha logged after midnight (before Fajr) belongs to the previous calendar day's record. Streak evaluation for day D happens at Fajr of D+1.
- **Prayer windows (D71):** **Fajr's window ends at SUNRISE** — not at Dhuhr. Every other prayer's window ends at the next prayer's time; Isha's ends at next Fajr, but its *nudge* is timed off Islamic midnight (adhan-js middle-of-the-night) to avoid 3am notifications. The five windows therefore do **not** tile the prayer day: between sunrise and Dhuhr nothing is due, no row is current, and the hero is PLAIN. The rule lives in one place, `src/domain/windows.ts`. Sunrise is shown on Today as a hairline horizon marker between the Fajr and Dhuhr rows — never a sixth prayer row.
- **DST correctness is a first-class requirement** — transition weekends (Europe March/October; Turkey has no DST) get explicit unit tests. This is a chronic, predictable failure in competitor apps.

## 4. Tracking semantics

- Statuses: `unlogged` (default) · `prayed` · `late` · `missed` (+ optional madeUp flag) · `exempt`.
- **Unlogged stays unlogged forever** — never auto-converted to missed. Visually distinct (dashed). In stats reported as "unlogged", separate from "missed".
- **Editing:** any past day editable via History, no time limit. Future days locked.
- **Never interrogate the user.** No "did you pray?" modal prompts. Logging is always user-initiated tapping.

## 5. Streaks

- **Two modes, user-selectable in Settings** (clear friendly naming, e.g. "Relaxed" / "Committed"):
  - **Soft:** a day counts if ≥1 prayer is prayed or late.
  - **Hard:** a day counts only if all 5 are prayed or late.
- Unlogged breaks a hard-streak day; doesn't count toward soft. Missed breaks hard.
- **Exempt days never break a streak** — they continue it (bridge, not count).
- Current streak + all-time best (with start date) tracked for both modes; displayed per the active mode.
- Day D's streak status is provisional until Fajr of D+1 (see §3). The header streak shows the running value optimistically (today's incomplete state doesn't show as broken while the day is open).
- **Forgiving by design:** logs are always editable, so a "broken" streak caused by a mistap or forgotten logging can always be repaired. No shaming copy anywhere, no "you broke your streak!" notifications.
- **The shipped default stays Soft/"Relaxed" (D70).** First-run setup asks the question with
  Hard/"Committed" pre-selected, so anyone who walks through the flow ends on Committed; the
  default only applies to someone who never answered, and for them Relaxed is the kinder answer.

## 6. Excused days (menstruation / postnatal)

- First-class, free, optional. Enable in Settings ("Excused days" with respectful, brief copy).
- When enabled: a quick toggle (in Today's header overflow or Settings) marks "exempt from [date]" / "exempt until [date]" periods; stored as date ranges.
- Exempt days: prayers render a neutral 'exempt' seal (the crescent — D64), captions like "not required". **Never rendered as missed, never nudged, never counted in stats denominators.** Streaks continue through.
- **Exempt is derived, resolved per prayer (D64):** the user records a period; a covered day overrides only `unlogged` and `missed` — an explicit `prayed`/`late` log keeps its status, so the first/last day of a period comes out right without per-prayer tapping. On an exempt day every seal is inert, kept marks included.
- **Period writes settle qada both directions (D63):** a day newly covered refunds each outstanding `missed` debt inside the same transaction; a day newly uncovered re-adds it; counters clamp at zero.
- All reminders + nudges automatically suppressed on exempt days.
- Qada estimation (§7) uses average exempt days/month (default 7, adjustable) to reduce estimated debt.
- No cycle prediction, no health data, nothing stored beyond the date ranges the user enters. This is not a period tracker.

## 7. Qada (missed-prayer debt)

- **Model:** per-prayer-type debt counters (Fajr/Dhuhr/Asr/Maghrib/Isha[/Witr later]). Logging 'missed' auto-increments that prayer's debt. Ticking off a made-up prayer decrements (oldest-first conceptually). Counters are **descending — progress toward relief**, with a projected debt-free date from the user's recent pace.
- **Today card:** compact card below the prayer list, visible only when debt > 0. Shows total remaining + one-tap "+1 made up" for the most-owed prayer type. Tapping the card opens the qada screen.
- **Qada screen** (pushed from Today card): per-prayer descending counters with gentle progress visualization, tick-off buttons (one at a time), pace + projected completion date, forgive & archive action. Must be beautiful, calm, simple — same paper design language.
- **Setup wizard** (first time the user opens qada, skippable): choose **(a) backtrack** — "from when to when did you miss prayers?" (date range or years) → auto-computes per-prayer debt, subtracting exemption days/month for women (adjustable), then lets the user hand-edit each counter; or **(b) fresh blank slate** — start at zero, only tracked misses accumulate.
- **Forgive & archive ("Start fresh"):** inside the qada screen, not buried in Settings. Compassionate copy (mercy framing, not deletion), confirm step; archives current debt as "forgiven · [date]" (history preserved), zeroes counters. **30-day undo** available in the same place. The undo is **additive** (D79): it adds the archived counters back on top of whatever they hold now, so prayers missed and logged between the forgiveness and the undo are not deleted. It is **withdrawn** — not offered at all — once the qada setup wizard has set the counters again since the forgiveness, because an estimate already spans the forgiven period and adding the archive on top would charge those prayers twice.
- **History integration:** a past 'missed' prayer can be marked "made up" from the day detail (sets madeUp flag + decrements debt). Shows as missed-but-resolved.
- No shaming anywhere. Copy reviewed for warmth in all three languages.

## 8. History tab

- **Month calendar grid:** Gregorian primary; header shows Hijri month span (e.g. "July · Muḥarram/Ṣafar"). Each day cell: progress circle showing prayed count (e.g. ring segments 0–5; late included with distinct shade; exempt days a neutral mark).
- **Day detail** (tap a date → expanding panel or bottom sheet): the 5 prayers with the same seal rows as Today, fully editable for past days; Hijri date shown; missed→made-up conversion available.
- **Stats section** (below or segmented with calendar):
  - Current + best streak (per active mode, e.g. "best: 61 · started June 9").
  - Per-prayer breakdown over 7/30-day window: most missed, most often late.
  - Completion rate (on-time vs late split) over 7/30 days.
  - Lifetime totals: total prayed, on time, days fully completed.
  - Exempt/unlogged excluded from denominators; unlogged shown as its own category, never merged into missed.

## 9. Qibla tab (design 3a — see docs/DESIGN.md)

- Header: "Qibla · [City]" + Recalibrate button.
- Compass dial (~288px): rotating ring with 36 ticks + cardinal letters, Makkah badge at qibla bearing, needle showing offset, fixed top marker, center pin.
- Status pill under the الْقِبْلَة calligraphy: "Turn to find the Qibla" → when aligned (**engages at ≤5°**): green "Facing the Qibla", needle snaps, ring/border/badge go green, badge icon mosque→check.
- **Alignment has hysteresis, and the card quotes the band it is actually using (D86).** It engages
  at ≤5° and **releases past 6°** — a hand is never still, and without a buffer the pill, the icons
  and the haptic chatter on the boundary. One degree is the whole buffer: the heading is published
  in whole degrees, so the delta walks in 1° steps and one sample sits between engaging and
  releasing. The guidance card is passed the **release** figure, never the engage one. A card that
  says 5° while the state machine honours 8° is simply a false sentence on screen, which is what a
  user caught in the 8° version.
- Guidance card: "Turn N° to the left/right — rotate until the needle meets the Makkah marker" → aligned: "Aligned — you may begin · Within 6° of the Kaaba".
- Info cards: Your heading (live °), Qibla bearing (e.g. "58° NE", highlighted), Distance (e.g. "10,321 km").
- **Sensor:** expo-location `watchHeadingAsync` (fused true heading + accuracy). **Smoothing:** shortest-arc interpolation + Reanimated spring on the UI thread — jitter-free but responsive (no visible lag when turning). Alignment state must never be color-only (icon + label + snap).
- **Accuracy confidence:** show sensor accuracy (e.g. dots/label low–high); low accuracy → calibration prompt (figure-8 animation/instruction). Footer hint: "lay the phone flat for best accuracy".
- True north (not magnetic) for bearing math; declination handled by the OS heading API.

## 10. Location

- **Auto (default):** coarse/approximate permission only — never request precise, never request Always. Re-resolve on launch. Works for times + qibla + method auto-selection.
- **Manual:** city search via OS geocoder (expo-location geocodeAsync — no API key). Stores city name + lat/lng. **One picker (D72)**, presented full-screen over whichever screen asked — Today, Qibla, Settings → Location, first-run setup — and dismissed straight back to it; choosing a city is the answer to the question that screen just asked, not an errand in another tab. Up to five candidates, but that is **the OS geocoder's ceiling, not ours** (D73): Android's returns exactly one.
- Location permission denied → app still fully works via manual city. **No dark patterns, no nagging.** App shows a friendly empty-state prompting city selection.
- Onboarding is minimal: the app must show something useful on first launch before any permission is granted.

## 10a. First-run setup (D69)

A short setup flow is offered **once**, on a genuinely fresh install, before the Today tab. It
does not weaken §10 — it is bound by one rule that makes the two compatible: **it may offer, and
it may never gate.**

- **Nothing is required.** Every step either carries an explicit way to decline it (location,
  reminders, qada, and the whole flow from the welcome page) or costs nothing to accept
  (theme, reminders-as-shipped, battery guidance, streak). A person who declines everything lands
  on Today with settings byte-identical to the app's defaults — the pre-onboarding path, not a
  degraded one.
- **No permission is requested without a tap on the control that names it.** The location ask is
  the same `LocationPromptCard` the Today tab shows; the notification ask happens on a button
  that reads "Allow notifications" while a sound is chosen and the OS has not been asked, and on
  a direct tap on a sound option. Nothing is requested on arrival or on a screen transition.
- **One decision per screen**, large type, an obvious default, and a progress indicator that says
  how much is left. The acceptance criterion is the owner's: it must be usable by someone very old
  or very young.
- **It runs once.** Finishing and skipping write the same flag; an install made before the flow
  existed migrates to "already seen" and is never sent through it.
- **Steps:** welcome → location → theme → reminders (off / device sound / adhan, all five prayers
  at once, with per-prayer detail deferred to Settings) → battery reliability (Android only, and
  only when reminders can actually fire) → streak mode → qada. Qada hands over to the existing
  setup wizard (§7); nothing in the flow is a second implementation of something Settings owns.
- **The welcome step states the app's heart (D99).** Title is the greeting — "Assalamu alaikum"
  (السلام عليكم / Selamün aleyküm) — and the body says why the app exists, in plain words: it is
  here to encourage prayer, to make each prayer's time easy to see and a small joy to mark,
  everything in it is free, and it will never scold or keep asking. Warm, never salesy (TONE.md);
  the setup explanation and the pledge line stay beneath it.
- **It ends on Today, in every branch (D85).** Including "Count them with me": Today is replaced in
  first and the qada setup is *pushed on top* of it, and closing the wizard on that visit returns
  there. Setup used to `replace` straight to `/qada`, which is a root-stack sibling of the tabs —
  full screen, no tab bar, nothing behind it — and a user took the counters for the app's main
  screen and thought prayers were marked there. Nothing may end first-run setup anywhere but the
  screen the app is for.

## 11. Notifications

All local (expo-notifications), all optional, all per prayer. Implementation: the *plan* is pure
(`src/domain/notificationPlan.ts`), the platform calls live behind an adapter
(`src/services/notifications.ts`), and `src/hooks/useNotificationSync.ts` decides when to reconcile.

### 11.1 The lifecycle of one prayer

A prayer's reminders are **four phases in one sequence**, and the whole design is that at any moment
the user should be looking at the newest one and nothing else:

| # | phase | fires at | gated on | sound |
|---|-------|----------|----------|-------|
| 1 | **Pre-reminder** | start − *X* min (per prayer, ladder 5/10/15/30/45) | `preReminderEnabled`; ships **off** | never the adhan |
| 2 | **Adhan reminder** | the prayer's start | `adhanEnabled`; ships **on** | per prayer: silent / device / the adhan (which recitation is one global choice, §11.6) |
| 3 | **Last call** | window end − *lead* (global, see §11.3) | `nudgeEnabled` (ships **on**) **and the prayer still unlogged** | never the adhan |
| 4 | **Sunrise note** | the window end itself — **Fajr only** | `sunriseNoteEnabled` (global, ships **off** — D90) **and Fajr still unlogged** | always silent |

Isha's last call is the exception to row 3: it fires at **Islamic midnight**, not at
`window end − lead`, because Isha's window runs to next Fajr (D71) and a last call at 4 am helps
nobody. Its copy therefore says the best time is ending rather than quoting a number of minutes.

### 11.2 The sunrise note, and why it exists for Fajr alone

Fajr is the only prayer whose window end is not another prayer's start: it ends at sunrise (D71),
and the next thing the app would otherwise say is Dhuhr's adhan six hours later. Someone who wakes
at eight has no way to learn from the app that Fajr's time closed at 6:20 and Dhuhr is at 1:00.
For every other prayer the next adhan carries that news for free — "Asr · time to pray" already
says Dhuhr is over — so a fifth notification would be noise.

**It reports the sky, never the person.** Copy: *"Fajr ended at sunrise"* / *"Next: Dhuhr · 1:00 pm"*.
It does not say "missed", does not ask anything, and does not imply anything about whether the user
prayed — the app does not know that, only whether they told it. It is:

- **silent and non-interrupting** — `interruptionLevel: 'passive'` on iOS (no banner, no sound, no
  lit screen; it appears in Notification Center when the user next looks) and a **low-importance
  channel** on Android (no heads-up, no sound, no vibration);
- **suppressed the moment Fajr is logged**, in any way, like the last call;
- **off unless the user asks for it** — `AppSettings.sunriseNoteEnabled`, one global flag (Fajr is
  the only prayer it exists for), with its own switch in Settings → Reminders. It is **independent
  of `nudgeEnabled`**: turning every last call off does not silence it, and turning it on does not
  require one (D90);
- **once a day at most**, which is also what keeps it affordable against the iOS cap (§11.4).

Someone who turns it on and never logs anything receives one factual line a day naming sunrise and
the next prayer time. That is information of exactly the kind they installed the app for, and it
names no failure.

**Why it ships off, and what that costs.** With it on, an unmarked Fajr produces *two*
notifications about the same prayer: the last call while there is still time, then the note once
there is not. The second arrives after the fact and volunteers the next prayer's time unasked —
which is noise to anyone who only wants to know what to pray now, and close to the line CLAUDE.md
draws at "never make it an audit". Before D90 it rode `nudgeEnabled`, so the only way to stop it
was to give up the last call on all five prayers, which is the far more useful notification. **What
is lost by defaulting it off:** someone who sleeps through Fajr now learns that its window closed
only by opening the app. The last call before sunrise is what remains — and it arrives while there
is still time to pray.

### 11.3 Configurable last-call timing

One global setting (`AppSettings.nudgeLeadMinutes`, Settings → Reminders), **not** per prayer:
"how much warning do I want" has one answer. Default **20 minutes**; offered as 10 / 15 / 20 / 30;
stored values are clamped to **5–60**. It is measured against the prayer's *real* window end — for
Fajr that is **sunrise**, not Dhuhr. A lead longer than the window itself (a short dawn-to-sunrise
stretch at high latitude, or a 30-minute lead against a 25-minute Maghrib window) **drops** that
last call rather than firing it early; the Fajr sunrise note is unaffected, since it is pinned to
the window end rather than offset from it and no longer shares a switch with it (§11.2). The row
appears only while at least one prayer's last call is on.

### 11.4 Scheduling, and the iOS cap

Rolling **5-day** window, rebuilt on app foreground, settings change, location change, prayer
logged, language change, and day rollover. The reconcile is differential: it reads what the OS
holds and applies only the difference, and never cancels what it is about to reschedule.

iOS holds at most **64 pending local notification requests**; we self-truncate at **60**, keeping
the earliest. The arithmetic:

- **Shipped default** (adhan on, pre-reminder off, last call on, sunrise note off): 5 prayers × 2
  = **10 a day → 50 for five days**. Fits, with the full five-day horizon intact. Turning the
  sunrise note on costs one more a day (**11 → 55**), and still fits.
- **Everything on** (pre-reminders and the sunrise note too): 5 × 3 + 1 = **16 a day → 80 for five
  days**, truncated to 60 — about **three and a half days** of coverage. That is the cost of a
  maximal configuration and it is the user's own trade; the schedule is rebuilt on every foreground
  regardless.

Exempt days produce **nothing at all**, not even the adhan reminder (§6).

### 11.5 What the platforms will and will not do (verified on device)

The owner's ask is "don't stack notifications — once something is no longer applicable, dismiss the
other". Only part of that is achievable, and the boundary is worth stating so a future reader does
not file the gap as a bug. Verified on an iPhone 11 Pro Max simulator, iOS 26, expo-notifications
57.0.12, and against the library's own iOS/Android sources:

| behaviour | iOS | Android |
|---|---|---|
| A **delivered** notification is replaced in the tray by a later one with the **same identifier** | ✅ verified — count stays 1, content updates | ✅ posts with `notify(tag = identifier, id = const)`, so same identifier replaces (read from `ExpoPresentationDelegate.kt`; not device-verified) |
| Two **pending** requests may share an identifier | ❌ **no** — verified: the second `schedule` silently replaced the first, which never fired | ❌ no — the pending store is keyed by identifier (`SharedPreferencesNotificationsStore.kt`) |
| A notification can be **dismissed at a future moment** while the app is closed | ❌ nothing offers this — see below | ✅ **since D88** — our own alarm + `NotificationManager.cancel(tag, 0)`, in a local Expo module |
| Thread/group identifiers to collapse a prayer's phases into one row | ➖ not needed — iOS groups an app's notifications by default; `threadIdentifier` is in the JS type but **dropped** by `toUNMutableNotificationContent()`, and would only *split* them into sub-groups | ❌ `setGroup` alone does **not** group (D88) |
| `dismissNotificationAsync` clears the tray | ✅ verified | ✅ |
| `interruptionLevel: 'passive'` suppresses the banner and the sound | ✅ verified (`active` bannered, `passive` did not, and still reached Notification Center) | n/a — a low-importance channel is the equivalent |

**The consequence, stated plainly:** replacement-by-identifier is real but unreachable for a
pre-scheduled sequence, because the replacement can only be scheduled *after* the earlier one has
fired, which needs the app to be running in between. **So a stale reminder cannot be *replaced* at
the instant it goes stale.** It can be *removed* — on Android.

#### Android: the notification dismisses itself (D88)

Every reminder carries an `expiresAt` in its payload — its prayer's window end, or the next
prayer's start for the sunrise note, which is meant to be read after the fact — and scheduling it
also arms an alarm for that instant. The alarm wakes a `BroadcastReceiver` of ours, which takes the
notification out of the tray. **No process of ours needs to be alive for any of it**, so Fajr's
banner does vanish at sunrise on a phone that has not been unlocked since.

That lives in `modules/notification-dismissal`, a **local Expo module of our own** — not a patch of
`expo-notifications`, which was built first and then rejected: a patch is keyed to an exact version
and disappears silently on the next bump (D88). The module uses only public Android APIs
(`AlarmManager`, `NotificationManager.cancel(tag, id)`) and **never posts, schedules or changes a
notification**, so it cannot affect delivery. Its one coupling is the convention in the first row
of the table above — the library posts under `(tag = our identifier, id = 0)` — which
`src/services/notificationDismissal.test.ts` asserts against the library's own source, because a
`cancel` aimed at the wrong pair is a silent no-op rather than an error.

Nothing about scheduling changes: every prayer keeps its own identifier and its own alarm, so the
rolling five-day window and its delivery guarantees are untouched. What shrinks is what the tray
holds — at most the notifications of the window that is currently open, in the shipped default two.

#### iOS: there is no expiry, and this is settled

**A delivered local notification cannot be removed at a future moment on iOS by any mechanism.** It
stays in Notification Centre until the user clears it or the app calls
`removeDeliveredNotifications`, which needs the app to be running. Apple's own guide covers
scheduling and cancelling *pending* requests and says nothing about delivered ones, and there is no
`timeoutAfter` equivalent on `UNNotificationContent`. `threadIdentifier` is not a way round it
either: it groups, it does not expire, and `expo-notifications` never writes it
(`NotificationRecords.swift` — `toUNMutableNotificationContent()` sets title, subtitle, body,
launchImageName, badge, userInfo, categoryIdentifier, sound, attachments and interruptionLevel, and
`threadIdentifier` only on the way *back*, at line 322, when a notification is read).

Nor is grouping wanted on iOS: **Notification Grouping defaults to Automatic**, which stacks an
app's notifications into one entry with the most recent on top, and that is exactly the behaviour
asked for. Setting a thread identifier would *subdivide* that stack rather than create it.

So on iOS the answer is the sweep below plus posting fewer — and that is the end of the
investigation, not a gap awaiting a fix.

#### Why the "one rolling slot" scheme cannot work — the arithmetic

The appealing idea is one identifier re-used all day: *"Fajr is here" → "15 minutes left for Fajr"
→ "Fajr ended at sunrise" → "Dhuhr is here" → …*, each delivery replacing the last, so the tray
never holds more than one. The observation behind it is correct — for Dhuhr, Asr, Maghrib and Isha
the window ends exactly when the next prayer starts, so the next adhan **is** semantically the
expiry replacement (which is why `expiry` is Fajr-only, §11.2). But the mechanism cannot be built:

> Tray replacement N steps later requires the ring to have N identifiers. Every notification
> pending at the same moment must have a **distinct** identifier (row 2 above, measured). So
> **N = the number of notifications currently scheduled**, and the replacement lag equals the whole
> lookahead. A single slot means exactly **one** pending notification — a lookahead of one event,
> roughly three hours — after which the app must be opened before anything else can be scheduled.

That is precisely the defect the differential sync exists to prevent: "the adhan did not fire" is
the category's second-most-common complaint, and every competitor's answer is "open the app every
few days". Trading multi-day reliability for a tidier tray would adopt the defect deliberately, so
the rolling slot is **rejected**. What the owner actually asked for — *"be smart… rather than
filling their notifications up"* — is served instead by posting fewer (at most one expiry a day,
and none at all unless it has been asked for — §11.2, D90), sequencing them so the newest is
self-sufficient, and clearing the tray on every sync.

What the app does instead:

1. **Posts fewer notifications**, and sequences them so the newest one is always the one worth
   reading — the sunrise note is last, and it names what to do next.
2. **Clears the tray every time it runs** (`selectStaleDelivered`), dismissing each delivered
   notification of ours whose prayer is now logged, whose day became exempt, which a later phase of
   the same prayer has superseded, whose moment has passed — the window end for phases 1–3, and the
   *next prayer's start* for the sunrise note, which is meant to be read after the fact — **or
   whose prayer day the horizon has already left behind** (D84). That last rule is the one that
   answers the wall: the plan's horizon starts at *today*, so before it existed every notification
   that fired on a day the user did not open the app was skipped as unjudgeable and stayed in the
   tray for good. No times are needed to judge it — every window on a past prayer day shut when the
   current one began. A day *beyond* the far end of the horizon is still left alone.
3. **Sweeps when the tray grows, not only when the app is opened.** `observeReceived` subscribes to
   our own reminders arriving — on Android that fires while the app merely sits in the background —
   and runs the sync, because Dhuhr's adhan landing is precisely what makes Fajr's obsolete. It is
   filtered to our scheduled reminders inside the service: the app *posts* the ongoing notification
   during a sync, so an unfiltered listener would sync, post, receive, sync, for ever.
4. **Silences a prayer the instant it is logged**: its pending last call and sunrise note are
   cancelled and everything of its already in the tray is dismissed, without waiting for the
   debounced sync.
5. Relies on both platforms' own **per-app grouping** for whatever remains between foregrounds.
   Deliberately *not* `setGroup` on Android: the platform reference is explicit that a group needs
   a summary notification to be a group at all, and that automatic bundling applies only to
   notifications with **no** group key — so setting one without also posting a summary would opt
   our reminders out of the bundling Android already does for free. A summary is its own row to
   create and remove, and with children now dismissing themselves while the app is dead there is
   nothing running to remove it — and with them gone the tray rarely holds more than one of ours
   anyway (D88). It would also mean intervening in a notification's construction, which is exactly
   what the dismissal module was designed to avoid.

   **Not to be confused with Android 16's notification organizer (D146).** That is a different
   mechanism reading the same input: an on-device classifier that sorts a notification by its
   *content* into Promotions / News / Social / Suggested, then bundles and **silences** it. D88's
   reasoning about group keys is unrelated and still stands — declining a group key is what lets
   the free per-app bundling work, and it is not what makes the classifier take an interest. There
   is no app-facing way to opt out of classification; what we do instead is declare
   `Notification.category` on everything we post, so a reminder at least says it is a reminder.

**So: "only ever one active notification" — how close, honestly?** While the process is alive,
effectively there on both platforms: the tray converges on the one live prayer within a debounce of
every arrival, every log, every foreground.

While the app is **shut**, the two platforms now differ.

- **Android**: close, and by a route that costs no delivery. Each notification is dismissed when
  its own window closes (D88), so what accumulates over a closed stretch is not K rows but the rows
  of the window that happens to be open — one or two in the shipped default, three if pre-reminders
  are on. What it cannot do is collapse those into a single row at the instant each becomes stale;
  the dismissal is by time, and a prayer *logged* on another device is not a thing this app has.
- **iOS**: not at all, and not by any route that keeps delivery. K notifications firing over a
  closed stretch need K distinct pending identifiers, so they occupy up to K rows, and nothing can
  dismiss them until something of ours runs again. iOS's own per-app grouping stacks them into one
  entry, which is the whole of the mitigation.

### 11.6 Hearing the adhan, and knowing whether you will

**The word "adhan" names the sound, and nothing else (D94).** In user-facing copy a notification is
named by its **time** — "Prayer-time reminders", "When the time comes in", "Before the time" — in
all three languages, and "adhan" appears only where the recording is meant: the sound choice, the
recitation, the adhan test. Before this rule, "turn all adhan reminders on" sat one group above a
sound option called "Adhan" and read as "set every sound to the adhan". Everything about the sound
lives in one Settings → Reminders group titled **"The adhan"**: the recitation, the in-app preview,
and the test buttons.

Two controls sit next to each other in that group, and they answer **different**
questions. The copy keeps them apart on purpose, because conflating them is how someone concludes
their reminders work when they do not.

- **"Recitation"** is a disclosure row naming the recitation currently in use; opening it reveals
  the **four recitations** (Makkah, Nasser Alqatami, Mufti Ismail Musa Menk, Sabah Fakhri, D81),
  and pressing one **chooses it and plays it in the app** (`expo-audio`, `hooks/useAdhanPreview`).
  Press the same one again to stop; press another to switch. `adhanVoice` is one **global** choice
  — never per prayer. The chosen row is marked by a check glyph, a brighter card and the `radio`
  accessibility state, and the sounding one is named in a word ("Playing X — tap it again to
  stop."), never by a colour or an icon alone. It exists so nobody has to choose a notification
  sound they have never heard.
  - **The preview is the file the reminder will use**, resolved once in
    `domain/adhanVoices.adhanSoundFile` and asked by both the preview and the notification service:
    the `.caf` clip on iOS, the full `.mp3` on Android. A three-minute audition on a phone that
    will only ever ring for 28 seconds would misrepresent the thing being chosen.
  - **One player, therefore one recitation at a time** — switching `replace()`s its source, so two
    adhans over each other is structurally impossible rather than a rule to remember.
  - **The iOS note.** One quiet line below the four, shown **only on iOS**: an iPhone plays about
    half a minute of the adhan and then fades, because Apple limits how long a notification sound
    can be. Stated as a fact about the platform, not as an apology or a missing feature; Android
    users, who hear the whole recitation, never see it.
  - **It plays through the silent switch** (`playsInSilentMode: true`). A person who pressed a play
    button asked for sound in as many words, and iOS's own convention is that the ringer switch
    governs *alerts*, not media somebody started. The cost is that the preview proves nothing about
    whether reminders are audible — so its own description says so, and §11.7 covers that ground.
  - **It stops when the user stops looking**, in three overlapping layers: the audio session itself
    (`enableBackgroundPlayback: false` in the config plugin → no `audio` background mode on iOS, no
    media foreground service on Android, plus `shouldPlayInBackground: false` at runtime, so the OS
    suspends it whether or not any JavaScript runs); any `AppState` change out of `active`
    (backgrounding, app switcher, screen lock, an incoming call); and screen blur or unmount.
  - It ducks other audio rather than stopping it, and the app declares **no microphone permission**
    (`microphonePermission: false`, `recordAudioAndroid: false`) — we never record.
  - **Adding `expo-audio` requires a native rebuild**; it is a native module, not an OTA change.

### 11.7 Saying when the phone will not make a sound

"I pressed send a test and heard nothing" is the failure this answers. A line under the test row
reports **only what the OS actually told us**, and the governing rule is that *unknown must never
produce a warning* — a confident wrong diagnosis sends the user to fix the wrong thing.

What each platform genuinely reports (read from `expo-notifications` 57's own sources):

| signal | iOS | Android |
|---|---|---|
| Sound allowed for this app | ✅ `ios.allowsSound` | ✅ app `importance`, **and** the channel's own `importance`/`sound` via `getNotificationChannelAsync` — which is what matters, since Android's settings UI silences the *channel* |
| Alerts allowed at all | ✅ `ios.allowsAlert` | ⚠️ only via app importance |
| Do Not Disturb / interruption filter | ❌ no API | ✅ `android.interruptionFilter` |
| Notification summary holding delivery | ❌ **`scheduledDeliverySetting` is not surfaced** by expo-notifications 57 | n/a |
| **Physical silent switch** | ❌ **no public API** | n/a |
| **Active Focus mode** | ❌ **no public API** | partially, via the interruption filter |

So the app says one of three things when it knows something — alerts off (most severe, wins),
sound off, or Do Not Disturb on — and otherwise says nothing at all until a test has been sent, at
which point it shows a footnote that points without claiming: *"Heard nothing? Check your ringer
and Focus — the app cannot see either."* The classifier is pure (`describeDelivery`) so the rule is
testable, and the line is announced to a screen reader rather than carried by an icon or a colour.

### 11.8 The rest

- **Android ongoing notification (optional, off by default):** one silent, unswipeable row under a
  fixed identifier — the single place in this app where "the new one replaces the old" is actually
  reachable. It has **two phases**, and it follows the log rather than only the clock (D83):
  - **`due`** — a prayer's time is in, its window still open (`domain/windows`: Fajr's ends at
    sunrise, Isha's at the next dawn), its day not exempt, and nothing logged against it. Reads
    *"Now: Dhuhr · 1:00 pm"* over *"Next: Asr · 4:00 pm"*. Two facts, neither of which ages, so the
    phase is redrawn once — when the window shuts. The body is the next prayer rather than a
    countdown because for Dhuhr, Asr, Maghrib and Isha the next prayer's start **is** the window
    end, so one line serves both audiences; the deadline is therefore unstated for Fajr alone,
    where a third clause in a lock-screen line would cost more than the omission (D83 — the
    sunrise note covers the same ground for anyone who has turned it on, §11.2).
  - **`upcoming`** — everything else. Reads *"Next: Asr · 4:00 pm"* over the approximate remainder,
    redrawn at the coarse checkpoints (`ONGOING_LEAD_CHECKPOINTS_MS`), never on a tick.
  Marking the due prayer moves it on at once; it **asks for nothing**, and it stops naming a prayer
  when the window closes rather than when the user answers, because after sunrise the app does not
  know whether Fajr was prayed — only whether it was told. (iOS's counterpart surface is the
  prayer-window Live Activity, D104 — shipped with the widgets, off by default like this one.)
- **Reminder health screen** (from Settings): list of currently scheduled notifications, "send test
  notification" button, the exact-alarm card (§11.9), Android battery-optimization/OEM guidance
  (Samsung/Xiaomi/Huawei/Oppo specifics), warning state if the OS has purged schedules.
- **Copy rules.** A notification is read on a lock screen, in a glance, often before the reader is
  awake. The **title names the prayer** (Latin + Arabic where that reads well; the Arabic bundle
  prints the Arabic name once), the **body carries exactly one fact**, and nothing is repeated
  between them. "20 minutes left **to pray**" keeps its last three words on purpose: a bare
  "20 minutes left" reads just as easily as *20 minutes until the prayer*. All copy is authored per
  language, never mirrored. Tapping any notification opens Today — **pressing one of its buttons
  never does** (§11.10).
- Four adhan recitations are bundled, two files each: a `.caf` clip under the iOS 30-second
  notification-sound cap, and the full `.mp3` Android rings with (D81, `assets/audio/CREDITS.md`).
  The cap is mentioned in UI copy in exactly **one** place — the iOS-only note beside the selector
  (§11.6), where it explains something the user can hear — and nowhere else. Licence position:
  no licence document was located for any of the four; credit is the reciters' names, on the
  selector and on About.

### 11.9 Exact alarms: whether the reminder lands on the minute (D91)

Android only. `expo-notifications` sets every reminder through `AlarmManager` and asks one question
first (`ExpoSchedulingDelegate.setupAlarm`): may this app set an *exact* alarm? If the answer is no
it sets an inexact one — **silently**, no error, nothing JS can observe — and Doze may then batch
that alarm and deliver it minutes late. On **Android 14+ the answer is no by default** for any app
targeting API 33 or higher, and we target 36. `SCHEDULE_EXACT_ALARM` has always been in `app.json`,
but a manifest entry only makes a permission *requestable*: until D91 nothing ever asked, so every
reminder on a fresh Android 14+ install was inexact and nothing in the app said so.

The two calls needed are not exposed by `expo-notifications`, so they live in
`modules/exact-alarms`, a second local Expo module beside `notification-dismissal` and bound by the
same rule — **it never schedules, posts or cancels a notification**, it reads one flag and opens one
settings screen. `services/exactAlarms` wraps it into three states: `exact`, `inexact`, `unknown`.

Where it is surfaced, and nowhere else:

- **Settings → Reminder reliability** shows a card in **both** states, because that screen exists to
  be checkable: "Reminders arrive at the right minute" when it is granted, and when it is not, that
  reminders may arrive late plus the one button that opens Android's *Alarms & reminders* screen.
  `unknown` renders nothing at all — that is a dev client without the native module, and an
  invented verdict there would be worse than a missing card (the rule the battery card already
  follows).
- **First-run setup**, once, inside the existing `battery` step — which exists for this same class
  of problem and is already skipped for anyone who chose no reminders. No new step, and the offer
  appears only when the phone is actually holding reminders back.

**Declining breaks nothing**, and the copy says so: reminders still arrive, they are just not
guaranteed to the minute. There is no second ask anywhere.

**Granting does not upgrade alarms that are already set.** Exactness is decided when an alarm is
set and never revisited, so the reminders already waiting — tonight's Isha, tomorrow's Fajr — stay
inexact until they are set again, which Android otherwise only does on a reboot or an app update
(`setupScheduledNotifications`, from the `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED` receiver that
`expo-notifications` declares). Both surfaces therefore call
`rebuildNotificationsFromStores()` — cancel everything, plan again — on the transition from
`inexact` to `exact`, and only on that transition.

**`USE_EXACT_ALARM` is deliberately not declared.** It is granted at install and needs no screen,
and Play halts the release of any app that declares it without being categorised as a clock or a
calendar. Ours is Lifestyle. Post-1.0 argument, with evidence, or never.

**iOS has nothing to do here**, and this is settled: a scheduled local notification is held by the
system and fires at its minute whatever the app is doing, including after a force-quit. There is no
permission, no downgrade and no card.

**What re-arms alarms the OS drops, and what does not.** Reboot and app update are covered by
`expo-notifications`' own receiver, which re-schedules its whole store. **Nothing covers a
force-stop** — by the user or by an OEM task killer — because a force-stopped app's alarms are
cancelled and only a launch restores them; that is what §11's battery guidance is for, and it is
why the app also re-syncs on every foreground. A foreground service would not change this (see
the Android reliability plan in the internal notes).

### 11.10 Marking a prayer from the notification (D92)

The adhan reminder carries **one button: Prayed**. Pressing it marks the prayer, swaps the reminder
for a short confirmation carrying **Undo**, and the app is never opened. CLAUDE.md's "the app is a
tool, and least friction wins" is what settles that this is a win rather than a loss to the reward
loop: the loop exists to make the tap feel good, not to draw anyone in.

**One button, not three.** D58 established that a prayer whose window is still open cannot be late
or missed, and the adhan arrives *at* the prayer's time. Late and Missed would be dishonest there,
and three buttons on a lock screen is worse than one anyway. The button is on the adhan and nowhere
else: the pre-reminder arrives *before* the time, where the button would invite a claim about a
prayer that cannot have happened yet.

**Nothing is written natively.** The press appends one entry — `(id, day, prayer, decidedAt)` — to a
small append-only queue (SharedPreferences on Android, an App Group `UserDefaults` on iOS), clears
the reminder, and posts the confirmation. The app **drains that queue on its next launch and on
every foreground**, through `trackingStore.toggleStatus` — the same path a tap on the seal takes —
so prayer days, qada, streaks and exempt days are applied exactly once by the code that already
owns them. A native write would have been a second copy of `src/domain` in two more languages.

- **The prayer day travels with the entry**, copied from the notification's own payload. A reminder
  still sitting on a lock screen the next morning is about the prayer it announced, not about the
  day the button was finally pressed. For the entry that somehow arrives without one, the day is
  resolved from `decidedAt` through `domain/dates` — never from the moment of the drain.
- **Undo is a second entry, not an edit.** It names the first. If both drain together they cancel
  and nothing was ever written; if the app was opened in between, the orphan undo clears the prayer
  it names. Nothing is ever un-written.
- **Draining is idempotent by construction.** `prayed` is written only over an unlogged prayer and
  `unlogged` only over a prayed one, so a replay after a crash does nothing — and a stale entry
  cannot overwrite a status the user set by hand in History.
- **Nothing expires.** A mark whose prayer day passed weeks ago still applies: the user did pray,
  the app simply was not opened. It cannot create a qada debt either, since only `missed` moves
  those counters and the queue can only ever say `prayed`.
- **A queue nobody drains is harmless.** The entries wait. Until then the streak and History do not
  know about them, which is the price of the button and a small one.

**The confirmation does not congratulate.** *"Maghrib marked"*, an Undo, gone in about thirty
seconds — silent, low importance, its own Android channel so it can be switched off without
touching the reminders. On Android the thirty seconds are the system's (`setTimeoutAfter`), exact
and honoured with the app dead; **on iOS there is no such thing** (§11.5), so it is a best-effort
timer inside the background time granted for handling the press, and a confirmation that outlives
it is removed at the next drain.

**Where the native code lives.** `modules/prayer-marks`, the third local Expo module, bound by the
same rule as the other two: **it never schedules a reminder**. On Android the press is delivered
through `expo-notifications`' own `NotificationManager` listener, registered from
`Application.onCreate` — early enough that a process started *by* the press has it in place. On iOS
it is a delegate added to the library's `NotificationCenterManager` from an app-delegate
subscriber, which iOS calls when it launches the app into the background to deliver the response.

**The App Group** (`group.app.simpleprayer`, added by `plugins/withAppGroup.js`) is shared
infrastructure, not this feature's: the widgets (D100) read the same container — their snapshot
mailbox and this queue live side by side in it, and the widget seal-tap appends `widgetMark:*`
entries the reader here merges in. The plugin's registration travels with the widget target
(branch `widgets-ios-config` until the owner's Apple-side pass, `docs/WIDGETS_APPLE_RUNBOOK.md`).

**The button survives an app update.** The category a request is scheduled under is recorded in its
payload, and the sync's staleness check rebuilds any held reminder whose recorded category no
longer matches what this build would attach — in both directions, because a button that queues
nothing (a build without the module) is worse than none. Without this, every reminder the previous
build had already handed to the OS keeps firing button-less for up to the whole plan window.

**The ongoing notification carries the same button while a prayer is due (D95, Android).** Its
payload then names the due prayer and carries, pre-baked, the localized "Next: …" content the
notification should show once that prayer is marked — Kotlin cannot build localized copy, so the
app computes the after-state (the same redraw its next foreground would do) at present time.
Pressing Prayed queues a real mark and **swaps the furniture in place** rather than clearing it:
the native handler re-posts the sticky notification with the carried content, on the same channel
and under the same tag, and posts the usual confirmation. With no after-content carried (the far
end of the planned window) it comes down instead, and the next foreground redraws whatever is true.
An Undo pressed before the app next opens leaves the swapped text one prayer ahead until then —
a small, honest staleness the next redraw corrects.

**The test notification is a dress rehearsal (D93).** It carries the same Prayed button, and a
`test` flag in its payload: the press clears the notification and posts a confirmation — *"The
button works. Nothing was saved."* — and **records nothing, ever**. The test confirmation carries
no Undo, because a button undoing nothing would be chrome. Its payload names no prayer on purpose;
the native handlers answer the test flag before the prayer guard, so a test is never one bug away
from marking someone's day. A second test row sends the same test with **the adhan** (§11.6),
whatever the prayers are set to — the recitation can be heard as a real notification before anyone
commits a prayer to it.

### 11.11 Pause what's playing (D96, Android only)

Opt-in, **off by default**: when a prayer's time comes in, music or a podcast playing on the phone
is paused — the moment belongs to the adhan, or to silence. The reminder's own sound is unaffected
(notifications do not play on the media stream), and nothing is restarted afterwards: the user
plays their audio again when they are ready, which is the honest meaning of "pause for prayer".

**Mechanism** (`modules/audio-pause`, the fourth local Expo module): every adhan-time request
scheduled while the setting is on carries `pauseAudio: true`, and the adapter arms an
`AlarmManager` alarm at the request's own fire instant — the `notification-dismissal` pattern
(D88), because `expo-notifications` dispatches nothing to listeners when a reminder fires with the
process dead. The alarm's receiver requests **permanent audio focus** and politely abandons it
moments later; well-behaved players stop and do not resume on their own. Nothing is paused when
nothing is playing. Two honesty rules: the alarm is **exact** wherever the exact-alarm permission
allows (a pause landing at a random moment is worse than none, so an entry more than a few minutes
past its instant is dropped, never delivered late); and the flag joins the payload's staleness
comparison, so flipping the toggle rewrites the reminders the OS already holds.

**iOS has no version of this and never will** by any mechanism Apple ships or permits: a dead app
cannot touch another app's audio, and the apps that appear to are holding a background audio
session Apple rejects (guideline 2.5.4). What iOS gives instead, for free, is the system's own
brief ducking while the notification sound plays. The toggle therefore never renders on iOS — nor
on an Android build without the module — because a switch that switched nothing would be worse
than no switch.

## 12. Settings tab

Grouped, minimal, everything obvious. Groups are **questions, not features** (D178): each is named
for what somebody opens Settings to do, in the order they are likely to want it, and no group
holds a single row unless it is conditional. The index is a list of doors and switches — a row is
a label, one sentence and a value — and anything with more than about four options lives on its
own screen, whose answer the row shows as its value.

- **Prayer times:** Location (auto toggle + current resolved city / manual city search, on its
  own screen; the row shows the city and how it was chosen) and How times are calculated
  (calculation method (Auto (X) + full list incl. Jafari), Asr madhab, high-latitude rule,
  per-prayer minute offsets, hijri date offset (±2 days); the row names the resolved authority).
  One group because "the times are wrong" is one question with two answers.
- **Reminders:** Reminders for each prayer (the row counts how many prayers have any reminder):
  per-prayer: adhan reminder on/off + sound (silent/system/adhan), pre-reminder on/off + minutes; last call on/off; **one global "how early the last call arrives"** row (10/15/20/30, default 20 — see §11.3), shown while any last call is on; **one global "note at sunrise" toggle** (default **off**, §11.2 — its own group between the bulk actions and the prayer cards, so an off-by-default setting is still findable without opening a card); **one global adhan recitation** row (four choices, each playable, §11.6); Android: "pause what's playing" toggle (§11.11, off by default) and persistent notification toggle; iOS: the Live Activity (D104, D112). And Check your reminders (the reminder health screen, §11.5).
- **Buddies:** Buddy mode (D174), a navigation row whose value is On/Off, with a one-line footer.
  Its own group, high on the page, because it is the feature nobody could find; still off by
  default and never mentioned outside Settings.
- **Your prayer log:** streak mode (soft/hard), Excused days (a navigation row: value On/Off,
  description the neutral-register status or a one-line teaser; the **switch and the paragraph
  under it live on the excused-days screen**, D62/D178), qada entry point, and the two exports
  (CSV/JSON via the share sheet) with the "made on your phone, goes only where you send it"
  caveat as the group's footer. Not called "Tracking": the pledge says "no tracking".
- **Your watch:** only while a paired Apple Watch is missing the app.
- **Appearance & language:** theme (system/light/dark), language (system/en/ar/tr), numerals
  (Arabic only).
- **Privacy:** the "No ads, ever" pledge (short manifesto: no ads, no account, no tracking, your
  prayer log never leaves the device — the footnote enumerates the narrow exceptions: city lookup,
  update check, opt-out crash reports, the tip purchase, and buddy marks; guarded by
  `privacyClaims.test.ts`) and the crash-reports toggle (D51, on by default) beside it, because
  the pledge is where the privacy claims are made and this is their one exception. Directly
  above Support, so the pledge stands over the tip jar it explains.
- **Support:** tip jar ("Leave a tip" — see §14; the pledge directly above it is the "no ads" line beside the jar), "Rate the app"
  (store deep link), **"Send feedback"** (opens the public board at `simpleprayer.featurebase.app`
  in the browser — a link out, never a form here; see D87 and §14a), About.
- About: version, licenses (fonts, adhan audio attribution), link to `simpleprayer.app/support`
  (the help page, not the landing page — that one is for people who do not have the app yet),
  "Rate the app" and "Send feedback" (both repeated from Settings → Support on purpose — §14a).

## 13. Review prompting (store ratings)

- expo-store-review → native APIs only. **No pre-gating dialogs** ("enjoying the app?" is banned by Google, disallowed by Apple).
- **Triggers (behavioral delight moments), best first — the first one the policy allows is the one
  that fires:** completing a 7-day streak; completing a 30-day streak; first week with all days
  fully green; successful setup completion (times shown + first reminder confirmed delivered); and
  last, **steady use** — times shown, 12+ sessions, 21+ days installed (D89).
- **Steady use exists because the other four assume logging.** Streaks and complete weeks need a
  log; setup success needs a tap on one of our notifications. Someone who only ever wants prayer
  times and a qibla, with reminders off, satisfies none of them ever — so before D89 they could
  not be asked at all, and reviews are the entire discovery channel for an app with no ads to
  advertise it. It is deliberately the weakest moment in the set ("it has kept working for you"),
  tried last, and its thresholds are set past the point where a logger would already have earned
  and spent a better one — so in practice it reaches only the people the others cannot.
- **Hard exclusions:** never during a prayer window or adhan; never after a broken streak or a mistap-fix; never after the user reported/adjusted "wrong times"; not on Ramadan's first/last days; not during first launch/onboarding; crash-free-session gate.
- **The adhan exclusion covers in-app playback only, and is self-wiring (D89).** The "Hear the
  adhan" preview (§11.6) reports to `services/adhanPlayback`, which `useReviewPrompt` reads at fire
  time and subscribes to for the quiet period — no mount site or screen has to remember to pass
  anything, which is why it was dead the first time. The adhan that arrives at Fajr is an OS
  *notification sound* and no process can observe it; `prayerWindowMinutes` (30) is what actually
  protects someone on the mat.
- **Throttling:** ≥90 days between attempts (iOS enforces 3/365 anyway), lifetime self-cap ~3. Trigger thresholds live in one config module (tunable via EAS Update without store release).
- Settings "Rate the app" row uses the store **deep link** (`https://apps.apple.com/app/id<ID>?action=write-review` / `market://details?id=...`), never the in-app API.

## 14. Tip jar (RevenueCat)

- Settings → "Support the app": exactly **three consumable tiers** — the fixed product ids
  `tip_small` / `tip_medium` / `tip_large`, identical on iOS, Android and the test store — fetched
  **directly by id** via `getProducts(…, NON_SUBSCRIPTION)` and bought with `purchaseStoreProduct`.
  **No RevenueCat Offering and no Paywall** (D57 supersedes the original "grouped in an Offering"
  plan); prices are the store's own localized `priceString`, rendered verbatim. A product the store
  does not recognise yields fewer tiers, never an error state.
- **Copy rules (App Store rejection-critical):** say "tip", "support the app", "buy the developer a coffee". **NEVER** "donate", "donation", "charity", "sadaqah", "zakat", "bağış", "تبرع" anywhere near the IAP flow or store metadata (Apple 3.2.2(iv)). Tips are to the developer (Apple 3.1.1 explicitly allows this). Guarded by `src/i18n/__tests__/tipCopy.test.ts` (D44).
- Post-tip: sincere thank-you moment; lifetime tip counter stored locally. **No Supporter badge and
  no non-consumable product** (D45): the supporter marker derives from the local ledger, and the UI
  says plainly that a tip cannot be restored on another phone.
- "This app has no ads and never will" displayed beside the tip jar.
- Never shown in the same session as a review prompt. One-time dismissible-forever card may appear after a genuine value moment (e.g. 30-day streak) — never before.
- Store product creation requires the owner's App Store Connect / Play Console — code + config ship first, products wired when credentials available.

## 14a. Hearing from people (D87)

The app has no account and no analytics, so it hears nothing unless someone tells us. Two ways out,
both links, neither of them anything the app sends:

- **"Send feedback"**, in Settings → Support **and** on the About screen — the two places people
  hunt for a way to reach a developer, duplicated on the same reasoning that already puts "Rate the
  app" on both. It is named for reporting *and* requesting, because one row has to be findable by
  someone with a complaint and someone with an idea. It goes to a public Featurebase board:
  **anyone can read it, and post to it, without an account.** The board is also where
  what-is-planned-next is posted.
- The same link on the website: on `/support` in all three languages, and in the **footer of every
  page**.
- **`hello@simpleprayer.app`**, on the website's `/support` page, the press kit and in the footer: the
  general inbox. **`privacy@simpleprayer.app`** is for privacy questions only, and is the address the
  privacy policy and the store listings name (D205).

It is hosted elsewhere on purpose, and both halves of that are enforced, not merely intended. The
site cannot host it — `docs/WEBSITE.md` forbids forms, cookies and third-party embeds, and the
generated CSP (`default-src 'none'; connect-src 'none'; form-action 'none'`) makes that a build
artefact rather than a promise. The app must not host it either: the pledge in Settings names
**exactly three** things that ever leave the phone, guarded by `privacyClaims.test.ts`, and a form
in the app would make it four — in the pledge, in the privacy policy, and in both stores'
data-safety answers. Opening a URL in the user's own browser adds none of that.

The row's copy ends **"No account needed"**, and that clause is load-bearing rather than
reassurance. The pledge two rows above it says "No account, no sign-in, no email address"; a board
that made people sign up to be heard would have read as that promise breaking the moment anyone
followed the link. Anonymous posting is what makes this destination allowable at all, so the copy
says so — and if it were ever switched off, that sentence is the first thing that would have to
change, in the app and on the website together.

## 15. Non-goals (v1)

- No Quran reader, no dua/dhikr library, no mosque finder, no social features, no leaderboards, no sharing of streaks (tracking is private *muraqaba*, not *riya* — deliberate, principled position).
- No accounts, no cloud sync, no analytics SDKs, no ads (ever).
- ~~No home/lock-screen widgets in v1~~ **Delivered post-v1 as Milestone W (D100–D104,
  2026-08-24):** Schedule + Now homescreen widgets on both platforms, iOS lockscreen accessories
  (times only, D101), StandBy, and the single-window Live Activity (D104). Widgets render a
  pushed, fully-resolved snapshot (D102) and their seal tap is a prayed toggle through the D92
  queue.
- ~~No watch apps in v1~~ ~~No Apple Watch/Wear OS~~ **Delivered post-v1 as Milestone V
  (D126–D129, 2026-08-28):** an Apple Watch app (Today hero + seal + qibla) with all four
  complication families and the Smart Stack; a Wear OS app, tile and complication data source;
  a Wear Watch Face Format face ("Manuscript", its own Play listing); and conditional
  watch-local adhan on Wear only (fires only with the phone away, D128). Everything renders the
  pushed envelope (D127 — the widget snapshot wrapped, never extended); every mark travels the
  D92 queue; seals are allowed on the wrist by D126, with D101 unchanged for phone lockscreens.
  Apple offers no third-party watch faces
  (watchOS 26 even broke face sharing) — on Apple the complications are the face story.
- No desktop.

## 16. Quality bars

- **Cold launch → times visible** is the headline performance metric (competitors take 20–90s due to ad SDKs; we target instant).
- 60fps animations (Reanimated, UI-thread); compass must feel immediate.
- All states never color-only (icon + word) — accessibility.
- Feature parity iOS/Android; Android notification reliability is a feature, not an afterthought.
- Domain core (streaks, stats, windows, qada math, hijri, qibla math, scheduling plan) has exhaustive unit tests incl. DST transitions, high latitudes, day-boundary edges, month boundaries.
