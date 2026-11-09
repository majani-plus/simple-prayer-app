/**
 * Prayer-time computation — the ONLY module that computes times.
 *
 * Everything the app shows on a clock face originates here: the eight time markers of a prayer
 * day, the five prayer windows, "what is next", "what is now", and the instant the Isha nudge
 * is allowed to fire. Nothing else in the codebase may construct an `adhan.PrayerTimes`;
 * `methods.ts` owns the parameters and `dates.ts` owns the day boundary, and this module is the
 * seam that joins them (docs/ARCHITECTURE.md, docs/PRODUCT_SPEC.md §3).
 *
 * ## What a "day" means here
 *
 * A `PrayerDay` is a local calendar date (`dates.ts`). The times for day `D` are the times adhan
 * computes for that calendar date — Fajr(D) … Isha(D) — and together they make up prayer day `D`,
 * which runs Fajr(D) → Fajr(D+1). That is why {@link getPrayerWindows} needs `D+1` as well:
 * **Isha's window ends at the NEXT DAY's Fajr** (PRODUCT_SPEC §3), so it deliberately crosses
 * midnight, and an Isha logged at 00:30 still belongs to prayer day `D`.
 *
 * The prayer DAY and a prayer's WINDOW are different things, and only the day tiles: Fajr's window
 * shuts at sunrise (`windows.ts`), so from sunrise to Dhuhr nothing is current even though the
 * prayer day runs on. The Fajr→Fajr boundary lives in `dates.ts` and is untouched by that.
 *
 * ## Offsets
 *
 * `CalculationSettings.offsets` shifts each of the five tracked prayers by whole minutes
 * (the "temkin" adjustment that makes the app agree with a local mosque calendar). Applied here,
 * never inside `methods.ts` (`params.adjustments` stays at zero), so there is exactly one place
 * where a displayed time can differ from the astronomical one. Offsets shift an **absolute
 * instant** (`+n × 60 000 ms`), which is what makes them DST-proof.
 *
 * Two markers deliberately ignore offsets:
 *  - **`sunrise`** — `PrayerOffsets` is keyed by the five *tracked prayers* (see `types.ts`), so
 *    the settings model has no sunrise offset to apply. Sunrise is reported raw.
 *  - **`middleOfTheNight` / `lastThirdOfTheNight`** — these come from `adhan.SunnahTimes`, which
 *    derives them from the astronomical Maghrib→next-Fajr night. They are night *anchors*, not
 *    prayers; a mosque's printed-calendar adjustment says nothing about where the night's
 *    midpoint falls, so the offsets are not propagated into them. The practical divergence is
 *    bounded by the average of the Maghrib and Fajr offsets (≤ 30 minutes).
 *
 * ## Purity and cost
 *
 * Pure TypeScript, no React/React Native/Expo, no clock reads (`now` is always a parameter), no
 * caching. Every call recomputes, so a screen that renders a live countdown should memoize on
 * `(day | now-to-the-minute, location, settings)` rather than calling in a render loop.
 *
 * ## Failure mode
 *
 * Malformed input throws `RangeError` (bad day string, non-finite/out-of-range coordinates,
 * invalid `Date`, non-finite offset). A time adhan could not resolve throws `Error`. Failing
 * loudly is deliberate: a silently wrong prayer time is worse than a visible error, and
 * `methods.ts` already installs a polar-circle resolution so high latitudes stay computable.
 */

import * as adhan from 'adhan';

import { addDays, parseDay, resolvePrayerDayForInstant, toDayString } from './dates';
import { buildParameters, resolveMadhab, resolveMethod } from './methods';
import { WINDOW_END_MARKER } from './windows';
import {
  PRAYERS,
  type CalculationSettings,
  type ConcreteMethodId,
  type Coordinates,
  type DayTimes,
  type NextPrayerInfo,
  type Prayer,
  type PrayerDay,
  type PrayerWindow,
  type TimeMarker,
} from './types';

// ---------------------------------------------------------------------------
// Local types (narrow helpers not present in types.ts)
// ---------------------------------------------------------------------------

/**
 * The minimum a caller must know about "where the user is" to get times.
 *
 * `AppLocation` satisfies it structurally, so the stores can pass their location straight in,
 * while tests and future callers (widgets, the notification planner) can pass a bare lat/lng.
 * `countryCode` is only read when `settings.method === 'auto'`.
 */
