/**
 * Notification service — the only place the app talks to `expo-notifications`.
 *
 * This module **applies** a schedule; it never decides one. `domain/notificationPlan` answers
 * "what should the OS be holding right now" purely, and everything here is the machinery that
 * makes reality match that answer: permissions, Android channels, localized content, and a
 * differential apply that touches only what actually changed.
 *
 * ## Why the diff matters ("the adhan did not fire")
 *
 * "The notification didn't go off" is the category's second-most-common complaint, and the
 * standard implementation is what causes it: on every foreground the app cancels *all* pending
 * notifications and reschedules them. Between the cancel and the schedule there is a window in
 * which the OS holds nothing at all — and if the process is killed there (a swipe-away, a
 * low-memory kill, an Android OEM task-killer), the user's reminders are simply gone until they
 * next open the app. That is why every competitor has to tell people to "open the app every few
 * days".
 *
 * {@link NotificationService.sync} never cancels what it is about to reschedule. It reads what
 * the OS actually holds, asks {@link diffPlans} for the difference, and applies only that. A
 * steady-state sync issues **zero** platform calls, so it is safe to run on every foreground,
 * every settings change and every prayer logged.
 *
 * ## Drift: why the key diff is not enough on its own
 *
 * `diffPlans` matches by key (`${kind}:${day}:${prayer}`) and is deliberately blind to *time*:
 * when the user moves city or edits an offset, every fire time shifts while every key stays the
 * same. The OS is no help here either — iOS turns a date trigger into a
 * `UNTimeIntervalNotificationTrigger` and reports back the interval it was *created* with, not
 * the absolute instant.
 *
 * So every request we schedule carries its own intended `fireAt` — plus the sound it was built
 * with, the adhan voice that sound resolved to, and the language it was written in — in its `data`
 * payload (see {@link NotificationPayload}), which both platforms hand back verbatim from
 * `getAllScheduledNotificationsAsync`. {@link isStale} compares them against the plan: a fire time
 * off by more than {@link DRIFT_TOLERANCE_MS}, a changed sound, a changed recitation or a changed
 * language means cancel-then-reschedule *for that one notification*. Nothing else is touched, so
 * moving city costs one cancel + one schedule per notification instead of a full teardown.
 *
 * ## Android channels (PRODUCT_SPEC §11, ARCHITECTURE.md)
 *
 * Android owns sound and importance per **channel**, and **a channel's sound cannot be changed
 * after it is created** — `setNotificationChannelAsync` on an existing id can only update its
 * name and description. A single "Reminders" channel would therefore freeze whichever sound the
 * user happened to pick first, forever.
 *
 * The channel id therefore encodes the sound, and — when that sound is the adhan — **which
 * recitation it is**: `` `${kind}-${sound}-v${CHANNEL_VERSION}` `` for silent and system,
 * `` `${kind}-adhan-${voice}-v${CHANNEL_VERSION}` `` for the adhan ({@link channelIdFor}).
 * Switching Maghrib from the adhan to the device sound, or switching every adhan from Makkah to
 * Menk, moves the notifications onto a different channel rather than trying to mutate one. Get
 * this wrong and the sound simply never changes on Android — no error, no clue, just the old
 * recitation forever.
 *
 * Channels are created lazily — only the ones the current plan actually needs.
 *
 * **The one thing that *is* deleted** is an adhan channel carrying a recitation the user no longer
 * uses ({@link pruneStaleAdhanChannels}), because the alternative is a row in the Android
 * notification settings for every voice the user ever auditioned, only one of which is live —
 * and someone silencing "Adhan reminders · Makkah" while actually receiving on
 * "Adhan reminders · Menk" is a support problem with no visible cause. The usual objection to
 * deleting a channel (it throws away the user's own per-channel tweaks) does not apply here: the
 * id encodes the voice, and Android *remembers* a deleted channel's settings, so returning to a
 * voice restores exactly the tweaks that voice had. Silent and system channels are never deleted.
 *
 * `CHANNEL_VERSION` is the escape hatch: if a channel's *fixed* properties ever have to change,
 * bump it and every user gets a new channel instead of a stale one.
 *
 * ## Notifications that leave by themselves — Android only (D88)
 *
 * A reminder stops being true when its prayer's window closes, and nothing of ours runs between a
 * reminder landing and the user picking up the phone — which is exactly why someone who does not
 * open the app for two days used to come back to a wall of hours-old notifications.
 *
 * So every request carries {@link NotificationPayload.expiresAt}, and {@link NotificationAdapter}
 * arms an alarm for that instant when it schedules the request (`modules/notification-dismissal`,
 * our own local Expo module). The alarm takes the notification out of the tray with the app's
 * process gone. It **never posts, schedules or changes a notification**, so nothing about delivery
 * — the reliability-critical half, the category's #2 complaint — can be affected by it.
 *
 * iOS has no equivalent, by any mechanism (PRODUCT_SPEC §11.5), so there the payload field is
 * inert and {@link selectStaleDelivered} on the next foreground is the whole of the answer.
 *
 * ## The foreground handler
 *
 * `expo-notifications` hands a notification that arrives **while the app is open** to a handler
 * that decides whether to present it, and **its default with no handler installed is to present
 * nothing** — no banner, no sound, no entry in the shade, and no error. Every notification the
 * user is in the app for is therefore lost unless one is installed, including the reminder-health
 * screen's test notification, which is pressed from inside the app by definition.
 * {@link foregroundPresentation} is that policy and {@link createExpoNotificationAdapter}
 * installs it on first use of the native module.
 *
 * ## The adhan sound
 *
 * Which file the `adhan` sound resolves to is **not decided here** — `domain/adhanVoices` owns it,
 * and owns it alone so that the in-app preview and the notification can never name different
 * files. iOS gets a `.caf` clip under Apple's 30-second cap; Android gets the full `.mp3`. All
 * eight files are bundled by the `expo-notifications` config plugin's `sounds` array in
 * **app.json**, which is what makes a bare base filename a valid sound on both platforms.
 *
 * The cap itself is stated to the user on iOS and nowhere else (the selector's own note), because
 * on an iPhone it is an audible fact about what they are choosing. Android users never see it.
 *
 * ## Failure policy
 *
 * Nothing here throws for an expected failure. Permission denied, a platform without
 * notifications, a single failed schedule: all of them return a {@link SyncOutcome} the caller
 * can render. Rescheduling runs on every foreground — it must degrade, not crash the app.
 *
 * ## Why the adapter is injectable
 *
 * `expo-notifications` is a native module; importing it eagerly breaks plain Jest runs. Everything
 * goes through {@link NotificationAdapter} — the app uses {@link createExpoNotificationAdapter}
 * (which `require`s the native module lazily on first use) and tests use
 * {@link createFakeNotificationAdapter}, an in-memory OS.
 *
 * Dependency rule: `services → domain`. No React, no stores, no database. The one exception is
 * i18n: notification bodies are user-facing copy, so the default content builder resolves keys
 * through the app's i18next instance — lazily, and replaceable via {@link NotificationServiceOptions}.
 */

import { DEFAULT_ADHAN_VOICE, adhanSoundFile, isAdhanVoice } from '../domain/adhanVoices';
import {
  DEFAULT_ADHAN_LINGER_MINUTES,
  DEFAULT_MAX_NOTIFICATIONS,
  DEFAULT_NUDGE_LEAD_MINUTES,
  diffPlans,
  notificationKey,
  planNotifications,
  selectStaleDelivered,
  type DeliveredNotification,
  type PrayerStatusMap,
} from '../domain/notificationPlan';
import { prayerNameKey } from '../domain/prayerNames';
import { NOTIFICATION_KINDS, PRAYERS, isPrayer } from '../domain/types';
import { windowEndFor } from '../domain/windows';
import { formatTime, type TimeFormatPreference } from '../utils/formatTime';
import {
  cancelPause,
  isSupported as audioPauseSupported,
  schedulePause,
} from '../../modules/audio-pause';
import { cancelDismissal, scheduleDismissal } from '../../modules/notification-dismissal';
import {
  ADHAN_CATEGORY_ID,
  CONFIRMATION_CATEGORY_ID,
  MARK_AFTER_BODY_FIELD,
  MARK_AFTER_TITLE_FIELD,
  MARK_CHANNEL_FIELD,
  MARK_ONGOING_FIELD,
  MARK_PRAYED_ACTION,
  MARK_UNDO_ACTION,
  isSupported as prayerMarksSupported,
} from '../../modules/prayer-marks';

import { buildOngoingContent, ONGOING_REFRESH_GRACE_MS, selectOngoingState } from './ongoingNotification';

