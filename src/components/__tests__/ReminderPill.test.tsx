/**
 * The hero's reminder pill.
 *
 * Since spec-accessibility §4.1 the pill renders against TWO sources of truth — the stored
 * setting and the OS notification permission — because the app's worst first-run bug was the gap
 * between them: every prayer ships `adhanEnabled: true`, so the pill said "Reminder on" while the
 * permission had never been asked for and nothing could ever fire. These tests pin the contract:
 *
 * - The pill can NEVER claim a reminder is on while the permission would prevent it from firing.
 * - Tapping while the OS can still ask → asks right there. Once it cannot → system settings.
 * - Toggling stays synchronous store writes; the permission dialog is never awaited.
 *
 * The notification layer is the real service over `createFakeNotificationAdapter` (permission
 * granted unless a test says otherwise), installed via `setNotificationService` — the same seam
 * every other notification test uses. The tracking store is mocked because a permission grant
 * triggers the real post-grant sync, which reads it through SQLite.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AppState,
  Linking,
  StyleSheet,
  type AppStateStatus,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { ReminderPill } from '../ReminderPill';
import { initI18n } from '@/i18n';
import { FSI, PDI, stripBidi } from '@/i18n/bidi';
import {
  createFakeNotificationAdapter,
  createNotificationService,
  setNotificationService,
  type FakeNotificationAdapter,
} from '@/services/notifications';
import { useSettingsStore } from '@/stores/settingsStore';
import { ThemePreferenceContext, nightPaper, paperLight } from '@/theme';

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

/** A minimal tracking store: the post-grant sync reads it, and the real one opens SQLite. */
jest.mock('@/stores/trackingStore', () => {
  const streaks = jest.requireActual<typeof import('@/domain/streaks')>('@/domain/streaks');
  const getState = () => ({
    dayRecords: {},
    exemptPeriods: [] as { startDay: string; endDay: string | null }[],
    todayDay: () => '2026-08-19',
    isExemptDay: () => false,
    dayRecordFor: (day: string) => streaks.unloggedDayRecord(day),
  });
  return {
    useTrackingStore: { getState, subscribe: () => () => undefined },
    getTrackingActions: () => ({}),
  };
});

/** Material Symbols codepoints for the three bell glyphs (see components/Icon.tsx). */
const NOTIFICATIONS = String.fromCodePoint(0xe7f5);
const NOTIFICATIONS_OFF = String.fromCodePoint(0xe7f6);
const NOTIFICATIONS_ACTIVE = String.fromCodePoint(0xe7f7);

const NEEDS_PERMISSION = 'Reminders off — allow notifications';

function pillStyle(): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId('pill').props.style) as ViewStyle;
}

function labelStyle(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

let adapter: FakeNotificationAdapter;

/** Lets the mount-time permission read (and anything else pending) resolve inside act. */
async function settle() {
  await act(async () => {
    // A macrotask, not a microtask: the request path chains several awaits (the service queue,
    // the channel pass, the adapter), and all of them must land before assertions run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Presses the pill inside an async act scope, then settles — the permission path resolves
 * promises the press started, and asserting mid-flight is what act scoping exists to prevent.
 */
async function press() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('pill'));
  });
  await settle();
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  useSettingsStore.getState().setAllReminders({ adhanEnabled: false });
  // Granted by default: the pre-§4.1 behaviours below must hold whenever notifications CAN fire.
  adapter = createFakeNotificationAdapter({ platform: 'ios' });
  setNotificationService(createNotificationService(adapter));
});

afterEach(() => {
  setNotificationService(null);
  jest.restoreAllMocks();
});

