/**
 * Travel mode — what changes for someone on a journey, and what deliberately does not.
 *
 * ## The rules, and what the app does with them
 *
 * A traveller is given two concessions. **Qasr**: the four-rak'ah prayers (Dhuhr, Asr, Isha) are
 * prayed as two; Fajr and Maghrib are unchanged. **Jam'**: Dhuhr and Asr may be prayed together,
 * and so may Maghrib and Isha, in either prayer's time. Prayer times themselves do not move, it is
 * still five prayers a day, and every one of them is still owed and still logged.
 *
 * That last sentence is why travel is **not** the exemption feature (D60): an excused day owes
 * nothing, a travelling day owes everything, just shortened and possibly paired. The shipped
 * exemption copy has always said so in all three languages.
 *
 * The schools disagree about who counts as a traveller — around 80 km is the common threshold, and
 * traveller status lasts while the intended stay is short, four days on one reading and fifteen on
 * another. None of that is knowable from a phone, and guessing would be worse than asking. So the
 * app does not detect travel, does not ask which school, and does not measure distance: the user
 * says when they are travelling and when they are not. This module holds only what follows from
 * that switch.
 *
 * ## What travel actually changes here: one boundary, for honesty
 *
 * Marking a prayer never becomes automatic and never becomes approximate. The single thing that
 * moves is **when "I prayed this, now" has to be recorded as late**. A traveller praying Dhuhr in
 * Asr's time is on time, so the wordless one-tap seal must not write `late` — hence
 * {@link travelPrayedStatusAt}, which reads the boundary off the jam' partner's window instead of
 * the prayer's own.
 *
 * It is a small change on purpose, and narrower than it sounds: the one-tap seal only exists while
 * a prayer's window is open, so in the everyday case a delayed combined prayer is marked through
 * the deliberate three-option pill, which states "Prayed" in words and is never rewritten (D71).
 * What this covers is the tap that lands as the window shuts — for Dhuhr as Asr comes in, the case
 * a traveller meets most.
 *
 * Everything else is untouched, and that is a decision rather than an omission: prayer times, the
 * windows themselves (`windows.ts` is not extended — notifications, the always-on row and the
 * widgets read that table and must not shift), streaks, stats, qada, history, and the rak'ah count,
 * which the app has never modelled and does not start modelling now. Travel writes no per-day
 * record: it is a state the user is in, not a ledger of where they have been.
 */

import { isAfterDay } from './dates';
import { isWindowClosed } from './windows';

import type { Prayer, PrayerDay, PrayerWindow } from './types';

/**
 * Travel as the user set it, exactly as it is persisted in settings.
 *
 * There is no timer behind the end date and nothing scheduled: whether travel is on is *derived*
 * per day by {@link isTravelingOn}, so a state left behind is inert rather than wrong.
 */
export interface TravelState {
  /** Whether the user has said they are travelling. */
  active: boolean;
  /** First travel day, or `null` when travel is off. */
  startDay: PrayerDay | null;
  /**
   * **Last** travel day, inclusive — `null` means "until I end it". Because days here are prayer
   * days (Fajr→next Fajr), travel lapses at the Fajr after this day, which is the boundary a
   * traveller would recognise for free.
   */
  endDay: PrayerDay | null;
}

/**
 * Which prayer each combinable prayer may be delayed into: Dhuhr into Asr's time, Maghrib into
 * Isha's. The pairs are fixed by the rule — Fajr stands alone, and Asr and Isha are the later
 * halves, so they are absent as keys.
 */
export const JAM_PARTNER: Partial<Record<Prayer, Prayer>> = {
  dhuhr: 'asr',
  maghrib: 'isha',
};

/**
 * Whether `day` is a travel day.
 *
 * The end date is applied here rather than by anything that runs: past the last travel day this
 * answers `false`, which is the whole of "travel mode turns itself off". A state that is active
 * with no start day, or whose end precedes its start, describes no day and is treated as off —
 * being wrongly *not* travelling only costs a correctly-late mark, while the reverse would tell
 * someone a prayer counted when it did not.
 *
 * @param day - The prayer day under test (`YYYY-MM-DD`).
 * @param travel - Travel state as persisted.
 * @returns `true` when the user is travelling on that day.
 */
export function isTravelingOn(day: PrayerDay, travel: TravelState): boolean {
  if (!travel.active) return false;
  const { startDay, endDay } = travel;
  if (startDay === null) return false;
  if (isAfterDay(startDay, day)) return false;
  if (endDay === null) return true;
  if (isAfterDay(startDay, endDay)) return false;
  return !isAfterDay(day, endDay);
}

/**
 * The window a traveller's prayer is still on time within: the jam' partner's, when the prayer has
 * one.
 *
 * No new time is computed. Asr's window already ends at Maghrib and Isha's at the next day's Fajr
 * ({@link import('./windows').WINDOW_END_MARKER}), so reading the partner's window off the list the
 * screen already has gives exactly the two extended boundaries the rule allows — Dhuhr until
 * Maghrib, Maghrib until Fajr — without touching the table those windows come from.
 *
 * @param windows - The day's windows, in any order.
 * @param prayer - The prayer being marked.
 * @returns The window to judge lateness against, or `undefined` when it is not in the list.
 */
export function travelWindowFor(
  windows: readonly PrayerWindow[],
  prayer: Prayer
): PrayerWindow | undefined {
  const target = JAM_PARTNER[prayer] ?? prayer;
  return windows.find((candidate) => candidate.prayer === target);
}

/**
 * What "I prayed it", asserted at `at` **while travelling**, records.
 *
 * The travelling twin of `windows.prayedStatusAt`, and it differs in exactly one way: a prayer that
 * may be combined is judged against its partner's window, because praying it there is praying it on
 * time. For Fajr, Asr and Isha the answer is identical to the settled case.
 *
 * A window that cannot be resolved answers `'prayed'` — the same mercy the settled function shows,
 * for the same reason: a prayer we cannot place in time is never declared late on a guess.
 *
 * This is for the **wordless** one-tap seal only. The three-option pill states Prayed or Late in
 * words and is never rewritten, travelling or not (D71) — so a traveller who really did pray Dhuhr
 * after Maghrib can still say exactly that.
 *
 * @param windows - The day's windows, in any order.
 * @param prayer - The prayer being marked.
 * @param at - The instant of the tap, in epoch ms.
 * @returns `'late'` only once even the combined window has closed.
 */
export function travelPrayedStatusAt(
  windows: readonly PrayerWindow[],
  prayer: Prayer,
  at: number
): 'prayed' | 'late' {
  return isWindowClosed(travelWindowFor(windows, prayer), at) ? 'late' : 'prayed';
}
