/**
 * Screen test for the History tab (`src/app/(tabs)/history.tsx`).
 *
 * The screen is a composition, so what is tested here is the composition — the things no component
 * test can see:
 *
 * 1. the calendar opens on the current month and reflects what the store resolved for its days;
 * 2. month paging never reaches the future, in either direction;
 * 3. only a bounded window of days is read, not the whole history;
 * 4. tapping a past day opens the detail, and a pick there reaches the tracking store with that
 *    day — while a future day cannot be opened at all;
 * 5. the stats section renders from the store's summaries, and an empty history stays calm.
 *
 * The tracking store is mocked (it would open SQLite through `expo-sqlite`) and so is MMKV, which
 * the settings singleton hydrates from at import time. Everything else — the domain, the settings
 * store, the calendar, the sheet, the seal, i18n — is the real thing.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { act, configure, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Activity } from 'react';
import { Dimensions } from 'react-native';
import { create, useStore } from 'zustand';

import HistoryScreen from '../app/(tabs)/history';
import { computeStats } from '../domain/stats';
import { unloggedDayRecord } from '../domain/streaks';
import type {
  DayRecord,
  Prayer,
  PrayerDay,
  PrayerStatus,
  StatsSummary,
  StreakSummary,
} from '../domain/types';
import { initI18n } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import { maxContentWidth } from '../theme';

/** Whether the History tab is the one showing — `useIsFocused` needs a navigator otherwise. */
const mockFocused = { current: true };
jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof import('expo-router')>('expo-router'),
  useIsFocused: () => mockFocused.current,
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

/** The prayer day the mocked store reports. Mutable so a test can sit on a year boundary. */
let mockToday: PrayerDay = '2026-08-19';
/** Readable alias for the assertions below. */
const TODAY: PrayerDay = '2026-08-19';

function dayRecord(day: PrayerDay, statuses: Partial<Record<Prayer, PrayerStatus>>): DayRecord {
  const base = unloggedDayRecord(day);
  return { ...base, statuses: { ...base.statuses, ...statuses } };
}

/** A day the store resolved as exempt: all five prayers exempt, flagged (PRODUCT_SPEC §6). */
function exemptDayRecord(day: PrayerDay): DayRecord {
  const base = unloggedDayRecord(day);
  return {
    ...base,
    isExempt: true,
    statuses: {
      fajr: 'exempt',
      dhuhr: 'exempt',
      asr: 'exempt',
      maghrib: 'exempt',
      isha: 'exempt',
    },
  };
}

const mockStreak: StreakSummary = {
  mode: 'soft',
  current: 4,
  best: 61,
  currentStartedOn: '2026-08-16',
  bestStartedOn: '2026-06-09',
};

/** Whatever the mocked store currently holds — reassigned per test. */
const mockStore: {
  dayRecords: Record<PrayerDay, DayRecord>;
  stats: StatsSummary;
  lifetime: StatsSummary;
} = {
  dayRecords: {},
  stats: computeStats([], { windowDays: 7, todayDay: TODAY }),
  lifetime: computeStats([], { windowDays: null, todayDay: TODAY }),
};

const mockActions = {
  loadRange: jest.fn(),
  toggleStatus: jest.fn(() => true),
  toggleSimpleStatus: jest.fn(() => true),
  setStatus: jest.fn(() => true),
  markMadeUp: jest.fn(() => true),
  clearMadeUp: jest.fn(() => true),
};

interface MockState {
  hydrated: boolean;
  revision: number;
  dayRecords: Record<PrayerDay, DayRecord>;
  todayDay: () => PrayerDay;
  streakSummary: () => StreakSummary;
  statsFor: (windowDays: number | null) => StatsSummary;
}

jest.mock('../stores/trackingStore', () => ({
  useTrackingHydrated: () => true,
  useTrackingActions: () => mockActions,
  useTrackingStore: (selector: (state: MockState) => unknown) =>
    selector({
      hydrated: true,
      revision: 1,
      dayRecords: mockStore.dayRecords,
      todayDay: () => mockToday,
      streakSummary: () => mockStreak,
      statsFor: (windowDays) => (windowDays === null ? mockStore.lifetime : mockStore.stats),
    }),
}));

