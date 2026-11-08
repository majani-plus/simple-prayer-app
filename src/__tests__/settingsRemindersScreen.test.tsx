/**
 * Screen test for Settings → Reminders (`src/app/settings/reminders.tsx`).
 *
 * This screen configures the behaviour the category is worst at (our market research: "the
 * adhan did not fire"), so the tests are aimed at the promises rather than the layout:
 *
 * 1. **Every control writes one settings field, for one prayer.** The notification plan is
 *    computed from the store by `domain/notificationPlan`, so "the right notification is
 *    scheduled" is a property of *where the write lands* — and a sound set on Fajr must never
 *    touch Dhuhr.
 * 2. **The bulk actions really are bulk**, because setting five prayers one at a time is the
 *    reason people give up half way through.
 * 3. **A change reaches the notification service, coalesced.** The real controller from
 *    `hooks/useNotificationSync` is started against a fake platform, so three taps in a row are
 *    asserted to cost exactly one reschedule — the actual wiring, not a mock of it.
 * 4. **A refusal is handled calmly and asked about exactly once.** The permission card explains,
 *    offers one button, prompts once however fast it is tapped, and turns into a system-settings
 *    deep link once the OS has stopped asking — while the rest of the screen stays configurable.
 * 5. **The test notification proves the pipeline**, with the sound the user actually chose.
 * 6. **A prayer's card is closed until it is asked for**, and while closed it still says what it
 *    is set to — in words, to the eye and to a screen reader alike.
 *
 * The real settings store is used (over an in-memory MMKV) so clamps and selectors are the
 * production ones; the tracking store is mocked because it opens SQLite; the notification layer
 * runs the real service over `createFakeNotificationAdapter`.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';

import RemindersSettingsScreen from '../app/settings/reminders';
import { ADHAN_VOICES, DEFAULT_ADHAN_VOICE, adhanSoundFile } from '../domain/adhanVoices';
import { PRAYERS } from '../domain/types';
import { startNotificationSync } from '../hooks/useNotificationSync';
import { initI18n } from '../i18n';
import {
  createFakeNotificationAdapter,
  createNotificationService,
  setNotificationService,
  type FakeNotificationAdapter,
  type NotificationAdapter,
  type NotificationService,
} from '../services/notifications';
import { useSettingsStore } from '../stores/settingsStore';

import type { AppLocation, Prayer } from '../domain/types';

// `expo-audio` is a native module and cannot load under Jest. The preview's *behaviour* (play,
// stop, switch, stop on leaving) belongs to `hooks/useAdhanPreview`; what this screen owes is that
// the four recitations are reachable, that the chosen one is marked, and that pressing one both
// chooses it and plays it — so the player is faked at the module boundary and the assertions stay
// about the screen.
jest.mock('expo-audio', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  const listeners = new Set<() => void>();
  const state = { playing: false };
  const set = (playing: boolean) => {
    state.playing = playing;
    for (const listener of listeners) listener();
  };
  const player = {
    get playing() {
      return state.playing;
    },
    play: jest.fn(() => set(true)),
    pause: jest.fn(() => set(false)),
    seekTo: jest.fn(),
    // Switching recitation replaces the one player's source; the fake stops, as the real one does.
    replace: jest.fn(() => set(false)),
  };
  return {
    __player: player,
    __reset: () => set(false),
    useAudioPlayer: () => player,
    // The real hook re-renders when playback starts or stops; the fake has to as well, or the
    // control could never change its word.
    useAudioPlayerStatus: () => {
      const [playing, setPlaying] = React.useState(state.playing);
      React.useEffect(() => {
        const listener = () => setPlaying(state.playing);
        listeners.add(listener);
        listener();
        return () => void listeners.delete(listener);
      }, []);
      return { playing };
    },
    setAudioModeAsync: jest.fn(async () => undefined),
  };
});

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

/** Whether the fake binary carries `modules/audio-pause` — the D96 toggle only renders where it does. */
let mockAudioPauseSupported = false;

