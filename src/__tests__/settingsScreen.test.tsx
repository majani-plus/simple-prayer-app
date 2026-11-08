/**
 * Screen test for the Settings tab (`src/app/(tabs)/settings.tsx`).
 *
 * The screen is a composition, so what is tested is the composition: that every group named in
 * PRODUCT_SPEC §12 is on screen in order, that each navigation row goes where it says it goes,
 * that the rows summarising another screen's state (the resolved calculation method, how many
 * prayers have reminders, which city) read the settings store rather than a hardcoded string,
 * and that theme and language changes land in the store immediately — the store being what the
 * root layout watches to repaint and to switch i18next.
 *
 * MMKV is mocked (the settings singleton hydrates from it at import time) and `expo-router`'s
 * `useRouter` is a probe, so a press can be checked against the route it pushed. Everything else
 * — the settings store, the domain method resolution, i18n, the rows — is the real thing.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import SettingsScreen from '../app/(tabs)/settings';
import { addDays } from '../domain/dates';
import { initI18n } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import { useTrackingStore } from '../stores/trackingStore';

// Jest has no app config, so the DSN app.json ships is fed in here: these tests are of the
// normal build. One test below clears it to stand in for a FOSS build.
const DSN = 'https://key@o1.ingest.de.sentry.io/1';
let mockSentryDsn: string | null = DSN;
jest.mock('../services/telemetry', () => ({
  ...jest.requireActual('../services/telemetry'),
  sentryDsn: () => mockSentryDsn,
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
        remove: (key: string) => void store.delete(key),
        clearAll: () => store.clear(),
      };
    },
  };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

// The safe-area provider is installed by expo-router, which this test does not mount.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

/** Istanbul — a country whose auto method resolves to a named authority (Diyanet). */
const ISTANBUL = {
  latitude: 41.0082,
  longitude: 28.9784,
  label: 'Istanbul',
  countryCode: 'TR',
  source: 'manual' as const,
  resolvedAt: 0,
};

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  mockPush.mockClear();
  useSettingsStore.getState().resetToDefaults();
  await initI18n().changeLanguage('en');
});

describe('the Settings tab', () => {
  it('shows every group from the spec, in order', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByText('Settings')).toBeTruthy();

    // Actually in order. This test has always been called "in order" and only ever checked that
    // each group existed, which would have passed for any arrangement — including the one the
    // owner reported as hard to follow on a real device (2026-09-16).
    //
    // The order is the order of questions (D178): are my times right → what reminds me → who
    // prays with me → what my log counts → how it looks → what leaves the phone → where to get
    // help. Location is inside Prayer times; the exports are inside the log group; the pledge
    // stands directly above the tip jar it explains.
    const expected = [
      'settings-group-prayer-times',
      'settings-group-reminders',
      'settings-group-buddies',
      'settings-group-tracking',
      'settings-group-appearance',
      'settings-group-privacy',
      'settings-group-support',
    ];

    const tree = JSON.stringify(screen.toJSON());
    const positions = expected.map((id) => {
      const at = tree.indexOf(`"${id}"`);
      expect(at).toBeGreaterThan(-1);
      return at;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('puts location inside the prayer-times group — one question, two answers', async () => {
    await render(<SettingsScreen />);

    const group = screen.getByTestId('settings-group-prayer-times');
    expect(within(group).getByTestId('settings-row-location')).toBeTruthy();
    expect(within(group).getByTestId('settings-row-calculation')).toBeTruthy();
    expect(screen.queryByTestId('settings-group-location')).toBeNull();
  });

  it('keeps buddy mode in its own group, not buried in tracking, and says whether it is on', async () => {
    await render(<SettingsScreen />);

    const row = within(screen.getByTestId('settings-group-buddies')).getByTestId(
      'settings-row-buddies'
    );
    expect(row).toBeTruthy();
    // Off by default (D174), and the row says so in a word rather than leaving the group a
    // mystery to someone who has never heard of it.
    expect(within(row).getByText('Off')).toBeTruthy();
    expect(
      within(screen.getByTestId('settings-group-tracking')).queryByTestId('settings-row-buddies')
    ).toBeNull();

    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/settings/buddies');
  });

  it('keeps the exports under the log they export, and the pledge under Privacy', async () => {
    await render(<SettingsScreen />);

    // No separate Data heading any more: the two export rows close the prayer-log group.
    expect(screen.queryByTestId('settings-group-data')).toBeNull();
    const log = screen.getByTestId('settings-group-tracking');
    expect(within(log).getByTestId('settings-row-export-csv')).toBeTruthy();
    expect(within(log).getByTestId('settings-row-export-json')).toBeTruthy();

    // The pledge is stated rather than sold (D31), under the word people look for, with the
    // crash-reports switch — its one exception — beside it.
    const privacy = screen.getByTestId('settings-group-privacy');
    expect(within(privacy).getByTestId('settings-row-pledge')).toBeTruthy();
    expect(within(privacy).getByText('No ads, ever')).toBeTruthy();
    expect(within(privacy).getByTestId('settings-row-diagnostics')).toBeTruthy();

    const support = screen.getByTestId('settings-group-support');
    expect(within(support).getByTestId('settings-row-rate')).toBeTruthy();
    expect(within(support).getByTestId('settings-row-feedback')).toBeTruthy();
    expect(within(support).getByTestId('settings-row-about')).toBeTruthy();
  });

  it('opens the about screen', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('settings-row-about'));

    expect(mockPush).toHaveBeenCalledWith('/settings/about');
  });

  it('opens scrolled to the top', async () => {
    // A debugging leftover once shipped `contentOffset={{ y: 5000 }}` here, which mounted the
    // screen scrolled to the bottom with the title buried under the status bar. The scroll view
    // must start wherever the OS puts an untouched one: no initial offset at all.
    await render(<SettingsScreen />);

    expect(screen.getByTestId('settings-scroll').props.contentOffset).toBeUndefined();
  });
});

