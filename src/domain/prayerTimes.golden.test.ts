/**
 * Golden reference values for prayer-time computation — the tripwire for dependency drift.
 *
 * Every other prayer-time test asserts relative properties (ordering, plausible bands,
 * no-throw), which means a change in adhan's angles, rounding, or solar math could pass the
 * entire suite while silently moving every displayed time. This file pins **absolute
 * wall-clock values** for a matrix of city × method × season, frozen against adhan 4.4.4,
 * and sanity-checked against the shape each authority
 * publishes (Umm al-Qura's fixed Maghrib+90 Isha, the Moonsighting Committee's seasonal
 * twilight, Jafari's 4° Maghrib sitting inside Tehran's 4.5°, …).
 *
 * The dependency range is deliberately a caret (owner decision, 2026-08-27): upgrades are
 * allowed to flow, and THIS FILE is what makes that safe — an upgrade that moves a value
 * fails the build. When that happens, verify the new output against the authority's
 * published timetable for that city, then update the row — never widen a tolerance to make
 * the diff go away.
 *
 * The computation is timezone-independent (see prayerTimes.test.ts's module header), so the
 * frozen values are rendered into each city's own IANA zone with `Intl` and the tests run
 * identically under any device TZ.
 */

import { computeDayTimes, getPrayerWindows, type TimesLocation } from './prayerTimes';
import type { CalculationSettings, PrayerDay } from './types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const noOffsets = () => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });

function settings(overrides: Partial<CalculationSettings> = {}): CalculationSettings {
  return {
    method: 'auto',
    madhab: 'shafi',
    highLatitudeRule: 'auto',
    offsets: noOffsets(),
    hijriOffset: 0,
    ...overrides,
  };
}

