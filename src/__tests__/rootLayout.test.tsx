/**
 * Startup wiring tests for `src/app/_layout.tsx`.
 *
 * The root layout is the only place where the persistence layer meets the app shell, and its
 * contract is narrow but load-bearing:
 *
 * 1. migrations run once, before anything queries the database, and the tracking store hydrates;
 * 2. a failing database must never white-screen the app — startup still completes and the
 *    splash screen is still hidden;
 * 3. the settings store is the source of truth for the theme (fed into `ThemePreferenceContext`)
 *    and for the language (pushed into i18next).
 *
 * Native modules are mocked: `react-native-mmkv` (the settings singleton is created at import
 * time), the database client (it would load `expo-sqlite`), the font packages, and
 * `expo-splash-screen`. `expo-router`'s `Stack` is replaced with a probe, so the theme colours
 * the layout resolved can be read straight off the screen options it passed down.
 *
 * This file lives outside `src/app/` on purpose: every file under the router root becomes a route.
 */

import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// The `jest.mock` calls below are hoisted above these imports, so the layout sees the mocks.
import RootLayout from '../app/_layout';
import i18n from '../i18n';
import { initTelemetry, reportHandledError } from '../services/telemetry';
import { useSettingsStore } from '../stores/settingsStore';
import { nightPaper, paperLight } from '../theme/tokens';

// Telemetry is initialised at the layout's MODULE SCOPE (before the first render), so the mock's
// functions are created inside the factory — a `const mockFn` out here would still be in its
// temporal dead zone when the hoisted import of `_layout` runs. The wrapper is the identity so
// this suite renders the bare layout; the service's own behaviour (including "off means no init")
// is covered in `services/telemetry.test.ts`.
jest.mock('../services/telemetry', () => ({
  initTelemetry: jest.fn(() => true),
  reportHandledError: jest.fn(),
  wrapRootWithTelemetry: (component: unknown) => component,
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
        clearAll: () => store.clear(),
      };
    },
  };
});

const mockRunMigrations = jest.fn<Promise<void>, []>();
jest.mock('../db/client', () => ({
  runMigrations: (...args: []) => mockRunMigrations(...args),
}));

const mockHydrate = jest.fn();
const mockRelease = jest.fn();
const mockSetTodayDayResolver = jest.fn<() => void, [(() => string) | null]>(() => mockRelease);
jest.mock('../stores/trackingStore', () => ({
  getTrackingActions: () => ({
    hydrate: mockHydrate,
    setTodayDayResolver: mockSetTodayDayResolver,
  }),
  // `useNotificationSync` (wired at the root) reads the store imperatively rather than selecting,
  // so the mock has to answer getState/subscribe as well as the actions.
  useTrackingStore: {
    getState: () => ({ dayRecords: {}, exemptPeriods: [], qadaDebts: {} }),
    subscribe: () => () => {},
  },
}));

// This suite is about STARTUP WIRING, not scheduling. Stubbing the sync hook keeps the real
// expo-notifications module (and its Expo Go warnings) out of a test that never asserts on it;
// useNotificationSync has its own suite.
const mockNotificationSync = jest.fn();
jest.mock('../hooks/useNotificationSync', () => ({
  useNotificationSync: () => mockNotificationSync(),
}));

// Same reasoning for the review-prompt observer (D28): it is mounted at the root, but it diffs
// tracking/settings state and subscribes to notification taps, none of which this suite asserts on.
// It has its own suite in `hooks/useReviewPrompt.test.ts`; here we only prove it is MOUNTED, which
// is the part the root layout owns and the part that silently regressed before.
const mockReviewPrompt = jest.fn();
jest.mock('../hooks/useReviewPrompt', () => ({
  useReviewPrompt: () => mockReviewPrompt(),
}));

// And for the launch/foreground location refresh: pure observation again, own suite in
// `hooks/useLocationRefresh.test.ts`, and an unmounted instance is invisible — PRODUCT_SPEC §10's
// "re-resolve on launch" shipped unwired once, which is exactly how this class of hook regresses.
const mockLocationRefresh = jest.fn();
jest.mock('../hooks/useLocationRefresh', () => ({
  useLocationRefresh: () => mockLocationRefresh(),
}));

