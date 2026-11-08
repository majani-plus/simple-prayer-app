/// <reference types="node" />
/**
 * Tests for prayer-day arithmetic.
 *
 * ## Timezone strategy
 *
 * DST correctness is a first-class product requirement (PRODUCT_SPEC §3), so the DST tests
 * here run in the *real* Europe/Berlin, America/New_York, Australia/Lord_Howe (30-minute
 * shift) and America/Santiago (midnight itself is skipped) zones — not in a simulation.
 *
 * That needs a child process: Jest's node environment hands tests a *copy* of `process.env`
 * (jest-util `createProcessObject`), so assigning `process.env.TZ` at runtime never reaches
 * Node's real environment and V8's timezone stays whatever the machine/CI has (this dev box
 * is Africa/Cairo, CI is UTC). `inTimeZone()` therefore transpiles `dates.ts` once and runs a
 * probe against it in `node -e` with a real `TZ`, returning JSON. `describe('timezone harness')`
 * fails loudly if that ever stops working, so the DST tests can never silently become vacuous.
 *
 * Everything that is *not* timezone-sensitive is tested in-process, and
 * `describe('DST immunity by construction')` proves structurally that the day arithmetic never
 * touches `Date` at all — which is what actually makes 23- and 25-hour days a non-event.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as ts from 'typescript';

import {
  MONTH_GRID_COLUMNS,
  MONTH_GRID_ROWS,
  addDays,
  compareDays,
  daysBetween,
  daysInMonth,
  diffDays,
  endOfMonth,
  isAfterDay,
  isBeforeDay,
  isFutureDay,
  isSameDay,
  isValidDay,
  monthGrid,
  monthKey,
  parseDay,
  prayerDayForInstant,
  resolvePrayerDayForInstant,
  startOfMonth,
  toDayString,
  todayDay,
  weekdayIndex,
  type MonthGrid,
  type WeekStart,
} from './dates';

// ---------------------------------------------------------------------------
// Real-timezone harness
// ---------------------------------------------------------------------------

type DatesModule = typeof import('./dates');

/** Compiled copy of `dates.ts` that child processes can `require`. Built once. */
let compiledModulePath = '';

beforeAll(() => {
  const source = fs.readFileSync(path.join(__dirname, 'dates.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: 'dates.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-dates-'));
  compiledModulePath = path.join(directory, 'dates.js');
  fs.writeFileSync(compiledModulePath, compiled);
});

/**
 * Runs `probe` in a child process whose local timezone really is `timeZone`.
 *
 * The probe is shipped as source text (`Function.prototype.toString`), so it must be
 * self-contained: no closure variables, no imports, and only values that survive `JSON`.
 */
function inTimeZone<T>(timeZone: string, probe: (dates: DatesModule) => T): T {
  const script =
    `const dates = require(${JSON.stringify(compiledModulePath)});` +
    `const probe = (${probe.toString()});` +
    `process.stdout.write(JSON.stringify(probe(dates)));`;
  const stdout = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timeZone },
    timeout: 60_000,
  });
  return JSON.parse(stdout) as T;
}

/**
 * DST transition days used throughout, verified against the tz database:
 * - `2026-03-08` New York springs forward (23h)
 * - `2026-03-29` Berlin springs forward (23h)
 * - `2026-04-05` Lord Howe falls back by 30 minutes (24.5h)
 * - `2026-09-06` Santiago springs forward *at midnight*, so 00:00 never happens (23h)
 * - `2026-10-04` Lord Howe springs forward by 30 minutes (23.5h)
 * - `2026-10-25` Berlin falls back (25h)
 * - `2026-11-01` New York falls back (25h)
 */
const TRANSITION_DAYS = [
  '2026-03-08',
  '2026-03-29',
  '2026-04-05',
  '2026-09-06',
  '2026-10-04',
  '2026-10-25',
  '2026-11-01',
] as const;

const ZONES = [
  'UTC', // CI
  'Europe/Berlin', // +1/+2 DST
  'America/New_York', // -5/-4 DST
  'Australia/Lord_Howe', // +10:30/+11 — a 30-minute DST shift
  'America/Santiago', // -4/-3 — the jump lands on midnight itself
  'Pacific/Kiritimati', // +14, furthest ahead of UTC, no DST
  'Pacific/Pago_Pago', // -11, furthest behind UTC, no DST
] as const;

interface ZoneReport {
  timeZone: string;
  /** Real length of each transition day in that zone: 23, 23.5, 24, 24.5 or 25. */
  dayLengthHours: Record<string, number>;
  /** Local hour `parseDay` lands on — 0, or 1 where the zone skips midnight. */
  midnightLocalHour: Record<string, number>;
  /** Days of 2026 where `parseDay` is not the first instant of that day. Must stay empty. */
  dayStartFailures: string[];
  /** Days of 2026 where `weekdayIndex` disagrees with `Date.getDay()`. Must stay empty. */
  weekdayFailures: string[];
  addDays: Record<string, string>;
  diffDays: Record<string, number>;
  /** What a naive `elapsedMs / 86_400_000` would have answered. Kept to prove the hazard. */
  naiveDiffDays: Record<string, number>;
  daysBetweenLengths: Record<string, number>;
  monthGrids: Record<string, string>;
  calendarDateAroundJump: Record<string, string>;
  prayerDayAroundJump: Record<string, string>;
  localDate: Record<string, string>;
  utcDate: Record<string, string>;
}

