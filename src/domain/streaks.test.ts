/// <reference types="node" />
/**
 * Tests for the soft/hard streak engines.
 *
 * ## Determinism & timezone robustness
 *
 * `streaks.ts` never reads the clock and never constructs a calendar instant — "today" is
 * always passed in as a `YYYY-MM-DD` prayer day. Every test below is therefore identical on
 * this machine (Europe/Istanbul, UTC+3) and in CI (UTC): no instant is ever built, no local
 * time is ever formatted, and no test asserts on anything derived from the ambient timezone.
 * `describe('purity')` locks that property in structurally, so it cannot regress.
 *
 * Days that fall on European DST transitions and on a leap day are still exercised, because
 * the day arithmetic is delegated to `dates.ts` and a regression there must surface here too.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { addDays } from './dates';
import {
  STREAK_MILESTONES,
  classifyDay,
  computeStreak,
  dayCounts,
  streakMilestone,
  unloggedDayRecord,
  type ComputeStreakOptions,
  type DayVerdict,
} from './streaks';
import {
  PRAYERS,
  type DayRecord,
  type Prayer,
  type PrayerDay,
  type PrayerStatus,
  type StreakMode,
} from './types';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Either one status applied to all five prayers, or a per-prayer override map. */
type StatusSpec = PrayerStatus | Partial<Record<Prayer, PrayerStatus>>;

function rec(day: PrayerDay, spec: StatusSpec = 'unlogged', isExempt = false): DayRecord {
  const record = unloggedDayRecord(day);
  if (typeof spec === 'string') {
    for (const prayer of PRAYERS) record.statuses[prayer] = spec;
  } else {
    for (const prayer of PRAYERS) {
      const status = spec[prayer];
      if (status !== undefined) record.statuses[prayer] = status;
    }
  }
  record.isExempt = isExempt;
  return record;
}

/** All five prayed — counts in both modes. */
const full = (day: PrayerDay): DayRecord => rec(day, 'prayed');
/** All five late — still counts in both modes (late is a fulfilled prayer). */
const allLate = (day: PrayerDay): DayRecord => rec(day, 'late');
/** Only Fajr prayed — counts in soft, breaks in hard. */
const onlyFajr = (day: PrayerDay): DayRecord => rec(day, { fajr: 'prayed' });
/** Four prayed, Isha missed — counts in soft, breaks in hard. */
const oneMissed = (day: PrayerDay): DayRecord => rec(day, { ...allButIsha('prayed'), isha: 'missed' });
/** Four prayed, Isha never logged — counts in soft, breaks in hard. */
const oneUnlogged = (day: PrayerDay): DayRecord => rec(day, allButIsha('prayed'));
/** A day the user marked exempt: the flag plus the five neutral statuses. */
const exemptDay = (day: PrayerDay): DayRecord => rec(day, 'exempt', true);
/** Nothing logged at all — breaks in both modes. */
const blank = (day: PrayerDay): DayRecord => rec(day, 'unlogged');

function allButIsha(status: PrayerStatus): Partial<Record<Prayer, PrayerStatus>> {
  return { fajr: status, dhuhr: status, asr: status, maghrib: status };
}

/** Build consecutive days from `startDay`. `'GAP'` advances the day without emitting a record. */
type SeqStep = DayRecord | 'GAP' | ((day: PrayerDay) => DayRecord);

function seq(startDay: PrayerDay, steps: SeqStep[]): DayRecord[] {
  const out: DayRecord[] = [];
  steps.forEach((step, index) => {
    const day = addDays(startDay, index);
    if (step === 'GAP') return;
    out.push(typeof step === 'function' ? step(day) : step);
  });
  return out;
}

/** `n` consecutive days built by `make`, starting at `startDay`. */
function runOf(startDay: PrayerDay, n: number, make: (day: PrayerDay) => DayRecord): DayRecord[] {
  return Array.from({ length: n }, (_, i) => make(addDays(startDay, i)));
}

const summary = (records: DayRecord[], opts: ComputeStreakOptions) => computeStreak(records, opts);

const MODES: StreakMode[] = ['soft', 'hard'];

// ---------------------------------------------------------------------------
// classifyDay / dayCounts
// ---------------------------------------------------------------------------

