/**
 * `DayDetail` — the History day sheet.
 *
 * The rows themselves are `PrayerRow`'s business and are tested there; what is asserted here is
 * what only this sheet decides: that it opens on a day and closes every way a native sheet must,
 * that a pick reaches the caller with the right prayer, that an exempt day says so and offers
 * nothing, that a future day is locked, and that the made-up conversion only appears on a missed
 * prayer — and reverses.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import { DayDetail } from '../DayDetail';
import * as formatTimeModule from '@/utils/formatTime';
import { unloggedDayRecord } from '@/domain/streaks';
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

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

configure({ defaultIncludeHiddenElements: true });

/** A Wednesday, so the default render exercises the ordinary Dhuhr name. */
const DAY: PrayerDay = '2026-08-12';
/** The Friday of the same week — Dhuhr is Jumu'ah there (D75). */
const FRIDAY: PrayerDay = '2026-08-14';

/** Five plausible times for the day, so the rows have something to render. */
const TIMES: Record<Prayer, Date> = {
  fajr: new Date(2026, 7, 12, 4, 51),
  dhuhr: new Date(2026, 7, 12, 13, 12),
  asr: new Date(2026, 7, 12, 16, 55),
  maghrib: new Date(2026, 7, 12, 20, 22),
  isha: new Date(2026, 7, 12, 21, 48),
};

function recordWith(
  statuses: Partial<Record<Prayer, PrayerStatus>>,
  extra: Partial<DayRecord> = {}
): DayRecord {
  const base = unloggedDayRecord(DAY);
  return { ...base, statuses: { ...base.statuses, ...statuses }, ...extra };
}

const handlers = {
  onClose: jest.fn(),
  onPick: jest.fn(),
  onToggleMadeUp: jest.fn(),
};

async function renderSheet(overrides: Partial<React.ComponentProps<typeof DayDetail>> = {}) {
  const view = await render(
    <DayDetail
      day={DAY}
      record={unloggedDayRecord(DAY)}
      times={TIMES}
      {...handlers}
      {...overrides}
    />
  );
  // The seals probe reduce-motion and animate on mount.
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
  useSettingsStore.getState().setHijriOffset(0);
  useSettingsStore.getState().setTimeFormat('24h');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('opening and closing', () => {
  it('renders nothing at all when no day is selected', async () => {
    await render(<DayDetail day={null} record={undefined} times={null} {...handlers} />);
    expect(screen.queryByTestId('day-detail-sheet')).toBeNull();
  });

  it('shows the day’s Gregorian and Hijri date', async () => {
    await renderSheet();

    // 12 August 2026 is 28 Safar 1448.
    expect(screen.getByText(/August/)).toBeTruthy();
    expect(screen.getByText(/Safar/)).toBeTruthy();
    expect(screen.getByText(/1448/)).toBeTruthy();
  });

  it('follows the record while it is open — a mark made in the sheet shows in the sheet', async () => {
    await renderSheet();
    expect(screen.queryByTestId('detail-madeup-fajr')).toBeNull();

    await act(async () => {
      screen.rerender(
        <DayDetail day={DAY} record={recordWith({ fajr: 'missed' })} times={TIMES} {...handlers} />
      );
    });

    // The made-up action exists only on a missed prayer, so its arrival is the record arriving.
    expect(screen.getByTestId('detail-madeup-fajr')).toBeTruthy();
  });

  it('shows the new day when it is reopened on another one', async () => {
    await renderSheet();
    await act(async () => {
      screen.rerender(<DayDetail day={null} record={undefined} times={null} {...handlers} />);
    });
    await act(async () => {
      screen.rerender(
        <DayDetail day={FRIDAY} record={unloggedDayRecord(FRIDAY)} times={TIMES} {...handlers} />
      );
    });

    // Friday names its midday prayer Jumu'ah (D75) — a fact only the second day could produce.
    expect(screen.getByText(/Jumu/)).toBeTruthy();
  });

  it('dismisses from the backdrop and from the close control', async () => {
    await renderSheet();

    await act(async () => {
      fireEvent.press(screen.getByTestId('day-detail-backdrop'));
    });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByTestId('day-detail-close'));
    });
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });
});

