/**
 * Tests for the location store.
 *
 * The store is exercised end to end over the *real* service (`createLocationService`) with an
 * in-memory adapter, and a real settings store backed by memory storage — the same code paths
 * the app runs, with only the native modules swapped. `react-native-mmkv` is mocked because
 * importing this module transitively creates the MMKV-backed settings singleton.
 *
 * The behaviours under test are product requirements (PRODUCT_SPEC §10): nothing prompts
 * unless the user asked, `settings.location` stays the single source of truth, a manual city
 * outranks the device, and a geocoder failure never costs us the location.
 */

import { act, renderHook } from '@testing-library/react-native';

import type { AppLocation } from '../domain/types';
import {
  createFakeLocationAdapter,
  createLocationService,
  type FakeLocationConfig,
} from '../services/location';
import {
  createLocationStore,
  REFRESH_MIN_INTERVAL_MS,
  useLocationActions,
  useLocationStatus,
  type LocationStore,
} from './locationStore';
import { createMemorySettingsStorage, createSettingsStore } from './settingsStore';

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
        clearAll: () => void store.clear(),
      };
    },
  };
});

const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 };
const ANKARA = { latitude: 39.9334, longitude: 32.8597 };

const ISTANBUL_ADDRESS = {
  city: 'Istanbul',
  region: 'Istanbul',
  country: 'Türkiye',
  isoCountryCode: 'tr',
  timezone: 'Europe/Istanbul',
};

const ANKARA_ADDRESS = {
  city: 'Ankara',
  region: 'Ankara',
  country: 'Türkiye',
  isoCountryCode: 'tr',
  timezone: 'Europe/Istanbul',
};

const GRANTED = { status: 'granted' as const, granted: true, canAskAgain: false };
const DENIED = { status: 'denied' as const, granted: false, canAskAgain: false };
const UNDETERMINED = { status: 'undetermined' as const, granted: false, canAskAgain: true };

const NOW = 1_700_000_000_000;

const MANUAL_MECCA: AppLocation = {
  latitude: 21.4225,
  longitude: 39.8262,
  label: 'Mecca, Saudi Arabia',
  countryCode: 'SA',
  source: 'manual',
  resolvedAt: 1,
};

interface Harness {
  store: ReturnType<typeof createLocationStore>;
  adapter: ReturnType<typeof createFakeLocationAdapter>;
  settings: ReturnType<typeof createSettingsStore>;
  clock: { now: number };
}

let storageCounter = 0;

function makeHarness(
  config: FakeLocationConfig = {},
  seedLocation: AppLocation | null = null
): Harness {
  const adapter = createFakeLocationAdapter(config);
  const clock = { now: NOW };
  const now = () => clock.now;
  const service = createLocationService(adapter, { now });
  // A fresh storage key per harness keeps parallel stores from sharing persisted settings.
  const settings = createSettingsStore(
    createMemorySettingsStorage(),
    `settings-${(storageCounter += 1)}`
  );
  if (seedLocation !== null) settings.getState().setLocation(seedLocation);

  const store = createLocationStore({
    service,
    getSettings: () => settings.getState(),
    getSettingsActions: () => settings.getState(),
    now,
  });
  return { store, adapter, settings, clock };
}

function statusOf(store: Harness['store']): LocationStore['status'] {
  return store.getState().status;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  it('is idle and touches nothing at construction (the app must work before permission)', () => {
    const { store, adapter } = makeHarness({ permission: UNDETERMINED, position: ISTANBUL });

    expect(store.getState().status).toBe('idle');
    expect(store.getState().permission).toBe('undetermined');
    expect(store.getState().error).toBeNull();
    expect(adapter.calls.getPermission).toBe(0);
    expect(adapter.calls.requestPermission).toBe(0);
    expect(adapter.calls.getCurrentPosition).toBe(0);
  });

  it('starts ready when a location was restored from settings', () => {
    const { store } = makeHarness({}, MANUAL_MECCA);

    expect(store.getState().status).toBe('ready');
    expect(store.getState().lastResolvedAt).toBe(MANUAL_MECCA.resolvedAt);
  });
});

// ---------------------------------------------------------------------------
// requestAndResolve — granted
// ---------------------------------------------------------------------------