describe('classifyDay / dayCounts — soft mode (≥1 prayed or late)', () => {
  const D = '2026-07-02';

  it('counts a day with all five prayed', () => {
    expect(classifyDay(full(D), 'soft')).toBe<DayVerdict>('counts');
    expect(dayCounts(full(D), 'soft')).toBe(true);
  });

  it('counts a day with all five late', () => {
    expect(dayCounts(allLate(D), 'soft')).toBe(true);
  });

  it.each(PRAYERS)('counts a day with only %s prayed', (prayer) => {
    expect(dayCounts(rec(D, { [prayer]: 'prayed' }), 'soft')).toBe(true);
  });

  it.each(PRAYERS)('counts a day with only %s late', (prayer) => {
    expect(dayCounts(rec(D, { [prayer]: 'late' }), 'soft')).toBe(true);
  });

  it('counts a day that mixes one prayed with four missed', () => {
    expect(dayCounts(rec(D, { ...allButIsha('missed'), isha: 'prayed' }), 'soft')).toBe(true);
  });

  it('breaks on a day with nothing logged', () => {
    expect(classifyDay(blank(D), 'soft')).toBe<DayVerdict>('breaks');
    expect(dayCounts(blank(D), 'soft')).toBe(false);
  });

  it('breaks on a day where all five are missed', () => {
    expect(classifyDay(rec(D, 'missed'), 'soft')).toBe<DayVerdict>('breaks');
  });

  it('breaks on a day mixing missed and unlogged only', () => {
    expect(classifyDay(rec(D, { fajr: 'missed', dhuhr: 'missed' }), 'soft')).toBe<DayVerdict>('breaks');
  });
});

describe('classifyDay / dayCounts — hard mode (all five)', () => {
  const D = '2026-07-02';

  it('counts a day with all five prayed', () => {
    expect(classifyDay(full(D), 'hard')).toBe<DayVerdict>('counts');
  });

  it('counts a day with all five late', () => {
    expect(dayCounts(allLate(D), 'hard')).toBe(true);
  });

  it('counts a day mixing prayed and late', () => {
    const record = rec(D, { fajr: 'late', dhuhr: 'prayed', asr: 'prayed', maghrib: 'late', isha: 'prayed' });
    expect(dayCounts(record, 'hard')).toBe(true);
  });

  it.each(PRAYERS)('breaks when %s is missed', (prayer) => {
    expect(classifyDay(rec(D, { ...fillAll('prayed'), [prayer]: 'missed' }), 'hard')).toBe<DayVerdict>(
      'breaks'
    );
  });

  it.each(PRAYERS)('breaks when %s is left unlogged', (prayer) => {
    expect(classifyDay(rec(D, { ...fillAll('prayed'), [prayer]: 'unlogged' }), 'hard')).toBe<DayVerdict>(
      'breaks'
    );
  });

  it('breaks on an empty day', () => {
    expect(dayCounts(blank(D), 'hard')).toBe(false);
  });
});

function fillAll(status: PrayerStatus): Record<Prayer, PrayerStatus> {
  return { fajr: status, dhuhr: status, asr: status, maghrib: status, isha: status };
}

describe('classifyDay — exempt days bridge', () => {
  const D = '2026-07-02';

  it.each(MODES)('bridges an exempt day in %s mode', (mode) => {
    expect(classifyDay(exemptDay(D), mode)).toBe<DayVerdict>('bridges');
  });

  it.each(MODES)('never counts an exempt day in %s mode (bridge, not count)', (mode) => {
    expect(dayCounts(exemptDay(D), mode)).toBe(false);
  });

  it.each(MODES)('counts an excused day she actually prayed on, in %s mode', (mode) => {
    // REVERSED deliberately. This used to assert 'bridges' — the flag winning over logged
    // prayers — and that was wrong for the reason the feature exists. Menstruation starts at a
    // moment, not at midnight: a woman who prayed Fajr and Dhuhr before it began genuinely
    // prayed that day, the seal keeps her gold mark, and bridging made her streak SHRINK (2 → 1)
    // the instant she marked herself excused. Marking yourself excused must only ever gain days.
    expect(classifyDay(rec(D, 'prayed', true), mode)).toBe<DayVerdict>('counts');
  });

  it.each(MODES)('still bridges an excused day with nothing prayed, in %s mode', (mode) => {
    // The other half of the rule, and the common case: excused and did not pray. It must never
    // break the streak, and must not inflate it either.
    expect(classifyDay(rec(D, 'unlogged', true), mode)).toBe<DayVerdict>('bridges');
  });

  it.each(MODES)('lets the isExempt flag win over missed prayers in %s mode', (mode) => {
    expect(classifyDay(rec(D, 'missed', true), mode)).toBe<DayVerdict>('bridges');
  });

  it.each(MODES)('bridges five exempt statuses even without the flag in %s mode', (mode) => {
    expect(classifyDay(rec(D, 'exempt', false), mode)).toBe<DayVerdict>('bridges');
  });

  it('excludes partly-exempt prayers from the hard-mode requirement', () => {
    const record = rec(D, { fajr: 'exempt', dhuhr: 'exempt', asr: 'exempt', maghrib: 'exempt', isha: 'prayed' });
    expect(classifyDay(record, 'hard')).toBe<DayVerdict>('counts');
    expect(classifyDay(record, 'soft')).toBe<DayVerdict>('counts');
  });

  it('still breaks a partly-exempt day whose remaining prayer is unlogged', () => {
    const record = rec(D, { fajr: 'exempt', dhuhr: 'exempt', asr: 'exempt', maghrib: 'exempt' });
    expect(classifyDay(record, 'hard')).toBe<DayVerdict>('breaks');
    expect(classifyDay(record, 'soft')).toBe<DayVerdict>('breaks');
  });

  it('still breaks a partly-exempt day whose remaining prayer is missed', () => {
    const record = rec(D, { fajr: 'exempt', dhuhr: 'exempt', asr: 'exempt', maghrib: 'exempt', isha: 'missed' });
    expect(classifyDay(record, 'hard')).toBe<DayVerdict>('breaks');
  });

  it('counts a half-exempt day in hard mode when every non-exempt prayer is fulfilled', () => {
    const record = rec(D, { fajr: 'exempt', dhuhr: 'exempt', asr: 'late', maghrib: 'prayed', isha: 'prayed' });
    expect(classifyDay(record, 'hard')).toBe<DayVerdict>('counts');
  });
});

