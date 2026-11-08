/**
 * Tests for qada debt math (PRODUCT_SPEC §7).
 *
 * ## Timezone strategy
 *
 * Every instant in these tests is built from *local* fields (`parseDay` + `setHours`), never
 * from a UTC literal like `'2026-08-19T00:00:00Z'`. The pace window is defined in local
 * calendar days, so a UTC literal would land on a different day on this machine
 * (Europe/Istanbul, UTC+3) than in CI (UTC) and the boundary tests would flap. Nothing here
 * reads the real clock: `todayDay` and `now` are always injected.
 *
 * ## The invariant under test
 *
 * The counters descend toward relief and can never go negative — through ticks, undone misses,
 * corrupt stored data, absurd exemption settings, forgiveness and its undo.
 */

import { addDays, diffDays, isValidDay, parseDay, toDayString } from './dates';
import {
  addDebts,
  applyMiss,
  applyTick,
  applyUndoMiss,
  canUndoForgive,
  computeProgress,
  DAYS_PER_MONTH,
  DEFAULT_PACE_WINDOW_DAYS,
  emptyDebts,
  estimateDebt,
  estimateRangeDays,
  FORGIVE_UNDO_WINDOW_DAYS,
  forgive,
  MAX_PROJECTION_DAYS,
  MIN_PACE_SAMPLE,
  MIN_PROJECTABLE_DEBT,
  mostOwedPrayer,
  normalizeDebts,
  totalDebt,
  undoForgive,
} from './qada';
import { PRAYERS, type Prayer, type PrayerDay, type QadaDebts, type QadaEvent } from './types';

// ---------------------------------------------------------------------------
// Helpers — all local-time, never a UTC string
// ---------------------------------------------------------------------------

const TODAY: PrayerDay = '2026-08-19';

