/**
 * History statistics — PRODUCT_SPEC §8.
 *
 * This module owns every number shown in the History tab's stats section: per-prayer
 * breakdowns, completion and on-time rates, fully-completed days, and the
 * "most missed" / "most often late" callouts. Streak numbers are NOT here — they live in
 * `streaks.ts`; qada debt lives in `qada.ts`.
 *
 * Pure TypeScript: no React, no React Native, no Expo, no `Date` arithmetic of its own
 * (all day maths is delegated to `dates.ts`, the single owner of the day boundary).
 *
 * ## The two honesty guarantees
 *
 * 1. **Exempt is invisible to denominators** (PRODUCT_SPEC §6). An exempt prayer is never
 *    rendered as missed, never nudged, and never counted in a denominator. It is reported
 *    only as `PrayerBreakdown.exempt`, so the UI can show "3 exempt days" without those days
 *    dragging any percentage down. An exempt day is never a `fullDays` day either — the user
 *    was not obliged, so crediting it as "all five prayed" would be a lie in the other
 *    direction.
 * 2. **Unlogged is its own category, never merged into missed** (PRODUCT_SPEC §4, §8).
 *    "I did not record this" is not "I did not pray this". `unlogged` is counted and
 *    reported, but it is excluded from every denominator — a user who prayed 3 and simply
 *    forgot to log 2 does not get a 60% completion rate.
 *
 * ## What `totalTracked` means
 *
 * `totalTracked` is the number of prayer slots that carry an actual log — i.e. everything
 * except `unlogged`. It therefore satisfies, exactly:
 *
 * ```
 * totalTracked === prayed + late + missed + Σ byPrayer[i].exempt
 * completionRate === (prayed + late) / (totalTracked − Σ byPrayer[i].exempt)
 *               === (prayed + late) / (prayed + late + missed)
 * ```
 *
 * which is the formula documented on `StatsSummary` in `types.ts` combined with §8's
 * "exempt/unlogged excluded from denominators".
 *
 * ## What is counted: supplied records only
 *
 * `computeStats` never invents days. It counts exactly the `DayRecord`s it is handed
 * (after window filtering) and cannot know whether a day with no record at all was exempt,
 * unlogged, or simply before the user installed the app. A caller that wants "days I logged
 * nothing" to appear as five `unlogged` slots must materialise those days itself and pass
 * all-`unlogged` records — that is the query layer's job, not this module's. As a direct
 * consequence, `computeStats([], …)` is all zeros and all-`null` rates, not a 0% window.
 *
 * ## Window convention
 *
 * A window of N days is the **last N prayer days ending at `todayDay`, inclusive of both
 * ends**: `[addDays(todayDay, −(N − 1)), todayDay]`. So `windowDays: 1` is today alone and
 * `windowDays: 7` is today plus the six preceding days. `windowDays: null` means lifetime:
 * unbounded start, still ending at `todayDay`. Records dated after `todayDay` are dropped in
 * both modes (future days are locked, PRODUCT_SPEC §4), so lifetime is exactly the window
 * with its start removed and never disagrees with a window about the future.
 *
 * ## Invalid input
 *
 * Like `dates.ts`, this module fails loudly (`RangeError`) on a malformed day, a non-positive
 * or non-integer `windowDays`, two records claiming the same day, or an unrecognised status
 * string. Silently-wrong statistics are worse than a crash in a test.
 */

import { addDays, compareDays, isValidDay } from './dates';
import {
  PRAYERS,
  PRAYER_STATUSES,
  type DayRecord,
  type Prayer,
  type PrayerBreakdown,
  type PrayerDay,
  type PrayerStatus,
  type StatsSummary,
} from './types';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Inputs that pin a stats computation to a point in time.
 *
 * Not in `types.ts` (that file is the shared contract and is not mine to extend); it is
 * declared here because it is only ever the argument shape of {@link computeStats}.
 */