describe('classifyDay — defensive input', () => {
  const D = '2026-07-02';

  it('treats a missing status entry as unlogged', () => {
    const record: DayRecord = { ...full(D), statuses: { fajr: 'prayed' } as Record<Prayer, PrayerStatus> };
    expect(classifyDay(record, 'soft')).toBe<DayVerdict>('counts');
    expect(classifyDay(record, 'hard')).toBe<DayVerdict>('breaks');
  });

  it('throws RangeError on an unknown status', () => {
    const record = rec(D, { ...fillAll('prayed'), fajr: 'napped' as PrayerStatus });
    expect(() => classifyDay(record, 'hard')).toThrow(RangeError);
  });

  it('throws RangeError on an unknown mode', () => {
    expect(() => classifyDay(full(D), 'medium' as StreakMode)).toThrow(RangeError);
  });
});

describe('unloggedDayRecord', () => {
  it('is the neutral all-unlogged record and breaks in both modes', () => {
    const record = unloggedDayRecord('2026-07-02');
    expect(record).toEqual({
      day: '2026-07-02',
      statuses: { fajr: 'unlogged', dhuhr: 'unlogged', asr: 'unlogged', maghrib: 'unlogged', isha: 'unlogged' },
      madeUp: {},
      isExempt: false,
    });
    expect(dayCounts(record, 'soft')).toBe(false);
    expect(dayCounts(record, 'hard')).toBe(false);
  });

  it('returns a fresh object each call', () => {
    const a = unloggedDayRecord('2026-07-02');
    const b = unloggedDayRecord('2026-07-02');
    a.statuses.fajr = 'prayed';
    expect(b.statuses.fajr).toBe('unlogged');
  });
});

// ---------------------------------------------------------------------------
// computeStreak — foundations
// ---------------------------------------------------------------------------

describe('computeStreak — empty and trivial input', () => {
  it.each(MODES)('returns a zeroed summary for no records at all (%s)', (mode) => {
    expect(summary([], { mode, todayDay: '2026-07-02' })).toEqual({
      mode,
      current: 0,
      best: 0,
      currentStartedOn: null,
      bestStartedOn: null,
    });
  });

  it('returns a zeroed summary when every record lies in the future', () => {
    const records = runOf('2026-07-10', 5, full);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-02' })).toEqual({
      mode: 'hard',
      current: 0,
      best: 0,
      currentStartedOn: null,
      bestStartedOn: null,
    });
  });

  it('returns zeros when includeToday is false and the only record is today', () => {
    expect(summary([full('2026-07-02')], { mode: 'hard', todayDay: '2026-07-02', includeToday: false })).toEqual(
      { mode: 'hard', current: 0, best: 0, currentStartedOn: null, bestStartedOn: null }
    );
  });

  it('counts a single complete day that is today', () => {
    expect(summary([full('2026-07-02')], { mode: 'hard', todayDay: '2026-07-02' })).toEqual({
      mode: 'hard',
      current: 1,
      best: 1,
      currentStartedOn: '2026-07-02',
      bestStartedOn: '2026-07-02',
    });
  });

  it('counts a single complete day that closed yesterday', () => {
    expect(summary([full('2026-07-01')], { mode: 'hard', todayDay: '2026-07-02' })).toEqual({
      mode: 'hard',
      current: 1,
      best: 1,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2026-07-01',
    });
  });

  it('echoes the requested mode in the summary', () => {
    expect(summary([], { mode: 'soft', todayDay: '2026-07-02' }).mode).toBe('soft');
    expect(summary([], { mode: 'hard', todayDay: '2026-07-02' }).mode).toBe('hard');
  });
});

