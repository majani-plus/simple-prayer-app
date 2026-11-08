/**
 * Screen test for the Today tab (`src/app/(tabs)/index.tsx`).
 *
 * The screen is a composition, so what is tested here is the composition itself — the things no
 * component test can see:
 *
 * 1. the five prayers of the CURRENT prayer day are rendered, in order, from real computed times;
 * 2. only one seal can be open at a time;
 * 3. a pick reaches `trackingStore.toggleStatus` with the prayer day the screen decided on;
 * 4. with no location the hero is replaced by the one call to action that may prompt.
 *
 * The tracking store is mocked (it would open SQLite through `expo-sqlite`), and so is MMKV, which
 * the settings singleton hydrates from at import time. Everything else — the domain engine, the
 * settings store, the seal, the row, i18n — is the real thing.
 *
 * The test clock is derived from the *computed* times rather than hardcoded, so the file is
 * independent of the machine's timezone: "one hour after Isha" is an absolute instant wherever the
 * runner happens to live.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Dimensions, Linking, StyleSheet, type ViewStyle } from 'react-native';

import TodayScreen from '../app/(tabs)/index';
import { addDays } from '../domain/dates';
import { computeDayTimes, getCurrentPrayerDay, getPrayerWindows } from '../domain/prayerTimes';
import { computeStats } from '../domain/stats';
import { unloggedDayRecord } from '../domain/streaks';
import { PRAYERS, type DayRecord, type ExemptPeriod } from '../domain/types';
import { initI18n } from '../i18n';
import { useLocationStore } from '../stores/locationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { paperLight } from '../theme';
import * as formatTimeModule from '../utils/formatTime';

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
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success' },
}));

// The safe-area provider is installed by expo-router, which this test does not mount.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

/**
 * `useIsFocused` wants a navigation container this test does not mount. Only the dashboard's qibla
 * dial asks — it gates the magnetometer on focus — so the answer is simply "yes, on screen".
 */
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  useIsFocused: () => true,
}));

const mockRecord: { current: DayRecord } = { current: unloggedDayRecord('1970-01-01') };
/** Stored exempt periods, for the banner/overflow surfaces. Empty unless a test opens one. */
const mockPeriods: { current: ExemptPeriod[] } = { current: [] };
const mockActions = {
  loadDay: jest.fn(),
  // The glance pane's own `useHistory` reads a month at a time (D124).
  loadRange: jest.fn(),
  toggleStatus: jest.fn(() => true),
  toggleSimpleStatus: jest.fn(() => true),
  setStatus: jest.fn(() => true),
  tickQada: jest.fn(() => true),
  setQadaDebts: jest.fn(),
  forgiveQada: jest.fn(() => true),
  undoForgive: jest.fn(() => true),
  markMadeUp: jest.fn(() => true),
  clearMadeUp: jest.fn(() => true),
  startExemptPeriod: jest.fn(() => mockPeriods.current),
  addExemptPeriod: jest.fn(() => true),
  endExemptPeriod: jest.fn(() => mockPeriods.current),
  onWriteFailed: jest.fn(() => () => undefined),
};

/** The store's day cache as the yesterday card reads it — filled per test. */
const mockDayRecords: { current: Record<string, DayRecord> } = { current: {} };
/** What `statsFor(7)` answers — the yesterday card's logger gate. Zero = a non-logger. */
const mockRecentStats = { current: { totalTracked: 0 } };

/** The qada card reads these; with nothing owed it renders nothing (PRODUCT_SPEC §7). */
const mockDebts = { current: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 } };

/**
 * The prayer day the store would resolve. Only the dashboard's glance pane asks (through its own
 * `useHistory`), and it must agree with the day this file's clock helpers are built from.
 */
const mockTodayDay = { current: '2025-07-11' };

/**
 * The summaries the dashboard's record card reads. The yesterday card's own gate is
 * `mockRecentStats`; these are the *window* and *lifetime* shapes `StatCards` renders, and they
 * have to be real summaries rather than stubs, because that card does date arithmetic on them.
 */
const mockStreak = {
  current: {
    mode: 'soft' as const,
    current: 4,
    best: 9,
    currentStartedOn: '2025-07-08',
    bestStartedOn: '2025-06-01',
  },
};
const mockWindowStats: { current: unknown } = { current: null };
const mockLifetimeStats: { current: unknown } = { current: null };

jest.mock('../stores/trackingStore', () => ({
  useTrackingHydrated: () => true,
  useDayRecord: () => mockRecord.current,
  useTrackingActions: () => mockActions,
  useQadaDebts: () => mockDebts.current,
  useExemptPeriods: () => mockPeriods.current,
  useTrackingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      revision: 0,
      dayRecords: mockDayRecords.current,
      todayDay: () => mockTodayDay.current,
      // The yesterday card asks for a 7-day window and only reads `totalTracked`; the dashboard's
      // record card asks for both windows and renders them, so each gets the shape it needs.
      statsFor: (windowDays: number | null) =>
        windowDays === null
          ? (mockLifetimeStats.current ?? mockRecentStats.current)
          : (mockWindowStats.current ?? mockRecentStats.current),
      streakSummary: () => mockStreak.current,
      qadaProgress: () => ({
        debts: mockDebts.current,
        total: 0,
        paidInWindow: 0,
        perDay: 0,
        projectedClearDay: null,
      }),
      undoableForgive: () => null,
      qadaShownDebts: () => mockDebts.current,
      qadaDerivedMisses: () => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }),
    }),
}));

configure({ defaultIncludeHiddenElements: true });

/** Accra: low latitude (no polar-night edge cases) and a place the auto method resolves for. */
const LOCATION = {
  latitude: 5.6037,
  longitude: -0.187,
  label: 'Accra',
  countryCode: 'GH',
  source: 'auto' as const,
  resolvedAt: 0,
};

const DAY = '2025-07-11';

/** The windows of `DAY`, computed with the app's own defaults — the test's ground truth. */
function windowsForDay() {
  return getPrayerWindows(DAY, LOCATION, useSettingsStore.getState().calculation);
}

/** An instant at which every prayer of `DAY` has started (so every seal is loggable). */
function afterIsha(): Date {
  const isha = windowsForDay()[4];
  return new Date(isha.start.getTime() + 60 * 60 * 1000);
}

/** An instant inside Asr's window: Maghrib is next and still locked, Fajr…Asr are loggable. */
function duringAsr(): Date {
  const asr = windowsForDay()[2];
  return new Date(asr.start.getTime() + 30 * 60 * 1000);
}

/**
 * "00:30 on the morning of `DAY` itself" — past midnight, but still inside the prayer day that
 * began at the PREVIOUS date's Fajr. `DAY` is a Friday, so this instant's calendar date is Friday
 * while its prayer day is Thursday: the exact case where naming Dhuhr from the wall clock would
 * put Jumu'ah on a Thursday (D75).
 */
function beforeFajrOnDay(): Date {
  const fajr = windowsForDay()[0].start;
  return new Date(fajr.getTime() - 30 * 60 * 1000);
}

/**
 * "00:30, Isha still unlogged": half an hour before the NEXT calendar date's Fajr, i.e. past
 * midnight but inside the prayer day that began at `DAY`'s Fajr (PRODUCT_SPEC §3).
 *
 * Derived from the engine rather than written as a wall-clock time, so it stays past midnight
 * and before Fajr wherever the test runner's timezone happens to be.
 */
function afterMidnight(): Date {
  const nextFajr = getPrayerWindows(
    addDays(DAY, 1),
    LOCATION,
    useSettingsStore.getState().calculation
  )[0].start;
  return new Date(nextFajr.getTime() - 30 * 60 * 1000);
}