describe('editing a past day', () => {
  it('renders the same five rows Today uses, unlocked', async () => {
    await renderSheet();

    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as Prayer[]) {
      expect(screen.getByTestId(`detail-row-${prayer}`)).toBeTruthy();
      expect(screen.getByTestId(`seal-${prayer}-face`).props.accessibilityState.disabled).toBe(
        false
      );
    }
  });

  it('keeps the full pill for every editable prayer — never the Today screen’s direct pick', async () => {
    // Deliberate (spec-today-interaction §3): the sheet is a correction surface, possibly months
    // removed from the moment, so every editable prayer — today's current one included — opens
    // the three-choice pill. The direct-pick restriction is Today-screen ergonomics, not data
    // model. Guarded by tapping a face: a direct-pick seal would log instead of opening.
    await renderSheet();

    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as Prayer[]) {
      await act(async () => {
        fireEvent.press(screen.getByTestId(`seal-${prayer}-face`));
      });
      expect(screen.getByTestId(`seal-${prayer}-options`).props.accessibilityElementsHidden).toBe(
        false
      );
      // Close it again so the next face is visible (one open seal at a time).
      await act(async () => {
        fireEvent.press(screen.getByTestId(`seal-${prayer}-dismiss`));
      });
    }
    expect(handlers.onPick).not.toHaveBeenCalled();
  });

  it('closes an open pill when a touch starts on the sheet outside it, picking nothing', async () => {
    await renderSheet();

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-asr-face'));
    });
    expect(screen.getByTestId('seal-asr-options').props.accessibilityElementsHidden).toBe(false);

    // A touch on the sheet's own paper — the date line, another row's text, anywhere outside the
    // pill — dismisses it without logging, exactly as on Today.
    await act(async () => {
      fireEvent(screen.getByTestId('day-detail-seal-dismiss'), 'startShouldSetResponderCapture', {
        nativeEvent: { pageX: 20, pageY: 500 },
      });
    });
    expect(screen.getByTestId('seal-asr-options').props.accessibilityElementsHidden).toBe(true);
    expect(handlers.onPick).not.toHaveBeenCalled();
  });

  it('reports a pick with the prayer it belongs to, and closes the seal', async () => {
    await renderSheet();

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-asr-face'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-asr-option-late'));
    });

    expect(handlers.onPick).toHaveBeenCalledWith(
      'asr',
      'late',
      expect.objectContaining({ clears: false })
    );
    expect(screen.getByTestId('seal-asr-options').props.accessibilityElementsHidden).toBe(true);
  });

  it('opens only one seal at a time', async () => {
    await renderSheet();
    const isOpen = (prayer: string) =>
      screen.getByTestId(`seal-${prayer}-options`).props.accessibilityElementsHidden === false;

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-fajr-face'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-isha-face'));
    });

    expect(isOpen('fajr')).toBe(false);
    expect(isOpen('isha')).toBe(true);
  });

  it('re-renders only the row whose seal opened', async () => {
    await renderSheet();
    // Every row formats its time once per render, so the calls count the rows that re-rendered.
    // With handlers minted inline in the row loop, one tap re-rendered all five (D158 on Today).
    const renderedTime = jest.spyOn(formatTimeModule, 'formatTime');

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-asr-face'));
    });

    expect(renderedTime).toHaveBeenCalledTimes(1);
    renderedTime.mockRestore();
  });
});