describe('ReminderPill', () => {
  it('offers to remind when the prayer has no adhan reminder', async () => {
    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    expect(screen.getByText('Remind me')).toBeTruthy();
    expect(screen.getByText(NOTIFICATIONS)).toBeTruthy();
  });

  it('reads as on when the reminder is enabled — word and icon, not just colour', async () => {
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: true });
    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    expect(screen.getByText('Reminder on')).toBeTruthy();
    expect(screen.getByText(NOTIFICATIONS_ACTIVE)).toBeTruthy();
  });

  it('persists the toggle through the settings store', async () => {
    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    fireEvent.press(screen.getByTestId('pill'));

    expect(useSettingsStore.getState().reminders.maghrib.adhanEnabled).toBe(true);
    expect(await screen.findByText('Reminder on')).toBeTruthy();

    fireEvent.press(screen.getByTestId('pill'));
    expect(useSettingsStore.getState().reminders.maghrib.adhanEnabled).toBe(false);
    expect(await screen.findByText('Remind me')).toBeTruthy();
  });

  it('touches only that prayer, and only its adhan reminder', async () => {
    const before = useSettingsStore.getState().reminders.maghrib;
    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    fireEvent.press(screen.getByTestId('pill'));

    const after = useSettingsStore.getState().reminders;
    expect(after.maghrib).toMatchObject({
      sound: before.sound,
      preReminderEnabled: before.preReminderEnabled,
      preReminderMinutes: before.preReminderMinutes,
      nudgeEnabled: before.nudgeEnabled,
    });
    expect(after.fajr.adhanEnabled).toBe(false);
  });

  it('exposes itself as a switch with a localized label, hint and checked state', async () => {
    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    const pill = screen.getByTestId('pill');
    expect(pill.props.accessibilityRole).toBe('switch');
    expect(pill.props.accessibilityState).toMatchObject({ checked: false });
    expect(pill.props.accessibilityLabel).toBe('Reminder for Maghrib');
    expect(pill.props.accessibilityHint).toBe("Sends a reminder when this prayer's time arrives");

    fireEvent.press(pill);
    await screen.findByText('Reminder on');
    expect(screen.getByTestId('pill').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('pill').props.accessibilityHint).toBe(
      'Turns off the reminder for this prayer'
    );
  });

  it('takes a supplied prayer name for the announcement, bidi-isolated', async () => {
    await render(<ReminderPill prayer="isha" prayerName="العشاء" testID="pill" />);
    await settle();
    const label = screen.getByTestId('pill').props.accessibilityLabel as string;

    // The words are the words…
    expect(stripBidi(label)).toBe('Reminder for العشاء');
    // …and the Arabic run arrives wrapped in FSI…PDI, because an RTL name at the end of an LTR
    // sentence otherwise drags the surrounding neutrals across it (src/i18n/bidi.ts). Every
    // interpolation in the app gets this from `i18n/formatter`, not from the call site.
    expect(label).toBe(`Reminder for ${FSI}العشاء${PDI}`);
  });

  it('is an outlined paper pill when off and a filled accent pill when on', async () => {
    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    expect(pillStyle()).toMatchObject({
      backgroundColor: paperLight.card,
      borderColor: paperLight.borderMid,
      borderRadius: 999,
    });
    expect(labelStyle('Remind me').color).toBe(paperLight.header);

    fireEvent.press(screen.getByTestId('pill'));
    await screen.findByText('Reminder on');
    expect(pillStyle()).toMatchObject({
      backgroundColor: paperLight.accent,
      borderColor: paperLight.accent,
    });
    expect(labelStyle('Reminder on').color).toBe(paperLight.sealFg);
  });

  it('keeps both states legible on night paper', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <ReminderPill prayer="maghrib" testID="pill" />
      </ThemePreferenceContext.Provider>
    );
    await settle();
    expect(pillStyle().backgroundColor).toBe(nightPaper.card);
    expect(labelStyle('Remind me').color).toBe(nightPaper.header);

    fireEvent.press(screen.getByTestId('pill'));
    await screen.findByText('Reminder on');
    expect(pillStyle().backgroundColor).toBe(nightPaper.accent);
    expect(labelStyle('Reminder on').color).toBe(nightPaper.sealFg);
  });
});

