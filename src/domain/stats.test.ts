/// <reference types="node" />
/**
 * Tests for History statistics (PRODUCT_SPEC §8).
 *
 * ## Timezone strategy
 *
 * There is nothing to arrange: `stats.ts` never constructs, parses or formats a `Date`. Its
 * only time input is `todayDay`, a `YYYY-MM-DD` string supplied by the caller, and all day
 * maths is delegated to `dates.ts` (which does its own integer, DST-proof arithmetic). Every
 * assertion below is therefore bit-identical on this machine (Europe/Istanbul) and in CI
 * (UTC). `describe('timezone independence')` proves that rather than trusting it: it reads
 * the module source, and it runs a whole computation with the `Date` constructor sabotaged.
 *
 * ## What the interesting tests are actually pinning down
 *
 * The two guarantees that are easy to regress and expensive to get wrong:
 * exempt never touches a denominator, and unlogged is never quietly folded into missed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { computeStats, mostLatePrayer, mostMissedPrayer, type StatsOptions } from './stats';
import {
  PRAYERS,
  type DayRecord,
  type Prayer,
  type PrayerDay,
  type PrayerStatus,
  type StatsSummary,
} from './types';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

interface DayOptions {
  isExempt?: boolean;
  madeUp?: Partial<Record<Prayer, boolean>>;
}

/** A day record with every unspecified prayer left `unlogged`. */
function day(
  d: PrayerDay,
  statuses: Partial<Record<Prayer, PrayerStatus>> = {},
  opts: DayOptions = {}
): DayRecord {
  return {
    day: d,
    statuses: {
      fajr: 'unlogged',
      dhuhr: 'unlogged',
      asr: 'unlogged',
      maghrib: 'unlogged',
      isha: 'unlogged',
      ...statuses,
    },
    madeUp: opts.madeUp ?? {},
    isExempt: opts.isExempt ?? false,
  };
}

/** A day record where all five prayers share one status. */
function uniformDay(d: PrayerDay, status: PrayerStatus, opts: DayOptions = {}): DayRecord {
  return day(d, { fajr: status, dhuhr: status, asr: status, maghrib: status, isha: status }, opts);
}

/** An exempt day, exactly as the query layer materialises one (flag + five exempt slots). */
function exemptDay(d: PrayerDay): DayRecord {
  return uniformDay(d, 'exempt', { isExempt: true });
}

/** Consecutive days ending at `endDay` (inclusive), ascending. Pure string maths. */
function daysEndingAt(endDay: PrayerDay, count: number): PrayerDay[] {
  const [y, m, d] = endDay.split('-').map(Number) as [number, number, number];
  const out: PrayerDay[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const at = new Date(Date.UTC(y, m - 1, d - i));
    out.push(at.toISOString().slice(0, 10));
  }
  return out;
}

function breakdown(summary: StatsSummary, prayer: Prayer) {
  const row = summary.byPrayer.find((r) => r.prayer === prayer);
  if (row === undefined) throw new Error(`no breakdown row for ${prayer}`);
  return row;
}

const TODAY: PrayerDay = '2026-08-19';
const week = (todayDay: PrayerDay = TODAY): StatsOptions => ({ windowDays: 7, todayDay });
const lifetime = (todayDay: PrayerDay = TODAY): StatsOptions => ({
  windowDays: null,
  todayDay,
});

// ---------------------------------------------------------------------------

describe('computeStats — empty history', () => {
  it.each([
    ['7-day window', week()],
    ['30-day window', { windowDays: 30, todayDay: TODAY }],
    ['lifetime', lifetime()],
  ])('reports nothing rather than zero percent (%s)', (_label, opts) => {
    const summary = computeStats([], opts);

    expect(summary.totalTracked).toBe(0);
    expect(summary.prayed).toBe(0);
    expect(summary.late).toBe(0);
    expect(summary.missed).toBe(0);
    expect(summary.unlogged).toBe(0);
    expect(summary.fullDays).toBe(0);
    expect(summary.completionRate).toBeNull();
    expect(summary.onTimeRate).toBeNull();
    expect(summary.windowDays).toBe(opts.windowDays);
  });

  it('still returns all five breakdown rows in canonical order', () => {
    const summary = computeStats([], week());

    expect(summary.byPrayer.map((r) => r.prayer)).toEqual([...PRAYERS]);
    for (const row of summary.byPrayer) {
      expect(row).toEqual({
        prayer: row.prayer,
        prayed: 0,
        late: 0,
        missed: 0,
        unlogged: 0,
        exempt: 0,
      });
    }
  });

  it('never yields NaN for a rate when a denominator is zero', () => {
    const summary = computeStats([], lifetime());

    for (const rate of [summary.completionRate, summary.onTimeRate]) {
      expect(rate).toBeNull();
      expect(Number.isNaN(rate as unknown as number)).toBe(false);
    }
  });

  it('reports nothing when every supplied day sits outside the window', () => {
    const summary = computeStats(
      [uniformDay('2026-01-01', 'prayed'), uniformDay('2026-02-01', 'prayed')],
      week()
    );

    expect(summary.totalTracked).toBe(0);
    expect(summary.completionRate).toBeNull();
  });
});

