/**
 * The two ways to log a prayer (D192) — and the one place that decides what a stored status
 * LOOKS like under each.
 *
 * - **Detailed** is the app as it always was: prayed / late / missed, three choices, and a prayer
 *   nobody marked simply stays "not marked" (D06). Every function here is the identity for it.
 * - **Simple** is one tap: prayed ↔ not marked. A prayer left unmarked shows as **missed once its
 *   time has passed**, and a prayer stored `late` shows as **prayed** (there is no "late" to pick).
 *
 * ## Display only — nothing is written
 *
 * Simple mode never writes `missed`. The seal stores `prayed` or nothing (`simpleTapTarget`), and
 * everything this module does is applied when a record is READ — by the screens, by the stats, by
 * the widget snapshot. So switching modes changes no stored prayer data at all, in either
 * direction, and switching back to detailed shows the log exactly as it was. This amends D06
 * ("nothing auto-marks missed") for display only.
 *
 * Three guards keep the display merciful:
 *
 * 1. **Only days on or after `since`** — the prayer day simple mode was turned on — can show an
 *    unmarked prayer as missed. Old history is never painted red by changing a setting.
 * 2. **Only once the prayer's time has ended.** A prayer whose time is still open is "not yet",
 *    never missed. Past prayer days are closed entirely; today is decided per prayer by its
 *    window (`domain/windows`), measured by the caller at an instant it chooses.
 * 3. **Exempt stays exempt.** An excused day never shows a miss.
 *
 * ## Qada (owner: "qada too")
 *
 * The misses simple mode SHOWS are owed like any other, so the qada screen counts them:
 * `shown = stored + max(0, derived − madeUp)`, per prayer. `derived` is {@link derivedMisses};
 * `madeUp` is a counter in settings (`simpleQadaMadeUp`), because a derived miss has no row to
 * stamp. Making one up takes the STORED debt first and only then the counter
 * ({@link makeUpSource}); putting one back reverses that order ({@link putBackSource}). The shown
 * number can never drop below the stored debt, and never below zero.
 *
 * Streaks need nothing from here: `streaks.classifyDay` already treats `unlogged` exactly like
 * `missed` and `late` exactly like `prayed`, so the mapping cannot change a verdict (the tests pin
 * that).
 *
 * Pure: no React, no clock, no store read. Callers hand in a {@link ModeView} — built by
 * {@link modeViewFor}, whose one-entry memo of today's windows changes no answer, it only spares
 * the engine a re-run on every render.
 */

import { isBeforeDay, isSameDay } from './dates';
import { getPrayerWindows } from './prayerTimes';
import { emptyDebts } from './qada';
import { isWindowClosed } from './windows';
import {
  PRAYERS,
  type AppLocation,
  type AppSettings,
  type CalculationSettings,
  type DayRecord,
  type Prayer,
  type PrayerDay,
  type PrayerStatus,
  type PrayerWindow,
  type QadaDebts,
  type TrackingMode,
} from './types';

/** What {@link displayStatus} needs to know about one prayer on one day. */
export interface DisplayContext {
  /** The prayer's time has ended. */
  windowClosed: boolean;
  /** The day is excused. */
  isExempt: boolean;
  /** The day is on or after the day simple mode was turned on. */
  onOrAfterSince: boolean;
}

/** Everything the record-level helpers need, measured once by the caller. */
export interface ModeView {
  mode: TrackingMode;
  /** `simpleModeSince`; `null` means no day can show a derived miss. */
  since: PrayerDay | null;
  /** The current prayer day. */
  today: PrayerDay;
  /** Today's prayers whose time has already ended, at the instant the view was taken. */
  closedToday: readonly Prayer[];
}

/**
 * The status to SHOW for a stored one.
 *
 * @param stored - What the log holds (`unlogged` for no row).
 * @param ctx - Whether the time has ended, the day is exempt, and the day is on or after `since`.
 * @param mode - The tracking mode.
 * @returns `stored` unchanged in detailed mode; in simple mode `late` → `prayed`, and `unlogged`
 *   → `missed` when the time has ended on a non-exempt day on or after `since`.
 */
