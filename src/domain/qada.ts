/**
 * Qada — missed-prayer debt math (docs/PRODUCT_SPEC.md §7).
 *
 * This module owns every number the qada feature shows: the five per-prayer debt counters,
 * the backtracking estimate (exemption-aware), the tick / miss / undo transitions, the pace
 * and projected debt-free date, and "forgive & archive" with its 30-day undo. No other module
 * may compute or mutate a debt counter; the store and the DB persist what these functions return.
 *
 * ## The emotional contract (this is product, not decoration)
 *
 * Counters **descend toward relief**. Every function here is written so the number can only
 * move down or stay put unless the user themselves logged a prayer as `missed`:
 *
 * - No counter can ever go below zero. Ticking an already-cleared prayer is a silent no-op,
 *   never a negative balance, never an error the user has to acknowledge.
 * - Corrupt or fractional stored counts are floored and clamped rather than rejected — the
 *   user is never charged for a fraction of a prayer, and bad data never inflates a debt.
 * - Forgiveness is total and reversible: `forgive` archives the exact previous counters inside
 *   the event, so `undoForgive` hands them back. The undo is **additive** — the caller adds the
 *   archive to the counters as they stand ({@link addDebts}, D79) — because a miss logged after
 *   the forgiveness is a real, separately incurred debt that a replacement would silently delete.
 * - A projection is offered only when it can be stood behind (see {@link MIN_PACE_SAMPLE},
 *   {@link MIN_PROJECTABLE_DEBT}, {@link MAX_PROJECTION_DAYS}); the screen never renders
 *   `Infinity`, `NaN`, a year-99999 date, or a distant "clear by" at someone who is trying
 *   their best. Saying nothing beats saying something wrong.
 *
 * ## Purity
 *
 * Pure TypeScript: no React, no React Native, no Expo, no I/O, no `Date.now()`. Every function
 * is a total function of its arguments; the current instant and the current day are always
 * passed in. All day arithmetic is delegated to `dates.ts`, which is DST-safe.
 *
 * ## Debt model
 *
 * Debt is a *count per prayer type*, not a list of dated obligations — `{ fajr: 12, … }`.
 * The UI's "oldest first" framing is presentational only; there is no age to track, which is
 * what keeps the model cheap and the screen calm.
 *
 * ## Events
 *
 * `QadaEvent` is the audit trail (see docs/ARCHITECTURE.md, `qada_events`). This module
 * *reads* events (`computeProgress`) and *produces* the one event whose payload is
 * load-bearing (`forgive`). The tiny, obvious events — `{ type: 'tick', prayer, delta: -1, at }`
 * for a made-up prayer and `{ type: 'add', prayer, delta: +1, at }` for a newly logged miss —
 * are written by the store alongside the debts these functions return. A `tick` event must only
 * be written when the counter actually moved (see {@link applyTick}), otherwise the pace
 * calculation would count taps that paid off nothing.
 *
 * ## Errors
 *
 * `RangeError` for malformed arguments a programmer controls (bad day strings, bad window
 * sizes, invalid `Date`s). `TypeError` for an event of the wrong shape or type handed to
 * {@link undoForgive}. Stored *counts* are never a hard error — they are sanitised.
 */

