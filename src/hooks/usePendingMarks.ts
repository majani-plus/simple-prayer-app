/**
 * `usePendingMarks` — the wire between the "Prayed" button on a notification and the database.
 *
 * The native halves record a press with the app gone (`modules/prayer-marks`); `domain/pendingMarks`
 * decides what a batch of those records means; `services/pendingMarks` applies it through the
 * tracking store. None of them knows *when* to look. This module is that answer, and like
 * `useTodayDayResolver` and `useNotificationSync` it belongs to the **root layout**: a mark must
 * land whatever screen the app happens to open on.
 *
 * ## Two triggers, and a third that is not one
 *
 * | trigger        | why                                                                    |
 * | -------------- | ---------------------------------------------------------------------- |
 * | startup        | the ordinary case — the app was killed, the button was pressed, it opens |
 * | app foreground | the phone was unlocked, the shade pulled down, the button pressed, the app returned |
 *
 * There is deliberately **no timer and no polling**. A queue that is never drained is harmless by
 * design: the entries wait, and nothing about them goes stale (`domain/pendingMarks`). Waking the
 * app to check would be work in service of nothing.
 *
 * The startup trigger is gated on `ready`, because a drain before the migrations have run and the
 * tracking store has hydrated would write into a database that is not there yet.
 *
 * ## The copy goes down here too
 *
 * The confirmation notification is composed natively, so its words must already be on disk when
 * the button is pressed. They are pushed on start and again on every language change — the same
 * reason `useNotificationSync` rewrites scheduled notifications when the language changes.
 *
 * Dependency rule: `hooks → stores + services + domain`. No SQL, no user-facing strings.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { getCurrentPrayerDay } from '@/domain/prayerTimes';
import type { PrayerDay } from '@/domain/types';
import i18n from '@/i18n';
import {
  configurePrayerMarks,
  drainPendingMarks,
  type DrainOutcome,
  type PendingMarksQueue,
  type PendingMarksTracking,
} from '@/services/pendingMarks';
import { getSettingsSnapshot } from '@/stores/settingsStore';
import { getTrackingActions } from '@/stores/trackingStore';

/** Seams for the controller's test; the app passes none of them. */
export interface PendingMarkDrainOptions {
  queue?: PendingMarksQueue;
  /** Defaults to the app-wide tracking store. */
  tracking?: PendingMarksTracking;
  /** Defaults to the user's own location and calculation settings. */
  resolveDay?: (instant: Date) => PrayerDay;
  /** Defaults to the app's translator. */
  translate?: (key: string, params?: Record<string, unknown>) => string;
  /** Called after every drain. Exists so a test can await one. */
  onDrained?: (outcome: DrainOutcome) => void;
}

/**
 * The prayer day of an instant, from the user's own location and calculation settings.
 *
 * Only ever used for an entry that arrived without a day of its own, and only ever asked about the
 * instant the user *pressed the button* — never about now. Returns `undefined` when there is no
 * location, which leaves such an entry in the queue for a later drain rather than filing it under
 * a guess (PRODUCT_SPEC §10: the app stays usable with no location at all).
 */
function dayResolver(): ((instant: Date) => PrayerDay) | undefined {
  const settings = getSettingsSnapshot();
  const location = settings.location;
  if (location === null) return undefined;
  return (instant) => getCurrentPrayerDay(instant, location, settings.calculation);
}

/**
 * Starts draining. Returns the stop function.
 *
 * Never throws and never rejects: a failed drain leaves the queue exactly as it was, and the next
 * foreground tries again.
 *
 * @param options - Test seams; the app passes none.
 * @returns The teardown function.
 */
export function startPendingMarkDrain(options: PendingMarkDrainOptions = {}): () => void {
  let disposed = false;

  const pushCopy = () => {
    void configurePrayerMarks(
      options.translate ?? ((key, params) => i18n.t(key, params ?? {}))
    );
  };

  const drain = () => {
    void drainPendingMarks({
      tracking: options.tracking ?? getTrackingActions(),
      queue: options.queue,
      // `dayResolver()` reads the settings store, so it is only reached when nothing was injected.
      resolveDay: options.resolveDay ?? dayResolver(),
    }).then((outcome) => {
      if (!disposed) options.onDrained?.(outcome);
    });
  };

  pushCopy();
  drain();

  const appState = AppState.addEventListener('change', (status) => {
    if (status === 'active') drain();
  });
  const onLanguageChanged = () => pushCopy();
  i18n.on('languageChanged', onLanguageChanged);

  return () => {
    disposed = true;
    appState.remove();
    i18n.off('languageChanged', onLanguageChanged);
  };
}

/**
 * Applies anything the user marked from a notification while the app was closed.
 *
 * Call it once, from the root layout, passing `true` only once the database is ready. It renders
 * nothing and returns nothing.
 *
 * @param ready - Whether the migrations have run and the tracking store has hydrated.
 */
export function usePendingMarks(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    return startPendingMarkDrain();
  }, [ready]);
}
