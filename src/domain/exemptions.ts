/**
 * Exempt days — menstruation and postnatal (PRODUCT_SPEC §6).
 *
 * This module owns every question of the form "is this day exempt?" and every pure
 * transformation of the stored `ExemptPeriod` list. Nothing else may reimplement range
 * containment: streaks, stats, qada and the notification plan all ask here.
 *
 * ## Why this module is load-bearing
 *
 * An exempt day is **never missed, never nudged, never in a stats denominator, and it
 * bridges streaks** (continues them without incrementing). Rendering an exempt day as
 * "missed" is the single sharpest guilt trigger reported in our market research, so
 * the containment rules below are deliberately simple, inclusive and hard to get wrong.
 *
 * ## The data
 *
 * A period is a closed `[startDay, endDay]` range of prayer days, **both ends inclusive**,
 * or an open-ended `[startDay, ∞)` range when `endDay` is `null` ("exempt from today", not
 * yet ended). Days are `YYYY-MM-DD` local calendar labels; all arithmetic is delegated to
 * `dates.ts`, so nothing here depends on the device timezone or on DST.
 *
 * Nothing else is stored. There is no cycle prediction, no health data, no derived
 * physiology — only the ranges the user typed (PRODUCT_SPEC §6).
 *
 * ## Semantics chosen here (and why)
 *
 * 1. **Union semantics.** The exempt set is the union of all periods. `normalizePeriods`
 *    returns that union as the minimal list of maximal ranges: overlapping *and* adjacent
 *    ranges merge (`…-05` + `…-06` is one period, not two), inverted ranges (`endDay`
 *    before `startDay`) are dropped as corrupt.
 * 2. **At most one open-ended period survives normalization, and it is always the last
 *    element.** An open range covers everything from its start onward, so it necessarily
 *    swallows every period that starts on or after it; two open ranges can never coexist.
 * 3. **Starting a period while one is already open never creates a second open period.**
 *    It widens the existing one to `min(existingStart, day)` — see {@link startPeriod} for
 *    the full rationale. Coverage is monotone: `startPeriod` never *removes* an exempt day.
 * 4. **Ending a period before it started cancels it.** `endPeriod` writes the end day and
 *    re-normalizes, and normalization drops inverted ranges — see {@link endPeriod}.
 *
 * ## Failure mode
 *
 * Malformed input (a day string that is not a real `YYYY-MM-DD` date, a non-finite
 * timestamp, a non-object period) throws `RangeError`, exactly as `dates.ts` does.
 * Silently ignoring a corrupt period would make a genuinely exempt day render as missed,
 * which is the one outcome this feature exists to prevent — failing loudly is safer.
 * The one tolerated inconsistency is an inverted range, which is *dropped* everywhere
 * (it describes no days at all) rather than throwing.
 *
 * Pure TypeScript: no React, no React Native, no Expo, no `Date` construction at all.
 */

import { compareDays, daysBetween, diffDays, isValidDay } from './dates';
import type { ExemptPeriod, PrayerDay } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Mean length of a Gregorian month in days (365.2425 / 12), used to express an observed
 * exempt-day count as a per-month rate without snapping to calendar-month boundaries.
 */
export const AVERAGE_DAYS_PER_MONTH = 30.436875;

/**
 * Shortest observation window {@link averageExemptDaysPerMonth} will extrapolate from.
 * Below roughly one cycle the sample says nothing useful — five exempt days inside a
 * ten-day window would extrapolate to an absurd 15/month and would badly distort the qada
 * estimate — so the function returns `null` and the caller keeps its configured default.
 */
export const MIN_AVERAGE_WINDOW_DAYS = 28;

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object' && value !== null) return Object.prototype.toString.call(value);
  return String(value);
}

/** Validates a `YYYY-MM-DD` prayer day, throwing with the argument's name on failure. */
function assertDay(value: unknown, argumentName: string): PrayerDay {
  if (!isValidDay(value)) {
    throw new RangeError(
      `${argumentName} must be a YYYY-MM-DD calendar date, received ${describeValue(value)}`
    );
  }
  return value;
}

