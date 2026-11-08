/**
 * `CalendarMonth` — the History tab's month grid.
 *
 * What is asserted here is everything the grid promises and nothing about how it draws: the shape
 * of the month (6×7, padding cells blank, never a neighbouring month's date), that every cell
 * reflects the statuses the store resolved for its day, that an exempt day reads as exempt rather
 * than as a miss, that a future day is inert, and that the arrows can never page into the future.
 */

import { act, configure, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import {
  CALENDAR_CELL_HEIGHT,
  CALENDAR_RING_SIZE,
  CalendarMonth,
  calendarCellMetrics,
  tallyDay,
} from '../CalendarMonth';
import { monthGrid } from '@/domain/dates';
import { unloggedDayRecord } from '@/domain/streaks';
import { PRAYERS } from '@/domain/types';
import { initI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

import type { DayRecord, Prayer, PrayerDay, PrayerStatus } from '@/domain/types';

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

configure({ defaultIncludeHiddenElements: true });

const TODAY: PrayerDay = '2026-08-19';
const YEAR = 2026;
const MONTH0 = 7; // August

/** A record with the given statuses; anything unnamed stays unlogged. */
function recordWith(day: PrayerDay, statuses: Partial<Record<Prayer, PrayerStatus>>): DayRecord {
  const base = unloggedDayRecord(day);
  return { ...base, statuses: { ...base.statuses, ...statuses } };
}

function exemptRecord(day: PrayerDay): DayRecord {
  return {
    ...unloggedDayRecord(day),
    statuses: { fajr: 'exempt', dhuhr: 'exempt', asr: 'exempt', maghrib: 'exempt', isha: 'exempt' },
    isExempt: true,
  };
}

/**
 * A segment's stroke, as a comparable string. `react-native-svg` normalises a colour prop into an
 * opaque `{ type, payload }` object, so identity comparison would be meaningless.
 */
function strokeOf(day: PrayerDay, prayer: Prayer): string {
  return JSON.stringify(screen.getByTestId(`calendar-segment-${day}-${prayer}`).props.stroke);
}

const handlers = {
  onPreviousMonth: jest.fn(),
  onNextMonth: jest.fn(),
  onSelectDay: jest.fn(),
};

async function renderCalendar(overrides: Partial<React.ComponentProps<typeof CalendarMonth>> = {}) {
  return render(
    <CalendarMonth
      testID="calendar"
      year={YEAR}
      monthIndex0={MONTH0}
      records={{}}
      today={TODAY}
      canGoNext={false}
      weekStartsOn={0}
      {...handlers}
      {...overrides}
    />
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  useSettingsStore.getState().setHijriOffset(0);
});

describe('the grid', () => {
  it('renders every day of the month once, and no neighbouring dates', async () => {
    await renderCalendar();

    // August 2026 has 31 days.
    for (let dayOfMonth = 1; dayOfMonth <= 31; dayOfMonth += 1) {
      const day = `2026-08-${String(dayOfMonth).padStart(2, '0')}`;
      expect(screen.getByTestId(`calendar-day-${day}`)).toBeTruthy();
    }
    // The last day of July and the first of September are padding, not cells.
    expect(screen.queryByTestId('calendar-day-2026-07-31')).toBeNull();
    expect(screen.queryByTestId('calendar-day-2026-09-01')).toBeNull();
  });

  it('lays the days out in the columns domain/dates decided on', async () => {
    await renderCalendar();
    const grid = monthGrid(YEAR, MONTH0, 0);

    grid.forEach((cells, rowIndex) => {
      if (cells.every((cell) => cell === null)) {
        expect(screen.queryByTestId(`calendar-row-${String(rowIndex)}`)).toBeNull();
        return;
      }
      const row = screen.getByTestId(`calendar-row-${String(rowIndex)}`);
      for (const day of cells) {
        if (day === null) continue;
        expect(within(row).getByTestId(`calendar-day-${day}`)).toBeTruthy();
      }
    });
  });

  it('names the Gregorian month and the Hijri months it spans', async () => {
    await renderCalendar();

    expect(screen.getByText('August 2026')).toBeTruthy();
    // 1–31 August 2026 runs from Safar 1448 into Rabiʿ al-Awwal 1448.
    expect(screen.getByText(/Safar/)).toBeTruthy();
    expect(screen.getByText(/Rabi/)).toBeTruthy();
  });
});

describe('a day cell', () => {
  it('draws one ring segment per prayer, coloured by that prayer’s status', async () => {
    const day: PrayerDay = '2026-08-03';
    await renderCalendar({
      records: { [day]: recordWith(day, { fajr: 'prayed', dhuhr: 'late', asr: 'missed' }) },
    });

    const colorOf = (prayer: Prayer) => strokeOf(day, prayer);

    // Four distinct treatments for four distinct meanings — and the two unlogged prayers keep
    // the faint track rather than being drawn as misses (PRODUCT_SPEC §4).
    const prayed = colorOf('fajr');
    const late = colorOf('dhuhr');
    const missed = colorOf('asr');
    const unlogged = colorOf('maghrib');
    expect(new Set([prayed, late, missed, unlogged]).size).toBe(4);
    expect(colorOf('isha')).toBe(unlogged);
  });

  it('spells the day out in words, so the ring is never the only signal', async () => {
    const day: PrayerDay = '2026-08-03';
    await renderCalendar({
      records: { [day]: recordWith(day, { fajr: 'prayed', dhuhr: 'prayed', asr: 'late' }) },
    });

    expect(screen.getByTestId(`calendar-day-${day}`).props.accessibilityLabel).toContain(
      '2 prayed, 1 late, 0 missed'
    );
  });

  it('says “nothing marked” for an untouched past day rather than “missed”', async () => {
    await renderCalendar();

    const label = screen.getByTestId('calendar-day-2026-08-03').props.accessibilityLabel as string;
    expect(label).toContain('nothing marked');
    expect(label).not.toContain('missed');
  });

  it('renders an exempt day calmly — never as a missed one', async () => {
    const day: PrayerDay = '2026-08-05';
    await renderCalendar({ records: { [day]: exemptRecord(day) } });

    const cell = screen.getByTestId(`calendar-day-${day}`);
    expect(cell.props.accessibilityLabel).toContain('exempt');
    expect(cell.props.accessibilityLabel).not.toContain('missed');

    // Every segment is the same calm neutral, and none of them is the missed hue.
    const strokes = PRAYERS.map((prayer) => strokeOf(day, prayer));
    expect(new Set(strokes).size).toBe(1);

    const missedDay: PrayerDay = '2026-08-06';
    await renderCalendar({ records: { [missedDay]: recordWith(missedDay, { fajr: 'missed' }) } });
    expect(strokes[0]).not.toBe(strokeOf(missedDay, 'fajr'));
  });

  it('opens a past day and refuses a future one', async () => {
    await renderCalendar();

    fireEvent.press(screen.getByTestId('calendar-day-2026-08-18'));
    expect(handlers.onSelectDay).toHaveBeenCalledWith('2026-08-18');

    handlers.onSelectDay.mockClear();
    const future = screen.getByTestId('calendar-day-2026-08-20');
    expect(future.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(future);
    expect(handlers.onSelectDay).not.toHaveBeenCalled();
  });

  it('draws no ring on a future day', async () => {
    await renderCalendar();

    expect(screen.getByTestId('calendar-ring-2026-08-19')).toBeTruthy();
    expect(screen.queryByTestId('calendar-ring-2026-08-20')).toBeNull();
  });

  it('marks today as selectable, not as future', async () => {
    await renderCalendar();

    const cell = screen.getByTestId(`calendar-day-${TODAY}`);
    expect(cell.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(cell);
    expect(handlers.onSelectDay).toHaveBeenCalledWith(TODAY);
  });
});

describe('month navigation', () => {
  it('cannot page past the current month', async () => {
    await renderCalendar({ canGoNext: false });

    const next = screen.getByTestId('calendar-next');
    expect(next.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(next);
    expect(handlers.onNextMonth).not.toHaveBeenCalled();

    // Backwards is always allowed.
    fireEvent.press(screen.getByTestId('calendar-previous'));
    expect(handlers.onPreviousMonth).toHaveBeenCalledTimes(1);
  });

  it('pages forward once an earlier month is being shown', async () => {
    await renderCalendar({ monthIndex0: 5, canGoNext: true });

    fireEvent.press(screen.getByTestId('calendar-next'));
    expect(handlers.onNextMonth).toHaveBeenCalledTimes(1);
  });

  it('announces the new month, but says nothing on first render', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);

    const view = await renderCalendar({ monthIndex0: 5 });
    expect(announce).not.toHaveBeenCalled();

    await act(async () => {
      view.rerender(
        <CalendarMonth
          testID="calendar"
          year={YEAR}
          monthIndex0={6}
          records={{}}
          today={TODAY}
          canGoNext
          weekStartsOn={0}
          {...handlers}
        />
      );
    });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(String(announce.mock.calls[0][0])).toContain('July 2026');
    announce.mockRestore();
  });
});

/**
 * Paging a month used to remount thirty `Svg` roots and thirty animated pressables, and a single
 * day's store write re-rendered all thirty cells (D183). Cells are now keyed by grid position and
 * `memo`ised, which only holds for as long as every prop the parent hands them stays stable — one
 * inline object or arrow in the grid would quietly undo the whole thing.
 *
 * So this asserts the bailout itself rather than a duration: React reuses a bailed-out subtree's
 * props object verbatim, so an untouched cell's host props are identical *by reference* after the
 * re-render, while the one day that changed gets a fresh object.
 */
describe('re-rendering', () => {
  it('re-renders only the cell whose day changed', async () => {
    const changed: PrayerDay = '2026-08-03';
    const untouched: PrayerDay = '2026-08-04';
    const before = { [untouched]: recordWith(untouched, { fajr: 'prayed' }) };

    const view = await renderCalendar({ records: before });
    const untouchedBefore = screen.getByTestId(`calendar-day-${untouched}`).props;
    const changedBefore = screen.getByTestId(`calendar-day-${changed}`).props;

    await act(async () => {
      view.rerender(
        <CalendarMonth
          testID="calendar"
          year={YEAR}
          monthIndex0={MONTH0}
          records={{ ...before, [changed]: recordWith(changed, { fajr: 'prayed' }) }}
          today={TODAY}
          canGoNext={false}
          weekStartsOn={0}
          {...handlers}
        />
      );
    });

    expect(screen.getByTestId(`calendar-day-${untouched}`).props).toBe(untouchedBefore);
    expect(screen.getByTestId(`calendar-day-${changed}`).props).not.toBe(changedBefore);
    // And it is the *right* cell that moved: the new day now says so in words.
    expect(screen.getByTestId(`calendar-day-${changed}`).props.accessibilityLabel).toContain(
      '1 prayed'
    );
  });
});

describe('tallyDay', () => {
  it('counts an absent record as five unlogged prayers', () => {
    expect(tallyDay(undefined)).toEqual({
      prayed: 0,
      late: 0,
      missed: 0,
      unlogged: 5,
      exempt: 0,
    });
  });

  it('counts what the store resolved, exempt included', () => {
    expect(tallyDay(exemptRecord('2026-08-05'))).toEqual({
      prayed: 0,
      late: 0,
      missed: 0,
      unlogged: 0,
      exempt: 5,
    });
  });
});

/**
 * The seven columns always stretched to their container, but the ring inside each stayed 34pt — so
 * on a tablet the month became small dots floating in wide, squat cells (D125). The ring now grows
 * with its column, and everything else grows from the ring.
 */
describe('calendarCellMetrics', () => {
  it('is the mockup before the grid has been measured', () => {
    expect(calendarCellMetrics(null)).toEqual({
      ringSize: CALENDAR_RING_SIZE,
      ringStroke: 2.5,
      ringPad: 3.5,
      ringBox: CALENDAR_RING_SIZE + 7,
      cellHeight: CALENDAR_CELL_HEIGHT,
    });
  });

  it('is the mockup on a phone-width grid, exactly', () => {
    // A 390pt screen, less the page padding and the calendar card's own.
    expect(calendarCellMetrics(318)).toEqual(calendarCellMetrics(null));
    expect(calendarCellMetrics(280)).toEqual(calendarCellMetrics(null));
  });

  it('grows the ring with its column, and the stroke in proportion', () => {
    // The grid inside a clamped 600pt column: 600 − 40 page − 32 card.
    const wide = calendarCellMetrics(528);
    expect(wide.ringSize).toBeGreaterThan(CALENDAR_RING_SIZE);
    expect(wide.cellHeight).toBeGreaterThan(CALENDAR_CELL_HEIGHT);
    // The hairline stays a hairline relative to the ring rather than thinning as it grows.
    expect(wide.ringStroke / wide.ringSize).toBeCloseTo(2.5 / CALENDAR_RING_SIZE, 5);
    expect(wide.ringBox).toBeCloseTo(wide.ringSize + wide.ringPad * 2, 5);
  });

  it('caps the ring, so a very wide grid never balloons it', () => {
    expect(calendarCellMetrics(900).ringSize).toBe(48);
    expect(calendarCellMetrics(2000).ringSize).toBe(48);
  });

  it('keeps a cell tall enough for the touch target at every width', () => {
    for (const width of [null, 280, 318, 400, 528, 900, 2000]) {
      expect(calendarCellMetrics(width).cellHeight).toBeGreaterThanOrEqual(CALENDAR_CELL_HEIGHT);
    }
  });
});
