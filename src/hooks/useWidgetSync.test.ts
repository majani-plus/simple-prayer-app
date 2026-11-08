/**
 * Tests for `useWidgetSync`'s controller — when a rebuild is asked for, not what it says.
 *
 * Fake timers + a recording sync. The stores are the real zustand instances: a `setState` on
 * either must reach the controller, because that is the entire contract.
 */

import { AppState, type AppStateStatus } from 'react-native';

import {
  startWidgetSync,
  WIDGET_STARTUP_DELAY_MS,
  WIDGET_SYNC_DEBOUNCE_MS,
} from './useWidgetSync';
import { useBuddyStore } from '@/stores/buddyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';

import type { SyncWidgetsOptions } from '@/services/widgets';
import type { WidgetSnapshot } from '@/services/widgetSnapshot';

function recordingSync() {
  const calls: number[] = [];
  const sync = () => {
    calls.push(Date.now());
    return Promise.resolve('written' as const);
  };
  return { calls, sync };
}

/**
 * Every test but the cold-start ones switches the startup wait off, so the debounce is the only
 * clock in play. The app passes neither seam.
 */
const NO_STARTUP_WAIT = { startupDelayMs: 0 } as const;

/** The Activity reconciler is its own service (`liveActivity.test.ts`); here it just resolves. */
const syncActivity = () => Promise.resolve();