/** A `Date` at a local wall-clock time on `day`. */
function at(day: PrayerDay, hours = 12, minutes = 0): Date {
  const date = parseDay(day);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/** A `tick` event on `day` at a local wall-clock time. */
function tickOn(
  day: PrayerDay,
  { prayer = 'fajr' as Prayer, delta = -1, hours = 12, minutes = 0 } = {}
): QadaEvent {
  return { type: 'tick', prayer, delta, at: at(day, hours, minutes).getTime() };
}

/** `n` tick events, one per day, on the `n` days ending on `endDay`. */
function ticksOverDays(endDay: PrayerDay, n: number): QadaEvent[] {
  return Array.from({ length: n }, (_unused, index) => tickOn(addDays(endDay, -index)));
}

function debts(values: Partial<QadaDebts>): QadaDebts {
  return { ...emptyDebts(), ...values };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('uses the average Julian month (365.25 / 12) for month conversion', () => {
    expect(DAYS_PER_MONTH).toBe(30.4375);
    expect(DAYS_PER_MONTH).toBeCloseTo(365.25 / 12, 10);
  });

  it('defaults the pace window to 30 days', () => {
    expect(DEFAULT_PACE_WINDOW_DAYS).toBe(30);
  });

  it('keeps the forgive undo open for 30 days', () => {
    expect(FORGIVE_UNDO_WINDOW_DAYS).toBe(30);
  });

  it('stops projecting past ten years, where a date becomes a sentence', () => {
    expect(MAX_PROJECTION_DAYS).toBe(3_650);
  });

  it('needs a day of prayers under a projection, at both ends', () => {
    expect(MIN_PACE_SAMPLE).toBe(5);
    expect(MIN_PROJECTABLE_DEBT).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// emptyDebts / totalDebt / normalizeDebts / mostOwedPrayer
// ---------------------------------------------------------------------------

describe('emptyDebts', () => {
  it('has exactly the five tracked prayers as keys', () => {
    expect(Object.keys(emptyDebts()).sort()).toEqual([...PRAYERS].sort());
  });

  it('starts every counter at zero', () => {
    const empty = emptyDebts();
    for (const prayer of PRAYERS) {
      expect(empty[prayer]).toBe(0);
    }
  });

  it('returns a fresh object each call (no shared singleton to mutate)', () => {
    const first = emptyDebts();
    const second = emptyDebts();
    expect(first).not.toBe(second);
    first.fajr = 9;
    expect(second.fajr).toBe(0);
  });
});

describe('totalDebt', () => {
  it('is zero for an empty debt', () => {
    expect(totalDebt(emptyDebts())).toBe(0);
  });

  it('sums all five counters', () => {
    expect(totalDebt({ fajr: 1, dhuhr: 2, asr: 3, maghrib: 4, isha: 5 })).toBe(15);
  });

  it('clamps corrupt negative counts to zero instead of subtracting', () => {
    expect(totalDebt({ fajr: -100, dhuhr: 2, asr: 0, maghrib: 0, isha: 0 })).toBe(2);
  });

  it('ignores non-finite counts rather than returning NaN', () => {
    const corrupt = { fajr: Number.NaN, dhuhr: Number.POSITIVE_INFINITY, asr: 4 } as QadaDebts;
    expect(totalDebt(corrupt)).toBe(4);
  });

  it('floors fractional counts (never charges for a fraction of a prayer)', () => {
    expect(totalDebt({ fajr: 3.9, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 })).toBe(3);
  });
});

describe('normalizeDebts', () => {
  it('fills in missing prayers with zero', () => {
    expect(normalizeDebts({ fajr: 3 })).toEqual({ fajr: 3, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });
  });

  it('clamps negatives, floors fractions and drops junk', () => {
    expect(
      normalizeDebts({ fajr: -5, dhuhr: 2.7, asr: '9', maghrib: null, isha: Number.NaN })
    ).toEqual({ fajr: 0, dhuhr: 2, asr: 0, maghrib: 0, isha: 0 });
  });

  it('never throws on rubbish input', () => {
    for (const input of [null, undefined, 42, 'nope', [], true]) {
      expect(normalizeDebts(input)).toEqual(emptyDebts());
    }
  });

  it('returns a copy, not the input', () => {
    const source = debts({ fajr: 2 });
    const normalized = normalizeDebts(source);
    expect(normalized).not.toBe(source);
    normalized.fajr = 99;
    expect(source.fajr).toBe(2);
  });
});

describe('addDebts', () => {
  it('sums the two records prayer by prayer', () => {
    expect(
      addDebts({ fajr: 4, dhuhr: 3, asr: 2, maghrib: 1, isha: 0 }, debts({ fajr: 3, isha: 5 }))
    ).toEqual({ fajr: 7, dhuhr: 3, asr: 2, maghrib: 1, isha: 5 });
  });

  it('leaves the addend alone when it is empty', () => {
    const current = debts({ fajr: 4, asr: 2 });
    expect(addDebts(current, emptyDebts())).toEqual(current);
    expect(addDebts(emptyDebts(), current)).toEqual(current);
  });

  it('sanitises both sides rather than letting corruption through', () => {
    expect(
      addDebts({ fajr: -9, dhuhr: 2.9, asr: Number.NaN, maghrib: 0, isha: 0 } as QadaDebts, {
        fajr: 3,
        dhuhr: '4',
        asr: 1,
        maghrib: 0,
        isha: 0,
      } as unknown as QadaDebts)
    ).toEqual({ fajr: 3, dhuhr: 2, asr: 1, maghrib: 0, isha: 0 });
  });

  it('mutates neither operand', () => {
    const left = debts({ fajr: 2 });
    const right = debts({ fajr: 3 });
    addDebts(left, right);
    expect(left.fajr).toBe(2);
    expect(right.fajr).toBe(3);
  });
});

describe('mostOwedPrayer', () => {
  it('is null when nothing is owed', () => {
    expect(mostOwedPrayer(emptyDebts())).toBeNull();
  });

  it('picks the largest counter', () => {
    expect(mostOwedPrayer({ fajr: 1, dhuhr: 2, asr: 9, maghrib: 4, isha: 5 })).toBe('asr');
  });

  it('breaks ties in canonical prayer order so the suggestion never jitters', () => {
    expect(mostOwedPrayer({ fajr: 0, dhuhr: 7, asr: 7, maghrib: 7, isha: 0 })).toBe('dhuhr');
  });

  it('ignores corrupt counts', () => {
    const corrupt = { fajr: Number.NaN, dhuhr: -50, asr: 1 } as QadaDebts;
    expect(mostOwedPrayer(corrupt)).toBe('asr');
  });
});

// ---------------------------------------------------------------------------
// estimateDebt
// ---------------------------------------------------------------------------

describe('estimateRangeDays', () => {
  it('counts both ends of the range', () => {
    expect(estimateRangeDays('2026-03-14', '2026-03-14')).toBe(1);
    expect(estimateRangeDays('2026-03-01', '2026-03-07')).toBe(7);
    expect(estimateRangeDays('2023-01-01', '2023-12-31')).toBe(365);
    expect(estimateRangeDays('2024-01-01', '2024-12-31')).toBe(366);
  });

  it('agrees with the counter estimateDebt charges', () => {
    for (const [start, end] of [
      ['2026-08-16', '2026-08-19'],
      ['2020-01-01', '2024-12-31'],
      ['2026-02-27', '2026-03-02'],
    ] as [PrayerDay, PrayerDay][]) {
      const days = estimateRangeDays(start, end);
      const result = estimateDebt({
        startDay: start,
        endDay: end,
        deductExemptions: false,
        exemptDaysPerMonth: 0,
      });
      expect(result.fajr).toBe(days);
      expect(totalDebt(result)).toBe(days * PRAYERS.length);
    }
  });

  it('is zero for a range that runs backwards, rather than a throw or a negative', () => {
    expect(estimateRangeDays('2026-08-20', '2026-08-16')).toBe(0);
    expect(estimateRangeDays('2026-08-20', '2000-01-01')).toBe(0);
  });

  it('still rejects a day that is not a date', () => {
    expect(() => estimateRangeDays('2026-02-30', '2026-03-01')).toThrow(/startDay/);
    expect(() => estimateRangeDays('2026-03-01', 'soon' as PrayerDay)).toThrow(/endDay/);
  });
});

describe('estimateDebt', () => {
  const estimate = (
    startDay: PrayerDay,
    endDay: PrayerDay,
    deductExemptions = false,
    exemptDaysPerMonth = 7
  ) => estimateDebt({ startDay, endDay, deductExemptions, exemptDaysPerMonth });

  it('counts a single day as one day, not zero (inclusive range)', () => {
    const result = estimate('2026-03-14', '2026-03-14');
    expect(result).toEqual({ fajr: 1, dhuhr: 1, asr: 1, maghrib: 1, isha: 1 });
    expect(totalDebt(result)).toBe(5);
  });

  it('charges five prayers per day for a week', () => {
    const result = estimate('2026-03-01', '2026-03-07');
    expect(result).toEqual({ fajr: 7, dhuhr: 7, asr: 7, maghrib: 7, isha: 7 });
    expect(totalDebt(result)).toBe(35);
  });

  it('includes both endpoints across a month boundary', () => {
    expect(estimate('2026-01-31', '2026-02-01').fajr).toBe(2);
  });

  it('counts the leap day in a leap year', () => {
    expect(estimate('2024-02-28', '2024-03-01').fajr).toBe(3);
    expect(estimate('2023-02-28', '2023-03-01').fajr).toBe(2);
  });

  it('handles a full non-leap year', () => {
    const result = estimate('2023-01-01', '2023-12-31');
    expect(result.fajr).toBe(365);
    expect(totalDebt(result)).toBe(365 * 5);
  });

  it('handles a five-year span including two leap years', () => {
    const start: PrayerDay = '2020-01-01';
    const end: PrayerDay = '2024-12-31';
    const expectedDays = 366 + 365 + 365 + 365 + 366; // 1827
    expect(diffDays(start, end) + 1).toBe(expectedDays);

    const result = estimate(start, end);
    for (const prayer of PRAYERS) {
      expect(result[prayer]).toBe(expectedDays);
    }
    expect(totalDebt(result)).toBe(expectedDays * 5);
  });

  it('handles a two-decade span without losing precision', () => {
    const result = estimate('2000-01-01', '2019-12-31');
    expect(result.fajr).toBe(diffDays('2000-01-01', '2019-12-31') + 1);
    expect(result.fajr).toBe(7305);
  });

  it('gives every prayer the same count', () => {
    const result = estimate('2019-06-01', '2021-06-01');
    const counts = new Set(PRAYERS.map((prayer) => result[prayer]));
    expect(counts.size).toBe(1);
  });

  it('returns a fresh object that shares nothing with a previous result', () => {
    const first = estimate('2026-01-01', '2026-01-10');
    const second = estimate('2026-01-01', '2026-01-10');
    expect(first).not.toBe(second);
    first.fajr = 0;
    expect(second.fajr).toBe(10);
  });

  describe('exemption deduction', () => {
    it('reduces the estimate by round(months × exemptDaysPerMonth) days per prayer', () => {
      const days = 365;
      const expectedExempt = Math.round((days / DAYS_PER_MONTH) * 7);
      expect(expectedExempt).toBe(84);

      const result = estimate('2023-01-01', '2023-12-31', true, 7);
      for (const prayer of PRAYERS) {
        expect(result[prayer]).toBe(days - expectedExempt);
      }
      expect(result.fajr).toBe(281);
    });

    it('is strictly smaller than the undeducted estimate', () => {
      const plain = estimate('2020-01-01', '2024-12-31', false, 7);
      const deducted = estimate('2020-01-01', '2024-12-31', true, 7);
      expect(totalDebt(deducted)).toBeLessThan(totalDebt(plain));
      expect(deducted.fajr).toBe(1827 - Math.round((1827 / DAYS_PER_MONTH) * 7));
    });

    it('deducts nothing when the rounded deduction is under half a day', () => {
      // 1 day ≈ 0.033 months → 0.23 exempt days → rounds to 0.
      expect(estimate('2026-03-14', '2026-03-14', true, 7).fajr).toBe(1);
    });

    it('rounds halves up (Math.round)', () => {
      // 1 day × (30.4375 / 2) days per month = exactly 0.5 exempt days → 1.
      expect(estimate('2026-03-14', '2026-03-14', true, DAYS_PER_MONTH / 2).fajr).toBe(0);
    });

    it('never goes below zero, however aggressive the exemption figure', () => {
      const result = estimate('2026-01-01', '2026-01-30', true, 31);
      for (const prayer of PRAYERS) {
        expect(result[prayer]).toBe(0);
      }
      expect(totalDebt(result)).toBe(0);
    });

    it('clamps at zero rather than producing a negative debt for an absurd figure', () => {
      const result = estimate('2026-01-01', '2026-12-31', true, 10_000);
      expect(totalDebt(result)).toBe(0);
      for (const prayer of PRAYERS) {
        expect(result[prayer]).toBeGreaterThanOrEqual(0);
      }
    });

    it('changes nothing when the exemption figure is zero', () => {
      expect(estimate('2026-01-01', '2026-12-31', true, 0)).toEqual(
        estimate('2026-01-01', '2026-12-31', false, 7)
      );
    });

    it('ignores exemptDaysPerMonth entirely when deductExemptions is false', () => {
      const result = estimateDebt({
        startDay: '2026-01-01',
        endDay: '2026-12-31',
        deductExemptions: false,
        exemptDaysPerMonth: Number.NaN,
      });
      expect(result.fajr).toBe(365);
    });

    it('rejects a nonsensical exemption figure when the deduction is requested', () => {
      for (const perMonth of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => estimate('2026-01-01', '2026-12-31', true, perMonth)).toThrow(RangeError);
      }
    });
  });

  describe('invalid input', () => {
    it('rejects a reversed range', () => {
      expect(() => estimate('2026-03-14', '2026-03-13')).toThrow(RangeError);
      expect(() => estimate('2026-03-14', '2026-03-13')).toThrow(/before startDay/);
    });

    it('rejects malformed days', () => {
      expect(() => estimate('2026-02-30', '2026-03-01')).toThrow(RangeError);
      expect(() => estimate('2026-3-1', '2026-03-01')).toThrow(RangeError);
      expect(() => estimate('2026-01-01', 'yesterday')).toThrow(RangeError);
      expect(() => estimate(undefined as unknown as PrayerDay, '2026-03-01')).toThrow(RangeError);
    });

    it('names the offending argument', () => {
      expect(() => estimate('nope', '2026-03-01')).toThrow(/startDay/);
      expect(() => estimate('2026-03-01', 'nope')).toThrow(/endDay/);
    });
  });
});

// ---------------------------------------------------------------------------
// applyTick / applyMiss / applyUndoMiss
// ---------------------------------------------------------------------------

describe('applyTick', () => {
  it('decrements the ticked prayer by one', () => {
    expect(applyTick(debts({ fajr: 3 }), 'fajr').fajr).toBe(2);
  });

  it('leaves the other four counters untouched', () => {
    const result = applyTick({ fajr: 3, dhuhr: 4, asr: 5, maghrib: 6, isha: 7 }, 'asr');
    expect(result).toEqual({ fajr: 3, dhuhr: 4, asr: 4, maghrib: 6, isha: 7 });
  });

  it('never goes below zero, however many times it is called', () => {
    let current = debts({ maghrib: 2 });
    for (let i = 0; i < 10; i += 1) {
      current = applyTick(current, 'maghrib');
    }
    expect(current.maghrib).toBe(0);
    expect(totalDebt(current)).toBe(0);
  });

  it('is a silent no-op at zero (no throw, no negative balance)', () => {
    const result = applyTick(emptyDebts(), 'isha');
    expect(result).toEqual(emptyDebts());
  });

  it('does not mutate its input', () => {
    const before = debts({ dhuhr: 5 });
    const result = applyTick(before, 'dhuhr');
    expect(before.dhuhr).toBe(5);
    expect(result).not.toBe(before);
  });

  it('sanitises a corrupt stored counter on the way through', () => {
    const corrupt = { fajr: -7, dhuhr: 2.9 } as QadaDebts;
    const result = applyTick(corrupt, 'dhuhr');
    expect(result).toEqual({ fajr: 0, dhuhr: 1, asr: 0, maghrib: 0, isha: 0 });
  });

  it('rejects a prayer that is not one of the five', () => {
    expect(() => applyTick(emptyDebts(), 'witr' as Prayer)).toThrow(RangeError);
    expect(() => applyTick(emptyDebts(), 'sunrise' as Prayer)).toThrow(RangeError);
    expect(() => applyTick(emptyDebts(), undefined as unknown as Prayer)).toThrow(RangeError);
  });
});

describe('applyMiss', () => {
  it('increments the missed prayer by one', () => {
    expect(applyMiss(emptyDebts(), 'fajr').fajr).toBe(1);
    expect(applyMiss(debts({ fajr: 4 }), 'fajr').fajr).toBe(5);
  });

  it('leaves the other four counters untouched', () => {
    expect(applyMiss(emptyDebts(), 'isha')).toEqual({
      fajr: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 0,
      isha: 1,
    });
  });

  it('does not mutate its input', () => {
    const before = emptyDebts();
    applyMiss(before, 'asr');
    expect(before.asr).toBe(0);
  });

  it('rejects an unknown prayer', () => {
    expect(() => applyMiss(emptyDebts(), 'tahajjud' as Prayer)).toThrow(RangeError);
  });
});

describe('applyUndoMiss', () => {
  it('decrements when a missed log becomes something else', () => {
    expect(applyUndoMiss(debts({ asr: 3 }), 'asr').asr).toBe(2);
  });

  it('round-trips with applyMiss', () => {
    const before = debts({ maghrib: 2 });
    expect(applyUndoMiss(applyMiss(before, 'maghrib'), 'maghrib')).toEqual(before);
  });

  it('never goes below zero (forgiveness is not clawed back by a later edit)', () => {
    expect(applyUndoMiss(emptyDebts(), 'fajr').fajr).toBe(0);
    let current = debts({ fajr: 1 });
    for (let i = 0; i < 5; i += 1) {
      current = applyUndoMiss(current, 'fajr');
    }
    expect(current.fajr).toBe(0);
  });

  it('does not mutate its input', () => {
    const before = debts({ isha: 2 });
    applyUndoMiss(before, 'isha');
    expect(before.isha).toBe(2);
  });

  it('rejects an unknown prayer', () => {
    expect(() => applyUndoMiss(emptyDebts(), '' as Prayer)).toThrow(RangeError);
  });
});

describe('counter invariants under long random sequences', () => {
  it('never produces a negative or fractional counter', () => {
    let current: QadaDebts = debts({ fajr: 3, isha: 1 });
    const operations = [applyTick, applyMiss, applyUndoMiss, applyTick, applyUndoMiss];
    for (let step = 0; step < 500; step += 1) {
      const prayer = PRAYERS[step % PRAYERS.length];
      const operation = operations[step % operations.length];
      current = operation(current, prayer);
      for (const each of PRAYERS) {
        expect(current[each]).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(current[each])).toBe(true);
      }
    }
    expect(totalDebt(current)).toBeGreaterThanOrEqual(0);
  });

  it('only ever grows through an explicit miss', () => {
    const start = debts({ dhuhr: 4 });
    expect(totalDebt(applyTick(start, 'dhuhr'))).toBeLessThan(totalDebt(start));
    expect(totalDebt(applyUndoMiss(start, 'dhuhr'))).toBeLessThan(totalDebt(start));
    expect(totalDebt(applyMiss(start, 'dhuhr'))).toBe(totalDebt(start) + 1);
  });
});

// ---------------------------------------------------------------------------
// computeProgress
// ---------------------------------------------------------------------------

describe('computeProgress', () => {
  const progress = (
    current: QadaDebts,
    events: QadaEvent[],
    todayDay: PrayerDay = TODAY,
    paceWindowDays?: number
  ) => computeProgress(current, events, { todayDay, paceWindowDays });

  it('reports the sanitised debts and their total', () => {
    const result = progress({ fajr: 2.9, dhuhr: -3, asr: 1 } as QadaDebts, []);
    expect(result.debts).toEqual({ fajr: 2, dhuhr: 0, asr: 1, maghrib: 0, isha: 0 });
    expect(result.total).toBe(3);
  });

  it('returns a debts copy that cannot alias the caller input', () => {
    const input = debts({ fajr: 5 });
    const result = progress(input, []);
    expect(result.debts).not.toBe(input);
    result.debts.fajr = 0;
    expect(input.fajr).toBe(5);
  });

  describe('zero pace', () => {
    it('reports no progress and no projection when nothing was ticked', () => {
      const result = progress(debts({ fajr: 50 }), []);
      expect(result.paidInWindow).toBe(0);
      expect(result.perDay).toBe(0);
      expect(result.projectedClearDay).toBeNull();
      expect(result.total).toBe(50);
    });

    it('never returns Infinity for perDay or the projection', () => {
      const result = progress(debts({ fajr: 1_000_000 }), []);
      expect(Number.isFinite(result.perDay)).toBe(true);
      expect(result.projectedClearDay).toBeNull();
    });

    it('reports no projection when the debt is already clear, even with recent ticks', () => {
      const result = progress(emptyDebts(), ticksOverDays(TODAY, 10));
      expect(result.total).toBe(0);
      expect(result.paidInWindow).toBe(10);
      expect(result.perDay).toBeCloseTo(10 / 30, 12);
      expect(result.projectedClearDay).toBeNull();
    });
  });

  describe('steady pace', () => {
    it('projects one day per owed prayer at one per day', () => {
      const result = progress(debts({ fajr: 100 }), ticksOverDays(TODAY, 30));
      expect(result.paidInWindow).toBe(30);
      expect(result.perDay).toBe(1);
      expect(result.projectedClearDay).toBe(addDays(TODAY, 100));
    });

    it('uses integer arithmetic so float drift never adds a spurious day', () => {
      // 11 owed at 11 per 30 days is exactly 30 days, but the naive
      // `ceil(total / perDay)` says 31 because 11 / 30 is not exact in binary.
      expect(Math.ceil(11 / (11 / 30))).toBe(31);
      const result = progress(debts({ fajr: 11 }), ticksOverDays(TODAY, 11));
      expect(result.paidInWindow).toBe(11);
      expect(result.projectedClearDay).toBe(addDays(TODAY, 30));
    });

    it('projects a fractional pace without accumulating error', () => {
      const result = progress(debts({ fajr: 100 }), ticksOverDays(TODAY, 6));
      expect(result.perDay).toBeCloseTo(0.2, 12);
      expect(result.projectedClearDay).toBe(addDays(TODAY, 500));
    });

    it('rounds a partial final day up', () => {
      // 10 owed, 7 paid in 30 days → 42.86 days, so 43; 11 owed → 47.14, so 48.
      expect(progress(debts({ fajr: 10 }), ticksOverDays(TODAY, 7)).projectedClearDay).toBe(
        addDays(TODAY, 43)
      );
      expect(progress(debts({ fajr: 11 }), ticksOverDays(TODAY, 7)).projectedClearDay).toBe(
        addDays(TODAY, 48)
      );
      // 5 owed against 100 paid in 30 days → 1.5 days, so 2 — never rounded down to today.
      expect(
        progress(debts({ fajr: 5 }), [tickOn(TODAY, { delta: -100 })]).projectedClearDay
      ).toBe(addDays(TODAY, 2));
    });

    it('offers no date until a day of prayers stands on each side of the sum', () => {
      // A debt too small to need a date, however strong the pace.
      const nearlyDone = progress(debts({ fajr: MIN_PROJECTABLE_DEBT - 1 }), ticksOverDays(TODAY, 30));
      expect(nearlyDone.paidInWindow).toBe(30);
      expect(nearlyDone.projectedClearDay).toBeNull();

      // A pace too thin to extrapolate, however large the debt.
      const oneTap = progress(debts({ fajr: 500 }), ticksOverDays(TODAY, MIN_PACE_SAMPLE - 1));
      expect(oneTap.paidInWindow).toBe(MIN_PACE_SAMPLE - 1);
      expect(oneTap.perDay).toBeCloseTo(4 / 30, 12);
      expect(oneTap.projectedClearDay).toBeNull();

      // Exactly enough of both is enough.
      const justEnough = progress(
        debts({ fajr: MIN_PROJECTABLE_DEBT }),
        ticksOverDays(TODAY, MIN_PACE_SAMPLE)
      );
      expect(justEnough.projectedClearDay).toBe(addDays(TODAY, DEFAULT_PACE_WINDOW_DAYS));
    });

    it('counts ticks spread across all five prayers', () => {
      const events = PRAYERS.map((prayer, index) => tickOn(addDays(TODAY, -index), { prayer }));
      const result = progress({ fajr: 1, dhuhr: 1, asr: 1, maghrib: 1, isha: 1 }, events);
      expect(result.paidInWindow).toBe(5);
      expect(result.perDay).toBeCloseTo(5 / 30, 12);
      expect(result.projectedClearDay).toBe(addDays(TODAY, 30));
    });
  });

  describe('the pace window', () => {
    it('includes ticks logged today, right up to the last minute', () => {
      const result = progress(debts({ fajr: 5 }), [
        tickOn(TODAY, { hours: 0, minutes: 0 }),
        tickOn(TODAY, { hours: 23, minutes: 59 }),
      ]);
      expect(result.paidInWindow).toBe(2);
    });

    it('includes the first day of the window and excludes the day before it', () => {
      const firstDay = addDays(TODAY, -(DEFAULT_PACE_WINDOW_DAYS - 1));
      const dayBefore = addDays(TODAY, -DEFAULT_PACE_WINDOW_DAYS);
      const result = progress(debts({ fajr: 5 }), [
        tickOn(firstDay, { hours: 0, minutes: 0 }),
        tickOn(dayBefore, { hours: 23, minutes: 59 }),
      ]);
      expect(result.paidInWindow).toBe(1);
    });

    it('excludes ticks dated in the future', () => {
      const result = progress(debts({ fajr: 5 }), [
        tickOn(addDays(TODAY, 1), { hours: 0, minutes: 0 }),
        tickOn(addDays(TODAY, 400)),
      ]);
      expect(result.paidInWindow).toBe(0);
      expect(result.projectedClearDay).toBeNull();
    });

    it('excludes long-past ticks', () => {
      const result = progress(debts({ fajr: 5 }), ticksOverDays(addDays(TODAY, -200), 60));
      expect(result.paidInWindow).toBe(0);
    });

    it('honours a custom window length', () => {
      const events = ticksOverDays(TODAY, 30);
      const week = progress(debts({ fajr: 70 }), events, TODAY, 7);
      expect(week.paidInWindow).toBe(7);
      expect(week.perDay).toBe(1);
      expect(week.projectedClearDay).toBe(addDays(TODAY, 70));
    });

    it('supports a one-day window', () => {
      const result = progress(
        debts({ fajr: 10 }),
        [tickOn(TODAY, { delta: -5 }), tickOn(addDays(TODAY, -1), { delta: -5 })],
        TODAY,
        1
      );
      expect(result.paidInWindow).toBe(5);
      expect(result.perDay).toBe(5);
      expect(result.projectedClearDay).toBe(addDays(TODAY, 2));
    });

    it('clips the window at the start of the calendar instead of throwing', () => {
      const result = computeProgress(debts({ fajr: 2 }), [tickOn('0000-01-05')], {
        todayDay: '0000-01-10',
        paceWindowDays: 1000,
      });
      expect(result.paidInWindow).toBe(1);
      expect(result.perDay).toBeCloseTo(1 / 1000, 12);
    });

    it('defaults to a 30-day window', () => {
      const events = ticksOverDays(TODAY, 45);
      expect(progress(debts({ fajr: 5 }), events).paidInWindow).toBe(DEFAULT_PACE_WINDOW_DAYS);
      expect(
        progress(debts({ fajr: 5 }), events, TODAY, DEFAULT_PACE_WINDOW_DAYS).paidInWindow
      ).toBe(DEFAULT_PACE_WINDOW_DAYS);
    });
  });

  describe('which events count', () => {
    it('ignores every event type except tick', () => {
      const events: QadaEvent[] = [
        { type: 'add', prayer: 'fajr', delta: 1, at: at(TODAY).getTime() },
        { type: 'estimateSet', prayer: null, delta: 500, at: at(TODAY).getTime() },
        { type: 'manualSet', prayer: 'asr', delta: -20, at: at(TODAY).getTime() },
        { type: 'forgive', prayer: null, delta: -900, at: at(TODAY).getTime() },
        { type: 'forgiveUndo', prayer: null, delta: 900, at: at(TODAY).getTime() },
      ];
      const result = progress(debts({ fajr: 10 }), events);
      expect(result.paidInWindow).toBe(0);
      expect(result.projectedClearDay).toBeNull();
    });

    it('does not treat forgiveness as progress', () => {
      const forgiveEvent: QadaEvent = {
        type: 'forgive',
        prayer: null,
        delta: -5000,
        at: at(TODAY).getTime(),
      };
      expect(progress(debts({ fajr: 10 }), [forgiveEvent]).paidInWindow).toBe(0);
    });

    it('counts the magnitude of a multi-prayer tick', () => {
      const result = progress(debts({ fajr: 10 }), [tickOn(TODAY, { delta: -4 })]);
      expect(result.paidInWindow).toBe(4);
    });

    it('contributes nothing for a tick with a zero or positive delta', () => {
      const result = progress(debts({ fajr: 10 }), [
        tickOn(TODAY, { delta: 0 }),
        tickOn(TODAY, { delta: 3 }),
      ]);
      expect(result.paidInWindow).toBe(0);
    });

    it('survives corrupt event rows', () => {
      const events = [
        tickOn(TODAY),
        { type: 'tick', prayer: 'fajr', delta: -1, at: Number.NaN } as QadaEvent,
        { type: 'tick', prayer: 'fajr', at: at(TODAY).getTime() } as unknown as QadaEvent,
        null as unknown as QadaEvent,
      ];
      expect(progress(debts({ fajr: 10 }), events).paidInWindow).toBe(1);
    });

    it('accepts an empty event list', () => {
      expect(progress(debts({ fajr: 3 }), []).paidInWindow).toBe(0);
    });

    it('does not depend on event order', () => {
      const events = ticksOverDays(TODAY, 12);
      const forward = progress(debts({ fajr: 40 }), events);
      const reversed = progress(debts({ fajr: 40 }), [...events].reverse());
      expect(reversed).toEqual(forward);
    });
  });

  describe('absurd projections', () => {
    it('withholds a date past the horizon instead of naming a century', () => {
      const huge = { fajr: 1e6, dhuhr: 1e6, asr: 1e6, maghrib: 1e6, isha: 1e6 };
      const result = progress(huge, ticksOverDays(TODAY, 30));
      expect(result.total).toBe(5e6);
      // The pace itself is still reported: the screen can say what was made up recently
      // even when it must not say when the debt ends.
      expect(result.paidInWindow).toBe(30);
      expect(result.perDay).toBe(1);
      expect(result.projectedClearDay).toBeNull();
    });

    it('projects right up to the horizon and not one day past it', () => {
      // At one a day, days needed === prayers owed.
      const inside = progress(debts({ fajr: MAX_PROJECTION_DAYS }), ticksOverDays(TODAY, 30));
      expect(inside.projectedClearDay).toBe(addDays(TODAY, MAX_PROJECTION_DAYS));

      const outside = progress(debts({ fajr: MAX_PROJECTION_DAYS + 1 }), ticksOverDays(TODAY, 30));
      expect(outside.projectedClearDay).toBeNull();
    });

    it('never emits an out-of-calendar day near the end of the supported range', () => {
      const nearTheEnd: PrayerDay = '9999-12-01';
      const result = computeProgress(debts({ fajr: 1_000 }), ticksOverDays(nearTheEnd, 30), {
        todayDay: nearTheEnd,
      });
      expect(result.projectedClearDay).toBe('9999-12-31');
      expect(isValidDay(result.projectedClearDay as PrayerDay)).toBe(true);
    });

    it('clamps to today itself on the very last supported day', () => {
      const lastDay: PrayerDay = '9999-12-31';
      const result = computeProgress(debts({ fajr: 1_000 }), ticksOverDays(lastDay, 30), {
        todayDay: lastDay,
      });
      expect(result.projectedClearDay).toBe(lastDay);
    });

    it('always yields a parseable day when it yields one at all', () => {
      const cases: [number, number][] = [
        [5, 5],
        [5, 30],
        [10, 7],
        [3_000, 30],
      ];
      for (const [owed, paid] of cases) {
        const result = progress(debts({ fajr: owed }), ticksOverDays(TODAY, paid));
        expect(result.projectedClearDay).not.toBeNull();
        expect(isValidDay(result.projectedClearDay as PrayerDay)).toBe(true);
      }
    });

    it('never returns a day in the past or today when it returns one', () => {
      for (const [owed, paid] of [
        [5, 30],
        [10, 7],
        [400, 30],
      ] as [number, number][]) {
        const result = progress(debts({ fajr: owed }), ticksOverDays(TODAY, paid));
        expect(diffDays(TODAY, result.projectedClearDay as PrayerDay)).toBeGreaterThan(0);
      }
    });
  });

  describe('invalid input', () => {
    it('rejects a malformed todayDay', () => {
      expect(() => progress(emptyDebts(), [], '2026-02-30')).toThrow(RangeError);
      expect(() => progress(emptyDebts(), [], 'today')).toThrow(/todayDay/);
    });

    it('rejects a pace window that is not a positive integer', () => {
      for (const window of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => progress(emptyDebts(), [], TODAY, window)).toThrow(RangeError);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// forgive / undoForgive / canUndoForgive
// ---------------------------------------------------------------------------

describe('forgive', () => {
  const NOW = at('2026-08-19', 14, 30);

  it('zeroes every counter', () => {
    const { debts: cleared } = forgive({ fajr: 12, dhuhr: 7, asr: 3, maghrib: 21, isha: 5 }, NOW);
    expect(cleared).toEqual(emptyDebts());
    expect(totalDebt(cleared)).toBe(0);
  });

  it('records a forgive event with the total as a negative delta', () => {
    const { event } = forgive({ fajr: 12, dhuhr: 7, asr: 3, maghrib: 21, isha: 5 }, NOW);
    expect(event.type).toBe('forgive');
    expect(event.prayer).toBeNull();
    expect(event.delta).toBe(-48);
    expect(event.at).toBe(NOW.getTime());
  });

  it('preserves all five per-prayer numbers in the event meta', () => {
    const before: QadaDebts = { fajr: 12, dhuhr: 7, asr: 3, maghrib: 21, isha: 5 };
    const { event } = forgive(before, NOW);
    expect(event.meta).toBeDefined();
    expect(event.meta?.debts).toEqual(before);
    expect(event.meta?.total).toBe(48);
    expect(event.meta?.forgivenOn).toBe(toDayString(NOW));
  });

  it('stamps the local calendar day, not a UTC-shifted one', () => {
    const lateNight = at('2026-08-19', 23, 45);
    const { event } = forgive(debts({ fajr: 1 }), lateNight);
    expect(event.meta?.forgivenOn).toBe('2026-08-19');
  });

  it('does not mutate the input and snapshots by value', () => {
    const before = debts({ fajr: 4, isha: 2 });
    const { event } = forgive(before, NOW);
    expect(before).toEqual({ fajr: 4, dhuhr: 0, asr: 0, maghrib: 0, isha: 2 });
    before.fajr = 999;
    expect((event.meta?.debts as QadaDebts).fajr).toBe(4);
  });

  it('sanitises corrupt counters into the archive', () => {
    const corrupt = { fajr: -3, dhuhr: 2.8, asr: Number.NaN } as QadaDebts;
    const { event } = forgive(corrupt, NOW);
    expect(event.meta?.debts).toEqual({ fajr: 0, dhuhr: 2, asr: 0, maghrib: 0, isha: 0 });
    expect(event.delta).toBe(-2);
  });

  it('works on an already-empty debt', () => {
    const { debts: cleared, event } = forgive(emptyDebts(), NOW);
    expect(cleared).toEqual(emptyDebts());
    expect(event.delta).toBe(-0);
    expect(event.meta?.total).toBe(0);
  });

  it('rejects an invalid instant', () => {
    expect(() => forgive(emptyDebts(), new Date('nope'))).toThrow(RangeError);
    expect(() => forgive(emptyDebts(), undefined as unknown as Date)).toThrow(RangeError);
    expect(() => forgive(emptyDebts(), 0 as unknown as Date)).toThrow(/now/);
  });
});

describe('undoForgive', () => {
  const NOW = at('2026-08-19', 9, 0);

  it('round-trips a forgiveness exactly', () => {
    const before: QadaDebts = { fajr: 12, dhuhr: 7, asr: 3, maghrib: 21, isha: 5 };
    const { event } = forgive(before, NOW);
    const restored = undoForgive(event);
    expect(restored).toEqual(before);
    expect(totalDebt(restored)).toBe(totalDebt(before));
  });

  it('restores every prayer independently, including zeroes', () => {
    const before: QadaDebts = { fajr: 0, dhuhr: 1, asr: 0, maghrib: 99, isha: 4 };
    const restored = undoForgive(forgive(before, NOW).event);
    for (const prayer of PRAYERS) {
      expect(restored[prayer]).toBe(before[prayer]);
    }
  });

  it('returns a copy that does not alias the event meta', () => {
    const { event } = forgive(debts({ fajr: 3 }), NOW);
    const restored = undoForgive(event);
    restored.fajr = 0;
    expect((event.meta?.debts as QadaDebts).fajr).toBe(3);
  });

  it('sanitises a hand-written or corrupted snapshot', () => {
    const event: QadaEvent = {
      type: 'forgive',
      prayer: null,
      delta: -5,
      at: NOW.getTime(),
      meta: { debts: { fajr: -2, dhuhr: '4', asr: 3.9 } },
    };
    expect(undoForgive(event)).toEqual({ fajr: 0, dhuhr: 0, asr: 3, maghrib: 0, isha: 0 });
  });

  it('refuses a non-forgive event with a clear message', () => {
    const tick = tickOn(TODAY);
    expect(() => undoForgive(tick)).toThrow(TypeError);
    expect(() => undoForgive(tick)).toThrow(/"forgive"/);
    expect(() => undoForgive(tick)).toThrow(/"tick"/);
  });

  it('refuses every other event type', () => {
    for (const type of ['tick', 'add', 'estimateSet', 'manualSet', 'forgiveUndo'] as const) {
      const event: QadaEvent = { type, prayer: null, delta: 0, at: NOW.getTime(), meta: {} };
      expect(() => undoForgive(event)).toThrow(TypeError);
    }
  });

  it('refuses a forgive event that has lost its snapshot', () => {
    const base: QadaEvent = { type: 'forgive', prayer: null, delta: -5, at: NOW.getTime() };
    expect(() => undoForgive(base)).toThrow(/snapshot/);
    expect(() => undoForgive({ ...base, meta: {} })).toThrow(TypeError);
    expect(() => undoForgive({ ...base, meta: { debts: null } })).toThrow(TypeError);
    expect(() => undoForgive({ ...base, meta: { debts: 42 } })).toThrow(TypeError);
  });

  it('refuses a non-event', () => {
    expect(() => undoForgive(null as unknown as QadaEvent)).toThrow(TypeError);
    expect(() => undoForgive('forgive' as unknown as QadaEvent)).toThrow(TypeError);
  });
});

describe('canUndoForgive', () => {
  const FORGIVEN_ON: PrayerDay = '2026-08-19';
  const event = forgive(
    { fajr: 3, dhuhr: 1, asr: 0, maghrib: 2, isha: 4 },
    at(FORGIVEN_ON, 10, 0)
  ).event;

  it('is available immediately', () => {
    expect(canUndoForgive(event, at(FORGIVEN_ON, 10, 1))).toBe(true);
  });

  it('is available later the same day', () => {
    expect(canUndoForgive(event, at(FORGIVEN_ON, 23, 59))).toBe(true);
  });

  it('is available on each of the following 30 days', () => {
    for (let day = 1; day <= FORGIVE_UNDO_WINDOW_DAYS; day += 1) {
      const now = at(addDays(FORGIVEN_ON, day), 8, 0);
      expect(canUndoForgive(event, now)).toBe(true);
    }
  });

  it('is still available at the very end of day 30', () => {
    expect(canUndoForgive(event, at(addDays(FORGIVEN_ON, 30), 23, 59))).toBe(true);
  });

  it('is refused from day 31 onwards', () => {
    expect(canUndoForgive(event, at(addDays(FORGIVEN_ON, 31), 0, 0))).toBe(false);
    expect(canUndoForgive(event, at(addDays(FORGIVEN_ON, 31), 23, 59))).toBe(false);
    expect(canUndoForgive(event, at(addDays(FORGIVEN_ON, 60)))).toBe(false);
    expect(canUndoForgive(event, at(addDays(FORGIVEN_ON, 3650)))).toBe(false);
  });

  it('counts whole calendar days, not 30 × 24 hours', () => {
    // Forgiven a minute before midnight; 30 calendar days later is ~30 days + 24h in ms terms.
    const lateEvent = forgive(debts({ fajr: 1 }), at(FORGIVEN_ON, 23, 59)).event;
    expect(canUndoForgive(lateEvent, at(addDays(FORGIVEN_ON, 30), 0, 1))).toBe(true);
    expect(canUndoForgive(lateEvent, at(addDays(FORGIVEN_ON, 31), 0, 1))).toBe(false);
  });

  it('tolerates a clock that has gone backwards', () => {
    expect(canUndoForgive(event, at(addDays(FORGIVEN_ON, -5)))).toBe(true);
    expect(canUndoForgive(event, at(addDays(FORGIVEN_ON, -400)))).toBe(true);
  });

  it('is false for any non-forgive event, without throwing', () => {
    expect(canUndoForgive(tickOn(TODAY), at(TODAY))).toBe(false);
    expect(
      canUndoForgive(
        { type: 'forgiveUndo', prayer: null, delta: 5, at: at(TODAY).getTime(), meta: {} },
        at(TODAY)
      )
    ).toBe(false);
  });

  it('is false when the snapshot is missing or the timestamp is corrupt', () => {
    expect(
      canUndoForgive(
        { type: 'forgive', prayer: null, delta: -5, at: at(TODAY).getTime() },
        at(TODAY)
      )
    ).toBe(false);
    expect(canUndoForgive({ ...event, at: Number.NaN }, at(TODAY))).toBe(false);
    expect(canUndoForgive(null as unknown as QadaEvent, at(TODAY))).toBe(false);
  });

  it('is false — not a crash — for a finite but unrepresentable stored timestamp', () => {
    // Regression: `at` is persisted data, not an argument. A finite-but-unusable value used to
    // reach `toDayString`/`diffDays` and throw a RangeError, taking the qada screen down at the
    // exact moment the user reached for the undo. Each of these is a realistic corruption:
    //   1.7e15  — a microsecond timestamp (year 55840): a real `Date`, but off the 0000…9999
    //             calendar `dates.ts` supports, so `diffDays` rejected the day string.
    //  -8e15    — the same, on the negative side (year −251540).
    //   8.64e15+1 and 1e300 — finite, but past `Date`'s representable range entirely.
    for (const corruptAt of [1.7e15, -8e15, 8.64e15 + 1, 1e300]) {
      const corrupt: QadaEvent = { ...event, at: corruptAt };
      expect(() => canUndoForgive(corrupt, at(TODAY))).not.toThrow();
      expect(canUndoForgive(corrupt, at(TODAY))).toBe(false);
    }
  });

  it('is a safe precondition for undoForgive', () => {
    const candidates: QadaEvent[] = [
      event,
      { ...event, meta: undefined },
      { ...event, meta: {} },
      tickOn(TODAY),
      { type: 'forgive', prayer: null, delta: 0, at: Number.NaN, meta: { debts: emptyDebts() } },
      { ...event, at: 1.7e15 },
      { ...event, at: 1e300 },
    ];
    for (const candidate of candidates) {
      const now = at(addDays(FORGIVEN_ON, 3));
      if (canUndoForgive(candidate, now)) {
        expect(() => undoForgive(candidate)).not.toThrow();
      }
    }
  });

  it('rejects an invalid instant', () => {
    expect(() => canUndoForgive(event, new Date('nope'))).toThrow(RangeError);
    expect(() => canUndoForgive(event, undefined as unknown as Date)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// End-to-end journeys
// ---------------------------------------------------------------------------

describe('journeys', () => {
  it('estimate → miss → tick → progress → forgive → undo keeps every number sane', () => {
    const now = at('2026-08-19', 18, 0);

    // Backtrack a year with the exemption deduction.
    let current = estimateDebt({
      startDay: '2025-01-01',
      endDay: '2025-12-31',
      deductExemptions: true,
      exemptDaysPerMonth: 7,
    });
    expect(current.fajr).toBe(281);

    // A newly missed Fajr, then ten made up.
    current = applyMiss(current, 'fajr');
    expect(current.fajr).toBe(282);
    for (let i = 0; i < 10; i += 1) {
      current = applyTick(current, 'fajr');
    }
    expect(current.fajr).toBe(272);

    const events = ticksOverDays(TODAY, 30);
    const before = computeProgress(current, events, { todayDay: TODAY });
    expect(before.total).toBe(272 + 281 * 4);
    expect(before.paidInWindow).toBe(30);
    expect(before.projectedClearDay).not.toBeNull();
    expect(isValidDay(before.projectedClearDay as PrayerDay)).toBe(true);

    // Start fresh.
    const forgiven = forgive(current, now);
    expect(totalDebt(forgiven.debts)).toBe(0);
    const cleared = computeProgress(forgiven.debts, events, { todayDay: TODAY });
    expect(cleared.total).toBe(0);
    expect(cleared.projectedClearDay).toBeNull();

    // Second thoughts, three days later.
    expect(canUndoForgive(forgiven.event, at(addDays(TODAY, 3)))).toBe(true);
    expect(undoForgive(forgiven.event)).toEqual(current);
  });

  it('a fresh slate stays at zero no matter how much the user taps', () => {
    let current = emptyDebts();
    for (const prayer of PRAYERS) {
      current = applyTick(current, prayer);
      current = applyUndoMiss(current, prayer);
    }
    expect(current).toEqual(emptyDebts());
    const result = computeProgress(current, [], { todayDay: TODAY });
    expect(result.total).toBe(0);
    expect(result.perDay).toBe(0);
    expect(result.projectedClearDay).toBeNull();
  });

  it('forgiveness followed by an old missed-log edit does not resurrect debt', () => {
    const { debts: cleared } = forgive(debts({ fajr: 5 }), at(TODAY, 12));
    expect(applyUndoMiss(cleared, 'fajr')).toEqual(emptyDebts());
  });
});

// ---------------------------------------------------------------------------
// Reported from the running app (Aug 2026) — the two numbers a user actually saw
// ---------------------------------------------------------------------------

describe('what the owner saw', () => {
  /**
   * "for 4 days it counted 372 missed prayers".
   *
   * The estimate itself is sound: four days owe four of each prayer, twenty in all. 372 is a
   * *range* number, not a prayers number — it is the inclusive day count of a range a year and
   * a few days long, which is what the wizard used to hand this function when a picked date
   * kept the year of its own one-year-back default. Both facts are pinned here so neither the
   * arithmetic nor the diagnosis can quietly drift.
   */
  it('charges four days as twenty prayers, not as a year of them', () => {
    const result = estimateDebt({
      startDay: '2026-08-16',
      endDay: '2026-08-19',
      deductExemptions: false,
      exemptDaysPerMonth: 7,
    });
    expect(estimateRangeDays('2026-08-16', '2026-08-19')).toBe(4);
    expect(result).toEqual({ fajr: 4, dhuhr: 4, asr: 4, maghrib: 4, isha: 4 });
    expect(totalDebt(result)).toBe(20);
  });

  it('shows where 372 comes from: a range a year long, in days', () => {
    // The wizard's old default reached back a year, and the picker opened there, so a day
    // tapped in the visible month kept the *old* year.
    expect(estimateRangeDays('2025-08-14', '2026-08-20')).toBe(372);
    expect(estimateRangeDays('2026-08-16', '2026-08-20')).toBe(5);
  });

  /**
   * "I set start from today, and have only fajr to make up, and it says 'At this pace, you're
   * clear around September 19, 2026', today is August 20."
   *
   * One tick inside a thirty-day window is a pace of one prayer per thirty days, so one
   * outstanding prayer projected exactly thirty days out. Arithmetically true, and useless:
   * the user could clear it in the next five minutes.
   */
  it('says nothing about a clear date when one prayer is owed and one was made up', () => {
    const day: PrayerDay = '2026-08-20';
    const result = computeProgress(debts({ fajr: 1 }), [tickOn(day)], { todayDay: day });

    expect(result.total).toBe(1);
    expect(result.paidInWindow).toBe(1);
    // The number the old maths produced, kept as a landmark: it must never be said again.
    expect(addDays(day, DEFAULT_PACE_WINDOW_DAYS)).toBe('2026-09-19');
    expect(result.projectedClearDay).toBeNull();
  });

  it('still projects once the pace rests on real ground', () => {
    const day: PrayerDay = '2026-08-20';
    const result = computeProgress(debts({ fajr: 30 }), ticksOverDays(day, 30), { todayDay: day });
    expect(result.paidInWindow).toBe(30);
    expect(result.projectedClearDay).toBe(addDays(day, 30));
  });
});