function zoneReportProbe(dates: DatesModule): ZoneReport {
  const HOUR = 3600000;
  const transitionDays = [
    '2026-03-08',
    '2026-03-29',
    '2026-04-05',
    '2026-09-06',
    '2026-10-04',
    '2026-10-25',
    '2026-11-01',
  ];

  const dayLengthHours: Record<string, number> = {};
  const midnightLocalHour: Record<string, number> = {};
  for (let i = 0; i < transitionDays.length; i += 1) {
    const day = transitionDays[i];
    const start = dates.parseDay(day);
    const nextStart = dates.parseDay(dates.addDays(day, 1));
    dayLengthHours[day] = (nextStart.getTime() - start.getTime()) / HOUR;
    midnightLocalHour[day] = start.getHours();
  }

  const year = dates.daysBetween('2026-01-01', '2026-12-31');
  const dayStartFailures: string[] = [];
  const weekdayFailures: string[] = [];
  for (let j = 0; j < year.length; j += 1) {
    const d = year[j];
    const dayStart = dates.parseDay(d);
    // `parseDay` must be inside the day, and one millisecond earlier must be the day before —
    // i.e. it is the earliest instant of that day, even where 00:00 itself does not exist.
    if (dates.toDayString(dayStart) !== d) dayStartFailures.push(d + ':self');
    if (dates.toDayString(new Date(dayStart.getTime() - 1)) !== dates.addDays(d, -1)) {
      dayStartFailures.push(d + ':previous');
    }
    if (dates.weekdayIndex(d) !== dayStart.getDay()) weekdayFailures.push(d);
  }

  function naiveDiff(a: string, b: string): number {
    return Math.floor((dates.parseDay(b).getTime() - dates.parseDay(a).getTime()) / (24 * HOUR));
  }

  const springFajr = new Date(2026, 2, 29, 5, 0, 0, 0);
  const fallFajr = new Date(2026, 10, 1, 6, 20, 0, 0);
  const repeatedOneThirty = new Date(new Date(2026, 10, 1, 1, 30, 0, 0).getTime() + HOUR);

  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayLengthHours: dayLengthHours,
    midnightLocalHour: midnightLocalHour,
    dayStartFailures: dayStartFailures,
    weekdayFailures: weekdayFailures,
    addDays: {
      'berlinSpring-1': dates.addDays('2026-03-29', -1),
      'berlinSpring+1': dates.addDays('2026-03-29', 1),
      'berlinFall+1': dates.addDays('2026-10-25', 1),
      'newYorkSpring+1': dates.addDays('2026-03-08', 1),
      'newYorkFall+1': dates.addDays('2026-11-01', 1),
      'lordHowe+1': dates.addDays('2026-10-04', 1),
      'santiago+1': dates.addDays('2026-09-06', 1),
      'leapDay+1': dates.addDays('2028-02-28', 1),
      'yearEnd+1': dates.addDays('2026-12-31', 1),
    },
    diffDays: {
      berlinSpring: dates.diffDays('2026-03-28', '2026-03-30'),
      berlinFall: dates.diffDays('2026-10-24', '2026-10-26'),
      newYorkSpring: dates.diffDays('2026-03-07', '2026-03-09'),
      newYorkFall: dates.diffDays('2026-10-31', '2026-11-02'),
      lordHowe: dates.diffDays('2026-10-03', '2026-10-05'),
      santiago: dates.diffDays('2026-09-05', '2026-09-07'),
      march: dates.diffDays('2026-03-01', '2026-04-01'),
      october: dates.diffDays('2026-10-01', '2026-11-01'),
      year: dates.diffDays('2026-01-01', '2027-01-01'),
    },
    naiveDiffDays: {
      berlinSpring: naiveDiff('2026-03-28', '2026-03-30'),
      newYorkSpring: naiveDiff('2026-03-07', '2026-03-09'),
      santiago: naiveDiff('2026-09-05', '2026-09-07'),
      march: naiveDiff('2026-03-01', '2026-04-01'),
      october: naiveDiff('2026-10-01', '2026-11-01'),
    },
    daysBetweenLengths: {
      march: dates.daysBetween('2026-03-01', '2026-03-31').length,
      october: dates.daysBetween('2026-10-01', '2026-10-31').length,
      november: dates.daysBetween('2026-11-01', '2026-11-30').length,
      leapFebruary: dates.daysBetween('2028-02-01', '2028-02-29').length,
    },
    monthGrids: {
      march2026: JSON.stringify(dates.monthGrid(2026, 2, 1)),
      august2026: JSON.stringify(dates.monthGrid(2026, 7, 0)),
      october2026: JSON.stringify(dates.monthGrid(2026, 9, 0)),
      november2026: JSON.stringify(dates.monthGrid(2026, 10, 1)),
      february2028: JSON.stringify(dates.monthGrid(2028, 1, 0)),
    },
    calendarDateAroundJump: {
      'mar29@0130': dates.toDayString(new Date(2026, 2, 29, 1, 30, 0, 0)),
      'mar29@0330': dates.toDayString(new Date(2026, 2, 29, 3, 30, 0, 0)),
      'sep6@0130': dates.toDayString(new Date(2026, 8, 6, 1, 30, 0, 0)),
      'nov1@0130': dates.toDayString(new Date(2026, 10, 1, 1, 30, 0, 0)),
      'nov1@0130+1h': dates.toDayString(repeatedOneThirty),
    },
    prayerDayAroundJump: {
      'spring@0130': dates.prayerDayForInstant(new Date(2026, 2, 29, 1, 30, 0, 0), springFajr),
      'spring@0330': dates.prayerDayForInstant(new Date(2026, 2, 29, 3, 30, 0, 0), springFajr),
      'spring@fajr-1ms': dates.prayerDayForInstant(new Date(springFajr.getTime() - 1), springFajr),
      'spring@fajr': dates.prayerDayForInstant(new Date(springFajr.getTime()), springFajr),
      'spring@fajr+1ms': dates.prayerDayForInstant(new Date(springFajr.getTime() + 1), springFajr),
      'spring@0600': dates.prayerDayForInstant(new Date(2026, 2, 29, 6, 0, 0, 0), springFajr),
      'fall@0130': dates.prayerDayForInstant(new Date(2026, 10, 1, 1, 30, 0, 0), fallFajr),
      'fall@0130+1h': dates.prayerDayForInstant(repeatedOneThirty, fallFajr),
      'fall@0700': dates.prayerDayForInstant(new Date(2026, 10, 1, 7, 0, 0, 0), fallFajr),
    },
    localDate: {
      'jul2@0030': dates.toDayString(new Date(2026, 6, 2, 0, 30, 0, 0)),
      'jul2@2330': dates.toDayString(new Date(2026, 6, 2, 23, 30, 0, 0)),
    },
    utcDate: {
      'jul2@0030': new Date(2026, 6, 2, 0, 30, 0, 0).toISOString().slice(0, 10),
      'jul2@2330': new Date(2026, 6, 2, 23, 30, 0, 0).toISOString().slice(0, 10),
    },
  };
}

const reports = new Map<string, ZoneReport>();

function reportFor(zone: string): ZoneReport {
  const cached = reports.get(zone);
  if (cached !== undefined) return cached;
  const report = inTimeZone(zone, zoneReportProbe);
  reports.set(zone, report);
  return report;
}

beforeAll(() => {
  for (const zone of ZONES) reportFor(zone);
});

// ---------------------------------------------------------------------------
// Harness guard — if this breaks, every DST test below is meaningless
// ---------------------------------------------------------------------------

