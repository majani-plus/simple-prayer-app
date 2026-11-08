/**
 * `domain/pendingMarks` — what the "Prayed" button on a notification actually means by the time
 * the app gets to read it.
 *
 * ## Why a queue exists at all
 *
 * Pressing **Prayed** on the adhan notification has to work with the app's process gone. Writing
 * the prayer log from native code would mean a second copy of every rule this project owns —
 * prayer days, qada, streaks, exempt days — so the native handler does the one cheap thing it can
 * do honestly instead: it **appends what the user asserted** to a tiny queue (SharedPreferences on
 * Android, an App Group `UserDefaults` on iOS) and gets out of the way. The app drains that queue
 * on its next launch through `trackingStore.toggleStatus`, so the real write is performed by the
 * code that already owns every rule. See D92.
 *
 * This module is the pure half: it turns a bag of queue entries into **at most one intent per
 * prayer**, and decides nothing else. It has no idea where the entries came from and never touches
 * the database.
 *
 * ## Undo, and why nothing is ever un-written
 *
 * The confirmation notification carries an **Undo**. Pressing it does not reach back into anything
 * — it appends a *second* entry naming the first ({@link PendingMark.annuls}). Two cases follow,
 * and {@link resolvePendingMarks} is the whole of the difference:
 *
 * - **Both entries drain together** (the usual case — the app was not opened in between). They
 *   cancel: no intent at all, and nothing was ever written to undo.
 * - **The undo drains alone**, because the app was opened and drained between the two presses.
 *   Its target is not in the batch, so it becomes an `undo` intent, which clears a prayer that is
 *   currently `prayed` back to unlogged. That is a real write, and the right one: the user has
 *   said twice, deliberately, that they did not mean it.
 *
 * ## Idempotency without a ledger
 *
 * Entries are acknowledged only after their writes land, so a crash mid-drain replays them. That
 * is safe by construction rather than by bookkeeping: the applier writes `prayed` **only over an
 * unlogged prayer** and `unlogged` **only over a prayed one**, so the second pass finds the work
 * already done and does nothing. The same guard is what stops a stale queue entry from clobbering
 * a status the user set in the app by hand, which matters more — a prayer someone deliberately
 * edited to `late` in History must not be silently rewritten by a button they pressed hours ago.
 *
 * Dependency rule: pure TypeScript. No React, no RN, no SQL.
 */

import { isValidDay } from './dates';
import { PRAYERS, type Prayer, type PrayerDay, type PrayerStatus } from './types';

// ---------------------------------------------------------------------------
// The queue entry
// ---------------------------------------------------------------------------

/**
 * One thing the user asserted from a notification, exactly as the native handler wrote it.
 *
 * Deliberately flat and dumb: a handful of fields, no schema, no migration story. Anything richer
 * would be a second model of the domain living outside `src/domain`, which is the one thing this
 * design exists to avoid.
 */
export interface PendingMark {
  /**
   * Unique, and the only reason entries have identity: an {@link annuls} entry names one, and the
   * drain acknowledges consumed entries by it. Written natively from the notification's identifier
   * and the instant of the press, and never parsed — treat it as opaque.
   */
  id: string;
  /**
   * The prayer day the notification was *for*, carried straight from its payload.
   *
   * **Not** re-derived from {@link decidedAt}. The payload's day is the answer `domain/dates`
   * already gave when the reminder was planned, and it stays right in the case that would break a
   * re-derivation: a notification still sitting on an iPhone's lock screen the next morning is
   * about the prayer it announced, not about the day the user got round to pressing the button.
   *
   * Absent only if a payload ever arrives without one, which is what
   * {@link ResolvePendingMarksOptions.resolveDay} is for.
   */
  day?: PrayerDay;
  prayer: Prayer;
  /** Epoch ms of the press. The honest record of when the user asserted it; also orders the batch. */
  decidedAt: number;
  /** Set only on an undo: the {@link id} of the mark this entry cancels. */
  annuls?: string;
  /**
   * Set only by a widget seal-tap that toggles OFF a prayer whose `prayed` came from the app
   * itself (D26): there is no queue entry to {@link annuls}, because the mark it cancels lives in
   * the database. A `clears` entry asserts "not prayed after all" in its own right and resolves as
   * an `undo` intent, which the drain applies only over a prayer that is still `prayed` — so a
   * stale clear can never erase a status the user has since set by hand.
   *
   * A widget toggling off a mark that IS still in the queue also writes `clears` rather than
   * `annuls`: per-prayer last-decision-wins collapses the pair to a single `undo`, which the drain
   * then finds nothing to clear. Same net effect as annulment, and the native side never has to
   * read the queue to find an id.
   */
  clears?: boolean;
  /**
   * The confirmation notification this entry put in the tray, so the drain can take it back out.
   * Absent when none was posted.
   */
  confirmationId?: string;
}

