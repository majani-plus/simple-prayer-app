import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { StatusBar } from './StatusBar';
import { isFutureDay } from '@/domain/dates';
import { PRAYERS, type DayRecord, type PrayerDay } from '@/domain/types';
import { formatNumber } from '@/i18n/numerals';
import { spacing } from '@/theme';

/**
 * The month's own bar under the calendar grid (D183): how the visible month went, as one stacked
 * `StatusBar` and a legend in words.
 *
 * Two rules shape it. It is **hidden entirely when nothing in the month is logged**, so somebody
 * who only wants prayer times sees a calendar and nothing that reads as a score. And **exempt days
 * are left out** of the tally altogether (D65): a count of them adds nothing anyone can act on and
 * would put a cycle tally on a screen others may see. Future days cannot hold a log and are skipped;
 * an absent record is five unlogged prayers, which is the track the fills sit on.
 *
 * Pure tallying of what the store already resolved — no rule of its own.
 */

/** The month's counts, exempt days excluded. */
export interface MonthTally {
  prayed: number;
  late: number;
  missed: number;
  unlogged: number;
}

/**
 * Tallies the past-or-present days of a month.
 *
 * @param days - The month's prayer days, in any order; future days are skipped.
 * @param records - Resolved records by day; a miss is five unlogged prayers.
 * @param today - The current prayer day, the boundary past which days are skipped.
 */
export function tallyMonth(
  days: readonly PrayerDay[],
  records: Record<PrayerDay, DayRecord | undefined>,
  today: PrayerDay
): MonthTally {
  const tally: MonthTally = { prayed: 0, late: 0, missed: 0, unlogged: 0 };
  for (const day of days) {
    if (isFutureDay(day, today)) continue;
    const record = records[day];
    if (record?.isExempt === true) continue;
    for (const prayer of PRAYERS) {
      const status = record?.statuses[prayer] ?? 'unlogged';
      // A stored exempt status on a non-exempt day is stale; it is neither a mark nor a blank.
      if (status === 'exempt') continue;
      tally[status] += 1;
    }
  }
  return tally;
}

export interface MonthBarProps {
  /** The month's prayer days. */
  days: readonly PrayerDay[];
  records: Record<PrayerDay, DayRecord | undefined>;
  today: PrayerDay;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The bar and its legend, or nothing at all when the month holds no mark.
 */
export function MonthBar({ days, records, today, style, testID }: MonthBarProps) {
  const { t, i18n } = useTranslation();
  const tally = useMemo(() => tallyMonth(days, records, today), [days, records, today]);
  const logged = tally.prayed + tally.late + tally.missed;
  if (logged === 0) return null;

  const number = (value: number) => formatNumber(value, i18n.language, { useGrouping: true });
  // Only the non-zero parts are named: "12 prayed · 1 late" says everything a bar with two fills
  // shows, and a "0 missed" would be the one number on the page that reads as a reproach avoided.
  const legend = (['prayed', 'late', 'missed', 'unlogged'] as const)
    .filter((key) => tally[key] > 0)
    .map((key) => t(`history.month.legend.${key}`, { count: number(tally[key]) }))
    .join(t('history.month.join'));

  return (
    <View testID={testID} style={[{ gap: spacing.xs, marginTop: spacing.md }, style]}>
      <StatusBar
        prayed={tally.prayed}
        late={tally.late}
        missed={tally.missed}
        total={logged + tally.unlogged}
        testID={testID === undefined ? undefined : `${testID}-bar`}
      />
      <AppText testID={testID === undefined ? undefined : `${testID}-legend`} variant="hint">
        {legend}
      </AppText>
    </View>
  );
}
