/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 */

/**
 * Screen test for Settings → Prayer times (`src/app/settings/calculation.tsx`).
 *
 * This screen carries the app's credibility (PRODUCT_SPEC §3, our market research), so the
 * tests are about the promises rather than the pixels:
 *
 * 1. **The authority is named.** The summary says which authority is in force and whether it was
 *    chosen automatically or by the user — and it changes when the user overrides it.
 * 2. **Every change previews itself.** The madhab rows show what Asr would be under each school;
 *    the offset rows show the resulting time; the Hijri stepper shows the resulting date.
 * 3. **Every change is written through the settings store**, which is the single source the Today
 *    tab and the notification planner read — so "reflected immediately on Today" is a property of
 *    where the write lands, and that is what is asserted.
 * 4. **The rule that does not apply says so.** The high-latitude section is quiet at 41°N and
 *    open at 69°N.
 *
 * The real settings store is used (over an in-memory MMKV), so the clamps, the sanitizer and the
 * selector hooks are the production ones. The timezone is pinned so "one minute later" is a fact
 * rather than a coincidence of where CI is standing.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import CalculationSettingsScreen from '../app/settings/calculation';
import { initI18n } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import type { AppLocation } from '../domain/types';

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

configure({ defaultIncludeHiddenElements: true });

const ISTANBUL: AppLocation = {
  label: 'Istanbul, Türkiye',
  latitude: 41.0082,
  longitude: 28.9784,
  countryCode: 'TR',
  timeZone: 'Europe/Istanbul',
  source: 'auto',
  resolvedAt: 1,
};

/** Tromsø — well above the 48° line where the high-latitude rule starts to matter. */
const TROMSO: AppLocation = {
  label: 'Tromsø, Norway',
  latitude: 69.6492,
  longitude: 18.9553,
  countryCode: 'NO',
  source: 'manual',
  resolvedAt: 1,
};

const calculation = () => useSettingsStore.getState().calculation;

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function renderScreen(location: AppLocation | null = ISTANBUL) {
  // Deliberately NOT wrapped in `act`: nothing is mounted yet, and opening an act scope around a
  // plain zustand write swallows the render that follows it.
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.getState().setLocation(location);
  await render(<CalculationSettingsScreen />);
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  mockRouter.back.mockClear();
});

describe('the authority', () => {
  it('names what auto resolved to, and says the app chose it', async () => {
    await renderScreen();
    expect(screen.getByTestId('calculation-summary-authority')).toHaveTextContent('Diyanet');
    expect(screen.getByText('Chosen automatically for your country')).toBeTruthy();
  });

  it('opens the full list and writes the chosen authority through the store', async () => {
    await renderScreen();
    expect(screen.queryByTestId('method-picker')).toBeNull();

    await press('calculation-method-toggle');
    expect(screen.getByTestId('method-picker')).toBeTruthy();

    await press('method-option-ummAlQura');

    expect(calculation().method).toBe('ummAlQura');
    expect(screen.getByTestId('calculation-summary-authority')).toHaveTextContent('Umm al-Qura');
    expect(screen.getByText('Chosen by you')).toBeTruthy();
    // Choosing closes the list again — the screen returns to its overview.
    expect(screen.queryByTestId('method-picker')).toBeNull();
  });
});

describe('the Asr madhab', () => {
  it('previews what each school would produce today', async () => {
    await renderScreen();
    const shafi = screen.getByTestId('calculation-madhab-shafi').props.accessibilityValue?.text;
    const hanafi = screen.getByTestId('calculation-madhab-hanafi').props.accessibilityValue?.text;

    expect(typeof shafi).toBe('string');
    expect(typeof hanafi).toBe('string');
    // The whole point of the setting: the two schools disagree, visibly, before you commit.
    expect(shafi).not.toEqual(hanafi);
  });

  it('writes the chosen school through the store', async () => {
    await renderScreen();
    expect(calculation().madhab).toBe('shafi');
    await press('calculation-madhab-hanafi');
    expect(calculation().madhab).toBe('hanafi');
  });
});

