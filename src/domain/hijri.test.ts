/**
 * Tests for the Hijri (Umm al-Qura) conversion module.
 *
 * Both engines are exercised on every platform: `toHijriIntl` (this Node build has full ICU)
 * and `toHijriTabular` (the bundled table, which is what Hermes runs on device). The Hermes
 * situation is simulated by stubbing `Intl`, so the fallback path is covered here rather than
 * only discovered on a phone.
 *
 * Timezone robustness: every expectation is a literal Hijri triple or a `YYYY-MM-DD` string.
 * Nothing is derived from `new Date()`, `toISOString()` or the host timezone, so the suite
 * gives the same result in Europe/Istanbul (UTC+3) and in a UTC CI runner — and there is an
 * explicit test that mutates `process.env.TZ` to prove it.
 */

import { addDays, diffDays } from './dates';
import {
  HIJRI_ERA_KEY,
  HIJRI_MONTH_KEYS,
  MAX_HIJRI_OFFSET,
  UMM_AL_QURA_FIRST_YEAR,
  UMM_AL_QURA_LAST_YEAR,
  activeHijriEngine,
  clampHijriOffset,
  formatHijri,
  hijriFromDayNumber,
  hijriMonthKey,
  hijriMonthSpanForGregorianMonth,
  isIntlUmalquraAvailable,
  isWithinUmmAlQuraTable,
  resetHijriEngineCache,
  toHijri,
  toHijriIntl,
  toHijriTabular,
  type HijriDate,
} from './hijri';
import type { PrayerDay } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EPOCH: PrayerDay = '1970-01-01';
const dayNumberOf = (day: PrayerDay): number => diffDays(EPOCH, day);
const dayOfNumber = (dayNumber: number): PrayerDay => addDays(EPOCH, dayNumber);
const hijri = (year: number, month: number, day: number): HijriDate => ({ year, month, day });

/**
 * Known Gregorian → Umm al-Qura correspondences. The dated events are the Saudi (Umm al-Qura)
 * calendar's own values, which is exactly what this module claims to reproduce.
 */
const KNOWN: { gregorian: PrayerDay; expected: HijriDate; what: string }[] = [
  { gregorian: '1970-01-01', expected: hijri(1389, 10, 22), what: 'the Unix epoch' },
  { gregorian: '1979-11-21', expected: hijri(1400, 1, 1), what: '1 Muharram 1400' },
  { gregorian: '2000-01-01', expected: hijri(1420, 9, 24), what: 'Y2K' },
  { gregorian: '2024-03-11', expected: hijri(1445, 9, 1), what: '1 Ramadan 1445' },
  { gregorian: '2024-04-10', expected: hijri(1445, 10, 1), what: 'Eid al-Fitr 1445' },
  { gregorian: '2024-06-15', expected: hijri(1445, 12, 9), what: 'Day of Arafah 1445' },
  { gregorian: '2024-07-07', expected: hijri(1446, 1, 1), what: '1 Muharram 1446' },
  { gregorian: '2025-03-01', expected: hijri(1446, 9, 1), what: '1 Ramadan 1446' },
  { gregorian: '2026-06-15', expected: hijri(1447, 12, 29), what: 'the last day of 1447' },
  { gregorian: '2026-06-16', expected: hijri(1448, 1, 1), what: '1 Muharram 1448' },
  { gregorian: '2026-07-02', expected: hijri(1448, 1, 17), what: "the spec's header example day" },
  { gregorian: '2026-08-19', expected: hijri(1448, 3, 6), what: 'a mid-month day' },
  { gregorian: '2030-01-05', expected: hijri(1451, 9, 1), what: '1 Ramadan 1451' },
];

/** Installs a fake global `Intl` for the duration of `run`, then restores the real one. */
function withIntl(fake: unknown, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Intl');
  try {
    Object.defineProperty(globalThis, 'Intl', {
      value: fake,
      configurable: true,
      writable: true,
    });
    resetHijriEngineCache();
    run();
  } finally {
    if (original === undefined) {
      delete (globalThis as { Intl?: unknown }).Intl;
    } else {
      Object.defineProperty(globalThis, 'Intl', original);
    }
    resetHijriEngineCache();
  }
}

afterEach(() => {
  resetHijriEngineCache();
});

// ---------------------------------------------------------------------------
// Month keys
// ---------------------------------------------------------------------------

