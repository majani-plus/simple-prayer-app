/**
 * Tests for the drain — the join between the queue a notification button writes to and the
 * tracking store that owns what a logged prayer means.
 *
 * These run against **real SQL** (an in-memory better-sqlite3 database with the committed
 * migrations) and a **real tracking store**, on purpose. The whole claim of this feature is that a
 * mark made from a notification is written by exactly the code a tap on the seal would have used;
 * a mocked store would assert that the drain calls a function, which is not the same claim.
 */

import { createTestDb, type TestDb } from '../db/__tests__/testDb';
import { getPrayerLog, getQadaDebts } from '../db/queries';
import { emptyDebts } from '../domain/qada';
import type { PrayerDay } from '../domain/types';
import {
  createMemorySettingsStorage,
  createSettingsStore,
} from '../stores/settingsStore';
import { createTrackingStore, type TrackingStore } from '../stores/trackingStore';
import { drainPendingMarks, type PendingMarksQueue } from './pendingMarks';

jest.mock('react-native-mmkv', () => {
  const instances = new Map<string, Map<string, string>>();
  return {
    createMMKV: ({ id }: { id: string }) => {
      let values = instances.get(id);
      if (values === undefined) {
        values = new Map();
        instances.set(id, values);
      }
      const values_ = values;
      return {
        id,
        set: (key: string, value: string) => void values_.set(key, value),
        getString: (key: string) => values_.get(key),
        getBoolean: () => undefined,
        getNumber: () => undefined,
        remove: (key: string) => void values_.delete(key),
        delete: (key: string) => void values_.delete(key),
        clearAll: () => void values_.clear(),
      };
    },
  };
});

const TODAY: PrayerDay = '2026-08-21';
const YESTERDAY: PrayerDay = '2026-08-20';

let db: TestDb;
let store: ReturnType<typeof createTrackingStore>;
let settings: ReturnType<typeof createSettingsStore>;

function tracking(): TrackingStore {
  return store.getState();
}

/**
 * A queue that hands back whatever it was given and remembers what was acknowledged — without
 * removing it, so a test can drain the same batch twice exactly as a crashed drain would.
 */
function fakeQueue(entries: unknown[]): PendingMarksQueue & { acknowledged: string[] } {
  const acknowledged: string[] = [];
  return {
    acknowledged,
    read: async () => entries,
    acknowledge: async (ids) => {
      acknowledged.push(...ids);
    },
  };
}

beforeEach(() => {
  db = createTestDb();
  settings = createSettingsStore(
    createMemorySettingsStorage(),
    `pending-marks-test-${String(Math.random())}`
  );
  store = createTrackingStore({
    getDb: () => db.db,
    getSettings: () => settings.getState(),
    getTodayDay: () => TODAY,
  });
  store.getState().hydrate();
});

afterEach(() => {
  db.close();
});