describe('the high-latitude rule', () => {
  it('is folded away, and labelled as irrelevant, where it changes nothing', async () => {
    await renderScreen(ISTANBUL);
    expect(screen.queryByTestId('calculation-latitude-options')).toBeNull();
    expect(screen.getByText(/changes nothing where you are/)).toBeTruthy();
  });

  it('can still be opened by anyone who wants it', async () => {
    await renderScreen(ISTANBUL);
    await press('calculation-latitude-toggle');
    expect(screen.getByTestId('calculation-latitude-options')).toBeTruthy();
  });

  it('is open and flagged as relevant far enough north', async () => {
    await renderScreen(TROMSO);
    expect(screen.getByTestId('calculation-latitude-options')).toBeTruthy();
    expect(screen.getByText(/far enough north/)).toBeTruthy();
  });

  it('writes the chosen rule through the store', async () => {
    await renderScreen(TROMSO);
    await press('calculation-latitude-seventhOfTheNight');
    expect(calculation().highLatitudeRule).toBe('seventhOfTheNight');
  });
});

describe('the per-prayer offsets', () => {
  it('moves one prayer and shows the resulting time', async () => {
    await renderScreen();
    const before = screen.getByTestId('calculation-offset-time-fajr').props.children;

    await press('calculation-offset-stepper-fajr-increase');

    expect(calculation().offsets.fajr).toBe(1);
    const after = screen.getByTestId('calculation-offset-time-fajr').props.children;
    expect(after).not.toEqual(before);
    // Only the prayer that was touched moves.
    expect(calculation().offsets.dhuhr).toBe(0);
  });

  it('goes negative too', async () => {
    await renderScreen();
    await press('calculation-offset-stepper-isha-decrease');
    expect(calculation().offsets.isha).toBe(-1);
  });

  it('stops at the store’s ±30 bound', async () => {
    await renderScreen();
    await act(async () => {
      useSettingsStore.getState().setPrayerOffset('asr', 30);
    });
    const increase = screen.getByTestId('calculation-offset-stepper-asr-increase');
    expect(increase.props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      fireEvent.press(increase);
    });
    expect(calculation().offsets.asr).toBe(30);
  });

  it('offers a reset only once something has been adjusted, and clears every prayer', async () => {
    await renderScreen();
    expect(screen.queryByTestId('calculation-offsets-reset')).toBeNull();

    await press('calculation-offset-stepper-fajr-increase');
    await press('calculation-offset-stepper-maghrib-decrease');
    expect(screen.getByTestId('calculation-summary-adjusted')).toBeTruthy();

    await press('calculation-offsets-reset');

    expect(calculation().offsets).toEqual({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });
    expect(screen.queryByTestId('calculation-offsets-reset')).toBeNull();
    expect(screen.queryByTestId('calculation-summary-adjusted')).toBeNull();
  });
});

describe('the Hijri offset', () => {
  it('shows the resulting date and moves it a day at a time', async () => {
    await renderScreen();
    const before = screen.getByTestId('calculation-hijri-stepper-description').props.children;

    await press('calculation-hijri-stepper-increase');

    expect(calculation().hijriOffset).toBe(1);
    expect(screen.getByTestId('calculation-hijri-stepper-description').props.children).not.toEqual(before);
  });

  it('stops at ±2 days', async () => {
    await renderScreen();
    await press('calculation-hijri-stepper-increase');
    await press('calculation-hijri-stepper-increase');
    expect(calculation().hijriOffset).toBe(2);
    expect(
      screen.getByTestId('calculation-hijri-stepper-increase').props.accessibilityState
    ).toMatchObject({ disabled: true });
  });
});

describe('without a location', () => {
  it('still lets every setting be changed, and says why there are no previews', async () => {
    await renderScreen(null);
    expect(screen.getByTestId('calculation-no-location')).toBeTruthy();
    expect(screen.queryByTestId('calculation-offset-time-fajr')).toBeNull();

    await press('calculation-offset-stepper-fajr-increase');
    expect(calculation().offsets.fajr).toBe(1);
  });
});

describe('leaving', () => {
  it('goes back', async () => {
    await renderScreen();
    await press('calculation-back');
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
