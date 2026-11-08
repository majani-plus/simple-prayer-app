import { Children, isValidElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { SectionDivider } from './SectionDivider';
import { SettingIconGutterContext } from './SettingRow';
import { spacing, useTheme } from '@/theme';

/**
 * One block of settings: a ◆ section rule, a quiet title, and the rows on a single paper card.
 *
 * Two behaviours the screen depends on:
 *
 * 1. **Hairlines belong to the group, not the rows.** The group draws a 1pt rule between
 *    consecutive rows, inset so it starts under the label rather than cutting the card in half.
 *    A row therefore stays a plain block of content and can be moved between groups freely.
 * 2. **The left edge belongs to the group too.** Leading glyphs are optional per row, but a card
 *    reads as one list with one left edge. If *any* row in the group carries an icon, the group
 *    tells all of them to reserve the glyph gutter, so a card mixing icon and iconless rows still
 *    lines its labels up instead of stepping in and out.
 * 3. **An empty group disappears entirely** — rule, title and card. That is what makes it safe
 *    to leave a group in place as a *slot* for rows another screen has not added yet: the
 *    settings list never shows an empty card, and the section appears the moment it has content.
 *    `null`/`false` children (conditional rows) count as no content, so a group whose only row is
 *    platform-specific vanishes on the other platform without any extra condition.
 *
 * Titles and footnotes arrive already localized; the group renders no strings of its own.
 */

export interface SettingGroupProps {
  /** Quiet section title above the card (e.g. "Reminders"). */
  title?: string;
  /** A single explanatory line under the card, for a caveat that belongs to the whole group. */
  footer?: string;
  /**
   * Draws the ◆ section rule above the title. Defaults to `true`; pass `false` for the first
   * group on a screen, which sits directly under the screen header.
   */
  divider?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A titled card of settings rows.
 *
 * @param title - Section title; omit for an untitled card.
 * @param divider - Whether to draw the ◆ rule above the title (default `true`).
 * @returns The section, or `null` when it has no rows to show.
 */
export function SettingGroup({
  title,
  footer,
  divider = true,
  children,
  style,
  testID,
}: SettingGroupProps) {
  const { colors } = useTheme();
  // `Children.toArray` drops `null`, `undefined` and booleans — exactly the values a conditional
  // row evaluates to — so this is the same question as "does this group have any rows".
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;

  // Only the rows this group renders directly are asked: a row's own nested content (choice
  // chips, an offset list) is laid out by the row and is not part of the card's left edge.
  const anyIcon = rows.some(
    (row) =>
      isValidElement<{ icon?: unknown }>(row) &&
      (row.props as { icon?: unknown }).icon !== undefined,
  );

  return (
    <View testID={testID} style={[{ gap: spacing.sm }, style]}>
      {divider ? <SectionDivider placement="top" style={{ marginBottom: spacing.xs }} /> : null}

      {title === undefined ? null : (
        <AppText
          variant="headerMeta"
          weight={600}
          tone="header"
          accessibilityRole="header"
          style={{ paddingHorizontal: spacing.xs }}
        >
          {title}
        </AppText>
      )}

      <Card variant="bright" border="faint" style={{ overflow: 'hidden' }}>
        <SettingIconGutterContext value={anyIcon}>
          {rows.map((row, index) => (
            // The index is a stable identity: this list is positional and fixed per render pass.
            <View key={index}>
              {index === 0 ? null : (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    height: 1,
                    marginStart: spacing.lg,
                    backgroundColor: colors.borderFaint,
                  }}
                />
              )}
              {row}
            </View>
          ))}
        </SettingIconGutterContext>
      </Card>

      {footer === undefined ? null : (
        <AppText variant="hint" style={{ paddingHorizontal: spacing.xs }}>
          {footer}
        </AppText>
      )}
    </View>
  );
}
