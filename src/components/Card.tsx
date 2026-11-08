import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { radius as radiusScale, useTheme } from '@/theme';

/**
 * The paper surface every row, info card and grouped block sits on: a 14pt-radius rectangle with
 * a 1pt hairline border over a translucent paper fill.
 *
 * `variant` picks how far the fill lifts off the background — the palette ships the four levels
 * the design uses (quiet rows → default rows → the next-prayer row → an expanded/elevated
 * surface). `emphasised` adds what marks the *next prayer*: the strong gold border plus the soft
 * gold glow (`0 2px 10px -4px`) from the mockup.
 */

/** Fill levels, from the quietest past-prayer row to a fully elevated surface. */
export type CardVariant = 'quiet' | 'normal' | 'bright' | 'elevated';

/** Border weights available from the palette. */
export type CardBorder = 'none' | 'faint' | 'mid' | 'strong';

export interface CardProps extends Omit<ViewProps, 'style'> {
  /** Fill level. Defaults to `normal`. */
  variant?: CardVariant;
  /** Border colour. Defaults to `strong` when emphasised, `faint` otherwise. */
  border?: CardBorder;
  /** The next-prayer treatment: strong gold border + gold glow. */
  emphasised?: boolean;
  /** Corner radius. Defaults to the design's 14. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A themed paper card.
 *
 * @param variant - Fill level; see {@link CardVariant}.
 * @param emphasised - Adds the gold border + glow used for the next prayer.
 * @returns A `View` styled as the design's card surface. Compose it with `PressableScale` when
 * the card itself is tappable — `Card` stays presentational.
 */
export function Card({
  variant = 'normal',
  border,
  emphasised = false,
  radius = radiusScale.card,
  style,
  children,
  ...rest
}: CardProps) {
  const { colors } = useTheme();

  const backgrounds: Record<CardVariant, string> = {
    quiet: colors.cardQuiet,
    normal: colors.card,
    bright: colors.cardBright,
    elevated: colors.cardElevated,
  };

  const borders: Record<CardBorder, string> = {
    none: 'transparent',
    faint: colors.borderFaint,
    mid: colors.borderMid,
    strong: colors.borderStrong,
  };

  const resolvedBorder = border ?? (emphasised ? 'strong' : 'faint');

  // Built up field by field below; RN 0.87's style types are read-only.
  const resolved: { -readonly [K in keyof ViewStyle]: ViewStyle[K] } = {
    borderRadius: radius,
    backgroundColor: backgrounds[variant],
    borderWidth: 1,
    borderColor: borders[resolvedBorder],
  };

  if (emphasised) {
    // The design's `0 2px 10px -4px rgba(138,100,32,.3)`. `boxShadow` is used rather than the
    // legacy shadow* props because it is the only cross-platform way to express the negative
    // spread that keeps the glow tight under the card.
    resolved.boxShadow = [
      {
        offsetX: 0,
        offsetY: 2,
        blurRadius: 10,
        spreadDistance: -4,
        color: colors.shadowGold,
      },
    ];
  }

  return (
    <View style={[resolved, style]} {...rest}>
      {children}
    </View>
  );
}
