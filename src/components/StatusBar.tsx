import { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { radius, useTheme } from '@/theme';

/**
 * The stats page's one shape: a stacked bar of prayed · late · missed over an unlogged track.
 *
 * It exists so a number can also be *seen*. Every figure on the History tab used to be a numeral
 * in a table; the bar gives the same fact a length, which is what makes the page readable at a
 * glance without anybody having to divide in their head.
 *
 * Three rules it keeps:
 *
 * - **Unlogged is the track, never a fill.** What was not marked is left as paper — the absence of
 *   colour, not a fourth colour — so nothing that was simply never logged can read as a miss
 *   (PRODUCT_SPEC §5). A month nobody logged is an empty track, which is exactly what it is.
 * - **It carries no meaning of its own** (`accessible={false}`): the words beside it say prayed,
 *   late and missed in full, and a colour is never the only signal anywhere in this app.
 * - **The fills stay countable.** A 1pt paper gap separates them, so three segments read as three
 *   segments rather than one gradient.
 *
 * Widths are flex shares of the total rather than measured points, so the bar is correct at its
 * first frame at any width — a tablet pane, a wide card, a phone — with no layout pass to wait
 * for. The shares animate when they change (a window switch, a fresh tap), instantly under
 * reduced motion (spec-accessibility §2.7).
 */

export interface StatusBarProps {
  prayed: number;
  late: number;
  missed: number;
  /** Everything the bar is a share of, unlogged included. `0` renders the empty track. */
  total: number;
  /** Bar height in points. The design's 8. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The paper showing between two fills, in points. */
const FILL_GAP = 1;

/** How long a share takes to travel to a new value (the design's 320ms). */
const FILL_MS = 320;

/**
 * One animated fill: a share of the bar in one of the three seal colours.
 *
 * @param share - 0…1 of the whole bar.
 */
function Fill({ share, color, testID }: { share: number; color: string; testID?: string }) {
  const reduceMotion = useReduceMotion();
  const grow = useSharedValue(share);
  useEffect(() => {
    grow.set(reduceMotion ? share : withTiming(share, { duration: FILL_MS }));
  }, [grow, reduceMotion, share]);

  const style = useAnimatedStyle(() => ({ flexGrow: grow.get() }));

  return (
    <Animated.View
      testID={testID}
      style={[{ flexBasis: 0, backgroundColor: color, borderRadius: radius.pill }, style]}
    />
  );
}

/**
 * A stacked status bar.
 *
 * @param total - The denominator; `prayed + late + missed` plus whatever was never marked.
 * @returns A pill-shaped track with up to three fills, or the bare track when nothing is tracked.
 */
export function StatusBar({
  prayed,
  late,
  missed,
  total,
  height = 8,
  style,
  testID,
}: StatusBarProps) {
  const { colors } = useTheme();
  const share = (value: number) => (total > 0 ? Math.max(0, Math.min(1, value / total)) : 0);
  const fills = [
    { key: 'prayed', share: share(prayed), color: colors.accent },
    { key: 'late', share: share(late), color: colors.late },
    { key: 'missed', share: share(missed), color: colors.missed },
  ];
  // The remainder is claimed explicitly rather than left as free space: Yoga hands *all* spare
  // room to the growing children, so without this the three fills would stretch to fill a bar
  // that is mostly unlogged.
  const rest = Math.max(0, 1 - fills.reduce((sum, fill) => sum + fill.share, 0));

  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          flexDirection: 'row',
          gap: FILL_GAP,
          height,
          borderRadius: radius.pill,
          backgroundColor: colors.borderFaint,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {fills.map((fill) => (
        <Fill
          key={fill.key}
          share={fill.share}
          color={fill.color}
          testID={testID === undefined ? undefined : `${testID}-${fill.key}`}
        />
      ))}
      {/* Transparent, and animated like the others: the track has to give way at the same rate
          the fills take it, or the bar tears for the length of the animation. */}
      <Fill share={rest} color="transparent" />
    </View>
  );
}
