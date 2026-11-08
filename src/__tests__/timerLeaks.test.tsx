/**
 * The Today tab is the one screen in the app that runs a clock. Three things schedule work over
 * time: `useNow` (the once-a-second tick), `LiveCountdown` (which mounts one), and `usePrayerDay`
 * (the self-rearming rollover timer, plus an `AppState` subscription). Each is individually
 * covered elsewhere; what no single test can see is whether they all actually *let go*.
 *
 * That matters more here than it usually does. `LiveCountdown` is mounted and unmounted constantly
 * in normal use — every time the next prayer changes, the hero's countdown is torn down and the
 * previous row's caption stops being one — and `usePrayerDay`'s rollover timer re-arms itself
 * every ten minutes, forever. A single missed cleanup is not a slow leak: it is an ever-growing
 * pile of timers each re-rendering an unmounted tree, and the symptom (a warm phone, a stuttering
 * seal animation) would never be traced back to here.
 *
 * **How the counting works.** React and the testing library schedule timers of their own while a
 * tree is mounting, so `jest.getTimerCount()` is only meaningful once the queue has *settled* —
 * one tick past the last unmount. {@link settledTimerCount} does exactly that, and the count it
 * returns is stable no matter how many mount/unmount rounds preceded it. The first test in the
 * file proves the guard can fail, by leaking a timer on purpose.
 */

import { act, renderHook, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { LiveCountdown } from '../components/LiveCountdown';
import { useHeading } from '../hooks/useHeading';
import { usePrayerDay } from '../hooks/usePrayerDay';
import { useNow } from '../hooks/useNow';
import { initI18n } from '../i18n';
import { createFakeHeadingAdapter, createHeadingService } from '../services/heading';
import { useSettingsStore } from '../stores/settingsStore';

// The only thing `useHeading` reads from the location store; the real one opens MMKV.
jest.mock('@/stores/locationStore', () => ({
  useLocationPermission: () => ({ permission: 'granted', canAskAgain: true }),
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
        remove: (key: string) => void store.delete(key),
        clearAll: () => store.clear(),
      };
    },
  };
});

// The tracking store opens SQLite; the timers under test do not care what it returns, only that
// the hook gets a record. A `jest.mock` factory may not close over an import, so the domain
// helper is required lazily inside it.
jest.mock('../stores/trackingStore', () => {
  // One stable object: the real `useTrackingActions` is shallow-compared and hands back the same
  // action identities for the app's life, and an effect that depends on them must not re-run —
  // and re-arm its timers — on every render just because the mock allocated a new closure.
  const actions = {
    loadDay: jest.fn(),
  };
  return {
    useTrackingHydrated: () => true,
    useDayRecord: (day: string) =>
      day === ''
        ? undefined
        : jest
            .requireActual<typeof import('../domain/streaks')>('../domain/streaks')
            .unloggedDayRecord(day),
    useTrackingActions: () => actions,
  };
});

/** Accra — low latitude, so every prayer of the day genuinely exists. */
const LOCATION = {
  latitude: 5.6037,
  longitude: -0.187,
  label: 'Accra',
  countryCode: 'GH',
  source: 'auto' as const,
  resolvedAt: 0,
};

/** Live `AppState` listeners, counted so a forgotten `remove()` shows up as a leak too. */
let listeners: ((state: AppStateStatus) => void)[] = [];

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });
  (AppState as { currentState: AppStateStatus }).currentState = 'active';
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2025-07-11T14:00:00.000Z'));
});