describe('HIJRI_MONTH_KEYS', () => {
  it('has all twelve months in calendar order', () => {
    expect(HIJRI_MONTH_KEYS).toEqual([
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
    ]);
  });

  it('has exactly 12 unique namespaced keys', () => {
    expect(HIJRI_MONTH_KEYS).toHaveLength(12);
    expect(new Set(HIJRI_MONTH_KEYS).size).toBe(12);
    for (const key of HIJRI_MONTH_KEYS) {
      expect(key).toMatch(/^hijri\.months\.[a-zA-Z]+$/);
    }
  });

  it('maps every month number 1…12 to its key', () => {
    for (let month = 1; month <= 12; month++) {
      expect(hijriMonthKey(month)).toBe(HIJRI_MONTH_KEYS[month - 1]);
    }
    expect(hijriMonthKey(1)).toBe('hijri.months.muharram');
    expect(hijriMonthKey(9)).toBe('hijri.months.ramadan');
    expect(hijriMonthKey(12)).toBe('hijri.months.dhuAlHijjah');
  });

  it('rejects month numbers outside 1…12', () => {
    for (const bad of [0, 13, -1, 1.5, Number.NaN]) {
      expect(() => hijriMonthKey(bad)).toThrow(RangeError);
    }
  });
});

// ---------------------------------------------------------------------------
// Known correspondences — both engines
// ---------------------------------------------------------------------------

