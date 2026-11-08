import { View } from 'react-native';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { SettingRow, type SettingRowProps } from './SettingRow';
import { radius, spacing, useTheme } from '@/theme';

import type { StyleProp, ViewStyle } from 'react-native';

/**
 * **All the options in one settings row**, shown as chips under the label.
 *
 * Chips rather than a picker or an action sheet because every choice in this app's settings is
 * small (two to four options) and worth *seeing*: "Relaxed / Committed" explains itself at a
 * glance, where a modal would hide it behind a tap.
 *
 * ### Chips, not cards — the difference from `OptionCard`
 *
 * This is the *short* half of the app's two ways to pick one of several things. It fits two to
 * four one- or two-word options into a single row, and only the **selected** option explains
 * itself (its sentence renders under the chips). When every option needs its own sentence, or its
 * own live preview, or there are more than about four of them — the fourteen calculation
 * authorities, the two Asr schools, the four high-latitude rules — use `OptionCard`, which is one
 * full-width card *per* option, usually revealed by a {@link SettingNavigationRow} or a
 * disclosure row. `OptionCard`'s header carries the full comparison table.
 *
 * The selected chip is never marked by colour alone: it carries a check glyph, its label goes
 * semibold, and it exposes `accessibilityState.selected` with the `radio` role inside a
 * `radiogroup`. The selected option's own sentence — when it has one — is rendered under the
 * chips, so the user reads what the setting they picked actually means.
 *
 * Every string arrives localized; this component renders none of its own.
 */

/** One selectable option. `T` is usually a domain union (`ThemePreference`, `StreakMode`…). */
export interface SettingChoiceOption<T extends string> {
  value: T;
  /** Localized chip label. */
  label: string;
  /** One localized sentence shown under the chips while this option is selected. */
  description?: string;
  /** Accessibility label for the chip; defaults to `label`. */
  accessibilityLabel?: string;
}

export interface SettingChoiceRowProps<T extends string> extends Omit<
  SettingRowProps,
  'value' | 'children' | 'onPress' | 'chevron' | 'trailing' | 'accessibilityRole'
> {
  /** The options, in the order they should read. */
  options: readonly SettingChoiceOption<T>[];
  /** The selected option's value. */
  value: T;
  /** Called with the newly selected value. Selecting the current value is a no-op. */
  onChange: (value: T) => void;
  /** Style for the chip strip. */
  chipsStyle?: StyleProp<ViewStyle>;
}

/**
 * A row of choice chips.
 *
 * @param options - The choices; two to four of them.
 * @param value - The selected value.
 * @param onChange - Receives the new value (never the current one).
 * @returns A static {@link SettingRow} whose children are the chip strip and, when the selected
 * option has one, its explanation.
 */
export function SettingChoiceRow<T extends string>({
  options,
  value,
  onChange,
  chipsStyle,
  disabled = false,
  label,
  testID,
  ...rest
}: SettingChoiceRowProps<T>) {
  const { colors } = useTheme();
  const selected = options.find((option) => option.value === value);

  return (
    <SettingRow {...rest} label={label} disabled={disabled} chevron={false} testID={testID}>
      <View
        testID={testID === undefined ? undefined : `${testID}-options`}
        // The group is labelled and typed, but deliberately NOT `accessible`: marking a container
        // accessible on iOS collapses it into one element and takes the chips themselves out of
        // the focus order, which is the opposite of what a radio group needs.
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, chipsStyle]}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <PressableScale
              key={option.value}
              testID={testID === undefined ? undefined : `${testID}-option-${option.value}`}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              accessibilityState={{ selected: isSelected, disabled }}
              onPress={isSelected ? undefined : () => onChange(option.value)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                minHeight: 34,
                paddingVertical: 7,
                paddingHorizontal: spacing.md,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: isSelected ? colors.accent : colors.borderMid,
                backgroundColor: isSelected ? colors.accent : colors.card,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {isSelected ? <Icon name="check" size={14} color={colors.sealFg} /> : null}
              <AppText
                variant="time"
                weight={isSelected ? 600 : 400}
                tabularNums={false}
                color={isSelected ? colors.sealFg : colors.header}
              >
                {option.label}
              </AppText>
            </PressableScale>
          );
        })}
      </View>

      {selected?.description === undefined ? null : (
        <AppText variant="caption" tone={disabled ? 'soft' : 'muted'}>
          {selected.description}
        </AppText>
      )}
    </SettingRow>
  );
}
