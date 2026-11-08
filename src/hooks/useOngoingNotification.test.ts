/**
 * The clock behind the Android ongoing notification.
 *
 * `services/ongoingNotification` is where "when should this be redrawn" is decided, and it is
 * unit-tested there. What can only go wrong *here* is the wiring, and it can go wrong in three
 * expensive ways:
 *
 * 1. **It runs when it should not.** The notification is Android-only and off by default (D27),
 *    so on iOS — and while the switch is off — this controller must arm nothing and subscribe to
 *    nothing. A timer running for a feature nobody enabled is a battery bug with no upside.
 * 2. **It runs too often.** The whole design exists to avoid ticking. Over a full day the
 *    controller should wake a couple of dozen times, not tens of thousands.
 * 3. **It stops running.** The timer must re-arm after every redraw, survive a sleeping device
 *    (the chunked timer), and catch up on foreground.
 *
 * The subject is `startOngoingNotificationRefresh`, the plain controller the hook wraps, so there
 * is no renderer and no argument about when React flushed. The tracking store is mocked (it opens
 * SQLite); the settings store is real over an in-memory MMKV, because "flip the switch and the
 * clock starts" is exactly the behaviour under test.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { buildSyncInput } from './useNotificationSync';
import { startOngoingNotificationRefresh } from './useOngoingNotification';
import { initI18n } from '@/i18n';
import { nextOngoingRefreshAt, selectOngoingState } from '@/services/ongoingNotification';
import { DEFAULT_SETTINGS, useSettingsStore } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';

import type { AppSettings, DayTimes, Prayer, PrayerDay, PrayerStatus } from '@/domain/types';

jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));

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
        remove: (key: string) => void store.delete(key),
        clearAll: () => store.clear(),
      };
    },
  };
});

/**
 * A tracking store that can actually be written to and subscribed on. The real one opens SQLite,
 * but "a logged prayer re-aims the clock" (D83) cannot be tested against a store that never
 * changes and never notifies.
 */
jest.mock('@/stores/trackingStore', () => {
  const streaks = jest.requireActual<typeof import('@/domain/streaks')>('@/domain/streaks');
  const listeners = new Set<(state: unknown) => void>();
  const state = {
    dayRecords: {} as Record<string, ReturnType<typeof streaks.unloggedDayRecord>>,
    exemptPeriods: [] as unknown[],
    todayDay: () => '2026-08-19',
    isExemptDay: () => false,
    dayRecordFor: (day: string) => state.dayRecords[day] ?? streaks.unloggedDayRecord(day),
  };
  return {
    useTrackingStore: {
      getState: () => state,
      subscribe: (listener: (state: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      /** Test-only: log a prayer and notify, as a real write would. */
      __log: (day: string, prayer: string, status: string) => {
        const record = state.dayRecordFor(day);
        state.dayRecords = {
          ...state.dayRecords,
          [day]: { ...record, statuses: { ...record.statuses, [prayer]: status } },
        };
        for (const listener of listeners) listener(state);
      },
      /** Test-only: back to an empty log. */
      __reset: () => {
        state.dayRecords = {};
      },
    },
  };
});

/** Accra — on the prime meridian and near the equator, so every prayer genuinely exists. */
const LOCATION: AppSettings['location'] = {
  latitude: 5.6037,
  longitude: -0.187,
  label: 'Accra',
  countryCode: 'GH',
  source: 'auto',
  resolvedAt: 0,
};

const TODAY: PrayerDay = '2026-08-19';
const START = new Date('2026-08-19T00:30:00.000Z');

let appStateListeners: ((state: AppStateStatus) => void)[] = [];
let removals = 0;
/** Stop functions of every controller a test started; drained in `afterEach`. */
let started: (() => void)[] = [];

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, location: LOCATION });
  tracking.__reset();
  appStateListeners = [];
  removals = 0;
  started = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    appStateListeners.push(listener);
    return {
      remove: () => {
        removals += 1;
        appStateListeners = appStateListeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });
  jest.useFakeTimers();
  jest.setSystemTime(START);
});

