import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { forwardChevron } from '@/i18n/direction';
import { PRAYERS, type DayRecord } from '@/domain/types';
import { spacing, useTheme } from '@/theme';

/**
 * The yesterday card on Today: a one-tap way to finish marking yesterday's prayers, for the
 * person who logs in the morning what they prayed the evening before (owner request, 2026-08-24:
 * "I'd like to be able to quickly see yesterday's prayers so I can log them when I wake up").
 * Tapping it opens yesterday in the same day sheet History uses — the screen owns that.
 *
 * Everything about when it appears is in service of one rule: **this is an offer, never an
 * audit.** So it renders nothing at all unless *both* of these hold, and the second one is the
 * screen's to establish (`show`):
 *
 * 1. Yesterday still has at least one unmarked prayer. An exempt yesterday has none (its slots
 *    resolve to `exempt`), so it hides the card by construction — nothing was owed.
 * 2. The user actually logs (something marked in the last few days). A person who only ever
 *    wants prayer times must never open the app to a daily count of prayers they never intended
 *    to mark — that is the two-audiences rule, and it is why the gate is the screen's stats
 *    rather than this card's guess.
 *
 * The wording says "not marked", the log's own neutral word — never "missed", which is a status
 * only the user may assign.
 */

/** How many of `record`'s prayers are still unmarked. An absent record counts as none: the card
 * must not claim anything about a day it has not actually read. */
export function unmarkedCount(record: DayRecord | undefined): number {
  if (record === undefined) return 0;
  return PRAYERS.filter((prayer) => record.statuses[prayer] === 'unlogged').length;
}

export interface YesterdayCardProps {
  /** Yesterday's resolved record; `undefined` while it has not been read yet (renders nothing). */
  record: DayRecord | undefined;
  /**
   * The screen's half of the gate: `false` for someone who does not log (see above). The card
   * contributes the other half (an unmarked prayer exists) itself.
   */
  show: boolean;
  /** Opens yesterday's day sheet. The card is route-free; the screen owns navigation. */
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The Today tab's yesterday card.
 *
 * @param record - Yesterday's record; the card counts its unmarked prayers.
 * @param show - The screen's logger gate; `false` renders nothing whatever the record says.
 * @returns The card, or `null` when there is nothing to offer.
 */
export function YesterdayCard({
  record,
  show,
  onPress,
  style,
  testID = 'yesterday-card',
}: YesterdayCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const count = unmarkedCount(record);
  if (!show || count === 0) return null;

  const countText = t('today.yesterday.count', { count });

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('today.yesterday.a11yLabel', { count: countText })}
      accessibilityHint={t('today.yesterday.a11yHint')}
      onPress={onPress}
      style={style}
    >
      <Card
        variant="quiet"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
        }}
      >
        <Icon name="history" size={22} color={colors.accent} />

        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="caption" tone="header">
            {t('today.yesterday.heading')}
          </AppText>
          <AppText testID={`${testID}-count`} variant="time" tone="muted">
            {countText}
          </AppText>
        </View>

        {/* Points the way navigation goes, which mirrors with the writing direction. */}
        <Icon name={forwardChevron()} size={20} color={colors.faint} />
      </Card>
    </PressableScale>
  );
}