export interface StatsOptions {
  /**
   * Length of the window in whole days, counting `todayDay` as day 1. Must be a safe
   * integer ≥ 1. `null` means lifetime (no start bound).
   */
  windowDays: number | null;
  /**
   * The current prayer day (`YYYY-MM-DD`) — the inclusive last day of the window. Passed in
   * rather than read from the clock so this module stays pure and testable; callers get it
   * from `dates.prayerDayForInstant`.
   */
  todayDay: PrayerDay;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const STATUS_VALUES: readonly string[] = PRAYER_STATUSES;

/** A zeroed breakdown row for one prayer. */
function emptyBreakdown(prayer: Prayer): PrayerBreakdown {
  return { prayer, prayed: 0, late: 0, missed: 0, unlogged: 0, exempt: 0 };
}

/**
 * The status that actually counts for one slot of one day.
 *
 * - A day flagged `isExempt` forces every slot to `exempt`, whatever the stored statuses say.
 *   The flag is the authority (PRODUCT_SPEC §6: exempt days are "never counted in stats
 *   denominators"), so a stale `missed` row underneath an exemption period can never leak
 *   into a percentage.
 * - A missing key is `unlogged`, mirroring the storage rule "absence of a row = unlogged"
 *   (docs/ARCHITECTURE.md, data model).
 */
function effectiveStatus(record: DayRecord, prayer: Prayer): PrayerStatus {
  if (record.isExempt === true) return 'exempt';
  const statuses = record.statuses as Partial<Record<Prayer, PrayerStatus>> | undefined;
  const raw = statuses?.[prayer];
  if (raw === undefined || raw === null) return 'unlogged';
  if (!STATUS_VALUES.includes(raw)) {
    throw new RangeError(
      `stats: unknown prayer status ${JSON.stringify(raw)} for ${prayer} on ${String(record.day)}`
    );
  }
  return raw;
}

/** Shared engine for {@link mostMissedPrayer} / {@link mostLatePrayer}. */
function peakPrayer(summary: StatsSummary, field: 'missed' | 'late'): Prayer | null {
  const rows = summary?.byPrayer;
  if (!Array.isArray(rows)) return null;

  let best: Prayer | null = null;
  let bestCount = 0;
  let bestOrder = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const count = row?.[field];
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    const order = PRAYERS.indexOf(row.prayer);
    const rank = order === -1 ? Number.MAX_SAFE_INTEGER : order;
    if (count > bestCount || (count === bestCount && rank < bestOrder)) {
      best = row.prayer;
      bestCount = count;
      bestOrder = rank;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Aggregates day records into the History tab's statistics (PRODUCT_SPEC §8).
 *
 * Counts only the records supplied, restricted to the window
 * `[addDays(todayDay, −(windowDays − 1)), todayDay]` (both ends inclusive), or to
 * `(−∞, todayDay]` when `windowDays` is `null`. Missing days are never synthesised, and days
 * after `todayDay` are always dropped. Order of `records` is irrelevant and the array (and
 * every record in it) is never mutated.
 *
 * Semantics worth knowing before reading a number off the result:
 * - **Exempt** slots land only in `byPrayer[i].exempt`. They inflate `totalTracked` and are
 *   subtracted straight back out of every denominator; an exempt day is never a `fullDays`.
 * - **Unlogged** slots land only in `unlogged`. They are in no denominator and are never
 *   folded into `missed`.
 * - **`fullDays`** counts non-exempt days whose five slots are all `prayed` or `late`.
 * - **Rates** are `null` — never `NaN`, never `0` — whenever their denominator is zero.
 *
 * @param records - Resolved day records, in any order, at most one per day. Each contributes
 *                  five slots. `isExempt` overrides the day's stored statuses; a missing
 *                  status key counts as `unlogged`.
 * @param opts - {@link StatsOptions}: window length (or `null` for lifetime) and the current
 *               prayer day that ends the window.
 * @returns A {@link StatsSummary} whose `windowDays` echoes `opts.windowDays` and whose
 *          `byPrayer` always holds exactly five rows in canonical
 *          Fajr→Dhuhr→Asr→Maghrib→Isha order, even when nothing was counted.
 * @throws RangeError if `opts.todayDay` or any `record.day` is not a real `YYYY-MM-DD` date,
 *         if `opts.windowDays` is not `null` and not a safe integer ≥ 1, if two records share
 *         a day, if a record is `null`/`undefined`, or if a status string is unrecognised.
 */
export function computeStats(records: DayRecord[], opts: StatsOptions): StatsSummary {
  const windowDays = opts?.windowDays ?? null;
  const todayDay = opts?.todayDay;

  if (!isValidDay(todayDay)) {
    throw new RangeError(
      `stats: opts.todayDay must be a YYYY-MM-DD calendar date, received ${JSON.stringify(todayDay)}`
    );
  }
  if (windowDays !== null && (!Number.isSafeInteger(windowDays) || windowDays < 1)) {
    throw new RangeError(
      `stats: opts.windowDays must be null or a whole number of days >= 1, received ${JSON.stringify(windowDays)}`
    );
  }

  // Inclusive lower bound. `windowDays: 1` ⇒ today alone.
  const windowStart = windowDays === null ? null : addDays(todayDay, -(windowDays - 1));

  const byPrayer = PRAYERS.map(emptyBreakdown);
  const breakdownFor = new Map<Prayer, PrayerBreakdown>(byPrayer.map((row) => [row.prayer, row]));

  let prayed = 0;
  let late = 0;
  let missed = 0;
  let unlogged = 0;
  let exemptSlots = 0;
  let fullDays = 0;

  const seenDays = new Set<PrayerDay>();
  const list = Array.isArray(records) ? records : [];

  for (const entry of list) {
    const record = entry as DayRecord | null | undefined;
    if (record === null || record === undefined) {
      throw new RangeError('stats: records must not contain null or undefined entries');
    }
    if (!isValidDay(record.day)) {
      throw new RangeError(
        `stats: record.day must be a YYYY-MM-DD calendar date, received ${JSON.stringify(record.day)}`
      );
    }
    if (seenDays.has(record.day)) {
      throw new RangeError(`stats: duplicate record for day ${record.day}`);
    }
    seenDays.add(record.day);

    if (compareDays(record.day, todayDay) > 0) continue;
    if (windowStart !== null && compareDays(record.day, windowStart) < 0) continue;

    let fullDay = record.isExempt !== true;

    for (const prayer of PRAYERS) {
      const status = effectiveStatus(record, prayer);
      const breakdown = breakdownFor.get(prayer);
      /* istanbul ignore next -- breakdownFor is built from PRAYERS, so this cannot miss. */
      if (breakdown === undefined) continue;

      switch (status) {
        case 'prayed':
          prayed += 1;
          breakdown.prayed += 1;
          break;
        case 'late':
          late += 1;
          breakdown.late += 1;
          break;
        case 'missed':
          missed += 1;
          breakdown.missed += 1;
          fullDay = false;
          break;
        case 'unlogged':
          unlogged += 1;
          breakdown.unlogged += 1;
          fullDay = false;
          break;
        case 'exempt':
          exemptSlots += 1;
          breakdown.exempt += 1;
          fullDay = false;
          break;
        default: {
          const exhaustive: never = status;
          throw new RangeError(`stats: unhandled prayer status ${JSON.stringify(exhaustive)}`);
        }
      }
    }

    if (fullDay) fullDays += 1;
  }

  const totalTracked = prayed + late + missed + exemptSlots;
  const obligated = prayed + late + missed; // === totalTracked − exempt
  const performed = prayed + late;

  return {
    windowDays,
    totalTracked,
    prayed,
    late,
    missed,
    unlogged,
    completionRate: obligated === 0 ? null : performed / obligated,
    onTimeRate: performed === 0 ? null : prayed / performed,
    fullDays,
    byPrayer,
  };
}

/**
 * The prayer missed most often in a summary — History's "most missed" callout.
 *
 * @param summary - A summary from {@link computeStats}.
 * @returns The prayer with the highest `missed` count, or `null` when nothing in the window
 *          was logged as missed (a zero count is never a "winner", so the UI shows nothing
 *          rather than an arbitrary prayer). Unlogged prayers are not missed prayers and are
 *          never considered here.
 *
 * @remarks Tiebreak is deterministic: among equal counts the prayer that comes **earliest in
 *          the day** wins, using the canonical order Fajr → Dhuhr → Asr → Maghrib → Isha.
 *          Fajr therefore wins an all-square day, which is also the most useful answer.
 */
export function mostMissedPrayer(summary: StatsSummary): Prayer | null {
  return peakPrayer(summary, 'missed');
}

/**
 * The prayer most often prayed late in a summary — History's "most often late" callout.
 *
 * @param summary - A summary from {@link computeStats}.
 * @returns The prayer with the highest `late` count, or `null` when nothing in the window was
 *          logged as late.
 *
 * @remarks Same deterministic tiebreak as {@link mostMissedPrayer}: earliest prayer of the
 *          day wins (Fajr → Dhuhr → Asr → Maghrib → Isha).
 */
export function mostLatePrayer(summary: StatsSummary): Prayer | null {
  return peakPrayer(summary, 'late');
}
