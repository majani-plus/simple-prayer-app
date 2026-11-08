/**
 * Screen test for the first-run setup flow (`src/app/onboarding.tsx`).
 *
 * The flow exists in tension with PRODUCT_SPEC §10 — "no dark-pattern onboarding; the app works
 * before it asks for anything" — and the resolution is a rule rather than a wording: **it may
 * offer, and it may never gate.** Everything below is a way for that rule to be broken silently,
 * which is why these are the tests:
 *
 * 1. **Nothing is asked on arrival.** Mounting the flow requests neither the location nor the
 *    notification permission. Only a tap on the control that names the ask may raise a dialog.
 * 2. **The whole flow can be declined**, and someone who declines it lands on Today with their
 *    settings exactly as the app shipped them — not a degraded state, the old state.
 * 3. **Every step can be left.** Each one either offers an explicit way out or costs nothing to
 *    accept; the steps that ask for something (location, reminders, qada) carry the way out.
 * 4. **The reminder choice and the Today pill tell one story.** "No reminders" has to silence
 *    every kind, or the user is nudged by a feature they just switched off; a sound choice has to
 *    be the thing that asks the OS, or the pill goes back to promising what it cannot deliver
 *    (the app's worst first-run bug, spec-accessibility §4.1).
 * 5. **The streak default is not changed behind anyone's back** (D68): tapping through the flow
 *    lands on Committed, but a person who never reaches that step keeps the forgiving default.
 *
 * The location store is faked over a real zustand store so a permission change re-renders the
 * screen the way production does; the settings store is real, because what the flow *writes* is
 * half of what is being tested. `expo-router` is a spy: leaving the flow is a `replace`, and
 * which href it replaces with is the difference between "into the qada wizard" and "to Today".
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';

import OnboardingScreen from '../app/onboarding';
import { PRAYERS } from '../domain/types';
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

/** An href the flow may leave with: a plain route, or one carrying params (the qada hand-over). */
type TestHref = string | { pathname: string; params: Record<string, string> };

const mockReplace = jest.fn<void, [TestHref]>();
const mockPush = jest.fn<void, [TestHref]>();
jest.mock('expo-router', () => ({
  router: {
    replace: (href: unknown) => mockReplace(href as TestHref),
    push: (href: unknown) => mockPush(href as TestHref),
  },
}));

const mockRequestAndResolve = jest.fn(() => Promise.resolve(null));
const mockSelectManualLocation = jest.fn();
const mockSearchCity = jest.fn(() => Promise.resolve({ results: [], error: null }));

jest.mock('@/stores/locationStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create<{ status: string; permission: string; canAskAgain: boolean }>(() => ({
    status: 'idle',
    permission: 'undetermined',
    canAskAgain: true,
  }));
  const actions = {
    requestAndResolve: () => mockRequestAndResolve(),
    refresh: () => Promise.resolve(null),
    syncPermission: () => Promise.resolve({ status: 'undetermined', granted: false, canAskAgain: true }),
    searchCity: () => mockSearchCity(),
    selectManualLocation: (location: unknown) => mockSelectManualLocation(location),
    clearLocation: () => undefined,
    reset: () => undefined,
  };
  return {
    __store: store,
    useLocationStatus: () => store((state) => state.status),
    useIsResolvingLocation: () => store((state) => state.status === 'requesting'),
    useLocationError: () => null,
    useLocationPermission: () => ({
      permission: store((state) => state.permission),
      canAskAgain: store((state) => state.canAskAgain),
    }),
    useLocationActions: () => actions,
  };
});

const mockOpenBatterySettings = jest.fn(() => Promise.resolve('opened'));
// Stubbed rather than exercised: the real module reaches for `expo-device` and
// `expo-intent-launcher`, and its own behaviour (OEM detection, the fallback chain) is pinned in
// `services/batteryGuidance.test.ts`. What matters here is only which screen the step opens.
jest.mock('@/services/batteryGuidance', () => ({
  currentOemFamily: () => 'samsung',
  hasAggressiveBatteryManager: () => true,
  openBatteryOptimisationSettings: () => mockOpenBatterySettings(),
}));