describe('computeStreak — unbroken runs', () => {
  it('counts an unbroken soft run of 12 days ending yesterday', () => {
    const records = runOf('2026-06-20', 12, onlyFajr); // one prayer/day: soft only
    expect(summary(records, { mode: 'soft', todayDay: '2026-07-02' })).toEqual({
      mode: 'soft',
      current: 12,
      best: 12,
      currentStartedOn: '2026-06-20',
      bestStartedOn: '2026-06-20',
    });
  });

  it('gives that same soft run a hard streak of zero', () => {
    const records = runOf('2026-06-20', 12, onlyFajr);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-02' })).toMatchObject({
      current: 0,
      best: 0,
      currentStartedOn: null,
      bestStartedOn: null,
    });
  });

  it('counts an unbroken hard run of 12 complete days', () => {
    const records = runOf('2026-06-20', 12, full);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-02' })).toEqual({
      mode: 'hard',
      current: 12,
      best: 12,
      currentStartedOn: '2026-06-20',
      bestStartedOn: '2026-06-20',
    });
  });

  it('counts a run of all-late days in hard mode (late is fulfilled)', () => {
    const records = runOf('2026-06-28', 4, allLate);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-02' })).toMatchObject({ current: 4, best: 4 });
  });

  it('crosses a month boundary', () => {
    const records = runOf('2026-06-28', 7, full); // 28 Jun … 4 Jul
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-04' })).toMatchObject({
      current: 7,
      currentStartedOn: '2026-06-28',
    });
  });

  it('crosses a year boundary', () => {
    const records = runOf('2026-12-28', 10, full); // 28 Dec … 6 Jan
    expect(summary(records, { mode: 'hard', todayDay: '2027-01-06' })).toMatchObject({
      current: 10,
      currentStartedOn: '2026-12-28',
    });
  });

  it('crosses a leap day', () => {
    const records = runOf('2028-02-27', 5, full); // 27, 28, 29 Feb, 1, 2 Mar
    expect(summary(records, { mode: 'hard', todayDay: '2028-03-02' })).toMatchObject({
      current: 5,
      currentStartedOn: '2028-02-27',
    });
  });

  it('crosses a European DST spring-forward weekend (23-hour day)', () => {
    const records = runOf('2026-03-27', 5, full); // 2026-03-29 is the EU spring transition
    expect(summary(records, { mode: 'hard', todayDay: '2026-03-31' })).toMatchObject({
      current: 5,
      currentStartedOn: '2026-03-27',
    });
  });

  it('crosses a European DST fall-back weekend (25-hour day)', () => {
    const records = runOf('2026-10-23', 5, full); // 2026-10-25 is the EU autumn transition
    expect(summary(records, { mode: 'hard', todayDay: '2026-10-27' })).toMatchObject({
      current: 5,
      currentStartedOn: '2026-10-23',
    });
  });
});

// ---------------------------------------------------------------------------
// computeStreak — breaking
// ---------------------------------------------------------------------------

describe('computeStreak — breaks', () => {
  it('breaks on a gap day with no record at all (sparse input)', () => {
    // 1,2,3 complete · 4 missing entirely · 5,6 complete · today = 7 (open)
    const records = seq('2026-07-01', [full, full, full, 'GAP', full, full]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-07' })).toEqual({
      mode: 'hard',
      current: 2,
      best: 3,
      currentStartedOn: '2026-07-05',
      bestStartedOn: '2026-07-01',
    });
  });

  it('breaks on an explicitly blank record exactly like on a missing one', () => {
    const withBlank = seq('2026-07-01', [full, full, full, blank, full, full]);
    const withGap = seq('2026-07-01', [full, full, full, 'GAP', full, full]);
    const opts: ComputeStreakOptions = { mode: 'hard', todayDay: '2026-07-07' };
    expect(summary(withBlank, opts)).toEqual(summary(withGap, opts));
  });

  it('breaks a soft streak on a day where everything was missed', () => {
    const records = seq('2026-07-01', [onlyFajr, onlyFajr, (d) => rec(d, 'missed'), onlyFajr]);
    expect(summary(records, { mode: 'soft', todayDay: '2026-07-05' })).toMatchObject({
      current: 1,
      best: 2,
      currentStartedOn: '2026-07-04',
      bestStartedOn: '2026-07-01',
    });
  });

  it('breaks the streak when the range starts with a broken day', () => {
    const records = seq('2026-07-01', [blank, full, full]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-04' })).toMatchObject({
      current: 2,
      best: 2,
      currentStartedOn: '2026-07-02',
      bestStartedOn: '2026-07-02',
    });
  });

  it('breaks when the last closed day is broken, even with a long history', () => {
    const records = [...runOf('2026-06-01', 20, full), blank('2026-06-21')];
    expect(summary(records, { mode: 'hard', todayDay: '2026-06-22' })).toMatchObject({
      current: 0,
      best: 20,
      currentStartedOn: null,
      bestStartedOn: '2026-06-01',
    });
  });

  it('breaks on a long unlogged stretch between the last record and today', () => {
    const records = runOf('2026-01-01', 5, full);
    expect(summary(records, { mode: 'soft', todayDay: '2026-08-19' })).toMatchObject({
      current: 0,
      best: 5,
      bestStartedOn: '2026-01-01',
    });
  });
});

