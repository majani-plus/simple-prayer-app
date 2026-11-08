import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { spacing, useTheme } from '@/theme';

/**
 * The "hold it flatter" hint (audit B-2).
 *
 * Shown under the dial while `hooks/useTilt` reports the phone held steeply — the posture where
 * the OS heading genuinely degrades (sharply so on Android, whose fusion has no gyro). One quiet
 * row, icon + words, never a modal and never color-only; the needle itself is left alone, because
 * hiding it mid-turn would read as breakage and on iOS the heading stays usable while tilted.
 * The hint's calm is upstream: the tilt signal it renders is filtered, hysteresis-gated and
 * sustain-timed, so this component can afford to be nothing but presentation.
 */
export interface QiblaTiltHintProps {
  /**
   * Which posture the words are about. `tilt` (default): held steeply, "hold it flatter".
   * `faceDown`: the screen faces the floor (D172) — the dial's north–south sense is mirrored
   * there, so the words ask for the phone to be turned over.
   */
  reason?: 'tilt' | 'faceDown';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A quiet inline hint row.
 *
 * @returns Icon + hint text, announced politely when it appears.
 */
export function QiblaTiltHint({ reason = 'tilt', style, testID }: QiblaTiltHintProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const faceDown = reason === 'faceDown';

  return (
    <View
      testID={testID ?? (faceDown ? 'qibla-face-down-hint' : 'qibla-tilt-hint')}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
        },
        style,
      ]}
    >
      <Icon
        name={faceDown ? 'screen_rotation' : 'compass_calibration'}
        size={16}
        variant="outlined"
        color={colors.header}
      />
      <AppText variant="hint" style={{ textAlign: 'center', flexShrink: 1 }}>
        {t(faceDown ? 'qibla.tilt.faceDownHint' : 'qibla.tilt.hint')}
      </AppText>
    </View>
  );
}