describe('computeStats — a perfect window', () => {
  const records = daysEndingAt(TODAY, 7).map((d) => uniformDay(d, 'prayed'));
  const summary = computeStats(records, week());

  it('counts every slot as tracked and prayed', () => {
    expect(summary.totalTracked).toBe(35);
    expect(summary.prayed).toBe(35);
    expect(summary.late).toBe(0);
    expect(summary.missed).toBe(0);
    expect(summary.unlogged).toBe(0);
  });

  it('reports 100% completion and 100% on time', () => {
    expect(summary.completionRate).toBe(1);
    expect(summary.onTimeRate).toBe(1);
  });

  it('counts all seven days as full days', () => {
    expect(summary.fullDays).toBe(7);
  });

  it('has no most-missed and no most-late prayer', () => {
    expect(mostMissedPrayer(summary)).toBeNull();
    expect(mostLatePrayer(summary)).toBeNull();
  });

  it('counts a window of late-but-prayed days as complete, not on time', () => {
    const lateWeek = daysEndingAt(TODAY, 7).map((d) => uniformDay(d, 'late'));
    const lateSummary = computeStats(lateWeek, week());

    expect(lateSummary.completionRate).toBe(1);
    expect(lateSummary.onTimeRate).toBe(0);
    expect(lateSummary.fullDays).toBe(7);
  });
});

describe('computeStats — a mixed window with all five statuses', () => {
  // 2026-08-19 is `TODAY`; the window is 2026-08-13 … 2026-08-19.
  const records: DayRecord[] = [
    // all five prayed → a full day
    uniformDay('2026-08-13', 'prayed'),
    // prayed + late only → still a full day
    day('2026-08-14', {
      fajr: 'late',
      dhuhr: 'prayed',
      asr: 'prayed',
      maghrib: 'prayed',
      isha: 'late',
    }),
    // one missed → not a full day
    day('2026-08-15', {
      fajr: 'missed',
      dhuhr: 'prayed',
      asr: 'prayed',
      maghrib: 'prayed',
      isha: 'prayed',
    }),
    // one unlogged → not a full day, and not a miss
    day('2026-08-16', {
      fajr: 'prayed',
      dhuhr: 'prayed',
      asr: 'prayed',
      maghrib: 'prayed',
      isha: 'unlogged',
    }),
    // exempt day → invisible everywhere but `exempt`
    exemptDay('2026-08-17'),
    // a bit of everything
    day('2026-08-18', {
      fajr: 'missed',
      dhuhr: 'late',
      asr: 'prayed',
      maghrib: 'missed',
      isha: 'unlogged',
    }),
    // today, still in progress
    day('2026-08-19', { fajr: 'prayed', dhuhr: 'prayed', asr: 'late' }),
  ];
  const summary = computeStats(records, week());

  it('counts each status exactly once per slot', () => {
    expect(summary.prayed).toBe(19);
    expect(summary.late).toBe(4);
    expect(summary.missed).toBe(3);
    expect(summary.unlogged).toBe(4);
    expect(summary.totalTracked).toBe(31); // 19 + 4 + 3 + 5 exempt

    // Every one of the 35 slots landed in exactly one bucket.
    const exemptSlots = summary.byPrayer.reduce((n, row) => n + row.exempt, 0);
    expect(summary.prayed + summary.late + summary.missed + summary.unlogged + exemptSlots).toBe(
      35
    );
  });

  it('keeps the documented invariant totalTracked = prayed + late + missed + exempt', () => {
    const exemptSlots = summary.byPrayer.reduce((n, row) => n + row.exempt, 0);

    expect(exemptSlots).toBe(5);
    expect(summary.totalTracked).toBe(summary.prayed + summary.late + summary.missed + exemptSlots);
  });

  it('divides completion by obligated slots only — no exempt, no unlogged', () => {
    // (19 prayed + 4 late) / (19 + 4 + 3 missed) = 23/26
    expect(summary.completionRate).toBeCloseTo(23 / 26, 12);
    expect(summary.completionRate).not.toBeCloseTo(23 / 31, 6); // exempt in the denominator
    expect(summary.completionRate).not.toBeCloseTo(23 / 30, 6); // unlogged in the denominator
    expect(summary.completionRate).not.toBeCloseTo(23 / 35, 6); // both in the denominator
  });

  it('splits on-time against late only', () => {
    expect(summary.onTimeRate).toBeCloseTo(19 / 23, 12);
  });

  it('counts only days whose five slots are all prayed or late', () => {
    expect(summary.fullDays).toBe(2); // 08-13 and 08-14
  });

  it('gives every prayer a breakdown whose parts sum to the days counted', () => {
    for (const row of summary.byPrayer) {
      expect(row.prayed + row.late + row.missed + row.unlogged + row.exempt).toBe(7);
    }
  });

  it('breaks the counts down per prayer', () => {
    expect(breakdown(summary, 'fajr')).toEqual({
      prayer: 'fajr',
      prayed: 3,
      late: 1,
      missed: 2,
      unlogged: 0,
      exempt: 1,
    });
    expect(breakdown(summary, 'isha')).toEqual({
      prayer: 'isha',
      prayed: 2,
      late: 1,
      missed: 0,
      unlogged: 3,
      exempt: 1,
    });
    expect(breakdown(summary, 'maghrib')).toEqual({
      prayer: 'maghrib',
      prayed: 4,
      late: 0,
      missed: 1,
      unlogged: 1,
      exempt: 1,
    });
  });

  it('is independent of the order records arrive in', () => {
    const shuffled = [...records].reverse();

    expect(computeStats(shuffled, week())).toEqual(summary);
  });

  it('does not mutate the records it is given', () => {
    const snapshot = JSON.parse(JSON.stringify(records)) as DayRecord[];
    computeStats(records, week());

    expect(records).toEqual(snapshot);
  });
});