/** Lets the debounced run's promise chain settle under fake timers. */
async function flush(): Promise<void> {
  jest.advanceTimersByTime(WIDGET_SYNC_DEBOUNCE_MS + 1);
  // Enough microtask turns for the full run chain: sync → activity → watch envelope → onSynced.
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('startWidgetSync', () => {
  it('publishes once on start, after the debounce', async () => {
    const { calls, sync } = recordingSync();
    const stop = startWidgetSync({ sync, syncActivity, ...NO_STARTUP_WAIT });

    expect(calls).toHaveLength(0);
    await flush();
    expect(calls).toHaveLength(1);
    stop();
  });

  it('coalesces a burst of store changes into one rebuild', async () => {
    const { calls, sync } = recordingSync();
    const stop = startWidgetSync({ sync, syncActivity, ...NO_STARTUP_WAIT });
    await flush();

    useTrackingStore.setState({});
    useTrackingStore.setState({});
    useSettingsStore.setState({});
    await flush();

    expect(calls).toHaveLength(2);
    stop();
  });

  it('redraws for a buddy change the widgets show, and not for the rest (D194)', async () => {
    const { calls, sync } = recordingSync();
    const stop = startWidgetSync({ sync, syncActivity, ...NO_STARTUP_WAIT });
    await flush();

    // The sent ledger and the push token are never drawn.
    useBuddyStore.setState({ sent: { fajr: 'prayed' }, pushToken: 'x' });
    await flush();
    expect(calls).toHaveLength(1);

    // A buddy's mark arriving is.
    useBuddyStore.setState((state) => ({ marks: { ...state.marks, fajr: ['a'.repeat(32)] } }));
    await flush();
    expect(calls).toHaveLength(2);
    stop();
  });

  it('runs once more when a change lands mid-sync, with the fresher state', async () => {
    const calls: number[] = [];
    let release: (() => void) | undefined;
    const sync = () => {
      calls.push(Date.now());
      return new Promise<'written'>((resolve) => {
        release = () => resolve('written');
      });
    };
    const stop = startWidgetSync({ sync, syncActivity, ...NO_STARTUP_WAIT });

    jest.advanceTimersByTime(WIDGET_SYNC_DEBOUNCE_MS + 1);
    expect(calls).toHaveLength(1);

    // The world changes while the first sync is still on the wire.
    useTrackingStore.setState({});
    jest.advanceTimersByTime(WIDGET_SYNC_DEBOUNCE_MS + 1);
    expect(calls).toHaveLength(1); // still running — nothing overlapping

    release?.();
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
    jest.advanceTimersByTime(WIDGET_SYNC_DEBOUNCE_MS + 1);
    expect(calls).toHaveLength(2);

    release?.();
    stop();
  });

  it('stops cold: nothing fires after cleanup', async () => {
    const { calls, sync } = recordingSync();
    const stop = startWidgetSync({ sync, syncActivity, ...NO_STARTUP_WAIT });
    stop();

    useTrackingStore.setState({});
    useSettingsStore.setState({});
    await flush();

    expect(calls).toHaveLength(0);
  });

  it('reports outcomes and survives a sync that rejects', async () => {
    const outcomes: string[] = [];
    const stop = startWidgetSync({
      sync: () => Promise.reject(new Error('bridge down')),
      syncActivity: () => Promise.reject(new Error('also down')),
      syncWatchEnvelope: () => Promise.reject(new Error('watch down too')),
      onSynced: (outcome) => outcomes.push(outcome),
      ...NO_STARTUP_WAIT,
    });

    await flush();
    expect(outcomes).toEqual(['unchanged']);
    stop();
  });

  it('publishes the watch envelope on the same debounced run', async () => {
    const { calls, sync } = recordingSync();
    const watchCalls: number[] = [];
    const stop = startWidgetSync({
      sync,
      syncActivity,
      syncWatchEnvelope: () => {
        watchCalls.push(Date.now());
        return Promise.resolve('written');
      },
      ...NO_STARTUP_WAIT,
    });

    await flush();
    expect(calls).toHaveLength(1);
    expect(watchCalls).toHaveLength(1);
    stop();
  });

  it('builds the snapshot once and hands the widgets’ copy to the watch', async () => {
    const snapshot = { generatedAt: 1 } as unknown as WidgetSnapshot;
    const handed: (WidgetSnapshot | null | undefined)[] = [];
    const stop = startWidgetSync({
      sync: (syncOptions?: SyncWidgetsOptions) => {
        syncOptions?.onBuilt?.(snapshot);
        return Promise.resolve('written' as const);
      },
      syncActivity,
      syncWatchEnvelope: (watchOptions) => {
        handed.push(watchOptions?.snapshot);
        return Promise.resolve('written');
      },
      ...NO_STARTUP_WAIT,
    });

    await flush();
    expect(handed).toEqual([snapshot]);
    stop();
  });

  it('leaves the watch to build its own when the widgets never got that far', async () => {
    // `syncWidgets` returns before building on an unsupported bridge or a store that is not
    // hydrated yet; `undefined` is what tells the watch to do the work itself.
    const handed: (WidgetSnapshot | null | undefined)[] = [];
    const { sync } = recordingSync();
    const stop = startWidgetSync({
      sync,
      syncActivity,
      syncWatchEnvelope: (watchOptions) => {
        handed.push(watchOptions?.snapshot);
        return Promise.resolve('unsupported');
      },
      ...NO_STARTUP_WAIT,
    });

    await flush();
    expect(handed).toEqual([undefined]);
    stop();
  });

  describe('the cold start', () => {
    it('holds the first publish back well past the debounce', async () => {
      const { calls, sync } = recordingSync();
      const stop = startWidgetSync({ sync, syncActivity });

      await flush();
      expect(calls).toHaveLength(0);

      jest.advanceTimersByTime(WIDGET_STARTUP_DELAY_MS);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
      expect(calls).toHaveLength(1);
      stop();
    });

    it('cancels it when the controller is stopped before it fires', async () => {
      const { calls, sync } = recordingSync();
      startWidgetSync({ sync, syncActivity })();

      jest.advanceTimersByTime(WIDGET_STARTUP_DELAY_MS + 1000);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
      expect(calls).toHaveLength(0);
    });

    it('absorbs a trigger that lands inside the wait — one publish, at the wait', async () => {
      // The pending-marks drain and the language pass both fire triggers in this window; a
      // trigger that cancelled the wait would put the rebuild back at +400 ms on every launch.
      const { calls, sync } = recordingSync();
      const stop = startWidgetSync({ sync, syncActivity });

      useTrackingStore.setState({});
      await flush();
      expect(calls).toHaveLength(0);

      jest.advanceTimersByTime(WIDGET_STARTUP_DELAY_MS);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
      expect(calls).toHaveLength(1);

      // …and nothing else is pending.
      jest.advanceTimersByTime(WIDGET_STARTUP_DELAY_MS + 1000);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
      expect(calls).toHaveLength(1);
      stop();
    });
  });

  describe('the foreground redraw (D189)', () => {
    /** Captures the controller's AppState listener so a test can bring the app forward. */
    function captureAppState() {
      let listener: ((state: AppStateStatus) => void) | undefined;
      const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
        listener = handler as (state: AppStateStatus) => void;
        return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
      });
      return { emit: (state: AppStateStatus) => listener?.(state), restore: () => spy.mockRestore() };
    }

    it('redraws at once on foreground, even when the sync will find nothing new', async () => {
      // An unchanged snapshot is deduped by the sync, and that is exactly when a countdown has
      // run negative across a boundary — so the redraw must not depend on the sync writing.
      const appState = captureAppState();
      const redraw = jest.fn(() => Promise.resolve());
      const sync = jest.fn(() => Promise.resolve('unchanged' as const));
      const stop = startWidgetSync({ sync, syncActivity, redraw, ...NO_STARTUP_WAIT });
      await flush();
      expect(redraw).not.toHaveBeenCalled();

      appState.emit('active');
      expect(redraw).toHaveBeenCalledTimes(1);

      appState.emit('background');
      expect(redraw).toHaveBeenCalledTimes(1);
      stop();
      appState.restore();
    });

    it('survives a redraw that rejects', async () => {
      const appState = captureAppState();
      const redraw = jest.fn(() => Promise.reject(new Error('bridge gone')));
      const { calls, sync } = recordingSync();
      const stop = startWidgetSync({ sync, syncActivity, redraw, ...NO_STARTUP_WAIT });
      await flush();

      appState.emit('active');
      await flush();
      expect(redraw).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(2);
      stop();
      appState.restore();
    });
  });
});