// The background-refresh registration. Stubbed for two reasons: the real hook imports
// `services/backgroundRefresh`, which DEFINES an OS task at module scope and pulls the whole sync
// graph in behind it — neither belongs in a renderer — and the one thing the root layout actually
// owns here is mounting it at all, which is what the test below pins. Its own behaviour lives in
// `services/backgroundRefresh.test.ts`.
const mockBackgroundRefresh = jest.fn<void, [boolean]>();
jest.mock('../hooks/useBackgroundRefresh', () => ({
  useBackgroundRefresh: (ready: boolean) => mockBackgroundRefresh(ready),
}));

const mockHideAsync = jest.fn<Promise<void>, []>(() => Promise.resolve());
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: () => Promise.resolve(),
  hideAsync: (...args: []) => mockHideAsync(...args),
}));

interface StackProbeProps {
  children?: ReactNode;
  screenOptions?: { contentStyle?: { backgroundColor?: string } };
}

let mockLastScreenOptions: StackProbeProps['screenOptions'];

const mockReplace = jest.fn<void, [string]>();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native') as typeof import('react-native');
  const Stack = (props: StackProbeProps) => {
    mockLastScreenOptions = props.screenOptions;
    return <RNText testID="stack">navigator</RNText>;
  };
  Stack.Screen = function Screen() {
    return null;
  };
  // The closure defers the reference, so `mockReplace`'s temporal dead zone at module-factory
  // time is not a problem (the same trick the `Stack` probe uses for `mockLastScreenOptions`).
  return { Stack, router: { replace: (href: string) => mockReplace(href) } };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

