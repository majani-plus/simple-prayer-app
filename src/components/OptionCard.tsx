import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { radius, spacing, useTheme } from '@/theme';

/**
 * **One card per option** in a "pick exactly one" list — the calculation method, the Asr madhab,
 * the high-latitude rule.
 *
 * The whole point of the component is that **selection is never colour-only** (PRODUCT_SPEC §16,
 * DESIGN.md): the chosen card carries a filled check glyph, a brighter fill, the strong gold
 * border *and* the `selected`/`checked` accessibility state. Any one of those alone would fail
 * somebody — a colour-blind user, a screen-reader user, or a phone in bright sunlight.
 *
 * `value` is the trailing slot for a live consequence of the choice ("15:42" beside Hanafi), so a
 * user can see what a setting does before committing to it rather than after.
 *
 * ### Card, not chips — the difference from {@link SettingChoiceRow}
 *
 * The app has exactly two ways to pick one of several things, and they are not interchangeable:
 *
 * | | `SettingChoiceRow` | `OptionCard` (this) |
 * |---|---|---|
 * | Shape | *one* settings row holding all the options as chips | *one card per option*, stacked |
 * | Fits | 2–4 options, one or two words each | 2–14 options |
 * | Per-option description | no — only the *selected* option explains itself, under the chips | yes, every option carries its own sentence |
 * | Per-option preview | no | yes (`value`) |
 * | Lives in | a {@link SettingGroup} card, beside other rows | its own stack, usually revealed by a disclosure row |
 *
 * A short either/or ("Relaxed / Committed") reads at a glance as chips and would waste a screen
 * as cards. The fourteen calculation authorities are the opposite case: every one of them needs
 * its own sentence and its own preview, and an authority nobody can read the description of is
 * exactly the failure the picker exists to avoid (our market research).
 *
 * Anything longer than about four options therefore belongs here; anything shorter belongs in a
 * `SettingChoiceRow`.
 */

export interface OptionCardProps {
  /** The option's name. */
  label: string;
  /** One quiet line explaining it. */
  description?: string;
  /** Trailing value — typically a live preview of what choosing this would produce. */
  value?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Spoken hint; the label and description are already announced. */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A selectable paper card with radio semantics.
 *
 * @param selected - Whether this is the active choice.
 * @param value - Optional trailing preview text.
 * @returns A pressable card announcing itself as a radio option.
 */
export function OptionCard({
  label,
  description,
  value,
  selected,
  onPress,
  disabled = false,
  accessibilityHint,
  style,
  testID,
}: OptionCardProps) {
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityLabel={description === undefined ? label : `${label}. ${description}`}
      accessibilityHint={accessibilityHint}
      accessibilityValue={value === undefined ? undefined : { text: value }}
      disabled={disabled}
      haptics
      onPress={onPress}
      // A full-width card dims under the thumb rather than scaling — the same rule as SettingRow:
      // at this width even a gentle scale reads as the screen wobbling, not as a press.
      scale={1}
      pressedOpacity={0.7}
      style={[{ borderRadius: radius.card, opacity: disabled ? 0.55 : 1 }, style]}
    >
      <Card
        variant={selected ? 'bright' : 'normal'}
        border={selected ? 'strong' : 'faint'}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          minHeight: 52,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        }}
      >
        <Icon
          name={selected ? 'check_circle' : 'circle'}
          size={20}
          variant={selected ? 'filled' : 'outlined'}
          color={selected ? colors.accent : colors.unlogged}
        />
        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="rowName" weight={selected ? 600 : 500}>
            {label}
          </AppText>
          {description === undefined ? null : (
            <AppText variant="caption" tone="header">
              {description}
            </AppText>
          )}
        </View>
        {value === undefined ? null : (
          <AppText variant="time" weight={600} tone={selected ? 'strong' : 'muted'} tabularNums>
            {value}
          </AppText>
        )}
      </Card>
    </PressableScale>
  );
}
