/**
 * Screen test for the qada screen (`src/app/qada.tsx`).
 *
 * The screen is a composition, so what is tested is the composition's promises (PRODUCT_SPEC §7):
 *
 * 1. the wizard never opens itself — only on a tap, or when a caller asked for it on the way in;
 * 2. the counters descend, one tap at a time, through the tracking store;
 * 3. a projection is shown **only when it means something** — otherwise the screen says something
 *    kind instead of something false;
 * 4. "Start fresh" asks once, archives rather than deletes, and offers the undo in the same place
 *    for thirty days — and stops offering it afterwards;
 * 5. at zero the screen is relief, not an empty state.
 *
 * The tracking store is mocked (it opens SQLite), but every transition inside the mock is the real
 * `domain/qada` one — the debts, the forgiveness archive, the undo window and the pace are the
 * domain's answers, not the test's.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, I18nManager, StyleSheet, type ViewStyle } from 'react-native';

import QadaScreen from '../app/qada';
import { PRAYERS, type Prayer, type QadaDebts, type QadaEvent } from '../domain/types';
import { initI18n } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';

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

// The safe-area provider is installed by expo-router, which this test does not mount.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
/** The route params the screen was opened with — `{ setup: '1' }` is the onboarding hand-over. */
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
}));

/**
 * A tracking store that keeps its rows in memory but runs every transition through the real
 * `domain/qada`, in a real zustand store so the screen re-renders exactly as it would in the app.
 */
jest.mock('../stores/trackingStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const qada = jest.requireActual<typeof import('../domain/qada')>('../domain/qada');
  /**
   * The current PRAYER day (Fajr→Fajr), which is what the real store answers with. It defaults to
   * the pinned clock's calendar date, and a test may move it off that date to reproduce the
   * midnight→Fajr window, where the two genuinely differ.
   */
  const defaultToday = '2026-08-19';

  interface MockFake {
    hydrated: boolean;
    revision: number;
    today: string;
    debts: QadaDebts;
    events: QadaEvent[];
    forgiveEvent: QadaEvent | null;
    forgiveUndone: boolean;
    todayDay: () => string;
    qadaProgress: (paceWindowDays?: number) => unknown;
    tickQada: (prayer: Prayer) => boolean;
    setQadaDebts: (debts: QadaDebts) => QadaDebts;
    forgiveQada: () => boolean;
    undoableForgive: () => QadaEvent | null;
    undoForgive: () => boolean;
  }

  const store = create<MockFake>((set, get) => {
    /** Every write bumps the revision, exactly as the real store does. */
    const bump = (patch: Partial<MockFake>) => set({ ...patch, revision: get().revision + 1 });

    return {
      hydrated: true,
      revision: 0,
      today: defaultToday,
      debts: qada.emptyDebts(),
      events: [],
      forgiveEvent: null,
      forgiveUndone: false,

      todayDay: () => get().today,

      qadaProgress: (paceWindowDays = 30) =>
        qada.computeProgress(get().debts, get().events, {
          todayDay: get().today,
          paceWindowDays,
        }),

      tickQada: (prayer) => {
        const { debts, events } = get();
        const next = qada.applyTick(debts, prayer);
        if (next[prayer] === debts[prayer]) return false;
        bump({
          debts: next,
          events: [...events, { type: 'tick', prayer, delta: -1, at: Date.now() }],
        });
        return true;
      },

      setQadaDebts: (debts) => {
        const next = qada.normalizeDebts(debts);
        bump({ debts: next });
        return next;
      },

      forgiveQada: () => {
        const { debts } = get();
        if (qada.totalDebt(debts) === 0) return false;
        const result = qada.forgive(debts, new Date());
        bump({ debts: result.debts, forgiveEvent: result.event, forgiveUndone: false });
        return true;
      },

      undoableForgive: () => {
        const { forgiveEvent, forgiveUndone } = get();
        if (forgiveEvent === null || forgiveUndone) return null;
        return qada.canUndoForgive(forgiveEvent, new Date()) ? forgiveEvent : null;
      },

      undoForgive: () => {
        const event = get().undoableForgive();
        if (event === null) return false;
        // Additive, exactly like the real store (D79): the archive lands on top of whatever the
        // counters hold, so a miss logged since the forgiveness is not deleted by the undo.
        bump({ debts: qada.addDebts(get().debts, qada.undoForgive(event)), forgiveUndone: true });
        return true;
      },
    };
  });

  return {
    __store: store,
    useTrackingHydrated: () => store((s: { hydrated: boolean }) => s.hydrated),
    useQadaDebts: () => store((s: { debts: QadaDebts }) => s.debts),
    // The setup wizard prefills its days-per-month stepper from recorded exempt periods; this
    // screen's tests never record any, so an empty list is the honest fake.
    useExemptPeriods: () => [],
    useTrackingActions: () => store.getState(),
    useTrackingStore: (selector: (state: unknown) => unknown) => store(selector),
  };
});