afterEach(() => {
  for (const stop of started) stop();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/**
 * Advances the clock in steps small enough for the controller's chunked timer to re-arm, draining
 * microtasks between them — the redraw re-arms inside a promise, so a bare `advanceTimersByTime`
 * would stop after the first one.
 */
async function advance(ms: number, step = 60_000): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    const chunk = Math.min(step, remaining);
    jest.advanceTimersByTime(chunk);
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    remaining -= chunk;
  }
}

/** Today's real prayer times for {@link LOCATION}, so no instant in these tests is hardcoded. */
function todayTimes(): DayTimes['times'] {
  const input = buildSyncInput({
    now: START,
    settings: { ...useSettingsStore.getState(), location: LOCATION } as AppSettings,
    todayDay: TODAY,
    isExemptDay: () => false,
    statusesFor: () => ({}),
    locale: 'en',
  });
  return input!.days[0].times;
}

/** The instant the module itself says the first redraw is due, derived rather than hardcoded. */
function firstRedrawAt(now: Date = START): Date {
  const input = buildSyncInput({
    now,
    settings: { ...useSettingsStore.getState(), location: LOCATION } as AppSettings,
    todayDay: TODAY,
    isExemptDay: () => false,
    statusesFor: () => ({}),
    locale: 'en',
  });
  const state = selectOngoingState(input!.days, now);
  return nextOngoingRefreshAt(state!, now)!;
}

/** The mocked store's write hook — see the `jest.mock` above. */
const tracking = useTrackingStore as unknown as {
  __log: (day: PrayerDay, prayer: Prayer, status: PrayerStatus) => void;
  __reset: () => void;
};

/**
 * Starts a controller and registers its stop for teardown. A controller that outlives a failing
 * assertion would keep its settings subscription and go on arming timers inside the *next* test,
 * which is a debugging session nobody needs.
 */
function start(overrides: { platform?: 'ios' | 'android'; refresh?: jest.Mock } = {}) {
  const refresh = overrides.refresh ?? jest.fn(() => Promise.resolve());
  const stop = startOngoingNotificationRefresh({
    platform: overrides.platform ?? 'android',
    refresh,
  });
  started.push(stop);
  return { refresh, stop };
}

// ---------------------------------------------------------------------------

describe('when it does nothing at all', () => {
  it('is inert on iOS, even with the setting on', async () => {
    useSettingsStore.getState().setPersistentNotification(true);

    const { refresh, stop } = start({ platform: 'ios' });
    await advance(24 * 60 * 60 * 1000, 60 * 60 * 1000);

    expect(refresh).not.toHaveBeenCalled();
    // Nor does it hold a subscription: the ongoing notification does not exist on iOS (D27).
    expect(appStateListeners).toHaveLength(0);
    stop();
  });

  it('arms no timer while the setting is off — which is its default', async () => {
    expect(useSettingsStore.getState().persistentNotificationEnabled).toBe(false);

    const { refresh, stop } = start();
    await advance(24 * 60 * 60 * 1000);

    expect(refresh).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    stop();
  });

  it('arms no timer when there is no location to compute times from', async () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, location: null });
    useSettingsStore.getState().setPersistentNotification(true);

    const { refresh, stop } = start();
    await advance(6 * 60 * 60 * 1000);

    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});