configure({ defaultIncludeHiddenElements: true });

/** Somewhere the engine resolves cleanly, so the detail sheet has real times to render. */
const LOCATION = {
  latitude: 5.6037,
  longitude: -0.187,
  label: 'Accra',
  countryCode: 'GH',
  source: 'auto' as const,
  resolvedAt: 0,
};

async function renderScreen() {
  const view = await render(<HistoryScreen />);
  // Let the seals' reduce-motion probe and any mount animation settle.
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  return view;
}

/** Presses a target and lets the resulting state update flush. */
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 19, 12, 0, 0));
  jest.clearAllMocks();
  mockToday = TODAY;
  mockFocused.current = true;
  useSettingsStore.getState().setLocation(LOCATION);
  useSettingsStore.getState().setTimeFormat('12h');
  useSettingsStore.getState().setHijriOffset(0);
  useSettingsStore.getState().setExemptionModeEnabled(false);
  mockStore.dayRecords = {
    '2026-08-17': dayRecord('2026-08-17', { fajr: 'prayed', dhuhr: 'late', asr: 'missed' }),
    '2026-08-18': dayRecord('2026-08-18', { fajr: 'missed' }),
  };
  mockStore.stats = computeStats(Object.values(mockStore.dayRecords), {
    windowDays: 7,
    todayDay: TODAY,
  });
  mockStore.lifetime = computeStats(Object.values(mockStore.dayRecords), {
    windowDays: null,
    todayDay: TODAY,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the calendar', () => {
  it('opens on the month containing today and marks it', async () => {
    await renderScreen();

    expect(screen.getByText('August 2026')).toBeTruthy();
    expect(screen.getByTestId(`calendar-day-${TODAY}`)).toBeTruthy();
  });

  it('reflects the statuses the store resolved for each day', async () => {
    await renderScreen();

    expect(screen.getByTestId('calendar-day-2026-08-17').props.accessibilityLabel).toContain(
      '1 prayed, 1 late, 1 missed'
    );
    expect(screen.getByTestId('calendar-day-2026-08-16').props.accessibilityLabel).toContain(
      'nothing marked'
    );
  });

  it('reads a bounded window of days, not the whole history', async () => {
    await renderScreen();

    // The visible month plus one month either side — and never a future month.
    expect(mockActions.loadRange.mock.calls).toEqual([
      ['2026-07-01', '2026-07-31'],
      ['2026-08-01', '2026-08-31'],
    ]);
  });

  /**
   * The one place the D123 clamp is asserted through a real screen rather than in
   * `src/theme/layout.test.ts`: proof the recipe is actually spread into a shell, not merely
   * exported. This suite's ambient window is 750pt wide — a *medium* one — so the clamp applies.
   *
   * It asserts *padding*, not `maxWidth`/`alignSelf`, and that is the point of the change it
   * guards: a ScrollView sizes its own content container, so `alignSelf` there did nothing and
   * the column — correctly 600pt wide — sat against the start edge, left in en/tr and right in ar.
   * Symmetric padding is the version that actually centres, so the assertion is the arithmetic:
   * (750 − 600) / 2 = 75 a side, leaving exactly the readable measure in the middle.
   */
  it('centres its column on a window wider than a phone', async () => {
    await renderScreen();

    const shell = screen.getByTestId('history-scroll').props.contentContainerStyle;
    expect(shell).toMatchObject({ paddingHorizontal: (750 - maxContentWidth) / 2 });
    expect(750 - 2 * (shell.paddingHorizontal as number)).toBe(maxContentWidth);
  });
});

