/**
 * `useNotificationSync` — the wire between the app's state and the notification engine.
 *
 * `services/notifications` knows how to make the OS match a plan; `domain/notificationPlan`
 * knows what the plan is. Neither knows *when* to look. This module is that answer, and like
 * `useTodayDayResolver` it belongs to the **root layout**: reminders must be kept current
 * whatever screen the user is on, including one reached by a notification tap without the Today
 * tab ever mounting.
 *
 * The mechanism lives in {@link startNotificationSync}, a plain start/stop controller with no
 * React in it; {@link useNotificationSync} is a five-line `useEffect` around it. The triggers are
 * subscriptions and timers rather than render state, so making them a controller costs nothing
 * and buys a wiring layer that can be tested without a renderer — and reused from a background
 * task later.
 *
 * ## The five triggers (PRODUCT_SPEC §11, ARCHITECTURE.md)
 *
 * | trigger              | how it is observed                                        |
 * | -------------------- | --------------------------------------------------------- |
 * | app foreground       | `AppState` → `active`                                      |
 * | settings change      | a `settingsStore` subscription, filtered to what matters   |
 * | location change      | same subscription (the location lives in settings)         |
 * | a prayer is logged   | a `trackingStore` subscription — **that prayer goes quiet immediately**: its pending last call and sunrise note are cancelled and anything of its still in the tray is dismissed, before the debounced full sync |
 * | day rollover         | a self-rearming timer aimed at the next Fajr               |
 *
 * A sixth, `i18next`'s `languageChanged`, exists because a scheduled notification carries the
 * copy it was written with: without it, yesterday's language would sit in the tray.
 *
 * A seventh, `service.observeReceived`, exists for the **tray** rather than the schedule: a sync
 * sweeps everything the user no longer needs to see, and the notification that just landed is
 * precisely the one that makes the previous prayer's obsolete. It fires **only in the foreground,
 * on both platforms** — the library never tells JS about a notification that lands while the app
 * is in the background (D165, correcting what D84 and this comment used to claim). The background
 * and closed-app cases are answered natively on Android (each row's own expiry via
 * `setTimeoutAfter`, plus the dismissal alarm) and cannot be answered on iOS until the next open
 * (PRODUCT_SPEC §11.5).
 *
 * ## The one thing a plan diff cannot see: exact alarms
 *
 * On Android the *plan* can be perfectly current while every alarm holding it is inexact, because
 * exactness is fixed when an alarm is armed and never revisited (D91). So the foreground trigger
 * and the first sync also ask the OS whether it will honour an exact alarm, and rebuild the whole
 * schedule the one time the answer goes from no to yes — see {@link startNotificationSync}'s
 * `checkExactAlarms`. Nothing else here ever rewrites a schedule the plan agrees with.
 *
 * ## Not causing a render loop
 *
 * The controller subscribes but never *selects*: it reads stores through `getState()` inside
 * callbacks and renders nothing, so a logged prayer does not re-render the root layout. The
 * hook's one effect has stable dependencies and runs once for the life of the app.
 *
 * The subtler loop is inside the tracking store: `dayRecordFor` reads through to the database on
 * a cache miss and bumps `revision`, which would wake this subscription, which would read more
 * days… {@link trackingSignature} closes it. The signature counts only *logged* statuses and the
 * exempt periods, so caching a day that has nothing logged changes nothing and the cascade stops
 * after at most one extra pass.
 *
 * Syncs are debounced ({@link DEFAULT_SYNC_DEBOUNCE_MS}) so a screen that writes three settings in
 * a row costs one sync, and the service itself serialises whatever still overlaps.
 *
 * The **mount / cold start** sync is the one exception: it waits {@link STARTUP_SYNC_DELAY_MS},
 * so the rebuild does not land on the JS thread at the exact moment the user's first seal tap
 * does. A trigger arriving in that window is absorbed by the pending startup sync (which reads
 * the stores when it runs), so a cold start still costs exactly one sync — a newly logged prayer
 * keeps its immediate fast path regardless.
 *
 * Dependency rule: `hooks → stores + services + domain`. No SQL, no user-facing strings.
 */

