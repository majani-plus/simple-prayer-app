/**
 * What a prayer is *called* on a given day — the one place Friday's midday prayer is named.
 *
 * ## The ruling, because a naive rename is wrong for a large share of users
 *
 * Jumu'ah is not "Dhuhr on Friday". It is a **different prayer** — two rak'ahs preceded by a
 * khutbah — that **replaces** Dhuhr for whoever prays it in congregation. Whoever does not pray
 * it prays **Dhuhr**, four rak'ahs, in the same time slot:
 *
 * - **Women** are not obligated to attend in the majority position of all four Sunni madhabs; one
 *   who prays at home prays Dhuhr. (If she does attend, it counts and she does not pray Dhuhr.)
 * - **Travellers, the ill, and anyone who cannot reach a masjid** are likewise not obligated and
 *   pray Dhuhr.
 * - **Ja'fari/Shia** users in the time of ghayba commonly hold Jumu'ah to be *wajib takhyiri* —
 *   Jumu'ah or Dhuhr, at the worshipper's choice — so many pray Dhuhr on Friday deliberately.
 *
 * So "on Friday the prayer is called Jumu'ah" is false for a large, permanent fraction of the
 * people using this app, and labelling a woman's Dhuhr at home "Jumu'ah" is simply incorrect.
 * Showing nothing, though, is also wrong: someone going to the masjid looks for Jumu'ah, and
 * every other prayer app shows it.
 *
 * **The app therefore names both, Jumu'ah first** — `prayers.jumuah` carries the pair ("Jumu'ah ·
 * Dhuhr", "Cuma · Öğle", "الجمعة · الظهر"), which is never wrong for anybody and needs no setting,
 * no question and no explanation. See docs/DECISIONS.md D75.
 *
 * ## It is a DISPLAY name only
 *
 * The prayer's identity stays `dhuhr` everywhere — storage, statuses, streaks, stats, qada,
 * notification keys, test ids. Nothing here returns a `Prayer`; it returns an **i18n key**. Forking
 * the data model on a weekday would corrupt history and every aggregate the moment the week turned.
 *
 * ## Which Friday
 *
 * Friday-ness is a property of the **prayer day** the prayer belongs to, never of `new Date()` read
 * at render time. The prayer day runs Fajr→next Fajr (`dates.ts`), so a Thursday-night Isha logged
 * at 00:30 belongs to Thursday's prayer day and its Dhuhr is Thursday's — it does not become
 * Friday's because the wall clock has passed midnight. `weekdayIndex` reads the day label itself
 * with integer arithmetic, so the answer is timezone- and DST-independent by construction.
 *
 * ## Occurrences, not slots
 *
 * Only surfaces naming a prayer **on a particular day** use this: the Today rows and hero, the
 * History day detail, the scheduled-reminder list, the ongoing notification. Settings, the qada
 * counters and the per-prayer stats name the *slot* — the recurring midday prayer across all days —
 * and correctly stay "Dhuhr". That is the line: an occurrence can be Jumu'ah, a slot cannot.
 *
 * Pure TypeScript. No React, no React Native, no i18n — it returns keys, never words.
 */

import { weekdayIndex } from './dates';

import type { Prayer, PrayerDay } from './types';

/**
 * The i18n leaf naming a prayer: one of the five prayer ids, or `jumuah` for Friday's midday
 * prayer. Resolved against `prayers.*` (Latin) and `prayers.arabic.*` (calligraphy), which both
 * carry the same set of keys.
 */
export type PrayerNameKey = Prayer | 'jumuah';

/** Friday, in the Sunday-first indexing `dates.weekdayIndex` returns. */
const FRIDAY = 5;

/**
 * Whether this occurrence of a prayer is Friday's midday prayer.
 *
 * @param prayer - The prayer's stable identity; only `dhuhr` can ever qualify.
 * @param day - The **prayer day** the occurrence belongs to (Fajr→next Fajr), not the calendar
 *              date of the instant it was logged at.
 * @returns `true` only for Dhuhr on a Friday prayer day.
 * @throws RangeError if `day` is not a real `YYYY-MM-DD` date.
 */
export function isJumuah(prayer: Prayer, day: PrayerDay): boolean {
  return prayer === 'dhuhr' && weekdayIndex(day) === FRIDAY;
}

/**
 * The i18n key naming one occurrence of a prayer.
 *
 * @param prayer - The prayer's stable identity — unchanged by this call, and what every write,
 *                 aggregate and notification keeps using.
 * @param day - The prayer day the occurrence belongs to.
 * @returns `'jumuah'` for Friday's Dhuhr, otherwise `prayer` itself.
 * @throws RangeError if `day` is not a real `YYYY-MM-DD` date.
 */
export function prayerNameKey(prayer: Prayer, day: PrayerDay): PrayerNameKey {
  return isJumuah(prayer, day) ? 'jumuah' : prayer;
}