describe('computeStats — exempt days', () => {
  const opts = week();

  it('excludes exempt slots from the completion denominator', () => {
    const withoutExempt = computeStats([uniformDay('2026-08-18', 'prayed')], opts);
    const withExempt = computeStats(
      [uniformDay('2026-08-18', 'prayed'), exemptDay('2026-08-17')],
      opts
    );

    expect(withoutExempt.completionRate).toBe(1);
    expect(withExempt.completionRate).toBe(1); // 5/5, not 5/10
    expect(withExempt.totalTracked).toBe(10);
    expect(withExempt.byPrayer.reduce((n, row) => n + row.exempt, 0)).toBe(5);
  });

  it('never renders an exempt slot as missed or unlogged', () => {
    const summary = computeStats([exemptDay('2026-08-18')], opts);

    expect(summary.missed).toBe(0);
    expect(summary.unlogged).toBe(0);
    expect(summary.prayed).toBe(0);
    expect(summary.late).toBe(0);
    expect(mostMissedPrayer(summary)).toBeNull();
  });

  it('leaves every rate null when the whole window is exempt', () => {
    const records = daysEndingAt(TODAY, 7).map(exemptDay);
    const summary = computeStats(records, opts);

    expect(summary.totalTracked).toBe(35);
    expect(summary.completionRate).toBeNull();
    expect(summary.onTimeRate).toBeNull();
  });

  it('does not count an exempt day as a full day', () => {
    const summary = computeStats([exemptDay('2026-08-18')], opts);

    expect(summary.fullDays).toBe(0);
  });

  it('lets the isExempt flag win over stale stored statuses', () => {
    // A `missed` row left behind by logging before the exemption period was entered.
    const stale = uniformDay('2026-08-18', 'missed', { isExempt: true });
    const summary = computeStats([stale], opts);

    expect(summary.missed).toBe(0);
    expect(breakdown(summary, 'fajr').exempt).toBe(1);
    expect(summary.completionRate).toBeNull();
  });

  it('does not credit a fully-prayed exempt day as a full day', () => {
    const devout = uniformDay('2026-08-18', 'prayed', { isExempt: true });
    const summary = computeStats([devout], opts);

    expect(summary.fullDays).toBe(0);
    expect(summary.prayed).toBe(0);
    expect(summary.byPrayer.reduce((n, row) => n + row.exempt, 0)).toBe(5);
  });

  it('excludes a per-prayer exempt slot without failing the whole day silently', () => {
    // isExempt is false but one slot is exempt: the day is still not "all five prayed".
    const partial = day('2026-08-18', {
      fajr: 'exempt',
      dhuhr: 'prayed',
      asr: 'prayed',
      maghrib: 'prayed',
      isha: 'prayed',
    });
    const summary = computeStats([partial], opts);

    expect(summary.completionRate).toBe(1); // 4/4
    expect(summary.totalTracked).toBe(5);
    expect(summary.fullDays).toBe(0);
  });
});