async function renderScreen(now: Date) {
  jest.setSystemTime(now);
  const view = await render(<TodayScreen />);
  // Let the seal's reduce-motion probe and the open/close animations settle.
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  return view;
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  useSettingsStore.getState().setLocation(LOCATION);
  useSettingsStore.getState().setTimeFormat('12h');
  useSettingsStore.getState().setExemptionModeEnabled(false);
  useSettingsStore.getState().endTravel();
  useLocationStore.setState({ status: 'ready', error: null, canAskAgain: true });
  mockRecord.current = unloggedDayRecord(DAY);
  mockDebts.current = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
  mockPeriods.current = [];
  mockDayRecords.current = {};
  mockRecentStats.current = { totalTracked: 0 };
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * Whether a seal's pill is open. A seal builds its three options only on its first open, so a
 * pill that has never opened is absent from the tree, and one that has closed again is hidden —
 * both mean "not open".
 */
function pillOpen(prayer: string): boolean {
  const options = screen.queryByTestId(`seal-${prayer}-options`, { includeHiddenElements: true });
  return options !== null && options.props.accessibilityElementsHidden === false;
}

describe('Today screen', () => {
  it('renders a row for each of the five prayers of the current prayer day', async () => {
    await renderScreen(afterIsha());

    for (const prayer of PRAYERS) {
      expect(screen.getByTestId(`prayer-row-${prayer}`)).toBeTruthy();
    }
    expect(within(screen.getByTestId('prayer-row-fajr')).getByText('Fajr')).toBeTruthy();
    expect(within(screen.getByTestId('prayer-row-isha')).getByText('العشاء')).toBeTruthy();
    // The footer is the app's only visible seal tutorial: it teaches both gestures.
    expect(screen.getByText('tap the seal when you pray · tap again to undo')).toBeTruthy();
  });

  it('marks sunrise between the Fajr and Dhuhr rows, and nowhere else', async () => {
    // Sunrise closes Fajr's window and opens the morning, so it sits exactly where it falls in a
    // chronological list. It is a hairline, not a sixth prayer: the list still holds five rows,
    // and the marker sits between the first and the second.
    await renderScreen(afterIsha());

    const list = within(screen.getByTestId('prayer-rows'));
    const ids = list
      .getAllByTestId(/^(prayer-row-|sunrise-marker$)/)
      .map((node) => node.props.testID as string);
    expect(list.getAllByTestId(/^prayer-row-/)).toHaveLength(PRAYERS.length);
    expect(ids).toEqual([
      'prayer-row-fajr',
      'sunrise-marker',
      'prayer-row-dhuhr',
      'prayer-row-asr',
      'prayer-row-maghrib',
      'prayer-row-isha',
    ]);

    const sunrise = computeDayTimes(DAY, LOCATION, useSettingsStore.getState().calculation).times
      .sunrise;
    const marker = within(screen.getByTestId('sunrise-marker'));
    expect(marker.getByText('Sunrise')).toBeTruthy();
    expect(
      marker.getByText(formatTimeModule.formatTime(sunrise, { timeFormat: '12h' }))
    ).toBeTruthy();
    // No seal, so nothing about it can be logged or mistaken for a prayer.
    expect(screen.queryByTestId('seal-sunrise-face')).toBeNull();
  });

  it('leaves the qada card off the screen when nothing is owed', async () => {
    await renderScreen(afterIsha());
    // A "0 left to make up" card would be a daily reminder of a debt that no longer exists (§7).
    expect(screen.queryByTestId('qada-card')).toBeNull();
  });

  it('shows the qada card with the total once something is owed', async () => {
    mockDebts.current = { fajr: 12, dhuhr: 3, asr: 0, maghrib: 0, isha: 0 };
    await renderScreen(afterIsha());

    expect(screen.getByTestId('qada-card')).toBeTruthy();
    expect(screen.getByTestId('qada-card-total').props.children).toBe('15');
    // …and it has not displaced anything: the rows and the footer are still where they were.
    expect(screen.getByTestId('prayer-rows')).toBeTruthy();
    expect(screen.getByTestId('today-footer')).toBeTruthy();
  });

  it('opens exactly one seal at a time', async () => {
    await renderScreen(afterIsha());


    expect(PRAYERS.some((prayer) => pillOpen(prayer))).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-face'));
    });
    expect(PRAYERS.filter((prayer) => pillOpen(prayer))).toEqual(['dhuhr']);

    // Opening another seal must close the first — the screen owns "only one".
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-asr-face'));
    });
    expect(PRAYERS.filter((prayer) => pillOpen(prayer))).toEqual(['asr']);

    // Tapping the open pill anywhere but on an option closes it without changing anything.
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-asr-dismiss'));
    });
    expect(PRAYERS.some((prayer) => pillOpen(prayer))).toBe(false);
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
  });

  it('closes the open pill when a touch starts anywhere outside it, logging nothing', async () => {
    // "I opened the choices and decided not to change it": a tap on the surrounding paper must
    // dismiss the pill — and must not claim the touch, so whatever it was aimed at still happens.
    await renderScreen(afterIsha());


    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-face'));
    });
    expect(pillOpen('dhuhr')).toBe(true);

    // "The touch is never claimed" (so it still scrolls / opens what it hit) is pinned by
    // SealDismiss.test; this exercises the wiring: outside touch → closed, nothing logged.
    await act(async () => {
      fireEvent(screen.getByTestId('today-seal-dismiss'), 'startShouldSetResponderCapture', {
        nativeEvent: { pageX: 30, pageY: 600 },
      });
    });
    expect(PRAYERS.some((prayer) => pillOpen(prayer))).toBe(false);
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();

    // A second stray touch while nothing is open stays a no-op — it must never re-toggle.
    await act(async () => {
      fireEvent(screen.getByTestId('today-seal-dismiss'), 'startShouldSetResponderCapture', {
        nativeEvent: { pageX: 30, pageY: 600 },
      });
    });
    expect(PRAYERS.some((prayer) => pillOpen(prayer))).toBe(false);
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
  });

  it('sends a pick to the tracking store for the current prayer day, and closes the seal', async () => {
    // A PAST row: at this hour Isha is the current prayer and its seal is direct-pick, so the
    // pill flow is exercised on Dhuhr, whose window has closed.
    const now = afterIsha();
    await renderScreen(now);
    const expectedDay = getCurrentPrayerDay(now, LOCATION, useSettingsStore.getState().calculation);

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-face'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-option-prayed'));
    });

    expect(mockActions.toggleStatus).toHaveBeenCalledWith(expectedDay, 'dhuhr', 'prayed');
    expect(pillOpen('dhuhr')).toBe(false);
  });

  describe('the currently-due prayer (spec-today-interaction)', () => {
    const rowStyle = (prayer: string): ViewStyle =>
      StyleSheet.flatten(screen.getByTestId(`prayer-row-${prayer}`).props.style) as ViewStyle;

    it('emphasises the row whose window is open — never the next prayer', async () => {
      // The owner's live defect: at 18:38 in Cairo the app emphasised Maghrib (next) while Asr's
      // window was open. The bright register belongs to the current prayer; the hero is the
      // "next" instrument.
      await renderScreen(duringAsr());

      expect(rowStyle('asr')).toMatchObject({ backgroundColor: paperLight.cardBright });
      expect(rowStyle('maghrib')).toMatchObject({ backgroundColor: paperLight.cardQuiet });
      // Exactly one row is ever loud.
      const loud = PRAYERS.filter(
        (prayer) => rowStyle(prayer).backgroundColor === paperLight.cardBright
      );
      expect(loud).toEqual(['asr']);
      // …and it names its deadline: Asr's window ends when Maghrib begins.
      const deadline = formatTimeModule.formatTime(windowsForDay()[2].end, { timeFormat: '12h' });
      expect(
        within(screen.getByTestId('prayer-row-asr')).getByText(`now · until ${deadline}`)
      ).toBeTruthy();
    });

    it('logs the current prayer prayed with a single tap, with the confirming haptic — no pill', async () => {
      const now = duringAsr();
      await renderScreen(now);
      const expectedDay = getCurrentPrayerDay(
        now,
        LOCATION,
        useSettingsStore.getState().calculation
      );

      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-asr-face'));
      });

      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expectedDay, 'asr', 'prayed');
      // One crisp click (D197) — not the two-pulse Success the owner found mushy.
      expect(Haptics.impactAsync).toHaveBeenCalledWith('rigid');
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
      // No pill ever opened — the tap was the whole interaction.
      expect(pillOpen('asr')).toBe(false);
    });

    it('records LATE when a one-tap lands after the window shut — the tap that raced sunrise', async () => {
      // The wordless tap means "done, now". Fajr's window closes at sunrise, which is a hard
      // edge people log against: the screen is open at 06:13 with the tap offered, sunrise
      // passes at 06:14, the finger lands at 06:15. What actually happened is a late Fajr, and
      // that is what gets written (D71). The clock moves without the rollover timer running,
      // which is exactly the render the race produces.
      const sunriseAt = computeDayTimes(DAY, LOCATION, useSettingsStore.getState().calculation)
        .times.sunrise;
      const now = new Date(sunriseAt.getTime() - 60 * 1000);
      await renderScreen(now);
      const expectedDay = getCurrentPrayerDay(
        now,
        LOCATION,
        useSettingsStore.getState().calculation
      );

      // Fajr is still current here — the one-tap is on offer.
      expect(rowStyle('fajr').backgroundColor).toBe(paperLight.cardBright);

      jest.setSystemTime(new Date(sunriseAt.getTime() + 60 * 1000));
      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-fajr-face'));
      });

      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expectedDay, 'fajr', 'late');
    });

    it('records PRAYED for the same tap a minute earlier — inside the window', async () => {
      const sunriseAt = computeDayTimes(DAY, LOCATION, useSettingsStore.getState().calculation)
        .times.sunrise;
      await renderScreen(new Date(sunriseAt.getTime() - 60 * 1000));

      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-fajr-face'));
      });

      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expect.any(String), 'fajr', 'prayed');
    });

    it('never rewrites a deliberate pick: "Prayed" on a closed window stays prayed', async () => {
      // The pill offers ✓ Prayed and 🕐 Late in words. Someone who prayed Fajr at dawn and only
      // opened the app at nine must be able to say so — and rewriting the pick would leave the
      // pill's own Late option with nothing to do (D71).
      const sunriseAt = computeDayTimes(DAY, LOCATION, useSettingsStore.getState().calculation)
        .times.sunrise;
      await renderScreen(new Date(sunriseAt.getTime() + 3 * 60 * 60 * 1000));

      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-fajr-face'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-fajr-option-prayed'));
      });

      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expect.any(String), 'fajr', 'prayed');
    });

    it('undoes the mark with a second tap while the window is still open', async () => {
      // `toggleStatus` implements set-and-clear: the same call clears a stored `prayed`.
      mockRecord.current = {
        ...unloggedDayRecord(DAY),
        statuses: { ...unloggedDayRecord(DAY).statuses, asr: 'prayed' },
      };
      const now = duringAsr();
      await renderScreen(now);
      const expectedDay = getCurrentPrayerDay(
        now,
        LOCATION,
        useSettingsStore.getState().calculation
      );

      // Logged, the row KEEPS the primary register (owner amendment: the weight says which
      // window you are in; the gold seal says it is no longer owed)…
      expect(rowStyle('asr')).toMatchObject({ backgroundColor: paperLight.cardBright });

      // …and the face still answers the symmetric undo, without opening a pill.
      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-asr-face'));
      });
      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expectedDay, 'asr', 'prayed');
      expect(pillOpen('asr')).toBe(false);
      // The undo is felt, but lighter: a tick, not the click the mark got (D193, D197).
      expect(Haptics.selectionAsync).toHaveBeenCalled();
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    });

    it('still UNDOES when the second tap races the window shutting — it never becomes "late"', async () => {
      // The mirror of the "records LATE" case above, and the one it must not swallow. The tap
      // that MARKS a prayer means "done, now", so past the deadline it honestly records `late`.
      // The tap that UNDOES a mark means "I did not pray this after all" — there is no instant
      // at which that becomes a claim about lateness. Rewriting it to `late` sends
      // `toggleStatus(day, prayer, 'late')` against a stored `prayed`, which does not match, so
      // instead of clearing the log the store SETS it to late: the undo is silently swallowed
      // and the user is left with a mark they were trying to remove — and one they can no longer
      // remove with the same gesture, because a `late` row is no longer direct-pick.
      mockRecord.current = {
        ...unloggedDayRecord(DAY),
        statuses: { ...unloggedDayRecord(DAY).statuses, asr: 'prayed' },
      };
      const now = duringAsr();
      await renderScreen(now);
      const expectedDay = getCurrentPrayerDay(
        now,
        LOCATION,
        useSettingsStore.getState().calculation
      );

      // The clock crosses Asr's window end without the rollover timer running — the same render
      // the "records LATE" case above produces, so the seal is still offering the direct tap.
      jest.setSystemTime(new Date(windowsForDay()[2].end.getTime() + 60 * 1000));
      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-asr-face'));
      });

      // `toggleStatus` clears only when the status it is handed matches the stored one.
      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expectedDay, 'asr', 'prayed');
    });

    it('gives an exempt day no current row at all', async () => {
      mockRecord.current = {
        ...unloggedDayRecord(DAY),
        statuses: {
          fajr: 'exempt',
          dhuhr: 'exempt',
          asr: 'exempt',
          maghrib: 'exempt',
          isha: 'exempt',
        },
        isExempt: true,
      };
      await renderScreen(duringAsr());

      // Nothing is due on an exempt day: every row quiet, nothing emphasised.
      for (const prayer of PRAYERS) {
        expect(rowStyle(prayer).backgroundColor).toBe(paperLight.cardQuiet);
      }
      // …no NEXT tier either, and the hero is chip-less PLAIN — it never claims "prayed".
      expect(screen.queryByText('next ·')).toBeNull();
      expect(screen.queryByTestId('countdown-hero-mode-due')).toBeNull();
      expect(screen.queryByTestId('countdown-hero-mode-waiting')).toBeNull();
    });
  });

  describe('the hero’s framing and the NEXT tier (owner amendment)', () => {
    const rowStyle = (prayer: string): ViewStyle =>
      StyleSheet.flatten(screen.getByTestId(`prayer-row-${prayer}`).props.style) as ViewStyle;
    /** Asr's deadline and Maghrib's start are the SAME instant — one countdown target. */
    const sharedInstant = () =>
      formatTimeModule.formatTime(windowsForDay()[3].start, { timeFormat: '12h' });

    it('speaks DUE while the current prayer is unlogged, and holds the next-row cue back', async () => {
      await renderScreen(duringAsr());

      // The hero names the CURRENT prayer and renders the instant as a deadline.
      expect(screen.getByTestId('countdown-hero-mode-due')).toBeTruthy();
      const hero = within(screen.getByTestId('countdown-hero'));
      expect(hero.getByText('Asr')).toBeTruthy();
      expect(hero.getByText(`until ${sharedInstant()}`)).toBeTruthy();
      // The pill is present in DUE too (a pill that comes and goes is jitter — owner), bound to
      // the NEXT prayer: the one whose arrival ends the countdown, not the one already due.
      expect(screen.getByLabelText('Reminder for Maghrib')).toBeTruthy();
      // Exactly one emphasised row before the log lands: no "next" cue anywhere.
      expect(screen.queryByText('next ·')).toBeNull();
    });

    it('flips to WAITING with the next-row cue once the current prayer is logged — same instant, reframed', async () => {
      mockRecord.current = {
        ...unloggedDayRecord(DAY),
        statuses: { ...unloggedDayRecord(DAY).statuses, asr: 'prayed' },
      };
      await renderScreen(duringAsr());

      // The hero names the NEXT prayer, at the very timestamp DUE called the deadline.
      // WAITING carries no glyph since 2026-08-21 — the clock belongs to "left to pray".
      expect(screen.queryByTestId('countdown-hero-mode-waiting')).toBeNull();
      const hero = within(screen.getByTestId('countdown-hero'));
      expect(hero.getByText('Maghrib')).toBeTruthy();
      expect(hero.getByText(sharedInstant())).toBeTruthy();
      // "prayed" carries its subject — a bare "prayed" under "Maghrib" reads as Maghrib prayed.
      expect(hero.getByText(/^Asr prayed · next in /)).toBeTruthy();
      // The reminder pill returns the moment the log lands — attached to the next prayer.
      expect(screen.getByLabelText('Reminder for Maghrib')).toBeTruthy();

      // The NEXT tier arrived on Maghrib's row: the word, the ring, the countdown…
      const maghribRow = within(screen.getByTestId('prayer-row-maghrib'));
      expect(maghribRow.getByText('next ·')).toBeTruthy();
      expect(screen.getByTestId('prayer-row-maghrib-next-up-ring')).toBeTruthy();
      // …while staying unmistakably subordinate: quiet card against Asr's bright one, which
      // keeps the primary register even though it is logged.
      expect(rowStyle('maghrib').backgroundColor).toBe(paperLight.cardQuiet);
      expect(rowStyle('asr').backgroundColor).toBe(paperLight.cardBright);
    });

    it('waits on tomorrow’s Fajr after a logged Isha — no cue on any row of this day', async () => {
      mockRecord.current = {
        ...unloggedDayRecord(DAY),
        statuses: { ...unloggedDayRecord(DAY).statuses, isha: 'prayed' },
      };
      await renderScreen(afterMidnight());

      // "Next" is tomorrow's Fajr, which is not in today's list: the hero carries the whole
      // WAITING answer, Isha's row keeps the current emphasis, and no row gets the cue.
      // WAITING carries no glyph since 2026-08-21 — the clock belongs to "left to pray".
      expect(screen.queryByTestId('countdown-hero-mode-waiting')).toBeNull();
      expect(within(screen.getByTestId('countdown-hero')).getByText('Fajr')).toBeTruthy();
      expect(rowStyle('isha').backgroundColor).toBe(paperLight.cardBright);
      expect(screen.queryByText('next ·')).toBeNull();
    });

    it('falls back to chip-less PLAIN after sunrise, with NO row loud — Fajr’s window has shut', async () => {
      // Fajr's window ends at sunrise (`domain/windows.ts`), so from sunrise until Dhuhr nothing
      // is due: no row holds the primary register, the hero drops to PLAIN (DUE's "left to pray"
      // would overstate the time, WAITING would claim a prayer that was never logged), and Fajr's
      // row reads as any unlogged past prayer does.
      const sunrise = computeDayTimes(DAY, LOCATION, useSettingsStore.getState().calculation).times
        .sunrise;
      await renderScreen(new Date(sunrise.getTime() + 30 * 60 * 1000));

      expect(screen.queryByTestId('countdown-hero-mode-due')).toBeNull();
      expect(screen.queryByTestId('countdown-hero-mode-waiting')).toBeNull();
      // `DAY` is a Friday, so the midday prayer names itself as the pair (D75).
      expect(
        within(screen.getByTestId('countdown-hero')).getByText('Jumu’ah · Dhuhr')
      ).toBeTruthy();
      expect(rowStyle('fajr').backgroundColor).toBe(paperLight.cardQuiet);
      expect(within(screen.getByTestId('prayer-row-fajr')).getByText('not marked')).toBeTruthy();
      // Nothing anywhere claims to be happening now.
      expect(screen.queryByText('now')).toBeNull();
      // The morning still points somewhere: Dhuhr carries the subtle NEXT cue, not the loud one.
      expect(within(screen.getByTestId('prayer-row-dhuhr')).getByText('next ·')).toBeTruthy();
      expect(rowStyle('dhuhr').backgroundColor).toBe(paperLight.cardQuiet);
    });

    it('offers the deliberate pill on Fajr after sunrise, never the one-tap seal', async () => {
      // The one-tap "done" is an assertion about NOW, and it is only ever offered while the
      // window is open. After sunrise the row falls back to the three-option pill, where the user
      // says in words whether Fajr was prayed on time or late (D71).
      const sunrise = computeDayTimes(DAY, LOCATION, useSettingsStore.getState().calculation).times
        .sunrise;
      await renderScreen(new Date(sunrise.getTime() + 30 * 60 * 1000));

      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-fajr-face'));
      });
      expect(screen.getByTestId('seal-fajr-option-prayed')).toBeTruthy();
      expect(screen.getByTestId('seal-fajr-option-late')).toBeTruthy();
      expect(screen.getByTestId('seal-fajr-option-missed')).toBeTruthy();
    });
  });

  it('locks the seal of a prayer whose time has not arrived', async () => {
    await renderScreen(duringAsr());

    // Maghrib is next: emphasised, counted down to — and not yet loggable.
    expect(screen.getByTestId('seal-maghrib-face').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('seal-asr-face').props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-maghrib-face'));
    });
    expect(pillOpen('maghrib')).toBe(false);
  });

  it('unlocks a prayer by itself when its time arrives — and hands it the emphasis and the direct tap', async () => {
    const now = duringAsr();
    await renderScreen(now);
    expect(screen.getByTestId('seal-maghrib-face').props.accessibilityState.disabled).toBe(true);

    // No interaction, no refresh: the screen's own rollover timer crosses the boundary.
    const maghrib = windowsForDay()[3];
    await act(async () => {
      jest.advanceTimersByTime(maghrib.start.getTime() - now.getTime() + 2000);
    });

    expect(screen.getByTestId('seal-maghrib-face').props.accessibilityState.disabled).toBe(false);
    // …and the hero speaks the new DUE state: Maghrib, unlogged, is the current prayer now.
    expect(screen.getByTestId('countdown-hero-mode-due')).toBeTruthy();
    expect(within(screen.getByTestId('countdown-hero')).getByText('Maghrib')).toBeTruthy();

    // The same tick moved the CURRENT register: Maghrib is the loud row now, Asr has gone quiet…
    const flat = (prayer: string) =>
      StyleSheet.flatten(screen.getByTestId(`prayer-row-${prayer}`).props.style) as ViewStyle;
    expect(flat('maghrib').backgroundColor).toBe(paperLight.cardBright);
    expect(flat('asr').backgroundColor).toBe(paperLight.cardQuiet);

    // …and its seal is direct-pick: one tap logs it, no pill.
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-maghrib-face'));
    });
    expect(mockActions.toggleStatus).toHaveBeenCalledWith(DAY, 'maghrib', 'prayed');
    expect(pillOpen('maghrib')).toBe(false);
  });

  it('switches to the new day by itself when Fajr arrives, on a screen left open overnight', async () => {
    // Owner, 2026-11-07: "if I'm looking at the prayer screen, once Fajr hits, the screen should
    // transition to the next day". 30 minutes before Fajr, then let the screen's own clock run.
    const now = afterMidnight();
    await renderScreen(now);
    expect(within(screen.getByTestId('today-header')).getByText(/July 11$/)).toBeTruthy();

    const nextFajr = getPrayerWindows(
      addDays(DAY, 1),
      LOCATION,
      useSettingsStore.getState().calculation
    )[0].start;
    await act(async () => {
      jest.advanceTimersByTime(nextFajr.getTime() - now.getTime() + 2000);
    });

    // The new prayer day: its date in the header, Fajr the current (due) prayer, loggable.
    expect(within(screen.getByTestId('today-header')).getByText(/July 12$/)).toBeTruthy();
    expect(screen.getByTestId('countdown-hero-mode-due')).toBeTruthy();
    expect(within(screen.getByTestId('countdown-hero')).getByText('Fajr')).toBeTruthy();
    expect(screen.getByTestId('seal-fajr-face').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId('seal-dhuhr-face').props.accessibilityState.disabled).toBe(true);
  });

  it('still shows yesterday’s prayer day after midnight, with Isha loggable', async () => {
    // 00:30. The calendar has rolled over; the prayer day has not (PRODUCT_SPEC §3).
    const now = afterMidnight();
    await renderScreen(now);

    expect(getCurrentPrayerDay(now, LOCATION, useSettingsStore.getState().calculation)).toBe(DAY);
    // The header still names the day the user is living in, not the date on their phone.
    expect(within(screen.getByTestId('today-header')).getByText(/July 11$/)).toBeTruthy();
    // Isha is unlogged and its window runs to next Fajr, so the hero is in DUE mode speaking
    // ISHA — never tomorrow's Fajr, and never a highlight on today's already-past Fajr row.
    expect(screen.getByTestId('countdown-hero-mode-due')).toBeTruthy();
    expect(within(screen.getByTestId('countdown-hero')).getByText('Isha')).toBeTruthy();
    expect(within(screen.getByTestId('prayer-row-fajr')).queryByText('next ·')).toBeNull();

    // Every prayer of the open day has started, so every seal — Isha's above all — is loggable.
    for (const prayer of PRAYERS) {
      expect(screen.getByTestId(`seal-${prayer}-face`).props.accessibilityState.disabled).toBe(
        false
      );
    }
    // The once-unexplained night state is now legible: Isha's window runs to next Fajr, so at
    // 00:30 Isha is the CURRENT prayer — emphasised, deadline named, one tap to log.
    expect(StyleSheet.flatten(screen.getByTestId('prayer-row-isha').props.style)).toMatchObject({
      backgroundColor: paperLight.cardBright,
    });
    const untilFajr = formatTimeModule.formatTime(windowsForDay()[4].end, { timeFormat: '12h' });
    expect(
      within(screen.getByTestId('prayer-row-isha')).getByText(`now · until ${untilFajr}`)
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-isha-face'));
    });

    // Filed under the day it belongs to — the previous calendar date — with no pill opened.
    expect(mockActions.toggleStatus).toHaveBeenCalledWith(DAY, 'isha', 'prayed');
    expect(pillOpen('isha')).toBe(false);
  });

  it('ticks the countdown without re-rendering the prayer rows', async () => {
    await renderScreen(duringAsr());

    // Every row and the hero call `formatTime` once per render; only `LiveCountdown` calls
    // `formatDuration` on a tick. Spying after the first render makes the two countable.
    const renderedTime = jest.spyOn(formatTimeModule, 'formatTime');
    const tickedDuration = jest.spyOn(formatTimeModule, 'formatDuration');

    // Three separate commits, so each second is really its own render pass.
    for (let second = 0; second < 3; second += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }

    // The clocks ran — the hero's countdown and the next row's caption, once a second each…
    expect(tickedDuration.mock.calls.length).toBeGreaterThanOrEqual(3);
    // …and nothing above those two text nodes re-rendered: every row and the hero would have
    // reformatted their time (DESIGN.md §Animation principles).
    expect(renderedTime).not.toHaveBeenCalled();

    renderedTime.mockRestore();
    tickedDuration.mockRestore();
  });

  it('re-reads the day when exemption mode is switched on', async () => {
    await renderScreen(afterIsha());
    const before = mockActions.loadDay.mock.calls.length;

    // The setting lives in the settings store, which cannot bump the tracking store's revision:
    // without an explicit re-read the rows would keep rendering the statuses they were logged
    // with — including `missed`, which an exempt day must never show (PRODUCT_SPEC §6).
    await act(async () => {
      useSettingsStore.getState().setExemptionModeEnabled(true);
    });

    expect(mockActions.loadDay.mock.calls.length).toBeGreaterThan(before);
    expect(mockActions.loadDay).toHaveBeenLastCalledWith(DAY);
  });

  it('renders the exempt state without asking for anything', async () => {
    mockRecord.current = {
      ...unloggedDayRecord(DAY),
      statuses: {
        fajr: 'exempt',
        dhuhr: 'exempt',
        asr: 'exempt',
        maghrib: 'exempt',
        isha: 'exempt',
      },
      isExempt: true,
    };
    await renderScreen(afterIsha());

    expect(screen.getAllByText('not required')).toHaveLength(5);
    expect(screen.getByTestId('today-footer').props.children).toBe(
      'These days are exempt — nothing to mark.'
    );
  });

  it('replaces the hero with one call to action when there is no location', async () => {
    useSettingsStore.getState().setLocation(null);
    useLocationStore.setState({ status: 'idle' });
    const requestAndResolve = jest.fn(() => Promise.resolve(null));
    useLocationStore.setState({ requestAndResolve });

    await renderScreen(afterIsha());

    expect(screen.getByText('Prayer times need a location')).toBeTruthy();
    expect(screen.queryByTestId('countdown-hero')).toBeNull();
    expect(screen.queryByTestId('prayer-rows')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('location-prompt-action'));
    });
    expect(requestAndResolve).toHaveBeenCalledTimes(1);
  });

  it('never asks the OS for anything without a tap', async () => {
    // The worst case for an accidental prompt: no location at all, so the card is on screen.
    useSettingsStore.getState().setLocation(null);
    const requestAndResolve = jest.fn(() => Promise.resolve(null));
    const refresh = jest.fn(() => Promise.resolve(null));
    useLocationStore.setState({ status: 'idle', requestAndResolve, refresh });

    await renderScreen(afterIsha());
    // Mounting, settling, foregrounding and a minute of timers: still nothing.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(requestAndResolve).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('location-prompt-action'));
    });
    expect(requestAndResolve).toHaveBeenCalledTimes(1);
  });

  it('points a blocked permission at the system settings instead of prompting again', async () => {
    useSettingsStore.getState().setLocation(null);
    const requestAndResolve = jest.fn(() => Promise.resolve(null));
    useLocationStore.setState({
      status: 'denied',
      canAskAgain: false,
      error: 'permissionDenied',
      requestAndResolve,
    });

    await renderScreen(afterIsha());

    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

    expect(screen.getByText('Location is off')).toBeTruthy();
    expect(screen.getByText('Open settings')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('location-prompt-action'));
    });
    expect(requestAndResolve).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
});