/** What a batch of entries adds up to for one prayer. */
export interface MarkIntent {
  day: PrayerDay;
  prayer: Prayer;
  /**
   * `prayed` — the user pressed the button; write it if the prayer is still unlogged.
   * `undo` — an undo whose target was drained in an earlier batch; clear it if it is still `prayed`.
   */
  intent: 'prayed' | 'undo';
  /** When the user decided, not when the app drained. */
  decidedAt: number;
}

/** How to date an entry that arrived without a day of its own. */
export interface ResolvePendingMarksOptions {
  /**
   * The prayer day of an instant, normally `getCurrentPrayerDay` bound to the user's location and
   * calculation settings.
   *
   * It is asked about **`decidedAt`**, never about the moment of the drain: someone who presses
   * Prayed at Maghrib and opens the app after midnight must have it filed against the prayer day
   * they were living in, and between midnight and Fajr that is still yesterday's date
   * (PRODUCT_SPEC §3). `domain/dates` stays the sole owner of that boundary — nothing native, and
   * nothing here, applies it a second time.
   *
   * May throw (no location yet, a polar Fajr). An entry that cannot be dated is **left in the
   * queue** rather than dropped or guessed at: it costs a few bytes and the next drain, with a
   * location, files it correctly.
   */
  resolveDay?: (instant: Date) => PrayerDay;
}

