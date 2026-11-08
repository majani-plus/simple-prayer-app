/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 */

/**
 * Screen test for Settings → Reminder reliability (`src/app/settings/reminder-health.tsx`).
 *
 * The screen makes one promise (PRODUCT_SPEC §11, D19): it answers *will my next adhan actually
 * fire?* honestly, from the operating system rather than from our own bookkeeping. The category's
 * second-loudest complaint is that reminders silently stop, and every competitor's answer is
 * "open the app every few days" (our market research) — so the assertions here are all about
 * the screen telling the truth, including when the truth is bad:
 *
 * 1. Each permission state produces its own verdict and its own single correct fix — the prompt
 *    while the OS will still show one, the system settings page once it will not.
 * 2. An OS holding nothing while reminders are switched on is reported as a problem, with a
 *    working "reschedule now", not papered over.
 * 3. The scheduled list is the OS's answer, with real times — and it comes **last**, after
 *    everything the user can act on (owner, 2026-08-20: "move 'what your phone is holding' to the
 *    very end"). It is evidence, not a fix.
 * 4. The test notification actually reaches the service, and its result is visible.
 * 5. Android-only material (battery guidance) never renders on iOS, and the iOS notes never
 *    render on Android.
 * 6. Nothing here quotes iOS's 30-second sound cap at the user; that constraint is ours to
 *    respect, not theirs to read about.
 *
 * The notification service is the **real** one over `createFakeNotificationAdapter` — an
 * in-memory OS — rather than a mock of the screen's calls. That is deliberate: "reschedule now"
 * is only meaningful if it really plans, really schedules, and really shows up in the list the
 * screen reads back.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppState, Linking, Platform } from 'react-native';

import ReminderHealthScreen from '../app/settings/reminder-health';
import { initI18n } from '../i18n';
import {
  setBatteryGuidanceAdapter,
  setExemptionProbe,
  type BatteryGuidanceAdapter,
  type ExemptionState,
} from '../services/batteryGuidance';
import { setExactAlarmAdapter, type ExactAlarmAdapter } from '../services/exactAlarms';
import {
  setNotificationOrganizerAdapter,
  type NotificationOrganizerAdapter,
} from '../services/notificationOrganizer';
import {
  TEST_NOTIFICATION_ID,
  createFakeNotificationAdapter,
  createNotificationService,
  setNotificationService,
  type FakeNotificationAdapter,
  type NotificationPermission,
} from '../services/notifications';
import { DEFAULT_SETTINGS, useSettingsStore } from '../stores/settingsStore';

import type { AppSettings } from '../domain/types';

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
      clearAll: () => values.clear(),
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
  navigate: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, router: mockRouter }));

/**
 * The screen reads one thing from the background-refresh service — the status — and the module
 * itself defines an OS task at import time and pulls in the whole sync graph behind it. Mocking it
 * here keeps both out of a renderer and lets a test set the answer;
 * `services/backgroundRefresh.test.ts` covers the module's own behaviour. The `jest.fn` is built
 * inside the factory because `jest.mock` is hoisted above every `const` in this file.
 */
jest.mock('@/services/backgroundRefresh', () => ({
  readBackgroundRefreshStatus: jest.fn(() => Promise.resolve('available')),
}));

/**
 * The tracking store, minus SQLite. It is read two ways here — as a hook with a selector (the
 * screen's `todayDay`) and through `getState()` (the reschedule path) — so the mock has to be
 * both.
 */
jest.mock('@/stores/trackingStore', () => {
  const streaks = jest.requireActual<typeof import('@/domain/streaks')>('@/domain/streaks');
  const state = {
    dayRecords: {},
    exemptPeriods: [],
    // The real calendar date, not a pinned one: "reschedule now" runs against the real clock, so a
    // fixture day would drift into the past and the plan would honestly come out empty — which is
    // exactly how this file's reschedule assertions once rotted overnight. The civil date is a
    // fine stand-in for the Fajr-boundary day here; the plan spans days, so off-by-one at the
    // edges still schedules plenty.
    todayDay: () => new Date().toISOString().slice(0, 10),
    isExemptDay: () => false,
    dayRecordFor: (day: string) => streaks.unloggedDayRecord(day),
  };
  const useTrackingStore = <T,>(selector: (value: typeof state) => T): T => selector(state);
  useTrackingStore.getState = () => state;
  useTrackingStore.subscribe = () => () => undefined;
  return { useTrackingStore };
});