/** An instant rendered as HH:mm in an explicit IANA zone — never the device clock. */
function hhmm(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

const MARKERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

interface GoldenRow {
  city: string;
  location: TimesLocation;
  zone: string;
  /** Explicit method for rows that bypass the country map; otherwise `auto` resolves it. */
  method?: CalculationSettings['method'];
  /** The concrete method `auto` must resolve to — pins COUNTRY_METHOD_MAP as a side effect. */
  resolved: string;
  day: PrayerDay;
  expected: Record<(typeof MARKERS)[number], string>;
}

const ISTANBUL: TimesLocation = { latitude: 41.0082, longitude: 28.9784, countryCode: 'TR' };
const NEW_YORK: TimesLocation = { latitude: 40.7128, longitude: -74.006, countryCode: 'US' };
const MECCA: TimesLocation = { latitude: 21.4225, longitude: 39.8262, countryCode: 'SA' };
const KARACHI: TimesLocation = { latitude: 24.8607, longitude: 67.0011, countryCode: 'PK' };
const CAIRO: TimesLocation = { latitude: 30.0444, longitude: 31.2357, countryCode: 'EG' };
const LONDON: TimesLocation = { latitude: 51.5074, longitude: -0.1278, countryCode: 'GB' };
const JAKARTA: TimesLocation = { latitude: -6.2088, longitude: 106.8456, countryCode: 'ID' };
const TEHRAN: TimesLocation = { latitude: 35.6892, longitude: 51.389, countryCode: 'IR' };
const DUBAI: TimesLocation = { latitude: 25.2048, longitude: 55.2708, countryCode: 'AE' };
const SYDNEY: TimesLocation = { latitude: -33.8688, longitude: 151.2093, countryCode: 'AU' };
const CAPE_TOWN: TimesLocation = { latitude: -33.9249, longitude: 18.4241, countryCode: 'ZA' };

// prettier-ignore
const GOLDEN: GoldenRow[] = [
  { city: 'Istanbul', location: ISTANBUL, zone: 'Europe/Istanbul', resolved: 'turkey', day: '2026-01-15',
    expected: { fajr: '06:50', sunrise: '08:20', dhuhr: '13:18', asr: '15:46', maghrib: '18:07', isha: '19:32' } },
  { city: 'Istanbul', location: ISTANBUL, zone: 'Europe/Istanbul', resolved: 'turkey', day: '2026-08-19',
    expected: { fajr: '04:35', sunrise: '06:11', dhuhr: '13:13', asr: '16:59', maghrib: '20:04', isha: '21:33' } },
  { city: 'New York', location: NEW_YORK, zone: 'America/New_York', resolved: 'northAmerica', day: '2026-01-15',
    expected: { fajr: '05:58', sunrise: '07:18', dhuhr: '12:07', asr: '14:35', maghrib: '16:53', isha: '18:14' } },
  { city: 'New York', location: NEW_YORK, zone: 'America/New_York', resolved: 'northAmerica', day: '2026-08-19',
    expected: { fajr: '04:48', sunrise: '06:10', dhuhr: '13:01', asr: '16:46', maghrib: '19:48', isha: '21:10' } },
  { city: 'Mecca', location: MECCA, zone: 'Asia/Riyadh', resolved: 'ummAlQura', day: '2026-01-15',
    expected: { fajr: '05:41', sunrise: '07:01', dhuhr: '12:30', asr: '15:38', maghrib: '17:59', isha: '19:29' } },
  { city: 'Mecca', location: MECCA, zone: 'Asia/Riyadh', resolved: 'ummAlQura', day: '2026-08-19',
    expected: { fajr: '04:40', sunrise: '06:00', dhuhr: '12:24', asr: '15:47', maghrib: '18:48', isha: '20:18' } },
  { city: 'Karachi', location: KARACHI, zone: 'Asia/Karachi', resolved: 'karachi', day: '2026-01-15',
    expected: { fajr: '05:58', sunrise: '07:19', dhuhr: '12:42', asr: '15:44', maghrib: '18:04', isha: '19:24' } },
  { city: 'Karachi', location: KARACHI, zone: 'Asia/Karachi', resolved: 'karachi', day: '2026-08-19',
    expected: { fajr: '04:48', sunrise: '06:08', dhuhr: '12:37', asr: '16:04', maghrib: '19:03', isha: '20:23' } },
  { city: 'Cairo', location: CAIRO, zone: 'Africa/Cairo', resolved: 'egyptian', day: '2026-01-15',
    expected: { fajr: '05:21', sunrise: '06:52', dhuhr: '12:05', asr: '14:58', maghrib: '17:17', isha: '18:39' } },
  { city: 'Cairo', location: CAIRO, zone: 'Africa/Cairo', resolved: 'egyptian', day: '2026-08-19',
    expected: { fajr: '04:52', sunrise: '06:25', dhuhr: '13:00', asr: '16:34', maghrib: '19:32', isha: '20:55' } },
  { city: 'London', location: LONDON, zone: 'Europe/London', resolved: 'moonsightingCommittee', day: '2026-01-15',
    expected: { fajr: '06:20', sunrise: '07:59', dhuhr: '12:15', asr: '14:02', maghrib: '16:24', isha: '17:54' } },
  { city: 'London', location: LONDON, zone: 'Europe/London', resolved: 'moonsightingCommittee', day: '2026-08-19',
    expected: { fajr: '04:10', sunrise: '05:52', dhuhr: '13:09', asr: '16:59', maghrib: '20:18', isha: '21:24' } },
  // Asr here lands on an exact minute (15:27:00): stock adhan's Rounding.Up bug pushed it to
  // 15:28; the patched round-up (patches/adhan@4.4.4.patch, D122) keeps the true value.
  { city: 'Jakarta', location: JAKARTA, zone: 'Asia/Jakarta', resolved: 'singapore', day: '2026-01-15',
    expected: { fajr: '04:25', sunrise: '05:49', dhuhr: '12:03', asr: '15:27', maghrib: '18:16', isha: '19:31' } },
  { city: 'Jakarta', location: JAKARTA, zone: 'Asia/Jakarta', resolved: 'singapore', day: '2026-08-19',
    expected: { fajr: '04:40', sunrise: '05:59', dhuhr: '11:58', asr: '15:18', maghrib: '17:55', isha: '19:05' } },
  { city: 'Tehran', location: TEHRAN, zone: 'Asia/Tehran', resolved: 'tehran', day: '2026-01-15',
    expected: { fajr: '05:45', sunrise: '07:14', dhuhr: '12:14', asr: '14:55', maghrib: '17:34', isha: '18:24' } },
  { city: 'Tehran', location: TEHRAN, zone: 'Asia/Tehran', resolved: 'tehran', day: '2026-08-19',
    expected: { fajr: '03:55', sunrise: '05:26', dhuhr: '12:08', asr: '15:50', maghrib: '19:08', isha: '19:59' } },
  { city: 'Dubai', location: DUBAI, zone: 'Asia/Dubai', resolved: 'dubai', day: '2026-01-15',
    expected: { fajr: '05:45', sunrise: '07:03', dhuhr: '12:31', asr: '15:33', maghrib: '17:54', isha: '19:12' } },
  { city: 'Dubai', location: DUBAI, zone: 'Asia/Dubai', resolved: 'dubai', day: '2026-08-19',
    expected: { fajr: '04:33', sunrise: '05:51', dhuhr: '12:26', asr: '15:54', maghrib: '18:54', isha: '20:12' } },
  { city: 'Tehran (Jafari)', location: { latitude: 35.6892, longitude: 51.389 }, zone: 'Asia/Tehran',
    method: 'jafari', resolved: 'jafari', day: '2026-01-15',
    expected: { fajr: '05:54', sunrise: '07:14', dhuhr: '12:14', asr: '14:55', maghrib: '17:31', isha: '18:24' } },
  { city: 'Tehran (Jafari)', location: { latitude: 35.6892, longitude: 51.389 }, zone: 'Asia/Tehran',
    method: 'jafari', resolved: 'jafari', day: '2026-08-19',
    expected: { fajr: '04:05', sunrise: '05:26', dhuhr: '12:08', asr: '15:50', maghrib: '19:06', isha: '19:59' } },
  // Southern hemisphere — January is the LONG day at −33°, August the short one.
  { city: 'Sydney', location: SYDNEY, zone: 'Australia/Sydney', resolved: 'muslimWorldLeague', day: '2026-01-15',
    expected: { fajr: '04:19', sunrise: '05:59', dhuhr: '13:05', asr: '16:49', maghrib: '20:09', isha: '21:43' } },
  { city: 'Sydney', location: SYDNEY, zone: 'Australia/Sydney', resolved: 'muslimWorldLeague', day: '2026-08-19',
    expected: { fajr: '05:06', sunrise: '06:30', dhuhr: '12:00', asr: '15:04', maghrib: '17:28', isha: '18:47' } },
  { city: 'Cape Town', location: CAPE_TOWN, zone: 'Africa/Johannesburg', resolved: 'muslimWorldLeague', day: '2026-01-15',
    expected: { fajr: '04:11', sunrise: '05:51', dhuhr: '12:57', asr: '16:40', maghrib: '20:00', isha: '21:34' } },
  { city: 'Cape Town', location: CAPE_TOWN, zone: 'Africa/Johannesburg', resolved: 'muslimWorldLeague', day: '2026-08-19',
    expected: { fajr: '05:57', sunrise: '07:21', dhuhr: '12:51', asr: '15:56', maghrib: '18:19', isha: '19:39' } },
];

// The same engine decades out: adhan's NOAA-style solar math has no epoch tables to outrun,
// and these rows prove it stays put (Mecca 2100's winter day differs from 2026's by ≤1 min).
// prettier-ignore
const GOLDEN_FUTURE: GoldenRow[] = [
  { city: 'Istanbul', location: ISTANBUL, zone: 'Europe/Istanbul', resolved: 'turkey', day: '2050-06-21',
    expected: { fajr: '03:24', sunrise: '05:25', dhuhr: '13:11', asr: '17:11', maghrib: '20:47', isha: '22:38' } },
  { city: 'Mecca', location: MECCA, zone: 'Asia/Riyadh', resolved: 'ummAlQura', day: '2100-01-15',
    expected: { fajr: '05:40', sunrise: '07:01', dhuhr: '12:30', asr: '15:38', maghrib: '17:59', isha: '19:29' } },
];

// ---------------------------------------------------------------------------
// Golden matrix
// ---------------------------------------------------------------------------

describe.each([
  ['golden reference values (adhan 4.4.4)', GOLDEN],
  ['golden reference values decades out', GOLDEN_FUTURE],
] as const)('%s', (_label, rows) => {
  it.each(rows.map((row) => [row.city, row.day, row] as const))(
    '%s on %s matches the frozen timetable to the minute',
    (_city, _day, row) => {
      const result = computeDayTimes(row.day, row.location, settings({ method: row.method ?? 'auto' }));
      expect(result.method).toBe(row.resolved);
      const actual = Object.fromEntries(
        MARKERS.map((marker) => [marker, hhmm(result.times[marker], row.zone)])
      );
      expect(actual).toEqual(row.expected);
    }
  );
});

// ---------------------------------------------------------------------------
// Authority-shape cross-checks (relationships an upgrade must also preserve)
// ---------------------------------------------------------------------------

describe('authority shapes', () => {
  it('Umm al-Qura Isha is exactly Maghrib + 90 minutes, both seasons', () => {
    for (const day of ['2026-01-15', '2026-08-19'] as PrayerDay[]) {
      const { times } = computeDayTimes(day, MECCA, settings());
      expect(times.isha.getTime() - times.maghrib.getTime()).toBe(90 * 60_000);
    }
  });

  it('Jafari Maghrib (4°) falls inside Tehran Maghrib (4.5°), after sunset', () => {
    const location = { latitude: 35.6892, longitude: 51.389 };
    for (const day of ['2026-01-15', '2026-08-19'] as PrayerDay[]) {
      const jafari = computeDayTimes(day, location, settings({ method: 'jafari' })).times;
      const tehran = computeDayTimes(day, location, settings({ method: 'tehran' })).times;
      expect(jafari.maghrib.getTime()).toBeGreaterThan(jafari.sunrise.getTime());
      expect(jafari.maghrib.getTime()).toBeLessThanOrEqual(tehran.maghrib.getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// Supported-range boundaries (dates.ts promises years 0000–9999)
// ---------------------------------------------------------------------------

describe('supported-range boundaries', () => {
  it('computes the first and last supportable days without NaN', () => {
    for (const day of ['0001-01-01', '9999-12-30'] as PrayerDay[]) {
      const { times } = computeDayTimes(day, MECCA, settings());
      for (const marker of MARKERS) {
        expect(Number.isFinite(times[marker].getTime())).toBe(true);
      }
    }
  });

  it("the final day's windows throw a clean RangeError (Isha needs year-10000 Fajr), never NaN", () => {
    expect(() => getPrayerWindows('9999-12-31', MECCA, settings())).toThrow(RangeError);
    // …while the day's own markers still compute (adhan handles the next-day hop internally).
    expect(() => computeDayTimes('9999-12-31', MECCA, settings())).not.toThrow();
  });
});
