/**
 * `services/liveActivity` — when the prayer Live Activity exists, and what it says (D27, D112).
 *
 * The design in one paragraph: this app has no push entitlement (D49), so an Activity can only
 * be born while the app is foregrounded and can never be pushed new content after. What survives
 * those constraints is a two-faced card around the prayer's moment (toggle in Settings, off by
 * default; both distances user-set, D112):
 *
 * - the **due card**, born when the app comes forward inside an open window, counting down on a
 *   native timer; it stays for `liveActivityLingerMinutes` after the prayer came in, not for the
 *   whole window — the lockscreen carries the moment, never a ledger;
 * - the **lead card**, born up to `liveActivityLeadMinutes` before the NEXT prayer starts and
 *   only while the CURRENT prayer is still unlogged — a countdown to get the current prayer in
 *   before the next arrives. At the next prayer's start it re-renders itself into that prayer's
 *   due card (`staleDate` passing re-renders with `isStale`, no process needed).
 *
 * Both faces carry the seal as an "I prayed" button (iOS 17 `Button(intent:)`, the D109 idiom):
 * the tap appends to the D92 queue and — running in the app's process as a `LiveActivityIntent`
 * — flips the card to its marked face and retires it. The lead card's seal marks the CURRENT
 * prayer, not the card's subject.
 *
 * When the card should NOT exist, existing is the bug: toggle off, no current prayer (the
 * sunrise→Dhuhr gap), an exempt day (D64 — nothing is owed, so nothing counts down), a current
 * prayer already marked (the question answered — this kills BOTH faces), or the linger spent.
 * All of those END whatever is showing, on the next foreground reconcile; between foregrounds
 * the system's dimming (`staleDate`) and its own ceiling stand in, the accepted D104 trade.
 *
 * Everything user-facing is rendered HERE, through the app's translator and formatter, and
 * travels to Swift as final text — the same rule as the widget snapshot.
 */

import {
  getCurrentPrayer,
  getNextPrayer,
  getPrayerWindows,
  type TimesLocation,
} from '../domain/prayerTimes';
import { prayerNameKey } from '../domain/prayerNames';
import type { CalculationSettings, Prayer, PrayerDay, PrayerStatus } from '../domain/types';
import i18n from '../i18n';
import { isRtlLanguage } from '../i18n/direction';
import { numericLocale } from '../i18n/numerals';
import * as bridge from '../../modules/prayer-widgets';
import { formatTime, type TimeFormatPreference } from '../utils/formatTime';
import { getSettingsSnapshot } from '../stores/settingsStore';
import { getTrackingActions } from '../stores/trackingStore';

const MS_PER_MINUTE = 60_000;

/** The bridge as this module needs it — a seam for tests, the real module by default. */
export interface LiveActivityBridge {
  liveActivitiesSupported(): boolean;
  startPrayerWindowActivity(payload: bridge.PrayerActivityPayload): Promise<void>;
  endPrayerWindowActivities(): Promise<void>;
}

export type LiveActivitySyncOutcome = 'unsupported' | 'started' | 'ended' | 'unchanged';

/** Seams for tests; the app passes none of them. */
export interface SyncLiveActivityOptions {
  now?: Date;
  bridge?: LiveActivityBridge;
  translate?: (key: string, params?: Record<string, unknown>) => string;
  settings?: ReturnType<typeof getSettingsSnapshot>;
  tracking?: {
    hydrated: boolean;
    dayRecordFor: (day: PrayerDay) => { statuses: Record<Prayer, PrayerStatus> } | undefined;
    isExemptDay: (day: PrayerDay) => boolean;
  };
}

/**
 * What the last sync put up, so a repeat trigger costs no bridge call. `undefined` means this
 * process has never reconciled — the first pass always speaks to the bridge, because an Activity
 * from a previous app run may still be on the lock screen with nobody accounting for it.
 */
let lastShown: string | null | undefined;

/** Test-only: forget the dedupe state. */
export function resetLiveActivityMemory(): void {
  lastShown = undefined;
}

/**
 * Reconciles the Activity with the world: starts the face the moment calls for, ends whatever is
 * showing when nothing does. Runs from the same debounced controller as the widget sync
 * (`useWidgetSync`), so every trigger that repaints a widget also reconsiders the Activity.
 *
 * @param options - Test seams only.
 * @returns What happened.
 */
export async function syncLiveActivity(
  options: SyncLiveActivityOptions = {}
): Promise<LiveActivitySyncOutcome> {
  const bridgeImpl = options.bridge ?? bridge;
  if (!bridgeImpl.liveActivitiesSupported()) return 'unsupported';

  const settings = options.settings ?? getSettingsSnapshot();
  const tracking = options.tracking ?? getTrackingActions();
  const translate =
    options.translate ??
    ((key: string, params?: Record<string, unknown>) => i18n.t(key, params ?? {}));
  const now = options.now ?? new Date();
  const language = i18n.language ?? 'en';

  const desired = desiredActivity(now, settings, tracking, translate, language);
  // The key carries everything the rendered card depends on: a 12/24h, theme, face or linger
  // change mid-window must re-issue the Activity (start replaces), or the card would keep the
  // old content. `staleAt` folds the linger setting in; `markPrayer` folds the lead card's
  // button target in.
  const key =
    desired === null
      ? null
      : `${desired.status}:${desired.day}:${desired.prayer}:${desired.staleAt}:${desired.markPrayer}:${language}:${settings.timeFormat}:${settings.theme}`;

  if (lastShown !== undefined && key === lastShown) return 'unchanged';
  if (desired === null) {
    lastShown = null;
    await bridgeImpl.endPrayerWindowActivities();
    return 'ended';
  }
  await bridgeImpl.startPrayerWindowActivity(desired);
  lastShown = key;
  return 'started';
}