describe('the yesterday card (owner request, 2026-08-24)', () => {
  /** The prayer day before `DAY` — what the card is about when the clock sits inside `DAY`. */
  const YESTERDAY = addDays(DAY, -1);

  function cacheYesterday(statuses: Partial<DayRecord['statuses']>): void {
    const base = unloggedDayRecord(YESTERDAY);
    mockDayRecords.current = {
      [YESTERDAY]: { ...base, statuses: { ...base.statuses, ...statuses } },
    };
  }

  /** The gate's "this person logs" answer. */
  function actAsLogger(): void {
    mockRecentStats.current = { totalTracked: 3 };
  }

  it('reads yesterday through the store once when the cache is empty', async () => {
    await renderScreen(duringAsr());
    expect(mockActions.loadDay).toHaveBeenCalledWith(YESTERDAY);
  });

  it('never appears for someone who does not log, whatever yesterday holds', async () => {
    cacheYesterday({}); // five unmarked prayers — the loudest case
    await renderScreen(duringAsr());
    expect(screen.queryByTestId('yesterday-card')).toBeNull();
  });

  it('offers a logger the unmarked count, in the log’s own neutral word', async () => {
    actAsLogger();
    cacheYesterday({ fajr: 'prayed', dhuhr: 'prayed', asr: 'late' });
    await renderScreen(duringAsr());
    expect(screen.getByTestId('yesterday-card')).toBeTruthy();
    // "not marked", never "missed" — a status only the user may assign.
    expect(screen.getByText('2 prayers not marked')).toBeTruthy();
  });

  it('disappears once yesterday is fully marked', async () => {
    actAsLogger();
    cacheYesterday({
      fajr: 'prayed',
      dhuhr: 'prayed',
      asr: 'prayed',
      maghrib: 'late',
      isha: 'missed',
    });
    await renderScreen(duringAsr());
    expect(screen.queryByTestId('yesterday-card')).toBeNull();
  });

  it('says nothing about an exempt yesterday — nothing was owed', async () => {
    actAsLogger();
    cacheYesterday({
      fajr: 'exempt',
      dhuhr: 'exempt',
      asr: 'exempt',
      maghrib: 'exempt',
      isha: 'exempt',
    });
    await renderScreen(duringAsr());
    expect(screen.queryByTestId('yesterday-card')).toBeNull();
  });

  it('opens yesterday in the day sheet, and a pick lands on yesterday’s day', async () => {
    actAsLogger();
    cacheYesterday({ fajr: 'prayed', dhuhr: 'prayed', asr: 'prayed', maghrib: 'prayed' });
    await renderScreen(duringAsr());

    await act(async () => {
      fireEvent.press(screen.getByTestId('yesterday-card'));
    });
    const sheet = within(screen.getByTestId('yesterday-detail'));

    // The sheet's rows are History's own; Isha's seal opens its full pill (no direct pick on a
    // past day) and the pick goes through the same store door as everywhere else — keyed to
    // YESTERDAY, not to the screen's own day.
    await act(async () => {
      fireEvent.press(sheet.getByTestId('seal-isha-face'));
      jest.advanceTimersByTime(400);
    });
    await act(async () => {
      fireEvent.press(sheet.getByTestId('seal-isha-option-missed'));
    });
    expect(mockActions.toggleStatus).toHaveBeenCalledWith(YESTERDAY, 'isha', 'missed');
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Rigid);
  });
});

