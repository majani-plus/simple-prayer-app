/**
 * Prayer-day arithmetic — the ONLY place day-boundary logic lives.
 *
 * This module owns every conversion between wall-clock instants (`Date`) and prayer days
 * (`PrayerDay`, a `YYYY-MM-DD` string), plus all calendar arithmetic on prayer days
 * (add/diff/compare/ranges/month grids). No other module may reimplement any of it
 * (docs/ARCHITECTURE.md, docs/PRODUCT_SPEC.md §3).
 *
 * ## The prayer day
 *
 * The prayer day runs **Fajr → next Fajr**, so an Isha prayed at 00:30 belongs to the
 * PREVIOUS calendar date's prayer day. `prayerDayForInstant` is the single function that
 * applies that rule; everything else here is plain proleptic-Gregorian calendar maths on
 * the `YYYY-MM-DD` label.
 *
 * ## Local time, always
 *
 * A `PrayerDay` is a **local** calendar date. It is never derived from UTC fields, never
 * serialised through `toISOString()`, and never round-tripped through an ISO instant.
 * `2026-07-02` means "the day the user's wall clock called July 2nd", wherever they are.
 *
 * ## DST safety
 *
 * All arithmetic (`addDays`, `diffDays`, `daysBetween`, `compareDays`, `monthGrid`, …) runs on
 * integer day numbers derived purely from the (year, month, day) fields — it never divides
 * elapsed milliseconds by 86_400_000 and never constructs an intermediate `Date`. A day that
 * is 23 or 25 hours long (Europe/Berlin, America/New_York and friends) is therefore still
 * exactly one day. Only `parseDay` / `toDayString` / `todayDay` touch the local timezone at all.
 *
 * ## Purity
 *
 * Pure TypeScript. No React, no React Native, no Expo, and deliberately **no adhan** — the Fajr
 * instant needed by `prayerDayForInstant` is passed in by the caller.
 *
 * ## Invalid input
 *
 * Every exported function validates its arguments and throws `RangeError` on a malformed day
 * string (wrong shape, non-existent date such as `2026-02-30`), a non-integer count, or an
 * invalid `Date`. Failing loudly is deliberate: a silently-wrong prayer day corrupts logs,
 * streaks and qada debt.
 */

import type { PrayerDay } from './types';

// ---------------------------------------------------------------------------
// Local types (narrow helpers not present in types.ts)
// ---------------------------------------------------------------------------

/** Day of the week, `0` = Sunday … `6` = Saturday (matches `Date.prototype.getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which column a calendar week starts in: `0` = Sunday, `1` = Monday. */
export type WeekStart = 0 | 1;

/**
 * A History-tab month calendar: exactly 6 rows × 7 columns.
 * `null` marks a cell outside the requested month (see {@link monthGrid}).
 */
export type MonthGrid = (PrayerDay | null)[][];

/** Rows in a {@link monthGrid}. Fixed so the calendar never changes height between months. */
export const MONTH_GRID_ROWS = 6;
/** Columns in a {@link monthGrid} — one per weekday. */
export const MONTH_GRID_COLUMNS = 7;

// ---------------------------------------------------------------------------
// Internal: civil-date <-> day-number conversion (Howard Hinnant's algorithms)
// ---------------------------------------------------------------------------

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CivilDate {
  year: number;
  /** 1-based month, 1…12. */
  month: number;
  /** 1-based day of month. */
  day: number;
}

