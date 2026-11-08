/**
 * Unit tests for `useHistory` — the History tab's single answer to "which month, which days,
 * which numbers".
 *
 * The screen test already covers what a user sees; what is left here is the wiring underneath it,
 * where the failures are invisible until they are not:
 *
 * 1. **Bounded loading.** Three months around the visible one, one dense query each, never a
 *    future month, and never the same month twice.
 * 2. **Re-reading after the cache is dropped.** The tracking store empties its day cache whenever
 *    something changes that re-resolves every day (an exempt period is recorded, the database is
 *    re-hydrated). The hook has to notice and read the visible month again — a calendar that
 *    silently goes blank until the user pages away and back is worse than a slow one.
 * 3. **The future is not a place.** Neither the month offset nor the selection can point at it,
 *    whatever the caller does.
 *
 * The tracking store is mocked, but as a REAL zustand store: the whole point of these cases is
 * that the hook reacts to the store changing underneath it, which a plain object mock cannot show.
 * `dayRecords` is filled densely by `loadRange`, exactly as the real store does.
 */

import { act, renderHook } from '@testing-library/react-native';
import { create } from 'zustand';

import { useHistory } from './useHistory';
import { daysBetween } from '@/domain/dates';
import { unloggedDayRecord } from '@/domain/streaks';
import { useSettingsStore } from '@/stores/settingsStore';

import type { DayRecord, PrayerDay, StatsSummary, StreakSummary } from '@/domain/types';

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

const EMPTY_STREAK: StreakSummary = {
  mode: 'soft',
  current: 0,
  best: 0,
  currentStartedOn: null,
  bestStartedOn: null,
};

const EMPTY_STATS = {
  windowDays: 7,
  daysConsidered: 0,
  totalTracked: 0,
  prayed: 0,
  late: 0,
  missed: 0,
  unlogged: 0,
  exempt: 0,
  completionRate: null,
  onTimeRate: null,
  fullyCompletedDays: 0,
  byPrayer: [],
} as unknown as StatsSummary;

interface MockTrackingState {
  hydrated: boolean;
  revision: number;
  dayRecords: Record<PrayerDay, DayRecord>;
  today: PrayerDay;
  todayDay: () => PrayerDay;
  streakSummary: () => StreakSummary;
  statsFor: (windowDays: number | null) => StatsSummary;
  loadRange: (from: PrayerDay, to: PrayerDay) => DayRecord[];
  /** What the store does when something re-resolves every day: drop the cache, bump the clock. */
  invalidateDays: () => void;
}

/** Every range the hook asked for, in order. */
const mockRanges: [PrayerDay, PrayerDay][] = [];

const mockStore = create<MockTrackingState>((set, get) => ({
  hydrated: true,
  revision: 0,
  dayRecords: {},
  today: '2026-08-19',
  todayDay: () => get().today,
  streakSummary: () => EMPTY_STREAK,
  statsFor: () => EMPTY_STATS,
  loadRange: (from, to) => {
    mockRanges.push([from, to]);
    const records = daysBetween(from, to).map((day) => unloggedDayRecord(day));
    set((state) => ({
      dayRecords: Object.fromEntries([
        ...Object.entries(state.dayRecords),
        ...records.map((record) => [record.day, record] as const),
      ]),
    }));
    return records;
  },
  invalidateDays: () => {
    set((state) => ({ dayRecords: {}, revision: state.revision + 1 }));
  },
}));

jest.mock('@/stores/trackingStore', () => ({
  useTrackingHydrated: () => mockStore((state) => state.hydrated),
  useTrackingActions: () => mockStore.getState(),
  useTrackingStore: (selector: (state: MockTrackingState) => unknown) => mockStore(selector),
}));

beforeEach(() => {
  mockRanges.length = 0;
  mockStore.setState({ hydrated: true, revision: 0, dayRecords: {}, today: '2026-08-19' });
  useSettingsStore.getState().setLocation(null);
  useSettingsStore.getState().setExemptionModeEnabled(false);
});

describe('bounded loading', () => {
  it('reads the visible month and the one before it, and never a future one', async () => {
    await renderHook(() => useHistory());

    expect(mockRanges).toEqual([
      ['2026-07-01', '2026-07-31'],
      ['2026-08-01', '2026-08-31'],
    ]);
  });

  it('reads each month once, however often it is paged over', async () => {
    const { result } = await renderHook(() => useHistory());

    await act(async () => {
      result.current.goToPreviousMonth();
    });
    await act(async () => {
      result.current.goToNextMonth();
    });
    await act(async () => {
      result.current.goToPreviousMonth();
    });

    expect(mockRanges).toEqual([
      ['2026-07-01', '2026-07-31'],
      ['2026-08-01', '2026-08-31'],
      ['2026-06-01', '2026-06-30'],
    ]);
  });

  it('re-reads the visible month after the store drops its day cache', async () => {
    const { result } = await renderHook(() => useHistory());
    expect(mockRanges).toHaveLength(2);
    mockRanges.length = 0;

    // What recording an exempt period (or re-hydrating) does to the store: every cached day is
    // dropped, because every one of them may resolve differently now.
    await act(async () => {
      mockStore.getState().invalidateDays();
    });

    // The calendar must not be left holding an empty month it never reads again.
    expect(mockRanges).toContainEqual(['2026-08-01', '2026-08-31']);
    expect(Object.keys(result.current.records).length).toBeGreaterThan(0);
  });
});

describe('the future', () => {
  it('cannot be paged into, from the current month', async () => {
    const { result } = await renderHook(() => useHistory());

    expect(result.current.canGoNext).toBe(false);
    await act(async () => {
      result.current.goToNextMonth();
    });

    expect(result.current.month.key).toBe('2026-08');
    expect(mockRanges.every(([from]) => from <= '2026-08-01')).toBe(true);
  });

  it('crosses the year boundary backwards without inventing a month', async () => {
    mockStore.setState({ today: '2027-01-14' });
    const { result } = await renderHook(() => useHistory());

    await act(async () => {
      result.current.goToPreviousMonth();
    });

    expect(result.current.month).toEqual({ year: 2026, monthIndex0: 11, key: '2026-12' });
    expect(mockRanges).toContainEqual(['2026-12-01', '2026-12-31']);
    expect(mockRanges).toContainEqual(['2026-11-01', '2026-11-30']);
  });

  it('refuses to select a future day, and drops a selection that becomes one', async () => {
    const { result } = await renderHook(() => useHistory());

    await act(async () => {
      result.current.selectDay('2026-08-20');
    });
    expect(result.current.selectedDay).toBeNull();

    await act(async () => {
      result.current.selectDay('2026-08-18');
    });
    expect(result.current.selectedDay).toBe('2026-08-18');

    // The clock moved backwards (a timezone change, a device clock correction): the day the sheet
    // is showing is now in the future, so it stops being a selection rather than staying editable.
    await act(async () => {
      mockStore.setState({ today: '2026-08-17', revision: 1 });
    });
    expect(result.current.selectedDay).toBeNull();
  });
});