describe('Today screen — exemption surfaces (spec-exemption §2b, §3, §4a)', () => {
  /** Opens a period in the mocked store, `startDay` → ongoing. */
  function openSince(startDay: string): void {
    mockPeriods.current = [{ id: 1, startDay, endDay: null, createdAt: 0 }];
  }

  function enableMode(): void {
    useSettingsStore.getState().setExemptionModeEnabled(true);
  }

  it('shows the ⋯ from the first launch, but nothing louder while the mode is off', async () => {
    // A stored period cannot speak for itself while the mode is off — no banner, no inert seals.
    // The ⋯ is there for everyone, because a feature nobody can find is the worse failure.
    openSince(addDays(DAY, -2));
    await renderScreen(afterIsha());

    expect(screen.getByTestId('today-header-overflow')).toBeTruthy();
    expect(screen.queryByTestId('exemption-banner')).toBeNull();
  });

  it('explains itself the first time, then begins — turning the mode on by being used', async () => {
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });
    // The one line someone meeting the idea for the first time gets. It says what excused days
    // DO, never who should take them — illness and travel are still owed, and the Settings body
    // is the only place that spells the scope out.
    expect(screen.getByTestId('today-overflow-intro')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-begin'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-today'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-until'));
    });

    expect(mockActions.startExemptPeriod).toHaveBeenCalledWith(DAY);
    expect(useSettingsStore.getState().exemptionModeEnabled).toBe(true);
  });

  it('drops the first-time line once the mode is on', async () => {
    enableMode();
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });

    expect(screen.queryByTestId('today-overflow-intro')).toBeNull();
  });

  it('begins an open-ended period: ⋯ → "Excused from today" → "Until I end it"', async () => {
    enableMode();
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-begin'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-today'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-until'));
    });

    // The day the SCREEN decided on (Fajr→Fajr), not a calendar date read from a clock.
    expect(mockActions.startExemptPeriod).toHaveBeenCalledWith(DAY);
    expect(mockActions.addExemptPeriod).not.toHaveBeenCalled();
  });

  it('begins a period that ends by itself: "3 days" writes a closed period, nothing scheduled', async () => {
    enableMode();
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-begin'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-today'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-3'));
    });

    // Today counts as the first of the three, so the last exempt day is two days on.
    expect(mockActions.addExemptPeriod).toHaveBeenCalledWith(DAY, addDays(DAY, 2));
    expect(mockActions.startExemptPeriod).not.toHaveBeenCalled();
  });

  it('takes a day count of its own, and says which day that ends on', async () => {
    enableMode();
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-begin'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-today'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-count'));
    });
    // The stepper opens at five days; one press up makes it six.
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-stepper-increase'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-confirm'));
    });

    expect(mockActions.addExemptPeriod).toHaveBeenCalledWith(DAY, addDays(DAY, 5));
  });

  it('offers backdating the start — and never offers today or the future in that list', async () => {
    enableMode();
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-begin'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-earlier'));
    });

    // The list runs backwards from yesterday; today belongs to "From today" and tomorrow to nobody.
    expect(screen.queryByTestId(`exemption-begin-day-${DAY}`)).toBeNull();
    expect(screen.queryByTestId(`exemption-begin-day-${addDays(DAY, 1)}`)).toBeNull();
    const twoDaysAgo = addDays(DAY, -2);
    await act(async () => {
      fireEvent.press(screen.getByTestId(`exemption-begin-day-${twoDaysAgo}`));
    });
    // The duration question follows a backdated start too.
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-begin-until'));
    });
    expect(mockActions.startExemptPeriod).toHaveBeenCalledWith(twoDaysAgo);
  });

  it('shows the banner while a period is open, and its End control reaches the end sheet', async () => {
    enableMode();
    openSince(addDays(DAY, -2));
    await renderScreen(afterIsha());

    expect(screen.getByTestId('exemption-banner')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-banner-end'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-end-yesterday'));
    });
    expect(mockActions.endExemptPeriod).toHaveBeenCalledWith(addDays(DAY, -1));
  });

  describe('a period begun with an end date', () => {
    /** Begun yesterday, planned to end two days from now. */
    function plannedUntil(): void {
      mockPeriods.current = [
        { id: 1, startDay: addDays(DAY, -1), endDay: addDays(DAY, 2), createdAt: 0 },
      ];
    }

    it('shows the banner reading "until", with no "still excused?" line', async () => {
      enableMode();
      plannedUntil();
      await renderScreen(afterIsha());

      expect(screen.getByTestId('exemption-banner-body').props.children).toMatch(/until/);
      expect(screen.queryByTestId('exemption-banner-still-on')).toBeNull();
    });

    it('offers End in the ⋯, because a plan can still be cut short', async () => {
      enableMode();
      plannedUntil();
      await renderScreen(afterIsha());

      await act(async () => {
        fireEvent.press(screen.getByTestId('today-header-overflow'));
      });

      expect(screen.getByTestId('today-overflow-end')).toBeTruthy();
      expect(screen.queryByTestId('today-overflow-begin')).toBeNull();
    });

    it('is over once its last day is past: no banner, and ⋯ offers Begin again', async () => {
      // The whole point of a duration — nothing ran, nothing was scheduled, the coverage simply
      // stopped covering today.
      enableMode();
      mockPeriods.current = [
        { id: 1, startDay: addDays(DAY, -5), endDay: addDays(DAY, -1), createdAt: 0 },
      ];
      await renderScreen(afterIsha());

      expect(screen.queryByTestId('exemption-banner')).toBeNull();

      await act(async () => {
        fireEvent.press(screen.getByTestId('today-header-overflow'));
      });

      expect(screen.getByTestId('today-overflow-begin')).toBeTruthy();
      expect(screen.queryByTestId('today-overflow-end')).toBeNull();
    });
  });

  it('can end as of today, and the overflow’s single action flips to End while open', async () => {
    enableMode();
    openSince(addDays(DAY, -2));
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });
    expect(screen.queryByTestId('today-overflow-begin')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-end'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('exemption-end-today'));
    });
    expect(mockActions.endExemptPeriod).toHaveBeenCalledWith(DAY);
  });

  it('keeps the banner to one line while the period is under 5 days old', async () => {
    enableMode();
    openSince(addDays(DAY, -4));
    await renderScreen(afterIsha());

    expect(screen.getByTestId('exemption-banner')).toBeTruthy();
    expect(screen.queryByTestId('exemption-banner-still-on')).toBeNull();
  });

  it('grows the gentle line once the period is 5 days old — static, no count, no badge', async () => {
    enableMode();
    openSince(addDays(DAY, -5));
    await renderScreen(afterIsha());

    const line = screen.getByTestId('exemption-banner-still-on');
    // A door held open, never a nudge to hurry — and no number anywhere in it.
    expect(line.props.children).toBe(
      'Still excused? End it here whenever you’re ready — there’s no rush.'
    );
    expect(String(line.props.children)).not.toMatch(/\d/);
  });

  it('hides the reminder pill on an exempt day and keeps her own kept marks inert', async () => {
    enableMode();
    openSince(DAY);
    // The first day of a period: Fajr was prayed before it began and stays visible (amendment 2).
    mockRecord.current = {
      ...unloggedDayRecord(DAY),
      statuses: {
        fajr: 'prayed',
        dhuhr: 'exempt',
        asr: 'exempt',
        maghrib: 'exempt',
        isha: 'exempt',
      },
      isExempt: true,
    };
    await renderScreen(afterIsha());

    // "Reminder on" while the plan is silent would be a lie; the banner speaks instead.
    expect(screen.queryByText('Remind me')).toBeNull();
    expect(screen.queryByText('Reminder on')).toBeNull();
    expect(screen.getByTestId('exemption-banner')).toBeTruthy();

    // The kept "prayed" is displayed but not editable: writes are refused under an exemption,
    // and a tap that could clear a mark she cannot re-log would be a trap.
    expect(screen.getByTestId('seal-fajr-face').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('seal-dhuhr-face').props.accessibilityState.disabled).toBe(true);
  });
});

