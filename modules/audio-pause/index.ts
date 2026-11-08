/**
 * `audio-pause` — pause whatever the phone is playing at a future instant, with the app's
 * process gone. The fourth local Expo module (D96, "Pause what's playing").
 *
 * ## Why this exists
 *
 * Someone listening to music or a podcast when a prayer's time comes in has asked, by turning the
 * setting on, for that audio to go quiet — the moment belongs to the adhan, or to silence. The
 * reminder itself cannot do this: a notification's sound plays *over* media without stopping it,
 * and by the time the reminder lands the app's process is usually gone.
 *
 * Android can do it the same way `notification-dismissal` (D88) tidies the tray: an
 * `AlarmManager` alarm at the reminder's own fire instant, handled by a manifest-declared
 * receiver, no JS runtime involved. The "pause" is a request for permanent audio focus — the
 * polite, documented way to tell a player to stop and not resume on its own — and the reminder's
 * own sound is unaffected, because notifications do not play on the media stream. See
 * `android/…/PendingPauses.kt` for the mechanism, including why this alarm is exact where the
 * dismissal one is deliberately not.
 *
 * **It never posts, schedules or changes a notification**, so it cannot make reminders less
 * reliable. It is purely additive: nothing regresses if it does nothing at all.
 *
 * ## Where it does nothing
 *
 * iOS — a dead app cannot touch another app's audio there by any mechanism Apple ships or
 * permits, which is why the setting never renders on iOS at all (the system's own brief ducking
 * while the notification sound plays is what iOS users get, for free). Also web and Jest, and any
 * dev client built before this module existed ({@link isSupported} answers `false` there). Both
 * functions resolve without doing anything in all of those places, so callers need no platform
 * checks.
 */

/** The two calls the native module exposes. See the Kotlin module for the contract. */
interface AudioPauseNativeModule {
  schedulePause(identifier: string, atEpochMs: number): Promise<void>;
  cancelPause(identifier: string): Promise<void>;
}

/**
 * `null` until first use, then the module or `null` forever.
 *
 * Resolved lazily and behind a `try`: importing `expo`'s native-module bridge eagerly is what
 * breaks plain Jest runs, and a build without this module must degrade rather than throw at
 * import time.
 */
let resolved: AudioPauseNativeModule | null | undefined;

function nativeModule(): AudioPauseNativeModule | null {
  if (resolved !== undefined) return resolved;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };
    resolved = requireOptionalNativeModule<AudioPauseNativeModule>('AudioPause');
  } catch {
    resolved = null;
  }
  return resolved;
}

/**
 * Whether the running binary actually carries the native module — Android, built since it was
 * added. The settings screen consults this so the toggle is only ever offered where flipping it
 * would do something; a switch that switched nothing would be worse than no switch.
 */
export function isSupported(): boolean {
  return nativeModule() !== null;
}

/**
 * Asks the system to pause other audio once `atEpochMs` passes, whether or not this app is
 * running. Replaces any instant previously set for the same identifier.
 *
 * Never rejects: music that keeps playing is not worth failing a sync over.
 *
 * @param identifier - The reminder's identifier — the same string it was scheduled under, so the
 *        pause replaces and cancels along with it.
 * @param atEpochMs - The reminder's own fire instant, in epoch milliseconds.
 */
export async function schedulePause(identifier: string, atEpochMs: number): Promise<void> {
  const native = nativeModule();
  if (native === null || !Number.isFinite(atEpochMs)) return;
  try {
    await native.schedulePause(identifier, atEpochMs);
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * Forgets a scheduled pause, because the reminder it belonged to has been cancelled. Safe to call
 * for an identifier that never had one.
 *
 * @param identifier - The reminder's identifier.
 */
export async function cancelPause(identifier: string): Promise<void> {
  const native = nativeModule();
  if (native === null) return;
  try {
    await native.cancelPause(identifier);
  } catch {
    // Deliberately swallowed — see above.
  }
}
