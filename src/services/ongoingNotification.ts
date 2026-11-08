/**
 * The Android ongoing notification (PRODUCT_SPEC §11, decision D27) — what it says and when it
 * has to be redrawn.
 *
 * This module is deliberately **pure**: no React, no platform module, no store. It answers three
 * questions and nothing else.
 *
 * 1. *Which prayer is the notification about?* — {@link selectOngoingState}
 * 2. *What does it read?* — {@link buildOngoingContent}
 * 3. *When must it be redrawn?* — {@link nextOngoingRefreshAt}
 *
 * The presenting is `services/notifications`' job (it owns the adapter and the channel), and the
 * timing is `hooks/useOngoingNotification`'s. Keeping the answers here means the notification's
 * copy can be tested against a clock rather than against a device.
 *
 * ## It follows the log, not only the clock (D83)
 *
 * The notification has **two phases**, and which one it is in depends on what the user has told
 * the app:
 *
 * | phase      | when                                                    | reads                              |
 * | ---------- | ------------------------------------------------------- | ---------------------------------- |
 * | `due`      | a prayer's time is in, its window is open, nothing logged | "Now: Dhuhr · 1:00 pm" / "Next: Asr · 4:00 pm" |
 * | `upcoming` | otherwise                                                 | "Next: Asr · 4:00 pm" / "About 2 hours left…"  |
 *
 * A notification that always names the *next* prayer is silent about the one you could pray right
 * now, which is precisely the moment the app exists for — so at one o'clock it says Dhuhr, and the
 * instant Dhuhr is marked it moves to Asr. That is the whole reward loop reflected on the lock
 * screen, and it costs nothing to a user who never logs: their prayer simply stays named until its
 * window shuts, and then the notification looks forward again.
 *
 * Two things it deliberately does **not** do, both from CLAUDE.md's "never an accusation":
 *
 * - It never keeps naming a prayer whose window has closed. After sunrise the app does not know
 *   whether Fajr was prayed, only whether it was told — so it says nothing about Fajr at all.
 * - It asks for nothing. The body of the `due` phase is the *next* prayer's time, not an
 *   invitation to log. Someone who never logs must never feel written at.
 *
 * The `due` body carries no duration, which is not only tidiness: for Dhuhr, Asr, Maghrib and Isha
 * the next prayer's start **is** the window end (`domain/windows`), so one line answers both "how
 * long do I have" and "what is next" — and a line with no duration in it never goes stale, so the
 * phase needs exactly one redraw instead of five.
 *
 * ## Why it does not tick
 *
 * A persistent notification that says "in 2 h 07 m" is a lie one minute later, and a notification
 * re-posted every second is a battery complaint waiting to happen — in a category whose second
 * loudest complaint is already about notifications (our market research). Two things resolve
 * that tension:
 *
 * - **The title carries the prayer's clock time**, which never goes stale. "Next: Maghrib · 20:47"
 *   is true whether it was drawn a second ago or an hour ago.
 * - **The body carries an approximate remainder**, redrawn only at {@link ONGOING_LEAD_CHECKPOINTS_MS}
 *   — an hour out, half an hour out, a quarter of an hour out, five minutes out — and at the
 *   transition itself. That is at most five redraws per prayer, about twenty-five a day, instead
 *   of eighty-six thousand.
 *
 * The remainder is worded as an approximation (`notifications.ongoing.remaining` → "About 2 hours
 * 7 minutes left") because between two checkpoints it genuinely is one. Saying "about" is cheaper
 * than being wrong.
 *
 * ## What it cannot promise
 *
 * Timers only run while the JS process is alive. A phone that has been in the user's pocket for
 * three hours may show a remainder computed three hours ago until the app is next foregrounded.
 * The clock time in the title is what stays correct through that, which is exactly why it leads.
 *
 * Dependency rule: `services → domain`. The only other import is `utils/formatTime`, which is the
 * app's single time/duration formatter.
 */

import { prayerNameKey } from '../domain/prayerNames';
import { PRAYERS } from '../domain/types';
import { windowEndFor } from '../domain/windows';
import { formatDuration, type TimeFormatPreference } from '../utils/formatTime';