import { addDays, diffDays, isValidDay, parseDay, toDayString } from './dates';
import {
  isPrayer,
  PRAYERS,
  type Prayer,
  type PrayerDay,
  type QadaDebts,
  type QadaEstimateInput,
  type QadaEvent,
  type QadaProgress,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Average days per month used to convert a backtrack span into months.
 *
 * `365.25 / 12 = 30.4375` — the mean *Julian* month, i.e. the ordinary "average month"
 * every qada calculator uses. The exact mean Gregorian month is `365.2425 / 12 = 30.436875`;
 * the two differ by ~45 seconds of month, which over a ten-year backtrack moves the exemption
 * deduction by less than a fifth of one day. The rounder number is chosen because it is the
 * one a user can reproduce on paper, and because the estimate is hand-editable afterwards.
 */
export const DAYS_PER_MONTH = 30.4375;

/** Default pace window: prayers made up over the last 30 days (PRODUCT_SPEC §7). */
export const DEFAULT_PACE_WINDOW_DAYS = 30;

/**
 * Prayers that must have been made up inside the window before a pace is worth extrapolating
 * from: five, one day's worth.
 *
 * Below this there is no pace, only a sample of one or two taps, and dividing by it produces a
 * date that is arithmetically true and grossly wrong. The case that named this constant: one
 * outstanding Fajr and one prayer made up today gives a pace of 1/30 per day, so the screen
 * announced a clear date **thirty days out** for a debt the user could settle in five minutes.
 * A projection is a motivational device, not an accounting one — when the ground under it is
 * this thin the honest output is `null`, and the screen says something kind instead.
 */
export const MIN_PACE_SAMPLE = 5;

/**
 * Debt below which no date is offered, however solid the pace: five, again one day's worth.
 *
 * With four prayers left the finish line is already in sight; a date adds nothing the number
 * itself does not say, and rounding noise ("clear around Thursday" for two prayers) makes the
 * screen look like it is guessing. Silence reads better than precision here.
 */
export const MIN_PROJECTABLE_DEBT = 5;

/**
 * How far ahead a projection may reach before it stops being a promise: 3,650 days ≈ 10 years.
 *
 * A small pace against a large debt produces dates like "clear by 2431". Such a date is not
 * encouragement, it is a sentence — the one thing this feature must never hand someone. Beyond
 * this horizon the projection is **withheld** rather than saturated: the pace line still says
 * what was made up recently, and no date is offered at all. Within the horizon the projected
 * day is still clipped to the calendar range `dates.ts` supports (year ≤ 9999).
 */
export const MAX_PROJECTION_DAYS = 3_650;

/** How long "Start fresh" stays undoable, in whole calendar days (PRODUCT_SPEC §7). */
export const FORGIVE_UNDO_WINDOW_DAYS = 30;

/** First day `dates.ts` can represent; used to clip the pace window. */
const FIRST_SUPPORTED_DAY: PrayerDay = '0000-01-01';

/** Last day `dates.ts` can represent; used to clip projections. */
const LAST_SUPPORTED_DAY: PrayerDay = '9999-12-31';

// ---------------------------------------------------------------------------
// Local types (narrow helpers not present in types.ts)
// ---------------------------------------------------------------------------

/** Options for {@link computeProgress}. */
export interface QadaProgressOptions {
  /** The current prayer day; the pace window ends on this day, inclusive. */
  todayDay: PrayerDay;
  /** Length of the pace window in whole days. Defaults to {@link DEFAULT_PACE_WINDOW_DAYS}. */
  paceWindowDays?: number;
}

/**
 * Payload carried by a `forgive` event's `meta`. Written by {@link forgive}, read by
 * {@link undoForgive}. A type alias (not an interface) so it stays assignable to
 * `QadaEvent['meta']`, i.e. `Record<string, unknown>`.
 */
export type QadaForgiveMeta = {
  /** The five counters exactly as they stood before forgiveness. */
  debts: QadaDebts;
  /** Their sum — denormalised so the archive row can be labelled without re-summing. */
  total: number;
  /** Local calendar day the forgiveness happened, for the "forgiven · [date]" archive label. */
  forgivenOn: PrayerDay;
};

/** Result of {@link forgive}: the cleared counters plus the event that archives the old ones. */
export interface QadaForgiveResult {
  debts: QadaDebts;
  event: QadaEvent;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coerces any stored value into a usable debt count: a non-negative integer.
 *
 * Junk (`undefined`, `NaN`, `Infinity`, strings, negatives) becomes `0`; a fractional count is
 * floored, never rounded up. Both choices resolve ambiguity in the user's favour.
 */
function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Throws unless `value` is one of the five tracked prayers. */
function assertPrayer(value: Prayer, argumentName = 'prayer'): void {
  if (typeof value !== 'string' || !isPrayer(value)) {
    throw new RangeError(
      `Invalid ${argumentName}: expected one of ${PRAYERS.join(', ')}, got ${String(value)}`
    );
  }
}

/** Throws unless `value` is a valid `Date`; returns its epoch milliseconds. */
function assertInstant(value: Date, argumentName: string): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`Invalid ${argumentName}: expected a valid Date, got ${String(value)}`);
  }
  return value.getTime();
}

