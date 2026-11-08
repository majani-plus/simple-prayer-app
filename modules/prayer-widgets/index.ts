/**
 * `prayer-widgets` — the JS face of the homescreen widgets' data bridge (D26).
 *
 * The fifth local module, and like its four siblings it is bound by the house rule: **it never
 * schedules a reminder**, and it never writes the prayer log. Its whole native surface is a
 * mailbox — the app deposits one JSON snapshot (`services/widgetSnapshot`), the widgets read it:
 *
 * - **Android** (W2): SharedPreferences + two `AppWidgetProvider`s. `writeSnapshot` also redraws
 *   the widgets and re-arms the inexact transition alarms that keep the "current prayer" fresh.
 * - **iOS** (W3): the App Group `UserDefaults` (`SPAppGroupIdentifier`, same container as the
 *   D92 queue), plus `WidgetCenter.reloadTimelines`.
 *
 * Taps on a widget never come through here: they are handled natively (a `BroadcastReceiver` on
 * Android, an `AppIntent` in the iOS extension), appending to the **prayer-marks** queue the app
 * already drains. This module is app→widget only.
 *
 * Resolved lazily and optionally, exactly like `modules/prayer-marks`: in Jest, on web, or in a
 * dev client built before the module existed, every call is a silent no-op — widgets are an
 * enhancement, never a dependency.
 */

import { requireOptionalNativeModule } from 'expo';

/**
 * What the app pre-renders for the prayer Live Activity (D27, D112). All text is final.
 *
 * `day`/`prayer` (and every window/text field) describe the card's SUBJECT: the current prayer
 * on the due face, the approaching one on the lead face — which carries the subject's full
 * window and due-phase caption too, because at `staleAt` it re-renders itself into the subject's
 * due card with no process running. `markDay`/`markPrayer` name what the seal button asserts,
 * which on the lead face is the CURRENT prayer, not the subject.
 */
export interface PrayerActivityPayload {
  status: 'due' | 'upcoming';
  day: string;
  prayer: string;
  name: string;
  arabicName?: string;
  timeText: string;
  untilText: string;
  leftToPray: string;
  startAt: number;
  endAt: number;
  /** When this face stops being live: due = the linger's end, upcoming = the subject's start. */
  staleAt: number;
  /** Lead face only: "Starts at 4:31 pm". */
  startsCaption?: string;
  /** Lead face only: the countdown's label, "until it starts". */
  untilStartLabel?: string;
  /** Lead face only: "You can still pray Dhuhr". */
  stillToPray?: string;
  markDay: string;
  markPrayer: string;
  /** The seal button's accessibility label, "I prayed". */
  prayedLabel: string;
  /** The marked face's line, "Dhuhr marked" — travels through the tap intent. */
  markedText: string;
  language: string;
  rtl: boolean;
  theme: string;
}

interface PrayerWidgetsNativeModule {
  /** Stores the snapshot JSON, redraws every widget, and (Android) re-arms transition alarms. */
  writeSnapshot(json: string): Promise<void>;
  /** Removes the stored snapshot; widgets fall back to their bundled "open the app" state. */
  clearSnapshot(): Promise<void>;
  /** Redraws every widget from the stored snapshot, without writing (absent on older binaries). */
  render?(): Promise<void>;
  /** Whether any widget of ours is currently placed (used to skip work; may over-report). */
  hasWidgets(): Promise<boolean>;
  /** iOS 16.2+ on a build carrying the extension; absent or false everywhere else. */
  liveActivitiesSupported?: boolean;
  /** Replaces any prayer Activity with one for this window; it self-dismisses at `endAt`. */
  startPrayerWindowActivity?(payload: PrayerActivityPayload): Promise<void>;
  /** Ends every prayer Activity immediately (the toggle went off, or nothing is due). */
  endPrayerWindowActivities?(): Promise<void>;
}

let cached: PrayerWidgetsNativeModule | null | undefined;

function nativeModule(): PrayerWidgetsNativeModule | null {
  if (cached === undefined) {
    try {
      cached = requireOptionalNativeModule<PrayerWidgetsNativeModule>('PrayerWidgets');
    } catch {
      cached = null;
    }
  }
  return cached ?? null;
}

/** Whether this binary carries the native widget bridge. */
export function isSupported(): boolean {
  return nativeModule() !== null;
}

/**
 * Stores the snapshot for the widgets and asks them to redraw.
 *
 * @param json - The serialized `WidgetSnapshot`.
 */
export async function writeSnapshot(json: string): Promise<void> {
  await nativeModule()?.writeSnapshot(json);
}

/**
 * Redraws the widgets from what is already stored. An unchanged snapshot is never rewritten, and
 * that is exactly when a drawing goes stale across a prayer boundary — so the app calls this on
 * every foreground (D189).
 */
export async function render(): Promise<void> {
  await nativeModule()?.render?.();
}

/** Clears the stored snapshot, flipping widgets to their bundled "open the app" state. */
export async function clearSnapshot(): Promise<void> {
  await nativeModule()?.clearSnapshot();
}

/** Whether this binary and OS can show the prayer-window Live Activity (iOS 16.2+). */
export function liveActivitiesSupported(): boolean {
  return nativeModule()?.liveActivitiesSupported === true;
}

/** Starts (replacing) the single-window Live Activity. No-op where unsupported. */
export async function startPrayerWindowActivity(payload: PrayerActivityPayload): Promise<void> {
  await nativeModule()?.startPrayerWindowActivity?.(payload);
}

/** Ends every prayer Activity. No-op where unsupported. */
export async function endPrayerWindowActivities(): Promise<void> {
  await nativeModule()?.endPrayerWindowActivities?.();
}