describe('computeStats — unlogged is never missed', () => {
  const opts = week();

  it('keeps unlogged out of missed and out of every denominator', () => {
    const records = [
      day('2026-08-18', { fajr: 'prayed', dhuhr: 'prayed', asr: 'prayed' }),
      day('2026-08-17', { fajr: 'prayed', dhuhr: 'prayed' }),
    ];
    const summary = computeStats(records, opts);

    expect(summary.unlogged).toBe(5);
    expect(summary.missed).toBe(0);
    expect(summary.prayed).toBe(5);
    expect(summary.totalTracked).toBe(5); // unlogged is NOT tracked
    expect(summary.completionRate).toBe(1); // 5/5, never 5/10
    expect(mostMissedPrayer(summary)).toBeNull();
  });

  it('reports a fully unlogged window as unknown, not as a disaster', () => {
    const records = daysEndingAt(TODAY, 7).map((d) => day(d));
    const summary = computeStats(records, opts);

    expect(summary.unlogged).toBe(35);
    expect(summary.missed).toBe(0);
    expect(summary.totalTracked).toBe(0);
    expect(summary.completionRate).toBeNull();
    expect(summary.onTimeRate).toBeNull();
    expect(summary.fullDays).toBe(0);
  });

  it('separates unlogged from missed in the per-prayer breakdown', () => {
    const summary = computeStats([day('2026-08-18', { fajr: 'missed', isha: 'unlogged' })], opts);

    expect(breakdown(summary, 'fajr')).toMatchObject({ missed: 1, unlogged: 0 });
    expect(breakdown(summary, 'isha')).toMatchObject({ missed: 0, unlogged: 1 });
  });

  it('treats a missing status key as unlogged (absence of a row = unlogged)', () => {
    const sparse = {
      day: '2026-08-18',
      statuses: { fajr: 'prayed' },
      madeUp: {},
      isExempt: false,
    } as unknown as DayRecord;
    const summary = computeStats([sparse], opts);

    expect(summary.prayed).toBe(1);
    expect(summary.unlogged).toBe(4);
    expect(summary.missed).toBe(0);
  });

  it('does not let unlogged block a made-up missed prayer from counting as missed', () => {
    const madeUp = day('2026-08-18', { fajr: 'missed' }, { madeUp: { fajr: true } });
    const summary = computeStats([madeUp], opts);

    // Made-up is a qada concern; History still counts the prayer as missed.
    expect(summary.missed).toBe(1);
  });
});

