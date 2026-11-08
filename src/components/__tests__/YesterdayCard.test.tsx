/**
 * Component test for the Today tab's yesterday card (owner request, 2026-08-24).
 *
 * The card is presentational — the screen supplies the record and the logger gate — so what is
 * pinned here are its own promises:
 *
 * 1. it renders nothing without the screen's `show`, whatever the record holds — a person who
 *    does not log must never meet a daily count of unmarked prayers (two-audiences rule);
 * 2. it renders nothing when there is nothing to offer: no unmarked prayer, an exempt yesterday
 *    (whose slots all resolve to `exempt`), or a record that has not been read yet;
 * 3. it counts in the log's own neutral word — "not marked", never "missed";
 * 4. it is a way through and nothing else: one press, one callback.
 */

import { configure, fireEvent, render, screen } from '@testing-library/react-native';

import { YesterdayCard, unmarkedCount } from '../YesterdayCard';
import { unloggedDayRecord } from '@/domain/streaks';
import type { DayRecord, PrayerStatus } from '@/domain/types';
import { initI18n } from '@/i18n';

configure({ defaultIncludeHiddenElements: true });

const DAY = '2026-08-23';

function recordWith(statuses: Partial<Record<keyof DayRecord['statuses'], PrayerStatus>>): DayRecord {
  const base = unloggedDayRecord(DAY);
  return { ...base, statuses: { ...base.statuses, ...statuses } };
}

beforeAll(() => {
  initI18n();
});

describe('unmarkedCount', () => {
  it('counts only unlogged slots, and an absent record as none', () => {
    expect(unmarkedCount(undefined)).toBe(0);
    expect(unmarkedCount(recordWith({}))).toBe(5);
    expect(unmarkedCount(recordWith({ fajr: 'prayed', dhuhr: 'late', asr: 'missed' }))).toBe(2);
    expect(
      unmarkedCount(
        recordWith({
          fajr: 'exempt',
          dhuhr: 'exempt',
          asr: 'exempt',
          maghrib: 'exempt',
          isha: 'exempt',
        })
      )
    ).toBe(0);
  });
});

describe('YesterdayCard', () => {
  it('renders nothing without the screen’s gate, whatever the record holds', async () => {
    await render(<YesterdayCard record={recordWith({})} show={false} onPress={jest.fn()} />);
    expect(screen.queryByTestId('yesterday-card')).toBeNull();
  });

  it('renders nothing while the record has not been read', async () => {
    await render(<YesterdayCard record={undefined} show onPress={jest.fn()} />);
    expect(screen.queryByTestId('yesterday-card')).toBeNull();
  });

  it('renders nothing once every prayer is marked', async () => {
    await render(
      <YesterdayCard
        record={recordWith({
          fajr: 'prayed',
          dhuhr: 'prayed',
          asr: 'late',
          maghrib: 'missed',
          isha: 'prayed',
        })}
        show
        onPress={jest.fn()}
      />
    );
    expect(screen.queryByTestId('yesterday-card')).toBeNull();
  });

  it('says how many are not marked — never "missed" — and opens on one press', async () => {
    const onPress = jest.fn();
    await render(
      <YesterdayCard
        record={recordWith({ fajr: 'prayed', dhuhr: 'prayed', asr: 'prayed', maghrib: 'prayed' })}
        show
        onPress={onPress}
      />
    );
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('1 prayer not marked')).toBeTruthy();
    expect(screen.queryByText(/missed/)).toBeNull();

    fireEvent.press(screen.getByTestId('yesterday-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
