/**
 * The desired notification schedule — computed purely, applied by nobody here.
 *
 * This module owns the answer to one question: **given the user's reminder settings, the
 * computed prayer times for the next few days, what has already been logged and which days
 * are exempt, exactly which notifications should the OS be holding right now?**
 * (PRODUCT_SPEC §11, ARCHITECTURE.md "Notification scheduling design".)
 *
 * It performs no side effects: it never touches expo-notifications, never reads the clock
 * (`now` is passed in) and never talks to the database. `src/services/notifications.ts` takes
 * the list produced here, diffs it against what the OS actually holds (see {@link diffPlans})
 * and applies the difference. That split is what makes the semantics testable.
 *
 * ## What gets planned
 *
 * For every prayer of every supplied day, up to four notifications (`NotificationKind`), which
 * together are one prayer's whole reminder life in fire order:
 *
 * | kind          | fires at                                   | gated on                                    |
 * | ------------- | ------------------------------------------ | ------------------------------------------- |
 * | `preReminder` | start − `preReminderMinutes`               | `preReminderEnabled` and a positive offset  |
 * | `adhan`       | the prayer's start instant                 | `adhanEnabled`                              |
 * | `nudge`       | `nudgeLeadMinutes` before the window end    | `nudgeEnabled` **and still unlogged**       |
 * | `expiry`      | the window end itself — **Fajr only**       | `sunriseNoteEnabled` **and still unlogged** |
 *
 * Each one also carries **when it stops being worth reading** (`expiresAt`): the window end for the
 * first three, the next prayer's start for `expiry`, which exists to be read after the fact. That
 * is the same judgement {@link selectStaleDelivered} makes when the app runs — computed here so
 * Android can act on it with the app dead (D88). Nothing in this module acts on it.
 *
 * ## Why `expiry` is Fajr-only ({@link EXPIRY_PRAYERS})
 *
 * The point of the expiry notification is the gap *after* a window closes: someone who wakes at
 * eight learns that Fajr ended at sunrise and that Dhuhr is at one. Fajr is the only prayer with
 * such a gap — its window ends at sunrise (D71) and the next thing the app says is Dhuhr's adhan,
 * hours later. For every other prayer the window end **is** the next prayer's start, so the next
 * adhan already carries the news ("Asr · time to pray" says Dhuhr is over), and a second
 * notification saying so would be noise the user has to read past.
 *
 * That restriction is also what keeps the phase affordable: one extra notification per day rather
 * than five (see "The cap" below), and it is why the copy may name sunrise directly.
 *
 * `expiry` states a fact about the sky, never a verdict about the person: it is silent, it is
 * suppressed the moment the prayer is logged, and it never asks anything (PRODUCT_SPEC §11,
 * CLAUDE.md "no shaming copy anywhere", "never interrogate the user").
 *
 * ## Why `expiry` has a setting of its own, and ships off (D90)
 *
 * It used to ride `nudgeEnabled`, which meant an unmarked Fajr produced **two** notifications
 * about the same prayer: the last call while there was still time, and then the note at sunrise
 * once there was not. The second arrives after the fact and volunteers the next prayer's time
 * unasked — useful to someone who slept through Fajr, noise to everyone who just wants to know
 * what to pray now, and the only way to stop it was to give up the last call on all five prayers.
 *
 * So it is now `sunriseNoteEnabled`, **independent of `nudgeEnabled`** and defaulting to `false`
 * here as it does in the store: a caller that has not been taught about the setting must not send
 * a notification nobody asked for. The unlogged condition stays — it belongs to the note itself,
 * not to the switch it used to share — so a marked Fajr still gets nothing.
 *
 * What is lost by defaulting it off: someone who sleeps through Fajr learns that its window closed
 * only by opening the app. The last call before sunrise is what remains, and it arrives while
 * there is still time to pray, which is the more useful of the two.
 *
 * ## Windows and the nudge instant
 *
 * Windows are **derived from `days`**, not passed in — the caller already hands us the day's
 * markers, so asking it for windows too would be a second source of truth. The end of each window
 * is the rule `domain/windows.ts` owns (shared verbatim with `domain/prayerTimes.ts`, so the two
 * can never disagree about when a nudge is due):
 *
 * ```
 * fajr → SUNRISE   dhuhr → asr   asr → maghrib   maghrib → isha   isha → next day's fajr
 * ```
 *
 * Fajr is the one whose deadline is not the next prayer, and it is the nudge that gains most: the
 * last call to pray Fajr now arrives before the sun is up instead of just before Dhuhr, hours
 * after the window shut.
 *
 * The nudge does **not** fire at the window end (nobody wants a "you still haven't prayed"
 * notification at the exact moment the window shuts, and for Isha the end is ~4am):
 *
 * - **Isha** nudges at **Islamic midnight** — `times.middleOfTheNight`, the adhan-js
 *   `SunnahTimes` midpoint between that day's Maghrib and the next day's Fajr — with no lead
 *   applied, because Islamic midnight is already hours before the real deadline. Callers who
 *   compute it elsewhere may override per day via `ishaNudgeTimes`.
 * - **Every other prayer** nudges `nudgeLeadMinutes` before its window end
 *   ({@link DEFAULT_NUDGE_LEAD_MINUTES} = 20 minutes — long enough to still pray, short enough
 *   that it reads as "last call" rather than a second adhan).
 *
 * A nudge whose computed instant does not land strictly inside its own window `(start, end)`
 * is dropped rather than clamped. That only happens in degenerate high-latitude nights where
 * Islamic midnight precedes Isha, or when the lead is longer than the window itself.
 *
 * ## Suppression rules
 *
 * - **Exempt days produce nothing at all** — not even the adhan notification (PRODUCT_SPEC §6:
 *   "All reminders + nudges automatically suppressed on exempt days").
 * - A prayer that is **logged in any way** (`prayed`, `late`, `missed`, `exempt`) loses its
 *   **nudge and its expiry**; its adhan and pre-reminder are untouched, because they are about
 *   the prayer time arriving, not about the log being empty. A missing `statuses` entry — and an
 *   explicit `'unlogged'` — both count as unlogged, so both still stand. The two are suppressed
 *   independently of each other's switch: each one is dropped by the log alone.
 * - Nothing is ever planned at or before `now`.
 *
 * ## The cap
 *
 * iOS holds at most **64 pending local notification requests per app**
 * ({@link IOS_NOTIFICATION_LIMIT}); submit more and the system keeps the 64 that fire soonest
 * and silently discards the rest. Rather than let the OS truncate arbitrarily we truncate
 * ourselves, **keeping the earliest**, at {@link DEFAULT_MAX_NOTIFICATIONS} (60) — leaving
 * headroom for the test notification from the reminder-health screen and anything else the app
 * schedules. Earliest-first truncation is also what implements "nudges prioritised for the
 * nearest days": the near days are simply the ones that survive.
 *
 * The arithmetic, per prayer day: five prayers × three per-prayer kinds, plus **one** `expiry`
 * (Fajr's alone) — sixteen at the theoretical maximum. Five days of that is 80 requests, so a
 * user who has turned everything on is truncated at 60 and covered for **three and a half days**
 * rather than five. The **shipped default** — adhan on, pre-reminder off, nudge on, sunrise note
 * off — costs 5 × 2 = **10 a day, 50 across five days**, which fits under the cap with room to
 * spare; asking for the sunrise note as well costs one more a day (55), and still fits. That is
 * the number that matters: the default configuration keeps the full rolling window, and only a
 * maximal one trades a day and a half of horizon for the extra reminders it asked for. The plan
 * is rebuilt on every foreground either way.
 *
 * ## Failure policy
 *
 * Structural mistakes fail loudly (`RangeError`): a malformed or non-consecutive day list, an
 * invalid `now`, a nonsensical `maxCount`. Astronomically unresolvable times do not: a prayer
 * whose start is an invalid `Date` (polar day/night with `PolarCircleResolution.unresolved`)
 * simply contributes no notifications, and a nudge with an unresolvable anchor is skipped.
 * Rescheduling runs on every app foreground — it must degrade, not throw.
 *
 * Pure TypeScript. No React, no React Native, no Expo, no adhan.
 */

