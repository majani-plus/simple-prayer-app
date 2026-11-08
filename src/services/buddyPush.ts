/**
 * The remote half of notifications, which exists only because buddy mode does.
 *
 * ## Why this is not in `services/notifications.ts`
 *
 * That file is the app's **local** notification engine: it plans and schedules reminders that the
 * phone fires at itself, and it has never known what a push token is. D49 went further and stripped
 * the push entitlement from the binary, so that the declared capability surface equalled the used
 * one. D175 reversed that — the app now genuinely sends remote notifications — but the reversal is
 * narrow, and keeping it in its own file is how that stays visible: everything remote about this
 * app is these hundred lines, and nothing here schedules anything.
 *
 * ## What a buddy notification is
 *
 * Quiet. Its own Android channel with no sound and no vibration. Since D196 it is HIGH importance on Android, so it shows as a banner. It is
 * good news about somebody else; it must never interrupt, and it must never compete with an adhan.
 * Tapping it opens Today, where the seal is one tap away.
 *
 * ## Why it carries no "Prayed" button (yet)
 *
 * The plan was to reuse the adhan's (D92), so "she prayed, me too" would be one tap from the lock
 * screen. Three things have to be true for that and only one of them is today:
 *
 *  1. the action identifier must be `prayed` (`modules/prayer-marks`), not a new one;
 *  2. **iOS** — `PrayerMarksResponder.handlePrayed` reads `userInfo["prayer"]` at the top level,
 *     but an Expo *remote* push nests its data under `userInfo["body"]`, so the guard returns early
 *     and the button does nothing. Android is fine; it reads the body already;
 *  3. the day must come from the receiver's clock. The `day` in a buddy push is the **sender's**
 *     prayer day, so a buddy one timezone over would land the mark on the wrong day — and its keys
 *     would collide with the pending-marks queue's own `day`/`prayer` fields.
 *
 * (2) is a native change that cannot be verified without a device, and a button that works on
 * Android and silently does nothing on iOS is worse than no button. So there is no button, and
 * the tap opens Today instead. Tracked in the internal notes for a later milestone.
 */

import { Platform } from 'react-native';

import type { Prayer, PrayerDay } from '@/domain/types';
import type { MarkState } from '@/domain/buddies';
import { withTimeout } from '@/utils/withTimeout';

/** The Android channel buddy marks arrive on. Named in the relay's push payload too. */
export const BUDDY_CHANNEL_ID = 'buddies_v2';

/**
 * The first buddy channel, created at LOW importance. Android never lets an app raise a channel's
 * importance after creation, so D196 moved buddies to {@link BUDDY_CHANNEL_ID} and deletes this
 * one. The relay still sends `channelId: 'buddies'` (older app versions need it); this app's own
 * `BuddyMessagingService` re-routes those pushes to the new channel on arrival.
 */
export const LEGACY_BUDDY_CHANNEL_ID = 'buddies';

/** The same eight seconds the relay client and the native senders give up after. */
export const PUSH_TOKEN_TIMEOUT_MS = 8_000;

/** Loaded lazily so importing this module stays safe under Jest and in node scripts. */
function notifications(): typeof import('expo-notifications') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    return null;
  }
}

function projectId(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as typeof import('expo-constants').default;
    return (
      Constants?.expoConfig?.extra?.eas?.projectId ??
      (Constants?.easConfig as { projectId?: string } | undefined)?.projectId
    );
  } catch {
    return undefined;
  }
}

