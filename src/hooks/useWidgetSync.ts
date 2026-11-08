/**
 * `useWidgetSync` — when the homescreen widgets are told the world changed (D26).
 *
 * `services/widgetSnapshot` decides what widgets say, `services/widgets` ships it; this hook is
 * the *when*, and like its root-layout siblings (`usePendingMarks`, `useNotificationSync`) it
 * belongs to `_layout.tsx`: widgets must stay true whatever screen the app is on.
 *
 * ## The triggers
 *
 * | trigger                     | why                                                          |
 * | --------------------------- | ------------------------------------------------------------ |
 * | startup (after migrations)  | first publish, and the repaint after every app update — the one trigger that waits (see `WIDGET_STARTUP_DELAY_MS`) |
 * | app foreground              | the D92 drain just ran here; marks made from notifications and widgets become real now |
 * | tracking store change       | a log/exempt/qada write — the seals on the widget must match |
 * | settings store change       | location, method, offsets, 12/24h, theme, exemption mode     |
 * | i18n `languageChanged`      | every string in the snapshot is pre-translated               |
 * | system appearance change    | under the "system" theme the widgets' palette follows it, and only a write makes the native side redraw |
 *
 * There is deliberately **no timer**: inside its 14-day horizon a widget keeps itself fresh from
 * the segments the snapshot carries, with no app involvement. The one clock-driven change — the
 * day rolling over while the app sits open — arrives through the tracking store anyway (the
 * today-resolver reloads the new day into the cache).
 *
 * Everything is debounced through one trailing timer: a drain that applies three marks fires the
 * tracking listener three times and must cost one rebuild, not three. The sync itself dedupes
 * against the last shipped payload, so even a redundant trigger costs a build and no bridge call.
 *
 * One rebuild also serves all three consumers: the snapshot `syncWidgets` builds is handed to the
 * watch rather than built again, which is half the work a run used to do.
 */

import { useEffect } from 'react';
import { Appearance, AppState } from 'react-native';

import i18n from '@/i18n';
import { syncLiveActivity } from '@/services/liveActivity';
import { syncWatch, type SyncWatchOptions } from '@/services/watch';
import { syncWidgets, type SyncWidgetsOptions, type WidgetSyncOutcome } from '@/services/widgets';
import { render as renderWidgets } from '../../modules/prayer-widgets';
import { useBuddyStore } from '@/stores/buddyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';

import type { WidgetSnapshot } from '@/services/widgetSnapshot';

/**
 * How long triggers coalesce before one rebuild runs. A full second (was 400ms, D197): a 14-day
 * rebuild on the JS thread landing 400ms after a seal tap was landing on the NEXT tap, for
 * somebody marking several prayers in a row. The homescreen can wait a second.
 */
export const WIDGET_SYNC_DEBOUNCE_MS = 1000;

/**
 * How long the **first** publish of a process waits.
 *
 * The widgets are already showing the snapshot the last run left them, so nothing on the
 * homescreen is wrong while this waits — and the two seconds it gives back are the ones in which
 * the user is tapping their first seal, which is what a 14-day rebuild on the JS thread was
 * delaying. Every later trigger keeps {@link WIDGET_SYNC_DEBOUNCE_MS}.
 *
 * A plain timer, for the reason `useNotificationSync`'s `STARTUP_SYNC_DELAY_MS` gives: RN 0.86's
 * `InteractionManager` is deprecated, waits for nothing any more, and warns when touched.
 */
export const WIDGET_STARTUP_DELAY_MS = 2000;

/** Seams for tests; the app passes none of them. */
export interface WidgetSyncControllerOptions {
  sync?: (options?: SyncWidgetsOptions) => Promise<WidgetSyncOutcome>;
  /** The Live Activity reconciler (D27) — same triggers, same debounce. */
  syncActivity?: () => Promise<unknown>;
  /** The watch-envelope publisher (Milestone V) — same triggers, same debounce. */
  syncWatchEnvelope?: (options?: SyncWatchOptions) => Promise<unknown>;
  debounceMs?: number;
  /**
   * How long the first publish waits. Defaults to {@link WIDGET_STARTUP_DELAY_MS}; `0` starts the
   * ordinary debounce at once, which is what the tests use.
   */
  startupDelayMs?: number;
  /** Redraws the widgets from the stored snapshot (D189). Defaults to the bridge's `render`. */
  redraw?: () => Promise<void>;
  /** Called after every completed sync. Exists so a test can await one. */
  onSynced?: (outcome: WidgetSyncOutcome) => void;
}

/**
 * Starts the widget-sync listeners. Returned stop function removes every subscription and cancels
 * a pending debounce — nothing fires after unmount.
 *
 * @param options - Test seams only.
 * @returns A cleanup function.
 */
