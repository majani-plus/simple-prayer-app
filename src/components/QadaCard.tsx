import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { forwardChevron } from '@/i18n/direction';
import { formatNumber } from '@/i18n/numerals';
import { normalizeDebts, totalDebt } from '@/domain/qada';
import { spacing, type as typeScale, useTheme } from '@/theme';
import { useQadaShownDebts } from '@/hooks/useTrackingModeView';

/**
 * The qada card on Today: what is left to make up, and a way through to the screen that handles it.
 *
 * It appears **only when something is owed** (PRODUCT_SPEC §7) — at zero it renders nothing at
 * all, because an empty "0 prayers to make up" card would be a daily reminder of a debt that no
 * longer exists. Everything about it is written so the number reads as descending: the caption
 * says what is *left*, and no part of it is red, urgent or phrased as something owed to someone.
 *
 * ## Why there is no button here
 *
 * There used to be a one-tap "+1 made up" on this card, acting on the most-owed prayer, with an
 * undo behind it. It is gone by the owner's decision: making up a prayer is a deliberate act
 * belonging to the qada screen, where the user can see which prayer they are settling and put it
 * back if they mistap. Today's one tap is for the prayer in front of them — this card is a quiet
 * summary that opens the screen, and nothing on it competes with the prayer list above.
 */

export interface QadaCardProps {
  /** Opens the qada screen. The card is a route-free component; the screen owns navigation. */
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The Today tab's qada card.
 *
 * @param onPress - Opens the qada screen.
 * @returns The card, or `null` when nothing is owed.
 */
export function QadaCard({ onPress, style, testID = 'qada-card' }: QadaCardProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  // Only the total is shown, and it is the debts' own sum. `useQada` would also recompute the pace
  // and the undo window from the database on every log, which this card never shows. "Shown", so
  // simple mode's unmarked misses are counted here exactly as on the qada screen (D192).
  const stored = useQadaShownDebts();
  const total = useMemo(() => totalDebt(normalizeDebts(stored)), [stored]);

  const totalText = useMemo(
    () => formatNumber(total, i18n.language),
    [i18n.language, total]
  );

  // Nothing owed, nothing to say. Rendered after the hooks so the card can appear and disappear
  // without changing the hook order.
  if (total <= 0) return null;

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('qada.card.a11yLabel', {
        total: t('qada.count', { count: total }),
      })}
      accessibilityHint={t('qada.card.a11yHint')}
      onPress={onPress}
      style={style}
    >
      <Card
        variant="bright"
        border="mid"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
        }}
      >
        <Icon name="self_improvement" size={22} color={colors.accent} />

        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="caption" tone="header">
            {t('qada.card.heading')}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
            <AppText
              testID={`${testID}-total`}
              variant="rowName"
              weight={600}
              tone="diamond"
              tabularNums
              style={{ fontSize: typeScale.streakNumber }}
            >
              {totalText}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('qada.unit', { count: total })}
            </AppText>
          </View>
          <AppText testID={`${testID}-status`} variant="hint">
            {t('qada.card.hint')}
          </AppText>
        </View>

        {/* Points the way navigation goes, which mirrors with the writing direction. */}
        <Icon name={forwardChevron()} size={20} color={colors.faint} />
      </Card>
    </PressableScale>
  );
}