export interface TimesLocation extends Coordinates {
  /** ISO 3166-1 alpha-2, any case. Drives `auto` method resolution; ignored otherwise. */
  countryCode?: string;
}

/** The prayer whose window contains a given instant, plus the prayer day that window belongs to. */
export interface CurrentPrayerInfo {
  prayer: Prayer;
  /** The prayer day the window belongs to — for Isha after midnight this is the PREVIOUS date. */
  day: PrayerDay;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

function assertLocation(location: TimesLocation): void {
  if (location === null || typeof location !== 'object') {
    throw new RangeError('Invalid location: expected an object with latitude and longitude');
  }
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError(`Invalid latitude: expected a number in −90…90, got ${String(latitude)}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError(
      `Invalid longitude: expected a number in −180…180, got ${String(longitude)}`
    );
  }
}

function assertInstant(value: Date, argumentName: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`Invalid ${argumentName}: expected a valid Date instance`);
  }
}

/** Reads one prayer's minute offset, tolerating settings persisted by an older build. */
function offsetMinutes(settings: CalculationSettings, prayer: Prayer): number {
  const value = settings.offsets?.[prayer];
  if (value === undefined || value === null) return 0;
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Invalid offset for ${prayer}: expected a number of minutes, got ${value}`
    );
  }
  return value;
}

/**
 * Shifts an instant by whole minutes, always returning a fresh `Date` so nothing this module
 * hands out aliases adhan's internal objects (or another return value).
 */
function shiftMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS);
}

/** Guards against adhan handing back an unresolved (`Invalid Date`) marker. */
function assertComputed(instant: Date, marker: TimeMarker, day: PrayerDay): Date {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error(`Could not compute ${marker} for ${day}: adhan returned an invalid date`);
  }
  return instant;
}

interface RawDay {
  method: ConcreteMethodId;
  times: adhan.PrayerTimes;
}

/**
 * Where the repaired Asr lands inside the Dhuhr→Maghrib span, when it has to be estimated.
 * The midpoint: early enough to be merciful (a longer window, never a shorter one), and inside
 * the span by construction. See {@link repairAsr}.
 */
const ASR_TAQDIR_FRACTION = 1 / 2;

/**
 * Repairs adhan 4.4.4's polar Asr defect (found by the 2026-08-27 library audit, D121).
 *
 * `SolarTime.afternoon` computes the Asr altitude from `tan(|latitude − declination|)`. Once
 * `|latitude − declination| ≥ 90°` — deep winter above ~66°, where the sun clears the horizon
 * but its geometric noon altitude is ≤ 0 — the tangent flips sign and adhan returns a
 * plausible-looking `Date` that can land before Dhuhr, after Maghrib, or on the next calendar
 * day (Tromsø 2026: 45 affected days; measured through this module). The polar-circle
 * resolution does not protect Asr: it only engages when sunrise/sunset themselves fail.
 *
 * The repair is the same move the tradition itself makes when the sign a prayer is timed by
 * does not occur (taqdir — estimation), and the same move adhan's own night-portion rules make
 * for Fajr/Isha: place the prayer a fixed fraction into the span it must fall in. On these days
 * the shadow never reaches the length either madhab waits for, so the Shafi/Hanafi distinction
 * has no meaning and a single estimate serves both. Days where adhan's Asr is already inside
 * (Dhuhr, Maghrib) — every day below ~66°, and most days above — are returned untouched.
 *
 * An impossible Asr can arrive two ways, and both are repaired: as a plausible-looking
 * out-of-band instant (stock adhan 4.4.4) or as an `Invalid Date` (our patched copy —
 * `patches/adhan@4.4.6.patch` makes `SolarTime.afternoon` report "no such time" honestly, the
 * fix offered upstream). Handling both keeps this module correct with or without the patch.
 */
