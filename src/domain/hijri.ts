/**
 * Hijri (Umm al-Qura) dates — the date shown in the Today header and in History.
 *
 * This module owns every Gregorian → Hijri conversion in the app, the user's ±2 day Hijri
 * offset (`CalculationSettings.hijriOffset`), and the Hijri month span the History header
 * renders (docs/PRODUCT_SPEC.md §2, §8, §12).
 *
 * ## What it does NOT own
 *
 * Calendar arithmetic on Gregorian days belongs to `dates.ts` and is delegated to it
 * (`addDays`, `diffDays`, `daysInMonth`) — this module never reimplements it. It also does
 * not localise anything: every user-facing name is returned as an **i18n key**
 * (`hijri.months.*`), never as English text. The UI renders those keys and formats the
 * numerals locale-aware (Arabic-Indic digits in `ar`), per docs/ARCHITECTURE.md.
 *
 * ## The offset
 *
 * Moon sighting is local and announcements differ between countries, so the user may nudge
 * the date by ±2 days. The offset shifts the **Gregorian** date BEFORE conversion — never
 * the resulting Hijri day number — so month lengths, month rollovers and year rollovers all
 * stay internally consistent (adding 1 to "30 Sha'ban" must produce "1 Ramadan", not the
 * nonexistent "31 Sha'ban").
 *
 * ## Two engines, one answer
 *
 * 1. **Intl** (`islamic-umalqura` calendar) when the JS engine really supports it.
 * 2. **A tabular Umm al-Qura fallback** (`toHijriTabular`) — pure arithmetic, no `Intl`.
 *
 * The fallback exists because **Hermes**, the React Native engine, ships a cut-down `Intl`:
 * depending on the build and platform it may ignore the `-u-ca-islamic-umalqura` extension
 * and silently answer in the *Gregorian* calendar, which would render a wildly wrong date
 * (or crash) on device. `Intl` is therefore never trusted blindly: it is probed once
 * (see {@link isIntlUmalquraAvailable}) and only used when it both reports the right
 * calendar and reproduces known Umm al-Qura dates exactly. Otherwise the table is used.
 *
 * ### The table
 *
 * `UMM_AL_QURA_MONTH_LENGTHS` holds one 12-bit word per Hijri year for AH 1300–1600
 * (Gregorian 1882-11-12 … 2174-11-25): bit *m* set ⇒ month *m+1* has 30 days, else 29.
 * This is the official Umm al-Qura month-length data (the same fixed table ICU carries);
 * it was extracted from ICU and verified day-for-day against it across the whole range.
 * Outside the table both this module and ICU fall back to the standard *tabular civil*
 * Islamic calendar (the "Kuwaiti" algorithm, 30-year cycle, epoch 622-07-16 CE), so the two
 * engines agree exactly there too — that region is unreachable in practice anyway
 * (the app cannot show dates before 1882 or after 2174).
 *
 * Verified: 1 Muharram 1400 = 1979-11-21 · 1 Ramadan 1445 = 2024-03-11 ·
 * 1 Shawwal 1445 = 2024-04-10 · 1 Muharram 1446 = 2024-07-07.
 *
 * ## Purity
 *
 * Pure TypeScript. No React, no React Native, no Expo. Every exported function validates its
 * arguments and throws `RangeError` on malformed input, matching `dates.ts`: a silently wrong
 * Hijri date is worse than a loud failure, and the app must never crash on device because
 * of a missing `Intl` calendar.
 */

import { addDays, daysInMonth, diffDays, isValidDay } from './dates';
import type { PrayerDay } from './types';

// ---------------------------------------------------------------------------
// Local types (narrow helpers not present in types.ts)
// ---------------------------------------------------------------------------

/** A Hijri (Umm al-Qura) calendar date. `month` is 1…12, `day` is 1…30. */
export interface HijriDate {
  year: number;
  /** 1 = Muharram … 12 = Dhu al-Hijjah. */
  month: number;
  day: number;
}

/** Which conversion engine answered. Surfaced for diagnostics and tests. */
export type HijriEngine = 'intl' | 'tabular';

/** A Hijri month, identified for rendering. */
export interface HijriMonthRef {
  year: number;
  /** 1…12. */
  month: number;
  /** i18n key, e.g. `"hijri.months.muharram"`. */
  monthKey: string;
}

