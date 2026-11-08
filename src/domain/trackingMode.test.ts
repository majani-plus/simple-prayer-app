import { classifyDay, unloggedDayRecord } from './streaks';
import {
  closedPrayersAt,
  derivedMisses,
  displayRecord,
  displayStatus,
  displayStatuses,
  isClosedOn,
  makeUpSource,
  modeViewKey,
  putBackSource,
  simpleQadaDebts,
  simpleTapTarget,
  type DisplayContext,
  type ModeView,
} from './trackingMode';
import {
  PRAYERS,
  PRAYER_STATUSES,
  type DayRecord,
  type PrayerStatus,
  type PrayerWindow,
  type QadaDebts,
  type StreakMode,
} from './types';

const OPEN: DisplayContext = { windowClosed: false, isExempt: false, onOrAfterSince: true };
const CLOSED: DisplayContext = { windowClosed: true, isExempt: false, onOrAfterSince: true };

const debts = (fajr = 0, dhuhr = 0, asr = 0, maghrib = 0, isha = 0): QadaDebts => ({
  fajr,
  dhuhr,
  asr,
  maghrib,
  isha,
});

function view(overrides: Partial<ModeView> = {}): ModeView {
  return {
    mode: 'simple',
    since: '2026-11-01',
    today: '2026-11-07',
    closedToday: ['fajr', 'dhuhr'],
    ...overrides,
  };
}

function record(day: string, statuses: Partial<DayRecord['statuses']> = {}, isExempt = false) {
  const base = unloggedDayRecord(day);
  return { ...base, statuses: { ...base.statuses, ...statuses }, isExempt };
}

describe('displayStatus', () => {
  it('is the identity in detailed mode, for every status and every context', () => {
    for (const status of PRAYER_STATUSES) {
      for (const ctx of [OPEN, CLOSED, { ...CLOSED, isExempt: true }]) {
        expect(displayStatus(status, ctx, 'detailed')).toBe(status);
      }
    }
  });

  it('shows late as prayed in simple mode', () => {
    expect(displayStatus('late', OPEN, 'simple')).toBe('prayed');
    expect(displayStatus('late', CLOSED, 'simple')).toBe('prayed');
  });

  it('shows an unmarked prayer as missed only once its time has ended', () => {
    expect(displayStatus('unlogged', CLOSED, 'simple')).toBe('missed');
    expect(displayStatus('unlogged', OPEN, 'simple')).toBe('unlogged');
  });

  it('never paints a day before simple mode began, or an excused day', () => {
    expect(displayStatus('unlogged', { ...CLOSED, onOrAfterSince: false }, 'simple')).toBe(
      'unlogged'
    );
    expect(displayStatus('unlogged', { ...CLOSED, isExempt: true }, 'simple')).toBe('unlogged');
    expect(displayStatus('exempt', CLOSED, 'simple')).toBe('exempt');
  });

  it('keeps stored prayed and missed as they are', () => {
    expect(displayStatus('prayed', CLOSED, 'simple')).toBe('prayed');
    expect(displayStatus('missed', OPEN, 'simple')).toBe('missed');
  });

  it('refuses an unknown status', () => {
    expect(() => displayStatus('bogus' as PrayerStatus, CLOSED, 'simple')).toThrow(RangeError);
  });
});

describe('closedPrayersAt / isClosedOn', () => {
  const at = (h: number) => new Date(2026, 10, 7, h).getTime();
  const windows: PrayerWindow[] = [
    { prayer: 'fajr', start: new Date(at(5)), end: new Date(at(7)) },
    { prayer: 'dhuhr', start: new Date(at(12)), end: new Date(at(15)) },
  ];

  it('is half-open, as the windows are', () => {
    expect(closedPrayersAt(windows, at(6))).toEqual([]);
    expect(closedPrayersAt(windows, at(7))).toEqual(['fajr']);
    expect(closedPrayersAt(windows, at(16))).toEqual(['fajr', 'dhuhr']);
  });

  it('closes every prayer of a past day, today per the view, and nothing ahead', () => {
    const v = view({ closedToday: ['fajr'] });
    for (const prayer of PRAYERS) expect(isClosedOn('2026-11-06', prayer, v)).toBe(true);
    expect(isClosedOn('2026-11-07', 'fajr', v)).toBe(true);
    expect(isClosedOn('2026-11-07', 'isha', v)).toBe(false);
    expect(isClosedOn('2026-11-08', 'fajr', v)).toBe(false);
  });
});

describe('displayRecord', () => {
  it('returns the very same object in detailed mode', () => {
    const r = record('2026-11-05', { fajr: 'late' });
    expect(displayRecord(r, view({ mode: 'detailed' }))).toBe(r);
  });

  it('returns the same object when simple mode changes nothing', () => {
    const r = record('2026-11-05', {
      fajr: 'prayed',
      dhuhr: 'prayed',
      asr: 'missed',
      maghrib: 'prayed',
      isha: 'prayed',
    });
    expect(displayRecord(r, view())).toBe(r);
  });

  it('maps a past day, and leaves the stored record untouched', () => {
    const r = record('2026-11-05', { fajr: 'late', dhuhr: 'prayed' });
    const shown = displayRecord(r, view());
    expect(shown.statuses).toEqual({
      fajr: 'prayed',
      dhuhr: 'prayed',
      asr: 'missed',
      maghrib: 'missed',
      isha: 'missed',
    });
    expect(r.statuses.fajr).toBe('late');
    expect(r.statuses.asr).toBe('unlogged');
  });

  it('maps today prayer by prayer: an open prayer is never missed', () => {
    const shown = displayRecord(record('2026-11-07'), view());
    expect(shown.statuses).toEqual({
      fajr: 'missed',
      dhuhr: 'missed',
      asr: 'unlogged',
      maghrib: 'unlogged',
      isha: 'unlogged',
    });
  });

  it('leaves days before `since`, days with no `since`, and excused days alone', () => {
    expect(displayRecord(record('2026-10-31'), view()).statuses.fajr).toBe('unlogged');
    expect(displayRecord(record('2026-11-05'), view({ since: null })).statuses.fajr).toBe(
      'unlogged'
    );
    const excused = record('2026-11-05', {}, true);
    expect(displayRecord(excused, view())).toBe(excused);
  });

  it('displayStatuses agrees with displayRecord', () => {
    const r = record('2026-11-05', { fajr: 'late' });
    expect(displayStatuses(r.day, r.statuses, false, view())).toEqual(
      displayRecord(r, view()).statuses
    );
    expect(displayStatuses(r.day, r.statuses, true, view()).asr).toBe('unlogged');
  });
});