const backgroundRefreshService = jest.requireMock('@/services/backgroundRefresh') as {
  readBackgroundRefreshStatus: jest.Mock;
};

configure({ defaultIncludeHiddenElements: true });

/** Accra — on the prime meridian and near the equator, so every prayer genuinely exists. */
const LOCATION: AppSettings['location'] = {
  latitude: 5.6037,
  longitude: -0.187,
  label: 'Accra',
  countryCode: 'GH',
  source: 'auto',
  resolvedAt: 0,
};

const GRANTED: NotificationPermission = { status: 'granted', granted: true, canAskAgain: true };

let adapter: FakeNotificationAdapter;
let opened: { action: string; params?: unknown }[];

/**
 * What the phone currently answers about exact alarms. Held in a variable rather than baked into
 * the adapter so a test can change the answer mid-run — which is the whole point of the permission:
 * the user leaves for a system screen and comes back with a different one.
 */
let exactAlarms: boolean | null;
/** How many times the system's alarms-and-reminders screen was asked for. */
let exactAlarmScreenOpened: number;

function exactAlarmAdapter(platform: ExactAlarmAdapter['platform']): ExactAlarmAdapter {
  return {
    platform,
    async canScheduleExactAlarms() {
      return exactAlarms;
    },
    async openSystemScreen() {
      exactAlarmScreenOpened += 1;
      return true;
    },
    async openAppSettings() {
      opened.push({ action: 'app-settings' });
    },
  };
}

function batteryAdapter(
  platform: BatteryGuidanceAdapter['platform'],
  manufacturer = 'Xiaomi',
  brand = 'Redmi'
): BatteryGuidanceAdapter {
  return {
    platform,
    manufacturer: () => manufacturer,
    brand: () => brand,
    async startActivity(action, params) {
      opened.push({ action, params });
    },
    async openAppSettings() {
      opened.push({ action: 'app-settings' });
    },
  };
}

function organizerAdapter(
  platform: NotificationOrganizerAdapter['platform'],
  sdk: number
): NotificationOrganizerAdapter {
  return {
    platform,
    sdkVersion: () => sdk,
    async startActivity(action) {
      opened.push({ action });
    },
    async openAppSettings() {
      opened.push({ action: 'app-settings' });
    },
  };
}