/**
 * Exact alarms (D91), stubbed the same way and for the same reason: the real module reaches for a
 * native module, and its own behaviour is pinned in `services/exactAlarms.test.ts`. The state is
 * held in a variable so a test can change the answer mid-run — which is the whole point of the
 * permission, since the user leaves for a system screen and comes back with a different one.
 */
let mockExactAlarms: 'exact' | 'inexact' | 'unknown';
const mockOpenExactAlarms = jest.fn(() => Promise.resolve('opened'));
jest.mock('@/services/exactAlarms', () => ({
  readExactAlarmState: () => Promise.resolve(mockExactAlarms),
  openExactAlarmSettings: () => mockOpenExactAlarms(),
}));

/** The rebuild the flow owes anyone who allows exact alarms while it is running. */
const mockRebuild = jest.fn(() => Promise.resolve(null));
jest.mock('@/hooks/useNotificationSync', () => ({
  rebuildNotificationsFromStores: () => mockRebuild(),
}));

const mockRequestNotifications = jest.fn();
const mockOpenSystemSettings = jest.fn();

/**
 * The notification permission, faked over a real store so "the OS just answered" propagates into
 * the step exactly as the production hook's `setState` does.
 */
jest.mock('@/hooks/useNotificationPermission', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create<{
    permission: { status: string; granted: boolean; canAskAgain: boolean } | null;
  }>(() => ({ permission: { status: 'undetermined', granted: false, canAskAgain: true } }));
  return {
    __store: store,
    useNotificationPermission: () => ({
      permission: store((state) => state.permission),
      request: () => mockRequestNotifications(),
      openSystemSettings: () => mockOpenSystemSettings(),
    }),
  };
});

const locationFlow = (
  jest.requireMock('@/stores/locationStore') as {
    __store: { setState: (patch: Record<string, unknown>) => void };
  }
).__store;

const notificationFlow = (
  jest.requireMock('@/hooks/useNotificationPermission') as {
    __store: { setState: (patch: Record<string, unknown>) => void };
  }
).__store;

configure({ defaultIncludeHiddenElements: true });

const ISTANBUL: AppLocation = {
  label: 'Istanbul, Türkiye',
  latitude: 41.0082,
  longitude: 28.9784,
  countryCode: 'TR',
  source: 'auto',
  resolvedAt: 1,
};

/** The permission an accepted (or already-granted) notification step sees. */
const GRANTED = { status: 'granted', granted: true, canAskAgain: false };

const settings = () => useSettingsStore.getState();

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** Presses whichever primary button the current step is showing. */
async function advance() {
  const primary =
    screen.queryByTestId('onboarding-primary') ??
    screen.queryByTestId('onboarding-notifications-primary') ??
    screen.queryByTestId('onboarding-tracking-continue') ??
    screen.queryByTestId('onboarding-streak-continue') ??
    screen.getByTestId('onboarding-location-continue');
  await act(async () => {
    fireEvent.press(primary);
  });
}

interface Options {
  location?: AppLocation | null;
  locationStatus?: string;
  canAskAgain?: boolean;
  notificationPermission?: { status: string; granted: boolean; canAskAgain: boolean } | null;
}

async function renderFlow({
  location = null,
  locationStatus = 'idle',
  canAskAgain = true,
  notificationPermission = { status: 'undetermined', granted: false, canAskAgain: true },
}: Options = {}) {
  settings().resetToDefaults();
  settings().setLocation(location);
  locationFlow.setState({ status: locationStatus, permission: 'undetermined', canAskAgain });
  notificationFlow.setState({ permission: notificationPermission });
  await render(<OnboardingScreen />);
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  mockExactAlarms = 'exact';
  mockOpenExactAlarms.mockClear();
  mockRebuild.mockClear();
  mockReplace.mockClear();
  mockPush.mockClear();
  mockRequestAndResolve.mockClear();
  mockSelectManualLocation.mockClear();
  mockRequestNotifications.mockClear();
  mockOpenSystemSettings.mockClear();
});

