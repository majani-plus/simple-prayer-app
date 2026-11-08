import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PrayerSeal } from './PrayerSeal';
import type { PrayerStatus, TrackingMode } from '@/domain/types';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { spacing } from '@/theme';

/**
 * A small looping picture of a tracking mode, for first-run setup (D192): the real seal, being
 * "tapped" through the states that mode has — prayed ↔ missed for simple, prayed → late → missed
 * for detailed. Built from `PrayerSeal` itself, so the picture is exactly what the user will tap.
 *
 * Decorative: the option card beside it says the same thing in words, so the whole picture is
 * hidden from screen readers and takes no touches. With reduce motion on, nothing moves — the
 * states stand side by side instead, which says the same thing without animation.
 */

/** The states each mode's seal cycles through. */
const STATES: Record<TrackingMode, readonly PrayerStatus[]> = {
  simple: ['prayed', 'missed'],
  detailed: ['prayed', 'late', 'missed'],
};

/** How long each state shows before the next "tap". */
const STEP_MS = 1600;

const noop = () => {};

export interface TrackingModeDemoProps {
  mode: TrackingMode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrackingModeDemo({ mode, style, testID }: TrackingModeDemoProps) {
  const reduceMotion = useReduceMotion();
  const states = STATES[mode];
  const [index, setIndex] = useState(0);
  const press = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => {
      // The press dip, then the face changes — the same order a real tap has.
      press.set(
        withSequence(withTiming(0.88, { duration: 110 }), withTiming(1, { duration: 190 }))
      );
      setIndex((current) => (current + 1) % states.length);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [reduceMotion, states.length, press]);

  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.get() }] }));

  const seal = (status: PrayerStatus, key?: string) => (
    <PrayerSeal
      key={key}
      testID={key === undefined ? `${testID}-seal` : `${testID}-seal-${status}`}
      prayer="dhuhr"
      prayerName=""
      status={status}
      isOpen={false}
      disabled
      onToggleOpen={noop}
      onPick={noop}
    />
  );

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }, style]}
    >
      {reduceMotion ? (
        states.map((status) => seal(status, status))
      ) : (
        <Animated.View style={pressStyle}>{seal(states[index] ?? 'prayed')}</Animated.View>
      )}
    </View>
  );
}
