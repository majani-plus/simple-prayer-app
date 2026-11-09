# Changelog

All notable changes to Simple Prayer are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`scripts/bump-version.ts` maintains this file: it moves `[Unreleased]` into a dated release section
and opens a fresh `[Unreleased]`. Write entries under `[Unreleased]` as you go — in language a user
would recognise, not commit subjects.

## [Unreleased]

### Added

- **Open source:** the app's code is now open source under the MIT licence. The name
  "Simple Prayer" and its icon are not part of that licence (see `TRADEMARKS.md`).
- **Urdu:** the app, its widgets and watches, and the website now come in Urdu. In the app and on
  the website Urdu is set in Nastaliq; widgets and watches use Naskh, which fits their small
  spaces. The Urdu was written with AI help and has not yet been checked by a native speaker.
  Corrections are welcome.

### Changed

- **Asr follows your country.** The new default, Auto, uses the Hanafi Asr in Pakistan, India,
  Bangladesh and Afghanistan, and the majority Asr everywhere else. If you never changed the Asr
  setting, it is now Auto. If you chose Hanafi, nothing changes. You can still choose Shafi or
  Hanafi in Settings › Prayer times.

- **Marking prayers:** tapping seals one after another no longer stutters. The seals open and
  close faster, press in like a button and spring back, and a mark gives one crisp click instead
  of a soft buzz.
- **Now widget:** the quiet countdown to the next prayer (after you mark the current one, and
  after sunrise) now shows hours and minutes only. The countdown of time left to pray keeps its
  seconds.

### Fixed

- **Website:** the website build runs again (adhan 4.4.6).

## [1.6.0] - 2026-11-07

### Added

- **Two ways to mark prayers.** Simple: one tap marks a prayer as prayed, and a prayer you do not
  mark shows as missed once its time has passed. Detailed: prayed, prayed late or missed, as
  before. Choose during setup, or change it any time in Settings › Your prayer log. Changing it
  never changes the prayers you have already marked. In simple mode, a prayer marked late shows
  as prayed, and prayers shown as missed are counted on the making-up screen.

### Changed

- **Widget text no longer gets cut off.** The countdown and the prayer's name keep their size
  when the phone's text size is set very large, so they always fit. Smaller lines shrink a
  little instead of being cut.

- **The Now widget always counts toward something.** After sunrise it counts down to Dhuhr, or
  to Jumu'ah on Fridays. Once you mark a prayer, it keeps the word "Prayed" and counts down
  quietly to the next prayer. The countdown for the time left to pray stays bold, so the two
  never look the same.

- Expo libraries updated to their latest SDK 58 bug-fix releases.

- **Marking a prayer shows at once.** The seal changes the moment you tap it. The app saves it
  straight after. If saving fails, the seal goes back and the phone buzzes to tell you.

- The paper texture is back to its earlier strength in light and dark, and taking a mark back off a prayer gives a lighter tap than marking it (D193).

### Fixed

- **Buddy notifications on Android are easier to see.** They now show as a banner instead of
  being sorted away as unimportant. They are still silent.

- **The widget no longer counts below zero.** When a prayer's time ran out, the countdown could
  keep going into minus numbers instead of moving to the next prayer. The widget now updates
  when you turn the screen on, when you unlock the phone and when you open the app.

- **Today moves to the new day at Fajr** even when the phone holds back the app's timer. Before,
  a screen left open overnight could stay on yesterday until you left the app and came back.

- Buddies: your marks reach your buddy without having to reopen the app. A slow push-token request could stall buddy sync until the app was killed; it is now bounded, asked for once, and kept off the path a mark takes. On iOS, marking from a notification or the Live Activity now tells your buddies straight away, as it already did on Android (D194).

## [1.5.0] - 2026-10-29

### Added

### Changed

- **Tapping a prayer answers at once.** The seal opens the moment you tap it, marking a prayer
  shows straight away, and the day sheet in History slides up faster.
- **Built on Expo SDK 58.** Newer versions of everything the app is made from.

### Fixed

## [1.4.4] - 2026-10-10

### Added

### Changed

- **The one-row widget on Android is clearer.** The countdown is much bigger, the button to mark
  the prayer is bigger, and nothing else gets in the way. When there is nothing to mark, it shows
  today's five prayers instead.