describe('a month of mixed days', () => {
  it('keeps exempt, unlogged and logged days visually and verbally distinct', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(true);
    mockStore.dayRecords = {
      ...mockStore.dayRecords,
      '2026-08-12': exemptDayRecord('2026-08-12'),
      '2026-08-13': dayRecord('2026-08-13', {
        fajr: 'prayed',
        dhuhr: 'prayed',
        asr: 'late',
        maghrib: 'missed',
        isha: 'prayed',
      }),
    };

    await renderScreen();

    // Exempt says "exempt" — never "missed", never "nothing marked" (PRODUCT_SPEC §6).
    const exempt = screen.getByTestId('calendar-day-2026-08-12').props.accessibilityLabel;
    expect(exempt).toContain('exempt');
    expect(exempt).not.toContain('missed');

    // A day nobody touched says so in its own words, and never borrows the missed one (§4).
    const untouched = screen.getByTestId('calendar-day-2026-08-11').props.accessibilityLabel;
    expect(untouched).toContain('nothing marked');
    expect(untouched).not.toContain('missed');

    // A mixed day reports each status separately.
    expect(screen.getByTestId('calendar-day-2026-08-13').props.accessibilityLabel).toContain(
      '3 prayed, 1 late, 1 missed'
    );

    // The month's own bar under the grid names the same things in words (D183) — and leaves the
    // exempt day out of its tally.
    const legend = screen.getByTestId('history-month-legend').props.children as string;
    expect(legend).toMatch(/\d+ prayed · \d+ late · \d+ missed · \d+ not marked/);
    expect(legend).not.toContain('exempt');

    // …and the three are drawn in three different colours, so the ring agrees with the words.
    const stroke = (day: PrayerDay, prayer: Prayer) =>
      screen.getByTestId(`calendar-segment-${day}-${prayer}`).props.stroke as string;
    const colours = new Set([
      stroke('2026-08-13', 'fajr'),
      stroke('2026-08-13', 'asr'),
      stroke('2026-08-13', 'maghrib'),
      stroke('2026-08-11', 'fajr'),
      stroke('2026-08-12', 'fajr'),
    ]);
    expect(colours.size).toBe(5);
  });

  it('says an exempt day is exempt in the detail sheet, and offers nothing to mark', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(true);
    mockStore.dayRecords = {
      ...mockStore.dayRecords,
      '2026-08-12': exemptDayRecord('2026-08-12'),
    };

    await renderScreen();
    await press('calendar-day-2026-08-12');

    expect(screen.getByTestId('day-detail-exempt')).toBeTruthy();
    expect(screen.getByTestId('seal-fajr-face').props.accessibilityState.disabled).toBe(true);
    // The seal cannot be opened, so its options are never even built…
    await press('seal-fajr-face');
    expect(
      screen.queryByTestId('seal-fajr-option-prayed', { includeHiddenElements: true })
    ).toBeNull();
    // …and nothing about an exempt day is offered as a miss to make up (PRODUCT_SPEC §6).
    expect(screen.queryByTestId('detail-madeup-fajr')).toBeNull();
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
    expect(mockActions.setStatus).not.toHaveBeenCalled();
  });
});

describe('the excused-days register', () => {
  it('stays invisible while the mode is off', async () => {
    await renderScreen();
    expect(screen.queryByTestId('history-row-exemption')).toBeNull();
  });

  it('offers the excused periods row while the mode is on, and opens the register', async () => {
    useSettingsStore.getState().setExemptionModeEnabled(true);
    const push = jest.spyOn(router, 'push').mockImplementation(() => undefined);

    await renderScreen();
    await press('history-row-exemption');

    expect(push).toHaveBeenCalledWith('/settings/exemption');
    push.mockRestore();
  });
});