describe('requestAndResolve — permission granted', () => {
  it('prompts, resolves and persists through the settings store', async () => {
    const { store, settings, adapter } = makeHarness({
      permission: UNDETERMINED,
      permissionAfterRequest: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    const location = await store.getState().requestAndResolve();

    expect(adapter.calls.requestPermission).toBe(1);
    expect(location).toEqual({
      latitude: ISTANBUL.latitude,
      longitude: ISTANBUL.longitude,
      label: 'Istanbul, Türkiye',
      countryCode: 'TR',
      timeZone: 'Europe/Istanbul',
      source: 'auto',
      resolvedAt: NOW,
    });
    // The store keeps no copy of its own: settings is the source of truth.
    expect(settings.getState().location).toEqual(location);
    expect(statusOf(store)).toBe('ready');
    expect(store.getState().permission).toBe('granted');
    expect(store.getState().error).toBeNull();
    expect(store.getState().lastResolvedAt).toBe(NOW);
  });

  it('turns auto-following back on (the user just asked for the device location)', async () => {
    const { store, settings } = makeHarness({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });
    settings.getState().setUseAutoLocation(false);

    await store.getState().requestAndResolve();

    expect(settings.getState().useAutoLocation).toBe(true);
  });

  it('shares one in-flight resolution between concurrent callers', async () => {
    const { store, adapter } = makeHarness({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    const [a, b] = await Promise.all([
      store.getState().requestAndResolve(),
      store.getState().requestAndResolve(),
    ]);

    expect(a).toEqual(b);
    expect(adapter.calls.getCurrentPosition).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// requestAndResolve — denied and failures
// ---------------------------------------------------------------------------

describe('requestAndResolve — refusals and failures', () => {
  it('reports denied without storing anything when the user refuses', async () => {
    const { store, settings } = makeHarness({
      permission: UNDETERMINED,
      permissionAfterRequest: DENIED,
      position: ISTANBUL,
    });

    const location = await store.getState().requestAndResolve();

    expect(location).toBeNull();
    expect(settings.getState().location).toBeNull();
    expect(statusOf(store)).toBe('denied');
    expect(store.getState().error).toBe('permissionDenied');
    expect(store.getState().canAskAgain).toBe(false);
  });

  it('keeps an already-chosen city when a later permission request is refused', async () => {
    const { store, settings } = makeHarness(
      { permission: DENIED, position: ISTANBUL },
      MANUAL_MECCA
    );

    await store.getState().requestAndResolve();

    expect(statusOf(store)).toBe('denied');
    // The app is still fully usable: the manual city survived the refusal.
    expect(settings.getState().location).toEqual(MANUAL_MECCA);
  });

  it('reports an error (not a denial) when permission is granted but the fix fails', async () => {
    const { store, settings } = makeHarness({ permission: GRANTED, position: null });

    const location = await store.getState().requestAndResolve();

    expect(location).toBeNull();
    expect(statusOf(store)).toBe('error');
    expect(store.getState().error).toBe('positionUnavailable');
    expect(settings.getState().location).toBeNull();
  });

  it('stores a coordinate-labelled location when the geocoder is unavailable', async () => {
    const { store, settings } = makeHarness({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: null,
    });

    const location = await store.getState().requestAndResolve();

    expect(statusOf(store)).toBe('ready');
    expect(location?.label).toBe('41.01°N, 28.98°E');
    expect(location?.countryCode).toBeUndefined();
    expect(settings.getState().location?.latitude).toBe(ISTANBUL.latitude);
  });
});

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

describe('refresh', () => {
  it('never prompts — a launch with no permission stays silent', async () => {
    const { store, adapter } = makeHarness({ permission: UNDETERMINED, position: ISTANBUL });

    const location = await store.getState().refresh();

    expect(adapter.calls.requestPermission).toBe(0);
    expect(location).toBeNull();
    expect(statusOf(store)).toBe('denied');
  });

  it('re-resolves when permission is already granted', async () => {
    const { store, settings } = makeHarness({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    const location = await store.getState().refresh();

    expect(location?.label).toBe('Istanbul, Türkiye');
    expect(settings.getState().location?.label).toBe('Istanbul, Türkiye');
  });

  it('skips a still-fresh auto location, and re-resolves once it is stale', async () => {
    const { store, adapter, clock } = makeHarness({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    await store.getState().refresh();
    expect(adapter.calls.getCurrentPosition).toBe(1);

    clock.now = NOW + REFRESH_MIN_INTERVAL_MS - 1;
    await store.getState().refresh();
    expect(adapter.calls.getCurrentPosition).toBe(1);

    clock.now = NOW + REFRESH_MIN_INTERVAL_MS + 1;
    await store.getState().refresh();
    expect(adapter.calls.getCurrentPosition).toBe(2);
  });

  it('re-resolves a fresh location when forced', async () => {
    const { store, adapter } = makeHarness({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    await store.getState().refresh();
    await store.getState().refresh({ force: true });

    expect(adapter.calls.getCurrentPosition).toBe(2);
  });

  it('does nothing at all while auto-location is off', async () => {
    const { store, settings, adapter } = makeHarness(
      { permission: GRANTED, position: ISTANBUL, addresses: [ISTANBUL_ADDRESS] },
      MANUAL_MECCA
    );
    settings.getState().setUseAutoLocation(false);

    const location = await store.getState().refresh({ force: true });

    expect(adapter.calls.getPermission).toBe(0);
    expect(location).toEqual(MANUAL_MECCA);
    expect(settings.getState().location).toEqual(MANUAL_MECCA);
  });
});

// ---------------------------------------------------------------------------
// Manual selection
// ---------------------------------------------------------------------------

describe('manual location', () => {
  it('overrides an auto location and stops following the device', async () => {
    const { store, settings, adapter } = makeHarness({
      permission: GRANTED,
      position: ISTANBUL,
      addresses: [ISTANBUL_ADDRESS],
    });

    await store.getState().requestAndResolve();
    expect(settings.getState().location?.source).toBe('auto');

    store.getState().selectManualLocation(MANUAL_MECCA);

    expect(settings.getState().location).toEqual({ ...MANUAL_MECCA, resolvedAt: NOW });
    expect(settings.getState().useAutoLocation).toBe(false);
    expect(statusOf(store)).toBe('ready');

    // …and a later foreground refresh must not quietly take it back.
    const callsBefore = adapter.calls.getCurrentPosition;
    await store.getState().refresh({ force: true });
    expect(adapter.calls.getCurrentPosition).toBe(callsBefore);
    expect(settings.getState().location?.source).toBe('manual');
  });

  it('forces the manual source even if the caller passes an auto candidate', () => {
    const { store, settings } = makeHarness();

    store.getState().selectManualLocation({ ...MANUAL_MECCA, source: 'auto' });

    expect(settings.getState().location?.source).toBe('manual');
  });

  it('clears the stored location and returns to idle', async () => {
    const { store, settings } = makeHarness({}, MANUAL_MECCA);

    store.getState().clearLocation();

    expect(settings.getState().location).toBeNull();
    expect(statusOf(store)).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// searchCity & syncPermission
// ---------------------------------------------------------------------------

describe('searchCity', () => {
  it('returns manual candidates without touching the stored location', async () => {
    const { store, settings } = makeHarness({
      searchResults: [ISTANBUL, ANKARA],
      // Two candidates have to reverse-geocode to two different NAMES to stay two candidates:
      // `searchCity` drops anything that would render as a duplicate row (see its label pass).
      addressSequence: [[ISTANBUL_ADDRESS], [ANKARA_ADDRESS]],
    });

    const { results, error } = await store.getState().searchCity('istanbul');

    expect(error).toBeNull();
    expect(results).toHaveLength(2);
    expect(results[0]?.source).toBe('manual');
    expect(settings.getState().location).toBeNull();
    expect(store.getState().isSearching).toBe(false);
  });

  it('surfaces a geocoder failure and still clears the searching flag', async () => {
    const { store } = makeHarness({ searchResults: null });

    const { results, error } = await store.getState().searchCity('istanbul');

    expect(results).toEqual([]);
    expect(error).toBe('geocodeUnavailable');
    expect(store.getState().isSearching).toBe(false);
  });
});

describe('syncPermission', () => {
  it('clears a stale denial after the user grants permission in the OS settings', async () => {
    const { store, adapter } = makeHarness({ permission: DENIED, position: ISTANBUL });

    await store.getState().refresh();
    expect(statusOf(store)).toBe('denied');

    adapter.config.permission = GRANTED;
    const permission = await store.getState().syncPermission();

    expect(permission.granted).toBe(true);
    expect(store.getState().permission).toBe('granted');
    // Granting does not invent a location — the UI still has to ask for one.
    expect(statusOf(store)).toBe('idle');
    expect(store.getState().error).toBeNull();
  });

  it('marks the flow denied when permission is (still) missing', async () => {
    const { store } = makeHarness({ permission: DENIED });

    await store.getState().syncPermission();

    expect(statusOf(store)).toBe('denied');
    expect(store.getState().error).toBe('permissionDenied');
    expect(store.getState().canAskAgain).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

describe('selector hooks', () => {
  it('exposes stable actions and a live status through the singleton store', async () => {
    const { result } = await renderHook(() => ({
      status: useLocationStatus(),
      actions: useLocationActions(),
    }));

    const firstActions = result.current.actions;
    expect(typeof firstActions.requestAndResolve).toBe('function');
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.actions.reset();
    });

    expect(result.current.actions).toBe(firstActions);
  });
});