/** Whether the OS will let a notification through at all. Never prompts. */
export async function buddyNotificationsAllowed(): Promise<boolean> {
  const api = notifications();
  if (!api) return false;
  try {
    const { status } = await api.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Ask for a push token, if the person has already allowed notifications.
 *
 * It never prompts on its own: buddy mode's own screen is where permission is asked for, in
 * context, and a silent prompt fired by a background sync is exactly the kind of thing this app
 * does not do. Returns `null` for every failure — no permission, no network, a simulator with no
 * push support — and buddy marks then arrive when the app is next opened instead.
 */
export async function getBuddyPushToken(): Promise<string | null> {
  const api = notifications();
  if (!api) return null;

  try {
    const { status } = await api.getPermissionsAsync();
    if (status !== 'granted') return null;

    // Bounded: this is a native registration plus a fetch to Expo with no timeout of its own, and
    // every caller is waiting on it. A token that does not come in eight seconds is a token that
    // does not come this time; the next sync asks again.
    const token = await withTimeout(
      api.getExpoPushTokenAsync({ projectId: projectId() }),
      PUSH_TOKEN_TIMEOUT_MS,
      null
    );
    return token?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * The quiet channel. Idempotent, so re-registering on a language change simply renames it.
 */
export async function configureBuddyNotifications(labels: {
  channelName: string;
  channelDescription: string;
}): Promise<void> {
  const api = notifications();
  if (!api) return;

  try {
    if (Platform.OS === 'android') {
      await api.setNotificationChannelAsync(BUDDY_CHANNEL_ID, {
        name: labels.channelName,
        description: labels.channelDescription,
        // Good news, not an alarm: no sound and no vibration. HIGH importance so it shows as a
        // banner and is never filed away as "unimportant" by OEM launchers (HyperOS sorted the
        // LOW channel out of sight — owner, 2026-11-07, D196).
        importance: api.AndroidImportance.HIGH,
        sound: null,
        vibrationPattern: null,
        enableVibrate: false,
        showBadge: false,
      });
      // Its replacement exists now; the old channel would only sit in Settings as a duplicate.
      await api.deleteNotificationChannelAsync?.(LEGACY_BUDDY_CHANNEL_ID);
    }
  } catch {
    // A channel that could not be created means the notification arrives with default settings —
    // worse, but not worth failing anything over.
  }
}

/**
 * What a buddy notification says, rendered by the *sending* phone in the receiver's language.
 *
 * One line, the title: "Your buddy prayed Dhuhr". There is deliberately no body — a second line
 * would have to say something, and there is nothing else true to say (TONE: one fact).
 */
export interface BuddyNotificationText {
  title: string;
  /**
   * The same sentence with `{}` where a name belongs — "{} prayed Dhuhr". The receiving phone
   * swaps in the nickname *it* gave us as the notification is delivered (`modules/buddy-nicknames`),
   * and shows `title` unchanged if it has none. We cannot write the name ourselves: a buddy's
   * nickname is chosen by the person looking at them and has never left their phone (D174).
   */
  titleNamed: string;
}

/**
 * Compose the words for a buddy's phone.
 *
 * The sender writes them, in the receiver's language, because the relay holds no copy and no
 * language — see `services/buddyRelay.ts`. `translate` is injected rather than imported so that
 * this can render a language the sender is not themselves using.
 */
export function composeBuddyNotification(
  translate: (key: string, options?: Record<string, unknown>) => string,
  prayer: Prayer
): BuddyNotificationText {
  const name = translate(`prayers.${prayer}`);
  return {
    title: translate('buddy.push.title', { prayer: name }),
    // The hole is passed as an ordinary interpolation value, so `i18n/formatter.ts` wraps it in
    // the same bidi isolates as every other value: when the receiving phone puts the nickname in,
    // it lands already isolated, and a Latin name inside an Arabic sentence keeps its place. The
    // relay allows exactly those four isolate characters and no other format character.
    titleNamed: translate('buddy.push.titleNamed', { prayer: name, nickname: '{}' }),
  };
}

/** What rides in a buddy push's `data`. Mirrors the relay's `BuddyPayload`. */
export type BuddyPushPayload =
  | {
      type: 'mark';
      pairId: string;
      day: PrayerDay;
      prayer: Prayer;
      state: MarkState;
      /** The sender's own language and preference, so this phone can address them properly. */
      lang: string;
      notify: boolean;
      /**
       * The title with `{}` where this phone's nickname for them goes. Read by the notification
       * rewriters, not by JS — it is here so the payload type stays an honest description of the
       * wire, and so nothing later mistakes it for something the relay composed.
       */
      titleNamed?: string;
    }
  | { type: 'paired' | 'unpaired'; pairId: string }
  /**
   * What the other phone reads in, and whether it wants to be told at all. Forwarded by the relay
   * and stored nowhere — the durable copy of both fields rides on every mark.
   */
  | { type: 'prefs'; pairId: string; lang: string; notify: boolean };

function asPayload(data: unknown): BuddyPushPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.pairId !== 'string') return null;

  if (row.type === 'paired' || row.type === 'unpaired') {
    return { type: row.type, pairId: row.pairId };
  }
  if (row.type === 'prefs') {
    return {
      type: 'prefs',
      pairId: row.pairId,
      lang: typeof row.lang === 'string' ? row.lang : 'en',
      notify: row.notify !== false,
    };
  }
  if (row.type !== 'mark') return null;
  if (typeof row.day !== 'string' || typeof row.prayer !== 'string') return null;
  if (row.state !== 'prayed' && row.state !== 'cleared') return null;

  return {
    type: 'mark',
    pairId: row.pairId,
    day: row.day as PrayerDay,
    prayer: row.prayer as Prayer,
    state: row.state,
    lang: typeof row.lang === 'string' ? row.lang : 'en',
    notify: row.notify !== false,
  };
}

/**
 * Buddy pushes, as they arrive.
 *
 * Both paths are needed and neither is sufficient: a notification *received* while the app is
 * running, and a notification the person *tapped*. Neither is a guarantee — iOS does not promise to
 * run the app for a silent push — which is why the inbox remains the source of truth and this is an
 * accelerator on top of it.
 *
 * @returns An unsubscribe function; a no-op where expo-notifications is not available.
 */
export function subscribeToBuddyPushes(onPayload: (payload: BuddyPushPayload) => void): () => void {
  const api = notifications();
  if (!api) return () => undefined;

  const handle = (data: unknown) => {
    const payload = asPayload(data);
    if (payload) onPayload(payload);
  };

  try {
    const received = api.addNotificationReceivedListener((event) => {
      handle(event.request.content.data);
    });
    const responded = api.addNotificationResponseReceivedListener((event) => {
      handle(event.notification.request.content.data);
    });
    return () => {
      received.remove();
      responded.remove();
    };
  } catch {
    return () => undefined;
  }
}

/**
 * Tell this phone's owner that somebody took their invite.
 *
 * Posted **locally**, by the phone that shows it, which is the only way it can be in the right
 * language: the relay holds no copy, and the person who accepted has no idea what language the
 * inviter reads. The relay's part is the silent push that wakes the app; the words are ours.
 *
 * Quiet, like every other buddy notification — good news about somebody else, never an alarm.
 */
export async function notifyInviteAccepted(title: string, body: string): Promise<void> {
  const api = notifications();
  if (!api) return;
  try {
    await api.scheduleNotificationAsync({
      content: {
        title,
        body,
        // `false`, not null: this API wants a boolean where the push payload wanted null. Same
        // intent — a buddy notification never makes a sound.
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: BUDDY_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch {
    // The pair is recorded either way; the screen shows it the moment it is opened.
  }
}
