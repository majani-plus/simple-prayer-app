import { useState } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type Insets,
  type LayoutChangeEvent,
  type PressableProps,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion } from '@/theme';
import { tickHaptic } from '@/utils/haptics';

/**
 * A `Pressable` that dips on touch — the press feedback the design applies everywhere.
 *
 * The scale lives in a Reanimated shared value and is animated on the UI thread, so a press stays
 * responsive while the JS thread is busy (logging a prayer writes to SQLite) and never re-renders
 * React. The amount is per call site because the mockup varies it: 0.95 for pills and cards, 0.93
 * for the seal face, 0.9 for the seal's three options.
 *
 * **Scale is for compact controls.** The same ratio that reads as a press on a 48pt seal reads as
 * the screen wobbling on a full-width row — the owner called it out on the settings toggles. A
 * large surface passes `scale={1}` with a `pressedOpacity` instead: the content dips like ink
 * lightening under a thumb, nothing moves. Both run on the same shared progress, so a call site
 * may also combine them.
 *
 * It also guarantees the 48pt minimum touch target (Google's 48dp bar — the stricter of the two
 * platforms' floors, and what the Play pre-launch report checks; Apple's 44pt is exceeded for
 * free): anything laid out smaller than `minTouchTarget` grows a matching `hitSlop`, so a 12pt
 * icon button is still comfortably tappable without padding that would break the visual rhythm.
 *
 * When the OS asks for reduced motion, the dip becomes a jump-cut: the pressed scale is applied
 * and released instantly, so the feedback survives without anything easing across frames.
 *
 * **Haptics fire on the press, never on touch-down.** `onPressIn` arrives the instant a finger
 * lands — including the finger that is about to scroll the list, which the ScrollView then takes
 * over without `onPress` ever firing. Ticking there meant every scroll that began on a seal
 * buzzed (owner, 2026-09-13: *"vibration should only be on click otherwise it's annoying"*). The
 * tick now rides `onPress`, the same event that commits the action, and is sent before the
 * caller's handler runs so a slow handler (a SQLite write) can never hold it back.
 */

/**
 * Press-in: a fast ease-out, so the control is already down by the time the finger has settled.
 * The design's ease-in-out (`.4,0,.2,1`) spent its first third barely moving, which read as lag.
 */
const PRESS_EASING = Easing.bezier(0.2, 0, 0, 1);
/**
 * Release: a stiff spring with a hair of overshoot, so the control springs back like a physical
 * key instead of fading back up (owner, 2026-11-07: "feel tactile, like something physical I can
 * press"). Settles in about 150ms.
 */
const RELEASE_SPRING = { stiffness: 900, damping: 30, mass: 1 } as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  /** Scale at full press. Defaults to 0.95. Pass 1 (with `pressedOpacity`) for large surfaces. */
  scale?: number;
  /**
   * Opacity at full press. Off by default — most controls speak through `scale` alone. Full-width
   * rows use this *instead* of the scale (see above): the whole card dimming slightly is press
   * feedback; the whole card moving is wobble.
   */
  pressedOpacity?: number;
  /**
   * Fire the light tick (`tickHaptic`) when the press commits (`onPress`). Off by default. Never on
   * touch-down: a touch that becomes a scroll must stay silent.
   */
  haptics?: boolean;
  /**
   * Minimum tappable size in points; a smaller layout is padded out with `hitSlop`.
   * Defaults to 48 (Google's 48dp floor; Apple's 44pt is exceeded for free — D55). Pass 0 to opt
   * out, or pass your own `hitSlop` — an explicit one always wins.
   */
  minTouchTarget?: number;
  /**
   * The underlying pressable's host node. Declared rather than left to the props spread because
   * one caller needs it for a real job: after a pick the seal hands VoiceOver's focus to its face,
   * and `AccessibilityInfo.setAccessibilityFocus` needs a node handle to aim at.
   */
  ref?: React.Ref<ViewInstance>;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * A pressable that scales down while held.
 *
 * @param scale - Pressed scale (default 0.95).
 * @param pressedOpacity - Pressed opacity; the press feedback for large surfaces (with `scale={1}`).
 * @param haptics - Whether to play selection feedback when the press commits.
 * @returns A `Pressable`; every accessibility prop is forwarded, and `accessibilityRole`
 * defaults to `button`.
 */
export function PressableScale({
  scale = 0.95,
  pressedOpacity,
  haptics = false,
  minTouchTarget = 48,
  disabled = false,
  accessibilityRole = 'button',
  hitSlop,
  ref,
  style,
  onPress,
  onPressIn,
  onPressOut,
  onLayout,
  children,
  ...rest
}: PressableScaleProps) {
  const pressedScale = useSharedValue(1);
  const pressedDim = useSharedValue(1);
  const reduceMotion = useReduceMotion();
  const [measuredSlop, setMeasuredSlop] = useState<Insets | undefined>(undefined);

  // A disabled control must keep whatever static opacity its caller painted (OptionCard greys
  // itself out at 0.55): the animated `opacity: 1` would silently win over the style prop.
  const dims = pressedOpacity !== undefined && !disabled;

  const animatedStyle = useAnimatedStyle(() =>
    dims
      ? { transform: [{ scale: pressedScale.get() }], opacity: pressedDim.get() }
      : { transform: [{ scale: pressedScale.get() }] }
  );

  // `.set()` rather than assigning `.value`: the shared value is a mutable box React does not own,
  // and the accessor form is what the React Compiler's immutability rule accepts.
  const animateTo = (pressed: boolean) => {
    // Reduced motion: the pressed state still shows, it just arrives without travelling. (The
    // opacity dip is not motion, but the same jump-cut costs nothing and keeps one rule.)
    const apply = (value: SharedValue<number>, target: number) => {
      value.set(
        reduceMotion
          ? target
          : pressed
            ? withTiming(target, { duration: motion.press, easing: PRESS_EASING })
            : withSpring(target, RELEASE_SPRING)
      );
    };
    apply(pressedScale, pressed ? scale : 1);
    if (dims) apply(pressedDim, pressed ? pressedOpacity : 1);
  };

  const handlePressIn = (event: GestureResponderEvent) => {
    animateTo(true);
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    animateTo(false);
    onPressOut?.(event);
  };

  const handlePress = (event: GestureResponderEvent) => {
    // Before the caller's handler, so the tick lands with the lift of the finger and not after
    // whatever the handler does (writing the log, closing a pill).
    if (haptics) tickHaptic();
    onPress?.(event);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const horizontal = Math.max(0, (minTouchTarget - width) / 2);
    const vertical = Math.max(0, (minTouchTarget - height) / 2);
    setMeasuredSlop((previous) => {
      if (horizontal === 0 && vertical === 0) return previous === undefined ? previous : undefined;
      if (previous?.left === horizontal && previous.top === vertical) return previous;
      return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
    });
    onLayout?.(event);
  };

  return (
    <AnimatedPressable
      ref={ref}
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      hitSlop={hitSlop ?? measuredSlop}
      onLayout={minTouchTarget > 0 && hitSlop === undefined ? handleLayout : onLayout}
      onPress={disabled ? undefined : handlePress}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
