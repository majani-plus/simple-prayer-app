/**
 * `services/watch` — the impure edge between the app's state and the paired watch (Milestone V).
 *
 * `services/watchEnvelope` decides what the watch will say; this module decides **when to say it
 * again** and carries the result across the bridge (`modules/watch-sync`). It mirrors
 * `services/widgets` deliberately — same triggers (it rides the same debounced hook), same
 * dedupe discipline, same honesty rule: with no location the shipped envelope is CLEARED, so the
 * watch shows its bundled "open the app" state rather than times that describe nothing.
 *
 * One difference from the widgets' dedupe key: no appearance rides in it. The watch canvas is
 * night-paper always (V0a), so a system light/dark flip changes none of its pixels.
 *
 * The envelope wraps the same 14-day snapshot the widgets ship, so when both are published on one
 * run (`useWidgetSync`) the widgets' build is passed in through `options.snapshot` and this
 * module builds nothing. Called on its own, it still builds its own.
 *
 * The D92 family rule holds: this module never writes the prayer log and never schedules
 * anything on the phone. It publishes; the watch reads. (The Wear watch's conditional local
 * alerts are scheduled ON THE WATCH from the envelope's pre-rendered entries — and fire only
 * when the phone is away, so they can never duplicate the phone's own notification.)
 */

import { addDays, todayDay } from '../domain/dates';
import type { Prayer, PrayerDay, PrayerStatus } from '../domain/types';
import i18n from '../i18n';
import { isRtlLanguage } from '../i18n/direction';
import { numericLocale } from '../i18n/numerals';
import * as bridge from '../../modules/watch-sync';
import { getSettingsSnapshot } from '../stores/settingsStore';
import { displayStatuses, modeViewFor } from '../domain/trackingMode';
import { getTrackingActions, resolvePrayerDay } from '../stores/trackingStore';
import { buildWatchEnvelope, type WatchEnvelope } from './watchEnvelope';
import { buildWidgetSnapshot, type WidgetSnapshot } from './widgetSnapshot';

/** The bridge as this module needs it — a seam for tests, the real module by default. */
export interface WatchBridge {
  isSupported(): boolean;
  pushEnvelope(json: string): Promise<void>;
  clearEnvelope(): Promise<void>;
}

/** What a sync did, for tests and for the hook's logging. */
export type WatchSyncOutcome = 'unsupported' | 'written' | 'cleared' | 'unchanged';

/** Seams for tests; the app passes none of them. */
export interface SyncWatchOptions {
  now?: Date;
  bridge?: WatchBridge;
  translate?: (key: string, params?: Record<string, unknown>) => string;
  /** Defaults to the live settings store snapshot. */
  settings?: ReturnType<typeof getSettingsSnapshot>;
  /** Defaults to the live tracking store. */
  tracking?: {
    hydrated: boolean;
    loadRange: (from: PrayerDay, to: PrayerDay) => unknown;
    dayRecordFor: (day: PrayerDay) => { statuses: Record<Prayer, PrayerStatus> } | undefined;
    isExemptDay: (day: PrayerDay) => boolean;
  };
  /** Called with what was built, so a test can assert on content without parsing the JSON. */
  onBuilt?: (envelope: WatchEnvelope | null) => void;
  /**
   * A 14-day snapshot already built for this instant — `services/widgets`' own, passed on by
   * `useWidgetSync` so one run builds it once. `null` carries the same meaning it has there: the
   * sky could not be resolved, so there is nothing to send and the envelope is cleared. Omit it
   * (`undefined`) and this builds its own, which is what every caller outside that hook does.
   */
  snapshot?: WidgetSnapshot | null;
}

/**
 * The last JSON shipped; `undefined` means this process has never reconciled — the first pass
 * always speaks to the bridge, because the watch may still hold a previous process's envelope
 * whose world (a location, since revoked) no longer exists. The tri-state of `widgets.ts`.
 */
let lastShipped: string | null | undefined;

/** Test-only: forget the dedupe state. */
export function resetWatchSyncMemory(): void {
  lastShipped = undefined;
}

/**
 * Rebuilds the watch envelope from live state and ships it across the bridge.
 *
 * @param options - Test seams only.
 * @returns What happened, so callers can log or await it.
 */
export async function syncWatch(options: SyncWatchOptions = {}): Promise<WatchSyncOutcome> {
  const bridgeImpl = options.bridge ?? bridge;
  if (!bridgeImpl.isSupported()) return 'unsupported';

  const settings = options.settings ?? getSettingsSnapshot();
  const tracking = options.tracking ?? getTrackingActions();
  const translate =
    options.translate ??
    ((key: string, params?: Record<string, unknown>) => i18n.t(key, params ?? {}));
  const now = options.now ?? new Date();
  const modeView = modeViewFor(settings, resolvePrayerDay(settings, now), now.getTime());
  const language = i18n.language ?? 'en';

  // An unhydrated store is "too early", not "no data" — it must not wipe a good envelope.
  if (settings.location !== null && !tracking.hydrated) return 'unchanged';

  let envelope: WatchEnvelope | null = null;
  if (settings.location !== null) {
    // The shared build already loaded the days it needed and answers for the same instant, so
    // both the load and the build are skipped when one was handed in.
    let snapshot = options.snapshot;
    if (snapshot === undefined) {
      try {
        const calendarToday = todayDay(now);
        tracking.loadRange(addDays(calendarToday, -2), calendarToday);
      } catch {
        // Mid-migration loads still produce an envelope; statuses default to unlogged and the
        // next sync after hydration repaints them (widgets.ts, same reasoning).
      }
      snapshot = buildWidgetSnapshot(
        { now, location: settings.location, calculation: settings.calculation },
        {
          translate,
          language,
          numericLocale: numericLocale(language),
          rtl: isRtlLanguage(language),
          timeFormat: settings.timeFormat,
          theme: settings.theme,
          hijriOffset: settings.calculation.hijriOffset,
          // As the tracking mode SHOWS them (D192): in simple mode a closed, unmarked prayer reads
          // as missed and a late one as prayed. The snapshot's shape does not change; measured at
          // `now`, the instant this snapshot is built for.
          statusesFor: (day) => {
            try {
              const statuses = tracking.dayRecordFor(day)?.statuses;
              if (statuses === undefined) return undefined;
              return displayStatuses(day, statuses, tracking.isExemptDay(day), modeView);
            } catch {
              return undefined;
            }
          },
          isExemptDay: (day) => {
            try {
              return tracking.isExemptDay(day);
            } catch {
              return false;
            }
          },
        }
      );
    }
    if (snapshot !== null) {
      const adhanEnabled = {} as Record<Prayer, boolean>;
      for (const prayer of Object.keys(settings.reminders) as Prayer[]) {
        adhanEnabled[prayer] = settings.reminders[prayer].adhanEnabled;
      }
      envelope = buildWatchEnvelope(
        { snapshot, now, location: settings.location, adhanEnabled },
        { translate }
      );
    }
  }

  options.onBuilt?.(envelope);

  if (envelope === null) {
    if (lastShipped === null) return 'unchanged';
    lastShipped = null;
    await bridgeImpl.clearEnvelope();
    return 'cleared';
  }

  // `generatedAt` (inside the wrapped snapshot) changes every build; compare everything but it.
  const json = JSON.stringify(envelope);
  const comparable = JSON.stringify({
    ...envelope,
    snapshot: { ...envelope.snapshot, generatedAt: 0 },
  });
  if (comparable === lastShipped) return 'unchanged';
  await bridgeImpl.pushEnvelope(json);
  lastShipped = comparable;
  return 'written';
}
