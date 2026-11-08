import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { OptionCard } from './OptionCard';
import { listMethods, methodLabelKey, resolveMethod } from '@/domain/methods';
import { spacing } from '@/theme';

import type { CalculationMethodId } from '@/domain/types';

/**
 * The calculation-method list (PRODUCT_SPEC §3).
 *
 * This picker is a credibility instrument, not a preferences widget. The research is blunt about
 * it (our market research on Turkey and the Arabic markets): for most users "correct times" means
 * "the same times my mosque prints", and an app that silently picks one global method collects
 * *vakitler yanlış* one-star reviews. So the authority is always **nameable**:
 *
 * - `Auto` is first and stays first, but it never hides behind the word — the row shows what it
 *   currently resolves to ("Auto · Diyanet"), computed from the user's country through
 *   `domain/methods.resolveMethod`, the same function the engine uses.
 * - Every other row names its authority *and* its angles in the description, so a user who knows
 *   their calendar can recognise it.
 * - Nothing is computed here. The list, its order and every label key come from
 *   `domain/methods.listMethods()`; this component only renders them.
 */

export interface MethodPickerProps {
  /** The stored setting, which may be the `auto` sentinel. */
  value: CalculationMethodId;
  /** ISO 3166-1 alpha-2 of the user's location, used to resolve `auto`. */
  countryCode?: string;
  /** Localized country name for the `auto` description, when one is known. */
  countryName?: string;
  onChange: (method: CalculationMethodId) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The ordered method list with `auto` first.
 *
 * @param value - The current setting.
 * @param countryCode - Resolves what `auto` currently means.
 * @returns One {@link OptionCard} per method.
 */
export function MethodPicker({
  value,
  countryCode,
  countryName,
  onChange,
  style,
  testID = 'method-picker',
}: MethodPickerProps) {
  const { t } = useTranslation();

  const options = useMemo(() => listMethods(), []);
  const resolved = resolveMethod('auto', countryCode);
  const resolvedName = t(methodLabelKey(resolved));

  return (
    <View testID={testID} style={[{ gap: spacing.xs }, style]} accessibilityRole="radiogroup">
      {options.map((option) => {
        const isAuto = option.id === 'auto';
        return (
          <OptionCard
            key={option.id}
            testID={`method-option-${option.id}`}
            label={
              isAuto
                ? t('settings.calculation.method.autoLabel', { authority: resolvedName })
                : t(option.labelKey)
            }
            description={
              isAuto
                ? countryName === undefined
                  ? t('settings.calculation.method.autoDescriptionUnknown')
                  : t('settings.calculation.method.autoDescription', { country: countryName })
                : t(option.descriptionKey)
            }
            selected={value === option.id}
            onPress={() => onChange(option.id)}
            accessibilityHint={t('settings.calculation.method.a11yHint')}
          />
        );
      })}
    </View>
  );
}
