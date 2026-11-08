/**
 * Tests for `startPendingMarkDrain`, the controller `usePendingMarks` is a five-line wrapper
 * around — no renderer, no `act`, and therefore no argument about when React flushed what. Same
 * shape as `useNotificationSync.test.ts`, and for the same reason.
 *
 * What is under test here is *when* a drain happens, not what it writes; that is
 * `services/pendingMarks.test.ts`, against real SQL.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import type { DayRecord, PrayerDay } from '@/domain/types';
import i18n, { initI18n } from '@/i18n';
import type { PendingMarksTracking } from '@/services/pendingMarks';
import { startPendingMarkDrain } from './usePendingMarks';

// Under Jest there is no native module, so the copy would never be pushed and the drain would
// never see a queue. The mock is only "the binary has the module"; everything else is real.
jest.mock('../../modules/prayer-marks', () => ({
  ...jest.requireActual('../../modules/prayer-marks'),
  isSupported: () => true,
  configure: async () => undefined,
}));

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

const TODAY: PrayerDay = '2026-08-21';

/** A tracking surface that records what it was asked to write and always succeeds. */
function fakeTracking(): PendingMarksTracking & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    dayRecordFor: (day) =>
      ({
        day,
        statuses: { fajr: 'unlogged', dhuhr: 'unlogged', asr: 'unlogged', maghrib: 'unlogged', isha: 'unlogged' },
        madeUp: {},
        isExempt: false,
      }) as DayRecord,
    toggleStatus: (day, prayer) => {
      written.push(`${day}:${prayer}`);
      return true;
    },
    flushWrites: () => true,
  };
}

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Lets every queued microtask (the drain's promise chain) settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('startPendingMarkDrain', () => {
  it('drains as soon as it starts — the app was opened because the button was pressed', async () => {
    const tracking = fakeTracking();
    const stop = startPendingMarkDrain({
      tracking,
      queue: {
        read: async () => [{ id: 'a', day: TODAY, prayer: 'maghrib', decidedAt: 1 }],
        acknowledge: async () => undefined,
      },
    });
    await settle();
    stop();

    expect(tracking.written).toEqual([`${TODAY}:maghrib`]);
  });

  it('drains again when the app comes back to the foreground', async () => {
    const tracking = fakeTracking();
    let entries: unknown[] = [];
    const stop = startPendingMarkDrain({
      tracking,
      queue: { read: async () => entries, acknowledge: async () => undefined },
    });
    await settle();

    // Pressed from the shade while the app sat in the background.
    entries = [{ id: 'a', day: TODAY, prayer: 'asr', decidedAt: 1 }];
    for (const listener of appStateListeners) listener('active');
    await settle();
    stop();

    expect(tracking.written).toEqual([`${TODAY}:asr`]);
  });

  it('ignores every app state but active', async () => {
    const tracking = fakeTracking();
    const reads: number[] = [];
    const stop = startPendingMarkDrain({
      tracking,
      queue: {
        read: async () => {
          reads.push(1);
          return [];
        },
        acknowledge: async () => undefined,
      },
    });
    await settle();

    for (const listener of appStateListeners) {
      listener('background');
      listener('inactive');
    }
    await settle();
    stop();

    expect(reads).toHaveLength(1);
  });

  it('stops listening once torn down', async () => {
    const tracking = fakeTracking();
    const reads: number[] = [];
    const stop = startPendingMarkDrain({
      tracking,
      queue: {
        read: async () => {
          reads.push(1);
          return [];
        },
        acknowledge: async () => undefined,
      },
    });
    await settle();
    stop();

    for (const listener of appStateListeners) listener('active');
    await settle();

    expect(reads).toHaveLength(1);
    expect(appStateListeners).toHaveLength(0);
  });

  it('pushes the confirmation copy on start, and again when the language changes', async () => {
    const asked: string[] = [];
    const stop = startPendingMarkDrain({
      tracking: fakeTracking(),
      queue: { read: async () => [], acknowledge: async () => undefined },
      translate: (key) => {
        asked.push(key);
        return key;
      },
    });
    await settle();
    const onStart = asked.length;

    i18n.emit('languageChanged', 'ar');
    await settle();
    stop();

    // The words are composed natively with the app gone, so they have to be pushed before then —
    // and re-pushed, because a scheduled notification keeps whatever copy it was written with.
    expect(onStart).toBeGreaterThan(0);
    expect(asked.length).toBe(onStart * 2);
    expect(asked).toContain('notifications.actions.undo');
    expect(asked).toContain('notifications.marked.title');
  });

  it('survives a drain that cannot read the queue', async () => {
    const stop = startPendingMarkDrain({
      tracking: fakeTracking(),
      queue: {
        read: async () => {
          throw new Error('no native module');
        },
        acknowledge: async () => undefined,
      },
      onDrained: () => undefined,
    });
    await settle();

    expect(stop).not.toThrow();
  });
});