interface MockState {
  revision: number;
  /** The current prayer day the store answers with — off the calendar date before Fajr. */
  today: string;
  debts: QadaDebts;
  events: QadaEvent[];
  forgiveEvent: QadaEvent | null;
  forgiveUndone: boolean;
  /** The one action a test drives directly, to stand in for a miss logged somewhere else. */
  setQadaDebts: (debts: QadaDebts) => QadaDebts;
}

const { __store: trackingStore } = jest.requireMock('../stores/trackingStore') as {
  __store: { setState: (patch: Partial<MockState>) => void; getState: () => MockState };
};

configure({ defaultIncludeHiddenElements: true });

function seed(patch: Partial<MockState>) {
  trackingStore.setState({
    today: '2026-08-19',
    debts: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    events: [],
    forgiveEvent: null,
    forgiveUndone: false,
    ...patch,
    revision: trackingStore.getState().revision + 1,
  });
}

async function renderScreen() {
  const view = await render(<QadaScreen />);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  return view;
}

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  // Noon, so "40 days ago" and "3 days ago" stay on the calendar days they name.
  jest.setSystemTime(new Date(2026, 7, 19, 12, 0, 0));
  jest.clearAllMocks();
  useSettingsStore.getState().setQadaSetupCompleted(true);
  useSettingsStore.getState().setExemptionModeEnabled(false);
  mockParams.current = {};
  seed({});
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the qada screen', () => {
  it('never opens the wizard over itself — the counters are what a first visit gets', async () => {
    useSettingsStore.getState().setQadaSetupCompleted(false);
    await renderScreen();

    // Someone who owes two prayers came for the list, not for a setup flow.
    expect(screen.queryByTestId('qada-wizard')).toBeNull();
    expect(screen.getByTestId('qada-counters')).toBeTruthy();
    for (const prayer of PRAYERS) {
      expect(screen.getByTestId(`qada-add-${prayer}`)).toBeTruthy();
    }
    // Counting a backlog is an offer, and it is named for what it does before it has been used.
    expect(screen.getByTestId('qada-rerun-setup').props.accessibilityLabel).toBe(
      'Count what I missed'
    );
  });

  it('opens the wizard only when it is asked for', async () => {
    useSettingsStore.getState().setQadaSetupCompleted(false);
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-rerun-setup'));
    });
    expect(screen.getByTestId('qada-wizard')).toBeTruthy();
  });

  it('opens the wizard when it was asked for on the way in — first-run setup’s hand-over', async () => {
    // The other caller of "ask for the wizard" is not a tap on this screen: it is the last step
    // of first-run setup, whose button says "Count them with me". That tap has to land *in* the
    // wizard. Without the intent travelling with the route it lands on five zeroes instead, and
    // the user has to go find the header link they just pressed a button to avoid.
    useSettingsStore.getState().setQadaSetupCompleted(false);
    mockParams.current = { setup: '1' };
    await renderScreen();

    expect(screen.getByTestId('qada-wizard')).toBeTruthy();
  });

  it('bounds the wizard’s range by the PRAYER day, not the calendar date', async () => {
    // The wizard's range stops at yesterday because "today's prayers are the Today screen's to
    // log" — but `today` defaults to the local CALENDAR date and the screen never passed the
    // prayer day it is already holding (the prop's own doc says it does). Between midnight and
    // Fajr the two differ by one, so at 00:30 the wizard offers the current, still-open prayer
    // day as the last countable day: five prayers the user can still go and pray, charged to
    // them as debt by a wizard whose stated rule is not to.
    jest.setSystemTime(new Date(2026, 7, 20, 0, 30, 0)); // past midnight on the 20th…
    seed({ today: '2026-08-19' }); // …but Fajr has not arrived, so the prayer day is the 19th.
    useSettingsStore.getState().setQadaSetupCompleted(false);
    mockParams.current = { setup: '1' };
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-choice-backtrack'));
    });

    // Yesterday relative to the PRAYER day — the 18th, never the still-open 19th.
    expect(within(screen.getByTestId('qada-wizard-to')).getByText('August 18, 2026')).toBeTruthy();
  });

  it('leaves the wizard shut once it is dismissed, even though the param is still on the route', async () => {
    // Closing the wizard must be final for this visit — a param that keeps re-opening it would be
    // a screen the user cannot get out of.
    useSettingsStore.getState().setQadaSetupCompleted(false);
    mockParams.current = { setup: '1' };
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-skip'));
    });
    expect(screen.queryByTestId('qada-wizard')).toBeNull();
  });

  it('goes back to Today when the wizard closes on a hand-over visit (D85)', async () => {
    // Reported by a user: they finished the estimate and were left on a full-screen counter list
    // with no tab bar, concluded it was the app's main screen, and thought prayers were marked
    // there. Counting a backlog was the last thing first-run setup offered, not a destination.
    useSettingsStore.getState().setQadaSetupCompleted(false);
    mockParams.current = { setup: '1' };
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-skip'));
    });

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('stays put when the wizard closes on an ordinary visit', async () => {
    // The other half of the rule above, and the one that would be easy to break with it: someone
    // who opened the wizard from this screen's own header link came here on purpose. Closing it
    // returns them to the counters, never off the screen they chose.
    useSettingsStore.getState().setQadaSetupCompleted(false);
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-rerun-setup'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-wizard-skip'));
    });

    expect(screen.getByTestId('qada-counters')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('offers the wizard as a re-run once it has been done', async () => {
    useSettingsStore.getState().setQadaSetupCompleted(true);
    await renderScreen();

    expect(screen.queryByTestId('qada-wizard')).toBeNull();
    expect(screen.getByTestId('qada-rerun-setup').props.accessibilityLabel).toBe('Set up again');
  });

  it('renders relief, not absence, when nothing is owed — with the counters still there', async () => {
    await renderScreen();

    expect(screen.getByTestId('qada-relief')).toBeTruthy();
    expect(screen.getByText('Nothing left to make up')).toBeTruthy();
    // No pace to speak of and nothing to forgive: nothing on this screen asks for anything.
    expect(screen.queryByTestId('qada-pace')).toBeNull();
    expect(screen.queryByTestId('qada-forgive')).toBeNull();

    // The counters stay, at zero, so a prayer owed can be added without meeting a wizard —
    // and every one of them reads as cleared rather than as an empty slot.
    expect(screen.getByTestId('qada-counters')).toBeTruthy();
    for (const prayer of PRAYERS) {
      expect(screen.getByTestId(`qada-cleared-${prayer}`)).toBeTruthy();
      expect(screen.queryByTestId(`qada-make-up-${prayer}`)).toBeNull();
      expect(screen.getByTestId(`qada-add-${prayer}`)).toBeTruthy();
    }
  });

  it('adds one to a counter when its plus is tapped, from zero upwards', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-add-asr'));
    });

    expect(trackingStore.getState().debts).toEqual({
      fajr: 0,
      dhuhr: 0,
      asr: 1,
      maghrib: 0,
      isha: 0,
    });
    expect(screen.getByTestId('qada-total').props.children).toBe('1');
    expect(within(screen.getByTestId('qada-row-asr')).getByText('1')).toBeTruthy();
    expect(screen.getByTestId('qada-add-asr').props.accessibilityLabel).toBe(
      'Add one Asr to make up'
    );
  });

  it('is the undo for a "made up" tapped by mistake', async () => {
    seed({ debts: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 4, isha: 0 } });
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-make-up-maghrib'));
    });
    expect(trackingStore.getState().debts.maghrib).toBe(3);

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-add-maghrib'));
    });

    // Back exactly where it was, and only that counter moved.
    expect(trackingStore.getState().debts).toEqual({
      fajr: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 4,
      isha: 0,
    });
  });

  it('shows the total and one descending counter per prayer', async () => {
    seed({ debts: { fajr: 12, dhuhr: 4, asr: 4, maghrib: 0, isha: 1 } });
    await renderScreen();

    expect(screen.getByTestId('qada-total').props.children).toBe('21');
    for (const prayer of PRAYERS) {
      expect(screen.getByTestId(`qada-row-${prayer}`)).toBeTruthy();
    }
    // A cleared prayer keeps its line, loses its button, and says so in words as well as colour.
    expect(screen.getByTestId('qada-cleared-maghrib')).toBeTruthy();
    expect(screen.queryByTestId('qada-make-up-maghrib')).toBeNull();
    expect(screen.getByTestId('qada-make-up-fajr')).toBeTruthy();
  });

  it('takes one off a counter, through the store, when its button is tapped', async () => {
    seed({ debts: { fajr: 3, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 } });
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-make-up-fajr'));
    });

    expect(trackingStore.getState().debts.fajr).toBe(2);
    expect(screen.getByTestId('qada-total').props.children).toBe('2');
    expect(within(screen.getByTestId('qada-row-fajr')).getByText('2')).toBeTruthy();
  });

  it('takes the last one off and stops there — no path on this screen goes below zero', async () => {
    seed({ debts: { fajr: 1, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 } });
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-make-up-fajr'));
    });

    // The button that could decrement again is gone with the debt, and the screen turns to relief.
    expect(trackingStore.getState().debts).toEqual({
      fajr: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 0,
      isha: 0,
    });
    expect(screen.getByTestId('qada-relief')).toBeTruthy();
    expect(screen.queryByTestId('qada-make-up-fajr')).toBeNull();

    // …and "Start fresh" on nothing is a no-op rather than a negative or an empty archive.
    expect(trackingStore.getState().forgiveEvent).toBeNull();
  });

  it('hides the projection while there is no pace to project from', async () => {
    seed({ debts: { fajr: 30, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 } });
    await renderScreen();

    expect(screen.queryByTestId('qada-projection')).toBeNull();
    expect(screen.getByText('One whenever you can. There is no clock on this.')).toBeTruthy();
  });

  it('shows the pace and a projected date once prayers have been made up', async () => {
    const at = Date.now() - 3 * DAY_MS;
    seed({
      debts: { fajr: 30, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      events: Array.from({ length: 10 }, () => ({
        type: 'tick' as const,
        prayer: 'fajr' as const,
        delta: -1,
        at,
      })),
    });
    await renderScreen();

    expect(screen.getByText('10 made up in the last 30 days.')).toBeTruthy();
    // 30 owed at 10 per 30 days is 90 days: 17 November 2026.
    expect(screen.getByTestId('qada-projection').props.children).toBe(
      'At this pace, you’re clear around November 17, 2026.'
    );
  });

  /**
   * The owner's report, on the screen that showed it: one Fajr owed, one prayer made up, and a
   * clear date a month out. The pace line is still worth saying; the date is not.
   */
  it('says what was made up without naming a date the pace cannot support', async () => {
    seed({
      debts: { fajr: 1, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      events: [{ type: 'tick', prayer: 'fajr', delta: -1, at: Date.now() }],
    });
    await renderScreen();

    expect(screen.getByTestId('qada-pace-recent').props.children).toBe(
      '1 made up in the last 30 days.'
    );
    expect(screen.queryByTestId('qada-projection')).toBeNull();
    expect(screen.getByText('One whenever you can. There is no clock on this.')).toBeTruthy();
  });

  it('never projects from a tick that has fallen out of the pace window', async () => {
    seed({
      debts: { fajr: 30, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      events: [{ type: 'tick', prayer: 'fajr', delta: -1, at: Date.now() - 90 * DAY_MS }],
    });
    await renderScreen();

    expect(screen.queryByTestId('qada-projection')).toBeNull();
  });
});

describe('start fresh', () => {
  it('asks once, then zeroes the counters and offers the undo in the same place', async () => {
    seed({ debts: { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 } });
    await renderScreen();

    // The action is quiet and reversible-looking; nothing happens until it is confirmed.
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive'));
    });
    expect(screen.getByTestId('qada-forgive-confirm')).toBeTruthy();
    expect(screen.getByText(/50 prayers will be archived, not erased/)).toBeTruthy();
    expect(trackingStore.getState().debts.fajr).toBe(10);

    // Backing out changes nothing at all.
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive-cancel'));
    });
    expect(screen.queryByTestId('qada-forgive-confirm')).toBeNull();
    expect(trackingStore.getState().debts.fajr).toBe(10);

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive-confirm-action'));
    });

    expect(PRAYERS.every((prayer) => trackingStore.getState().debts[prayer] === 0)).toBe(true);
    expect(screen.getByTestId('qada-relief')).toBeTruthy();
    expect(screen.getByTestId('qada-forgive-undo')).toBeTruthy();
  });

  it('brings the archived prayers back when the undo is taken', async () => {
    seed({ debts: { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 } });
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive-confirm-action'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive-undo-action'));
    });

    // Restored exactly, per prayer — the archive is the source, not a remembered total.
    expect(trackingStore.getState().debts).toEqual({
      fajr: 10,
      dhuhr: 10,
      asr: 10,
      maghrib: 10,
      isha: 10,
    });
    expect(screen.getByTestId('qada-total').props.children).toBe('50');
    expect(screen.queryByTestId('qada-forgive-undo')).toBeNull();
  });

  it('keeps the undo reachable after a new prayer is missed inside the window', async () => {
    seed({ debts: { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 } });
    const { rerender } = await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive-confirm-action'));
    });
    expect(screen.getByTestId('qada-forgive-undo')).toBeTruthy();

    // The user misses a prayer the next day and logs it: the counters leave zero. The promise
    // made two taps ago — "you can bring them back for 30 days" — has to survive that.
    await act(async () => {
      trackingStore.getState().setQadaDebts({ fajr: 1, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });
      await rerender(<QadaScreen />);
    });

    expect(screen.getByTestId('qada-total').props.children).toBe('1');
    expect(screen.getByTestId('qada-forgive-undo')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-forgive-undo-action'));
    });

    // Every archived per-prayer number comes back — added to the Fajr missed since, not in
    // place of it (D79). The prayer she logged as missed is hers, and the undo does not eat it.
    expect(trackingStore.getState().debts).toEqual({
      fajr: 11,
      dhuhr: 10,
      asr: 10,
      maghrib: 10,
      isha: 10,
    });
    expect(screen.queryByTestId('qada-forgive-undo')).toBeNull();
  });

  it('stops offering the undo once the thirty-day window has passed', async () => {
    seed({
      debts: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      forgiveEvent: {
        type: 'forgive',
        prayer: null,
        delta: -50,
        at: Date.now() - 40 * DAY_MS,
        meta: {
          debts: { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 },
          total: 50,
          forgivenOn: '2026-07-10',
        },
      },
    });
    await renderScreen();

    expect(screen.getByTestId('qada-relief')).toBeTruthy();
    expect(screen.queryByTestId('qada-forgive-undo')).toBeNull();
  });

  it('still offers the undo on the last day of the window', async () => {
    seed({
      debts: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      forgiveEvent: {
        type: 'forgive',
        prayer: null,
        delta: -50,
        at: Date.now() - 30 * DAY_MS,
        meta: {
          debts: { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 },
          total: 50,
          forgivenOn: '2026-07-20',
        },
      },
    });
    await renderScreen();

    expect(screen.getByTestId('qada-forgive-undo')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------------ direction */

describe('the per-prayer ring under reduce motion', () => {
  it('still moves the counter — the arc just lands without easing', async () => {
    // spec-accessibility §2.7: the ring's fill renders at its final value instead of easing
    // there; the numeral inside the ring carries the change either way. Reanimated's jest
    // utilities cannot read `useAnimatedProps` off an SVG arc, so what is pinned here is the
    // contract that matters: with the flag on, the flow is consulted and behaves identically.
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => Promise.resolve(true));
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((() => ({ remove: jest.fn() })) as unknown as
        typeof AccessibilityInfo.addEventListener);

    seed({ debts: { fajr: 3, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 } });
    await renderScreen();
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-make-up-fajr'));
    });
    expect(trackingStore.getState().debts.fajr).toBe(2);
    expect(within(screen.getByTestId('qada-row-fajr')).getByText('2')).toBeTruthy();
  });
});