/** Mounts the screen with the world in a given shape, and lets its two OS reads settle. */
async function renderScreen({
  platform = 'android' as 'ios' | 'android',
  permission = GRANTED,
  remindersOn = true,
  prescheduled = false,
  /** Android SDK level. Below 36 there is no notification organizer to warn about (D146). */
  sdk = 35,
  /** What `PowerManager.isIgnoringBatteryOptimizations` answers, through the probe seam. */
  exemption = 'unknown' as ExemptionState,
  manufacturer = 'Xiaomi',
  brand = 'Redmi',
  /** What `BackgroundTask.getStatusAsync` resolves to, through the service seam. */
  backgroundRefresh = 'available' as 'available' | 'restricted' | 'unknown',
}: {
  platform?: 'ios' | 'android';
  permission?: NotificationPermission;
  sdk?: number;
  remindersOn?: boolean;
  /** Whether the fake OS is already holding this app's reminders. */
  prescheduled?: boolean;
  exemption?: ExemptionState;
  manufacturer?: string;
  brand?: string;
  backgroundRefresh?: 'available' | 'restricted' | 'unknown';
} = {}) {
  jest.replaceProperty(Platform, 'OS', platform);
  backgroundRefreshService.readBackgroundRefreshStatus.mockResolvedValue(backgroundRefresh);
  setBatteryGuidanceAdapter(batteryAdapter(platform, manufacturer, brand));
  setExemptionProbe(async () => exemption);
  setExactAlarmAdapter(exactAlarmAdapter(platform));
  setNotificationOrganizerAdapter(organizerAdapter(platform, sdk));

  adapter = createFakeNotificationAdapter({ platform, permission });
  const service = createNotificationService(adapter, {
    translate: (key) => key,
    formatClock: () => '05:00',
  });
  setNotificationService(service);

  useSettingsStore.setState({ ...DEFAULT_SETTINGS, location: LOCATION });
  if (!remindersOn) {
    useSettingsStore.getState().setAllReminders({
      adhanEnabled: false,
      preReminderEnabled: false,
      nudgeEnabled: false,
    });
  }

  if (prescheduled) {
    await service.sync({
      now: new Date('2026-08-19T00:30:00.000Z'),
      days: [],
      reminders: useSettingsStore.getState().reminders,
      statuses: {},
      exemptDays: new Set(),
      locale: 'en',
    });
    // A day-less sync cancels rather than schedules; do the real thing through the screen's own
    // path instead, so the list holds exactly what the app would really have put there.
    const { syncNotificationsFromStores } = jest.requireActual<
      typeof import('@/hooks/useNotificationSync')
    >('@/hooks/useNotificationSync');
    await syncNotificationsFromStores({ now: () => new Date('2026-08-19T00:30:00.000Z') });
  }

  await render(<ReminderHealthScreen />);
  // The screen reads the permission, the schedule, the exact-alarm answer, the battery exemption
  // and the background-refresh status in one `Promise.all` on mount; each is several microtask
  // hops deep.
  await act(async () => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  });
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** Every `testID` on screen, in the order it is rendered — so section order can be asserted. */
function testIdOrder(): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const element = node as { props?: Record<string, unknown>; children?: unknown };
    const id = element.props?.testID;
    if (typeof id === 'string') found.push(id);
    walk(element.children);
  };
  walk(screen.toJSON());
  return found;
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  opened = [];
  exactAlarms = true;
  exactAlarmScreenOpened = 0;
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.canGoBack.mockClear();
  mockRouter.canGoBack.mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  setNotificationService(null);
  setBatteryGuidanceAdapter(null);
  setExemptionProbe(null);
  setExactAlarmAdapter(null);
});

// ---------------------------------------------------------------------------

describe('the permission verdict', () => {
  it('says so, and offers the prompt, when permission has never been asked for', async () => {
    await renderScreen({
      permission: { status: 'undetermined', granted: false, canAskAgain: true },
    });

    expect(screen.getByTestId('reminder-health-verdict-permissionMissing')).toBeTruthy();
    expect(screen.getByText('Your phone has not been asked yet')).toBeTruthy();
    expect(screen.getByTestId('reminder-health-allow')).toBeTruthy();
    // The prompt is the fix here, not a trip to the system settings.
    expect(screen.queryByTestId('reminder-health-open-settings')).toBeNull();
  });

  it('asks the OS only when the button is pressed, never on arrival', async () => {
    await renderScreen({
      permission: { status: 'undetermined', granted: false, canAskAgain: true },
    });
    expect(adapter.calls.requestPermission).toBe(0);

    await press('reminder-health-allow');

    expect(adapter.calls.requestPermission).toBe(1);
  });

  it('sends the user to the system settings once the OS will not ask again', async () => {
    await renderScreen({
      permission: { status: 'denied', granted: false, canAskAgain: false },
    });

    expect(screen.getByTestId('reminder-health-verdict-permissionDenied')).toBeTruthy();
    expect(screen.getByText('Notifications are switched off for this app')).toBeTruthy();
    expect(screen.getByTestId('reminder-health-open-settings')).toBeTruthy();
    // Offering a prompt the OS will silently ignore is the dishonest version of this screen.
    expect(screen.queryByTestId('reminder-health-allow')).toBeNull();
  });

  it('separates "no reminders chosen" from "reminders broken"', async () => {
    await renderScreen({ remindersOn: false });

    expect(screen.getByTestId('reminder-health-verdict-noReminders')).toBeTruthy();
    expect(screen.queryByTestId('reminder-health-verdict-empty')).toBeNull();

    await press('reminder-health-choose-reminders');
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/reminders');
  });

  it('confirms the schedule when the OS really is holding it', async () => {
    await renderScreen({ prescheduled: true });

    expect(screen.getByTestId('reminder-health-verdict-ok')).toBeTruthy();
    expect(screen.getByText('Your next reminder is scheduled')).toBeTruthy();
  });

  it('states the severity in words, not only in colour', async () => {
    await renderScreen({
      permission: { status: 'denied', granted: false, canAskAgain: false },
    });

    // The card's tint is one of three signals; the word and the glyph are the other two.
    expect(screen.getByText('Not working')).toBeTruthy();
  });
});

