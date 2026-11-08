/// <reference types="node" />
/**
 * Tests for exempt-day logic (PRODUCT_SPEC §6).
 *
 * ## Timezone strategy
 *
 * `exemptions.ts` never constructs, reads or formats a `Date`: it works on `YYYY-MM-DD`
 * labels and epoch-millisecond numbers only, delegating all calendar arithmetic to
 * `dates.ts` (which is itself proven DST-safe in `dates.test.ts`). Every assertion below is
 * therefore identical in Europe/Istanbul, UTC and anywhere else, and no test hardcodes a
 * UTC instant. `describe('timezone and DST immunity by construction')` locks that property
 * down by scanning the source, so it cannot rot.
 *
 * ## Emotional contract under test
 *
 * An exempt day is never missed, never nudged, never in a stats denominator, and it bridges
 * streaks. In practice that means: inclusive on both ends, open-ended periods really are
 * open-ended, and no transformation here may silently un-exempt a day the user recorded.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { daysBetween, diffDays } from './dates';
import {
  AVERAGE_DAYS_PER_MONTH,
  MIN_AVERAGE_WINDOW_DAYS,
  averageExemptDaysPerMonth,
  countExemptDaysInRange,
  endPeriod,
  expandExemptDays,
  findOngoingPeriod,
  findOpenPeriod,
  isDayExempt,
  normalizePeriods,
  startPeriod,
  trimOngoingPeriod,
} from './exemptions';
import type { ExemptPeriod, PrayerDay } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed epoch ms. Nothing in the module interprets it as a wall-clock time. */
const T0 = 1_775_000_000_000;
const DAY_MS = 86_400_000;

/** Builds a period; the object is frozen so any accidental mutation throws in strict mode. */
function period(
  startDay: PrayerDay,
  endDay: PrayerDay | null,
  overrides: Partial<ExemptPeriod> = {}
): ExemptPeriod {
  return Object.freeze({ startDay, endDay, createdAt: T0, ...overrides });
}

/** Freezes the list too, so a mutating implementation would fail loudly. */
function freeze(periods: ExemptPeriod[]): ExemptPeriod[] {
  periods.forEach((entry) => Object.freeze(entry));
  Object.freeze(periods);
  return periods;
}

/** Compact, readable shape of a normalized list: `["2026-03-01..2026-03-05", "2026-04-01..∞"]`. */
function ranges(periods: ExemptPeriod[]): string[] {
  return periods.map((entry) => `${entry.startDay}..${entry.endDay ?? '∞'}`);
}

// ---------------------------------------------------------------------------
// isDayExempt
// ---------------------------------------------------------------------------

describe('isDayExempt', () => {
  it('returns false for empty input — nothing is exempt by default', () => {
    expect(isDayExempt('2026-03-04', [])).toBe(false);
  });

  describe('single-day period', () => {
    const periods = freeze([period('2026-03-04', '2026-03-04')]);

    it('covers the day itself', () => {
      expect(isDayExempt('2026-03-04', periods)).toBe(true);
    });

    it('does not cover the day before', () => {
      expect(isDayExempt('2026-03-03', periods)).toBe(false);
    });

    it('does not cover the day after', () => {
      expect(isDayExempt('2026-03-05', periods)).toBe(false);
    });
  });

  describe('multi-day period, both ends inclusive', () => {
    const periods = freeze([period('2026-03-04', '2026-03-08')]);

    it('covers the start day exactly', () => {
      expect(isDayExempt('2026-03-04', periods)).toBe(true);
    });

    it('covers the end day exactly', () => {
      expect(isDayExempt('2026-03-08', periods)).toBe(true);
    });

    it('covers every day in between', () => {
      for (const day of ['2026-03-05', '2026-03-06', '2026-03-07']) {
        expect(isDayExempt(day, periods)).toBe(true);
      }
    });

    it('excludes the day immediately before the start', () => {
      expect(isDayExempt('2026-03-03', periods)).toBe(false);
    });

    it('excludes the day immediately after the end', () => {
      expect(isDayExempt('2026-03-09', periods)).toBe(false);
    });
  });

  describe('open-ended period', () => {
    const periods = freeze([period('2026-03-04', null)]);

    it('covers its start day', () => {
      expect(isDayExempt('2026-03-04', periods)).toBe(true);
    });

    it('covers the next day', () => {
      expect(isDayExempt('2026-03-05', periods)).toBe(true);
    });

    it('covers a day years later — an unfinished period never expires on its own', () => {
      expect(isDayExempt('2031-11-30', periods)).toBe(true);
    });

    it('covers the far end of the supported calendar without overflowing', () => {
      expect(isDayExempt('9999-12-31', periods)).toBe(true);
    });

    it('does not cover the day before it started', () => {
      expect(isDayExempt('2026-03-03', periods)).toBe(false);
    });
  });

  describe('several periods', () => {
    const periods = freeze([
      period('2026-01-01', '2026-01-05'),
      period('2026-01-10', '2026-01-15'),
    ]);

    it('covers a day in the first period', () => {
      expect(isDayExempt('2026-01-05', periods)).toBe(true);
    });

    it('covers a day in the second period', () => {
      expect(isDayExempt('2026-01-10', periods)).toBe(true);
    });

    it('leaves a day between two periods unexempt', () => {
      expect(isDayExempt('2026-01-07', periods)).toBe(false);
    });

    it('leaves the day right after the first and right before the second unexempt', () => {
      expect(isDayExempt('2026-01-06', periods)).toBe(false);
      expect(isDayExempt('2026-01-09', periods)).toBe(false);
    });
  });

  it('does not require sorted or merged input', () => {
    const periods = freeze([
      period('2026-05-20', '2026-05-25'),
      period('2026-02-01', null),
      period('2026-01-01', '2026-01-03'),
    ]);
    expect(isDayExempt('2026-01-02', periods)).toBe(true);
    expect(isDayExempt('2026-01-04', periods)).toBe(false);
    expect(isDayExempt('2026-05-22', periods)).toBe(true);
  });

  it('ignores an inverted (corrupt) period rather than covering everything', () => {
    const periods = freeze([period('2026-03-10', '2026-03-01')]);
    expect(isDayExempt('2026-03-05', periods)).toBe(false);
    expect(isDayExempt('2026-03-10', periods)).toBe(false);
    expect(isDayExempt('2026-03-01', periods)).toBe(false);
  });

  it('spans a month boundary', () => {
    const periods = freeze([period('2026-01-30', '2026-02-02')]);
    expect(ranges(periods)).toEqual(['2026-01-30..2026-02-02']);
    expect(isDayExempt('2026-01-31', periods)).toBe(true);
    expect(isDayExempt('2026-02-01', periods)).toBe(true);
    expect(isDayExempt('2026-02-03', periods)).toBe(false);
  });

  it('spans a year boundary', () => {
    const periods = freeze([period('2025-12-30', '2026-01-02')]);
    expect(isDayExempt('2025-12-31', periods)).toBe(true);
    expect(isDayExempt('2026-01-01', periods)).toBe(true);
    expect(isDayExempt('2026-01-03', periods)).toBe(false);
  });

  it('handles 29 February in a leap year', () => {
    const periods = freeze([period('2028-02-27', '2028-03-01')]);
    expect(isDayExempt('2028-02-29', periods)).toBe(true);
  });

  it('throws RangeError on a malformed day', () => {
    expect(() => isDayExempt('2026-2-3', [])).toThrow(RangeError);
    expect(() => isDayExempt('2026-02-30', [])).toThrow(RangeError);
    expect(() => isDayExempt('nope', [])).toThrow(RangeError);
  });

  it('throws RangeError on a malformed period rather than silently ignoring it', () => {
    expect(() => isDayExempt('2026-03-04', [period('2026-13-01', null)])).toThrow(RangeError);
    expect(() => isDayExempt('2026-03-04', [period('2026-03-01', '2026-02-30')])).toThrow(
      RangeError
    );
    expect(() =>
      isDayExempt('2026-03-04', [
        { startDay: '2026-03-01', endDay: undefined, createdAt: T0 } as unknown as ExemptPeriod,
      ])
    ).toThrow(RangeError);
    expect(() =>
      isDayExempt('2026-03-04', [{ startDay: '2026-03-01', endDay: null, createdAt: Number.NaN }])
    ).toThrow(RangeError);
  });

  it('names the offending argument in the error message', () => {
    expect(() => isDayExempt('2026-03-04', [period('bad', null)])).toThrow(
      /periods\[0\]\.startDay/
    );
  });
});

