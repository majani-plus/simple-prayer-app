import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fonts, useTheme } from '@/theme';

/**
 * The hairline rule that bounds a section, with the ◆ ornament sitting *on* the line.
 *
 * In the mockup the ornament is a paper-coloured chip centred over the rule, so the rule appears
 * to break behind it. Painting that chip is wrong *here*: the app's paper carries a noise texture
 * and a vignette that a flat `colors.bg` rectangle cannot match, so the chip showed up as a pale
 * patch sitting on the parchment. The rule is therefore drawn as two flexing segments with the
 * ornament between them — the same broken line, with the texture running straight through it.
 *
 * The hero section is bounded by two of these: `placement="top"` carries the ornament,
 * `placement="bottom"` is the bare rule. Spacing around it belongs to the parent.
 */

/** Ornament glyph size (px) and the .3em tracking the design specifies. */
export const ORNAMENT_SIZE = 12;
const ORNAMENT_TRACKING = ORNAMENT_SIZE * 0.3;
export const ORNAMENT_LINE_HEIGHT = 14;
export const RULE_THICKNESS = 1;
/** Air between the ornament and the rule it breaks. */
export const ORNAMENT_MARGIN = 12;

export interface SectionDividerProps {
  /**
   * Which edge of the section this rule is. `top` carries the ◆ by default (as in the mockup),
   * `bottom` is a plain hairline.
   */
  placement?: 'top' | 'bottom';
  /** Force the ornament on or off, whatever the placement. */
  ornament?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A themed section rule.
 *
 * @param placement - `top` (default, ornamented) or `bottom`.
 * @returns A decorative `View`, hidden from assistive technology.
 */
export function SectionDivider({
  placement = 'top',
  ornament,
  style,
  testID,
}: SectionDividerProps) {
  const { colors } = useTheme();
  const showOrnament = ornament ?? placement === 'top';
  const height = showOrnament ? ORNAMENT_LINE_HEIGHT : RULE_THICKNESS;

  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height, flexDirection: 'row', alignItems: 'center' }, style]}
    >
      <View style={{ flex: 1, height: RULE_THICKNESS, backgroundColor: colors.hairline }} />
      {showOrnament ? (
        <Text
          // Deliberately frozen (spec-accessibility §2.4): pure ornament, hidden from the
          // accessibility tree above — it carries no words and owes Dynamic Type nothing.
          allowFontScaling={false}
          style={{
            marginHorizontal: ORNAMENT_MARGIN,
            fontFamily: fonts.regular,
            fontSize: ORNAMENT_SIZE,
            lineHeight: ORNAMENT_LINE_HEIGHT,
            color: colors.diamond,
            letterSpacing: ORNAMENT_TRACKING,
            // Letter spacing is trailing-only, so the single glyph would sit half a tracking
            // step left of centre; this pays it back.
            paddingStart: ORNAMENT_TRACKING,
          }}
        >
          ◆
        </Text>
      ) : null}
      <View style={{ flex: 1, height: RULE_THICKNESS, backgroundColor: colors.hairline }} />
    </View>
  );
}
