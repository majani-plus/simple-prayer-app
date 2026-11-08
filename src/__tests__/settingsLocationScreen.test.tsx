/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 */

/**
 * Screen test for Settings → Location (`src/app/settings/location.tsx`).
 *
 * PRODUCT_SPEC §10 makes one promise about this screen — **saying no costs you nothing** — and
 * the research explains why it matters (our market research: a permission flow that will not
 * take no for an answer is the category's signature dark pattern). The tests are therefore about
 * consent and about the manual path being genuinely equal:
 *
 * 1. Nothing prompts on its own. Mounting the screen reads the permission but never asks for it;
 *    only the switch can raise the OS dialog.
 * 2. A refusal is explained once, with the right sentence for "will ask again" versus "will not",
 *    and the system-settings deep link only where it is the actual way out.
 * 3. The manual route is always available, and it opens the app's one city picker (`app/city`)
 *    rather than a search of this screen's own — choosing the city is that screen's job now, and
 *    is pinned in `cityPickerScreen.test.tsx`.
 * 4. The privacy line is on screen.
 * 5. A city in another time zone is labelled (the M6 timezone decision — see `ClockZoneNote`).
 *
 * The location store is faked over a real zustand store, so flipping "permission denied"
 * re-renders the screen exactly as the real one would. The settings store is real.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import LocationSettingsScreen from '../app/settings/location';
import { initI18n } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import type { AppLocation } from '../domain/types';
import type { CitySearchResult } from '../services/location';

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
    }),
  };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
/** What `useLocalSearchParams` answers; `{ focus: 'city' }` simulates the prompt cards' route. */
const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
}));

const mockRequestAndResolve = jest.fn(() => Promise.resolve(null));
const mockRefresh = jest.fn((_options?: { force?: boolean }) => Promise.resolve(null));
const mockSyncPermission = jest.fn(() =>
  Promise.resolve({ status: 'undetermined', granted: false, canAskAgain: true })
);
const mockSearchCity = jest.fn<Promise<CitySearchResult>, [string]>();
const mockSelectManualLocation = jest.fn();

/**
 * A location store faked over a *real* zustand store, so a permission change propagates into the
 * screen the way the production store's subscription does. The actions object is a single stable
 * identity, as `useShallow` guarantees in the real one.
 */
jest.mock('@/stores/locationStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create<{
    status: string;
    permission: string;
    canAskAgain: boolean;
    error: string | null;
  }>(() => ({
    status: 'ready',
    permission: 'granted',
    canAskAgain: true,
    error: null,
  }));
  const actions = {
    requestAndResolve: () => mockRequestAndResolve(),
    refresh: (options?: { force?: boolean }) => mockRefresh(options),
    syncPermission: () => mockSyncPermission(),
    searchCity: (query: string) => mockSearchCity(query),
    selectManualLocation: (location: unknown) => mockSelectManualLocation(location),
    clearLocation: () => undefined,
    reset: () => undefined,
  };
  return {
    __store: store,
    useLocationStatus: () => store((state) => state.status),
    useIsResolvingLocation: () => store((state) => state.status === 'requesting'),
    useLocationError: () => store((state) => state.error),
    useLocationPermission: () => ({
      permission: store((state) => state.permission),
      canAskAgain: store((state) => state.canAskAgain),
    }),
    useLocationActions: () => actions,
  };
});

const flowStore = (
  jest.requireMock('@/stores/locationStore') as {
    __store: {
      setState: (patch: Record<string, unknown>) => void;
      getState: () => Record<string, unknown>;
    };
  }
).__store;

configure({ defaultIncludeHiddenElements: true });

const ISTANBUL: AppLocation = {
  label: 'Istanbul, Türkiye',
  latitude: 41.0082,
  longitude: 28.9784,
  countryCode: 'TR',
  timeZone: 'Europe/Istanbul',
  source: 'auto',
  resolvedAt: Date.UTC(2026, 7, 19, 6, 30),
};