afterEach(() => {
  // Spies first, then the timers: a spy taken from the fake implementation must be handed back
  // to it, not to the real one.
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Advances the fake clock inside `act`, flushing whatever re-renders the tick schedules. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** The number of pending timers once React's own mount/unmount bookkeeping has drained. */
async function settledTimerCount(): Promise<number> {
  await advance(1);
  return jest.getTimerCount();
}

/** A hook that forgets to clean up — the failure this file exists to detect. */
function useLeakyClock() {
  useEffect(() => {
    const id = setInterval(() => {}, 1000);
    return () => {
      // Deliberately does not clear `id`.
      void id;
    };
  }, []);
}

describe('the leak detector itself', () => {
  it('notices a timer that is never cleared', async () => {
    const baseline = await settledTimerCount();

    for (let round = 0; round < 3; round += 1) {
      const { unmount } = await renderHook(() => useLeakyClock());
      await unmount();
    }

    expect(await settledTimerCount()).toBe(baseline + 3);
  });
});

describe('useNow', () => {
  it('leaves no timer and no listener behind after repeated mounts', async () => {
    const baseline = await settledTimerCount();

    for (let round = 0; round < 5; round += 1) {
      const { unmount } = await renderHook(() => useNow());
      await advance(2_500);
      await unmount();
    }

    expect(await settledTimerCount()).toBe(baseline);
    expect(listeners).toHaveLength(0);
  });

  it('does not re-arm after being unmounted mid-tick', async () => {
    const baseline = await settledTimerCount();
    const { unmount } = await renderHook(() => useNow());
    // Unmount 999 ms in — with a timer armed and about to fire.
    await advance(999);
    await unmount();

    await advance(10 * 60 * 1000);

    expect(await settledTimerCount()).toBe(baseline);
  });
});

describe('LiveCountdown', () => {
  it('releases its clock every time it is unmounted', async () => {
    const baseline = await settledTimerCount();
    const target = new Date(Date.now() + 90 * 60 * 1000);

    for (let round = 0; round < 5; round += 1) {
      const view = await render(<LiveCountdown target={target} testID="countdown" />);
      expect(screen.getByTestId('countdown')).toBeTruthy();
      await advance(3_000);
      await view.unmount();
    }

    expect(await settledTimerCount()).toBe(baseline);
    expect(listeners).toHaveLength(0);
  });
});

describe('usePrayerDay', () => {
  // No `act` here on purpose: nothing is mounted yet, and RNTL v14's `act` is async — an
  // un-awaited call leaves the act queue dirty and the next `render` never commits.
  beforeEach(() => {
    useSettingsStore.getState().setLocation(LOCATION);
  });

  it('releases the rollover timer and the AppState subscription', async () => {
    const baseline = await settledTimerCount();

    for (let round = 0; round < 3; round += 1) {
      const { result, unmount } = await renderHook(() => usePrayerDay());
      expect(result.current.next).not.toBeNull();
      // Long enough to cross several of the ten-minute chunks the timer re-arms in.
      await advance(45 * 60 * 1000);
      await unmount();
    }

    expect(await settledTimerCount()).toBe(baseline);
    expect(listeners).toHaveLength(0);
  });

  it('stops re-arming once unmounted', async () => {
    const baseline = await settledTimerCount();
    const { unmount } = await renderHook(() => usePrayerDay());
    await advance(5 * 60 * 1000);
    await unmount();

    // Six hours is several prayer boundaries: a surviving rollover timer would still be re-arming.
    await advance(6 * 60 * 60 * 1000);

    expect(await settledTimerCount()).toBe(baseline);
  });
});

/**
 * The compass is the app's only *sensor*, and the one subscription whose cost is measured in
 * battery rather than in renders. It is also torn down and rebuilt constantly: every tab change
 * and every trip through the app switcher ends a session.
 *
 * `useHeading`'s own suite proves a single unmount stops the stream. What it cannot show is the
 * three timers the sensor callback arms — the calibration grace period, the throttle's trailing
 * publish and the stale-stream watchdog — surviving a teardown that happens while they are still
 * in flight. A leaked calibration timer is the worst of the three: it fires a second and a half
 * later and asks a dead screen to show the figure-8 prompt.
 */
describe('useHeading', () => {
  it('releases the sensor, all three of its timers and the AppState subscription', async () => {
    const baseline = await settledTimerCount();
    const adapter = createFakeHeadingAdapter();
    const service = createHeadingService(adapter);

    for (let round = 0; round < 3; round += 1) {
      const { unmount } = await renderHook(() => useHeading({ service }));
      // Let the service's start promise resolve, so the stream is genuinely running.
      await act(async () => {});

      await act(async () => {
        // Poor accuracy arms the calibration grace timer. This first sample also publishes
        // immediately, which is what makes the next one land inside the throttle window.
        adapter.emit({ trueHeading: 12, magHeading: 12, accuracy: 0 });
      });
      await act(async () => {
        // Inside the throttle gap: arms the trailing publish. Both timers are now in flight.
        adapter.emit({ trueHeading: 40, magHeading: 40, accuracy: 0 });
      });

      await unmount();
    }

    expect(await settledTimerCount()).toBe(baseline);
    expect(adapter.isWatching).toBe(false);
    expect(adapter.startCount).toBe(adapter.removeCount);
    expect(listeners).toHaveLength(0);
  });
});