describe('the reminder trap (spec-accessibility §4.1)', () => {
  it('never claims the reminder is on while the permission would prevent it', async () => {
    adapter.config.permission = { status: 'undetermined', granted: false, canAskAgain: true };
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: true });

    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();

    // Icon + words, never colour alone — and not the switch role while its job is permission.
    expect(screen.queryByText('Reminder on')).toBeNull();
    expect(screen.getByText(NEEDS_PERMISSION)).toBeTruthy();
    expect(screen.getByText(NOTIFICATIONS_OFF)).toBeTruthy();
    const pill = screen.getByTestId('pill');
    expect(pill.props.accessibilityRole).toBe('button');
    expect(pill.props.accessibilityHint).toBe(
      'Asks the system for permission to send notifications'
    );
    // Outlined, not filled: the pill must not wear the "on" face in any channel.
    expect(pillStyle().backgroundColor).toBe(paperLight.card);
  });

  it('renders the stored setting while the very first permission read is still in flight', async () => {
    // A service whose getPermission never resolves: the pill must not flash a warning at every
    // granted user during the milliseconds the read takes.
    setNotificationService({
      ...createNotificationService(adapter),
      getPermission: () => new Promise(() => undefined),
    });
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: true });

    await render(<ReminderPill prayer="maghrib" testID="pill" />);

    expect(screen.getByText('Reminder on')).toBeTruthy();
    expect(screen.queryByText(NEEDS_PERMISSION)).toBeNull();
  });

  it('asks the OS right there when tapped, and turns honest gold on a grant', async () => {
    adapter.config.permission = { status: 'undetermined', granted: false, canAskAgain: true };
    adapter.config.permissionAfterRequest = {
      status: 'granted',
      granted: true,
      canAskAgain: true,
    };
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: true });

    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    expect(adapter.calls.requestPermission).toBe(0);

    await press();

    // The tap asked (once), the setting was never toggled off, and the pill now tells the truth.
    expect(screen.getByText('Reminder on')).toBeTruthy();
    expect(adapter.calls.requestPermission).toBe(1);
    expect(useSettingsStore.getState().reminders.maghrib.adhanEnabled).toBe(true);
    expect(screen.getByText(NOTIFICATIONS_ACTIVE)).toBeTruthy();
  });

  it('stays honest when the OS says no again', async () => {
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: true };
    adapter.config.permissionAfterRequest = { status: 'denied', granted: false, canAskAgain: false };
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: true });

    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    await press();

    expect(adapter.calls.requestPermission).toBe(1);
    expect(screen.getByText(NEEDS_PERMISSION)).toBeTruthy();
    // The OS will not ask again, so the pill's next door is the system settings.
    expect(screen.getByTestId('pill').props.accessibilityHint).toBe(
      'Opens system settings, where notifications can be allowed'
    );
  });

  it('deep-links to the system settings once the OS has stopped asking', async () => {
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: false };
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: true });
    const openSettings = jest
      .spyOn(Linking, 'openSettings')
      .mockImplementation(() => Promise.resolve());

    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    await press();

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(adapter.calls.requestPermission).toBe(0);
    expect(useSettingsStore.getState().reminders.maghrib.adhanEnabled).toBe(true);
  });

  it('turning the reminder on is itself the signal of intent — it asks in the same tap', async () => {
    adapter.config.permission = { status: 'undetermined', granted: false, canAskAgain: true };
    // A dialog that never answers: what the pill does before the OS responds is the design —
    // the toggle must land without waiting, and the pill must not claim "on" on credit.
    let asked = 0;
    const base = createNotificationService(adapter);
    setNotificationService({
      ...base,
      requestPermission: () => {
        asked += 1;
        return new Promise(() => undefined);
      },
    });

    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    expect(screen.getByText('Remind me')).toBeTruthy();

    await press();

    // The toggle landed without awaiting the dialog, and the OS was asked in the same tap…
    expect(useSettingsStore.getState().reminders.maghrib.adhanEnabled).toBe(true);
    expect(asked).toBe(1);
    // …but until the OS answers, the pill does not claim "on" on credit.
    expect(screen.getByText(NEEDS_PERMISSION)).toBeTruthy();
    expect(screen.queryByText('Reminder on')).toBeNull();
  });

  it('turns honest gold on return from the system settings, without another tap', async () => {
    // The blocked path's happy ending: the user allowed notifications in the OS settings and
    // came back. Foregrounding re-reads the permission — the pill must not stay on its warning.
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: false };
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: true });

    let foreground: ((state: AppStateStatus) => void) | undefined;
    const addListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        foreground = listener as (state: AppStateStatus) => void;
        return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
      });

    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();
    expect(screen.getByText(NEEDS_PERMISSION)).toBeTruthy();
    expect(addListener).toHaveBeenCalled();

    // While the app was backgrounded, the user flipped the switch in the OS settings…
    adapter.config.permission = { status: 'granted', granted: true, canAskAgain: false };
    await act(async () => {
      foreground?.('active');
    });
    await settle();

    // …and the pill tells the new truth the moment the app is back.
    expect(screen.getByText('Reminder on')).toBeTruthy();
    expect(screen.queryByText(NEEDS_PERMISSION)).toBeNull();
  });

  it('turning the reminder off never involves the permission machinery', async () => {
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: true };
    useSettingsStore.getState().setReminder('maghrib', { adhanEnabled: false });

    await render(<ReminderPill prayer="maghrib" testID="pill" />);
    await settle();

    // Setting off + permission denied is NOT the trap: nothing was promised.
    expect(screen.getByText('Remind me')).toBeTruthy();
    expect(screen.getByTestId('pill').props.accessibilityRole).toBe('switch');
  });
});
