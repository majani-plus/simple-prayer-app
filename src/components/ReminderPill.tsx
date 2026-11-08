import { useTranslation } from 'react-i18next';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { radius, spacing, useTheme } from '@/theme';
import { usePrayerReminder, useSettingsActions } from '@/stores/settingsStore';

import type { Prayer } from '@/domain/types';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * The hero's reminder pill: "Reminder on" (filled gold) / "Remind me" (outlined paper) — and a
 * third, honest state, "Reminders off — allow notifications" (outlined, bell-off), for when the
 * setting is on but the OS permission means nothing can actually fire (spec-accessibility §4.1).
 *
 * It controls the prayer's **adhan-time** reminder — the notification that fires at the prayer
 * time (PRODUCT_SPEC §11.1). Pre-reminders and end-of-window nudges are configured in Settings
 * and are deliberately untouched here: this pill is the one-tap "tell me when it's time".
 *
 * ## Why the pill checks the permission at all
 *
 * Every prayer ships with `adhanEnabled: true`, but the OS permission used to be requested only
 * inside Settings → Reminders — so a first-run user was shown "Reminder on" while the scheduler
 * silently skipped everything. The pill now tells the truth and asks when it should:
 *
 * - The **on** face renders only while the permission actually allows a notification to fire.
 * - While the setting is on but the permission is not granted, the pill renders the third state
 *   (icon + words, never colour alone). Tapping it **asks right there** when the OS can still
 *   show its dialog — that tap is the strongest possible signal of intent, and PRODUCT_SPEC §11
 *   requires the prompt to come from an explicit user action — or deep-links to the system
 *   settings once the OS has stopped asking.
 * - Nothing here ever prompts on launch; rendering only *reads* the permission.
 *
 * Toggling still only persists the setting, synchronously — the original design's point is kept:
 * the pill never *awaits* a permission dialog, so the control answers the tap instantly.
 * Scheduling stays `services/notifications`'s job via `hooks/useNotificationSync`; the one side
 * effect added is `useNotificationPermission.request`, which is fire-and-forget and runs the
 * same post-grant sync Settings → Reminders performs. While the very first permission read is
 * still in flight the pill renders the setting as stored (the read resolves in milliseconds;
 * flashing a warning at every granted user instead would be the dishonest default).
 *
 * State is never colour-only: the icon changes (`notifications_active` / `notifications` /
 * `notifications_off`), the label changes, and the pill exposes itself as a switch with a checked
 * state — or as a button while its job is getting permission rather than toggling.
 */
export interface ReminderPillProps {
  /** The prayer whose adhan reminder this pill toggles. */
  prayer: Prayer;
  /** Localized prayer name for the accessibility label; defaults to the `prayers.*` string. */
  prayerName?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Icon size from the mockup (17px), matching the label's optical size. */
const ICON_SIZE = 17;

/**
 * A pill that turns one prayer's adhan reminder on or off — and obtains the notification
 * permission the reminder cannot fire without.
 *
 * @param prayer - Which prayer's reminder this pill controls.
 * @returns A pressable whose fill, icon, label and accessibility role all reflect the state.
 */
export function ReminderPill({ prayer, prayerName, style, testID }: ReminderPillProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reminder = usePrayerReminder(prayer);
  const { setReminder } = useSettingsActions();
  const { permission, request, openSystemSettings } = useNotificationPermission();

  const enabled = reminder.adhanEnabled;
  // "Known not granted" — `null` (still reading) renders the happy path; see the header.
  const ungranted = permission !== null && !permission.granted;
  // The trap this component exists to eliminate: the setting says remind, the OS says never.
  const needsPermission = enabled && ungranted;
  // Once the OS will not show its dialog again, the only door left is the system settings.
  const blocked = ungranted && !permission.canAskAgain;

  const on = enabled && !ungranted;
  const label = needsPermission
    ? t('today.reminder.needsPermission')
    : on
      ? t('today.reminder.on')
      : t('today.reminder.off');
  const name = prayerName ?? t(`prayers.${prayer}`);

  const onPress = (): void => {
    if (needsPermission) {
      // The setting is already on; the tap means "make it real".
      if (blocked) openSystemSettings();
      else request();
      return;
    }
    const next = !enabled;
    setReminder(prayer, { adhanEnabled: next });
    // Turning a reminder on is the strongest signal of intent to be notified: if the OS can
    // still ask, ask right now (fire-and-forget — the toggle above already landed). When it
    // cannot, the pill's third state renders on the next frame and carries the settings link.
    if (next && ungranted && !blocked) request();
  };

  return (
    <PressableScale
      testID={testID}
      accessibilityRole={needsPermission ? 'button' : 'switch'}
      accessibilityState={needsPermission ? undefined : { checked: on }}
      accessibilityLabel={t('today.reminder.a11yLabel', { prayer: name })}
      accessibilityHint={
        needsPermission
          ? blocked
            ? t('today.reminder.a11yHintBlocked')
            : t('today.reminder.a11yHintAsk')
          : on
            ? t('today.reminder.a11yHintOn')
            : t('today.reminder.a11yHintOff')
      }
      haptics
      onPress={onPress}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 9,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.pill,
          borderWidth: 1,
          // Off (and needs-permission): the paper fill reads as an outline on both palettes.
          // On: the accent carries it, so the border becomes the accent too rather than a ring.
          borderColor: on ? colors.accent : colors.borderMid,
          backgroundColor: on ? colors.accent : colors.card,
        },
        style,
      ]}
    >
      <Icon
        name={needsPermission ? 'notifications_off' : on ? 'notifications_active' : 'notifications'}
        size={ICON_SIZE}
        color={on ? colors.sealFg : colors.header}
      />
      <AppText
        variant="time"
        weight={600}
        tabularNums={false}
        color={on ? colors.sealFg : colors.header}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}