describe('streaks are unchanged by the mapping', () => {
  // `classifyDay` already treats unlogged as missed and late as prayed — so simple mode needs no
  // change to the streak, and a switch can never move one. Pinned here so a change to either side
  // fails loudly.
  it.each<StreakMode>(['soft', 'hard'])('gives the same verdict in %s mode', (mode) => {
    const statuses: PrayerStatus[] = ['unlogged', 'prayed', 'late', 'missed'];
    for (const a of statuses) {
      for (const b of statuses) {
        const r = record('2026-11-05', { fajr: a, dhuhr: b, asr: 'prayed', maghrib: a, isha: b });
        expect(classifyDay(displayRecord(r, view()), mode)).toBe(classifyDay(r, mode));
      }
    }
  });
});

describe('derivedMisses', () => {
  it('counts only stored-unlogged prayers that simple mode shows as missed', () => {
    const records = [
      record('2026-10-31'), // before since: nothing
      record('2026-11-05', { fajr: 'prayed', dhuhr: 'missed', asr: 'late' }),
      record('2026-11-06', {}, true), // excused: nothing
      record('2026-11-07'), // today: fajr + dhuhr closed
    ];
    expect(derivedMisses(records, view())).toEqual(debts(1, 1, 0, 1, 1));
  });

  it('is all zero in detailed mode', () => {
    expect(derivedMisses([record('2026-11-05')], view({ mode: 'detailed' }))).toEqual(debts());
  });
});

describe('qada in simple mode', () => {
  it('shows stored + derived − made up, never below the stored debt', () => {
    expect(simpleQadaDebts(debts(2), debts(3), debts(1))).toEqual(debts(4));
    // Made up past what is derived (a shown miss was later marked prayed): stored stays.
    expect(simpleQadaDebts(debts(2), debts(1), debts(3))).toEqual(debts(2));
  });

  it('makes up the stored debt first, then the counter, and nothing when nothing is owed', () => {
    expect(makeUpSource(debts(1), debts(3), 'fajr')).toBe('stored');
    expect(makeUpSource(debts(0), debts(2), 'fajr')).toBe('counter');
    expect(makeUpSource(debts(0), debts(0), 'fajr')).toBeNull();
  });

  it('puts back on the counter first, so it undoes the last make-up', () => {
    expect(putBackSource(debts(3), debts(1), 'fajr')).toBe('counter');
    expect(putBackSource(debts(3), debts(0), 'fajr')).toBe('stored');
    // A counter that absorbs nothing any more (derived dropped to 0) cannot be "put back".
    expect(putBackSource(debts(0), debts(2), 'fajr')).toBe('stored');
  });

  it('works through the example in D192', () => {
    // Stored 1 Asr, 2 unmarked Asr shown as missed: 3 to make up.
    const stored = debts(0, 0, 1);
    const derived = debts(0, 0, 2);
    let madeUp = debts();
    let storedNow = stored;
    const shown = () => simpleQadaDebts(storedNow, derived, madeUp);
    expect(shown().asr).toBe(3);
    // 1st make-up: the stored one.
    expect(makeUpSource(storedNow, shown(), 'asr')).toBe('stored');
    storedNow = debts(0, 0, 0);
    expect(shown().asr).toBe(2);
    // 2nd and 3rd: the counter.
    expect(makeUpSource(storedNow, shown(), 'asr')).toBe('counter');
    madeUp = debts(0, 0, 1);
    expect(makeUpSource(storedNow, shown(), 'asr')).toBe('counter');
    madeUp = debts(0, 0, 2);
    expect(shown().asr).toBe(0);
    expect(makeUpSource(storedNow, shown(), 'asr')).toBeNull();
  });
});

describe('simpleTapTarget', () => {
  it('clears what shows as prayed and marks everything else prayed — never late or missed', () => {
    expect(simpleTapTarget('prayed')).toBe('unlogged');
    expect(simpleTapTarget('late')).toBe('unlogged');
    expect(simpleTapTarget('unlogged')).toBe('prayed');
    expect(simpleTapTarget('missed')).toBe('prayed');
  });
});

describe('modeViewKey', () => {
  it('changes with every field that changes what is shown', () => {
    const base = modeViewKey(view());
    expect(modeViewKey(view({ mode: 'detailed' }))).not.toBe(base);
    expect(modeViewKey(view({ since: null }))).not.toBe(base);
    expect(modeViewKey(view({ today: '2026-11-08' }))).not.toBe(base);
    expect(modeViewKey(view({ closedToday: ['fajr'] }))).not.toBe(base);
    expect(modeViewKey(view())).toBe(base);
  });
});
