import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { spacing, useTheme } from '@/theme';

/**
 * The figure-8 calibration prompt (PRODUCT_SPEC §9: "low accuracy → calibration prompt").
 *
 * A magnetometer drifts, and near a laptop, a car dashboard or a magnetic case it drifts a lot.
 * The fix is physical — sweeping the phone through a figure 8 lets the OS re-fit its hard-iron
 * offsets — so the prompt *shows the motion* rather than describing it: a dot travels a lemniscate
 * once every couple of seconds on the UI thread.
 *
 * Three rules it follows, all from the same principle that a compass must never nag:
 *
 * 1. **It is dismissible**, and the caller keeps the dismissal until the condition clears.
 * 2. **It is quiet** — a paper card in the flow, not an alert, and never over the dial.
 * 3. **It respects reduce-motion**: the loop stops and the dot rests, because a small perpetually
 *    moving object is precisely what that setting exists to switch off. The instruction still
 *    reads the same, so nothing is lost.
 */
export interface QiblaCalibrationCardProps {
  /** Dismisses the card. The caller decides when it may come back. */
  onDismiss: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The lemniscate's box, and how long one full circuit takes. */
const FIGURE_WIDTH = 62;
const FIGURE_HEIGHT = 34;
const DOT_SIZE = 7;
const LOOP_MS = 2600;
/** Points sampled along the curve to draw it. 48 is smooth at this size and costs nothing. */
const SAMPLES = 48;
const TAU = Math.PI * 2;

/** Lemniscate of Gerono: `x = sin θ`, `y = sin θ · cos θ` — the figure 8 people actually draw. */
function figureEightPoint(theta: number): { x: number; y: number } {
  const amplitudeX = (FIGURE_WIDTH - DOT_SIZE) / 2;
  const amplitudeY = (FIGURE_HEIGHT - DOT_SIZE) / 2;
  return {
    x: FIGURE_WIDTH / 2 + amplitudeX * Math.sin(theta),
    y: FIGURE_HEIGHT / 2 + amplitudeY * 2 * Math.sin(theta) * Math.cos(theta),
  };
}

/**
 * The calibration card.
 *
 * @param onDismiss - Called when the user closes the card.
 * @returns A paper card with the animated figure-8, the instruction and a dismiss button.
 */
export function QiblaCalibrationCard({
  onDismiss,
  style,
  testID = 'qibla-calibration',
}: QiblaCalibrationCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      })
      .catch(() => {
        // A platform that cannot answer is treated as "motion is fine" — the default.
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.linear }), -1, false)
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress, reduceMotion]);

  const path = useMemo(() => {
    const points = Array.from({ length: SAMPLES + 1 }, (_, index) =>
      figureEightPoint((index / SAMPLES) * TAU)
    );
    return points
      .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');
  }, []);

  const dotStyle = useAnimatedStyle(() => {
    const theta = progress.get() * TAU;
    // Inlined rather than calling `figureEightPoint`: this runs on the UI thread, where a plain
    // JS function from the module scope is not available unless it is a worklet.
    const amplitudeX = (FIGURE_WIDTH - DOT_SIZE) / 2;
    const amplitudeY = (FIGURE_HEIGHT - DOT_SIZE) / 2;
    return {
      transform: [
        { translateX: amplitudeX * Math.sin(theta) },
        { translateY: amplitudeY * 2 * Math.sin(theta) * Math.cos(theta) },
      ],
    };
  });

  return (
    <Card
      testID={testID}
      variant="bright"
      border="mid"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
        },
        style,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: FIGURE_WIDTH, height: FIGURE_HEIGHT, justifyContent: 'center' }}
      >
        <Svg width={FIGURE_WIDTH} height={FIGURE_HEIGHT}>
          <Path
            d={path}
            fill="none"
            stroke={colors.accent}
            strokeOpacity={0.35}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </Svg>
        <Animated.View
          testID={`${testID}-dot`}
          style={[
            {
              position: 'absolute',
              top: FIGURE_HEIGHT / 2 - DOT_SIZE / 2,
              left: FIGURE_WIDTH / 2 - DOT_SIZE / 2,
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: DOT_SIZE / 2,
              backgroundColor: colors.accent,
            },
            dotStyle,
          ]}
        />
      </View>

      <View accessible accessibilityRole="text" style={{ flex: 1, gap: 2 }}>
        <AppText
          variant="caption"
          italic={false}
          weight={600}
          tone="ink"
          style={{ fontSize: 13.5 }}
        >
          {t('qibla.calibration.title')}
        </AppText>
        <AppText variant="caption" tone="header">
          {t('qibla.calibration.body')}
        </AppText>
      </View>

      <PressableScale
        testID={`${testID}-dismiss`}
        accessibilityRole="button"
        accessibilityLabel={t('qibla.calibration.dismiss')}
        onPress={onDismiss}
        style={{ padding: spacing.xs }}
      >
        <Icon name="close" size={18} color={colors.faint} />
      </PressableScale>
    </Card>
  );
}