/* ---------------------------------------------------------------------------------------- */

describe('nothing is asked before it is tapped', () => {
  it('mounts without requesting either permission', async () => {
    await renderFlow();

    expect(mockRequestAndResolve).not.toHaveBeenCalled();
    expect(mockRequestNotifications).not.toHaveBeenCalled();
  });

  it('only ever asks from a control that says what it is about to do', async () => {
    await renderFlow();

    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance(); // theme — "Continue", and it asks for nothing
    expect(mockRequestNotifications).not.toHaveBeenCalled();

    // The reminder step's forward button reads "Allow notifications" while a sound is chosen and
    // the OS has not been asked. Pressing it asks, and goes no further: the answer is meant to be
    // seen on the step that asked for it, not behind a transition.
    await advance();
    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);
    expect(mockRequestAndResolve).not.toHaveBeenCalled();
  });
});

describe('declining the whole flow', () => {
  it('lands on Today with every setting exactly as it shipped', async () => {
    await renderFlow();
    const before = { ...settings() };

    await press('onboarding-skip-all');

    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(settings().onboardingCompleted).toBe(true);
    // The state a skipper is left in IS the pre-onboarding state: the location card on Today,
    // reminders at their defaults, the forgiving streak mode.
    expect(settings().location).toBeNull();
    expect(settings().streakMode).toBe(before.streakMode);
    expect(settings().streakMode).toBe('soft');
    expect(settings().theme).toBe('system');
    expect(settings().reminders).toEqual(before.reminders);
    expect(settings().qadaSetupCompleted).toBe(false);
  });

  it('offers a way out of every step that asks for something', async () => {
    await renderFlow({ notificationPermission: GRANTED });

    expect(screen.getByTestId('onboarding-skip-all')).toBeTruthy();
    await press('onboarding-start');
    expect(screen.getByTestId('onboarding-location-skip')).toBeTruthy();
    await press('onboarding-location-skip');

    // Theme, reminders and the streak have no cost to accept — their "Continue" IS the decline,
    // and a second button that did the same thing would be a decision, not a kindness.
    await advance(); // theme
    await advance(); // notifications
    await advance(); // tracking
    await advance(); // streak
    expect(screen.getByTestId('onboarding-qada-skip')).toBeTruthy();
  });

  it('reaches Today by pressing the quiet action on every step that has one', async () => {
    await renderFlow({ notificationPermission: GRANTED });

    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance();
    await advance();
    await advance();
    await advance();
    await press('onboarding-qada-skip');

    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(settings().onboardingCompleted).toBe(true);
  });
});

describe('the location step', () => {
  it('asks with the same card the Today tab uses, and only on a tap', async () => {
    await renderFlow();
    await press('onboarding-start');

    expect(screen.getByTestId('onboarding-location-prompt')).toBeTruthy();
    expect(mockRequestAndResolve).not.toHaveBeenCalled();

    await press('onboarding-location-prompt-action');
    expect(mockRequestAndResolve).toHaveBeenCalledTimes(1);
  });

  it('opens the shared city picker without leaving the flow', async () => {
    await renderFlow();
    await press('onboarding-start');

    await press('onboarding-location-prompt-choose-city');

    // Pushed, not replaced: the picker sits ON TOP of this step and dismisses back to it, so
    // declining GPS never ejects anyone from setup. It is also the same picker Today, Qibla and
    // Settings open — this step does not carry a search of its own.
    expect(mockPush).toHaveBeenCalledWith('/city');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('city-search')).toBeNull();
  });

  it('confirms a resolved location and grows the forward button', async () => {
    await renderFlow({ location: ISTANBUL, locationStatus: 'ready' });
    await press('onboarding-start');

    expect(screen.getByTestId('onboarding-location-resolved')).toBeTruthy();
    expect(screen.getByText('Istanbul, Türkiye')).toBeTruthy();
    // Answered, so the step no longer offers to be skipped — there is nothing left to decline.
    expect(screen.queryByTestId('onboarding-location-skip')).toBeNull();
    expect(screen.getByTestId('onboarding-location-continue')).toBeTruthy();
  });
});