import type { PrayerStatusMap } from '../domain/notificationPlan';
import type { DayTimes, Prayer, PrayerDay } from '../domain/types';

/**
 * How long before the next prayer the notification is redrawn, in milliseconds.
 *
 * Descending, and read as "the remainder is worth restating at this point". The gaps widen as the
 * prayer gets further away because "about 3 hours" ages far more gracefully than "about 4
 * minutes".
 */
export const ONGOING_LEAD_CHECKPOINTS_MS: readonly number[] = [
  60 * 60 * 1000,
  30 * 60 * 1000,
  15 * 60 * 1000,
  5 * 60 * 1000,
];

/**
 * Absorbs timer jitter, so a redraw armed for the prayer's exact instant lands on the far side of
 * it and finds the *next* prayer rather than re-drawing the one that just started.
 */
export const ONGOING_REFRESH_GRACE_MS = 1000;

/** Under this, "less than a minute" is more honest than a number. */
const ALMOST_NOW_MS = 60 * 1000;

/**
 * What the notification is about right now: a prayer the user could pray this minute (`due`), or
 * the next one to begin (`upcoming`). See the module header for which is chosen when.
 */
export type OngoingPhase = 'due' | 'upcoming';

/** One prayer, on one prayer day, at one instant. */
export interface OngoingPrayerRef {
  prayer: Prayer;
  /**
   * The prayer day the occurrence belongs to. Carried so the copy can name Friday's midday prayer
   * "Jumu'ah · Dhuhr" (D75): the identity stays `dhuhr`, only the word changes, and which Friday
   * is a question about the prayer day — after Isha on a Thursday, the next prayer is already
   * Friday's Fajr.
   */
  day: PrayerDay;
  at: Date;
}

/** Which prayer the ongoing notification is currently about. */
export interface OngoingPrayerState extends OngoingPrayerRef {
  phase: OngoingPhase;
  /**
   * The instant this state stops being true — the prayer's window end while `due`, and its start
   * while `upcoming`. It is what {@link nextOngoingRefreshAt} aims the redraw at.
   */
  until: Date;
  /**
   * The prayer after {@link OngoingPrayerRef.prayer}, which the `due` body names. `null` at the
   * far end of the planned window, or when its time could not be resolved.
   */
  next: OngoingPrayerRef | null;
}

/** What {@link selectOngoingState} needs beyond the times, to know whether a prayer is still due. */
export interface OngoingStateOptions {
  /**
   * What has been logged. A prayer with any status against it — `prayed`, `late`, `missed`,
   * `exempt` — is no longer due; a missing entry and an explicit `unlogged` both mean it still is.
   * Absent means nothing is logged, which is the honest default for a caller that does not track.
   */
  statuses?: PrayerStatusMap;
  /** Days the user is exempt on. Nothing is ever *due* on one (PRODUCT_SPEC §6). */
  exemptDays?: ReadonlySet<PrayerDay>;
}

/** Translation function, shaped like i18next's `t`. */
export type OngoingTranslateFn = (key: string, params?: Record<string, unknown>) => string;

/** Everything {@link buildOngoingContent} needs that is not the state. */
export interface OngoingContentDeps {
  translate: OngoingTranslateFn;
  /** Formats a prayer's start time; the app passes `utils/formatTime`. */
  formatClock: (date: Date, timeFormat?: TimeFormatPreference) => string;
  timeFormat?: TimeFormatPreference;
  /** UI language, for the duration phrase. Defaults to the active i18n language. */
  locale?: string;
  /**
   * Formats the remaining milliseconds as a bare phrase ("2 hours 7 minutes"). Injected only by
   * tests; the default is the app's `formatDuration`.
   */
  formatRemaining?: (ms: number, locale?: string) => string;
}

/** A notification's title and body. */
export interface OngoingContent {
  title: string;
  body: string;
}

function defaultFormatRemaining(ms: number, locale?: string): string {
  return formatDuration(ms, { style: 'long', countdown: false, locale });
}

/** A `Date` we can actually do arithmetic with. */
function isUsableDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Whether nothing at all has been logged for this prayer, so it is still the one to pray. */
function isUnlogged(statuses: PrayerStatusMap | undefined, day: PrayerDay, prayer: Prayer): boolean {
  const status = statuses?.[day]?.[prayer];
  return status === undefined || status === 'unlogged';
}