// ---------------------------------------------------------------------------
// normalizePeriods
// ---------------------------------------------------------------------------

describe('normalizePeriods', () => {
  it('returns an empty list for empty input', () => {
    expect(normalizePeriods([])).toEqual([]);
  });

  it('leaves a single period untouched in value', () => {
    const periods = freeze([period('2026-03-04', '2026-03-08')]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-04..2026-03-08']);
  });

  it('sorts unsorted periods ascending by start day', () => {
    const periods = freeze([
      period('2026-05-01', '2026-05-04'),
      period('2026-01-01', '2026-01-04'),
      period('2026-03-01', '2026-03-04'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual([
      '2026-01-01..2026-01-04',
      '2026-03-01..2026-03-04',
      '2026-05-01..2026-05-04',
    ]);
  });

  it('merges overlapping periods', () => {
    const periods = freeze([
      period('2026-03-01', '2026-03-06'),
      period('2026-03-04', '2026-03-09'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-01..2026-03-09']);
  });

  it('merges a period fully contained in another', () => {
    const periods = freeze([
      period('2026-03-01', '2026-03-20'),
      period('2026-03-05', '2026-03-06'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-01..2026-03-20']);
  });

  it('merges touching periods (same end and start day)', () => {
    const periods = freeze([
      period('2026-03-01', '2026-03-05'),
      period('2026-03-05', '2026-03-08'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-01..2026-03-08']);
  });

  it('merges adjacent periods (end + 1 day === next start)', () => {
    const periods = freeze([
      period('2026-03-01', '2026-03-05'),
      period('2026-03-06', '2026-03-08'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-01..2026-03-08']);
  });

  it('merges adjacent periods across a month boundary', () => {
    const periods = freeze([
      period('2026-01-28', '2026-01-31'),
      period('2026-02-01', '2026-02-03'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-01-28..2026-02-03']);
  });

  it('merges adjacent periods across a year boundary', () => {
    const periods = freeze([
      period('2025-12-28', '2025-12-31'),
      period('2026-01-01', '2026-01-03'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2025-12-28..2026-01-03']);
  });

  it('merges adjacent periods across 29 February', () => {
    const periods = freeze([
      period('2028-02-25', '2028-02-29'),
      period('2028-03-01', '2028-03-02'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2028-02-25..2028-03-02']);
  });

  it('does NOT merge periods separated by a single free day', () => {
    const periods = freeze([
      period('2026-03-01', '2026-03-05'),
      period('2026-03-07', '2026-03-09'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual([
      '2026-03-01..2026-03-05',
      '2026-03-07..2026-03-09',
    ]);
    expect(isDayExempt('2026-03-06', periods)).toBe(false);
  });

  it('merges a chain of overlapping and adjacent periods into one', () => {
    const periods = freeze([
      period('2026-03-01', '2026-03-03'),
      period('2026-03-04', '2026-03-06'),
      period('2026-03-05', '2026-03-10'),
      period('2026-03-11', '2026-03-11'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-01..2026-03-11']);
  });

  it('drops inverted periods', () => {
    const periods = freeze([
      period('2026-03-10', '2026-03-01'),
      period('2026-04-01', '2026-04-02'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-04-01..2026-04-02']);
  });

  it('keeps single-day periods', () => {
    const periods = freeze([period('2026-03-04', '2026-03-04')]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-04..2026-03-04']);
  });

  it('collapses two open-ended periods into one covering the union', () => {
    const periods = freeze([period('2026-03-01', null), period('2026-05-01', null)]);
    const normalized = normalizePeriods(periods);
    expect(ranges(normalized)).toEqual(['2026-03-01..∞']);
    expect(normalized).toHaveLength(1);
  });

  it('collapses open-ended periods regardless of input order', () => {
    const periods = freeze([period('2026-05-01', null), period('2026-03-01', null)]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-01..∞']);
  });

  it('lets an open-ended period absorb every later closed period', () => {
    const periods = freeze([
      period('2026-03-01', null),
      period('2026-04-01', '2026-04-05'),
      period('2027-01-01', '2027-01-05'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-03-01..∞']);
  });

  it('keeps earlier closed periods that the open one does not reach', () => {
    const periods = freeze([
      period('2026-03-01', null),
      period('2026-01-01', '2026-01-05'),
      period('2026-02-01', '2026-02-05'),
    ]);
    expect(ranges(normalizePeriods(periods))).toEqual([
      '2026-01-01..2026-01-05',
      '2026-02-01..2026-02-05',
      '2026-03-01..∞',
    ]);
  });

  it('merges a closed period that is adjacent to the open one', () => {
    const periods = freeze([period('2026-03-01', null), period('2026-02-25', '2026-02-28')]);
    expect(ranges(normalizePeriods(periods))).toEqual(['2026-02-25..∞']);
  });

  it('always puts the open-ended period last', () => {
    const normalized = normalizePeriods(
      freeze([
        period('2026-06-01', null),
        period('2026-01-01', '2026-01-02'),
        period('2026-03-01', '2026-03-02'),
      ])
    );
    expect(normalized[normalized.length - 1]?.endDay).toBeNull();
    expect(normalized.filter((entry) => entry.endDay === null)).toHaveLength(1);
  });

  it('never leaves more than one open-ended period, however many go in', () => {
    const periods = freeze([
      period('2026-01-01', null),
      period('2026-02-01', null),
      period('2026-03-01', null),
      period('2026-04-01', '2026-04-05'),
    ]);
    const normalized = normalizePeriods(periods);
    expect(normalized.filter((entry) => entry.endDay === null)).toHaveLength(1);
    expect(ranges(normalized)).toEqual(['2026-01-01..∞']);
  });

  it('keeps the id of the earliest-starting contributor and the smallest createdAt', () => {
    const periods = freeze([
      period('2026-03-04', '2026-03-08', { id: 7, createdAt: T0 + 5 * DAY_MS }),
      period('2026-03-01', '2026-03-05', { id: 3, createdAt: T0 + 9 * DAY_MS }),
      period('2026-03-09', '2026-03-12', { id: 11, createdAt: T0 }),
    ]);
    const normalized = normalizePeriods(periods);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.id).toBe(3);
    expect(normalized[0]?.createdAt).toBe(T0);
    expect(ranges(normalized)).toEqual(['2026-03-01..2026-03-12']);
  });

  it('omits the id when the surviving contributor has none', () => {
    const normalized = normalizePeriods(
      freeze([period('2026-03-01', '2026-03-05'), period('2026-03-06', '2026-03-08', { id: 9 })])
    );
    expect(normalized[0]).not.toHaveProperty('id');
  });

  it('is idempotent', () => {
    const periods = freeze([
      period('2026-03-04', '2026-03-08'),
      period('2026-03-06', null),
      period('2026-01-01', '2026-01-02'),
      period('2026-02-10', '2026-02-01'),
    ]);
    const once = normalizePeriods(periods);
    const twice = normalizePeriods(once);
    expect(twice).toEqual(once);
  });

  it('never mutates the input array or its periods', () => {
    const periods = freeze([
      period('2026-03-04', '2026-03-08'),
      period('2026-03-06', '2026-03-12'),
    ]);
    const snapshot = ranges(periods);
    normalizePeriods(periods);
    expect(ranges(periods)).toEqual(snapshot);
    expect(periods).toHaveLength(2);
  });

  it('returns fresh objects, never references into the input', () => {
    const original = period('2026-03-04', '2026-03-08');
    const normalized = normalizePeriods(freeze([original]));
    expect(normalized[0]).not.toBe(original);
    expect(normalized[0]).toEqual(original);
  });

  it('preserves the exact set of exempt days it claims to (union semantics)', () => {
    const periods = freeze([
      period('2026-03-01', '2026-03-05'),
      period('2026-03-06', '2026-03-08'),
      period('2026-03-20', '2026-03-22'),
    ]);
    const before = expandExemptDays(periods, '2026-02-01', '2026-04-30');
    const after = expandExemptDays(normalizePeriods(periods), '2026-02-01', '2026-04-30');
    expect([...after]).toEqual([...before]);
  });

  it('throws RangeError on a malformed period', () => {
    expect(() => normalizePeriods([period('2026-03-32', null)])).toThrow(RangeError);
  });

  it('throws RangeError when periods is not an array', () => {
    expect(() => normalizePeriods(undefined as unknown as ExemptPeriod[])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// findOpenPeriod
// ---------------------------------------------------------------------------

describe('findOpenPeriod', () => {
  it('returns null for empty input', () => {
    expect(findOpenPeriod([])).toBeNull();
  });

  it('returns null when every period is closed', () => {
    expect(findOpenPeriod(freeze([period('2026-03-01', '2026-03-05')]))).toBeNull();
  });

  it('returns the ongoing period', () => {
    const open = findOpenPeriod(
      freeze([period('2026-01-01', '2026-01-05'), period('2026-03-01', null)])
    );
    expect(open?.startDay).toBe('2026-03-01');
    expect(open?.endDay).toBeNull();
  });

  it('returns the merged (earliest) start when the open period touches a closed one', () => {
    const open = findOpenPeriod(
      freeze([period('2026-02-25', '2026-02-28'), period('2026-03-01', null)])
    );
    expect(open?.startDay).toBe('2026-02-25');
  });

  it('is unambiguous even when the stored data holds several open periods', () => {
    const open = findOpenPeriod(freeze([period('2026-05-01', null), period('2026-03-01', null)]));
    expect(open?.startDay).toBe('2026-03-01');
  });
});

// ---------------------------------------------------------------------------
// findOngoingPeriod
// ---------------------------------------------------------------------------

describe('findOngoingPeriod', () => {
  const TODAY: PrayerDay = '2026-03-10';

  it('returns null for empty input', () => {
    expect(findOngoingPeriod([], TODAY)).toBeNull();
  });

  it('finds an open-ended period, exactly as findOpenPeriod would', () => {
    const ongoing = findOngoingPeriod(freeze([period('2026-03-08', null)]), TODAY);
    expect(ongoing?.startDay).toBe('2026-03-08');
    expect(ongoing?.endDay).toBeNull();
  });

  it('finds a planned period whose end is still to come', () => {
    const ongoing = findOngoingPeriod(freeze([period('2026-03-09', '2026-03-11')]), TODAY);
    expect(ranges(ongoing === null ? [] : [ongoing])).toEqual(['2026-03-09..2026-03-11']);
  });

  it('still counts a planned period on its very last day', () => {
    expect(findOngoingPeriod(freeze([period('2026-03-08', TODAY)]), TODAY)).not.toBeNull();
  });

  it('is over the day after the planned end — which is how an exemption ends by itself', () => {
    expect(findOngoingPeriod(freeze([period('2026-03-05', '2026-03-09')]), TODAY)).toBeNull();
  });

  it('ignores a period that has not started yet', () => {
    expect(findOngoingPeriod(freeze([period('2026-03-11', '2026-03-14')]), TODAY)).toBeNull();
  });

  it('reports the merged stretch when today sits in a run of adjacent records', () => {
    const ongoing = findOngoingPeriod(
      freeze([period('2026-03-05', '2026-03-08'), period('2026-03-09', '2026-03-12')]),
      TODAY
    );
    expect(ranges(ongoing === null ? [] : [ongoing])).toEqual(['2026-03-05..2026-03-12']);
  });

  it('picks today’s period out of a history of past ones', () => {
    const ongoing = findOngoingPeriod(
      freeze([
        period('2026-01-01', '2026-01-05'),
        period('2026-02-01', '2026-02-05'),
        period('2026-03-09', '2026-03-11'),
      ]),
      TODAY
    );
    expect(ongoing?.startDay).toBe('2026-03-09');
  });

  it('agrees with isDayExempt, which is the property that matters', () => {
    const periods = freeze([period('2026-03-01', '2026-03-05'), period('2026-03-09', '2026-03-11')]);
    for (const day of daysBetween('2026-02-28', '2026-03-13')) {
      expect(findOngoingPeriod(periods, day) !== null).toBe(isDayExempt(day, periods));
    }
  });
});

// ---------------------------------------------------------------------------
// expandExemptDays
// ---------------------------------------------------------------------------

describe('expandExemptDays', () => {
  it('returns an empty set for empty input', () => {
    expect(expandExemptDays([], '2026-03-01', '2026-03-31').size).toBe(0);
  });

  it('expands a closed period, both ends inclusive', () => {
    const days = expandExemptDays(
      freeze([period('2026-03-04', '2026-03-07')]),
      '2026-03-01',
      '2026-03-31'
    );
    expect([...days]).toEqual(['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']);
  });

  it('expands a single-day period', () => {
    const days = expandExemptDays(
      freeze([period('2026-03-04', '2026-03-04')]),
      '2026-03-01',
      '2026-03-31'
    );
    expect([...days]).toEqual(['2026-03-04']);
  });

  it('clips a period that starts before the range', () => {
    const days = expandExemptDays(
      freeze([period('2026-02-25', '2026-03-02')]),
      '2026-03-01',
      '2026-03-31'
    );
    expect([...days]).toEqual(['2026-03-01', '2026-03-02']);
  });

  it('clips a period that ends after the range', () => {
    const days = expandExemptDays(
      freeze([period('2026-03-30', '2026-04-04')]),
      '2026-03-01',
      '2026-03-31'
    );
    expect([...days]).toEqual(['2026-03-30', '2026-03-31']);
  });

  it('clips an open-ended period at the end of the range', () => {
    const days = expandExemptDays(freeze([period('2026-03-29', null)]), '2026-03-01', '2026-03-31');
    expect([...days]).toEqual(['2026-03-29', '2026-03-30', '2026-03-31']);
  });

  it('expands an open-ended period that began before the range', () => {
    const days = expandExemptDays(freeze([period('2020-01-01', null)]), '2026-03-01', '2026-03-03');
    expect([...days]).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  });

  it('excludes a period entirely outside the range', () => {
    const days = expandExemptDays(
      freeze([period('2026-01-01', '2026-01-05'), period('2026-06-01', '2026-06-05')]),
      '2026-03-01',
      '2026-03-31'
    );
    expect(days.size).toBe(0);
  });

  it('expands across a month boundary', () => {
    const days = expandExemptDays(
      freeze([period('2026-01-28', '2026-02-03')]),
      '2026-01-01',
      '2026-02-28'
    );
    expect([...days]).toEqual([
      '2026-01-28',
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
      '2026-02-03',
    ]);
  });

  it('expands across a range spanning several months', () => {
    const days = expandExemptDays(
      freeze([
        period('2026-01-30', '2026-02-02'),
        period('2026-02-27', '2026-03-01'),
        period('2026-03-30', '2026-04-01'),
      ]),
      '2026-01-01',
      '2026-04-30'
    );
    expect([...days]).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
    ]);
  });

  it('expands across a year boundary', () => {
    const days = expandExemptDays(
      freeze([period('2025-12-31', '2026-01-01')]),
      '2025-12-01',
      '2026-01-31'
    );
    expect([...days]).toEqual(['2025-12-31', '2026-01-01']);
  });

  it('includes 29 February in a leap year', () => {
    const days = expandExemptDays(
      freeze([period('2028-02-28', '2028-03-01')]),
      '2028-02-01',
      '2028-03-31'
    );
    expect([...days]).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('counts a day covered by two overlapping periods once', () => {
    const days = expandExemptDays(
      freeze([period('2026-03-01', '2026-03-05'), period('2026-03-03', '2026-03-07')]),
      '2026-03-01',
      '2026-03-31'
    );
    expect(days.size).toBe(7);
  });

  it('iterates ascending', () => {
    const days = expandExemptDays(
      freeze([period('2026-03-20', '2026-03-21'), period('2026-03-01', '2026-03-02')]),
      '2026-01-01',
      '2026-12-31'
    );
    expect([...days]).toEqual(['2026-03-01', '2026-03-02', '2026-03-20', '2026-03-21']);
  });

  it('returns an empty set when the range is inverted, without throwing', () => {
    expect(
      expandExemptDays(freeze([period('2026-03-01', null)]), '2026-03-31', '2026-03-01').size
    ).toBe(0);
  });

  it('returns the single day when the range is one day long', () => {
    const days = expandExemptDays(
      freeze([period('2026-03-01', '2026-03-31')]),
      '2026-03-10',
      '2026-03-10'
    );
    expect([...days]).toEqual(['2026-03-10']);
  });

  it('ignores inverted periods', () => {
    const days = expandExemptDays(
      freeze([period('2026-03-10', '2026-03-01')]),
      '2026-03-01',
      '2026-03-31'
    );
    expect(days.size).toBe(0);
  });

  it('throws RangeError on malformed bounds', () => {
    expect(() => expandExemptDays([], 'nope', '2026-03-31')).toThrow(RangeError);
    expect(() => expandExemptDays([], '2026-03-01', '2026-04-31')).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// countExemptDaysInRange
// ---------------------------------------------------------------------------

describe('countExemptDaysInRange', () => {
  const scenarios: { name: string; periods: ExemptPeriod[]; from: PrayerDay; to: PrayerDay }[] = [
    { name: 'empty input', periods: [], from: '2026-01-01', to: '2026-12-31' },
    {
      name: 'single closed period',
      periods: [period('2026-03-04', '2026-03-08')],
      from: '2026-03-01',
      to: '2026-03-31',
    },
    {
      name: 'overlapping periods',
      periods: [period('2026-03-01', '2026-03-10'), period('2026-03-05', '2026-03-15')],
      from: '2026-01-01',
      to: '2026-12-31',
    },
    {
      name: 'adjacent periods',
      periods: [period('2026-03-01', '2026-03-05'), period('2026-03-06', '2026-03-10')],
      from: '2026-03-01',
      to: '2026-03-31',
    },
    {
      name: 'open-ended period clipped by the range',
      periods: [period('2026-03-20', null)],
      from: '2026-03-01',
      to: '2026-03-31',
    },
    {
      name: 'periods straddling both range edges',
      periods: [period('2026-02-25', '2026-03-03'), period('2026-03-28', '2026-04-05')],
      from: '2026-03-01',
      to: '2026-03-31',
    },
    {
      name: 'inverted period mixed in',
      periods: [period('2026-03-10', '2026-03-01'), period('2026-03-15', '2026-03-16')],
      from: '2026-03-01',
      to: '2026-03-31',
    },
    {
      name: 'range spanning a month boundary',
      periods: [period('2026-01-28', '2026-02-03')],
      from: '2026-01-20',
      to: '2026-02-10',
    },
  ];

  it.each(scenarios)('agrees with expandExemptDays().size — $name', ({ periods, from, to }) => {
    freeze(periods);
    expect(countExemptDaysInRange(periods, from, to)).toBe(
      expandExemptDays(periods, from, to).size
    );
  });

  it('counts an inclusive closed period', () => {
    expect(
      countExemptDaysInRange(
        freeze([period('2026-03-04', '2026-03-08')]),
        '2026-03-01',
        '2026-03-31'
      )
    ).toBe(5);
  });

  it('counts a single-day period as one', () => {
    expect(
      countExemptDaysInRange(
        freeze([period('2026-03-04', '2026-03-04')]),
        '2026-03-01',
        '2026-03-31'
      )
    ).toBe(1);
  });

  it('counts overlapping days once', () => {
    expect(
      countExemptDaysInRange(
        freeze([period('2026-03-01', '2026-03-10'), period('2026-03-05', '2026-03-15')]),
        '2026-03-01',
        '2026-03-31'
      )
    ).toBe(15);
  });

  it('returns 0 for an empty period list', () => {
    expect(countExemptDaysInRange([], '2026-03-01', '2026-03-31')).toBe(0);
  });

  it('returns 0 for an inverted range', () => {
    expect(
      countExemptDaysInRange(freeze([period('2026-03-01', null)]), '2026-03-31', '2026-03-01')
    ).toBe(0);
  });

  it('counts a month boundary crossing correctly', () => {
    expect(
      countExemptDaysInRange(
        freeze([period('2026-01-28', '2026-02-03')]),
        '2026-01-01',
        '2026-02-28'
      )
    ).toBe(7);
  });

  it('handles a decade-long range with an open-ended period without expanding it', () => {
    const periods = freeze([period('2026-06-01', null)]);
    expect(countExemptDaysInRange(periods, '2026-01-01', '2035-12-31')).toBe(
      diffDays('2026-06-01', '2035-12-31') + 1
    );
  });

  it('throws RangeError on malformed bounds', () => {
    expect(() => countExemptDaysInRange([], '2026-03-01', 'nope')).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// startPeriod
// ---------------------------------------------------------------------------

describe('startPeriod', () => {
  it('opens a period from the given day when nothing is stored', () => {
    const result = startPeriod([], '2026-03-04', T0);
    expect(ranges(result)).toEqual(['2026-03-04..∞']);
    expect(result[0]?.createdAt).toBe(T0);
  });

  it('marks the start day and every following day exempt', () => {
    const result = startPeriod([], '2026-03-04', T0);
    expect(isDayExempt('2026-03-03', result)).toBe(false);
    expect(isDayExempt('2026-03-04', result)).toBe(true);
    expect(isDayExempt('2026-09-04', result)).toBe(true);
  });

  it('keeps earlier closed periods untouched', () => {
    const stored = freeze([period('2026-01-01', '2026-01-05')]);
    expect(ranges(startPeriod(stored, '2026-03-04', T0))).toEqual([
      '2026-01-01..2026-01-05',
      '2026-03-04..∞',
    ]);
  });

  it('is a no-op on coverage when the same day is already open', () => {
    const stored = freeze([period('2026-03-04', null)]);
    expect(ranges(startPeriod(stored, '2026-03-04', T0 + DAY_MS))).toEqual(['2026-03-04..∞']);
  });

  it('is idempotent when applied twice', () => {
    const once = startPeriod([], '2026-03-04', T0);
    const twice = startPeriod(once, '2026-03-04', T0 + DAY_MS);
    expect(ranges(twice)).toEqual(ranges(once));
  });

  it('leaves an already-open earlier period alone when starting a later day', () => {
    const stored = freeze([period('2026-03-01', null)]);
    const result = startPeriod(stored, '2026-03-10', T0 + DAY_MS);
    expect(ranges(result)).toEqual(['2026-03-01..∞']);
    expect(isDayExempt('2026-03-05', result)).toBe(true);
  });

  it('widens an open period backwards when starting an earlier day (start-date correction)', () => {
    const stored = freeze([period('2026-03-10', null)]);
    const result = startPeriod(stored, '2026-03-04', T0 + DAY_MS);
    expect(ranges(result)).toEqual(['2026-03-04..∞']);
    expect(isDayExempt('2026-03-04', result)).toBe(true);
    expect(isDayExempt('2026-03-03', result)).toBe(false);
  });

  it('never produces two open-ended periods, however often it is called', () => {
    let periods: ExemptPeriod[] = [];
    for (const day of ['2026-03-04', '2026-04-01', '2026-02-01', '2026-04-01']) {
      periods = startPeriod(periods, day, T0);
      expect(periods.filter((entry) => entry.endDay === null)).toHaveLength(1);
    }
    expect(ranges(periods)).toEqual(['2026-02-01..∞']);
  });

  it('never removes an exempt day (coverage is monotone)', () => {
    const stored = freeze([period('2026-01-01', '2026-01-05'), period('2026-02-01', '2026-02-05')]);
    const before = expandExemptDays(stored, '2026-01-01', '2026-06-30');
    const after = expandExemptDays(
      startPeriod(stored, '2026-03-04', T0),
      '2026-01-01',
      '2026-06-30'
    );
    for (const day of before) expect(after.has(day)).toBe(true);
  });

  it('merges with an adjacent closed period and re-opens the stretch', () => {
    const stored = freeze([period('2026-03-01', '2026-03-03')]);
    expect(ranges(startPeriod(stored, '2026-03-04', T0))).toEqual(['2026-03-01..∞']);
  });

  it('re-opens a closed period when starting inside it', () => {
    const stored = freeze([period('2026-03-01', '2026-03-10')]);
    const result = startPeriod(stored, '2026-03-05', T0);
    expect(ranges(result)).toEqual(['2026-03-01..∞']);
    expect(isDayExempt('2026-03-20', result)).toBe(true);
  });

  it('keeps the stored id when the new period merges into an existing one', () => {
    const stored = freeze([period('2026-03-01', '2026-03-03', { id: 42 })]);
    expect(startPeriod(stored, '2026-03-04', T0)[0]?.id).toBe(42);
  });

  it('does not mutate the stored list', () => {
    const stored = freeze([period('2026-03-01', '2026-03-03')]);
    startPeriod(stored, '2026-03-04', T0);
    expect(ranges(stored)).toEqual(['2026-03-01..2026-03-03']);
  });

  it('throws RangeError on a malformed day or timestamp', () => {
    expect(() => startPeriod([], '2026-03-32', T0)).toThrow(RangeError);
    expect(() => startPeriod([], '2026-03-04', Number.NaN)).toThrow(RangeError);
    expect(() => startPeriod([], '2026-03-04', undefined as unknown as number)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// endPeriod
// ---------------------------------------------------------------------------

describe('endPeriod', () => {
  it('closes the ongoing period, with the end day inclusive', () => {
    const stored = freeze([period('2026-03-04', null)]);
    const result = endPeriod(stored, '2026-03-08', T0);
    expect(ranges(result)).toEqual(['2026-03-04..2026-03-08']);
    expect(isDayExempt('2026-03-08', result)).toBe(true);
    expect(isDayExempt('2026-03-09', result)).toBe(false);
  });

  it('produces a single-day period when ending on the start day', () => {
    const stored = freeze([period('2026-03-04', null)]);
    expect(ranges(endPeriod(stored, '2026-03-04', T0))).toEqual(['2026-03-04..2026-03-04']);
  });

  it('round-trips with startPeriod', () => {
    const started = startPeriod([], '2026-03-04', T0);
    const ended = endPeriod(started, '2026-03-09', T0 + 5 * DAY_MS);
    expect(ranges(ended)).toEqual(['2026-03-04..2026-03-09']);
    expect(countExemptDaysInRange(ended, '2026-01-01', '2026-12-31')).toBe(6);
  });

  it('is a no-op when nothing is ongoing', () => {
    const stored = freeze([period('2026-01-01', '2026-01-05')]);
    expect(ranges(endPeriod(stored, '2026-03-04', T0))).toEqual(['2026-01-01..2026-01-05']);
  });

  it('is a no-op on an empty list', () => {
    expect(endPeriod([], '2026-03-04', T0)).toEqual([]);
  });

  it('still normalizes when there is nothing to end', () => {
    const stored = freeze([period('2026-01-06', '2026-01-08'), period('2026-01-01', '2026-01-05')]);
    expect(ranges(endPeriod(stored, '2026-03-04', T0))).toEqual(['2026-01-01..2026-01-08']);
  });

  it('cancels the period when the end day precedes its start', () => {
    const stored = freeze([period('2026-03-04', null)]);
    expect(endPeriod(stored, '2026-03-01', T0)).toEqual([]);
  });

  it('cancels only the ongoing period, keeping other records', () => {
    const stored = freeze([period('2026-01-01', '2026-01-05'), period('2026-03-04', null)]);
    expect(ranges(endPeriod(stored, '2026-02-01', T0))).toEqual(['2026-01-01..2026-01-05']);
  });

  it('merges the closed period with an adjacent earlier one', () => {
    const stored = freeze([period('2026-03-01', '2026-03-03'), period('2026-03-04', null)]);
    expect(ranges(endPeriod(stored, '2026-03-08', T0))).toEqual(['2026-03-01..2026-03-08']);
  });

  it('does not retract days recorded by an already-closed period', () => {
    const stored = freeze([period('2026-03-15', '2026-03-20'), period('2026-03-01', null)]);
    const result = endPeriod(stored, '2026-03-10', T0);
    expect(ranges(result)).toEqual(['2026-03-01..2026-03-10', '2026-03-15..2026-03-20']);
    expect(isDayExempt('2026-03-18', result)).toBe(true);
  });

  it('closes the merged range when the open period had swallowed a neighbour', () => {
    const stored = freeze([period('2026-02-25', '2026-02-28'), period('2026-03-01', null)]);
    expect(ranges(endPeriod(stored, '2026-03-05', T0))).toEqual(['2026-02-25..2026-03-05']);
  });

  it('collapses several stored open periods into one closed range', () => {
    const stored = freeze([period('2026-03-01', null), period('2026-05-01', null)]);
    expect(ranges(endPeriod(stored, '2026-06-01', T0))).toEqual(['2026-03-01..2026-06-01']);
  });

  it('keeps the id of the period it closed', () => {
    const stored = freeze([period('2026-03-04', null, { id: 5 })]);
    expect(endPeriod(stored, '2026-03-08', T0)[0]?.id).toBe(5);
  });

  it('keeps the original createdAt of the closed period', () => {
    const stored = freeze([period('2026-03-04', null, { createdAt: T0 })]);
    expect(endPeriod(stored, '2026-03-08', T0 + 4 * DAY_MS)[0]?.createdAt).toBe(T0);
  });

  it('closes across a month boundary', () => {
    const stored = freeze([period('2026-01-30', null)]);
    const result = endPeriod(stored, '2026-02-02', T0);
    expect(ranges(result)).toEqual(['2026-01-30..2026-02-02']);
    expect(countExemptDaysInRange(result, '2026-01-01', '2026-02-28')).toBe(4);
  });

  it('does not mutate the stored list', () => {
    const stored = freeze([period('2026-03-04', null)]);
    endPeriod(stored, '2026-03-08', T0);
    expect(ranges(stored)).toEqual(['2026-03-04..∞']);
  });

  it('throws RangeError on a malformed day or timestamp', () => {
    expect(() => endPeriod([], '2026-02-30', T0)).toThrow(RangeError);
    expect(() => endPeriod([], '2026-03-04', Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// trimOngoingPeriod
// ---------------------------------------------------------------------------

describe('trimOngoingPeriod', () => {
  const TODAY: PrayerDay = '2026-03-10';

  describe('an open-ended period: identical to endPeriod', () => {
    const CASES: { name: string; stored: ExemptPeriod[]; day: PrayerDay }[] = [
      { name: 'closes it', stored: [period('2026-03-04', null)], day: '2026-03-08' },
      { name: 'single day', stored: [period('2026-03-10', null)], day: TODAY },
      { name: 'cancels it', stored: [period('2026-03-04', null)], day: '2026-03-01' },
      {
        name: 'keeps other records',
        stored: [period('2026-01-01', '2026-01-05'), period('2026-03-04', null)],
        day: '2026-03-08',
      },
      {
        name: 'merges with an adjacent earlier one',
        stored: [period('2026-03-01', '2026-03-03'), period('2026-03-04', null)],
        day: '2026-03-08',
      },
    ];

    it.each(CASES)('$name', ({ stored, day }) => {
      const frozen = freeze(stored);
      expect(ranges(trimOngoingPeriod(frozen, day, TODAY, T0))).toEqual(
        ranges(endPeriod(frozen, day, T0))
      );
    });
  });

  describe('a planned period, which endPeriod cannot touch', () => {
    it('cuts it short, ending today', () => {
      const stored = freeze([period('2026-03-08', '2026-03-14')]);
      const result = trimOngoingPeriod(stored, TODAY, TODAY, T0);
      expect(ranges(result)).toEqual(['2026-03-08..2026-03-10']);
      expect(isDayExempt('2026-03-11', result)).toBe(false);
    });

    it('cuts it short, ending yesterday', () => {
      const stored = freeze([period('2026-03-08', '2026-03-14')]);
      const result = trimOngoingPeriod(stored, '2026-03-09', TODAY, T0);
      expect(ranges(result)).toEqual(['2026-03-08..2026-03-09']);
      expect(isDayExempt(TODAY, result)).toBe(false);
    });

    it('cancels it when the end precedes its start — the mode being switched off', () => {
      const stored = freeze([period('2026-03-10', '2026-03-16')]);
      expect(trimOngoingPeriod(stored, '2026-03-09', TODAY, T0)).toEqual([]);
    });

    it('keeps the id and the original createdAt', () => {
      const stored = freeze([period('2026-03-08', '2026-03-14', { id: 7 })]);
      const [trimmed] = trimOngoingPeriod(stored, TODAY, TODAY, T0 + DAY_MS);
      expect(trimmed?.id).toBe(7);
      expect(trimmed?.createdAt).toBe(T0);
    });

    it('leaves a past record alone while trimming today’s', () => {
      const stored = freeze([period('2026-01-01', '2026-01-05'), period('2026-03-08', '2026-03-14')]);
      expect(ranges(trimOngoingPeriod(stored, TODAY, TODAY, T0))).toEqual([
        '2026-01-01..2026-01-05',
        '2026-03-08..2026-03-10',
      ]);
    });

    it('trims the whole merged stretch, not just the record today falls in', () => {
      const stored = freeze([period('2026-03-05', '2026-03-09'), period('2026-03-10', '2026-03-16')]);
      expect(ranges(trimOngoingPeriod(stored, TODAY, TODAY, T0))).toEqual(['2026-03-05..2026-03-10']);
    });
  });

  it('is a no-op when nothing is ongoing, having already run out', () => {
    const stored = freeze([period('2026-03-01', '2026-03-05')]);
    expect(ranges(trimOngoingPeriod(stored, TODAY, TODAY, T0))).toEqual(['2026-03-01..2026-03-05']);
  });

  it('is a no-op on an empty list', () => {
    expect(trimOngoingPeriod([], TODAY, TODAY, T0)).toEqual([]);
  });

  it('leaves a not-yet-started period alone', () => {
    const stored = freeze([period('2026-03-11', '2026-03-14')]);
    expect(ranges(trimOngoingPeriod(stored, TODAY, TODAY, T0))).toEqual(['2026-03-11..2026-03-14']);
  });

  it('ends the exemption for good: nothing is ongoing afterwards', () => {
    const stored = freeze([period('2026-03-08', '2026-03-14')]);
    const result = trimOngoingPeriod(stored, '2026-03-09', TODAY, T0);
    expect(findOngoingPeriod(result, TODAY)).toBeNull();
  });

  it('does not mutate the stored list', () => {
    const stored = freeze([period('2026-03-08', '2026-03-14')]);
    trimOngoingPeriod(stored, TODAY, TODAY, T0);
    expect(ranges(stored)).toEqual(['2026-03-08..2026-03-14']);
  });

  it('throws RangeError on a malformed day, today or timestamp', () => {
    expect(() => trimOngoingPeriod([], '2026-02-30', TODAY, T0)).toThrow(RangeError);
    expect(() => trimOngoingPeriod([], TODAY, '2026-02-30', T0)).toThrow(RangeError);
    expect(() => trimOngoingPeriod([], TODAY, TODAY, Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// A period planned to end in the future
// ---------------------------------------------------------------------------

/**
 * "Excused for three days" is stored as an ordinary closed period whose end has not arrived yet,
 * which is what makes an exemption that ends by itself need no timer and no scheduled work: the
 * coverage simply runs out. Nothing in this module knows what day it is, so a future end was always
 * going to behave — these lock that in, because the whole feature rests on it.
 */
describe('a planned period is an ordinary closed period', () => {
  const TODAY: PrayerDay = '2026-03-10';
  /** Three days beginning today: today plus two more. */
  const planned = freeze([period(TODAY, '2026-03-12')]);

  it('covers today and every planned day', () => {
    expect(isDayExempt(TODAY, planned)).toBe(true);
    expect(isDayExempt('2026-03-11', planned)).toBe(true);
    expect(isDayExempt('2026-03-12', planned)).toBe(true);
  });

  it('stops covering the day after, with nothing having run', () => {
    expect(isDayExempt('2026-03-13', planned)).toBe(false);
  });

  it('normalizes to itself', () => {
    expect(ranges(normalizePeriods(planned))).toEqual(['2026-03-10..2026-03-12']);
  });

  it('expands to exactly its own days', () => {
    expect([...expandExemptDays(planned, '2026-03-01', '2026-03-31')].sort()).toEqual([
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
    ]);
    expect(countExemptDaysInRange(planned, '2026-03-01', '2026-03-31')).toBe(3);
  });

  it('merges with a plan begun again the day after it lapsed, healing into one stretch', () => {
    // The extend-if-wrong story: nothing to "extend", because adjacent ranges merge.
    const extended = startPeriod(planned, '2026-03-13', T0 + DAY_MS);
    expect(ranges(extended)).toEqual(['2026-03-10..∞']);
  });
});

// ---------------------------------------------------------------------------
// averageExemptDaysPerMonth
// ---------------------------------------------------------------------------

describe('averageExemptDaysPerMonth', () => {
  /** Three 5-day periods over a 90-day window: the everyday case for the qada wizard. */
  const quarter = freeze([
    period('2026-01-01', '2026-01-05'),
    period('2026-02-01', '2026-02-05'),
    period('2026-03-01', '2026-03-05'),
  ]);

  it('expresses the observed count as a rate per mean Gregorian month', () => {
    const average = averageExemptDaysPerMonth(quarter, '2026-01-01', '2026-03-31');
    expect(average).toBeCloseTo((15 * AVERAGE_DAYS_PER_MONTH) / 90, 10);
    expect(average).toBeCloseTo(5.0728, 4);
  });

  it('returns roughly the per-cycle count for a one-month window', () => {
    const average = averageExemptDaysPerMonth(
      freeze([period('2026-01-10', '2026-01-16')]),
      '2026-01-01',
      '2026-01-31'
    );
    expect(average).toBeCloseTo((7 * AVERAGE_DAYS_PER_MONTH) / 31, 10);
    expect(average).toBeCloseTo(6.87, 2);
  });

  it('counts only the part of a period inside the window', () => {
    const average = averageExemptDaysPerMonth(
      freeze([period('2025-12-28', '2026-01-03')]),
      '2026-01-01',
      '2026-02-28'
    );
    expect(average).toBeCloseTo((3 * AVERAGE_DAYS_PER_MONTH) / 59, 10);
  });

  it('clips an open-ended period at the end of the window', () => {
    const average = averageExemptDaysPerMonth(
      freeze([period('2026-01-15', null)]),
      '2026-01-01',
      '2026-02-28'
    );
    expect(average).toBeCloseTo((45 * AVERAGE_DAYS_PER_MONTH) / 59, 10);
  });

  it('counts overlapping periods once', () => {
    const average = averageExemptDaysPerMonth(
      freeze([period('2026-01-01', '2026-01-10'), period('2026-01-05', '2026-01-15')]),
      '2026-01-01',
      '2026-03-31'
    );
    expect(average).toBeCloseTo((15 * AVERAGE_DAYS_PER_MONTH) / 90, 10);
  });

  it('returns null when the window contains no exempt day at all', () => {
    expect(averageExemptDaysPerMonth([], '2026-01-01', '2026-12-31')).toBeNull();
    expect(
      averageExemptDaysPerMonth(
        freeze([period('2024-01-01', '2024-01-05')]),
        '2026-01-01',
        '2026-12-31'
      )
    ).toBeNull();
  });

  it('returns null for a window shorter than the minimum observation length', () => {
    const periods = freeze([period('2026-01-01', '2026-01-05')]);
    expect(averageExemptDaysPerMonth(periods, '2026-01-01', '2026-01-27')).toBeNull();
  });

  it('accepts a window of exactly the minimum observation length', () => {
    const periods = freeze([period('2026-01-01', '2026-01-05')]);
    const average = averageExemptDaysPerMonth(periods, '2026-01-01', '2026-01-28');
    expect(average).toBeCloseTo((5 * AVERAGE_DAYS_PER_MONTH) / MIN_AVERAGE_WINDOW_DAYS, 10);
  });

  it('returns null for an inverted window', () => {
    expect(averageExemptDaysPerMonth(quarter, '2026-03-31', '2026-01-01')).toBeNull();
  });

  it('returns null for a single-day window', () => {
    expect(averageExemptDaysPerMonth(quarter, '2026-01-02', '2026-01-02')).toBeNull();
  });

  it('is stable across a long window of regular cycles', () => {
    const periods = freeze(
      Array.from({ length: 12 }, (_unused, index) => {
        const month = String(index + 1).padStart(2, '0');
        return period(`2026-${month}-01`, `2026-${month}-05`);
      })
    );
    const average = averageExemptDaysPerMonth(periods, '2026-01-01', '2026-12-31');
    expect(average).toBeCloseTo(5, 1);
  });

  it('reflects a long postnatal stretch honestly (callers must widen the window)', () => {
    const average = averageExemptDaysPerMonth(
      freeze([period('2026-01-05', '2026-02-13')]),
      '2026-01-01',
      '2026-02-28'
    );
    expect(average).toBeCloseTo((40 * AVERAGE_DAYS_PER_MONTH) / 59, 10);
    expect(average).toBeGreaterThan(20);
  });

  it('never returns 0 — an absence of records is not an absence of periods', () => {
    const average = averageExemptDaysPerMonth([], '2020-01-01', '2026-12-31');
    expect(average).toBeNull();
  });

  it('throws RangeError on malformed bounds', () => {
    expect(() => averageExemptDaysPerMonth([], '2026-01-01', 'later')).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting invariants
// ---------------------------------------------------------------------------

describe('cross-cutting invariants', () => {
  const messyPeriods = freeze([
    period('2026-01-28', '2026-02-03'), // month boundary
    period('2026-02-04', '2026-02-06'), // adjacent to the previous one
    period('2026-03-10', '2026-03-10'), // single day
    period('2026-05-01', '2026-04-01'), // inverted → dropped
    period('2026-04-20', '2026-04-25'),
    period('2026-04-22', '2026-04-28'), // overlapping
  ]);

  it('isDayExempt agrees with expandExemptDays for every day of a 400-day range', () => {
    const days = expandExemptDays(messyPeriods, '2025-12-01', '2027-01-04');
    for (const day of daysBetween('2025-12-01', '2027-01-04')) {
      expect(isDayExempt(day, messyPeriods)).toBe(days.has(day));
    }
  });

  it('isDayExempt agrees with an open-ended period over a long range', () => {
    const periods = freeze([period('2026-06-15', null)]);
    const days = expandExemptDays(periods, '2026-01-01', '2026-12-31');
    for (const day of daysBetween('2026-01-01', '2026-12-31')) {
      expect(isDayExempt(day, periods)).toBe(days.has(day));
    }
  });

  it('normalization preserves the exempt day set exactly', () => {
    const before = expandExemptDays(messyPeriods, '2025-01-01', '2027-12-31');
    const after = expandExemptDays(normalizePeriods(messyPeriods), '2025-01-01', '2027-12-31');
    expect([...after]).toEqual([...before]);
  });

  it('start-then-end reproduces exactly the days the user marked', () => {
    let periods = startPeriod([], '2026-03-04', T0);
    periods = endPeriod(periods, '2026-03-09', T0 + 5 * DAY_MS);
    periods = startPeriod(periods, '2026-04-01', T0 + 28 * DAY_MS);
    periods = endPeriod(periods, '2026-04-06', T0 + 33 * DAY_MS);
    expect(ranges(periods)).toEqual(['2026-03-04..2026-03-09', '2026-04-01..2026-04-06']);
    expect(countExemptDaysInRange(periods, '2026-01-01', '2026-12-31')).toBe(12);
    expect(isDayExempt('2026-03-10', periods)).toBe(false);
    expect(isDayExempt('2026-04-06', periods)).toBe(true);
  });

  it('normalized periods are strictly ordered and never adjacent', () => {
    const normalized = normalizePeriods(messyPeriods);
    for (let index = 1; index < normalized.length; index += 1) {
      const previous = normalized[index - 1];
      const current = normalized[index];
      expect(previous?.endDay).not.toBeNull();
      expect(
        diffDays(previous?.endDay as PrayerDay, current?.startDay as PrayerDay)
      ).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Timezone and DST immunity by construction
// ---------------------------------------------------------------------------

describe('timezone and DST immunity by construction', () => {
  const source = fs.readFileSync(path.join(__dirname, 'exemptions.ts'), 'utf8');

  it('never constructs or reads a Date', () => {
    expect(source).not.toMatch(/new Date\b/);
    expect(source).not.toMatch(/Date\.(now|parse|UTC)\b/);
    expect(source).not.toMatch(/toISOString|getFullYear|getTimezoneOffset/);
  });

  it('imports nothing but dates.ts and the type contract', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(['./dates', './types']);
  });

  it('contains no React, React Native or Expo import', () => {
    expect(source).not.toMatch(/from 'react/);
    expect(source).not.toMatch(/from 'expo/);
  });
});