describe('the per-prayer ring under RTL', () => {
  const originalIsRTL = I18nManager.isRTL;

  /** `I18nManager.isRTL` is fixed when the bundle boots, so this is how a mirrored launch looks. */
  function bootedAs(direction: 'ltr' | 'rtl'): void {
    Object.defineProperty(I18nManager, 'isRTL', {
      value: direction === 'rtl',
      configurable: true,
    });
  }

  afterEach(() => {
    bootedAs(originalIsRTL ? 'rtl' : 'ltr');
  });

  it.each([
    ['ltr', 1],
    ['rtl', -1],
  ] as const)('sweeps the way the language reads, in %s', async (direction, scaleX) => {
    bootedAs(direction);
    seed({ debts: { fajr: 12, dhuhr: 3, asr: 0, maghrib: 0, isha: 0 } });
    await renderScreen();

    // The arc is a **gauge**: it starts at twelve and fills clockwise as the debt grows, which
    // reads as "forward" — so in Arabic it fills the other way, exactly as a progress bar does.
    // Only the drawing surface turns; the numeral inside it is a sibling and stays upright.
    //
    // Deliberately unlike the History calendar's five-slot ring (see
    // `i18n/__tests__/mirroring.test.tsx`), which is a clock face and stays put in both directions.
    const style =
      StyleSheet.flatten(screen.getByTestId('qada-ring-fajr').props.style as ViewStyle) ?? {};
    expect(style.transform).toEqual([{ scaleX }]);

    // The count itself is never mirrored — a reversed numeral is a different number.
    expect(screen.getByTestId('qada-row-fajr')).toBeTruthy();
  });
});