/**
 * Days since 1970-01-01 for a proleptic-Gregorian civil date. Pure integer maths —
 * no `Date`, no timezone, no DST.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400; // [0, 399]
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1; // [0, 365]
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Inverse of {@link daysFromCivil}. */
function civilFromDays(dayNumber: number): CivilDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097; // [0, 146096]
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365
  ); // [0, 399]
  const y = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100)); // [0, 365]
  const mp = Math.floor((5 * dayOfYear + 2) / 153); // [0, 11]
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** Zero-pads to a fixed width; used for `YYYY-MM-DD` formatting. */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Formats civil fields as `YYYY-MM-DD`. Years must be in 0…9999 (guaranteed by validation). */
function formatCivil(year: number, month: number, day: number): PrayerDay {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Parses and validates a `PrayerDay` into its civil fields.
 * Rejects anything that is not a real `YYYY-MM-DD` calendar date (e.g. `2026-02-30`, `2026-13-01`).
 */
function toCivil(day: PrayerDay, argumentName = 'day'): CivilDate {
  if (typeof day !== 'string') {
    throw new RangeError(
      `Invalid ${argumentName}: expected a YYYY-MM-DD string, got ${typeof day}`
    );
  }
  const match = DAY_PATTERN.exec(day);
  if (match === null) {
    throw new RangeError(`Invalid ${argumentName}: "${day}" is not in YYYY-MM-DD form`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new RangeError(`Invalid ${argumentName}: "${day}" has no such month`);
  }
  if (dayOfMonth < 1 || dayOfMonth > daysInMonth(year, month - 1)) {
    throw new RangeError(`Invalid ${argumentName}: "${day}" is not a real calendar date`);
  }
  return { year, month, day: dayOfMonth };
}

/** Validated `PrayerDay` → day number since the epoch. */
function toDayNumber(day: PrayerDay, argumentName = 'day'): number {
  const civil = toCivil(day, argumentName);
  return daysFromCivil(civil.year, civil.month, civil.day);
}

/** Day number since the epoch → `PrayerDay`. */
function fromDayNumber(dayNumber: number): PrayerDay {
  const civil = civilFromDays(dayNumber);
  if (civil.year < 0 || civil.year > 9999) {
    throw new RangeError(`Day out of supported range: year ${civil.year} is outside 0000…9999`);
  }
  return formatCivil(civil.year, civil.month, civil.day);
}

// ---------------------------------------------------------------------------
// Instant <-> prayer day
// ---------------------------------------------------------------------------

/**
 * Whether a value is a well-formed `PrayerDay`: a `YYYY-MM-DD` string naming a real
 * calendar date. `"2026-02-30"` and `"2026-2-3"` are both rejected.
 *
 * @param value - Candidate value, typically read back from storage or a route param.
 * @returns `true` when the value is safe to pass to every other function in this module.
 */
export function isValidDay(value: unknown): value is PrayerDay {
  if (typeof value !== 'string') return false;
  try {
    toCivil(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The **local** calendar date of an instant, as `YYYY-MM-DD`.
 *
 * Uses the local year/month/day fields, so it is never UTC-shifted: `2026-07-02T23:30`
 * local is `"2026-07-02"` even where that instant is already July 3rd in UTC.
 *
 * This is the *calendar* date, not the prayer day — an instant after midnight but before
 * Fajr still yields the new calendar date. Use {@link prayerDayForInstant} to apply the
 * Fajr→Fajr boundary.
 *
 * @param date - Any valid `Date`.
 * @returns The local calendar date as `YYYY-MM-DD`.
 * @throws RangeError if `date` is not a valid `Date` (e.g. `new Date('nope')`).
 */
export function toDayString(date: Date): PrayerDay {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date: expected a valid Date instance');
  }
  return formatCivil(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Local midnight (00:00:00.000 local time) at the start of a prayer day.
 *
 * The returned `Date` is a real instant, so its UTC representation depends on the local
 * offset in force on that date — which is exactly what makes it DST-correct.
 *
 * Edge case: in the handful of zones where a DST jump skips midnight itself (e.g. some
 * years in America/Santiago), no 00:00 exists and the platform normalises forward to the
 * first instant that does exist (01:00 local). That instant is still inside the requested
 * day, so day-boundary comparisons remain correct.
 *
 * @param day - A `YYYY-MM-DD` prayer day.
 * @returns A `Date` at the start of that local day.
 * @throws RangeError if `day` is not a real `YYYY-MM-DD` date.
 */
export function parseDay(day: PrayerDay): Date {
  const civil = toCivil(day);
  // Build from a safe base then set the fields: `new Date(y, …)` maps years 0–99 into 1900+y,
  // whereas `setFullYear` does not.
  const date = new Date(2000, 0, 1, 0, 0, 0, 0);
  date.setFullYear(civil.year, civil.month - 1, civil.day);
  return date;
}

/**
 * The local calendar date of "now".
 *
 * Note this is the *calendar* date. Between midnight and Fajr the current prayer day is
 * still the previous one — screens that care (Today, logging) must use
 * {@link prayerDayForInstant} with the day's computed Fajr.
 *
 * @param now - Instant to read, defaulting to the current time. Pass it explicitly in tests.
 * @returns Today's local calendar date as `YYYY-MM-DD`.
 */
export function todayDay(now: Date = new Date()): PrayerDay {
  return toDayString(now);
}

/**
 * The prayer day an instant belongs to, applying the Fajr→next-Fajr boundary
 * (PRODUCT_SPEC §3): an Isha logged at 00:30 belongs to the previous calendar date.
 *
 * Rule: if `instant` is **strictly before** the Fajr of its own local calendar date, it
 * belongs to the previous calendar date; **exactly at** Fajr (and after) it belongs to
 * that calendar date.
 *
 * Precondition: `fajrOfInstantCalendarDay` must be the Fajr computed for
 * `toDayString(instant)` — i.e. the caller resolves the calendar date first, then computes
 * that date's Fajr (with the user's offsets applied), then calls this. Nothing is asserted
 * about where that Fajr instant falls, so a large negative offset that pushes Fajr back
 * across midnight still behaves consistently.
 *
 * @param instant - The wall-clock instant to classify (e.g. `Date.now()`, or a log time).
 * @param fajrOfInstantCalendarDay - Fajr of `toDayString(instant)`, offsets already applied.
 * @returns The prayer day, as `YYYY-MM-DD`.
 * @throws RangeError if either argument is not a valid `Date`.
 */
export function prayerDayForInstant(instant: Date, fajrOfInstantCalendarDay: Date): PrayerDay {
  const calendarDay = toDayString(instant);
  if (
    !(fajrOfInstantCalendarDay instanceof Date) ||
    Number.isNaN(fajrOfInstantCalendarDay.getTime())
  ) {
    throw new RangeError('Invalid fajrOfInstantCalendarDay: expected a valid Date instance');
  }
  return instant.getTime() < fajrOfInstantCalendarDay.getTime()
    ? addDays(calendarDay, -1)
    : calendarDay;
}

/**
 * Bound on {@link resolvePrayerDayForInstant}'s walk. Timezones span UTC−12…UTC+14, so a
 * device calendar date is never more than 2 days from the prayer day at the chosen location;
 * 3 leaves margin without letting a broken oracle loop.
 */
export const MAX_BOUNDARY_WALK = 3;

/**
 * The prayer day an instant belongs to, resolved for real against the caller's Fajr oracle:
 * the unique day `D` with `fajr(D) <= instant < fajr(D + 1)`.
 *
 * {@link prayerDayForInstant} applies the boundary rule in a single step from the instant's
 * local calendar date, which is exact whenever the device clock and the location whose Fajr is
 * being computed disagree by less than a full day — every realistic case. But a device timezone
 * and a *manually chosen* city can sit more than 24 hours apart (UTC+14 Line Islands against
 * UTC−11 Niue is 25), and then the calendar date is two days away from the prayer day and one
 * step is not enough: the label handed to a log write would be off by a day. This function
 * walks until the defining inequality holds, so it is correct at any separation.
 *
 * The walk is bounded: the oracle is assumed monotone (each day's Fajr is later than the
 * previous day's — true of any astronomical Fajr, offsets included), so at most
 * {@link MAX_BOUNDARY_WALK} steps are ever needed. If a pathological oracle exhausts the bound
 * the current best answer is returned rather than throwing — being wrong about the day must
 * never make a log un-writable (the same policy as the tracking store's resolver chain).
 *
 * @param instant - The wall-clock instant to classify.
 * @param fajrOf - Returns the Fajr instant of a given prayer day, offsets applied. May be
 *   called for up to `MAX_BOUNDARY_WALK + 1` days around the instant's calendar date. A throw
 *   propagates to the caller.
 * @returns The prayer day, as `YYYY-MM-DD`.
 * @throws RangeError if `instant` is invalid, or whatever `fajrOf` throws.
 */
export function resolvePrayerDayForInstant(
  instant: Date,
  fajrOf: (day: PrayerDay) => Date
): PrayerDay {
  const t = instant.getTime();
  if (!(instant instanceof Date) || Number.isNaN(t)) {
    throw new RangeError('Invalid instant: expected a valid Date instance');
  }

  const fajrMs = (day: PrayerDay): number => {
    const fajr = fajrOf(day);
    if (!(fajr instanceof Date) || Number.isNaN(fajr.getTime())) {
      throw new RangeError(`Invalid Fajr for ${day}: the oracle returned an invalid Date`);
    }
    return fajr.getTime();
  };

  let day = toDayString(instant);
  if (t < fajrMs(day)) {
    // Before this date's own Fajr: walk back until the day's Fajr has been reached. With a
    // monotone oracle the exit condition also proves t < fajr(day + 1), so no forward check
    // is needed on this branch.
    for (let step = 0; step < MAX_BOUNDARY_WALK && t < fajrMs(day); step += 1) {
      day = addDays(day, -1);
    }
    return day;
  }
  // At or past this date's Fajr: walk forward while the NEXT day's Fajr has also been reached
  // (the device calendar running behind the city by more than a day).
  for (let step = 0; step < MAX_BOUNDARY_WALK && t >= fajrMs(addDays(day, 1)); step += 1) {
    day = addDays(day, 1);
  }
  return day;
}

// ---------------------------------------------------------------------------
// Day arithmetic
// ---------------------------------------------------------------------------

/**
 * Shifts a prayer day by whole calendar days. DST-safe by construction: the arithmetic
 * happens on integer day numbers, never on elapsed milliseconds.
 *
 * @param day - Starting `YYYY-MM-DD` day.
 * @param n - Whole days to add; negative moves backwards, `0` returns the same day.
 * @returns The shifted day as `YYYY-MM-DD`.
 * @throws RangeError if `day` is malformed, `n` is not a safe integer, or the result would
 *         leave the supported year range 0000…9999.
 */
export function addDays(day: PrayerDay, n: number): PrayerDay {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Invalid day offset: expected a whole number, got ${n}`);
  }
  return fromDayNumber(toDayNumber(day) + n);
}

/**
 * Whole calendar days from `a` to `b`.
 *
 * `diffDays(a, b) === n` exactly when `addDays(a, n) === b`. Positive when `b` is later,
 * negative when earlier, `0` when equal. DST-safe: a 23- or 25-hour day still counts as one.
 *
 * @param a - Start day (`YYYY-MM-DD`).
 * @param b - End day (`YYYY-MM-DD`).
 * @returns Signed whole-day distance from `a` to `b`.
 * @throws RangeError if either day is malformed.
 */
export function diffDays(a: PrayerDay, b: PrayerDay): number {
  return toDayNumber(b, 'b') - toDayNumber(a, 'a');
}

/**
 * Chronological ordering of two prayer days.
 *
 * @param a - First day (`YYYY-MM-DD`).
 * @param b - Second day (`YYYY-MM-DD`).
 * @returns `-1` when `a` is earlier, `0` when identical, `1` when `a` is later.
 * @throws RangeError if either day is malformed.
 */
export function compareDays(a: PrayerDay, b: PrayerDay): -1 | 0 | 1 {
  const delta = diffDays(a, b);
  if (delta > 0) return -1;
  if (delta < 0) return 1;
  return 0;
}

/**
 * Whether two prayer days name the same calendar date. Normalising, so it is safe against
 * differently-shaped-but-equal inputs only insofar as both are valid `YYYY-MM-DD` strings.
 *
 * @throws RangeError if either day is malformed.
 */
export function isSameDay(a: PrayerDay, b: PrayerDay): boolean {
  return compareDays(a, b) === 0;
}

/**
 * Whether `a` is strictly earlier than `b`.
 *
 * @throws RangeError if either day is malformed.
 */
export function isBeforeDay(a: PrayerDay, b: PrayerDay): boolean {
  return compareDays(a, b) === -1;
}

/**
 * Whether `a` is strictly later than `b`.
 *
 * @throws RangeError if either day is malformed.
 */
export function isAfterDay(a: PrayerDay, b: PrayerDay): boolean {
  return compareDays(a, b) === 1;
}

/**
 * Whether `day` lies in the future relative to `today`. Future days are locked for editing
 * (PRODUCT_SPEC §4); `today` itself is not a future day.
 *
 * @param day - Day under test (`YYYY-MM-DD`).
 * @param today - The current prayer day (`YYYY-MM-DD`), supplied by the caller so this stays pure.
 * @returns `true` only when `day` is strictly after `today`.
 * @throws RangeError if either day is malformed.
 */
export function isFutureDay(day: PrayerDay, today: PrayerDay): boolean {
  return isAfterDay(day, today);
}

/**
 * Every prayer day from `startDay` to `endDay`, **inclusive of both ends**, ascending.
 *
 * Returns `[startDay]` when the two are equal, and `[]` when `startDay` is after `endDay`
 * (an empty range is not an error — a qada wizard or a stats window may legitimately
 * produce one). Allocates one string per day, so callers spanning years should expect a
 * proportionally large array.
 *
 * @param startDay - First day of the range (`YYYY-MM-DD`).
 * @param endDay - Last day of the range (`YYYY-MM-DD`), included in the result.
 * @returns Ascending list of days.
 * @throws RangeError if either day is malformed.
 */
export function daysBetween(startDay: PrayerDay, endDay: PrayerDay): PrayerDay[] {
  const start = toDayNumber(startDay, 'startDay');
  const end = toDayNumber(endDay, 'endDay');
  if (start > end) return [];
  const days: PrayerDay[] = [];
  for (let dayNumber = start; dayNumber <= end; dayNumber += 1) {
    days.push(fromDayNumber(dayNumber));
  }
  return days;
}

/**
 * Day of the week a prayer day falls on, `0` = Sunday … `6` = Saturday.
 *
 * Computed from the day number, never from a `Date`, so it is timezone- and DST-independent.
 *
 * @param day - `YYYY-MM-DD` day.
 * @returns The weekday index.
 * @throws RangeError if `day` is malformed.
 */
export function weekdayIndex(day: PrayerDay): Weekday {
  // 1970-01-01 (day number 0) was a Thursday = 4 in a Sunday-first week.
  const index = (((toDayNumber(day) + 4) % 7) + 7) % 7;
  return index as Weekday;
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

/**
 * Number of days in a Gregorian month.
 *
 * @param year - Full year (e.g. `2028`).
 * @param monthIndex0 - **Zero-based** month, `0` = January … `11` = December (matches `Date`).
 * @returns 28–31; February returns 29 in leap years (2028 → 29, 2100 → 28).
 * @throws RangeError if `year` is not an integer or `monthIndex0` is outside 0…11.
 */
export function daysInMonth(year: number, monthIndex0: number): number {
  if (!Number.isSafeInteger(year)) {
    throw new RangeError(`Invalid year: expected a whole number, got ${year}`);
  }
  if (!Number.isSafeInteger(monthIndex0) || monthIndex0 < 0 || monthIndex0 > 11) {
    throw new RangeError(`Invalid monthIndex0: expected 0…11, got ${monthIndex0}`);
  }
  if (monthIndex0 === 1) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIndex0];
}

/**
 * First day of the month containing `day`.
 *
 * @param day - Any `YYYY-MM-DD` day in the month.
 * @returns The 1st of that month as `YYYY-MM-DD`.
 * @throws RangeError if `day` is malformed.
 */
export function startOfMonth(day: PrayerDay): PrayerDay {
  const civil = toCivil(day);
  return formatCivil(civil.year, civil.month, 1);
}

/**
 * Last day of the month containing `day` (28th–31st, leap-year aware).
 *
 * @param day - Any `YYYY-MM-DD` day in the month.
 * @returns The final day of that month as `YYYY-MM-DD`.
 * @throws RangeError if `day` is malformed.
 */
export function endOfMonth(day: PrayerDay): PrayerDay {
  const civil = toCivil(day);
  return formatCivil(civil.year, civil.month, daysInMonth(civil.year, civil.month - 1));
}

/**
 * The month a prayer day belongs to, as `YYYY-MM`. Stable sort/group key for the History tab
 * and for month-bucketed stats.
 *
 * @param day - `YYYY-MM-DD` day.
 * @returns `YYYY-MM`.
 * @throws RangeError if `day` is malformed.
 */
export function monthKey(day: PrayerDay): string {
  const civil = toCivil(day);
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}`;
}

/**
 * A fixed 6×7 month grid for the History calendar.
 *
 * ### Convention — read this before rendering (the History tab depends on it)
 *
 * 1. The grid is **always 6 rows of 7 cells**, for every month, so the calendar never
 *    changes height when the user pages between months. Short months simply leave whole
 *    trailing rows empty; a renderer may drop an all-`null` row if it prefers to reflow.
 * 2. Leading and trailing cells are **`null`, never adjacent-month days**. Every non-`null`
 *    cell is a day of the requested month, so a cell can be rendered directly (progress ring,
 *    tap target) without re-checking which month it belongs to, and `null` renders as blank —
 *    not as a greyed-out neighbouring date. This is why the return type is `(PrayerDay | null)[][]`.
 * 3. `grid[row][column]`: rows run top to bottom, columns left to right, column `0` being the
 *    weekday named by `weekStartsOn`.
 *
 * @param year - Full year of the month to render (e.g. `2026`).
 * @param monthIndex0 - **Zero-based** month, `0` = January … `11` = December.
 * @param weekStartsOn - `0` for a Sunday-first week, `1` for Monday-first (locale-driven).
 * @returns A 6×7 array of `YYYY-MM-DD` strings and `null` padding cells.
 * @throws RangeError if `year`/`monthIndex0` are invalid or `weekStartsOn` is not 0 or 1.
 */
export function monthGrid(year: number, monthIndex0: number, weekStartsOn: WeekStart): MonthGrid {
  const total = daysInMonth(year, monthIndex0); // also validates year + monthIndex0
  if (weekStartsOn !== 0 && weekStartsOn !== 1) {
    throw new RangeError(
      `Invalid weekStartsOn: expected 0 (Sunday) or 1 (Monday), got ${weekStartsOn}`
    );
  }

  const firstDay = formatCivil(year, monthIndex0 + 1, 1);
  const leading = (weekdayIndex(firstDay) - weekStartsOn + 7) % 7;

  const grid: MonthGrid = [];
  for (let row = 0; row < MONTH_GRID_ROWS; row += 1) {
    const cells: (PrayerDay | null)[] = [];
    for (let column = 0; column < MONTH_GRID_COLUMNS; column += 1) {
      const dayOfMonth = row * MONTH_GRID_COLUMNS + column - leading + 1;
      cells.push(
        dayOfMonth >= 1 && dayOfMonth <= total
          ? formatCivil(year, monthIndex0 + 1, dayOfMonth)
          : null
      );
    }
    grid.push(cells);
  }
  return grid;
}
