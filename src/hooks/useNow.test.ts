import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { useNow } from './useNow';

/** Captured AppState listeners, so the tests can drive foreground/background transitions. */
let appStateListeners: ((state: AppStateStatus) => void)[] = [];
let removedSubscriptions = 0;

function emitAppState(state: AppStateStatus) {
  (AppState as { currentState: AppStateStatus }).currentState = state;
  for (const listener of [...appStateListeners]) listener(state);
}

/** Advances fake timers inside `act`, flushing the re-renders each tick schedules. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  appStateListeners = [];
  removedSubscriptions = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    appStateListeners.push(listener);
    return {
      remove: () => {
        removedSubscriptions += 1;
        appStateListeners = appStateListeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });
  (AppState as { currentState: AppStateStatus }).currentState = 'active';
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 6, 2, 18, 40, 12, 234));
});

afterEach(() => {
  // Restore the spies before the fake timers, so a spy on `clearTimeout` is put back onto the
  // fake implementation it was taken from rather than onto the real one.
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('useNow', () => {
  it('returns the current time straight away', async () => {
    const { result } = await renderHook(() => useNow());
    expect(result.current.getTime()).toBe(Date.now());
  });

  it('aligns the first tick to the next second boundary', async () => {
    const { result } = await renderHook(() => useNow());
    const initial = result.current;

    // 766ms remain of the current second (…12.234).
    await advance(765);
    expect(result.current).toBe(initial);

    await advance(1);
    expect(result.current).not.toBe(initial);
    expect(result.current.getMilliseconds()).toBe(0);
    expect(result.current.getSeconds()).toBe(13);
  });

  it('keeps ticking on the boundary without drifting', async () => {
    const { result } = await renderHook(() => useNow());

    await advance(766);
    expect(result.current.getSeconds()).toBe(13);

    await advance(1000);
    expect(result.current.getSeconds()).toBe(14);
    expect(result.current.getMilliseconds()).toBe(0);

    await advance(3000);
    expect(result.current.getSeconds()).toBe(17);
    expect(result.current.getMilliseconds()).toBe(0);
  });

  it('honours a custom interval and aligns to it', async () => {
    const { result } = await renderHook(() => useNow(60_000));
    const initial = result.current;

    await advance(30_000);
    expect(result.current).toBe(initial);

    // 47.766s remain of the current minute (…40:12.234).
    await advance(17_766);
    expect(result.current.getMinutes()).toBe(41);
    expect(result.current.getSeconds()).toBe(0);
  });

  it('falls back to one second for a nonsensical interval', async () => {
    const { result } = await renderHook(() => useNow(0));

    await advance(766);
    expect(result.current.getSeconds()).toBe(13);
  });

  it('stops ticking while the app is backgrounded', async () => {
    const { result } = await renderHook(() => useNow());
    await advance(766);
    const lastForegroundValue = result.current;

    await act(async () => {
      emitAppState('background');
    });

    await advance(10_000);
    expect(result.current).toBe(lastForegroundValue);
  });

  it('resyncs immediately when the app comes back to the foreground', async () => {
    const { result } = await renderHook(() => useNow());

    await act(async () => {
      emitAppState('background');
    });
    await advance(10_000);

    await act(async () => {
      emitAppState('active');
    });
    expect(result.current.getTime()).toBe(Date.now());

    // …and the ticking resumes, still aligned to the second.
    await advance(1000);
    expect(result.current.getMilliseconds()).toBe(0);
  });

  it('keeps ticking through a transient "inactive" state', async () => {
    const { result } = await renderHook(() => useNow());

    await act(async () => {
      emitAppState('inactive');
    });

    await advance(2000);
    expect(result.current.getSeconds()).toBe(14);
    expect(result.current.getMilliseconds()).toBe(0);
  });

  it('does not tick when mounted while backgrounded', async () => {
    (AppState as { currentState: AppStateStatus }).currentState = 'background';
    const { result } = await renderHook(() => useNow());
    const initial = result.current;

    await advance(5000);
    expect(result.current).toBe(initial);
  });

  it('releases its timer and its AppState subscription on unmount', async () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await renderHook(() => useNow());
    await advance(766);
    clearTimeoutSpy.mockClear();

    await unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removedSubscriptions).toBe(1);
    expect(appStateListeners).toHaveLength(0);
  });
});