### Fixed

## [1.4.3] - 2026-10-10

### Added

### Changed

- **The one-row widget looks better.** On Android the prayer's name now sits beside the mosque mark
  with its Arabic name under it, and the countdown, your buddies and the button sit together on
  their own raised card. On iOS the medium widget now uses its full height: a large countdown, a
  larger button, and today's five prayers at the top.
- **The paper texture behind the app is a little lighter.**

### Fixed

## [1.4.2] - 2026-09-17

### Added

- **The History tab is redesigned.** It opens on your streak, with this week's completion drawn
  as a ring beside it. The month now has its own bar under the calendar, saying in words how it
  went. Your record shows every number as a bar as well as a figure, and the per-prayer table is
  five bars with "6 of 7" beside each.
- **A one-row home screen widget.** The next prayer, the countdown and the mark button on a
  single row the full width of the screen, with your buddies' badges beside the button when they
  have prayed it. On Android it is its own widget, "Next prayer — one row"; on iOS it is the
  medium size of the "Next prayer" widget.

### Changed

### Fixed

- Switching months in the History calendar is no longer laggy.

## [1.4.1] - 2026-09-16

### Added

- A buddy's face is now their initials, taken from the name you gave them, and you can still pick
  a picture instead. It appears beside the prayer's name as a small badge, and under the countdown
  for the prayer you are in.
- Buddy badges on the large home screen widget, beside the mark button (D177).
- When you invite somebody, you are asked who they are first, and told when they accept.
- Settings → Buddies is its own section now, instead of the last row under the qada counter.
- Buddy notifications are one line and use the name you gave your buddy — "Amina prayed Dhuhr".
  The name is added by your own phone as the notification arrives. It is still never sent anywhere,
  and your buddy still never learns what you call them.
- **Inviting a buddy happens in one sheet.** Name them, share the code, and the moment they accept
  the code turns into "Amina is your buddy now" while you watch. Close it early and the invite
  stays in your list with the time it has left; tap it to open the code again, or cancel it.
- **"You have a new buddy"** appears whenever the app finds that somebody accepted — even if you
  open the app days later.
- Tap a buddy to change their nickname, icon or colour, or to remove them.
- **Marking a prayer from the home screen widget now tells your buddies straight away**, without
  opening the app.

### Changed

- Buddy badges are bigger everywhere: beside the prayer's name, under the countdown, in the list,
  and on the large widget.

- **Settings has been reorganised around what you came to do**, not around what the app is made of.
  Location now sits with Prayer times; the pledge has its own Privacy section; Tracking is called
  Your prayer log; and the excused-days switch has moved onto its own screen, so nothing about it
  is readable from the Settings list.
- The buddy sections say family as well as friends, which is what people are using it for.

### Fixed

- **The app no longer crashes when you switch between Arabic and English.** It was restarting
  while the screen was still being drawn.
- A buddy undoing a prayer now updates while you are watching, instead of waiting until you
  leave the app and come back.
- Changing your language now reaches your buddies straight away, so their notifications arrive
  in the right one.
- The person who sent an invite now sees it accepted within seconds, instead of on their next
  visit to the app.
- A buddy's mark now shows on the large widget as soon as it arrives.

## [1.4.0] - 2026-09-15

### Added

- **Prayer buddies.** You can pair with a few people — a partner, a sibling, a friend — and see
  on today's screen that they prayed, while they see the same about you. They never see a prayer
  you missed or one you have not marked yet, there is no history, no streak and no score, and
  either of you can end it at any time. It is off until you turn it on in Settings → Buddies, and
  nothing else in the app changes if you do not (D174).
- The marks are carried by a small relay of ours that deletes each one as soon as the other phone
  has it, holds no name, no location and no logs, and whose source code is public
  (`simple-prayer-relay`, D175).
- The Qibla screen says so when the phone's screen is facing the floor, where a compass drawn
  on the screen cannot be read the right way round (D172).

### Changed

- Apple Watch: the hijri date now sits just under the Today screen instead of in its top line,
  the prayer name and countdown are a little larger, and the layout scales to the watch size so
  the seal is whole on a 40mm (D173).