describe('drainPendingMarks', () => {
  it('writes a queued mark through the ordinary logging path', async () => {
    const queue = fakeQueue([
      { id: 'a', day: TODAY, prayer: 'maghrib', decidedAt: 1_000 },
    ]);

    const outcome = await drainPendingMarks({ tracking: tracking(), queue });

    expect(outcome).toMatchObject({ read: 1, applied: 1, skipped: 0, failed: 0 });
    // In the database, not just in the store's cache.
    expect(getPrayerLog(db.db, TODAY, 'maghrib')?.status).toBe('prayed');
    // And visible to the screens, which read the cache.
    expect(tracking().dayRecordFor(TODAY).statuses.maghrib).toBe('prayed');
  });

  it('acknowledges what it applied, so the queue does not grow', async () => {
    const queue = fakeQueue([{ id: 'a', day: TODAY, prayer: 'fajr', decidedAt: 1_000 }]);

    await drainPendingMarks({ tracking: tracking(), queue });

    expect(queue.acknowledged).toEqual(['a']);
  });

  it('has one effect when the same queue is drained twice', async () => {
    const queue = fakeQueue([{ id: 'a', day: TODAY, prayer: 'asr', decidedAt: 1_000 }]);

    const first = await drainPendingMarks({ tracking: tracking(), queue });
    const second = await drainPendingMarks({ tracking: tracking(), queue });

    expect(first.applied).toBe(1);
    // The replay finds the work already done and does nothing — which is what makes it safe to
    // acknowledge only after the writes land.
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(1);
    expect(getPrayerLog(db.db, TODAY, 'asr')?.status).toBe('prayed');
    expect(getQadaDebts(db.db)).toEqual(emptyDebts());
  });

  it('never counts a qada debt, however often it replays', async () => {
    // A missed prayer is the only thing that moves the counters, and the queue can only ever say
    // "prayed" — so paying one off, or owing one, is not reachable from here at all.
    tracking().setStatus(YESTERDAY, 'isha', 'missed');
    tracking().flushWrites();
    const before = getQadaDebts(db.db);
    const queue = fakeQueue([{ id: 'a', day: TODAY, prayer: 'isha', decidedAt: 1_000 }]);

    await drainPendingMarks({ tracking: tracking(), queue });
    await drainPendingMarks({ tracking: tracking(), queue });

    expect(getQadaDebts(db.db)).toEqual(before);
  });

  it('writes nothing when a mark and its undo arrive together', async () => {
    const queue = fakeQueue([
      { id: 'a', day: TODAY, prayer: 'dhuhr', decidedAt: 1_000 },
      { id: 'b', day: TODAY, prayer: 'dhuhr', decidedAt: 1_020, annuls: 'a' },
    ]);

    const outcome = await drainPendingMarks({ tracking: tracking(), queue });

    expect(outcome.applied).toBe(0);
    expect(getPrayerLog(db.db, TODAY, 'dhuhr')).toBeNull();
    // Both are still acknowledged: an entry left behind would be re-resolved for ever.
    expect(queue.acknowledged.slice().sort()).toEqual(['a', 'b']);
  });

  it('clears a prayer when the undo arrives after its mark was already applied', async () => {
    await drainPendingMarks({
      tracking: tracking(),
      queue: fakeQueue([{ id: 'a', day: TODAY, prayer: 'dhuhr', decidedAt: 1_000 }]),
    });
    expect(getPrayerLog(db.db, TODAY, 'dhuhr')?.status).toBe('prayed');

    const outcome = await drainPendingMarks({
      tracking: tracking(),
      queue: fakeQueue([{ id: 'b', day: TODAY, prayer: 'dhuhr', decidedAt: 1_020, annuls: 'a' }]),
    });

    expect(outcome.applied).toBe(1);
    // Unlogging removes the row entirely (D06: nothing is written that the user did not assert).
    expect(getPrayerLog(db.db, TODAY, 'dhuhr')).toBeNull();
    expect(tracking().dayRecordFor(TODAY).statuses.dhuhr).toBe('unlogged');
  });

  it('leaves a prayer the user marked differently in the app alone', async () => {
    // Pressed "Prayed" at Maghrib, never opened the app, then corrected the day in History.
    tracking().setStatus(TODAY, 'maghrib', 'late');
    const queue = fakeQueue([{ id: 'a', day: TODAY, prayer: 'maghrib', decidedAt: 1_000 }]);

    const outcome = await drainPendingMarks({ tracking: tracking(), queue });

    expect(outcome).toMatchObject({ applied: 0, skipped: 1 });
    expect(getPrayerLog(db.db, TODAY, 'maghrib')?.status).toBe('late');
  });

  it('does not undo a prayer the user has since edited', async () => {
    tracking().setStatus(TODAY, 'asr', 'late');
    const queue = fakeQueue([
      { id: 'b', day: TODAY, prayer: 'asr', decidedAt: 1_020, annuls: 'a' },
    ]);

    await drainPendingMarks({ tracking: tracking(), queue });

    expect(getPrayerLog(db.db, TODAY, 'asr')?.status).toBe('late');
  });

  it('files a mark under the day its notification named, not the day it is drained on', async () => {
    // Pressed at Isha yesterday; the app is opened today. The prayer day travelled with the entry.
    const queue = fakeQueue([{ id: 'a', day: YESTERDAY, prayer: 'isha', decidedAt: 1_000 }]);

    await drainPendingMarks({
      tracking: tracking(),
      queue,
      resolveDay: () => TODAY,
    });

    expect(getPrayerLog(db.db, YESTERDAY, 'isha')?.status).toBe('prayed');
    expect(getPrayerLog(db.db, TODAY, 'isha')).toBeNull();
  });

  it('dates an entry with no day of its own from when the user decided', async () => {
    const decidedAt = 1_755_000_000_000;
    const seen: number[] = [];
    const queue = fakeQueue([{ id: 'a', prayer: 'isha', decidedAt }]);

    await drainPendingMarks({
      tracking: tracking(),
      queue,
      resolveDay: (instant) => {
        seen.push(instant.getTime());
        return YESTERDAY;
      },
    });

    // The instant asked about is the press, never `Date.now()` at the drain.
    expect(seen).toEqual([decidedAt]);
    expect(getPrayerLog(db.db, YESTERDAY, 'isha')?.status).toBe('prayed');
  });

  it('applies a mark whose prayer day is long past', async () => {
    const queue = fakeQueue([
      { id: 'a', day: '2026-07-04', prayer: 'fajr', decidedAt: 1_000 },
    ]);

    const outcome = await drainPendingMarks({ tracking: tracking(), queue });

    expect(outcome.applied).toBe(1);
    expect(getPrayerLog(db.db, '2026-07-04', 'fajr')?.status).toBe('prayed');
  });

  it('does nothing at all on an empty queue', async () => {
    const queue = fakeQueue([]);

    const outcome = await drainPendingMarks({ tracking: tracking(), queue });

    expect(outcome).toEqual({ read: 0, applied: 0, skipped: 0, failed: 0, acknowledged: 0 });
    expect(queue.acknowledged).toEqual([]);
  });

  it('lets a POLICY refusal go as skipped — a clock-skewed future-day entry must not jam the batch', async () => {
    // The store's only `false` is a future day (D06: never write what the user did not assert,
    // and their assertion was "now", not that date). Holding it used to block every other
    // entry's acknowledgment for days.
    const queue = fakeQueue([{ id: 'a', day: TODAY, prayer: 'fajr', decidedAt: 1_000 }]);
    const refusing = {
      dayRecordFor: tracking().dayRecordFor,
      toggleStatus: () => false,
      flushWrites: () => true,
    };

    const outcome = await drainPendingMarks({ tracking: refusing, queue });

    expect(outcome).toMatchObject({ applied: 0, skipped: 1, failed: 0, acknowledged: 1 });
    expect(queue.acknowledged).toEqual(['a']);
  });

  it('keeps the batch when a write THROWS — that is the database in trouble, not the entry', async () => {
    const queue = fakeQueue([{ id: 'a', day: TODAY, prayer: 'fajr', decidedAt: 1_000 }]);
    const failing = {
      dayRecordFor: tracking().dayRecordFor,
      toggleStatus: () => {
        throw new Error('db locked');
      },
      flushWrites: () => true,
    };

    const outcome = await drainPendingMarks({ tracking: failing, queue });

    expect(outcome).toMatchObject({ failed: 1, acknowledged: 0 });
    expect(queue.acknowledged).toEqual([]);
  });

  it('keeps the batch when the deferred write fails after the tap was accepted (D191)', async () => {
    const queue = fakeQueue([{ id: 'a', day: TODAY, prayer: 'fajr', decidedAt: 1_000 }]);
    const lateFailure = {
      dayRecordFor: tracking().dayRecordFor,
      toggleStatus: () => true,
      flushWrites: () => false,
    };

    const outcome = await drainPendingMarks({ tracking: lateFailure, queue });

    expect(outcome).toMatchObject({ acknowledged: 0 });
    expect(queue.acknowledged).toEqual([]);
  });

  it('survives a queue that cannot be read', async () => {
    const outcome = await drainPendingMarks({
      tracking: tracking(),
      queue: {
        read: async () => {
          throw new Error('no native module');
        },
        acknowledge: async () => undefined,
      },
    });

    expect(outcome).toEqual({ read: 0, applied: 0, skipped: 0, failed: 0, acknowledged: 0 });
  });
});
