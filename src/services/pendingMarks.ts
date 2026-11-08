/**
 * `services/pendingMarks` — the app's half of "Prayed" pressed on a notification.
 *
 * The native halves (`modules/prayer-marks`) record what the user asserted and get out of the way;
 * `domain/pendingMarks` decides what a batch of those records adds up to. This file is the join:
 * it reads the queue, applies each intent **through `trackingStore.toggleStatus`**, and only then
 * tells the native side to forget it.
 *
 * ## Why the write goes through the store and not around it
 *
 * Everything that makes a logged prayer correct — the Fajr→Fajr day, the qada counters, the audit
 * row, the exempt-day refusal, the cache invalidation that makes the screen redraw — lives behind
 * `setStatus`. A drain that wrote SQL directly would have to reproduce all of it, and would drift.
 * So the drain does exactly what a tap on the seal does, and nothing else (D92).
 *
 * ## Two guards, and what each one is for
 *
 * - **`prayed` is written only over an unlogged prayer.** That is what stops a queue entry from
 *   overwriting a status the user set by hand — a prayer deliberately edited to `late` in History
 *   must not be silently rewritten by a button pressed hours earlier — and it is also what makes
 *   replay a no-op, so a crash mid-drain costs nothing.
 * - **`undo` is written only over a `prayed` prayer.** Same reasoning from the other side: an undo
 *   whose mark was never applied, or whose prayer has since been edited, has nothing to do.
 *
 * Neither is a special rule invented here. `toggleStatus(day, prayer, 'prayed')` sets an unlogged
 * prayer to prayed and clears a prayed one — the seal's own behaviour — so each guard is only
 * deciding *whether* to make the tap the user already made.
 *
 * ## Nothing expires
 *
 * A mark whose prayer day passed weeks ago still applies. The user did pray; the app simply was
 * not opened. Dropping it would be the one thing this feature must never do, and it cannot create
 * a qada debt — only `missed` moves those counters, and this only ever writes `prayed`.
 *
 * Dependency rule: `services → domain + modules`. No React, no SQL, no user-facing strings beyond
 * the ones handed to it for the native copy.
 */

import {
  acknowledgePendingMarks,
  configure as configureNative,
  isSupported,
  readPendingMarks,
  type PrayerMarksCopy,
} from '../../modules/prayer-marks';
import { resolvePendingMarks } from '../domain/pendingMarks';
import { PRAYERS, type DayRecord, type LoggableStatus, type Prayer, type PrayerDay } from '../domain/types';

/** The slice of the tracking store a drain needs. Narrow so a test can pass a plain object. */
export interface PendingMarksTracking {
  /** The day as stored, read through to the database on a cache miss. */
  dayRecordFor(day: PrayerDay): DayRecord;
  /** The seal's own action: choosing a status a prayer already has clears it. */
  toggleStatus(day: PrayerDay, prayer: Prayer, status: LoggableStatus): boolean;
  /** Commits the store's queued writes (D191); `false` when one failed and was rolled back. */
  flushWrites(): boolean;
}

/** The queue, as this file needs it. Defaults to the native module. */
export interface PendingMarksQueue {
  read(): Promise<unknown[]>;
  acknowledge(ids: readonly string[]): Promise<void>;
}

/** Everything a drain needs from the outside world. */
export interface DrainPendingMarksOptions {
  tracking: PendingMarksTracking;
  /** Defaults to the native queue. */
  queue?: PendingMarksQueue;
  /**
   * The prayer day of an instant, for the entry that somehow arrives without one. Asked about the
   * moment the user *decided*, never the moment of the drain — see `domain/pendingMarks`.
   */
  resolveDay?: (instant: Date) => PrayerDay;
}

/** What a drain did. Reported rather than thrown; nothing here is worth failing a launch over. */
export interface DrainOutcome {
  /** Entries read from the queue. */
  read: number;
  /** Writes that actually changed a prayer. */
  applied: number;
  /**
   * Intents that resolved to nothing to do — the prayer was already marked, already cleared, or
   * on an exempt day. Not a failure: the queue said something that is already true.
   */
  skipped: number;
  /** Writes the store refused. The batch is left in the queue and retried on the next drain. */
  failed: number;
  /** Entries the native side was told to forget. */
  acknowledged: number;
}

