# Ramadan 2027: proposed scope

**Status: proposal. Nothing here is built.** The owner approves or changes this, then `feat/ramadan`
builds what is approved. Decision IDs from D195.

**Dates.** Ramadan 1448 starts around **8 Feb 2027**. The release must be in both stores by about
**1 Feb**, so the release cut is about **10 Jan 2027**.

**Principles that shape every item** (CLAUDE.md, "The why"): the prayer stays the main thing on
Today. Ramadan adds information; it adds no work. Nothing asks a non-logger to log. An unmarked
fast is never shown as missed, and nobody is asked why they did not fast (travel, illness,
menstruation and age all excuse it).

⚠ marks new stored data. The owner must approve each one before it is committed.

---

## The one rule: which day is "Ramadan"

A new pure helper in `src/domain/hijri.ts`:

```ts
isRamadan(day: PrayerDay, offsetDays: number): boolean // toHijri(day, offsetDays).month === 9
```

`services/review.ts` (`RAMADAN_MONTH`, `isRamadanEdgeDay`) moves onto it, so there is one
definition. It uses the Hijri date the app already shows, with the user's ±2 offset. So if the
local announcement differs, the user has one thing to fix: **Settings → Calculation → Hijri date**.
That fixes the header date and Ramadan together.

Prayer days run Fajr to Fajr. A fast also starts at Fajr, so **the fast of prayer day D is the
fast of D**. The night _before_ a fast belongs to the previous prayer day. That gives two
derived facts, with no new date logic:

- **Fasting today** = `isRamadan(D)`. This covers Fajr to Maghrib: the iftar countdown and the
  fast tick.
- **Fasting tomorrow** = `isRamadan(D + 1)`. This covers Maghrib to Fajr: the suhoor countdown and
  Taraweeh. It is true on the last evening of Sha'ban, when Taraweeh starts. It is false on the
  last evening of Ramadan, which is Eid eve.

---

## 1. Ramadan mode: on by itself, off by itself

- **What the user sees.** Nothing to turn on. On the evening before 1 Ramadan, the items below
  appear. After the last iftar, they go away. In Settings → Calculation, under the Hijri date, a
  row reads **Ramadan: Automatic / Off**. Off hides everything in this document.
- **Code.** `isRamadan` and its tests in `domain/hijri.ts`. A `ramadanActive(day, offset, mode)`
  selector next to it. The Settings row goes in `src/app/settings/calculation.tsx`.
- **Stored data.** ⚠ One MMKV setting: `ramadanMode: 'auto' | 'off'`. A missing key reads as
  `'auto'` (the `'x' in input` precedent, `settingsStore.ts:504`). No migration.
- **Effort:** S. **v1.**

## 2. Iftar and suhoor countdowns

- **What the user sees.** One extra line in the Today hero, under the prayer countdown. The prayer
  countdown does not change and stays first.
  - From Fajr to Maghrib on a fasting day: **"Iftar at 5:42 pm · in 2 hours 5 minutes"**.
  - From Maghrib until Fajr, when tomorrow is a fasting day: **"Suhoor ends at 5:12 am"**. When
    Isha is marked or its time has ended, the countdown also shows: "· in 6 hours 3 minutes".
  - The same line goes on the Now widgets (iOS small and medium, Android 2×2 and 4×1) and the
    watch app. Schedule widgets, lock-screen widgets and complications do not change in v1.
- **Code.** No new time calculations. Iftar is that day's Maghrib, and suhoor end is the next
  day's Fajr. Both are already in the timeline and the widget snapshot.
  - The hero line goes in `components/CountdownHero.tsx`. It reuses the existing countdown
    formatting.
  - `services/widgetSnapshot.ts` gets two **optional** additions:
    - `WidgetDay.fasting?: true`, set only on Ramadan days.
    - `WidgetStrings.iftar?` / `suhoorEnds?`, set only while Ramadan is on.
  - The snapshot stays at **version 1**. Older readers ignore unknown keys, so this is safe, the
    same as the optional `buddies` field. The watch envelope wraps the snapshot, so the watch gets
    the fields without a change.
  - The native renderers read the flag: `targets/widget`, `targets/watch`,
    `modules/prayer-widgets` (Kotlin) and `wear/`.
- **Stored data.** None. The snapshot is rebuilt from scratch every time and is not user data.
- **Effort:** M. Most of it is four native renderers plus the copy. **v1.**

## 3. Fast tick, one per day