/** Validates an epoch-milliseconds timestamp. */
function assertTimestamp(value: unknown, argumentName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(
      `${argumentName} must be a finite epoch-milliseconds number, received ${describeValue(value)}`
    );
  }
  return value;
}

/** Validates one stored period. `endDay` must be `null` or a real day — never `undefined`. */
function assertPeriod(period: ExemptPeriod, index: number): ExemptPeriod {
  if (typeof period !== 'object' || period === null) {
    throw new RangeError(
      `periods[${index}] must be an ExemptPeriod object, received ${describeValue(period)}`
    );
  }
  assertDay(period.startDay, `periods[${index}].startDay`);
  if (period.endDay !== null) {
    assertDay(period.endDay, `periods[${index}].endDay`);
  }
  assertTimestamp(period.createdAt, `periods[${index}].createdAt`);
  return period;
}

/** Validates the whole list (and that it is a list at all). */
function assertPeriods(periods: ExemptPeriod[]): ExemptPeriod[] {
  if (!Array.isArray(periods)) {
    throw new RangeError(`periods must be an array, received ${describeValue(periods)}`);
  }
  periods.forEach(assertPeriod);
  return periods;
}

/** `false` for an inverted (corrupt) range, which describes no days and is dropped. */
function isChronological(period: ExemptPeriod): boolean {
  return period.endDay === null || compareDays(period.startDay, period.endDay) <= 0;
}

/** Sorts by start day, then closed-before-open, then by end day, then by creation time. */
function comparePeriods(a: ExemptPeriod, b: ExemptPeriod): number {
  const byStart = compareDays(a.startDay, b.startDay);
  if (byStart !== 0) return byStart;
  if (a.endDay === null && b.endDay !== null) return 1;
  if (a.endDay !== null && b.endDay === null) return -1;
  if (a.endDay !== null && b.endDay !== null) {
    const byEnd = compareDays(a.endDay, b.endDay);
    if (byEnd !== 0) return byEnd;
  }
  return a.createdAt - b.createdAt;
}

/**
 * Intersects a period with `[fromDay, toDay]`, clipping an open end at `toDay`.
 * Returns `null` when the period contributes no day to the range.
 */