describe('computeStreak — a missed prayer breaks hard but not soft', () => {
  // 3 complete days, then a day with 4 prayed + Isha missed, then 2 complete days.
  const records = seq('2026-07-01', [full, full, full, oneMissed, full, full]);
  const todayDay = '2026-07-07';

  it('keeps the soft streak running through the missed prayer', () => {
    expect(summary(records, { mode: 'soft', todayDay })).toEqual({
      mode: 'soft',
      current: 6,
      best: 6,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2026-07-01',
    });
  });

  it('breaks the hard streak on that day', () => {
    expect(summary(records, { mode: 'hard', todayDay })).toEqual({
      mode: 'hard',
      current: 2,
      best: 3,
      currentStartedOn: '2026-07-05',
      bestStartedOn: '2026-07-01',
    });
  });

  it('behaves identically when the fifth prayer is unlogged rather than missed', () => {
    const unloggedVariant = seq('2026-07-01', [full, full, full, oneUnlogged, full, full]);
    expect(summary(unloggedVariant, { mode: 'hard', todayDay })).toEqual(summary(records, { mode: 'hard', todayDay }));
    expect(summary(unloggedVariant, { mode: 'soft', todayDay })).toEqual(summary(records, { mode: 'soft', todayDay }));
  });
});

// ---------------------------------------------------------------------------
// computeStreak — exempt bridging
// ---------------------------------------------------------------------------

describe('computeStreak — exempt days bridge', () => {
  it('bridges a single exempt day mid-run without incrementing', () => {
    const records = seq('2026-07-01', [full, full, full, exemptDay, full, full, full]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-08' })).toEqual({
      mode: 'hard',
      current: 6, // 3 + 3, the exempt day adds nothing
      best: 6,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2026-07-01',
    });
  });

  it('bridges a realistic multi-day exempt period', () => {
    const records = [
      ...runOf('2026-07-01', 10, full),
      ...runOf('2026-07-11', 6, exemptDay),
      ...runOf('2026-07-17', 4, full),
    ];
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-21' })).toMatchObject({
      current: 14,
      best: 14,
      currentStartedOn: '2026-07-01',
    });
  });

  it('bridges in soft mode too', () => {
    const records = seq('2026-07-01', [onlyFajr, exemptDay, onlyFajr]);
    expect(summary(records, { mode: 'soft', todayDay: '2026-07-04' })).toMatchObject({
      current: 2,
      currentStartedOn: '2026-07-01',
    });
  });

  it('does not resurrect a streak that was already broken before the exempt period', () => {
    const records = seq('2026-07-01', [full, blank, exemptDay, exemptDay, full]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toMatchObject({
      current: 1,
      best: 1,
      currentStartedOn: '2026-07-05',
    });
  });

  it('reports the first counting day when exempt days open the range', () => {
    const records = seq('2026-07-01', [exemptDay, exemptDay, full, full, full]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toEqual({
      mode: 'hard',
      current: 3,
      best: 3,
      currentStartedOn: '2026-07-03', // never the bridging day that precedes the run
      bestStartedOn: '2026-07-03',
    });
  });

  it('keeps the streak when exempt days close the range (yesterday exempt)', () => {
    const records = seq('2026-07-01', [full, full, full, exemptDay, exemptDay]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toMatchObject({
      current: 3,
      best: 3,
      currentStartedOn: '2026-07-01',
    });
  });

  it('keeps the streak when today itself is exempt', () => {
    const records = seq('2026-07-01', [full, full, full, exemptDay]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-04' })).toMatchObject({
      current: 3,
      currentStartedOn: '2026-07-01',
    });
  });

  it('reports zero — not a break — for a history of nothing but exempt days', () => {
    const records = runOf('2026-07-01', 6, exemptDay);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-07' })).toEqual({
      mode: 'hard',
      current: 0,
      best: 0,
      currentStartedOn: null,
      bestStartedOn: null,
    });
  });

  it('ignores a future-dated exemption', () => {
    // The user marked herself exempt through next week. Those days must contribute nothing
    // while they are still in the future, and must not repair a break once they arrive.
    const records = [...runOf('2026-07-01', 3, full), ...runOf('2026-07-05', 7, exemptDay)];

    // Today (2026-07-04) is open and unlogged → bridges; the streak stands at the three
    // closed days and the seven future exempt days add nothing to it.
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-04' })).toEqual({
      mode: 'hard',
      current: 3,
      best: 3,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2026-07-01',
    });

    // Once 2026-07-04 has closed unlogged it breaks the streak, and the exempt days that
    // follow bridge over nothing rather than restoring it.
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toMatchObject({
      current: 0,
      best: 3,
      currentStartedOn: null,
      bestStartedOn: '2026-07-01',
    });
  });
});

// ---------------------------------------------------------------------------
// computeStreak — the open day
// ---------------------------------------------------------------------------