### Fixed

## [1.3.1] - 2026-09-15

### Added

### Changed

- Apple Watch: the qibla is one crown-turn up from the Today screen instead of a page after the
  whole schedule; the hint that names it now sits at the top of the hero (D171).

### Fixed

- Wear OS: the watch's background is black, and the Today screen keeps the prayer seal on the
  first screen at any font size — on a small watch or a large font the date line moves just under
  the seal instead of pushing it off the screen. This is the fix for Play's review of the watch
  app (D170).

## [1.3.0] - 2026-09-13

### Added

- The app tops up its reminders, widgets and watch data in the background, so they keep going when
  the app is not opened for days (D167).
- Reminder reliability: the battery card now reads whether battery saver is holding the app back
  and names the setting on Xiaomi phones; a new card explains background refresh on iOS (D166, D167).

### Changed

- Marking a prayer no longer vibrates when the touch was the start of a scroll; the three choices
  open as one short cross-fade instead of a staged animation (D157).
- Faster to open and to tap: fonts ship inside the app, the first background sync and the review
  prompt's first scan both wait for your first tap, a tap redraws one row instead of five, and the
  review prompt no longer re-renders the whole app on every log (D158, D159, D161).
- The compass reads the axis that stays level when the phone is held upright, and the needle asks
  for 120 Hz (D162).
- Reminders on iOS are time-sensitive, so a Focus mode or Scheduled Summary no longer holds them
  until later (D166).
- Wear OS: text meets the platform's minimum sizes, the tile follows the system font size, a scroll
  indicator, swipe to close, a proper launcher icon and a tile preview (D164).
- Android release builds are shrunk and obfuscated (D163).

### Fixed

- A prayer's reminder now clears itself when the next prayer starts on Android, and the tray sweep
  on open can no longer be skipped by a failed sync (D165).
- Reminders armed before "Alarms and reminders" was allowed stayed inexact even after it was
  granted; the app now rebuilds them (D166).
- On an iPad in landscape or upside down the compass was turned by the interface's rotation (D162).
- A native SQLite statement leaked on every database query (D160).
- Google Play no longer flags the Wear app's `androidx.fragment` as outdated (D163).
- Android: when the compass's gyro-fused heading has drifted after a long idle while the
  magnetometer still reports good accuracy, the app now notices (it cross-checks against the
  magnetometer-only heading) and offers the figure-8 calibration instead of showing a confident,
  wrong needle (D168).
- Android: when that drift is found with the phone lying flat, the needle and the "Turn N°" readout
  anchor to the raw compass heading instead of waiting for a figure-8, sliding onto the right
  heading within about a second (D169).
- Android tablets: turning the Qibla tab to landscape froze the needle (the two-pane layout never
  mounted the UI-thread needle source while the readout kept moving); both layouts mount it now.

## [1.2.2] - 2026-08-30

### Added

### Changed

### Fixed

## [1.2.1] - 2026-08-30

### Added

### Changed

### Fixed

- The Qibla compass now follows the phone in real time on Android. The needle is driven straight
  from the orientation sensor rather than through a delay, so it turns as you turn.
- The Qibla compass now turns smoothly on Android. The needle was being fed a new reading only
  about once a second, so it stepped instead of gliding; it now updates around fifty times a
  second, as it already did on iPhone. In landscape it also points the right way.

## [1.2.0] - 2026-08-29

### Added

### Changed

- The Arabic wording has been rewritten throughout. It now uses one word for each thing rather than
  three depending on the screen, speaks to everyone rather than assuming a man, and says only what
  the app actually knows — the make-up screen no longer tells you your obligation is discharged, it
  tells you the counter is at zero. The adhan section is headed "المؤذّن" instead of a word that
  means Qur'anic recitation.
- Arabic now has its own interface typeface. Body text, labels and settings are set in Noto Naskh
  Arabic, which reads clearly at small sizes and has four weights, so headings, labels and quiet
  captions look as different from each other as they do in English. The calligraphic prayer names,
  the Today headline and the watch face keep Amiri, which is unchanged.

### Fixed

- On a tablet, screens are properly centred. The readable column was the right width but sat
  against one side of the screen — noticeable on Arabic, where it sat against the right.
