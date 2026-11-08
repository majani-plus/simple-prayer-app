/**
 * `StatCards` — the History tab's stats section. (The streak left this card for `StreakHero`; its
 * own copy is pinned there.)
 *
 * The numbers themselves belong to `domain/stats` and are tested there; what this file asserts is
 * that the section renders exactly what it was handed, that unlogged is reported as its own
 * category rather than folded into missed or into a row's shortfall, and that a bad window is
 * stated as plainly as a good one — no shaming copy anywhere.
 */

import { act, configure, fireEvent, render, screen, within } from '@testing-library/react-native';

import { getAnimatedStyle } from '@/testing/reanimated';

import { StatCards } from '../StatCards';
import { computeStats } from '@/domain/stats';
import { unloggedDayRecord } from '@/domain/streaks';
import { initI18n } from '@/i18n';

import type { DayRecord, Prayer, PrayerStatus, StatsSummary } from '@/domain/types';

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

configure({ defaultIncludeHiddenElements: true });

const TODAY = '2026-08-19';

function dayRecord(day: string, statuses: Partial<Record<Prayer, PrayerStatus>>): DayRecord {
  const base = unloggedDayRecord(day);
  return { ...base, statuses: { ...base.statuses, ...statuses } };
}

/** Real summaries from the real domain — this component must never disagree with them. */
function summaryOf(records: DayRecord[], windowDays: number | null = 7): StatsSummary {
  return computeStats(records, { windowDays, todayDay: TODAY });
}

const onSelectWindow = jest.fn();

/** A status-bar fill's share of its bar, as flexbox sees it. */
function shareOf(testID: string): number | undefined {
  return (getAnimatedStyle(screen.getByTestId(testID)) as { flexGrow?: number }).flexGrow;
}

async function renderStats(overrides: Partial<React.ComponentProps<typeof StatCards>> = {}) {
  const stats = summaryOf([
    dayRecord('2026-08-19', { fajr: 'prayed', dhuhr: 'prayed', asr: 'late' }),
    dayRecord('2026-08-18', { fajr: 'missed', dhuhr: 'prayed' }),
  ]);
  return render(
    <StatCards
      testID="stats"
      stats={stats}
      lifetime={stats}
      window={7}
      onSelectWindow={onSelectWindow}
      mostMissed="fajr"
      mostLate="asr"
      {...overrides}
    />
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the window switch', () => {
  it('offers 7 and 30 days and reports the choice', async () => {
    await renderStats();

    expect(screen.getByTestId('stat-window-7').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('stat-window-30').props.accessibilityState.selected).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByTestId('stat-window-30'));
    });
    expect(onSelectWindow).toHaveBeenCalledWith(30);
  });
});

