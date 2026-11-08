import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { radius, useTheme } from '@/theme';

/**
 * The round `−` / `+` button every incrementing control in the app is built from.
 *
 * There are three places a number is nudged one step at a time — the per-prayer minute offsets and
 * the Hijri day shift ({@link SettingStepperRow}), and the qada estimate in
 * `QadaSetupWizard`, where the figure between the buttons is a text field rather than a label.
 * They disagree about what sits *between* the buttons; they must not disagree about the buttons.
 * Three hand-rolled copies had already drifted (34pt vs 32pt, two different disabled opacities),
 * which is exactly the kind of drift a settings screen shows off.
 *
 * Two things the button owns so no caller repeats them:
 *
 * - **44pt of touch.** The glyph is 34pt; `PressableScale` grows the hit area around it.
 * - **A bound that is announced, not just faded.** `disabled` sets `accessibilityState.disabled`
 *   as well as dimming, so "you cannot go further" survives greyscale and VoiceOver.
 *
 * The label arrives already localized ("One minute earlier for Fajr"); this renders no strings.
 */

/** Diameter of the button face in points. */
export const STEP_BUTTON_SIZE = 34;

export interface StepButtonProps {
  /** Which way this button moves the value. */
  icon: 'add' | 'remove';
  /** Localized accessibility label, e.g. "One minute later for Fajr". */
  accessibilityLabel: string;
  onPress: () => void;
  /** Dims the button and stops it accepting taps — use it at a bound. */
  disabled?: boolean;
  testID?: string;
}

/**
 * One step button.
 *
 * @param icon - `add` or `remove`.
 * @param disabled - Whether the value has reached the bound in this direction.
 * @returns A 34pt round button with a 44pt touch target.
 */
export function StepButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  testID,
}: StepButtonProps) {
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      haptics
      scale={0.9}
      onPress={onPress}
      style={{
        width: STEP_BUTTON_SIZE,
        height: STEP_BUTTON_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: disabled ? colors.borderFaint : colors.borderMid,
        backgroundColor: colors.card,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={17} color={disabled ? colors.soft : colors.accent} />
    </PressableScale>
  );
}
