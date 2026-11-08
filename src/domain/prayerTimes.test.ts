/**
 * Tests for prayer-time computation.
 *
 * ## Timezone strategy (read this before adding a test)
 *
 * The computation itself is **timezone-independent**: `parseDay` hands adhan a local midnight and
 * adhan reads only its year/month/date fields, so the same `(day, location, settings)` produces
 * the same absolute instants on a laptop in Istanbul and in a UTC CI runner. The harness proves
 * that (`describe('timezone independence')`) rather than assuming it, and every in-process
 * assertion about a *wall clock* renders the instant into an explicit IANA zone with `Intl`
 * (`zoned()`), never with `Date.prototype.getHours` — so nothing here depends on `TZ`.
 *
 * Two functions genuinely read the device zone, because a prayer day is a local calendar date:
 * `getCurrentPrayerDay` and `getCurrentPrayer`. Those are tested against *real* zones
 * (Europe/Istanbul, America/New_York, Europe/Berlin, Europe/Oslo) in a child process, exactly as
 * `dates.test.ts` does and for the same reason: Jest hands tests a *copy* of `process.env`, so
 * assigning `process.env.TZ` never reaches Node's real environment and V8's zone stays whatever
 * the machine has. `inTimeZone()` therefore transpiles `types/dates/methods/windows/prayerTimes` to ESM
 * once, symlinks the repo's `node_modules` next to them (adhan ships `"type": "module"`, so the
 * child must be ESM and must resolve the bare specifier `adhan`), and runs a probe under a real
 * `TZ`. `describe('timezone harness')` fails loudly if any of that stops working, so the DST
 * tests can never silently become vacuous.
 *
 * ## DST (PRODUCT_SPEC §3 — "a first-class requirement")
 *
 * The sharp assertion is `wall-clock minutes − elapsed minutes === ±60` across a transition night:
 * an implementation that adds hours to a local time instead of milliseconds to an instant gets
 * that wrong, and the Isha window — which always crosses midnight — is where it shows up.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as ts from 'typescript';

import {
  computeDayTimes,
  getCurrentPrayer,
  getCurrentPrayerDay,
  getIshaNudgeTime,
  getIshaNudgeTimeFrom,
  getNextPrayer,
  getPrayerWindows,
  type TimesLocation,
} from './prayerTimes';
import {
  PRAYERS,
  TIME_MARKERS,
  type CalculationSettings,
  type Prayer,
  type PrayerDay,
  type PrayerOffsets,
} from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISTANBUL: TimesLocation = { latitude: 41.0082, longitude: 28.9784, countryCode: 'TR' };
const NEW_YORK: TimesLocation = { latitude: 40.7128, longitude: -74.006, countryCode: 'US' };
const BERLIN: TimesLocation = { latitude: 52.52, longitude: 13.405, countryCode: 'DE' };
const MECCA: TimesLocation = { latitude: 21.4225, longitude: 39.8262, countryCode: 'SA' };
const TROMSO: TimesLocation = { latitude: 69.6492, longitude: 18.9553, countryCode: 'NO' };
const LONGYEARBYEN: TimesLocation = { latitude: 78.2232, longitude: 15.6469, countryCode: 'NO' };

/** A quiet summer day with nothing special about it — the baseline for the Istanbul assertions. */
const SUMMER_DAY: PrayerDay = '2026-08-19';
const NEXT_SUMMER_DAY: PrayerDay = '2026-08-20';
const WINTER_DAY: PrayerDay = '2026-01-15';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const SOLAR_ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

const noOffsets = (): PrayerOffsets => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });

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

function withOffsets(partial: Partial<PrayerOffsets>): CalculationSettings {
  return settings({ offsets: { ...noOffsets(), ...partial } });
}

/** An instant rendered in an explicit IANA zone — the only way this file reads a wall clock. */
function zoned(
  instant: Date,
  timeZone: string
): { day: PrayerDay; hhmm: string; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: `${field('year')}-${field('month')}-${field('day')}`,
    hhmm: `${field('hour')}:${field('minute')}`,
    minuteOfDay: Number(field('hour')) * 60 + Number(field('minute')),
  };
}

/** Runs `factory` at most once, on first use — harness calls must wait for `beforeAll`. */
function lazy<T>(factory: () => T): () => T {
  let value: T;
  let resolved = false;
  return () => {
    if (!resolved) {
      value = factory();
      resolved = true;
    }
    return value;
  };
}

// ---------------------------------------------------------------------------
// Real-timezone harness
// ---------------------------------------------------------------------------

interface ProbeApi {
  prayerTimes: typeof import('./prayerTimes');
  dates: typeof import('./dates');
  /** JSON payload handed to the probe, since a probe cannot close over anything. */
  payload: Record<string, unknown>;
}

const MODULES_UNDER_TEST = ['types', 'dates', 'methods', 'windows', 'prayerTimes'] as const;

/** Directory holding the transpiled ESM copies + a `node_modules` symlink. Built once. */
let probeDirectory = '';

beforeAll(() => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  probeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-prayer-times-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(probeDirectory, 'node_modules'));

  for (const name of MODULES_UNDER_TEST) {
    const original = fs.readFileSync(path.join(__dirname, `${name}.ts`), 'utf8');
    // ESM needs file extensions; the domain modules import each other as `'./dates'`.
    const source = original.replace(/(from\s+')(\.\/[A-Za-z]+)(')/g, '$1$2.mjs$3');
    if (/from\s+'\.\/[A-Za-z]+'/.test(source)) {
      throw new Error(`Failed to rewrite relative imports of ${name}.ts for the ESM probe`);
    }
    const compiled = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    fs.writeFileSync(path.join(probeDirectory, `${name}.mjs`), compiled);
  }

  fs.writeFileSync(
    path.join(probeDirectory, 'probe.mjs'),
    [
      "const prayerTimes = await import('./prayerTimes.mjs');",
      "const dates = await import('./dates.mjs');",
      // The probe source comes from this test file, never from user input.
      "const probe = new Function('api', 'return (' + process.argv[2] + ')(api)');",
      'const payload = JSON.parse(process.argv[3]);',
      'console.log(JSON.stringify(probe({ prayerTimes, dates, payload })));',
    ].join('\n')
  );
});

afterAll(() => {
  if (probeDirectory === '') return;
  // Unlink the symlink explicitly before removing the directory: never risk recursing into the
  // repo's node_modules.
  try {
    fs.unlinkSync(path.join(probeDirectory, 'node_modules'));
  } catch {
    /* already gone */
  }
  fs.rmSync(probeDirectory, { recursive: true, force: true });
});

/**
 * Runs `probe` in a child process whose local timezone really is `timeZone`.
 *
 * `probe` is shipped as source text, so it must be self-contained: no closure variables, no
 * imports, and only values that survive `JSON`. Anything it needs from the test goes in `payload`.
 */
