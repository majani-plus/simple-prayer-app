/**
 * Background refresh — the app doing its own housekeeping with nobody holding the phone.
 *
 * ## The three things that stop being true while the app is closed
 *
 * 1. **The reminder schedule runs out.** `domain/notificationPlan` plans `DEFAULT_PLAN_DAYS`
 *    ahead, and `hooks/useNotificationSync` only extends that window while a process is alive.
 *    A phone left unopened for longer than the window simply runs out of adhans — which is
 *    the category's second-loudest complaint, and the reason every competitor tells people
 *    to "open the app every few days". D166 recorded this gap and deliberately left it open; this
 *    module is the thing it said had not been done.
 * 2. **The tray keeps rows nobody needs.** On Android each row expires by itself (`setTimeoutAfter`
 *    plus the dismissal alarm, D88/D165). On iOS a delivered notification can only be taken out of
 *    the tray by our own code, so the sweep at the top of `runSync` is the whole answer there — and
 *    until now it only ran when the user opened the app. Somebody who leaves the phone alone for
 *    two days comes back to a wall of stale notifications.
 * 3. **The widgets, the Live Activity and the watch drift towards their horizon.** The widget
 *    snapshot carries 14 days and the watch tile about 36 hours, so neither goes wrong quickly —
 *    but both are published only by a running app.
 *
 * One headless run answers all three, because all three already have a "reconcile everything from
 * the stores" entry point. This module is only the *when* and the *without a screen* — it decides
 * nothing about reminders, widgets or the watch.
 *
 * ## Why it lives here and not in a hook
 *
 * `TaskManager.defineTask` must run in the global scope of the bundle, before React exists, and on
 * Android the JS context can be started headlessly with no view mounted at all. Expo Router loads
 * route modules lazily as the router renders, so a definition inside `src/app/_layout.tsx` would
 * simply never be reached on a headless launch. The definition therefore sits at this module's top
 * level and the repo-root `index.ts` imports it before `expo-router/entry`.
 *
 * ## What a headless run has to do for itself
 *
 * Everything the root layout does in an effect, nothing here gets for free:
 *
 * - the database has to be migrated and the tracking store hydrated (`useStartup`);
 * - i18next has to be pointed at the user's chosen language, not the device's — every scheduled
 *   notification carries the copy it was written with, so getting this wrong would quietly write
 *   the next five days of reminders in the wrong language.
 *
 * The settings store needs no such step: it hydrates from MMKV synchronously inside `create()`
 * (D13), so reading it is safe the instant this module is imported.
 *
 * ## Failure policy
 *
 * Every step is in its own `try`/`catch` and the run reports `Success` unless *every* step failed.
 * The steps are independent — a widget bridge that is missing must not cost the user five days of
 * reminders — and on iOS a task that reports failure too often is scheduled less generously.
 * Nothing in here may throw out of the task body.
 *
 * ## Two notes on the imports
 *
 * `syncNotificationsFromStores` lives in `hooks/useNotificationSync`, so this service imports from
 * `hooks/` — the one place in `src/services` that does. It is deliberate and it is the reason that
 * function was written as a plain imperative export in the first place ("reusable from a background
 * task later", says its own module header); the alternative is a third copy of the same twelve
 * lines. Nothing React-shaped comes across with it.
 *
 * And importing this module pulls the notification, widget, watch and Live Activity services in at
 * the entry point rather than at the first render. That costs no extra work on a cold start:
 * `src/app/_layout.tsx` imports every one of them anyway, a few milliseconds later. Only the order
 * changed.
 *
 * Otherwise the usual rule holds: no React, no components, and no user-facing strings of its own.
 */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { runMigrations } from '@/db/client';
import { syncNotificationsFromStores } from '@/hooks/useNotificationSync';
import { applyLanguage, deviceLanguage, initI18n } from '@/i18n';
import { syncLiveActivity } from '@/services/liveActivity';
import { syncWatch } from '@/services/watch';
import { syncWidgets } from '@/services/widgets';
import { getSettingsSnapshot } from '@/stores/settingsStore';
import { getTrackingActions, useTrackingStore } from '@/stores/trackingStore';

import type { WidgetSnapshot } from '@/services/widgetSnapshot';