describe('timezone harness', () => {
  it('really runs the module in the requested timezone', () => {
    for (const zone of ZONES) {
      expect(reportFor(zone).timeZone).toBe(zone);
    }
  });

  it('really produces 23-, 23.5-, 24.5- and 25-hour days', () => {
    expect(reportFor('UTC').dayLengthHours).toEqual({
      '2026-03-08': 24,
      '2026-03-29': 24,
      '2026-04-05': 24,
      '2026-09-06': 24,
      '2026-10-04': 24,
      '2026-10-25': 24,
      '2026-11-01': 24,
    });
    expect(reportFor('Europe/Berlin').dayLengthHours['2026-03-29']).toBe(23);
    expect(reportFor('Europe/Berlin').dayLengthHours['2026-10-25']).toBe(25);
    expect(reportFor('America/New_York').dayLengthHours['2026-03-08']).toBe(23);
    expect(reportFor('America/New_York').dayLengthHours['2026-11-01']).toBe(25);
    expect(reportFor('Australia/Lord_Howe').dayLengthHours['2026-10-04']).toBe(23.5);
    expect(reportFor('Australia/Lord_Howe').dayLengthHours['2026-04-05']).toBe(24.5);
    expect(reportFor('America/Santiago').dayLengthHours['2026-09-06']).toBe(23);
  });
});

// ---------------------------------------------------------------------------
// DST: the arithmetic
// ---------------------------------------------------------------------------