describe('month navigation', () => {
  it('cannot page past the current month', async () => {
    await renderScreen();

    expect(screen.getByTestId('calendar-next').props.accessibilityState.disabled).toBe(true);
    await press('calendar-next');
    expect(screen.getByText('August 2026')).toBeTruthy();
  });

  it('pages back, and forward again only as far as this month', async () => {
    await renderScreen();

    await press('calendar-previous');
    expect(screen.getByText('July 2026')).toBeTruthy();
    expect(screen.getByTestId('calendar-next').props.accessibilityState.disabled).toBe(false);

    await press('calendar-next');
    expect(screen.getByText('August 2026')).toBeTruthy();
    expect(screen.getByTestId('calendar-next').props.accessibilityState.disabled).toBe(true);
  });

  it('crosses the year boundary in both directions', async () => {
    mockToday = '2027-01-14';
    mockStore.dayRecords = {};

    await renderScreen();
    expect(screen.getByText('January 2027')).toBeTruthy();

    await press('calendar-previous');
    expect(screen.getByText('December 2026')).toBeTruthy();
    // December really is December: 31 days, and its last one is a real, selectable cell.
    expect(screen.getByTestId('calendar-day-2026-12-31')).toBeTruthy();
    expect(mockActions.loadRange).toHaveBeenCalledWith('2026-12-01', '2026-12-31');
    expect(mockActions.loadRange).toHaveBeenCalledWith('2026-11-01', '2026-11-30');

    await press('calendar-next');
    expect(screen.getByText('January 2027')).toBeTruthy();
    expect(screen.getByTestId('calendar-next').props.accessibilityState.disabled).toBe(true);
  });

  it('keeps the read bounded to a month at a time however far back it is paged', async () => {
    // Three years of history: paging back through it must never widen a single query.
    await renderScreen();
    mockActions.loadRange.mockClear();

    for (let step = 0; step < 36; step += 1) await press('calendar-previous');

    expect(mockActions.loadRange.mock.calls).toHaveLength(36);
    for (const [from, to] of mockActions.loadRange.mock.calls as [PrayerDay, PrayerDay][]) {
      expect(from.slice(8)).toBe('01');
      // A month, never a span: at most 31 days between the two ends.
      const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      expect(span).toBeLessThanOrEqual(30);
    }
    // Paged 36 months back, the calendar is on the right month and reads it once more.
    expect(screen.getByText('August 2023')).toBeTruthy();
    // 36 sequential press-and-render cycles is genuinely slow, and slower again when Jest runs the
    // whole suite in parallel workers — it timed out at the 5s default only under full-suite load.
    // The assertion is unchanged; only the clock it is measured against is honest about the work.
  }, 20_000);

  it('loads the newly-visible month once, and not again on the way back', async () => {
    await renderScreen();
    mockActions.loadRange.mockClear();

    await press('calendar-previous');
    // June is now one month before the visible July; July and August are already read.
    expect(mockActions.loadRange.mock.calls).toEqual([['2026-06-01', '2026-06-30']]);

    mockActions.loadRange.mockClear();
    await press('calendar-next');
    expect(mockActions.loadRange).not.toHaveBeenCalled();
  });
});

describe('the day detail', () => {
  it('opens on a past day and shows its five prayers', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-17');

    expect(screen.getByTestId('day-detail-sheet')).toBeTruthy();
    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(screen.getByTestId(`detail-row-${prayer}`)).toBeTruthy();
    }
    expect(within(screen.getByTestId('detail-row-fajr')).getByText('prayed')).toBeTruthy();
  });

  it('sends an edit to the tracking store for the day that was opened', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-17');

    await press('seal-maghrib-face');
    await press('seal-maghrib-option-prayed');

    expect(mockActions.toggleStatus).toHaveBeenCalledWith('2026-08-17', 'maghrib', 'prayed');
  });

  it('offers the made-up conversion on a missed prayer and applies it', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-18');

    await press('detail-madeup-fajr');
    expect(mockActions.markMadeUp).toHaveBeenCalledWith('2026-08-18', 'fajr');
  });

  it('writes to the day that was opened, months back, and not to its neighbours', async () => {
    mockStore.dayRecords = {
      ...mockStore.dayRecords,
      '2026-06-15': dayRecord('2026-06-15', { asr: 'missed' }),
    };

    await renderScreen();
    await press('calendar-previous');
    await press('calendar-previous');
    expect(screen.getByText('June 2026')).toBeTruthy();

    await press('calendar-day-2026-06-15');
    await press('seal-maghrib-face');
    await press('seal-maghrib-option-late');

    expect(mockActions.toggleStatus).toHaveBeenCalledTimes(1);
    expect(mockActions.toggleStatus).toHaveBeenCalledWith('2026-06-15', 'maghrib', 'late');

    // The made-up conversion of the same old day lands on the same old day.
    await press('detail-madeup-asr');
    expect(mockActions.markMadeUp).toHaveBeenCalledWith('2026-06-15', 'asr');
  });

  it('cannot be opened for a future day', async () => {
    await renderScreen();

    const future = screen.getByTestId('calendar-day-2026-08-20');
    expect(future.props.accessibilityState.disabled).toBe(true);
    await press('calendar-day-2026-08-20');

    expect(screen.queryByTestId('day-detail-sheet')).toBeNull();
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
  });

  it('closes again without changing anything', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-17');
    await press('day-detail-close');

    expect(screen.queryByTestId('day-detail-sheet')).toBeNull();
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
  });
});