/** The Hijri month(s) a Gregorian month covers — the History header's subtitle. */
export interface HijriMonthSpan {
  /**
   * Distinct Hijri months touched, ascending. Normally 2; exactly 1 when a short Gregorian
   * month falls inside one Hijri month (February 2025); 3 in the rare alignment where a
   * 31-day month starts on the last day of one Hijri month and ends on the first day of
   * another (August 2019 → Dhu al-Qi'dah 1440 / Dhu al-Hijjah 1440 / Muharram 1441).
   */
  months: HijriMonthRef[];
  /** Hijri date of the 1st of the Gregorian month (offset applied). */
  start: HijriDate;
  /** Hijri date of the last day of the Gregorian month (offset applied). */
  end: HijriDate;
}

/**
 * One renderable piece of a formatted Hijri date. Deliberately structural: the module never
 * builds a display string, because word order, separators and numerals are the UI's and
 * i18n layer's business (`ar` needs Arabic-Indic numerals and RTL layout).
 */
export type HijriToken =
  | { type: 'day'; value: number }
  | { type: 'month'; value: number; key: string }
  | { type: 'year'; value: number }
  | { type: 'era'; key: string };

/** How much of the date to emit. */
export type HijriFormatStyle =
  /** Today header: "16 Muharram". */
  | 'dayMonth'
  /** History day detail: "16 Muharram 1448". */
  | 'dayMonthYear'
  /** History header: "Muharram 1448". */
  | 'monthYear'
  /** Just the month name. */
  | 'monthOnly';

export interface HijriFormatOptions {
  /** Defaults to `'dayMonth'`. */
  style?: HijriFormatStyle;
  /** Append the `hijri.era.ah` token ("AH" / "هـ"). Defaults to `false`. */
  includeEra?: boolean;
}

/** Structural render instructions for a Hijri date. */
export interface HijriFormatted {
  /** The date these tokens describe. */
  date: HijriDate;
  /** i18n key for the month name. */
  monthKey: string;
  /**
   * Tokens in reading order (day → month → year → era). RTL is a layout concern: Arabic
   * renders the same order, mirrored by the writing direction, so the UI must not reverse it.
   */
  tokens: HijriToken[];
}

// ---------------------------------------------------------------------------
// i18n keys
// ---------------------------------------------------------------------------

/**
 * i18n keys for the twelve Hijri months, index 0 = Muharram … index 11 = Dhu al-Hijjah.
 * Never literal names — `src/i18n/locales/{en,ar,tr}.json` own the display text.
 */
export const HIJRI_MONTH_KEYS: readonly string[] = [
  'hijri.months.muharram',
  'hijri.months.safar',
  'hijri.months.rabiAlAwwal',
  'hijri.months.rabiAlThani',
  'hijri.months.jumadaAlAwwal',
  'hijri.months.jumadaAlThani',
  'hijri.months.rajab',
  'hijri.months.shaban',
  'hijri.months.ramadan',
  'hijri.months.shawwal',
  'hijri.months.dhuAlQidah',
  'hijri.months.dhuAlHijjah',
];

/** i18n key for the "AH" era marker. */
export const HIJRI_ERA_KEY = 'hijri.era.ah';

/** The ± limit the Settings screen exposes for the Hijri offset (PRODUCT_SPEC §12). */
export const MAX_HIJRI_OFFSET = 2;

// ---------------------------------------------------------------------------
// Umm al-Qura table
// ---------------------------------------------------------------------------

/** First Hijri year covered by the exact Umm al-Qura table. */
export const UMM_AL_QURA_FIRST_YEAR = 1300;
/** Last Hijri year covered by the exact Umm al-Qura table. */
export const UMM_AL_QURA_LAST_YEAR = 1600;

/** Days since 1970-01-01 of 1 Muharram 1300 AH (= Gregorian 1882-11-12). */
const UMM_AL_QURA_START_DAY_NUMBER = -31826;

/**
 * Month lengths for AH 1300–1600, one 12-bit word per year: bit *m* (0-based) set means
 * month *m+1* has 30 days, clear means 29. Official Umm al-Qura data, extracted from ICU
 * and verified against it for every day in the range.
 */
