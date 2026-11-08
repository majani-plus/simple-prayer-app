/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 *
 * Tests for the tracking store — the composition point between the UI, `db/queries` and
 * `domain/*`.
 *
 * The file runs in a pinned timezone. Most of it is zone-agnostic, but the midnight-to-Fajr
 * regression at the bottom is not: "00:30 local, Fajr at 04:34" is a claim about Istanbul, and
 * a `beforeAll` cannot make it true — Jest hands the sandbox a copy of `process.env`, so assigning
 * `TZ` from inside a test never reaches `Date`. See `src/testing/fixedTimezoneEnvironment.js`.
 *
 * Everything here runs against REAL SQL: an in-memory better-sqlite3 database with the
 * committed migrations applied (`src/db/__tests__/testDb.ts`), and a real settings store backed
 * by the in-memory storage adapter. Only `react-native-mmkv` is mocked, because importing this
 * module pulls in the MMKV-backed settings singleton.
 *
 * The store's contract is that it holds NO rules of its own, so the assertions repeatedly check
 * the store's output against the domain functions called directly on the same data.
 */

import { addDays, parseDay } from '../domain/dates';
import { computeDayTimes } from '../domain/prayerTimes';
import { expandExemptDays, normalizePeriods } from '../domain/exemptions';
import {
  applyMiss,
  computeProgress,
  emptyDebts,
  FORGIVE_UNDO_WINDOW_DAYS,
  totalDebt,
} from '../domain/qada';
import { computeStats } from '../domain/stats';
import { modeViewFor } from '../domain/trackingMode';
import { computeStreak } from '../domain/streaks';
import { PRAYERS, type ExemptPeriod, type PrayerDay, type QadaDebts } from '../domain/types';
import {
  getDayRecords,
  getPrayerLog,
  getQadaDebts,
  listExemptPeriods,
  listQadaEvents,
} from '../db/queries';
import { createTestDb, type TestDb } from '../db/__tests__/testDb';
import {
  createMemorySettingsStorage,
  createSettingsStore,
  useSettingsStore,
} from './settingsStore';
import {
  createTrackingStore,
  resolvePrayerDay,
  useTrackingStore,
  type TrackingStore,
} from './trackingStore';