describe('the theme step', () => {
  it('applies a choice on the spot', async () => {
    await renderFlow();
    await press('onboarding-start');
    await press('onboarding-location-skip');

    expect(settings().theme).toBe('system');
    await press('onboarding-theme-dark');
    expect(settings().theme).toBe('dark');
    await press('onboarding-theme-light');
    expect(settings().theme).toBe('light');
  });
});

describe('the reminder step', () => {
  /** Walks to the reminder step without touching anything on the way. */
  async function toReminders(options?: Options) {
    await renderFlow(options);
    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance();
  }

  it('silences every kind of reminder when "no reminders" is chosen', async () => {
    await toReminders();

    await press('onboarding-reminders-off');

    for (const prayer of PRAYERS) {
      const reminder = settings().reminders[prayer];
      // The nudge matters as much as the adhan reminder: a person who has just said "none" and
      // is then nudged at the end of a window was told one thing and sent another.
      expect(reminder.adhanEnabled).toBe(false);
      expect(reminder.nudgeEnabled).toBe(false);
      expect(reminder.preReminderEnabled).toBe(false);
    }
    // Nothing to permit, so nothing is asked, and the button says what it does.
    expect(mockRequestNotifications).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('onboarding-notifications-primary').props.accessibilityLabel
    ).toBe('Continue');
  });

  it('turns the adhan on for all five and asks the OS in the same tap', async () => {
    await toReminders();

    await press('onboarding-reminders-adhan');

    for (const prayer of PRAYERS) {
      expect(settings().reminders[prayer].adhanEnabled).toBe(true);
      expect(settings().reminders[prayer].sound).toBe('adhan');
    }
    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);
  });

  it('names the ask on the button rather than springing it on a "Continue"', async () => {
    await toReminders();

    // Nothing has been tapped: the pre-selected choice is the app's own default (a reminder with
    // the device sound), and the OS has not been asked yet.
    const primary = screen.getByTestId('onboarding-notifications-primary');
    expect(primary.props.accessibilityLabel).toBe('Allow notifications');

    await act(async () => {
      fireEvent.press(primary);
    });

    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);
    // It asks and stays: the answer is visible on this step rather than behind a transition.
    expect(screen.getByTestId('onboarding-notifications-primary')).toBeTruthy();
  });

  it('says "Continue" once the permission is granted', async () => {
    await toReminders({ notificationPermission: GRANTED });

    const primary = screen.getByTestId('onboarding-notifications-primary');
    expect(primary.props.accessibilityLabel).toBe('Continue');
  });

  it('will not walk on with a reminder the OS has refused — but "No reminders" always can', async () => {
    // Android 13's first refusal leaves `canAskAgain` true (expo maps it from
    // `shouldShowRequestPermissionRationale`), and a dialog swiped away rather than answered leaves
    // it true on both platforms.
    //
    // This used to read "Continue" and move on, and the step then walked someone out of onboarding
    // with a reminder sound selected on screen that could never make a sound. Saying so is worth
    // more than moving fast (owner, 2026-08-30, D137). The button offers the ask again instead.
    //
    // It is not a gate. The way out is the "No reminders" card two fingers above, and taking it
    // moves the flow on immediately — which is the second half of this test, and the half that
    // matters: the rule is that the step never dead-ends, not that the button always says Continue.
    await toReminders();
    await advance();
    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);

    // The OS answers: refused, but not permanently.
    await act(async () => {
      notificationFlow.setState({
        permission: { status: 'denied', granted: false, canAskAgain: true },
      });
    });

    const primary = screen.getByTestId('onboarding-notifications-primary');
    expect(primary.props.accessibilityLabel).toBe('Allow notifications');
    expect(screen.getByTestId('onboarding-reminders-refused')).toBeTruthy();

    // Pressing it re-opens the dialog rather than advancing.
    await act(async () => {
      fireEvent.press(primary);
    });
    expect(mockRequestNotifications).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('onboarding-tracking-continue')).toBeNull();

    // Saying "no reminders" is the other way, and it is one tap.
    await press('onboarding-reminders-off');
    const forward = screen.getByTestId('onboarding-notifications-primary');
    expect(forward.props.accessibilityLabel).toBe('Continue');
    await act(async () => {
      fireEvent.press(forward);
    });
    expect(screen.getByTestId('onboarding-tracking-continue')).toBeTruthy();
    expect(mockRequestNotifications).toHaveBeenCalledTimes(2);
  });

  it('lets a granted permission move on exactly as before', async () => {
    // The change above must not touch the happy path: nothing gates when the OS said yes.
    await toReminders();
    await advance();
    await act(async () => {
      notificationFlow.setState({
        permission: { status: 'granted', granted: true, canAskAgain: false },
      });
    });
    const primary = screen.getByTestId('onboarding-notifications-primary');
    expect(primary.props.accessibilityLabel).toBe('Continue');
    await act(async () => {
      fireEvent.press(primary);
    });
    expect(screen.getByTestId('onboarding-tracking-continue')).toBeTruthy();
  });

  it('still asks when the permission could not be read at all — null must never slip through', async () => {
    // A slow or failing `getPermissionsAsync` (some OEM builds) leaves the hook at `null`.
    // Treating that as "probably granted" once let the tap-through path finish onboarding with
    // reminders that could never fire; the ask is the one call that always learns the truth.
    await toReminders({ notificationPermission: null });

    const primary = screen.getByTestId('onboarding-notifications-primary');
    expect(primary.props.accessibilityLabel).toBe('Allow notifications');
    await act(async () => {
      fireEvent.press(primary);
    });
    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);

    // Picking a sound with the permission unreadable asks too, same as the undetermined path.
    await press('onboarding-reminders-adhan');
    expect(mockRequestNotifications).toHaveBeenCalledTimes(2);
  });

  it('still names the ask on the button for a second, untouched visit to the step', async () => {
    // The escape above must not become "the button stops naming the ask": someone who steps back
    // from the next step without ever having asked still meets "Allow notifications".
    await toReminders();
    await press('onboarding-reminders-off');
    await advance(); // tracking
    await press('onboarding-back');
    await press('onboarding-reminders-adhan');

    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);
  });

  it('offers the settings door when the OS has stopped asking, and still lets "No reminders" pass', async () => {
    await toReminders({
      notificationPermission: { status: 'denied', granted: false, canAskAgain: false },
    });

    expect(screen.getByTestId('onboarding-reminders-blocked')).toBeTruthy();
    // The OS will not show its dialog again, so the button must not offer the ask — and must not
    // offer "Continue" either while a reminder is selected that cannot arrive.
    const primary = screen.getByTestId('onboarding-notifications-primary');
    expect(primary.props.accessibilityLabel).toBe('Open device settings');
    await act(async () => {
      fireEvent.press(primary);
    });
    expect(mockOpenSystemSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('onboarding-tracking-continue')).toBeNull();

    await press('onboarding-reminders-off');
    const forward = screen.getByTestId('onboarding-notifications-primary');
    expect(forward.props.accessibilityLabel).toBe('Continue');
    await act(async () => {
      fireEvent.press(forward);
    });
    expect(screen.getByTestId('onboarding-tracking-continue')).toBeTruthy();
  });
});