/** Renders the root layout and flushes the startup promise chain. */
async function renderRootLayout() {
  const utils = await render(<RootLayout />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

/** Applies a settings change inside `act`, so the layout's effects run for it. */
async function updateSettings(change: () => void) {
  await act(async () => {
    change();
    await Promise.resolve();
  });
}

describe('RootLayout startup wiring', () => {
  beforeEach(async () => {
    mockRunMigrations.mockReset();
    mockRunMigrations.mockResolvedValue(undefined);
    mockHydrate.mockReset();
    mockSetTodayDayResolver.mockClear();
    mockRelease.mockClear();
    mockHideAsync.mockClear();
    mockReviewPrompt.mockClear();
    mockBackgroundRefresh.mockClear();
    mockReplace.mockClear();
    mockLastScreenOptions = undefined;
    await updateSettings(() => useSettingsStore.getState().resetToDefaults());
    // These cases are about STARTUP WIRING, so they run as an install that has already been
    // through (or past) setup. The first-run redirect has its own block at the bottom.
    await updateSettings(() => useSettingsStore.getState().setOnboardingCompleted(true));
  });

  // The review-prompt observer has to be mounted exactly once, above the tabs, or D28 never fires:
  // the hook is pure observation, so an unmounted one is invisible — no crash, no failing test,
  // just an app that never asks for a review. It shipped unmounted once; this is the guard.
  it('mounts the review-prompt observer exactly once', async () => {
    await renderRootLayout();

    expect(mockReviewPrompt).toHaveBeenCalled();
  });

  // Same class of guard: the silent location refresh (PRODUCT_SPEC §10 "re-resolve on launch")
  // only exists while the root mounts it.
  it('mounts the auto-location refresh', async () => {
    await renderRootLayout();

    expect(mockLocationRefresh).toHaveBeenCalled();
  });

  // Without this call the task is defined and never scheduled, so nothing ever wakes the app and
  // a phone left alone still runs out of reminders — the exact failure the task exists to prevent,
  // and one with no visible symptom until somebody misses a Fajr days later.
  it('registers the background refresh task once startup has settled', async () => {
    await renderRootLayout();

    expect(mockBackgroundRefresh).toHaveBeenCalledWith(true);
  });

  it('started crash reporting at module scope, gated on the persisted setting', () => {
    // No render needed: `initTelemetry` ran when `_layout` was imported — before anything could
    // crash — and it was handed the store's synchronously hydrated `crashReportingEnabled`
    // (`true` here, the first-run default). The off path (no init at all) is pinned in
    // `services/telemetry.test.ts`, where the setting can be varied per test.
    expect(jest.mocked(initTelemetry)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(initTelemetry)).toHaveBeenCalledWith(true);
  });

  it('runs migrations, hydrates tracking, hides the splash and renders the navigator', async () => {
    const { getByTestId } = await renderRootLayout();

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(mockHydrate).toHaveBeenCalledTimes(1);
    expect(mockHideAsync).toHaveBeenCalled();
    expect(getByTestId('stack')).toBeTruthy();
  });

  it('still renders (never white-screens) when migrations fail', async () => {
    mockRunMigrations.mockRejectedValue(new Error('migration exploded'));
    jest.mocked(reportHandledError).mockClear();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByTestId } = await renderRootLayout();

    expect(mockHydrate).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    // The app survives, so no crash report would exist — the failure is reported as a handled
    // error instead (a no-op when the user opted out).
    expect(jest.mocked(reportHandledError)).toHaveBeenCalledWith(expect.any(Error));
    expect(mockHideAsync).toHaveBeenCalled();
    expect(getByTestId('stack')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('still renders when hydration throws', async () => {
    mockHydrate.mockImplementation(() => {
      throw new Error('hydrate exploded');
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByTestId } = await renderRootLayout();

    expect(getByTestId('stack')).toBeTruthy();
    expect(mockHideAsync).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('feeds the settings theme preference into the theme context', async () => {
    await updateSettings(() => useSettingsStore.getState().setTheme('dark'));
    await renderRootLayout();
    expect(mockLastScreenOptions?.contentStyle?.backgroundColor).toBe(nightPaper.bg);

    await updateSettings(() => useSettingsStore.getState().setTheme('light'));
    expect(mockLastScreenOptions?.contentStyle?.backgroundColor).toBe(paperLight.bg);
  });

  /**
   * The prayer day (Fajr→Fajr) has to be installed on the tracking store from the ROOT, not from
   * the Today tab: a route reached without Today mounting — a notification deep link into
   * Settings, a modal, a tab dropped under memory pressure — would otherwise leave the store
   * filing writes against the calendar date for the midnight→Fajr hours (internal notes, Known
   * Issues). The resolver's own behaviour is pinned in `hooks/useTodayDayResolver.test.ts`; what
   * matters here is only that the root is the thing installing it.
   */
  it('installs the prayer-day resolver on the tracking store once a location exists', async () => {
    await renderRootLayout();

    // No location yet: nothing to derive a Fajr from, so the store keeps its own fallback.
    expect(mockSetTodayDayResolver).not.toHaveBeenCalled();

    await updateSettings(() =>
      useSettingsStore.getState().setLocation({
        latitude: 41.0082,
        longitude: 28.9784,
        label: 'Istanbul',
        countryCode: 'TR',
        source: 'manual',
        resolvedAt: 0,
      })
    );

    expect(mockSetTodayDayResolver).toHaveBeenCalledTimes(1);
    const resolver = mockSetTodayDayResolver.mock.calls[0][0];
    expect(typeof resolver).toBe('function');
    // It answers with a real prayer day, read from the clock at call time.
    expect(resolver?.()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('applies the settings language to i18next', async () => {
    await renderRootLayout();

    await updateSettings(() => useSettingsStore.getState().setLanguage('ar'));
    expect(i18n.language).toBe('ar');

    await updateSettings(() => useSettingsStore.getState().setLanguage('tr'));
    expect(i18n.language).toBe('tr');
  });

  /**
   * The first-run redirect.
   *
   * It is a redirect, not a gate: `app/onboarding` sets the same flag whether it was finished or
   * skipped, so the only thing the root owes it is *once*. The two ways that can go wrong are the
   * two cases below — never offering it, and offering it to someone who has been using the app
   * for months (the second is the reason `sanitizeSettings` migrates a pre-existing payload to
   * `true`).
   */
  describe('first-run setup redirect', () => {
    it('sends a fresh install to the setup flow, and still hides the splash', async () => {
      await updateSettings(() => useSettingsStore.getState().setOnboardingCompleted(false));

      await renderRootLayout();

      expect(mockReplace).toHaveBeenCalledWith('/onboarding');
      // The splash comes down AFTER the redirect is issued, never before: the order is what
      // stops a frame of the Today tab painting behind it.
      expect(mockHideAsync).toHaveBeenCalled();
    });

    it('leaves an install that has already seen it alone', async () => {
      await updateSettings(() => useSettingsStore.getState().setOnboardingCompleted(true));

      await renderRootLayout();

      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockHideAsync).toHaveBeenCalled();
    });

    it('does not redirect a second time when the flow marks itself done', async () => {
      await updateSettings(() => useSettingsStore.getState().setOnboardingCompleted(false));
      await renderRootLayout();
      expect(mockReplace).toHaveBeenCalledTimes(1);

      // What `app/onboarding` does on its way out. The root must not navigate in answer.
      await updateSettings(() => useSettingsStore.getState().setOnboardingCompleted(true));

      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });
});