- In Arabic, the comma between a city and its region is the Arabic one — «الفاتح، اسطنبول» rather
  than a Latin comma dropped into the middle of an Arabic line.
- Setting up reminders no longer moves on as if reminders were on when the permission was refused.
  If you say no to the notification prompt, the app says so and offers to ask again (or to open
  your device settings); choosing "No reminders" continues as normal.
- Arabic text is no longer smaller than it should be. The size compensation the app applies to
  Arabic was calculated against the wrong measurement, so Arabic has been rendering about a fifth
  smaller than intended.
- Arabic counts now read as Arabic. Numbers between two and ten took the wrong word — "2 ساعة"
  instead of "ساعتين", "6 دقيقة" instead of "6 دقائق" — and a streak of 46 days read "46 يوم متتالٍ"
  instead of "46 يومًا متتاليًا". Every count in the app is affected: countdowns, streaks, qada
  totals, reminder timings and excused-day ranges.
- Arabic numerals now follow your region again. On iPhone, times and numbers were shown as 4:51 and
  46 everywhere, even for readers in Saudi Arabia, Egypt, Iraq, Jordan and the Gulf, who write
  ٤:٥١ and ٤٦. Readers in Morocco, Algeria, Tunisia, Libya and the UAE keep Western digits, as
  before.

## [1.1.0] - 2026-08-27

### Added

- **Apple Watch app.** Today's prayers on your wrist with the live countdown, the seal to mark
  the current prayer with one tap (tap again to undo), and the Qibla one crown-turn below. The
  watch keeps up to two weeks of times, so it stays right even when your phone is far; a mark
  made on the watch lands in the app the next time it opens.
- **Watch-face complications** (Apple Watch): the next prayer with a live countdown in every
  slot shape a face offers, plus the Smart Stack, which raises the card while a prayer's time
  is in.
- **Wear OS app, tile and complications.** The same Today and Qibla on Android watches, a tile
  one swipe from the face with the seal right on it, and complications for any watch face.
- **"Manuscript", our own Wear OS watch face:** warm gold on night paper, the Hijri date, the
  time in a serif hand, and the next prayer with a countdown that never goes stale. It ships as
  its own small app on Google Play, fed by Simple Prayer on your phone.
- **The watch can sound the adhan when your phone is away** (Wear OS): checked at that exact
  moment, so it never doubles up while the phone is near.
- **Tablet and foldable support.** The app now runs properly on an iPad, and turns with it: an
  iPad may be held in any orientation, and a big Android screen may be rotated (phones stay
  upright). Folding or unfolding a foldable, rotating, or sharing the screen with another app all
  rearrange the page as it happens.
- **A wider screen shows more, not bigger.** On a tablet in portrait the page keeps a comfortable
  reading width in the middle of the paper instead of stretching to the edges. In landscape each of
  Today, History and the Qibla opens into two pages side by side, divided by the same ◆ rule the
  app uses between sections:
  - **Today** keeps the prayers exactly where they are, and gains this month's calendar, a live
    Qibla compass and your record beside them.
  - **History** shows the day you tapped standing next to the month, rather than sliding up over it.
  - **The Qibla** gives the compass a larger dial, with the figures and guidance beside it.
- The home-screen widgets are now iPad-native, so they size themselves to an iPad's grid.

### Changed

- After pressing "I prayed" on a reminder, the confirmation now says what happened in a full
  sentence — "You marked Dhuhr as prayed" — and slips away by itself after fifteen seconds.
- The button on reminders now says "I prayed" — a personal acknowledgment instead of the
  shorthand "Prayed", in all three languages.
- Android: the home-screen widgets were redesigned to match iOS. The small widget now shows a
  live countdown to the end of the current prayer's time, and the week's rendering bugs are
  fixed: the current prayer's column no longer paints as a solid gold block, and the seal rings
  draw crisply instead of as filled blobs.
- Android: while a prayer's time is in, the always-on notification now switches to that prayer —
  with its "I prayed" button — even if the app has not been opened. Before, it could keep
  showing the next prayer without the button until the app was next opened.

- The widgets were redesigned from scratch on both platforms, in the app's own style: the
  prayer's name with the app's mark on top, the big live countdown framed by the app's ornament
  lines, the deadline underneath ("until 4:51 pm"), and the day's five seals at the foot.
