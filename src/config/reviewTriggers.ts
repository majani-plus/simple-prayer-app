/**
 * Review-prompt tuning — every threshold behind the store rating prompt, as data.
 *
 * PRODUCT_SPEC §13 / decision D28. This file exists so the whole policy can be retuned from an
 * **EAS Update** without a store release: `services/review.ts` reads numbers from here and holds
 * no constants of its own, so shipping "make the cooldown 120 days" or "stop prompting entirely"
 * is a JS bundle push, not a two-week review queue.
 *
 * That is not a nicety. There is **no success callback** on either platform — neither
 * `SKStoreReviewController` (iOS) nor the Play In-App Review API tells you whether the sheet
 * appeared, whether the user wrote anything, or whether the OS silently swallowed the call. The
 * only feedback loop is the store's public rating average, observed days later. A policy that can
 * only be corrected by a binary release is a policy you cannot steer.
 *
 * ## Deliberately data-only
 *
 * No imports, no functions, no logic — just frozen numbers and a type. Two reasons:
 *
 * 1. An EAS Update should be able to replace this module wholesale without dragging a dependency
 *    graph behind it.
 * 2. Everything here is a *product* decision (how long is "recently"? how many prompts is
 *    "deliberate"?) and everything in `services/review.ts` is a *mechanism* decision. Keeping the
 *    two in separate files is what stops the next person from hardcoding 90 days into a `if`.
 *
 * ## Why these particular numbers
 *
 * - **`steadyUseSessions: 12` / `steadyUseMinDays: 21`.** The other three triggers all assume the
 *   user logs prayers or taps a reminder, and CLAUDE.md's two-audiences rule says the person who
 *   only ever wants prayer times and a qibla is not a lesser user. Without this they could never
 *   be asked at all — and reviews are the entire discovery channel for an app with no ads to
 *   advertise it, which is what the "Rate the app" row already tells them. The two numbers are
 *   what keeps it from stealing a better moment: someone who logs reaches a 7-day streak or a
 *   complete week well inside three weeks, spends an attempt there, and is then in cooldown, so
 *   in practice this fires only for the person the other three cannot reach. It is deliberately
 *   the *weakest* moment in the set — "it has kept working for you for three weeks" — which is
 *   why it is tried last and never first.
 * - **Two streak milestones, 7 and 30** (`domain/streaks.STREAK_MILESTONES` also celebrates 3,
 *   100 and 365). 3 is too early to be a delight moment — the user has barely used the app — and
 *   100/365 arrive long after the lifetime cap is spent. Streak milestones are the top-converting
 *   pattern for habit apps (our market research).
 * - **`cooldownDays: 90`.** iOS enforces 3 prompts per 365 days at the OS level and silently
 *   no-ops the rest; ~90 days is the spacing that keeps our own three attempts inside the OS's
 *   allowance instead of burning two of them in a week and finding the third eaten.
 * - **`lifetimeCap: 3`.** Not "3 per year" — three, ever, for this install. The category's
 *   sharpest 1★ reviews are about apps that nag (our market research); a prayer app that
 *   nags at Fajr is an offence, not a UX wrinkle.
 * - **`settleDelayMs: 2500`.** "After the moment has landed, never mid-interaction." Long enough
 *   for the streak seal's animation to finish and the user to read the number; short enough that
 *   it still reads as part of the same moment.
 * - **The four `cooldownAfter*` values** encode "this user is currently unhappy, or was recently".
 *   Adjusting prayer-time offsets is the loudest dissatisfaction signal in the app — it means our
 *   times were wrong for them — so it silences prompting for a **month**, longer than a broken
 *   streak (a fortnight) or a mistyped seal (a week).
 *
 * ## What is NOT tunable here
 *
 * The hard exclusions themselves. "Never during a prayer window", "never while the adhan is
 * playing", "not on Ramadan's first or last day" and "not in the first session" are binary rules
 * in `services/review.ts` with no threshold to turn — an EAS Update must not be able to switch
 * them off by accident. Only `enabled` (the global kill switch) can stop the feature.
 */

/** Milliseconds in a day. Every duration below is expressed in days or ms, never in both. */
export const DAY_MS = 86_400_000;

