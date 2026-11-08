import { useEffect, type ReactNode } from 'react';
import { I18nManager, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, useTheme } from '@/theme';

/**
 * A rate drawn as a ring: an accent arc over a faint track, with the number itself in the middle.
 *
 * The shape and the numeral say the same thing twice, which is the point — the arc is read before
 * the eye has finished the percentage, and the percentage is there for anyone the arc does not
 * serve. Nothing here is colour-only; the centre always carries the words.
 *
 * `rate` of `null` means "there is nothing to divide" (a week with no obligated prayer in it), and
 * is drawn as the bare track rather than as a zero — an empty ring and a 0% ring are different
 * facts, and only one of them is about the person using the app.
 *
 * The arc animates to its value on mount and on change, instantly under reduced motion
 * (spec-accessibility §2.7). Like the qada counters' rings it is a **gauge** — it starts at twelve
 * and fills forward — so in Arabic it fills the other way, exactly as a progress bar does.
 */

export interface ProgressRingProps {
  /** 0…1, or `null` when there is nothing to divide. */
  rate: number | null;
  /** Outer diameter in points. */
  size?: number;
  /** Ring thickness in points. */
  stroke?: number;
  /** Centred inside the ring — the figure the arc is drawing. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A ring gauge.
 *
 * @param rate - The share to fill, 0…1, or `null` for an empty track.
 * @returns A square of `size` points holding the ring and its centred children.
 */
export function ProgressRing({
  rate,
  size = 76,
  stroke = 7,
  children,
  style,
  testID,
}: ProgressRingProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  const radiusPx = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  const fraction = rate === null ? 0 : Math.max(0, Math.min(1, rate));

  const filled = useSharedValue(fraction);
  useEffect(() => {
    filled.set(
      reduceMotion
        ? fraction
        : withTiming(fraction, { duration: motion.dial, easing: Easing.bezier(0.3, 0.7, 0.3, 1) })
    );
  }, [filled, fraction, reduceMotion]);

  const arc = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - filled.get()),
  }));

  return (
    <View
      testID={testID}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute', transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
        pointerEvents="none"
      >
        <Circle
          testID={testID === undefined ? undefined : `${testID}-track`}
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          fill="none"
          stroke={colors.borderFaint}
          strokeWidth={stroke}
        />
        {rate === null ? null : (
          <AnimatedCircle
            testID={testID === undefined ? undefined : `${testID}-arc`}
            cx={size / 2}
            cy={size / 2}
            r={radiusPx}
            fill="none"
            stroke={colors.accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animatedProps={arc}
            // Start the arc at twelve o'clock rather than at three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      {children}
    </View>
  );
}