describe('computeStats — window boundaries', () => {
  it('includes both ends: [todayDay − (N − 1), todayDay]', () => {
    const summary = computeStats(
      [
        uniformDay('2026-08-12', 'prayed'), // one day before the window
        uniformDay('2026-08-13', 'prayed'), // first day of the window
        uniformDay('2026-08-19', 'prayed'), // todayDay, last day of the window
      ],
      week()
    );

    expect(summary.totalTracked).toBe(10);
    expect(summary.fullDays).toBe(2);
  });

  it('treats windowDays: 1 as today alone', () => {
    const summary = computeStats(
      [uniformDay('2026-08-18', 'prayed'), uniformDay('2026-08-19', 'late')],
      { windowDays: 1, todayDay: TODAY }
    );

    expect(summary.totalTracked).toBe(5);
    expect(summary.late).toBe(5);
    expect(summary.prayed).toBe(0);
  });

  it('counts exactly N days when N consecutive days are supplied', () => {
    for (const n of [1, 2, 7, 30, 365]) {
      const records = daysEndingAt(TODAY, 400).map((d) => uniformDay(d, 'prayed'));
      const summary = computeStats(records, { windowDays: n, todayDay: TODAY });

      expect(summary.totalTracked).toBe(n * 5);
      expect(summary.fullDays).toBe(n);
    }
  });

  it('drops days after todayDay, in both windowed and lifetime mode', () => {
    const records = [uniformDay('2026-08-19', 'prayed'), uniformDay('2026-08-20', 'missed')];

    expect(computeStats(records, week()).missed).toBe(0);
    expect(computeStats(records, lifetime()).missed).toBe(0);
    expect(computeStats(records, lifetime()).totalTracked).toBe(5);
  });

  it('crosses month and year boundaries by calendar, not by arithmetic on milliseconds', () => {
    const summary = computeStats(
      [
        uniformDay('2025-12-28', 'prayed'), // outside a 7-day window ending 2026-01-04
        uniformDay('2025-12-29', 'prayed'), // first day of it
        uniformDay('2026-01-01', 'prayed'),
        uniformDay('2026-01-04', 'prayed'),
      ],
      { windowDays: 7, todayDay: '2026-01-04' }
    );

    expect(summary.totalTracked).toBe(15);
  });

  it('handles a leap-day window', () => {
    const summary = computeStats(
      [
        uniformDay('2028-02-28', 'prayed'),
        uniformDay('2028-02-29', 'prayed'),
        uniformDay('2028-03-01', 'prayed'),
      ],
      { windowDays: 2, todayDay: '2028-03-01' }
    );

    expect(summary.totalTracked).toBe(10); // 02-29 and 03-01 only
  });

  it('echoes the requested windowDays back on the summary', () => {
    expect(computeStats([], { windowDays: 30, todayDay: TODAY }).windowDays).toBe(30);
    expect(computeStats([], lifetime()).windowDays).toBeNull();
  });
});

describe('computeStats — lifetime mode', () => {
  it('counts everything up to and including today, however old', () => {
    const records = [
      uniformDay('2019-03-04', 'prayed'),
      uniformDay('2023-11-30', 'late'),
      uniformDay('2026-08-19', 'missed'),
    ];
    const summary = computeStats(records, lifetime());

    expect(summary.totalTracked).toBe(15);
    expect(summary.prayed).toBe(5);
    expect(summary.late).toBe(5);
    expect(summary.missed).toBe(5);
    expect(summary.completionRate).toBeCloseTo(10 / 15, 12);
    expect(summary.fullDays).toBe(2);
  });

  it('is the same as a window long enough to contain all of history', () => {
    const records = daysEndingAt(TODAY, 40).map((d) => uniformDay(d, 'prayed'));
    const asLifetime = computeStats(records, lifetime());
    const asWindow = computeStats(records, { windowDays: 40, todayDay: TODAY });

    expect({ ...asLifetime, windowDays: 40 }).toEqual(asWindow);
  });

  it('sees strictly more than a 7-day window over the same history', () => {
    const records = daysEndingAt(TODAY, 30).map((d) => uniformDay(d, 'prayed'));

    expect(computeStats(records, lifetime()).totalTracked).toBe(150);
    expect(computeStats(records, week()).totalTracked).toBe(35);
  });
});