jest.mock('../../modules/audio-pause', () => {
  const actual = jest.requireActual('../../modules/audio-pause');
  return { ...actual, isSupported: () => mockAudioPauseSupported };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

/** A minimal stand-in for the tracking store, which `useNotificationSync` reads through SQLite. */
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

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: { navigate: jest.fn() },
  // The screen uses this to silence the adhan when another screen is pushed over it. Outside a
  // navigator there is no focus to lose, so it behaves as a plain effect.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}));

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

let adapter: FakeNotificationAdapter;
let service: NotificationService;

const reminders = () => useSettingsStore.getState().reminders;

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** Opens a prayer's card. Its controls are only mounted once it is open. */
async function open(prayer: Prayer) {
  await press(`reminders-${prayer}-card`);
}

/** Lets pending promises (and any timer up to `ms`) settle inside one act scope. */
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function renderScreen() {
  // Deliberately NOT wrapped in `act`: nothing is mounted yet, and opening an act scope around a
  // plain zustand write swallows the render that follows it.
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.getState().setLocation(ISTANBUL);
  await render(<RemindersSettingsScreen />);
  // The permission is read in an effect; let that resolve before anything is asserted.
  await settle();
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  adapter = createFakeNotificationAdapter({ platform: 'ios' });
  service = createNotificationService(adapter);
  setNotificationService(service);
  mockRouter.back.mockClear();
});

afterEach(() => {
  setNotificationService(null);
  jest.restoreAllMocks();
});

describe('the prayer cards', () => {
  // The screen the owner asked for: five prayers you can read, not fifteen controls you have to
  // wade through ("make them collapsible cards, so I start by seeing a list of prayers").
  it('starts as five closed cards, with no controls on screen', async () => {
    await renderScreen();

    for (const prayer of PRAYERS) {
      expect(screen.getByTestId(`reminders-${prayer}-card`)).toBeTruthy();
      expect(screen.queryByTestId(`reminders-${prayer}-adhan`)).toBeNull();
      expect(screen.queryByTestId(`reminders-${prayer}-pre`)).toBeNull();
      expect(screen.queryByTestId(`reminders-${prayer}-nudge`)).toBeNull();
    }
  });

  it('opens one card without disturbing the others, and closes it again', async () => {
    await renderScreen();

    await open('dhuhr');
    expect(screen.getByTestId('reminders-dhuhr-adhan')).toBeTruthy();
    // Opening one card must not close another: the page under the user's thumb has to hold still.
    expect(screen.queryByTestId('reminders-asr-adhan')).toBeNull();
    await open('asr');
    expect(screen.getByTestId('reminders-dhuhr-adhan')).toBeTruthy();
    expect(screen.getByTestId('reminders-asr-adhan')).toBeTruthy();

    await open('dhuhr');
    expect(screen.queryByTestId('reminders-dhuhr-adhan')).toBeNull();
    expect(screen.getByTestId('reminders-asr-adhan')).toBeTruthy();
  });

  it('exposes the disclosure to a screen reader, expanded state and all', async () => {
    await renderScreen();
    const card = () => screen.getByTestId('reminders-fajr-card');

    expect(card().props.accessibilityRole).toBe('button');
    expect(card().props.accessibilityState).toMatchObject({ expanded: false });
    // The summary is spoken with the name, so the closed card tells its whole story by ear too.
    expect(card().props.accessibilityLabel).toBe(
      'Fajr · At the time · Device sound · Last call'
    );
    expect(card().props.accessibilityHint).toBe('Opens this prayer’s reminders');

    await open('fajr');

    expect(card().props.accessibilityState).toMatchObject({ expanded: true });
    expect(card().props.accessibilityHint).toBe('Closes this prayer’s reminders');
  });

  it('summarises what a closed card is set to, in words rather than a colour', async () => {
    await renderScreen();

    const summary = screen.getByTestId('reminders-maghrib-summary');
    expect(summary).toHaveTextContent('At the time · Device sound', { exact: false });
    expect(summary).toHaveTextContent('Last call', { exact: false });

    // A prayer with nothing switched on says so, rather than being the card without a tint.
    await press('reminders-bulk-adhan-off');
    await press('reminders-bulk-nudge-off');
    expect(screen.getByTestId('reminders-maghrib-summary')).toHaveTextContent('No reminders', {
      exact: false,
    });
  });

  it('drops the summary while the card is open, because the controls say it better', async () => {
    await renderScreen();
    expect(screen.getByTestId('reminders-isha-summary')).toBeTruthy();

    await open('isha');

    expect(screen.queryByTestId('reminders-isha-summary')).toBeNull();
  });
});

describe('the three reminders, per prayer', () => {
  it('writes the adhan toggle for exactly the prayer that was tapped', async () => {
    await renderScreen();
    await open('fajr');
    expect(reminders().fajr.adhanEnabled).toBe(true);

    await press('reminders-fajr-adhan');

    expect(reminders().fajr.adhanEnabled).toBe(false);
    expect(reminders().dhuhr.adhanEnabled).toBe(true);
  });

  it('writes the pre-reminder toggle and reveals its lead-time chips', async () => {
    await renderScreen();
    await open('fajr');
    expect(screen.queryByTestId('reminders-fajr-minutes')).toBeNull();

    await press('reminders-fajr-pre');

    expect(reminders().fajr.preReminderEnabled).toBe(true);
    expect(reminders().isha.preReminderEnabled).toBe(false);
    expect(screen.getByTestId('reminders-fajr-minutes')).toBeTruthy();
  });

  it('writes the nudge toggle', async () => {
    await renderScreen();
    await open('asr');
    expect(reminders().asr.nudgeEnabled).toBe(true);

    await press('reminders-asr-nudge');

    expect(reminders().asr.nudgeEnabled).toBe(false);
    expect(reminders().maghrib.nudgeEnabled).toBe(true);
  });

  // The label the owner read as Fajr-specific, and the sentence that has to make the condition
  // unmistakable: it is every prayer, and it only ever fires while the prayer is unmarked.
  it('says plainly what the last call is, for the prayer it belongs to', async () => {
    await renderScreen();
    await open('asr');

    expect(screen.getByText('Last call before the time ends')).toBeTruthy();
    expect(
      screen.getByText(
        'A quiet reminder as Asr’s time is running out — sent only if you have not marked it yet.'
      )
    ).toBeTruthy();
  });

  it('hides the sound chips while the adhan reminder is off', async () => {
    await renderScreen();
    await open('isha');
    expect(screen.getByTestId('reminders-isha-sound')).toBeTruthy();

    await press('reminders-isha-adhan');

    expect(screen.queryByTestId('reminders-isha-sound')).toBeNull();
  });
});

describe('the sound', () => {
  it('persists per prayer and leaves the others alone', async () => {
    await renderScreen();
    await open('fajr');
    await open('dhuhr');
    expect(reminders().fajr.sound).toBe('system');

    await press('reminders-fajr-sound-option-adhan');

    expect(reminders().fajr.sound).toBe('adhan');
    expect(reminders().dhuhr.sound).toBe('system');
    expect(screen.getByTestId('reminders-fajr-sound-option-adhan')).toBeSelected();
    expect(screen.getByTestId('reminders-dhuhr-sound-option-system')).toBeSelected();
  });

  // The adhan option says what the clip *is*. It used to lead with iOS's 30-second cap, which the
  // owner called out as confusing users about something that is ours to handle, not theirs.
  it('describes the adhan clip without quoting the iOS sound cap', async () => {
    await renderScreen();
    await open('maghrib');
    await press('reminders-maghrib-sound-option-adhan');

    expect(
      screen.getByText('The call to prayer, played by your phone as the reminder arrives.')
    ).toBeTruthy();
    expect(screen.queryByText(/iOS/)).toBeNull();
    expect(screen.queryByText(/30 seconds/)).toBeNull();
    expect(screen.queryByText(/27.75/)).toBeNull();
  });

  it('can be silenced for one prayer only', async () => {
    await renderScreen();
    await open('dhuhr');

    await press('reminders-dhuhr-sound-option-silent');

    expect(reminders().dhuhr.sound).toBe('silent');
    expect(reminders().asr.sound).toBe('system');
  });
});

describe('the pre-reminder lead time', () => {
  it('writes the chosen number of minutes for that prayer', async () => {
    await renderScreen();
    await open('fajr');
    await press('reminders-fajr-pre');
    expect(reminders().fajr.preReminderMinutes).toBe(30);

    await press('reminders-fajr-minutes-option-45');

    expect(reminders().fajr.preReminderMinutes).toBe(45);
    expect(reminders().dhuhr.preReminderMinutes).toBe(15);
  });

  it('offers the Fajr wake-up its own copy', async () => {
    await renderScreen();
    await open('fajr');
    expect(
      screen.getByText(
        'The wake-up. Set it early enough that you can actually get up — this is the reminder other apps charge for.'
      )
    ).toBeTruthy();
  });
});

describe('the last call’s timing', () => {
  const lead = () => useSettingsStore.getState().nudgeLeadMinutes;

  it('is one global choice, not five, and writes the chosen number of minutes', async () => {
    await renderScreen();
    expect(lead()).toBe(20);

    await press('reminders-nudge-lead-option-10');

    expect(lead()).toBe(10);
    // Nothing per-prayer moved: "how much warning do I want" has one answer.
    expect(PRAYERS.every((prayer: Prayer) => reminders()[prayer].nudgeEnabled)).toBe(true);
  });

  it('names Isha’s exception, which the lead does not move', async () => {
    await renderScreen();
    expect(
      screen.getByText(
        'Before a prayer’s time ends. Isha’s is timed to Islamic midnight instead.'
      )
    ).toBeTruthy();
  });

  it('is absent while no prayer has a last call to time', async () => {
    await renderScreen();
    expect(screen.getByTestId('reminders-nudge-lead')).toBeTruthy();

    await press('reminders-bulk-nudge-off');

    expect(screen.queryByTestId('reminders-nudge-lead')).toBeNull();
  });
});

describe('the sunrise note', () => {
  const sunriseNote = () => useSettingsStore.getState().sunriseNoteEnabled;

  it('is a switch of its own, off until it is asked for (D90)', async () => {
    await renderScreen();
    expect(sunriseNote()).toBe(false);

    await press('reminders-sunrise-note-switch');

    expect(sunriseNote()).toBe(true);
    // It is not a per-prayer reminder: no prayer's last call moved with it.
    expect(PRAYERS.every((prayer: Prayer) => reminders()[prayer].nudgeEnabled)).toBe(true);

    await press('reminders-sunrise-note-switch');
    expect(sunriseNote()).toBe(false);
  });

  it('is reachable without opening a prayer card, since it ships off', async () => {
    await renderScreen();
    // Same reasoning as the bulk rows: a setting nobody can see is a setting nobody turns on.
    expect(screen.getByTestId('reminders-sunrise-note-switch')).toBeTruthy();
  });

  it('says what it is and when it arrives, so it can be decided without trying it', async () => {
    await renderScreen();

    expect(
      screen.getByText(
        'A silent note at sunrise, when Fajr’s time ends. It gives the next prayer and its ' +
          'time. It comes only if you have not marked Fajr yet.'
      )
    ).toBeTruthy();
    // And says which notification it is NOT, because the last call is the one it gets confused
    // with — that one arrives while there is still time to pray.
    expect(
      screen.getByText(
        'This is not the last call. The last call arrives before sunrise, while there is still ' +
          'time to pray. You can set that for each prayer below.'
      )
    ).toBeTruthy();
  });

  it('is no longer promised by Fajr’s last-call switch, which now describes only itself', async () => {
    await renderScreen();
    await open('fajr');

    expect(
      screen.getByText(
        'A quiet reminder before sunrise, when Fajr’s time is running out — sent only if you ' +
          'have not marked it yet.'
      )
    ).toBeTruthy();
  });

  it('is not promised for any other prayer', async () => {
    await renderScreen();
    await open('maghrib');

    expect(
      screen.getByText(
        'A quiet reminder as Maghrib’s time is running out — sent only if you have not marked it yet.'
      )
    ).toBeTruthy();
  });
});

describe('bulk actions', () => {
  it('turns every adhan reminder off, then back on, in one tap each', async () => {
    await renderScreen();

    await press('reminders-bulk-adhan-off');
    expect(PRAYERS.every((prayer: Prayer) => !reminders()[prayer].adhanEnabled)).toBe(true);
    expect(screen.getByTestId('reminders-bulk-adhan')).toHaveTextContent('0 of 5 on', {
      exact: false,
    });

    await press('reminders-bulk-adhan-on');
    expect(PRAYERS.every((prayer: Prayer) => reminders()[prayer].adhanEnabled)).toBe(true);
    expect(screen.getByTestId('reminders-bulk-adhan')).toHaveTextContent('5 of 5 on', {
      exact: false,
    });
  });

  it('turns every nudge off without touching the adhan reminders', async () => {
    await renderScreen();

    await press('reminders-bulk-nudge-off');

    expect(PRAYERS.every((prayer: Prayer) => !reminders()[prayer].nudgeEnabled)).toBe(true);
    expect(PRAYERS.every((prayer: Prayer) => reminders()[prayer].adhanEnabled)).toBe(true);
  });

  it('disables the action that would change nothing', async () => {
    await renderScreen();
    // Everything ships with the adhan reminder on, so "turn all on" is already true.
    expect(screen.getByTestId('reminders-bulk-adhan-on')).toBeDisabled();
    expect(screen.getByTestId('reminders-bulk-adhan-off')).toBeEnabled();
  });
});

describe('the test notification', () => {
  it('sends one through the service, with the sound the user chose', async () => {
    await renderScreen();
    await open('fajr');
    await press('reminders-fajr-sound-option-adhan');

    await press('reminders-test');
    await settle();

    const presented = adapter.presented.get('test');
    // The adapter is on iOS, so the test rings with the `.caf` clip — the same file the real
    // reminder will use, which is the entire point of the test button.
    expect(presented?.sound).toBe(adhanSoundFile(DEFAULT_ADHAN_VOICE, 'ios'));
    expect(screen.getByTestId('reminders-test-status')).toHaveTextContent(
      'Sent — it should be in your notifications now.',
      { exact: false }
    );
  });

  it('reports honestly when the platform refuses', async () => {
    adapter.config.failing = new Set<keyof NotificationAdapter>(['present']);
    await renderScreen();

    await press('reminders-test');
    await settle();

    expect(screen.getByTestId('reminders-test-status')).toHaveTextContent(
      'It could not be sent. Notifications are switched off for this app.',
      { exact: false }
    );
  });

  it('does not fire twice when the row is tapped twice in a frame', async () => {
    await renderScreen();

    // Both taps land in one frame, before React has re-rendered with the "sending" flag set.
    await act(async () => {
      fireEvent.press(screen.getByTestId('reminders-test'));
      fireEvent.press(screen.getByTestId('reminders-test'));
    });
    await settle();

    expect(adapter.calls.present).toBe(1);
  });

  it('offers a second test that always plays the adhan, whatever the prayers are set to', async () => {
    await renderScreen();
    // Every prayer is on the device sound by default; the adhan row must ignore that.

    await press('reminders-test-adhan');
    await settle();

    const presented = adapter.presented.get('test');
    expect(presented?.sound).toBe(adhanSoundFile(DEFAULT_ADHAN_VOICE, 'ios'));
    // The feedback renders under the row that was pressed, not the other one.
    expect(screen.getByTestId('reminders-test-status')).toHaveTextContent(
      'Sent — it should be in your notifications now.',
      { exact: false }
    );
  });
});

describe('the adhan selector', () => {
  it('is one line until asked, and that line says which recitation is in use', async () => {
    await renderScreen();

    // Nobody meets four options uninvited (CLAUDE.md): the resting state answers the only
    // question most people have of this row.
    expect(screen.getByText('Makkah')).toBeTruthy();
    expect(screen.queryByTestId('reminders-adhan-voice-options')).toBeNull();

    await press('reminders-adhan-voice');

    expect(screen.getByTestId('reminders-adhan-voice-options')).toBeTruthy();
    for (const voice of ADHAN_VOICES) {
      expect(screen.getByTestId(`reminders-adhan-voice-${voice}`)).toBeTruthy();
    }
  });

  it('marks the chosen one to a screen reader, not by colour', async () => {
    await renderScreen();
    await press('reminders-adhan-voice');

    const chosen = screen.getByTestId('reminders-adhan-voice-makkah');
    expect(chosen.props.accessibilityState).toMatchObject({ selected: true, checked: true });
    expect(chosen.props.accessibilityRole).toBe('radio');
    expect(
      screen.getByTestId('reminders-adhan-voice-menk').props.accessibilityState
    ).toMatchObject({ selected: false, checked: false });
  });

  it('chooses and plays in one press, and stops on the next', async () => {
    await renderScreen();
    await press('reminders-adhan-voice');
    expect(screen.queryByTestId('reminders-adhan-preview-status')).toBeNull();

    await press('reminders-adhan-voice-menk');
    await settle();

    // Chosen — the setting, not just the sound.
    expect(useSettingsStore.getState().adhanVoice).toBe('menk');
    // …and sounding, said in a word rather than by an icon alone.
    expect(screen.getByText('Playing Mufti Ismail Musa Menk — tap it again to stop.')).toBeTruthy();

    await press('reminders-adhan-voice-menk');
    await settle();

    expect(screen.queryByTestId('reminders-adhan-preview-status')).toBeNull();
    // Stopping is not un-choosing.
    expect(useSettingsStore.getState().adhanVoice).toBe('menk');
  });

  it('switches rather than stacking when a second recitation is pressed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require('expo-audio') as { __player: { replace: jest.Mock } };
    await renderScreen();
    await press('reminders-adhan-voice');

    await press('reminders-adhan-voice-alqatami');
    await settle();
    await press('reminders-adhan-voice-fakhry');
    await settle();

    expect(audio.__player.replace).toHaveBeenCalled();
    expect(useSettingsStore.getState().adhanVoice).toBe('fakhry');
    expect(screen.getByText('Playing Sabah Fakhri — tap it again to stop.')).toBeTruthy();
  });

  it('tells an iPhone user that Apple caps the sound, and tells nobody else', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderScreen();
    await press('reminders-adhan-voice');

    // Apple's limit, stated as a fact about the platform — no apology, and no jargon.
    expect(screen.getByTestId('reminders-adhan-voice-ios-note')).toBeTruthy();
    expect(
      screen.getByText(
        'On an iPhone a reminder plays about half a minute of the adhan and then fades. Apple limits how long a notification sound can be.'
      )
    ).toBeTruthy();
  });

  it('says nothing about the cap on Android, where there is none', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderScreen();
    await press('reminders-adhan-voice');

    expect(screen.queryByTestId('reminders-adhan-voice-ios-note')).toBeNull();
  });

  it('does not claim to prove reminders arrive', async () => {
    await renderScreen();

    expect(screen.getByText('Four recitations. Tap one to hear it.')).toBeTruthy();
    // The proof of delivery is the row below it, and stays a separate control.
    expect(screen.getByTestId('reminders-test')).toBeTruthy();
  });

  it('stops the recitation when the list is folded away', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require('expo-audio') as { __player: { pause: jest.Mock } };
    await renderScreen();
    await press('reminders-adhan-voice');
    await press('reminders-adhan-voice-makkah');
    await settle();
    audio.__player.pause.mockClear();

    await press('reminders-adhan-voice');

    // Folding the list away takes the stop control with it, so it must take the sound too.
    expect(audio.__player.pause).toHaveBeenCalled();
    expect(screen.queryByTestId('reminders-adhan-preview-status')).toBeNull();
  });

  it('stops the recitation when the screen goes away', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require('expo-audio') as { __player: { pause: jest.Mock } };
    await renderScreen();
    await press('reminders-adhan-voice');
    await press('reminders-adhan-voice-makkah');
    await settle();
    audio.__player.pause.mockClear();

    await act(async () => {
      screen.unmount();
    });

    expect(audio.__player.pause).toHaveBeenCalled();
  });
});

