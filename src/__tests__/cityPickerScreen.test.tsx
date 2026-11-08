/**
 * Screen test for the city picker (`src/app/city.tsx`).
 *
 * The picker is the app's **only** city search, reached from four places — the Today and Qibla
 * prompt cards, Settings → Location, and first-run setup. That is the point of it: "Choose a
 * city" used to push Settings → Location with the search focused, which answered a question asked
 * on Today by dropping the user into a different tab. So what is pinned here is the contract the
 * four callers depend on:
 *
 * 1. **It stores the choice and gets out of the way.** Picking a city writes it as the manual
 *    location and dismisses back to whoever presented the picker — never onward to somewhere new.
 * 2. **It can always be left empty-handed.** Closing changes nothing.
 * 3. **It never strands anyone.** With no history behind it (a cold start straight into the
 *    route) "back" still means Today rather than a black screen.
 * 4. **It keeps everything `CitySearch` already earned** — the debounce, the last-write-wins
 *    guard, the marker on the city in use, and a failure that explains itself — because it uses
 *    that component rather than a second search written here.
 *
 * The location store is faked so `searchCity` is scriptable; the settings store is real, because
 * "which city is marked as in use" is read from it.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import CityPickerScreen from '../app/city';
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
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockSearchCity = jest.fn<Promise<CitySearchResult>, [string]>();
const mockSelectManualLocation = jest.fn();

jest.mock('@/stores/locationStore', () => {
  const actions = {
    requestAndResolve: () => Promise.resolve(null),
    refresh: () => Promise.resolve(null),
    syncPermission: () => Promise.resolve({ status: 'granted', granted: true, canAskAgain: false }),
    searchCity: (query: string) => mockSearchCity(query),
    selectManualLocation: (location: unknown) => mockSelectManualLocation(location),
    clearLocation: () => undefined,
    reset: () => undefined,
  };
  return { useLocationActions: () => actions };
});

configure({ defaultIncludeHiddenElements: true });

const KADIKOY: AppLocation = {
  label: 'Kadıköy, Türkiye',
  latitude: 40.99,
  longitude: 29.03,
  countryCode: 'TR',
  source: 'manual',
  resolvedAt: 1,
};

const IZMIR: AppLocation = {
  label: 'İzmir, Türkiye',
  latitude: 38.42,
  longitude: 27.14,
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

/** Types a query and lets the debounce and the lookup settle. */
async function search(query: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('city-picker-search-input'), query);
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

async function renderPicker(location: AppLocation | null = null) {
  settings().resetToDefaults();
  settings().setLocation(location);
  await render(<CityPickerScreen />);
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.canGoBack.mockReturnValue(true);
  mockSelectManualLocation.mockClear();
  mockSearchCity.mockReset();
  mockSearchCity.mockResolvedValue({ results: [KADIKOY, IZMIR], error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('choosing a city', () => {
  it('stores the choice and dismisses back to whoever asked', async () => {
    await renderPicker();

    await search('Kad');
    await press(`city-result-${KADIKOY.label}`);

    expect(mockSelectManualLocation).toHaveBeenCalledWith(KADIKOY);
    expect(mockRouter.back).toHaveBeenCalled();
    // Never `push`: the picker answers the screen underneath it, it does not lead anywhere new.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('raises the keyboard on arrival — the user came here to type', async () => {
    await renderPicker();
    expect(screen.getByTestId('city-picker-search-input').props.autoFocus).toBe(true);
  });

  /**
   * With the keyboard up, a tap that lands on a result must *choose* it rather than be spent
   * dismissing the keyboard. That is `keyboardShouldPersistTaps="handled"` on the scroll view,
   * and it is the difference between one tap and two on the only screen where the keyboard is
   * always up.
   */
  it('lets a result be tapped while the keyboard is still up', async () => {
    await renderPicker();
    expect(screen.getByTestId('city-picker-scroll').props.keyboardShouldPersistTaps).toBe(
      'handled'
    );
    // And the results are inset by the keyboard rather than hidden under it.
    expect(screen.getByTestId('city-picker-scroll').props.automaticallyAdjustKeyboardInsets).toBe(
      true
    );
  });

  it('marks the city already in use, and only when the user chose it', async () => {
    await renderPicker({ ...KADIKOY, source: 'manual' });
    await search('Kad');
    expect(screen.getByTestId(`city-result-${KADIKOY.label}`).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );

    // An `auto` location is the device's answer, not a choice — the search cannot call it "in use".
    await renderPicker({ ...KADIKOY, source: 'auto' });
    await search('Kad');
    expect(screen.getAllByTestId(`city-result-${KADIKOY.label}`)[0].props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
  });
});

describe('leaving empty-handed', () => {
  it('closes without touching the stored location', async () => {
    await renderPicker();

    await press('city-picker-close');

    expect(mockSelectManualLocation).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('falls back to Today when there is no history to pop', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await renderPicker();

    await press('city-picker-close');

    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});

describe('what it inherits from CitySearch', () => {
  it('waits for the typing to settle before asking the geocoder', async () => {
    await renderPicker();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('city-picker-search-input'), 'I');
      fireEvent.changeText(screen.getByTestId('city-picker-search-input'), 'Is');
      fireEvent.changeText(screen.getByTestId('city-picker-search-input'), 'Ist');
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockSearchCity).toHaveBeenCalledTimes(1);
    expect(mockSearchCity).toHaveBeenCalledWith('Ist');
  });

  it('explains a geocoder it could not reach, and offers to try again', async () => {
    mockSearchCity.mockResolvedValue({ results: [], error: 'geocodeUnavailable' });
    await renderPicker();

    await search('Istanbul');

    expect(screen.getByTestId('city-picker-search-failed')).toBeTruthy();
    expect(screen.getByTestId('city-picker-search-retry')).toBeTruthy();
  });
});
