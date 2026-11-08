import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  ORNAMENT_LINE_HEIGHT,
  ORNAMENT_MARGIN,
  ORNAMENT_SIZE,
  RULE_THICKNESS,
} from './SectionDivider';
import { fonts, useTheme } from '@/theme';

/**
 * `SectionDivider`, turned ninety degrees: the seam between two panes (D125).
 *
 * The design language had only a horizontal section rule, because until the expanded layouts there
 * was only ever one column. This is deliberately the *same* ornament at the same size on the same
 * hairline, so a spread reads as one sheet of paper divided rather than two screens pushed
 * together — and, as there, the rule is drawn as two flexing segments with the ornament between
 * them so the paper's texture runs straight through the break instead of being covered by a chip.
 *
 * The glyph keeps its horizontal tracking correction rather than gaining a vertical one: a single
 * ◆ is optically square, and the eye reads it as centred in a 14pt-wide column.
 */

/** The seam's width — the ornament's line box, so the ◆ sits in it without wrapping. */
export const DIVIDER_WIDTH = ORNAMENT_LINE_HEIGHT;

export interface VerticalDividerProps {
  /** The ◆ on the rule. On by default: this seam is the ornamented one. */
  ornament?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A themed pane seam.
 *
 * @param ornament - Whether to carry the ◆ (default `true`).
 * @returns A decorative `View`, hidden from assistive technology — a divider is not a stop on the
 *   way through a screen, and the panes either side announce themselves.
 */
export function VerticalDivider({ ornament = true, style, testID }: VerticalDividerProps) {
  const { colors } = useTheme();

  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: DIVIDER_WIDTH, alignItems: 'center' }, style]}
    >
      <View style={{ flex: 1, width: RULE_THICKNESS, backgroundColor: colors.hairline }} />
      {ornament ? (
        <Text
          // Frozen for the same reason as the horizontal rule's: pure ornament, hidden from the
          // accessibility tree above, owing Dynamic Type nothing.
          allowFontScaling={false}
          style={{
            marginVertical: ORNAMENT_MARGIN,
            fontFamily: fonts.regular,
            fontSize: ORNAMENT_SIZE,
            lineHeight: ORNAMENT_LINE_HEIGHT,
            color: colors.diamond,
          }}
        >
          ◆
        </Text>
      ) : null}
      <View style={{ flex: 1, width: RULE_THICKNESS, backgroundColor: colors.hairline }} />
    </View>
  );
}