describe('the streak step', () => {
  async function toStreak() {
    await renderFlow({ notificationPermission: GRANTED });
    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance(); // theme
    await advance(); // notifications
    await advance(); // tracking
  }

  it('lands on Committed for someone who taps through', async () => {
    await toStreak();

    await press('onboarding-streak-continue');

    expect(settings().streakMode).toBe('hard');
  });

  it('honours Relaxed when it is chosen', async () => {
    await toStreak();

    await press('onboarding-streak-soft');
    await press('onboarding-streak-continue');

    expect(settings().streakMode).toBe('soft');
  });

  it('leaves the forgiving default alone for anyone who never gets there', async () => {
    await renderFlow();

    await press('onboarding-skip-all');

    expect(settings().streakMode).toBe('soft');
  });
});

describe('the tracking step (D192)', () => {
  async function toTracking() {
    await renderFlow({ notificationPermission: GRANTED });
    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance(); // theme
    await advance(); // notifications
  }

  it('comes before the streak, shows both modes with their pictures, and offers simple first', async () => {
    await toTracking();

    expect(screen.getByTestId('onboarding-tracking-demo-simple')).toBeTruthy();
    expect(screen.getByTestId('onboarding-tracking-demo-detailed')).toBeTruthy();
    expect(screen.getByTestId('onboarding-tracking-simple').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );

    await press('onboarding-tracking-continue');

    expect(settings().trackingMode).toBe('simple');
    expect(settings().simpleModeSince).not.toBeNull();
    expect(screen.getByTestId('onboarding-streak-continue')).toBeTruthy();
  });

  it('honours Detailed when it is chosen', async () => {
    await toTracking();

    await press('onboarding-tracking-detailed');
    await press('onboarding-tracking-continue');

    expect(settings().trackingMode).toBe('detailed');
    expect(settings().simpleModeSince).toBeNull();
  });

  it('keeps the app as it was for anyone who never gets there', async () => {
    await renderFlow();

    await press('onboarding-skip-all');

    expect(settings().trackingMode).toBe('detailed');
  });
});