describe('what the OS is holding', () => {
  it('warns, and offers to reschedule, when the list is empty but reminders are on', async () => {
    await renderScreen();

    expect(screen.getByTestId('reminder-health-verdict-empty')).toBeTruthy();
    expect(screen.getByText('Your phone is holding no reminders')).toBeTruthy();
    expect(screen.getByTestId('reminder-health-schedule-empty')).toBeTruthy();
    expect(screen.getByTestId('reminder-health-reschedule-now')).toBeTruthy();
  });

  it('actually reschedules, and then shows what arrived', async () => {
    await renderScreen();
    expect(adapter.scheduled.size).toBe(0);

    await press('reminder-health-reschedule-now');
    await act(async () => {
      for (let turn = 0; turn < 200; turn += 1) await Promise.resolve();
    });

    // The fake OS is now genuinely holding reminders, and the screen re-read them.
    expect(adapter.scheduled.size).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId('reminder-health-schedule-count')).toBeTruthy());
    expect(screen.getByTestId('reminder-health-schedule-list')).toBeTruthy();
  });

  it('lists the reminders with their times, read back from the OS', async () => {
    await renderScreen({ prescheduled: true });

    expect(screen.getByTestId('reminder-health-schedule-list')).toBeTruthy();
    // Rows are keyed by the OS payload's own key, so this is the platform's answer, not ours.
    // The day is the mocked store's (real-clock) today — see the trackingStore mock for why it
    // cannot be a pinned date.
    const today = new Date().toISOString().slice(0, 10);
    expect(screen.getByTestId(`reminder-health-scheduled-adhan:${today}:dhuhr`)).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
  });

  // Nobody arrives on this screen wanting to read a timetable; they arrive because something did
  // not arrive. So the verdict, the test and the platform guidance — the things that can actually
  // change the outcome — all come before the list of what is scheduled.
  it('comes last, after everything the user can act on', async () => {
    await renderScreen({ platform: 'ios', prescheduled: true });
    const order = testIdOrder();

    expect(order.indexOf('reminder-health-verdict-ok')).toBeLessThan(
      order.indexOf('reminder-health-test')
    );
    expect(order.indexOf('reminder-health-test')).toBeLessThan(
      order.indexOf('reminder-health-ios')
    );
    expect(order.indexOf('reminder-health-ios')).toBeLessThan(
      order.indexOf('reminder-health-schedule-list')
    );
  });

  it('re-reads the OS on demand without rescheduling anything', async () => {
    await renderScreen({ prescheduled: true });
    const reads = adapter.calls.getScheduled;
    const writes = adapter.calls.schedule;

    await press('reminder-health-refresh');
    await act(async () => {
      for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
    });

    expect(adapter.calls.getScheduled).toBeGreaterThan(reads);
    // "Read again" must not quietly become "rewrite everything": the point of this screen is to
    // show the user what is there, not to change it under them.
    expect(adapter.calls.schedule).toBe(writes);
    expect(adapter.calls.cancel).toBe(0);
  });
});

