/**
 * Streak engines — the two modes the user picks between in Settings
 * ("Relaxed" = soft, "Committed" = hard). PRODUCT_SPEC §5.
 *
 * This module owns exactly three things:
 *
 *  1. **Whether a single day counts** — `classifyDay` / `dayCounts` turn one `DayRecord`
 *     into a verdict under a `StreakMode`. Nothing else in the app may re-derive this.
 *  2. **How verdicts chain into streaks** — `computeStreak` produces the `StreakSummary`
 *     (current, all-time best, and the day each of them started on).
 *  3. **Which streak lengths are celebration-worthy** — `streakMilestone`, consumed by the
 *     review-prompt trigger (PRODUCT_SPEC §13) and by any future congratulation UI.
 *
 * ## The rules, exactly
 *
 * - **Soft:** the day counts when **at least one** of the five is `prayed` or `late`.
 * - **Hard:** the day counts only when **all five** are `prayed` or `late`.
 * - `missed` and `unlogged` never count toward a day. In hard mode either one breaks the day;
 *   in soft mode they are simply not contributions. `unlogged` is never treated as `missed`
 *   (PRODUCT_SPEC §4) — for streak purposes both merely fail to count.
 * - **Exempt days bridge.** A day the user marked exempt (menstruation / postnatal,
 *   PRODUCT_SPEC §6) neither increments a streak nor breaks it: the walk steps straight over
 *   it and the run continues on the far side. This holds in both modes, and holds even if
 *   prayers happen to be logged on that day — `DayRecord.isExempt` wins.
 * - **A day is judged only once it is CLOSED.** The prayer day closes at the next Fajr
 *   (PRODUCT_SPEC §3), so the still-open current day can never break a streak. It is allowed
 *   to *extend* one the moment it qualifies — the header streak is deliberately optimistic
 *   while today is open (PRODUCT_SPEC §5) — but an incomplete today is treated exactly like
 *   a bridge, not like a break.
 *
 * ## No shaming
 *
 * Nothing here reports a *lost* streak: there is no "broken" flag, no previous-streak length,
 * no last-broken day. A repaired log simply recomputes to a bigger number. Callers cannot
 * render "you broke your streak!" from this module's output, which is the point
 * (PRODUCT_SPEC §5, §7).
 *
 * ## Purity & determinism
 *
 * Pure TypeScript: no React, no React Native, no Expo, no adhan — and it never reads the
 * clock. "Today" is always passed in by the caller as a `PrayerDay`, which is what makes the
 * whole engine timezone-independent and trivially testable. All calendar arithmetic is
 * delegated to `dates.ts`, the only module allowed to own it (docs/ARCHITECTURE.md).
 *
 * ## Invalid input
 *
 * Malformed day strings throw `RangeError`, matching `dates.ts`. A silently-misplaced day
 * would corrupt the streak the user is emotionally invested in, so it fails loudly.
 */

import { addDays, compareDays, isValidDay } from './dates';
import {
  PRAYERS,
  type DayRecord,
  type PrayerDay,
  type PrayerStatus,
  type StreakMode,
  type StreakSummary,
} from './types';

// ---------------------------------------------------------------------------
// Local types (not in types.ts — narrow to this module)
// ---------------------------------------------------------------------------

/**
 * What one day does to a streak.
 *
 * `counts` increments it, `breaks` ends it, and `bridges` does neither — the run steps over
 * the day and continues. Bridging is what exempt days do, and what the still-open current
 * day does while it does not yet qualify.
 */
export type DayVerdict = 'counts' | 'bridges' | 'breaks';

/** Streak lengths worth celebrating, ascending. Consumed by {@link streakMilestone}. */
export const STREAK_MILESTONES = [3, 7, 30, 100, 365] as const;

/** One of the celebrated streak lengths. */
export type StreakMilestone = (typeof STREAK_MILESTONES)[number];

