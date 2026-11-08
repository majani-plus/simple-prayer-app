/**
 * The launch/foreground auto-location refresh (`startLocationRefresh`).
 *
 * The store's silent flow (`locationStore.refresh`) has its own suite; what is tested here is the
 * wiring that decides *when* it runs, and the two ways that wiring could do harm:
 *
 * 1. **Prompting, or looking like it did.** A pass while the permission is still `undetermined`
 *    must leave the location store exactly as it found it — a first-run user has to see the
 *    friendly first ask, not a "you refused" card explaining a refusal that never happened. And no
 *    pass may ever call `requestPermission`.
 * 2. **Not running.** The whole point (PRODUCT_SPEC §10 "re-resolve on launch") is that a granted
 *    user's stale city refreshes without them touching anything — including the permission itself
 *    being absorbed into the store, which is what lets the Qibla compass start on launch.
 *
 * Everything is real except the platform: a real settings store over memory storage, a real
 * location store over `createFakeLocationAdapter`, and the controller under test on top.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { startLocationRefresh } from './useLocationRefresh';
import {
  createFakeLocationAdapter,
  createLocationService,
  type FakeLocationAdapter,
} from '@/services/location';
import { createLocationStore, REFRESH_MIN_INTERVAL_MS } from '@/stores/locationStore';
import { createMemorySettingsStorage, createSettingsStore } from '@/stores/settingsStore';

const POSITION = { latitude: 41.0082, longitude: 28.9784 };
const ADDRESS = { city: 'Istanbul', country: 'Türkiye', isoCountryCode: 'TR' };

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

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

/** Drains the promise queue; every layer here is promise-only, no timers. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

/** A real settings store + a real location store over a scripted adapter, plus the controller. */
function makeHarness(adapter: FakeLocationAdapter, options: { now?: () => number } = {}) {
  const now = options.now ?? (() => Date.now());
  const settings = createSettingsStore(createMemorySettingsStorage(), 'location-refresh-test');
  const service = createLocationService(adapter, { now });
  const locationStore = createLocationStore({
    service,
    getSettings: () => settings.getState(),
    getSettingsActions: () => settings.getState(),
    now,
  });

  const start = () =>
    startLocationRefresh({
      service,
      actions: () => locationStore.getState(),
    });

  return { settings, locationStore, start };
}

describe('startLocationRefresh', () => {
  it('re-resolves a granted auto location on mount and absorbs the permission', async () => {
    const adapter = createFakeLocationAdapter({
      permission: { status: 'granted', granted: true, canAskAgain: true },
      position: POSITION,
      addresses: [ADDRESS],
    });
    const { settings, locationStore, start } = makeHarness(adapter);

    const stop = start();
    await settle();

    // The silent flow ran: a location landed in settings, and the store both knows the
    // permission (the compass gate) and reports ready.
    const stored = settings.getState().location;
    expect(stored?.label).toBe('Istanbul, Türkiye');
    expect(stored?.source).toBe('auto');
    expect(locationStore.getState().permission).toBe('granted');
    expect(locationStore.getState().status).toBe('ready');
    // And it never prompted.
    expect(adapter.calls.requestPermission).toBe(0);

    stop();
  });

  it('touches nothing while the permission is undetermined (the first-run case)', async () => {
    const adapter = createFakeLocationAdapter({
      permission: { status: 'undetermined', granted: false, canAskAgain: true },
      position: POSITION,
      addresses: [ADDRESS],
    });
    const { settings, locationStore, start } = makeHarness(adapter);

    const stop = start();
    await settle();

    // The store still looks like nobody was ever asked — status idle, permission undetermined —
    // so the Today/Qibla cards make the friendly first ask instead of explaining a refusal.
    expect(locationStore.getState().status).toBe('idle');
    expect(locationStore.getState().permission).toBe('undetermined');
    expect(settings.getState().location).toBeNull();
    expect(adapter.calls.requestPermission).toBe(0);
    expect(adapter.calls.getCurrentPosition).toBe(0);

    stop();
  });

  it('never overwrites a manual city, but still absorbs the permission for the compass', async () => {
    const adapter = createFakeLocationAdapter({
      permission: { status: 'granted', granted: true, canAskAgain: true },
      position: POSITION,
      addresses: [ADDRESS],
    });
    const { settings, locationStore, start } = makeHarness(adapter);
    settings.getState().setLocation({
      latitude: 39.9334,
      longitude: 32.8597,
      label: 'Ankara',
      source: 'manual',
      resolvedAt: 1,
    });
    settings.getState().setUseAutoLocation(false);

    const stop = start();
    await settle();

    expect(settings.getState().location?.label).toBe('Ankara');
    expect(adapter.calls.getCurrentPosition).toBe(0);
    // The half that matters on this path: useHeading reads this field before starting the sensor.
    expect(locationStore.getState().permission).toBe('granted');

    stop();
  });

  it('runs again on foreground, honouring the freshness window', async () => {
    let nowMs = Date.UTC(2026, 7, 19, 12, 0, 0);
    const adapter = createFakeLocationAdapter({
      permission: { status: 'granted', granted: true, canAskAgain: true },
      position: POSITION,
      addresses: [ADDRESS],
    });
    const { start } = makeHarness(adapter, { now: () => nowMs });

    const stop = start();
    await settle();
    expect(adapter.calls.getCurrentPosition).toBe(1);

    // Straight back to the foreground: the stored fix is fresh, so no second round-trip.
    for (const listener of appStateListeners) listener('active');
    await settle();
    expect(adapter.calls.getCurrentPosition).toBe(1);

    // A foreground after the freshness window re-resolves.
    nowMs += REFRESH_MIN_INTERVAL_MS + 1;
    for (const listener of appStateListeners) listener('active');
    await settle();
    expect(adapter.calls.getCurrentPosition).toBe(2);

    stop();
  });

  it('stops cleanly: a foreground after stop() does nothing', async () => {
    const adapter = createFakeLocationAdapter({
      permission: { status: 'granted', granted: true, canAskAgain: true },
      position: POSITION,
      addresses: [ADDRESS],
    });
    const { start } = makeHarness(adapter);

    const stop = start();
    await settle();
    stop();

    const callsAfterStop = adapter.calls.getPermission;
    for (const listener of appStateListeners) listener('active');
    await settle();
    expect(adapter.calls.getPermission).toBe(callsAfterStop);
    expect(appStateListeners).toHaveLength(0);
  });

  it('a permission read that throws degrades to doing nothing', async () => {
    const adapter = createFakeLocationAdapter({
      permission: { status: 'granted', granted: true, canAskAgain: true },
      position: POSITION,
      addresses: [ADDRESS],
    });
    const { locationStore, start } = makeHarness(adapter);
    // The service absorbs a throwing platform into UNKNOWN_PERMISSION (granted: false), so the
    // controller's gate closes; nothing downstream runs.
    jest.spyOn(adapter, 'getPermission').mockRejectedValue(new Error('platform exploded'));

    const stop = start();
    await settle();

    expect(locationStore.getState().status).toBe('idle');
    expect(adapter.calls.getCurrentPosition).toBe(0);

    stop();
  });
});