function repairAsr(times: adhan.PrayerTimes): void {
  const dhuhr = times.dhuhr?.getTime();
  const asr = times.asr?.getTime();
  const maghrib = times.maghrib?.getTime();
  // An unresolvable day (dhuhr/maghrib themselves invalid) stays adhan's problem —
  // assertComputed reports it loudly downstream.
  if (!Number.isFinite(dhuhr) || !Number.isFinite(maghrib)) return;
  if (maghrib <= dhuhr) return;
  if (Number.isFinite(asr) && (asr as number) > dhuhr && (asr as number) < maghrib) return;

  const estimated = dhuhr + (maghrib - dhuhr) * ASR_TAQDIR_FRACTION;
  // Whole minutes, matching the convention every other adhan marker follows.
  times.asr = new Date(Math.round(estimated / MINUTE_MS) * MINUTE_MS);
}

/** One adhan computation for a calendar date, with the method resolved and parameters built. */
function computeRaw(
  day: PrayerDay,
  location: TimesLocation,
  settings: CalculationSettings
): RawDay {
  assertLocation(location);
  // `parseDay` validates the day string and gives local midnight; adhan reads only the local
  // year/month/date fields off it, so the resulting instants do not depend on the device zone.
  const startOfDay = parseDay(day);
  const method = resolveMethod(settings.method, location.countryCode);
  const parameters = buildParameters(method, {
    madhab: resolveMadhab(settings.madhab, location.countryCode, method),
    highLatitudeRule: settings.highLatitudeRule,
    coordinates: { latitude: location.latitude, longitude: location.longitude },
  });
  const coordinates = new adhan.Coordinates(location.latitude, location.longitude);
  const times = new adhan.PrayerTimes(coordinates, startOfDay, parameters);
  // Every consumer — day times, windows, notifications, widgets — flows through here, so the
  // polar Asr repair happens exactly once, before offsets.
  repairAsr(times);
  return { method, times };
}

/** The five tracked prayers of one adhan computation, with `settings.offsets` applied. */
function applyOffsets(
  raw: RawDay,
  day: PrayerDay,
  settings: CalculationSettings
): Record<Prayer, Date> {
  const result = {} as Record<Prayer, Date>;
  for (const prayer of PRAYERS) {
    result[prayer] = shiftMinutes(
      assertComputed(raw.times[prayer], prayer, day),
      offsetMinutes(settings, prayer)
    );
  }
  return result;
}

/**
 * The five tracked prayers of a calendar date, offsets applied. Cheaper than a full `DayTimes`
 * because it skips `SunnahTimes` (which computes a second day internally).
 */
function trackedTimes(
  day: PrayerDay,
  location: TimesLocation,
  settings: CalculationSettings
): Record<Prayer, Date> {
  return applyOffsets(computeRaw(day, location, settings), day, settings);
}

/**
 * Everything a window boundary can be drawn from: the five tracked prayers (offsets applied) plus
 * `sunrise` (raw — `PrayerOffsets` has no sunrise key). Still one adhan run, still no
 * `SunnahTimes`, so building the day's windows costs exactly what it did before Fajr's end moved.
 */
function windowMarkers(
  day: PrayerDay,
  location: TimesLocation,
  settings: CalculationSettings
): Record<Prayer, Date> & { sunrise: Date } {
  const raw = computeRaw(day, location, settings);
  return {
    ...applyOffsets(raw, day, settings),
    sunrise: shiftMinutes(assertComputed(raw.times.sunrise, 'sunrise', day), 0),
  };
}

// ---------------------------------------------------------------------------
// Day times
// ---------------------------------------------------------------------------

/**
 * All eight time markers for one prayer day, ready to display.
 *
 * The five tracked prayers carry their `settings.offsets` minute adjustment; `sunrise`,
 * `middleOfTheNight` and `lastThirdOfTheNight` do not (see the module header for why). The
 * Sunnah markers come from `adhan.SunnahTimes`, i.e. they bracket the night that FOLLOWS this
 * day's Maghrib — `middleOfTheNight` is Islamic midnight and normally lands on the next calendar
 * date. adhan rounds every marker to the nearest minute (seconds are always `0`, though a
 * sub-second remainder survives) and offsets are whole minutes, so nothing here drifts by a
 * second; compare instants with `getTime()` rather than assuming millisecond-zero.
 *
 * The returned `method` is the concrete authority actually used, so the UI can render
 * "Auto · Diyanet" without re-resolving the country map.
 *
 * @param day - The prayer day to compute, `YYYY-MM-DD` (a local calendar date).
 * @param location - Coordinates, plus `countryCode` when `settings.method` is `auto`.
 * @param settings - Method, madhab, high-latitude rule and per-prayer minute offsets.
 * @returns A `DayTimes` whose `Date`s are owned by the caller (never aliased or cached).
 * @throws RangeError if `day` is not a real `YYYY-MM-DD` date, the coordinates are out of range,
 *         or an offset is not a finite number.
 * @throws Error if adhan cannot resolve a marker for this date and location.
 */