describe('Friday’s midday prayer (D75)', () => {
  // `DAY` (2025-07-11) is a Friday, so the whole suite already renders a Jumu'ah day; these
  // assert it deliberately, and that the naming never leaks past the display layer.

  it('names the row Jumu’ah AND Dhuhr, in both scripts', async () => {
    await renderScreen(duringAsr());

    const row = within(screen.getByTestId('prayer-row-dhuhr'));
    // Both, because Jumu'ah replaces Dhuhr only for whoever prays it in congregation. A woman
    // praying at home, a traveller or anyone who cannot reach a masjid prays Dhuhr — the row has
    // to be true for her too, and "Jumu'ah" alone would not be.
    expect(row.getByText('Jumu’ah · Dhuhr')).toBeTruthy();
    expect(row.getByText('الجمعة')).toBeTruthy();
    // Two spoken elements begin with the pair — the row's own sentence ("…, 1:13 pm, upcoming")
    // and the seal's face ("…, not marked"). Both must say the same name: a screen reader that
    // heard the row call it Jumu'ah and its seal call it Dhuhr would be describing two prayers.
    expect(screen.getAllByLabelText(/^Jumu’ah · Dhuhr, /)).toHaveLength(2);
  });

  it('logs it as `dhuhr` all the same — the name never reaches the store', async () => {
    await renderScreen(duringAsr());

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-face'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-option-prayed'));
    });

    // The identity is what streaks, stats, qada and the notification plan all key on. A weekday
    // that could fork it would strand every Friday's log in a prayer nothing else knows about.
    expect(mockActions.toggleStatus).toHaveBeenCalledWith(DAY, 'dhuhr', 'prayed');
  });

  it('leaves the other four prayers alone', async () => {
    await renderScreen(duringAsr());

    for (const [prayer, name] of [
      ['fajr', 'Fajr'],
      ['asr', 'Asr'],
      ['maghrib', 'Maghrib'],
      ['isha', 'Isha'],
    ] as const) {
      expect(within(screen.getByTestId(`prayer-row-${prayer}`)).getByText(name)).toBeTruthy();
    }
  });

  it('follows the prayer day across midnight, not the date on the phone', async () => {
    // 00:30 on Friday the 11th: the phone says Friday, the prayer day is still Thursday's. The
    // midday prayer of a Thursday is Dhuhr, and calling it Jumu'ah here would be the bug the
    // prayer-day rule exists to prevent.
    const now = beforeFajrOnDay();
    await renderScreen(now);

    expect(getCurrentPrayerDay(now, LOCATION, useSettingsStore.getState().calculation)).toBe(
      addDays(DAY, -1)
    );
    const row = within(screen.getByTestId('prayer-row-dhuhr'));
    expect(row.getByText('Dhuhr')).toBeTruthy();
    expect(row.getByText('الظهر')).toBeTruthy();
    expect(screen.queryByText('Jumu’ah · Dhuhr')).toBeNull();
  });
});