describe('the qada step', () => {
  async function toQada() {
    await renderFlow({ notificationPermission: GRANTED });
    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance(); // theme
    await advance(); // notifications
    await advance(); // tracking
    await advance(); // streak
  }

  it('hands over to the wizard that already exists — carrying the intent, not hoping for it', async () => {
    await toQada();

    await press('onboarding-qada-start');

    // "Count them with me" has to *arrive* at the counting. The qada screen deliberately no
    // longer opens its wizard by itself (someone who owes two prayers came for the list, not for
    // a setup flow), so an unqualified `/qada` drops this tap onto five zeroes and a small header
    // link — the one thing the user just said they did not want to have to find.
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/qada', params: { setup: '1' } });
    expect(settings().onboardingCompleted).toBe(true);
    // Still false: the flag records that the wizard was *completed*, and it has not been yet.
    expect(settings().qadaSetupCompleted).toBe(false);
  });

  it('puts Today underneath the counting, so setup never ends somewhere else (D85)', async () => {
    // Reported by a user: this branch used to `replace` straight to /qada, which is a root-stack
    // sibling of the tabs — full screen, no tab bar, nothing behind it. They took the counters
    // for the app's main screen and thought prayers were marked there. Setup ends on Today in
    // both branches now; counting a backlog is pushed on top of it, as the offer it is.
    await toQada();

    await press('onboarding-qada-start');

    expect(mockReplace).toHaveBeenCalledWith('/');
    // Order matters, not just presence: Today has to be the thing underneath.
    expect(mockReplace.mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0]
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('goes to Today on "not now", with nothing owed and nothing asked', async () => {
    await toQada();

    await press('onboarding-qada-skip');

    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(settings().qadaSetupCompleted).toBe(false);
  });
});

describe('the frame', () => {
  it('announces where the user is, and has no battery step on iOS', async () => {
    await renderFlow();

    // Seven steps on iOS: welcome, location, theme, reminders, tracking, streak, qada. The
    // Android-only battery step is the eighth and must not be counted here.
    expect(screen.getByTestId('onboarding-progress').props.accessibilityLabel).toBe(
      'Step 1 of 7'
    );
    expect(screen.getByTestId('onboarding-progress').props.accessibilityValue).toEqual({
      min: 1,
      max: 7,
      now: 1,
    });

    await press('onboarding-start');
    expect(screen.getByTestId('onboarding-progress').props.accessibilityLabel).toBe(
      'Step 2 of 7'
    );
  });

  it('has no way back from the first step, and one from every step after it', async () => {
    await renderFlow();

    expect(screen.queryByTestId('onboarding-back')).toBeNull();
    await press('onboarding-start');
    expect(screen.getByTestId('onboarding-back')).toBeTruthy();

    await press('onboarding-back');
    expect(screen.getByTestId('onboarding-skip-all')).toBeTruthy();
  });
});

/**
 * The Android-only reliability step.
 *
 * It exists because "the adhan did not fire" is the second most common complaint in the whole
 * category and is usually the OEM's battery manager rather than the app
 * (our market research). It is also the step most at risk of becoming noise: shown to an iOS
 * user it would be meaningless, and shown to someone who has just turned reminders off it would
 * be advice about protecting notifications that will never be sent.
 */
describe('the battery step (Android)', () => {
  let restore: (() => void) | null = null;

  beforeAll(() => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    restore = () => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
    };
  });

  afterAll(() => {
    restore?.();
  });

  async function toBattery(options?: Options) {
    await renderFlow({ notificationPermission: GRANTED, ...options });
    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance(); // theme
    await advance(); // reminders
  }

  it('appears after the reminders, and opens the right settings screen', async () => {
    await toBattery();

    expect(screen.getByTestId('onboarding-progress').props.accessibilityLabel).toBe('Step 5 of 8');
    await press('onboarding-battery-open');
    expect(mockOpenBatterySettings).toHaveBeenCalledTimes(1);

    // Informational only — it never blocks, and "Continue" carries on to the streak step.
    await advance();
    expect(screen.getByTestId('onboarding-tracking-continue')).toBeTruthy();
  });

  /**
   * The one offer of exact alarms (D91). It rides inside this step rather than adding a seventh:
   * the step already exists for "your phone may not deliver this reminder", it is already skipped
   * for anyone who chose no reminders, and a flow that may offer but never gate cannot afford a
   * screen whose only content is a permission.
   */
  it('offers exact alarms when the phone will not deliver on the minute', async () => {
    mockExactAlarms = 'inexact';
    await toBattery();

    expect(screen.getByText(/Your phone can also hold a reminder back/)).toBeTruthy();
    await press('onboarding-exact-alarms-open');
    expect(mockOpenExactAlarms).toHaveBeenCalledTimes(1);

    // It offers and never gates: Continue carries on whether or not anything was allowed.
    await advance();
    expect(screen.getByTestId('onboarding-tracking-continue')).toBeTruthy();
  });

  it('says nothing about them when the phone already delivers on the minute', async () => {
    mockExactAlarms = 'exact';
    await toBattery();

    expect(screen.queryByTestId('onboarding-exact-alarms-open')).toBeNull();
    expect(screen.queryByText(/Your phone can also hold a reminder back/)).toBeNull();
  });

  // Allowing exact alarms cannot reach an alarm that is already set, and the reminders chosen two
  // steps ago are already set. Without this the fix does nothing until something else moves the
  // schedule — which for a brand new install is days away.
  it('rebuilds the reminders when the user comes back having allowed them', async () => {
    const foregrounds: ((status: string) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_type: string, handler: (status: string) => void) => {
        foregrounds.push(handler);
        return { remove: () => undefined };
      }) as never);

    mockExactAlarms = 'inexact';
    await toBattery();
    expect(mockRebuild).not.toHaveBeenCalled();

    mockExactAlarms = 'exact';
    await act(async () => {
      for (const handler of foregrounds) handler('active');
      for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
    });

    expect(mockRebuild).toHaveBeenCalledTimes(1);
    // And the offer stops being made, because there is nothing left to offer.
    expect(screen.queryByTestId('onboarding-exact-alarms-open')).toBeNull();
  });

  it('is not shown at all when there are no reminders to protect', async () => {
    await renderFlow({ notificationPermission: GRANTED });
    await press('onboarding-start');
    await press('onboarding-location-skip');
    await advance(); // theme

    await press('onboarding-reminders-off');
    // The flow shortens as it is answered: seven steps again, and Continue lands on tracking.
    expect(screen.getByTestId('onboarding-progress').props.accessibilityValue).toEqual({
      min: 1,
      max: 7,
      now: 4,
    });
    await advance();
    expect(screen.getByTestId('onboarding-tracking-continue')).toBeTruthy();
  });
});
