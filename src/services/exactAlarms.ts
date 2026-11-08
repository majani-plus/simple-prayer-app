/**
 * Exact alarms — whether a reminder arrives *on the minute* (PRODUCT_SPEC §11, decision D91).
 *
 * ## The problem this exists for
 *
 * `expo-notifications` sets every reminder through Android's `AlarmManager`, and asks the system
 * one question before each one (`ExpoSchedulingDelegate.setupAlarm`): may this app set an exact
 * alarm? If the answer is no it sets an **inexact** one instead — silently, with no error and no
 * way for JS to notice. The reminder still arrives; the system decides when, and under Doze that
 * can be many minutes after the prayer time.
 *
 * On Android 14+ the answer is no by default for any app targeting API 33 or higher, and we target
 * 36. `SCHEDULE_EXACT_ALARM` sits in `app.json`'s permission list, but a manifest entry only makes
 * a permission *requestable* — nothing had ever asked. So every reminder on a fresh Android 14+
 * install was inexact, and nothing in the app said so.
 *
 * This module is the two calls that fix that, wrapped so the rest of the app can use them without
 * platform checks: read the state, and open the one screen where the user can change it. Both go
 * through `modules/exact-alarms`, a local Expo module, because the library exposes neither.
 *
 * ## Why `'unknown'` is a state
 *
 * The same reason `batteryGuidance` has one: an honest "we cannot tell" beats a green tick that
 * might be wrong. It happens when the binary has no native module (a dev client built before it
 * existed) or the call fails. The reliability screen renders **nothing** for `'unknown'` rather
 * than a card nobody can act on.
 *
 * ## What granting it does not do
 *
 * It does not upgrade alarms that are already set. Android re-arms them from
 * `expo-notifications`' own store on reboot and on app update, and those re-armed alarms *are*
 * exact — but until then every reminder already scheduled stays inexact, including tonight's Isha.
 * That is why the callers rebuild the schedule when they see this flip to `'exact'`.
 *
 * Dependency rule: `services` may touch platform modules; nothing here imports React, a store or
 * the database. Everything platform-shaped goes through {@link ExactAlarmAdapter} so the whole
 * module is testable in plain Jest.
 */

/** Whether the phone will deliver a reminder at the minute it was set for. */
export type ExactAlarmState =
  /** Alarms are set exactly: granted, or a platform where the question does not arise. */
  | 'exact'
  /** The system will batch our alarms. Reminders still arrive, but they may arrive late. */
  | 'inexact'
  /** Nothing could be asked. Never presented to the user as a fault — see the module header. */
  | 'unknown';

/** What a "take me there" call did. Never throws; the caller renders the answer. */
export type OpenExactAlarmResult = 'opened' | 'unavailable';

/** The platform surface this module uses. Replaceable so every path is testable. */
export interface ExactAlarmAdapter {
  readonly platform: 'ios' | 'android' | 'other';
  /** `modules/exact-alarms`: `true`/`false` from the OS, `null` when nothing could be asked. */
  canScheduleExactAlarms(): Promise<boolean | null>;
  /** The system's *Alarms & reminders* screen. `false` when no activity took the intent. */
  openSystemScreen(): Promise<boolean>;
  /** `Linking.openSettings()` — this app's own page in the system settings. */
  openAppSettings(): Promise<void>;
}

let adapter: ExactAlarmAdapter | null = null;

/** Builds the real adapter, requiring native modules lazily so importing this file stays cheap. */
function createDefaultAdapter(): ExactAlarmAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  const platformOS = RN.Platform.OS;

  return {
    platform: platformOS === 'ios' ? 'ios' : platformOS === 'android' ? 'android' : 'other',
    async canScheduleExactAlarms() {
      const native =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../modules/exact-alarms') as typeof import('../../modules/exact-alarms');
      return await native.canScheduleExactAlarms();
    },
    async openSystemScreen() {
      const native =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../modules/exact-alarms') as typeof import('../../modules/exact-alarms');
      return await native.openExactAlarmSettings();
    },
    async openAppSettings() {
      await RN.Linking.openSettings();
    },
  };
}

/** @returns The adapter in use, creating the real one on first call. */
export function getExactAlarmAdapter(): ExactAlarmAdapter {
  if (adapter === null) adapter = createDefaultAdapter();
  return adapter;
}

/**
 * Replaces the platform adapter. Tests use this; the app never calls it.
 *
 * @param next - The adapter to install, or `null` to fall back to the real one.
 */
export function setExactAlarmAdapter(next: ExactAlarmAdapter | null): void {
  adapter = next;
}

/**
 * Whether this phone will deliver reminders at the minute they were set for.
 *
 * **iOS is always `'exact'`, and is never asked.** A scheduled local notification there is held by
 * the system and fires on time whatever the app is doing — including when it has been swiped away
 * or force-quit. There is no permission to be missing, so there is nothing to report.
 *
 * @returns The state, reading the OS on Android. Never throws; a failed read is `'unknown'`.
 */
export async function readExactAlarmState(): Promise<ExactAlarmState> {
  const platform = getExactAlarmAdapter();
  if (platform.platform !== 'android') return 'exact';
  try {
    const allowed = await platform.canScheduleExactAlarms();
    if (allowed === null) return 'unknown';
    return allowed ? 'exact' : 'inexact';
  } catch {
    return 'unknown';
  }
}

/**
 * Opens the system screen where exact alarms are allowed for this app.
 *
 * Nothing here can grant anything: Android decided this is a settings screen rather than a dialog,
 * so the user grants it there and the app reads the new state on its next foreground. A ROM
 * without that screen falls through to this app's own settings page, which always exists — the
 * button is pressed by someone who has already missed a prayer, and it must never do nothing.
 *
 * @returns `'opened'` when something was shown, `'unavailable'` when nothing could be.
 */
export async function openExactAlarmSettings(): Promise<OpenExactAlarmResult> {
  const platform = getExactAlarmAdapter();
  if (platform.platform !== 'android') return 'unavailable';

  try {
    if (await platform.openSystemScreen()) return 'opened';
  } catch {
    // Treated exactly like a missing screen: the app's own settings page is next.
  }
  try {
    await platform.openAppSettings();
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