import type { SoundPlatform } from '../domain/adhanVoices';
import type {
  AdhanVoice,
  DayTimes,
  NotificationKind,
  PlannedNotification,
  Prayer,
  PrayerDay,
  ReminderSettings,
  ReminderSound,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Bumped only when a channel's **immutable** properties (sound, importance, vibration) must
 * change. Android will not update those on an existing channel, so a new id is the only way; the
 * old channels stay behind, unused and harmless.
 *
 * **v2 — the adhan channels had to be re-minted.** `SoundResolver` in expo-notifications does not
 * fail when a sound file is missing: it falls back to `Settings.System.DEFAULT_NOTIFICATION_URI`.
 * That fallback is resolved *once*, when the channel is created, and then frozen into it — so any
 * install that created `adhan-adhan-<voice>-v1` while the recitations were not yet in `res/raw`
 * holds a channel that will play the device's default sound for ever, with no error and no way
 * for the app to correct it. Every build before the recitations shipped is such an install, and
 * the first Android build that carried them failed on the duplicate-resource bug, so the window
 * was real rather than theoretical. An owner's tester reported hearing no adhan, which is exactly
 * this. Bumping the version is the only repair; it costs a set of unused channels.
 */
export const CHANNEL_VERSION = 2;

/** The Android ongoing/persistent notification's channel (PRODUCT_SPEC §11, off by default). */
export const ONGOING_CHANNEL_ID = `ongoing-v${CHANNEL_VERSION}`;

/** Identifier of the Android ongoing notification. Fixed, so re-presenting it replaces it. */
export const ONGOING_NOTIFICATION_ID = 'ongoing';

/** Identifier of the reminder-health screen's test notification. */
export const TEST_NOTIFICATION_ID = 'test';

/** Where tapping any of our notifications lands: the Today tab (PRODUCT_SPEC §11). */
export const TODAY_ROUTE = '/';

/**
 * How far a held notification's intended `fireAt` may sit from the plan's before it counts as
 * stale. One second: prayer times are whole minutes, so anything above jitter is a real move.
 */
export const DRIFT_TOLERANCE_MS = 1000;

/**
 * The Android channel a planned notification belongs on.
 *
 * The sound is part of the id because Android refuses to change a channel's sound after creation,
 * and for the adhan the **recitation** is part of it too, for exactly the same reason: switching
 * from Makkah to Menk is a sound change, and a channel cannot take one. See the module header.
 *
 * Only the adhan carries a voice segment. A `silent` or `system` channel sounds the same whichever
 * recitation is chosen, so putting the voice in its id would create four identical channels and
 * scatter the user's own tweaks across them.
 *
 * @param kind - Which notification kind the channel carries.
 * @param sound - The sound the user chose for that prayer.
 * @param voice - The chosen recitation. Ignored unless `sound` is `adhan`.
 * @returns A stable channel id such as `adhan-adhan-makkah-v1` or `nudge-system-v1`.
 */
export function channelIdFor(
  kind: NotificationKind,
  sound: ReminderSound,
  voice: AdhanVoice = DEFAULT_ADHAN_VOICE
): string {
  const variant = sound === 'adhan' ? `adhan-${voice}` : sound;
  return `${kind}-${variant}-v${CHANNEL_VERSION}`;
}

/**
 * Matches a channel id this app created for the **adhan** sound, capturing the recitation.
 *
 * Two shapes are recognised, and the difference is a migration: `adhan-adhan-makkah-v1` is the
 * current form, and `adhan-adhan-v1` is what builds before the selector created — a channel whose
 * sound is `adhan.wav`, a file this build no longer ships. The legacy form captures no voice, and
 * {@link pruneStaleAdhanChannels} treats it as always stale for that reason.
 *
 * No token in an id contains a hyphen (kinds and voices are single lowercase/camel words), so this
 * cannot mis-parse an id we produced, and anything it does not match is left strictly alone.
 */
const ADHAN_CHANNEL_ID = new RegExp(`^[A-Za-z]+-adhan(?:-([a-z]+))?-v${CHANNEL_VERSION}$`);

/**
 * Whether an existing Android channel is an adhan channel carrying a recitation nobody is using.
 *
 * Pure and exported so the rule is testable without a device — and because getting it wrong is
 * expensive in both directions: too eager and it deletes the live channel (the user's reminders
 * lose their sound until the next sync recreates it), too shy and the sound silently never changes.
 *
 * @param id - A channel id as the OS reports it, ours or another library's.
 * @param voice - The recitation currently chosen.
 * @returns `true` only for one of our adhan channels whose voice is not `voice`.
 */
export function isStaleAdhanChannel(id: string, voice: AdhanVoice): boolean {
  const match = ADHAN_CHANNEL_ID.exec(id);
  if (match === null) return false;
  // The legacy voiceless form names a sound file this build does not ship; it is always stale.
  return match[1] !== voice;
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/** Permission states we distinguish. Mirrors expo's `PermissionStatus`. */
export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

/** A permission answer, normalised away from the platform response shape. */
export interface NotificationPermission {
  status: NotificationPermissionStatus;
  granted: boolean;
  /** `false` once the OS will no longer prompt — the UI must send the user to system settings. */
  canAskAgain: boolean;
  /** What the OS says it will actually *do* with a notification. See {@link NotificationDelivery}. */
  delivery?: NotificationDelivery;
}

/**
 * The part of the OS's answer that is about **delivery rather than permission** — granted is not
 * the same as audible, and "I pressed send a test and heard nothing" is the complaint this exists
 * to answer (our market research).
 *
 * Every field is `boolean | null` where `null` means **we do not know**, and the distinction is
 * the whole point: a UI may only report what the OS actually told us.
 *
 * What each platform genuinely reports (read from `expo-notifications` 57's own sources, not
 * assumed — see PRODUCT_SPEC §11.7):
 *
 * - **iOS** `getPermissionsAsync().ios` carries `allowsSound`, `allowsAlert`,
 *   `allowsDisplayOnLockScreen`, `allowsDisplayInNotificationCenter` and more, straight off
 *   `UNNotificationSettings`. **It does not carry `scheduledDeliverySetting`** (the notification
 *   summary), so we cannot tell when the OS is holding notifications back for a scheduled digest.
 * - **Android** `getPermissionsAsync().android` carries the app-level `importance` and
 *   `interruptionFilter` (the live Do Not Disturb state). Per-channel importance and sound are a
 *   separate read (`getNotificationChannelAsync`), and are what actually matter, because Android's
 *   own settings UI silences the *channel*.
 *
 * **What neither platform will tell us, and what the copy must therefore never claim:** the iOS
 * physical silent switch, and whether a Focus mode is active. There is no public API for either.
 * A screen that says "your phone is on silent" would be guessing, and a wrong diagnosis sends the
 * user to fix the wrong thing.
 */
export interface NotificationDelivery {
  /** Whether a notification from this app may play a sound at all. */
  soundEnabled: boolean | null;
  /** Whether it may appear as a banner/alert at all. */
  alertsEnabled: boolean | null;
  /** Android's live interruption filter — the Do Not Disturb state. `null` off Android. */
  interruptionFilter: 'all' | 'priority' | 'none' | 'alarms' | null;
}

/** Nothing known about delivery — the honest default, and what a failed read produces. */
const UNKNOWN_DELIVERY: NotificationDelivery = {
  soundEnabled: null,
  alertsEnabled: null,
  interruptionFilter: null,
};

/** Used when the platform could not even tell us what the permission is. */
const UNKNOWN_PERMISSION: NotificationPermission = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
  delivery: UNKNOWN_DELIVERY,
};

/**
 * The one thing worth telling the user about how their notifications will arrive, or `null` when
 * the OS has told us nothing worth repeating.
 *
 * - `alertsOff` — nothing will appear at all. The most severe, so it wins.
 * - `soundOff` — it will appear, silently. On Android this is the *channel*, which is where the
 *   system's own settings UI takes people.
 * - `dndOn` — Do Not Disturb is filtering notifications right now (Android only; iOS gives us no
 *   equivalent).
 */
export type DeliveryWarning = 'alertsOff' | 'soundOff' | 'dndOn';

/**
 * Decides what may honestly be said about delivery.
 *
 * Pure and exported so the policy is tested without a device — and so the rule that governs it is
 * inspectable: **a `null` field means unknown and must never produce a warning.** Reporting
 * "sound is off" because we could not read the setting would be exactly the wrong-diagnosis
 * failure this feature exists to prevent.
 *
 * @param permission - The OS's answer, including {@link NotificationDelivery}.
 * @param channel - The Android channel the notification in question will use, when known. Its
 *        `importance`/`sound` outrank the app-level signal, because Android silences per channel.
 * @returns The single most severe known problem, or `null` when nothing is known to be wrong.
 */
export function describeDelivery(
  permission: NotificationPermission | null,
  channel?: { importance: ChannelImportance; sound: string | null } | null
): DeliveryWarning | null {
  if (permission === null || !permission.granted) return null;
  const delivery = permission.delivery ?? UNKNOWN_DELIVERY;

  if (delivery.alertsEnabled === false) return 'alertsOff';

  // Android: a channel dropped to `low` shows no banner and plays nothing, and a channel whose
  // sound the user cleared plays nothing — either way the test notification will be silent, and
  // neither is visible in the app-level answer.
  if (channel != null && (channel.importance === 'low' || channel.sound === null)) {
    return 'soundOff';
  }
  if (delivery.soundEnabled === false) return 'soundOff';

  // `all` is "nothing is being filtered"; every other value is a live Do Not Disturb of some kind.
  if (delivery.interruptionFilter !== null && delivery.interruptionFilter !== 'all') {
    return 'dndOn';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/**
 * The payload every request we schedule carries. It is our own bookkeeping, round-tripped through
 * the OS: `fireAt` is what makes drift detectable (see the module header) and `url` is what the
 * response listener routes on.
 */
export interface NotificationPayload {
  /** `${kind}:${day}:${prayer}` — the same key `domain/notificationPlan` diffs on. */
  key: string;
  kind: NotificationKind;
  prayer: Prayer;
  day: PrayerDay;
  /** Epoch ms this request was scheduled to fire at. */
  fireAt: number;
  /** The sound it was scheduled with — the second half of staleness detection. */
  sound: ReminderSound;
  /**
   * The recitation the `adhan` sound resolved to when this request was made — `null` when the
   * request was scheduled before the app had a selector at all.
   *
   * Carried on every notification (the setting is global) but only *compared* for `adhan` ones —
   * see {@link isStale}, and note that changing the voice must not cost a reschedule of the silent
   * and device-sound reminders, which sound identical either way.
   */
  voice: AdhanVoice | null;
  /** The language its title and body were written in, so a language change rewrites them. */
  lang: string;
  /**
   * Epoch ms after which this notification is no longer worth reading — the prayer's window end,
   * or the next prayer's start for the sunrise note (`PlannedNotification.expiresAt`).
   *
   * **Android acts on it with the app dead**: scheduling the request also arms an alarm for this
   * instant, which takes the notification back out of the tray whether or not this app is running
   * (`modules/notification-dismissal`, D88). iOS has no equivalent and carries it inertly. Absent
   * when the day's times could not resolve it — and absent on every request scheduled by a build
   * older than D88, which {@link isStale} treats as a reason to rebuild that request once.
   */
  expiresAt?: number;
  /**
   * The action category this request was scheduled under — the "Prayed" button (D92). Absent on
   * everything scheduled without one: every non-adhan kind, and every adhan scheduled by a build
   * without `modules/prayer-marks`. It exists so {@link isStale} can see the difference: the
   * button is attached at *schedule* time, so a held adhan from an older build would otherwise
   * sit "unchanged" for the whole plan window, firing button-less after an upgrade.
   */
  category?: string;
  /**
   * Whether this reminder's fire instant also pauses whatever the phone is playing — the "Pause
   * what's playing" setting (D96), applied at schedule time exactly as the button is: the adapter
   * arms a pause alarm alongside the request (`modules/audio-pause`, Android only), and
   * {@link isStale} rebuilds a held reminder whose recorded flag no longer matches the setting.
   * Only ever set on the adhan kind, and only where the native module exists.
   */
  pauseAudio?: boolean;
  /**
   * The Android `Notification.category` this request was scheduled with (D146) — `'reminder'` on
   * every reminder kind, absent on iOS and on anything scheduled before D146.
   *
   * Recorded for the same reason as {@link NotificationPayload.category}: it is stamped at
   * *schedule* time, so a held reminder from an older build would otherwise sit "unchanged" for
   * the whole plan window and keep arriving with nothing declared. {@link isStale} reads the gap
   * as "rebuild this one", and one sync repairs the schedule the OS is already holding.
   */
  androidCategory?: string;
  /** Deep link opened when the notification is tapped. Always {@link TODAY_ROUTE} for now. */
  url: string;
}

/**
 * The payload of the pre-scheduled ongoing-notification swap (D95 extended): the OS re-posts the
 * sticky notification at the next prayer transition with no process awake. Deliberately NOT a
 * {@link NotificationPayload} — it has no `kind`, so {@link parsePayload} rejects it and the
 * diff-sync neither counts nor cancels it; `applyOngoing` alone manages its lifecycle.
 */
export interface OngoingSwapData extends Record<string, unknown> {
  url: string;
  /** The transition instant, epoch ms — informational (the request's own trigger is the truth). */
  fireAt: number;
  /** Never present; declared so the adapter can read the field off either payload shape. */
  expiresAt?: undefined;
  /** Never present; same reason as {@link OngoingSwapData.expiresAt}. */
  pauseAudio?: undefined;
}

/** One request handed to the platform. */
export interface ScheduleRequest {
  identifier: string;
  title: string;
  body: string;
  data: NotificationPayload | OngoingSwapData;
  /**
   * `null` = silent, `'default'` = the device notification sound, otherwise a bundled base
   * filename such as {@link ADHAN_SOUND_FILE}.
   */
  sound: string | null;
  /** Android only; ignored elsewhere. */
  channelId?: string;
  /**
   * The action category this notification is shown with — the "Prayed" button (D92). Set only on
   * the adhan reminder, and only where the native halves that answer the press actually exist;
   * a button that queues nothing would be worse than no button.
   *
   * The category itself must be registered ({@link NotificationAdapter.ensureCategory}) before a
   * notification naming it is delivered. Both platforms silently show no buttons for an unknown
   * category rather than failing, so a mismatch is invisible — which is why the identifiers live
   * in `modules/prayer-marks` and nowhere else.
   */
  categoryId?: string;
  /**
   * iOS only. `'passive'` adds the notification to Notification Center without lighting the
   * screen, playing a sound or showing a banner — the closest thing iOS has to "tell me when I
   * look, never interrupt me", and what the `expiry` note uses. Omitted means the system default.
   *
   * `'timeSensitive'` is what every reminder that is meant to interrupt now carries. The earlier
   * decision not to use it (D76, reading D49) treated it as an entitlement this app could not
   * have; that was true of `'critical'` and not of this one. The time-sensitive entitlement is
   * declared in the binary (`plugins/withTimeSensitiveNotifications`) and needs no approval from
   * Apple. Without it a Focus mode that does not list this app, or the Scheduled Summary, holds
   * the adhan back until the Focus ends or the next digest — which is delivery hours late, not
   * delivery quietly. A prayer time is the textbook case for the level, and iOS still lets the
   * user take it away per app in Settings.
   *
   * `'critical'` remains permanently out: it bypasses the ringer switch and needs an entitlement
   * Apple grants case by case.
   */
  interruptionLevel?: 'passive' | 'active' | 'timeSensitive';
  /**
   * Android: post as sticky when this fires, exactly like {@link PresentRequest.ongoing}. Only the
   * pre-scheduled ongoing swap sets it — a reminder must always be dismissible.
   */
  ongoing?: boolean;
  fireAt: Date;
}

/** An immediately-presented notification (the test notification, the ongoing one). */
export interface PresentRequest {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: string | null;
  channelId?: string;
  /** Android: cannot be swiped away, and is not dismissed when tapped. */
  ongoing?: boolean;
  /**
   * The action category this notification is shown with, exactly as on {@link ScheduleRequest}.
   * The test notification carries the adhan's, so the "Prayed" button can be tried (its payload's
   * test flag keeps the press from recording anything, D93); the ongoing notification carries it
   * while a prayer is due (D95).
   */
  categoryId?: string;
  /**
   * iOS only, exactly as on {@link ScheduleRequest}. Only the test notification sets it: a test
   * that cannot break through a Focus mode when the real adhan can is not a rehearsal of
   * anything. The ongoing notification is Android-only and never carries one.
   */
  interruptionLevel?: 'passive' | 'active' | 'timeSensitive';
}

/** What the OS is holding, normalised. */
export interface ScheduledNotification {
  identifier: string;
  /** The intended fire instant from the payload, or `null` when we cannot tell. */
  fireAt: Date | null;
  /** Our payload, when the request carries a well-formed one. */
  payload: NotificationPayload | null;
  title: string | null;
  body: string | null;
}

/**
 * A user tapping one of our notifications. `url` is the route to open — always
 * {@link TODAY_ROUTE} today, but carried per notification so a future kind can deep-link
 * somewhere else without changing this contract.
 */
export interface NotificationTapEvent {
  url: string;
  /** The payload, when the tapped notification was one of ours. */
  payload: NotificationPayload | null;
}

/**
 * One of our scheduled notifications **arriving** while the app is in the **foreground** — on
 * either platform, and only there. This used to claim Android also delivered it while the app
 * merely sat in the background; it does not: `ExpoHandlingDelegate.handleNotification` gates the
 * JS event on `isAppInForeground()` (RESUMED) and otherwise posts the notification natively
 * without telling JS anything (D165, correcting D84's second half; D96 had already recorded the
 * same fact for the same seam).
 *
 * So what this buys is a tray sweep while the user is already looking at the app. With the app in
 * the background or gone, the tray is kept right by other means: on Android by each row's own
 * `expiresAt`, enforced by the system through `setTimeoutAfter` (the `expo-notifications` patch)
 * with the dismissal alarm as a second line; on iOS by nothing until the next open, because a
 * local notification's delivery runs no app code there. See {@link NotificationService.observeReceived}.
 */
export interface NotificationReceivedEvent {
  /** Never `null` — only notifications carrying one of our plan payloads are reported. */
  payload: NotificationPayload;
}

/** One action button, as this service wants it. */
export interface CategoryAction {
  /** Matched against the press; see `modules/prayer-marks`' action constants. */
  identifier: string;
  title: string;
}

/**
 * A set of action buttons a notification can be shown with (D92).
 *
 * Registering one is global and idempotent on both platforms — the same identifier registered
 * again replaces what was there, which is how a language change reaches buttons that are already
 * on screen for notifications scheduled days ago.
 */
export interface CategorySpec {
  id: string;
  actions: CategoryAction[];
}

/** Android importance levels, named so the service never imports the platform enum. */
export type ChannelImportance = 'low' | 'default' | 'high';

/** An Android notification channel, as this service wants it. */
export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  importance: ChannelImportance;
  /** `null` = silent, `'default'` = device sound, otherwise a bundled base filename. */
  sound: string | null;
  vibrate: boolean;
  showBadge: boolean;
}

/**
 * Everything the service needs from the platform. Implemented for real by
 * {@link createExpoNotificationAdapter} and in memory by {@link createFakeNotificationAdapter}.
 */
export interface NotificationAdapter {
  /** `'other'` covers web and anything without local notifications. */
  readonly platform: 'ios' | 'android' | 'other';
  /** Reads the current permission. MUST NOT prompt. */
  getPermission(): Promise<NotificationPermission>;
  /** Prompts. Only ever called from an explicit user action. */
  requestPermission(): Promise<NotificationPermission>;
  /** Everything the OS is holding for this app, ours and otherwise. */
  getScheduled(): Promise<ScheduledNotification[]>;
  /**
   * Everything already **delivered** and still in the tray. Only readable while the app runs,
   * which is exactly when {@link NotificationService.sync} uses it to clear what has gone stale.
   */
  getPresented(): Promise<ScheduledNotification[]>;
  /**
   * Hands one request to the platform — and, when it carries a
   * {@link NotificationPayload.expiresAt}, **arms its self-dismissal** so the tray loses it when it
   * stops being true, with the app dead (`modules/notification-dismissal`, Android only, D88).
   *
   * The two belong in one call on purpose: a reminder scheduled without its dismissal is a
   * notification that outlives its own meaning, and every caller would have to remember the second
   * step. `cancel` and `dismiss` undo it for the same reason.
   */
  schedule(request: ScheduleRequest): Promise<void>;
  /** Drops a pending request, and any self-dismissal armed with it. */
  cancel(identifier: string): Promise<void>;
  /** Shows a notification right now. */
  present(request: PresentRequest): Promise<void>;
  /** Removes a presented notification from the tray, and disarms its self-dismissal. */
  dismiss(identifier: string): Promise<void>;
  /** Creates or updates an Android channel. A no-op on other platforms. */
  ensureChannel(channel: ChannelSpec): Promise<void>;
  /**
   * Registers (or replaces) a set of action buttons, so notifications naming it show them. Both
   * platforms support this; it is a no-op on `other`.
   */
  ensureCategory(category: CategorySpec): Promise<void>;
  /**
   * Every channel this app currently owns, by id. `[]` off Android. Used to find the adhan
   * channels left behind by a recitation the user has moved on from — asking the OS what exists
   * beats guessing, which would mean one probe per (kind × voice) combination on every sync.
   */
  listChannels(): Promise<string[]>;
  /**
   * Removes an Android channel. A no-op elsewhere. Only ever called on a stale adhan channel
   * ({@link isStaleAdhanChannel}) — see the module header for why that one case is safe.
   */
  deleteChannel(id: string): Promise<void>;
  /**
   * Reads back an Android channel as the OS currently holds it — importance and sound may have
   * been changed by the user in the system settings since we created it, and that is precisely
   * what {@link describeDelivery} needs to know. `null` off Android, or when there is no such
   * channel.
   */
  getChannel(id: string): Promise<{ importance: ChannelImportance; sound: string | null } | null>;
  /** Subscribes to notification taps. Returns the unsubscribe function. */
  addResponseListener(listener: (event: NotificationTapEvent) => void): () => void;
  /**
   * Subscribes to notifications **arriving**, ours and otherwise, while the process is alive.
   * Returns the unsubscribe function. The payload is `null` for anything that is not one of our
   * scheduled reminders — including the ongoing notification, which we post ourselves.
   */
  addReceivedListener(listener: (event: { payload: NotificationPayload | null }) => void): () => void;
  /** The tap that launched the app, if it was launched by one. */
  getLastResponse(): Promise<NotificationTapEvent | null>;
}

// ---------------------------------------------------------------------------
// Service contract
// ---------------------------------------------------------------------------

/** Everything {@link NotificationService.sync} needs. Gathered by the caller, never ambient. */
export interface SyncInput {
  /** The instant to plan for. Nothing is scheduled at or before it. */
  now: Date;
  /**
   * Consecutive prayer days starting at today, offsets applied — normally
   * `DEFAULT_PLAN_DAYS` of them. An empty list is legal and cancels everything.
   */
  days: readonly DayTimes[];
  reminders: ReminderSettings;
  /**
   * The recitation every `adhan` sound plays. Defaults to `DEFAULT_ADHAN_VOICE`, so a caller that
   * has not been taught about the setting yet still schedules something valid.
   */
  adhanVoice?: AdhanVoice;
  /** What has already been logged, for nudge suppression. */
  statuses: PrayerStatusMap;
  /** Days the user is exempt on; these produce nothing at all (PRODUCT_SPEC §6). */
  exemptDays: ReadonlySet<PrayerDay>;
  /** Exempt days where she kept the call — see `NotificationPlanInput.reminderKeptDays`. */
  reminderKeptDays?: ReadonlySet<PrayerDay>;
  /** Islamic-midnight overrides for the Isha nudge, per day. */
  ishaNudgeTimes?: Record<PrayerDay, Date>;
  /** Caps the plan. Defaults to `DEFAULT_MAX_NOTIFICATIONS` (60, under iOS's 64). */
  maxCount?: number;
  /** Lead time for non-Isha nudges. Defaults to `DEFAULT_NUDGE_LEAD_MINUTES`. */
  nudgeLeadMinutes?: number;
  /**
   * Whether Fajr's silent note at sunrise is wanted. **Off unless passed** (D90) — a caller that
   * predates the setting must not send a notification the user never asked for.
   */
  sunriseNoteEnabled?: boolean;
  /**
   * Whether whatever the phone is playing should pause when a prayer's time comes in (D96,
   * "Pause what's playing"). **Off unless passed**, for the same reason as the sunrise note.
   * Acted on only where `modules/audio-pause` exists — Android — and carried per adhan request,
   * so flipping it rewrites the held reminders on the next sync.
   */
  pauseAudioAtAdhan?: boolean;
  /** The user's 12/24h preference, for the times inside notification bodies. */
  timeFormat?: TimeFormatPreference;
  /**
   * The language the content is written in (e.g. `i18n.language`). Stored in each payload, so
   * switching the app language rewrites every held notification instead of leaving yesterday's
   * language in the tray.
   */
  locale?: string;
  /** Android ongoing notification (PRODUCT_SPEC §11). Off by default. */
  persistentNotification?: boolean;
}

/** Why a sync did nothing, or that it did something. */
export type SyncStatus = 'applied' | 'permissionDenied' | 'unsupported';

/** What a sync did. Everything is reported; nothing is thrown. */
export interface SyncOutcome {
  status: SyncStatus;
  /** Size of the desired plan (before the diff). */
  planned: number;
  /** Keys newly handed to the OS. */
  scheduled: string[];
  /** Identifiers taken back from the OS. */
  cancelled: string[];
  /** Keys that were already correctly scheduled and were left alone. */
  unchanged: string[];
  /** Platform calls that failed. A non-zero value still leaves the rest applied. */
  failures: number;
  permission: NotificationPermission;
}

/** The surface the app (and the reminder-health screen) consumes. */
export interface NotificationService {
  /** Current permission, without prompting. Never throws. */
  getPermission(): Promise<NotificationPermission>;
  /**
   * Prompts for permission — **only ever call this from an explicit user action**
   * (PRODUCT_SPEC §11; the reminders screen's button). On Android 13+ this is the
   * `POST_NOTIFICATIONS` runtime request, which needs a channel to exist first, so the base
   * channels are created before the prompt.
   */
  requestPermission(): Promise<NotificationPermission>;
  /** Reconciles the OS with the plan. Idempotent; safe to call as often as you like. */
  sync(input: SyncInput): Promise<SyncOutcome>;
  /**
   * Makes one prayer go quiet the moment it is logged, without waiting for a full sync: its
   * pending last call and sunrise note are cancelled, and anything of its already sitting in the
   * tray is dismissed. Tapping "prayed" should silence the prayer you just prayed — including
   * the adhan banner still on the lock screen from an hour ago.
   *
   * Returns `false` only when a platform call failed; cancelling or dismissing an identifier the
   * OS is not holding resolves cleanly on both platforms and reports `true`.
   */
  clearForPrayer(day: PrayerDay, prayer: Prayer): Promise<boolean>;
  /**
   * What, if anything, the OS has told us will stop a notification being seen or heard — the
   * answer to "I pressed send a test and nothing happened".
   *
   * Reports only what the platform actually says (see {@link NotificationDelivery}); it never
   * guesses at the iOS silent switch or a Focus mode, because neither is readable.
   *
   * @param options - The sound the notification in question will use, and (for the adhan) the
   *        recitation, so the right Android channel is inspected. Defaults to `system`.
   * @returns The single most severe known problem, or `null`.
   */
  checkDelivery(options?: {
    sound?: ReminderSound;
    voice?: AdhanVoice;
  }): Promise<DeliveryWarning | null>;
  /** Everything the OS holds for this app; the reminder-health screen's ground truth. */
  listScheduled(): Promise<ScheduledNotification[]>;
  /** Fires a notification now, so the user can prove reminders work. */
  sendTestNotification(options?: { sound?: ReminderSound; voice?: AdhanVoice }): Promise<boolean>;
  /** Drops every notification this app scheduled. Used when reminders are turned off wholesale. */
  cancelAll(): Promise<void>;
  /**
   * Calls `listener` whenever the user taps one of our notifications, and once up front for the
   * tap that launched the app (PRODUCT_SPEC §11: tapping opens Today). The listener is what
   * knows about routing; this layer never imports the navigator.
   *
   * @param listener - Receives the route to open.
   * @returns The unsubscribe function.
   */
  observeTaps(listener: (event: NotificationTapEvent) => void): () => void;
  /**
   * Calls `listener` each time one of **our scheduled reminders** arrives while the process is
   * alive — the trigger for sweeping the tray at the moment it grows rather than at the next
   * foreground (PRODUCT_SPEC §11.5).
   *
   * Everything that is not one of ours is filtered out here rather than at the call site, and the
   * ongoing notification is the reason why: the app posts it during a sync, so a listener that saw
   * it would sync again, post it again, and never stop.
   *
   * @param listener - Receives the arriving notification's payload.
   * @returns The unsubscribe function.
   */
  observeReceived(listener: (event: NotificationReceivedEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/** The i18next-shaped translate function the content builder needs. */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/** Title and body of one notification. */
export interface NotificationContent {
  title: string;
  body: string;
}

/** Construction-time dependencies of {@link createNotificationService}. */
export interface NotificationServiceOptions {
  /** Defaults to the app's i18next instance, resolved lazily on each call. */
  translate?: TranslateFn;
  /** Defaults to `utils/formatTime`. Injected so tests are locale-independent. */
  formatClock?: (date: Date, timeFormat?: TimeFormatPreference) => string;
}

/** The app's i18next instance, required lazily so importing this module stays cheap. */
function defaultTranslate(key: string, params?: Record<string, unknown>): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const i18n = require('../i18n').default as {
    t: (key: string, params?: Record<string, unknown>) => string;
  };
  return i18n.t(key, params);
}

function defaultFormatClock(date: Date, timeFormat?: TimeFormatPreference): string {
  return formatTime(date, { timeFormat });
}

/**
 * The i18n leaf naming one occurrence of a prayer — `jumuah` for Friday's midday prayer, so a
 * notification reads "Jumu'ah · Dhuhr" the way every other per-day surface does (D77,
 * `domain/prayerNames`). The prayer's identity is untouched: `notification.prayer` stays `dhuhr`
 * in the key, the payload and the diff.
 *
 * `prayerNameKey` throws on a day label it cannot read, and this is the one place that matters:
 * `buildContent` runs *outside* the per-notification try in {@link NotificationService.sync}, so a
 * throw here would abandon every remaining notification in the plan. A name is never worth that —
 * an unreadable day simply falls back to the prayer's own id.
 *
 * @param prayer - The prayer's stable identity.
 * @param day - The prayer day the occurrence belongs to.
 * @returns The `prayers.*` / `prayers.arabic.*` leaf to translate.
 */
function nameKeyFor(prayer: Prayer, day: PrayerDay): string {
  try {
    return prayerNameKey(prayer, day);
  } catch {
    return prayer;
  }
}

/**
 * Builds the localized title and body for one planned notification.
 *
 * **What these strings are for.** A notification is read on a lock screen, in a glance, often
 * before the reader is properly awake. It gets one job each, and the shape is the same in all
 * three languages: the **title names the prayer**, the **body carries exactly one fact**. Nothing
 * is repeated between them, nothing is explained, and no sentence is built where a phrase does.
 *
 * | kind          | title                    | body                            |
 * | ------------- | ------------------------ | ------------------------------- |
 * | `preReminder` | the prayer               | when it starts                  |
 * | `adhan`       | the prayer               | that it is time, and when       |
 * | `nudge`       | the prayer               | when the time runs out          |
 * | `expiry`      | that Fajr ended, and why | which prayer is next, and when  |
 *
 * **Every time in here is an absolute clock time, and that is a rule rather than a style (D88).**
 * A notification's text is frozen the instant it is delivered — nothing redraws it, and on iOS
 * nothing can. A duration therefore stops being merely stale and becomes false: "20 minutes left
 * to pray" still says twenty minutes an hour later, on the screen someone checks precisely to
 * learn whether they still have time. An absolute time cannot go false, and it is the more useful
 * fact anyway: a person glancing at a lock screen wants the deadline, not arithmetic.
 *
 * The precedent was already here. `nudge.bodyIsha` exists because Isha's last call is Islamic
 * midnight, hours before its window really ends (D71), so a number of minutes would have been a
 * lie at the moment it was written. The reasoning was never special to Isha; it just took longer
 * to notice that a number goes wrong for every prayer, only more slowly. Durations survive in
 * exactly one place — the ongoing notification, which the app redraws.
 *
 * `expiry` is the one whose title is not the prayer's name, because it is not a call to pray —
 * it reports that the sun rose. It says nothing about the reader: not that they missed anything,
 * not that they should have done anything. The app does not know whether they prayed, only
 * whether they said so, and a notification is the worst possible place to guess.
 *
 * @param notification - The planned notification to describe.
 * @param deps - Translation, clock formatting, and the neighbouring prayer an `expiry` points to.
 * @returns Non-empty `title` and `body`.
 */
export function buildContent(
  notification: PlannedNotification,
  deps: {
    translate: TranslateFn;
    formatClock: (date: Date, timeFormat?: TimeFormatPreference) => string;
    prayerTime: Date;
    timeFormat?: TimeFormatPreference;
    /** When the prayer's window closes — the deadline a `nudge` quotes. */
    windowEnd?: Date;
    /** The prayer an `expiry` points forward to, and when it starts. */
    nextPrayer?: Prayer;
    nextPrayerTime?: Date;
  }
): NotificationContent {
  const { translate, formatClock, prayerTime, timeFormat } = deps;
  // A notification names one *occurrence*, so Friday's midday prayer is "Jumu'ah · Dhuhr" (D77).
  // The identity stays `dhuhr` — the key, the payload and the diff never see this.
  const name = nameKeyFor(notification.prayer, notification.day);
  const prayer = translate(`prayers.${name}`);
  const arabic = translate(`prayers.arabic.${name}`);
  const time = formatClock(prayerTime, timeFormat);

  if (notification.kind === 'expiry') {
    // `nextPrayerFor` only ever looks within the notification's own day, so the prayer it points
    // forward to belongs to that same day and is named by it.
    const next =
      deps.nextPrayer === undefined
        ? ''
        : translate(`prayers.${nameKeyFor(deps.nextPrayer, notification.day)}`);
    const nextTime =
      deps.nextPrayerTime === undefined ? '' : formatClock(deps.nextPrayerTime, timeFormat);
    return {
      title: translate('notifications.expiry.title', { prayer, arabic }),
      // Without a next prayer to point at there is no forward half of the message, and a body
      // reading "Next:  · " would be worse than the plain fact of the window having closed.
      body:
        next === '' || nextTime === ''
          ? translate('notifications.expiry.bodyAlone', { prayer, time })
          : translate('notifications.expiry.body', { next, time: nextTime }),
    };
  }

  const title = translate(`notifications.${notification.kind}.title`, { prayer, arabic });
  // The last call names the deadline itself. Isha is the exception and stays one: its last call
  // is Islamic midnight while its window runs to dawn (D71), so the honest deadline is hours away
  // and quoting it would read as permission to leave the prayer until four in the morning. It says
  // what is true without a number — the good time is ending — which is also the fallback for a
  // window end we could not resolve, a state no non-Isha nudge can reach (a nudge is computed
  // *from* the window end, so without one there is no nudge).
  const nudgeBody =
    notification.prayer === 'isha' || !(deps.windowEnd instanceof Date)
      ? translate('notifications.nudge.bodyIsha', { prayer })
      : translate('notifications.nudge.body', {
          prayer,
          time: formatClock(deps.windowEnd, timeFormat),
        });
  const body =
    notification.kind === 'nudge'
      ? nudgeBody
      : translate(`notifications.${notification.kind}.body`, { prayer, arabic, time });

  return { title, body };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * Importance per kind. The nudge is deliberately quieter than the adhan itself, and `expiry` is
 * quieter still: `low` is Android's "put it in the shade, no sound, no heads-up banner" — the
 * counterpart of the `passive` interruption level it carries on iOS. A note that a window has
 * closed must never interrupt anyone.
 */
const CHANNEL_IMPORTANCE: Record<NotificationKind, ChannelImportance> = {
  adhan: 'high',
  preReminder: 'high',
  nudge: 'default',
  expiry: 'low',
};

/** Kinds that never buzz, never banner, and never wake a screen. */
const SILENT_KINDS = new Set<NotificationKind>(['expiry']);

/**
 * The platform sound value for a {@link ReminderSound}.
 *
 * The adhan's filename is platform-dependent (`domain/adhanVoices`): the `.caf` clip on iOS, the
 * full `.mp3` elsewhere. Nothing else varies.
 */
function soundValue(sound: ReminderSound, voice: AdhanVoice, platform: SoundPlatform): string | null {
  if (sound === 'silent') return null;
  if (sound === 'adhan') return adhanSoundFile(voice, platform);
  return 'default';
}

/**
 * Describes the Android channel a `(kind, sound, voice)` triple belongs on.
 *
 * The channel is Android's, so the sound is resolved for Android — the full recitation, not the
 * iOS clip — regardless of where this happens to be called from.
 *
 * @param kind - The notification kind.
 * @param sound - The sound the user chose.
 * @param voice - The chosen recitation; part of the id and the name only when `sound` is `adhan`.
 * @param translate - Resolves the channel's user-facing name and description.
 * @returns A {@link ChannelSpec} whose `id` is {@link channelIdFor}'s.
 */
export function channelSpecFor(
  kind: NotificationKind,
  sound: ReminderSound,
  voice: AdhanVoice,
  translate: TranslateFn
): ChannelSpec {
  return {
    id: channelIdFor(kind, sound, voice),
    name: translate('notifications.channel.name', {
      name: translate(`notifications.channel.${kind}.name`),
      // The channel row in Android's settings names the recitation, because that is what tells
      // the user which of several adhan channels they are looking at.
      variant:
        sound === 'adhan'
          ? translate('notifications.channel.variant.adhanVoice', {
              voice: translate(`settings.reminders.voice.${voice}`),
            })
          : translate(`notifications.channel.variant.${sound}`),
    }),
    description: translate(`notifications.channel.${kind}.description`),
    importance: CHANNEL_IMPORTANCE[kind],
    sound: soundValue(sound, voice, 'android'),
    // Vibration is the one channel of attention that survives a silenced phone; the user can
    // still turn it off per channel in the Android settings. A silent kind gets none of it —
    // a buzz is an interruption whatever the channel's sound says.
    vibrate: !SILENT_KINDS.has(kind),
    showBadge: false,
  };
}

/** The ongoing notification's channel: silent, low, never a badge. */
export function ongoingChannelSpec(translate: TranslateFn): ChannelSpec {
  return {
    id: ONGOING_CHANNEL_ID,
    name: translate('notifications.channel.ongoing.name'),
    description: translate('notifications.channel.ongoing.description'),
    importance: 'low',
    sound: null,
    vibrate: false,
    showBadge: false,
  };
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

const KINDS = new Set<string>(NOTIFICATION_KINDS);

/**
 * Whether a held notification no longer matches what we would schedule for it now.
 *
 * The key cannot answer this: `${kind}:${day}:${prayer}` is identical before and after a move to
 * another city, a change of sound, a change of recitation, or a change of app language. The
 * payload can.
 *
 * The recitation is compared **only for notifications that actually play it**. A silent or
 * device-sound reminder sounds exactly the same whichever voice is selected, so treating a voice
 * change as staleness there would tear down and rebuild the entire schedule to no audible effect.
 *
 * `expiresAt` **is** compared for every kind, and it is the one field that can move while the fire
 * time does not: switching the Asr madhab moves Dhuhr's window end without touching Dhuhr's start,
 * and a notification carrying yesterday's deadline would have Android drop it at the wrong minute.
 * It is also what makes the first sync after an upgrade rewrite the whole schedule once — every
 * request scheduled by an older build lacks the field, and those requests are the ones still
 * carrying "20 minutes left to pray" in their frozen text (D88).
 *
 * @param held - What the OS is holding.
 * @param wanted - The planned notification with the same key.
 * @param lang - The language the content would be written in now.
 * @param voice - The recitation the adhan would resolve to now.
 * @returns `true` when the held request has to be cancelled and re-scheduled.
 */
/**
 * Whether two optional instants disagree by enough to matter — the same {@link DRIFT_TOLERANCE_MS}
 * the fire time uses, because both come from the same recomputed prayer times and both wobble by
 * milliseconds for reasons no user could perceive. One side absent and the other present always
 * counts as a move: that is a request written by a build that did not carry the field.
 */
function instantMoved(held: number | undefined, wanted: number | undefined): boolean {
  if (held === undefined || wanted === undefined) return held !== wanted;
  return Math.abs(held - wanted) > DRIFT_TOLERANCE_MS;
}

export function isStale(
  held: ScheduledNotification,
  wanted: PlannedNotification,
  lang: string,
  voice: AdhanVoice = DEFAULT_ADHAN_VOICE,
  category?: string,
  pauseAudio?: boolean,
  androidCategory?: string
): boolean {
  const heldAt = held.fireAt?.getTime();
  if (heldAt === undefined || !Number.isFinite(heldAt)) return true;
  if (Math.abs(heldAt - wanted.fireAt.getTime()) > DRIFT_TOLERANCE_MS) return true;
  if (held.payload === null) return true;
  if (held.payload.sound !== wanted.sound) return true;
  if (wanted.sound === 'adhan' && held.payload.voice !== voice) return true;
  if (instantMoved(held.payload.expiresAt, wanted.expiresAt?.getTime())) return true;
  // The "Prayed" button is attached at schedule time (D92), so a request scheduled before the
  // button existed — or after the native halves vanished — differs in what it *offers* while
  // matching in everything the key and the times can see. Both directions rebuild: a missing
  // button is the upgrade gap this fixes, and a button that queues nothing would be worse.
  if (held.payload.category !== category) return true;
  // Same reasoning for the pause flag (D96): armed at schedule time, invisible to the key, and a
  // flipped setting must reach the reminders the OS is already holding.
  if ((held.payload.pauseAudio === true) !== (pauseAudio === true)) return true;
  // And again for the declared Android category (D146): stamped at schedule time, invisible to
  // the key, and the whole point is that it reaches the reminders the OS is already holding.
  if (held.payload.androidCategory !== androidCategory) return true;
  return held.payload.lang !== lang;
}

/**
 * What the OS should do with one of our notifications that arrives **while the app is open**.
 *
 * Up to SDK 57, `expo-notifications` dropped a foreground notification unless a handler said to
 * show it — the request was delivered to JS and discarded, with no error anywhere. SDK 58 shows it
 * by default, but this handler stays the one place that decides: the adhan must be presented for
 * anyone who happens to have the app open at prayer time, and the "send a test notification"
 * button must show something, because the user is by definition inside the app when they press
 * it. See {@link createExpoNotificationAdapter}, which
 * installs it the first time the native module is touched.
 *
 * Two cases are not the default:
 *
 * - The **ongoing notification** is furniture, not an event. It is re-presented several times a
 *   prayer window (`services/ongoingNotification`), so a banner each time would be a new
 *   interruption for the same unchanged fact; it belongs in the list, silently.
 * - A prayer whose sound the user set to **silent** stays silent. On Android `shouldPlaySound`
 *   overrides the channel, so leaving it `true` would play a sound the user explicitly turned
 *   off. (The same flag suppresses Android's heads-up banner, which is the price of honouring
 *   the choice: the notification still arrives, in the shade.)
 *
 * The badge is never set — nothing in this app counts unread anything (`showBadge: false` on
 * every channel).
 */
export interface ForegroundPresentation {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/**
 * Decides how a notification arriving in the foreground is presented.
 *
 * Kept pure and exported so the policy is unit-tested without the native module — the handler in
 * {@link createExpoNotificationAdapter} is a one-line call to this.
 *
 * @param request - The incoming request's identifier and `data` payload.
 * @returns The behaviour to hand back to `expo-notifications`.
 */
export function foregroundPresentation(request: {
  identifier?: string | null;
  data?: unknown;
}): ForegroundPresentation {
  if (request.identifier === ONGOING_NOTIFICATION_ID) {
    return {
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  }

  const data = request.data;
  const record = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const sound = record.sound;

  // The sunrise note is information, not an event: in the list, never over what the user is
  // doing. Someone holding the app open at sunrise is the last person who needs a banner
  // announcing it.
  if (SILENT_KINDS.has(record.kind as NotificationKind)) {
    return {
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  }

  return {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: sound !== 'silent',
    shouldSetBadge: false,
  };
}

/**
 * Reads one of our payloads back out of whatever the OS returned.
 *
 * @param data - The `data` field of a scheduled or delivered notification.
 * @returns The payload, or `null` when the notification is not one of ours (the test
 *          notification, the ongoing one, anything a future version scheduled differently).
 */
export function parsePayload(data: unknown): NotificationPayload | null {
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const { key, kind, prayer, day, fireAt, sound, voice, lang, url, expiresAt, category } = record;
  const { androidCategory } = record;
  if (typeof key !== 'string' || typeof kind !== 'string' || !KINDS.has(kind)) return null;
  if (typeof prayer !== 'string' || !isPrayer(prayer)) return null;
  if (typeof day !== 'string' || typeof fireAt !== 'number' || !Number.isFinite(fireAt)) {
    return null;
  }
  return {
    key,
    kind: kind as NotificationKind,
    prayer,
    day,
    fireAt,
    sound: sound === 'silent' || sound === 'adhan' ? sound : 'system',
    // `null` for a request scheduled by a build that predated the selector, and that is the whole
    // point: such a request names `adhan.wav`, a file this build no longer ships, so it must be
    // rebuilt whatever the user's voice is. Reading a missing voice as the *default* would leave
    // a Makkah user's upgraded schedule pointing at a sound that is not in the bundle — which iOS
    // answers by silently playing its own default. `null` never equals a voice, so `isStale` says
    // so and one sync repairs it.
    voice: isAdhanVoice(voice) ? voice : null,
    lang: typeof lang === 'string' ? lang : '',
    url: typeof url === 'string' ? url : TODAY_ROUTE,
    // Absent on anything an older build scheduled, and left absent rather than guessed: `isStale`
    // reads the gap as "rebuild this one", which is exactly right.
    ...(typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? { expiresAt } : {}),
    // Absent on anything scheduled without a button; `isStale` reads the difference directly.
    ...(typeof category === 'string' ? { category } : {}),
    // Same story as `category`: absent unless the request was scheduled with a pause armed.
    ...(record.pauseAudio === true ? { pauseAudio: true } : {}),
    // Absent on iOS and on everything scheduled before D146; `isStale` reads the gap directly.
    ...(typeof androidCategory === 'string' ? { androidCategory } : {}),
  };
}

/**
 * The action category a notification of this kind would be scheduled under **right now** (D92):
 * the "Prayed" button on the adhan, and nothing anywhere else. `undefined` on every build whose
 * binary cannot answer a press — a button that queued nothing would be worse than no button.
 *
 * One function rather than two inline conditions, because {@link isStale} and the scheduling loop
 * must agree on this exactly: the first decides when a held request no longer offers what this
 * answers, and the second writes the answer into the next one.
 */
export function actionCategoryFor(kind: NotificationKind): string | undefined {
  return kind === 'adhan' && prayerMarksSupported() ? ADHAN_CATEGORY_ID : undefined;
}

/**
 * `Notification.CATEGORY_REMINDER` — what every prayer reminder actually is: a thing the user
 * scheduled, for a time they chose (D146).
 *
 * Declaring it is ordinary Android practice we had simply never done: the platform asks apps to
 * name a system-wide category so it can rank and filter correctly, and until now our reminders
 * arrived describing themselves as nothing at all. `CATEGORY_ALARM` was considered and rejected —
 * Android's Do Not Disturb filter reads that as a real alarm, and "Allow alarms" is on by
 * default, so it would have let the adhan sound through DND for everyone without being asked.
 */
export const ANDROID_CATEGORY_REMINDER = 'reminder';

/**
 * `Notification.CATEGORY_STATUS` — the ongoing row and the mark confirmation (D146). Standing
 * information about where the day is, not an alert competing for attention.
 */
export const ANDROID_CATEGORY_STATUS = 'status';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Builds a {@link NotificationService} over an adapter.
 *
 * Every method serialises onto one internal queue: two overlapping `sync()` calls (a foreground
 * racing a settings change) would otherwise both read the same "currently scheduled" list and
 * both decide to schedule the same request. Callers therefore never need a lock of their own.
 *
 * @param adapter - Platform access; the app passes {@link createExpoNotificationAdapter}.
 * @param options - Content dependencies; see {@link NotificationServiceOptions}.
 * @returns A service whose methods never throw for expected failures.
 */
export function createNotificationService(
  adapter: NotificationAdapter,
  options: NotificationServiceOptions = {}
): NotificationService {
  const translate = options.translate ?? defaultTranslate;
  const formatClock = options.formatClock ?? defaultFormatClock;

  /** Serialises platform work; see the JSDoc above. */
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    // Keep the chain alive even when a link rejects, and never surface an unhandled rejection.
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function readPermission(): Promise<NotificationPermission> {
    try {
      return await adapter.getPermission();
    } catch {
      return UNKNOWN_PERMISSION;
    }
  }

  /** Creates the channels a set of `(kind, sound)` pairs needs. Android only. */
  async function ensureChannels(
    pairs: Iterable<readonly [NotificationKind, ReminderSound]>,
    voice: AdhanVoice
  ) {
    if (adapter.platform !== 'android') return 0;
    let failures = 0;
    for (const [kind, sound] of pairs) {
      try {
        await adapter.ensureChannel(channelSpecFor(kind, sound, voice, translate));
      } catch {
        failures += 1;
      }
    }
    return failures;
  }

  /**
   * Registers the two action categories the "Prayed" button needs (D92), in the current language.
   *
   * Runs on every sync rather than once at startup, and that is the point: a category is global
   * and replaceable, so re-registering it is how a language change reaches the buttons on
   * notifications that were scheduled days ago and cannot be rewritten.
   *
   * Skipped entirely when the build has no `modules/prayer-marks` — an older dev client, or a
   * platform without it. A button that queued nothing would be strictly worse than no button.
   *
   * @returns The number of platform calls that failed.
   */
  async function ensureMarkCategories(): Promise<number> {
    if (!prayerMarksSupported()) return 0;
    const categories: CategorySpec[] = [
      {
        id: ADHAN_CATEGORY_ID,
        actions: [
          { identifier: MARK_PRAYED_ACTION, title: translate('notifications.actions.prayed') },
        ],
      },
      {
        id: CONFIRMATION_CATEGORY_ID,
        actions: [{ identifier: MARK_UNDO_ACTION, title: translate('notifications.actions.undo') }],
      },
    ];
    let failures = 0;
    for (const category of categories) {
      try {
        await adapter.ensureCategory(category);
      } catch {
        failures += 1;
      }
    }
    return failures;
  }

  /**
   * Removes the adhan channels left behind by recitations the user has moved on from.
   *
   * This is the half of the voice selector that is easy to skip and impossible to notice missing:
   * without it a user accumulates a channel per voice they ever auditioned, all live, all named
   * almost the same, and the one they open in Android's settings is very likely not the one their
   * reminders use. It runs after {@link ensureChannels}, so the channel for the *current* voice
   * already exists and is never a candidate.
   *
   * One `listChannels` call per sync on Android, and zero deletes in the steady state.
   *
   * @param voice - The recitation currently chosen; everything else adhan-shaped goes.
   * @returns The number of platform calls that failed.
   */
  async function pruneStaleAdhanChannels(voice: AdhanVoice): Promise<number> {
    if (adapter.platform !== 'android') return 0;
    let existing: string[];
    try {
      existing = await adapter.listChannels();
    } catch {
      // Not knowing what exists is not a reason to delete anything. The stale rows stay; the
      // sound still changes, because the new voice's channel was created above.
      return 0;
    }

    let failures = 0;
    for (const id of existing) {
      if (!isStaleAdhanChannel(id, voice)) continue;
      try {
        await adapter.deleteChannel(id);
      } catch {
        failures += 1;
      }
    }
    return failures;
  }

  function emptyOutcome(status: SyncStatus, permission: NotificationPermission): SyncOutcome {
    return {
      status,
      planned: 0,
      scheduled: [],
      cancelled: [],
      unchanged: [],
      failures: 0,
      permission,
    };
  }

  /** The prayer's own start instant — the time a notification's copy quotes. */
  function prayerTimeFor(days: readonly DayTimes[], notification: PlannedNotification): Date {
    const dayTimes = days.find((entry) => entry.day === notification.day);
    const start = dayTimes?.times?.[notification.prayer];
    return start instanceof Date && !Number.isNaN(start.getTime()) ? start : notification.fireAt;
  }

  /**
   * The prayer after this one on the same day, and when it starts — the forward half of an
   * `expiry` body ("Next: Dhuhr · 12:59 pm"). Absent after Isha, and absent when the day's times
   * could not be resolved, in which case the copy falls back to the fact alone.
   */
  function nextPrayerFor(
    days: readonly DayTimes[],
    notification: PlannedNotification
  ): { prayer: Prayer; time: Date } | null {
    const index = PRAYERS.indexOf(notification.prayer);
    const next = index >= 0 ? PRAYERS[index + 1] : undefined;
    if (next === undefined) return null;
    const start = days.find((entry) => entry.day === notification.day)?.times?.[next];
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
    return { prayer: next, time: start };
  }

  /**
   * Takes out of the tray everything the user no longer needs to see — the app's only way to act
   * on "don't stack notifications", since neither platform can dismiss anything while the app is
   * closed (see {@link selectStaleDelivered}). Runs at the end of every sync, so a stale banner
   * survives at most until the app is next opened.
   *
   * @returns The number of platform calls that failed.
   */
  async function clearStaleDelivered(input: SyncInput): Promise<number> {
    let presented: ScheduledNotification[];
    try {
      presented = await adapter.getPresented();
    } catch {
      // An adapter that cannot read the tray simply leaves it alone; nothing else is affected.
      return 0;
    }

    const delivered: DeliveredNotification[] = [];
    for (const entry of presented) {
      const payload = entry.payload;
      // No payload means it is not ours — the ongoing notification, or another app's row on a
      // platform that reports them. We never dismiss what we did not post.
      if (payload === null) continue;
      delivered.push({
        key: payload.key,
        kind: payload.kind,
        prayer: payload.prayer,
        day: payload.day,
        fireAt: new Date(payload.fireAt),
      });
    }
    if (delivered.length === 0) return 0;

    let failures = 0;
    for (const key of selectStaleDelivered(delivered, {
      now: input.now,
      days: input.days,
      statuses: input.statuses,
      exemptDays: input.exemptDays,
      reminderKeptDays: input.reminderKeptDays,
    })) {
      try {
        await adapter.dismiss(key);
      } catch {
        failures += 1;
      }
    }
    return failures;
  }

  /**
   * The ongoing notification's title, body, button and press payload as they should read at `at`
   * — for the present redraw when `at` is now, and for the pre-scheduled swap when it is the next
   * transition. One composer, so the two can never disagree.
   *
   * What the notification is about, and what it reads, both belong to
   * `services/ongoingNotification` — see that module for why the body is approximate and how
   * often it is redrawn. The statuses go with it because the notification follows the log, not
   * only the clock (D83): while Dhuhr is in and unmarked it says so, and the moment it is marked
   * it moves on to Asr.
   *
   * While a prayer is due, it carries the same "I prayed" button as the adhan (D95) — plus,
   * pre-baked, the content it should show once that prayer is marked. The press is answered
   * natively with the app possibly gone, and Kotlin cannot build localized copy, so the
   * "Next: …" line has to travel with the notification itself.
   */
  function composeOngoing(
    input: SyncInput,
    at: Date
  ): { title: string; body: string; data: Record<string, unknown>; categoryId?: string; until: Date } | null {
    const state = selectOngoingState(input.days, at, {
      statuses: input.statuses,
      exemptDays: input.exemptDays,
    });
    if (state === null) return null;

    const contentDeps = {
      translate,
      formatClock,
      timeFormat: input.timeFormat,
      locale: input.locale,
    };
    const content = buildOngoingContent(state, at, contentDeps);

    let action: Record<string, unknown> = {};
    let categoryId: string | undefined;
    if (state.phase === 'due' && prayerMarksSupported()) {
      const afterState = selectOngoingState(input.days, at, {
        statuses: {
          ...input.statuses,
          [state.day]: { ...input.statuses[state.day], [state.prayer]: 'prayed' },
        },
        exemptDays: input.exemptDays,
      });
      const after = afterState === null ? null : buildOngoingContent(afterState, at, contentDeps);
      categoryId = ADHAN_CATEGORY_ID;
      action = {
        prayer: state.prayer,
        day: state.day,
        [MARK_ONGOING_FIELD]: true,
        [MARK_CHANNEL_FIELD]: ONGOING_CHANNEL_ID,
        // Absent at the far end of the planned window; the native side then simply takes the
        // notification down, and the next foreground redraws whatever is true by then.
        ...(after === null
          ? {}
          : { [MARK_AFTER_TITLE_FIELD]: after.title, [MARK_AFTER_BODY_FIELD]: after.body }),
      };
    }

    return {
      title: content.title,
      body: content.body,
      data: { url: TODAY_ROUTE, androidCategory: ANDROID_CATEGORY_STATUS, ...action },
      ...(categoryId === undefined ? {} : { categoryId }),
      until: state.until,
    };
  }

  /**
   * The Android ongoing notification: present it (and pre-schedule its next redraw), or take both
   * down.
   *
   * The pre-scheduled half is what makes the settings screen's "redrawn when a prayer begins"
   * true with the app asleep: content only ever changed on a JS redraw, so a phone left in a
   * pocket kept showing "Next: Maghrib" — button-less — long into Maghrib's own window, which is
   * exactly when the button matters (owner report, 2026-08-25). Now every sync also schedules ONE
   * DATE-triggered re-post under the same identifier, carrying the content composed FOR the next
   * transition instant; the OS swaps the sticky notification then, no process needed. One step
   * only, by design — each fired swap is a step the next sync (foreground, a reminder landing, a
   * log) rebuilds from — the same one-step honesty D95 already accepts for the press path.
   */
  async function applyOngoing(input: SyncInput, held: readonly ScheduledNotification[]): Promise<number> {
    if (adapter.platform !== 'android') return 0;
    // Whether the OS is already holding a pre-scheduled swap — consulted so a cancel is only ever
    // issued against a request that exists, keeping the steady state free of no-op platform calls.
    const swapHeld = held.some((entry) => entry.identifier === ONGOING_NOTIFICATION_ID);
    if (input.persistentNotification !== true) {
      let failures = 0;
      try {
        // Dismissal for the presented one; the cancel reaches the pre-scheduled swap, which IS a
        // pending request (unlike the presented notification, which never was).
        await adapter.dismiss(ONGOING_NOTIFICATION_ID);
      } catch {
        failures += 1;
      }
      if (swapHeld) {
        try {
          await adapter.cancel(ONGOING_NOTIFICATION_ID);
        } catch {
          failures += 1;
        }
      }
      return failures;
    }

    const current = composeOngoing(input, input.now);
    if (current === null) return 0;

    let failures = 0;
    try {
      await adapter.ensureChannel(ongoingChannelSpec(translate));
      await adapter.present({
        identifier: ONGOING_NOTIFICATION_ID,
        title: current.title,
        body: current.body,
        data: current.data,
        sound: null,
        channelId: ONGOING_CHANNEL_ID,
        ongoing: true,
        ...(current.categoryId === undefined ? {} : { categoryId: current.categoryId }),
      });
    } catch {
      return 1;
    }

    // The swap: whatever should be on screen the moment the current content stops being true —
    // nudged past the boundary so it draws the far side, exactly like `nextOngoingRefreshAt`.
    const transition = new Date(current.until.getTime() + ONGOING_REFRESH_GRACE_MS);
    const future = composeOngoing(input, transition);
    try {
      // Cancel-then-schedule under one identifier, the same discipline the reminder loop uses —
      // but only when the OS actually holds one, so the steady state costs no extra calls.
      if (swapHeld) await adapter.cancel(ONGOING_NOTIFICATION_ID);
      if (future !== null) {
        const data: OngoingSwapData = {
          ...future.data,
          url: TODAY_ROUTE,
          fireAt: transition.getTime(),
        };
        await adapter.schedule({
          identifier: ONGOING_NOTIFICATION_ID,
          title: future.title,
          body: future.body,
          data,
          sound: null,
          channelId: ONGOING_CHANNEL_ID,
          ongoing: true,
          ...(future.categoryId === undefined ? {} : { categoryId: future.categoryId }),
          fireAt: transition,
        });
      }
    } catch {
      failures += 1;
    }
    return failures;
  }

  async function runSync(input: SyncInput): Promise<SyncOutcome> {
    if (adapter.platform === 'other') {
      return emptyOutcome('unsupported', UNKNOWN_PERMISSION);
    }

    const permission = await readPermission();
    if (!permission.granted) {
      // Nothing is cancelled: a permission that comes back later should find its schedule intact.
      return emptyOutcome('permissionDenied', permission);
    }

    // The tray sweep goes FIRST. It depends on nothing below — only on `input` — and it used to be
    // the last statement of this function, behind every early return: a plan that failed to build,
    // or an OS that would not list its schedule, silently left the tray untouched as a side effect
    // (D165). On iOS this sweep is the only thing that ever clears a delivered row, so it must be
    // the one part of a sync that cannot be skipped.
    const sweepFailures = await clearStaleDelivered(input);

    let desired: PlannedNotification[];
    try {
      desired = planNotifications({
        now: input.now,
        days: input.days,
        reminders: input.reminders,
        statuses: input.statuses,
        exemptDays: input.exemptDays,
      reminderKeptDays: input.reminderKeptDays,
        ishaNudgeTimes: input.ishaNudgeTimes,
        sunriseNoteEnabled: input.sunriseNoteEnabled === true,
        maxCount: input.maxCount ?? DEFAULT_MAX_NOTIFICATIONS,
        nudgeLeadMinutes: input.nudgeLeadMinutes ?? DEFAULT_NUDGE_LEAD_MINUTES,
        // While the always-on notification is up (Android only), the adhan's tray row turns
        // redundant once read — the ongoing row states the same fact for the whole window — so
        // the plan retires it early and the dismissal alarm follows `expiresAt` as ever (D88).
        // Threading this through the plan (not a schedule-time override) keeps `isStale` honest:
        // flipping the toggle rewrites the held adhans exactly once.
        adhanExpiresAfterMinutes:
          input.persistentNotification === true && adapter.platform === 'android'
            ? DEFAULT_ADHAN_LINGER_MINUTES
            : undefined,
      });
    } catch {
      // A malformed day list is a programming error upstream; refusing to touch the OS is the
      // safe response — the existing schedule stays exactly as it is. (The tray was still swept.)
      return { ...emptyOutcome('applied', permission), failures: sweepFailures };
    }

    const voice = input.adhanVoice ?? DEFAULT_ADHAN_VOICE;
    let failures = sweepFailures;
    failures += await ensureChannels(
      new Map(
        desired.map((entry) => [`${entry.kind}-${entry.sound}`, [entry.kind, entry.sound] as const])
      ).values(),
      voice
    );
    failures += await pruneStaleAdhanChannels(voice);
    failures += await ensureMarkCategories();

    let held: ScheduledNotification[];
    try {
      held = await adapter.getScheduled();
    } catch {
      // Without ground truth a diff is meaningless, and scheduling blind would duplicate.
      return {
        ...emptyOutcome('applied', permission),
        planned: desired.length,
        failures: failures + 1,
      };
    }

    const desiredByKey = new Map(desired.map((entry) => [entry.key, entry]));
    const ours = held.filter((entry) => entry.payload !== null);

    // Held-and-wanted, but no longer what we would schedule today: the times moved, the sound
    // changed, or the app language changed — none of which touch the key (see the module header).
    // These must be cancelled before they are re-scheduled.
    const lang = input.locale ?? '';
    // The pause flag every adhan request should carry right now (D96). One computation, consulted
    // by both the staleness check and the scheduling loop, exactly like `actionCategoryFor`.
    const pauseAudio = input.pauseAudioAtAdhan === true && audioPauseSupported();
    // The Android category every reminder should carry right now (D146), computed once for the
    // same reason as `pauseAudio`: the staleness check and the scheduling loop have to agree, or
    // every held reminder rebuilds on every sync forever. `undefined` off Android, where the
    // field means nothing and stamping one would churn the whole schedule for no gain.
    const androidCategory =
      adapter.platform === 'android' ? ANDROID_CATEGORY_REMINDER : undefined;
    const drifted = new Set<string>();
    const intact: string[] = [];
    for (const entry of ours) {
      const key = entry.payload?.key ?? entry.identifier;
      const wanted = desiredByKey.get(key);
      if (wanted === undefined) {
        intact.push(key); // Not wanted at all — diffPlans will put it in `toCancel`.
        continue;
      }
      if (
        isStale(
          entry,
          wanted,
          lang,
          voice,
          actionCategoryFor(wanted.kind),
          wanted.kind === 'adhan' && pauseAudio,
          androidCategory
        )
      ) {
        drifted.add(key);
        continue;
      }
      intact.push(key);
    }

    // Only the intact keys are declared "already scheduled", so a stale one lands in
    // `toSchedule` on its own; `drifted` is added to the cancels so the identifier is free again.
    const diff = diffPlans(desired, intact);
    const toCancel = [...diff.toCancel, ...drifted];
    const toSchedule = diff.toSchedule;

    // Cancel first: on a drifted key the two operations touch the same identifier, and "replace"
    // is not a behaviour either platform documents.
    const cancelled: string[] = [];
    for (const identifier of toCancel) {
      try {
        await adapter.cancel(identifier);
        cancelled.push(identifier);
      } catch {
        failures += 1;
      }
    }

    const scheduled: string[] = [];
    for (const notification of toSchedule) {
      const next = notification.kind === 'expiry' ? nextPrayerFor(input.days, notification) : null;
      const content = buildContent(notification, {
        translate,
        formatClock,
        prayerTime: prayerTimeFor(input.days, notification),
        timeFormat: input.timeFormat,
        // The deadline the last call quotes. Asked of `domain/windows` rather than read off
        // `notification.expiresAt`, which happens to hold the same instant for a nudge but means
        // something else — when the notification stops being worth reading, not when the prayer
        // runs out. Two facts that coincide are still two facts.
        windowEnd: windowEndFor(input.days, notification.day, notification.prayer),
        nextPrayer: next?.prayer,
        nextPrayerTime: next?.time,
      });
      const category = actionCategoryFor(notification.kind);
      try {
        await adapter.schedule({
          identifier: notification.key,
          title: content.title,
          body: content.body,
          data: {
            key: notification.key,
            kind: notification.kind,
            prayer: notification.prayer,
            day: notification.day,
            fireAt: notification.fireAt.getTime(),
            sound: notification.sound,
            voice,
            lang,
            url: TODAY_ROUTE,
            // Read natively on Android, where it becomes the notification's own self-destruct
            // (D88). Omitted rather than sent as `undefined`: the value crosses the bridge into a
            // JSON payload, and a key that is present-but-null would have to be handled twice.
            ...(notification.expiresAt === undefined
              ? {}
              : { expiresAt: notification.expiresAt.getTime() }),
            // Recorded in the payload as well as on the request, so `isStale` can tell an adhan
            // scheduled with the button from one an older build scheduled without it.
            ...(category === undefined ? {} : { category }),
            // The adapter arms the pause alarm off this flag, and `isStale` reads it back (D96).
            ...(notification.kind === 'adhan' && pauseAudio ? { pauseAudio: true } : {}),
            // Read by the patched `ExpoNotificationBuilder` and stamped onto the Android
            // notification itself (D146). Omitted off Android for the reason above.
            ...(androidCategory === undefined ? {} : { androidCategory }),
          },
          sound: soundValue(notification.sound, voice, adapter.platform),
          channelId: channelIdFor(notification.kind, notification.sound, voice),
          // The "Prayed" button, on the adhan and nowhere else (D92). The pre-reminder arrives
          // before the prayer's time, so the button would be an invitation to claim a prayer that
          // cannot have happened yet; the last call and the sunrise note are deliberately quieter
          // things than the moment the time comes in.
          ...(category === undefined ? {} : { categoryId: category }),
          // iOS only, and the difference between a reminder arriving at the prayer time and one
          // arriving whenever the phone's next Scheduled Summary happens to be. See
          // `ScheduleRequest.interruptionLevel`: the sunrise note stays out of the way, everything
          // that is meant to interrupt says so.
          interruptionLevel: SILENT_KINDS.has(notification.kind) ? 'passive' : 'timeSensitive',
          fireAt: notification.fireAt,
        });
        scheduled.push(notification.key);
      } catch {
        failures += 1;
      }
    }

    failures += await applyOngoing(input, held);

    const scheduledSet = new Set(scheduled);
    return {
      status: 'applied',
      planned: desired.length,
      scheduled,
      cancelled,
      unchanged: desired.filter((entry) => !scheduledSet.has(entry.key)).map((entry) => entry.key),
      failures,
      permission,
    };
  }

  return {
    getPermission: () => enqueue(readPermission),

    requestPermission: () =>
      enqueue(async () => {
        // Android 13+ shows no POST_NOTIFICATIONS prompt until the app owns a channel, so the
        // one channel every configuration needs is created first. It is the device-sound one, so
        // no recitation is involved.
        await ensureChannels([['adhan', 'system'] as const], DEFAULT_ADHAN_VOICE);
        try {
          return await adapter.requestPermission();
        } catch {
          return UNKNOWN_PERMISSION;
        }
      }),

    sync: (input) => enqueue(() => runSync(input)),

    clearForPrayer: (day, prayer) =>
      enqueue(async () => {
        let ok = true;
        // The two phases that exist only while the prayer is unlogged. The adhan and the
        // pre-reminder are deliberately not cancelled: they are about the time arriving, and by
        // the point anything is logged they have already fired anyway.
        for (const kind of ['nudge', 'expiry'] as const) {
          try {
            await adapter.cancel(notificationKey(kind, day, prayer));
          } catch {
            ok = false;
          }
        }
        // And whatever this prayer already put in the tray. Every phase is dismissed, including
        // the adhan: the user has just said they prayed, so none of it is still an ask.
        for (const kind of NOTIFICATION_KINDS) {
          try {
            await adapter.dismiss(notificationKey(kind, day, prayer));
          } catch {
            ok = false;
          }
        }
        return ok;
      }),

    checkDelivery: ({
      sound = 'system',
      voice = DEFAULT_ADHAN_VOICE,
    }: { sound?: ReminderSound; voice?: AdhanVoice } = {}) =>
      enqueue(async () => {
        const permission = await readPermission();
        let channel: { importance: ChannelImportance; sound: string | null } | null = null;
        try {
          channel = await adapter.getChannel(channelIdFor('adhan', sound, voice));
        } catch {
          // An unreadable channel is not knowledge either way; the classifier treats it as unknown.
        }
        return describeDelivery(permission, channel);
      }),

    listScheduled: () =>
      enqueue(async () => {
        try {
          return await adapter.getScheduled();
        } catch {
          return [];
        }
      }),

    sendTestNotification: ({
      sound = 'system',
      voice = DEFAULT_ADHAN_VOICE,
    }: { sound?: ReminderSound; voice?: AdhanVoice } = {}) =>
      enqueue(async () => {
        try {
          await ensureChannels([['adhan', sound] as const], voice);
          await adapter.present({
            identifier: TEST_NOTIFICATION_ID,
            title: translate('notifications.test.title'),
            body: translate('notifications.test.body'),
            // The sound rides along in `data` so the foreground handler can honour a `silent`
            // choice: the test is pressed from inside the app, so it is always presented through
            // {@link foregroundPresentation}. The test flag is what makes the Prayed button below
            // a dress rehearsal: the native handler clears the notification and posts the
            // confirmation, and records nothing.
            // `androidCategory` makes the dress rehearsal honest on Android too: the test
            // notification declares itself exactly as a real reminder does (D146). Inert on iOS.
            data: {
              url: TODAY_ROUTE,
              sound,
              test: true,
              androidCategory: ANDROID_CATEGORY_REMINDER,
            },
            sound: soundValue(sound, voice, adapter.platform),
            channelId: channelIdFor('adhan', sound, voice),
            // The same button a real adhan carries, where the build can answer it — pressing a
            // test must prove the loop, not just the delivery.
            ...(prayerMarksSupported() ? { categoryId: ADHAN_CATEGORY_ID } : {}),
            // And the same iOS delivery level, for the same reason: someone pressing this is
            // asking "will the adhan reach me", and a test that a Focus mode holds while the real
            // adhan breaks through would answer the wrong question.
            interruptionLevel: 'timeSensitive',
          });
          return true;
        } catch {
          return false;
        }
      }),

    observeTaps: (listener) => {
      let live = true;
      let unsubscribe: () => void;
      try {
        unsubscribe = adapter.addResponseListener((event) => {
          if (live) listener(event);
        });
      } catch {
        unsubscribe = () => undefined;
      }

      // The cold-start case: the app was launched *by* a tap, so there is a response waiting
      // before any listener could exist.
      void (async () => {
        try {
          const last = await adapter.getLastResponse();
          if (live && last !== null) listener(last);
        } catch {
          // A missing launch response is the normal case, not a failure.
        }
      })();

      return () => {
        live = false;
        try {
          unsubscribe();
        } catch {
          // Nothing to do — the subscription is already gone.
        }
      };
    },

    observeReceived: (listener) => {
      let live = true;
      let unsubscribe: () => void;
      try {
        unsubscribe = adapter.addReceivedListener((event) => {
          // Only our own scheduled reminders. See the interface docs for why the ongoing
          // notification must never reach the caller.
          if (!live || event.payload === null) return;
          listener({ payload: event.payload });
        });
      } catch {
        unsubscribe = () => undefined;
      }

      return () => {
        live = false;
        try {
          unsubscribe();
        } catch {
          // Nothing to do — the subscription is already gone.
        }
      };
    },

    cancelAll: () =>
      enqueue(async () => {
        let held: ScheduledNotification[];
        try {
          held = await adapter.getScheduled();
        } catch {
          return;
        }
        for (const entry of held) {
          if (entry.payload === null) continue;
          try {
            await adapter.cancel(entry.identifier);
          } catch {
            // One stubborn identifier must not abort the rest.
          }
        }
      }),
  };
}

// ---------------------------------------------------------------------------
// expo-notifications adapter
// ---------------------------------------------------------------------------

type ExpoNotificationsModule = typeof import('expo-notifications');

/** Maps our importance names onto the platform enum, without importing it at module scope. */
function androidImportance(
  importance: ChannelImportance,
  AndroidImportance: ExpoNotificationsModule['AndroidImportance']
): number {
  if (importance === 'high') return AndroidImportance.HIGH;
  if (importance === 'low') return AndroidImportance.LOW;
  return AndroidImportance.DEFAULT;
}

/** Android's `NotificationManager.getCurrentInterruptionFilter()` constants. */
const INTERRUPTION_FILTERS: Record<number, NotificationDelivery['interruptionFilter']> = {
  1: 'all',
  2: 'priority',
  3: 'none',
  4: 'alarms',
};

/**
 * `NotificationManagerCompat.getImportance()`: `IMPORTANCE_NONE` 0 … `IMPORTANCE_HIGH` 4.
 * Anything below `DEFAULT` (3) makes no sound. `UNSPECIFIED` (-1000) means the OS did not say.
 */
function androidSoundEnabled(importance: unknown): boolean | null {
  if (typeof importance !== 'number' || !Number.isFinite(importance)) return null;
  if (importance < 0) return null;
  return importance >= 3;
}

function toPermission(response: {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  ios?: { status?: number; allowsSound?: boolean | null; allowsAlert?: boolean | null } | null;
  android?: { importance?: number; interruptionFilter?: number } | null;
}): NotificationPermission {
  const status: NotificationPermissionStatus =
    response.status === 'granted'
      ? 'granted'
      : response.status === 'denied'
        ? 'denied'
        : 'undetermined';
  // iOS "provisional" authorisation reports `granted: false` at the root while quietly allowing
  // notifications; expo surfaces it as `granted` only through the ios sub-object.
  const provisional = response.ios?.status === 3;

  const ios = response.ios ?? null;
  const android = response.android ?? null;
  const delivery: NotificationDelivery = {
    // `undefined` and `null` both mean "not reported"; only an explicit boolean is knowledge.
    soundEnabled:
      typeof ios?.allowsSound === 'boolean'
        ? ios.allowsSound
        : androidSoundEnabled(android?.importance),
    alertsEnabled: typeof ios?.allowsAlert === 'boolean' ? ios.allowsAlert : null,
    interruptionFilter:
      typeof android?.interruptionFilter === 'number'
        ? (INTERRUPTION_FILTERS[android.interruptionFilter] ?? null)
        : null,
  };

  return {
    status: provisional ? 'granted' : status,
    granted: response.granted === true || status === 'granted' || provisional,
    canAskAgain: response.canAskAgain !== false,
    delivery,
  };
}

/**
 * What `expo-notifications` calls a plain tap on the notification body, as opposed to a press on
 * one of its action buttons.
 *
 * Copied rather than imported: the module is `require`d lazily so that importing this file stays
 * safe under Jest, and a string constant is not worth breaking that for. iOS's own
 * `UNNotificationDefaultActionIdentifier` is normalised to this same value by the library.
 */
const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

/** Whether a response is a tap on the notification itself. */
function isDefaultAction(actionIdentifier: string | undefined): boolean {
  // Absent on anything an older build delivered, which predates action buttons entirely and can
  // therefore only be a tap.
  return actionIdentifier === undefined || actionIdentifier === DEFAULT_ACTION_IDENTIFIER;
}

/**
 * The real adapter, over `expo-notifications`.
 *
 * The native modules (`expo-notifications`, `react-native`) are `require`d lazily on first use —
 * the same trick `services/location.ts` uses — so importing this file stays safe under Jest and
 * in node scripts.
 *
 * @returns A {@link NotificationAdapter} bound to the device.
 */
export function createExpoNotificationAdapter(): NotificationAdapter {
  let module: ExpoNotificationsModule | null = null;
  /** The foreground handler is global to the process, so it is installed exactly once. */
  let handlerInstalled = false;
  const load = (): ExpoNotificationsModule => {
    if (module === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      module = require('expo-notifications') as ExpoNotificationsModule;
    }
    // Installed here rather than at module scope because that would `require` the native module
    // eagerly and break plain Jest runs — and here is early enough by construction: every path
    // that can reach a notification (scheduling, presenting, the tap listener the root layout
    // subscribes on mount) comes through `load()` first. It decides how every foreground
    // notification is presented; see {@link foregroundPresentation}.
    if (!handlerInstalled) {
      handlerInstalled = true;
      try {
        module.setNotificationHandler({
          handleNotification: async (notification) =>
            foregroundPresentation({
              identifier: notification.request.identifier,
              data: notification.request.content.data,
            }),
        });
      } catch {
        // A platform without a notification handler is a platform without notifications; the
        // rest of the adapter already degrades rather than throwing.
        handlerInstalled = false;
      }
    }
    return module;
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const platformOS = (require('react-native') as typeof import('react-native')).Platform.OS;
  const platform: NotificationAdapter['platform'] =
    platformOS === 'ios' ? 'ios' : platformOS === 'android' ? 'android' : 'other';

  return {
    platform,

    async getPermission() {
      return toPermission(await load().getPermissionsAsync());
    },

    async requestPermission() {
      return toPermission(
        await load().requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: false, allowSound: true },
        })
      );
    },

    async getScheduled() {
      const requests = await load().getAllScheduledNotificationsAsync();
      return requests.map((request) => {
        const payload = parsePayload(request.content?.data);
        return {
          identifier: request.identifier,
          fireAt: payload === null ? null : new Date(payload.fireAt),
          payload,
          title: request.content?.title ?? null,
          body: request.content?.body ?? null,
        };
      });
    },

    async getPresented() {
      const delivered = await load().getPresentedNotificationsAsync();
      return delivered.map((notification) => {
        const request = notification.request;
        const payload = parsePayload(request.content?.data);
        return {
          identifier: request.identifier,
          fireAt: payload === null ? null : new Date(payload.fireAt),
          payload,
          title: request.content?.title ?? null,
          body: request.content?.body ?? null,
        };
      });
    },

    async schedule(request) {
      const Notifications = load();
      await Notifications.scheduleNotificationAsync({
        identifier: request.identifier,
        content: {
          title: request.title,
          body: request.body,
          data: { ...request.data },
          // `false` is expo's "silent"; a bare filename is resolved from the bundled sounds.
          sound: request.sound === null ? false : request.sound,
          ...(request.ongoing === true ? { sticky: true, autoDismiss: false } : {}),
          ...(request.categoryId === undefined ? {} : { categoryIdentifier: request.categoryId }),
          // iOS only, and it has to be forwarded here or it reaches nothing: the level is computed
          // per notification but the OS only ever sees what this object carries. Ignored on
          // Android, where importance belongs to the channel.
          ...(request.interruptionLevel === undefined
            ? {}
            : { interruptionLevel: request.interruptionLevel }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: request.fireAt,
          ...(request.channelId === undefined ? {} : { channelId: request.channelId }),
        },
      });
      // Second, and only after the request itself exists: the alarm that takes it back out of the
      // tray when its window closes. A no-op on iOS and on any build without the native module.
      if (request.data.expiresAt !== undefined) {
        await scheduleDismissal(request.identifier, request.data.expiresAt);
      }
      // And, when asked for, the alarm that pauses whatever is playing at the reminder's own fire
      // instant (D96). Same no-op rules as the dismissal.
      if (request.data.pauseAudio === true) {
        await schedulePause(request.identifier, request.data.fireAt);
      }
    },

    async cancel(identifier) {
      await load().cancelScheduledNotificationAsync(identifier);
      await cancelDismissal(identifier);
      await cancelPause(identifier);
    },

    async present(request) {
      await load().scheduleNotificationAsync({
        identifier: request.identifier,
        content: {
          title: request.title,
          body: request.body,
          data: { ...request.data },
          sound: request.sound === null ? false : request.sound,
          ...(request.ongoing === true ? { sticky: true, autoDismiss: false } : {}),
          ...(request.categoryId === undefined ? {} : { categoryIdentifier: request.categoryId }),
          // Same reason as in `schedule` above: computed elsewhere, delivered only from here.
          ...(request.interruptionLevel === undefined
            ? {}
            : { interruptionLevel: request.interruptionLevel }),
        },
        trigger: request.channelId === undefined ? null : { channelId: request.channelId },
      });
    },

    async dismiss(identifier) {
      // Dismissal only — it must not also cancel the pending request under the same identifier.
      // `clearForPrayer` dismisses every phase of a logged prayer, and some of those phases may
      // still be *scheduled* rather than delivered (a prayer logged from History before its own
      // adhan has fired). Cancelling them there would silence a reminder the user never turned
      // off. Callers that want both do both — see `applyOngoing`.
      await load().dismissNotificationAsync(identifier);
      // The armed dismissal deliberately STAYS. `clearForPrayer` dismisses phases whose requests
      // are still pending — a prayer logged from History at 3am dismisses a Fajr adhan that has not
      // fired yet — and disarming here would leave that reminder, once it does fire, with nothing
      // to take it back out of the tray. An alarm for a notification that is already gone cancels
      // a tag that is not there, which costs nothing.
    },

    addResponseListener(listener) {
      const subscription = load().addNotificationResponseReceivedListener((response) => {
        // An action button is not a tap. Pressing "Prayed" is answered natively and must leave the
        // user exactly where they were (D92) — routing them to Today because the app happened to
        // be running would make the button behave differently depending on whether it was open.
        if (!isDefaultAction(response.actionIdentifier)) return;
        const data = response.notification.request.content.data as Record<string, unknown> | null;
        const url = typeof data?.url === 'string' ? data.url : TODAY_ROUTE;
        listener({ url, payload: parsePayload(data) });
      });
      return () => subscription.remove();
    },

    addReceivedListener(listener) {
      const subscription = load().addNotificationReceivedListener((notification) => {
        listener({ payload: parsePayload(notification.request.content.data) });
      });
      return () => subscription.remove();
    },

    async getLastResponse() {
      const response = await load().getLastNotificationResponseAsync();
      if (response === null || response === undefined) return null;
      // Same rule as the live listener: only a real tap opens a screen. iOS replays the response
      // that launched the app here, and an action press can be that response.
      if (!isDefaultAction(response.actionIdentifier)) return null;
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      return {
        url: typeof data?.url === 'string' ? data.url : TODAY_ROUTE,
        payload: parsePayload(data),
      };
    },

    async getChannel(id) {
      if (platform !== 'android') return null;
      const Notifications = load();
      const channel = await Notifications.getNotificationChannelAsync(id);
      if (channel === null || channel === undefined) return null;
      const importance = channel.importance;
      return {
        // Android's AndroidImportance: NONE 0 · MIN 1 · LOW 2 · DEFAULT 3 · HIGH 4 · MAX 5.
        importance: importance >= 4 ? 'high' : importance >= 3 ? 'default' : 'low',
        sound: channel.sound === null || channel.sound === undefined ? null : String(channel.sound),
      };
    },

    async ensureChannel(channel) {
      if (platform !== 'android') return;
      const Notifications = load();
      await Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        description: channel.description,
        importance: androidImportance(channel.importance, Notifications.AndroidImportance),
        sound: channel.sound,
        enableVibrate: channel.vibrate,
        showBadge: channel.showBadge,
      });
    },

    async listChannels() {
      if (platform !== 'android') return [];
      const channels = await load().getNotificationChannelsAsync();
      return (channels ?? []).map((channel) => channel.id);
    },

    async deleteChannel(id) {
      if (platform !== 'android') return;
      await load().deleteNotificationChannelAsync(id);
    },

    async ensureCategory(category) {
      if (platform === 'other') return;
      await load().setNotificationCategoryAsync(
        category.id,
        category.actions.map((action) => ({
          identifier: action.identifier,
          buttonTitle: action.title,
          // The whole design rests on this being `false`: the press is answered natively, the app
          // is never opened, and the user stays where they were (D92). `true` would launch the app
          // and put the reward loop's own screen between them and a button that meant "done".
          options: { opensAppToForeground: false },
        }))
      );
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests, and any platform without notifications)
// ---------------------------------------------------------------------------

/** Scripted behaviour for {@link createFakeNotificationAdapter}; mutable on the returned adapter. */
export interface FakeNotificationConfig {
  platform?: NotificationAdapter['platform'];
  permission?: Partial<NotificationPermission>;
  /** What {@link NotificationAdapter.requestPermission} answers; defaults to `permission`. */
  permissionAfterRequest?: Partial<NotificationPermission>;
  /** Method names that should reject, to exercise the failure paths. */
  failing?: Set<keyof NotificationAdapter>;
  /** The tap that "launched the app", replayed by {@link NotificationService.observeTaps}. */
  lastResponse?: NotificationTapEvent | null;
}

/** A {@link NotificationAdapter} backed by a Map, plus call counters. */
export interface FakeNotificationAdapter extends NotificationAdapter {
  config: FakeNotificationConfig;
  /** Everything "scheduled", keyed by identifier. */
  readonly scheduled: Map<string, ScheduleRequest>;
  /** Everything "presented" right now, keyed by identifier. */
  readonly presented: Map<string, PresentRequest>;
  /** Channels created so far, keyed by id — a real Android would refuse to change these. */
  readonly channels: Map<string, ChannelSpec>;
  /** Action categories registered so far, keyed by id. Re-registering replaces, as it does live. */
  readonly categories: Map<string, CategorySpec>;
  /**
   * Self-dismissals currently armed, identifier → epoch ms, mirroring what
   * `modules/notification-dismissal` would be holding on Android. Only ever populated when the
   * fake platform is `android`, because that is the only platform where the module exists.
   */
  readonly dismissals: Map<string, number>;
  /** Delivers a tap to every live listener, as the OS would. */
  emitTap(event: NotificationTapEvent): void;
  /** Delivers an arriving notification to every live listener, as the OS would. */
  emitReceived(event: { payload: NotificationPayload | null }): void;
  calls: Record<
    | 'getPermission'
    | 'requestPermission'
    | 'getScheduled'
    | 'getPresented'
    | 'schedule'
    | 'cancel'
    | 'present'
    | 'dismiss'
    | 'ensureChannel'
    | 'ensureCategory'
    | 'listChannels'
    | 'deleteChannel'
    | 'addResponseListener'
    | 'addReceivedListener',
    number
  >;
}

const DEFAULT_FAKE_PERMISSION: NotificationPermission = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
};

/**
 * Builds an in-memory {@link NotificationAdapter} — the test double for the whole notification
 * layer, and a usable stand-in on platforms with no notification support.
 *
 * It is exported from the production module for the same reason `createFakeLocationAdapter` is:
 * the seam has to be reachable without importing a test file.
 *
 * @param config - Initial scripted behaviour; mutable afterwards via `adapter.config`.
 * @returns A fake adapter with call counters and inspectable state.
 */
export function createFakeNotificationAdapter(
  config: FakeNotificationConfig = {}
): FakeNotificationAdapter {
  const scheduled = new Map<string, ScheduleRequest>();
  const presented = new Map<string, PresentRequest>();
  const channels = new Map<string, ChannelSpec>();
  const categories = new Map<string, CategorySpec>();
  const dismissals = new Map<string, number>();
  const listeners = new Set<(event: NotificationTapEvent) => void>();
  const receivedListeners = new Set<(event: { payload: NotificationPayload | null }) => void>();

  const adapter: FakeNotificationAdapter = {
    config: { ...config },
    scheduled,
    presented,
    channels,
    categories,
    dismissals,
    emitTap(event) {
      for (const listener of listeners) listener(event);
    },
    emitReceived(event) {
      for (const listener of receivedListeners) listener(event);
    },
    calls: {
      getPermission: 0,
      requestPermission: 0,
      getScheduled: 0,
      getPresented: 0,
      schedule: 0,
      cancel: 0,
      present: 0,
      dismiss: 0,
      ensureChannel: 0,
      ensureCategory: 0,
      listChannels: 0,
      deleteChannel: 0,
      addResponseListener: 0,
      addReceivedListener: 0,
    },
    get platform() {
      return adapter.config.platform ?? 'android';
    },

    async getPermission() {
      adapter.calls.getPermission += 1;
      fail('getPermission');
      return { ...DEFAULT_FAKE_PERMISSION, ...adapter.config.permission };
    },

    async requestPermission() {
      adapter.calls.requestPermission += 1;
      fail('requestPermission');
      return {
        ...DEFAULT_FAKE_PERMISSION,
        ...(adapter.config.permissionAfterRequest ?? adapter.config.permission),
      };
    },

    async getScheduled() {
      adapter.calls.getScheduled += 1;
      fail('getScheduled');
      return [...scheduled.values()].map((request) => ({
        identifier: request.identifier,
        fireAt: new Date(request.data.fireAt),
        payload: parsePayload(request.data),
        title: request.title,
        body: request.body,
      }));
    },

    async getPresented() {
      adapter.calls.getPresented += 1;
      fail('getPresented');
      return [...presented.values()].map((request) => {
        const payload = parsePayload(request.data);
        return {
          identifier: request.identifier,
          fireAt: payload === null ? null : new Date(payload.fireAt),
          payload,
          title: request.title,
          body: request.body,
        };
      });
    },

    async schedule(request) {
      adapter.calls.schedule += 1;
      fail('schedule');
      scheduled.set(request.identifier, request);
      // Mirrors `createExpoNotificationAdapter`: a request carrying an expiry arms its own
      // dismissal, and only Android has the module that can honour one.
      if (request.data.expiresAt !== undefined && adapter.platform === 'android') {
        dismissals.set(request.identifier, request.data.expiresAt);
      }
    },

    async cancel(identifier) {
      adapter.calls.cancel += 1;
      fail('cancel');
      scheduled.delete(identifier);
      dismissals.delete(identifier);
    },

    async present(request) {
      adapter.calls.present += 1;
      fail('present');
      presented.set(request.identifier, request);
    },

    async dismiss(identifier) {
      adapter.calls.dismiss += 1;
      fail('dismiss');
      presented.delete(identifier);
    },

    addResponseListener(listener) {
      adapter.calls.addResponseListener += 1;
      fail('addResponseListener');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addReceivedListener(listener) {
      adapter.calls.addReceivedListener += 1;
      fail('addReceivedListener');
      receivedListeners.add(listener);
      return () => receivedListeners.delete(listener);
    },

    async getLastResponse() {
      fail('getLastResponse');
      return adapter.config.lastResponse ?? null;
    },

    async getChannel(id) {
      fail('getChannel');
      if (adapter.platform !== 'android') return null;
      const channel = channels.get(id);
      return channel === undefined
        ? null
        : { importance: channel.importance, sound: channel.sound };
    },

    async listChannels() {
      adapter.calls.listChannels += 1;
      fail('listChannels');
      if (adapter.platform !== 'android') return [];
      return [...channels.keys()];
    },

    async deleteChannel(id) {
      adapter.calls.deleteChannel += 1;
      fail('deleteChannel');
      if (adapter.platform !== 'android') return;
      channels.delete(id);
    },

    async ensureChannel(channel) {
      adapter.calls.ensureChannel += 1;
      fail('ensureChannel');
      const existing = channels.get(channel.id);
      // Android only lets the name and description change after creation; the fake enforces that
      // so a test can never "prove" a sound change that the real platform would ignore.
      channels.set(
        channel.id,
        existing === undefined
          ? channel
          : { ...existing, name: channel.name, description: channel.description }
      );
    },

    async ensureCategory(category) {
      adapter.calls.ensureCategory += 1;
      fail('ensureCategory');
      // Unlike a channel, a category is genuinely replaceable on both platforms — which is what
      // makes re-registering it the way a language change reaches buttons already on screen.
      categories.set(category.id, category);
    },
  };

  function fail(method: keyof NotificationAdapter): void {
    if (adapter.config.failing?.has(method) === true) {
      throw new Error(`fake adapter: ${method} failed`);
    }
  }

  return adapter;
}

// ---------------------------------------------------------------------------
// App-wide singleton
// ---------------------------------------------------------------------------

let defaultService: NotificationService | null = null;

/**
 * The app-wide service, created on first use so that no native module is touched at import.
 *
 * @returns The singleton {@link NotificationService} over {@link createExpoNotificationAdapter}.
 */
export function getNotificationService(): NotificationService {
  if (defaultService === null) {
    defaultService = createNotificationService(createExpoNotificationAdapter());
  }
  return defaultService;
}

/**
 * Replaces the app-wide service. Tests and the reminder-health screen's harness use this; the
 * app itself never calls it.
 *
 * @param service - The service to install, or `null` to fall back to the real one.
 */
export function setNotificationService(service: NotificationService | null): void {
  defaultService = service;
}

/** Current permission, without prompting. See {@link NotificationService.getPermission}. */
export function getNotificationPermission(): Promise<NotificationPermission> {
  return getNotificationService().getPermission();
}

/**
 * Prompts for notification permission. **Only from an explicit user action** (PRODUCT_SPEC §11).
 *
 * @returns The permission after the prompt.
 */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  return getNotificationService().requestPermission();
}

/** Reconciles the OS with the plan. See {@link NotificationService.sync}. */
export function syncNotifications(input: SyncInput): Promise<SyncOutcome> {
  return getNotificationService().sync(input);
}

/** Silences one prayer the instant it is logged. See {@link NotificationService.clearForPrayer}. */
export function clearPrayerNotifications(day: PrayerDay, prayer: Prayer): Promise<boolean> {
  return getNotificationService().clearForPrayer(day, prayer);
}

/** The reminder-health screen's ground truth: what the OS is actually holding. */
export function listScheduledNotifications(): Promise<ScheduledNotification[]> {
  return getNotificationService().listScheduled();
}

/** Fires the reminder-health screen's test notification. */
export function sendTestNotification(options?: { sound?: ReminderSound }): Promise<boolean> {
  return getNotificationService().sendTestNotification(options);
}

/** Subscribes to notification taps. See {@link NotificationService.observeTaps}. */
export function observeNotificationTaps(
  listener: (event: NotificationTapEvent) => void
): () => void {
  return getNotificationService().observeTaps(listener);
}
