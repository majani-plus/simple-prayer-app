/**
 * `exact-alarms` — ask Android whether it will honour an alarm *to the minute*, and offer the one
 * screen that changes the answer.
 *
 * ## Why this exists
 *
 * `expo-notifications` sets every reminder through `AlarmManager` and silently downgrades from
 * `setExactAndAllowWhileIdle` to `setAndAllowWhileIdle` when the system says no
 * (`ExpoSchedulingDelegate.kt`). Doze may then batch that alarm and deliver it late. On Android
 * 14+ "no" is the default for any app targeting API 33 or higher — we target 36 — and declaring
 * `SCHEDULE_EXACT_ALARM` in the manifest only makes the permission *requestable*. The library
 * exposes neither the question nor the screen, so this module does. See the Kotlin module.
 *
 * **It never schedules, posts or cancels a notification**, so it cannot make delivery worse; the
 * same property that made `modules/notification-dismissal` safe to build.
 *
 * ## Where it does nothing
 *
 * iOS, web and Jest have no such module: {@link canScheduleExactAlarms} and
 * {@link isIgnoringBatteryOptimizations} answer `null` (*not "no"* — see below) and
 * {@link openExactAlarmSettings} answers `false`. Callers need no platform checks;
 * `services/exactAlarms` and `services/batteryGuidance` turn those answers into something a screen
 * can say out loud.
 *
 * `null` and `false` are deliberately different answers. `false` means the phone was asked and
 * said no, which is worth telling the user about. `null` means nobody could be asked — an old dev
 * client, or a platform where the question is meaningless — and a screen that reports that as
 * "your reminders may be late" would be inventing a fault.
 *
 * ## Rebuild required
 *
 * This is a native module. A dev client built before it existed does not contain it and
 * {@link isSupported} answers `false` there, correctly and without crashing.
 */

/** The three calls the native module exposes. See the Kotlin module for the contract. */
interface ExactAlarmsNativeModule {
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<boolean>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
}

/**
 * `null` until first use, then the module or `null` forever.
 *
 * Resolved lazily and behind a `try`: importing `expo`'s native-module bridge eagerly is what
 * breaks plain Jest runs, and a build without this module must degrade rather than throw at
 * import time.
 */
let resolved: ExactAlarmsNativeModule | null | undefined;

function nativeModule(): ExactAlarmsNativeModule | null {
  if (resolved !== undefined) return resolved;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };
    resolved = requireOptionalNativeModule<ExactAlarmsNativeModule>('ExactAlarms');
  } catch {
    resolved = null;
  }
  return resolved;
}

/**
 * Whether the running binary carries the native module — Android, built since it was added.
 *
 * @returns `true` when the two calls below can actually reach the operating system.
 */
export function isSupported(): boolean {
  return nativeModule() !== null;
}

/**
 * Whether the system will honour an alarm set for an exact minute.
 *
 * True below Android 12 as well, where no such permission exists and every alarm is exact: the
 * question this answers is "will the adhan be on time", not "does this OS have a permission".
 *
 * @returns `true`/`false` from the operating system, or `null` when nothing could be asked.
 */
export async function canScheduleExactAlarms(): Promise<boolean | null> {
  const native = nativeModule();
  if (native === null) return null;
  try {
    return await native.canScheduleExactAlarms();
  } catch {
    return null;
  }
}

/**
 * Shows this app's *Alarms & reminders* page in the system settings.
 *
 * Only ever called from a tap on a control that says so. Nothing here can grant the permission —
 * the user grants it on that screen, and the app finds out on its next foreground.
 *
 * @returns `true` when a screen was shown, `false` when nothing took the intent.
 */
export async function openExactAlarmSettings(): Promise<boolean> {
  const native = nativeModule();
  if (native === null) return false;
  try {
    return await native.openExactAlarmSettings();
  } catch {
    return false;
  }
}

/**
 * Whether this app is on Android's battery-optimisation exemption list.
 *
 * The stock flag only. A manufacturer's own battery manager is a separate policy with no public
 * API, so `true` does not mean every part of the phone will leave the app alone —
 * `services/batteryGuidance` and the copy it feeds are careful to say so.
 *
 * @returns `true`/`false` from the operating system, or `null` when nothing could be asked — an
 *          older dev client, or a platform with no such module. `null` is deliberately not `false`
 *          for the same reason as above: a screen must not report a restriction it never read.
 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean | null> {
  const native = nativeModule();
  if (native === null) return null;
  try {
    return await native.isIgnoringBatteryOptimizations();
  } catch {
    return null;
  }
}