describe('computeStreak — the still-open current day', () => {
  it('does not break the streak when today is completely unlogged', () => {
    const records = runOf('2026-07-01', 5, full); // 1..5
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toMatchObject({
      current: 5,
      currentStartedOn: '2026-07-01',
    });
  });

  it('does not break the hard streak when today is only partly logged', () => {
    const records = [...runOf('2026-07-01', 5, full), oneUnlogged('2026-07-06')];
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toMatchObject({
      current: 5,
      best: 5,
      currentStartedOn: '2026-07-01',
    });
  });

  it('does not break the streak when today already has a missed prayer', () => {
    const records = [...runOf('2026-07-01', 5, full), oneMissed('2026-07-06')];
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toMatchObject({ current: 5 });
  });

  it('does not break the soft streak when today has nothing logged yet', () => {
    const records = [...runOf('2026-07-01', 5, onlyFajr), blank('2026-07-06')];
    expect(summary(records, { mode: 'soft', todayDay: '2026-07-06' })).toMatchObject({ current: 5 });
  });

  it('extends the streak the moment today qualifies (run ending exactly at today)', () => {
    const records = runOf('2026-07-01', 6, full); // 1..6, today = 6
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toEqual({
      mode: 'hard',
      current: 6,
      best: 6,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2026-07-01',
    });
  });

  it('extends a soft streak as soon as the first prayer of today is logged', () => {
    const before = [...runOf('2026-07-01', 5, onlyFajr), blank('2026-07-06')];
    const after = runOf('2026-07-01', 6, onlyFajr);
    expect(summary(before, { mode: 'soft', todayDay: '2026-07-06' }).current).toBe(5);
    expect(summary(after, { mode: 'soft', todayDay: '2026-07-06' }).current).toBe(6);
  });

  it('never lets an incomplete today reduce the streak below its closed-day value', () => {
    const closed = runOf('2026-07-01', 5, full);
    const optimistic = summary([...closed, blank('2026-07-06')], { mode: 'hard', todayDay: '2026-07-06' });
    const closedOnly = summary(closed, { mode: 'hard', todayDay: '2026-07-06', includeToday: false });
    expect(optimistic.current).toBe(closedOnly.current);
  });

  it('excludes a completed today when includeToday is false', () => {
    const records = runOf('2026-07-01', 6, full);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06', includeToday: false })).toEqual({
      mode: 'hard',
      current: 5,
      best: 5,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2026-07-01',
    });
  });

  it('defaults includeToday to true', () => {
    const records = runOf('2026-07-01', 6, full);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-06' })).toEqual(
      summary(records, { mode: 'hard', todayDay: '2026-07-06', includeToday: true })
    );
  });

  it('does not judge a broken today even when includeToday is explicitly true', () => {
    const records = [...runOf('2026-07-01', 3, full), rec('2026-07-04', 'missed')];
    expect(summary(records, { mode: 'soft', todayDay: '2026-07-04', includeToday: true })).toMatchObject({
      current: 3,
      currentStartedOn: '2026-07-01',
    });
  });

  it('still breaks on yesterday when includeToday is false (yesterday has closed)', () => {
    const records = [...runOf('2026-07-01', 3, full), blank('2026-07-04')];
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-05', includeToday: false })).toMatchObject({
      current: 0,
      best: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// computeStreak — best vs current
// ---------------------------------------------------------------------------

describe('computeStreak — best streak', () => {
  it('reports a best that is greater than the current streak', () => {
    const records = [
      ...runOf('2026-05-01', 9, full), // 1..9 May
      // 10 May missing → break
      ...runOf('2026-05-11', 3, full), // 11..13 May
    ];
    expect(summary(records, { mode: 'hard', todayDay: '2026-05-14' })).toEqual({
      mode: 'hard',
      current: 3,
      best: 9,
      currentStartedOn: '2026-05-11',
      bestStartedOn: '2026-05-01',
    });
  });

  it('keeps the earliest start day when two runs tie for best', () => {
    const records = seq('2026-07-01', [full, full, full, 'GAP', full, full, full]);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-08' })).toMatchObject({
      current: 3,
      best: 3,
      currentStartedOn: '2026-07-05',
      bestStartedOn: '2026-07-01', // the record was set first here
    });
  });

  it('reports best === current for one unbroken run', () => {
    const records = runOf('2026-07-01', 8, full);
    const result = summary(records, { mode: 'hard', todayDay: '2026-07-08' });
    expect(result.best).toBe(result.current);
    expect(result.bestStartedOn).toBe(result.currentStartedOn);
  });

  it('keeps a best from long ago after the current streak is broken', () => {
    const records = [...runOf('2025-01-01', 40, full), ...runOf('2026-07-01', 2, full)];
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-03' })).toMatchObject({
      current: 2,
      best: 40,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2025-01-01',
    });
  });

  it('measures best across an exempt bridge as one continuous run', () => {
    const records = [
      ...runOf('2026-01-01', 4, full),
      ...runOf('2026-01-05', 3, exemptDay),
      ...runOf('2026-01-08', 4, full),
      blank('2026-01-12'),
      ...runOf('2026-01-13', 5, full),
    ];
    expect(summary(records, { mode: 'hard', todayDay: '2026-01-18' })).toMatchObject({
      current: 5,
      best: 8, // 4 + 4 bridged by the exempt days
      bestStartedOn: '2026-01-01',
      currentStartedOn: '2026-01-13',
    });
  });

  it('differs per mode over the same history', () => {
    const records = seq('2026-07-01', [full, oneMissed, full, full, onlyFajr, full]);
    expect(summary(records, { mode: 'soft', todayDay: '2026-07-07' })).toMatchObject({ current: 6, best: 6 });
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-07' })).toMatchObject({
      current: 1,
      best: 2,
      currentStartedOn: '2026-07-06',
      bestStartedOn: '2026-07-03',
    });
  });
});