// Ten values per row, each row labelled with the Hijri year its first value belongs to.
// Reflowing that would scatter the year markers mid-row and make this safety-critical
// table easy to misread, so Prettier is told to leave the layout alone.
// prettier-ignore
const UMM_AL_QURA_MONTH_LENGTHS: readonly number[] = [
  /* 1300 */ 0x555, 0x2ab, 0x937, 0x2b6, 0x576, 0x36c, 0xb55, 0xaaa, 0x956, 0x49e,
  /* 1310 */ 0x95d, 0x2ba, 0x5b5, 0x3aa, 0xb4b, 0xa96, 0x52e, 0x2ad, 0x56d, 0xb5a,
  /* 1320 */ 0x752, 0xf25, 0xe8a, 0xd16, 0xa56, 0xab5, 0x6b4, 0xda9, 0xb92, 0xb25,
  /* 1330 */ 0x64b, 0xa9b, 0x35a, 0x6d9, 0x5d4, 0xda5, 0xd4a, 0xa95, 0x536, 0x975,
  /* 1340 */ 0x2f4, 0x6e9, 0x6d4, 0x6a9, 0x535, 0x25d, 0x4bd, 0x9ba, 0x3b4, 0xb69,
  /* 1350 */ 0xb2a, 0xa55, 0x4ad, 0xa5d, 0x2da, 0x6d9, 0xeaa, 0xe94, 0xd2a, 0xc56,
  /* 1360 */ 0x4ae, 0xa6d, 0x56a, 0xd55, 0xd4a, 0xa93, 0x52b, 0xa5b, 0x53a, 0x6b5,
  /* 1370 */ 0xea9, 0xd52, 0xd29, 0xa55, 0x4ad, 0x56d, 0xaea, 0x6e4, 0xed1, 0xda2,
  /* 1380 */ 0xaaa, 0x95a, 0x2da, 0x5b9, 0xbb2, 0x764, 0x6c9, 0x555, 0x2ab, 0x4db,
  /* 1390 */ 0xaba, 0x5b4, 0xda9, 0xd52, 0xaa5, 0x92d, 0x26d, 0x8ed, 0x2da, 0xad5,
  /* 1400 */ 0xaa5, 0xa4b, 0x497, 0x937, 0x2b6, 0x975, 0xd69, 0xd52, 0xc95, 0x92b,
  /* 1410 */ 0x25b, 0x4db, 0x9d5, 0x5d2, 0xda5, 0xd4a, 0xa95, 0x54d, 0xaad, 0x3aa,
  /* 1420 */ 0xbd2, 0xbc4, 0xb89, 0xa95, 0x52d, 0x5ad, 0xb6a, 0x6d4, 0xdc9, 0xd92,
  /* 1430 */ 0xaa6, 0x956, 0x2ae, 0x56d, 0x36a, 0xb55, 0xaaa, 0x94d, 0x49d, 0x95d,
  /* 1440 */ 0x2ba, 0x5b5, 0x5aa, 0xd55, 0xa9a, 0x92e, 0x26e, 0x55d, 0xada, 0x6d4,
  /* 1450 */ 0x6a5, 0xb27, 0xa4d, 0x4ad, 0x56d, 0xb5a, 0x754, 0xf49, 0xe92, 0xd26,
  /* 1460 */ 0xa56, 0x356, 0x6b5, 0xbaa, 0xb92, 0xb25, 0x68b, 0xa9b, 0x55a, 0xada,
  /* 1470 */ 0x5b4, 0xda9, 0xb52, 0xa9a, 0x536, 0x276, 0x575, 0xaf2, 0x6d4, 0x6a9,
  /* 1480 */ 0x555, 0x2ad, 0x4bd, 0x9ba, 0x574, 0xb69, 0xb52, 0xa95, 0x52d, 0xa5d,
  /* 1490 */ 0x4da, 0xad9, 0x6b2, 0xe95, 0xe2a, 0xc96, 0x92e, 0xaad, 0x56a, 0xd65,
  /* 1500 */ 0xd4a, 0xd15, 0x62b, 0xc5b, 0x53a, 0x6b5, 0xdb2, 0xd64, 0xd29, 0xa55,
  /* 1510 */ 0x4ad, 0x96d, 0xaea, 0x6e8, 0xed1, 0xda4, 0xd4a, 0xa6a, 0x2da, 0x5b9,
  /* 1520 */ 0xb72, 0xb68, 0x6d1, 0x655, 0x4ab, 0x95b, 0x2ba, 0x5b5, 0xda9, 0xd52,
  /* 1530 */ 0xca6, 0x94e, 0x46e, 0x95d, 0x4da, 0xad5, 0xaaa, 0xa4d, 0x49b, 0x937,
  /* 1540 */ 0x4b6, 0x975, 0xd6a, 0xd52, 0xaa5, 0x94b, 0x2ab, 0x55b, 0xad9, 0x5d2,
  /* 1550 */ 0xdc5, 0xd92, 0xb25, 0x555, 0xab5, 0x5b4, 0xba9, 0x7a2, 0x745, 0x593,
  /* 1560 */ 0xaab, 0x4d6, 0x9d6, 0x5d2, 0xba5, 0xb4a, 0xa95, 0x4ad, 0x15d, 0x2dd,
  /* 1570 */ 0x9da, 0x5b4, 0x5a9, 0x52d, 0x25b, 0x8b7, 0x176, 0x56d, 0xb6a, 0xaca,
  /* 1580 */ 0xa96, 0x52b, 0x15b, 0x2bb, 0x5b6, 0xdaa, 0xb94, 0xd46, 0xa8d, 0x52d,
  /* 1590 */ 0xa9d, 0x55a, 0x755, 0x749, 0xf13, 0xe4a, 0xa96, 0x556, 0x6b5, 0xbaa,
  /* 1600 */ 0xb94,
];
/** Length in days of Hijri month `month` (1…12) of a year covered by the table. */
function tableMonthLength(yearIndex: number, month: number): number {
  return (UMM_AL_QURA_MONTH_LENGTHS[yearIndex] >> (month - 1)) & 1 ? 30 : 29;
}