describe('the test notification', () => {
  it('reaches the service and reports that it arrived', async () => {
    await renderScreen();

    await press('reminder-health-test-send');
    await act(async () => {
      for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
    });

    expect(adapter.presented.has(TEST_NOTIFICATION_ID)).toBe(true);
    expect(screen.getByText('The test was sent')).toBeTruthy();
  });

  it('says so plainly when the phone refuses it', async () => {
    await renderScreen();
    adapter.config.failing = new Set(['present']);

    await press('reminder-health-test-send');
    await act(async () => {
      for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
    });

    expect(screen.getByText('The test could not be sent')).toBeTruthy();
  });
});

/**
 * Exact alarms (D91) — the setting that decides whether a reminder arrives *on the minute*.
 *
 * `expo-notifications` downgrades to an inexact alarm without a word when the OS refuses, and on
 * Android 14+ it refuses by default. This screen exists to answer "will my next adhan fire?", so
 * the one setting that most decides whether it fires *on time* has to be readable here — including
 * when the answer is "yes", because a screen that only speaks when something is wrong cannot be
 * checked.
 */
describe('exact alarms', () => {
  it('says plainly that reminders may be late, and offers the one screen that fixes it', async () => {
    exactAlarms = false;
    await renderScreen({ platform: 'android' });

    expect(screen.getByTestId('reminder-health-exact-alarms')).toBeTruthy();
    expect(screen.getByText('Reminders may arrive late')).toBeTruthy();
    // Never alarming: the reminders still arrive, and the copy has to say so.
    expect(screen.getByText(/They still arrive, but the phone decides when/)).toBeTruthy();
    // …and it has to say how late, honestly. Doze batches an inexact alarm to roughly one firing
    // every nine minutes, and the window widens the longer the phone has been idle — so "a few
    // minutes" was an understatement exactly where it mattered most, which is Fajr.
    expect(screen.getByText(/At night, when the phone is not being used, it can be much longer/))
      .toBeTruthy();

    await press('reminder-health-exact-alarms-open');
    expect(exactAlarmScreenOpened).toBe(1);
  });

  it('confirms it when the permission is already granted, rather than disappearing', async () => {
    exactAlarms = true;
    await renderScreen({ platform: 'android' });

    expect(screen.getByTestId('reminder-health-exact-alarms')).toBeTruthy();
    expect(screen.getByText('Reminders arrive at the right minute')).toBeTruthy();
    // Nothing to do, so nothing to press.
    expect(screen.queryByTestId('reminder-health-exact-alarms-open')).toBeNull();
  });

  // A dev client built before the native module existed. An invented verdict on this screen is
  // worse than no card — the same reason the battery card refuses to claim an exemption state.
  it('says nothing at all when the phone cannot be asked', async () => {
    exactAlarms = null;
    await renderScreen({ platform: 'android' });

    expect(screen.queryByTestId('reminder-health-exact-alarms')).toBeNull();
  });

  it('never appears on iOS, where the system holds the notification itself', async () => {
    await renderScreen({ platform: 'ios' });

    expect(screen.queryByTestId('reminder-health-exact-alarms')).toBeNull();
  });

  it('comes before the battery card, because it is the one we can actually read', async () => {
    exactAlarms = false;
    await renderScreen({ platform: 'android' });
    const order = testIdOrder();

    expect(order.indexOf('reminder-health-exact-alarms')).toBeGreaterThan(
      order.indexOf('reminder-health-test')
    );
    expect(order.indexOf('reminder-health-exact-alarms')).toBeLessThan(
      order.indexOf('reminder-health-battery')
    );
  });

  /**
   * Granting the permission does not upgrade alarms that are already set — Android only re-arms
   * them exactly on reboot or on an app update. Without this, someone who fixes the setting today
   * still gets an inexact Isha tonight and an inexact Fajr tomorrow, which is precisely the
   * reminder they went to the settings screen to protect.
   */
  it('rebuilds the schedule when the user comes back having allowed them', async () => {
    const foregrounds: ((status: string) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_type: string, handler: (status: string) => void) => {
        foregrounds.push(handler);
        return { remove: () => undefined };
      }) as never);

    exactAlarms = false;
    await renderScreen({ platform: 'android', prescheduled: true });
    const writes = adapter.calls.schedule;
    expect(adapter.scheduled.size).toBeGreaterThan(0);

    // The user grants it on the system screen and returns.
    exactAlarms = true;
    await act(async () => {
      for (const handler of foregrounds) handler('active');
      for (let turn = 0; turn < 200; turn += 1) await Promise.resolve();
    });

    expect(adapter.calls.cancel).toBeGreaterThan(0);
    expect(adapter.calls.schedule).toBeGreaterThan(writes);
    expect(adapter.scheduled.size).toBeGreaterThan(0);
  });

  it('rebuilds nothing when the answer has not changed', async () => {
    const foregrounds: ((status: string) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_type: string, handler: (status: string) => void) => {
        foregrounds.push(handler);
        return { remove: () => undefined };
      }) as never);

    exactAlarms = false;
    await renderScreen({ platform: 'android', prescheduled: true });
    const writes = adapter.calls.schedule;

    // Came back without changing anything — the common case, and it must cost nothing.
    await act(async () => {
      for (const handler of foregrounds) handler('active');
      for (let turn = 0; turn < 200; turn += 1) await Promise.resolve();
    });

    expect(adapter.calls.cancel).toBe(0);
    expect(adapter.calls.schedule).toBe(writes);
  });
});