jest.mock('react-native-mmkv', () => {
  const instances = new Map<string, Map<string, string>>();
  return {
    createMMKV: ({ id }: { id: string }) => {
      let values = instances.get(id);
      if (values === undefined) {
        values = new Map();
        instances.set(id, values);
      }
      const store = values;
      return {
        id,
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        getBoolean: () => undefined,
        getNumber: () => undefined,
        remove: (key: string) => void store.delete(key),
        delete: (key: string) => void store.delete(key),
        clearAll: () => void store.clear(),
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const TODAY: PrayerDay = '2026-08-19';
const YESTERDAY: PrayerDay = '2026-08-18';
const TOMORROW: PrayerDay = '2026-08-20';

/** Local midnight of `TODAY` plus 12 hours — timezone-independent and firmly inside the day. */
const BASE_NOW = parseDay(TODAY).getTime() + 12 * 60 * 60 * 1000;

interface Harness {
  db: TestDb;
  settings: ReturnType<typeof createSettingsStore>;
  store: ReturnType<typeof createTrackingStore>;
  /** Reads the store's state + actions. */
  state: () => TrackingStore;
  /** Moves the injected clock. */
  setNow: (value: number) => void;
  /** Moves the injected "today". */
  setToday: (day: PrayerDay) => void;
}

let harness: Harness;

function setup(): Harness {
  const db = createTestDb();
  const settings = createSettingsStore(
    createMemorySettingsStorage(),
    `tracking-test-${String(Math.random())}`
  );
  let clock = BASE_NOW;
  let todayDay: PrayerDay = TODAY;

  const store = createTrackingStore({
    getDb: () => db.db,
    getSettings: () => settings.getState(),
    now: () => clock,
    getTodayDay: () => todayDay,
    scheduleWrite: (run) => run(),
  });
  store.getState().hydrate();

  return {
    db,
    settings,
    store,
    state: () => store.getState(),
    setNow: (value) => {
      clock = value;
    },
    setToday: (day) => {
      todayDay = day;
    },
  };
}

beforeEach(() => {
  harness = setup();
});

afterEach(() => {
  harness.db.close();
});

/** The Drizzle handle under test. */
function db() {
  return harness.db.db;
}

/** The store's actions/state. */
function store(): TrackingStore {
  return harness.state();
}

/** Turns exemption mode on — most exemption behaviour is gated on it. */
function enableExemptionMode(): void {
  harness.settings.getState().setExemptionModeEnabled(true);
}

/** Debts as a plain object, straight from SQLite. */
function storedDebts(): QadaDebts {
  return getQadaDebts(db());
}

// ---------------------------------------------------------------------------
// Hydration & caching
// ---------------------------------------------------------------------------

describe('hydrate', () => {
  it('starts from an empty database with zeroed debts and no periods', () => {
    expect(store().hydrated).toBe(true);
    expect(store().debts).toEqual(emptyDebts());
    expect(store().exemptPeriods).toEqual([]);
    expect(store().dayRecords).toEqual({});
  });

  it('reloads persisted debts and periods', () => {
    store().setQadaDebts({ fajr: 3, dhuhr: 0, asr: 1, maghrib: 0, isha: 0 }, 'estimate');
    store().startExemptPeriod(YESTERDAY);

    store().hydrate();

    expect(store().debts).toEqual({ fajr: 3, dhuhr: 0, asr: 1, maghrib: 0, isha: 0 });
    expect(store().exemptPeriods).toHaveLength(1);
    expect(store().exemptPeriods[0]?.startDay).toBe(YESTERDAY);
  });
});

describe('day record cache', () => {
  it('loadRange caches a dense range', () => {
    const records = store().loadRange('2026-08-01', '2026-08-31');
    expect(records).toHaveLength(31);
    expect(Object.keys(store().dayRecords)).toHaveLength(31);
    expect(store().dayRecords['2026-08-15']?.statuses.fajr).toBe('unlogged');
  });

  it('dayRecordFor reads through and caches on a miss', () => {
    expect(store().dayRecords[TODAY]).toBeUndefined();
    const record = store().dayRecordFor(TODAY);
    expect(record.day).toBe(TODAY);
    expect(store().dayRecords[TODAY]).toBe(record);
  });

  it('invalidateDays drops the cache', () => {
    store().loadDay(TODAY);
    store().invalidateDays();
    expect(store().dayRecords).toEqual({});
  });

  it('refreshes only the written day after a status change', () => {
    store().loadRange(YESTERDAY, TODAY);
    store().setStatus(TODAY, 'fajr', 'prayed');

    expect(store().dayRecords[TODAY]?.statuses.fajr).toBe('prayed');
    expect(store().dayRecords[YESTERDAY]?.statuses.fajr).toBe('unlogged');
  });
});

// ---------------------------------------------------------------------------
// setStatus & the qada side effects
// ---------------------------------------------------------------------------

describe('setStatus', () => {
  it('persists the status and caches the resolved day', () => {
    expect(store().setStatus(TODAY, 'dhuhr', 'late')).toBe(true);
    expect(getPrayerLog(db(), TODAY, 'dhuhr')?.status).toBe('late');
    expect(store().dayRecordFor(TODAY).statuses.dhuhr).toBe('late');
  });

  it('logging missed increments that prayer’s debt and appends an add event', () => {
    store().setStatus(TODAY, 'fajr', 'missed');

    expect(store().debts.fajr).toBe(1);
    expect(storedDebts()).toEqual(applyMiss(emptyDebts(), 'fajr'));

    const events = listQadaEvents(db());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'add', prayer: 'fajr', delta: 1, at: BASE_NOW });
    expect(events[0]?.meta).toEqual({ day: TODAY });
  });

  it('logging missed then changing it to prayed leaves the debt back where it started', () => {
    const before = storedDebts();

    store().setStatus(TODAY, 'maghrib', 'missed');
    expect(store().debts.maghrib).toBe(1);

    store().setStatus(TODAY, 'maghrib', 'prayed');

    expect(store().debts).toEqual(before);
    expect(storedDebts()).toEqual(before);
    // Both halves of the round trip are in the audit trail.
    expect(listQadaEvents(db()).map((event) => event.delta)).toEqual([-1, 1]);
  });

  it('un-logging a missed prayer also gives the debt back', () => {
    store().setStatus(TODAY, 'isha', 'missed');
    store().setStatus(TODAY, 'isha', 'unlogged');

    expect(store().debts.isha).toBe(0);
    expect(getPrayerLog(db(), TODAY, 'isha')).toBeNull();
  });

  it('re-logging missed over missed does not double-count the debt', () => {
    store().setStatus(TODAY, 'fajr', 'missed');
    store().setStatus(TODAY, 'fajr', 'missed');

    expect(store().debts.fajr).toBe(1);
    expect(listQadaEvents(db())).toHaveLength(1);
  });

  it('does not refund a missed prayer that was already made up', () => {
    store().setStatus(TODAY, 'asr', 'missed');
    store().markMadeUp(TODAY, 'asr');
    expect(store().debts.asr).toBe(0);

    // Editing the log afterwards must not pay off the same debt a second time.
    store().setStatus(TODAY, 'asr', 'prayed');
    expect(store().debts.asr).toBe(0);
  });

  it('never lets a debt go negative when the miss is undone after a forgiveness', () => {
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    store().forgiveQada();
    expect(store().debts.fajr).toBe(0);

    store().setStatus(YESTERDAY, 'fajr', 'prayed');

    expect(store().debts.fajr).toBe(0);
    // The counter did not move, so no event was written for it.
    expect(listQadaEvents(db(), { types: ['add'] }).map((event) => event.delta)).toEqual([1]);
  });

  it('keeps the log and the debt in step when the transaction is the unit of work', () => {
    store().setStatus(TODAY, 'dhuhr', 'missed');
    store().setStatus(YESTERDAY, 'dhuhr', 'missed');

    const logged = getDayRecords(db(), YESTERDAY, TODAY).filter(
      (record) => record.statuses.dhuhr === 'missed'
    ).length;
    expect(logged).toBe(storedDebts().dhuhr);
  });

  it('refuses a day after today (future days are locked)', () => {
    expect(store().setStatus(TOMORROW, 'fajr', 'prayed')).toBe(false);
    expect(getPrayerLog(db(), TOMORROW, 'fajr')).toBeNull();
  });

  it('accepts today and any past day', () => {
    expect(store().setStatus(TODAY, 'fajr', 'prayed')).toBe(true);
    expect(store().setStatus('2020-01-01', 'fajr', 'prayed')).toBe(true);
  });

  it('refuses a malformed day rather than throwing', () => {
    expect(store().setStatus('not-a-day', 'fajr', 'prayed')).toBe(false);
  });

  it('never lets an exempt day become missed', () => {
    enableExemptionMode();
    store().startExemptPeriod(YESTERDAY);

    expect(store().setStatus(YESTERDAY, 'fajr', 'missed')).toBe(false);
    expect(getPrayerLog(db(), YESTERDAY, 'fajr')).toBeNull();
    expect(store().debts).toEqual(emptyDebts());
    expect(store().dayRecordFor(YESTERDAY).statuses.fajr).toBe('exempt');
  });

  it('allows writes again once exemption mode is switched off', () => {
    enableExemptionMode();
    store().startExemptPeriod(YESTERDAY);
    expect(store().setStatus(YESTERDAY, 'fajr', 'prayed')).toBe(false);

    harness.settings.getState().setExemptionModeEnabled(false);
    expect(store().setStatus(YESTERDAY, 'fajr', 'prayed')).toBe(true);
  });
});

describe('toggleStatus', () => {
  it('logs on the first tap', () => {
    expect(store().toggleStatus(TODAY, 'fajr', 'prayed')).toBe(true);
    expect(store().dayRecordFor(TODAY).statuses.fajr).toBe('prayed');
  });

  it('clears back to unlogged when the same status is chosen twice', () => {
    store().toggleStatus(TODAY, 'fajr', 'prayed');
    store().toggleStatus(TODAY, 'fajr', 'prayed');

    expect(store().dayRecordFor(TODAY).statuses.fajr).toBe('unlogged');
    expect(getPrayerLog(db(), TODAY, 'fajr')).toBeNull();
  });

  it('switches to the other status when a different one is chosen', () => {
    store().toggleStatus(TODAY, 'fajr', 'prayed');
    store().toggleStatus(TODAY, 'fajr', 'late');

    expect(store().dayRecordFor(TODAY).statuses.fajr).toBe('late');
  });

  it('toggling a missed prayer off returns the debt', () => {
    store().toggleStatus(TODAY, 'fajr', 'missed');
    expect(store().debts.fajr).toBe(1);

    store().toggleStatus(TODAY, 'fajr', 'missed');
    expect(store().debts.fajr).toBe(0);
  });

  it('is refused on a future day', () => {
    expect(store().toggleStatus(TOMORROW, 'fajr', 'prayed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Made-up conversion
// ---------------------------------------------------------------------------

describe('markMadeUp / clearMadeUp', () => {
  it('decrements the debt and records a tick', () => {
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    expect(store().debts.fajr).toBe(1);

    expect(store().markMadeUp(YESTERDAY, 'fajr')).toBe(true);

    expect(store().debts.fajr).toBe(0);
    expect(store().dayRecordFor(YESTERDAY).madeUp.fajr).toBe(true);
    const ticks = listQadaEvents(db(), { types: ['tick'] });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ prayer: 'fajr', delta: -1 });
  });

  it('refuses to make up a prayer that is not a stored miss', () => {
    expect(store().markMadeUp(YESTERDAY, 'fajr')).toBe(false);
    store().setStatus(YESTERDAY, 'fajr', 'prayed');
    expect(store().markMadeUp(YESTERDAY, 'fajr')).toBe(false);
  });

  it('refuses to make up the same prayer twice', () => {
    store().setStatus(YESTERDAY, 'dhuhr', 'missed');
    store().markMadeUp(YESTERDAY, 'dhuhr');

    expect(store().markMadeUp(YESTERDAY, 'dhuhr')).toBe(false);
    expect(store().debts.dhuhr).toBe(0);
    expect(listQadaEvents(db(), { types: ['tick'] })).toHaveLength(1);
  });

  it('clearMadeUp puts the debt back', () => {
    store().setStatus(YESTERDAY, 'asr', 'missed');
    store().markMadeUp(YESTERDAY, 'asr');

    expect(store().clearMadeUp(YESTERDAY, 'asr')).toBe(true);

    expect(store().debts.asr).toBe(1);
    expect(store().dayRecordFor(YESTERDAY).madeUp.asr).toBeUndefined();
  });

  it('clearMadeUp is a no-op when nothing was made up', () => {
    store().setStatus(YESTERDAY, 'asr', 'missed');
    expect(store().clearMadeUp(YESTERDAY, 'asr')).toBe(false);
    expect(store().debts.asr).toBe(1);
  });

  it('refuses to make up a prayer whose debt was already forgiven', () => {
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    store().forgiveQada();
    expect(store().debts.fajr).toBe(0);

    // There is nothing left to pay off, so no marker is stamped and no tick is written.
    expect(store().markMadeUp(YESTERDAY, 'fajr')).toBe(false);
    expect(getPrayerLog(db(), YESTERDAY, 'fajr')?.madeUpAt).toBeUndefined();
    expect(listQadaEvents(db(), { types: ['tick'] })).toHaveLength(0);
  });

  it('never resurrects a forgiven debt through a made-up round trip', () => {
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    store().forgiveQada();

    store().markMadeUp(YESTERDAY, 'fajr');
    store().clearMadeUp(YESTERDAY, 'fajr');

    // Mercy is never clawed back: only a freshly logged miss may raise a counter.
    expect(store().debts.fajr).toBe(0);
    expect(storedDebts().fajr).toBe(0);
  });

  it('refuses to make up (or un-make-up) a prayer on an exempt day', () => {
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    store().markMadeUp(YESTERDAY, 'fajr');
    enableExemptionMode();
    store().startExemptPeriod(YESTERDAY);

    expect(store().clearMadeUp(YESTERDAY, 'fajr')).toBe(false);
    expect(store().markMadeUp(YESTERDAY, 'dhuhr')).toBe(false);
    // No prayer is owed on an exempt day, so no counter may move because of one.
    expect(store().debts).toEqual(emptyDebts());
  });

  it('refuses a future day', () => {
    expect(store().markMadeUp(TOMORROW, 'fajr')).toBe(false);
    expect(store().clearMadeUp(TOMORROW, 'fajr')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Qada
// ---------------------------------------------------------------------------

describe('tickQada', () => {
  it('decrements the counter and records the event', () => {
    store().setQadaDebts({ fajr: 2, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });

    expect(store().tickQada('fajr')).toBe(true);

    expect(store().debts.fajr).toBe(1);
    expect(storedDebts().fajr).toBe(1);
    const ticks = listQadaEvents(db(), { types: ['tick'] });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ prayer: 'fajr', delta: -1, at: BASE_NOW });
  });

  it('is a silent no-op at zero and writes no event', () => {
    expect(store().tickQada('isha')).toBe(false);
    expect(store().debts.isha).toBe(0);
    expect(listQadaEvents(db(), { types: ['tick'] })).toHaveLength(0);
  });
});

/**
 * The two ways a prayer can be marked as made up — the tick on the qada screen and the
 * conversion in a History day detail — both decrement the same counter. One missed prayer is one
 * prayer owed, so between them they may pay it off exactly once, in either order.
 */
describe('the two paths that pay a debt off', () => {
  it('cannot pay one miss off twice: tick first, then the History conversion', () => {
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    expect(store().debts.fajr).toBe(1);

    expect(store().tickQada('fajr')).toBe(true);
    expect(store().debts.fajr).toBe(0);

    // The counter is already at zero, so the History conversion has nothing to pay and refuses —
    // it does not stamp a marker either, or clearing it later would resurrect the debt.
    expect(store().markMadeUp(YESTERDAY, 'fajr')).toBe(false);
    expect(store().debts.fajr).toBe(0);
    expect(storedDebts().fajr).toBe(0);
    expect(getPrayerLog(db(), YESTERDAY, 'fajr')?.madeUpAt).toBeUndefined();
    expect(listQadaEvents(db(), { types: ['tick'] })).toHaveLength(1);
  });

  it('cannot pay one miss off twice: the History conversion first, then the tick', () => {
    store().setStatus(YESTERDAY, 'dhuhr', 'missed');
    expect(store().markMadeUp(YESTERDAY, 'dhuhr')).toBe(true);
    expect(store().debts.dhuhr).toBe(0);

    expect(store().tickQada('dhuhr')).toBe(false);
    expect(store().debts.dhuhr).toBe(0);
    expect(storedDebts().dhuhr).toBe(0);
    expect(listQadaEvents(db(), { types: ['tick'] })).toHaveLength(1);
  });

  it('lets two misses be paid off one by each path, and no further', () => {
    store().setStatus(YESTERDAY, 'asr', 'missed');
    store().setStatus(addDays(YESTERDAY, -1), 'asr', 'missed');
    expect(store().debts.asr).toBe(2);

    expect(store().tickQada('asr')).toBe(true);
    expect(store().markMadeUp(YESTERDAY, 'asr')).toBe(true);
    expect(store().debts.asr).toBe(0);

    expect(store().tickQada('asr')).toBe(false);
    expect(store().markMadeUp(addDays(YESTERDAY, -1), 'asr')).toBe(false);
    expect(store().debts.asr).toBe(0);
  });

  it('does not go negative when a ticked-off miss is later corrected to prayed', () => {
    store().setStatus(YESTERDAY, 'maghrib', 'missed');
    store().tickQada('maghrib');
    expect(store().debts.maghrib).toBe(0);

    // "I did pray it after all" — the miss is undone, but its debt was already settled by the
    // tick, so there is nothing left to give back.
    store().setStatus(YESTERDAY, 'maghrib', 'prayed');

    expect(store().debts.maghrib).toBe(0);
    expect(storedDebts().maghrib).toBe(0);
    expect(totalDebt(store().debts)).toBe(0);
  });

  it('keeps the counter non-negative through a long mixed sequence of both paths', () => {
    const days = [YESTERDAY, addDays(YESTERDAY, -1), addDays(YESTERDAY, -2)];
    for (const day of days) store().setStatus(day, 'isha', 'missed');

    const moves: (() => void)[] = [
      () => void store().tickQada('isha'),
      () => void store().markMadeUp(days[0], 'isha'),
      () => void store().clearMadeUp(days[0], 'isha'),
      () => void store().tickQada('isha'),
      () => void store().markMadeUp(days[1], 'isha'),
      () => void store().tickQada('isha'),
      () => void store().tickQada('isha'),
      () => void store().markMadeUp(days[2], 'isha'),
      () => void store().clearMadeUp(days[1], 'isha'),
      () => void store().tickQada('isha'),
      () => void store().tickQada('isha'),
    ];
    for (const move of moves) {
      move();
      expect(store().debts.isha).toBeGreaterThanOrEqual(0);
      expect(storedDebts().isha).toBe(store().debts.isha);
    }

    expect(store().debts.isha).toBe(0);
  });
});

describe('setQadaDebts', () => {
  it('stores the wizard estimate and records an estimateSet event', () => {
    const debts: QadaDebts = { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 };
    expect(store().setQadaDebts(debts, 'estimate')).toEqual(debts);

    expect(storedDebts()).toEqual(debts);
    const events = listQadaEvents(db());
    expect(events[0]).toMatchObject({ type: 'estimateSet', prayer: null, delta: 50 });
  });

  it('records a hand-edit as manualSet with a signed delta', () => {
    store().setQadaDebts({ fajr: 5, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, 'estimate');
    store().setQadaDebts({ fajr: 2, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });

    const events = listQadaEvents(db(), { types: ['manualSet'] });
    expect(events[0]).toMatchObject({ type: 'manualSet', delta: -3 });
  });

  it('sanitises junk counts through the domain', () => {
    const stored = store().setQadaDebts({
      fajr: -4,
      dhuhr: 2.7,
      asr: Number.NaN,
      maghrib: 0,
      isha: 0,
    } as QadaDebts);
    expect(stored).toEqual({ fajr: 0, dhuhr: 2, asr: 0, maghrib: 0, isha: 0 });
  });
});

describe('forgive & undo', () => {
  const debts: QadaDebts = { fajr: 4, dhuhr: 3, asr: 2, maghrib: 1, isha: 0 };

  it('zeroes the counters and archives them', () => {
    store().setQadaDebts(debts, 'estimate');

    expect(store().forgiveQada()).toBe(true);

    expect(store().debts).toEqual(emptyDebts());
    expect(storedDebts()).toEqual(emptyDebts());
    const forgiveEvent = listQadaEvents(db(), { types: ['forgive'] })[0];
    expect(forgiveEvent).toMatchObject({ delta: -10 });
    expect(forgiveEvent?.meta).toMatchObject({ debts, total: 10 });
  });

  it('is a no-op when nothing is owed', () => {
    expect(store().forgiveQada()).toBe(false);
    expect(listQadaEvents(db(), { types: ['forgive'] })).toHaveLength(0);
  });

  it('forgive then undo restores the exact debts when nothing was logged since', () => {
    store().setQadaDebts(debts, 'estimate');
    store().forgiveQada();

    expect(store().undoableForgive()).not.toBeNull();
    expect(store().undoForgive()).toBe(true);

    expect(store().debts).toEqual(debts);
    expect(storedDebts()).toEqual(debts);
    const undo = listQadaEvents(db(), { types: ['forgiveUndo'] })[0];
    expect(undo).toMatchObject({ type: 'forgiveUndo', delta: 10 });
  });

  it('adds the archive back ON TOP of misses logged since the forgiveness (D79)', () => {
    store().setQadaDebts(debts, 'estimate');
    store().forgiveQada();

    // Three Fajrs genuinely missed in the days after the old debt was set down. They are the
    // user's own deliberate logs, not part of what was forgiven.
    store().setStatus(TODAY, 'fajr', 'missed');
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    store().setStatus('2026-08-17', 'fajr', 'missed');
    expect(storedDebts().fajr).toBe(3);

    expect(store().undoForgive()).toBe(true);

    // 4 archived + 3 newly incurred. A replacement would have read 4 and deleted three real
    // misses; the undo reverses the forgiveness, it does not rewind time.
    expect(store().debts).toEqual({ ...debts, fajr: 7 });
    expect(storedDebts()).toEqual({ ...debts, fajr: 7 });
    // Exactly the inverse of the forgive event's −total delta, whatever else has moved.
    const undo = listQadaEvents(db(), { types: ['forgiveUndo'] })[0];
    expect(undo).toMatchObject({ type: 'forgiveUndo', delta: 10 });
  });

  it('withdraws the undo once the estimate wizard has set the counters again (D79)', () => {
    store().setQadaDebts(debts, 'estimate');
    store().forgiveQada();

    harness.setNow(BASE_NOW + 1_000);
    const reEstimated: QadaDebts = { fajr: 20, dhuhr: 20, asr: 20, maghrib: 20, isha: 20 };
    store().setQadaDebts(reEstimated, 'estimate');

    // The wizard's estimate already spans the forgiven period, so adding the archive on top
    // would charge those prayers twice. The offer is withdrawn rather than left silently wrong.
    expect(store().undoableForgive()).toBeNull();
    expect(store().undoForgive()).toBe(false);
    expect(store().debts).toEqual(reEstimated);
    expect(storedDebts()).toEqual(reEstimated);
    expect(listQadaEvents(db(), { types: ['forgiveUndo'] })).toHaveLength(0);
  });

  it('keeps the undo after a relative hand-adjustment', () => {
    store().setQadaDebts(debts, 'estimate');
    store().forgiveQada();

    // What `useQada.putBack` writes when a mis-tapped "+1 made up" is reversed: a whole-record
    // write, but a relative one that re-establishes nothing over the forgiven period. It must
    // not cost the user the 30-day promise.
    harness.setNow(BASE_NOW + 1_000);
    store().setQadaDebts(applyMiss(storedDebts(), 'isha'), 'manual');

    expect(store().undoableForgive()).not.toBeNull();
    expect(store().undoForgive()).toBe(true);
    expect(store().debts).toEqual({ ...debts, isha: 1 });
  });

  it('offers the undo only once', () => {
    store().setQadaDebts(debts, 'estimate');
    store().forgiveQada();
    store().undoForgive();

    expect(store().undoableForgive()).toBeNull();
    expect(store().undoForgive()).toBe(false);
    expect(store().debts).toEqual(debts);
  });

  it('withdraws the undo after the 30-day window', () => {
    store().setQadaDebts(debts, 'estimate');
    store().forgiveQada();

    const later = addDays(TODAY, FORGIVE_UNDO_WINDOW_DAYS + 1);
    harness.setNow(parseDay(later).getTime() + 60_000);
    harness.setToday(later);

    expect(store().undoableForgive()).toBeNull();
    expect(store().undoForgive()).toBe(false);
  });

  it('offers a fresh undo after a second forgiveness', () => {
    store().setQadaDebts(debts, 'estimate');
    store().forgiveQada();
    store().undoForgive();

    harness.setNow(BASE_NOW + 1_000);
    store().forgiveQada();

    expect(store().undoableForgive()).not.toBeNull();
    expect(store().undoForgive()).toBe(true);
    expect(store().debts).toEqual(debts);
  });
});

describe('qadaProgress', () => {
  it('agrees with computeProgress on the same debts and tick events', () => {
    store().setQadaDebts({ fajr: 20, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, 'estimate');
    store().tickQada('fajr');
    harness.setNow(BASE_NOW + 1);
    store().tickQada('fajr');

    const expected = computeProgress(storedDebts(), listQadaEvents(db(), { types: ['tick'] }), {
      todayDay: TODAY,
    });

    expect(store().qadaProgress()).toEqual(expected);
    expect(store().qadaProgress().paidInWindow).toBe(2);
    expect(store().qadaProgress().total).toBe(18);
  });

  it('recomputes after a tick rather than serving a stale memo', () => {
    store().setQadaDebts({ fajr: 3, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, 'estimate');
    expect(store().qadaProgress().total).toBe(3);

    store().tickQada('fajr');
    expect(store().qadaProgress().total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

describe('exempt periods', () => {
  it('startExemptPeriod persists an open-ended period and invalidates the day cache', () => {
    enableExemptionMode();
    store().loadRange(YESTERDAY, TODAY);
    expect(store().dayRecords[TODAY]?.isExempt).toBe(false);

    const periods = store().startExemptPeriod(YESTERDAY);

    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ startDay: YESTERDAY, endDay: null });
    // The cache is dropped, because every cached day may now resolve differently.
    expect(store().dayRecords).toEqual({});
    expect(store().dayRecordFor(TODAY).isExempt).toBe(true);
    expect(store().dayRecordFor(TODAY).statuses.isha).toBe('exempt');
  });

  it('endExemptPeriod closes the open period and re-resolves the days after it', () => {
    enableExemptionMode();
    store().startExemptPeriod('2026-08-10');
    expect(store().isExemptDay(TODAY)).toBe(true);

    store().endExemptPeriod('2026-08-14');

    expect(store().exemptPeriods[0]).toMatchObject({
      startDay: '2026-08-10',
      endDay: '2026-08-14',
    });
    expect(store().isExemptDay('2026-08-14')).toBe(true);
    expect(store().isExemptDay('2026-08-15')).toBe(false);
    expect(store().dayRecordFor(TODAY).isExempt).toBe(false);
  });

  it('addExemptPeriod accepts an end date still to come — "excused for three days"', () => {
    enableExemptionMode();

    // Today plus two more: the shape the begin sheet's "3 days" writes.
    expect(store().addExemptPeriod(TODAY, '2026-08-21')).toBe(true);

    expect(store().isExemptDay(TODAY)).toBe(true);
    expect(store().isExemptDay('2026-08-21')).toBe(true);
    // Nothing is scheduled and nothing runs: the coverage simply stops.
    expect(store().isExemptDay('2026-08-22')).toBe(false);
    expect(store().dayRecordFor(TODAY).isExempt).toBe(true);
  });

  it('endExemptPeriod cuts a planned period short, which endPeriod alone could not', () => {
    enableExemptionMode();
    store().addExemptPeriod(YESTERDAY, '2026-08-25');
    expect(store().isExemptDay(TODAY)).toBe(true);

    store().endExemptPeriod(YESTERDAY);

    expect(store().exemptPeriods[0]).toMatchObject({ startDay: YESTERDAY, endDay: YESTERDAY });
    expect(store().isExemptDay(TODAY)).toBe(false);
    expect(store().dayRecordFor(TODAY).isExempt).toBe(false);
  });

  it('endExemptPeriod cancels a planned period that began today', () => {
    enableExemptionMode();
    store().addExemptPeriod(TODAY, '2026-08-25');

    store().endExemptPeriod(YESTERDAY);

    expect(store().exemptPeriods).toEqual([]);
    expect(store().isExemptDay(TODAY)).toBe(false);
  });

  it('normalises overlapping periods through the domain, not by hand', () => {
    enableExemptionMode();
    store().startExemptPeriod('2026-08-01');
    store().endExemptPeriod('2026-08-05');
    store().startExemptPeriod('2026-08-06');
    store().endExemptPeriod('2026-08-09');

    // Adjacent ranges are one uninterrupted stretch.
    expect(store().exemptPeriods).toEqual(normalizePeriods(listExemptPeriods(db())));
    expect(store().exemptPeriods).toHaveLength(1);
    expect(store().exemptPeriods[0]).toMatchObject({
      startDay: '2026-08-01',
      endDay: '2026-08-09',
    });
  });

  it('deleteExemptPeriod removes the row, reloads and invalidates', () => {
    enableExemptionMode();
    store().startExemptPeriod('2026-08-01');
    store().endExemptPeriod('2026-08-05');
    const id = store().exemptPeriods[0]?.id as number;

    store().loadDay('2026-08-03');
    expect(store().deleteExemptPeriod(id)).toBe(true);

    expect(store().exemptPeriods).toEqual([]);
    expect(store().dayRecords).toEqual({});
    expect(store().isExemptDay('2026-08-03')).toBe(false);
  });

  it('deleteExemptPeriod reports an unknown id', () => {
    expect(store().deleteExemptPeriod(999)).toBe(false);
  });

  it('ignores stored periods entirely while exemption mode is off', () => {
    enableExemptionMode();
    store().startExemptPeriod(YESTERDAY);
    harness.settings.getState().setExemptionModeEnabled(false);

    expect(store().isExemptDay(YESTERDAY)).toBe(false);
    expect(store().dayRecordFor(YESTERDAY).isExempt).toBe(false);
  });

  it('never serves a cached day as missed after exemption mode is switched on', () => {
    // The period is stored while the feature is off, so nothing resolves as exempt yet.
    store().startExemptPeriod(YESTERDAY);
    store().setStatus(YESTERDAY, 'fajr', 'missed');
    expect(store().dayRecordFor(YESTERDAY).statuses.fajr).toBe('missed');

    enableExemptionMode();

    // Turning the feature on must re-resolve the cache, not keep rendering the day as missed.
    expect(store().dayRecordFor(YESTERDAY).statuses.fajr).toBe('exempt');
    expect(store().dayRecordFor(YESTERDAY).isExempt).toBe(true);
  });

  it('drops cached exempt days when exemption mode is switched off', () => {
    enableExemptionMode();
    store().startExemptPeriod(YESTERDAY);
    expect(store().loadDay(YESTERDAY).isExempt).toBe(true);

    harness.settings.getState().setExemptionModeEnabled(false);

    expect(store().dayRecordFor(YESTERDAY).isExempt).toBe(false);
    expect(
      store()
        .loadRange(YESTERDAY, TODAY)
        .every((record) => !record.isExempt)
    ).toBe(true);
  });

  it('resolves exempt days exactly as expandExemptDays does', () => {
    enableExemptionMode();
    store().startExemptPeriod('2026-08-03');
    store().endExemptPeriod('2026-08-07');

    const periods: ExemptPeriod[] = store().exemptPeriods;
    const expected = expandExemptDays(periods, '2026-08-01', '2026-08-10');
    const resolved = store()
      .loadRange('2026-08-01', '2026-08-10')
      .filter((record) => record.isExempt)
      .map((record) => record.day);

    expect(new Set(resolved)).toEqual(expected);
  });

  it('keeps explicit prayed/late logs visible on an exempt day (amendment 2)', () => {
    enableExemptionMode();
    // She prayed Fajr and Dhuhr late, then her period began before Asr.
    store().setStatus(YESTERDAY, 'fajr', 'prayed');
    store().setStatus(YESTERDAY, 'dhuhr', 'late');
    store().setStatus(YESTERDAY, 'asr', 'missed');

    store().startExemptPeriod(YESTERDAY);

    const record = store().dayRecordFor(YESTERDAY);
    expect(record.isExempt).toBe(true);
    // The day-level range overrides only `unlogged` and `missed` — never her own marks.
    expect(record.statuses).toEqual({
      fajr: 'prayed',
      dhuhr: 'late',
      asr: 'exempt',
      maghrib: 'exempt',
      isha: 'exempt',
    });
  });
});

// ---------------------------------------------------------------------------
// Exempt-period writes settle qada debt (spec-exemption §5, D-x5)
// ---------------------------------------------------------------------------

describe('exempt period writes settle qada debt', () => {
  beforeEach(() => {
    enableExemptionMode();
  });

  it('backdating a start over stored misses refunds their debt in the same write', () => {
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().setStatus('2026-08-15', 'asr', 'missed');
    store().setStatus('2026-08-16', 'fajr', 'missed');
    expect(storedDebts()).toEqual({ fajr: 2, dhuhr: 0, asr: 1, maghrib: 0, isha: 0 });

    store().startExemptPeriod('2026-08-15');

    // No prayer was owed on those days: hiding the misses without refunding them would leave
    // her owing make-up prayers she was never obliged to make up — the outcome this feature
    // must never produce.
    expect(storedDebts()).toEqual(emptyDebts());
    expect(store().debts).toEqual(emptyDebts());
    // The audit trail mirrors the refund: one negative `add` per hidden miss, each carrying
    // the day it corrects — symmetric with how logging `missed` added the debt.
    const refunds = listQadaEvents(db(), { types: ['add'] }).filter((event) => event.delta < 0);
    expect(refunds).toHaveLength(3);
    expect(refunds.every((event) => typeof event.meta?.day === 'string')).toBe(true);
  });

  it('does not refund a miss that was already made up — that debt was settled by its tick', () => {
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().markMadeUp('2026-08-15', 'fajr');
    expect(storedDebts().fajr).toBe(0);

    store().startExemptPeriod('2026-08-15');
    expect(storedDebts().fajr).toBe(0);

    // …and un-covering it later does not charge the prayer a second time either.
    store().endExemptPeriod('2026-08-14');
    expect(storedDebts().fajr).toBe(0);
  });

  it('refunds nothing (and writes no event) when the counters were already zeroed', () => {
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().forgiveQada();
    expect(storedDebts().fajr).toBe(0);
    const eventsBefore = listQadaEvents(db()).length;

    store().startExemptPeriod('2026-08-15');

    // The domain clamps at zero; an event for a counter that did not move would be a lie in
    // the audit trail (and would inflate nothing but confusion).
    expect(storedDebts().fajr).toBe(0);
    expect(listQadaEvents(db()).length).toBe(eventsBefore);
  });

  it('uncovering restores exactly what covering forgave — nothing, when the refund was clamped by an earlier forgiveness (D63)', () => {
    // A miss whose debt the user has already been forgiven: covering the day refunds nothing
    // (the counter is at zero — the test above pins that), so uncovering it must re-add
    // nothing. Re-adding here would resurrect forgiven debt through a perfectly legal
    // cover/uncover round trip, contradicting both D63 ("uncovering a miss restores exactly
    // what covering it forgave") and qada.ts's contract that forgiveness is never clawed back.
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().forgiveQada();
    store().startExemptPeriod('2026-08-15');
    expect(storedDebts().fajr).toBe(0);
    const id = store().exemptPeriods[0]?.id as number;

    expect(store().deleteExemptPeriod(id)).toBe(true);

    // The miss is visible again — but its debt was forgiven, and stays forgiven.
    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('missed');
    expect(storedDebts().fajr).toBe(0);
  });

  it('uncovering restores nothing when the miss was already paid off from the qada screen', () => {
    // Same clamp, different door: the user paid the debt with a qada-screen tick (which marks
    // no log made up — it pays the aggregate counter). Covering the day then refunds nothing,
    // so uncovering it must not charge the prayer a second time.
    store().setStatus('2026-08-15', 'fajr', 'missed');
    expect(store().tickQada('fajr')).toBe(true);
    store().startExemptPeriod('2026-08-15');
    expect(storedDebts().fajr).toBe(0);

    store().endExemptPeriod('2026-08-14'); // ends before it started: cancels the period

    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('missed');
    expect(storedDebts().fajr).toBe(0);
  });

  it('a partially clamped refund uncovers to exactly what was refunded, not to every covered miss', () => {
    // Two fajr misses, counter hand-edited down to 1: covering both days can only refund the 1
    // that is actually owed. Uncovering must re-add that same 1 — the round trip preserves the
    // hand-edited number instead of inflating it to 2.
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().setStatus('2026-08-16', 'fajr', 'missed');
    store().setQadaDebts({ fajr: 1, dhuhr: 0, asr: 1, maghrib: 0, isha: 0 });

    store().addExemptPeriod('2026-08-15', '2026-08-16');
    expect(storedDebts().fajr).toBe(0);
    const id = store().exemptPeriods[0]?.id as number;

    expect(store().deleteExemptPeriod(id)).toBe(true);
    expect(storedDebts().fajr).toBe(1);
    // The untouched counter is untouched both ways.
    expect(storedDebts().asr).toBe(1);
  });

  it('deleting a period re-adds the debt of the misses it uncovers', () => {
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().startExemptPeriod('2026-08-14');
    store().endExemptPeriod('2026-08-16');
    expect(storedDebts().fajr).toBe(0);
    const id = store().exemptPeriods[0]?.id as number;

    expect(store().deleteExemptPeriod(id)).toBe(true);

    // The miss is honest again — and so is what it costs.
    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('missed');
    expect(storedDebts().fajr).toBe(1);
    expect(store().debts.fajr).toBe(1);
  });

  it('backdating the end re-adds only the misses that fall outside the shorter range', () => {
    store().setStatus('2026-08-12', 'fajr', 'missed');
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().startExemptPeriod('2026-08-12');
    expect(storedDebts().fajr).toBe(0);

    store().endExemptPeriod('2026-08-13');

    // 2026-08-15 left the range; 2026-08-12 is still inside it.
    expect(storedDebts().fajr).toBe(1);
    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('missed');
    expect(store().dayRecordFor('2026-08-12').statuses.fajr).toBe('exempt');
  });

  it('addExemptPeriod records a closed past period and refunds what it covers', () => {
    store().setStatus('2026-08-01', 'dhuhr', 'missed');
    expect(storedDebts().dhuhr).toBe(1);

    expect(store().addExemptPeriod('2026-07-30', '2026-08-03')).toBe(true);

    expect(store().exemptPeriods[0]).toMatchObject({
      startDay: '2026-07-30',
      endDay: '2026-08-03',
    });
    expect(storedDebts().dhuhr).toBe(0);
    expect(store().isExemptDay('2026-08-01')).toBe(true);
  });

  it('addExemptPeriod refuses inverted or malformed ranges without writing', () => {
    expect(store().addExemptPeriod('2026-08-05', '2026-08-01')).toBe(false);
    expect(store().addExemptPeriod('not-a-day' as PrayerDay, '2026-08-01')).toBe(false);
    expect(listExemptPeriods(db())).toEqual([]);
  });

  it('a planned period refunds the past days it covers and nothing else', () => {
    store().setStatus(YESTERDAY, 'asr', 'missed');
    expect(storedDebts().asr).toBe(1);

    // Backdated to yesterday and planned three days ahead: one write, both directions handled.
    expect(store().addExemptPeriod(YESTERDAY, '2026-08-21')).toBe(true);

    expect(storedDebts().asr).toBe(0);
    expect(store().isExemptDay('2026-08-21')).toBe(true);
    expect(store().isExemptDay('2026-08-22')).toBe(false);
  });

  it('cutting a planned period short re-adds the debt for the days it gives back', () => {
    store().setStatus(YESTERDAY, 'asr', 'missed');
    store().addExemptPeriod('2026-08-17', '2026-08-25');
    expect(storedDebts().asr).toBe(0);

    // "Actually it ended before yesterday" — yesterday's miss is owed again.
    store().endExemptPeriod('2026-08-17');

    expect(storedDebts().asr).toBe(1);
    expect(store().dayRecordFor(YESTERDAY).statuses.asr).toBe('missed');
  });

  it('updateExemptPeriod moves a record and settles the debt in both directions', () => {
    store().setStatus('2026-08-05', 'asr', 'missed');
    store().setStatus('2026-08-10', 'asr', 'missed');
    store().addExemptPeriod('2026-08-04', '2026-08-06');
    expect(storedDebts().asr).toBe(1); // the 5th refunded, the 10th still owed
    const id = store().exemptPeriods[0]?.id as number;

    expect(store().updateExemptPeriod(id, '2026-08-09', '2026-08-11')).toBe(true);

    // The 5th is uncovered (re-added), the 10th newly covered (refunded): still exactly one.
    expect(storedDebts().asr).toBe(1);
    expect(store().dayRecordFor('2026-08-05').statuses.asr).toBe('missed');
    expect(store().dayRecordFor('2026-08-10').statuses.asr).toBe('exempt');
  });

  it('updateExemptPeriod refuses an unknown id and an inverted range, leaving rows untouched', () => {
    store().addExemptPeriod('2026-08-04', '2026-08-06');
    const id = store().exemptPeriods[0]?.id as number;

    expect(store().updateExemptPeriod(9999, '2026-08-01', '2026-08-02')).toBe(false);
    expect(store().updateExemptPeriod(id, '2026-08-06', '2026-08-04')).toBe(false);

    expect(store().exemptPeriods[0]).toMatchObject({
      startDay: '2026-08-04',
      endDay: '2026-08-06',
    });
  });
});

// ---------------------------------------------------------------------------
// The mode toggle settles qada debt too — same invariant, different door
// ---------------------------------------------------------------------------

describe('the exemption-mode toggle settles qada debt', () => {
  /** Flips the flag on the harness settings store (no app-singleton subscription in tests). */
  function setMode(enabled: boolean): void {
    harness.settings.getState().setExemptionModeEnabled(enabled);
  }

  it('switching ON refunds a miss logged on a covered day while the mode was off', () => {
    setMode(true);
    store().startExemptPeriod('2026-08-14');
    store().endExemptPeriod('2026-08-16');
    setMode(false);

    // With the mode off the covered day is an ordinary day: the miss is honest and owed.
    expect(store().setStatus('2026-08-15', 'fajr', 'missed')).toBe(true);
    expect(storedDebts().fajr).toBe(1);

    setMode(true);

    // The flip is observed on the next store access: the miss is hidden AND its debt refunded.
    // Hiding it while the debt silently stood is exactly the outcome D-x5 exists to prevent,
    // reached through a legal toggle instead of a backdated write.
    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('exempt');
    expect(storedDebts().fajr).toBe(0);
    expect(store().debts.fajr).toBe(0);
  });

  it('switching OFF re-adds the debt of every miss it reveals', () => {
    setMode(true);
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().startExemptPeriod('2026-08-14');
    store().endExemptPeriod('2026-08-16');
    expect(storedDebts().fajr).toBe(0); // refunded by the covering write

    setMode(false);

    // What she sees (a missed prayer) and what the counter believes must agree.
    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('missed');
    expect(storedDebts().fajr).toBe(1);
    expect(store().debts.fajr).toBe(1);
  });

  it('round-trips: repeated toggles neither strand nor duplicate debt', () => {
    setMode(true);
    store().setStatus('2026-08-15', 'asr', 'missed');
    store().startExemptPeriod('2026-08-14');
    store().endExemptPeriod('2026-08-16');
    expect(storedDebts().asr).toBe(0);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      setMode(false);
      expect(store().dayRecordFor('2026-08-15').statuses.asr).toBe('missed');
      expect(storedDebts().asr).toBe(1);

      setMode(true);
      expect(store().dayRecordFor('2026-08-15').statuses.asr).toBe('exempt');
      expect(storedDebts().asr).toBe(0);
    }
  });

  it('a period recorded while the mode is off moves no debt; the switch-on settles it', () => {
    // The flag was never on: the write's coverage is invisible, so reconciling on the raw
    // lists here would refund a debt the user still SEES as missed.
    store().setStatus('2026-08-15', 'fajr', 'missed');
    expect(store().addExemptPeriod('2026-08-14', '2026-08-16')).toBe(true);
    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('missed');
    expect(storedDebts().fajr).toBe(1);

    setMode(true);

    expect(store().dayRecordFor('2026-08-15').statuses.fajr).toBe('exempt');
    expect(storedDebts().fajr).toBe(0);
  });

  it('a made-up miss moves nothing in either direction of the toggle', () => {
    setMode(true);
    // Logged and paid while the mode was off: the debt was settled by its tick.
    setMode(false);
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().markMadeUp('2026-08-15', 'fajr');
    store().addExemptPeriod('2026-08-14', '2026-08-16');
    expect(storedDebts().fajr).toBe(0);

    setMode(true);
    expect(store().dayRecordFor('2026-08-15').isExempt).toBe(true);
    expect(storedDebts().fajr).toBe(0);

    setMode(false);
    expect(store().dayRecordFor('2026-08-15').isExempt).toBe(false);
    expect(storedDebts().fajr).toBe(0);
  });

  it('the toggle leaves an audit trail symmetric with the period writes', () => {
    setMode(true);
    store().setStatus('2026-08-15', 'fajr', 'missed');
    store().startExemptPeriod('2026-08-14');
    store().endExemptPeriod('2026-08-16');

    setMode(false);
    store().dayRecordFor('2026-08-15');

    const adds = listQadaEvents(db(), { types: ['add'] });
    // +1 (the log), −1 (the covering write), +1 (the switch-off reveal) — each carrying its day.
    expect(adds.map((event) => event.delta)).toEqual(expect.arrayContaining([1, -1, 1]));
    expect(adds.every((event) => typeof event.meta?.day === 'string')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

describe('derived selectors', () => {
  /** Logs a small, deliberately mixed history: three good days, one broken, one exempt. */
  function seedHistory(): void {
    for (const day of ['2026-08-15', '2026-08-16', '2026-08-17']) {
      for (const prayer of PRAYERS) store().setStatus(day, prayer, 'prayed');
    }
    store().setStatus('2026-08-18', 'fajr', 'missed');
    store().setStatus(TODAY, 'fajr', 'prayed');
    store().setStatus(TODAY, 'dhuhr', 'late');
  }

  it('streakSummary matches computeStreak on the same records', () => {
    seedHistory();

    const records = getDayRecords(db(), '2026-08-15', TODAY);
    const expected = computeStreak(records, { mode: 'soft', todayDay: TODAY });

    expect(store().streakSummary()).toEqual(expected);
    expect(store().streakSummary().current).toBeGreaterThan(0);
  });

  it('follows the streakMode setting', () => {
    seedHistory();
    harness.settings.getState().setStreakMode('hard');

    const records = getDayRecords(db(), '2026-08-15', TODAY);
    expect(store().streakSummary()).toEqual(
      computeStreak(records, { mode: 'hard', todayDay: TODAY })
    );
    expect(store().streakSummary().mode).toBe('hard');
  });

  it('honours includeToday', () => {
    seedHistory();
    const records = getDayRecords(db(), '2026-08-15', TODAY);

    expect(store().streakSummary({ includeToday: false })).toEqual(
      computeStreak(records, { mode: 'soft', todayDay: TODAY, includeToday: false })
    );
  });

  it('bridges exempt days exactly as the domain does', () => {
    enableExemptionMode();
    for (const prayer of PRAYERS) store().setStatus('2026-08-15', prayer, 'prayed');
    store().startExemptPeriod('2026-08-16');
    store().endExemptPeriod('2026-08-18');
    for (const prayer of PRAYERS) store().setStatus(TODAY, prayer, 'prayed');

    const exempt = expandExemptDays(store().exemptPeriods, '2026-08-15', TODAY);
    const records = getDayRecords(db(), '2026-08-15', TODAY, exempt);

    expect(store().streakSummary()).toEqual(
      computeStreak(records, { mode: 'soft', todayDay: TODAY })
    );
    // Two counting days with a three-day exempt bridge between them.
    expect(store().streakSummary().current).toBe(2);
  });

  it('recomputes the streak when exemption mode is toggled', () => {
    for (const prayer of PRAYERS) store().setStatus('2026-08-17', prayer, 'prayed');
    store().startExemptPeriod('2026-08-18');
    store().endExemptPeriod('2026-08-18');
    for (const prayer of PRAYERS) store().setStatus(TODAY, prayer, 'prayed');

    // Feature off: 2026-08-18 is an ordinary unlogged day and breaks the run.
    expect(store().streakSummary().current).toBe(1);

    enableExemptionMode();

    // Feature on: the same day bridges, so the memoised value must not survive the toggle.
    expect(store().streakSummary().current).toBe(2);
  });

  it('reports an empty streak with no data at all', () => {
    expect(store().streakSummary()).toEqual({
      mode: 'soft',
      current: 0,
      best: 0,
      currentStartedOn: null,
      bestStartedOn: null,
    });
  });

  it('statsFor matches computeStats over the same window', () => {
    seedHistory();

    const from = addDays(TODAY, -6);
    const records = getDayRecords(db(), from, TODAY);
    expect(store().statsFor(7)).toEqual(computeStats(records, { windowDays: 7, todayDay: TODAY }));
  });

  it('statsFor(null) walks the lifetime range', () => {
    seedHistory();

    const records = getDayRecords(db(), '2026-08-15', TODAY);
    expect(store().statsFor(null)).toEqual(
      computeStats(records, { windowDays: null, todayDay: TODAY })
    );
  });

  it('statsFor(null) ignores stored periods while exemption mode is off', () => {
    enableExemptionMode();
    store().startExemptPeriod('2020-01-01');
    store().endExemptPeriod('2020-01-05');
    harness.settings.getState().setExemptionModeEnabled(false);

    for (const prayer of PRAYERS) store().setStatus(TODAY, prayer, 'prayed');

    // The lifetime window starts at the first LOG, not at a period the feature is ignoring —
    // otherwise six years of never-logged days would pour in as `unlogged`.
    expect(store().statsFor(null)).toEqual(
      computeStats(getDayRecords(db(), TODAY, TODAY), { windowDays: null, todayDay: TODAY })
    );
    expect(store().statsFor(null).unlogged).toBe(0);
  });

  it('statsFor excludes exempt days from the denominators, via the domain', () => {
    enableExemptionMode();
    seedHistory();
    store().startExemptPeriod('2026-08-16');
    store().endExemptPeriod('2026-08-17');

    const from = addDays(TODAY, -6);
    const exempt = expandExemptDays(store().exemptPeriods, from, TODAY);
    const records = getDayRecords(db(), from, TODAY, exempt);

    expect(store().statsFor(7)).toEqual(computeStats(records, { windowDays: 7, todayDay: TODAY }));
    expect(store().statsFor(7).byPrayer[0]?.exempt).toBe(2);
  });

  it('recomputes derived values after a log changes', () => {
    const before = store().statsFor(7).prayed;
    store().setStatus(TODAY, 'fajr', 'prayed');
    expect(store().statsFor(7).prayed).toBe(before + 1);
  });

  it('memoises repeated calls between mutations', () => {
    seedHistory();
    expect(store().statsFor(30)).toBe(store().statsFor(30));
    expect(store().streakSummary()).toBe(store().streakSummary());

    const memoised = store().statsFor(30);
    store().setStatus(TODAY, 'asr', 'prayed');
    expect(store().statsFor(30)).not.toBe(memoised);
  });
});

// ---------------------------------------------------------------------------
// End-to-end consistency
// ---------------------------------------------------------------------------

describe('debt and log consistency', () => {
  it('survives a long mixed sequence without divergence', () => {
    const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'];
    for (const day of days) {
      store().setStatus(day, 'fajr', 'missed');
      store().setStatus(day, 'dhuhr', 'prayed');
    }
    expect(store().debts.fajr).toBe(4);

    store().markMadeUp(days[0] as PrayerDay, 'fajr');
    store().setStatus(days[1] as PrayerDay, 'fajr', 'late');
    store().toggleStatus(days[2] as PrayerDay, 'fajr', 'missed');

    // One made up, one edited away, one un-logged: a single outstanding miss remains.
    expect(store().debts.fajr).toBe(1);
    expect(storedDebts()).toEqual(store().debts);

    const outstanding = getDayRecords(db(), days[0] as PrayerDay, TODAY).filter(
      (record) => record.statuses.fajr === 'missed' && record.madeUp.fajr !== true
    ).length;
    expect(outstanding).toBe(totalDebt(store().debts));
  });
});

// ---------------------------------------------------------------------------
// Exempt periods: the stored rows are the source of truth
// ---------------------------------------------------------------------------

describe('exempt period persistence is read-modify-write on the stored rows', () => {
  /** A second store over the same database, deliberately used BEFORE `hydrate()`. */
  function coldStore() {
    return createTrackingStore({
      getDb: () => db(),
      getSettings: () => harness.settings.getState(),
      now: () => BASE_NOW,
      getTodayDay: () => TODAY,
      scheduleWrite: (run) => run(),
    }).getState();
  }

  it('startExemptPeriod does not wipe stored periods when the store has not hydrated', () => {
    enableExemptionMode();
    store().startExemptPeriod('2026-08-01');
    store().endExemptPeriod('2026-08-05');
    expect(listExemptPeriods(db())).toHaveLength(1);

    // `replaceExemptPeriods` replaces the WHOLE table, so a transform built from an empty
    // in-memory cache would silently delete the period the user already recorded.
    coldStore().startExemptPeriod('2026-08-20');

    const stored = normalizePeriods(listExemptPeriods(db()));
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ startDay: '2026-08-01', endDay: '2026-08-05' });
    expect(stored[1]).toMatchObject({ startDay: '2026-08-20', endDay: null });
  });

  it('endExemptPeriod closes the stored open period even before hydration', () => {
    enableExemptionMode();
    store().startExemptPeriod('2026-08-10');
    expect(listExemptPeriods(db())).toHaveLength(1);

    coldStore().endExemptPeriod('2026-08-14');

    expect(listExemptPeriods(db())).toEqual([
      expect.objectContaining({ startDay: '2026-08-10', endDay: '2026-08-14' }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// The prayer day (PRODUCT_SPEC §3)
// ---------------------------------------------------------------------------

/**
 * The store's notion of "today" is the **prayer day** (Fajr → next Fajr), never the calendar
 * date. Every test above injects `getTodayDay`, so nothing there can see whether the production
 * wiring actually does that — which is exactly where it was wrong: the singleton was built
 * without `getTodayDay` and fell back to `dates.todayDay`, the calendar date.
 *
 * The window in which the two disagree is midnight → Fajr, and inside it the calendar date is
 * both too late (it treats the still-open previous day as closed and judges its streak) and too
 * early (it names a prayer day that has not begun as an editable "today").
 */
describe('the prayer day boundary', () => {
  /** Accra — low latitude, so Fajr sits a comfortable few hours after local midnight. */
  const ACCRA = {
    latitude: 5.6037,
    longitude: -0.187,
    label: 'Accra',
    countryCode: 'GH',
    source: 'auto' as const,
    resolvedAt: 0,
  };

  /** Fajr of `day` per the app's own engine — derived, so the test is timezone-independent. */
  function fajrOf(day: PrayerDay): Date {
    return computeDayTimes(day, ACCRA, harness.settings.getState().calculation).times.fajr;
  }

  /** Half an hour before today's Fajr: the "00:30, Isha still unlogged" moment. */
  function beforeFajr(): Date {
    return new Date(fajrOf(TODAY).getTime() - 30 * 60 * 1000);
  }

  /** A store over the same database whose "today" is resolved for real, at `at`. */
  function liveStore(at: Date) {
    const created = createTrackingStore({
      getDb: () => db(),
      getSettings: () => harness.settings.getState(),
      now: () => at.getTime(),
      getTodayDay: () => resolvePrayerDay(harness.settings.getState(), at),
      scheduleWrite: (run) => run(),
    });
    created.getState().hydrate();
    return created.getState();
  }

  beforeEach(() => {
    harness.settings.getState().setLocation(ACCRA);
  });

  it('is still yesterday before Fajr, and today from Fajr onward', () => {
    const settings = harness.settings.getState();
    const fajr = fajrOf(TODAY);

    expect(resolvePrayerDay(settings, beforeFajr())).toBe(YESTERDAY);
    expect(resolvePrayerDay(settings, fajr)).toBe(TODAY);
    expect(resolvePrayerDay(settings, new Date(fajr.getTime() + 60 * 60 * 1000))).toBe(TODAY);
  });

  it('falls back to the calendar date when no location has been set', () => {
    harness.settings.getState().setLocation(null);
    const at = new Date(parseDay(TODAY).getTime() + 30 * 60 * 1000);

    expect(resolvePrayerDay(harness.settings.getState(), at)).toBe(TODAY);
  });

  it('lets the still-open prayer day be logged after midnight, and locks the day that has not begun', () => {
    const live = liveStore(beforeFajr());

    expect(live.todayDay()).toBe(YESTERDAY);
    // The Isha the user is standing in the middle of.
    expect(live.setStatus(YESTERDAY, 'isha', 'prayed')).toBe(true);
    // The calendar date: a prayer day whose Fajr has not arrived.
    expect(live.setStatus(TODAY, 'fajr', 'prayed')).toBe(false);
  });

  it('does not break a hard streak at midnight while the day is still open', () => {
    harness.settings.getState().setStreakMode('hard');
    // Two closed days, complete.
    for (const day of [addDays(YESTERDAY, -2), addDays(YESTERDAY, -1)]) {
      for (const prayer of PRAYERS) store().setStatus(day, prayer, 'prayed');
    }
    // The open day: four of five logged, Isha not marked yet.
    for (const prayer of PRAYERS.filter((prayer) => prayer !== 'isha')) {
      store().setStatus(YESTERDAY, prayer, 'prayed');
    }

    const live = liveStore(beforeFajr());

    // The open day bridges (§5: provisional until Fajr of D+1) — it must NOT read as broken.
    expect(live.streakSummary().current).toBe(2);
    // …and logging the Isha the user just prayed closes it and extends the streak.
    expect(live.setStatus(YESTERDAY, 'isha', 'prayed')).toBe(true);
    expect(live.streakSummary().current).toBe(3);
  });

  it('binds the application-wide store to the prayer day, not the calendar date', () => {
    useSettingsStore.getState().setLocation(ACCRA);
    const fajr = computeDayTimes(TODAY, ACCRA, useSettingsStore.getState().calculation).times.fajr;

    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(fajr.getTime() - 30 * 60 * 1000));
      expect(useTrackingStore.getState().todayDay()).toBe(YESTERDAY);

      jest.setSystemTime(fajr);
      expect(useTrackingStore.getState().todayDay()).toBe(TODAY);
    } finally {
      jest.useRealTimers();
      useSettingsStore.getState().setLocation(null);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: 00:30, Fajr at 04:34 (PRODUCT_SPEC §3)
// ---------------------------------------------------------------------------

/**
 * The bug this pins down, in the one window where it is visible.
 *
 * The store was built with the default `getTodayDay`, which is the local CALENDAR date. Between
 * midnight and Fajr that is the wrong day in both directions at once: the day the user is still
 * living in (and still logging) reads as closed and gets judged, while the day that has not begun
 * reads as editable. Writes still landed — they carry their own day — but everything derived from
 * "today" was measured one day forward, which is how a streak closes at midnight rather than at
 * Fajr.
 *
 * The fixture is exact rather than derived: Istanbul, 2026-08-18, Fajr 04:34 local, clock at
 * 00:30. The timezone is pinned for the whole file (see the docblock at the top) so "00:30 local"
 * and "04:34" mean what they say; the first test asserts the 04:34 so the fixture cannot rot
 * silently under an adhan update.
 */
describe('at 00:30 local, with Fajr at 04:34', () => {
  const ISTANBUL = {
    latitude: 41.0082,
    longitude: 28.9784,
    label: 'Istanbul',
    countryCode: 'TR',
    source: 'manual' as const,
    resolvedAt: 0,
  };

  /** The prayer day the user is still standing in at 00:30 — Isha not logged yet. */
  const OPEN_DAY: PrayerDay = '2026-08-17';
  /** The calendar date the clock already shows, whose Fajr is still four hours away. */
  const CALENDAR_DAY: PrayerDay = '2026-08-18';

  beforeEach(() => {
    harness.settings.getState().setLocation(ISTANBUL);
  });

  /** Fajr of the calendar date, per the app's own engine. */
  function fajr(): Date {
    return computeDayTimes(CALENDAR_DAY, ISTANBUL, harness.settings.getState().calculation).times
      .fajr;
  }

  /** 00:30 local on the calendar date. */
  function halfPastMidnight(): Date {
    return new Date(parseDay(CALENDAR_DAY).getTime() + 30 * 60 * 1000);
  }

  /** A store over the shared database whose "today" is resolved for real, at 00:30. */
  function storeAt0030(): TrackingStore {
    const at = halfPastMidnight();
    const created = createTrackingStore({
      getDb: () => db(),
      getSettings: () => harness.settings.getState(),
      now: () => at.getTime(),
      getTodayDay: () => resolvePrayerDay(harness.settings.getState(), at),
      scheduleWrite: (run) => run(),
    });
    created.getState().hydrate();
    return created.getState();
  }

  it('the fixture is what it claims: Fajr is 04:34 and the clock reads 00:30', () => {
    expect([fajr().getHours(), fajr().getMinutes()]).toEqual([4, 34]);
    expect([halfPastMidnight().getHours(), halfPastMidnight().getMinutes()]).toEqual([0, 30]);
  });

  it('treats the previous calendar date as today', () => {
    expect(storeAt0030().todayDay()).toBe(OPEN_DAY);
    // …and flips at Fajr itself, not a minute before or after.
    expect(resolvePrayerDay(harness.settings.getState(), new Date(fajr().getTime() - 1))).toBe(
      OPEN_DAY
    );
    expect(resolvePrayerDay(harness.settings.getState(), fajr())).toBe(CALENDAR_DAY);
  });

  it('files a status written at 00:30 under that same prayer day', () => {
    const live = storeAt0030();

    expect(live.setStatus(live.todayDay(), 'isha', 'prayed')).toBe(true);

    expect(getPrayerLog(db(), OPEN_DAY, 'isha')).toMatchObject({ status: 'prayed' });
    expect(getPrayerLog(db(), CALENDAR_DAY, 'isha')).toBeNull();
    expect(live.dayRecordFor(OPEN_DAY).statuses.isha).toBe('prayed');
  });

  it('locks the calendar date behind the future-day guard until its Fajr arrives', () => {
    const live = storeAt0030();

    // The prayer day that has not begun: nothing in it is loggable yet (§8/§4).
    expect(live.setStatus(CALENDAR_DAY, 'fajr', 'prayed')).toBe(false);
    expect(live.markMadeUp(CALENDAR_DAY, 'fajr')).toBe(false);
    expect(getPrayerLog(db(), CALENDAR_DAY, 'fajr')).toBeNull();

    // The day the user is living in is not future, and is still writable.
    expect(live.setStatus(OPEN_DAY, 'maghrib', 'prayed')).toBe(true);
  });

  it('measures the streak against the open day, so midnight cannot break it', () => {
    harness.settings.getState().setStreakMode('hard');
    for (const day of [addDays(OPEN_DAY, -2), addDays(OPEN_DAY, -1)]) {
      for (const prayer of PRAYERS) store().setStatus(day, prayer, 'prayed');
    }
    // The open day: four of five, Isha still to come.
    for (const prayer of PRAYERS.filter((prayer) => prayer !== 'isha')) {
      store().setStatus(OPEN_DAY, prayer, 'prayed');
    }

    const live = storeAt0030();
    const records = getDayRecords(db(), addDays(OPEN_DAY, -2), OPEN_DAY);

    expect(live.streakSummary()).toEqual(
      computeStreak(records, { mode: 'hard', todayDay: OPEN_DAY, includeToday: true })
    );
    expect(live.streakSummary().current).toBe(2);
    // What the calendar date would have said: the open day judged as closed and incomplete.
    expect(
      computeStreak(records, { mode: 'hard', todayDay: CALENDAR_DAY, includeToday: true }).current
    ).toBe(0);
  });

  it('measures stats over the window ending on the open day', () => {
    for (const prayer of PRAYERS) store().setStatus(OPEN_DAY, prayer, 'prayed');
    store().setStatus(addDays(OPEN_DAY, -6), 'fajr', 'missed');

    const live = storeAt0030();
    const window = getDayRecords(db(), addDays(OPEN_DAY, -6), OPEN_DAY);

    expect(live.statsFor(7)).toEqual(computeStats(window, { windowDays: 7, todayDay: OPEN_DAY }));
    // The calendar date's window drops the oldest day and adds one that has not happened.
    expect(live.statsFor(7)).not.toEqual(
      computeStats(getDayRecords(db(), addDays(CALENDAR_DAY, -6), CALENDAR_DAY), {
        windowDays: 7,
        todayDay: CALENDAR_DAY,
      })
    );
  });

  it('stays on the calendar date when there is no location to resolve Fajr from', () => {
    harness.settings.getState().setLocation(null);

    const live = storeAt0030();

    expect(live.todayDay()).toBe(CALENDAR_DAY);
    expect(live.setStatus(CALENDAR_DAY, 'isha', 'prayed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setTodayDayResolver — the runtime injection point
// ---------------------------------------------------------------------------

/**
 * The store must not import the location or the prayer-time engine to know what day it is, so the
 * screen that already holds both installs a resolver instead. These tests are about the contract
 * of that slot: it overrides, it releases, it survives two installers, and it can never take a
 * write down with it.
 */
describe('setTodayDayResolver', () => {
  it('overrides the injected fallback while it is installed, and releases back to it', () => {
    expect(store().todayDay()).toBe(TODAY);

    const release = store().setTodayDayResolver(() => YESTERDAY);
    expect(store().todayDay()).toBe(YESTERDAY);

    release();
    expect(store().todayDay()).toBe(TODAY);
  });

  it('bumps the revision only when the answer actually changed', () => {
    const before = store().revision;
    // Agreeing with the fallback must not churn every subscriber on mount.
    const releaseSame = store().setTodayDayResolver(() => TODAY);
    expect(store().revision).toBe(before);
    releaseSame();
    expect(store().revision).toBe(before);

    const release = store().setTodayDayResolver(() => YESTERDAY);
    expect(store().revision).toBe(before + 1);
    release();
    expect(store().revision).toBe(before + 2);
  });

  it('re-derives on every call, so a resolver that reads the clock rolls over on its own', () => {
    let day: PrayerDay = YESTERDAY;
    store().setTodayDayResolver(() => day);

    expect(store().todayDay()).toBe(YESTERDAY);
    day = TODAY;
    expect(store().todayDay()).toBe(TODAY);
  });

  it('is measured by the derived selectors, not just reported', () => {
    for (const prayer of PRAYERS) store().setStatus(YESTERDAY, prayer, 'prayed');

    store().setTodayDayResolver(() => YESTERDAY);
    expect(store().statsFor(1)).toEqual(
      computeStats(getDayRecords(db(), YESTERDAY, YESTERDAY), {
        windowDays: 1,
        todayDay: YESTERDAY,
      })
    );
    expect(store().statsFor(1).prayed).toBe(5);
  });

  it('lets a stale release be a no-op, so two screens cannot drop each other', () => {
    const releaseFirst = store().setTodayDayResolver(() => YESTERDAY);
    const releaseSecond = store().setTodayDayResolver(() => TOMORROW);

    // The first screen unmounts second-to-last; the resolver in force is not its own.
    releaseFirst();
    expect(store().todayDay()).toBe(TOMORROW);

    releaseSecond();
    expect(store().todayDay()).toBe(TODAY);
  });

  it('falls through to the fallback when the resolver throws or answers with nonsense', () => {
    store().setTodayDayResolver(() => {
      throw new Error('polar night: no Fajr today');
    });
    expect(store().todayDay()).toBe(TODAY);
    // Being wrong about the day must never make a log un-writable.
    expect(store().setStatus(TODAY, 'fajr', 'prayed')).toBe(true);

    store().setTodayDayResolver(() => '2026-13-45' as PrayerDay);
    expect(store().todayDay()).toBe(TODAY);

    store().setTodayDayResolver(null);
    expect(store().todayDay()).toBe(TODAY);
  });
});

// ---------------------------------------------------------------------------
// A database that cannot answer (regression: failed migration → seal tap crash)
// ---------------------------------------------------------------------------

/**
 * The root layout deliberately survives a failed migration (`useStartup` is non-fatal), which
 * leaves a database whose tables do not exist. The Today seals render without the database, so a
 * tap then reaches raw SQL — and before `attempt` was added, the thrown SQL error escaped the
 * press handler, which is a hard crash in a release build. Every mutating action must instead
 * degrade to its ordinary refusal value.
 */
describe('a database whose tables are missing', () => {
  function brokenStore() {
    // An in-memory database with NO migrations applied — exactly what a failed migration leaves.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as new (path: string) => { close(): void };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require('drizzle-orm/better-sqlite3') as {
      drizzle: (client: unknown) => never;
    };
    const sqlite = new Database(':memory:');
    const settings = createSettingsStore(
      createMemorySettingsStorage(),
      `tracking-broken-${String(Math.random())}`
    );
    const created = createTrackingStore({
      getDb: () => drizzle(sqlite),
      getSettings: () => settings.getState(),
      now: () => BASE_NOW,
      getTodayDay: () => TODAY,
      scheduleWrite: (run) => run(),
    });
    return { state: () => created.getState(), close: () => sqlite.close() };
  }

  it('every mutating action refuses instead of throwing', () => {
    const broken = brokenStore();
    const state = broken.state();

    expect(state.setStatus(TODAY, 'fajr', 'prayed')).toBe(false);
    expect(state.toggleStatus(TODAY, 'fajr', 'prayed')).toBe(false);
    expect(state.markMadeUp(YESTERDAY, 'asr')).toBe(false);
    expect(state.clearMadeUp(YESTERDAY, 'asr')).toBe(false);
    expect(state.tickQada('fajr')).toBe(false);
    expect(state.forgiveQada()).toBe(false);
    expect(state.undoableForgive()).toBeNull();
    expect(state.undoForgive()).toBe(false);
    expect(state.deleteExemptPeriod(1)).toBe(false);
    // The whole-record writes fall back to what the caller can already see on screen.
    expect(state.setQadaDebts({ fajr: 2, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 })).toEqual(
      emptyDebts()
    );
    expect(state.startExemptPeriod(TODAY)).toEqual([]);
    expect(state.endExemptPeriod(TODAY)).toEqual([]);

    broken.close();
  });

  it('a healthy store still reports real writes as true (attempt is not a blanket false)', () => {
    expect(store().setStatus(TODAY, 'fajr', 'prayed')).toBe(true);
    expect(getPrayerLog(db(), TODAY, 'fajr')?.status).toBe('prayed');
  });
});

// ---------------------------------------------------------------------------
// Tracking modes (D192)
// ---------------------------------------------------------------------------

describe('tracking modes (D192)', () => {
  const simpleFrom = (day: PrayerDay) => harness.settings.getState().setTrackingMode('simple', day);

  it('changes no stored prayer data when switching, in either direction', () => {
    const s = harness.state();
    s.setStatus(YESTERDAY, 'fajr', 'late');
    s.setStatus(YESTERDAY, 'dhuhr', 'missed');
    s.setStatus(TODAY, 'fajr', 'prayed');
    const rows = () => getDayRecords(harness.db.db, YESTERDAY, TODAY, new Set());
    const before = { rows: rows(), debts: getQadaDebts(harness.db.db), stats: s.statsFor(7) };

    simpleFrom(YESTERDAY);
    expect(rows()).toEqual(before.rows);
    expect(getQadaDebts(harness.db.db)).toEqual(before.debts);

    harness.settings.getState().setTrackingMode('detailed', TODAY);
    expect(rows()).toEqual(before.rows);
    expect(harness.state().statsFor(7)).toEqual(before.stats);
  });

  it('counts stats as simple mode shows them, and as stored when asked for detailed', () => {
    const s = harness.state();
    s.setStatus(YESTERDAY, 'fajr', 'late');
    s.setStatus(YESTERDAY, 'dhuhr', 'prayed');
    simpleFrom(YESTERDAY);

    // Yesterday: late → prayed, three unmarked → missed. Today has no location here, so none of
    // its prayers has ended and all five stay unmarked.
    expect(harness.state().statsFor(2)).toMatchObject({
      prayed: 2,
      late: 0,
      missed: 3,
      unlogged: 5,
    });
    expect(harness.state().statsFor(2, 'detailed')).toMatchObject({
      prayed: 1,
      late: 1,
      missed: 0,
      unlogged: 8,
    });
  });

  it('never shows a miss on a day before simple mode began', () => {
    simpleFrom(TODAY);
    expect(harness.state().statsFor(7).missed).toBe(0);
    expect(harness.state().qadaShownDebts()).toEqual(emptyDebts());
  });

  it('starts the lifetime at the day simple mode began, even with nothing logged', () => {
    simpleFrom(YESTERDAY);
    expect(harness.state().statsFor(null)).toMatchObject({ missed: 5, totalTracked: 5 });
  });

  it('one tap stores prayed or nothing — never late or missed', () => {
    const s = harness.state();
    simpleFrom(YESTERDAY);
    const stored = () => getPrayerLog(harness.db.db, YESTERDAY, 'fajr')?.status ?? 'unlogged';

    expect(s.toggleSimpleStatus(YESTERDAY, 'fajr')).toBe(true);
    expect(stored()).toBe('prayed');
    expect(s.toggleSimpleStatus(YESTERDAY, 'fajr')).toBe(true);
    expect(stored()).toBe('unlogged');

    // A late from detailed mode shows as prayed, so the tap clears it.
    s.setStatus(YESTERDAY, 'fajr', 'late');
    s.toggleSimpleStatus(YESTERDAY, 'fajr');
    expect(stored()).toBe('unlogged');

    // A stored miss turns prayed, and its debt goes with it.
    s.setStatus(YESTERDAY, 'fajr', 'missed');
    expect(harness.state().debts.fajr).toBe(1);
    s.toggleSimpleStatus(YESTERDAY, 'fajr');
    expect(stored()).toBe('prayed');
    expect(harness.state().debts.fajr).toBe(0);

    // The future stays locked.
    expect(s.toggleSimpleStatus(TOMORROW, 'fajr')).toBe(false);
  });

  it('shows stored debt + the misses simple mode shows − the ones made up', () => {
    const s = harness.state();
    s.setStatus(YESTERDAY, 'fajr', 'missed'); // stored debt, from detailed mode
    simpleFrom(YESTERDAY);

    // Fajr is stored; Dhuhr…Isha are unmarked and shown as missed.
    expect(harness.state().qadaShownDebts()).toEqual({
      fajr: 1,
      dhuhr: 1,
      asr: 1,
      maghrib: 1,
      isha: 1,
    });
    expect(harness.state().qadaDerivedMisses()).toEqual({
      fajr: 0,
      dhuhr: 1,
      asr: 1,
      maghrib: 1,
      isha: 1,
    });
    expect(harness.state().qadaProgress().total).toBe(5);

    harness.settings.getState().setSimpleQadaMadeUp('dhuhr', 1);
    expect(harness.state().qadaShownDebts().dhuhr).toBe(0);
    expect(harness.state().qadaProgress().total).toBe(4);
    // Nothing reached the table: the stored debt is still just the one Fajr.
    expect(getQadaDebts(harness.db.db)).toEqual({ ...emptyDebts(), fajr: 1 });

    // Marking a shown miss prayed takes it out of the count.
    s.toggleSimpleStatus(YESTERDAY, 'asr');
    expect(harness.state().qadaShownDebts().asr).toBe(0);

    // Back in detailed mode only the stored debt counts; the counter is kept, not applied.
    harness.settings.getState().setTrackingMode('detailed', TODAY);
    expect(harness.state().qadaShownDebts()).toEqual({ ...emptyDebts(), fajr: 1 });
    expect(harness.settings.getState().simpleQadaMadeUp.dhuhr).toBe(1);
  });

  it("measures today's ended prayers from the times, and none it cannot place", () => {
    const location = {
      latitude: 5.6037,
      longitude: -0.187,
      label: 'Accra',
      countryCode: 'GH',
      source: 'auto' as const,
      resolvedAt: 0,
    };
    const settings = {
      ...harness.settings.getState(),
      trackingMode: 'simple' as const,
      simpleModeSince: TODAY,
      location,
    };
    const { times } = computeDayTimes(TODAY, location, settings.calculation);
    const afterAsrStarts = times.asr.getTime() + 60_000;

    expect(modeViewFor(settings, TODAY, afterAsrStarts).closedToday).toEqual(['fajr', 'dhuhr']);
    expect(modeViewFor(settings, TODAY, times.fajr.getTime()).closedToday).toEqual([]);
    expect(modeViewFor({ ...settings, location: null }, TODAY, afterAsrStarts).closedToday).toEqual(
      []
    );
    expect(
      modeViewFor({ ...settings, trackingMode: 'detailed' }, TODAY, afterAsrStarts).closedToday
    ).toEqual([]);
  });
});

describe('optimistic marking (D191)', () => {
  /**
   * A store over the harness database whose deferred writes wait in `pending` until the test
   * runs them — the "next tick" made visible.
   */
  function optimisticStore(getDb: () => ReturnType<typeof db> = db) {
    const pending: (() => void)[] = [];
    const created = createTrackingStore({
      getDb,
      getSettings: () => harness.settings.getState(),
      now: () => BASE_NOW,
      getTodayDay: () => TODAY,
      scheduleWrite: (run) => pending.push(run),
    });
    created.getState().hydrate();
    created.getState().loadDay(TODAY);
    return {
      store: created,
      state: () => created.getState(),
      /** Runs every scheduled write, as the next tick would. */
      tick: () => {
        for (const run of pending.splice(0)) run();
      },
      scheduled: () => pending.length,
    };
  }

  it('shows the tap before the database has it, and writes it on the next tick', () => {
    const o = optimisticStore();
    const revision = o.state().revision;

    expect(o.state().setStatus(TODAY, 'fajr', 'prayed')).toBe(true);

    expect(o.state().dayRecords[TODAY]?.statuses.fajr).toBe('prayed');
    expect(o.state().revision).toBe(revision + 1);
    expect(getPrayerLog(db(), TODAY, 'fajr')).toBeNull();

    o.tick();
    expect(getPrayerLog(db(), TODAY, 'fajr')?.status).toBe('prayed');
  });

  it('moves the qada debt with the tap, to the same numbers the write stores', () => {
    const o = optimisticStore();

    o.state().setStatus(TODAY, 'isha', 'missed');
    expect(o.state().debts.isha).toBe(1);
    expect(getQadaDebts(db()).isha).toBe(0);

    o.tick();
    expect(getQadaDebts(db())).toEqual(o.state().debts);
  });

  it('changes the store once per tap — a successful write does not wake every subscriber again', () => {
    const o = optimisticStore();
    let notified = 0;
    const unsubscribe = o.store.subscribe(() => {
      notified += 1;
    });

    o.state().toggleStatus(TODAY, 'fajr', 'prayed');
    o.tick();
    unsubscribe();

    expect(notified).toBe(1);
  });

  it('keeps quick taps in order, through one scheduled write', () => {
    const o = optimisticStore();

    // Prayed, cleared by the same tap again, then missed — all inside one tick.
    o.state().toggleStatus(TODAY, 'isha', 'prayed');
    o.state().toggleStatus(TODAY, 'isha', 'prayed');
    o.state().toggleStatus(TODAY, 'isha', 'missed');
    o.state().toggleStatus(TODAY, 'fajr', 'prayed');

    expect(o.scheduled()).toBe(1);
    expect(o.state().dayRecords[TODAY]?.statuses.isha).toBe('missed');

    o.tick();
    expect(getPrayerLog(db(), TODAY, 'isha')?.status).toBe('missed');
    expect(getPrayerLog(db(), TODAY, 'fajr')?.status).toBe('prayed');
    expect(getQadaDebts(db()).isha).toBe(1);
    expect(o.state().debts).toEqual(getQadaDebts(db()));
    expect(o.state().dayRecords[TODAY]).toEqual(getDayRecords(db(), TODAY, TODAY)[0]);
  });

  it('covers the simple-mode tap too, reading the queued status rather than the database', () => {
    harness.settings.getState().setTrackingMode('simple', YESTERDAY);
    const o = optimisticStore();

    expect(o.state().toggleSimpleStatus(TODAY, 'fajr')).toBe(true);
    expect(o.state().dayRecords[TODAY]?.statuses.fajr).toBe('prayed');
    expect(getPrayerLog(db(), TODAY, 'fajr')).toBeNull();
    // The second tap, in the same tick, sees the first one and clears it.
    o.state().toggleSimpleStatus(TODAY, 'fajr');
    expect(o.state().dayRecords[TODAY]?.statuses.fajr).toBe('unlogged');

    o.tick();
    expect(getPrayerLog(db(), TODAY, 'fajr')).toBeNull();
  });

  it('writes the queue before any other read of the database', () => {
    const o = optimisticStore();
    o.state().setStatus(TODAY, 'fajr', 'prayed');

    // The streak reads the logs from SQLite; it must see the tap without waiting for the tick.
    expect(o.state().streakSummary().current).toBe(computeStreakFromDb().current);
    expect(getPrayerLog(db(), TODAY, 'fajr')?.status).toBe('prayed');
  });

  it('puts the seal back to what is stored when the write fails, and says so', () => {
    const o = optimisticStore();
    const failed = jest.fn();
    o.state().onWriteFailed(failed);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const queries = require('../db/queries') as typeof import('../db/queries');
    const spy = jest.spyOn(queries, 'setPrayerStatus').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(o.state().setStatus(TODAY, 'isha', 'missed')).toBe(true);
    expect(o.state().debts.isha).toBe(1);
    const revision = o.state().revision;
    o.tick();
    spy.mockRestore();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(o.state().dayRecords[TODAY]?.statuses.isha).toBe('unlogged');
    expect(o.state().debts.isha).toBe(0);
    expect(o.state().revision).toBe(revision + 1);
    expect(getPrayerLog(db(), TODAY, 'isha')).toBeNull();
  });

  it('falls back to how the cache stood before the tap when the database cannot be read back', () => {
    let broken = false;
    const o = optimisticStore(() => {
      if (broken) throw new Error('no such table');
      return db();
    });
    const failed = jest.fn();
    o.state().onWriteFailed(failed);
    const before = o.state().dayRecords[TODAY];

    o.state().setStatus(TODAY, 'fajr', 'missed');
    o.state().setStatus(TODAY, 'dhuhr', 'missed');
    broken = true;

    expect(o.state().flushWrites()).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(o.state().dayRecords[TODAY]).toEqual(before);
    expect(o.state().debts).toEqual(emptyDebts());
  });

  /** The streak the domain computes over what the database holds now. */
  function computeStreakFromDb() {
    return computeStreak(getDayRecords(db(), addDays(TODAY, -30), TODAY), {
      mode: harness.settings.getState().streakMode,
      todayDay: TODAY,
    });
  }
});