/**
 * The task's name, as `TaskManager` stores it. Registered tasks survive a restart in persistent
 * storage under this string, so it is part of the app's on-device state and must not be renamed
 * casually: an installed app carrying the old name would keep a registration nothing answers.
 */
export const BACKGROUND_REFRESH_TASK = 'simple-prayer-background-refresh';

/**
 * How often the app asks to be woken, in minutes.
 *
 * One hour, and it is a *request* on both platforms rather than a schedule:
 *
 * - **iOS** treats it as a lower bound and nothing more. `BGProcessingTask` runs when the system
 *   decides the phone is idle and, in practice, usually while it charges overnight — which is
 *   exactly the moment that matters here, because it is the far side of the night that runs the
 *   plan out. Asking for less than an hour would not buy a single extra run.
 * - **Android** hands it to `WorkManager`, which honours it as a genuine minimum but never below
 *   its own 15-minute floor. An hour is comfortably above that floor, so the OS does not round it,
 *   and it costs at most 24 wakeups a day of work that is a no-op in the steady state: a sync whose
 *   plan has not changed issues zero platform calls (`services/notifications`).
 *
 * The number is not load-bearing. Every consumer has days of headroom — the notification plan five,
 * the widget snapshot fourteen — so this is about never letting a *long* gap open, not about being
 * current to the hour.
 */
export const BACKGROUND_REFRESH_INTERVAL_MINUTES = 60;

/** Whether the OS will run background work for this app. */
export type BackgroundRefreshStatus =
  /** The system will schedule the task. */
  | 'available'
  /**
   * The system will not. On iOS this is Background App Refresh switched off — for the whole phone
   * or for this app alone; on web it is always this. Never presented as the user's fault.
   */
  | 'restricted'
  /** Nothing could be asked: no native module, or the call failed. Renders no verdict at all. */
  | 'unknown';

/** Test seam: the sync functions and the startup work a headless run has to do itself. */
export interface BackgroundRefreshSteps {
  prepareStore?: () => Promise<void> | void;
  prepareLanguage?: () => Promise<void> | void;
  syncNotifications?: () => Promise<unknown>;
  syncWidgetSnapshot?: (options: {
    onBuilt: (snapshot: WidgetSnapshot | null) => void;
  }) => Promise<unknown>;
  syncActivity?: () => Promise<unknown>;
  syncWatchEnvelope?: (options: { snapshot: WidgetSnapshot | null | undefined }) => Promise<unknown>;
}

/**
 * Migrations, then hydration — the headless equivalent of the root layout's `useStartup`.
 *
 * Both halves are idempotent, and both are still guarded. `runMigrations` is safe to repeat
 * (Drizzle skips what its bookkeeping table already records) but still opens the database and
 * reads that table, so there is no reason to pay for it when a live process has already done it.
 * `hydrate` re-reads the exemptions and debts and drops the day cache, which is *correct* but
 * pointless when the app is already running behind us — a background task that runs while the user
 * has the app open would otherwise throw away a cache they are looking at.
 */
async function prepareStore(): Promise<void> {
  if (useTrackingStore.getState().hydrated) return;
  await runMigrations();
  getTrackingActions().hydrate();
}

/**
 * Points i18next at the language the user chose, which is the one the reminders this run schedules
 * will be written in.
 *
 * `initI18n` is idempotent — it returns early once `i18n.isInitialized` — so calling it here and at
 * `src/app/_layout.tsx`'s module scope initialises exactly once whichever of the two the process
 * reaches first. What is *not* shared is the language: the layout resolves the stored preference in
 * an effect, and a headless run has no effects, so without this line every notification written in
 * the background would carry the device's language rather than the user's.
 */
async function prepareLanguage(): Promise<void> {
  initI18n();
  const preference = getSettingsSnapshot().language;
  await applyLanguage(preference === 'system' ? deviceLanguage() : preference);
}

/**
 * Runs one step, and answers whether it got through.
 *
 * @param step - The work.
 * @returns `true` when it completed, `false` when it threw or rejected.
 */
async function attempt(step: () => Promise<unknown> | unknown): Promise<boolean> {
  try {
    await step();
    return true;
  } catch {
    // Deliberately silent. Every step is independent, the run reports its own verdict below, and
    // a background task has nowhere to log that anyone would read.
    return false;
  }
}