describe('the Android-only material', () => {
  it('explains the OEM battery problem and links to both screens', async () => {
    await renderScreen({ platform: 'android' });

    expect(screen.getByTestId('reminder-health-battery')).toBeTruthy();
    // The manufacturer is named, because "some phones misbehave" is advice nobody acts on.
    expect(screen.getByText(/Xiaomi phones pause background apps/)).toBeTruthy();

    await press('reminder-health-battery-open');
    expect(opened[0]?.action).toBe('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');

    await press('reminder-health-autostart-open');
    expect(opened[1]?.params).toMatchObject({ packageName: 'com.miui.securitycenter' });
  });

  // The Xiaomi in the owner's report. MIUI/HyperOS keeps a per-app "Battery saver" policy that the
  // stock exemption does not touch, and the stock button does not open it — so the copy has to
  // name the screen. Only Xiaomi gets a named path: sending a Samsung owner to a menu that does
  // not exist on their phone would be worse than the general advice.
  it('names the MIUI path on a Xiaomi, and locking the app in recents', async () => {
    await renderScreen({ platform: 'android' });

    expect(screen.getByText(/Settings, then Apps, then Simple Prayer, then Battery saver/)).toBeTruthy();
    expect(screen.getByText(/No restrictions/)).toBeTruthy();
    expect(screen.getByText(/lock Simple Prayer there/)).toBeTruthy();
  });

  it('keeps the general wording for a manufacturer whose screen we do not know', async () => {
    await renderScreen({ platform: 'android', manufacturer: 'samsung', brand: 'samsung' });

    expect(screen.getByText(/Samsung phones pause background apps more aggressively/)).toBeTruthy();
    expect(screen.queryByText(/then Battery saver/)).toBeNull();
  });

  it('admits it cannot read the exemption state when the binary cannot be asked', async () => {
    await renderScreen({ platform: 'android', exemption: 'unknown' });

    expect(screen.getByText(/cannot read this setting from the inside/)).toBeTruthy();
  });

  it('says plainly that battery limits are still on, when they are', async () => {
    await renderScreen({ platform: 'android', exemption: 'restricted' });

    expect(screen.getByText(/battery limits are still on for this app/)).toBeTruthy();
    expect(screen.queryByText(/cannot read this setting from the inside/)).toBeNull();
  });

  /**
   * The exemption reads Android's own list and nothing else. MIUI's per-app battery policy has no
   * public API, so on an aggressive manufacturer an exemption is necessary and not sufficient —
   * and this card must not turn it into a tick. A wrong reassurance here sends someone away from
   * the one screen that would have fixed their Fajr.
   */
  it('reports the exemption without calling it a clean bill of health on a Xiaomi', async () => {
    await renderScreen({ platform: 'android', exemption: 'exempt' });

    expect(screen.getByText(/already switched off for this app/)).toBeTruthy();
    expect(screen.getByText(/Your phone maker can have a separate setting/)).toBeTruthy();
    // Not "All set": the manufacturer's own policy is unread and unreadable. Scoped to the card,
    // because the exact-alarm card above it legitimately does say "All set".
    const card = within(screen.getByTestId('reminder-health-battery'));
    expect(card.queryByText('All set')).toBeNull();
    expect(card.getByText('Worth knowing')).toBeTruthy();
  });

  it('does call it settled on a phone with no battery manager of its own', async () => {
    await renderScreen({
      platform: 'android',
      exemption: 'exempt',
      manufacturer: 'Google',
      brand: 'google',
    });

    expect(within(screen.getByTestId('reminder-health-battery')).getByText('All set')).toBeTruthy();
  });

  it('renders none of it on iOS', async () => {
    await renderScreen({ platform: 'ios' });

    expect(screen.queryByTestId('reminder-health-battery')).toBeNull();
    expect(screen.queryByTestId('reminder-health-autostart-open')).toBeNull();
  });
});