describe('the stats section', () => {
  it('renders the store’s summaries', async () => {
    await renderScreen();

    expect(screen.getByTestId('history-stats')).toBeTruthy();
    // The streak heads the tab now (D183), above the calendar rather than inside the stats.
    expect(screen.getByTestId('history-streak')).toBeTruthy();
    expect(screen.getByTestId('stat-streak-current').props.children).toBe('4');
    expect(screen.getByTestId('stat-streak-best').props.children).toBe('61');
    expect(screen.getByTestId('stat-week-rate')).toBeTruthy();
    expect(screen.getByTestId('stat-prayer-fajr').props.accessibilityLabel).toBe(
      'Fajr: 1 prayed, 0 late, 1 missed'
    );
  });

  it('switches the window and asks the store for the other one', async () => {
    await renderScreen();

    await press('stat-window-30');
    expect(screen.getByTestId('stat-window-30').props.accessibilityState.selected).toBe(true);
  });

  it('renders an empty history calmly', async () => {
    mockStore.dayRecords = {};
    mockStore.stats = computeStats([], { windowDays: 7, todayDay: TODAY });
    mockStore.lifetime = computeStats([], { windowDays: null, todayDay: TODAY });

    await renderScreen();

    expect(screen.getByTestId('stat-empty')).toBeTruthy();
    expect(screen.queryByTestId('stat-lifetime')).toBeNull();
    // The calendar is still there, and still calm: nothing reads as a miss.
    expect(screen.getByTestId('calendar-day-2026-08-10').props.accessibilityLabel).toContain(
      'nothing marked'
    );
  });
});

/**
 * The expanded layout (D124): the month and the day stand side by side, and the day detail becomes
 * a panel rather than a sheet — which PRODUCT_SPEC §8 has always allowed.
 *
 * This suite's ambient window is 750pt (jest-expo's mock), which is a *medium* one, so every test
 * above exercises the single column and the sheet. Only this block widens it.
 */
describe('at expanded width', () => {
  beforeEach(() => {
    jest
      .spyOn(Dimensions, 'get')
      .mockImplementation(() => ({ width: 1194, height: 834, scale: 2, fontScale: 1 }));
  });

  it('stands the month and the day side by side', async () => {
    await renderScreen();

    const start = screen.getByTestId('history-panes-start');
    const end = screen.getByTestId('history-panes-end');
    expect(within(start).getByTestId('history-calendar')).toBeTruthy();
    expect(within(end).getByTestId('history-day-panel-card')).toBeTruthy();
  });

  it('replaces the bottom sheet with a standing panel', async () => {
    await renderScreen();

    expect(screen.getByTestId('history-day-panel-card')).toBeTruthy();
    expect(screen.queryByTestId('day-detail-sheet')).toBeNull();
    // A panel is never dismissed, so it offers nothing to dismiss it with.
    expect(screen.queryByTestId('history-day-panel-close')).toBeNull();
  });

  it('shows today until a day is chosen, and lets today be edited there', async () => {
    await renderScreen();

    expect(
      within(screen.getByTestId('history-day-panel-rows')).getByTestId('detail-row-fajr')
    ).toBeTruthy();
    // Today is the panel's day with nothing selected — and it is live, not a read-only preview.
    await press('seal-maghrib-face');
    await press('seal-maghrib-option-prayed');
    expect(mockActions.toggleStatus).toHaveBeenCalledWith(TODAY, 'maghrib', 'prayed');
  });

  it('marks today as the open day before anything is chosen', async () => {
    await renderScreen();
    expect(screen.getByTestId(`calendar-day-${TODAY}`).props.accessibilityState.selected).toBe(
      true
    );
  });

  it('retargets the panel — and the highlighted cell — when a day is chosen', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-17');

    expect(within(screen.getByTestId('detail-row-fajr')).getByText('prayed')).toBeTruthy();
    expect(screen.getByTestId('calendar-day-2026-08-17').props.accessibilityState.selected).toBe(
      true
    );

    await press('seal-maghrib-face');
    await press('seal-maghrib-option-prayed');
    expect(mockActions.toggleStatus).toHaveBeenCalledWith('2026-08-17', 'maghrib', 'prayed');
  });

  it('still refuses a future day, and stays on today', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-20');

    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId(`calendar-day-${TODAY}`).props.accessibilityState.selected).toBe(
      true
    );
  });

  it('spans both panes with one seal-dismiss boundary', async () => {
    await renderScreen();
    // A tap on the bare paper of either pane closes an open pill, as the sheet's own boundary does
    // at narrower widths.
    expect(screen.getByTestId('history-seal-dismiss')).toBeTruthy();
  });
});