describe('when the phone will not make a sound', () => {
  it('says so, in the words of the thing we actually know', async () => {
    adapter.config.permission = {
      status: 'granted',
      granted: true,
      canAskAgain: true,
      delivery: { soundEnabled: false, alertsEnabled: true, interruptionFilter: null },
    };

    await renderScreen();
    await settle();

    expect(
      screen.getByText('Sound is switched off for this app, so reminders will arrive silently.')
    ).toBeTruthy();
  });

  it('says nothing when the OS has told us nothing — no guess about the ringer', async () => {
    await renderScreen();
    await settle();

    expect(screen.queryByTestId('reminders-test-delivery')).toBeNull();
    expect(screen.queryByTestId('reminders-test-ringer-hint')).toBeNull();
  });

  it('points at the ringer only after a test was sent and nothing else explains it', async () => {
    await renderScreen();
    await press('reminders-test');
    await settle();

    expect(
      screen.getByText('Heard nothing? Check your ringer and Focus — the app cannot see either.')
    ).toBeTruthy();
  });
});

describe('permission', () => {
  it('stays out of the way while notifications are allowed', async () => {
    await renderScreen();
    expect(screen.queryByTestId('reminders-permission')).toBeNull();
  });

  it('explains a refusal once, and keeps the rest of the screen usable', async () => {
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: true };
    await renderScreen();

    expect(screen.getByTestId('reminders-permission')).toBeTruthy();
    expect(screen.getByText('Notifications are switched off')).toBeTruthy();
    // One button, and one only.
    expect(screen.getByTestId('reminders-permission-action')).toBeTruthy();
    expect(screen.getByText('Allow notifications')).toBeTruthy();

    // The whole configuration is still there and still writable.
    await open('isha');
    await press('reminders-isha-nudge');
    expect(reminders().isha.nudgeEnabled).toBe(false);
  });

  it('asks the OS exactly once however fast the button is tapped', async () => {
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: true };
    adapter.config.permissionAfterRequest = { status: 'granted', granted: true, canAskAgain: true };
    const sync = jest.spyOn(service, 'sync');
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('reminders-permission-action'));
      fireEvent.press(screen.getByTestId('reminders-permission-action'));
    });
    await settle();

    expect(adapter.calls.requestPermission).toBe(1);
    // A grant retires the card and reconciles the OS straight away, rather than leaving the user
    // with nothing scheduled until the next time the app comes to the foreground.
    expect(screen.queryByTestId('reminders-permission')).toBeNull();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('sends a permanently refused user to the system settings instead of asking again', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: false };
    await renderScreen();

    expect(screen.getByText('Open device settings')).toBeTruthy();
    await press('reminders-permission-action');

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(adapter.calls.requestPermission).toBe(0);
  });
});

