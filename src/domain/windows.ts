/**
 * Where a prayer's window **ends** — the rule, in one place, so it cannot drift.
 *
 * Two modules need it and neither may own it: `prayerTimes.ts` builds the five `PrayerWindow`s
 * from computed markers (and pulls in adhan to do so), while `notificationPlan.ts` times the
 * end-of-window nudge off `DayTimes` it is handed (and must stay free of adhan). They used to
 * carry a private copy of the table each; when the Fajr rule was corrected, one copy would have
 * been fixed and the other left behind. Hence this module: pure TypeScript, no adhan, no clock.
 *
 * {@link WINDOW_END_MARKER} is the table; {@link windowEndFor} resolves it against a list of days,
 * which is what every caller outside `prayerTimes.ts` actually wants.
 *
 * ## The rule, per prayer
 *
 * | prayer  | window ends at        | why                                                        |
 * | ------- | --------------------- | ---------------------------------------------------------- |
 * | fajr    | **sunrise**           | "…as long as the sun has not risen" (Muslim 612). Unanimous. |
 * | dhuhr   | asr                   | ends when the shadow reaches the Asr length — i.e. at the user's own Asr, madhab included. |
 * | asr     | maghrib               | "whoever catches a rak'ah of Asr before the sun sets has caught it" (Bukhari 579). |
 * | maghrib | isha                  | "…as long as the twilight has not disappeared" (Muslim 612). |
 * | isha    | the NEXT day's fajr   | the outer limit every school allows; Islamic midnight is where the *preferred* time ends, and the app says so with a nudge, never with a status. |
 *
 * **Fajr is the only prayer whose window closes before the next prayer begins.** That is what
 * makes the five windows stop tiling the prayer day: between sunrise and Dhuhr nothing is due,
 * and "what is current" is legitimately nothing (see `prayerTimes.getCurrentPrayer`).
 *
 * Deliberately NOT modelled: the makruh stretch after the sun yellows (Asr) and the "time of
 * necessity" after Islamic midnight (Isha). Both are preferences inside a window that is still
 * open, and this table decides only what is *late*. Calling a valid prayer late would be both
 * wrong and unkind, and neither boundary is a marker the engine computes.
 */

import type { DayTimes, Prayer, PrayerDay, PrayerWindow, TimeMarker } from './types';

/**
 * The markers that can close a window. `fajr` is absent: no prayer's window ends at dawn (Isha's
 * ends at the *next day's* Fajr, which is not a marker of its own day — see {@link WINDOW_END_MARKER}).
 */
export type WindowEndMarker = Extract<TimeMarker, 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha'>;

/**
 * Which marker of the prayer's OWN day closes its window, or `null` for "the next day's Fajr"
 * (Isha only). See the module header for the fiqh behind each entry.
 */
export const WINDOW_END_MARKER: Record<Prayer, WindowEndMarker | null> = {
  fajr: 'sunrise',
  dhuhr: 'asr',
  asr: 'maghrib',
  maghrib: 'isha',
  isha: null,
};

/**
 * The instant a prayer's window closes, read off a list of consecutive prayer days.
 *
 * {@link WINDOW_END_MARKER} says *which* marker closes each window; this resolves it against real
 * times, including the one case the table cannot express on its own — **Isha ends at the NEXT
 * day's Fajr**, so it needs the day after `day` and answers `undefined` when the list does not
 * reach that far.
 *
 * Three callers need exactly this and used to carry a copy each: the plan (when a last call is
 * due, and when a notification stops being relevant), the tray sweep (which delivered notification
 * has outlived its moment) and the ongoing notification (whether the current prayer is still due).
 * A fourth copy would eventually have disagreed with the other three.
 *
 * @param days - Consecutive prayer days with their markers, ascending. Order matters only in that
 *               the day after `day` must follow it.
 * @param day - The prayer day the prayer belongs to.
 * @param prayer - The prayer whose window end is wanted.
 * @returns The window end, or `undefined` when `day` is not in the list, the marker is missing, or
 *          the time is unresolvable (polar day/night) — never a guessed instant.
 */
export function windowEndFor(
  days: readonly DayTimes[],
  day: PrayerDay,
  prayer: Prayer
): Date | undefined {
  const index = days.findIndex((entry) => entry?.day === day);
  if (index < 0) return undefined;
  const marker = WINDOW_END_MARKER[prayer];
  const end = marker === null ? days[index + 1]?.times?.fajr : days[index].times?.[marker];
  return end instanceof Date && !Number.isNaN(end.getTime()) ? end : undefined;
}

/**
 * Whether a prayer's window has already shut at `at`.
 *
 * Half-open, matching `PrayerWindow`'s `[start, end)` contract: exactly at `end` the window is
 * closed. An absent or unresolvable window answers `false` — a prayer we cannot place in time is
 * never declared late on a guess.
 *
 * @param window - The prayer's window, or `undefined` when none could be computed.
 * @param at - The instant to test, in epoch ms.
 * @returns `true` only when `at` is at or after a usable window end.
 */
export function isWindowClosed(window: PrayerWindow | undefined | null, at: number): boolean {
  const end = window?.end;
  if (!(end instanceof Date)) return false;
  const endMs = end.getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(at)) return false;
  return at >= endMs;
}

/**
 * What "I prayed it", asserted at `at`, actually records.
 *
 * This is for the **wordless** log — the one-tap seal on the current prayer, whose whole meaning
 * is "done, now". If `at` falls outside the window, "now" is after the deadline, and the honest
 * record is `late`: that is precisely what late means.
 *
 * It is **not** for the three-option pill. There the user picks between ✓ Prayed and 🕐 Late in
 * words; rewriting that choice would both contradict a deliberate statement and make an on-time
 * prayer logged after the fact impossible to record (see docs/DECISIONS.md D71).
 *
 * @param window - The prayer's window; `undefined` when it could not be computed.
 * @param at - The instant the log is being made, in epoch ms.
 * @returns `'late'` when the window has closed, `'prayed'` otherwise.
 */
export function prayedStatusAt(
  window: PrayerWindow | undefined | null,
  at: number
): 'prayed' | 'late' {
  return isWindowClosed(window, at) ? 'late' : 'prayed';
}