/** The whole of a drain's decision. */
export interface PendingMarkResolution {
  /** At most one per `(day, prayer)`, ordered by `decidedAt`. */
  intents: MarkIntent[];
  /**
   * Every entry the batch accounts for, including the ones that cancelled each other and the
   * malformed ones. All of them are acknowledged: an entry left behind would be re-resolved for
   * ever. Entries that could not be dated are deliberately NOT here — see
   * {@link ResolvePendingMarksOptions.resolveDay}.
   */
  consumed: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PRAYER_SET = new Set<string>(PRAYERS);

/**
 * Whether a value is an entry this build can act on.
 *
 * Anything else is dropped rather than repaired. The queue crosses a native boundary and outlives
 * app versions, so "I do not understand this" is a case that has to exist — and a mark nobody can
 * read is not worth guessing at.
 *
 * @param value - A parsed queue entry, or whatever the native side handed over.
 * @returns `true` when the fields this build needs are present and well-formed.
 */
export function isPendingMark(value: unknown): value is PendingMark {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id === '') return false;
  if (typeof record.prayer !== 'string' || !PRAYER_SET.has(record.prayer)) return false;
  if (typeof record.decidedAt !== 'number' || !Number.isFinite(record.decidedAt)) return false;
  if (record.day !== undefined && (typeof record.day !== 'string' || !isValidDay(record.day))) {
    return false;
  }
  if (record.annuls !== undefined && typeof record.annuls !== 'string') return false;
  if (record.clears !== undefined && typeof record.clears !== 'boolean') return false;
  if (record.confirmationId !== undefined && typeof record.confirmationId !== 'string') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Oldest first, with `id` breaking a tie so the result never depends on storage order. */
function byDecidedAt(a: PendingMark, b: PendingMark): number {
  if (a.decidedAt !== b.decidedAt) return a.decidedAt - b.decidedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Reduces a queue batch to the writes it actually asks for.
 *
 * Three passes, and each one exists for a case that really happens:
 *
 * 1. **Cancel out.** An undo whose target is in this batch removes both entries. The common undo
 *    never becomes a write at all, which is the point of queueing rather than writing.
 * 2. **Keep the orphan undo.** An undo whose target is *not* here was written after that target
 *    had already been drained, so it has real work to do.
 * 3. **One intent per prayer.** Whatever survives, the last decision wins — a user who pressed
 *    Prayed, undid it, and pressed it again means the third press.
 *
 * Nothing here looks at how old an entry is. A mark whose prayer day passed weeks ago still
 * applies: the user did pray, and `setStatus` refuses only *future* days. Expiring it would throw
 * away the one thing the queue exists to keep (D92).
 *
 * @param entries - The queue as read, in any order. Malformed entries are consumed and ignored.
 * @param options - How to date an entry that has no day of its own.
 * @returns The intents to apply and every entry id to acknowledge afterwards.
 */
export function resolvePendingMarks(
  entries: readonly unknown[],
  options: ResolvePendingMarksOptions = {}
): PendingMarkResolution {
  const dated: (PendingMark & { day: PrayerDay })[] = [];
  const consumed: string[] = [];
  const undatable = new Set<string>();

  for (const entry of entries) {
    if (!isPendingMark(entry)) {
      // Unreadable, but still take it out of the queue if it at least has an id to name.
      const id = (entry as { id?: unknown } | null)?.id;
      if (typeof id === 'string' && id !== '') consumed.push(id);
      continue;
    }
    const day = entry.day ?? dayOf(entry.decidedAt, options.resolveDay);
    if (day === null) {
      undatable.add(entry.id);
      continue;
    }
    dated.push({ ...entry, day });
    consumed.push(entry.id);
  }

  const present = new Set(dated.map((mark) => mark.id));
  const annulled = new Set<string>();
  for (const mark of dated) {
    // An undo whose target is still waiting to be dated must not resolve as an orphan — it would
    // clear a prayer whose own mark has not been applied yet. Treat it as un-datable too.
    if (mark.annuls !== undefined && undatable.has(mark.annuls)) {
      undatable.add(mark.id);
      continue;
    }
    if (mark.annuls !== undefined && present.has(mark.annuls)) {
      annulled.add(mark.annuls);
      annulled.add(mark.id);
    }
  }

  const latest = new Map<string, MarkIntent>();
  for (const mark of dated.slice().sort(byDecidedAt)) {
    if (annulled.has(mark.id) || undatable.has(mark.id)) continue;
    latest.set(`${mark.day}:${mark.prayer}`, {
      day: mark.day,
      prayer: mark.prayer,
      intent: mark.annuls === undefined && mark.clears !== true ? 'prayed' : 'undo',
      decidedAt: mark.decidedAt,
    });
  }

  return {
    intents: [...latest.values()].sort((a, b) => a.decidedAt - b.decidedAt),
    consumed: consumed.filter((id) => !undatable.has(id)),
  };
}

// ---------------------------------------------------------------------------
// Overlay (what a widget shows before the app has drained)
// ---------------------------------------------------------------------------

/**
 * A day's statuses with the queue's undrained intents laid over them — what a widget renders so
 * a tap shows up on the widget itself the moment it lands, even though streak and History will
 * only learn about it when the app next opens (the D92 tradeoff, accepted).
 *
 * **One rule, and it is exactly the drain's rule:** a `prayed` intent shows only over a prayer
 * that is `unlogged`, an `undo` intent only over one that is `prayed`. Anything else — a `late`
 * or `missed` the user set by hand, an `exempt` day — is never repainted by a queue entry, so the
 * preview can never promise a write the drain would refuse. The native widgets (Kotlin and Swift)
 * implement this same function against the same queue JSON; `modules/prayer-widgets/contract/`
 * pins the cases all three implementations must agree on.
 *
 * @param day - The prayer day being rendered.
 * @param statuses - The day's statuses as the last snapshot knew them.
 * @param intents - A resolution's intents (any days; other days are ignored).
 * @returns A new status record with at most the allowed flips applied.
 */
export function overlayPendingMarks(
  day: PrayerDay,
  statuses: Record<Prayer, PrayerStatus>,
  intents: readonly MarkIntent[]
): Record<Prayer, PrayerStatus> {
  const result = { ...statuses };
  for (const intent of intents) {
    if (intent.day !== day) continue;
    if (intent.intent === 'prayed' && result[intent.prayer] === 'unlogged') {
      result[intent.prayer] = 'prayed';
    } else if (intent.intent === 'undo' && result[intent.prayer] === 'prayed') {
      result[intent.prayer] = 'unlogged';
    }
  }
  return result;
}

/** The prayer day of `decidedAt`, or `null` when there is no way to tell right now. */
function dayOf(decidedAt: number, resolve?: (instant: Date) => PrayerDay): PrayerDay | null {
  if (resolve === undefined) return null;
  try {
    const day = resolve(new Date(decidedAt));
    return isValidDay(day) ? day : null;
  } catch {
    return null;
  }
}