describe('the location row', () => {
  it('says no location is set before one is', async () => {
    await render(<SettingsScreen />);

    expect(screen.getByTestId('settings-row-location').props.accessibilityLabel).toContain(
      'Not set yet'
    );
  });

  it('summarises the resolved city and how it was chosen', async () => {
    useSettingsStore.getState().setLocation(ISTANBUL);
    useSettingsStore.getState().setUseAutoLocation(false);
    await render(<SettingsScreen />);

    expect(screen.getByText('Istanbul')).toBeTruthy();
    expect(screen.getByText('A city you chose.')).toBeTruthy();
  });

  it('opens the location sub-screen', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('settings-row-location'));

    expect(mockPush).toHaveBeenCalledWith('/settings/location');
  });
});

describe('the prayer-times row', () => {
  it('names the authority the automatic method resolved to', async () => {
    useSettingsStore.getState().setLocation(ISTANBUL);
    await render(<SettingsScreen />);

    // "Auto (…)" — never the bare word "Auto", which tells the user nothing they can check
    // against their mosque's calendar.
    expect(screen.getByText('Auto (Diyanet)')).toBeTruthy();
  });

  it('names a manually chosen method plainly', async () => {
    useSettingsStore.getState().setCalculation({ method: 'ummAlQura' });
    await render(<SettingsScreen />);

    expect(screen.getByText('Umm al-Qura')).toBeTruthy();
    expect(screen.queryByText(/^Auto/)).toBeNull();
  });

  it('opens the calculation sub-screen', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('settings-row-calculation'));

    expect(mockPush).toHaveBeenCalledWith('/settings/calculation');
  });
});