function clipToRange(
  period: ExemptPeriod,
  fromDay: PrayerDay,
  toDay: PrayerDay
): { start: PrayerDay; end: PrayerDay } | null {
  const start = compareDays(period.startDay, fromDay) >= 0 ? period.startDay : fromDay;
  const periodEnd = period.endDay === null ? toDay : period.endDay;
  const end = compareDays(periodEnd, toDay) <= 0 ? periodEnd : toDay;
  if (compareDays(start, end) > 0) return null;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

/**
 * Whether a prayer day falls inside any exempt period.
 *
 * Both ends are **inclusive**: a period `2026-03-04 … 2026-03-08` covers the 4th and the
 * 8th. An open-ended period (`endDay === null`) covers `startDay` and every day after it,
 * forever — the user has not told us when it ended, and guessing an end would eventually
 * render a genuinely exempt day as missed.
 *
 * The input does not need to be sorted, merged or otherwise normalized; overlapping
 * periods are harmless. Inverted (corrupt) periods cover nothing.
 *
 * @param day - The prayer day under test (`YYYY-MM-DD`).
 * @param periods - Stored exempt periods, in any order. `[]` means "nothing is exempt".
 * @returns `true` when the day must be treated as exempt: never missed, never nudged,
 *          excluded from stats denominators, and a bridge for streaks.
 * @throws RangeError if `day`, or any period's days/timestamp, is malformed.
 */
export function isDayExempt(day: PrayerDay, periods: ExemptPeriod[]): boolean {
  const target = assertDay(day, 'day');
  assertPeriods(periods);
  return periods.some((period) => {
    if (!isChronological(period)) return false;
    if (compareDays(period.startDay, target) > 0) return false;
    return period.endDay === null || compareDays(target, period.endDay) <= 0;
  });
}

/**
 * The single ongoing period, if the user is currently marked exempt with no end date.
 *
 * After normalization at most one open-ended period can exist (an open range swallows
 * everything starting after it), so this is unambiguous. The UI uses it to decide between
 * offering "exempt from …" and "exempt until …".
 *
 * @param periods - Stored exempt periods, in any order.
 * @returns The normalized open-ended period, or `null` when nothing is ongoing.
 * @throws RangeError if any period is malformed.
 */
export function findOpenPeriod(periods: ExemptPeriod[]): ExemptPeriod | null {
  const normalized = normalizePeriods(periods);
  const last = normalized[normalized.length - 1];
  return last !== undefined && last.endDay === null ? last : null;
}

/**
 * The period the user is exempt under **right now** — open-ended, or closed with an end date
 * still to come.
 *
 * This is the question every "are they currently excused?" surface actually has, and it is not
 * {@link findOpenPeriod}: since a period may be begun *with* an end date ("excused for three
 * days"), being currently exempt no longer implies being open-ended. A planned period is ongoing
 * until its last day is past, and then it simply stops being ongoing — which is the whole
 * mechanism behind an exemption that ends by itself, with nothing scheduled and nothing to
 * remember.
 *
 * Normalization merges overlapping and adjacent ranges, so at most one period can contain `today`
 * and the answer is unambiguous. A period that has not started yet is not ongoing.
 *
 * @param periods - Stored exempt periods, in any order.
 * @param today - The current prayer day (`YYYY-MM-DD`).
 * @returns The normalized period covering `today`, or `null` when the user is not exempt today.
 * @throws RangeError if `today`, or any period, is malformed.
 */
export function findOngoingPeriod(
  periods: ExemptPeriod[],
  today: PrayerDay
): ExemptPeriod | null {
  const target = assertDay(today, 'today');
  const ongoing = normalizePeriods(periods).find((period) => coversDay(period, target));
  return ongoing ?? null;
}

/** Whether a normalized period contains `day`; both ends inclusive, `null` end meaning forever. */
function coversDay(period: ExemptPeriod, day: PrayerDay): boolean {
  if (compareDays(period.startDay, day) > 0) return false;
  return period.endDay === null || compareDays(day, period.endDay) <= 0;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Canonical form of a period list: the union of all covered days, expressed as the
 * minimal list of maximal ranges, ascending by start day.
 *
 * Rules:
 * - **Overlapping ranges merge**, and so do **adjacent** ones — a period ending `2026-03-05`
 *   and one starting `2026-03-06` describe one uninterrupted stretch of exempt days and
 *   come back as a single period.
 * - **Inverted ranges are dropped** (`endDay` before `startDay`): they describe no day.
 * - **At most one open-ended period survives, and it is always the last element.** Every
 *   period starting on or after an open range's start is inside it, so two open ranges
 *   always collapse into one covering `[earliest open start, ∞)`. (The alternative —
 *   discarding the earlier open range — would silently un-exempt days the user marked, so
 *   union wins; `startPeriod` prevents the state from arising in the first place.)
 * - Idempotent: normalizing an already-normalized list returns an equal list.
 *
 * Identity of a merged period: it keeps the `id` of the earliest-starting contributor and
 * the **smallest** `createdAt` of all contributors (the moment the user first recorded any
 * part of that stretch). The store is responsible for reconciling rows — typically update
 * the surviving id and delete the rows that merged into it.
 *
 * The input array and its objects are never mutated.
 *
 * @param periods - Stored exempt periods, in any order, possibly overlapping or corrupt.
 * @returns A fresh, sorted, merged list of periods.
 * @throws RangeError if any period is malformed.
 */
export function normalizePeriods(periods: ExemptPeriod[]): ExemptPeriod[] {
  assertPeriods(periods);
  const sorted = periods.filter(isChronological).sort(comparePeriods);

  const merged: ExemptPeriod[] = [];
  for (const period of sorted) {
    const current = merged[merged.length - 1];
    if (current === undefined) {
      merged.push({ ...period });
      continue;
    }

    const currentEnd = current.endDay;
    if (currentEnd === null) {
      // `sorted` is ascending by start day, so this period starts inside the open range
      // and adds no new day — only possibly an earlier record of when it began.
      current.createdAt = Math.min(current.createdAt, period.createdAt);
      continue;
    }

    // Overlapping (diff <= 0) or adjacent (diff === 1) — one uninterrupted stretch.
    if (diffDays(currentEnd, period.startDay) <= 1) {
      current.endDay =
        period.endDay === null || compareDays(period.endDay, currentEnd) > 0
          ? period.endDay
          : currentEnd;
      current.createdAt = Math.min(current.createdAt, period.createdAt);
      continue;
    }

    merged.push({ ...period });
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Range queries
// ---------------------------------------------------------------------------

/**
 * Every exempt day inside `[fromDay, toDay]`, both ends inclusive.
 *
 * An open-ended period is clipped at `toDay`, so the result is always finite. Days covered
 * by several overlapping periods appear once. Iteration order is ascending, which lets a
 * caller stream a calendar month straight out of the set.
 *
 * An empty or inverted range (`fromDay` after `toDay`) yields an empty set — that is a
 * legitimate query (an empty stats window), not an error.
 *
 * @param periods - Stored exempt periods, in any order.
 * @param fromDay - First day of the query range (`YYYY-MM-DD`), included.
 * @param toDay - Last day of the query range (`YYYY-MM-DD`), included.
 * @returns Set of exempt `YYYY-MM-DD` days within the range, in ascending order.
 * @throws RangeError if either bound, or any period, is malformed.
 */
export function expandExemptDays(
  periods: ExemptPeriod[],
  fromDay: PrayerDay,
  toDay: PrayerDay
): Set<PrayerDay> {
  const from = assertDay(fromDay, 'fromDay');
  const to = assertDay(toDay, 'toDay');
  const days = new Set<PrayerDay>();
  if (compareDays(from, to) > 0) return days;

  for (const period of normalizePeriods(periods)) {
    const clipped = clipToRange(period, from, to);
    if (clipped === null) continue;
    for (const day of daysBetween(clipped.start, clipped.end)) {
      days.add(day);
    }
  }
  return days;
}

/**
 * How many days inside `[fromDay, toDay]` are exempt — always equal to
 * `expandExemptDays(periods, fromDay, toDay).size`, but computed per period instead of per
 * day, so a multi-year qada window costs nothing.
 *
 * Overlapping periods count a day once; an open-ended period counts only up to `toDay`;
 * an inverted range returns `0`.
 *
 * @param periods - Stored exempt periods, in any order.
 * @param fromDay - First day of the range (`YYYY-MM-DD`), included.
 * @param toDay - Last day of the range (`YYYY-MM-DD`), included.
 * @returns Count of exempt days in the range, `0` when there are none.
 * @throws RangeError if either bound, or any period, is malformed.
 */
export function countExemptDaysInRange(
  periods: ExemptPeriod[],
  fromDay: PrayerDay,
  toDay: PrayerDay
): number {
  const from = assertDay(fromDay, 'fromDay');
  const to = assertDay(toDay, 'toDay');
  if (compareDays(from, to) > 0) return 0;

  let count = 0;
  // Normalized periods are disjoint and non-adjacent, so their clipped lengths simply add.
  for (const period of normalizePeriods(periods)) {
    const clipped = clipToRange(period, from, to);
    if (clipped === null) continue;
    count += diffDays(clipped.start, clipped.end) + 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Transformations the store persists
// ---------------------------------------------------------------------------

/**
 * Marks the user exempt **from `day` onward**, with no end date yet.
 *
 * Behaviour when a period is already open — the case worth being explicit about:
 * the result still contains exactly **one** open-ended period, widened to start at
 * `min(existingStart, day)`.
 * - Starting on a day the open period already covers is therefore a no-op on coverage
 *   (the call is idempotent).
 * - Starting *earlier* than the open period reads as the user correcting the start date,
 *   and the range extends backwards.
 * - Two open periods are never produced, so `findOpenPeriod` stays unambiguous.
 *
 * The alternative — closing the stale period the day before and opening a new one — was
 * rejected because it yields exactly the same set of exempt days (the two ranges would be
 * adjacent, and adjacent ranges merge) while adding a fictional end date the user never
 * entered. Truncating a forgotten period to a "typical" length was rejected outright: this
 * app never guesses about the user's body.
 *
 * Starting inside or adjacent to an already-closed period re-opens that stretch: the merged
 * range keeps the earlier start and becomes open-ended, because the user has just said the
 * exemption is ongoing.
 *
 * @param periods - Current stored periods, in any order. Not mutated.
 * @param day - First exempt day (`YYYY-MM-DD`), inclusive.
 * @param now - Epoch milliseconds recorded as `createdAt` of the new period (a merge keeps
 *              the earlier contributor's timestamp instead).
 * @returns A fresh normalized list to persist; the store diffs it against its rows.
 * @throws RangeError if `day`, `now`, or any existing period is malformed.
 */
export function startPeriod(periods: ExemptPeriod[], day: PrayerDay, now: number): ExemptPeriod[] {
  const startDay = assertDay(day, 'day');
  const createdAt = assertTimestamp(now, 'now');
  assertPeriods(periods);
  return normalizePeriods([...periods, { startDay, endDay: null, createdAt }]);
}

/**
 * Ends the ongoing exemption, making `day` the **last exempt day** (inclusive).
 *
 * - With an open period present, its `endDay` becomes `day` and the list is re-normalized,
 *   so the now-closed range can merge with an adjacent neighbour.
 * - `day` equal to the open period's start produces a legitimate single-day period.
 * - `day` **before** the open period's start cancels that period: the inverted range covers
 *   no day and normalization drops it. The UI should not offer such a date; the domain
 *   treats it as "this exemption never happened" rather than throwing at the store.
 * - With **no** open period the call is a no-op returning the normalized list — there is
 *   nothing ongoing to end. Editing the end date of an already-closed period is a different
 *   operation (a row edit) and deliberately does not live here.
 * - **Only the ongoing period is ended.** Already-closed records are re-applied afterwards,
 *   so days the user had explicitly recorded as exempt are never retracted by ending a
 *   (possibly backdated) open period that happened to overlap them.
 *
 * @param periods - Current stored periods, in any order. Not mutated.
 * @param day - Last exempt day (`YYYY-MM-DD`), inclusive.
 * @param now - Epoch milliseconds of the action. Validated for symmetry with
 *              {@link startPeriod}; nothing is written with it, because closing a period
 *              creates no record and `ExemptPeriod` carries only its original `createdAt`.
 * @returns A fresh normalized list to persist.
 * @throws RangeError if `day`, `now`, or any existing period is malformed.
 */
export function endPeriod(periods: ExemptPeriod[], day: PrayerDay, now: number): ExemptPeriod[] {
  const endDay = assertDay(day, 'day');
  assertTimestamp(now, 'now');
  const open = findOpenPeriod(periods);
  if (open === null) return normalizePeriods(periods);
  const alreadyClosed = periods.filter((period) => period.endDay !== null);
  return normalizePeriods([...alreadyClosed, { ...open, endDay }]);
}

/**
 * Ends the **ongoing** exemption — open-ended or planned — making `day` the last exempt day.
 *
 * {@link endPeriod} can only end an open-ended period, which stopped being the whole story once a
 * period could be begun with an end date: "end it now" must also be able to cut a planned period
 * short, and the switch in Settings must be able to cancel one. So this is the operation the store
 * uses, and it degenerates to `endPeriod` exactly when the ongoing period is open-ended.
 *
 * - The ongoing period's `endDay` becomes `day`, and the list is re-normalized so the now-shorter
 *   range can merge with an adjacent neighbour.
 * - `day` **before** the ongoing period's start cancels it: the inverted range covers no day and
 *   normalization drops it. The UI does not offer such a date; the domain treats it as "this
 *   exemption never happened" rather than throwing at the store.
 * - With **nothing** ongoing the call is a normalized no-op.
 * - **Only the ongoing stretch is rewritten.** Records that neither run open nor reach `today` are
 *   history the user explicitly recorded, and are re-applied untouched — ending an exemption never
 *   retracts a past one, exactly as in {@link endPeriod}, whose note on this applies here too.
 *
 * @param periods - Current stored periods, in any order. Not mutated.
 * @param day - Last exempt day (`YYYY-MM-DD`), inclusive. The UI only ever offers `today` or
 *              earlier, so this shortens; passing a later day would legitimately lengthen.
 * @param today - The current prayer day, which decides which period counts as ongoing.
 * @param now - Epoch milliseconds of the action. Validated for symmetry with {@link startPeriod};
 *              nothing is written with it, because ending a period creates no record.
 * @returns A fresh normalized list to persist.
 * @throws RangeError if `day`, `today`, `now`, or any existing period is malformed.
 */
export function trimOngoingPeriod(
  periods: ExemptPeriod[],
  day: PrayerDay,
  today: PrayerDay,
  now: number
): ExemptPeriod[] {
  const endDay = assertDay(day, 'day');
  const target = assertDay(today, 'today');
  assertTimestamp(now, 'now');
  const ongoing = findOngoingPeriod(periods, target);
  if (ongoing === null) return normalizePeriods(periods);
  // Everything that still asserts "exempt today" is replaced by the one trimmed range; the rest is
  // untouched history. A raw record that merged into the ongoing stretch but ends before today is
  // therefore kept, which is deliberate and matches `endPeriod`: a day the user recorded as exempt
  // in its own right is not retracted by ending what came after it.
  const untouched = periods.filter((period) => !coversDay(period, target));
  return normalizePeriods([...untouched, { ...ongoing, endDay }]);
}

// ---------------------------------------------------------------------------
// Qada estimator input
// ---------------------------------------------------------------------------

/**
 * Observed average exempt days per month over `[fromDay, toDay]`, feeding the qada
 * backtracking estimator (PRODUCT_SPEC §7) so an estimate of missed prayers is reduced by
 * the days on which no prayer was owed.
 *
 * Computed as `exemptDaysInRange / (windowDays / 30.436875)` — a mean Gregorian month, so a
 * window that does not align to calendar months is still measured fairly. The value is
 * returned unrounded; callers format it.
 *
 * Returns `null` — meaning "no usable observation, keep your configured default (7)" —
 * when:
 * - `fromDay` is after `toDay`;
 * - the window is shorter than {@link MIN_AVERAGE_WINDOW_DAYS} (extrapolating from less
 *   than a cycle produces nonsense);
 * - the window contains **no** exempt day at all. An absence of records is not evidence of
 *   an absence of periods — the user may simply have started logging recently — and
 *   returning `0` would silently inflate the estimated qada debt.
 *
 * Note for callers: a postnatal stretch (~40 consecutive days) inside a short window will
 * dominate the average. Pass a window of at least several months when estimating long-term
 * debt.
 *
 * @param periods - Stored exempt periods, in any order.
 * @param fromDay - First day of the observation window (`YYYY-MM-DD`), included.
 * @param toDay - Last day of the observation window (`YYYY-MM-DD`), included.
 * @returns Average exempt days per month (> 0), or `null` when the data cannot support one.
 * @throws RangeError if either bound, or any period, is malformed.
 */
export function averageExemptDaysPerMonth(
  periods: ExemptPeriod[],
  fromDay: PrayerDay,
  toDay: PrayerDay
): number | null {
  const from = assertDay(fromDay, 'fromDay');
  const to = assertDay(toDay, 'toDay');
  if (compareDays(from, to) > 0) return null;

  const windowDays = diffDays(from, to) + 1;
  if (windowDays < MIN_AVERAGE_WINDOW_DAYS) return null;

  const exemptDays = countExemptDaysInRange(periods, from, to);
  if (exemptDays === 0) return null;

  return exemptDays / (windowDays / AVERAGE_DAYS_PER_MONTH);
}