/**
 * The dashboard (D124): at expanded width the reward loop keeps the leading pane and the trailing
 * one carries this month, the record and the live qibla dial.
 *
 * The rule every test here defends is that **the reward loop does not change**. It is the thing the
 * app is for, so it is not rearranged, shrunk or reordered to make room for a dashboard — the suite
 * above, which runs at the ambient 750pt (a *medium* window), is the proof of that, and these tests
 * only add what appears beside it.
 */
describe('the dashboard at expanded width', () => {
  /** A month with something in it, so the record card has real summaries to render. */
  function seedLoggedMonth(): void {
    const logged = PRAYERS.reduce<Record<string, 'prayed'>>((all, prayer) => {
      all[prayer] = 'prayed';
      return all;
    }, {});
    const record = { ...unloggedDayRecord(addDays(DAY, -2)), statuses: logged };
    mockDayRecords.current = { [addDays(DAY, -2)]: record as DayRecord };
    const days = Object.values(mockDayRecords.current);
    mockWindowStats.current = computeStats(days, { windowDays: 7, todayDay: DAY });
    mockLifetimeStats.current = computeStats(days, { windowDays: null, todayDay: DAY });
  }

  beforeEach(() => {
    jest
      .spyOn(Dimensions, 'get')
      .mockImplementation(() => ({ width: 1194, height: 834, scale: 2, fontScale: 1 }));
    seedLoggedMonth();
  });

  it('keeps the whole reward loop, in order, in the leading pane', async () => {
    await renderScreen(duringAsr());

    const start = within(screen.getByTestId('today-panes-start'));
    expect(start.getByTestId('today-header')).toBeTruthy();
    expect(start.getByTestId('countdown-hero')).toBeTruthy();
    expect(start.getByTestId('today-footer')).toBeTruthy();
    // The five rows, still in their order, with sunrise still after Fajr.
    const rows = start.getByTestId('prayer-rows');
    const ids = rows.children.map((child) =>
      typeof child === 'string' ? child : String(child.props.testID)
    );
    expect(ids).toEqual([
      'prayer-row-fajr',
      'sunrise-marker',
      'prayer-row-dhuhr',
      'prayer-row-asr',
      'prayer-row-maghrib',
      'prayer-row-isha',
    ]);
  });

  it('puts the month and the qibla dial in the trailing pane', async () => {
    await renderScreen(duringAsr());

    const end = within(screen.getByTestId('today-panes-end'));
    expect(end.getByTestId('today-glance-calendar')).toBeTruthy();
    expect(end.getByTestId('today-glance-qibla-dial')).toBeTruthy();
  });

  /**
   * Owner, 2026-08-27, on seeing the pane in landscape: "i would put Qibla above history". The dial
   * is the one thing here somebody wants an answer from *now*, so it leads.
   */
  it('leads the glance with the dial, then the month', async () => {
    await renderScreen(duringAsr());

    const rendered = JSON.stringify(screen.getByTestId('today-panes-end').toJSON());
    expect(rendered.indexOf('today-glance-qibla-card')).toBeGreaterThan(-1);
    expect(rendered.indexOf('today-glance-qibla-card')).toBeLessThan(
      rendered.indexOf('today-glance-calendar-card')
    );
  });

  it('shows a non-logger a calendar and a dial, and no table of zeros', async () => {
    mockDayRecords.current = {};
    mockWindowStats.current = computeStats([], { windowDays: 7, todayDay: DAY });
    mockLifetimeStats.current = computeStats([], { windowDays: null, todayDay: DAY });
    await renderScreen(duringAsr());

    // The record is what a non-logger must not be handed uninvited; the calendar is calm either way.
    expect(screen.getByTestId('today-glance-calendar')).toBeTruthy();
    expect(screen.queryByTestId('today-glance-stats')).toBeNull();
  });

  it('writes through the store when a glance calendar day is marked', async () => {
    await renderScreen(duringAsr());

    await act(async () => {
      fireEvent.press(screen.getByTestId(`calendar-day-${addDays(DAY, -2)}`));
    });

    // Both panes now hold a live Maghrib seal — today's row and the opened day's — so the tap has
    // to be aimed at the sheet, which is the point: the two are separate surfaces over separate
    // days, and this asserts the sheet's one writes to the day it is showing.
    const sheet = within(screen.getByTestId('today-glance-detail-sheet'));
    await act(async () => {
      fireEvent.press(sheet.getByTestId('seal-maghrib-face'));
    });
    await act(async () => {
      fireEvent.press(sheet.getByTestId('seal-maghrib-option-prayed'));
    });

    expect(mockActions.toggleStatus).toHaveBeenCalledWith(addDays(DAY, -2), 'maghrib', 'prayed');
  });

  it('spans both panes with one seal-dismiss boundary', async () => {
    await renderScreen(duringAsr());
    // A tap on the glance pane's bare paper closes an open pill too.
    expect(screen.getByTestId('today-seal-dismiss')).toBeTruthy();
  });

  it('keeps the two day sheets apart', async () => {
    await renderScreen(duringAsr());
    // Yesterday's sheet and the glance's are distinct surfaces; neither is open on arrival.
    expect(screen.queryByTestId('yesterday-detail-sheet')).toBeNull();
    expect(screen.queryByTestId('today-glance-detail-sheet')).toBeNull();
  });
});