- The current prayer's seal now sits right on the widget as a button: tap it to mark the prayer
  prayed — it fills gold, and the widget names the next prayer and its time. Tap again to undo.
- Android now has all three widgets, like iOS: the small one, the five-column day, and the full
  day as a list with the sunrise line ("Prayer times — the full day").
- The widget previews in Android's add-widget menu now look like the real widgets.
- iOS: the Lock Screen widget now leads with the countdown too, larger and bolder, instead of
  burying it under the prayer's name.
- Widgets in Arabic now mirror properly everywhere: Fajr starts from the right, and every row
  lays out right-to-left.
- A prayer whose time has not come can no longer be ticked from a widget, on either platform.
  Seals that a tap cannot change open the app instead.

### Fixed

- Widgets: the Hijri year is written plainly (1448, not 1,448).
- Widgets: switching the phone between light and dark now repaints the widgets when the app is
  opened (and immediately while it is open), instead of waiting for the next prayer.
- iOS: the widgets keep proper space around their content — text no longer touches the edges,
  on the home screen and the Lock Screen alike.
- iPad: the widgets no longer overflow and clip. They now display the same way the app itself
  does on iPad — uniformly scaled.
- iOS: the small widget fits the tightest screens — the prayer's name no longer cuts off, the
  countdown sits centered, and the five seals never touch the edges.
- iPad: the large widget no longer cuts off its first and last rows — the rows now breathe with
  the space they are given.

### Added

- The test notification now carries the Prayed button. Pressing it shows the whole flow — the
  notification clears and a short confirmation appears — and never saves anything.
- A second test button in Settings → Reminders sends the test with the adhan, so the recitation
  can be heard as a real notification before choosing it for a prayer.
- Android: while a prayer's time is in, the always-on notification carries the Prayed button too.
  Pressing it marks the prayer and the notification moves on to the next one, without opening the
  app.
- Android: a new "Pause what's playing" setting, off by default. When a prayer's time comes in,
  music or a podcast playing on the phone is paused — and not restarted. The reminder's own sound
  still plays.

### Changed

- Clearer words in Settings → Reminders: "adhan" now always means the sound. The notifications are
  named by their time — "Prayer-time reminders", "When the time comes in", "Before the time" — and
  everything about the adhan sound (recitation, preview, tests) sits together in its own group.

### Fixed

- The Prayed button now appears on reminders that were scheduled before the app was updated.
  Reminders already handed to the phone by an older version used to keep arriving without the
  button for up to five days.

## [1.0.0] - 2026-08-19

The first release.

### Added

- Today: today's prayer times, the current prayer highlighted with a live countdown, one-tap
  logging on the current prayer (tap the seal when you pray; a tap after the window closes records
  it as prayed late), a three-choice seal (prayed / late / missed) for past prayers, and a sunrise
  marker showing where Fajr's window ends. Everything is always re-editable.
- A short first-run setup that offers — never requires — location, theme, reminders, streak mode
  and qada, one decision per screen.
- On Fridays the midday prayer names itself "Jumu'ah · Dhuhr", which is true for everyone.
- An in-app adhan preview in Settings → Reminders, so the sound can be heard before it is chosen,
  and a note under the test button when the phone itself will stay quiet.
- History: a month calendar with a per-day progress circle, an editable day detail, streaks, a
  per-prayer breakdown and completion rates.
- Qibla: a smoothed compass with an accuracy reading, a calibration prompt and an aligned state.
- Qada: make-up tracking with a setup wizard, oldest-first tick-off, a projected debt-free date and
  a "start fresh" option that archives rather than deletes.
- Exemption mode, so days a person cannot pray are never counted as missed.
- Reminders per prayer, with optional pre-reminders, end-of-window nudges and a bundled adhan
  (CC0), plus a reminder-health screen for when the OS drops schedules.
- Automatic calculation method by country, with manual override, madhab, high-latitude rule and
  per-prayer minute offsets.
- English, Arabic and Turkish, each authored rather than machine-translated, with full RTL.
- Light and night-paper themes, following the system by default.
- Data export, and a tip jar for anyone who wants to support the work.