- **What the user sees.** On fasting days, one small seal under the five prayers on Today:
  **"Fasted"**. One tap marks it, and one more tap clears it. It looks like the prayer seal and
  uses the same haptic. History's day view shows the same tick for Ramadan days.
  - An unmarked fast is shown as "not marked" in every tracking mode, including after Maghrib and
    on past days. It is **never shown as missed**.
  - On exempt days, the tick shows the existing "not required" state and cannot be tapped (D59).
  - **Tracking modes.** A fast has no "delayed" state, so the tick works the same way in both
    modes (done ↔ not marked). In detailed mode, a long-press could add "Did not fast". This
    document does not propose that (see question 2).
  - Fasts do not count toward prayer streaks, stats or qada.
- **Code.** A new `ramadan_logs` table in `src/db/schema.ts`, a migration, and queries in
  `db/queries.ts`. The table must also be added to `services/export.ts` (CSV and JSON). A small seal row on Today goes beside `PrayerRow`, and `DayDetail` gets the
  same row.
- **Stored data.** ⚠ **New SQLite table** `ramadan_logs`. This is the app's **second
  migration** (only `0000` exists today):

  | column                    | type              | note                                                              |
  | ------------------------- | ----------------- | ----------------------------------------------------------------- |
  | `id`                      | integer PK        |                                                                   |
  | `day`                     | text `YYYY-MM-DD` | prayer day                                                        |
  | `kind`                    | text              | `'fast'` \| `'taraweeh'`                                          |
  | `status`                  | text              | `'done'` only in v1. No row means not marked, as in `prayer_logs` |
  | `logged_at`, `updated_at` | integer           | epoch ms                                                          |
  |                           |                   | unique (`day`, `kind`)                                            |

  One table covers items 3 and 4, so Taraweeh needs no second migration later.

- **Effort:** M. **v1, if the table is approved.**

## 4. Taraweeh (optional)

- **What the user sees.** On nights before a fast, a "Taraweeh" seal sits next to Isha. It works
  like the fast tick: done ↔ not marked, never missed, and never counted in streaks or stats.
  Nothing appears if it is never tapped.
- **Code.** The same component as item 3, with `kind = 'taraweeh'`, on day D where
  `isRamadan(D + 1)`.
- **Stored data.** ⚠ Rows in the `ramadan_logs` table from item 3. No new table or column.
- **Effort:** S on top of item 3. **Owner's call: v1 or later** (question 3).

---

## Later (not in v1, could come after Ramadan 2027)

- A suhoor reminder (a set time before Fajr). It needs a new setting ⚠ and a change to
  `domain/notificationPlan.ts`.
- A Ramadan line in History's month view ("Fasted 18 days"). Only after feedback, because it can
  easily start to look like an audit.

## Not doing (non-goals)

- **Imsak offset settings** (for example "stop eating 10 minutes before Fajr"). Suhoor ends at the
  Fajr the app already calculates. Diyanet's imsak _is_ Fajr, and a second time to set is
  precision that helps no one.
- **Laylat al-Qadr features.** The night is not known for certain. Any "tonight is the night"
  feature would claim something we cannot know.
- **A fasting qada ledger** (counting fasts owed). It turns Ramadan into a debt list, and the
  rulings (fidya, illness, travel) are too varied for the app to decide. Never an audit.

## Proposed copy (English; Arabic and Turkish to be written, not translated)

Hero: "Iftar at {{time}} · in {{countdown}}" · "Suhoor ends at {{time}}". Seals: "Fasted",
"Taraweeh", plus the existing "not marked" and "not required". Settings: "Ramadan", "Automatic",
"Off". Settings caption: "During Ramadan, Today shows the times for iftar and suhoor. It uses the
Hijri date. If Ramadan starts on a different day where you live, change the Hijri date."
Use the words people already say: Turkish _iftar, imsak, sahur, teravih_; Arabic _الإفطار،
السحور، الإمساك، التراويح_. The Arabic and Turkish drafts are flagged for owner review.

---

## Open questions for the owner

1. **Approve the stored data?** One MMKV setting `ramadanMode` (item 1), and one new SQLite table
   `ramadan_logs` with migration `0001` (items 3 and 4).
2. **Fast and Taraweeh ticks are done ↔ not marked in both tracking modes, and never "missed".**
   Is that right, or should detailed mode also allow "Did not fast"?
3. **Taraweeh in v1 (10 Jan), or after Ramadan 2027?**
4. **Who sees the fast tick?** Everyone during Ramadan (quiet, and an unmarked tick never looks
   wrong), or only people who have marked a prayer in the last 30 days, so pure prayer-times users
   never see it?
5. **Widgets:** is the extra line on the Now widgets and the watch enough for v1? Or should the
   lock-screen widgets and complications show iftar time in place of the next prayer during the
   fasting hours?
