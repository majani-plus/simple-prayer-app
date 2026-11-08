import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { spacing, useTheme } from '@/theme';

import type { HeadingConfidence } from '@/services/heading';

/**
 * How much to believe the dial (PRODUCT_SPEC §9, "accuracy confidence").
 *
 * Three dots and the word for the level — never the dots alone, which would be a colour-and-shape
 * code with no text — plus, when the platform could only give a magnetic heading, one quiet line
 * saying so. That line matters: the Qibla bearing is measured from **true** north, so a magnetic
 * reading is wrong by the local declination (up to ~20° at high latitudes). Showing a confident
 * needle over a heading we know to be offset would be the app lying about the one thing it is for.
 */
export interface QiblaAccuracyProps {
  /** The sensor's own confidence, from `hooks/useHeading`. */
  confidence: HeadingConfidence;
  /** `true` when the reading is magnetic rather than true north. */
  magnetic?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Dots lit per level. `unavailable` lights none — there is nothing to be confident about yet. */
const LIT: Record<HeadingConfidence, number> = { high: 3, medium: 2, low: 1, unavailable: 0 };
const DOT_COUNT = 3;
const DOT_SIZE = 6;

/**
 * The accuracy strip.
 *
 * @param confidence - Sensor confidence level.
 * @param magnetic - Whether the heading is magnetic rather than true-north referenced.
 * @returns A centred label + dots row, with the magnetic disclosure underneath when it applies.
 */
export function QiblaAccuracy({
  confidence,
  magnetic = false,
  style,
  testID = 'qibla-accuracy',
}: QiblaAccuracyProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const word = t(`qibla.accuracy.${confidence}`);
  const lit = LIT[confidence];

  return (
    <View testID={testID} style={[{ alignItems: 'center', gap: spacing.xs }, style]}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${t('qibla.accuracy.label')}: ${word}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}
      >
        <AppText variant="caption" tone="header">
          {t('qibla.accuracy.label')}
        </AppText>
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden>
          {Array.from({ length: DOT_COUNT }, (_, index) => (
            <View
              key={index}
              style={{
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: DOT_SIZE / 2,
                backgroundColor: index < lit ? colors.accent : 'transparent',
                borderWidth: 1,
                borderColor: index < lit ? colors.accent : colors.borderMid,
              }}
            />
          ))}
        </View>
        <AppText variant="caption" italic={false} weight={600} tone="header">
          {word}
        </AppText>
      </View>

      {magnetic ? (
        <AppText variant="hint" testID={`${testID}-magnetic`} style={{ textAlign: 'center' }}>
          {t('qibla.magneticNote')}
        </AppText>
      ) : null}
    </View>
  );
}