/** The four kinds of moment allowed to ask for a review, best first. See `services/review.ts`. */
export type ReviewTriggerKind =
  /** A streak just reached one of {@link ReviewTriggerConfig.streakMilestones}. */
  | 'streakMilestone'
  /** The user's first run of {@link ReviewTriggerConfig.completeWeekDays} all-five-logged days. */
  | 'firstCompleteWeek'
  /** Times are on screen for a real location AND a reminder has been confirmed delivered. */
  | 'setupSuccess'
  /**
   * The app has quietly worked for a long-standing user who never logs a prayer. The trigger of
   * last resort — see {@link ReviewTriggerConfig.steadyUseSessions}.
   */
  | 'steadyUse';

/** Everything the review policy can be retuned by. All fields are required on purpose. */
export interface ReviewTriggerConfig {
  /**
   * Global kill switch. `false` blocks every prompt with reason `disabled` and is the one lever
   * that can stop the feature dead from an EAS Update.
   */
  enabled: boolean;

  /**
   * Streak lengths that may prompt, ascending. Must be a subset of
   * `domain/streaks.STREAK_MILESTONES` — a value that module never emits would simply never fire.
   * Enforced by the test suite, not by a type, so this file can stay import-free.
   */
  streakMilestones: readonly number[];

  /** How many consecutive fully-logged days make a "complete week". */
  completeWeekDays: number;

  /**
   * The session ordinal from which prompting is possible at all. `2` means: never in the first
   * session, ever, under any trigger (PRODUCT_SPEC §13 — "not during first launch/onboarding").
   */
  minSessionOrdinal: number;

  /** How many sessions the app must have been opened in before the first prompt. */
  minSessionsBeforeFirstPrompt: number;

  /**
   * Sessions before the `steadyUse` trigger becomes available. Well above
   * {@link minSessionsBeforeFirstPrompt}, because this is the *last* moment tried, not the first.
   */
  steadyUseSessions: number;

  /** Days since install before `steadyUse` becomes available. */
  steadyUseMinDays: number;

  /** How long the app must have been installed before the first prompt. */
  minDaysSinceInstall: number;

  /** Minimum days between two prompt attempts. */
  cooldownDays: number;

  /** Prompt attempts allowed for the lifetime of this install. */
  lifetimeCap: number;

  /**
   * How long the moment must have been over before the prompt may appear. Guards
   * "never mid-interaction": a prompt racing the user's tap steals it.
   */
  settleDelayMs: number;

  /** Quiet period after adhan audio stops, on top of the never-while-playing rule. */
  quietAfterAdhanMs: number;

  /**
   * How long after a prayer's time the user counts as "praying right now".
   *
   * The *rule* — never prompt during a prayer — is not negotiable; this number only says how long
   * that state lasts, and it needs saying because `domain/prayerTimes.getPrayerWindows` covers
   * nearly the whole day: Dhuhr's window runs to Asr, Isha's to the next Fajr. Taken literally,
   * "inside a prayer window" is true for all but the morning between sunrise and Dhuhr, and the
   * feature would almost never fire. What the rule actually protects is the half hour after the
   * adhan, when the user is on the mat.
   */
  prayerWindowMinutes: number;

  /** No prompting for this long after a streak break was observed. */
  cooldownAfterStreakBreakDays: number;

  /** No prompting for this long after the user undid a mis-tapped log. */
  cooldownAfterMistapDays: number;

  /** No prompting for this long after the user adjusted prayer times / offsets / method. */
  cooldownAfterTimesAdjustedDays: number;

  /**
   * No prompting for this long after a session that did not end cleanly. See
   * `services/review.ts` — this is a *heuristic*, not real crash reporting.
   */
  cooldownAfterUncleanSessionDays: number;

  /** How many attempt-log entries to keep for debugging. Oldest are dropped first. */
  maxLogEntries: number;
}

/**
 * The shipped policy. Frozen so a screen cannot mutate it at runtime; replace the whole object
 * in an EAS Update to retune.
 */
export const REVIEW_TRIGGERS: ReviewTriggerConfig = Object.freeze({
  enabled: true,
  streakMilestones: Object.freeze([7, 30]),
  completeWeekDays: 7,
  minSessionOrdinal: 2,
  minSessionsBeforeFirstPrompt: 3,
  steadyUseSessions: 12,
  steadyUseMinDays: 21,
  minDaysSinceInstall: 3,
  cooldownDays: 90,
  lifetimeCap: 3,
  settleDelayMs: 2500,
  quietAfterAdhanMs: 120_000,
  prayerWindowMinutes: 30,
  cooldownAfterStreakBreakDays: 14,
  cooldownAfterMistapDays: 7,
  cooldownAfterTimesAdjustedDays: 30,
  cooldownAfterUncleanSessionDays: 7,
  maxLogEntries: 25,
}) as ReviewTriggerConfig;
