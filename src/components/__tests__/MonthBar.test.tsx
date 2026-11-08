/**
 * The month bar under the calendar (D183): a tally that leaves exempt and future days out, a bar
 * with a legend that names only what happened, and nothing at all for a month nobody marked.
 */
import { configure, render, screen } from '@testing-library/react-native';

import { MonthBar, tallyMonth } from '../MonthBar';
import { daysBetween } from '@/domain/dates';
import { unloggedDayRecord } from '@/domain/streaks';
import { initI18n } from '@/i18n';

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
const AUGUST = daysBetween('2026-08-01', '2026-08-31');

function dayRecord(day: PrayerDay, statuses: Partial<Record<Prayer, PrayerStatus>>): DayRecord {
  const base = unloggedDayRecord(day);
  return { ...base, statuses: { ...base.statuses, ...statuses } };
}

function exemptDayRecord(day: PrayerDay): DayRecord {
  const base = unloggedDayRecord(day);
  return {
    ...base,
    isExempt: true,
    statuses: { fajr: 'exempt', dhuhr: 'exempt', asr: 'exempt', maghrib: 'exempt', isha: 'exempt' },
  };
}

beforeAll(async () => {
  await initI18n();
});

describe('tallyMonth', () => {
  it('counts the five statuses of every past-or-present day, and a missing record as unlogged', () => {
    const tally = tallyMonth(
      AUGUST,
      {
        '2026-08-10': dayRecord('2026-08-10', { fajr: 'prayed', dhuhr: 'late', asr: 'missed' }),
      },
      TODAY
    );
    // 19 days up to and including today; one of them has three marks.
    expect(tally).toEqual({ prayed: 1, late: 1, missed: 1, unlogged: 19 * 5 - 3 });
  });

  it('skips future days and leaves exempt days out entirely (D65)', () => {
    const tally = tallyMonth(
      AUGUST,
      {
        '2026-08-12': exemptDayRecord('2026-08-12'),
        '2026-08-25': dayRecord('2026-08-25', { fajr: 'prayed' }),
      },
      TODAY
    );
    expect(tally.prayed).toBe(0);
    expect(tally.unlogged).toBe(18 * 5);
  });
});

describe('MonthBar', () => {
  it('renders nothing for a month nobody marked', async () => {
    await render(<MonthBar testID="bar" days={AUGUST} records={{}} today={TODAY} />);
    expect(screen.queryByTestId('bar')).toBeNull();
  });

  it('names only the counts that happened, in words, beside the bar', async () => {
    await render(
      <MonthBar
        testID="bar"
        days={AUGUST}
        records={{
          '2026-08-10': dayRecord('2026-08-10', { fajr: 'prayed', dhuhr: 'prayed', asr: 'late' }),
        }}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('bar-bar')).toBeTruthy();
    const legend = screen.getByTestId('bar-legend').props.children as string;
    expect(legend).toContain('2 prayed');
    expect(legend).toContain('1 late');
    expect(legend).toContain('not marked');
    expect(legend).not.toContain('missed');
  });
});