const JAKARTA: AppLocation = {
  label: 'Jakarta, Indonesia',
  latitude: -6.2,
  longitude: 106.85,
  countryCode: 'ID',
  timeZone: 'Asia/Jakarta',
  source: 'manual',
  resolvedAt: Date.UTC(2026, 7, 19, 6, 30),
};

const KADIKOY: AppLocation = {
  label: 'Kadıköy, Türkiye',
  latitude: 40.99,
  longitude: 29.03,
  countryCode: 'TR',
  source: 'manual',
  resolvedAt: 1,
};

const settings = () => useSettingsStore.getState();

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

interface Flow {
  status?: string;
  permission?: string;
  canAskAgain?: boolean;
  error?: string | null;
}

async function renderScreen({
  location = ISTANBUL,
  useAutoLocation = true,
  flow = {},
}: { location?: AppLocation | null; useAutoLocation?: boolean; flow?: Flow } = {}) {
  // Not inside `act`: nothing is mounted yet, and an act scope around a plain store write
  // swallows the render that follows it.
  settings().resetToDefaults();
  settings().setLocation(location);
  settings().setUseAutoLocation(useAutoLocation);
  flowStore.setState({
    status: 'ready',
    permission: 'granted',
    canAskAgain: true,
    error: null,
    ...flow,
  });
  await render(<LocationSettingsScreen />);
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  mockRequestAndResolve.mockClear();
  mockRefresh.mockClear();
  mockSyncPermission.mockClear();
  mockSelectManualLocation.mockClear();
  mockRouter.back.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.canGoBack.mockClear();
  mockRouter.canGoBack.mockReturnValue(true);
  mockParams.current = {};
  mockSearchCity.mockReset();
  mockSearchCity.mockResolvedValue({ results: [KADIKOY], error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('what is in use', () => {
  it('names the current location and where it came from', async () => {
    await renderScreen();
    expect(screen.getByText(ISTANBUL.label)).toBeTruthy();
    expect(screen.getByText('From your device')).toBeTruthy();
  });

  it('says so plainly when there is none', async () => {
    await renderScreen({ location: null });
    expect(screen.getByText('No location yet')).toBeTruthy();
  });

  it('marks a manually chosen city as chosen', async () => {
    await renderScreen({ location: KADIKOY, useAutoLocation: false });
    expect(screen.getByText('City you chose')).toBeTruthy();
  });

  it('states the privacy position on the screen that collects the data', async () => {
    await renderScreen();
    // Never "it never leaves your device": `resolveAutoLocation` reverse-geocodes the coarse fix,
    // so the position does go to the platform geocoder. What is true — and what the footer has to
    // say — is that it is only ever handed to the phone's own map service, and never to us.
    expect(screen.getByText(/never precise, never in the background/)).toBeTruthy();
    // Both halves of the lookup — the manual search and the device position — say where it goes.
    expect(screen.getAllByText(/own map service/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/never leaves your device/)).toBeNull();
  });
});

describe('consent', () => {
  it('reads the permission on mount but never asks for it', async () => {
    await renderScreen();
    expect(mockSyncPermission).toHaveBeenCalled();
    expect(mockRequestAndResolve).not.toHaveBeenCalled();
  });

  it('asks only when the switch is turned on', async () => {
    await renderScreen({ useAutoLocation: false, flow: { permission: 'undetermined' } });
    await press('location-auto-switch');
    expect(mockRequestAndResolve).toHaveBeenCalledTimes(1);
  });

  it('turning the switch off stops following the device without losing the location', async () => {
    await renderScreen();
    await press('location-auto-switch');
    expect(settings().useAutoLocation).toBe(false);
    expect(settings().location).not.toBeNull();
    expect(mockRequestAndResolve).not.toHaveBeenCalled();
  });

  it('explains a refusal the OS will reconsider, and offers to ask again', async () => {
    await renderScreen({
      flow: { status: 'denied', permission: 'denied', canAskAgain: true, error: 'permissionDenied' },
    });
    expect(screen.getByTestId('location-denied')).toBeTruthy();
    expect(screen.getByText(/completely fine/)).toBeTruthy();

    await press('location-denied-action');
    expect(mockRequestAndResolve).toHaveBeenCalledTimes(1);
  });

  it('sends a permanently refused user to the system settings instead of asking again', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await renderScreen({
      flow: {
        status: 'denied',
        permission: 'denied',
        canAskAgain: false,
        error: 'permissionDenied',
      },
    });
    expect(screen.getByText(/will not ask again/)).toBeTruthy();

    await press('location-denied-action');
    expect(openSettings).toHaveBeenCalled();
    expect(mockRequestAndResolve).not.toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it('never explains a refusal to someone who is not asking for the device anyway', async () => {
    await renderScreen({
      useAutoLocation: false,
      flow: { status: 'denied', permission: 'denied', canAskAgain: false },
    });
    expect(screen.queryByTestId('location-denied')).toBeNull();
  });
});

describe('refreshing', () => {
  it('is offered while the permission is granted, and forces a re-resolve', async () => {
    await renderScreen();
    await press('location-refresh');
    expect(mockRefresh).toHaveBeenCalledWith({ force: true });
  });

  it('is not offered without the permission', async () => {
    await renderScreen({ flow: { permission: 'denied', status: 'denied' } });
    expect(screen.queryByTestId('location-refresh')).toBeNull();
  });

  it('offers a retry when the fix itself failed', async () => {
    await renderScreen({ flow: { status: 'error', error: 'positionUnavailable' } });
    expect(screen.getByTestId('location-failed')).toBeTruthy();
    await press('location-failed-action');
    expect(mockRefresh).toHaveBeenCalledWith({ force: true });
  });
});

describe('the manual path', () => {
  it('is on the screen whether or not the device is being used', async () => {
    await renderScreen();
    expect(screen.getByTestId('location-choose-city')).toBeTruthy();
  });

  it('opens the shared city picker rather than a second search of its own', async () => {
    await renderScreen({ useAutoLocation: false, location: null });

    await press('location-choose-city');

    expect(mockRouter.push).toHaveBeenCalledWith('/city');
  });

  /**
   * The screen used to host its own `CitySearch`, and the Today/Qibla cards used to push here
   * with `?focus=city` to reach it — which answered a question asked on Today by moving the user
   * to the Settings tab. There is now exactly one city search in the app (`app/city`), and this
   * is the guard against a second one growing back here.
   */
  it('hosts no search field itself', async () => {
    await renderScreen();
    expect(screen.queryByTestId('city-search')).toBeNull();
    expect(screen.queryByTestId('city-search-input')).toBeNull();
  });
});

describe('the clock a city is written on', () => {
  it('is labelled when the chosen city keeps a different one', async () => {
    await renderScreen({ location: JAKARTA, useAutoLocation: false });
    // The row above already names the city, so the note is read from inside its own card.
    const note = screen.getByTestId('clock-zone-note');
    expect(note).toBeTruthy();
    expect(within(note).getByText(/Jakarta, Indonesia/)).toBeTruthy();
    // Jakarta (UTC+7) against an Istanbul phone (UTC+3): four hours, and which way.
    expect(within(note).getByText(/4 hours/)).toBeTruthy();
    expect(within(note).getByText(/ahead/)).toBeTruthy();
  });

  it('says nothing when the clocks agree', async () => {
    await renderScreen();
    expect(screen.queryByTestId('clock-zone-note')).toBeNull();
  });
});

describe('leaving', () => {
  it('goes back', async () => {
    await renderScreen();
    await press('location-settings-back');
    expect(mockRouter.back).toHaveBeenCalled();
  });

  // Cold start straight into this route (a process restart while it was foregrounded) leaves no
  // history to pop. Back must still mean "up to the tab this hangs off", not "over to Today".
  it('falls back to Settings, not Today, when there is no history to pop', async () => {
    mockRouter.canGoBack.mockReturnValueOnce(false);

    await renderScreen();
    await press('location-settings-back');

    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings');
  });
});