const EMPTY_OUTCOME: DrainOutcome = { read: 0, applied: 0, skipped: 0, failed: 0, acknowledged: 0 };

/** The native queue, wrapped in the shape {@link DrainPendingMarksOptions} wants. */
const nativeQueue: PendingMarksQueue = {
  read: readPendingMarks,
  acknowledge: acknowledgePendingMarks,
};

/**
 * Applies everything waiting in the queue.
 *
 * Safe to call as often as you like, and safe to call when there is nothing there — it is one
 * native round trip and no writes. Never throws.
 *
 * @param options - The tracking store, and optionally a queue and day resolver.
 * @returns What it did; see {@link DrainOutcome}.
 */
export async function drainPendingMarks(
  options: DrainPendingMarksOptions
): Promise<DrainOutcome> {
  const queue = options.queue ?? nativeQueue;

  let entries: unknown[];
  try {
    entries = await queue.read();
  } catch {
    return EMPTY_OUTCOME;
  }
  if (entries.length === 0) return EMPTY_OUTCOME;

  const { intents, consumed } = resolvePendingMarks(entries, { resolveDay: options.resolveDay });

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const intent of intents) {
    let current;
    try {
      current = options.tracking.dayRecordFor(intent.day).statuses[intent.prayer];
    } catch {
      failed += 1;
      continue;
    }

    // See the module header: each guard decides only *whether* to make the tap, never how.
    const wanted = intent.intent === 'prayed' ? 'unlogged' : 'prayed';
    if (current !== wanted) {
      skipped += 1;
      continue;
    }

    try {
      // A store REFUSAL (returns false — the one policy case is a future day, which an entry can
      // only carry through device clock skew at press time) is the entry's problem, not the
      // database's: it is let go as skipped. Applying it later, when its date arrives, would
      // write a prayer the user never asserted for that day (D06) — and holding it hostage used
      // to jam every OTHER entry's acknowledgment for days. A THROW is different: that is the
      // database in trouble, and the whole batch waits (below).
      if (options.tracking.toggleStatus(intent.day, intent.prayer, 'prayed')) applied += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }

  // A log is accepted at once and written on the next tick (D191). The native side may only
  // forget an entry once its write is really in the database.
  if (!options.tracking.flushWrites()) failed += 1;

  // All or nothing. A write that THREW means something is wrong with the database, not with any
  // entry, so the whole batch waits rather than being half-forgotten — and replaying it costs
  // nothing, because everything that landed is now a no-op.
  let acknowledged = 0;
  if (failed === 0 && consumed.length > 0) {
    try {
      await queue.acknowledge(consumed);
      acknowledged = consumed.length;
    } catch {
      // The entries stay; the next drain resolves them to nothing and clears them.
    }
  }

  return { read: entries.length, applied, skipped, failed, acknowledged };
}

/**
 * Hands the native side the words the confirmation will need, in the current language.
 *
 * Called whenever the notification schedule is rebuilt, which is also whenever the language
 * changes. Never throws.
 *
 * @param translate - The app's translator, e.g. `i18n.t`.
 */
export async function configurePrayerMarks(
  translate: (key: string, params?: Record<string, unknown>) => string
): Promise<void> {
  if (!isSupported()) return;
  const confirmationTitle = Object.fromEntries(
    PRAYERS.map((prayer) => [
      prayer,
      translate('notifications.marked.title', { prayer: translate(`prayers.${prayer}`) }),
    ])
  ) as PrayerMarksCopy['confirmationTitle'];

  await configureNative({
    confirmationTitle,
    testConfirmationTitle: translate('notifications.markedTest.title'),
    undo: translate('notifications.actions.undo'),
    channelName: translate('notifications.channel.marked.name'),
    channelDescription: translate('notifications.channel.marked.description'),
  });
}

/** Whether this build can put a "Prayed" button on a reminder at all. */
export { isSupported as prayerMarksSupported } from '../../modules/prayer-marks';