/** Options for {@link computeStreak}. */
export interface ComputeStreakOptions {
  /** Which engine to run — the user's Settings choice. */
  mode: StreakMode;
  /**
   * The prayer day the user is currently living in (from `dates.prayerDayForInstant`).
   * Days after it are ignored entirely, so a future-dated exemption cannot inflate a streak.
   */
  todayDay: PrayerDay;
  /**
   * Whether the still-open `todayDay` may extend the streak (default `true`).
   *
   * `true` — the optimistic value the Today header shows: today is added the moment it
   * qualifies, and is treated as a bridge (never a break) until then.
   * `false` — closed days only: the walk starts at the day before `todayDay`, which is the
   * last day that has actually closed at Fajr. Use it when a value must not move during the
   * day.
   */
  includeToday?: boolean;
}

// ---------------------------------------------------------------------------
// Single-day verdicts
// ---------------------------------------------------------------------------

/**
 * A `DayRecord` for a day with nothing logged at all — the meaning of a missing row
 * (docs/ARCHITECTURE.md "Data model": absence of a row = unlogged).
 *
 * Used to fill the gaps in a sparse `records` array, and safe to reuse anywhere a caller
 * needs the neutral starting state for a day.
 *
 * @param day - The prayer day to build the empty record for. Not validated here; callers
 *              that accept user/storage input should validate with `dates.isValidDay`.
 * @returns A fresh record with all five prayers `unlogged`, no made-up, not exempt.
 */
export function unloggedDayRecord(day: PrayerDay): DayRecord {
  return {
    day,
    statuses: {
      fajr: 'unlogged',
      dhuhr: 'unlogged',
      asr: 'unlogged',
      maghrib: 'unlogged',
      isha: 'unlogged',
    },
    madeUp: {},
    isExempt: false,
  };
}

/** Whether a status is a fulfilled prayer for streak purposes: `prayed` or `late`. */
function isFulfilled(status: PrayerStatus): boolean {
  switch (status) {
    case 'prayed':
    case 'late':
      return true;
    case 'unlogged':
    case 'missed':
    case 'exempt':
      return false;
    default: {
      const unreachable: never = status;
      throw new RangeError(`Unknown prayer status: ${String(unreachable)}`);
    }
  }
}

/**
 * Classify one day: does it increment the streak, break it, or bridge over it?
 *
 * Rules, in the order they are applied:
 *
 *  1. `record.isExempt` → never breaks, in either mode. It `counts` when at least one prayer was
 *     actually prayed or prayed late that day, and `bridges` otherwise (PRODUCT_SPEC §6). Being
 *     excused can only ever gain days, never cost one already earned.
 *  2. All five statuses `exempt` → `bridges` too, so a record whose exemption is expressed
 *     per-prayer rather than via the flag behaves identically.
 *  3. Otherwise, exempt prayers are excluded from the day's denominator (again §6 — exempt is
 *     never in a denominator), and the mode decides:
 *     - **soft:** `counts` when ≥1 of the five is `prayed`/`late`, else `breaks`.
 *     - **hard:** `counts` when *every non-exempt* prayer is `prayed`/`late`, else `breaks`.
 *       So a day with 4 exempt + 1 prayed counts in hard mode, while 4 exempt + 1 unlogged
 *       breaks it.
 *
 * @param record - The resolved day (statuses for all five prayers plus the exempt flag).
 * @param mode - `'soft'` (≥1 prayer) or `'hard'` (all five).
 * @returns `'counts'`, `'bridges'` or `'breaks'`.
 * @throws RangeError if a status or the mode is not a known value (defensive: these arrive
 *         from SQLite and from persisted settings).
 */