export function startWidgetSync(options: WidgetSyncControllerOptions = {}): () => void {
  const sync = options.sync ?? syncWidgets;
  const syncActivity = options.syncActivity ?? syncLiveActivity;
  const syncWatchEnvelope = options.syncWatchEnvelope ?? syncWatch;
  const debounceMs = options.debounceMs ?? WIDGET_SYNC_DEBOUNCE_MS;
  const startupDelayMs = options.startupDelayMs ?? WIDGET_STARTUP_DELAY_MS;
  const redraw = options.redraw ?? renderWidgets;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let rerun = false;

  const run = () => {
    if (stopped) return;
    if (running) {
      // A trigger landed mid-sync: run once more afterwards with the fresher state.
      rerun = true;
      return;
    }
    running = true;
    // The widgets and the watch say the same thing about the same 14 days, and building that
    // twice per run was the single most expensive thing this hook did. `syncWidgets` hands over
    // what it built; `undefined` (it never got as far as building) leaves the watch to build its
    // own, so nothing depends on the widget bridge being present.
    let built: WidgetSnapshot | null | undefined;
    void sync({ onBuilt: (snapshot) => void (built = snapshot) })
      .catch(() => 'unchanged' as const)
      .then(async (outcome) => {
        await syncActivity().catch(() => undefined);
        await syncWatchEnvelope({ snapshot: built }).catch(() => undefined);
        return outcome;
      })
      .then((outcome) => {
        running = false;
        options.onSynced?.(outcome);
        if (rerun && !stopped) {
          rerun = false;
          schedule();
        }
      });
  };

  /** Drops the cold-start wait, if it is still pending. */
  const cancelStartup = () => {
    clearTimeout(startupTimer);
    startupTimer = undefined;
  };

  const schedule = () => {
    if (stopped) return;
    // While the cold-start wait is pending it absorbs every trigger: the startup publish reads
    // the stores when it runs. (Cancelling the wait instead would defeat it on every launch —
    // the pending-marks drain and the language pass both fire triggers in this window.)
    if (startupTimer !== undefined) return;
    clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };

  // Startup publish, without waiting for a change — but deliberately later than every other
  // trigger, so the first seal tap gets the JS thread. See WIDGET_STARTUP_DELAY_MS.
  if (startupDelayMs > 0) {
    startupTimer = setTimeout(() => {
      startupTimer = undefined;
      run();
    }, startupDelayMs);
  } else {
    schedule();
  }

  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    // Redraw at once, before any sync: the sync dedupes an unchanged snapshot, and an unchanged
    // snapshot is the very case where the drawing went stale across a boundary — a countdown run
    // negative while the transition alarm was held back (D189). Native picks the right segment
    // for the current time on every draw.
    void redraw().catch(() => undefined);
    schedule();
  });
  // A system light/dark flip repaints nothing by itself: the snapshot's content is unchanged, so
  // only the sync's appearance-aware dedupe key (services/widgets) turns this into a write.
  const appearance = Appearance.addChangeListener(() => schedule());
  const unsubscribeTracking = useTrackingStore.subscribe(() => schedule());
  const unsubscribeSettings = useSettingsStore.subscribe(() => schedule());
  // The large widget draws buddy badges (D177), so a buddy's mark arriving is a redraw too. Without
  // this a badge appeared only when something else — a mark of your own, a foreground — happened to
  // rewrite the snapshot, which is exactly the delay the first device pass noticed.
  // Only the fields the widgets draw (`services/widgets` `buddyFacesFor`): every other buddy write —
  // the sent ledger, the push token, the invite — would otherwise rebuild fourteen days of
  // snapshot and the watch envelope for nothing (D194).
  const unsubscribeBuddies = useBuddyStore.subscribe((state, previous) => {
    if (
      state.enabled !== previous.enabled ||
      state.day !== previous.day ||
      state.marks !== previous.marks ||
      state.pairs !== previous.pairs
    ) {
      schedule();
    }
  });
  const onLanguage = () => schedule();
  i18n.on('languageChanged', onLanguage);

  return () => {
    stopped = true;
    cancelStartup();
    clearTimeout(timer);
    appState.remove();
    appearance.remove();
    unsubscribeTracking();
    unsubscribeSettings();
    unsubscribeBuddies();
    i18n.off('languageChanged', onLanguage);
  };
}

/**
 * Root-layout hook: keeps the widgets in step with the app.
 *
 * @param ready - Gate on migrations + hydration (`startup.done`), like `usePendingMarks`.
 */
export function useWidgetSync(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    return startWidgetSync();
  }, [ready]);
}