describe('pause what is playing (D96)', () => {
  it('offers it on Android builds that can act on it, and writes the setting when tapped', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockAudioPauseSupported = true;
    await renderScreen();

    await press('reminders-pause-audio-switch');

    expect(useSettingsStore.getState().pauseAudioEnabled).toBe(true);
  });

  it('is absent on iOS, where a dead app cannot touch other audio', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockAudioPauseSupported = true;
    await renderScreen();

    expect(screen.queryByTestId('reminders-pause-audio-switch')).toBeNull();
  });

  it('is absent on a build without the native module — a switch that switched nothing', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockAudioPauseSupported = false;
    await renderScreen();

    expect(screen.queryByTestId('reminders-pause-audio-switch')).toBeNull();
  });
});

describe('the always-on notification', () => {
  // PRODUCT_SPEC §12 puts this on the Reminders screen, and it is Android's alone (D27; iOS gets
  // a Live Activity after v1). The owner could not tell what it was going to do, so the copy now
  // names the thing it puts on screen — and the switch lives where reminders are configured
  // rather than on the diagnostics screen.
  it('offers it on Android, saying what appears and that it stays put', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderScreen();

    const row = screen.getByTestId('reminders-ongoing-switch');
    expect(screen.getByText('Always show the next prayer')).toBeTruthy();
    expect(
      screen.getByText(
        'Puts one silent notification in your notification shade: the prayer whose time is in, or the next one and its time. It never makes a sound, and it stays there instead of being swiped away.'
      )
    ).toBeTruthy();
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('writes the setting when tapped', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderScreen();

    await press('reminders-ongoing-switch');

    expect(useSettingsStore.getState().persistentNotificationEnabled).toBe(true);
  });

  it('is absent on iOS, where nothing can present it', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderScreen();

    expect(screen.queryByTestId('reminders-ongoing-group')).toBeNull();
    expect(screen.queryByTestId('reminders-ongoing-switch')).toBeNull();
  });
});