describe('DST — day arithmetic in real transition zones', () => {
  it('addDays gives byte-identical answers in every zone', () => {
    const expected = {
      'berlinSpring-1': '2026-03-28',
      'berlinSpring+1': '2026-03-30',
      'berlinFall+1': '2026-10-26',
      'newYorkSpring+1': '2026-03-09',
      'newYorkFall+1': '2026-11-02',
      'lordHowe+1': '2026-10-05',
      'santiago+1': '2026-09-07',
      'leapDay+1': '2028-02-29',
      'yearEnd+1': '2027-01-01',
    };
    for (const zone of ZONES) {
      expect(reportFor(zone).addDays).toEqual(expected);
    }
  });

  it('diffDays counts a 23- or 25-hour day as exactly one day', () => {
    const expected = {
      berlinSpring: 2,
      berlinFall: 2,
      newYorkSpring: 2,
      newYorkFall: 2,
      lordHowe: 2,
      santiago: 2,
      march: 31,
      october: 31,
      year: 365,
    };
    for (const zone of ZONES) {
      expect(reportFor(zone).diffDays).toEqual(expected);
    }
  });

  it('would have been wrong with naive millisecond division (the hazard is real)', () => {
    // 2026-03-28 → 2026-03-30 is only 47 hours in Berlin, so ms/86_400_000 floors to 1.
    expect(reportFor('Europe/Berlin').naiveDiffDays.berlinSpring).toBe(1);
    expect(reportFor('Europe/Berlin').diffDays.berlinSpring).toBe(2);
    // A whole March is 743 hours in a spring-forward zone → the naive answer loses a day.
    expect(reportFor('Europe/Berlin').naiveDiffDays.march).toBe(30);
    expect(reportFor('America/New_York').naiveDiffDays.march).toBe(30);
    expect(reportFor('America/New_York').naiveDiffDays.newYorkSpring).toBe(1);
    expect(reportFor('America/Santiago').naiveDiffDays.santiago).toBe(1);
    // Even a 30-minute shift is enough to break it.
    expect(reportFor('Australia/Lord_Howe').naiveDiffDays.october).toBe(30);
    // …and it happens to be right in UTC, which is exactly why CI alone would never catch it.
    expect(reportFor('UTC').naiveDiffDays).toEqual({
      berlinSpring: 2,
      newYorkSpring: 2,
      santiago: 2,
      march: 31,
      october: 31,
    });
  });

  it('daysBetween returns the full month across every transition', () => {
    const expected = { march: 31, october: 31, november: 30, leapFebruary: 29 };
    for (const zone of ZONES) {
      expect(reportFor(zone).daysBetweenLengths).toEqual(expected);
    }
  });

  it('monthGrid renders identically in every zone', () => {
    const reference = reportFor('UTC').monthGrids;
    for (const zone of ZONES) {
      expect(reportFor(zone).monthGrids).toEqual(reference);
    }
    // And matches what this process computes in its own ambient zone.
    expect(reference.august2026).toBe(JSON.stringify(monthGrid(2026, 7, 0)));
    expect(reference.february2028).toBe(JSON.stringify(monthGrid(2028, 1, 0)));
  });

  it('weekdayIndex agrees with Date.getDay() for every day of 2026, in every zone', () => {
    for (const zone of ZONES) {
      expect(reportFor(zone).weekdayFailures).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// DST: instant <-> day conversion
// ---------------------------------------------------------------------------

describe('DST — instant conversion in real transition zones', () => {
  it('parseDay is the earliest instant of the day, every day of 2026, in every zone', () => {
    for (const zone of ZONES) {
      expect(reportFor(zone).dayStartFailures).toEqual([]);
    }
  });

  it('parseDay lands on local midnight, or on 01:00 where the zone skips midnight', () => {
    for (const zone of ZONES) {
      const hours = reportFor(zone).midnightLocalHour;
      for (const day of TRANSITION_DAYS) {
        expect(hours[day]).toBe(zone === 'America/Santiago' && day === '2026-09-06' ? 1 : 0);
      }
    }
  });

  it('toDayString reports the calendar date on both sides of a jump', () => {
    const expected = {
      'mar29@0130': '2026-03-29', // Berlin: the last half-hour of CET
      'mar29@0330': '2026-03-29', // Berlin: first half-hour of CEST — 02:xx never happened
      'sep6@0130': '2026-09-06', // Santiago: the first hour that exists that day
      'nov1@0130': '2026-11-01', // New York: first (EDT) pass
      'nov1@0130+1h': '2026-11-01', // New York: the repeat (EST) pass, an hour later
    };
    for (const zone of ZONES) {
      expect(reportFor(zone).calendarDateAroundJump).toEqual(expected);
    }
  });

  it('toDayString uses local fields and is never UTC-shifted', () => {
    for (const zone of ZONES) {
      expect(reportFor(zone).localDate).toEqual({
        'jul2@0030': '2026-07-02',
        'jul2@2330': '2026-07-02',
      });
    }
    // Proof the two really do diverge: at UTC+14 just-after-midnight is still "yesterday" in
    // UTC, and at UTC-11 late evening is already "tomorrow".
    expect(reportFor('Pacific/Kiritimati').utcDate['jul2@0030']).toBe('2026-07-01');
    expect(reportFor('Pacific/Pago_Pago').utcDate['jul2@2330']).toBe('2026-07-03');
  });

  it('prayerDayForInstant holds the Fajr boundary through both jumps, in every zone', () => {
    const expected = {
      'spring@0130': '2026-03-28',
      'spring@0330': '2026-03-28',
      'spring@fajr-1ms': '2026-03-28',
      'spring@fajr': '2026-03-29',
      'spring@fajr+1ms': '2026-03-29',
      'spring@0600': '2026-03-29',
      'fall@0130': '2026-10-31',
      'fall@0130+1h': '2026-10-31',
      'fall@0700': '2026-11-01',
    };
    for (const zone of ZONES) {
      expect(reportFor(zone).prayerDayAroundJump).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Structural proof: the arithmetic cannot see a clock at all
// ---------------------------------------------------------------------------

describe('DST immunity by construction', () => {
  /** Runs `fn` with the global `Date` replaced by a booby trap. Assert outside the callback. */
  function withoutGlobalDate<T>(fn: () => T): T {
    const globals = globalThis as unknown as { Date: unknown };
    const realDate = globals.Date;
    globals.Date = function BannedDate() {
      throw new Error('prayer-day arithmetic must not construct a Date');
    };
    try {
      return fn();
    } finally {
      globals.Date = realDate;
    }
  }

  it('never constructs a Date, so no timezone or DST rule can reach it', () => {
    const result = withoutGlobalDate(() => ({
      added: addDays('2026-03-29', 1),
      subtracted: addDays('2026-10-25', -1),
      diffed: diffDays('2026-03-28', '2026-03-30'),
      compared: compareDays('2026-03-29', '2026-03-30'),
      same: isSameDay('2026-03-29', '2026-03-29'),
      before: isBeforeDay('2026-03-28', '2026-03-29'),
      after: isAfterDay('2026-03-30', '2026-03-29'),
      future: isFutureDay('2026-03-30', '2026-03-29'),
      ranged: daysBetween('2026-10-24', '2026-10-26'),
      weekday: weekdayIndex('2026-08-01'),
      monthStart: startOfMonth('2026-10-25'),
      monthEnd: endOfMonth('2028-02-01'),
      key: monthKey('2026-10-25'),
      length: daysInMonth(2028, 1),
      grid: monthGrid(2026, 1, 0)[0][0],
      valid: isValidDay('2026-02-30'),
    }));

    expect(result).toEqual({
      added: '2026-03-30',
      subtracted: '2026-10-24',
      diffed: 2,
      compared: -1,
      same: true,
      before: true,
      after: true,
      future: true,
      ranged: ['2026-10-24', '2026-10-25', '2026-10-26'],
      weekday: 6,
      monthStart: '2026-10-01',
      monthEnd: '2028-02-29',
      key: '2026-10',
      length: 29,
      grid: '2026-02-01',
      valid: false,
    });
  });

  it('proves the booby trap works (otherwise the test above proves nothing)', () => {
    let threw = false;
    try {
      withoutGlobalDate(() => parseDay('2026-03-29'));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toDayString
// ---------------------------------------------------------------------------

describe('toDayString', () => {
  it('formats the local calendar date with zero padding', () => {
    expect(toDayString(new Date(2026, 0, 5, 13, 45))).toBe('2026-01-05');
    expect(toDayString(new Date(2026, 8, 9, 0, 0))).toBe('2026-09-09');
    expect(toDayString(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12-31');
  });

  it('reads the local fields it was given, whatever the ambient zone', () => {
    const instant = new Date(2026, 6, 2, 23, 30);
    expect(toDayString(instant)).toBe(
      `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(
        instant.getDate()
      ).padStart(2, '0')}`
    );
  });

  it('handles years below 1000 without century remapping', () => {
    const early = new Date(2000, 0, 1);
    early.setFullYear(999, 0, 2);
    expect(toDayString(early)).toBe('0999-01-02');
  });

  it('throws on an invalid Date', () => {
    expect(() => toDayString(new Date('not a date'))).toThrow(RangeError);
    expect(() => toDayString(undefined as unknown as Date)).toThrow(RangeError);
    expect(() => toDayString('2026-07-02' as unknown as Date)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// parseDay
// ---------------------------------------------------------------------------

describe('parseDay', () => {
  it('returns the start of the local day', () => {
    const midnight = parseDay('2026-07-02');
    expect([midnight.getFullYear(), midnight.getMonth(), midnight.getDate()]).toEqual([2026, 6, 2]);
    expect([
      midnight.getHours(),
      midnight.getMinutes(),
      midnight.getSeconds(),
      midnight.getMilliseconds(),
    ]).toEqual([0, 0, 0, 0]);
  });

  it('round-trips through toDayString', () => {
    for (const day of daysBetween('2026-01-01', '2026-12-31')) {
      expect(toDayString(parseDay(day))).toBe(day);
    }
  });

  it('accepts February 29th in a leap year', () => {
    expect(toDayString(parseDay('2028-02-29'))).toBe('2028-02-29');
    expect(toDayString(parseDay('2000-02-29'))).toBe('2000-02-29');
  });

  it('rejects malformed and non-existent dates', () => {
    for (const bad of [
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-01-32',
      '2026-1-3',
      '26-01-03',
      '2026-01-03T00:00:00',
      'today',
      '',
    ]) {
      expect(() => parseDay(bad)).toThrow(RangeError);
    }
    expect(() => parseDay(20260103 as unknown as string)).toThrow(RangeError);
    expect(() => parseDay(null as unknown as string)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// todayDay
// ---------------------------------------------------------------------------

describe('todayDay', () => {
  it('uses the supplied instant', () => {
    expect(todayDay(new Date(2026, 7, 19, 2, 15))).toBe('2026-08-19');
    expect(todayDay(new Date(2028, 1, 29, 23, 59))).toBe('2028-02-29');
  });

  it('defaults to the current instant', () => {
    // Pinned to local noon so the assertion cannot race the real clock across midnight
    // (the previous `new Date()` form could disagree with `todayDay()` if the day rolled
    // over between the two calls) and so it holds in every host timezone.
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(2026, 6, 3, 12, 0));
      expect(todayDay()).toBe('2026-07-03');
      expect(todayDay()).toBe(toDayString(new Date()));
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the new calendar date after midnight — the Fajr rule is not applied here', () => {
    expect(todayDay(new Date(2026, 6, 3, 0, 30))).toBe('2026-07-03');
  });
});

// ---------------------------------------------------------------------------
// addDays
// ---------------------------------------------------------------------------

describe('addDays', () => {
  it('adds, subtracts and no-ops', () => {
    expect(addDays('2026-07-02', 1)).toBe('2026-07-03');
    expect(addDays('2026-07-02', -1)).toBe('2026-07-01');
    expect(addDays('2026-07-02', 0)).toBe('2026-07-02');
    expect(addDays('2026-07-02', 30)).toBe('2026-08-01');
  });

  it('crosses month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-02-01', -1)).toBe('2026-01-31');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-12-31', 366)).toBe('2028-01-01');
    expect(addDays('2027-01-01', -366)).toBe('2025-12-31');
  });

  it('handles leap years, including the century rules', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29'); // divisible by 400 → leap
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01'); // divisible by 100, not 400 → common
    expect(addDays('2028-01-01', 366)).toBe('2029-01-01');
    expect(addDays('2027-01-01', 365)).toBe('2028-01-01');
  });

  it('rejects non-integer offsets and malformed days', () => {
    expect(() => addDays('2026-07-02', 1.5)).toThrow(RangeError);
    expect(() => addDays('2026-07-02', NaN)).toThrow(RangeError);
    expect(() => addDays('2026-07-02', Infinity)).toThrow(RangeError);
    expect(() => addDays('2026-07-02', '1' as unknown as number)).toThrow(RangeError);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });

  it('refuses to leave the supported year range', () => {
    expect(() => addDays('0000-01-01', -1)).toThrow(RangeError);
    expect(() => addDays('9999-12-31', 1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// diffDays
// ---------------------------------------------------------------------------

describe('diffDays', () => {
  it('counts whole days with a sign', () => {
    expect(diffDays('2026-07-02', '2026-07-05')).toBe(3);
    expect(diffDays('2026-07-05', '2026-07-02')).toBe(-3);
    expect(diffDays('2026-07-02', '2026-07-02')).toBe(0);
  });

  it('spans month, year and leap boundaries', () => {
    expect(diffDays('2026-01-31', '2026-02-01')).toBe(1);
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(diffDays('2028-01-01', '2029-01-01')).toBe(366); // leap year
    expect(diffDays('2028-02-01', '2028-03-01')).toBe(29);
    expect(diffDays('2027-02-01', '2027-03-01')).toBe(28);
    expect(diffDays('2100-02-01', '2100-03-01')).toBe(28);
    expect(diffDays('2000-02-01', '2000-03-01')).toBe(29);
  });

  it('is the exact inverse of addDays', () => {
    const anchors = [
      '2026-01-01',
      '2026-03-29',
      '2026-10-25',
      '2026-03-08',
      '2026-11-01',
      '2028-02-28',
      '2026-12-31',
    ];
    const offsets = [-400, -31, -2, -1, 0, 1, 2, 31, 400];
    for (const anchor of anchors) {
      for (const offset of offsets) {
        const shifted = addDays(anchor, offset);
        expect(diffDays(anchor, shifted)).toBe(offset);
        expect(addDays(anchor, diffDays(anchor, shifted))).toBe(shifted);
      }
    }
  });

  it('reports which argument was malformed', () => {
    expect(() => diffDays('2026-02-30', '2026-03-01')).toThrow(/Invalid a/);
    expect(() => diffDays('2026-03-01', 'nope')).toThrow(/Invalid b/);
  });
});

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

describe('compareDays and the boolean helpers', () => {
  it('orders days chronologically', () => {
    expect(compareDays('2026-07-01', '2026-07-02')).toBe(-1);
    expect(compareDays('2026-07-02', '2026-07-02')).toBe(0);
    expect(compareDays('2026-07-03', '2026-07-02')).toBe(1);
    expect(compareDays('2026-12-31', '2027-01-01')).toBe(-1);
    expect(compareDays('2028-02-29', '2028-03-01')).toBe(-1);
    expect(compareDays('2026-09-01', '2026-10-01')).toBe(-1);
  });

  it('sorts a shuffled list correctly', () => {
    const shuffled = ['2027-01-01', '2026-02-28', '2026-12-31', '2028-02-29', '2026-01-01'];
    expect([...shuffled].sort(compareDays)).toEqual([
      '2026-01-01',
      '2026-02-28',
      '2026-12-31',
      '2027-01-01',
      '2028-02-29',
    ]);
  });

  it('exposes isSameDay / isBeforeDay / isAfterDay', () => {
    expect(isSameDay('2026-07-02', '2026-07-02')).toBe(true);
    expect(isSameDay('2026-07-02', '2026-07-03')).toBe(false);
    expect(isBeforeDay('2026-07-02', '2026-07-03')).toBe(true);
    expect(isBeforeDay('2026-07-03', '2026-07-02')).toBe(false);
    expect(isBeforeDay('2026-07-02', '2026-07-02')).toBe(false);
    expect(isAfterDay('2026-07-03', '2026-07-02')).toBe(true);
    expect(isAfterDay('2026-07-02', '2026-07-03')).toBe(false);
    expect(isAfterDay('2026-07-02', '2026-07-02')).toBe(false);
  });

  it('treats today as not-future and locks only later days', () => {
    const today = '2026-08-19';
    expect(isFutureDay(today, today)).toBe(false);
    expect(isFutureDay('2026-08-18', today)).toBe(false);
    expect(isFutureDay('2026-08-20', today)).toBe(true);
    expect(isFutureDay('2027-01-01', today)).toBe(true);
    expect(isFutureDay('2026-10-26', '2026-10-25')).toBe(true);
    expect(isFutureDay('2026-10-24', '2026-10-25')).toBe(false);
  });

  it('validates its inputs', () => {
    expect(() => compareDays('2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => isSameDay('2026-03-01', 'nope')).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// daysBetween
// ---------------------------------------------------------------------------

describe('daysBetween', () => {
  it('is inclusive of both ends', () => {
    expect(daysBetween('2026-07-01', '2026-07-04')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
    ]);
  });

  it('returns a single day when start equals end', () => {
    expect(daysBetween('2026-07-02', '2026-07-02')).toEqual(['2026-07-02']);
  });

  it('returns an empty array when start is after end', () => {
    expect(daysBetween('2026-07-04', '2026-07-01')).toEqual([]);
    expect(daysBetween('2027-01-01', '2026-12-31')).toEqual([]);
  });

  it('crosses month, year and leap boundaries', () => {
    expect(daysBetween('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
    expect(daysBetween('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(daysBetween('2028-02-27', '2028-03-01')).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(daysBetween('2027-02-27', '2027-03-01')).toEqual([
      '2027-02-27',
      '2027-02-28',
      '2027-03-01',
    ]);
  });

  it('covers a full leap year without gaps or repeats', () => {
    const days = daysBetween('2028-01-01', '2028-12-31');
    expect(days).toHaveLength(366);
    expect(new Set(days).size).toBe(366);
    expect(days).toContain('2028-02-29');
    expect(days[0]).toBe('2028-01-01');
    expect(days[days.length - 1]).toBe('2028-12-31');
    expect(days.every((day, index) => index === 0 || diffDays(days[index - 1], day) === 1)).toBe(
      true
    );
  });

  it('validates both endpoints', () => {
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(/Invalid startDay/);
    expect(() => daysBetween('2026-03-01', '2026-13-01')).toThrow(/Invalid endDay/);
  });
});

// ---------------------------------------------------------------------------
// prayerDayForInstant — the Fajr → next-Fajr boundary
// ---------------------------------------------------------------------------

describe('prayerDayForInstant', () => {
  it('assigns an Isha logged at 00:30 to the previous calendar date', () => {
    const instant = new Date(2026, 6, 3, 0, 30); // 3 July, 00:30 local
    const fajrOfJuly3 = new Date(2026, 6, 3, 4, 13);
    expect(prayerDayForInstant(instant, fajrOfJuly3)).toBe('2026-07-02');
  });

  it('is exclusive just before Fajr and inclusive exactly at Fajr', () => {
    const fajr = new Date(2026, 6, 3, 3, 20, 0, 0);
    expect(prayerDayForInstant(new Date(fajr.getTime() - 1), fajr)).toBe('2026-07-02');
    expect(prayerDayForInstant(new Date(fajr.getTime()), fajr)).toBe('2026-07-03');
    expect(prayerDayForInstant(new Date(fajr.getTime() + 1), fajr)).toBe('2026-07-03');
  });

  it('keeps the rest of the day on its calendar date', () => {
    const fajr = new Date(2026, 6, 3, 4, 13);
    expect(prayerDayForInstant(new Date(2026, 6, 3, 12, 0), fajr)).toBe('2026-07-03');
    expect(prayerDayForInstant(new Date(2026, 6, 3, 21, 45), fajr)).toBe('2026-07-03');
    expect(prayerDayForInstant(new Date(2026, 6, 3, 23, 59, 59, 999), fajr)).toBe('2026-07-03');
  });

  it('rolls back across a month boundary', () => {
    const fajrOfAug1 = new Date(2026, 7, 1, 4, 30);
    expect(prayerDayForInstant(new Date(2026, 7, 1, 0, 30), fajrOfAug1)).toBe('2026-07-31');
    const fajrOfMar1 = new Date(2027, 2, 1, 5, 40);
    expect(prayerDayForInstant(new Date(2027, 2, 1, 2, 0), fajrOfMar1)).toBe('2027-02-28');
  });

  it('rolls back across a year boundary', () => {
    const fajrOfJan1 = new Date(2027, 0, 1, 6, 20);
    expect(prayerDayForInstant(new Date(2027, 0, 1, 1, 0), fajrOfJan1)).toBe('2026-12-31');
  });

  it('rolls back onto February 29th in a leap year', () => {
    const fajrOfMar1 = new Date(2028, 2, 1, 5, 10);
    expect(prayerDayForInstant(new Date(2028, 2, 1, 1, 15), fajrOfMar1)).toBe('2028-02-29');
  });

  it('handles a Fajr pushed before midnight by a large negative offset', () => {
    // Documented behaviour: only the two instants are compared, so a Fajr at 23:50 the night
    // before means 00:05 is already *after* Fajr and belongs to the new calendar date.
    const shiftedFajr = new Date(2026, 6, 1, 23, 50);
    expect(prayerDayForInstant(new Date(2026, 6, 2, 0, 5), shiftedFajr)).toBe('2026-07-02');
  });

  it('throws on invalid inputs', () => {
    const valid = new Date(2026, 6, 2, 4, 0);
    expect(() => prayerDayForInstant(new Date('nope'), valid)).toThrow(RangeError);
    expect(() => prayerDayForInstant(valid, new Date('nope'))).toThrow(RangeError);
    expect(() => prayerDayForInstant(valid, undefined as unknown as Date)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// resolvePrayerDayForInstant
// ---------------------------------------------------------------------------

describe('resolvePrayerDayForInstant', () => {
  /** A Fajr oracle at a fixed local hour — the ordinary, same-timezone case. */
  const fajrAtLocal = (hour: number, minute = 0) => (day: string) => {
    const at = parseDay(day);
    at.setHours(hour, minute, 0, 0);
    return at;
  };

  it('agrees with prayerDayForInstant in the ordinary case', () => {
    const oracle = fajrAtLocal(4, 13);
    const preDawn = new Date(2026, 6, 3, 0, 30);
    const morning = new Date(2026, 6, 3, 6, 0);
    expect(resolvePrayerDayForInstant(preDawn, oracle)).toBe('2026-07-02');
    expect(resolvePrayerDayForInstant(preDawn, oracle)).toBe(
      prayerDayForInstant(preDawn, oracle('2026-07-03'))
    );
    expect(resolvePrayerDayForInstant(morning, oracle)).toBe('2026-07-03');
  });

  it('is exclusive just before Fajr and inclusive exactly at Fajr', () => {
    const oracle = fajrAtLocal(3, 20);
    const fajr = oracle('2026-07-03');
    expect(resolvePrayerDayForInstant(new Date(fajr.getTime() - 1), oracle)).toBe('2026-07-02');
    expect(resolvePrayerDayForInstant(new Date(fajr.getTime()), oracle)).toBe('2026-07-03');
  });

  it('walks TWO days back when the device calendar runs a full day ahead of the city', () => {
    // A device on UTC+14 whose chosen city sits on UTC−11 (25 hours apart): the instant's
    // local calendar date is two days past the prayer day at the city, and the one-step rule
    // would land on the wrong day — the label a log write files under. The oracle stands in
    // for that city: each day's Fajr is ~29 local hours away, i.e. always in the device's
    // "tomorrow", so the defining inequality fajr(D) <= t < fajr(D+1) resolves two days back.
    const cityFajr = (day: string) => new Date(parseDay(day).getTime() + 29 * 3_600_000);
    const preCityDawn = new Date(2026, 7, 21, 0, 30); // device Aug 21, city still on Aug 19
    expect(resolvePrayerDayForInstant(preCityDawn, cityFajr)).toBe('2026-08-19');
  });

  it('walks forward when the device calendar runs a full day behind the city', () => {
    // The mirror image: device on UTC−11, city on UTC+14. Each day's Fajr is ~19 local hours
    // BEFORE the device's midnight of that date, so by device-evening the next label's Fajr
    // has already passed and the prayer day is a day ahead of the calendar date.
    const cityFajr = (day: string) => new Date(parseDay(day).getTime() - 19 * 3_600_000);
    const deviceEvening = new Date(2026, 7, 20, 18, 0); // city already past Fajr of Aug 21
    expect(resolvePrayerDayForInstant(deviceEvening, cityFajr)).toBe('2026-08-21');
  });

  it('stops at the walk bound instead of looping on a pathological oracle', () => {
    // An oracle that always answers "later than the instant" can never satisfy the inequality;
    // the walk must terminate with an answer rather than hang or throw.
    const alwaysFuture = () => new Date(2100, 0, 1);
    expect(() =>
      resolvePrayerDayForInstant(new Date(2026, 7, 20, 12, 0), alwaysFuture)
    ).not.toThrow();
  });

  it('throws on an invalid instant and on an oracle returning an invalid Date', () => {
    const oracle = fajrAtLocal(4, 0);
    expect(() => resolvePrayerDayForInstant(new Date('nope'), oracle)).toThrow(RangeError);
    expect(() =>
      resolvePrayerDayForInstant(new Date(2026, 7, 20, 12, 0), () => new Date('nope'))
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// weekdayIndex
// ---------------------------------------------------------------------------

describe('weekdayIndex', () => {
  it('matches known weekdays (0 = Sunday)', () => {
    expect(weekdayIndex('1970-01-01')).toBe(4); // Thursday — the epoch
    expect(weekdayIndex('2026-02-01')).toBe(0); // Sunday
    expect(weekdayIndex('2026-08-01')).toBe(6); // Saturday
    expect(weekdayIndex('2028-02-29')).toBe(2); // Tuesday
    expect(weekdayIndex('2026-12-31')).toBe(4); // Thursday
  });

  it('agrees with Date.getDay() across a full year', () => {
    const year = daysBetween('2026-01-01', '2026-12-31');
    expect(year.map((day) => weekdayIndex(day))).toEqual(year.map((day) => parseDay(day).getDay()));
  });

  it('advances by one per day and wraps at 7', () => {
    let previous = weekdayIndex('2026-03-25');
    for (const day of daysBetween('2026-03-26', '2026-04-05')) {
      const current = weekdayIndex(day);
      expect(current).toBe((previous + 1) % 7);
      previous = current;
    }
  });

  it('works for dates before the epoch', () => {
    expect(weekdayIndex('1969-12-31')).toBe(3); // Wednesday
  });
});

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

describe('daysInMonth', () => {
  it('returns the standard month lengths', () => {
    const lengths = Array.from({ length: 12 }, (_, index) => daysInMonth(2026, index));
    expect(lengths).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it('applies the full leap-year rule to February', () => {
    expect(daysInMonth(2028, 1)).toBe(29); // divisible by 4
    expect(daysInMonth(2027, 1)).toBe(28);
    expect(daysInMonth(2100, 1)).toBe(28); // divisible by 100, not 400
    expect(daysInMonth(2000, 1)).toBe(29); // divisible by 400
    expect(daysInMonth(1900, 1)).toBe(28);
  });

  it('rejects out-of-range months and non-integers', () => {
    expect(() => daysInMonth(2026, -1)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 12)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 1.5)).toThrow(RangeError);
    expect(() => daysInMonth(NaN, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026.5, 0)).toThrow(RangeError);
  });
});

describe('startOfMonth / endOfMonth / monthKey', () => {
  it('finds the first and last day of a month', () => {
    expect(startOfMonth('2026-07-17')).toBe('2026-07-01');
    expect(startOfMonth('2026-07-01')).toBe('2026-07-01');
    expect(endOfMonth('2026-07-17')).toBe('2026-07-31');
    expect(endOfMonth('2026-07-31')).toBe('2026-07-31');
    expect(endOfMonth('2026-04-05')).toBe('2026-04-30');
  });

  it('gets February right in leap and common years', () => {
    expect(endOfMonth('2028-02-01')).toBe('2028-02-29');
    expect(endOfMonth('2028-02-29')).toBe('2028-02-29');
    expect(endOfMonth('2027-02-15')).toBe('2027-02-28');
    expect(endOfMonth('2100-02-15')).toBe('2100-02-28');
    expect(endOfMonth('2000-02-15')).toBe('2000-02-29');
  });

  it('handles the first and last months of a year', () => {
    expect(startOfMonth('2026-01-15')).toBe('2026-01-01');
    expect(endOfMonth('2026-12-15')).toBe('2026-12-31');
    expect(addDays(endOfMonth('2026-12-15'), 1)).toBe('2027-01-01');
    expect(addDays(startOfMonth('2026-01-15'), -1)).toBe('2025-12-31');
  });

  it('spans exactly the month between its own bounds', () => {
    for (let monthIndex0 = 0; monthIndex0 < 12; monthIndex0 += 1) {
      const someDay = `2028-${String(monthIndex0 + 1).padStart(2, '0')}-15`;
      expect(daysBetween(startOfMonth(someDay), endOfMonth(someDay))).toHaveLength(
        daysInMonth(2028, monthIndex0)
      );
    }
  });

  it('produces a stable YYYY-MM grouping key', () => {
    expect(monthKey('2026-07-02')).toBe('2026-07');
    expect(monthKey('2026-01-31')).toBe('2026-01');
    expect(monthKey('2026-12-31')).toBe('2026-12');
    expect(monthKey(startOfMonth('2026-07-02'))).toBe(monthKey(endOfMonth('2026-07-02')));
    expect(monthKey('2026-12-31')).not.toBe(monthKey('2027-01-01'));
  });

  it('validates its input', () => {
    expect(() => startOfMonth('2026-02-30')).toThrow(RangeError);
    expect(() => endOfMonth('nope')).toThrow(RangeError);
    expect(() => monthKey('2026-1-1')).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// monthGrid
// ---------------------------------------------------------------------------

const flatten = (grid: MonthGrid) => grid.flat();
const filled = (grid: MonthGrid) => flatten(grid).filter((cell): cell is string => cell !== null);

describe('monthGrid', () => {
  it('is always 6 rows of 7 cells, for every month and both week starts', () => {
    expect([MONTH_GRID_ROWS, MONTH_GRID_COLUMNS]).toEqual([6, 7]);
    for (const year of [2026, 2027, 2028]) {
      for (let monthIndex0 = 0; monthIndex0 < 12; monthIndex0 += 1) {
        for (const weekStartsOn of [0, 1] as WeekStart[]) {
          const grid = monthGrid(year, monthIndex0, weekStartsOn);
          expect(grid).toHaveLength(MONTH_GRID_ROWS);
          for (const row of grid) {
            expect(row).toHaveLength(MONTH_GRID_COLUMNS);
          }
        }
      }
    }
  });

  it('contains exactly the days of the requested month, in order, and nothing else', () => {
    for (const year of [2026, 2027, 2028]) {
      for (let monthIndex0 = 0; monthIndex0 < 12; monthIndex0 += 1) {
        for (const weekStartsOn of [0, 1] as WeekStart[]) {
          const grid = monthGrid(year, monthIndex0, weekStartsOn);
          const first = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-01`;
          expect(filled(grid)).toEqual(daysBetween(first, endOfMonth(first)));
          // Convention: padding cells are null, never adjacent-month days.
          for (const cell of filled(grid)) {
            expect(monthKey(cell)).toBe(monthKey(first));
          }
        }
      }
    }
  });

  it('places every day under the correct weekday column', () => {
    for (let monthIndex0 = 0; monthIndex0 < 12; monthIndex0 += 1) {
      for (const weekStartsOn of [0, 1] as WeekStart[]) {
        monthGrid(2026, monthIndex0, weekStartsOn).forEach((row) => {
          row.forEach((cell, column) => {
            if (cell !== null) {
              expect((weekdayIndex(cell) - weekStartsOn + 7) % 7).toBe(column);
            }
          });
        });
      }
    }
  });

  it('leaves no gaps: nulls only lead and trail the filled run', () => {
    for (let monthIndex0 = 0; monthIndex0 < 12; monthIndex0 += 1) {
      for (const weekStartsOn of [0, 1] as WeekStart[]) {
        const cells = flatten(monthGrid(2026, monthIndex0, weekStartsOn));
        const firstFilled = cells.findIndex((cell) => cell !== null);
        const lastFilled =
          cells.length - 1 - [...cells].reverse().findIndex((cell) => cell !== null);
        for (let index = firstFilled; index <= lastFilled; index += 1) {
          expect(cells[index]).not.toBeNull();
        }
      }
    }
  });

  describe('a month starting on a Sunday (February 2026)', () => {
    it('starts flush in the first cell of a Sunday-first grid and fills exactly 4 rows', () => {
      expect(weekdayIndex('2026-02-01')).toBe(0);
      const grid = monthGrid(2026, 1, 0);
      expect(grid[0][0]).toBe('2026-02-01');
      expect(grid[0][6]).toBe('2026-02-07');
      expect(grid[1][0]).toBe('2026-02-08');
      expect(grid[3][6]).toBe('2026-02-28');
      // Trailing rows are entirely null — the calendar keeps its height.
      expect(grid[4].every((cell) => cell === null)).toBe(true);
      expect(grid[5].every((cell) => cell === null)).toBe(true);
      expect(filled(grid)).toHaveLength(28);
    });

    it('shifts to the last column of the first row in a Monday-first grid', () => {
      const grid = monthGrid(2026, 1, 1);
      expect(grid[0].slice(0, 6).every((cell) => cell === null)).toBe(true);
      expect(grid[0][6]).toBe('2026-02-01');
      expect(grid[1][0]).toBe('2026-02-02');
      expect(grid[4][5]).toBe('2026-02-28');
      expect(grid[4][6]).toBeNull();
      expect(grid[5].every((cell) => cell === null)).toBe(true);
    });
  });

  describe('a month starting on a Saturday (August 2026)', () => {
    it('needs all six rows in a Sunday-first grid', () => {
      expect(weekdayIndex('2026-08-01')).toBe(6);
      const grid = monthGrid(2026, 7, 0);
      expect(grid[0].slice(0, 6).every((cell) => cell === null)).toBe(true);
      expect(grid[0][6]).toBe('2026-08-01');
      expect(grid[1][0]).toBe('2026-08-02');
      expect(grid[5][0]).toBe('2026-08-30');
      expect(grid[5][1]).toBe('2026-08-31');
      expect(grid[5].slice(2).every((cell) => cell === null)).toBe(true);
      expect(filled(grid)).toHaveLength(31);
    });

    it('shifts one column left in a Monday-first grid', () => {
      const grid = monthGrid(2026, 7, 1);
      expect(grid[0].slice(0, 5).every((cell) => cell === null)).toBe(true);
      expect(grid[0][5]).toBe('2026-08-01');
      expect(grid[0][6]).toBe('2026-08-02');
      expect(grid[5][0]).toBe('2026-08-31');
      expect(grid[5].slice(1).every((cell) => cell === null)).toBe(true);
    });
  });

  it('includes February 29th in a leap year and excludes it otherwise', () => {
    expect(filled(monthGrid(2028, 1, 1))).toContain('2028-02-29');
    expect(filled(monthGrid(2028, 1, 1))).toHaveLength(29);
    expect(filled(monthGrid(2027, 1, 1))).toHaveLength(28);
    expect(filled(monthGrid(2027, 1, 1))).not.toContain('2027-02-29');
  });

  it('handles January and December (year boundaries)', () => {
    const januaryDays = filled(monthGrid(2027, 0, 1));
    expect(januaryDays[0]).toBe('2027-01-01');
    expect(januaryDays).toHaveLength(31);
    const decemberDays = filled(monthGrid(2026, 11, 1));
    expect(decemberDays[decemberDays.length - 1]).toBe('2026-12-31');
  });

  it('rejects invalid arguments', () => {
    expect(() => monthGrid(2026, 12, 0)).toThrow(RangeError);
    expect(() => monthGrid(2026, -1, 0)).toThrow(RangeError);
    expect(() => monthGrid(2026.5, 0, 0)).toThrow(RangeError);
    expect(() => monthGrid(2026, 0, 2 as unknown as WeekStart)).toThrow(RangeError);
    expect(() => monthGrid(2026, 0, undefined as unknown as WeekStart)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// isValidDay
// ---------------------------------------------------------------------------

describe('isValidDay', () => {
  it('accepts real YYYY-MM-DD dates', () => {
    for (const day of ['2026-01-01', '2026-12-31', '2028-02-29', '2000-02-29', '0999-01-02']) {
      expect(isValidDay(day)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const value of [
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-00-01',
      '2026-01-32',
      '2026-1-1',
      '2026/01/01',
      '',
      null,
      undefined,
      20260101,
      new Date(),
    ]) {
      expect(isValidDay(value)).toBe(false);
    }
  });

  it('narrows the type for every other function in the module', () => {
    const candidate: unknown = '2026-07-02';
    if (isValidDay(candidate)) {
      expect(addDays(candidate, 1)).toBe('2026-07-03');
    } else {
      throw new Error('expected the candidate to be a valid day');
    }
  });
});