// ---------------------------------------------------------------------------
// computeStreak — input handling
// ---------------------------------------------------------------------------

describe('computeStreak — sparse, unsorted and duplicated input', () => {
  it('accepts records in any order', () => {
    const ordered = runOf('2026-07-01', 6, full);
    const shuffled = [ordered[3], ordered[0], ordered[5], ordered[1], ordered[4], ordered[2]];
    const opts: ComputeStreakOptions = { mode: 'hard', todayDay: '2026-07-07' };
    expect(summary(shuffled, opts)).toEqual(summary(ordered, opts));
  });

  it('accepts a reversed array', () => {
    const ordered = runOf('2026-07-01', 6, full);
    const opts: ComputeStreakOptions = { mode: 'hard', todayDay: '2026-07-07' };
    expect(summary([...ordered].reverse(), opts)).toEqual(summary(ordered, opts));
  });

  it('lets the last duplicate for a day win', () => {
    const records = [...runOf('2026-07-01', 3, full), blank('2026-07-02'), full('2026-07-02')];
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-04' })).toMatchObject({ current: 3 });

    const shadowed = [...runOf('2026-07-01', 3, full), full('2026-07-02'), blank('2026-07-02')];
    expect(summary(shadowed, { mode: 'hard', todayDay: '2026-07-04' })).toMatchObject({ current: 1, best: 1 });
  });

  it('treats every day between the earliest record and today as scanned', () => {
    // Only a single ancient record: the whole gap since then breaks the streak.
    expect(summary([full('2020-01-01')], { mode: 'hard', todayDay: '2020-01-10' })).toMatchObject({
      current: 0,
      best: 1,
      bestStartedOn: '2020-01-01',
    });
  });

  it('ignores records dated after today when computing best', () => {
    const records = [...runOf('2026-07-01', 2, full), ...runOf('2026-07-10', 30, full)];
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-02' })).toEqual({
      mode: 'hard',
      current: 2,
      best: 2,
      currentStartedOn: '2026-07-01',
      bestStartedOn: '2026-07-01',
    });
  });

  it('ignores today itself when includeToday is false and today is the only future-most record', () => {
    const records = runOf('2026-07-01', 3, full);
    expect(summary(records, { mode: 'hard', todayDay: '2026-07-03', includeToday: false })).toMatchObject({
      current: 2,
      best: 2,
      currentStartedOn: '2026-07-01',
    });
  });

  it('does not mutate the input records or their order', () => {
    const records = seq('2026-07-01', [full, exemptDay, oneMissed, blank]);
    const before = JSON.stringify(records);
    summary(records, { mode: 'hard', todayDay: '2026-07-05' });
    summary(records, { mode: 'soft', todayDay: '2026-07-05' });
    expect(JSON.stringify(records)).toBe(before);
  });
});

