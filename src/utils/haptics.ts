import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * The app's three haptics, shared by every surface with a seal (D197).
 *
 * Crisp single clicks, never buzzes. The owner found the old set "too mushy": iOS `Success` is a
 * two-pulse pattern, and on Android every `impactAsync`/`notificationAsync`/`selectionAsync` call
 * drives the vibrator motor with a timed waveform, which is exactly the soft buzz. Android's
 * `performHapticFeedback` constants (`performAndroidHapticsAsync`) are the system's own tuned
 * clicks instead — the same ones the keyboard and system switches use — and they follow the
 * user's "touch feedback" setting, as a system click should.
 */
function play(ios: () => Promise<void>, android: () => Promise<void>): void {
  try {
    void (Platform.OS === 'android' ? android() : ios()).catch(() => undefined);
  } catch {
    // A device without a haptic engine (or with it switched off) must never break a tap.
  }
}

/** A prayer marked: one firm click. iOS `.rigid` impact; Android `CONFIRM` (a system click). */
export function markHaptic(): void {
  play(
    () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
    () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
  );
}

/**
 * A light tick: a mark taken back off, or a seal's pill opening. Felt, so the finger knows the tap
 * landed, but clearly smaller than the click a mark gets.
 */
export function tickHaptic(): void {
  play(
    () => Haptics.selectionAsync(),
    () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click)
  );
}

/** A queued write that did not stick (D191): the seal went back, and this says so. */
export function errorHaptic(): void {
  play(
    () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject)
  );
}
