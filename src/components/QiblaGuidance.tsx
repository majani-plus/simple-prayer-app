import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { DEFAULT_ALIGNMENT_TOLERANCE_DEG } from '@/domain/qibla';
import { spacing, useTheme } from '@/theme';

/**
 * The sentence under the dial that tells you what to do: "Turn 38° to the left", or "Aligned —
 * you may begin" (design 3a, PRODUCT_SPEC §9).
 *
 * It is the accessible half of the alignment signal. A dial that only went green would be useless
 * to a colour-blind user and invisible to a screen reader; this card changes its **icon**, its
 * **words** and its **number** at the same moment, and reads as one spoken unit.
 *
 * `delta` is the signed shortest rotation from the device heading to the Qibla bearing —
 * `domain/qibla.shortestAngleDelta(heading, bearing)` — so it is already the short way round: at
 * heading 350° with the Qibla at 10° it is `+20`, "turn right 20°", never "turn left 340°".
 * Positive is clockwise, matching the domain's convention.
 */
export interface QiblaGuidanceProps {
  /**
   * Signed degrees to turn: positive right, negative left. `null` before the first heading fix —
   * the card then says it is still looking rather than inventing a direction.
   */
  delta: number | null;
  /** Whether the screen considers the device aligned (it owns the hysteresis, not this card). */
  aligned: boolean;
  /** The tolerance quoted in the aligned subtitle. Defaults to the domain's 5°. */
  toleranceDeg?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The turn-by-turn card.
 *
 * @param delta - Signed shortest rotation to the Qibla in degrees, or `null` with no fix.
 * @param aligned - Whether to show the aligned state.
 * @returns A paper card (green-tinted when aligned) holding an icon, a title and a subtitle.
 */
export function QiblaGuidance({
  delta,
  aligned,
  toleranceDeg = DEFAULT_ALIGNMENT_TOLERANCE_DEG,
  style,
  testID = 'qibla-guidance',
}: QiblaGuidanceProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const searching = delta === null || !Number.isFinite(delta);
  const turningRight = !searching && delta > 0;

  const icon: IconName = aligned
    ? 'task_alt'
    : searching
      ? 'explore'
      : turningRight
        ? 'turn_right'
        : 'turn_left';

  const title = aligned
    ? t('qibla.guide.aligned')
    : searching
      ? t('qibla.guide.searching')
      : t(turningRight ? 'qibla.guide.turnRight' : 'qibla.guide.turnLeft', {
          // Rounded to whole degrees: the sensor is not accurate to a tenth, and a number with a
          // decimal place would churn on every sample.
          degrees: Math.abs(Math.round(delta)),
        });

  const subtitle = aligned
    ? t('qibla.guide.alignedSub', { degrees: toleranceDeg })
    : searching
      ? t('qibla.guide.searchingSub')
      : t('qibla.guide.turnSub');

  const tone = aligned ? colors.alignedText : colors.inkStrong;

  return (
    <Card
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: 13,
          paddingHorizontal: spacing.lg,
          backgroundColor: aligned ? colors.alignedTintBg : colors.card,
          borderColor: aligned ? colors.alignedTintBorder : colors.borderFaint,
        },
        style,
      ]}
    >
      <Icon name={icon} size={22} color={tone} />
      <View style={{ flex: 1, gap: 1 }}>
        <AppText
          variant="caption"
          italic={false}
          weight={600}
          color={tone}
          style={{ fontSize: 14 }}
        >
          {title}
        </AppText>
        <AppText variant="caption" color={tone} style={{ opacity: 0.85 }}>
          {subtitle}
        </AppText>
      </View>
    </Card>
  );
}