import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { addDays } from '@/domain/dates';
import { DEFAULT_PLAN_DAYS } from '@/domain/notificationPlan';
import { computeDayTimes, getIshaNudgeTimeFrom } from '@/domain/prayerTimes';
import { PRAYERS } from '@/domain/types';
import i18n from '@/i18n';
import {
  getNotificationService,
  type NotificationService,
  type SyncInput,
  type SyncOutcome,
} from '@/services/notifications';
import { readExactAlarmState, type ExactAlarmState } from '@/services/exactAlarms';
import { getSettingsSnapshot, useSettingsStore } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';

import type {
  AppSettings,
  DayRecord,
  DayTimes,
  Prayer,
  PrayerDay,
  PrayerStatus,
} from '@/domain/types';

/**
 * How long a burst of changes is allowed to settle before one sync runs. A full second (was
 * 400ms, D197), so the reschedule runs after somebody marking several prayers has finished, not
 * between two of their taps. A logged prayer's own reminder is still cleared at once (step 5).
 */
export const DEFAULT_SYNC_DEBOUNCE_MS = 1000;

/**
 * How long the **first** sync of a process waits.
 *
 * Every other trigger keeps {@link DEFAULT_SYNC_DEBOUNCE_MS}. The cold start is the one moment
 * the user is reaching for a seal, and 400 ms after the first paint is almost exactly when their
 * thumb lands — so the plan rebuild ran on the JS thread while the press animation was trying to
 * start. Nothing is lost by yielding those two seconds: a steady-state sync issues no platform
 * calls at all, and the reminders the OS is already holding stay armed until this replaces them.
 *
 * (A plain timer, not `InteractionManager.runAfterInteractions`: RN 0.86 deprecated that module,
 * where it now does nothing but `setImmediate` — no interaction is tracked any more — and merely
 * touching it prints a LogBox warning on every launch. Two seconds is already past every frame
 * it used to wait for.)
 */
export const STARTUP_SYNC_DELAY_MS = 2000;

/**
 * Longest single `setTimeout` armed for the day rollover. A device asleep for six hours will not
 * honour a six-hour timer, so long waits are split into chunks that re-arm from the real clock —
 * the same pattern `usePrayerDay` uses.
 */
export const MAX_TIMER_MS = 10 * 60 * 1000;

/** Absorbs timer jitter so the rollover sync lands on the far side of the new Fajr. */
const ROLLOVER_GRACE_MS = 1000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** One prayer, on one day. */
export interface PrayerRef {
  day: PrayerDay;
  prayer: Prayer;
}

/**
 * Every prayer with something actually logged against it, as `` `${day}:${prayer}` `` → status.
 *
 * Unlogged prayers are deliberately absent rather than present-and-`'unlogged'`: that is what
 * makes the map — and {@link trackingSignature} over it — blind to a day merely being read into
 * the store's cache. See the module header on the render loop this closes.
 *
 * @param dayRecords - The tracking store's cache.
 * @returns A flat map of logged statuses.
 */
export function loggedStatusMap(
  dayRecords: Record<PrayerDay, DayRecord>
): Record<string, PrayerStatus> {
  const out: Record<string, PrayerStatus> = {};
  for (const [day, record] of Object.entries(dayRecords)) {
    for (const prayer of PRAYERS) {
      const status = record.statuses[prayer];
      if (status === undefined || status === 'unlogged') continue;
      out[`${day}:${prayer}`] = status;
    }
  }
  return out;
}

/**
 * The prayers that just became logged — the ones whose nudge has to be cancelled *now* rather
 * than at the end of the next debounce (PRODUCT_SPEC §11: "cancelled immediately when logged").
 *
 * @param previous - The logged map before the change.
 * @param next - The logged map after it.
 * @returns Newly logged prayers; a status merely *changing* (prayed → late) is not one, because
 *          its nudge is already gone.
 */
export function newlyLoggedPrayers(
  previous: Record<string, PrayerStatus>,
  next: Record<string, PrayerStatus>
): PrayerRef[] {
  const out: PrayerRef[] = [];
  for (const key of Object.keys(next)) {
    if (previous[key] !== undefined) continue;
    const separator = key.lastIndexOf(':');
    const day = key.slice(0, separator);
    const prayer = key.slice(separator + 1) as Prayer;
    if ((PRAYERS as readonly string[]).includes(prayer)) out.push({ day, prayer });
  }
  return out;
}

/**
 * A cheap value that changes exactly when the tracking state a notification plan depends on
 * changes: what is logged, and which days are exempt.
 *
 * @param state - Logged statuses and the exempt periods.
 * @returns A comparable string.
 */