describe('when the setting is on', () => {
  beforeEach(() => {
    useSettingsStore.getState().setPersistentNotification(true);
  });

  it('redraws at the moment the module says, and not before', async () => {
    const due = firstRedrawAt();
    const { refresh, stop } = start();

    await advance(due.getTime() - START.getTime() - 120_000);
    expect(refresh).not.toHaveBeenCalled();

    await advance(180_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('re-arms after each redraw instead of stopping at the first', async () => {
    const { refresh, stop } = start();

    await advance(12 * 60 * 60 * 1000);

    expect(refresh.mock.calls.length).toBeGreaterThan(3);
    stop();
  });

  it('wakes a couple of dozen times a day, not thousands — it never ticks', async () => {
    const { refresh, stop } = start();

    await advance(24 * 60 * 60 * 1000);

    // Five prayers, each with a transition plus up to four lead checkpoints.
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(30);
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(5);
    stop();
  });

  it('catches up on foreground after the device slept through a redraw', async () => {
    const { refresh, stop } = start();

    // The process was frozen: the clock moved but no timer ran.
    jest.setSystemTime(new Date(firstRedrawAt().getTime() + 60_000));
    expect(refresh).not.toHaveBeenCalled();

    for (const listener of appStateListeners) listener('active');
    await advance(1000, 1000);

    expect(refresh).toHaveBeenCalled();
    stop();
  });
});

describe('following the log', () => {
  beforeEach(() => {
    useSettingsStore.getState().setPersistentNotification(true);
  });

  it('re-aims the clock when the prayer it is about is marked (D83)', async () => {
    const times = todayTimes();
    // Five minutes past Dhuhr: the notification is about Dhuhr, and a due prayer names no
    // duration, so there is nothing to keep fresh until its window shuts at Asr.
    const afterDhuhr = new Date(times.dhuhr.getTime() + 5 * 60_000);
    jest.setSystemTime(afterDhuhr);
    const { refresh, stop } = start();

    await advance(times.asr.getTime() - 30 * 60_000 - afterDhuhr.getTime());
    expect(refresh).not.toHaveBeenCalled();

    // Marking Dhuhr turns it into a countdown to Asr, whose quarter-hour checkpoint is minutes
    // away — a timer still aimed at Asr itself would sit through it and leave a stale remainder.
    tracking.__log(TODAY, 'dhuhr', 'prayed');
    await advance(20 * 60_000);

    expect(refresh).toHaveBeenCalled();
    stop();
  });

  it('drops the subscription when it stops', async () => {
    const { refresh, stop } = start();
    stop();

    tracking.__log(TODAY, 'dhuhr', 'prayed');
    await advance(24 * 60 * 60 * 1000);

    expect(refresh).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('following the switch', () => {
  it('starts the clock when the setting is turned on', async () => {
    const { refresh, stop } = start();
    await advance(60 * 60 * 1000);
    expect(refresh).not.toHaveBeenCalled();

    useSettingsStore.getState().setPersistentNotification(true);
    await advance(12 * 60 * 60 * 1000);

    expect(refresh).toHaveBeenCalled();
    stop();
  });

  it('stops the clock when the setting is turned off', async () => {
    useSettingsStore.getState().setPersistentNotification(true);
    const { refresh, stop } = start();
    await advance(12 * 60 * 60 * 1000);
    const before = refresh.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    useSettingsStore.getState().setPersistentNotification(false);
    await advance(12 * 60 * 60 * 1000);

    expect(refresh).toHaveBeenCalledTimes(before);
    expect(jest.getTimerCount()).toBe(0);
    stop();
  });

  it('survives a failing redraw and keeps the clock running', async () => {
    useSettingsStore.getState().setPersistentNotification(true);
    const refresh = jest.fn(() => Promise.reject(new Error('no adapter')));
    const { stop } = start({ refresh });

    await advance(12 * 60 * 60 * 1000);

    expect(refresh.mock.calls.length).toBeGreaterThan(1);
    stop();
  });
});

describe('stopping', () => {
  it('clears the timer and drops the subscription', async () => {
    useSettingsStore.getState().setPersistentNotification(true);
    const { refresh, stop } = start();
    await advance(60 * 1000);

    stop();
    await advance(24 * 60 * 60 * 1000);

    expect(refresh).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(removals).toBe(1);
    expect(appStateListeners).toHaveLength(0);
  });
});