describe('rescheduling', () => {
  it('reaches the notification service, and coalesces a burst of changes into one sync', async () => {
    const sync = jest.spyOn(service, 'sync');
    await renderScreen();
    await open('fajr');
    await open('dhuhr');
    await open('asr');

    // The real controller from the root layout, pointed at the fake platform. The cold-start
    // wait is off (`startupDelayMs: 0`): what is under test is the debounce, not the launch.
    const stop = startNotificationSync({
      service,
      debounceMs: 60,
      navigate: null,
      startupDelayMs: 0,
    });
    await settle(120);
    const baseline = sync.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);

    // Three settings on three different prayers, as fast as a user could possibly tap them.
    await act(async () => {
      fireEvent.press(screen.getByTestId('reminders-fajr-adhan'));
      fireEvent.press(screen.getByTestId('reminders-dhuhr-nudge'));
      fireEvent.press(screen.getByTestId('reminders-asr-sound-option-silent'));
    });
    expect(reminders().fajr.adhanEnabled).toBe(false);
    expect(reminders().dhuhr.nudgeEnabled).toBe(false);
    expect(reminders().asr.sound).toBe('silent');

    await settle(120);

    // One reschedule for the burst — the schedule is current, and the service was not spammed.
    expect(sync.mock.calls.length).toBe(baseline + 1);
    stop();
  });
});