/**
 * The whole of a background run: bring the process up, then reconcile everything the OS is holding
 * on the app's behalf.
 *
 * The widget chain is threaded exactly as `hooks/useWidgetSync`'s `run` threads it — `syncWidgets`
 * hands over the 14-day snapshot it built through `onBuilt`, and the watch reuses it instead of
 * building the same thing again. `undefined` (the widget sync returned before building) leaves
 * `syncWatch` to build its own, so nothing here depends on the widget bridge existing.
 *
 * @param steps - Test seams; the task passes none of them.
 * @returns `Success` unless every step failed, which is the only case the OS should be told about.
 */
export async function runBackgroundRefresh(
  steps: BackgroundRefreshSteps = {}
): Promise<BackgroundTask.BackgroundTaskResult> {
  const outcomes: boolean[] = [];

  outcomes.push(await attempt(steps.prepareStore ?? prepareStore));
  outcomes.push(await attempt(steps.prepareLanguage ?? prepareLanguage));

  // Extends the rolling plan AND sweeps the tray — on iOS this is the only moment between two
  // openings of the app at which a delivered notification can be taken away (D165).
  outcomes.push(await attempt(steps.syncNotifications ?? (() => syncNotificationsFromStores())));

  let built: WidgetSnapshot | null | undefined;
  const syncWidgetSnapshot = steps.syncWidgetSnapshot ?? syncWidgets;
  outcomes.push(
    await attempt(() =>
      syncWidgetSnapshot({
        onBuilt: (snapshot) => {
          built = snapshot;
        },
      })
    )
  );
  outcomes.push(await attempt(steps.syncActivity ?? syncLiveActivity));
  const syncWatchEnvelope = steps.syncWatchEnvelope ?? syncWatch;
  outcomes.push(await attempt(() => syncWatchEnvelope({ snapshot: built })));

  return outcomes.some(Boolean)
    ? BackgroundTask.BackgroundTaskResult.Success
    : BackgroundTask.BackgroundTaskResult.Failed;
}

// The definition itself, at module scope, because that is the only place `TaskManager` accepts one:
// on a headless Android launch there is no component tree to run it from. Importing this module is
// therefore a side effect, and the repo-root `index.ts` is what makes it happen before the router
// does anything.
TaskManager.defineTask(BACKGROUND_REFRESH_TASK, () => runBackgroundRefresh());

/**
 * Reads whether the OS will run this app's background work.
 *
 * Same `'unknown'` policy as `services/exactAlarms` and `services/batteryGuidance`: an honest
 * "nothing could be asked" beats a verdict that might be wrong, and the reliability screen renders
 * no card for it.
 *
 * @returns The status; never throws.
 */
export async function readBackgroundRefreshStatus(): Promise<BackgroundRefreshStatus> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Available) return 'available';
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return 'restricted';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Asks the OS to start waking the app. Called once per process, from `hooks/useBackgroundRefresh`.
 *
 * Registration is persistent — `TaskManager` stores it and restores it on the next launch — so
 * repeating it is cheap and harmless, and re-registering is also how a changed
 * {@link BACKGROUND_REFRESH_INTERVAL_MINUTES} would ever reach an installed app.
 *
 * A `'restricted'` status is a no-op rather than an error: on iOS it means the user (or a Low Power
 * Mode) has switched Background App Refresh off, which is their choice, and on web it is simply the
 * platform. The reliability screen is where that gets explained.
 *
 * @returns What happened, for tests and for a caller that wants to log it. Never throws.
 */
export async function registerBackgroundRefresh(): Promise<
  'registered' | 'restricted' | 'unavailable'
> {
  const status = await readBackgroundRefreshStatus();
  if (status !== 'available') return status === 'restricted' ? 'restricted' : 'unavailable';

  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
      minimumInterval: BACKGROUND_REFRESH_INTERVAL_MINUTES,
    });
    return 'registered';
  } catch {
    // A platform that will not take the registration leaves the app exactly as it was before this
    // feature existed: every sync still runs on foreground. Nothing to surface.
    return 'unavailable';
  }
}