export function trackingSignature(state: {
  logged: Record<string, PrayerStatus>;
  exemptPeriods: readonly { startDay: PrayerDay; endDay: PrayerDay | null }[];
}): string {
  const logged = Object.keys(state.logged)
    .sort()
    .map((key) => `${key}=${state.logged[key]}`)
    .join(',');
  const exempt = state.exemptPeriods
    .map((period) => `${period.startDay}>${period.endDay ?? ''}`)
    .sort()
    .join(',');
  return `${logged}|${exempt}`;
}

/**
 * The settings a notification plan depends on, as a comparable string. Theme and streak mode are
 * deliberately absent: changing them must not cost a reschedule.
 *
 * @param settings - The full settings snapshot.
 * @returns A comparable string.
 */
export function reminderSignature(settings: AppSettings): string {
  return JSON.stringify([
    settings.reminders,
    // The chosen recitation. It changes the sound file every adhan reminder names — and, on
    // Android, the channel each one rides on — so it has to be able to trigger a reschedule on its
    // own, even though no reminder is turned on or off by it.
    settings.adhanVoice,
    settings.nudgeLeadMinutes,
    // Its own switch since D90, so it has to be able to move the schedule on its own — no
    // per-prayer reminder changes when it is toggled.
    settings.sunriseNoteEnabled,
    settings.calculation,
    settings.location === null
      ? null
      : [settings.location.latitude, settings.location.longitude, settings.location.countryCode],
    settings.persistentNotificationEnabled,
    // Carried per adhan request (D96), so flipping it must rewrite the held reminders.
    settings.pauseAudioEnabled,
    settings.timeFormat,
    settings.exemptionModeEnabled,
  ]);
}

/** Everything {@link buildSyncInput} reads. Passed in, so the function stays pure and testable. */
export interface SyncInputSources {
  now: Date;
  settings: AppSettings;
  /** The current prayer day (Fajr→Fajr), from the tracking store. */
  todayDay: PrayerDay;
  /** How many days the rolling window covers. Defaults to `DEFAULT_PLAN_DAYS`. */
  planDays?: number;
  isExemptDay: (day: PrayerDay) => boolean;
  statusesFor: (day: PrayerDay) => Partial<Record<Prayer, PrayerStatus>>;
  /** The language the content will be written in. */
  locale: string;
}

/**
 * Assembles the {@link SyncInput} for the next few days: their times (offsets applied), their
 * Islamic midnights, what is logged on them and which of them are exempt.
 *
 * @param sources - See {@link SyncInputSources}.
 * @returns The input, or `null` when there is no location or the engine cannot resolve the
 *          times — both of which mean "there is nothing to schedule", not "crash".
 */
export function buildSyncInput(sources: SyncInputSources): SyncInput | null {
  const { settings } = sources;
  const location = settings.location;
  if (location === null) return null;

  const count = Math.max(1, sources.planDays ?? DEFAULT_PLAN_DAYS);
  const days: DayTimes[] = [];
  const ishaNudgeTimes: Record<PrayerDay, Date> = {};
  const statuses: Record<PrayerDay, Partial<Record<Prayer, PrayerStatus>>> = {};
  const exemptDays = new Set<PrayerDay>();
  const reminderKeptDays = new Set<PrayerDay>();

  try {
    for (let offset = 0; offset < count; offset += 1) {
      const day = addDays(sources.todayDay, offset);
      // One `computeDayTimes` per day, shared with the nudge: asking for the day string alone
      // would make the planner recompute the very times it is already holding.
      const dayTimes = computeDayTimes(day, location, settings.calculation);
      days.push(dayTimes);
      ishaNudgeTimes[day] = getIshaNudgeTimeFrom(dayTimes, location, settings.calculation);
      statuses[day] = sources.statusesFor(day);
      if (sources.isExemptDay(day)) {
        exemptDays.add(day);
        // She chose to keep the call on excused days (begin sheet, owner 2026-08-28): the
        // adhan and pre-reminder still speak; the plan mutes the obligation-shaped kinds.
        if (!settings.exemptionMuteReminders) reminderKeptDays.add(day);
      }
    }
  } catch {
    // An unresolvable polar day or an impossible location: schedule nothing rather than throw.
    return null;
  }

  return {
    now: sources.now,
    days,
    reminders: settings.reminders,
    adhanVoice: settings.adhanVoice,
    nudgeLeadMinutes: settings.nudgeLeadMinutes,
    sunriseNoteEnabled: settings.sunriseNoteEnabled,
    statuses,
    exemptDays,
    reminderKeptDays,
    ishaNudgeTimes,
    timeFormat: settings.timeFormat,
    locale: sources.locale,
    persistentNotification: settings.persistentNotificationEnabled,
    pauseAudioAtAdhan: settings.pauseAudioEnabled,
  };
}

