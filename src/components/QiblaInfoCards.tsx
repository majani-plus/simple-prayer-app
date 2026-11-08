import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { useTheme } from '@/theme';

/**
 * The three figures under the dial: your live heading, the Qibla bearing (highlighted, because it
 * is the one number that is *true* whatever the phone is doing) and the distance to the Kaaba
 * (design 3a, PRODUCT_SPEC §9).
 *
 * The values arrive pre-formatted: rounding, thousands separators and locale numerals are the
 * screen's business (it holds the language and the domain figures), and this component's business
 * is the paper. Each card is one accessibility node — "Qibla bearing, 58 degrees north-east" —
 * because a label and a number read separately are two announcements that mean nothing apart.
 */
export interface QiblaInfoCardsProps {
  /** The live heading, formatted, or the em-dash placeholder before the first fix. */
  heading: string;
  /** The Qibla bearing, formatted (e.g. "58° NE"). */
  bearing: string;
  /** The great-circle distance to the Kaaba, formatted (e.g. "10,321 km"). */
  distance: string;
  /** Tints the highlighted card's border green in the aligned state. */
  aligned?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The mockup's gap between the three cards (9px, matching the prayer-row rhythm). */
const CARD_GAP = 9;
const LABEL_SIZE = 11;
const VALUE_SIZE = 20;

/**
 * The heading / bearing / distance row.
 *
 * @param bearing - The Qibla bearing string; its card is the emphasised one.
 * @returns A row of three equal paper cards.
 */
export function QiblaInfoCards({
  heading,
  bearing,
  distance,
  aligned = false,
  style,
  testID = 'qibla-info',
}: QiblaInfoCardsProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <View style={[{ flexDirection: 'row', gap: CARD_GAP }, style]}>
      <InfoCard
        testID={`${testID}-heading`}
        label={t('qibla.card.heading')}
        value={heading}
        valueColor={colors.ink}
      />
      <InfoCard
        testID={`${testID}-bearing`}
        label={t('qibla.card.bearing')}
        value={bearing}
        valueColor={colors.inkStrong}
        // Brighter fill + a gold border: the design's way of saying "this is the answer".
        variant="elevated"
        borderColor={aligned ? colors.alignedTintBorder : colors.borderStrong}
      />
      <InfoCard
        testID={`${testID}-distance`}
        label={t('qibla.card.distance')}
        value={distance}
        valueColor={colors.ink}
      />
    </View>
  );
}

function InfoCard({
  label,
  value,
  valueColor,
  variant = 'normal',
  borderColor,
  testID,
}: {
  label: string;
  value: string;
  valueColor: string;
  variant?: 'normal' | 'elevated';
  borderColor?: string;
  testID: string;
}) {
  return (
    <Card
      testID={testID}
      variant={variant}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}, ${value}`}
      style={{
        flex: 1,
        gap: 1,
        paddingVertical: 12,
        paddingHorizontal: 14,
        ...(borderColor === undefined ? null : { borderColor }),
      }}
    >
      {/* Two lines. Three cards across leave each label about 80pt, which "Your heading" fills at
          the default text size and overruns well before Apple's 200% bar — and unlike the figure
          below it, the label has no `adjustsFontSizeToFit` to fall back on, so one line meant an
          ellipsis and a number with nothing to say what it was. It has never wrapped at the
          default size in any of the three languages. */}
      <AppText variant="caption" style={{ fontSize: LABEL_SIZE }} numberOfLines={2}>
        {label}
      </AppText>
      {/* Two lines here as well, and for a blunter reason: `adjustsFontSizeToFit` is iOS-only, so
          on Android the shrink-to-fit that keeps "10,321 km" inside a third of the screen does not
          exist and the figure was simply cut — at the default text size, before Dynamic Type was
          even involved. A second line costs nothing (the three cards stretch to match) and gives
          both platforms somewhere to put the overflow; iOS still shrinks first, and now shrinks
          less far. */}
      <AppText
        variant="time"
        weight={700}
        color={valueColor}
        style={{ fontSize: VALUE_SIZE }}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </AppText>
    </Card>
  );
}