describe('a phone never pays for the dashboard', () => {
  it('mounts no glance pane, and therefore no compass, below the breakpoint', async () => {
    jest
      .spyOn(Dimensions, 'get')
      .mockImplementation(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 }));
    await renderScreen(duringAsr());

    expect(screen.queryByTestId('today-panes-start')).toBeNull();
    expect(screen.queryByTestId('today-glance-calendar')).toBeNull();
    expect(screen.queryByTestId('today-glance-qibla-dial')).toBeNull();
    // And the reward loop is exactly where it always was.
    expect(screen.getByTestId('today-scroll')).toBeTruthy();
    expect(screen.getByTestId('prayer-rows')).toBeTruthy();
  });
});

describe('Today screen — travel mode (D115–D117)', () => {
  /** Turns travel on for the screen's own day, open-ended unless a last day is given. */
  function travel(lastDay: string | null = null): void {
    useSettingsStore.getState().startTravel(DAY, lastDay as never);
  }

  async function openOverflow(): Promise<void> {
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-header-overflow'));
    });
  }

  it('offers travel in the ⋯ beside excused days, and nothing louder while it is off', async () => {
    await renderScreen(afterIsha());

    expect(screen.queryByTestId('travel-banner')).toBeNull();

    await openOverflow();

    expect(screen.getByTestId('today-overflow-travel-begin')).toBeTruthy();
    expect(screen.queryByTestId('today-overflow-travel-end')).toBeNull();
    // The two features are siblings: excused days keeps its own action, unchanged.
    expect(screen.getByTestId('today-overflow-begin')).toBeTruthy();
  });

  it('explains the concession where it is asked for, then starts open-ended in two taps', async () => {
    await renderScreen(afterIsha());

    await openOverflow();
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-travel-begin'));
    });

    // The rule is stated once, in the sheet somebody reached by asking — travel has no Settings
    // presence at all, so this is its only explanation.
    expect(screen.getByTestId('travel-begin-note')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('travel-begin-until'));
    });

    expect(useSettingsStore.getState().travelActive).toBe(true);
    expect(useSettingsStore.getState().travelStartDay).toBe(DAY);
    expect(useSettingsStore.getState().travelEndDay).toBeNull();
    expect(screen.getByTestId('travel-banner')).toBeTruthy();
  });

  it('takes a journey length: "3 days" counts today as the first', async () => {
    await renderScreen(afterIsha());

    await openOverflow();
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-travel-begin'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('travel-begin-3'));
    });

    expect(useSettingsStore.getState().travelEndDay).toBe(addDays(DAY, 2));
    expect(screen.getByTestId('travel-banner-body').props.children).toMatch(/until/);
  });

  it('takes a day count of its own', async () => {
    await renderScreen(afterIsha());

    await openOverflow();
    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-travel-begin'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('travel-begin-count'));
    });
    // Opens at five days; one press up makes it six.
    await act(async () => {
      fireEvent.press(screen.getByTestId('travel-begin-stepper-increase'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('travel-begin-confirm'));
    });

    expect(useSettingsStore.getState().travelEndDay).toBe(addDays(DAY, 5));
  });

  it('ends from the banner in one tap — there is nothing to backdate', async () => {
    travel();
    await renderScreen(afterIsha());

    await act(async () => {
      fireEvent.press(screen.getByTestId('travel-banner-end'));
    });

    expect(useSettingsStore.getState().travelActive).toBe(false);
    expect(screen.queryByTestId('travel-banner')).toBeNull();
  });

  it('ends from the ⋯ in one tap, with no sheet in between', async () => {
    travel();
    await renderScreen(afterIsha());

    await openOverflow();
    expect(screen.queryByTestId('today-overflow-travel-begin')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('today-overflow-travel-end'));
    });

    expect(useSettingsStore.getState().travelActive).toBe(false);
  });

  it('is over once the last travel day is past, with nothing having run', async () => {
    useSettingsStore.getState().startTravel(addDays(DAY, -5), addDays(DAY, -1));
    await renderScreen(afterIsha());

    // The state is still stored and still "active" — it simply does not apply to today.
    expect(useSettingsStore.getState().travelActive).toBe(true);
    expect(screen.queryByTestId('travel-banner')).toBeNull();

    await openOverflow();
    expect(screen.getByTestId('today-overflow-travel-begin')).toBeTruthy();
  });

  it('shows no "still travelling?" line under a journey with an end date', async () => {
    useSettingsStore.getState().startTravel(addDays(DAY, -20), addDays(DAY, 2));
    await renderScreen(afterIsha());

    expect(screen.getByTestId('travel-banner')).toBeTruthy();
    expect(screen.queryByTestId('travel-banner-still-on')).toBeNull();
  });

  it('stacks under the excused-days banner when both are on', async () => {
    // A woman may travel during her period. Both states are true, so both are said — exemption
    // first, because it decides whether the prayers are owed at all.
    useSettingsStore.getState().setExemptionModeEnabled(true);
    mockPeriods.current = [{ id: 1, startDay: addDays(DAY, -1), endDay: null, createdAt: 0 }];
    mockRecord.current = { ...unloggedDayRecord(DAY), isExempt: true };
    travel();
    await renderScreen(afterIsha());

    expect(screen.getByTestId('exemption-banner')).toBeTruthy();
    expect(screen.getByTestId('travel-banner')).toBeTruthy();
  });

  describe('the one thing travel changes about marking', () => {
    it('records PRAYED for a Dhuhr marked once Asr has come in', async () => {
      // A traveller may pray Dhuhr with Asr, so the tap that races Dhuhr's window shutting is
      // telling the truth when it says "prayed".
      travel();
      const dhuhrEnd = windowsForDay()[1].end;
      const now = new Date(dhuhrEnd.getTime() - 60 * 1000);
      await renderScreen(now);
      const expectedDay = getCurrentPrayerDay(
        now,
        LOCATION,
        useSettingsStore.getState().calculation
      );

      jest.setSystemTime(new Date(dhuhrEnd.getTime() + 60 * 1000));
      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-dhuhr-face'));
      });

      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expectedDay, 'dhuhr', 'prayed');
    });

    it('records LATE for the very same tap when travel is off', async () => {
      const dhuhrEnd = windowsForDay()[1].end;
      await renderScreen(new Date(dhuhrEnd.getTime() - 60 * 1000));

      jest.setSystemTime(new Date(dhuhrEnd.getTime() + 60 * 1000));
      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-dhuhr-face'));
      });

      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expect.any(String), 'dhuhr', 'late');
    });

    it('still records LATE for a travelling Fajr marked after sunrise — Fajr has no partner', async () => {
      travel();
      const sunriseAt = computeDayTimes(DAY, LOCATION, useSettingsStore.getState().calculation)
        .times.sunrise;
      await renderScreen(new Date(sunriseAt.getTime() - 60 * 1000));

      jest.setSystemTime(new Date(sunriseAt.getTime() + 60 * 1000));
      await act(async () => {
        fireEvent.press(screen.getByTestId('seal-fajr-face'));
      });

      expect(mockActions.toggleStatus).toHaveBeenCalledWith(expect.any(String), 'fajr', 'late');
    });
  });
});