/**
 * Finds the prayer the ongoing notification should be about, and which of the two phases it is in.
 *
 * It scans the whole planned window rather than just today, so the notification is still correct
 * after Isha, when the next prayer is tomorrow's Fajr.
 *
 * A prayer is **due** when its time has come, its window is still open, its day is not exempt and
 * nothing has been logged against it. Everything else — logged, expired, exempt, or a window end
 * we could not resolve — falls to **upcoming**, which names the next prayer to begin. See the
 * module header for why the notification follows the log at all (D83).
 *
 * @param days - Consecutive prayer days with their times, as the sync input carries them.
 * @param now - The instant to answer for.
 * @param options - What has been logged and which days are exempt; see {@link OngoingStateOptions}.
 *        Omitted means nothing is logged, so the current prayer is due.
 * @returns The notification's subject, or `null` when there is nothing to say — an empty or
 *          entirely past `days` with no prayer still due.
 */
export function selectOngoingState(
  days: readonly DayTimes[],
  now: Date,
  options: OngoingStateOptions = {}
): OngoingPrayerState | null {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;

  // Every resolvable prayer start in the planned window, in time order. Flattening once keeps
  // "the prayer after this one" a single step rather than a second search.
  const starts: (OngoingPrayerRef & { index: number })[] = [];
  for (let index = 0; index < days.length; index += 1) {
    const dayTimes = days[index];
    for (const prayer of PRAYERS) {
      const at = dayTimes?.times?.[prayer];
      if (isUsableDate(at)) starts.push({ prayer, day: dayTimes.day, at, index });
    }
  }
  starts.sort((a, b) => a.at.getTime() - b.at.getTime());

  // The prayer whose time is in: the last one to have started. A prayer starting exactly now has
  // begun, so the notification flips at the instant the adhan would sound rather than a beat later.
  const nextIndex = starts.findIndex((entry) => entry.at.getTime() > nowMs);
  const currentIndex = (nextIndex === -1 ? starts.length : nextIndex) - 1;
  const current = currentIndex >= 0 ? starts[currentIndex] : null;
  const upcoming = nextIndex === -1 ? null : starts[nextIndex];

  const ref = (entry: (typeof starts)[number] | undefined): OngoingPrayerRef | null =>
    entry === undefined ? null : { prayer: entry.prayer, day: entry.day, at: entry.at };

  if (current !== null && options.exemptDays?.has(current.day) !== true) {
    const end = windowEndFor(days, current.day, current.prayer);
    // Still open, and nothing said about it yet: this is the prayer the user can pray right now.
    if (end !== undefined && end.getTime() > nowMs && isUnlogged(options.statuses, current.day, current.prayer)) {
      return {
        phase: 'due',
        prayer: current.prayer,
        day: current.day,
        at: current.at,
        until: end,
        next: ref(upcoming ?? undefined),
      };
    }
  }

  if (upcoming === null) return null;
  return {
    phase: 'upcoming',
    prayer: upcoming.prayer,
    day: upcoming.day,
    at: upcoming.at,
    until: upcoming.at,
    next: ref(starts[nextIndex + 1]),
  };
}

/**
 * When the ongoing notification next has to be redrawn.
 *
 * Both phases aim at `state.until` — the moment the notification stops being true — nudged past it
 * so the redraw sees the *new* state rather than re-deriving the old one.
 *
 * Only the `upcoming` phase adds the {@link ONGOING_LEAD_CHECKPOINTS_MS} lead times, because only
 * it prints a duration that ages. A checkpoint already behind us is skipped rather than fired
 * immediately, so arriving twenty minutes before Maghrib arms the fifteen-minute mark, not a burst
 * of three. The `due` phase names no duration at all (see the module header), so it wakes exactly
 * once, when the window shuts.
 *
 * A log is **not** a moment this can predict: the redraw for it comes from the tracking-store
 * subscription in `hooks/useOngoingNotification`, not from a timer.
 *
 * @param state - What the notification is currently about.
 * @param now - The instant to answer for.
 * @returns The next redraw instant, or `null` when the state has already expired (the caller
 *          should re-select first).
 */
