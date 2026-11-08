/**
 * `notification-dismissal` — take a delivered notification out of the tray at a future instant,
 * with the app's process gone.
 *
 * ## Why this exists
 *
 * A reminder stops being true when its prayer's window closes, and until now nothing could act on
 * that unless the app happened to be running: the tray sweep (`domain/notificationPlan`'s
 * `selectStaleDelivered`) only runs when something wakes the app. Someone who does not open the
 * app for two days came back to a wall of notifications that were all hours out of date.
 *
 * Android can do better, and it does not need `expo-notifications` to grow an API for it. The
 * library posts every notification under `(tag = our identifier, id = 0)`, so
 * `NotificationManager.cancel(tag, 0)` — plain Android, no library involvement — removes any
 * notification it posted. This module schedules an `AlarmManager` alarm that does exactly that.
 * See `android/…/PendingDismissals.kt`, which documents the coupling and how it is guarded.
 *
 * **It never posts, schedules or changes a notification**, so it cannot make reminders less
 * reliable — the property that made this worth building rather than patching the library's own
 * scheduling. It is also purely additive: nothing regresses if it does nothing at all.
 *
 * ## Where it does nothing
 *
 * iOS (no expiry for a delivered local notification exists — PRODUCT_SPEC §11.5), web, and Jest.
 * Both functions resolve without doing anything there, so callers need no platform checks.
 *
 * ## Rebuild required
 *
 * This is a native module. A dev client built before it existed does not contain it, and
 * {@link isSupported} answers `false` there — correctly, and without crashing.
 */

/** The two calls the native module exposes. See the Kotlin module for the contract. */
interface NotificationDismissalNativeModule {
  scheduleDismissal(identifier: string, atEpochMs: number): Promise<void>;
  cancelDismissal(identifier: string): Promise<void>;
}

/**
 * `null` until first use, then the module or `null` forever.
 *
 * Resolved lazily and behind a `try`: importing `expo`'s native-module bridge eagerly is what
 * breaks plain Jest runs, and a build without this module must degrade rather than throw at
 * import time.
 */
let resolved: NotificationDismissalNativeModule | null | undefined;

function nativeModule(): NotificationDismissalNativeModule | null {
  if (resolved !== undefined) return resolved;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };
    resolved = requireOptionalNativeModule<NotificationDismissalNativeModule>(
      'NotificationDismissal'
    );
  } catch {
    resolved = null;
  }
  return resolved;
}

/**
 * Whether the running binary actually carries the native module — Android, built since it was
 * added. Exposed so a caller can report honestly rather than guess; nothing needs to check it
 * before calling, because the calls are no-ops without it.
 */
export function isSupported(): boolean {
  return nativeModule() !== null;
}

/**
 * Asks the system to remove the notification posted under `identifier` once `atEpochMs` passes,
 * whether or not this app is running. Replaces any instant previously set for that identifier.
 *
 * Never rejects: a tray that stays untidy is not worth failing a sync over, and the app's own
 * sweep still runs whenever it is awake.
 *
 * @param identifier - The notification's identifier — the same string it was scheduled under.
 * @param atEpochMs - When it stops being worth reading, in epoch milliseconds.
 */
export async function scheduleDismissal(identifier: string, atEpochMs: number): Promise<void> {
  const native = nativeModule();
  if (native === null || !Number.isFinite(atEpochMs)) return;
  try {
    await native.scheduleDismissal(identifier, atEpochMs);
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * Forgets a scheduled dismissal, because the app has cancelled or dismissed the notification
 * itself. Safe to call for an identifier that never had one.
 *
 * @param identifier - The notification's identifier.
 */
export async function cancelDismissal(identifier: string): Promise<void> {
  const native = nativeModule();
  if (native === null) return;
  try {
    await native.cancelDismissal(identifier);
  } catch {
    // Deliberately swallowed — see above.
  }
}