/** Throws unless `value` is a well-formed `YYYY-MM-DD` day. */
function assertDay(value: PrayerDay, argumentName: string): PrayerDay {
  if (!isValidDay(value)) {
    throw new RangeError(
      `Invalid ${argumentName}: expected a YYYY-MM-DD calendar date, got ${String(value)}`
    );
  }
  return value;
}

/** Returns a fresh copy of `debts` with one counter replaced by an already-sanitised count. */
function withCount(debts: QadaDebts, prayer: Prayer, count: number): QadaDebts {
  const next = normalizeDebts(debts);
  next[prayer] = count;
  return next;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/**
 * A debt of nothing: every prayer at zero.
 *
 * @returns A fresh, mutable `QadaDebts` with all five counters at `0`.
 */
export function emptyDebts(): QadaDebts {
  return { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
}

/**
 * Sanitises arbitrary (e.g. freshly deserialised) input into a complete `QadaDebts`.
 *
 * Missing prayers become `0`; negative, fractional, non-finite and non-numeric counts are
 * clamped/floored by the rules in this module's header. Never throws — a corrupt row must not
 * be able to take the qada screen down.
 *
 * @param input - Anything: a `QadaDebts`, a partial record, parsed JSON, `null`, junk.
 * @returns A fresh, complete, non-negative-integer `QadaDebts`.
 */
export function normalizeDebts(input: unknown): QadaDebts {
  const debts = emptyDebts();
  if (typeof input !== 'object' || input === null) return debts;
  const source = input as Partial<Record<Prayer, unknown>>;
  for (const prayer of PRAYERS) {
    debts[prayer] = sanitizeCount(source[prayer]);
  }
  return debts;
}

/**
 * Total prayers still owed across all five counters.
 *
 * Each counter is sanitised first, so the total is always a non-negative integer even if the
 * stored record is corrupt.
 *
 * @param debts - The current per-prayer debt counters.
 * @returns The sum, `0` when nothing is owed.
 */
export function totalDebt(debts: QadaDebts): number {
  let total = 0;
  for (const prayer of PRAYERS) {
    total += sanitizeCount(debts[prayer]);
  }
  return total;
}

/**
 * Adds two sets of counters together, prayer by prayer.
 *
 * The one caller is the forgiveness undo (D79): restoring an archived debt **adds** it back on
 * top of whatever the counters hold now, rather than replacing them. Replacing would silently
 * delete every miss logged between the forgiveness and the undo — misses the user incurred
 * separately and logged deliberately — and an erased debt someone does owe is the mirror image
 * of a minted debt they do not.
 *
 * Both operands are sanitised on the way in, so a corrupt stored record can only ever contribute
 * zero. Pure: neither argument is mutated.
 *
 * @param debts - The counters to add to.
 * @param addend - The counters to add.
 * @returns Fresh counters holding the per-prayer sums.
 */
export function addDebts(debts: QadaDebts, addend: QadaDebts): QadaDebts {
  const left = normalizeDebts(debts);
  const right = normalizeDebts(addend);
  const sum = emptyDebts();
  for (const prayer of PRAYERS) {
    sum[prayer] = left[prayer] + right[prayer];
  }
  return sum;
}

/**
 * The prayer type with the largest outstanding debt — what the Today card's one-tap
 * "+1 made up" button acts on (PRODUCT_SPEC §7).
 *
 * Ties are broken by the canonical prayer order (Fajr, Dhuhr, Asr, Maghrib, Isha), so the
 * suggestion is stable between renders rather than jittering between equal counters.
 *
 * @param debts - The current per-prayer debt counters.
 * @returns The most-owed prayer, or `null` when nothing at all is owed.
 */
export function mostOwedPrayer(debts: QadaDebts): Prayer | null {
  let best: Prayer | null = null;
  let bestCount = 0;
  for (const prayer of PRAYERS) {
    const count = sanitizeCount(debts[prayer]);
    if (count > bestCount) {
      best = prayer;
      bestCount = count;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Estimation (backtrack wizard)
// ---------------------------------------------------------------------------

/**
 * Whole days covered by a backtrack range, **both ends included** — the number
 * {@link estimateDebt} charges five prayers for, and the one the wizard puts on screen next to
 * the range so nobody can be handed a total they never saw coming.
 *
 * A range that runs backwards is `0` rather than a throw: a half-picked range is an ordinary
 * state of a two-field form, not a programming error, and the caller renders it as "pick a
 * later day", not as a crash.
 *
 * @param startDay - First day of the range (`YYYY-MM-DD`).
 * @param endDay - Last day of the range (`YYYY-MM-DD`), included.
 * @returns Days in the range: `1` for a single day, `0` when `endDay` precedes `startDay`.
 * @throws RangeError if either day is not a real `YYYY-MM-DD` date.
 */
export function estimateRangeDays(startDay: PrayerDay, endDay: PrayerDay): number {
  const span = diffDays(assertDay(startDay, 'startDay'), assertDay(endDay, 'endDay'));
  return span < 0 ? 0 : span + 1;
}

/**
 * Estimates the debt accumulated over a past date range — step (a) of the qada setup wizard.
 *
 * Counts **whole days from `startDay` to `endDay` inclusive** (so a single day is 1 day, not 0)
 * and charges five prayers for each: every counter starts at the same number.
 *
 * When `deductExemptions` is true (offered only when exemption mode is on, PRODUCT_SPEC §6),
 * the span is converted to months with `days / DAYS_PER_MONTH` and
 * `Math.round(months × exemptDaysPerMonth)` days are subtracted from **each** counter —
 * a menstruating woman owes no qada for those days at all, so whole days come off, not
 * individual prayers. The rounding is `Math.round` (halves up), and the result is clamped at
 * zero: an aggressive exemption figure can only ever produce a debt of nothing, never a
 * negative one, and never an error.
 *
 * The result is deliberately an *estimate*: the wizard lets the user hand-edit every counter
 * afterwards, and nothing here should be presented as a verdict.
 *
 * @param input - Range plus exemption settings (see `QadaEstimateInput`).
 * @returns Fresh per-prayer counters, each `max(0, days − exemptDays)`.
 * @throws RangeError if either day is not a real `YYYY-MM-DD` date, if `endDay` is before
 *   `startDay`, or if `deductExemptions` is true and `exemptDaysPerMonth` is not a finite
 *   number ≥ 0.
 */
export function estimateDebt(input: QadaEstimateInput): QadaDebts {
  const startDay = assertDay(input.startDay, 'startDay');
  const endDay = assertDay(input.endDay, 'endDay');
  const span = diffDays(startDay, endDay);
  if (span < 0) {
    throw new RangeError(`Invalid range: endDay "${endDay}" is before startDay "${startDay}"`);
  }

  const days = span + 1; // === estimateRangeDays(startDay, endDay), the range already validated
  let perPrayer = days;

  if (input.deductExemptions) {
    const perMonth = input.exemptDaysPerMonth;
    if (typeof perMonth !== 'number' || !Number.isFinite(perMonth) || perMonth < 0) {
      throw new RangeError(
        `Invalid exemptDaysPerMonth: expected a finite number >= 0, got ${String(perMonth)}`
      );
    }
    const exemptDays = Math.round((days / DAYS_PER_MONTH) * perMonth);
    perPrayer = Math.max(0, days - exemptDays);
  }

  const debts = emptyDebts();
  for (const prayer of PRAYERS) {
    debts[prayer] = perPrayer;
  }
  return debts;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Ticks off one made-up prayer: decrements that counter by one, never below zero.
 *
 * Pure — returns a fresh object and never mutates `debts`. Ticking a counter that is already
 * at zero is a **silent no-op** (no throw, no negative balance). Because of that, callers must
 * check `debts[prayer] > 0` *before* writing a `tick` event to the audit trail; a tick that
 * paid off nothing would otherwise inflate the pace in {@link computeProgress}.
 *
 * @param debts - The current per-prayer debt counters.
 * @param prayer - Which prayer was made up.
 * @returns Fresh counters with `prayer` reduced by one (or unchanged if it was already zero).
 * @throws RangeError if `prayer` is not one of the five tracked prayers.
 */
export function applyTick(debts: QadaDebts, prayer: Prayer): QadaDebts {
  assertPrayer(prayer);
  const current = sanitizeCount(debts[prayer]);
  return withCount(debts, prayer, Math.max(0, current - 1));
}

/**
 * Records a newly missed prayer: increments that counter by one.
 *
 * Called when a prayer's status becomes `missed` (from the seal or from History). This is the
 * only function in the module that can make a number go up, and only ever by one, and only
 * ever because the user said so.
 *
 * @param debts - The current per-prayer debt counters.
 * @param prayer - The prayer that was logged as missed.
 * @returns Fresh counters with `prayer` increased by one.
 * @throws RangeError if `prayer` is not one of the five tracked prayers.
 */
export function applyMiss(debts: QadaDebts, prayer: Prayer): QadaDebts {
  assertPrayer(prayer);
  return withCount(debts, prayer, sanitizeCount(debts[prayer]) + 1);
}

/**
 * Reverses {@link applyMiss}: a log that *was* `missed` became something else (prayed, late,
 * exempt, made-up, or unlogged again), so the debt it created is removed.
 *
 * Decrements by one and never goes below zero. The zero case is reachable in normal use — e.g.
 * the user forgave their debt and then edited an old `missed` log — and is deliberately a
 * silent no-op: forgiveness is not clawed back by a later edit.
 *
 * @param debts - The current per-prayer debt counters.
 * @param prayer - The prayer whose `missed` log was undone.
 * @returns Fresh counters with `prayer` reduced by one (or unchanged if it was already zero).
 * @throws RangeError if `prayer` is not one of the five tracked prayers.
 */
export function applyUndoMiss(debts: QadaDebts, prayer: Prayer): QadaDebts {
  assertPrayer(prayer);
  const current = sanitizeCount(debts[prayer]);
  return withCount(debts, prayer, Math.max(0, current - 1));
}

// ---------------------------------------------------------------------------
// Pace & projection
// ---------------------------------------------------------------------------

/**
 * Summarises the debt for the qada screen: totals, recent pace, and a projected clear day.
 *
 * **Window.** The pace window is `paceWindowDays` whole calendar days ending on `todayDay`
 * inclusive — i.e. `[todayDay − (paceWindowDays − 1), todayDay]`. Events are bucketed by the
 * **local calendar date** of their timestamp (local midnight to local midnight, so a 23- or
 * 25-hour DST day is still one day). Qada ticks are not tied to prayer windows, so the
 * Fajr→Fajr prayer-day rule deliberately does not apply here: a tick at 00:30 counts for the
 * new calendar day.
 *
 * **What counts as paid.** Only `tick` events, and only the magnitude of their negative delta
 * (`delta: -1` → one prayer). Events outside the window, of another type, or with a
 * non-negative/absent delta contribute nothing. `forgive` is explicitly *not* progress: mercy
 * must never masquerade as a pace the user then has to live up to.
 *
 * **Projection.** `ceil(total × paceWindowDays / paidInWindow)` days after `todayDay`, computed
 * as integer arithmetic rather than `total / perDay` so floating-point drift can never add a
 * spurious day (100 owed at 0.1/day is 1000 days, not 1001).
 *
 * It is `null` — no date at all — unless every one of these holds, because a wrong date is
 * worse than no date:
 *
 * 1. at least {@link MIN_PROJECTABLE_DEBT} prayers are still owed (below that the end is
 *    already in sight and a date is noise);
 * 2. at least {@link MIN_PACE_SAMPLE} were made up inside the window (below that there is no
 *    pace to extrapolate, only one or two taps, and the date comes out absurdly far);
 * 3. the answer lands within {@link MAX_PROJECTION_DAYS} (beyond that horizon a date reads as
 *    a sentence, so it is withheld rather than saturated).
 *
 * `paidInWindow` and `perDay` are reported regardless, so a screen can still say what was made
 * up recently when it cannot say when the debt ends. The projected day is clipped to stay
 * inside the supported calendar, so it is never `Infinity` and never an invalid date.
 *
 * @param debts - The current per-prayer debt counters (sanitised on the way in).
 * @param events - Qada audit events; order irrelevant, unrelated types ignored, may be empty.
 * @param opts - `todayDay` (window end) and optional `paceWindowDays`.
 * @returns A complete `QadaProgress` snapshot.
 * @throws RangeError if `todayDay` is malformed or `paceWindowDays` is not an integer ≥ 1.
 */
export function computeProgress(
  debts: QadaDebts,
  events: readonly QadaEvent[],
  opts: QadaProgressOptions
): QadaProgress {
  const todayDay = assertDay(opts.todayDay, 'todayDay');
  const paceWindowDays = opts.paceWindowDays ?? DEFAULT_PACE_WINDOW_DAYS;
  if (!Number.isInteger(paceWindowDays) || paceWindowDays < 1) {
    throw new RangeError(
      `Invalid paceWindowDays: expected an integer >= 1, got ${String(paceWindowDays)}`
    );
  }

  const normalized = normalizeDebts(debts);
  const total = totalDebt(normalized);

  // Local-midnight bounds: [start of the window's first day, start of the day after today).
  // On the very last supported day there is no representable "day after", so the window is
  // left open at the top — nothing can be dated beyond it anyway.
  const daysBack = Math.min(paceWindowDays - 1, diffDays(FIRST_SUPPORTED_DAY, todayDay));
  const fromMs = parseDay(addDays(todayDay, -daysBack)).getTime();
  const untilMs =
    todayDay === LAST_SUPPORTED_DAY
      ? Number.POSITIVE_INFINITY
      : parseDay(addDays(todayDay, 1)).getTime();

  let paidInWindow = 0;
  for (const event of events ?? []) {
    if (event === null || typeof event !== 'object' || event.type !== 'tick') continue;
    const at = event.at;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (at < fromMs || at >= untilMs) continue;
    paidInWindow += sanitizeCount(-event.delta);
  }

  const perDay = paidInWindow / paceWindowDays;

  let projectedClearDay: PrayerDay | null = null;
  if (total >= MIN_PROJECTABLE_DEBT && paidInWindow >= MIN_PACE_SAMPLE) {
    const daysNeeded = Math.ceil((total * paceWindowDays) / paidInWindow);
    // Past the horizon the date is a sentence rather than a promise, so it is withheld — not
    // saturated at the horizon, which would state a wrong date with total confidence.
    if (daysNeeded <= MAX_PROJECTION_DAYS) {
      const calendarRoom = Math.max(0, diffDays(todayDay, LAST_SUPPORTED_DAY));
      projectedClearDay = addDays(todayDay, Math.min(daysNeeded, calendarRoom));
    }
  }

  return { debts: normalized, total, paidInWindow, perDay, projectedClearDay };
}

// ---------------------------------------------------------------------------
// Forgive & archive
// ---------------------------------------------------------------------------

/**
 * "Start fresh": zeroes every counter and returns the event that archives what was cleared.
 *
 * Nothing is deleted — the previous counters are copied into `event.meta` (see
 * {@link QadaForgiveMeta}), which is what makes the 30-day undo possible and what the History
 * archive row ("forgiven · [date]") renders. The event's `delta` is `-total`: forgiveness is
 * recorded as debt leaving, in the same units as every other event.
 *
 * Pure — `debts` is not mutated.
 *
 * @param debts - The counters being forgiven.
 * @param now - The instant of forgiveness (passed in; this module never reads the clock).
 * @returns `{ debts: allZeroes, event: forgiveEvent }`. The caller persists both.
 * @throws RangeError if `now` is not a valid `Date`.
 */
export function forgive(debts: QadaDebts, now: Date): QadaForgiveResult {
  const at = assertInstant(now, 'now');
  const previous = normalizeDebts(debts);
  const meta: QadaForgiveMeta = {
    debts: previous,
    total: totalDebt(previous),
    forgivenOn: toDayString(now),
  };
  return {
    debts: emptyDebts(),
    event: {
      type: 'forgive',
      prayer: null,
      delta: -meta.total,
      at,
      meta,
    },
  };
}

/**
 * Reads back the counters archived inside a `forgive` event — the other half of the 30-day undo.
 *
 * Round-trips exactly: `undoForgive(forgive(d, now).event)` deep-equals the sanitised `d`,
 * all five per-prayer numbers preserved. Whether the undo is still *offered* is
 * {@link canUndoForgive}'s decision; this function answers whenever it is asked to, so a
 * caller that has already checked cannot be refused twice.
 *
 * This is the **archive**, not the result: the undo adds it to the counters as they stand
 * ({@link addDebts}, D79) rather than overwriting them, so misses logged since the forgiveness
 * survive. The caller performs that addition and writes the corresponding `forgiveUndo` event.
 *
 * @param event - The `forgive` event to reverse.
 * @returns The per-prayer counters as they stood before the forgiveness.
 * @throws TypeError if `event` is not an object, is not of type `forgive`, or has lost the
 *   `meta.debts` snapshot it needs to restore from.
 */
export function undoForgive(event: QadaEvent): QadaDebts {
  if (event === null || typeof event !== 'object') {
    throw new TypeError(`undoForgive expects a qada event object, received ${String(event)}`);
  }
  if (event.type !== 'forgive') {
    throw new TypeError(
      `undoForgive expects a "forgive" event, received a "${String(event.type)}" event`
    );
  }
  const snapshot = readForgiveSnapshot(event);
  if (snapshot === null) {
    throw new TypeError(
      'undoForgive: this forgive event has no meta.debts snapshot to restore from'
    );
  }
  return normalizeDebts(snapshot);
}

/**
 * Whether a forgiveness can still be undone: it is a `forgive` event that still carries its
 * snapshot, and at most {@link FORGIVE_UNDO_WINDOW_DAYS} whole calendar days have passed.
 *
 * Counted in **calendar days**, not milliseconds, so a DST change cannot shorten the window and
 * the boundary matches what the user reads: the day of forgiveness is day 0 and the offer stands
 * through day 30; on day 31 it is gone. A clock that has gone *backwards* (negative elapsed) is
 * treated as inside the window — device clock skew must never cost someone their undo.
 *
 * Safe as a precondition for {@link undoForgive}: it returns `false` (rather than throwing) for
 * any event that function would reject, so the UI never offers a button that cannot work.
 *
 * The stored timestamp is *data*, not an argument, so it is sanitised rather than asserted: a
 * value that is finite but still unusable — beyond `Date`'s representable range, or landing on a
 * year outside the `0000…9999` calendar `dates.ts` supports (a seconds/microseconds mix-up, a bad
 * migration, a device clock that was set to nonsense) — makes the undo unavailable, not the qada
 * screen crash. Only `now`, which the caller controls, is a hard error.
 *
 * @param event - The candidate `forgive` event.
 * @param now - The current instant.
 * @returns `true` while the undo should still be offered.
 * @throws RangeError if `now` is not a valid `Date`.
 */
export function canUndoForgive(event: QadaEvent, now: Date): boolean {
  assertInstant(now, 'now');
  if (event === null || typeof event !== 'object' || event.type !== 'forgive') return false;
  if (typeof event.at !== 'number' || !Number.isFinite(event.at)) return false;
  if (readForgiveSnapshot(event) === null) return false;

  const forgivenAt = new Date(event.at);
  if (Number.isNaN(forgivenAt.getTime())) return false;
  const forgivenOn = toDayString(forgivenAt);
  if (!isValidDay(forgivenOn)) return false;

  const elapsedDays = diffDays(forgivenOn, toDayString(now));
  return elapsedDays <= FORGIVE_UNDO_WINDOW_DAYS;
}

/** Extracts `meta.debts` from a forgive event, or `null` when it is missing/unusable. */
function readForgiveSnapshot(event: QadaEvent): unknown {
  const meta = event.meta;
  if (meta === null || typeof meta !== 'object') return null;
  const snapshot = (meta as { debts?: unknown }).debts;
  if (snapshot === null || typeof snapshot !== 'object') return null;
  return snapshot;
}