// D146. Android 16's classifier can take a reminder into a bundle and silence it. There is no way
// to opt out from inside the app, so the screen's whole job here is to name the cause and open the
// one screen that can undo it.
describe('the notification organizer card', () => {
  it('appears on Android 16 and opens the system notification settings', async () => {
    await renderScreen({ platform: 'android', sdk: 36 });

    expect(screen.getByTestId('reminder-health-organizer')).toBeTruthy();
    expect(screen.getByText(/arrives without a sound/)).toBeTruthy();

    await press('reminder-health-organizer-open');
    expect(opened.at(-1)?.action).toBe('android.settings.NOTIFICATION_SETTINGS');
  });

  it('admits it cannot see whether the phone is doing it', async () => {
    await renderScreen({ platform: 'android', sdk: 36 });

    expect(screen.getByText(/cannot see this from the inside/)).toBeTruthy();
  });

  it('stays hidden on older Android, where the feature does not exist', async () => {
    await renderScreen({ platform: 'android', sdk: 35 });

    expect(screen.queryByTestId('reminder-health-organizer')).toBeNull();
  });

  it('stays hidden on iOS whatever the version reads', async () => {
    await renderScreen({ platform: 'ios', sdk: 36 });

    expect(screen.queryByTestId('reminder-health-organizer')).toBeNull();
  });
});