describe('completion and the per-prayer bars', () => {
  it('renders the rates the domain computed, with the on-time / late split', async () => {
    await renderStats();

    // 3 prayed + 1 late out of 5 obligated (the missed Fajr included, the unlogged excluded).
    expect(screen.getByTestId('stat-completion-rate').props.children).toBe('80%');
    expect(screen.getByTestId('stat-ontime-rate').props.children).toBe('75%');
    expect(screen.getByText(/3 on time · 1 late · 1 missed · 5 not marked/)).toBeTruthy();
  });

  it('reports unlogged as its own category, never as missed', async () => {
    const stats = summaryOf([dayRecord('2026-08-19', { fajr: 'prayed' })]);
    await renderStats({ stats });

    // Four unlogged prayers, and not one of them counted as a miss.
    expect(screen.getByTestId('stat-prayer-dhuhr').props.accessibilityLabel).toContain(
      '0 prayed, 0 late, 0 missed'
    );
    expect(screen.getByText(/4 not marked/)).toBeTruthy();
  });

  it('gives every prayer a row and spells the counts out for a screen reader', async () => {
    await renderStats();

    expect(screen.getByTestId('stat-prayer-fajr').props.accessibilityLabel).toBe(
      'Fajr: 1 prayed, 0 late, 1 missed'
    );
    for (const prayer of ['dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(screen.getByTestId(`stat-prayer-${prayer}`)).toBeTruthy();
    }
  });

  it('captions each row with what was answered out of what was owed', async () => {
    await renderStats();

    // Fajr: prayed once, missed once. Dhuhr: prayed twice. Asr: late once, never obligated on
    // the other day — so its denominator is 1, not 2.
    expect(within(screen.getByTestId('stat-prayer-fajr')).getByText('1 of 2')).toBeTruthy();
    expect(within(screen.getByTestId('stat-prayer-dhuhr')).getByText('2 of 2')).toBeTruthy();
    expect(within(screen.getByTestId('stat-prayer-asr')).getByText('1 of 1')).toBeTruthy();
    // Nothing was ever obligated for Maghrib in this window: an em dash, not "0 of 0".
    expect(within(screen.getByTestId('stat-prayer-maghrib')).getByText('—')).toBeTruthy();
  });

  it('leaves unlogged out of the bars entirely — it is the track, not a miss', async () => {
    await renderStats();

    // Asr was late once and unmarked once: half the bar is the late colour and the other half is
    // bare track. If unlogged were ever folded into missed, this row would draw a miss.
    expect(shareOf('stat-prayer-asr-bar-late')).toBeCloseTo(0.5);
    expect(shareOf('stat-prayer-asr-bar-missed')).toBe(0);
    // Maghrib was never marked at all: an empty bar.
    for (const fill of ['prayed', 'late', 'missed']) {
      expect(shareOf(`stat-prayer-maghrib-bar-${fill}`)).toBe(0);
    }
  });

  it('draws the window’s own bar under the completion figures', async () => {
    await renderStats();

    // 3 prayed, 1 late, 1 missed, 5 never marked — out of ten.
    expect(shareOf('stat-completion-bar-prayed')).toBeCloseTo(0.3);
    expect(shareOf('stat-completion-bar-late')).toBeCloseTo(0.1);
    expect(shareOf('stat-completion-bar-missed')).toBeCloseTo(0.1);
  });

  it('names the most missed and the most often late prayer', async () => {
    await renderStats();
    expect(screen.getByText(/most missed: Fajr/)).toBeTruthy();
    expect(screen.getByText(/most often late: Asr/)).toBeTruthy();
  });

  it('says nothing rather than picking a prayer when there is nothing to name', async () => {
    await renderStats({ mostMissed: null, mostLate: null });
    expect(screen.getByTestId('stat-callouts').props.children).toBe(
      'most missed: — · most often late: —'
    );
  });
});

describe('lifetime totals', () => {
  it('shows the lifetime figures', async () => {
    await renderStats();

    expect(screen.getByTestId('stat-lifetime-prayed').props.children).toBe('4');
    expect(screen.getByTestId('stat-lifetime-ontime').props.children).toBe('3');
    expect(screen.getByTestId('stat-lifetime-fulldays').props.children).toBe('0');
  });
});

describe('an empty history', () => {
  it('renders one calm line instead of a wall of zeroes', async () => {
    const empty = summaryOf([]);
    await renderStats({ stats: empty, lifetime: empty, mostMissed: null, mostLate: null });

    expect(screen.getByTestId('stat-empty')).toBeTruthy();
    expect(screen.queryByTestId('stat-lifetime')).toBeNull();
    expect(
      screen.getByText('Nothing marked yet. Whatever you mark will gather here.')
    ).toBeTruthy();
  });

  it('shows an em dash rather than a zero percent when nothing was obligated', async () => {
    const empty = summaryOf([]);
    await renderStats({ stats: empty, lifetime: empty });

    expect(screen.getByTestId('stat-completion-rate').props.children).toBe('—');
    expect(screen.getByTestId('stat-ontime-rate').props.children).toBe('—');
  });
});