export function classifyDay(record: DayRecord, mode: StreakMode): DayVerdict {
  if (record.isExempt) {
    // An excused day on which she actually prayed still COUNTS; only one with nothing prayed
    // bridges. Menstruation begins at a moment, not at midnight, so a woman who prayed Fajr and
    // Dhuhr before it started genuinely prayed on that day — the seal keeps her gold mark (D64),
    // and the streak must agree with the seal.
    //
    // Bridging such a day made the streak visibly SHRINK the instant she marked herself excused
    // (2 → 1, caught in the visual gate). That is precisely the discouragement excused days exist
    // to prevent: telling her that being unable to pray cost her a day she had already earned.
    // Marking yourself excused can only ever gain you days, never lose one.
    //
    // Deliberately the soft rule in BOTH modes: requiring all five on a day she was excused from
    // praying at all would be perverse, and the day would bridge harmlessly anyway.
    return PRAYERS.some((prayer) => isFulfilled(record.statuses?.[prayer] ?? 'unlogged'))
      ? 'counts'
      : 'bridges';
  }

  let fulfilled = 0;
  let exempt = 0;
  for (const prayer of PRAYERS) {
    const status: PrayerStatus = record.statuses?.[prayer] ?? 'unlogged';
    if (status === 'exempt') exempt += 1;
    else if (isFulfilled(status)) fulfilled += 1;
  }

  if (exempt === PRAYERS.length) return 'bridges';

  switch (mode) {
    case 'soft':
      return fulfilled >= 1 ? 'counts' : 'breaks';
    case 'hard':
      return fulfilled + exempt === PRAYERS.length ? 'counts' : 'breaks';
    default: {
      const unreachable: never = mode;
      throw new RangeError(`Unknown streak mode: ${String(unreachable)}`);
    }
  }
}

/**
 * Whether a day increments the streak under `mode`.
 *
 * Soft: at least one of the five is `prayed` or `late`. Hard: all five are (exempt prayers
 * excluded from the requirement). See {@link classifyDay} for the full rule set.
 *
 * **An exempt day returns `false`** — it bridges rather than counts, and `false` here means
 * only "does not increment", never "breaks". Use {@link classifyDay} when the difference
 * matters; a caller that treats this `false` as a break will wrongly cut exempt users' streaks.
 *
 * @param record - The resolved day.
 * @param mode - The active streak mode.
 * @returns `true` only when the day adds 1 to a streak.
 * @throws RangeError on an unknown status or mode.
 */
export function dayCounts(record: DayRecord, mode: StreakMode): boolean {
  return classifyDay(record, mode) === 'counts';
}

// ---------------------------------------------------------------------------
// Streak computation
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY = (mode: StreakMode): StreakSummary => ({
  mode,
  current: 0,
  best: 0,
  currentStartedOn: null,
  bestStartedOn: null,
});

/**
 * Compute the current and all-time-best streak from a set of day records.
 *
 * ### Input
 *
 * `records` may be **unsorted** and **sparse**: any day between the earliest record and the
 * end of the walk that has no record is treated as fully unlogged (which counts in neither
 * mode, i.e. it breaks the streak). Records for days after `todayDay` are ignored, so an
 * exemption entered "until" a future date cannot extend today's streak. If the same day
 * appears twice, the last occurrence wins.
 *
 * ### The walk
 *
 * The scan runs over `[earliest record … lastDay]`, where `lastDay` is `todayDay` when
 * `includeToday` is `true` (the default) and the day before it otherwise. Each day is
 * classified with {@link classifyDay}, with one override: **`todayDay` never breaks**. While
 * the day is still open (it closes at the next Fajr, PRODUCT_SPEC §3) a `breaks` verdict on
 * it is downgraded to `bridges`, so an incomplete today leaves the streak intact while a
 * completed today extends it immediately.
 *
 * `current` is the run alive at `lastDay`; `best` is the longest run anywhere in the scanned
 * range. `best` is therefore always ≥ `current`. Bridging days extend neither number but keep
 * a run alive across themselves; the reported start days are the first *counting* day of the
 * run, never a bridging day that precedes it. History before the earliest record is unknown,
 * not broken — a run that reaches the earliest record simply stops there.
 *
 * Ties for `best` keep the **earliest** run that reached that length.
 *
 * @param records - Resolved day records, any order, gaps allowed.
 * @param opts - `mode`, `todayDay`, and optional `includeToday` (default `true`).
 * @returns A {@link StreakSummary} — `current`, `best`, and the day each started on (`null`
 *          when the corresponding length is 0). Never reports anything about a lost streak.
 * @throws RangeError if `todayDay` or any `record.day` is not a real `YYYY-MM-DD` date, if a
 *         record is nullish, or if a status/mode is unknown.
 */