// ---------------------------------------------------------------------------
// Imperative entry point
// ---------------------------------------------------------------------------

/** Options shared by the imperative sync and the hook. */
export interface NotificationSyncOptions {
  /** Defaults to the app-wide service. */
  service?: NotificationService;
  /** Days in the rolling window. Defaults to `DEFAULT_PLAN_DAYS`. */
  planDays?: number;
  /** Clock, injected by tests. */
  now?: () => Date;
}

/**
 * Reads the stores and reconciles the OS once — the imperative form of what the hook does on a
 * trigger. The reminders screen calls this straight after the permission prompt is answered, so
 * the user's first "yes" schedules something immediately instead of on the next foreground.
 *
 * @param options - See {@link NotificationSyncOptions}.
 * @returns The outcome, or `null` when there was nothing to plan (no location yet).
 */
export async function syncNotificationsFromStores(
  options: NotificationSyncOptions = {}
): Promise<SyncOutcome | null> {
  const tracking = useTrackingStore.getState();
  const input = buildSyncInput({
    now: options.now?.() ?? new Date(),
    settings: getSettingsSnapshot(),
    todayDay: tracking.todayDay(),
    planDays: options.planDays,
    isExemptDay: (day) => tracking.isExemptDay(day),
    statusesFor: (day) => tracking.dayRecordFor(day).statuses,
    locale: i18n.language,
  });
  if (input === null) return null;
  const service = options.service ?? getNotificationService();
  return await service.sync(input);
}

/**
 * Throws away every reminder the OS is holding and schedules the whole plan again.
 *
 * The heavy version of {@link syncNotificationsFromStores}, and it exists for exactly one thing:
 * an alarm's *exactness* is decided when it is set, and never revisited. When the user allows
 * exact alarms (D91), everything already scheduled — tonight's Isha, tomorrow's Fajr — stays
 * inexact, because an ordinary sync sees a plan that has not changed and correctly does nothing.
 * Android itself only re-arms them exactly on a reboot or an app update, which is far too late for
 * the reminder the user just went to a settings screen to protect.
 *
 * Never called on a timer or a foreground: only when something changed that the plan cannot see.
 *
 * @param options - See {@link NotificationSyncOptions}.
 * @returns The outcome of the fresh sync, or `null` when there was nothing to plan.
 */