export function nextOngoingRefreshAt(state: OngoingPrayerState, now: Date): Date | null {
  const nowMs = now.getTime();
  const untilMs = state.until.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(untilMs)) return null;

  let best = Number.POSITIVE_INFINITY;
  // The transition, nudged past the instant so the redraw sees what comes after it.
  const transition = untilMs + ONGOING_REFRESH_GRACE_MS;
  if (transition > nowMs) best = transition;

  if (state.phase === 'upcoming') {
    for (const lead of ONGOING_LEAD_CHECKPOINTS_MS) {
      const candidate = untilMs - lead;
      if (candidate > nowMs && candidate < best) best = candidate;
    }
  }

  return Number.isFinite(best) ? new Date(best) : null;
}

/**
 * The i18n leaf naming one occurrence of a prayer — `jumuah` for Friday's midday prayer (D75).
 *
 * `prayerNameKey` throws on a day label it cannot read, and this notification is posted outside
 * the sync's per-notification try (`services/notifications.applyOngoing`), so a throw here would
 * take the whole sync down. A name is never worth that: an unreadable day falls back to the
 * prayer's own id, exactly as the scheduled notifications do.
 */
function nameKeyFor(prayer: Prayer, day: PrayerDay): string {
  try {
    return prayerNameKey(prayer, day);
  } catch {
    return prayer;
  }
}

/**
 * The localized title and body of the ongoing notification.
 *
 * **While a prayer is `due`** the title names it and the time it came in, and the body names the
 * prayer after it — a pair of facts, neither of which ages, and between them the answer to both
 * "what should I be praying" and "when is the next one". Nothing asks the reader for anything.
 *
 * **While `upcoming`** the title states the next prayer and its clock time — the part that stays
 * true between redraws — and the body states the approximate remainder and invites the tap. When
 * the remainder cannot be phrased (a formatter blowing up on an uninitialised i18n, say), the body
 * falls back to the invitation alone rather than showing a broken string.
 *
 * @param state - Which prayer the notification is about, and in which phase.
 * @param now - The instant the remainder is measured from.
 * @param deps - Translation and formatting; see {@link OngoingContentDeps}.
 * @returns Non-empty `title` and `body`.
 */
export function buildOngoingContent(
  state: OngoingPrayerState,
  now: Date,
  deps: OngoingContentDeps
): OngoingContent {
  const { translate, formatClock, timeFormat, locale } = deps;
  const formatRemaining = deps.formatRemaining ?? defaultFormatRemaining;

  const prayer = translate(`prayers.${nameKeyFor(state.prayer, state.day)}`);
  const time = formatClock(state.at, timeFormat);

  if (state.phase === 'due') {
    const next = state.next;
    return {
      title: translate('notifications.ongoing.titleNow', { prayer, time }),
      // Without a prayer to point forward at there is no second fact, and a body reading
      // "Next:  · " would be worse than the plain invitation.
      body:
        next === null
          ? translate('notifications.ongoing.body')
          : translate('notifications.ongoing.bodyNext', {
              prayer: translate(`prayers.${nameKeyFor(next.prayer, next.day)}`),
              time: formatClock(next.at, timeFormat),
            }),
    };
  }

  const title = translate('notifications.ongoing.title', { prayer, time });

  const remainingMs = state.at.getTime() - now.getTime();
  let remaining: string | null = null;
  try {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      remaining = translate('notifications.ongoing.remainingNow');
    } else if (remainingMs < ALMOST_NOW_MS) {
      remaining = translate('notifications.ongoing.remainingSoon');
    } else {
      remaining = translate('notifications.ongoing.remaining', {
        duration: formatRemaining(remainingMs, locale),
      });
    }
  } catch {
    // A remainder we cannot phrase is dropped; the clock time in the title still carries the
    // whole message. This must never be the reason a notification fails to appear.
    remaining = null;
  }

  const body =
    remaining === null || remaining.trim() === ''
      ? translate('notifications.ongoing.body')
      : translate('notifications.ongoing.bodyRemaining', { remaining });

  return { title, body };
}