describe('mostMissedPrayer / mostLatePrayer', () => {
  const opts = week();

  it('returns null when nothing was missed or late', () => {
    const summary = computeStats([uniformDay('2026-08-18', 'prayed')], opts);

    expect(mostMissedPrayer(summary)).toBeNull();
    expect(mostLatePrayer(summary)).toBeNull();
  });

  it('returns null for an empty summary', () => {
    const summary = computeStats([], opts);

    expect(mostMissedPrayer(summary)).toBeNull();
    expect(mostLatePrayer(summary)).toBeNull();
  });

  it('finds the clear winner', () => {
    const summary = computeStats(
      [
        day('2026-08-18', { fajr: 'missed', isha: 'missed', asr: 'late' }),
        day('2026-08-17', { fajr: 'missed', asr: 'late' }),
        day('2026-08-16', { fajr: 'missed', asr: 'late', maghrib: 'late' }),
      ],
      opts
    );

    expect(mostMissedPrayer(summary)).toBe('fajr');
    expect(mostLatePrayer(summary)).toBe('asr');
  });

  it('breaks ties toward the earliest prayer of the day', () => {
    const summary = computeStats(
      [day('2026-08-18', { dhuhr: 'missed', asr: 'missed', isha: 'missed' })],
      opts
    );

    expect(mostMissedPrayer(summary)).toBe('dhuhr');
  });

  it('is deterministic regardless of the breakdown row order', () => {
    const summary = computeStats([day('2026-08-18', { asr: 'missed', maghrib: 'missed' })], opts);
    const reversed: StatsSummary = { ...summary, byPrayer: [...summary.byPrayer].reverse() };

    expect(mostMissedPrayer(summary)).toBe('asr');
    expect(mostMissedPrayer(reversed)).toBe('asr');
  });

  it('never answers with a prayer that was only unlogged', () => {
    const summary = computeStats([day('2026-08-18', { fajr: 'prayed' })], opts);

    expect(summary.unlogged).toBe(4);
    expect(mostMissedPrayer(summary)).toBeNull();
  });

  it('never answers with a prayer that was only exempt', () => {
    const summary = computeStats([exemptDay('2026-08-18')], opts);

    expect(mostMissedPrayer(summary)).toBeNull();
    expect(mostLatePrayer(summary)).toBeNull();
  });

  it('reads the two fields independently', () => {
    const summary = computeStats([day('2026-08-18', { fajr: 'late', isha: 'missed' })], opts);

    expect(mostLatePrayer(summary)).toBe('fajr');
    expect(mostMissedPrayer(summary)).toBe('isha');
  });
});

describe('computeStats — invalid input fails loudly', () => {
  it('rejects a malformed todayDay', () => {
    for (const bad of ['2026-8-19', '19-08-2026', '2026-02-30', '', 'today', null, undefined]) {
      expect(() =>
        computeStats([], { windowDays: 7, todayDay: bad as unknown as PrayerDay })
      ).toThrow(RangeError);
    }
  });

  it('rejects a windowDays that is not a whole number of days >= 1', () => {
    for (const bad of [0, -1, -7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeStats([], { windowDays: bad, todayDay: TODAY })).toThrow(RangeError);
    }
  });

  it('accepts windowDays: 1 and null as the only edge values', () => {
    expect(() => computeStats([], { windowDays: 1, todayDay: TODAY })).not.toThrow();
    expect(() => computeStats([], lifetime())).not.toThrow();
  });

  it('rejects a malformed record day', () => {
    expect(() => computeStats([uniformDay('2026-13-01', 'prayed')], week())).toThrow(RangeError);
  });

  it('rejects two records claiming the same day', () => {
    expect(() =>
      computeStats([uniformDay('2026-08-18', 'prayed'), uniformDay('2026-08-18', 'missed')], week())
    ).toThrow(/duplicate/i);
  });

  it('rejects a null record', () => {
    expect(() => computeStats([null as unknown as DayRecord], week())).toThrow(RangeError);
  });

  it('rejects an unrecognised status string', () => {
    const bogus = day('2026-08-18', { fajr: 'skipped' as unknown as PrayerStatus });

    expect(() => computeStats([bogus], week())).toThrow(/unknown prayer status/i);
  });

});

describe('timezone independence', () => {
  const source = fs.readFileSync(path.join(__dirname, 'stats.ts'), 'utf8');

  it('never touches the clock or a Date', () => {
    expect(source).not.toMatch(/\bnew Date\b/);
    expect(source).not.toMatch(/Date\.now\b/);
    expect(source).not.toMatch(/toISOString|getTimezoneOffset|Intl\./);
  });

  it('imports no React, React Native or Expo', () => {
    expect(source).not.toMatch(/from '(react|react-native|expo)/);
  });

  it('computes a full window with the Date constructor sabotaged', () => {
    // Proves the claim end to end, including through `dates.ts`: if any code path on the way
    // to a statistic read the clock or built a Date, this would throw.
    const records = daysEndingAt(TODAY, 10).map((d) => uniformDay(d, 'prayed'));
    const RealDate = globalThis.Date;
    let summary: StatsSummary | null = null;
    let failure: unknown = null;

    try {
      (globalThis as unknown as { Date: unknown }).Date = function BrokenDate(): never {
        throw new Error('stats must not touch Date');
      };
      summary = computeStats(records, week());
    } catch (error) {
      failure = error;
    } finally {
      (globalThis as unknown as { Date: unknown }).Date = RealDate;
    }

    expect(failure).toBeNull();
    expect(summary?.totalTracked).toBe(35);
    expect(summary?.fullDays).toBe(7);
  });
});