/**
 * Day number (days since 1970-01-01) of 1 Muharram for each covered year, plus one extra
 * entry marking the first day after the table. Built once at module load: 301 cheap
 * iterations, so every conversion afterwards is a binary search plus ≤12 additions.
 */
const UMM_AL_QURA_YEAR_STARTS: readonly number[] = (() => {
  const starts = new Array<number>(UMM_AL_QURA_MONTH_LENGTHS.length + 1);
  let dayNumber = UMM_AL_QURA_START_DAY_NUMBER;
  for (let index = 0; index < UMM_AL_QURA_MONTH_LENGTHS.length; index++) {
    starts[index] = dayNumber;
    for (let month = 1; month <= 12; month++) {
      dayNumber += tableMonthLength(index, month);
    }
  }
  starts[UMM_AL_QURA_MONTH_LENGTHS.length] = dayNumber;
  return starts;
})();

/** First day number NOT covered by the table (exclusive end). */
const UMM_AL_QURA_END_DAY_NUMBER = UMM_AL_QURA_YEAR_STARTS[UMM_AL_QURA_MONTH_LENGTHS.length];

// ---------------------------------------------------------------------------
// Internal: Gregorian day numbers
// ---------------------------------------------------------------------------

/** Anchor for day-number arithmetic; all of it is delegated to `dates.ts`. */
const EPOCH_DAY: PrayerDay = '1970-01-01';

/** Days since 1970-01-01 for a prayer day. Throws `RangeError` on a malformed day. */
function toDayNumber(day: PrayerDay): number {
  return diffDays(EPOCH_DAY, day);
}

/** Zero-pads for `YYYY-MM-DD` assembly. */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Builds and validates a `YYYY-MM-DD` day from civil fields.
 * `dates.ts` owns the arithmetic; this only assembles the label it expects.
 */