export async function rebuildNotificationsFromStores(
  options: NotificationSyncOptions = {}
): Promise<SyncOutcome | null> {
  const service = options.service ?? getNotificationService();
  await service.cancelAll();
  return await syncNotificationsFromStores({ ...options, service });
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** Options for {@link startNotificationSync} and {@link useNotificationSync}. */
export interface UseNotificationSyncOptions extends NotificationSyncOptions {
  /** Debounce window. Defaults to {@link DEFAULT_SYNC_DEBOUNCE_MS}. */
  debounceMs?: number;
  /**
   * How long the first sync after mount waits. Defaults to {@link STARTUP_SYNC_DELAY_MS}; `0`
   * starts the ordinary debounce at once, which is what the tests use.
   */
  startupDelayMs?: number;
  /**
   * Where a notification tap goes. Defaults to `expo-router`'s `router.navigate`; pass `null` to
   * leave taps unhandled (and a function to observe them in a test).
   */
  navigate?: ((url: string) => void) | null;
}

/**
 * Subscribes to every trigger and keeps the OS's schedule in step with the app — the whole
 * mechanism, with no React in it. {@link useNotificationSync} is a five-line wrapper around this.
 *
 * Keeping it framework-free is deliberate: the triggers are subscriptions and timers, not render
 * state, and a controller that can be started and stopped by hand is testable without a renderer
 * (and reusable from a future background task).
 *
 * @param options - See {@link UseNotificationSyncOptions}.
 * @returns The stop function: it clears both timers and drops every subscription.
 */
export function startNotificationSync(options: UseNotificationSyncOptions = {}): () => void {
  const {
    service: injected,
    planDays,
    now,
    debounceMs = DEFAULT_SYNC_DEBOUNCE_MS,
    startupDelayMs = STARTUP_SYNC_DELAY_MS,
    navigate = (url: string) => router.navigate(url as Href),
  } = options;

  const service = injected ?? getNotificationService();
  let disposed = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let rollover: ReturnType<typeof setTimeout> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The last answer Android gave about exact alarms, so a *change* can be acted on. `null` until
   * the first read, which is why the first read alone never rebuilds anything.
   */
  let exactAlarmsSeen: ExactAlarmState | null = null;

  let settingsSeen = reminderSignature(getSettingsSnapshot());
  let loggedSeen = loggedStatusMap(useTrackingStore.getState().dayRecords);
  let trackingSeen = trackingSignature({
    logged: loggedSeen,
    exemptPeriods: useTrackingStore.getState().exemptPeriods,
  });

  /** Arms the day-rollover sync at the next Fajr, in chunks a sleeping device will honour. */
  const armRollover = (input: SyncInput): void => {
    if (rollover !== null) clearTimeout(rollover);
    rollover = null;

    const nowMs = (now?.() ?? new Date()).getTime();
    let target = Number.POSITIVE_INFINITY;
    for (const day of input.days) {
      const fajr = day.times?.fajr?.getTime();
      if (fajr !== undefined && Number.isFinite(fajr) && fajr > nowMs && fajr < target) {
        target = fajr;
      }
    }
    if (!Number.isFinite(target)) return;

    const arm = (): void => {
      if (disposed) return;
      const remaining = target + ROLLOVER_GRACE_MS - (now?.() ?? new Date()).getTime();
      if (remaining <= 0) {
        requestSync();
        return;
      }
      rollover = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
    };
    arm();
  };

  const runSync = (): void => {
    if (disposed) return;
    const tracking = useTrackingStore.getState();
    const input = buildSyncInput({
      now: now?.() ?? new Date(),
      settings: getSettingsSnapshot(),
      todayDay: tracking.todayDay(),
      planDays,
      isExemptDay: (day) => tracking.isExemptDay(day),
      statusesFor: (day) => tracking.dayRecordFor(day).statuses,
      locale: i18n.language,
    });
    if (input === null) return;
    armRollover(input);
    void service.sync(input).catch(() => {
      // `sync` already reports failures in its outcome; a rejection here would only be a bug
      // in the adapter, and must not take the app down.
    });
  };

  /**
   * Asks Android whether it will honour an exact alarm, and rebuilds the whole schedule the one
   * time the answer improves.
   *
   * An alarm's exactness is decided when it is set and never revisited (D91), so allowing
   * "Alarms & reminders" reaches nothing that is already armed: tonight's Isha and tomorrow's Fajr
   * stay batched by Doze, and an ordinary sync correctly leaves them alone because the plan has
   * not changed. Android itself only re-arms them exactly at the next reboot or app update.
   *
   * The reliability screen already does this for the user who grants it through its own button
   * (`app/settings/reminder-health`). This is the same repair for every other route to the same
   * switch — Android's own Settings app, a notification from the system, a phone handed to someone
   * who knows where the setting lives — which is why "I allowed it and Fajr was still late" was an
   * expected outcome rather than a contradiction.
   *
   * Runs on the foreground and at the first sync, and does nothing at all off Android, where
   * {@link readExactAlarmState} answers `'exact'` without asking anything.
   */
  const checkExactAlarms = async (): Promise<void> => {
    if (disposed) return;
    let state: ExactAlarmState;
    try {
      state = await readExactAlarmState();
    } catch {
      // A platform read that failed is not knowledge; leave the last-seen answer where it was.
      return;
    }
    if (disposed) return;

    const previous = exactAlarmsSeen;
    exactAlarmsSeen = state;
    // Only this transition. The first read has no predecessor, and every other pair of answers
    // either changes nothing or is a permission being taken away, which no rebuild can help.
    if (previous !== 'inexact' || state !== 'exact') return;

    try {
      await rebuildNotificationsFromStores({ service, planDays, now });
    } catch {
      // The next ordinary sync still holds the schedule together; a failed rebuild must not take
      // the app down on a foreground.
    }
  };

  /** Drops the cold-start wait, if it is still pending. */
  const cancelStartup = (): void => {
    if (startupTimer !== null) clearTimeout(startupTimer);
    startupTimer = null;
  };

  const requestSync = (): void => {
    if (disposed) return;
    // While the cold-start wait is pending it ABSORBS every trigger: the startup sync reads the
    // stores when it runs, so whatever changed is in it. Letting a trigger cancel the wait and
    // take the ordinary debounce would defeat the wait on every launch that has data — hydrating
    // the tracking store changes the logged-prayer signature below, which is a trigger.
    if (startupTimer !== null) return;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      runSync();
    }, debounceMs);
  };

  // 1. Mount / cold start — the one trigger that deliberately waits longer than the debounce.
  //    See STARTUP_SYNC_DELAY_MS: the first seal tap arrives in this window and gets the thread.
  if (startupDelayMs > 0) {
    startupTimer = setTimeout(() => {
      startupTimer = null;
      void checkExactAlarms();
      runSync();
    }, startupDelayMs);
  } else {
    void checkExactAlarms();
    requestSync();
  }

  // 2. Foreground — and the moment to re-ask Android whether it will honour an exact alarm, since
  //    coming back from a settings screen is how that answer changes.
  const appState = AppState.addEventListener('change', (status) => {
    if (status !== 'active') return;
    void checkExactAlarms();
    requestSync();
  });

  // 3 + 4. Settings, which is also where the location lives.
  const unsubscribeSettings = useSettingsStore.subscribe(() => {
    const signature = reminderSignature(getSettingsSnapshot());
    if (signature === settingsSeen) return;
    settingsSeen = signature;
    requestSync();
  });

  // 5. Logs and exemptions. A newly logged prayer loses its nudge at once; everything else
  //    waits for the debounce.
  const unsubscribeTracking = useTrackingStore.subscribe((state) => {
    const logged = loggedStatusMap(state.dayRecords);
    for (const { day, prayer } of newlyLoggedPrayers(loggedSeen, logged)) {
      void service.clearForPrayer(day, prayer).catch(() => {
        // The next sync cancels the pending ones and clears the tray anyway; this is only the
        // fast path, so that tapping the seal silences the prayer before the debounce elapses.
      });
    }
    loggedSeen = logged;

    const signature = trackingSignature({ logged, exemptPeriods: state.exemptPeriods });
    if (signature === trackingSeen) return;
    trackingSeen = signature;
    requestSync();
  });

  // 6. Language: the copy is baked into each scheduled notification.
  const onLanguageChanged = (): void => requestSync();
  i18n.on('languageChanged', onLanguageChanged);

  // 7. One of our own reminders arriving while the app is in the FOREGROUND — the only state in
  //    which either platform delivers this event to JS (D165). A sync in the steady state issues
  //    no platform calls for the schedule, so what this buys is the tray sweep at the one moment
  //    the tray grows while the user is looking at it: Dhuhr's adhan landing is exactly what makes
  //    Fajr's obsolete (PRODUCT_SPEC §11.5). Background and closed-app rows are expired by the OS
  //    itself on Android (`setTimeoutAfter`, D165) and by the next open on iOS.
  const stopObservingReceipts = service.observeReceived(() => requestSync());

  // Tapping any of our notifications opens Today (PRODUCT_SPEC §11).
  const stopObservingTaps =
    navigate === null
      ? () => undefined
      : service.observeTaps((event) => {
          if (disposed) return;
          try {
            navigate(event.url);
          } catch {
            // A tap that arrives before the navigator is mounted is not worth crashing over.
          }
        });

  return () => {
    disposed = true;
    cancelStartup();
    if (debounce !== null) clearTimeout(debounce);
    if (rollover !== null) clearTimeout(rollover);
    appState.remove();
    unsubscribeSettings();
    unsubscribeTracking();
    i18n.off('languageChanged', onLanguageChanged);
    stopObservingTaps();
    stopObservingReceipts();
  };
}

/**
 * Keeps the OS's notification schedule in step with the app, and routes notification taps to the
 * Today tab.
 *
 * Call it once, from the root layout — like `useTodayDayResolver`, this is app-wide behaviour and
 * not a screen's job. It renders nothing and returns nothing.
 *
 * @param options - See {@link UseNotificationSyncOptions}. Every field is a stable value in the
 * app; passing a freshly-built object each render would restart the subscriptions.
 */
export function useNotificationSync(options: UseNotificationSyncOptions = {}): void {
  const { service, planDays, now, debounceMs, startupDelayMs, navigate } = options;

  useEffect(
    () => startNotificationSync({ service, planDays, now, debounceMs, startupDelayMs, navigate }),
    [service, planDays, now, debounceMs, startupDelayMs, navigate]
  );
}
