/**
 * Exercises `src/db/queries.ts` against REAL SQL: an in-memory better-sqlite3 database with the
 * committed migrations applied (see `testDb.ts`). expo-sqlite cannot run under Jest, but the
 * schema, the statements and the constraints are identical, so anything proven here is proven
 * for the device.
 */

import { addDays, parseDay } from '../../domain/dates';
import { expandExemptDays } from '../../domain/exemptions';
import { emptyDebts, forgive } from '../../domain/qada';
import { PRAYERS, type ExemptPeriod, type PrayerDay } from '../../domain/types';
import {
  appendQadaEvent,
  clearMadeUp,
  deleteExemptPeriod,
  firstLoggedDay,
  getDayRecord,
  getDayRecords,
  getPrayerLog,
  getQadaDebts,
  insertExemptPeriod,
  lastLoggedDay,
  latestForgiveEvent,
  listExemptPeriods,
  listPrayerLogs,
  listQadaEvents,
  markMadeUp,
  replaceExemptPeriods,
  setPrayerStatus,
  setQadaDebts,
  updateExemptPeriod,
  withTransaction,
} from '../queries';
import { prayerLogs } from '../schema';
import { createTestDb, type TestDb } from './testDb';

let harness: TestDb;

beforeEach(() => {
  harness = createTestDb();
});

afterEach(() => {
  harness.close();
});

/** The Drizzle handle under test. */
function db(): TestDb['db'] {
  return harness.db;
}