export function computeDayTimes(
  day: PrayerDay,
  location: TimesLocation,
  settings: CalculationSettings
): DayTimes {
  const raw = computeRaw(day, location, settings);
  const sunnah = new adhan.SunnahTimes(raw.times);

  const markers = {
    ...applyOffsets(raw, day, settings),
    // Not offset — `shiftMinutes(…, 0)` is here only to copy the Date adhan owns.
    sunrise: shiftMinutes(assertComputed(raw.times.sunrise, 'sunrise', day), 0),
    middleOfTheNight: shiftMinutes(
      assertComputed(sunnah.middleOfTheNight, 'middleOfTheNight', day),
      0
    ),
    lastThirdOfTheNight: shiftMinutes(
      assertComputed(sunnah.lastThirdOfTheNight, 'lastThirdOfTheNight', day),
      0
    ),
  } satisfies Record<TimeMarker, Date>;

  return { day, times: markers, method: raw.method };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The five prayer windows of a prayer day, in prayer order, as half-open intervals `[start, end)`.
 *
 * Each window ends at the prayer's **real** deadline, which `domain/windows.ts` owns and documents:
 * Dhuhr→Asr, Asr→Maghrib, Maghrib→Isha, **Isha→the NEXT DAY'S FAJR** (PRODUCT_SPEC §3), and
 * **FAJR→SUNRISE**. Fajr is the exception that matters: it is the one prayer whose window shuts
 * before the next prayer begins ("…as long as the sun has not risen", Muslim 612), so
 *
 * ```
 * fajr ──▶ sunrise    ·gap·    dhuhr ──▶ asr ──▶ maghrib ──▶ isha ──▶ next fajr
 * ```
 *
 * **The five windows therefore do NOT tile the prayer day.** Between sunrise and Dhuhr nothing is
 * due and {@link getCurrentPrayer} answers `null` — that is the correct answer, not a defect.
 * Everything else still tiles, so an Isha logged at 00:30 still belongs to the previous date.
 *
 * Isha's end is the outer limit (next Fajr), not Islamic midnight: midnight is where Isha's
 * *preferred* time ends, and the app says so with the {@link getIshaNudgeTime} nudge rather than by
 * calling a valid prayer late.
 *
 * Windows are always returned in canonical prayer order (`fajr … isha`), never sorted by time. At
 * extreme latitudes — or with offsets large enough to overtake the following marker — a window can
 * therefore be degenerate (`end <= start`); callers that measure a window must not assume
 * `end > start`.
 *
 * @param day - The prayer day, `YYYY-MM-DD`.
 * @param location - Coordinates, plus `countryCode` when `settings.method` is `auto`.
 * @param settings - Calculation settings, including per-prayer offsets.
 * @returns Exactly five windows: fajr, dhuhr, asr, maghrib, isha.
 * @throws RangeError / Error on the same conditions as {@link computeDayTimes}.
 */
export function getPrayerWindows(
  day: PrayerDay,
  location: TimesLocation,
  settings: CalculationSettings
): PrayerWindow[] {
  const today = windowMarkers(day, location, settings);
  const nextFajr = trackedTimes(addDays(day, 1), location, settings).fajr;

  return PRAYERS.map((prayer) => {
    const endMarker = WINDOW_END_MARKER[prayer];
    return {
      prayer,
      start: new Date(today[prayer].getTime()),
      // `null` means "the next day's Fajr", which is not a marker of this day (Isha only).
      end: new Date((endMarker === null ? nextFajr : today[endMarker]).getTime()),
    };
  });
}

// ---------------------------------------------------------------------------
// Now
// ---------------------------------------------------------------------------

interface Candidate {
  prayer: Prayer;
  day: PrayerDay;
  at: Date;
}

function candidatesFor(
  day: PrayerDay,
  location: TimesLocation,
  settings: CalculationSettings
): Candidate[] {
  const times = trackedTimes(day, location, settings);
  return PRAYERS.map((prayer) => ({ prayer, day, at: times[prayer] }));
}

/**
 * The next prayer to start after `now`, and how long there is to wait.
 *
 * Strictly-after semantics: at exactly a prayer's start time that prayer has *begun*, so the
 * answer is already the following one and `msRemaining` is always > 0. After Isha the answer
 * rolls over to **tomorrow's Fajr**, reported with tomorrow's prayer day — which is precisely the
 * moment the previous day's streak becomes final (PRODUCT_SPEC §3/§5).
 *
 * `day` is the prayer day the upcoming prayer belongs to: the calendar date whose computation
 * produced it, since Fajr(D)…Isha(D) all belong to prayer day D even when a polar-summer Isha
 * lands after midnight.
 *
 * Candidates are drawn from three calendar dates (yesterday, today, tomorrow) and sorted by time,
 * so the answer never depends on the device timezone agreeing with the location's, and a Maghrib
 * or Isha that spills past midnight is still found in the right order.
 *
 * @param now - The instant to look forward from (pass the clock in; this module never reads it).
 * @param location - Coordinates, plus `countryCode` when `settings.method` is `auto`.
 * @param settings - Calculation settings, including per-prayer offsets.
 * @returns The upcoming prayer, its prayer day, its start instant and `msRemaining` (> 0).
 * @throws RangeError if `now` is not a valid `Date`, plus the conditions of {@link computeDayTimes}.
 */
export function getNextPrayer(
  now: Date,
  location: TimesLocation,
  settings: CalculationSettings
): NextPrayerInfo {
  assertInstant(now, 'now');
  const calendarDay = toDayString(now);
  const candidates = [
    ...candidatesFor(addDays(calendarDay, -1), location, settings),
    ...candidatesFor(calendarDay, location, settings),
    ...candidatesFor(addDays(calendarDay, 1), location, settings),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const nowMs = now.getTime();
  const next = candidates.find((candidate) => candidate.at.getTime() > nowMs);
  if (next === undefined) {
    // Unreachable: tomorrow's Isha is always later than any instant on today's calendar date.
    throw new Error(`Could not find a prayer after ${now.toISOString()}`);
  }
  return {
    prayer: next.prayer,
    day: next.day,
    at: new Date(next.at.getTime()),
    msRemaining: next.at.getTime() - nowMs,
  };
}

/**
 * The prayer day an instant belongs to — the Fajr→next-Fajr boundary, applied for real.
 *
 * Delegates the rule to `dates.resolvePrayerDayForInstant`, which finds the unique day `D`
 * with `fajr(D) <= now < fajr(D + 1)`. So 00:30 is still "yesterday" for logging purposes
 * while 06:00 is today — and the answer stays right even when the device timezone and a
 * manually chosen city sit more than a calendar day apart (UTC+14 against UTC−11), where the
 * one-step rule from the device's calendar date lands on the wrong day.
 *
 * This is the function the Today tab, the seal interaction and every log write must use to decide
 * which `PrayerDay` a tap belongs to.
 *
 * @param now - The instant to classify.
 * @param location - Coordinates, plus `countryCode` when `settings.method` is `auto`.
 * @param settings - Calculation settings, including per-prayer offsets (Fajr's offset moves the
 *        day boundary with it — deliberately, since that is the Fajr the user sees).
 * @returns The prayer day as `YYYY-MM-DD`.
 * @throws RangeError if `now` is not a valid `Date`, plus the conditions of {@link computeDayTimes}.
 */
export function getCurrentPrayerDay(
  now: Date,
  location: TimesLocation,
  settings: CalculationSettings
): PrayerDay {
  assertInstant(now, 'now');
  return resolvePrayerDayForInstant(now, (day) => trackedTimes(day, location, settings).fajr);
}

/**
 * The prayer whose window currently contains `now`, with the prayer day that window belongs to.
 *
 * At 00:30 it answers `isha` of the PREVIOUS date, which is exactly the row the user is still able
 * to log. **`null` is a normal, daily answer**, not an error: Fajr's window ends at sunrise
 * ({@link getPrayerWindows}), so from sunrise until Dhuhr no prayer is current — nothing is due,
 * and the honest thing to say is nothing. `null` also covers the degenerate case where offsets or
 * extreme-latitude times reorder the day. Callers should treat it as "nothing to highlight".
 *
 * @param now - The instant to classify.
 * @param location - Coordinates, plus `countryCode` when `settings.method` is `auto`.
 * @param settings - Calculation settings, including per-prayer offsets.
 * @returns `{ prayer, day }`, or `null` when no window contains `now`.
 * @throws RangeError if `now` is not a valid `Date`, plus the conditions of {@link computeDayTimes}.
 */
export function getCurrentPrayer(
  now: Date,
  location: TimesLocation,
  settings: CalculationSettings
): CurrentPrayerInfo | null {
  const day = getCurrentPrayerDay(now, location, settings);
  const nowMs = now.getTime();
  const window = getPrayerWindows(day, location, settings).find(
    (candidate) => candidate.start.getTime() <= nowMs && nowMs < candidate.end.getTime()
  );
  return window === undefined ? null : { prayer: window.prayer, day };
}

// ---------------------------------------------------------------------------
// Nudges
// ---------------------------------------------------------------------------

/**
 * When the Isha end-of-window nudge may fire for a prayer day: **Islamic midnight**.
 *
 * Isha's window technically runs to the next day's Fajr, so nudging at its end would wake the
 * user at 4am. PRODUCT_SPEC §3/§11 therefore times the Isha nudge off `middleOfTheNight` — the
 * midpoint of the Maghrib→Fajr night from `adhan.SunnahTimes` — which is also the fiqh limit for
 * Isha's preferred time. Around 23:00–01:00 in most inhabited places.
 *
 * Safety net for extreme latitudes: in a polar summer the whole night can collapse to minutes and
 * Islamic midnight can fall outside `(Isha, next Fajr)`. When that happens the midpoint of the
 * actual Isha window is returned instead, so the nudge is always strictly inside the window it
 * belongs to. The caller still decides whether to schedule at all (never on exempt days, never
 * when the prayer is already logged).
 *
 * @param day - The prayer day whose Isha is being nudged, `YYYY-MM-DD`.
 * @param location - Coordinates, plus `countryCode` when `settings.method` is `auto`.
 * @param settings - Calculation settings, including per-prayer offsets.
 * @returns The instant the nudge should fire — strictly after Isha, strictly before the next Fajr
 *          (unless the window itself is degenerate, in which case the window's start is returned).
 * @throws RangeError / Error on the same conditions as {@link computeDayTimes}.
 */
export function getIshaNudgeTime(
  day: PrayerDay,
  location: TimesLocation,
  settings: CalculationSettings
): Date {
  return getIshaNudgeTimeFrom(computeDayTimes(day, location, settings), location, settings);
}

/**
 * {@link getIshaNudgeTime} for a caller that has already computed the day.
 *
 * Same answer, same rules; it just skips the `computeDayTimes` the day-string form has to run
 * (an `adhan.PrayerTimes` plus a `SunnahTimes`, which computes a second day internally). The
 * notification planner builds the times for every day of its window anyway, so asking for them
 * twice was two thirds of what an Isha nudge cost it.
 *
 * The next day's Fajr is still computed here: it is one cheap `trackedTimes` run, and taking it
 * from a caller would make the answer depend on the caller passing the *right* neighbouring day.
 *
 * @param dayTimes - The times of the prayer day whose Isha is being nudged, from
 *                   {@link computeDayTimes} with the same location and settings.
 * @param location - Coordinates, plus `countryCode` when `settings.method` is `auto`.
 * @param settings - Calculation settings, including per-prayer offsets.
 * @returns The instant the nudge should fire.
 * @throws RangeError / Error on the same conditions as {@link computeDayTimes}.
 */
export function getIshaNudgeTimeFrom(
  dayTimes: DayTimes,
  location: TimesLocation,
  settings: CalculationSettings
): Date {
  const ishaMs = dayTimes.times.isha.getTime();
  const nextFajrMs = trackedTimes(addDays(dayTimes.day, 1), location, settings).fajr.getTime();
  const middleOfTheNightMs = dayTimes.times.middleOfTheNight.getTime();

  if (middleOfTheNightMs > ishaMs && middleOfTheNightMs < nextFajrMs) {
    return new Date(middleOfTheNightMs);
  }
  return new Date(ishaMs + Math.round(Math.max(0, nextFajrMs - ishaMs) / 2));
}
