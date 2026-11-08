/**
 * Android's notification organizer — the "why did the adhan arrive silently" layer (D146).
 *
 * ## The problem this exists for
 *
 * Android 16 ships an on-device classifier that reads a notification's **content** — not the app
 * that sent it — and sorts it into one of a few buckets: Promotions, News, Social, Suggested.
 * Anything it takes is bundled, collapsed and **silenced**, and the usual long-press controls are
 * replaced by the organizer's own sheet, so the user cannot even set the notification back to
 * "Default" without first finding the feature that took it.
 *
 * A user on a Pixel found a prayer reminder filed under **Suggested** — described by Google as
 * "newsletters, recommended media" — arriving with no sound. A prayer-time reminder is none of
 * those things, and a silent one has failed at the only job it has.
 *
 * ## Why this module only points at a screen
 *
 * There is no app-facing way out. Classification is applied by the system's notification
 * assistant, and the only documented remedy is the user's own: *Settings → Notifications →
 * Notification organizer → don't include these apps*. Nor can the app read whether the organizer
 * is handling it — `getActiveNotifications` returns our own posts, not the ranking applied to
 * them. So this module refuses to guess, exactly as {@link readExemptionState} does for battery
 * optimisation: it says the situation plainly and opens the screen that can answer.
 *
 * The other half of the response is not here — it is the `androidCategory` every reminder now
 * carries (`ANDROID_CATEGORY_REMINDER` in `./notifications`), which tells Android these are
 * reminders rather than leaving them to describe themselves as nothing at all.
 *
 * Dependency rule: `services` may touch platform modules; nothing here imports React, a store or
 * the database. Everything platform-shaped goes through {@link NotificationOrganizerAdapter} so
 * the whole module is testable in plain Jest.
 */

import type { OpenSettingsResult } from './batteryGuidance';

/**
 * The Android version that first shipped the organizer (Android 16 = API 36).
 *
 * Gating on the platform version rather than on the device is deliberate. The feature reached
 * Pixels first, but it is an OS feature and other manufacturers will pick it up; a Pixel check
 * would quietly stop being true and leave the guidance hidden from the people who need it. The
 * cost of the looser gate is that a few Android 16 users see a card about something their phone
 * has not switched on — on a screen they only open when reminders already feel broken.
 */
export const ORGANIZER_MIN_SDK = 36;

/** Android's system-wide Notifications screen, which holds the organizer's settings. */
export const NOTIFICATION_SETTINGS_ACTION = 'android.settings.NOTIFICATION_SETTINGS';

/** The platform surface this module uses. Replaceable so every path is testable. */
export interface NotificationOrganizerAdapter {
  readonly platform: 'ios' | 'android' | 'other';
  /** `Platform.Version` — the SDK integer on Android, and meaningless anywhere else. */
  sdkVersion(): number;
  /** `IntentLauncher.startActivityAsync`. Rejects when no activity can handle the intent. */
  startActivity(action: string): Promise<void>;
  /** `Linking.openSettings()` — this app's own page in the system settings. */
  openAppSettings(): Promise<void>;
}

let adapter: NotificationOrganizerAdapter | null = null;

/** Builds the real adapter, requiring native modules lazily so importing this file stays cheap. */
function createDefaultAdapter(): NotificationOrganizerAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  const platformOS = RN.Platform.OS;

  return {
    platform: platformOS === 'ios' ? 'ios' : platformOS === 'android' ? 'android' : 'other',
    sdkVersion() {
      // A number on Android, a version string on iOS — which never reaches here anyway.
      return typeof RN.Platform.Version === 'number' ? RN.Platform.Version : 0;
    },
    async startActivity(action) {
      const IntentLauncher =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('expo-intent-launcher') as typeof import('expo-intent-launcher');
      await IntentLauncher.startActivityAsync(action);
    },
    async openAppSettings() {
      await RN.Linking.openSettings();
    },
  };
}

/** @returns The adapter in use, creating the real one on first call. */
export function getNotificationOrganizerAdapter(): NotificationOrganizerAdapter {
  if (adapter === null) adapter = createDefaultAdapter();
  return adapter;
}

/**
 * Replaces the platform adapter. Tests use this; the app never calls it.
 *
 * @param next - The adapter to install, or `null` to fall back to the real one.
 */
export function setNotificationOrganizerAdapter(next: NotificationOrganizerAdapter | null): void {
  adapter = next;
}

/**
 * Whether this device's Android version is new enough to have the organizer at all.
 *
 * This is *not* "the organizer is handling us" — see the module header. It answers only whether
 * the guidance is worth showing, so the vast majority of Android users never meet a card about a
 * feature their phone does not have.
 *
 * @returns `true` on Android 16 and later, `false` everywhere else including iOS.
 */
export function supportsNotificationOrganizer(): boolean {
  const platform = getNotificationOrganizerAdapter();
  if (platform.platform !== 'android') return false;
  try {
    return platform.sdkVersion() >= ORGANIZER_MIN_SDK;
  } catch {
    return false;
  }
}

/**
 * Opens Android's system-wide Notifications screen, where the organizer and its per-app exclusion
 * list live, falling back to this app's own settings page.
 *
 * The system screen is used rather than this app's notification settings because the organizer is
 * a *system* feature: its "don't include these apps" list is not reachable from our page. There is
 * no public intent for the organizer screen itself, so the user lands one level above it — which
 * is why the copy names the two rows to tap once they are there.
 *
 * @returns `'opened'` when something was shown, `'unavailable'` when nothing could be.
 */
export async function openNotificationSettings(): Promise<OpenSettingsResult> {
  const platform = getNotificationOrganizerAdapter();
  if (platform.platform !== 'android') return 'unavailable';

  try {
    await platform.startActivity(NOTIFICATION_SETTINGS_ACTION);
    return 'opened';
  } catch {
    // Not every ROM exposes the stock screen; the app's own settings page always exists.
  }
  try {
    await platform.openAppSettings();
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