describe('toHijri — known correspondences', () => {
  it.each(KNOWN)('converts $gregorian ($what)', ({ gregorian, expected }) => {
    expect(toHijri(gregorian, 0)).toEqual(expected);
  });

  it.each(KNOWN)('the tabular fallback also converts $gregorian', ({ gregorian, expected }) => {
    expect(toHijriTabular(gregorian, 0)).toEqual(expected);
  });

  it.each(KNOWN)('Intl also converts $gregorian', ({ gregorian, expected }) => {
    const viaIntl = toHijriIntl(gregorian, 0);
    // `null` only on an engine without the calendar; this Node build has full ICU.
    expect(viaIntl).not.toBeNull();
    expect(viaIntl).toEqual(expected);
  });

  it('rejects malformed days and offsets', () => {
    expect(() => toHijri('2026-02-30', 0)).toThrow(RangeError);
    expect(() => toHijri('2026-13-01', 0)).toThrow(RangeError);
    expect(() => toHijri('2026-7-2', 0)).toThrow(RangeError);
    expect(() => toHijri('not a day', 0)).toThrow(RangeError);
    expect(() => toHijri(42 as unknown as PrayerDay, 0)).toThrow(RangeError);
    expect(() => toHijri('2026-07-02', 1.5)).toThrow(RangeError);
    expect(() => toHijri('2026-07-02', Number.NaN)).toThrow(RangeError);
    expect(() => toHijri('2026-07-02', Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toHijriTabular('2026-02-30', 0)).toThrow(RangeError);
    expect(() => toHijriIntl('2026-02-30', 0)).toThrow(RangeError);
  });

  it('always returns a month in 1…12 and a day in 1…30', () => {
    for (
      let dayNumber = dayNumberOf('2020-01-01');
      dayNumber <= dayNumberOf('2040-01-01');
      dayNumber += 1
    ) {
      const result = toHijri(dayOfNumber(dayNumber), 0);
      expect(result.month).toBeGreaterThanOrEqual(1);
      expect(result.month).toBeLessThanOrEqual(12);
      expect(result.day).toBeGreaterThanOrEqual(1);
      expect(result.day).toBeLessThanOrEqual(30);
      expect(Number.isInteger(result.year)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Intl vs fallback agreement
// ---------------------------------------------------------------------------

describe('Intl and the tabular fallback agree', () => {
  it('agree exactly on every day from 2015 to 2040', () => {
    const start = dayNumberOf('2015-01-01');
    const end = dayNumberOf('2040-12-31');
    let checked = 0;
    for (let dayNumber = start; dayNumber <= end; dayNumber++) {
      const day = dayOfNumber(dayNumber);
      const viaIntl = toHijriIntl(day, 0);
      expect(viaIntl).not.toBeNull();
      // The Gregorian day rides along so a failure names the date that broke.
      expect({ gregorian: day, hijri: viaIntl }).toEqual({
        gregorian: day,
        hijri: toHijriTabular(day, 0),
      });
      checked++;
    }
    expect(checked).toBeGreaterThan(9000);
  });

  it('agree within one day across the whole supported range (1890–2170)', () => {
    // The contract is "within a day": a differing ICU build could legitimately shift a
    // boundary. Expressed exactly — the Intl answer must be the tabular answer for this
    // day or for one of its neighbours.
    const start = dayNumberOf('1890-01-01');
    const end = dayNumberOf('2170-01-01');
    for (let dayNumber = start; dayNumber <= end; dayNumber += 29) {
      const viaIntl = toHijriIntl(dayOfNumber(dayNumber), 0);
      expect(viaIntl).not.toBeNull();
      const neighbours = [-1, 0, 1].map((shift) =>
        toHijriTabular(dayOfNumber(dayNumber + shift), 0)
      );
      expect(neighbours).toContainEqual(viaIntl);
    }
  });

  it('agree outside the Umm al-Qura table, where both use the civil calendar', () => {
    for (const day of [
      '1700-06-15',
      '1800-01-01',
      '1882-11-11',
      '2174-11-26',
      '2300-05-05',
    ] as PrayerDay[]) {
      const viaIntl = toHijriIntl(day, 0);
      expect(viaIntl).not.toBeNull();
      expect(viaIntl).toEqual(toHijriTabular(day, 0));
    }
  });

  it('reproduces ICU for every single day the bundled table covers', () => {
    // The strongest guard on the bundled data: an independent ICU formatter (not the
    // module's own Intl path) checked against all ~106,600 days of AH 1300–1600. A single
    // corrupted hex digit anywhere in the table fails this.
    if (!isIntlUmalquraAvailable()) return; // Nothing to compare against on a Hermes-like engine.
    const oracle = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const readOracle = (dayNumber: number): HijriDate => {
      const parts = oracle.formatToParts(new Date(dayNumber * 86_400_000 + 12 * 3_600_000));
      const read = (type: string): number =>
        Number(parts.find((part) => part.type === type)?.value);
      return { year: read('year'), month: read('month'), day: read('day') };
    };

    const start = dayNumberOf('1882-11-12'); // 1 Muharram 1300
    const end = dayNumberOf('2174-11-25'); // 30 Dhu al-Hijjah 1600
    let checked = 0;
    for (let dayNumber = start; dayNumber <= end; dayNumber++) {
      const mine = hijriFromDayNumber(dayNumber);
      const theirs = readOracle(dayNumber);
      if (mine.year !== theirs.year || mine.month !== theirs.month || mine.day !== theirs.day) {
        throw new Error(
          `Umm al-Qura table mismatch on ${dayOfNumber(dayNumber)}: ` +
            `table=${JSON.stringify(mine)} icu=${JSON.stringify(theirs)}`
        );
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(106_000);
  });

  it('knows which years the exact table covers', () => {
    expect(UMM_AL_QURA_FIRST_YEAR).toBe(1300);
    expect(UMM_AL_QURA_LAST_YEAR).toBe(1600);
    expect(isWithinUmmAlQuraTable(1448)).toBe(true);
    expect(isWithinUmmAlQuraTable(1300)).toBe(true);
    expect(isWithinUmmAlQuraTable(1600)).toBe(true);
    expect(isWithinUmmAlQuraTable(1299)).toBe(false);
    expect(isWithinUmmAlQuraTable(1601)).toBe(false);
    expect(isWithinUmmAlQuraTable(1448.5)).toBe(false);
    // The table's exact edges: 1 Muharram 1300 and the last day of 1600.
    expect(toHijriTabular('1882-11-12', 0)).toEqual(hijri(1300, 1, 1));
    expect(toHijriTabular('1882-11-11', 0)).toEqual(hijri(1299, 12, 29));
    expect(toHijriTabular('2174-11-25', 0)).toEqual(hijri(1600, 12, 30));
    expect(toHijriTabular('2174-11-26', 0)).toEqual(hijri(1601, 1, 1));
  });
});

// ---------------------------------------------------------------------------
// The offset
// ---------------------------------------------------------------------------

describe('the ±day offset', () => {
  it('shifts the Gregorian date before converting, for every offset in −2…+2', () => {
    for (const { gregorian } of KNOWN) {
      for (let offset = -MAX_HIJRI_OFFSET; offset <= MAX_HIJRI_OFFSET; offset++) {
        expect(toHijri(gregorian, offset)).toEqual(toHijri(addDays(gregorian, offset), 0));
      }
    }
  });

  it('walks the Hijri day number one step at a time inside a month', () => {
    // 2026-08-19 is 6 Rabi al-awwal 1448, comfortably mid-month.
    expect(toHijri('2026-08-19', -2)).toEqual(hijri(1448, 3, 4));
    expect(toHijri('2026-08-19', -1)).toEqual(hijri(1448, 3, 5));
    expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
    expect(toHijri('2026-08-19', 1)).toEqual(hijri(1448, 3, 7));
    expect(toHijri('2026-08-19', 2)).toEqual(hijri(1448, 3, 8));
  });

  it("reproduces the spec's mock header (16 Muharram · July 2) with a −1 offset", () => {
    // PRODUCT_SPEC §2 shows "16 Muharram · July 2"; Umm al-Qura itself says 17 Muharram,
    // which is precisely the disagreement the offset setting exists to absorb.
    expect(toHijri('2026-07-02', 0)).toEqual(hijri(1448, 1, 17));
    expect(toHijri('2026-07-02', -1)).toEqual(hijri(1448, 1, 16));
  });

  it('rolls the month over rather than inventing a 31st day', () => {
    // 1447-12 is a 29-day month, so +1 from its last day must be 1 Muharram 1448.
    expect(toHijri('2026-06-15', 0)).toEqual(hijri(1447, 12, 29));
    expect(toHijri('2026-06-15', 1)).toEqual(hijri(1448, 1, 1));
    expect(toHijri('2026-06-15', 2)).toEqual(hijri(1448, 1, 2));
    // 1448-02 is a 30-day month.
    expect(toHijri('2026-08-13', 0)).toEqual(hijri(1448, 2, 30));
    expect(toHijri('2026-08-13', 1)).toEqual(hijri(1448, 3, 1));
    expect(toHijri('2026-08-12', 1)).toEqual(hijri(1448, 2, 30));
  });

  it('rolls the Hijri year over', () => {
    expect(toHijri('2026-06-16', -1)).toEqual(hijri(1447, 12, 29));
    expect(toHijri('2026-06-15', 1)).toEqual(hijri(1448, 1, 1));
  });

  it('accepts offsets beyond the UI limit and applies them faithfully', () => {
    expect(toHijri('2026-08-19', 30)).toEqual(toHijri('2026-09-18', 0));
    expect(toHijri('2026-08-19', -365)).toEqual(toHijri('2025-08-19', 0));
  });

  it('applies the offset in the fallback engine identically', () => {
    for (let offset = -MAX_HIJRI_OFFSET; offset <= MAX_HIJRI_OFFSET; offset++) {
      expect(toHijriTabular('2026-06-15', offset)).toEqual(toHijri('2026-06-15', offset));
    }
  });
});

describe('clampHijriOffset', () => {
  it('keeps offsets inside the ±2 the settings screen offers', () => {
    expect(MAX_HIJRI_OFFSET).toBe(2);
    expect(clampHijriOffset(0)).toBe(0);
    expect(clampHijriOffset(2)).toBe(2);
    expect(clampHijriOffset(-2)).toBe(-2);
    expect(clampHijriOffset(7)).toBe(2);
    expect(clampHijriOffset(-7)).toBe(-2);
  });

  it('truncates fractions', () => {
    expect(clampHijriOffset(1.9)).toBe(1);
    expect(clampHijriOffset(-1.9)).toBe(-1);
    expect(clampHijriOffset(0.4)).toBe(0);
  });

  it('falls back to no offset for junk rather than to a limit', () => {
    // A corrupt persisted setting must show the unadjusted date, never silently shift it.
    expect(clampHijriOffset(Number.NaN)).toBe(0);
    expect(clampHijriOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampHijriOffset(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampHijriOffset('2' as unknown as number)).toBe(0);
    expect(clampHijriOffset(null as unknown as number)).toBe(0);
    expect(clampHijriOffset(undefined as unknown as number)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Month boundaries
// ---------------------------------------------------------------------------

describe('month boundaries', () => {
  it('starts a new month the day after a 29- or 30-day month ends', () => {
    const boundaries: [PrayerDay, HijriDate, PrayerDay, HijriDate][] = [
      ['2026-01-19', hijri(1447, 7, 30), '2026-01-20', hijri(1447, 8, 1)],
      ['2026-03-19', hijri(1447, 9, 30), '2026-03-20', hijri(1447, 10, 1)],
      ['2026-06-15', hijri(1447, 12, 29), '2026-06-16', hijri(1448, 1, 1)],
      ['2026-08-13', hijri(1448, 2, 30), '2026-08-14', hijri(1448, 3, 1)],
    ];
    for (const [lastDay, lastHijri, firstDay, firstHijri] of boundaries) {
      expect(toHijri(lastDay, 0)).toEqual(lastHijri);
      expect(toHijri(firstDay, 0)).toEqual(firstHijri);
      expect(toHijriTabular(lastDay, 0)).toEqual(lastHijri);
      expect(toHijriTabular(firstDay, 0)).toEqual(firstHijri);
    }
  });

  it('never skips or repeats a day across 50 years (2000–2050)', () => {
    const start = dayNumberOf('2000-01-01');
    const end = dayNumberOf('2050-01-01');
    let previous = toHijriTabular(dayOfNumber(start), 0);
    for (let dayNumber = start + 1; dayNumber <= end; dayNumber++) {
      const current = toHijriTabular(dayOfNumber(dayNumber), 0);
      if (current.day !== 1) {
        // Same month, next day.
        expect({ ...current, day: current.day - 1 }).toEqual(previous);
      } else if (current.month !== 1) {
        // New month: the previous day closed a 29- or 30-day month.
        expect(current.month).toBe(previous.month + 1);
        expect(current.year).toBe(previous.year);
        expect([29, 30]).toContain(previous.day);
      } else {
        // New year: the previous day was the last of Dhu al-Hijjah.
        expect(current.year).toBe(previous.year + 1);
        expect(previous.month).toBe(12);
        expect([29, 30]).toContain(previous.day);
      }
      previous = current;
    }
  });

  it('gives every Hijri year 354 or 355 days', () => {
    // Count days per Hijri year over a stretch of the table.
    const lengths = new Map<number, number>();
    for (
      let dayNumber = dayNumberOf('2000-01-01');
      dayNumber <= dayNumberOf('2050-01-01');
      dayNumber++
    ) {
      const { year } = toHijriTabular(dayOfNumber(dayNumber), 0);
      lengths.set(year, (lengths.get(year) ?? 0) + 1);
    }
    // Drop the partial years at each end of the window.
    const years = [...lengths.keys()].sort((a, b) => a - b).slice(1, -1);
    expect(years.length).toBeGreaterThan(45);
    for (const year of years) {
      expect([354, 355]).toContain(lengths.get(year));
    }
  });
});

// ---------------------------------------------------------------------------
// hijriFromDayNumber
// ---------------------------------------------------------------------------

describe('hijriFromDayNumber', () => {
  it('converts raw day numbers', () => {
    expect(hijriFromDayNumber(0)).toEqual(hijri(1389, 10, 22));
    expect(hijriFromDayNumber(dayNumberOf('2026-08-19'))).toEqual(hijri(1448, 3, 6));
    expect(hijriFromDayNumber(-31826)).toEqual(hijri(1300, 1, 1));
  });

  it('rejects non-integers', () => {
    expect(() => hijriFromDayNumber(1.5)).toThrow(RangeError);
    expect(() => hijriFromDayNumber(Number.NaN)).toThrow(RangeError);
    expect(() => hijriFromDayNumber(Number.MAX_VALUE)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// The Hermes / missing-Intl path
// ---------------------------------------------------------------------------

describe('engine selection', () => {
  it('uses Intl on a full-ICU engine like this one', () => {
    expect(isIntlUmalquraAvailable()).toBe(true);
    expect(activeHijriEngine()).toBe('intl');
  });

  // The `year > 2000` Gregorian-leak guard: an engine that ignores `-u-ca-islamic-umalqura`
  // answers with the Gregorian year, ~600 years ahead of any plausible Hijri year, and the
  // guard rejects it. Its cost is that legitimate Hijri years past 2000 (≈ CE 2564, four
  // centuries past the Umm al-Qura table's own end) also route to the tabular engine — a
  // clean fallback, never a crash. These pin the boundary on both sides.
  it('still answers via Intl at Hijri year 2000, the last year the guard admits', () => {
    expect(activeHijriEngine()).toBe('intl');
    expect(toHijri('2562-07-15', 0)).toEqual(hijri(2000, 7, 12));
  });

  it('routes Hijri years past 2000 to the tabular engine instead of trusting Intl', () => {
    expect(activeHijriEngine()).toBe('intl');
    // Both engines agree out here (past the table, ICU degrades to the same arithmetic),
    // so equality with the tabular answer proves the fallback path stayed sound.
    expect(toHijri('2563-07-15', 0)).toEqual(toHijriTabular('2563-07-15', 0));
    expect(toHijri('2563-07-15', 0)).toEqual(hijri(2001, 7, 23));
  });

  it('falls back to the table when Intl is missing entirely', () => {
    withIntl(undefined, () => {
      expect(isIntlUmalquraAvailable()).toBe(false);
      expect(activeHijriEngine()).toBe('tabular');
      expect(toHijriIntl('2026-08-19', 0)).toBeNull();
      // The app still shows the right date instead of crashing.
      expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
      expect(toHijri('2026-06-16', -1)).toEqual(hijri(1447, 12, 29));
    });
  });

  it('falls back when Intl ignores the calendar extension (the Hermes case)', () => {
    // A cut-down Hermes resolves to `gregory` and answers in the Gregorian calendar.
    const gregorianOnly = {
      DateTimeFormat: class {
        resolvedOptions(): { calendar: string } {
          return { calendar: 'gregory' };
        }
        formatToParts(): { type: string; value: string }[] {
          return [
            { type: 'month', value: '8' },
            { type: 'day', value: '19' },
            { type: 'year', value: '2026' },
          ];
        }
      },
    };
    withIntl(gregorianOnly, () => {
      expect(isIntlUmalquraAvailable()).toBe(false);
      expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
    });
  });

  it('falls back when Intl claims the calendar but answers wrongly', () => {
    // Claims islamic-umalqura, but returns Gregorian-shaped values: the probe catches it.
    const liar = {
      DateTimeFormat: class {
        resolvedOptions(): { calendar: string } {
          return { calendar: 'islamic-umalqura' };
        }
        formatToParts(): { type: string; value: string }[] {
          return [
            { type: 'month', value: '1' },
            { type: 'day', value: '1' },
            { type: 'year', value: '1400' },
          ];
        }
      },
    };
    withIntl(liar, () => {
      expect(isIntlUmalquraAvailable()).toBe(false);
      expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
    });
  });

  it('falls back when constructing the formatter throws', () => {
    const explosive = {
      DateTimeFormat: class {
        constructor() {
          throw new Error('unsupported locale extension');
        }
      },
    };
    withIntl(explosive, () => {
      expect(isIntlUmalquraAvailable()).toBe(false);
      expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
    });
  });

  it('falls back when the engine has no formatToParts', () => {
    const partless = {
      DateTimeFormat: class {
        resolvedOptions(): { calendar: string } {
          return { calendar: 'islamic-umalqura' };
        }
        format(): string {
          return '6/3/1448';
        }
      },
    };
    withIntl(partless, () => {
      expect(isIntlUmalquraAvailable()).toBe(false);
      expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
    });
  });

  it('falls back when the month arrives as a name instead of a number', () => {
    const realIntl = Intl;
    const namedMonths = {
      DateTimeFormat: class {
        private readonly inner: Intl.DateTimeFormat;
        constructor() {
          this.inner = new realIntl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            timeZone: 'UTC',
          });
        }
        resolvedOptions(): { calendar: string } {
          return { calendar: 'islamic-umalqura' };
        }
        formatToParts(date: Date): { type: string; value: string }[] {
          return this.inner
            .formatToParts(date)
            .map((part) => (part.type === 'month' ? { type: 'month', value: 'Rabiʻ I' } : part));
        }
      },
    };
    withIntl(namedMonths, () => {
      expect(isIntlUmalquraAvailable()).toBe(false);
      expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
    });
  });

  it('still uses Intl when the era is folded into the year part', () => {
    // Some engines return "1448 AH" as the year; defensive parsing must cope rather than
    // discard a perfectly good implementation.
    const realIntl = Intl;
    const eraInYear = {
      DateTimeFormat: class {
        private readonly inner: Intl.DateTimeFormat;
        constructor() {
          this.inner = new realIntl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            timeZone: 'UTC',
          });
        }
        resolvedOptions(): { calendar: string } {
          return { calendar: 'islamic-umalqura' };
        }
        formatToParts(date: Date): { type: string; value: string }[] {
          return this.inner
            .formatToParts(date)
            .map((part) =>
              part.type === 'year' ? { type: 'year', value: `${part.value} AH` } : part
            )
            .concat([{ type: 'era', value: 'AH' }]);
        }
      },
    };
    withIntl(eraInYear, () => {
      expect(isIntlUmalquraAvailable()).toBe(true);
      expect(activeHijriEngine()).toBe('intl');
      expect(toHijriIntl('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
      expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
    });
  });

  it('produces identical dates on both engines for every known date', () => {
    const viaIntl = KNOWN.map(({ gregorian }) => toHijri(gregorian, 0));
    let viaTable: HijriDate[] = [];
    withIntl(undefined, () => {
      viaTable = KNOWN.map(({ gregorian }) => toHijri(gregorian, 0));
    });
    expect(viaTable).toEqual(viaIntl);
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe('formatHijri', () => {
  const date = hijri(1448, 1, 16);

  it('defaults to day + month for the Today header', () => {
    expect(formatHijri(date)).toEqual({
      date,
      monthKey: 'hijri.months.muharram',
      tokens: [
        { type: 'day', value: 16 },
        { type: 'month', value: 1, key: 'hijri.months.muharram' },
      ],
    });
  });

  it('adds the year for the History day detail', () => {
    expect(formatHijri(date, { style: 'dayMonthYear' }).tokens).toEqual([
      { type: 'day', value: 16 },
      { type: 'month', value: 1, key: 'hijri.months.muharram' },
      { type: 'year', value: 1448 },
    ]);
  });

  it('emits month + year for the History header', () => {
    expect(formatHijri(date, { style: 'monthYear' }).tokens).toEqual([
      { type: 'month', value: 1, key: 'hijri.months.muharram' },
      { type: 'year', value: 1448 },
    ]);
  });

  it('emits the month alone', () => {
    expect(formatHijri(date, { style: 'monthOnly' }).tokens).toEqual([
      { type: 'month', value: 1, key: 'hijri.months.muharram' },
    ]);
  });

  it('appends the era key only when asked', () => {
    expect(formatHijri(date, { includeEra: true }).tokens).toContainEqual({
      type: 'era',
      key: HIJRI_ERA_KEY,
    });
    expect(formatHijri(date, { includeEra: false }).tokens.some((t) => t.type === 'era')).toBe(
      false
    );
    expect(formatHijri(date).tokens.some((t) => t.type === 'era')).toBe(false);
    expect(HIJRI_ERA_KEY).toBe('hijri.era.ah');
  });

  it('never leaks a display string — every string it emits is an i18n key', () => {
    for (let month = 1; month <= 12; month++) {
      const formatted = formatHijri(hijri(1448, month, 1), {
        style: 'dayMonthYear',
        includeEra: true,
      });
      expect(formatted.monthKey).toBe(HIJRI_MONTH_KEYS[month - 1]);
      for (const token of formatted.tokens) {
        if (token.type === 'month') expect(token.key).toBe(HIJRI_MONTH_KEYS[month - 1]);
        if (token.type === 'era') expect(token.key).toBe(HIJRI_ERA_KEY);
      }
      // Every string anywhere in the result is namespaced under `hijri.` — no English,
      // no separators, nothing the i18n layer has not authored.
      const strings = JSON.stringify(formatted).match(/"[^"]*"/g) ?? [];
      const values = strings.filter(
        (quoted) =>
          !['"date"', '"monthKey"', '"tokens"', '"type"', '"value"', '"key"'].includes(quoted)
      );
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(value).toMatch(/^"(hijri\.[a-zA-Z.]+|day|month|year|era)"$/);
      }
    }
  });

  it('keeps tokens in reading order for RTL locales to mirror, not reorder', () => {
    const tokens = formatHijri(date, { style: 'dayMonthYear', includeEra: true }).tokens;
    expect(tokens.map((token) => token.type)).toEqual(['day', 'month', 'year', 'era']);
  });

  it('copies the date so callers cannot mutate the source', () => {
    const source = hijri(1448, 1, 16);
    const formatted = formatHijri(source);
    expect(formatted.date).not.toBe(source);
    formatted.date.day = 1;
    expect(source.day).toBe(16);
  });

  it('round-trips a converted date', () => {
    const converted = toHijri('2026-07-02', -1);
    const formatted = formatHijri(converted, { style: 'dayMonthYear' });
    expect(formatted.date).toEqual(hijri(1448, 1, 16));
    expect(formatted.monthKey).toBe('hijri.months.muharram');
  });

  it('rejects impossible Hijri dates', () => {
    expect(() => formatHijri(hijri(1448, 0, 1))).toThrow(RangeError);
    expect(() => formatHijri(hijri(1448, 13, 1))).toThrow(RangeError);
    expect(() => formatHijri(hijri(1448, 1, 0))).toThrow(RangeError);
    expect(() => formatHijri(hijri(1448, 1, 31))).toThrow(RangeError);
    expect(() => formatHijri(hijri(1448, 1, 1.5))).toThrow(RangeError);
    expect(() => formatHijri(null as unknown as HijriDate)).toThrow(RangeError);
  });

  it('rejects an unknown style', () => {
    expect(() => formatHijri(date, { style: 'yearOnly' as unknown as 'dayMonth' })).toThrow(
      RangeError
    );
  });
});

// ---------------------------------------------------------------------------
// The History header span
// ---------------------------------------------------------------------------

describe('hijriMonthSpanForGregorianMonth', () => {
  it('spans two Hijri months in the typical case (July 2026 → Muharram/Safar)', () => {
    // PRODUCT_SPEC §8's own example: "July · Muḥarram/Ṣafar".
    const span = hijriMonthSpanForGregorianMonth(2026, 6, 0);
    expect(span.months).toEqual([
      { year: 1448, month: 1, monthKey: 'hijri.months.muharram' },
      { year: 1448, month: 2, monthKey: 'hijri.months.safar' },
    ]);
    expect(span.start).toEqual(hijri(1448, 1, 16));
    expect(span.end).toEqual(hijri(1448, 2, 17));
  });

  it('spans a single Hijri month when February fits inside one (Feb 2025 → Shaban 1446)', () => {
    const span = hijriMonthSpanForGregorianMonth(2025, 1, 0);
    expect(span.months).toEqual([{ year: 1446, month: 8, monthKey: 'hijri.months.shaban' }]);
    expect(span.start).toEqual(hijri(1446, 8, 2));
    expect(span.end).toEqual(hijri(1446, 8, 29));
  });

  it('spans three Hijri months across a Hijri year boundary (August 2019)', () => {
    // 2019-08-01 is 29 Dhu al-Qi'dah 1440 and 2019-08-31 is 1 Muharram 1441, so the
    // whole of Dhu al-Hijjah 1440 sits in between.
    const span = hijriMonthSpanForGregorianMonth(2019, 7, 0);
    expect(span.months).toEqual([
      { year: 1440, month: 11, monthKey: 'hijri.months.dhuAlQidah' },
      { year: 1440, month: 12, monthKey: 'hijri.months.dhuAlHijjah' },
      { year: 1441, month: 1, monthKey: 'hijri.months.muharram' },
    ]);
    expect(span.start).toEqual(hijri(1440, 11, 29));
    expect(span.end).toEqual(hijri(1441, 1, 1));
  });

  it('carries the Hijri year change inside the span (June 2026)', () => {
    const span = hijriMonthSpanForGregorianMonth(2026, 5, 0);
    expect(span.months).toEqual([
      { year: 1447, month: 12, monthKey: 'hijri.months.dhuAlHijjah' },
      { year: 1448, month: 1, monthKey: 'hijri.months.muharram' },
    ]);
    expect(span.start.year).toBe(1447);
    expect(span.end.year).toBe(1448);
  });

  it('applies the offset to both endpoints', () => {
    const plain = hijriMonthSpanForGregorianMonth(2026, 5, 0);
    const shifted = hijriMonthSpanForGregorianMonth(2026, 5, 2);
    expect(shifted.start).toEqual(toHijri('2026-06-01', 2));
    expect(shifted.end).toEqual(toHijri('2026-06-30', 2));
    expect(shifted.start).not.toEqual(plain.start);
    // Two days later the month still straddles the same new-year boundary.
    expect(shifted.months.map((month) => month.month)).toEqual([12, 1]);
  });

  it('agrees with converting the first and last day directly, for every month 2000–2100', () => {
    for (let year = 2000; year <= 2100; year++) {
      for (let monthIndex0 = 0; monthIndex0 < 12; monthIndex0++) {
        const span = hijriMonthSpanForGregorianMonth(year, monthIndex0, 0);
        const monthNumber = String(monthIndex0 + 1).padStart(2, '0');
        const firstDay = `${year}-${monthNumber}-01` as PrayerDay;
        expect(span.start).toEqual(toHijri(firstDay, 0));

        // 1…3 distinct months, ascending and contiguous.
        expect(span.months.length).toBeGreaterThanOrEqual(1);
        expect(span.months.length).toBeLessThanOrEqual(3);
        for (let index = 1; index < span.months.length; index++) {
          const previous = span.months[index - 1];
          const current = span.months[index];
          const expectedMonth = previous.month === 12 ? 1 : previous.month + 1;
          const expectedYear = previous.month === 12 ? previous.year + 1 : previous.year;
          expect(current.month).toBe(expectedMonth);
          expect(current.year).toBe(expectedYear);
        }
        // The endpoints are the first and last entries.
        expect(span.months[0]).toEqual({
          year: span.start.year,
          month: span.start.month,
          monthKey: hijriMonthKey(span.start.month),
        });
        expect(span.months[span.months.length - 1]).toEqual({
          year: span.end.year,
          month: span.end.month,
          monthKey: hijriMonthKey(span.end.month),
        });
      }
    }
  });

  it('handles February in a leap year', () => {
    const span = hijriMonthSpanForGregorianMonth(2028, 1, 0);
    expect(span.end).toEqual(toHijri('2028-02-29', 0));
  });

  it('handles December, where the Gregorian year rolls over next', () => {
    const span = hijriMonthSpanForGregorianMonth(2026, 11, 0);
    expect(span.start).toEqual(toHijri('2026-12-01', 0));
    expect(span.end).toEqual(toHijri('2026-12-31', 0));
  });

  it('produces the same span on the fallback engine', () => {
    const viaIntl = hijriMonthSpanForGregorianMonth(2019, 7, 0);
    withIntl(undefined, () => {
      expect(hijriMonthSpanForGregorianMonth(2019, 7, 0)).toEqual(viaIntl);
    });
  });

  it('rejects invalid months, years and offsets', () => {
    expect(() => hijriMonthSpanForGregorianMonth(2026, 12, 0)).toThrow(RangeError);
    expect(() => hijriMonthSpanForGregorianMonth(2026, -1, 0)).toThrow(RangeError);
    expect(() => hijriMonthSpanForGregorianMonth(2026, 1.5, 0)).toThrow(RangeError);
    expect(() => hijriMonthSpanForGregorianMonth(2026.5, 1, 0)).toThrow(RangeError);
    expect(() => hijriMonthSpanForGregorianMonth(2026, 6, 0.5)).toThrow(RangeError);
    expect(() => hijriMonthSpanForGregorianMonth(2026, 6, Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Timezone robustness
// ---------------------------------------------------------------------------

describe('timezone independence', () => {
  const zones = [
    'UTC',
    'Europe/Istanbul',
    'Pacific/Kiritimati',
    'Pacific/Niue',
    'America/New_York',
  ];

  it('returns the same Hijri date in every timezone', () => {
    const originalTz = process.env.TZ;
    try {
      for (const zone of zones) {
        process.env.TZ = zone;
        resetHijriEngineCache();
        for (const { gregorian, expected } of KNOWN) {
          expect(toHijri(gregorian, 0)).toEqual(expected);
          expect(toHijriTabular(gregorian, 0)).toEqual(expected);
        }
        // A day either side of midnight in the extreme zones, where a local-time read
        // would shift the calendar date.
        expect(toHijri('2026-08-19', 0)).toEqual(hijri(1448, 3, 6));
        expect(hijriMonthSpanForGregorianMonth(2026, 6, 0).months).toHaveLength(2);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
      resetHijriEngineCache();
    }
  });

  it('gives a freshly loaded module the same answers under an extreme timezone', () => {
    // The module builds its year-start table and probes Intl at load time, so reload it
    // under each zone. `jest.isolateModules` is synchronous, which rules out `import()`;
    // `require` is the only way to re-evaluate the module here.
    const loadFresh = (): typeof import('./hijri') =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./hijri') as typeof import('./hijri');
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      jest.isolateModules(() => {
        const fresh = loadFresh();
        for (const { gregorian, expected } of KNOWN) {
          expect(fresh.toHijri(gregorian, 0)).toEqual(expected);
        }
      });
      process.env.TZ = 'Pacific/Niue'; // UTC−11
      jest.isolateModules(() => {
        const fresh = loadFresh();
        for (const { gregorian, expected } of KNOWN) {
          expect(fresh.toHijri(gregorian, 0)).toEqual(expected);
        }
      });
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});