describe('the tracking group', () => {
  it('offers the two streak modes by their friendly names, each explained', async () => {
    await render(<SettingsScreen />);

    expect(screen.getByText('Relaxed')).toBeTruthy();
    expect(screen.getByText('Committed')).toBeTruthy();
    // The selected mode's sentence is on screen; the other one's is not.
    expect(
      screen.getByText('A day counts once you mark at least one prayer as prayed or late.')
    ).toBeTruthy();
  });

  it('writes the streak mode straight to the store', async () => {
    await render(<SettingsScreen />);
    expect(useSettingsStore.getState().streakMode).toBe('soft');

    await fireEvent.press(screen.getByTestId('settings-row-streak-option-hard'));

    expect(useSettingsStore.getState().streakMode).toBe('hard');
    expect(
      await screen.findByText('A day counts when all five are marked as prayed or late.')
    ).toBeTruthy();
  });

  it('switches how prayers are marked, starting simple mode at today (D192)', async () => {
    await render(<SettingsScreen />);
    expect(useSettingsStore.getState().trackingMode).toBe('detailed');
    expect(screen.getByText('How you mark prayers')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('settings-row-tracking-mode-option-simple'));

    expect(useSettingsStore.getState().trackingMode).toBe('simple');
    expect(useSettingsStore.getState().simpleModeSince).toBe(useTrackingStore.getState().todayDay());
    expect(
      await screen.findByText(
        'One tap marks a prayer as prayed. A prayer you do not mark shows as missed once its time has passed.'
      )
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId('settings-row-tracking-mode-option-detailed'));
    expect(useSettingsStore.getState().trackingMode).toBe('detailed');
  });

  it('shows excused days as a door with its state on it, in the neutral register', async () => {
    await render(<SettingsScreen />);
    const row = screen.getByTestId('settings-row-exemption');

    // Off: the value says so, and the one-line description never names what the feature is for —
    // that paragraph lives under the switch on the excused-days screen (D62, D178).
    expect(within(row).getByText('Off')).toBeTruthy();
    expect(within(row).queryByText(/menstruation/)).toBeNull();
    expect(within(row).getByText('Days when prayer is not required. Never counted as missed.')).toBeTruthy();

    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/settings/exemption');
  });

  it('reads the running exemption onto the row once the mode is on', async () => {
    const original = { exemptPeriods: useTrackingStore.getState().exemptPeriods };
    useSettingsStore.getState().setExemptionModeEnabled(true);
    const today = useTrackingStore.getState().todayDay();
    useTrackingStore.setState({
      exemptPeriods: [{ id: 1, startDay: addDays(today, -2), endDay: null, createdAt: 0 }],
    });
    try {
      await render(<SettingsScreen />);
      const row = screen.getByTestId('settings-row-exemption');

      expect(within(row).getByText('On')).toBeTruthy();
      expect(within(row).getByText(/^Excused since /)).toBeTruthy();
    } finally {
      cleanup();
      useTrackingStore.setState(original);
    }
  });

  it('opens the making up prayers screen', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('settings-row-qada'));

    expect(mockPush).toHaveBeenCalledWith('/qada');
  });
});

describe('the reminders group', () => {
  it('counts every prayer when the first-run defaults are in force', async () => {
    // Out of the box each prayer has its adhan reminder and its end-of-window nudge on.
    await render(<SettingsScreen />);

    expect(screen.getByText('5 of 5 prayers')).toBeTruthy();
  });

  it('says none are on when every reminder has been switched off', async () => {
    useSettingsStore
      .getState()
      .setAllReminders({ adhanEnabled: false, preReminderEnabled: false, nudgeEnabled: false });
    await render(<SettingsScreen />);

    expect(screen.getByText('None yet')).toBeTruthy();
  });

  it('counts the prayers that have any kind of reminder', async () => {
    useSettingsStore
      .getState()
      .setAllReminders({ adhanEnabled: false, preReminderEnabled: false, nudgeEnabled: false });
    useSettingsStore.getState().setReminder('fajr', { adhanEnabled: true });
    // A prayer counts for ANY of the three kinds, not only the adhan one.
    useSettingsStore.getState().setReminder('isha', { nudgeEnabled: true });
    await render(<SettingsScreen />);

    expect(screen.getByText('2 of 5 prayers')).toBeTruthy();
  });

  it('opens the reminders screen and the reliability screen', async () => {
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByTestId('settings-row-reminders'));
    expect(mockPush).toHaveBeenCalledWith('/settings/reminders');

    await fireEvent.press(screen.getByTestId('settings-row-reminder-health'));
    expect(mockPush).toHaveBeenCalledWith('/settings/reminder-health');
  });
});

