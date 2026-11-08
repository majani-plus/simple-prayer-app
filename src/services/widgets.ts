/**
 * `services/widgets` — the impure edge between the app's state and the homescreen widgets (D26).
 *
 * `services/widgetSnapshot` decides what the widgets will say; this module decides **when to say
 * it again** and carries the result across the bridge (`modules/prayer-widgets`). It reads the
 * stores, renders the snapshot, and skips the write when nothing changed — a widget redraw is
 * cheap but not free, and the tracking store announces itself on every loaded day.
 *
 * The one rule inherited from the D92 family: this module never writes the prayer log and never
 * schedules anything. It publishes; the widgets read.
 */

import { buddyInitials } from '@/domain/buddies';
import { useBuddyStore } from '@/stores/buddyStore';
import { Appearance } from 'react-native';

import { addDays, todayDay } from '../domain/dates';
import { PRAYERS, type Prayer, type PrayerDay, type PrayerStatus } from '../domain/types';
import i18n from '../i18n';
import { isRtlLanguage } from '../i18n/direction';
import { numericLocale } from '../i18n/numerals';
import * as bridge from '../../modules/prayer-widgets';
import { getSettingsSnapshot } from '../stores/settingsStore';
import { displayStatuses, modeViewFor } from '../domain/trackingMode';
import { getTrackingActions, resolvePrayerDay } from '../stores/trackingStore';
import { buildWidgetSnapshot, type WidgetBuddy, type WidgetSnapshot } from './widgetSnapshot';

/** The bridge as this module needs it — a seam for tests, the real module by default. */
export interface WidgetsBridge {
  isSupported(): boolean;
  writeSnapshot(json: string): Promise<void>;
  clearSnapshot(): Promise<void>;
}

/** What a sync did, for tests and for the hook's logging. */
export type WidgetSyncOutcome = 'unsupported' | 'written' | 'cleared' | 'unchanged';

/** Seams for tests; the app passes none of them. */
export interface SyncWidgetsOptions {
  now?: Date;
  bridge?: WidgetsBridge;
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
  /**
   * Called with what was built, so a test can assert on content without parsing the JSON — and,
   * in the app, how `useWidgetSync` gets one 14-day snapshot to hand on to the watch instead of
   * having `syncWatch` build the same thing again. Not called at all when this returns before the
   * build (`unsupported`, or a store too early to read), which is what leaves the watch to build
   * its own.
   */
  onBuilt?: (snapshot: WidgetSnapshot | null) => void;
  /** The resolved system appearance; defaults to `Appearance.getColorScheme()`. */
  colorScheme?: 'light' | 'dark' | null;
}

/**
 * The last JSON shipped, so an unchanged rebuild costs no bridge call. `undefined` means this
 * process has never reconciled — the first pass always speaks to the bridge, because a widget
 * may still be showing a previous process's snapshot whose world (a location, since revoked)
 * no longer exists. Same tri-state as `liveActivity.ts`, for the same reason.
 */
let lastShipped: string | null | undefined;

/** Test-only: forget the dedupe state. */
export function resetWidgetSyncMemory(): void {
  lastShipped = undefined;
}

/**
 * Rebuilds the widget snapshot from live state and ships it across the bridge.
 *
 * Honesty over availability: with no location (or a sky the engine cannot solve) the stored
 * snapshot is CLEARED, so the widgets show their bundled "open the app" state rather than times
 * that no longer describe anything (`widgetSnapshot`'s staleness contract).
 *
 * @param options - Test seams only.
 * @returns What happened, so callers can log or await it.
 */
export async function syncWidgets(options: SyncWidgetsOptions = {}): Promise<WidgetSyncOutcome> {
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

  // No location means the times a widget shows would describe nothing — clear, honestly. An
  // unhydrated store is different: the data exists, this call is just too early, so it must not
  // wipe a good snapshot it cannot rebuild yet.
  if (settings.location !== null && !tracking.hydrated) return 'unchanged';

  let snapshot: WidgetSnapshot | null = null;
  if (settings.location !== null) {
    // Statuses live in the store's day cache; make sure the days a widget shows as *logged*
    // (yesterday spills into today via Isha; today is the one being tapped) are actually loaded.
    // Future days need no load: absence of a row IS unlogged (D06).
    try {
      const calendarToday = todayDay(now);
      tracking.loadRange(addDays(calendarToday, -2), calendarToday);
    } catch {
      // A store that cannot load (mid-migration) still gets a snapshot: statuses default to
      // unlogged, and the next sync after hydration repaints them.
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
        buddiesFor: (day) => {
          try {
            return buddyFacesFor(day);
          } catch {
            // A widget that cannot resolve buddies simply has none. Nothing else about it changes.
            return undefined;
          }
        },
        isExemptDay: (day) => {
          try {
            return tracking.isExemptDay(day);
          } catch {
            // Fail toward NOT exempt: quiet dashes for everyone beat crescents for someone who
            // never turned the mode on — and the next sync after hydration repaints either way.
            return false;
          }
        },
      }
    );
  }

  options.onBuilt?.(snapshot);

  if (snapshot === null) {
    // On the process's first reconcile (`undefined`) the clear always goes out — see lastShipped.
    if (lastShipped === null) return 'unchanged';
    lastShipped = null;
    await bridgeImpl.clearSnapshot();
    return 'cleared';
  }

  // `generatedAt` changes every build; compare everything but it, or nothing would ever dedupe.
  // The RESOLVED appearance rides in the key even though it is not in the payload: across a
  // system light/dark flip the snapshot is byte-identical, but the pixels are not — the native
  // side reads uiMode at draw time, and only a write makes it draw. Without this, the repaint an
  // app open owes the widgets after a flip was deduped away, and they held the old palette until
  // the next prayer transition (found on the emulator, 2026-08-25).
  const appearance =
    snapshot.theme === 'system'
      ? ((options.colorScheme !== undefined ? options.colorScheme : Appearance.getColorScheme()) ?? 'light')
      : snapshot.theme;
  const json = JSON.stringify(snapshot);
  const comparable = JSON.stringify({ ...snapshot, generatedAt: 0, appearance });
  if (comparable === lastShipped) return 'unchanged';
  await bridgeImpl.writeSnapshot(json);
  lastShipped = comparable;
  return 'written';
}

/**
 * Today's buddies, resolved to faces for the large widget (D177).
 *
 * Everything here is local: the colour, the letters and the glyph were all chosen by the person
 * holding this phone. No name and nothing that came off the wire crosses into the snapshot — a
 * widget is read at arm's length, and a name on one is a name anybody in the room can read.
 *
 * Answers `undefined` when buddy mode is off, which keeps the field out of the snapshot entirely
 * for the overwhelming majority of installs.
 */
function buddyFacesFor(day: PrayerDay): Partial<Record<Prayer, WidgetBuddy[]>> | undefined {
  const state = useBuddyStore.getState();
  if (!state.enabled || state.pairs.length === 0) return undefined;
  if (state.day !== day) return undefined;

  const faces: Partial<Record<Prayer, WidgetBuddy[]>> = {};
  let any = false;
  for (const prayer of PRAYERS) {
    const ids = state.marks[prayer];
    if (ids.length === 0) continue;
    const row = state.pairs
      .filter((pair) => ids.includes(pair.pairId))
      // Letters whatever face they wear in the app — see `WidgetBuddy`. A buddy with no name yet
      // gets the dots the app shows them with, rather than an empty disc.
      .map((pair) => ({ color: pair.color, initials: buddyInitials(pair.nickname) }));
    if (row.length === 0) continue;
    faces[prayer] = row;
    any = true;
  }
  return any ? faces : undefined;
}
