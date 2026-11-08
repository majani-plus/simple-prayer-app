import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from './AppText';
import { SettingRow, type SettingRowProps } from './SettingRow';
import { StepButton } from './StepButton';
import { formatNumber } from '@/i18n/numerals';
import { spacing } from '@/theme';

/**
 * A settings row whose value is a number nudged one step at a time: `− 15 min +`.
 *
 * This is the **only** stepper in the app. It is the control behind every bounded number the user
 * can set — the five per-prayer minute offsets (±30), the Hijri day offset (±2), pre-reminder
 * minutes — and it is a stepper rather than a slider because all of those are read as exact
 * figures. Someone holding a printed takvim needs "three minutes later", exactly, on the first
 * try; a slider makes that a game of skill and a text field makes it a keyboard.
 *
 * Four things the row owns:
 *
 * 1. **The bound is a wall.** The row clamps to `[min, max]`, disables the button that would leave
 *    the range, and never wraps around. The settings store clamps as well, and the two agreeing is
 *    deliberate: the store protects the data, this protects the gesture.
 * 2. **It never reports a value that did not move.** `onChange` fires only on a real change.
 * 3. **It is operable without being seen.** The whole `− value +` cluster is one `adjustable`
 *    element carrying the localized figure, so a screen-reader user can swipe up/down instead of
 *    hunting two small buttons — *and* each button stays separately labelled for anyone navigating
 *    by element.
 * 4. **The figure does not jitter**, because it is rendered in tabular figures at a fixed width.
 *
 * ### The `leading` slot
 *
 * The offsets screen needs more than a label on the leading side: each prayer's row shows the time
 * that prayer will now be *called*, so the user can tap until the app agrees with their mosque's
 * calendar and then stop. That live consequence goes in {@link SettingRowProps.leading}, beside
 * the label — which is why this row absorbed the calculation screen's former `OffsetStepper`
 * rather than the two living on side by side.
 *
 * Every string arrives localized; this component renders none of its own.
 */

export interface SettingStepperRowProps extends Omit<
  SettingRowProps,
  'value' | 'trailing' | 'onPress' | 'chevron' | 'accessibilityRole' | 'children'
> {
  /** Current value. */
  value: number;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Amount one press moves the value. Defaults to 1. */
  step?: number;
  /** Called with the clamped new value. Never called when the value would not change. */
  onChange: (value: number) => void;
  /** Renders the value (units, sign, locale-aware digits). Defaults to `String(value)`. */
  formatValue?: (value: number) => string;
  /** Localized accessibility label for the − button (e.g. "Five minutes earlier"). */
  decreaseLabel: string;
  /** Localized accessibility label for the + button. */
  increaseLabel: string;
  /**
   * Spoken name of what is being adjusted ("Fajr adjustment"), carried by the `adjustable`
   * control. Defaults to `label`. It is *not* the row's own label: the row has no accessibility
   * role, so the stepper is the only thing here that can hold one.
   */
  accessibilityLabel?: string;
}

/** How wide the figure's column is. Wide enough for "no change" and "+30 min" alike. */
const VALUE_WIDTH = 76;

/**
 * A row with a − / value / + stepper.
 *
 * @param value - Current value.
 * @param onChange - Receives the clamped new value.
 * @param formatValue - Formats the displayed figure (units and locale digits).
 * @returns A static {@link SettingRow} whose trailing control is the stepper.
 */
export function SettingStepperRow({
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  decreaseLabel,
  increaseLabel,
  accessibilityLabel,
  disabled = false,
  label,
  testID,
  ...rest
}: SettingStepperRowProps) {
  const { i18n } = useTranslation();
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;

  const move = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  };

  const decrease = () => move(-step);
  const increase = () => move(step);
  // `String(value)` would be Western digits regardless of language — the one way an Arabic screen
  // ends up reading "٠٥:١٢" beside "+3". The default goes through the app's numeral policy
  // instead (i18n/numerals.ts); a caller that needs units or a sign still supplies `formatValue`.
  const text = formatValue === undefined ? formatNumber(value, i18n.language) : formatValue(value);

  return (
    <SettingRow
      {...rest}
      label={label}
      testID={testID}
      disabled={disabled}
      chevron={false}
      trailing={
        <View
          testID={testID === undefined ? undefined : `${testID}-control`}
          // One accessible element for the whole cluster: a screen reader gets an adjustable
          // control it can swipe, rather than two 34pt buttons it has to find.
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled }}
          accessibilityValue={{ min, max, now: value, text }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (disabled) return;
            if (event.nativeEvent.actionName === 'increment') increase();
            if (event.nativeEvent.actionName === 'decrement') decrease();
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
        >
          <StepButton
            testID={testID === undefined ? undefined : `${testID}-decrease`}
            icon="remove"
            accessibilityLabel={decreaseLabel}
            disabled={!canDecrease}
            onPress={decrease}
          />
          <AppText
            testID={testID === undefined ? undefined : `${testID}-value`}
            variant="time"
            weight={600}
            // "No change" is a real state worth reading as one: at zero the figure steps back so
            // the adjusted rows are the ones that catch the eye.
            tone={disabled ? 'soft' : value === 0 ? 'muted' : 'strong'}
            tabularNums
            style={{ minWidth: VALUE_WIDTH, textAlign: 'center' }}
          >
            {text}
          </AppText>
          <StepButton
            testID={testID === undefined ? undefined : `${testID}-increase`}
            icon="add"
            accessibilityLabel={increaseLabel}
            disabled={!canIncrease}
            onPress={increase}
          />
        </View>
      }
    />
  );
}