describe('the crash-reports switch', () => {
  afterEach(() => {
    mockSentryDsn = DSN;
  });

  it('is not shown at all in a build with no Sentry DSN', async () => {
    mockSentryDsn = null;
    await render(<SettingsScreen />);

    expect(screen.queryByTestId('settings-row-diagnostics')).toBeNull();
  });

  // The opt-out for services/telemetry.ts. It lives in the Support group beside the pledge —
  // the pledge is where the app's privacy claims are made, so its one diagnostic exception is
  // disclosed and switchable in the same place.
  it('is on by default and writes the opt-out straight to the store', async () => {
    await render(<SettingsScreen />);

    const row = screen.getByTestId('settings-row-diagnostics');
    expect(row.props.accessibilityState.checked).toBe(true);
    expect(within(row).getByText('On')).toBeTruthy();

    await fireEvent.press(row);

    expect(useSettingsStore.getState().crashReportingEnabled).toBe(false);
    expect(await within(row).findByText('Off')).toBeTruthy();
  });

  it('says honestly that a change applies at the next launch', async () => {
    // The setting is read once at startup; a toggle that silently does nothing until a restart
    // must say so in its own copy.
    await render(<SettingsScreen />);

    expect(
      within(screen.getByTestId('settings-row-diagnostics')).getByText(/next time you open the app/)
    ).toBeTruthy();
  });

  it.each([
    ['en', 'Crash reports'],
    ['ar', 'تقارير الأعطال'],
    ['tr', 'Çökme raporları'],
  ] as const)('renders in %s', async (language, label) => {
    await act(async () => {
      await initI18n().changeLanguage(language);
    });
    await render(<SettingsScreen />);

    expect(screen.getByText(label)).toBeTruthy();
    // Still a live switch in every language, not just a translated label.
    expect(screen.getByTestId('settings-row-diagnostics').props.accessibilityState.checked).toBe(
      true
    );
  });
});

describe('appearance and language', () => {
  it('applies a theme choice immediately', async () => {
    await render(<SettingsScreen />);
    expect(useSettingsStore.getState().theme).toBe('system');

    await fireEvent.press(screen.getByTestId('settings-row-theme-option-dark'));

    // The root layout feeds this straight into the theme context — no confirm, no restart.
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('offers every language in its own script, and applies a same-direction choice immediately', async () => {
    await render(<SettingsScreen />);

    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('العربية')).toBeTruthy();
    expect(screen.getByText('Türkçe')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('settings-row-language-option-tr'));

    // Turkish reads the same way round as English, so there is nothing to restart and nothing to
    // ask: the store takes it and the root layout repaints.
    expect(useSettingsStore.getState().language).toBe('tr');
  });

  it('warns before Arabic turns the layout around, and never restarts unasked', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByTestId('settings-row-language-option-ar'));

    // Nothing has happened yet. A direction flip costs a reload, and a reload is never sprung on
    // someone mid-tap (src/i18n/useLanguageSwitch.ts).
    expect(useSettingsStore.getState().language).toBe('system');
    expect(alert).toHaveBeenCalledTimes(1);

    // "Later" is a real answer: the language still changes, and the alert has already said the
    // layout turns around at the next launch.
    const buttons = alert.mock.calls[0][2] as { text?: string; onPress?: () => void }[];
    await act(async () => {
      buttons[0].onPress?.();
    });
    expect(useSettingsStore.getState().language).toBe('ar');

    alert.mockRestore();
  });

  it('re-renders in the chosen language', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByText('Settings')).toBeTruthy();

    // The app's language is switched by the root layout when the store changes; this stands in
    // for that, and pins that the screen itself carries no English of its own. `act` because the
    // language change re-renders every subscribed `useTranslation` synchronously.
    await act(async () => {
      await initI18n().changeLanguage('tr');
    });

    expect(await screen.findByText('Ayarlar')).toBeTruthy();
    expect(screen.queryByText('Settings')).toBeNull();
  });
});
