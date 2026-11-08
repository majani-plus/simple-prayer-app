import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { type as typeScale, spacing, useTheme } from '@/theme';
import { useTimeFormat } from '@/stores/settingsStore';
import { formatTime } from '@/utils/formatTime';

/**
 * Sunrise, drawn as the horizon it is: a hairline rule between the Fajr and Dhuhr rows with the
 * sun sitting on it, naming the time.
 *
 * ```
 * ───────────────  ☀ Sunrise  6:14 am  ───────────────
 * ```
 *
 * **Why it is on the screen at all.** Sunrise is when Fajr's window shuts (`domain/windows.ts`) —
 * the only prayer whose deadline is not the next adhan — and it is a time Muslims plan around in
 * its own right. Before this the app never showed it, which left the Fajr row's "now · until
 * sunrise 6:14 am" naming an instant the screen itself did not mark.
 *
 * **Why it is a rule and not a row.** Every prayer on this screen is a `Card` with a 48px seal on
 * its trailing edge; this has no card, no fill, no seal and nothing to tap. It cannot be mistaken
 * for a sixth prayer — and being a *line* is what makes it mean something: it sits exactly where
 * sunrise falls in a chronological list, so it visibly closes off the Fajr row and opens the
 * morning. Someone who has never used the app reads "Sunrise 6:14 am" and is done; nobody has to
 * be told that a horizon is not a prayer.
 *
 * It is deliberately **constant** — same words, same weight, all day. A marker that changed as the
 * window closed would be a second, quieter countdown competing with the hero, and a line that
 * appears and disappears is the jitter D67 rules out.
 *
 * Construction follows `SectionDivider`: two flexing rule segments with the label between them,
 * rather than a paper-coloured chip painted over one line — the parchment carries a noise texture
 * and a vignette that a flat rectangle cannot match, so the texture is left to run through.
 */
export interface SunriseMarkerProps {
  /** The sunrise instant to name. */
  time: Date;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Matches the ◆ ornament's optical weight on the same rule. */
const SUN_SIZE = 13;
const RULE_THICKNESS = 1;

/**
 * The sunrise marker.
 *
 * @param time - Sunrise, already offset-free (`PrayerOffsets` has no sunrise key by design).
 * @returns A hairline rule carrying the sun, the word and the time, spoken as one phrase.
 */
export function SunriseMarker({ time, style, testID }: SunriseMarkerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const timeFormat = useTimeFormat();
  const timeText = formatTime(time, { timeFormat });

  const rule = (
    <View style={{ flex: 1, height: RULE_THICKNESS, backgroundColor: colors.hairline }} />
  );

  return (
    <View
      testID={testID}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }, style]}
    >
      {rule}
      {/* One node, one phrase: "Sunrise at 6:14 am". Reading out a sun glyph, a word and a
          number as three separate elements would make the calmest line on the screen the
          noisiest one under VoiceOver. */}
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('today.sunrise.a11yLabel', { time: timeText })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
      >
        {/* The sun is decorative *here* — the word beside it carries the meaning, so the marker
            is never glyph-only any more than it is colour-only. (`Icon` is already `accessible=
            {false}`, so it adds nothing to the phrase above.) Filled rather than outlined: at
            13px a solid disc with rays reads as the sun, an outline reads as a fussy asterisk. */}
        <Icon name="sunny" size={SUN_SIZE} color={colors.faint} />
        <AppText variant="caption" tone="faint" style={{ fontSize: typeScale.rowCaption }}>
          {t('today.sunrise.label')}
        </AppText>
        <AppText
          variant="caption"
          tone="faint"
          tabularNums
          style={{ fontSize: typeScale.rowCaption }}
        >
          {timeText}
        </AppText>
      </View>
      {rule}
    </View>
  );
}