export function computeStreak(records: DayRecord[], opts: ComputeStreakOptions): StreakSummary {
  const { mode, todayDay } = opts;
  const includeToday = opts.includeToday ?? true;

  if (!isValidDay(todayDay)) {
    throw new RangeError(`computeStreak: todayDay must be a YYYY-MM-DD date, got ${String(todayDay)}`);
  }

  const byDay = new Map<PrayerDay, DayRecord>();
  for (const record of records) {
    if (record === null || record === undefined) {
      throw new RangeError('computeStreak: records must not contain null or undefined');
    }
    if (!isValidDay(record.day)) {
      throw new RangeError(
        `computeStreak: record.day must be a YYYY-MM-DD date, got ${String(record.day)}`
      );
    }
    byDay.set(record.day, record); // later entries win over earlier duplicates
  }

  // The last day the walk may reach: today when we are optimistic about the open day,
  // otherwise the most recent day that has actually closed at Fajr.
  const lastDay = includeToday ? todayDay : addDays(todayDay, -1);

  // Earliest day we know anything about, ignoring future-dated records.
  let firstDay: PrayerDay | null = null;
  for (const day of byDay.keys()) {
    if (compareDays(day, lastDay) > 0) continue;
    if (firstDay === null || compareDays(day, firstDay) < 0) firstDay = day;
  }
  if (firstDay === null) return EMPTY_SUMMARY(mode);

  let best = 0;
  let bestStartedOn: PrayerDay | null = null;
  let run = 0;
  let runStartedOn: PrayerDay | null = null;

  for (let day: PrayerDay = firstDay; compareDays(day, lastDay) <= 0; day = addDays(day, 1)) {
    const record = byDay.get(day) ?? unloggedDayRecord(day);
    let verdict = classifyDay(record, mode);

    // The open day is not judged yet: it may extend a streak, never end one.
    if (verdict === 'breaks' && day === todayDay) verdict = 'bridges';

    switch (verdict) {
      case 'counts':
        run += 1;
        if (runStartedOn === null) runStartedOn = day;
        if (run > best) {
          best = run;
          bestStartedOn = runStartedOn;
        }
        break;
      case 'bridges':
        break;
      case 'breaks':
        run = 0;
        runStartedOn = null;
        break;
      default: {
        const unreachable: never = verdict;
        throw new RangeError(`Unknown day verdict: ${String(unreachable)}`);
      }
    }
  }

  return {
    mode,
    current: run,
    best,
    currentStartedOn: run > 0 ? runStartedOn : null,
    bestStartedOn: best > 0 ? bestStartedOn : null,
  };
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/**
 * The milestone a streak has *just* reached, or `null`.
 *
 * Exact equality only: 7 → `7`, but 8 → `null`. The caller is expected to invoke this once
 * per streak change, so a milestone fires on the day it is hit and never again — which is
 * what makes it usable as the review-prompt trigger (PRODUCT_SPEC §13: "completing a 7-day
 * streak", "completing a 30-day streak"). It says nothing about whether prompting is
 * *appropriate*; the exclusion and throttling rules live in `config/reviewTriggers.ts`.
 *
 * @param current - A current streak length. Non-integers, negatives and non-finite values
 *                  return `null` rather than throwing — a milestone check must never be able
 *                  to crash the Today screen.
 * @returns The matched milestone (3, 7, 30, 100 or 365), or `null`.
 */
export function streakMilestone(current: number): StreakMilestone | null {
  if (!Number.isInteger(current)) return null;
  return STREAK_MILESTONES.find((milestone) => milestone === current) ?? null;
}
