import { I18nManager, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, useTheme } from '@/theme';

/**
 * The on/off toggle, drawn in the paper language instead of the platform's.
 *
 * The stock `Switch` was the one control on the settings screens that still read as system
 * chrome: a hard-edged capsule with a pure-white puck and a saturated fill, sitting on parchment
 * beside serif type. It was worse in the dark theme, where the platform's "off" track is a *light*
 * pill — brighter than the accent-filled "on" state, so an off switch looked more active than an
 * on one.
 *
 * This one is built from the same two ingredients as every other surface in the app: a paper fill
 * inside a gold hairline. Off is an outlined, empty track with the knob resting on the leading
 * edge; on is the track filled with the accent and the knob at the trailing edge. Both states
 * carry the same 1pt border, so the control keeps its shape at either end and in either theme.
 *
 * ## Why it takes no `onValueChange`
 *
 * It is a *display* of state, not a target. {@link SettingSwitchRow} makes the whole row the
 * gesture and the accessibility node — one target, one announcement, no chance of a double
 * toggle — and renders this purely to show which way the setting is set. Anything that needs a
 * standalone toggle should wrap it in a pressable that owns the `switch` role.
 */

/** Track geometry. 52×32 keeps the knob at a comfortable 26pt inside a 3pt inset. */
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;
const BORDER = 1;
const KNOB_INSET = 3;
const KNOB_SIZE = TRACK_HEIGHT - KNOB_INSET * 2;
/** How far the knob travels between the two ends. Exported for the component test. */
export const SWITCH_TRAVEL = TRACK_WIDTH - KNOB_SIZE - KNOB_INSET * 2;

/** The design's standard UI easing (`cubic-bezier(.4,0,.2,1)`). */
const SWITCH_EASING = Easing.bezier(0.4, 0, 0.2, 1);

export interface PaperSwitchProps {
  /** Current state. */
  value: boolean;
  /** Dims the control to match a disabled row. */
  disabled?: boolean;
  testID?: string;
}

/**
 * A themed on/off indicator.
 *
 * @param value - Which way the setting is set.
 * @param disabled - Dims the track, border and knob.
 * @returns A non-interactive, accessibility-transparent switch face.
 */
export function PaperSwitch({ value, disabled = false, testID }: PaperSwitchProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  // One shared value drives fill, border and knob position together, so the control never shows
  // a half-filled track under a knob that has already arrived. Reduced motion: the knob jump-cuts
  // to its end — both states are fully legible without the slide (spec-accessibility §2.7).
  const progress = useDerivedValue(
    () =>
      reduceMotion
        ? value
          ? 1
          : 0
        : withTiming(value ? 1 : 0, { duration: motion.state, easing: SWITCH_EASING })
  );

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.cardQuiet, disabled ? colors.soft : colors.accent],
    ),
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      [disabled ? colors.borderFaint : colors.borderMid, disabled ? colors.soft : colors.accent],
    ),
  }));

  const knobStyle = useAnimatedStyle(() => ({
    // The knob travels toward the trailing edge, which mirrors with the writing direction.
    transform: [{ translateX: progress.value * SWITCH_TRAVEL * (I18nManager.isRTL ? -1 : 1) }],
    // The knob changes ground as it travels — empty track at one end, accent fill at the other —
    // so its own colour has to travel with it. A fixed cream knob is right on the accent and
    // invisible on the night theme's empty track, which is what the platform control got wrong.
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.faint, disabled ? colors.borderMid : colors.sealFg],
    ),
  }));

  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        testID={testID === undefined ? undefined : `${testID}-track`}
        style={[
          {
            width: TRACK_WIDTH,
            height: TRACK_HEIGHT,
            borderRadius: TRACK_HEIGHT / 2,
            borderWidth: BORDER,
            padding: KNOB_INSET - BORDER,
            opacity: disabled ? 0.55 : 1,
            justifyContent: 'center',
          },
          trackStyle,
        ]}
      >
        <Animated.View
          testID={testID === undefined ? undefined : `${testID}-knob`}
          style={[
            {
              width: KNOB_SIZE,
              height: KNOB_SIZE,
              borderRadius: KNOB_SIZE / 2,
            },
            knobStyle,
          ]}
        />
      </Animated.View>
    </View>
  );
}