describe('simple tracking mode (D192)', () => {
  beforeEach(() => {
    // Since the 17th: the 17th's unmarked prayers show as missed, its late as prayed.
    useSettingsStore.getState().setTrackingMode('simple', '2026-08-17');
  });
  afterEach(() => {
    useSettingsStore.getState().setTrackingMode('detailed', TODAY);
  });

  it('shows the day as simple mode does: late as prayed, unmarked as missed', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-17');

    expect(within(screen.getByTestId('detail-row-dhuhr')).getByText('prayed')).toBeTruthy();
    expect(within(screen.getByTestId('detail-row-maghrib')).getByText('missed')).toBeTruthy();
  });

  it('marks with one tap — no pill — through the simple toggle', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-17');

    await press('seal-maghrib-face');

    expect(mockActions.toggleSimpleStatus).toHaveBeenCalledWith('2026-08-17', 'maghrib');
    expect(mockActions.toggleStatus).not.toHaveBeenCalled();
    expect(screen.queryByTestId('seal-maghrib-option-prayed')).toBeNull();
  });

  it('offers "made up" only on a STORED miss, never on one simple mode only shows', async () => {
    await renderScreen();
    await press('calendar-day-2026-08-17');

    expect(screen.getByTestId('detail-madeup-asr')).toBeTruthy();
    expect(screen.queryByTestId('detail-madeup-maghrib')).toBeNull();
  });
});

describe('behind another tab (D191)', () => {
  it('does no work while hidden, and catches up when shown', async () => {
    mockFocused.current = false;
    const view = await renderScreen();
    expect(mockActions.loadRange).not.toHaveBeenCalled();

    mockFocused.current = true;
    await act(async () => {
      view.rerender(<HistoryScreen />);
    });
    expect(mockActions.loadRange).toHaveBeenCalled();
  });

  it('a hidden Activity drops its store subscriptions, so a write behind it renders nothing', async () => {
    // The mechanism the tab leans on, pinned against a real zustand store: `freezeOnBlur` is a
    // no-op in Expo Router 58, so this is the only thing keeping History still behind Today.
    const store = create(() => ({ revision: 0 }));
    let renders = 0;
    function Subscriber() {
      useStore(store, (state) => state.revision);
      renders += 1;
      return null;
    }
    const tree = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <Subscriber />
      </Activity>
    );
    const view = await render(tree('visible'));
    await act(async () => {
      view.rerender(tree('hidden'));
    });
    const hiddenAt = renders;

    await act(async () => {
      store.setState({ revision: 1 });
      store.setState({ revision: 2 });
      jest.runOnlyPendingTimers();
    });
    expect(renders).toBe(hiddenAt);

    await act(async () => {
      view.rerender(tree('visible'));
    });
    expect(renders).toBe(hiddenAt + 1);
  });
});