describe('the background refresh card', () => {
  /**
   * The reminder plan is five days long, and the app extends it whenever the OS wakes it. So the
   * honest iOS card is not a verdict but a place to look: iOS gates whether a scheduled background
   * task ever *runs* behind Background App Refresh, and no API lets us read that switch. Same shape
   * as the battery and organizer cards — state the fact, admit the blind spot, open the screen.
   */
  it('tells an iPhone user where the switch is, and does not claim to have read it', async () => {
    await renderScreen({ platform: 'ios', backgroundRefresh: 'available' });

    expect(screen.getByTestId('reminder-health-background-refresh')).toBeTruthy();
    expect(screen.getByText(/gives it a moment in the background/)).toBeTruthy();
    expect(screen.getByText(/cannot read this setting from the inside/)).toBeTruthy();
    expect(screen.getByText(/Background App Refresh/)).toBeTruthy();
  });

  // A tick here would be the wrong reassurance: the OS said it will schedule the task, not that it
  // will ever run one. The level word carries that, not just the tint.
  it('stays at "worth knowing" rather than claiming everything is set', async () => {
    await renderScreen({ platform: 'ios', backgroundRefresh: 'available' });

    const card = within(screen.getByTestId('reminder-health-background-refresh'));
    expect(card.getByText('Worth knowing')).toBeTruthy();
    expect(card.queryByText('All set')).toBeNull();
  });

  it('opens the system settings from the card', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

    await renderScreen({ platform: 'ios', backgroundRefresh: 'available' });
    await press('reminder-health-background-refresh-open');

    expect(openSettings).toHaveBeenCalled();
  });

  // The one state that IS a verdict: the OS told us it will not run our background work. It must
  // still say what survives — reminders already set arrive — rather than reading as a failure.
  it('reports a phone that will not run background work, without alarming anyone', async () => {
    await renderScreen({ platform: 'ios', backgroundRefresh: 'restricted' });

    const card = within(screen.getByTestId('reminder-health-background-refresh'));
    expect(card.getByText('Needs a moment')).toBeTruthy();
    expect(card.getByText(/already set will still arrive/)).toBeTruthy();
  });

  // WorkManager is always available and everything that actually stops it on Android is the
  // battery card above, so a second card would be noise on a screen that is already long.
  it('stays hidden on Android while background work is available', async () => {
    await renderScreen({ platform: 'android', backgroundRefresh: 'available' });

    expect(screen.queryByTestId('reminder-health-background-refresh')).toBeNull();
    expect(screen.getByTestId('reminder-health-battery')).toBeTruthy();
  });

  // Same policy as the exact-alarm card: a build with no native module gets no invented verdict.
  it('renders nothing when the status cannot be read', async () => {
    await renderScreen({ platform: 'ios', backgroundRefresh: 'unknown' });

    expect(screen.queryByTestId('reminder-health-background-refresh')).toBeNull();
  });

  // Above the Focus card and below the test notification: it is about reminders being *made*,
  // which comes before why one that was made arrived quietly.
  it('sits between the test notification and the Focus card', async () => {
    await renderScreen({ platform: 'ios', backgroundRefresh: 'available' });

    const order = testIdOrder();

    expect(order.indexOf('reminder-health-background-refresh')).toBeGreaterThan(
      order.indexOf('reminder-health-test')
    );
    expect(order.indexOf('reminder-health-background-refresh')).toBeLessThan(
      order.indexOf('reminder-health-ios')
    );
  });
});

describe('the iOS-only material', () => {
  it('names Focus and Do Not Disturb', async () => {
    await renderScreen({ platform: 'ios' });

    expect(screen.getByTestId('reminder-health-ios')).toBeTruthy();
    expect(screen.getByText(/Focus and Do Not Disturb/)).toBeTruthy();
  });

  // The clip being 27 seconds is a consequence of a platform limit we already handled. Telling
  // someone who came here because a reminder did not arrive about a *sound length* answers a
  // question they did not ask and reads as an excuse (owner, 2026-08-20).
  it('never quotes the 30-second sound cap at the user', async () => {
    await renderScreen({ platform: 'ios' });

    expect(screen.queryByText(/30 seconds/)).toBeNull();
    expect(screen.queryByText(/27.75/)).toBeNull();
  });

  it('does not render on Android', async () => {
    await renderScreen({ platform: 'android' });

    expect(screen.queryByTestId('reminder-health-ios')).toBeNull();
  });
});

describe('the screen itself', () => {
  it('goes back', async () => {
    await renderScreen();

    await press('reminder-health-back');

    expect(mockRouter.back).toHaveBeenCalled();
  });

  // This screen is reachable only through the Settings tab, and it is a plausible cold-start
  // target (it is where a "reminders are broken" support answer sends people). With no history
  // to pop, back must land on Settings rather than stranding the user on Today.
  it('falls back to Settings, not Today, when there is no history to pop', async () => {
    mockRouter.canGoBack.mockReturnValueOnce(false);

    await renderScreen();
    await press('reminder-health-back');

    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings');
  });

  it('states the promise the whole feature rests on', async () => {
    await renderScreen();

    // The direct answer to "open the app every few days" (our market research).
    expect(screen.getByText(/You never have to open it just to keep the adhan working/)).toBeTruthy();
  });
});