/** Raw row count, straight from SQLite — proves deletes really removed rows. */
function rowCount(table: string): number {
  const row = harness.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/** Local-midnight epoch ms for a day, so timestamp assertions are timezone-independent. */
function atMidnight(day: PrayerDay, offsetMs = 0): number {
  return parseDay(day).getTime() + offsetMs;
}

const DAY = '2026-07-02';

// ---------------------------------------------------------------------------
// setPrayerStatus
// ---------------------------------------------------------------------------

describe('setPrayerStatus', () => {
  it('inserts, updates and unlogs — the full round-trip', () => {
    const inserted = setPrayerStatus(db(), DAY, 'fajr', 'prayed', { now: 1000 });
    expect(inserted).toEqual({
      day: DAY,
      prayer: 'fajr',
      status: 'prayed',
      loggedAt: 1000,
      updatedAt: 1000,
    });
    expect(rowCount('prayer_logs')).toBe(1);

    const updated = setPrayerStatus(db(), DAY, 'fajr', 'late', { now: 2000 });
    expect(updated?.status).toBe('late');
    expect(updated?.loggedAt).toBe(1000);
    expect(updated?.updatedAt).toBe(2000);
    expect(rowCount('prayer_logs')).toBe(1);

    const cleared = setPrayerStatus(db(), DAY, 'fajr', 'unlogged', { now: 3000 });
    expect(cleared).toBeNull();
    expect(rowCount('prayer_logs')).toBe(0);
    expect(getPrayerLog(db(), DAY, 'fajr')).toBeNull();
  });

  it('never stores an "unlogged" row, even as the very first write', () => {
    expect(setPrayerStatus(db(), DAY, 'asr', 'unlogged')).toBeNull();
    expect(rowCount('prayer_logs')).toBe(0);
    const statuses = harness.sqlite.prepare('SELECT DISTINCT status FROM prayer_logs').all();
    expect(statuses).toEqual([]);
  });

  it('unlogging a prayer that was never logged is a silent no-op', () => {
    expect(() => setPrayerStatus(db(), DAY, 'isha', 'unlogged')).not.toThrow();
    expect(rowCount('prayer_logs')).toBe(0);
  });

  it('keeps loggedAt at the first write while updatedAt tracks every edit', () => {
    setPrayerStatus(db(), DAY, 'dhuhr', 'prayed', { now: 10 });
    setPrayerStatus(db(), DAY, 'dhuhr', 'late', { now: 20 });
    const final = setPrayerStatus(db(), DAY, 'dhuhr', 'missed', { now: 30 });
    expect(final?.loggedAt).toBe(10);
    expect(final?.updatedAt).toBe(30);
  });

  it('restarts loggedAt after an unlog, because the old row is gone', () => {
    setPrayerStatus(db(), DAY, 'dhuhr', 'prayed', { now: 10 });
    setPrayerStatus(db(), DAY, 'dhuhr', 'unlogged', { now: 20 });
    const relogged = setPrayerStatus(db(), DAY, 'dhuhr', 'prayed', { now: 30 });
    expect(relogged?.loggedAt).toBe(30);
  });

  it('drops the made-up marker when the status leaves "missed"', () => {
    setPrayerStatus(db(), DAY, 'isha', 'missed', { now: 1 });
    markMadeUp(db(), DAY, 'isha', 500);
    expect(getPrayerLog(db(), DAY, 'isha')?.madeUpAt).toBe(500);

    const prayed = setPrayerStatus(db(), DAY, 'isha', 'prayed', { now: 2 });
    expect(prayed?.madeUpAt).toBeUndefined();
  });

  it('keeps the made-up marker while the status stays "missed"', () => {
    setPrayerStatus(db(), DAY, 'isha', 'missed', { now: 1 });
    markMadeUp(db(), DAY, 'isha', 500);
    const again = setPrayerStatus(db(), DAY, 'isha', 'missed', { now: 2 });
    expect(again?.madeUpAt).toBe(500);
  });

  it('rejects malformed days and unknown prayers', () => {
    expect(() => setPrayerStatus(db(), '2026-02-30', 'fajr', 'prayed')).toThrow(RangeError);
    expect(() => setPrayerStatus(db(), 'nope', 'fajr', 'prayed')).toThrow(RangeError);
    // @ts-expect-error deliberately invalid prayer
    expect(() => setPrayerStatus(db(), DAY, 'witr', 'prayed')).toThrow(RangeError);
  });

  it('keeps different prayers and different days independent', () => {
    setPrayerStatus(db(), DAY, 'fajr', 'prayed', { now: 1 });
    setPrayerStatus(db(), DAY, 'asr', 'missed', { now: 1 });
    setPrayerStatus(db(), addDays(DAY, 1), 'fajr', 'late', { now: 1 });
    expect(rowCount('prayer_logs')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// UNIQUE(day, prayer)
// ---------------------------------------------------------------------------

describe('the UNIQUE(day, prayer) constraint', () => {
  it('collapses repeated writes onto a single row', () => {
    for (let i = 0; i < 10; i += 1) {
      setPrayerStatus(db(), DAY, 'fajr', i % 2 === 0 ? 'prayed' : 'late', { now: i });
    }
    expect(rowCount('prayer_logs')).toBe(1);
  });

  it('is enforced by SQLite itself, not just by the query layer', () => {
    const values = {
      day: DAY,
      prayer: 'fajr' as const,
      status: 'prayed' as const,
      madeUpAt: null,
      loggedAt: 1,
      updatedAt: 1,
    };
    db().insert(prayerLogs).values(values).run();
    expect(() => db().insert(prayerLogs).values(values).run()).toThrow(/UNIQUE/i);
  });
});

// ---------------------------------------------------------------------------
// markMadeUp / clearMadeUp
// ---------------------------------------------------------------------------

describe('markMadeUp / clearMadeUp', () => {
  it('converts a missed prayer to made-up and back', () => {
    setPrayerStatus(db(), DAY, 'fajr', 'missed', { now: 100 });

    const madeUp = markMadeUp(db(), DAY, 'fajr', 900);
    expect(madeUp?.status).toBe('missed');
    expect(madeUp?.madeUpAt).toBe(900);
    expect(madeUp?.updatedAt).toBe(900);

    const cleared = clearMadeUp(db(), DAY, 'fajr', { now: 1000 });
    expect(cleared?.madeUpAt).toBeUndefined();
    expect(cleared?.status).toBe('missed');
    expect(cleared?.updatedAt).toBe(1000);
  });

  it('refuses to mark a prayer that is not missed', () => {
    setPrayerStatus(db(), DAY, 'asr', 'prayed', { now: 1 });
    expect(markMadeUp(db(), DAY, 'asr', 900)).toBeNull();
    expect(getPrayerLog(db(), DAY, 'asr')?.madeUpAt).toBeUndefined();
  });

  it('returns null when the prayer is unlogged', () => {
    expect(markMadeUp(db(), DAY, 'isha', 900)).toBeNull();
    expect(clearMadeUp(db(), DAY, 'isha')).toBeNull();
  });

  it('rejects a non-finite timestamp', () => {
    setPrayerStatus(db(), DAY, 'fajr', 'missed', { now: 1 });
    expect(() => markMadeUp(db(), DAY, 'fajr', Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Dense day ranges
// ---------------------------------------------------------------------------

describe('getDayRecords', () => {
  it('returns a record for EVERY day in the range, including days with no rows', () => {
    setPrayerStatus(db(), '2026-07-02', 'fajr', 'prayed', { now: 1 });

    const records = getDayRecords(db(), '2026-07-01', '2026-07-03', new Set());
    expect(records.map((r) => r.day)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);

    expect(records[0]?.statuses).toEqual({
      fajr: 'unlogged',
      dhuhr: 'unlogged',
      asr: 'unlogged',
      maghrib: 'unlogged',
      isha: 'unlogged',
    });
    expect(records[1]?.statuses.fajr).toBe('prayed');
    expect(records[1]?.statuses.dhuhr).toBe('unlogged');
    expect(records[2]?.statuses.isha).toBe('unlogged');
    for (const record of records) expect(record.isExempt).toBe(false);
  });

  it('spans a month boundary without losing or inventing a day', () => {
    setPrayerStatus(db(), '2026-01-31', 'isha', 'late', { now: 1 });
    setPrayerStatus(db(), '2026-02-01', 'fajr', 'prayed', { now: 1 });

    const records = getDayRecords(db(), '2026-01-30', '2026-02-02', new Set());
    expect(records.map((r) => r.day)).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
    expect(records[1]?.statuses.isha).toBe('late');
    expect(records[2]?.statuses.fajr).toBe('prayed');
  });

  it('spans a leap-day February correctly', () => {
    const records = getDayRecords(db(), '2028-02-27', '2028-03-01', new Set());
    expect(records.map((r) => r.day)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  /**
   * Per-prayer resolution on exempt days (spec-exemption amendment 2): the day-level flag
   * overrides `unlogged` and `missed` only. An explicit `prayed`/`late` log — the prayers she
   * performed before the period began — keeps its status. This test
   * replaces the earlier "exempt overrides everything" expectation, which the approved spec
   * explicitly reverses.
   */
  it('lets exempt days override unlogged and missed — never prayed or late', () => {
    setPrayerStatus(db(), '2026-07-02', 'fajr', 'missed', { now: 1 });
    setPrayerStatus(db(), '2026-07-02', 'dhuhr', 'prayed', { now: 1 });
    setPrayerStatus(db(), '2026-07-02', 'asr', 'late', { now: 1 });
    markMadeUp(db(), '2026-07-02', 'fajr', 900);

    const records = getDayRecords(db(), '2026-07-01', '2026-07-02', new Set(['2026-07-02']));
    const exempt = records[1];
    expect(exempt?.isExempt).toBe(true);
    expect(exempt?.statuses).toEqual({
      fajr: 'exempt', // missed → protected
      dhuhr: 'prayed', // explicit log survives
      asr: 'late', // explicit log survives
      maghrib: 'exempt', // unlogged → derived
      isha: 'exempt',
    });
    // The hidden miss hides its made-up marker with it.
    expect(exempt?.madeUp).toEqual({});
    expect(records[0]?.isExempt).toBe(false);

    // The underlying rows survive, so un-marking the exemption restores them.
    expect(rowCount('prayer_logs')).toBe(3);
    const unresolved = getDayRecords(db(), '2026-07-02', '2026-07-02', new Set());
    expect(unresolved[0]?.statuses.fajr).toBe('missed');
    expect(unresolved[0]?.madeUp).toEqual({ fajr: true });
  });

  it('accepts the exempt set produced by domain/exemptions', () => {
    const periods: ExemptPeriod[] = [
      { startDay: '2026-07-03', endDay: '2026-07-05', createdAt: 1 },
    ];
    const exemptDays = expandExemptDays(periods, '2026-07-01', '2026-07-07');

    setPrayerStatus(db(), '2026-07-04', 'asr', 'missed', { now: 1 });
    const records = getDayRecords(db(), '2026-07-01', '2026-07-07', exemptDays);

    expect(records.filter((r) => r.isExempt).map((r) => r.day)).toEqual([
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
    expect(records[3]?.statuses.asr).toBe('exempt');
  });

  it('surfaces made-up markers on non-exempt days', () => {
    setPrayerStatus(db(), DAY, 'fajr', 'prayed', { now: 1 });
    setPrayerStatus(db(), DAY, 'isha', 'missed', { now: 1 });
    markMadeUp(db(), DAY, 'isha', 900);

    const record = getDayRecords(db(), DAY, DAY, new Set())[0];
    expect(record?.madeUp).toEqual({ isha: true });
    expect(record?.statuses.isha).toBe('missed');
  });

  it('returns an empty array when the range is inverted', () => {
    expect(getDayRecords(db(), '2026-07-05', '2026-07-01', new Set())).toEqual([]);
  });

  it('returns exactly one record for a single-day range', () => {
    expect(getDayRecords(db(), DAY, DAY, new Set())).toHaveLength(1);
  });

  it('defaults to no exempt days when the set is omitted', () => {
    setPrayerStatus(db(), DAY, 'fajr', 'prayed', { now: 1 });
    expect(getDayRecords(db(), DAY, DAY)[0]?.statuses.fajr).toBe('prayed');
  });

  it('rejects malformed range ends', () => {
    expect(() => getDayRecords(db(), 'nope', DAY, new Set())).toThrow(RangeError);
    expect(() => getDayRecords(db(), DAY, '2026-13-01', new Set())).toThrow(RangeError);
  });

  it('ignores rows outside the requested range', () => {
    setPrayerStatus(db(), '2026-06-30', 'fajr', 'prayed', { now: 1 });
    setPrayerStatus(db(), '2026-07-04', 'fajr', 'prayed', { now: 1 });
    const records = getDayRecords(db(), '2026-07-01', '2026-07-03', new Set());
    expect(records.every((r) => r.statuses.fajr === 'unlogged')).toBe(true);
  });
});

describe('getDayRecord', () => {
  it('matches the single-day slice of getDayRecords', () => {
    setPrayerStatus(db(), DAY, 'dhuhr', 'late', { now: 1 });
    expect(getDayRecord(db(), DAY, new Set())).toEqual(getDayRecords(db(), DAY, DAY, new Set())[0]);
  });

  it('resolves an exempt day per prayer: explicit logs kept, the rest derived', () => {
    setPrayerStatus(db(), DAY, 'dhuhr', 'late', { now: 1 });
    setPrayerStatus(db(), DAY, 'asr', 'missed', { now: 1 });
    const record = getDayRecord(db(), DAY, new Set([DAY]));
    expect(record.isExempt).toBe(true);
    expect(record.statuses.dhuhr).toBe('late');
    expect(record.statuses.asr).toBe('exempt');
    expect(record.statuses.fajr).toBe('exempt');
  });

  it('returns an all-unlogged record for a day with nothing stored', () => {
    const record = getDayRecord(db(), DAY);
    expect(record.day).toBe(DAY);
    expect(record.isExempt).toBe(false);
    for (const prayer of PRAYERS) expect(record.statuses[prayer]).toBe('unlogged');
  });
});

// ---------------------------------------------------------------------------
// Sparse reads
// ---------------------------------------------------------------------------

describe('listPrayerLogs / firstLoggedDay / lastLoggedDay', () => {
  it('lists only stored logs, ordered by day then canonical prayer order', () => {
    setPrayerStatus(db(), '2026-07-02', 'isha', 'prayed', { now: 1 });
    setPrayerStatus(db(), '2026-07-02', 'fajr', 'prayed', { now: 1 });
    setPrayerStatus(db(), '2026-07-01', 'asr', 'late', { now: 1 });

    const logs = listPrayerLogs(db(), '2026-07-01', '2026-07-02');
    expect(logs.map((l) => `${l.day}/${l.prayer}`)).toEqual([
      '2026-07-01/asr',
      '2026-07-02/fajr',
      '2026-07-02/isha',
    ]);
  });

  it('reports the first and last logged day, or null on an empty database', () => {
    expect(firstLoggedDay(db())).toBeNull();
    expect(lastLoggedDay(db())).toBeNull();

    setPrayerStatus(db(), '2026-07-09', 'fajr', 'prayed', { now: 1 });
    setPrayerStatus(db(), '2026-05-01', 'fajr', 'prayed', { now: 1 });
    expect(firstLoggedDay(db())).toBe('2026-05-01');
    expect(lastLoggedDay(db())).toBe('2026-07-09');
  });
});

// ---------------------------------------------------------------------------
// Exempt periods
// ---------------------------------------------------------------------------

describe('exempt periods', () => {
  it('inserts, lists, updates and deletes', () => {
    const inserted = insertExemptPeriod(db(), {
      startDay: '2026-07-03',
      endDay: null,
      createdAt: 111,
    });
    expect(inserted.id).toEqual(expect.any(Number));
    expect(inserted).toMatchObject({ startDay: '2026-07-03', endDay: null, createdAt: 111 });

    expect(listExemptPeriods(db())).toEqual([inserted]);

    const closed = updateExemptPeriod(db(), inserted.id as number, { endDay: '2026-07-07' });
    expect(closed).toMatchObject({ startDay: '2026-07-03', endDay: '2026-07-07', createdAt: 111 });

    expect(deleteExemptPeriod(db(), inserted.id as number)).toBe(true);
    expect(listExemptPeriods(db())).toEqual([]);
    expect(rowCount('exempt_periods')).toBe(0);
  });

  it('orders the list by start day', () => {
    insertExemptPeriod(db(), { startDay: '2026-08-01', endDay: null, createdAt: 2 });
    insertExemptPeriod(db(), { startDay: '2026-06-01', endDay: '2026-06-05', createdAt: 1 });
    expect(listExemptPeriods(db()).map((p) => p.startDay)).toEqual(['2026-06-01', '2026-08-01']);
  });

  it('can reopen a closed period', () => {
    const period = insertExemptPeriod(db(), {
      startDay: '2026-07-03',
      endDay: '2026-07-05',
      createdAt: 1,
    });
    const reopened = updateExemptPeriod(db(), period.id as number, { endDay: null });
    expect(reopened?.endDay).toBeNull();
  });

  it('returns null / false for an unknown id', () => {
    expect(updateExemptPeriod(db(), 42, { endDay: '2026-07-07' })).toBeNull();
    expect(deleteExemptPeriod(db(), 42)).toBe(false);
  });

  it('rejects an end day before the start day, on insert and on update', () => {
    expect(() =>
      insertExemptPeriod(db(), { startDay: '2026-07-05', endDay: '2026-07-01', createdAt: 1 })
    ).toThrow(RangeError);

    const period = insertExemptPeriod(db(), {
      startDay: '2026-07-05',
      endDay: null,
      createdAt: 1,
    });
    expect(() => updateExemptPeriod(db(), period.id as number, { endDay: '2026-07-01' })).toThrow(
      RangeError
    );
    expect(listExemptPeriods(db())[0]?.endDay).toBeNull();
  });

  it('rejects malformed days and ids', () => {
    expect(() =>
      insertExemptPeriod(db(), { startDay: '2026-02-30', endDay: null, createdAt: 1 })
    ).toThrow(RangeError);
    expect(() => deleteExemptPeriod(db(), 0)).toThrow(RangeError);
    expect(() => deleteExemptPeriod(db(), 1.5)).toThrow(RangeError);
  });

  it('replaces the whole table atomically', () => {
    insertExemptPeriod(db(), { startDay: '2026-01-01', endDay: '2026-01-03', createdAt: 1 });

    const replaced = replaceExemptPeriods(db(), [
      { startDay: '2026-03-01', endDay: '2026-03-04', createdAt: 2 },
      { startDay: '2026-04-01', endDay: null, createdAt: 3 },
    ]);
    expect(replaced).toHaveLength(2);
    expect(listExemptPeriods(db()).map((p) => p.startDay)).toEqual(['2026-03-01', '2026-04-01']);
    expect(rowCount('exempt_periods')).toBe(2);
  });

  it('leaves the table untouched when a replacement entry is invalid', () => {
    insertExemptPeriod(db(), { startDay: '2026-01-01', endDay: '2026-01-03', createdAt: 1 });
    expect(() =>
      replaceExemptPeriods(db(), [
        { startDay: '2026-03-01', endDay: null, createdAt: 2 },
        { startDay: 'nope', endDay: null, createdAt: 3 },
      ])
    ).toThrow(RangeError);
    expect(listExemptPeriods(db()).map((p) => p.startDay)).toEqual(['2026-01-01']);
  });

  it('feeds domain/exemptions, which feeds getDayRecords', () => {
    replaceExemptPeriods(db(), [{ startDay: '2026-09-01', endDay: '2026-09-02', createdAt: 1 }]);
    const exemptDays = expandExemptDays(listExemptPeriods(db()), '2026-08-31', '2026-09-03');
    const records = getDayRecords(db(), '2026-08-31', '2026-09-03', exemptDays);
    expect(records.map((r) => r.isExempt)).toEqual([false, true, true, false]);
  });
});

// ---------------------------------------------------------------------------
// Qada debts
// ---------------------------------------------------------------------------

describe('qada debts', () => {
  it('defaults every counter to 0 on an empty database', () => {
    expect(getQadaDebts(db())).toEqual(emptyDebts());
    expect(rowCount('qada_debts')).toBe(0);
  });

  it('survives a write/read round-trip', () => {
    const debts = { fajr: 3, dhuhr: 0, asr: 12, maghrib: 1, isha: 40 };
    expect(setQadaDebts(db(), debts, { now: 5 })).toEqual(debts);
    expect(getQadaDebts(db())).toEqual(debts);
    expect(rowCount('qada_debts')).toBe(5);
  });

  it('upserts rather than duplicating rows', () => {
    setQadaDebts(db(), { fajr: 1, dhuhr: 1, asr: 1, maghrib: 1, isha: 1 }, { now: 1 });
    setQadaDebts(db(), { fajr: 2, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 }, { now: 2 });
    expect(rowCount('qada_debts')).toBe(5);
    expect(getQadaDebts(db())).toEqual({ fajr: 2, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 });
  });

  it('sanitises through domain/qada before storing', () => {
    const stored = setQadaDebts(
      db(),
      { fajr: -5, dhuhr: 2.7, asr: 0, maghrib: 0, isha: 0 },
      { now: 1 }
    );
    expect(stored.fajr).toBe(0);
    expect(stored.dhuhr).toBe(2);
    expect(getQadaDebts(db())).toEqual({ fajr: 0, dhuhr: 2, asr: 0, maghrib: 0, isha: 0 });
  });

  it('reads a partially populated table as zeroes for the missing prayers', () => {
    harness.sqlite
      .prepare('INSERT INTO qada_debts (prayer, count, updated_at) VALUES (?, ?, ?)')
      .run('asr', 7, 1);
    expect(getQadaDebts(db())).toEqual({ fajr: 0, dhuhr: 0, asr: 7, maghrib: 0, isha: 0 });
  });

  it('stamps updated_at', () => {
    setQadaDebts(db(), emptyDebts(), { now: 4242 });
    const row = harness.sqlite
      .prepare('SELECT updated_at AS at FROM qada_debts WHERE prayer = ?')
      .get('fajr') as { at: number };
    expect(row.at).toBe(4242);
  });
});

// ---------------------------------------------------------------------------
// Qada events
// ---------------------------------------------------------------------------

describe('qada events', () => {
  it('appends events and returns them with an assigned id', () => {
    const event = appendQadaEvent(db(), { type: 'tick', prayer: 'fajr', delta: -1, at: 1000 });
    expect(event.id).toEqual(expect.any(Number));
    expect(event).toMatchObject({ type: 'tick', prayer: 'fajr', delta: -1, at: 1000 });
    expect(event.meta).toBeUndefined();
  });

  it('round-trips the JSON meta snapshot', () => {
    const { event } = forgive({ fajr: 2, dhuhr: 1, asr: 0, maghrib: 0, isha: 3 }, new Date(1000));
    const stored = appendQadaEvent(db(), event);
    expect(stored.delta).toBe(-6);
    expect(stored.meta).toEqual(event.meta);
    expect(stored.prayer).toBeNull();
  });

  it('reads a corrupt meta payload as absent instead of throwing', () => {
    harness.sqlite
      .prepare('INSERT INTO qada_events (type, prayer, delta, at, meta) VALUES (?, ?, ?, ?, ?)')
      .run('add', null, 1, 1000, '{not json');
    expect(listQadaEvents(db())[0]?.meta).toBeUndefined();
  });

  it('lists newest first', () => {
    appendQadaEvent(db(), { type: 'add', prayer: 'fajr', delta: 1, at: 100 });
    appendQadaEvent(db(), { type: 'tick', prayer: 'fajr', delta: -1, at: 300 });
    appendQadaEvent(db(), { type: 'tick', prayer: 'asr', delta: -1, at: 200 });
    expect(listQadaEvents(db()).map((e) => e.at)).toEqual([300, 200, 100]);
  });

  it('filters by type', () => {
    appendQadaEvent(db(), { type: 'add', prayer: 'fajr', delta: 1, at: 100 });
    appendQadaEvent(db(), { type: 'tick', prayer: 'fajr', delta: -1, at: 200 });
    appendQadaEvent(db(), { type: 'manualSet', prayer: null, delta: 0, at: 300 });

    expect(listQadaEvents(db(), { types: ['tick'] }).map((e) => e.type)).toEqual(['tick']);
    expect(listQadaEvents(db(), { types: ['tick', 'add'] })).toHaveLength(2);
    expect(listQadaEvents(db(), { types: [] })).toEqual([]);
  });

  it('filters by sinceDay using local midnight', () => {
    appendQadaEvent(db(), {
      type: 'tick',
      prayer: 'fajr',
      delta: -1,
      at: atMidnight('2026-07-01', -1),
    });
    appendQadaEvent(db(), { type: 'tick', prayer: 'asr', delta: -1, at: atMidnight('2026-07-01') });
    appendQadaEvent(db(), {
      type: 'tick',
      prayer: 'isha',
      delta: -1,
      at: atMidnight('2026-07-03', 60_000),
    });

    const since = listQadaEvents(db(), { sinceDay: '2026-07-01' });
    expect(since.map((e) => e.prayer)).toEqual(['isha', 'asr']);
  });

  it('caps the result with limit, keeping the most recent', () => {
    for (let i = 1; i <= 5; i += 1) {
      appendQadaEvent(db(), { type: 'tick', prayer: 'fajr', delta: -1, at: i * 100 });
    }
    expect(listQadaEvents(db(), { limit: 2 }).map((e) => e.at)).toEqual([500, 400]);
  });

  it('combines every filter', () => {
    appendQadaEvent(db(), { type: 'add', prayer: 'fajr', delta: 1, at: atMidnight('2026-07-02') });
    appendQadaEvent(db(), {
      type: 'tick',
      prayer: 'fajr',
      delta: -1,
      at: atMidnight('2026-07-02', 1),
    });
    appendQadaEvent(db(), { type: 'tick', prayer: 'asr', delta: -1, at: atMidnight('2026-07-03') });
    appendQadaEvent(db(), {
      type: 'tick',
      prayer: 'isha',
      delta: -1,
      at: atMidnight('2026-06-01'),
    });

    const result = listQadaEvents(db(), { sinceDay: '2026-07-02', types: ['tick'], limit: 1 });
    expect(result).toHaveLength(1);
    expect(result[0]?.prayer).toBe('asr');
  });

  it('rejects invalid events and filters', () => {
    // @ts-expect-error deliberately invalid event type
    expect(() => appendQadaEvent(db(), { type: 'nope', prayer: null, delta: 1, at: 1 })).toThrow(
      RangeError
    );
    expect(() =>
      appendQadaEvent(db(), { type: 'tick', prayer: 'fajr', delta: 1.5, at: 1 })
    ).toThrow(RangeError);
    expect(() =>
      appendQadaEvent(db(), { type: 'tick', prayer: 'fajr', delta: -1, at: Number.NaN })
    ).toThrow(RangeError);
    expect(() => listQadaEvents(db(), { limit: 0 })).toThrow(RangeError);
    expect(() => listQadaEvents(db(), { sinceDay: 'nope' })).toThrow(RangeError);
    // @ts-expect-error deliberately invalid filter type
    expect(() => listQadaEvents(db(), { types: ['nope'] })).toThrow(RangeError);
  });
});

describe('latestForgiveEvent', () => {
  it('is null before anything is forgiven', () => {
    expect(latestForgiveEvent(db())).toBeNull();
  });

  it('returns the most recent forgive event, with its snapshot intact', () => {
    appendQadaEvent(
      db(),
      forgive({ fajr: 1, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, new Date(100)).event
    );
    appendQadaEvent(db(), { type: 'tick', prayer: 'fajr', delta: -1, at: 150 });
    const second = forgive({ fajr: 0, dhuhr: 5, asr: 0, maghrib: 0, isha: 0 }, new Date(200));
    appendQadaEvent(db(), second.event);

    const latest = latestForgiveEvent(db());
    expect(latest?.at).toBe(200);
    expect(latest?.type).toBe('forgive');
    expect(latest?.meta).toEqual(second.event.meta);
  });

  it('ignores forgiveUndo events when picking the latest forgive', () => {
    appendQadaEvent(db(), forgive(emptyDebts(), new Date(100)).event);
    appendQadaEvent(db(), { type: 'forgiveUndo', prayer: null, delta: 0, at: 300 });
    expect(latestForgiveEvent(db())?.at).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

describe('withTransaction', () => {
  it('commits a log and its qada side effect together', () => {
    withTransaction(db(), (tx) => {
      setPrayerStatus(tx, DAY, 'fajr', 'missed', { now: 1 });
      setQadaDebts(tx, { fajr: 1, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, { now: 1 });
      appendQadaEvent(tx, { type: 'add', prayer: 'fajr', delta: 1, at: 1 });
    });

    expect(getPrayerLog(db(), DAY, 'fajr')?.status).toBe('missed');
    expect(getQadaDebts(db()).fajr).toBe(1);
    expect(listQadaEvents(db())).toHaveLength(1);
  });

  it('rolls the whole unit of work back when the callback throws', () => {
    setQadaDebts(db(), { fajr: 4, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, { now: 1 });

    expect(() =>
      withTransaction(db(), (tx) => {
        setPrayerStatus(tx, DAY, 'fajr', 'missed', { now: 2 });
        setQadaDebts(tx, { fajr: 5, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, { now: 2 });
        throw new Error('side effect failed');
      })
    ).toThrow('side effect failed');

    expect(getPrayerLog(db(), DAY, 'fajr')).toBeNull();
    expect(getQadaDebts(db()).fajr).toBe(4);
    expect(rowCount('prayer_logs')).toBe(0);
  });

  it('returns the callback result and supports nesting via savepoints', () => {
    const total = withTransaction(db(), (tx) =>
      withTransaction(tx, (inner) => {
        setPrayerStatus(inner, DAY, 'asr', 'prayed', { now: 1 });
        return listPrayerLogs(inner, DAY, DAY).length;
      })
    );
    expect(total).toBe(1);
    expect(rowCount('prayer_logs')).toBe(1);
  });
});
