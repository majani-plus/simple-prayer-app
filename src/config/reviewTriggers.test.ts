/**
 * The review-prompt policy is data, and this file is the guard on that data.
 *
 * `config/reviewTriggers.ts` exists to be edited by a human and shipped through an EAS Update
 * without a store release (PRODUCT_SPEC §13). That is exactly the kind of file where a plausible
 * one-character change — `lifetimeCap: 3` → `33`, `streakMilestones: [7, 30]` → `[7, 3]` — sails
 * through code review because it *looks* like a number. So the invariants that make the numbers
 * safe are asserted here rather than assumed:
 *
 * - Every configured streak milestone is one `domain/streaks` can actually emit. A value the
 *   engine never produces would be a trigger that silently never fires — the worst failure mode
 *   for a feature with no telemetry.
 * - The store-enforced ceilings are respected: three attempts, ≥90 days apart, fits inside iOS's
 *   3-per-365 without relying on the OS to save us.
 * - Nothing is zero or negative in a way that would turn a guard into a no-op.
 */

import { STREAK_MILESTONES } from '../domain/streaks';

import { DAY_MS, REVIEW_TRIGGERS } from './reviewTriggers';

describe('DAY_MS', () => {
  it('is a day', () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('REVIEW_TRIGGERS', () => {
  it('is frozen, so no screen can retune the policy at runtime', () => {
    expect(Object.isFrozen(REVIEW_TRIGGERS)).toBe(true);
    expect(Object.isFrozen(REVIEW_TRIGGERS.streakMilestones)).toBe(true);
  });

  it('ships enabled', () => {
    expect(REVIEW_TRIGGERS.enabled).toBe(true);
  });

  it('only celebrates streak lengths the domain actually emits', () => {
    for (const milestone of REVIEW_TRIGGERS.streakMilestones) {
      expect(STREAK_MILESTONES).toContain(milestone);
    }
  });

  it('celebrates 7 then 30, ascending (PRODUCT_SPEC §13)', () => {
    expect([...REVIEW_TRIGGERS.streakMilestones]).toEqual([7, 30]);
  });

  it('fits inside the iOS 3-per-365 ceiling by itself', () => {
    expect(REVIEW_TRIGGERS.lifetimeCap).toBeLessThanOrEqual(3);
    expect(REVIEW_TRIGGERS.cooldownDays).toBeGreaterThanOrEqual(90);
    // Three attempts 90 days apart span more than a year, so our own throttle is stricter than
    // the OS quota and we can never have a prompt silently eaten.
    expect((REVIEW_TRIGGERS.lifetimeCap - 1) * REVIEW_TRIGGERS.cooldownDays).toBeGreaterThanOrEqual(
      180
    );
  });

  it('never prompts before the second session', () => {
    expect(REVIEW_TRIGGERS.minSessionOrdinal).toBeGreaterThanOrEqual(2);
    expect(REVIEW_TRIGGERS.minSessionsBeforeFirstPrompt).toBeGreaterThanOrEqual(
      REVIEW_TRIGGERS.minSessionOrdinal
    );
  });

  it('waits for the moment to land before asking', () => {
    expect(REVIEW_TRIGGERS.settleDelayMs).toBeGreaterThan(0);
  });

  it('keeps every guard duration positive, so none of them degrades to a no-op', () => {
    const durations = [
      REVIEW_TRIGGERS.completeWeekDays,
      REVIEW_TRIGGERS.minDaysSinceInstall,
      REVIEW_TRIGGERS.quietAfterAdhanMs,
      REVIEW_TRIGGERS.prayerWindowMinutes,
      REVIEW_TRIGGERS.cooldownAfterStreakBreakDays,
      REVIEW_TRIGGERS.cooldownAfterMistapDays,
      REVIEW_TRIGGERS.cooldownAfterTimesAdjustedDays,
      REVIEW_TRIGGERS.cooldownAfterUncleanSessionDays,
      REVIEW_TRIGGERS.maxLogEntries,
    ];
    for (const value of durations) expect(value).toBeGreaterThan(0);
  });

  it('treats a wrong-times adjustment as the loudest signal of the three', () => {
    expect(REVIEW_TRIGGERS.cooldownAfterTimesAdjustedDays).toBeGreaterThan(
      REVIEW_TRIGGERS.cooldownAfterStreakBreakDays
    );
    expect(REVIEW_TRIGGERS.cooldownAfterStreakBreakDays).toBeGreaterThan(
      REVIEW_TRIGGERS.cooldownAfterMistapDays
    );
  });

  it('defines a complete week as seven days', () => {
    expect(REVIEW_TRIGGERS.completeWeekDays).toBe(7);
  });

  it('keeps the "praying right now" window well short of the gap between two prayers', () => {
    // `getPrayerWindows` tiles the whole day, so this number — not the window — is what stops the
    // prayer-window exclusion from being permanently true. Anything approaching a couple of hours
    // would silence the feature by accident.
    expect(REVIEW_TRIGGERS.prayerWindowMinutes).toBeGreaterThanOrEqual(15);
    expect(REVIEW_TRIGGERS.prayerWindowMinutes).toBeLessThanOrEqual(60);
  });
});

describe('the steady-use trigger (D89)', () => {
  it('is tried much later than the first prompt could ever be', () => {
    // It is the trigger of last resort, not an earlier one. If these ever crossed, the weakest
    // moment in the set would start beating a real milestone to the single lifetime attempt.
    expect(REVIEW_TRIGGERS.steadyUseSessions).toBeGreaterThan(
      REVIEW_TRIGGERS.minSessionsBeforeFirstPrompt
    );
    expect(REVIEW_TRIGGERS.steadyUseMinDays).toBeGreaterThan(REVIEW_TRIGGERS.minDaysSinceInstall);
  });

  it('waits longer than a logger would take to earn a better moment', () => {
    // Someone who logs reaches a 7-day streak, or a complete week, well inside this window and
    // spends the attempt there. That overlap is what keeps this from reaching them at all.
    expect(REVIEW_TRIGGERS.steadyUseMinDays).toBeGreaterThan(REVIEW_TRIGGERS.completeWeekDays);
    expect(REVIEW_TRIGGERS.steadyUseMinDays).toBeGreaterThan(
      Math.min(...REVIEW_TRIGGERS.streakMilestones)
    );
  });
});