function inTimeZone<T>(
  timeZone: string,
  probe: (api: ProbeApi) => unknown,
  payload: Record<string, unknown> = {}
): T {
  const output = execFileSync(
    process.execPath,
    [path.join(probeDirectory, 'probe.mjs'), probe.toString(), JSON.stringify(payload)],
    { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' }
  );
  return JSON.parse(output) as T;
}

/** Payload used by most harness calls: a location plus the settings under test. */
function probePayload(
  location: TimesLocation,
  config: CalculationSettings = settings()
): Record<string, unknown> {
  return { location, settings: config };
}

// ===========================================================================
// Harness sanity — if these fail, every timezone-sensitive test below is a lie
// ===========================================================================

describe('timezone harness', () => {
  it('really runs the child process in the requested timezone', () => {
    for (const zone of ['Europe/Istanbul', 'America/New_York', 'UTC', 'Australia/Lord_Howe']) {
      const report = inTimeZone<{ timeZone: string }>(zone, () => ({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
      expect(report.timeZone).toBe(zone);
    }
  });

  it('runs the module under test, not a stub', () => {
    const report = inTimeZone<{ exports: string[]; method: string }>(
      'Europe/Istanbul',
      (api) => ({
        exports: Object.keys(api.prayerTimes).sort(),
        method: api.prayerTimes.computeDayTimes(
          api.payload.day as PrayerDay,
          api.payload.location as TimesLocation,
          api.payload.settings as CalculationSettings
        ).method,
      }),
      { ...probePayload(ISTANBUL), day: SUMMER_DAY }
    );
    expect(report.exports).toEqual([
      'computeDayTimes',
      'getCurrentPrayer',
      'getCurrentPrayerDay',
      'getIshaNudgeTime',
      'getIshaNudgeTimeFrom',
      'getNextPrayer',
      'getPrayerWindows',
    ]);
    expect(report.method).toBe('turkey');
  });
});

describe('timezone independence', () => {
  it('computes identical instants whatever the device timezone is', () => {
    const inProcess = computeDayTimes(SUMMER_DAY, ISTANBUL, settings());
    const expected = Object.fromEntries(
      TIME_MARKERS.map((marker) => [marker, inProcess.times[marker].toISOString()])
    );

    for (const zone of ['UTC', 'Europe/Istanbul', 'America/New_York', 'Pacific/Kiritimati']) {
      const report = inTimeZone<Record<string, string>>(
        zone,
        (api) => {
          const times = api.prayerTimes.computeDayTimes(
            api.payload.day as PrayerDay,
            api.payload.location as TimesLocation,
            api.payload.settings as CalculationSettings
          ).times;
          const out: Record<string, string> = {};
          for (const key of Object.keys(times)) {
            out[key] = (times as unknown as Record<string, Date>)[key].toISOString();
          }
          return out;
        },
        { ...probePayload(ISTANBUL), day: SUMMER_DAY }
      );
      expect(report).toEqual(expected);
    }
  });

  it('answers the same next prayer whatever the device timezone is', () => {
    // An absolute instant, so no local-time literal is involved on either side.
    const now = new Date(Date.UTC(2026, 7, 19, 12, 0, 0));
    const inProcess = getNextPrayer(now, ISTANBUL, settings());

    for (const zone of ['UTC', 'Europe/Istanbul', 'America/Anchorage']) {
      const report = inTimeZone<{ prayer: string; day: string; at: string }>(
        zone,
        (api) => {
          const next = api.prayerTimes.getNextPrayer(
            new Date(api.payload.nowMs as number),
            api.payload.location as TimesLocation,
            api.payload.settings as CalculationSettings
          );
          return { prayer: next.prayer, day: next.day, at: next.at.toISOString() };
        },
        { ...probePayload(ISTANBUL), nowMs: now.getTime() }
      );
      expect(report).toEqual({
        prayer: inProcess.prayer,
        day: inProcess.day,
        at: inProcess.at.toISOString(),
      });
    }
  });
});

// ===========================================================================
// computeDayTimes
// ===========================================================================

describe('computeDayTimes (Istanbul sanity check)', () => {
  const times = computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times;
  const wall = (marker: (typeof TIME_MARKERS)[number]) => zoned(times[marker], 'Europe/Istanbul');

  it('resolves the Turkish country code to the Diyanet method', () => {
    expect(computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).method).toBe('turkey');
  });

  it('echoes the requested day back', () => {
    expect(computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).day).toBe(SUMMER_DAY);
  });

  it('returns every time marker as a valid Date', () => {
    expect(Object.keys(times).sort()).toEqual([...TIME_MARKERS].sort());
    for (const marker of TIME_MARKERS) {
      expect(times[marker]).toBeInstanceOf(Date);
      expect(Number.isNaN(times[marker].getTime())).toBe(false);
    }
  });

  it('orders the day fajr → sunrise → dhuhr → asr → maghrib → isha', () => {
    for (let index = 1; index < SOLAR_ORDER.length; index += 1) {
      expect(times[SOLAR_ORDER[index]].getTime()).toBeGreaterThan(
        times[SOLAR_ORDER[index - 1]].getTime()
      );
    }
  });

  it('puts the five prayers and sunrise on the requested local date', () => {
    for (const marker of SOLAR_ORDER) {
      expect(wall(marker).day).toBe(SUMMER_DAY);
    }
  });

  it('lands each prayer in a plausible part of an August day in Istanbul', () => {
    // Deliberately loose: this guards against gross errors (UTC drift, wrong date, swapped
    // markers), not against a minute of astronomical disagreement.
    const within = (marker: (typeof TIME_MARKERS)[number], fromHour: number, toHour: number) => {
      expect(wall(marker).minuteOfDay).toBeGreaterThanOrEqual(fromHour * 60);
      expect(wall(marker).minuteOfDay).toBeLessThan(toHour * 60);
    };
    within('fajr', 2, 6);
    within('sunrise', 4, 8);
    within('dhuhr', 11, 14);
    within('asr', 15, 19);
    within('maghrib', 18, 22);
    within('isha', 19, 23.5);
  });

  it('keeps the twilight gaps plausible (dawn before sunrise, dusk after sunset)', () => {
    const minutesBetween = (a: (typeof TIME_MARKERS)[number], b: (typeof TIME_MARKERS)[number]) =>
      (times[b].getTime() - times[a].getTime()) / MINUTE;
    expect(minutesBetween('fajr', 'sunrise')).toBeGreaterThan(45);
    expect(minutesBetween('fajr', 'sunrise')).toBeLessThan(150);
    expect(minutesBetween('maghrib', 'isha')).toBeGreaterThan(45);
    expect(minutesBetween('maghrib', 'isha')).toBeLessThan(150);
  });

  it('places the Sunnah markers inside the night that follows this day', () => {
    const nextFajr = computeDayTimes(NEXT_SUMMER_DAY, ISTANBUL, settings()).times.fajr;
    expect(times.middleOfTheNight.getTime()).toBeGreaterThan(times.maghrib.getTime());
    expect(times.lastThirdOfTheNight.getTime()).toBeGreaterThan(times.middleOfTheNight.getTime());
    expect(times.lastThirdOfTheNight.getTime()).toBeLessThan(nextFajr.getTime());
    // Islamic midnight is a night marker: in summer Istanbul it belongs to the NEXT calendar date.
    expect(zoned(times.middleOfTheNight, 'Europe/Istanbul').day).toBe(NEXT_SUMMER_DAY);
  });

  it('rounds every marker to a whole minute', () => {
    for (const marker of TIME_MARKERS) {
      expect(times[marker].getSeconds()).toBe(0);
    }
  });

  it('keeps a winter day ordered and plausible too', () => {
    const winter = computeDayTimes(WINTER_DAY, ISTANBUL, settings()).times;
    for (let index = 1; index < SOLAR_ORDER.length; index += 1) {
      expect(winter[SOLAR_ORDER[index]].getTime()).toBeGreaterThan(
        winter[SOLAR_ORDER[index - 1]].getTime()
      );
    }
    for (const marker of SOLAR_ORDER) {
      expect(zoned(winter[marker], 'Europe/Istanbul').day).toBe(WINTER_DAY);
    }
    // Winter days are shorter: sunrise later, maghrib earlier than in August.
    expect(zoned(winter.sunrise, 'Europe/Istanbul').minuteOfDay).toBeGreaterThan(
      wall('sunrise').minuteOfDay
    );
    expect(zoned(winter.maghrib, 'Europe/Istanbul').minuteOfDay).toBeLessThan(
      wall('maghrib').minuteOfDay
    );
  });

  it('returns fresh Date objects the caller owns', () => {
    const first = computeDayTimes(SUMMER_DAY, ISTANBUL, settings());
    const second = computeDayTimes(SUMMER_DAY, ISTANBUL, settings());
    expect(first.times.fajr).not.toBe(second.times.fajr);
    expect(first.times.fajr.getTime()).toBe(second.times.fajr.getTime());
    first.times.fajr.setFullYear(1999);
    expect(computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times.fajr.getTime()).toBe(
      second.times.fajr.getTime()
    );
  });
});

describe('computeDayTimes (method + parameter plumbing)', () => {
  it('honours an explicit method over the country map', () => {
    expect(computeDayTimes(SUMMER_DAY, ISTANBUL, settings({ method: 'egyptian' })).method).toBe(
      'egyptian'
    );
    expect(computeDayTimes(SUMMER_DAY, MECCA, settings()).method).toBe('ummAlQura');
  });

  it('falls back to Muslim World League when the country is unknown', () => {
    expect(computeDayTimes(SUMMER_DAY, { latitude: 0, longitude: 0 }, settings()).method).toBe(
      'muslimWorldLeague'
    );
    expect(computeDayTimes(SUMMER_DAY, { ...ISTANBUL, countryCode: 'ZZ' }, settings()).method).toBe(
      'muslimWorldLeague'
    );
  });

  it('produces different times for different methods', () => {
    const diyanet = computeDayTimes(SUMMER_DAY, ISTANBUL, settings({ method: 'turkey' })).times;
    const egyptian = computeDayTimes(SUMMER_DAY, ISTANBUL, settings({ method: 'egyptian' })).times;
    expect(egyptian.fajr.getTime()).not.toBe(diyanet.fajr.getTime());
  });

  it('puts the Hanafi Asr after the Shafi Asr', () => {
    const shafi = computeDayTimes(SUMMER_DAY, ISTANBUL, settings({ madhab: 'shafi' })).times.asr;
    const hanafi = computeDayTimes(SUMMER_DAY, ISTANBUL, settings({ madhab: 'hanafi' })).times.asr;
    expect(hanafi.getTime()).toBeGreaterThan(shafi.getTime());
  });

  it('respects the high-latitude rule setting', () => {
    const middle = computeDayTimes(
      '2026-06-21',
      BERLIN,
      settings({ highLatitudeRule: 'middleOfTheNight' })
    ).times.fajr;
    const seventh = computeDayTimes(
      '2026-06-21',
      BERLIN,
      settings({ highLatitudeRule: 'seventhOfTheNight' })
    ).times.fajr;
    expect(seventh.getTime()).not.toBe(middle.getTime());
  });
});

describe('computeDayTimes (offsets)', () => {
  const base = computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times;

  it('shifts exactly the requested prayer by exactly the requested minutes', () => {
    for (const prayer of PRAYERS) {
      for (const minutes of [-30, -13, -1, 1, 7, 30]) {
        const shifted = computeDayTimes(
          SUMMER_DAY,
          ISTANBUL,
          withOffsets({ [prayer]: minutes })
        ).times;
        expect(shifted[prayer].getTime() - base[prayer].getTime()).toBe(minutes * MINUTE);
        for (const marker of TIME_MARKERS) {
          if (marker === prayer) continue;
          expect(shifted[marker].getTime()).toBe(base[marker].getTime());
        }
      }
    }
  });

  it('applies every offset at once, independently', () => {
    const offsets: PrayerOffsets = { fajr: -3, dhuhr: 5, asr: -30, maghrib: 30, isha: 12 };
    const shifted = computeDayTimes(SUMMER_DAY, ISTANBUL, settings({ offsets })).times;
    for (const prayer of PRAYERS) {
      expect(shifted[prayer].getTime() - base[prayer].getTime()).toBe(offsets[prayer] * MINUTE);
    }
  });

  it('never offsets sunrise (PrayerOffsets has no sunrise key)', () => {
    const shifted = computeDayTimes(
      SUMMER_DAY,
      ISTANBUL,
      settings({ offsets: { fajr: 30, dhuhr: 30, asr: 30, maghrib: 30, isha: 30 } })
    ).times;
    expect(shifted.sunrise.getTime()).toBe(base.sunrise.getTime());
  });

  it('never offsets the Sunnah night markers', () => {
    const shifted = computeDayTimes(
      SUMMER_DAY,
      ISTANBUL,
      settings({ offsets: { fajr: -30, dhuhr: -30, asr: -30, maghrib: -30, isha: -30 } })
    ).times;
    expect(shifted.middleOfTheNight.getTime()).toBe(base.middleOfTheNight.getTime());
    expect(shifted.lastThirdOfTheNight.getTime()).toBe(base.lastThirdOfTheNight.getTime());
  });

  it('keeps whole-minute times after offsetting', () => {
    expect(
      computeDayTimes(SUMMER_DAY, ISTANBUL, withOffsets({ isha: -17 })).times.isha.getSeconds()
    ).toBe(0);
  });

  it('treats a missing offsets entry as zero (settings persisted by an older build)', () => {
    const partial = settings({ offsets: { fajr: 4 } as unknown as PrayerOffsets });
    const shifted = computeDayTimes(SUMMER_DAY, ISTANBUL, partial).times;
    expect(shifted.fajr.getTime() - base.fajr.getTime()).toBe(4 * MINUTE);
    expect(shifted.isha.getTime()).toBe(base.isha.getTime());
  });
});

describe('computeDayTimes (invalid input)', () => {
  it('rejects a malformed or impossible day', () => {
    for (const day of ['2026-8-19', '19-08-2026', '2026-02-30', '2026-13-01', 'nope', '']) {
      expect(() => computeDayTimes(day, ISTANBUL, settings())).toThrow(RangeError);
    }
  });

  it('rejects out-of-range or non-finite coordinates', () => {
    const bad: TimesLocation[] = [
      { latitude: 91, longitude: 0 },
      { latitude: -90.5, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: 0, longitude: -180.1 },
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    ];
    for (const location of bad) {
      expect(() => computeDayTimes(SUMMER_DAY, location, settings())).toThrow(RangeError);
    }
  });

  it('accepts the extremes of the coordinate range', () => {
    expect(() =>
      computeDayTimes(SUMMER_DAY, { latitude: 90, longitude: 180 }, settings())
    ).not.toThrow();
    expect(() =>
      computeDayTimes(SUMMER_DAY, { latitude: -90, longitude: -180 }, settings())
    ).not.toThrow();
  });

  it('rejects a non-finite offset instead of silently ignoring it', () => {
    expect(() => computeDayTimes(SUMMER_DAY, ISTANBUL, withOffsets({ asr: Number.NaN }))).toThrow(
      RangeError
    );
    expect(() =>
      computeDayTimes(SUMMER_DAY, ISTANBUL, withOffsets({ asr: Number.POSITIVE_INFINITY }))
    ).toThrow(RangeError);
  });
});

// ===========================================================================
// getPrayerWindows
// ===========================================================================

describe('getPrayerWindows', () => {
  const windows = getPrayerWindows(SUMMER_DAY, ISTANBUL, settings());
  const times = computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times;
  const nextTimes = computeDayTimes(NEXT_SUMMER_DAY, ISTANBUL, settings()).times;

  it('returns the five prayers in canonical order', () => {
    expect(windows.map((window) => window.prayer)).toEqual([...PRAYERS]);
  });

  it('starts each window at its own prayer time', () => {
    for (const window of windows) {
      expect(window.start.getTime()).toBe(times[window.prayer].getTime());
    }
  });

  it('ENDS FAJR AT SUNRISE, not at Dhuhr (Muslim 612 — the sun has risen, the window is shut)', () => {
    expect(windows[0].end.getTime()).toBe(times.sunrise.getTime());
    expect(windows[0].end.getTime()).not.toBe(times.dhuhr.getTime());
    // …and it really is a short window, not "most of the morning".
    expect(windows[0].end.getTime() - windows[0].start.getTime()).toBeLessThan(3 * HOUR);
  });

  it('ends every other window when the next prayer starts', () => {
    expect(windows[1].end.getTime()).toBe(times.asr.getTime());
    expect(windows[2].end.getTime()).toBe(times.maghrib.getTime());
    expect(windows[3].end.getTime()).toBe(times.isha.getTime());
  });

  it('ENDS ISHA AT THE NEXT DAY FAJR, crossing midnight (PRODUCT_SPEC §3)', () => {
    const isha = windows[4];
    expect(isha.end.getTime()).toBe(nextTimes.fajr.getTime());
    expect(zoned(isha.start, 'Europe/Istanbul').day).toBe(SUMMER_DAY);
    expect(zoned(isha.end, 'Europe/Istanbul').day).toBe(NEXT_SUMMER_DAY);
    // …and it really spans local midnight, rather than merely ending on the next date.
    expect(isha.end.getTime() - isha.start.getTime()).toBeGreaterThan(4 * HOUR);
    expect(zoned(isha.start, 'Europe/Istanbul').minuteOfDay).toBeGreaterThan(
      zoned(isha.end, 'Europe/Istanbul').minuteOfDay
    );
  });

  it('leaves exactly ONE gap — sunrise to Dhuhr, when nothing is due', () => {
    // Fajr's window shuts at sunrise, so the day is no longer tiled. Everything from Dhuhr on
    // still is: each window ends exactly where the next begins.
    expect(windows[1].start.getTime()).toBeGreaterThan(windows[0].end.getTime());
    for (let index = 2; index < windows.length; index += 1) {
      expect(windows[index].start.getTime()).toBe(windows[index - 1].end.getTime());
    }
    expect(windows[0].start.getTime()).toBe(times.fajr.getTime());
    expect(windows[4].end.getTime()).toBe(nextTimes.fajr.getTime());
    // The prayer DAY still runs Fajr → next Fajr even though the windows no longer cover it.
    const spanned = windows[4].end.getTime() - windows[0].start.getTime();
    expect(spanned).toBeGreaterThan(23 * HOUR);
    expect(spanned).toBeLessThan(25 * HOUR);
    const gap = windows[1].start.getTime() - windows[0].end.getTime();
    expect(gap).toBeGreaterThan(3 * HOUR);
  });

  it('moves both edges when an offset moves a prayer', () => {
    const shifted = getPrayerWindows(SUMMER_DAY, ISTANBUL, withOffsets({ asr: 10 }));
    expect(shifted[1].end.getTime() - windows[1].end.getTime()).toBe(10 * MINUTE);
    expect(shifted[2].start.getTime() - windows[2].start.getTime()).toBe(10 * MINUTE);
    expect(shifted[2].end.getTime()).toBe(windows[2].end.getTime());
  });

  it('moves Fajr’s START with its offset but never its end — sunrise takes no offset', () => {
    // `PrayerOffsets` is keyed by the five tracked prayers, so a mosque calendar's temkin
    // adjustment shifts when Fajr begins and leaves the astronomical deadline exactly where it is.
    const shifted = getPrayerWindows(SUMMER_DAY, ISTANBUL, withOffsets({ fajr: 7, dhuhr: 45 }));
    expect(shifted[0].start.getTime() - windows[0].start.getTime()).toBe(7 * MINUTE);
    expect(shifted[0].end.getTime()).toBe(times.sunrise.getTime());
  });

  it('moves the Isha window end when tomorrow’s Fajr is offset', () => {
    const shifted = getPrayerWindows(SUMMER_DAY, ISTANBUL, withOffsets({ fajr: -8 }));
    expect(shifted[4].end.getTime() - windows[4].end.getTime()).toBe(-8 * MINUTE);
  });

  it('returns Dates the caller owns', () => {
    const first = getPrayerWindows(SUMMER_DAY, ISTANBUL, settings());
    first[0].start.setFullYear(1999);
    expect(getPrayerWindows(SUMMER_DAY, ISTANBUL, settings())[0].start.getTime()).toBe(
      windows[0].start.getTime()
    );
  });

  it('rejects a malformed day', () => {
    expect(() => getPrayerWindows('2026-02-30', ISTANBUL, settings())).toThrow(RangeError);
  });

  it('still returns five windows in prayer order when an offset makes one degenerate', () => {
    // Tromsø in December: Dhuhr and Asr are minutes apart, so a −30 Asr offset inverts the Dhuhr
    // window. The contract is "five windows in prayer order", not "end > start".
    const degenerate = getPrayerWindows('2026-12-21', TROMSO, withOffsets({ asr: -30 }));
    expect(degenerate.map((window) => window.prayer)).toEqual([...PRAYERS]);
    expect(degenerate[1].end.getTime()).toBeLessThan(degenerate[1].start.getTime());
    // Contiguity from Dhuhr on survives regardless: every end is still the next window's start.
    for (let index = 2; index < degenerate.length; index += 1) {
      expect(degenerate[index].start.getTime()).toBe(degenerate[index - 1].end.getTime());
    }
  });
});

// ===========================================================================
// getNextPrayer
// ===========================================================================

describe('getNextPrayer', () => {
  const times = computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times;
  const tomorrow = computeDayTimes(NEXT_SUMMER_DAY, ISTANBUL, settings()).times;

  it('names today’s Fajr before Fajr', () => {
    const next = getNextPrayer(new Date(times.fajr.getTime() - 90 * MINUTE), ISTANBUL, settings());
    expect(next.prayer).toBe('fajr');
    expect(next.day).toBe(SUMMER_DAY);
    expect(next.at.getTime()).toBe(times.fajr.getTime());
    expect(next.msRemaining).toBe(90 * MINUTE);
  });

  it('names the following prayer at exactly a prayer time (a started prayer is not "next")', () => {
    const next = getNextPrayer(new Date(times.fajr.getTime()), ISTANBUL, settings());
    expect(next.prayer).toBe('dhuhr');
    expect(next.at.getTime()).toBe(times.dhuhr.getTime());
    expect(next.msRemaining).toBeGreaterThan(0);
  });

  it('walks the day between prayers', () => {
    const steps: [Prayer, Prayer][] = [
      ['fajr', 'dhuhr'],
      ['dhuhr', 'asr'],
      ['asr', 'maghrib'],
      ['maghrib', 'isha'],
    ];
    for (const [current, upcoming] of steps) {
      const midpoint = new Date((times[current].getTime() + times[upcoming].getTime()) / 2);
      const next = getNextPrayer(midpoint, ISTANBUL, settings());
      expect(next.prayer).toBe(upcoming);
      expect(next.day).toBe(SUMMER_DAY);
      expect(next.at.getTime()).toBe(times[upcoming].getTime());
    }
  });

  it('rolls over to TOMORROW’s Fajr after Isha, and reports tomorrow’s prayer day', () => {
    const next = getNextPrayer(new Date(times.isha.getTime() + MINUTE), ISTANBUL, settings());
    expect(next.prayer).toBe('fajr');
    expect(next.day).toBe(NEXT_SUMMER_DAY);
    expect(next.at.getTime()).toBe(tomorrow.fajr.getTime());
  });

  it('still names tomorrow’s Fajr from the small hours', () => {
    const afterMidnight = new Date(tomorrow.fajr.getTime() - 4 * HOUR);
    const next = getNextPrayer(afterMidnight, ISTANBUL, settings());
    expect(next.prayer).toBe('fajr');
    expect(next.day).toBe(NEXT_SUMMER_DAY);
    expect(next.msRemaining).toBe(4 * HOUR);
  });

  it('keeps msRemaining consistent with `at` and strictly positive all day', () => {
    for (
      let instant = times.fajr.getTime();
      instant < tomorrow.fajr.getTime();
      instant += 17 * MINUTE
    ) {
      const next = getNextPrayer(new Date(instant), ISTANBUL, settings());
      expect(next.msRemaining).toBe(next.at.getTime() - instant);
      expect(next.msRemaining).toBeGreaterThan(0);
      expect(PRAYERS).toContain(next.prayer);
    }
  });

  it('follows the offsets', () => {
    // With Fajr pushed 10 minutes later, the original Fajr instant is no longer "past Fajr".
    const next = getNextPrayer(new Date(times.fajr.getTime()), ISTANBUL, withOffsets({ fajr: 10 }));
    expect(next.prayer).toBe('fajr');
    expect(next.at.getTime()).toBe(times.fajr.getTime() + 10 * MINUTE);
    expect(next.msRemaining).toBe(10 * MINUTE);
  });

  it('rejects an invalid now', () => {
    expect(() => getNextPrayer(new Date('nope'), ISTANBUL, settings())).toThrow(RangeError);
    expect(() => getNextPrayer(undefined as unknown as Date, ISTANBUL, settings())).toThrow(
      RangeError
    );
  });

  it('answers at high latitude too', () => {
    const polar = getNextPrayer(new Date(Date.UTC(2026, 5, 21, 10, 0)), TROMSO, settings());
    expect(PRAYERS).toContain(polar.prayer);
    expect(polar.msRemaining).toBeGreaterThan(0);
  });
});

// ===========================================================================
// getCurrentPrayerDay — the Fajr→Fajr boundary, in a real timezone
// ===========================================================================

describe('getCurrentPrayerDay (Europe/Istanbul wall clock)', () => {
  interface DayReport {
    timeZone: string;
    fajr: string;
    at0030: PrayerDay;
    at0600: PrayerDay;
    at1200: PrayerDay;
    at2359: PrayerDay;
    justBeforeFajr: PrayerDay;
    exactlyAtFajr: PrayerDay;
  }

  const report = lazy(() =>
    inTimeZone<DayReport>(
      'Europe/Istanbul',
      (api) => {
        const location = api.payload.location as TimesLocation;
        const config = api.payload.settings as CalculationSettings;
        const fajr = api.prayerTimes.computeDayTimes(api.payload.day as PrayerDay, location, config)
          .times.fajr;
        const local = (hour: number, minute: number) => new Date(2026, 7, 19, hour, minute, 0, 0);
        return {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          fajr: fajr.toString().slice(0, 24),
          at0030: api.prayerTimes.getCurrentPrayerDay(local(0, 30), location, config),
          at0600: api.prayerTimes.getCurrentPrayerDay(local(6, 0), location, config),
          at1200: api.prayerTimes.getCurrentPrayerDay(local(12, 0), location, config),
          at2359: api.prayerTimes.getCurrentPrayerDay(local(23, 59), location, config),
          justBeforeFajr: api.prayerTimes.getCurrentPrayerDay(
            new Date(fajr.getTime() - 1),
            location,
            config
          ),
          exactlyAtFajr: api.prayerTimes.getCurrentPrayerDay(
            new Date(fajr.getTime()),
            location,
            config
          ),
        };
      },
      { ...probePayload(ISTANBUL), day: SUMMER_DAY }
    )
  );

  it('ran in Istanbul, with a pre-dawn Fajr', () => {
    expect(report().timeZone).toBe('Europe/Istanbul');
    expect(report().fajr).toMatch(/^Wed Aug 19 2026 0[2-5]:/);
  });

  it('says 00:30 still belongs to the PREVIOUS prayer day', () => {
    expect(report().at0030).toBe('2026-08-18');
  });

  it('says 06:00 belongs to today', () => {
    expect(report().at0600).toBe(SUMMER_DAY);
  });

  it('says midday and late evening belong to today', () => {
    expect(report().at1200).toBe(SUMMER_DAY);
    expect(report().at2359).toBe(SUMMER_DAY);
  });

  it('flips exactly at Fajr, not a millisecond earlier', () => {
    expect(report().justBeforeFajr).toBe('2026-08-18');
    expect(report().exactlyAtFajr).toBe(SUMMER_DAY);
  });

  it('moves the boundary with the Fajr offset', () => {
    const shifted = inTimeZone<{ before: PrayerDay; after: PrayerDay }>(
      'Europe/Istanbul',
      (api) => {
        const location = api.payload.location as TimesLocation;
        const config = api.payload.settings as CalculationSettings;
        const fajr = api.prayerTimes.computeDayTimes(api.payload.day as PrayerDay, location, config)
          .times.fajr;
        return {
          before: api.prayerTimes.getCurrentPrayerDay(
            new Date(fajr.getTime() - 1),
            location,
            config
          ),
          after: api.prayerTimes.getCurrentPrayerDay(new Date(fajr.getTime()), location, config),
        };
      },
      { ...probePayload(ISTANBUL, withOffsets({ fajr: 30 })), day: SUMMER_DAY }
    );
    expect(shifted.before).toBe('2026-08-18');
    expect(shifted.after).toBe(SUMMER_DAY);
  });

  it('rejects an invalid now', () => {
    expect(() => getCurrentPrayerDay(new Date('nope'), ISTANBUL, settings())).toThrow(RangeError);
  });
});

// ===========================================================================
// getCurrentPrayer
// ===========================================================================

/**
 * `getCurrentPrayer` resolves the prayer day first, so it reads the DEVICE zone — every
 * behavioural assertion about it therefore runs in a real one. (In the product the device zone
 * always tracks the user's location; a phone in Istanbul is not set to Anchorage.)
 */
describe('getCurrentPrayer (Europe/Istanbul wall clock)', () => {
  type Current = { prayer: Prayer; day: PrayerDay } | null;

  interface CurrentReport {
    /** One entry per window, probed at the window's midpoint. */
    midpoints: { window: Prayer; current: Current }[];
    /** Window edges, probed at `start`, `end − 1ms` and `end`. */
    edges: { window: Prayer; atStart: Current; beforeEnd: Current; atEnd: Current }[];
    /** A sweep across the whole prayer day. */
    scan: { samples: number; nulls: number; days: PrayerDay[]; sequence: Prayer[] };
    /** Named wall-clock instants. */
    wallClock: Record<string, Current>;
    /** Instants either side of sunrise — the boundary Fajr's window actually ends on. */
    sunriseEdge: {
      justBefore: Current;
      exactly: Current;
      anHourAfter: Current;
      justBeforeDhuhr: Current;
      atDhuhr: Current;
    };
  }

  const report = lazy(() =>
    inTimeZone<CurrentReport>(
      'Europe/Istanbul',
      (api) => {
        const location = api.payload.location as TimesLocation;
        const config = api.payload.settings as CalculationSettings;
        const day = api.payload.day as PrayerDay;
        const windows = api.prayerTimes.getPrayerWindows(day, location, config);
        const at = (instant: Date) => api.prayerTimes.getCurrentPrayer(instant, location, config);

        const scan = { samples: 0, nulls: 0, days: [] as string[], sequence: [] as string[] };
        for (
          let instant = windows[0].start.getTime();
          instant < windows[4].end.getTime();
          instant += 11 * 60000
        ) {
          const current = at(new Date(instant));
          scan.samples += 1;
          if (current === null) {
            scan.nulls += 1;
            continue;
          }
          if (!scan.days.includes(current.day)) scan.days.push(current.day);
          if (scan.sequence[scan.sequence.length - 1] !== current.prayer) {
            scan.sequence.push(current.prayer);
          }
        }

        return {
          midpoints: windows.map((window) => ({
            window: window.prayer,
            current: at(new Date((window.start.getTime() + window.end.getTime()) / 2)),
          })),
          edges: windows.map((window) => ({
            window: window.prayer,
            atStart: at(new Date(window.start.getTime())),
            beforeEnd: at(new Date(window.end.getTime() - 1)),
            atEnd: at(new Date(window.end.getTime())),
          })),
          scan,
          wallClock: {
            at0030: at(new Date(2026, 7, 19, 0, 30, 0, 0)),
            at0500: at(new Date(2026, 7, 19, 5, 0, 0, 0)),
            at0900: at(new Date(2026, 7, 19, 9, 0, 0, 0)),
            at1400: at(new Date(2026, 7, 19, 14, 0, 0, 0)),
            at2200: at(new Date(2026, 7, 19, 22, 0, 0, 0)),
          },
          sunriseEdge: (() => {
            const marks = api.prayerTimes.computeDayTimes(day, location, config).times;
            return {
              justBefore: at(new Date(marks.sunrise.getTime() - 1)),
              exactly: at(new Date(marks.sunrise.getTime())),
              anHourAfter: at(new Date(marks.sunrise.getTime() + 3600000)),
              justBeforeDhuhr: at(new Date(marks.dhuhr.getTime() - 1)),
              atDhuhr: at(new Date(marks.dhuhr.getTime())),
            };
          })(),
        };
      },
      { ...probePayload(ISTANBUL), day: SUMMER_DAY }
    )
  );

  it('names the prayer whose window contains the instant', () => {
    expect(report().midpoints).toEqual(
      [...PRAYERS].map((prayer) => ({
        window: prayer,
        current: { prayer, day: SUMMER_DAY },
      }))
    );
  });

  it('treats a window as half-open: [start, end)', () => {
    for (const edge of report().edges) {
      expect(edge.atStart).toEqual({ prayer: edge.window, day: SUMMER_DAY });
      expect(edge.beforeEnd).toEqual({ prayer: edge.window, day: SUMMER_DAY });
      expect(edge.atEnd?.prayer).not.toBe(edge.window);
    }
  });

  it('walks the five prayers in order, with ONE stretch where nothing is current', () => {
    // Fajr's window shuts at sunrise, so a real day now contains a genuine run of `null` — the
    // morning between sunrise and Dhuhr, when nothing is due. It is a normal answer, not a
    // defensive one, and it is the ONLY gap: the sequence is still fajr…isha, in order.
    expect(report().scan.samples).toBeGreaterThan(100);
    expect(report().scan.nulls).toBeGreaterThan(10);
    expect(report().scan.nulls).toBeLessThan(report().scan.samples / 2);
    expect(report().scan.days).toEqual([SUMMER_DAY]);
    expect(report().scan.sequence).toEqual([...PRAYERS]);
  });

  it('answers 00:30 with the PREVIOUS day’s Isha, and the rest of the day with today’s', () => {
    expect(report().wallClock.at0030).toEqual({ prayer: 'isha', day: '2026-08-18' });
    expect(report().wallClock.at0500).toEqual({ prayer: 'fajr', day: SUMMER_DAY });
    expect(report().wallClock.at1400).toEqual({ prayer: 'dhuhr', day: SUMMER_DAY });
    expect(report().wallClock.at2200).toEqual({ prayer: 'isha', day: SUMMER_DAY });
  });

  it('drops Fajr the instant the sun rises, and names nothing until Dhuhr', () => {
    const edge = report().sunriseEdge;
    expect(edge.justBefore).toEqual({ prayer: 'fajr', day: SUMMER_DAY });
    expect(edge.exactly).toBeNull();
    expect(edge.anHourAfter).toBeNull();
    expect(edge.justBeforeDhuhr).toBeNull();
    expect(edge.atDhuhr).toEqual({ prayer: 'dhuhr', day: SUMMER_DAY });
    // The morning is not a hole in the prayer DAY — it is still today, with the day's row list.
    expect(report().wallClock.at0900).toBeNull();
  });

  it('keeps Isha as the current prayer of the PREVIOUS day after midnight', () => {
    const windows = getPrayerWindows(SUMMER_DAY, ISTANBUL, settings());
    const afterMidnight = new Date(windows[4].end.getTime() - 90 * MINUTE);
    expect(zoned(afterMidnight, 'Europe/Istanbul').day).toBe(NEXT_SUMMER_DAY);
    expect(getCurrentPrayer(afterMidnight, ISTANBUL, settings())).toEqual({
      prayer: 'isha',
      day: SUMMER_DAY,
    });
  });

  it('follows the offsets', () => {
    // Dhuhr pushed 20 minutes later: the original Dhuhr instant now falls in the morning gap,
    // because nothing else reaches into it — Fajr's window ended at sunrise hours earlier.
    const dhuhr = computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times.dhuhr;
    expect(getCurrentPrayer(dhuhr, ISTANBUL, withOffsets({ dhuhr: 20 }))).toBeNull();
    expect(getCurrentPrayer(dhuhr, ISTANBUL, settings())?.prayer).toBe('dhuhr');

    // Fajr pushed 10 minutes later: the un-offset Fajr instant still belongs to YESTERDAY's Isha,
    // whose window ends at the (offset) Fajr the user actually sees.
    const fajr = computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times.fajr;
    expect(getCurrentPrayer(fajr, ISTANBUL, withOffsets({ fajr: 10 }))).toEqual({
      prayer: 'isha',
      day: '2026-08-18',
    });
  });

  it('rejects an invalid now', () => {
    expect(() => getCurrentPrayer(new Date('nope'), ISTANBUL, settings())).toThrow(RangeError);
  });
});

// ===========================================================================
// getIshaNudgeTime
// ===========================================================================

describe('getIshaNudgeTime', () => {
  it('is Islamic midnight (middleOfTheNight)', () => {
    const times = computeDayTimes(SUMMER_DAY, ISTANBUL, settings()).times;
    expect(getIshaNudgeTime(SUMMER_DAY, ISTANBUL, settings()).getTime()).toBe(
      times.middleOfTheNight.getTime()
    );
  });

  it('sits strictly inside the Isha window', () => {
    const windows = getPrayerWindows(SUMMER_DAY, ISTANBUL, settings());
    const nudge = getIshaNudgeTime(SUMMER_DAY, ISTANBUL, settings()).getTime();
    expect(nudge).toBeGreaterThan(windows[4].start.getTime());
    expect(nudge).toBeLessThan(windows[4].end.getTime());
  });

  it('never lands at 4am — it stays hours clear of Fajr, all year round', () => {
    for (const [location, zone] of [
      [ISTANBUL, 'Europe/Istanbul'],
      [NEW_YORK, 'America/New_York'],
      [MECCA, 'Asia/Riyadh'],
    ] as const) {
      for (let month = 1; month <= 12; month += 1) {
        const day = `2026-${String(month).padStart(2, '0')}-14`;
        const windows = getPrayerWindows(day, location, settings());
        const nudge = getIshaNudgeTime(day, location, settings());
        expect(nudge.getTime()).toBeGreaterThan(windows[4].start.getTime());
        // At least two hours before Fajr: never a pre-dawn notification.
        expect(windows[4].end.getTime() - nudge.getTime()).toBeGreaterThan(2 * HOUR);
        const local = zoned(nudge, zone).minuteOfDay;
        expect(local >= 21 * 60 || local <= 2 * 60).toBe(true);
      }
    }
  });

  it('ignores the Maghrib/Fajr offsets, like the marker it comes from', () => {
    const base = getIshaNudgeTime(SUMMER_DAY, ISTANBUL, settings()).getTime();
    const shifted = getIshaNudgeTime(
      SUMMER_DAY,
      ISTANBUL,
      withOffsets({ maghrib: 20, fajr: -20 })
    ).getTime();
    expect(shifted).toBe(base);
  });

  it('falls back to the middle of the Isha window when the polar night collapses', () => {
    // Tromsø, midsummer: Isha ≈ 00:32 and the next Fajr ≈ 01:00, with Islamic midnight between
    // them. Push Isha 20 minutes later and Islamic midnight now falls BEFORE Isha, so the
    // astronomical marker is no longer a legal nudge time.
    const day = '2026-06-21';
    const polar = withOffsets({ isha: 20 });
    const windows = getPrayerWindows(day, TROMSO, polar);
    expect(computeDayTimes(day, TROMSO, polar).times.middleOfTheNight.getTime()).toBeLessThan(
      windows[4].start.getTime()
    );

    const nudge = getIshaNudgeTime(day, TROMSO, polar);
    expect(nudge.getTime()).toBeGreaterThan(windows[4].start.getTime());
    expect(nudge.getTime()).toBeLessThan(windows[4].end.getTime());
    expect(nudge.getTime()).toBe(
      windows[4].start.getTime() +
        Math.round((windows[4].end.getTime() - windows[4].start.getTime()) / 2)
    );
  });

  it('returns the window start rather than a nonsense instant when the window inverts', () => {
    const day = '2026-06-21';
    const broken = withOffsets({ isha: 30 });
    const windows = getPrayerWindows(day, TROMSO, broken);
    expect(windows[4].end.getTime()).toBeLessThan(windows[4].start.getTime());
    expect(getIshaNudgeTime(day, TROMSO, broken).getTime()).toBe(windows[4].start.getTime());
  });

  it('rejects a malformed day', () => {
    expect(() => getIshaNudgeTime('2026-02-30', ISTANBUL, settings())).toThrow(RangeError);
  });

  it('gives the same answer from an already-computed day', () => {
    // The caller-supplied form is what the notification planner uses; if the two ever disagreed,
    // a nudge would fire at a different instant depending on who asked for it.
    for (const [day, location, config] of [
      [SUMMER_DAY, ISTANBUL, settings()],
      [SUMMER_DAY, ISTANBUL, withOffsets({ isha: 15, fajr: -10 })],
      ['2026-06-21', TROMSO, withOffsets({ isha: 20 })],
      ['2026-06-21', TROMSO, withOffsets({ isha: 30 })],
      ['2026-12-21', TROMSO, settings()],
    ] as const) {
      const times = computeDayTimes(day, location, config);
      expect(getIshaNudgeTimeFrom(times, location, config).getTime()).toBe(
        getIshaNudgeTime(day, location, config).getTime()
      );
    }
  });
});

// ===========================================================================
// DST transitions (PRODUCT_SPEC §3) — real zones, real clock changes
// ===========================================================================

interface Night {
  /** Elapsed minutes between Isha and the next Fajr — a real duration. */
  elapsedMinutes: number;
  /** The same span measured on the wall clock, ignoring the hour that vanished or repeated. */
  wallClockMinutes: number;
  ishaLocal: string;
  fajrLocal: string;
  /** Local calendar dates of this day's own six solar markers. */
  markerDays: PrayerDay[];
  ordered: boolean;
}

interface NightReport {
  timeZone: string;
  nights: Record<PrayerDay, Night>;
}

/** Measures each night (Isha → next Fajr) both as elapsed time and as wall-clock time. */
const nightProbe = (api: ProbeApi) => {
  const location = api.payload.location as TimesLocation;
  const config = api.payload.settings as CalculationSettings;
  const wall = (date: Date) => date.getHours() * 60 + date.getMinutes();
  const nights: Record<string, unknown> = {};
  for (const day of api.payload.days as PrayerDay[]) {
    const isha = api.prayerTimes.getPrayerWindows(day, location, config)[4];
    const times = api.prayerTimes.computeDayTimes(day, location, config).times;
    const markers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const values = markers.map((marker) => (times as unknown as Record<string, Date>)[marker]);
    const dayShift = api.dates.diffDays(
      api.dates.toDayString(isha.start),
      api.dates.toDayString(isha.end)
    );
    nights[day] = {
      elapsedMinutes: Math.round((isha.end.getTime() - isha.start.getTime()) / 60000),
      wallClockMinutes: wall(isha.end) + 1440 * dayShift - wall(isha.start),
      ishaLocal: isha.start.toString().slice(0, 24),
      fajrLocal: isha.end.toString().slice(0, 24),
      markerDays: values.map((value) => api.dates.toDayString(value)),
      ordered: values.every((value, index) => index === 0 || value > values[index - 1]),
    };
  }
  return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, nights };
};

const drift = (night: Night) => night.wallClockMinutes - night.elapsedMinutes;

describe('DST — America/New_York spring forward (2026-03-08, 02:00 → 03:00)', () => {
  const report = lazy(() =>
    inTimeZone<NightReport>('America/New_York', nightProbe, {
      ...probePayload(NEW_YORK),
      days: ['2026-03-06', '2026-03-07', '2026-03-08'],
    })
  );

  it('ran in New York', () => {
    expect(report().timeZone).toBe('America/New_York');
  });

  it('loses exactly one hour of real time across the transition night', () => {
    expect(drift(report().nights['2026-03-07'])).toBe(60);
  });

  it('measures ordinary nights with no discrepancy at all', () => {
    expect(drift(report().nights['2026-03-06'])).toBe(0);
    expect(drift(report().nights['2026-03-08'])).toBe(0);
  });

  it('keeps every night a plausible length in real time', () => {
    for (const night of Object.values(report().nights)) {
      expect(night.elapsedMinutes).toBeGreaterThan(8 * 60);
      expect(night.elapsedMinutes).toBeLessThan(12 * 60);
    }
  });

  it('keeps the transition day’s own times ordered and on its own date', () => {
    expect(report().nights['2026-03-08'].ordered).toBe(true);
    expect(report().nights['2026-03-08'].markerDays).toEqual(Array(6).fill('2026-03-08'));
  });

  it('jumps the wall-clock Fajr forward by about an hour on the transition day', () => {
    // 05:06 EST on the 7th → 06:04 EDT on the 8th: the clock moved, the sun did not.
    expect(report().nights['2026-03-06'].fajrLocal).toMatch(/^Sat Mar 07 2026 05:/);
    expect(report().nights['2026-03-07'].fajrLocal).toMatch(/^Sun Mar 08 2026 06:/);
  });

  it('counts down in real elapsed time across the skipped hour', () => {
    const countdown = inTimeZone<{
      prayer: Prayer;
      day: PrayerDay;
      msRemaining: number;
      at: string;
    }>(
      'America/New_York',
      (api) => {
        // 01:30 EST, half an hour before the clocks jump to 03:00.
        const next = api.prayerTimes.getNextPrayer(
          new Date(2026, 2, 8, 1, 30, 0, 0),
          api.payload.location as TimesLocation,
          api.payload.settings as CalculationSettings
        );
        return {
          prayer: next.prayer,
          day: next.day,
          msRemaining: next.msRemaining,
          at: next.at.toString().slice(0, 24),
        };
      },
      probePayload(NEW_YORK)
    );
    expect(countdown.prayer).toBe('fajr');
    expect(countdown.day).toBe('2026-03-08');
    expect(countdown.at).toMatch(/^Sun Mar 08 2026 06:/);
    // The wall clock says 01:30 → 06:04 is 4h34m; a real clock only waits 3h34m.
    expect(countdown.msRemaining / MINUTE).toBeGreaterThan(3 * 60);
    expect(countdown.msRemaining / MINUTE).toBeLessThan(4 * 60);
  });

  it('still puts 01:30 on the transition night in the previous prayer day', () => {
    const report2 = inTimeZone<{
      day: PrayerDay;
      current: { prayer: Prayer; day: PrayerDay } | null;
    }>(
      'America/New_York',
      (api) => {
        const now = new Date(2026, 2, 8, 1, 30, 0, 0);
        const location = api.payload.location as TimesLocation;
        const config = api.payload.settings as CalculationSettings;
        return {
          day: api.prayerTimes.getCurrentPrayerDay(now, location, config),
          current: api.prayerTimes.getCurrentPrayer(now, location, config),
        };
      },
      probePayload(NEW_YORK)
    );
    expect(report2.day).toBe('2026-03-07');
    expect(report2.current).toEqual({ prayer: 'isha', day: '2026-03-07' });
  });
});

describe('DST — America/New_York fall back (2026-11-01, 02:00 → 01:00)', () => {
  const report = lazy(() =>
    inTimeZone<NightReport>('America/New_York', nightProbe, {
      ...probePayload(NEW_YORK),
      days: ['2026-10-30', '2026-10-31', '2026-11-01'],
    })
  );

  it('gains exactly one hour of real time across the transition night', () => {
    expect(drift(report().nights['2026-10-31'])).toBe(-60);
    expect(report().nights['2026-10-31'].elapsedMinutes).toBeGreaterThan(10 * 60);
  });

  it('leaves ordinary nights alone', () => {
    expect(drift(report().nights['2026-10-30'])).toBe(0);
    expect(drift(report().nights['2026-11-01'])).toBe(0);
  });

  it('keeps the transition day’s times ordered and on its own date', () => {
    expect(report().nights['2026-11-01'].ordered).toBe(true);
    expect(report().nights['2026-11-01'].markerDays).toEqual(Array(6).fill('2026-11-01'));
  });
});

describe('DST — Europe/Berlin (2026-03-29 forward, 2026-10-25 back)', () => {
  const report = lazy(() =>
    inTimeZone<NightReport>('Europe/Berlin', nightProbe, {
      ...probePayload(BERLIN),
      days: ['2026-03-27', '2026-03-28', '2026-10-23', '2026-10-24'],
    })
  );

  it('ran in Berlin', () => {
    expect(report().timeZone).toBe('Europe/Berlin');
  });

  it('loses an hour on the March transition night and nothing the night before', () => {
    expect(drift(report().nights['2026-03-28'])).toBe(60);
    expect(drift(report().nights['2026-03-27'])).toBe(0);
  });

  it('gains an hour on the October transition night and nothing the night before', () => {
    expect(drift(report().nights['2026-10-24'])).toBe(-60);
    expect(drift(report().nights['2026-10-23'])).toBe(0);
  });

  it('keeps prayer days exactly one calendar day apart across both transitions', () => {
    const days = inTimeZone<PrayerDay[]>(
      'Europe/Berlin',
      (api) => {
        const out: string[] = [];
        for (const day of api.payload.days as PrayerDay[]) {
          const noon = api.dates.parseDay(day);
          noon.setHours(12, 0, 0, 0);
          out.push(
            api.prayerTimes.getCurrentPrayerDay(
              noon,
              api.payload.location as TimesLocation,
              api.payload.settings as CalculationSettings
            )
          );
        }
        return out;
      },
      {
        ...probePayload(BERLIN),
        days: ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26'],
      }
    );
    expect(days).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
  });
});

// ===========================================================================
// High latitude
// ===========================================================================

describe('high latitude (Tromsø, 69.6°N)', () => {
  const MIDSUMMER = '2026-06-21';
  const MIDWINTER = '2026-12-21';

  const expectOrdered = (times: Record<string, Date>) => {
    for (let index = 1; index < SOLAR_ORDER.length; index += 1) {
      expect(times[SOLAR_ORDER[index]].getTime()).toBeGreaterThan(
        times[SOLAR_ORDER[index - 1]].getTime()
      );
    }
  };

  it('produces ordered midsummer times without throwing', () => {
    const times = computeDayTimes(MIDSUMMER, TROMSO, settings()).times;
    for (const marker of TIME_MARKERS) {
      expect(Number.isNaN(times[marker].getTime())).toBe(false);
    }
    expectOrdered(times);
  });

  it('produces ordered midwinter times without throwing', () => {
    expectOrdered(computeDayTimes(MIDWINTER, TROMSO, settings()).times);
  });

  it('keeps the polar summer night short but real', () => {
    const times = computeDayTimes(MIDSUMMER, TROMSO, settings()).times;
    const nextFajr = computeDayTimes('2026-06-22', TROMSO, settings()).times.fajr;
    const night = nextFajr.getTime() - times.maghrib.getTime();
    expect(night).toBeGreaterThan(0);
    expect(night).toBeLessThan(3 * HOUR);
  });

  it('still returns five windows, and Isha still ends at the next Fajr', () => {
    const windows = getPrayerWindows(MIDSUMMER, TROMSO, settings());
    expect(windows.map((window) => window.prayer)).toEqual([...PRAYERS]);
    expect(windows[4].end.getTime()).toBe(
      computeDayTimes('2026-06-22', TROMSO, settings()).times.fajr.getTime()
    );
  });

  it('never throws across the year, under any high-latitude rule', () => {
    for (const rule of [
      'auto',
      'middleOfTheNight',
      'seventhOfTheNight',
      'twilightAngle',
    ] as const) {
      const config = settings({ highLatitudeRule: rule });
      for (let dayNumber = 0; dayNumber < 365; dayNumber += 7) {
        const day = new Date(Date.UTC(2026, 0, 1 + dayNumber)).toISOString().slice(0, 10);
        expect(() => computeDayTimes(day, TROMSO, config)).not.toThrow();
        expect(() => getPrayerWindows(day, TROMSO, config)).not.toThrow();
        expect(() => getIshaNudgeTime(day, TROMSO, config)).not.toThrow();
      }
    }
  });

  // adhan 4.4.4's Asr breaks above ~66°: `tan(|latitude − declination|)` flips sign in deep
  // winter and the returned Asr can land after Maghrib or on the next calendar day (45 Tromsø
  // days in 2026, measured). `repairAsr` (D121) estimates it into the Dhuhr→Maghrib span
  // instead. EVERY day of the year is checked, not a weekly sample — the defect is seasonal
  // and a stride can walk over it.
  it('keeps Asr strictly inside Dhuhr→Maghrib every single day of the year (D121)', () => {
    for (let dayNumber = 0; dayNumber < 365; dayNumber += 1) {
      const day = new Date(Date.UTC(2026, 0, 1 + dayNumber)).toISOString().slice(0, 10);
      const times = computeDayTimes(day, TROMSO, settings()).times;
      expect(times.asr.getTime()).toBeGreaterThan(times.dhuhr.getTime());
      expect(times.asr.getTime()).toBeLessThan(times.maghrib.getTime());
    }
  });

  it('answers the formerly-bad day from adhan itself, and leaves a healthy day untouched', () => {
    // 2026-01-14 under adhan 4.4.4: dhuhr 10:54Z, asr 11:46Z, maghrib 11:42Z — Asr after Maghrib,
    // which `repairAsr` pulled to the span midpoint. Upstream's stricter afternoon check
    // (adhan-js#232, carried by our patch) now sees the sun never reaches the Asr angle and
    // resolves the day by nearest latitude (AqrabBalad) instead, so the answer is adhan's own and
    // `repairAsr` stays the safety net it was meant to be.
    const bad = computeDayTimes('2026-01-14', TROMSO, settings()).times;
    expect(bad.asr.getTime()).toBeGreaterThan(bad.dhuhr.getTime());
    expect(bad.asr.getTime()).toBeLessThan(bad.maghrib.getTime());

    // Midsummer Asr is computable the ordinary way and must NOT be the midpoint estimate.
    const healthy = computeDayTimes('2026-06-21', TROMSO, settings()).times;
    const healthyMidpoint = (healthy.dhuhr.getTime() + healthy.maghrib.getTime()) / 2;
    expect(Math.abs(healthy.asr.getTime() - healthyMidpoint)).toBeGreaterThan(30 * MINUTE);
  });

  it('survives Svalbard (78.2°N) in midsummer and midwinter', () => {
    for (const day of [MIDSUMMER, MIDWINTER]) {
      expect(() => computeDayTimes(day, LONGYEARBYEN, settings())).not.toThrow();
      const times = computeDayTimes(day, LONGYEARBYEN, settings()).times;
      for (const marker of TIME_MARKERS) {
        expect(Number.isNaN(times[marker].getTime())).toBe(false);
      }
      expect(times.isha.getTime()).toBeGreaterThan(times.fajr.getTime());
    }
  });

  it('answers the current prayer in Tromsø wall-clock terms', () => {
    const report = inTimeZone<{
      day: PrayerDay;
      current: { prayer: Prayer; day: PrayerDay } | null;
    }>(
      'Europe/Oslo',
      (api) => {
        // 14:00 on midsummer's day — solidly inside the Dhuhr window even at 69°N.
        const now = new Date(2026, 5, 21, 14, 0, 0, 0);
        const location = api.payload.location as TimesLocation;
        const config = api.payload.settings as CalculationSettings;
        return {
          day: api.prayerTimes.getCurrentPrayerDay(now, location, config),
          current: api.prayerTimes.getCurrentPrayer(now, location, config),
        };
      },
      probePayload(TROMSO)
    );
    expect(report.day).toBe(MIDSUMMER);
    expect(report.current).toEqual({ prayer: 'dhuhr', day: MIDSUMMER });
  });
});

// ===========================================================================
// Sub-polar latitudes (59–66°N) — below the polar circle, so AqrabBalad never
// engages and the night-portion high-latitude rules are the SOLE defence when
// the summer sun stops reaching the Fajr/Isha depression angles.
// ===========================================================================

describe('sub-polar latitudes (59–66°N)', () => {
  const REYKJAVIK: TimesLocation = { latitude: 64.1466, longitude: -21.9426, countryCode: 'IS' };
  const STOCKHOLM: TimesLocation = { latitude: 59.3293, longitude: 18.0686, countryCode: 'SE' };
  const ANCHORAGE: TimesLocation = { latitude: 61.2181, longitude: -149.9003, countryCode: 'US' };
  const CITIES = [
    ['Reykjavik', REYKJAVIK],
    ['Stockholm', STOCKHOLM],
    ['Anchorage', ANCHORAGE],
  ] as const;
  const RULES = ['auto', 'middleOfTheNight', 'seventhOfTheNight', 'twilightAngle'] as const;
  const MIDSUMMER = '2026-06-21';

  it.each(CITIES.map(([name, city]) => [name, city] as const))(
    '%s: never throws and stays solar-ordered across the year, under every rule',
    (_name, city) => {
      for (const rule of RULES) {
        const config = settings({ highLatitudeRule: rule });
        for (let dayNumber = 0; dayNumber < 365; dayNumber += 7) {
          const day = new Date(Date.UTC(2026, 0, 1 + dayNumber)).toISOString().slice(0, 10);
          const times = computeDayTimes(day, city, config).times;
          const values = SOLAR_ORDER.map((marker) => times[marker].getTime());
          for (const value of values) expect(Number.isFinite(value)).toBe(true);
          for (let i = 1; i < values.length; i += 1) {
            expect(values[i]).toBeGreaterThan(values[i - 1]);
          }
          expect(() => getPrayerWindows(day, city, config)).not.toThrow();
          expect(() => getIshaNudgeTime(day, city, config)).not.toThrow();
        }
      }
    }
  );

  // adhan clamps unconditionally for angle-based methods: fajr = max(angleFajr, safeFajr) and
  // isha = min(angleIsha, safeIsha), where safe sits a night-portion from sunrise/sunset and
  // night = sunset → tomorrow's sunrise. That inequality IS the rule's promise, so assert it
  // sharply on midsummer day — the day the angles fail hardest. (±60s: adhan rounds markers
  // to the minute after taking the portions from unrounded instants.)
  const PORTIONS = {
    middleOfTheNight: { fajr: 1 / 2, isha: 1 / 2 },
    seventhOfTheNight: { fajr: 1 / 7, isha: 1 / 7 },
    // MWL angles are 18°/17°; the twilightAngle rule uses angle/60 of the night.
    twilightAngle: { fajr: 18 / 60, isha: 17 / 60 },
  } as const;

  it.each(CITIES.map(([name, city]) => [name, city] as const))(
    '%s: midsummer Fajr/Isha never escape their night portion, under every explicit rule',
    (_name, city) => {
      for (const rule of ['middleOfTheNight', 'seventhOfTheNight', 'twilightAngle'] as const) {
        const config = settings({ highLatitudeRule: rule });
        const times = computeDayTimes(MIDSUMMER, city, config).times;
        const nextSunrise = computeDayTimes('2026-06-22', city, config).times.sunrise;
        // MWL has no maghrib angle, so maghrib IS sunset.
        const night = nextSunrise.getTime() - times.maghrib.getTime();
        const portion = PORTIONS[rule];
        expect(night).toBeGreaterThan(0);
        expect(times.fajr.getTime()).toBeGreaterThanOrEqual(
          times.sunrise.getTime() - portion.fajr * night - MINUTE
        );
        expect(times.isha.getTime()).toBeLessThanOrEqual(
          times.maghrib.getTime() + portion.isha * night + MINUTE
        );
        // And the windows the rules exist to protect stay real.
        expect(times.fajr.getTime()).toBeLessThan(times.sunrise.getTime());
        expect(times.isha.getTime()).toBeGreaterThan(times.maghrib.getTime());
      }
    }
  );
});

// ===========================================================================
// Southern hemisphere — the seasons invert, and nothing above may assume June
// is the long day.
// ===========================================================================

describe('southern hemisphere', () => {
  const SYDNEY: TimesLocation = { latitude: -33.8688, longitude: 151.2093, countryCode: 'AU' };
  const CAPE_TOWN: TimesLocation = { latitude: -33.9249, longitude: 18.4241, countryCode: 'ZA' };
  const SANTIAGO: TimesLocation = { latitude: -33.4489, longitude: -70.6693, countryCode: 'CL' };

  it.each([
    ['Sydney', SYDNEY],
    ['Cape Town', CAPE_TOWN],
    ['Santiago', SANTIAGO],
  ] as const)(
    '%s: December day is longer than the June day, and both stay ordered',
    (_name, city) => {
      const june = computeDayTimes('2026-06-21', city, settings()).times;
      const december = computeDayTimes('2026-12-21', city, settings()).times;
      for (const times of [june, december]) {
        const values = SOLAR_ORDER.map((marker) => times[marker].getTime());
        for (let i = 1; i < values.length; i += 1) {
          expect(values[i]).toBeGreaterThan(values[i - 1]);
        }
      }
      const dayLength = (times: typeof june) => times.maghrib.getTime() - times.sunrise.getTime();
      expect(dayLength(december) - dayLength(june)).toBeGreaterThan(3 * HOUR);
    }
  );

  it('keeps all five windows real and Isha ending at next Fajr in Sydney, both seasons', () => {
    for (const day of ['2026-06-21', '2026-12-21'] as PrayerDay[]) {
      const windows = getPrayerWindows(day, SYDNEY, settings());
      expect(windows.map((window) => window.prayer)).toEqual([...PRAYERS]);
      for (const window of windows) {
        expect(window.end.getTime()).toBeGreaterThan(window.start.getTime());
      }
    }
  });
});

// ===========================================================================
// DST — America/Santiago spring forward (2026-09-06): the jump lands ON
// MIDNIGHT itself, so 00:00 never exists on the transition day. dates.test.ts
// proves parseDay's handling; this proves the prayer math on top of it.
// ===========================================================================

describe('DST — America/Santiago spring forward at midnight (2026-09-06, 00:00 → 01:00)', () => {
  const SANTIAGO: TimesLocation = { latitude: -33.4489, longitude: -70.6693, countryCode: 'CL' };
  const report = lazy(() =>
    inTimeZone<NightReport>('America/Santiago', nightProbe, {
      ...probePayload(SANTIAGO),
      days: ['2026-09-04', '2026-09-05', '2026-09-06'],
    })
  );

  it('ran in Santiago', () => {
    expect(report().timeZone).toBe('America/Santiago');
  });

  it('loses exactly one hour of real time across the transition night', () => {
    expect(drift(report().nights['2026-09-05'])).toBe(60);
  });

  it('measures the surrounding nights with no discrepancy', () => {
    expect(drift(report().nights['2026-09-04'])).toBe(0);
    expect(drift(report().nights['2026-09-06'])).toBe(0);
  });

  it('keeps the midnight-less day’s own times ordered and on its own date', () => {
    expect(report().nights['2026-09-06'].ordered).toBe(true);
    expect(report().nights['2026-09-06'].markerDays).toEqual(Array(6).fill('2026-09-06'));
  });
});