describe('simple tracking mode (D192)', () => {
  beforeEach(() => {
    useSettingsStore.getState().setTrackingMode('simple', DAY);
  });
  afterEach(() => {
    useSettingsStore.getState().setTrackingMode('detailed', DAY);
  });

  const faceLabel = (prayer: string): string =>
    String(screen.getByTestId(`seal-${prayer}-face`).props.accessibilityLabel);

  it('shows an unmarked prayer as missed once its time has ended, and an open one as not yet', async () => {
    await renderScreen(duringAsr());

    expect(faceLabel('fajr')).toMatch(/missed/);
    expect(faceLabel('dhuhr')).toMatch(/missed/);
    expect(faceLabel('asr')).toMatch(/not marked/);
    expect(faceLabel('maghrib')).not.toMatch(/missed/);
  });

  it('shows a stored late as prayed', async () => {
    mockRecord.current = {
      ...unloggedDayRecord(DAY),
      statuses: { ...unloggedDayRecord(DAY).statuses, fajr: 'late' },
    };
    await renderScreen(duringAsr());

    expect(faceLabel('fajr')).toMatch(/prayed/);
    expect(faceLabel('fajr')).not.toMatch(/late/);
  });

  it('turns a past prayer prayed with one tap — no pill, no late rewrite', async () => {
    const now = duringAsr();
    await renderScreen(now);
    const expectedDay = getCurrentPrayerDay(now, LOCATION, useSettingsStore.getState().calculation);

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-fajr-face'));
    });

    expect(mockActions.toggleSimpleStatus).toHaveBeenCalledWith(expectedDay, 'fajr');
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
    expect(pillOpen('fajr')).toBe(false);
  });

  it('keeps a prayer that has not started locked', async () => {
    await renderScreen(duringAsr());

    expect(screen.getByTestId('seal-maghrib-face').props.accessibilityState.disabled).toBe(true);
  });
});