describe('the made-up conversion', () => {
  it('is offered only on a missed prayer', async () => {
    await renderSheet({ record: recordWith({ fajr: 'missed', dhuhr: 'prayed' }) });

    expect(screen.getByTestId('detail-madeup-fajr')).toBeTruthy();
    expect(screen.queryByTestId('detail-madeup-dhuhr')).toBeNull();
    expect(screen.queryByTestId('detail-madeup-asr')).toBeNull();
  });

  it('marks a missed prayer as made up', async () => {
    await renderSheet({ record: recordWith({ isha: 'missed' }) });

    await act(async () => {
      fireEvent.press(screen.getByTestId('detail-madeup-isha'));
    });
    expect(handlers.onToggleMadeUp).toHaveBeenCalledWith('isha', true);
  });

  it('shows a resolved prayer as resolved, in a word, and un-marks it', async () => {
    await renderSheet({
      record: recordWith({ isha: 'missed' }, { madeUp: { isha: true } }),
    });

    const action = screen.getByTestId('detail-madeup-isha');
    expect(action.props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('made up')).toBeTruthy();

    await act(async () => {
      fireEvent.press(action);
    });
    expect(handlers.onToggleMadeUp).toHaveBeenCalledWith('isha', false);
  });
});

describe('days that cannot be edited', () => {
  it('says an exempt day is exempt, and locks every seal', async () => {
    await renderSheet({
      record: recordWith(
        {
          fajr: 'exempt',
          dhuhr: 'exempt',
          asr: 'exempt',
          maghrib: 'exempt',
          isha: 'exempt',
        },
        { isExempt: true }
      ),
    });

    expect(screen.getByTestId('day-detail-exempt')).toBeTruthy();
    expect(screen.getAllByText('not required')).toHaveLength(5);
    expect(screen.getByTestId('seal-fajr-face').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId('detail-madeup-fajr')).toBeNull();
  });

  it('locks a future day and explains why', async () => {
    await renderSheet({ isFuture: true });

    expect(screen.getByTestId('day-detail-locked')).toBeTruthy();
    for (const prayer of ['fajr', 'isha'] as Prayer[]) {
      expect(screen.getByTestId(`seal-${prayer}-face`).props.accessibilityState.disabled).toBe(
        true
      );
    }
  });

  it('explains itself instead of inventing times when there are none', async () => {
    await renderSheet({ times: null });

    expect(screen.getByTestId('day-detail-no-times')).toBeTruthy();
    expect(screen.queryByTestId('detail-row-fajr')).toBeNull();
  });
});

describe('Friday’s midday prayer (D75)', () => {
  it('names it Jumu’ah AND Dhuhr, never one instead of the other', async () => {
    await renderSheet({ day: FRIDAY, record: unloggedDayRecord(FRIDAY) });

    // Both names, because Jumu'ah replaces Dhuhr only for whoever prays it: a woman at home, a
    // traveller or anyone who cannot reach a masjid prays Dhuhr, and the row must be true for her
    // too. The Arabic companion is the calligraphy of the headline name.
    expect(screen.getByText('Jumu’ah · Dhuhr')).toBeTruthy();
    expect(screen.getByText('الجمعة')).toBeTruthy();
    expect(screen.queryByText('الظهر')).toBeNull();
  });

  it('leaves the prayer’s identity alone — the seal still logs `dhuhr`', async () => {
    await renderSheet({ day: FRIDAY, record: unloggedDayRecord(FRIDAY) });

    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-face'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('seal-dhuhr-option-prayed'));
    });

    // A display name may never reach the store: the day's record, its streak and its qada all key
    // on `dhuhr`, and a `jumuah` slipping through here would strand every Friday's log.
    expect(handlers.onPick).toHaveBeenCalledWith(
      'dhuhr',
      'prayed',
      expect.objectContaining({ clears: false })
    );
  });

  it('says plain Dhuhr on every other day', async () => {
    await renderSheet();

    expect(screen.getByText('Dhuhr')).toBeTruthy();
    expect(screen.getByText('الظهر')).toBeTruthy();
    expect(screen.queryByText('Jumu’ah · Dhuhr')).toBeNull();
    expect(screen.queryByText('الجمعة')).toBeNull();
  });

  it('names the made-up action after the same day, so the sheet never says two things', async () => {
    await renderSheet({
      day: FRIDAY,
      record: {
        ...unloggedDayRecord(FRIDAY),
        statuses: { ...unloggedDayRecord(FRIDAY).statuses, dhuhr: 'missed' },
      },
    });

    expect(screen.getByLabelText('Mark Jumu’ah · Dhuhr as made up')).toBeTruthy();
  });
});