function desiredActivity(
  now: Date,
  settings: ReturnType<typeof getSettingsSnapshot>,
  tracking: NonNullable<SyncLiveActivityOptions['tracking']>,
  translate: (key: string, params?: Record<string, unknown>) => string,
  language: string
): bridge.PrayerActivityPayload | null {
  if (!settings.liveActivityEnabled) return null;
  if (settings.location === null || !tracking.hydrated) return null;
  const location: TimesLocation = settings.location;
  const calculation: CalculationSettings = settings.calculation;

  let current: { prayer: Prayer; day: PrayerDay } | null;
  try {
    current = getCurrentPrayer(now, location, calculation);
  } catch {
    return null;
  }
  // Both faces exist for the same open question: the current prayer, unprayed, on a day that
  // counts. No current prayer (the sunrise→Dhuhr gap), an exempt day, or a mark all mean the
  // lockscreen has nothing to ask (D112: the lead card is "time to pray it before the next one",
  // so a marked current prayer removes the lead card too).
  if (current === null) return null;
  if (tracking.isExemptDay(current.day)) return null;
  const status = tracking.dayRecordFor(current.day)?.statuses[current.prayer] ?? 'unlogged';
  if (status !== 'unlogged') return null;

  let window: { start: Date; end: Date } | undefined;
  try {
    window = getPrayerWindows(current.day, location, calculation).find(
      (candidate) => candidate.prayer === current.prayer
    );
  } catch {
    return null;
  }
  if (window === undefined || window.end.getTime() <= now.getTime()) return null;

  const locale = numericLocale(language);
  const timeText = (date: Date): string =>
    formatTime(date, { timeFormat: settings.timeFormat as TimeFormatPreference, locale });
  const names = (prayer: Prayer, day: PrayerDay): { name: string; arabicName?: string } => {
    const nameKey = prayerNameKey(prayer, day);
    const name = translate(`prayers.${nameKey}`);
    const arabicName = translate(`prayers.arabic.${nameKey}`);
    return { name, arabicName: arabicName === name ? undefined : arabicName };
  };
  const untilTextFor = (prayer: Prayer, end: Date): string =>
    prayer === 'fajr'
      ? translate('today.caption.dueUntilSunrise', { time: timeText(end) })
      : translate('today.caption.dueUntil', { time: timeText(end) });
  const currentNames = names(current.prayer, current.day);
  const shared = {
    prayedLabel: translate('notifications.actions.prayed'),
    markedText: translate('notifications.marked.title', { prayer: currentNames.name }),
    language,
    rtl: isRtlLanguage(language),
    theme: settings.theme,
  };

  // The due card: the prayer's own moment, for `linger` minutes of its window.
  const lingerEndsAt = Math.min(
    window.end.getTime(),
    window.start.getTime() + settings.liveActivityLingerMinutes * MS_PER_MINUTE
  );
  if (now.getTime() < lingerEndsAt) {
    return {
      status: 'due',
      day: current.day,
      prayer: current.prayer,
      ...currentNames,
      timeText: timeText(window.start),
      untilText: untilTextFor(current.prayer, window.end),
      leftToPray: translate('widgets.leftToPray'),
      startAt: window.start.getTime(),
      endAt: window.end.getTime(),
      staleAt: lingerEndsAt,
      markDay: current.day,
      markPrayer: current.prayer,
      ...shared,
    };
  }

  // The lead card: the NEXT prayer approaching while the current one is still unprayed. Its
  // subject is the next prayer — at `staleAt` (= that prayer's start) it re-renders itself into
  // the next prayer's due card, which is why it carries the next window's full bounds and the
  // due-phase caption alongside its own. The seal, though, marks the CURRENT prayer.
  let next: { prayer: Prayer; day: PrayerDay; at: Date };
  try {
    next = getNextPrayer(now, location, calculation);
  } catch {
    return null;
  }
  if (next.at.getTime() - now.getTime() > settings.liveActivityLeadMinutes * MS_PER_MINUTE) {
    return null;
  }
  let nextWindow: { start: Date; end: Date } | undefined;
  try {
    nextWindow = getPrayerWindows(next.day, location, calculation).find(
      (candidate) => candidate.prayer === next.prayer
    );
  } catch {
    return null;
  }
  if (nextWindow === undefined) return null;

  return {
    status: 'upcoming',
    day: next.day,
    prayer: next.prayer,
    ...names(next.prayer, next.day),
    timeText: timeText(nextWindow.start),
    untilText: untilTextFor(next.prayer, nextWindow.end),
    leftToPray: translate('widgets.leftToPray'),
    startAt: nextWindow.start.getTime(),
    endAt: nextWindow.end.getTime(),
    staleAt: nextWindow.start.getTime(),
    startsCaption: translate('widgets.startsAt', { time: timeText(nextWindow.start) }),
    untilStartLabel: translate('widgets.untilItStarts'),
    stillToPray: translate('widgets.stillToPray', { prayer: currentNames.name }),
    markDay: current.day,
    markPrayer: current.prayer,
    ...shared,
  };
}