import { diffDays, isBeforeDay, isValidDay } from './dates';
import { windowEndFor } from './windows';
import {
  PRAYERS,
  type DayTimes,
  type NotificationKind,
  type PlannedNotification,
  type Prayer,
  type PrayerDay,
  type PrayerStatus,
  type ReminderSettings,
  type ReminderSound,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard ceiling iOS puts on **pending local notification requests per app**
 * (`UNUserNotificationCenter`): 64. Extra requests are not rejected with an error — the system
 * keeps the 64 soonest-to-fire and silently drops the others, which is why we truncate
 * deliberately instead of letting the OS choose. Android has no comparable limit, but the plan
 * is platform-independent so both platforms get the same list.
 */
export const IOS_NOTIFICATION_LIMIT = 64;

/**
 * How many prayer days the rolling schedule should cover (PRODUCT_SPEC §11: "rolling ~5-day
 * window"). This module honours whatever `days` it is given; the constant exists so the service
 * layer, the reminder-health screen and tests all agree on the horizon.
 */
export const DEFAULT_PLAN_DAYS = 5;

/**
 * Default value of `maxCount`: 60, four slots under {@link IOS_NOTIFICATION_LIMIT}. The headroom
 * absorbs the "send test notification" request from the reminder-health screen and any other
 * one-off the app schedules outside this plan.
 */
export const DEFAULT_MAX_NOTIFICATIONS = 60;

/**
 * Minutes before the end of a prayer's window that its nudge fires, for every prayer except
 * Isha (which uses Islamic midnight instead — see the module header). Twenty minutes is enough
 * time to actually pray and late enough that it reads as a last call.
 *
 * This is the *default* of `AppSettings.nudgeLeadMinutes`, which the user can move between
 * {@link MIN_NUDGE_LEAD_MINUTES} and {@link MAX_NUDGE_LEAD_MINUTES}.
 */
export const DEFAULT_NUDGE_LEAD_MINUTES = 20;

/**
 * Bounds on the user's last-call lead. Below five minutes the notification arrives too late to
 * act on; above an hour it stops being a last call and starts landing inside — or before — the
 * shorter windows (Maghrib's is often barely over an hour), where {@link planNotifications}
 * simply drops it. Both ends are honest limits rather than round numbers.
 */
export const MIN_NUDGE_LEAD_MINUTES = 5;
export const MAX_NUDGE_LEAD_MINUTES = 60;

/**
 * How long an adhan stays worth reading once something else shows the same fact persistently.
 * This is the value the service layer passes as `adhanExpiresAfterMinutes` while the Android
 * always-on notification is enabled: the loud reminder still fires and pops exactly as before,
 * but its tray row stops being information — the ongoing row says the same thing for the whole
 * window — so it retires after half an hour instead of overstaying until the window ends and
 * reading as a duplicate. Thirty minutes keeps it visible for anyone who picks the phone up a
 * bit late, and clears it well before the last call lands.
 */
export const DEFAULT_ADHAN_LINGER_MINUTES = 30;

/**
 * The prayers that get an `expiry` notification when their window closes: **Fajr only**.
 *
 * See the module header for the reasoning — in short, Fajr is the one prayer whose window end is
 * not another prayer's start, so it is the only one whose closing is not already announced by the
 * next adhan.
 */
export const EXPIRY_PRAYERS: ReadonlySet<Prayer> = new Set<Prayer>(['fajr']);

const MS_PER_MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Local types (narrow helpers not present in types.ts)
// ---------------------------------------------------------------------------

/**
 * Known statuses keyed by day then prayer. A missing day, a missing prayer and an explicit
 * `'unlogged'` all mean the same thing: nothing has been logged, so the nudge stands.
 */
export type PrayerStatusMap = Record<PrayerDay, Partial<Record<Prayer, PrayerStatus>>>;

/** Everything {@link planNotifications} needs. Supplied by the service layer; nothing is read from ambient state. */
export interface NotificationPlanInput {
  /** The instant the plan is computed for. Nothing is planned at or before it. */
  now: Date;
  /**
   * Prayer times for consecutive, strictly ascending prayer days, **offsets already applied**.
   * Typically {@link DEFAULT_PLAN_DAYS} entries starting at today. A gap or a repeat throws.
   */
  days: readonly DayTimes[];
  /** Per-prayer reminder configuration from the settings store. */
  reminders: ReminderSettings;
  /** What has already been logged, for nudge suppression only. */
  statuses: PrayerStatusMap;
  /** Days on which the user is exempt; these produce no notifications whatsoever. */
  exemptDays: ReadonlySet<PrayerDay>;
  /**
   * Exempt days where the user chose to KEEP the call (owner, 2026-08-28): the adhan and the
   * wake-up pre-reminder still speak — the clock is a fact — but nothing that presumes an
   * obligation does: no last call, no sunrise note. Absent/empty = every exempt day is silent.
   */
  reminderKeptDays?: ReadonlySet<PrayerDay>;
  /**
   * Optional per-day override for the Isha nudge instant (Islamic midnight). When a day is
   * absent, `days[i].times.middleOfTheNight` is used.
   */
  ishaNudgeTimes?: Record<PrayerDay, Date>;
  /**
   * Whether the sunrise note ({@link EXPIRY_PRAYERS}) is wanted at all. **Defaults to `false`** —
   * the same value the settings store ships, so a caller that has not been taught about the
   * setting sends nothing rather than a notification nobody asked for (D90). Independent of
   * `nudgeEnabled`; the note is still dropped for a prayer that has been logged.
   */
  sunriseNoteEnabled?: boolean;
  /** Maximum notifications to return, earliest kept. Defaults to {@link DEFAULT_MAX_NOTIFICATIONS}. */
  maxCount?: number;
  /**
   * The user's last-call lead, in minutes before the window end, for every prayer except Isha.
   * Defaults to {@link DEFAULT_NUDGE_LEAD_MINUTES}. Does not move `expiry`, which is pinned to
   * the window end itself.
   */
  nudgeLeadMinutes?: number;
  /**
   * When set, an adhan's `expiresAt` is pulled in to `min(windowEnd, start + this)` — the caller
   * is saying something else (the always-on notification) carries the "it's time" fact for the
   * rest of the window, so the adhan's tray row is redundant after this many minutes. Affects
   * the adhan only; pre-reminders, nudges and the sunrise note keep their own expiries. Omitted
   * (the default), the adhan expires at the window end as always (D88).
   */
  adhanExpiresAfterMinutes?: number;
}

/** The work the service layer has to do to make the OS match the plan. */
export interface NotificationPlanDiff {
  /** Planned notifications the OS is not holding yet, in the plan's order. */
  toSchedule: PlannedNotification[];
  /** Identifiers the OS is holding that the plan no longer wants, in the order given. */
  toCancel: string[];
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The stable identity of a planned notification: `` `${kind}:${day}:${prayer}` `` — exactly the
 * format `PlannedNotification.key` documents, and the identifier the OS request must carry so
 * {@link diffPlans} can match the two sides.
 *
 * The key deliberately does **not** encode `fireAt`: cancelling a nudge when its prayer is
 * logged must be possible knowing only which prayer it was. See {@link diffPlans} for what that
 * costs.
 *
 * @param kind - Which of the three notification kinds this is.
 * @param day - The prayer day (`YYYY-MM-DD`) the prayer belongs to.
 * @param prayer - The prayer the notification is about.
 * @returns The colon-joined key.
 */
export function notificationKey(kind: NotificationKind, day: PrayerDay, prayer: Prayer): string {
  return `${kind}:${day}:${prayer}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A `Date` we can actually do arithmetic with. */
function isUsableDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Sound for the ancillary kinds. PRODUCT_SPEC §11 attaches the sound choice to the *adhan-time*
 * reminder, so a pre-reminder or an end-of-window nudge must never play a full adhan clip — but
 * a user who chose `silent` for a prayer meant silent for all of it.
 */
function ancillarySound(sound: ReminderSound): ReminderSound {
  return sound === 'silent' ? 'silent' : 'system';
}

/** Whether nothing has been logged for this prayer, so its nudge is still wanted. */
function isUnlogged(statuses: PrayerStatusMap, day: PrayerDay, prayer: Prayer): boolean {
  const status = statuses?.[day]?.[prayer];
  return status === undefined || status === 'unlogged';
}

/** Validates the shape of `days` and fails loudly, before any planning work happens. */
function assertConsecutiveDays(days: readonly DayTimes[]): void {
  if (!Array.isArray(days)) {
    throw new RangeError('Invalid days: expected an array of DayTimes');
  }
  for (let index = 0; index < days.length; index += 1) {
    const entry = days[index];
    if (entry === null || typeof entry !== 'object' || !isValidDay(entry.day)) {
      throw new RangeError(`Invalid days[${index}]: expected a DayTimes with a YYYY-MM-DD day`);
    }
    if (index > 0 && diffDays(days[index - 1].day, entry.day) !== 1) {
      throw new RangeError(
        `Invalid days: expected consecutive ascending prayer days, got "${days[index - 1].day}" ` +
          `followed by "${entry.day}"`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Computes the full set of notifications the OS should be holding — the single source of truth
 * for "what should be scheduled", against which `services/notifications.ts` diffs reality.
 *
 * Behaviour, in the order it is applied:
 *
 * 1. **Exempt days contribute nothing** — no adhan, no pre-reminder, no nudge (PRODUCT_SPEC §6).
 * 2. For each remaining `(day, prayer)`, up to three notifications are considered:
 *    - `adhan` at the prayer's start, when `adhanEnabled`, carrying that prayer's configured
 *      `sound`;
 *    - `preReminder` at `start − preReminderMinutes`, when `preReminderEnabled` and the offset is
 *      a positive finite number of minutes;
 *    - `nudge` near the window end, when `nudgeEnabled` **and** the prayer is still unlogged
 *      (a missing `statuses` entry counts as unlogged). Isha nudges at Islamic midnight
 *      (`ishaNudgeTimes[day]`, else `times.middleOfTheNight`); every other prayer nudges
 *      `nudgeLeadMinutes` before its window end — **for Fajr that end is sunrise**. A nudge
 *      outside its own window `(start, end)` is dropped, which is what silences a Fajr nudge on
 *      a high-latitude day whose dawn-to-sunrise stretch is shorter than the lead.
 *      See the module header for the window derivation.
 *    - `expiry` at the window end itself, for the prayers in {@link EXPIRY_PRAYERS} (Fajr), when
 *      `sunriseNoteEnabled` **and** the prayer is still unlogged — its own switch, not the
 *      nudge's (D90), and off unless the caller asks. Always `silent`: it reports that a window
 *      closed, which is never worth waking someone for.
 *    Pre-reminders and nudges never carry the adhan clip — see {@link ancillarySound}.
 * 3. Anything at or before `now` is dropped.
 * 4. The survivors are sorted by `fireAt`, ties broken by `key`, so the result is fully
 *    deterministic.
 * 5. The list is truncated to `maxCount` (default {@link DEFAULT_MAX_NOTIFICATIONS}),
 *    **keeping the earliest**, matching how iOS itself would truncate past
 *    {@link IOS_NOTIFICATION_LIMIT}.
 *
 * A prayer whose start instant is unresolvable (invalid `Date`, i.e. polar day/night left
 * unresolved) contributes nothing and does not throw.
 *
 * @param input - See {@link NotificationPlanInput}. Nothing in it is mutated.
 * @returns Ascending by `fireAt`, then by `key`; at most `maxCount` entries; possibly empty.
 * @throws RangeError if `now` is not a valid `Date`, if `days` is not a list of consecutive
 *         ascending valid prayer days, or if `maxCount` / `nudgeLeadMinutes` /
 *         `adhanExpiresAfterMinutes` are negative or not finite numbers.
 */
export function planNotifications(input: NotificationPlanInput): PlannedNotification[] {
  const { now, days, reminders, statuses, exemptDays, ishaNudgeTimes, reminderKeptDays } = input;

  if (!isUsableDate(now)) {
    throw new RangeError('Invalid now: expected a valid Date instance');
  }
  assertConsecutiveDays(days);

  const maxCount = input.maxCount ?? DEFAULT_MAX_NOTIFICATIONS;
  if (!Number.isSafeInteger(maxCount) || maxCount < 0) {
    throw new RangeError(`Invalid maxCount: expected a non-negative whole number, got ${maxCount}`);
  }
  // Off unless asked for, matching the store's own default: an omitted flag must never turn a
  // notification on (D90).
  const sunriseNoteEnabled = input.sunriseNoteEnabled === true;
  const nudgeLeadMinutes = input.nudgeLeadMinutes ?? DEFAULT_NUDGE_LEAD_MINUTES;
  if (!Number.isFinite(nudgeLeadMinutes) || nudgeLeadMinutes < 0) {
    throw new RangeError(
      `Invalid nudgeLeadMinutes: expected a non-negative finite number, got ${nudgeLeadMinutes}`
    );
  }
  const adhanExpiresAfterMinutes = input.adhanExpiresAfterMinutes;
  if (
    adhanExpiresAfterMinutes !== undefined &&
    (!Number.isFinite(adhanExpiresAfterMinutes) || adhanExpiresAfterMinutes < 0)
  ) {
    throw new RangeError(
      `Invalid adhanExpiresAfterMinutes: expected a non-negative finite number, got ${adhanExpiresAfterMinutes}`
    );
  }

  const nowMs = now.getTime();
  const planned: PlannedNotification[] = [];

  const add = (
    kind: NotificationKind,
    day: PrayerDay,
    prayer: Prayer,
    fireAtMs: number,
    sound: ReminderSound,
    expiresAt: Date | undefined
  ): void => {
    if (!Number.isFinite(fireAtMs) || fireAtMs <= nowMs) return;
    planned.push({
      key: notificationKey(kind, day, prayer),
      kind,
      prayer,
      day,
      fireAt: new Date(fireAtMs),
      sound,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
  };

  for (let index = 0; index < days.length; index += 1) {
    const dayTimes = days[index];
    const day = dayTimes.day;

    // Rule 1: an exempt day is silent, top to bottom — unless she chose to keep the call,
    // in which case only the obligation-free kinds below speak.
    const kept = exemptDays?.has(day) === true && reminderKeptDays?.has(day) === true;
    if (exemptDays?.has(day) && !kept) continue;

    for (const prayer of PRAYERS) {
      const settings = reminders?.[prayer];
      if (!settings) continue;

      const start = dayTimes.times?.[prayer];
      // Unresolvable prayer time (polar day/night): plan nothing rather than throw.
      if (!isUsableDate(start)) continue;
      const startMs = start.getTime();

      // Window end, per `domain/windows.ts`: sunrise for Fajr, the next prayer for the middle
      // three, the next day's Fajr for Isha — which we may not have on the final day of the plan.
      // It is both when a last call is due and when every phase of this prayer stops being worth
      // reading, which is what `expiresAt` carries so Android can act on it alone (D88).
      const end = windowEndFor(days, day, prayer);

      if (settings.adhanEnabled) {
        // With the linger knob set, the adhan retires early: something persistent is showing the
        // same fact, so `min(windowEnd, start + linger)` is when this row stops being worth
        // reading. Without a usable window end the linger alone decides.
        let adhanExpiry = end;
        if (adhanExpiresAfterMinutes !== undefined) {
          const lingerEndMs = startMs + adhanExpiresAfterMinutes * MS_PER_MINUTE;
          adhanExpiry = new Date(
            isUsableDate(end) ? Math.min(end.getTime(), lingerEndMs) : lingerEndMs
          );
        }
        add('adhan', day, prayer, startMs, settings.sound, adhanExpiry);
      }

      if (
        settings.preReminderEnabled &&
        Number.isFinite(settings.preReminderMinutes) &&
        settings.preReminderMinutes > 0
      ) {
        add(
          'preReminder',
          day,
          prayer,
          startMs - settings.preReminderMinutes * MS_PER_MINUTE,
          ancillarySound(settings.sound),
          end
        );
      }

      // Rule: a logged prayer loses its last call and its sunrise note, and nothing else. Both
      // read this; neither one's switch can suppress the other (D90).
      const unlogged = isUnlogged(statuses, day, prayer);

      // The window end itself, for the one prayer whose closing nothing else announces. Planned
      // before the nudge and independently of it in both senses: it has its own setting, and a
      // lead longer than the dawn-to-sunrise stretch drops the last call (below) while the sunrise
      // note is still the right thing to send.
      // It alone outlives its own window — it exists to be read after the fact — so what retires
      // it is the next prayer's arrival, exactly as in {@link selectStaleDelivered}.
      if (sunriseNoteEnabled && !kept && unlogged && EXPIRY_PRAYERS.has(prayer) && isUsableDate(end)) {
        add('expiry', day, prayer, end.getTime(), 'silent', nextPrayerStart(dayTimes, prayer));
      }

      if (!settings.nudgeEnabled) continue;
      // A kept exempt day still never nags: the last call presumes a prayer owed.
      if (kept) continue;
      if (!unlogged) continue;

      let nudgeAt: Date | undefined;
      if (prayer === 'isha') {
        nudgeAt = ishaNudgeTimes?.[day] ?? dayTimes.times?.middleOfTheNight;
      } else if (isUsableDate(end)) {
        nudgeAt = new Date(end.getTime() - nudgeLeadMinutes * MS_PER_MINUTE);
      }
      if (!isUsableDate(nudgeAt)) continue;

      // Must land strictly inside its own window; drop rather than clamp.
      const nudgeMs = nudgeAt.getTime();
      if (nudgeMs <= startMs) continue;
      if (isUsableDate(end) && nudgeMs >= end.getTime()) continue;

      add('nudge', day, prayer, nudgeMs, ancillarySound(settings.sound), end);
    }
  }

  planned.sort((a, b) => {
    const byTime = a.fireAt.getTime() - b.fireAt.getTime();
    if (byTime !== 0) return byTime;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return planned.length > maxCount ? planned.slice(0, maxCount) : planned;
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/**
 * Compares the desired plan against the identifiers the OS is currently holding and reports the
 * minimum work needed to reconcile them. Pure: it schedules and cancels nothing itself.
 *
 * Matching is by `key` alone, which is what makes this cheap — but note the consequence: a
 * change that moves a notification **without** changing its key (the user edits
 * `preReminderMinutes`, or the location moves and every prayer time shifts) is invisible here,
 * because `${kind}:${day}:${prayer}` is unchanged. The caller must cancel everything and
 * reschedule from scratch when the *times* change; `diffPlans` is for the common case where only
 * the *set* of wanted notifications moved — a prayer was logged, a day rolled over, a reminder
 * was toggled.
 *
 * Duplicate keys collapse to their first occurrence on both sides, so neither list ever repeats
 * an identifier.
 *
 * @param desired - The plan from {@link planNotifications} (any order; its order is preserved).
 * @param scheduledKeys - Identifiers of the notifications the OS actually holds.
 * @returns `toSchedule` (wanted but not held, in `desired`'s order) and `toCancel` (held but no
 *          longer wanted, in `scheduledKeys`' order). Both are empty when the two sides agree.
 */
export function diffPlans(
  desired: readonly PlannedNotification[],
  scheduledKeys: readonly string[]
): NotificationPlanDiff {
  const scheduled = new Set(scheduledKeys);
  const desiredKeys = new Set<string>();

  const toSchedule: PlannedNotification[] = [];
  for (const notification of desired) {
    if (desiredKeys.has(notification.key)) continue;
    desiredKeys.add(notification.key);
    if (!scheduled.has(notification.key)) toSchedule.push(notification);
  }

  const emitted = new Set<string>();
  const toCancel: string[] = [];
  for (const key of scheduledKeys) {
    if (desiredKeys.has(key) || emitted.has(key)) continue;
    emitted.add(key);
    toCancel.push(key);
  }

  return { toSchedule, toCancel };
}

// ---------------------------------------------------------------------------
// Clearing the tray
// ---------------------------------------------------------------------------

/** One notification the OS has already **delivered** and is still showing. */
export interface DeliveredNotification {
  /** The identifier it was scheduled under — `${kind}:${day}:${prayer}`. */
  key: string;
  kind: NotificationKind;
  prayer: Prayer;
  day: PrayerDay;
  /** The instant it was scheduled to fire at. Orders the phases of one prayer against each other. */
  fireAt: Date;
}

/** Everything {@link selectStaleDelivered} needs. Same shape the plan input already carries. */
export interface StaleDeliveredInput {
  now: Date;
  /** Consecutive prayer days with their times — the same list {@link planNotifications} is given. */
  days: readonly DayTimes[];
  statuses: PrayerStatusMap;
  exemptDays: ReadonlySet<PrayerDay>;
  /** Same meaning as {@link NotificationPlanInput.reminderKeptDays}. */
  reminderKeptDays?: ReadonlySet<PrayerDay>;
}

/**
 * Which already-delivered notifications should be taken out of the tray.
 *
 * **This is the app's answer to "don't stack notifications" on iOS, and half of it on Android.**
 * A delivered notification is only ever replaced by a *later* one scheduled under the same
 * identifier, and both platforms hold at most one *pending* request per identifier — so the
 * phases of one prayer, which must all be scheduled in advance, cannot share one. (Verified on
 * device; see PRODUCT_SPEC §11.) On **iOS** there is therefore no way at all to make the Fajr
 * banner vanish at sunrise while the app is closed. On **Android** there now is: each notification
 * carries its own `expiresAt`, and an alarm of ours takes it out of the tray when that instant
 * passes, with no process of ours needed (`modules/notification-dismissal`, D88) — this same
 * judgement, made without us. This function is what covers iOS, what covers anything that alarm
 * has not reached yet, and what handles the two reasons that are not about time at all — the
 * prayer was logged, the day became exempt.
 *
 * What the app *can* do is clear the tray the instant it is running again — every foreground,
 * every settings change, every prayer logged. So the rule is not "when did this go stale" but
 * "which of these does the user no longer need to see", and the answer is:
 *
 * 1. **Its prayer is logged.** They dealt with it; nothing further is owed.
 * 2. **Its day is exempt.** An exempt day is silent top to bottom (PRODUCT_SPEC §6), including
 *    anything that arrived before the period was recorded.
 * 3. **A later phase of the same prayer has also been delivered.** The last call supersedes the
 *    adhan, the sunrise note supersedes the last call. Only the newest survives — which is the
 *    behaviour the OS would give us for free if it could.
 * 4. **Its moment has passed**, where "its moment" ends at the prayer's window end for the first
 *    three phases, and at the *next prayer's start* for `expiry` — the sunrise note exists to be
 *    read after the fact, so it is the one that outlives its own window, and Dhuhr's adhan is
 *    what retires it.
 * 5. **Its day is behind the horizon entirely.** `days` starts at *today*, so anything from an
 *    earlier prayer day fired before the current one began and cannot still be relevant — no
 *    times are needed to know that. This is the rule that answers "I don't open the app for two
 *    days and come back to a wall of notifications": every phase of every prayer of every skipped
 *    day is delivered with nobody running to dismiss it, and rules 1–4 all need `days` to hold
 *    that day, which by construction it never does again.
 *
 * A notification from **beyond the far end** of the horizon is left alone rather than dismissed:
 * nothing should ever have fired there, and it is a day we hold no times for and cannot judge.
 * A day we cannot even parse is left alone for the same reason. Notifications that are not ours
 * have no payload and never reach this function.
 *
 * @param delivered - What the tray currently holds, ours only.
 * @param input - See {@link StaleDeliveredInput}. Nothing in it is mutated.
 * @returns Identifiers to dismiss, in the order given, without repeats.
 */
export function selectStaleDelivered(
  delivered: readonly DeliveredNotification[],
  input: StaleDeliveredInput
): string[] {
  const { now, days, statuses, exemptDays, reminderKeptDays } = input;
  if (!isUsableDate(now)) return [];
  // Bound through a typed local: `Array.isArray` on a `readonly T[]` narrows it to `any[]`.
  const entries: readonly DeliveredNotification[] = Array.isArray(delivered) ? delivered : [];
  if (entries.length === 0) return [];
  const nowMs = now.getTime();

  const byDay = new Map<PrayerDay, DayTimes>();
  for (const entry of days) {
    if (entry !== null && typeof entry === 'object') byDay.set(entry.day, entry);
  }
  // The near end of the horizon — today. Everything before it is behind us by definition (rule 5).
  const horizonStart = days[0]?.day;

  /** The latest `fireAt` delivered for each `${day}:${prayer}`, so rule 3 can be a comparison. */
  const newest = new Map<string, number>();
  for (const entry of entries) {
    const at = entry.fireAt?.getTime();
    if (at === undefined || !Number.isFinite(at)) continue;
    const slot = `${entry.day}:${entry.prayer}`;
    newest.set(slot, Math.max(newest.get(slot) ?? Number.NEGATIVE_INFINITY, at));
  }

  const stale: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    const dayTimes = byDay.get(entry.day);
    if (dayTimes === undefined) {
      // Rule 5: a prayer day the horizon has already left behind. No times are needed — every
      // window on it shut when the current prayer day began.
      if (isPastDay(entry.day, horizonStart)) {
        seen.add(entry.key);
        stale.push(entry.key);
      }
      // Anything else out of the horizon we cannot judge, so we do not touch it.
      continue;
    }
    seen.add(entry.key);

    const keptExempt =
      exemptDays?.has(entry.day) === true && reminderKeptDays?.has(entry.day) === true;
    if (exemptDays?.has(entry.day) === true && !keptExempt) {
      stale.push(entry.key);
      continue;
    }
    // On a kept exempt day the delivered adhan may stay, but anything that presumed an
    // obligation — the last call, the sunrise note — is as stale as on a silent exempt day.
    if (keptExempt && (entry.kind === 'nudge' || entry.kind === 'expiry')) {
      stale.push(entry.key);
      continue;
    }
    // The unlogged sweep presumes a loggable day (nothing is ever logged on an exempt one);
    // a kept adhan falls through to the time sweeps below, exactly like a normal day's.
    if (!keptExempt && !isUnlogged(statuses, entry.day, entry.prayer)) {
      stale.push(entry.key);
      continue;
    }

    const at = entry.fireAt?.getTime();
    if (at !== undefined && Number.isFinite(at)) {
      const latest = newest.get(`${entry.day}:${entry.prayer}`);
      if (latest !== undefined && at < latest) {
        stale.push(entry.key);
        continue;
      }
    }

    // `expiry` fires AT the window end and is meant to be read afterwards, so what retires it is
    // the next prayer's arrival — which, for Fajr, is exactly Dhuhr.
    const relevanceEnd =
      entry.kind === 'expiry'
        ? nextPrayerStart(dayTimes, entry.prayer)
        : windowEndFor(days, entry.day, entry.prayer);
    if (isUsableDate(relevanceEnd) && nowMs >= relevanceEnd.getTime()) {
      stale.push(entry.key);
    }
  }

  return stale;
}

/**
 * Whether `day` sits strictly before the first day of the planning horizon.
 *
 * Both sides are validated first because this runs over whatever the OS handed back: a payload
 * written by an older build, or a day string a future one invents, must not throw here and abandon
 * the rest of the sweep.
 *
 * @param day - The delivered notification's prayer day.
 * @param horizonStart - The first day the plan covers, or `undefined` when there is no plan.
 * @returns `true` only when both are real days and `day` is the earlier one.
 */
function isPastDay(day: PrayerDay, horizonStart: PrayerDay | undefined): boolean {
  if (horizonStart === undefined || !isValidDay(day) || !isValidDay(horizonStart)) return false;
  return isBeforeDay(day, horizonStart);
}

/** The start of the prayer after `prayer` on the same day, or `undefined` after Isha. */
function nextPrayerStart(dayTimes: DayTimes, prayer: Prayer): Date | undefined {
  const index = PRAYERS.indexOf(prayer);
  const next = index >= 0 ? PRAYERS[index + 1] : undefined;
  return next === undefined ? undefined : dayTimes.times?.[next];
}