export function displayStatus(
  stored: PrayerStatus,
  ctx: DisplayContext,
  mode: TrackingMode
): PrayerStatus {
  if (mode === 'detailed') return stored;
  switch (stored) {
    case 'late':
      return 'prayed';
    case 'unlogged':
      return !ctx.isExempt && ctx.windowClosed && ctx.onOrAfterSince ? 'missed' : 'unlogged';
    case 'prayed':
    case 'missed':
    case 'exempt':
      return stored;
    default: {
      const unreachable: never = stored;
      throw new RangeError(`Unknown prayer status: ${String(unreachable)}`);
    }
  }
}

/**
 * Which of today's prayers have ended at `nowMs`.
 *
 * @param windows - Today's five windows (`prayerTimes.getPrayerWindows`).
 * @param nowMs - The instant, epoch ms.
 * @returns The prayers whose window is closed (half-open, as `windows.isWindowClosed`).
 */
export function closedPrayersAt(windows: readonly PrayerWindow[], nowMs: number): Prayer[] {
  return windows.filter((window) => isWindowClosed(window, nowMs)).map((window) => window.prayer);
}

/**
 * Whether a prayer's time has ended, as far as the view knows: every prayer of a past prayer day,
 * today's per {@link ModeView.closedToday}, and nothing in the future.
 */
export function isClosedOn(day: PrayerDay, prayer: Prayer, view: ModeView): boolean {
  if (isBeforeDay(day, view.today)) return true;
  return isSameDay(day, view.today) && view.closedToday.includes(prayer);
}

function contextFor(record: DayRecord, prayer: Prayer, view: ModeView): DisplayContext {
  return {
    windowClosed: isClosedOn(record.day, prayer, view),
    isExempt: record.isExempt,
    onOrAfterSince: view.since !== null && !isBeforeDay(record.day, view.since),
  };
}

/**
 * A record as it should be SHOWN.
 *
 * @param record - The stored record.
 * @param view - The mode and the moment.
 * @returns The same object when nothing changes (always, in detailed mode), so memoised readers
 *   downstream keep their identity; otherwise a copy with the mapped statuses.
 */
export function displayRecord(record: DayRecord, view: ModeView): DayRecord {
  if (view.mode === 'detailed') return record;
  let statuses: Record<Prayer, PrayerStatus> | null = null;
  for (const prayer of PRAYERS) {
    const stored = record.statuses[prayer];
    const shown = displayStatus(stored, contextFor(record, prayer, view), view.mode);
    if (shown === stored) continue;
    statuses ??= { ...record.statuses };
    statuses[prayer] = shown;
  }
  return statuses === null ? record : { ...record, statuses };
}

/**
 * {@link displayRecord} for callers that hold only a day's statuses (the widget snapshot).
 *
 * @returns The shown statuses; the same object when nothing changes.
 */
export function displayStatuses(
  day: PrayerDay,
  statuses: Record<Prayer, PrayerStatus>,
  isExempt: boolean,
  view: ModeView
): Record<Prayer, PrayerStatus> {
  return displayRecord({ day, statuses, madeUp: {}, isExempt }, view).statuses;
}

/**
 * Simple mode's misses that exist only on screen: stored `unlogged`, shown `missed`.
 *
 * @param records - Dense day records (a missing day is not counted — pass every day).
 * @param view - The mode and the moment.
 * @returns A count per prayer; all zero in detailed mode.
 */
export function derivedMisses(records: readonly DayRecord[], view: ModeView): QadaDebts {
  const counts = emptyDebts();
  if (view.mode !== 'simple') return counts;
  for (const record of records) {
    for (const prayer of PRAYERS) {
      if (record.statuses[prayer] !== 'unlogged') continue;
      if (displayStatus('unlogged', contextFor(record, prayer, view), view.mode) === 'missed') {
        counts[prayer] += 1;
      }
    }
  }
  return counts;
}