function gregorianDay(year: number, month: number, dayOfMonth: number): PrayerDay {
  const candidate = `${pad(year, 4)}-${pad(month, 2)}-${pad(dayOfMonth, 2)}`;
  if (!isValidDay(candidate)) {
    throw new RangeError(
      `Invalid Gregorian date: ${year}-${month}-${dayOfMonth} is not a real calendar date`
    );
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertOffset(offsetDays: number): void {
  if (typeof offsetDays !== 'number' || !Number.isSafeInteger(offsetDays)) {
    throw new RangeError(`Invalid offsetDays: expected a whole number, got ${String(offsetDays)}`);
  }
}

function assertDay(day: PrayerDay): void {
  if (!isValidDay(day)) {
    throw new RangeError(`Invalid day: expected a real YYYY-MM-DD date, got ${String(day)}`);
  }
}

function assertHijri(hijri: HijriDate): void {
  if (
    hijri === null ||
    typeof hijri !== 'object' ||
    !Number.isInteger(hijri.year) ||
    !Number.isInteger(hijri.month) ||
    !Number.isInteger(hijri.day) ||
    hijri.month < 1 ||
    hijri.month > 12 ||
    hijri.day < 1 ||
    hijri.day > 30
  ) {
    throw new RangeError(`Invalid Hijri date: ${JSON.stringify(hijri)}`);
  }
}

/**
 * Clamps a stored Hijri offset into the ±{@link MAX_HIJRI_OFFSET} range the UI offers.
 * Use when reading a possibly-corrupt persisted setting; conversion itself accepts any
 * whole number so tests and future features are not boxed in.
 *
 * @param offsetDays - Any number. Fractions are truncated toward zero (`1.9` → `1`); values
 * beyond the limit are clamped (`7` → `2`); anything that is not a finite number (`NaN`,
 * `Infinity`, a string read back from storage) falls back to `0` rather than to a limit,
 * so corrupt state shows the unadjusted date instead of silently shifting it two days.
 * @returns An integer in −{@link MAX_HIJRI_OFFSET}…+{@link MAX_HIJRI_OFFSET}.
 */
export function clampHijriOffset(offsetDays: number): number {
  if (typeof offsetDays !== 'number' || !Number.isFinite(offsetDays)) return 0;
  const rounded = Math.trunc(offsetDays);
  return Math.max(-MAX_HIJRI_OFFSET, Math.min(MAX_HIJRI_OFFSET, rounded));
}

// ---------------------------------------------------------------------------
// Engine 1: the tabular fallback (no Intl)
// ---------------------------------------------------------------------------

/**
 * Tabular civil ("Kuwaiti") Islamic calendar — the 30-year arithmetic cycle used outside the
 * Umm al-Qura table. ICU uses the same rule beyond its table, so the engines still agree.
 * Only reachable before 1882-11-12 or after 2174-11-25.
 */
function civilFromDayNumber(dayNumber: number): HijriDate {
  const julianDay = dayNumber + 2440588;
  const shifted = julianDay - 1948440 + 10632;
  const cycle = Math.floor((shifted - 1) / 10631);
  let remainder = shifted - 10631 * cycle + 354;
  const yearInCycle =
    Math.floor((10985 - remainder) / 5316) * Math.floor((50 * remainder) / 17719) +
    Math.floor(remainder / 5670) * Math.floor((43 * remainder) / 15238);
  remainder =
    remainder -
    Math.floor((30 - yearInCycle) / 15) * Math.floor((17719 * yearInCycle) / 50) -
    Math.floor(yearInCycle / 16) * Math.floor((15238 * yearInCycle) / 43) +
    29;
  const month = Math.floor((24 * remainder) / 709);
  const day = remainder - Math.floor((709 * month) / 24);
  return { year: 30 * cycle + yearInCycle - 30, month, day };
}

/** Index of the covered year containing `dayNumber`, by binary search. */
function yearIndexForDayNumber(dayNumber: number): number {
  let low = 0;
  let high = UMM_AL_QURA_MONTH_LENGTHS.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (UMM_AL_QURA_YEAR_STARTS[middle] <= dayNumber) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Converts a Gregorian day number (days since 1970-01-01) to its Umm al-Qura date using the
 * bundled table, with no dependency on `Intl` whatsoever. This is the Hermes-safe path.
 *
 * @param dayNumber - Whole days since 1970-01-01 (negative before it).
 * @returns The Hijri date; exact for AH 1300–1600, tabular-civil (±1–2 days) outside.
 * @throws RangeError if `dayNumber` is not a safe integer.
 */
export function hijriFromDayNumber(dayNumber: number): HijriDate {
  if (!Number.isSafeInteger(dayNumber)) {
    throw new RangeError(`Invalid dayNumber: expected a whole number, got ${String(dayNumber)}`);
  }
  if (dayNumber < UMM_AL_QURA_START_DAY_NUMBER || dayNumber >= UMM_AL_QURA_END_DAY_NUMBER) {
    return civilFromDayNumber(dayNumber);
  }
  const yearIndex = yearIndexForDayNumber(dayNumber);
  let remaining = dayNumber - UMM_AL_QURA_YEAR_STARTS[yearIndex];
  for (let month = 1; month <= 12; month++) {
    const length = tableMonthLength(yearIndex, month);
    if (remaining < length) {
      return { year: UMM_AL_QURA_FIRST_YEAR + yearIndex, month, day: remaining + 1 };
    }
    remaining -= length;
  }
  /* istanbul ignore next -- unreachable: the year's month lengths sum to its full length. */
  throw new RangeError(`Umm al-Qura table inconsistency at day number ${dayNumber}`);
}

/**
 * Hijri date of a prayer day using ONLY the bundled table — the fallback engine, exported so
 * it is tested on every platform rather than only where `Intl` is missing.
 *
 * @param day - Gregorian prayer day, `YYYY-MM-DD`.
 * @param offsetDays - Whole days added to the Gregorian date BEFORE conversion.
 * @returns The Umm al-Qura date.
 * @throws RangeError if `day` is malformed or `offsetDays` is not a whole number.
 */
export function toHijriTabular(day: PrayerDay, offsetDays: number): HijriDate {
  assertDay(day);
  assertOffset(offsetDays);
  return hijriFromDayNumber(toDayNumber(addDays(day, offsetDays)));
}

/**
 * Whether a Hijri year is inside the exact Umm al-Qura table (AH 1300–1600). Outside it both
 * engines degrade to the arithmetic civil calendar, which can differ from an official
 * announcement by a day or two.
 *
 * @param hijriYear - Hijri year to test.
 * @returns `true` when conversions for that year come from the official table.
 */
export function isWithinUmmAlQuraTable(hijriYear: number): boolean {
  return (
    Number.isInteger(hijriYear) &&
    hijriYear >= UMM_AL_QURA_FIRST_YEAR &&
    hijriYear <= UMM_AL_QURA_LAST_YEAR
  );
}

// ---------------------------------------------------------------------------
// Engine 2: Intl, probed defensively
// ---------------------------------------------------------------------------

/**
 * Locale forced to Latin digits (`-nu-latn`) so `Number()` can parse the parts: an
 * Arabic-Indic numbering system would otherwise yield `NaN`. The display numerals are the
 * UI's job, not this module's.
 */
const INTL_LOCALE = 'en-u-ca-islamic-umalqura-nu-latn';

/**
 * Dates the `Intl` implementation must reproduce exactly before it is trusted. They come
 * from the fixed Umm al-Qura table, so any correct implementation matches regardless of its
 * ICU version, while a Hermes build that quietly answers in the Gregorian calendar fails.
 */
const INTL_PROBES: readonly { day: PrayerDay; expected: HijriDate }[] = [
  { day: '1979-11-21', expected: { year: 1400, month: 1, day: 1 } },
  { day: '2024-03-11', expected: { year: 1445, month: 9, day: 1 } },
  { day: '2024-07-07', expected: { year: 1446, month: 1, day: 1 } },
];

let cachedFormatter: Intl.DateTimeFormat | null | undefined;

/**
 * Builds the formatter once, or returns `null` when this engine cannot do Umm al-Qura.
 * Everything is wrapped: an engine may throw on the calendar extension, resolve to another
 * calendar, or return unparseable parts.
 */
function getFormatter(): Intl.DateTimeFormat | null {
  if (cachedFormatter !== undefined) return cachedFormatter;
  cachedFormatter = null;
  try {
    if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return null;
    const formatter = new Intl.DateTimeFormat(INTL_LOCALE, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    });
    if (formatter.resolvedOptions().calendar !== 'islamic-umalqura') return null;
    if (typeof formatter.formatToParts !== 'function') return null;
    for (const probe of INTL_PROBES) {
      const actual = intlFromDayNumber(formatter, toDayNumber(probe.day));
      if (
        actual === null ||
        actual.year !== probe.expected.year ||
        actual.month !== probe.expected.month ||
        actual.day !== probe.expected.day
      ) {
        return null;
      }
    }
    cachedFormatter = formatter;
    return formatter;
  } catch {
    return null;
  }
}

/**
 * Reads a Hijri date out of `Intl`, defensively.
 *
 * The instant is built at **12:00 UTC** and formatted with `timeZone: 'UTC'`, so the local
 * timezone can never shift the calendar date — a `PrayerDay` is a civil label, and this
 * conversion must be identical in Istanbul (UTC+3) and in a UTC CI runner.
 *
 * Parts are read individually because engines disagree about the formatted string: some
 * append an era ("3/6/1448 AH"), some fold the era into the year part ("1448 AH"), some emit
 * month names instead of numbers. Digits are extracted from each part and anything that does
 * not yield a plausible date is rejected (`null`) rather than guessed at.
 */
function intlFromDayNumber(formatter: Intl.DateTimeFormat, dayNumber: number): HijriDate | null {
  try {
    const parts = formatter.formatToParts(new Date(dayNumber * 86_400_000 + 12 * 3_600_000));
    const read = (type: string): number | null => {
      const part = parts.find((candidate) => candidate.type === type);
      if (part === undefined) return null;
      // Strip an era or any other decoration an engine may fold into the value.
      const digits = /\d+/.exec(part.value);
      if (digits === null) return null;
      const value = Number(digits[0]);
      return Number.isSafeInteger(value) ? value : null;
    };
    const year = read('year');
    const month = read('month');
    const day = read('day');
    if (year === null || month === null || day === null) return null;
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 30) return null;
    // A Gregorian answer (an engine ignoring the calendar extension) is ~600 years ahead.
    if (year > 2000) return null;
    return { year, month, day };
  } catch {
    return null;
  }
}

/**
 * Whether this JS engine can be trusted for `islamic-umalqura` dates. Probed once and cached:
 * the calendar must resolve AND known Umm al-Qura dates must come back exactly right.
 *
 * @returns `true` on a full ICU build (Node, JSC, modern Hermes with full-icu), `false` on a
 * cut-down Hermes — where {@link toHijriTabular} takes over.
 */
export function isIntlUmalquraAvailable(): boolean {
  return getFormatter() !== null;
}

/** Which engine {@link toHijri} will use. For the diagnostics screen and tests. */
export function activeHijriEngine(): HijriEngine {
  return isIntlUmalquraAvailable() ? 'intl' : 'tabular';
}

/**
 * Clears the memoised `Intl` probe. Exists so tests can re-probe after stubbing `Intl`;
 * calling it in production is harmless (the next conversion simply probes again).
 */
export function resetHijriEngineCache(): void {
  cachedFormatter = undefined;
}

/**
 * Hijri date of a prayer day via `Intl` only.
 *
 * @param day - Gregorian prayer day, `YYYY-MM-DD`.
 * @param offsetDays - Whole days added to the Gregorian date BEFORE conversion.
 * @returns The Umm al-Qura date, or `null` when this engine has no usable
 * `islamic-umalqura` calendar (the Hermes case) — callers then use {@link toHijriTabular}.
 * @throws RangeError if `day` is malformed or `offsetDays` is not a whole number.
 */
export function toHijriIntl(day: PrayerDay, offsetDays: number): HijriDate | null {
  assertDay(day);
  assertOffset(offsetDays);
  const formatter = getFormatter();
  if (formatter === null) return null;
  return intlFromDayNumber(formatter, toDayNumber(addDays(day, offsetDays)));
}

// ---------------------------------------------------------------------------
// Public conversion
// ---------------------------------------------------------------------------

/**
 * The Umm al-Qura date shown for a prayer day — the app's single conversion entry point.
 *
 * `offsetDays` shifts the **Gregorian** date before converting, so a `+1` on the last day of
 * a Hijri month correctly rolls into day 1 of the next one (and, at year's end, into the
 * next Hijri year). This is the user's ±2 "Hijri date offset" setting (PRODUCT_SPEC §12),
 * which exists because moon-sighting announcements differ by region.
 *
 * Uses `Intl` where the engine genuinely supports the calendar and the bundled Umm al-Qura
 * table otherwise; both produce the same answer for AH 1300–1600 (Gregorian 1882–2174), so
 * the visible date never depends on which one ran.
 *
 * @param day - Gregorian prayer day, `YYYY-MM-DD` (see `dates.ts`).
 * @param offsetDays - Whole days to add to the Gregorian date before conversion; the UI
 * restricts this to −2…+2 (see {@link clampHijriOffset}), any whole number is accepted here.
 * @returns `{ year, month, day }` with `month` in 1…12 (1 = Muharram) and `day` in 1…30.
 * @throws RangeError if `day` is not a real `YYYY-MM-DD` date or `offsetDays` is not a whole
 * number.
 */
export function toHijri(day: PrayerDay, offsetDays: number): HijriDate {
  assertDay(day);
  assertOffset(offsetDays);
  const shifted = addDays(day, offsetDays);
  const dayNumber = toDayNumber(shifted);
  const formatter = getFormatter();
  if (formatter !== null) {
    const viaIntl = intlFromDayNumber(formatter, dayNumber);
    if (viaIntl !== null) return viaIntl;
  }
  return hijriFromDayNumber(dayNumber);
}

// ---------------------------------------------------------------------------
// Formatting (structural — never English)
// ---------------------------------------------------------------------------

/**
 * i18n key for a Hijri month number.
 *
 * @param month - 1…12, where 1 is Muharram.
 * @returns The `hijri.months.*` key.
 * @throws RangeError if `month` is not an integer in 1…12.
 */
export function hijriMonthKey(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid Hijri month: expected 1…12, got ${String(month)}`);
  }
  return HIJRI_MONTH_KEYS[month - 1];
}

/**
 * Turns a Hijri date into render instructions — an ordered token list plus the month's i18n
 * key. Deliberately returns no display string: the month name comes from the active locale
 * and the numerals must be formatted locale-aware (Arabic-Indic in `ar`), so composing text
 * here would hardcode English and break RTL.
 *
 * @param hijri - The date to describe (typically straight from {@link toHijri}).
 * @param opts - `style` selects which tokens appear (default `'dayMonth'`, the Today header);
 * `includeEra` appends the `hijri.era.ah` token.
 * @returns Tokens in reading order (day → month → year → era) with the resolved month key.
 * @throws RangeError if `hijri` is not a plausible Hijri date or `style` is unknown.
 */
export function formatHijri(hijri: HijriDate, opts: HijriFormatOptions = {}): HijriFormatted {
  assertHijri(hijri);
  const style = opts.style ?? 'dayMonth';
  const monthKey = hijriMonthKey(hijri.month);
  const tokens: HijriToken[] = [];

  switch (style) {
    case 'dayMonth':
    case 'dayMonthYear':
      tokens.push({ type: 'day', value: hijri.day });
      tokens.push({ type: 'month', value: hijri.month, key: monthKey });
      if (style === 'dayMonthYear') tokens.push({ type: 'year', value: hijri.year });
      break;
    case 'monthYear':
      tokens.push({ type: 'month', value: hijri.month, key: monthKey });
      tokens.push({ type: 'year', value: hijri.year });
      break;
    case 'monthOnly':
      tokens.push({ type: 'month', value: hijri.month, key: monthKey });
      break;
    default: {
      const exhaustive: never = style;
      throw new RangeError(`Unknown Hijri format style: ${String(exhaustive)}`);
    }
  }

  if (opts.includeEra === true) tokens.push({ type: 'era', key: HIJRI_ERA_KEY });

  return { date: { ...hijri }, monthKey, tokens };
}

// ---------------------------------------------------------------------------
// History header: the Hijri month span of a Gregorian month
// ---------------------------------------------------------------------------

/** A 31-day Gregorian month can touch at most three Hijri months (1 + 29 + 1 days). */
const MAX_SPAN_MONTHS = 3;

/**
 * The Hijri month(s) a Gregorian month covers — what the History header renders beside the
 * Gregorian month name ("July · Muḥarram/Ṣafar", PRODUCT_SPEC §8).
 *
 * Usually two months; exactly one when a short Gregorian month sits inside a single Hijri
 * month (February 2025 is entirely Sha'ban 1446); three in the rare alignment where a 31-day
 * month begins on the last day of one Hijri month and ends on the first of another
 * (August 2019 → Dhu al-Qi'dah 1440, Dhu al-Hijjah 1440, Muharram 1441). The Hijri year may
 * change mid-span, so each entry carries its own year.
 *
 * @param year - Gregorian year, e.g. `2026`.
 * @param monthIndex0 - **Zero-based** month, `0` = January … `11` = December (matches `Date`
 * and `dates.daysInMonth`).
 * @param offsetDays - The user's Hijri offset, applied to both endpoints before conversion.
 * @returns The distinct Hijri months in ascending order plus the converted first/last day.
 * @throws RangeError if `year`/`monthIndex0` are invalid or `offsetDays` is not a whole number.
 */
export function hijriMonthSpanForGregorianMonth(
  year: number,
  monthIndex0: number,
  offsetDays: number
): HijriMonthSpan {
  assertOffset(offsetDays);
  // Validates year/monthIndex0 and gives us the month's length in one call.
  const lastDayOfMonth = daysInMonth(year, monthIndex0);
  const firstDay = gregorianDay(year, monthIndex0 + 1, 1);
  const lastDay = gregorianDay(year, monthIndex0 + 1, lastDayOfMonth);

  const start = toHijri(firstDay, offsetDays);
  const end = toHijri(lastDay, offsetDays);

  const months: HijriMonthRef[] = [];
  let currentYear = start.year;
  let currentMonth = start.month;
  for (let step = 0; step < MAX_SPAN_MONTHS; step++) {
    months.push({
      year: currentYear,
      month: currentMonth,
      monthKey: hijriMonthKey(currentMonth),
    });
    if (currentYear === end.year && currentMonth === end.month) {
      return { months, start, end };
    }
    currentMonth += 1;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear += 1;
    }
  }
  /* istanbul ignore next -- unreachable: a Gregorian month spans at most three Hijri months. */
  throw new RangeError(
    `Hijri span for ${year}-${monthIndex0 + 1} exceeded ${MAX_SPAN_MONTHS} months`
  );
}
