import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { ProgressRing } from './ProgressRing';
import { Figure } from './StatCards';
import { parseDay } from '@/domain/dates';
import { type StreakMode, type StreakSummary } from '@/domain/types';
import { formatDate, formatNumber } from '@/i18n/numerals';
import { spacing, type as typeScale } from '@/theme';

/**
 * The head of the History tab: the run so far, and the week so far.
 *
 * This is the first thing the tab says, and it is deliberately the *encouraging* thing — the
 * streak as a headline numeral, the week's completion as a ring beside it. Everything that
 * accounts for what went wrong lives further down the page, after the calendar. The reward loop
 * is the product (CLAUDE.md), and a tab that opens with a ledger is the opposite of it.
 *
 * **A zero renders exactly like any other number.** No warning colour, no smaller type, and no
 * word anywhere on this card for a streak that ended — the copy offers the next step ("Mark a
 * prayer to start one.") rather than naming the loss. The app never shames (PRODUCT_SPEC §5), and
 * a streak is the one number most able to.
 *
 * **It computes nothing.** The streak arrives from `domain/streaks` and the rate from
 * `domain/stats`, both through the tracking store; what happens here is formatting and layout.
 */

export interface StreakHeroProps {
  /** Streak summary for the active mode, or `null` before the store has read the database. */
  streak: StreakSummary | null;
  /** The mode `streak` was computed for — named in the copy, because the two differ (§5). */
  streakMode: StreakMode;
  /** The last seven days' completion rate, 0…1, or `null` when there is nothing to divide. */
  weekRate: number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The ring's diameter and thickness, from the design. */
const RING_SIZE = 76;
const RING_STROKE = 7;

/**
 * The streak hero card.
 *
 * @param weekRate - Drawn as the ring and printed in its centre; `null` shows an empty ring.
 * @returns A `Card` holding the current streak, the best run, one hint line and the week's ring.
 */
export function StreakHero({ streak, streakMode, weekRate, style, testID }: StreakHeroProps) {
  const { t, i18n } = useTranslation();

  const number = useMemo(
    () => (value: number) => formatNumber(value, i18n.language, { useGrouping: true }),
    [i18n.language]
  );

  const current = streak?.current ?? 0;
  const label = t('today.streakLabel', { count: current });

  // A streak that has not started yet is offered a first step, never told what it lost. The
  // "not loaded yet" case (`streak === null`) is not that state, so it keeps the mode line.
  const hint =
    streak !== null && streak.current === 0
      ? t('history.stats.startHint')
      : streak === null || streak.bestStartedOn === null
        ? t('history.stats.modeLine', { mode: t(`history.stats.mode.${streakMode}`) })
        : t('history.stats.bestSince', {
            mode: t(`history.stats.mode.${streakMode}`),
            date: formatDate(parseDay(streak.bestStartedOn), i18n.language, {
              month: 'long',
              day: 'numeric',
            }),
          });

  // Two rows. The headline row is the numeral against the ring; the second row is the best run
  // and the hint, given the card's whole width. Putting the best figure inside the headline's
  // column squeezed it against the ring until "46" wrapped onto two lines on a phone.
  return (
    <Card testID={testID ?? 'stat-streak'} style={[{ padding: spacing.lg, gap: spacing.md }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
        }}
      >
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${number(current)} ${label}`}
          style={{ flexShrink: 1 }}
        >
          <AppText
            testID="stat-streak-current"
            variant="rowName"
            weight={700}
            tone="strong"
            tabularNums
            style={{ fontSize: typeScale.streakHero }}
          >
            {number(current)}
          </AppText>
          <AppText variant="caption">{label}</AppText>
        </View>

        <View style={{ alignItems: 'center', gap: 2 }}>
          <ProgressRing
            testID="stat-week-ring"
            rate={weekRate}
            size={RING_SIZE}
            stroke={RING_STROKE}
          >
            <AppText
              testID="stat-week-rate"
              variant="rowName"
              weight={700}
              tone="strong"
              tabularNums
              style={{ fontSize: typeScale.rowTime }}
            >
              {weekRate === null
                ? t('history.stats.none')
                : formatNumber(weekRate, i18n.language, {
                    style: 'percent',
                    maximumFractionDigits: 0,
                  })}
            </AppText>
          </ProgressRing>
          <AppText variant="caption">{t('history.stats.thisWeek')}</AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg }}>
        <View style={{ flexShrink: 0 }}>
          <Figure
            testID="stat-streak-best"
            value={number(streak?.best ?? 0)}
            label={t('history.stats.best')}
            tone="ink"
          />
        </View>
        <AppText variant="hint" style={{ flex: 1 }}>
          {hint}
        </AppText>
      </View>
    </Card>
  );
}