/**
 * The qada counters simple mode shows: `stored + max(0, derived − madeUp)` per prayer.
 *
 * A `madeUp` that has grown past `derived` (a shown miss was later marked prayed in History) adds
 * nothing and takes nothing: the shown debt never drops below what is stored.
 */
export function simpleQadaDebts(
  stored: QadaDebts,
  derived: QadaDebts,
  madeUp: Readonly<Record<Prayer, number>>
): QadaDebts {
  const shown = emptyDebts();
  for (const prayer of PRAYERS) {
    shown[prayer] = stored[prayer] + Math.max(0, derived[prayer] - madeUp[prayer]);
  }
  return shown;
}

/**
 * Where a "made up" on the qada screen should land in simple mode: the stored debt first (it is
 * the one with events and a pace), then the counter.
 *
 * @returns `'stored'`, `'counter'`, or `null` when nothing is owed for that prayer.
 */
export function makeUpSource(
  stored: QadaDebts,
  shown: QadaDebts,
  prayer: Prayer
): 'stored' | 'counter' | null {
  if (stored[prayer] > 0) return 'stored';
  if (shown[prayer] > stored[prayer]) return 'counter';
  return null;
}

/**
 * Where "owe one more" should land in simple mode — the reverse order of {@link makeUpSource}, so
 * it undoes the last make-up: the counter first, while it is still absorbing a shown miss.
 */
export function putBackSource(
  derived: QadaDebts,
  madeUp: Readonly<Record<Prayer, number>>,
  prayer: Prayer
): 'counter' | 'stored' {
  return Math.min(madeUp[prayer], derived[prayer]) > 0 ? 'counter' : 'stored';
}

/**
 * What one tap on a simple-mode seal stores: a prayer that shows as prayed (stored `prayed` or
 * `late`) is cleared; anything else is marked `prayed`. Never `late`, never `missed`.
 */
export function simpleTapTarget(stored: PrayerStatus): 'prayed' | 'unlogged' {
  return stored === 'prayed' || stored === 'late' ? 'unlogged' : 'prayed';
}

/** A stable string for a view, for memo keys. */
export function modeViewKey(view: ModeView): string {
  return `${view.mode}:${String(view.since)}:${view.today}:${view.closedToday.join(',')}`;
}

/** Today's windows, memoised on the day and the identities of location and calculation. */
let windowsCache: {
  today: PrayerDay;
  location: AppLocation;
  calculation: CalculationSettings;
  windows: PrayerWindow[];
} | null = null;

/**
 * The {@link ModeView} for `settings` at `nowMs` — the tracking mode, `simpleModeSince`, and which
 * of today's prayers have already ended (D192). Shared by the store's derived selectors, the
 * screens (`hooks/useTrackingModeView`) and the widget snapshot, so all three draw the same line.
 *
 * Detailed mode needs no times at all. Without a location, or with a sky the engine cannot solve,
 * no prayer of TODAY counts as ended — past days still do — because a prayer we cannot place in
 * time is never shown as missed on a guess.
 *
 * @param settings - The settings snapshot.
 * @param today - The current prayer day.
 * @param nowMs - The instant, epoch ms.
 */
export function modeViewFor(settings: AppSettings, today: PrayerDay, nowMs: number): ModeView {
  const base = { mode: settings.trackingMode, since: settings.simpleModeSince, today };
  if (settings.trackingMode !== 'simple' || settings.location === null) {
    return { ...base, closedToday: [] };
  }
  const cached = windowsCache;
  let windows: PrayerWindow[];
  if (
    cached !== null &&
    cached.today === today &&
    cached.location === settings.location &&
    cached.calculation === settings.calculation
  ) {
    windows = cached.windows;
  } else {
    try {
      windows = getPrayerWindows(today, settings.location, settings.calculation);
    } catch {
      return { ...base, closedToday: [] };
    }
    windowsCache = {
      today,
      location: settings.location,
      calculation: settings.calculation,
      windows,
    };
  }
  return { ...base, closedToday: closedPrayersAt(windows, nowMs) };
}