describe('computeStreak — invalid input fails loudly', () => {
  it.each(['2026-7-02', '2026-02-30', '20260702', 'today', '', '2026-13-01'])(
    'throws RangeError for todayDay %p',
    (bad) => {
      expect(() => summary([], { mode: 'hard', todayDay: bad })).toThrow(RangeError);
    }
  );

  it('throws RangeError for a malformed record day', () => {
    expect(() => summary([full('2026-02-30')], { mode: 'hard', todayDay: '2026-07-02' })).toThrow(RangeError);
  });

  it('throws RangeError for a nullish record', () => {
    const records = [full('2026-07-01'), null as unknown as DayRecord];
    expect(() => summary(records, { mode: 'hard', todayDay: '2026-07-02' })).toThrow(RangeError);
  });

  it('throws RangeError for an unknown mode when there is something to classify', () => {
    expect(() =>
      summary([full('2026-07-01')], { mode: 'sideways' as StreakMode, todayDay: '2026-07-02' })
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// computeStreak — invariants over generated histories
// ---------------------------------------------------------------------------

describe('computeStreak — invariants over generated histories', () => {
  /** Deterministic LCG so the generated cases are identical on every machine and run. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  const shapes: ((day: PrayerDay) => DayRecord)[] = [full, allLate, onlyFajr, oneMissed, blank, exemptDay];

  it.each(MODES)('holds the streak invariants for 200 random histories (%s)', (mode) => {
    const random = lcg(20260819);
    const start = '2026-01-01';

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const length = 1 + Math.floor(random() * 40);
      const records: DayRecord[] = [];
      for (let i = 0; i < length; i += 1) {
        if (random() < 0.15) continue; // sparse: leave a hole
        const shape = shapes[Math.floor(random() * shapes.length)];
        records.push(shape(addDays(start, i)));
      }
      const todayDay = addDays(start, length - 1);
      const result = computeStreak(records, { mode, todayDay });

      expect(result.best).toBeGreaterThanOrEqual(result.current);
      expect(result.current).toBeLessThanOrEqual(length);
      expect(result.currentStartedOn === null).toBe(result.current === 0);
      expect(result.bestStartedOn === null).toBe(result.best === 0);

      if (result.currentStartedOn !== null) {
        // Every day from the reported start to today must be counting or bridging,
        // and exactly `current` of them must count.
        let counted = 0;
        for (let day = result.currentStartedOn; ; day = addDays(day, 1)) {
          const record = records.find((r) => r.day === day) ?? unloggedDayRecord(day);
          let verdict = classifyDay(record, mode);
          if (verdict === 'breaks' && day === todayDay) verdict = 'bridges';
          expect(verdict).not.toBe<DayVerdict>('breaks');
          if (verdict === 'counts') counted += 1;
          if (day === todayDay) break;
        }
        expect(counted).toBe(result.current);
        expect(classifyDay(records.find((r) => r.day === result.currentStartedOn)!, mode)).toBe<DayVerdict>(
          'counts'
        );
      }
    }
  });

  it('never returns a negative or fractional streak', () => {
    const records = seq('2026-07-01', [full, exemptDay, 'GAP', onlyFajr, oneMissed]);
    for (const mode of MODES) {
      const result = summary(records, { mode, todayDay: '2026-07-06' });
      expect(Number.isInteger(result.current)).toBe(true);
      expect(Number.isInteger(result.best)).toBe(true);
      expect(result.current).toBeGreaterThanOrEqual(0);
      expect(result.best).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// streakMilestone
// ---------------------------------------------------------------------------

describe('streakMilestone', () => {
  it('exposes the milestones ascending', () => {
    expect([...STREAK_MILESTONES]).toEqual([3, 7, 30, 100, 365]);
  });

  it.each(STREAK_MILESTONES)('returns %i on exactly that streak', (milestone) => {
    expect(streakMilestone(milestone)).toBe(milestone);
  });

  it.each([0, 1, 2, 4, 5, 6, 8, 29, 31, 99, 101, 364, 366, 1000])(
    'returns null for a streak of %i',
    (value) => {
      expect(streakMilestone(value)).toBeNull();
    }
  );

  it('returns null for negative streaks', () => {
    expect(streakMilestone(-1)).toBeNull();
    expect(streakMilestone(-7)).toBeNull();
  });

  it.each([7.5, 6.999, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns null for the non-integer value %p',
    (value) => {
      expect(streakMilestone(value)).toBeNull();
    }
  );

  it('fires once when a streak grows past a milestone', () => {
    const fired = [5, 6, 7, 8, 9].map((n) => streakMilestone(n));
    expect(fired).toEqual([null, null, 7, null, null]);
  });

  it('composes with computeStreak on the day a 7-day streak completes', () => {
    const records = runOf('2026-07-01', 7, full);
    const { current } = summary(records, { mode: 'hard', todayDay: '2026-07-07' });
    expect(streakMilestone(current)).toBe(7);
  });

  it('does not fire while today is still open and short of the milestone', () => {
    const records = [...runOf('2026-07-01', 6, full), oneUnlogged('2026-07-07')];
    const { current } = summary(records, { mode: 'hard', todayDay: '2026-07-07' });
    expect(current).toBe(6);
    expect(streakMilestone(current)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Purity / no-shaming (structural)
// ---------------------------------------------------------------------------

describe('purity', () => {
  const source = fs.readFileSync(path.join(__dirname, 'streaks.ts'), 'utf8');

  it('imports nothing from React, React Native, Expo or adhan', () => {
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./dates', './types']);
  });

  it('never reads the clock', () => {
    expect(source).not.toMatch(/new Date\(/);
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/Date\.parse\(/);
  });

  it('returns exactly the StreakSummary shape and nothing about lost streaks', () => {
    const result = summary(runOf('2026-07-01', 3, full), { mode: 'hard', todayDay: '2026-07-04' });
    expect(Object.keys(result).sort()).toEqual(
      ['best', 'bestStartedOn', 'current', 'currentStartedOn', 'mode'].sort()
    );
  });

  it('is stable across repeated calls with the same input', () => {
    const records = seq('2026-07-01', [full, exemptDay, oneMissed, full]);
    const opts: ComputeStreakOptions = { mode: 'hard', todayDay: '2026-07-05' };
    expect(summary(records, opts)).toEqual(summary(records, opts));
  });
});
