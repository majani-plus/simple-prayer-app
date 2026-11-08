/**
 * Tests for the pure notification plan.
 *
 * ## Timezone strategy
 *
 * Every instant in this file is built from **local** calendar components
 * (`new Date(year, monthIndex, day, hours, minutes)`) by the `at()` helper — never from a UTC
 * literal like `"2026-08-19T05:00:00Z"`. Fixtures and expectations are therefore expressed in
 * the same wall clock, so the suite gives identical results on the dev machine
 * (Europe/Istanbul, UTC+3) and in CI (UTC).
 *
 * `at()` also relies on `Date`'s field normalisation for after-midnight markers: hour `24`
 * means 00:00 of the next calendar day, which is exactly where Islamic midnight lives.
 *
 * The synthetic day used throughout (Fajr 05:00 … Isha 21:45, Islamic midnight 00:30) is
 * deliberately *not* produced by adhan-js: this module never calls adhan, and hand-built times
 * make the window arithmetic legible in the assertions.
 */

import {
  DEFAULT_MAX_NOTIFICATIONS,
  DEFAULT_NUDGE_LEAD_MINUTES,
  DEFAULT_PLAN_DAYS,
  IOS_NOTIFICATION_LIMIT,
  MAX_NUDGE_LEAD_MINUTES,
  MIN_NUDGE_LEAD_MINUTES,
  diffPlans,
  notificationKey,
  planNotifications,
  selectStaleDelivered,
  type DeliveredNotification,
  type NotificationPlanInput,
  type PrayerStatusMap,
} from './notificationPlan';
import { computeDayTimes, getIshaNudgeTime } from './prayerTimes';
import {
  PRAYERS,
  type DayTimes,
  type PlannedNotification,
  type Prayer,
  type PrayerDay,
  type PrayerReminderSettings,
  type ReminderSettings,
} from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A local wall-clock instant on `day`. Hours ≥ 24 roll into the following calendar date
 * (`at('2026-08-19', 24, 30)` is 2026-08-20 00:30 local), which is how the after-midnight
 * markers are expressed.
 */
function at(day: PrayerDay, hours: number, minutes: number): Date {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(year, month - 1, dayOfMonth, hours, minutes, 0, 0);
}

const D1: PrayerDay = '2026-08-19';
const D2: PrayerDay = '2026-08-20';
const D3: PrayerDay = '2026-08-21';
const D4: PrayerDay = '2026-08-22';
const D5: PrayerDay = '2026-08-23';

/**
 * The synthetic day used by nearly every test.
 *
 * ```
 * fajr 05:00 · sunrise 06:30 · dhuhr 13:00 · asr 16:45 · maghrib 20:15 · isha 21:45
 * islamic midnight 00:30 (next date) · last third 02:15 (next date)
 * ```
 *
 * Derived windows (`domain/windows.ts` — Fajr's ends at SUNRISE, the rest at the next prayer) and,
 * with the default 20-minute lead, nudge instants:
 * fajr 06:10 · dhuhr 16:25 · asr 19:55 · maghrib 21:25 · isha 00:30 (Islamic midnight, no lead).
 */
function makeDay(day: PrayerDay): DayTimes {
  return {
    day,
    method: 'muslimWorldLeague',
    times: {
      fajr: at(day, 5, 0),
      sunrise: at(day, 6, 30),
      dhuhr: at(day, 13, 0),
      asr: at(day, 16, 45),
      maghrib: at(day, 20, 15),
      isha: at(day, 21, 45),
      middleOfTheNight: at(day, 24, 30),
      lastThirdOfTheNight: at(day, 26, 15),
    },
  };
}

/** `count` consecutive synthetic days starting at `2026-08-19`. */
function makeDays(count: number): DayTimes[] {
  const start = at(D1, 12, 0);
  const days: DayTimes[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
    days.push(makeDay(day));
  }
  return days;
}

function reminder(overrides: Partial<PrayerReminderSettings> = {}): PrayerReminderSettings {
  return {
    adhanEnabled: false,
    sound: 'system',
    preReminderEnabled: false,
    preReminderMinutes: 15,
    nudgeEnabled: false,
    ...overrides,
  };
}

/** The same settings for all five prayers (fresh object per prayer). */
function everyPrayer(overrides: Partial<PrayerReminderSettings> = {}): ReminderSettings {
  return {
    fajr: reminder(overrides),
    dhuhr: reminder(overrides),
    asr: reminder(overrides),
    maghrib: reminder(overrides),
    isha: reminder(overrides),
  };
}

const ALL_OFF = everyPrayer();
const ALL_ON = everyPrayer({
  adhanEnabled: true,
  preReminderEnabled: true,
  nudgeEnabled: true,
});

/**
 * A maximal configuration: every per-prayer reminder on **and** the sunrise note, which is not a
 * per-prayer setting and ships off (D90). This is what the iOS-cap arithmetic in PRODUCT_SPEC
 * §11.4 counts — sixteen a day — so the tests that quote those numbers spread this rather than
 * `ALL_ON` alone.
 */
const EVERYTHING_ON = { reminders: ALL_ON, sunriseNoteEnabled: true } as const;

function makeInput(overrides: Partial<NotificationPlanInput> = {}): NotificationPlanInput {
  return {
    now: at(D1, 4, 0),
    days: makeDays(DEFAULT_PLAN_DAYS),
    reminders: ALL_OFF,
    statuses: {},
    exemptDays: new Set<PrayerDay>(),
    ...overrides,
  };
}

/** Convenience: the keys of a plan, in plan order. */
const keysOf = (plan: PlannedNotification[]) => plan.map((n) => n.key);

/** The single planned notification with this key, or `undefined`. */
const find = (plan: PlannedNotification[], key: string) => plan.find((n) => n.key === key);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('states the real iOS pending-notification ceiling', () => {
    expect(IOS_NOTIFICATION_LIMIT).toBe(64);
  });

  it('plans a rolling five-day window by default', () => {
    expect(DEFAULT_PLAN_DAYS).toBe(5);
  });

  it('caps below the iOS limit, leaving headroom', () => {
    expect(DEFAULT_MAX_NOTIFICATIONS).toBe(60);
    expect(DEFAULT_MAX_NOTIFICATIONS).toBeLessThan(IOS_NOTIFICATION_LIMIT);
  });

  it('uses a documented non-Isha nudge lead', () => {
    expect(DEFAULT_NUDGE_LEAD_MINUTES).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

describe('notificationKey', () => {
  it('is exactly kind:day:prayer', () => {
    expect(notificationKey('adhan', D1, 'fajr')).toBe('adhan:2026-08-19:fajr');
    expect(notificationKey('preReminder', D2, 'maghrib')).toBe('preReminder:2026-08-20:maghrib');
    expect(notificationKey('nudge', D3, 'isha')).toBe('nudge:2026-08-21:isha');
  });

  it('matches the key every planned notification carries', () => {
    const plan = planNotifications(makeInput({ ...EVERYTHING_ON, maxCount: 1000 }));
    expect(plan.length).toBeGreaterThan(0);
    for (const notification of plan) {
      expect(notification.key).toBe(
        notificationKey(notification.kind, notification.day, notification.prayer)
      );
      expect(notification.key.split(':')).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------
// A full five-day plan
// ---------------------------------------------------------------------------

describe('planNotifications — a full five-day plan under the cap', () => {
  const plan = planNotifications(
    makeInput({ reminders: everyPrayer({ adhanEnabled: true, nudgeEnabled: true }) })
  );

  it('plans an adhan and a nudge for every prayer of every day', () => {
    // 5 days × 5 prayers × 2 kinds = 50 — the shipped default configuration, which since D90
    // does NOT include the sunrise note. It fits under the 60 cap with the full five-day
    // horizon, and asking for the note costs one more a day: 55, still under it.
    expect(plan).toHaveLength(50);
    expect(plan.some((n) => n.kind === 'expiry')).toBe(false);
    expect(plan.length).toBeLessThan(DEFAULT_MAX_NOTIFICATIONS);

    const withNote = planNotifications(
      makeInput({
        reminders: everyPrayer({ adhanEnabled: true, nudgeEnabled: true }),
        sunriseNoteEnabled: true,
      })
    );
    expect(withNote).toHaveLength(55);
    expect(withNote.length).toBeLessThan(DEFAULT_MAX_NOTIFICATIONS);
  });

  it('covers every day and every prayer exactly once per kind', () => {
    for (const day of [D1, D2, D3, D4, D5]) {
      for (const prayer of PRAYERS) {
        expect(find(plan, `adhan:${day}:${prayer}`)).toBeDefined();
        expect(find(plan, `nudge:${day}:${prayer}`)).toBeDefined();
      }
    }
    expect(new Set(keysOf(plan)).size).toBe(plan.length);
  });

  it('is strictly ordered by fireAt', () => {
    for (let index = 1; index < plan.length; index += 1) {
      expect(plan[index].fireAt.getTime()).toBeGreaterThanOrEqual(plan[index - 1].fireAt.getTime());
    }
  });

  it('never plans anything at or before now', () => {
    const nowMs = at(D1, 4, 0).getTime();
    for (const notification of plan) {
      expect(notification.fireAt.getTime()).toBeGreaterThan(nowMs);
    }
  });

  it('keeps each day self-contained — day N finishes before day N+1 begins', () => {
    const dayOrder = plan.map((n) => n.day);
    const firstSeen = [...new Set(dayOrder)];
    expect(firstSeen).toEqual([D1, D2, D3, D4, D5]);
    // Days never interleave: 10 per day here (adhan + nudge × 5 prayers), and the Isha nudge at
    // Islamic midnight — already past calendar midnight — is still the last item of its day.
    expect(dayOrder).toEqual([D1, D2, D3, D4, D5].flatMap((day) => Array(10).fill(day)));
    expect(plan[9].key).toBe(`nudge:${D1}:isha`);
  });

  it('plans the last day even though the following day is unknown', () => {
    const lastIshaNudge = find(plan, `nudge:${D5}:isha`);
    expect(lastIshaNudge?.fireAt).toEqual(at(D5, 24, 30));
  });
});

// ---------------------------------------------------------------------------
// Adhan notifications
// ---------------------------------------------------------------------------

describe('planNotifications — adhan notifications', () => {
  it('fires exactly at the prayer start', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: everyPrayer({ adhanEnabled: true }) })
    );
    expect(find(plan, `adhan:${D1}:fajr`)?.fireAt).toEqual(at(D1, 5, 0));
    expect(find(plan, `adhan:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 13, 0));
    expect(find(plan, `adhan:${D1}:asr`)?.fireAt).toEqual(at(D1, 16, 45));
    expect(find(plan, `adhan:${D1}:maghrib`)?.fireAt).toEqual(at(D1, 20, 15));
    expect(find(plan, `adhan:${D1}:isha`)?.fireAt).toEqual(at(D1, 21, 45));
  });

  it('carries that prayer’s configured sound', () => {
    const reminders: ReminderSettings = {
      fajr: reminder({ adhanEnabled: true, sound: 'adhan' }),
      dhuhr: reminder({ adhanEnabled: true, sound: 'system' }),
      asr: reminder({ adhanEnabled: true, sound: 'silent' }),
      maghrib: reminder({ adhanEnabled: true, sound: 'adhan' }),
      isha: reminder({ adhanEnabled: true, sound: 'silent' }),
    };
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders }));
    expect(find(plan, `adhan:${D1}:fajr`)?.sound).toBe('adhan');
    expect(find(plan, `adhan:${D1}:dhuhr`)?.sound).toBe('system');
    expect(find(plan, `adhan:${D1}:asr`)?.sound).toBe('silent');
    expect(find(plan, `adhan:${D1}:maghrib`)?.sound).toBe('adhan');
    expect(find(plan, `adhan:${D1}:isha`)?.sound).toBe('silent');
  });

  it('is per-prayer: a disabled prayer contributes no adhan', () => {
    const reminders = everyPrayer({ adhanEnabled: true });
    reminders.asr = reminder({ adhanEnabled: false });
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders }));
    expect(keysOf(plan)).toEqual([
      `adhan:${D1}:fajr`,
      `adhan:${D1}:dhuhr`,
      `adhan:${D1}:maghrib`,
      `adhan:${D1}:isha`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pre-reminders
// ---------------------------------------------------------------------------

describe('planNotifications — pre-reminders', () => {
  it('fires the configured number of minutes before the prayer', () => {
    const reminders: ReminderSettings = {
      fajr: reminder({ preReminderEnabled: true, preReminderMinutes: 30 }),
      dhuhr: reminder({ preReminderEnabled: true, preReminderMinutes: 10 }),
      asr: reminder({ preReminderEnabled: true, preReminderMinutes: 5 }),
      maghrib: reminder(),
      isha: reminder({ preReminderEnabled: true, preReminderMinutes: 45 }),
    };
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders }));
    expect(find(plan, `preReminder:${D1}:fajr`)?.fireAt).toEqual(at(D1, 4, 30));
    expect(find(plan, `preReminder:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 12, 50));
    expect(find(plan, `preReminder:${D1}:asr`)?.fireAt).toEqual(at(D1, 16, 40));
    expect(find(plan, `preReminder:${D1}:maghrib`)).toBeUndefined();
    expect(find(plan, `preReminder:${D1}:isha`)?.fireAt).toEqual(at(D1, 21, 0));
  });

  it('never plays the adhan clip, but honours an explicit silent choice', () => {
    const reminders: ReminderSettings = {
      fajr: reminder({ preReminderEnabled: true, sound: 'adhan' }),
      dhuhr: reminder({ preReminderEnabled: true, sound: 'silent' }),
      asr: reminder({ preReminderEnabled: true, sound: 'system' }),
      maghrib: reminder(),
      isha: reminder(),
    };
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders }));
    expect(find(plan, `preReminder:${D1}:fajr`)?.sound).toBe('system');
    expect(find(plan, `preReminder:${D1}:dhuhr`)?.sound).toBe('silent');
    expect(find(plan, `preReminder:${D1}:asr`)?.sound).toBe('system');
  });

  it('is skipped when the offset is not a positive number of minutes', () => {
    for (const preReminderMinutes of [0, -15, Number.NaN]) {
      const plan = planNotifications(
        makeInput({
          days: makeDays(1),
          reminders: everyPrayer({ preReminderEnabled: true, preReminderMinutes }),
        })
      );
      expect(plan).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Nudges — timing
// ---------------------------------------------------------------------------

describe('planNotifications — nudge timing', () => {
  const plan = planNotifications(
    makeInput({ days: makeDays(1), reminders: everyPrayer({ nudgeEnabled: true }) })
  );

  it('fires the lead time before the window end for the three midday prayers', () => {
    // Windows end at the next prayer's time (`domain/windows.ts`); lead is 20 minutes.
    expect(find(plan, `nudge:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 16, 25)); // asr 16:45 − 20
    expect(find(plan, `nudge:${D1}:asr`)?.fireAt).toEqual(at(D1, 19, 55)); // maghrib 20:15 − 20
    expect(find(plan, `nudge:${D1}:maghrib`)?.fireAt).toEqual(at(D1, 21, 25)); // isha 21:45 − 20
  });

  it('LAST-CALLS FAJR BEFORE SUNRISE, not before Dhuhr', () => {
    // Fajr's window shuts at sunrise, so its nudge is 06:10 (sunrise 06:30 − 20) — while there is
    // still time to pray it. Timed off Dhuhr it fired at 12:40, six hours after the deadline,
    // which is the whole reason this rule was wrong.
    expect(find(plan, `nudge:${D1}:fajr`)?.fireAt).toEqual(at(D1, 6, 10));
    expect(find(plan, `nudge:${D1}:fajr`)?.fireAt).not.toEqual(at(D1, 12, 40));
  });

  it('uses Islamic midnight for Isha, not the 4am window end', () => {
    const ishaNudge = find(plan, `nudge:${D1}:isha`);
    // middleOfTheNight, i.e. 00:30 the next calendar date — never the next day's Fajr (05:00).
    expect(ishaNudge?.fireAt).toEqual(at(D1, 24, 30));
    expect(ishaNudge?.fireAt).not.toEqual(at(D2, 5, 0));
    // …and the lead time is deliberately NOT subtracted from Islamic midnight.
    expect(ishaNudge?.fireAt.getTime()).toBe(at(D1, 24, 30).getTime());
  });

  it('prefers an explicit ishaNudgeTimes entry over middleOfTheNight', () => {
    const overridden = planNotifications(
      makeInput({
        days: makeDays(2),
        reminders: everyPrayer({ nudgeEnabled: true }),
        ishaNudgeTimes: { [D1]: at(D1, 23, 55) },
      })
    );
    expect(find(overridden, `nudge:${D1}:isha`)?.fireAt).toEqual(at(D1, 23, 55));
    // Days without an override fall back to their own middleOfTheNight.
    expect(find(overridden, `nudge:${D2}:isha`)?.fireAt).toEqual(at(D2, 24, 30));
  });

  it('honours a custom nudge lead for the non-Isha prayers only', () => {
    const custom = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders: everyPrayer({ nudgeEnabled: true }),
        nudgeLeadMinutes: 45,
      })
    );
    expect(find(custom, `nudge:${D1}:fajr`)?.fireAt).toEqual(at(D1, 5, 45)); // sunrise 06:30 − 45
    expect(find(custom, `nudge:${D1}:maghrib`)?.fireAt).toEqual(at(D1, 21, 0));
    expect(find(custom, `nudge:${D1}:isha`)?.fireAt).toEqual(at(D1, 24, 30));
  });

  it('drops a nudge that would fall outside its own window', () => {
    // Maghrib's window here is 90 minutes long and Fajr's (dawn→sunrise) is 90 too; a 120-minute
    // lead lands before each prayer even begins. Fajr's short window is the realistic case — at
    // high latitudes dawn and sunrise can be minutes apart, and a lead longer than the window
    // must go silent rather than shout before dawn.
    const days = [makeDay(D1)];
    const plan120 = planNotifications(
      makeInput({
        days,
        reminders: everyPrayer({ nudgeEnabled: true }),
        nudgeLeadMinutes: 120,
      })
    );
    expect(find(plan120, `nudge:${D1}:maghrib`)).toBeUndefined();
    expect(find(plan120, `nudge:${D1}:fajr`)).toBeUndefined();
    // The long-windowed prayers still get theirs (dhuhr 13:00 → asr 16:45).
    expect(find(plan120, `nudge:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 14, 45));
  });

  it('drops the Isha nudge when Islamic midnight precedes Isha (degenerate high-latitude night)', () => {
    const day = makeDay(D1);
    const degenerate: DayTimes = {
      ...day,
      times: { ...day.times, middleOfTheNight: at(D1, 21, 0) }, // before isha 21:45
    };
    const plan = planNotifications(
      makeInput({ days: [degenerate], reminders: everyPrayer({ nudgeEnabled: true }) })
    );
    expect(find(plan, `nudge:${D1}:isha`)).toBeUndefined();
    expect(find(plan, `nudge:${D1}:maghrib`)).toBeDefined();
  });

  it('never lets the Isha nudge spill past the next day’s Fajr', () => {
    const day = makeDay(D1);
    const late: DayTimes = {
      ...day,
      times: { ...day.times, middleOfTheNight: at(D1, 29, 0) }, // 05:00 next day = next Fajr
    };
    const plan = planNotifications(
      makeInput({ days: [late, makeDay(D2)], reminders: everyPrayer({ nudgeEnabled: true }) })
    );
    expect(find(plan, `nudge:${D1}:isha`)).toBeUndefined();
  });

  it('carries an ancillary sound, never the adhan clip', () => {
    const reminders: ReminderSettings = {
      fajr: reminder({ nudgeEnabled: true, sound: 'adhan' }),
      dhuhr: reminder({ nudgeEnabled: true, sound: 'silent' }),
      asr: reminder(),
      maghrib: reminder(),
      isha: reminder(),
    };
    const nudges = planNotifications(makeInput({ days: makeDays(1), reminders }));
    expect(find(nudges, `nudge:${D1}:fajr`)?.sound).toBe('system');
    expect(find(nudges, `nudge:${D1}:dhuhr`)?.sound).toBe('silent');
  });
});

// ---------------------------------------------------------------------------
// Nudges — suppression by log status
// ---------------------------------------------------------------------------

describe('planNotifications — a logged prayer suppresses only its nudge', () => {
  const reminders = everyPrayer({
    adhanEnabled: true,
    preReminderEnabled: true,
    nudgeEnabled: true,
  });

  it('keeps the adhan and pre-reminder of a prayer that was already logged', () => {
    const statuses: PrayerStatusMap = { [D1]: { dhuhr: 'prayed' } };
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders, statuses }));

    expect(find(plan, `nudge:${D1}:dhuhr`)).toBeUndefined();
    expect(find(plan, `adhan:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 13, 0));
    expect(find(plan, `preReminder:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 12, 45));
  });

  it('leaves the other prayers’ nudges alone', () => {
    const statuses: PrayerStatusMap = { [D1]: { dhuhr: 'prayed' } };
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders, statuses }));
    for (const prayer of PRAYERS) {
      const expected = prayer === 'dhuhr' ? undefined : expect.anything();
      expect(find(plan, `nudge:${D1}:${prayer}`)).toEqual(expected);
    }
  });

  it('leaves the same prayer on other days alone', () => {
    const statuses: PrayerStatusMap = { [D1]: { dhuhr: 'prayed' } };
    const plan = planNotifications(
      makeInput({ days: makeDays(3), reminders, statuses, maxCount: 1000 })
    );
    expect(find(plan, `nudge:${D1}:dhuhr`)).toBeUndefined();
    expect(find(plan, `nudge:${D2}:dhuhr`)).toBeDefined();
    expect(find(plan, `nudge:${D3}:dhuhr`)).toBeDefined();
  });

  it.each(['prayed', 'late', 'missed', 'exempt'] as const)('treats %s as logged', (status) => {
    const statuses: PrayerStatusMap = { [D1]: { asr: status } };
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders, statuses }));
    expect(find(plan, `nudge:${D1}:asr`)).toBeUndefined();
    expect(find(plan, `adhan:${D1}:asr`)).toBeDefined();
  });

  it('treats an explicit "unlogged" exactly like a missing entry', () => {
    const explicit = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders,
        statuses: { [D1]: { asr: 'unlogged' } },
      })
    );
    const missing = planNotifications(makeInput({ days: makeDays(1), reminders, statuses: {} }));
    expect(keysOf(explicit)).toEqual(keysOf(missing));
    expect(find(explicit, `nudge:${D1}:asr`)).toBeDefined();
  });

  it('tolerates a statuses map with no entry for the day at all', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders, statuses: { '2020-01-01': { fajr: 'prayed' } } })
    );
    expect(find(plan, `nudge:${D1}:fajr`)).toBeDefined();
  });

  it('suppresses every nudge when the whole day is logged, keeping every adhan', () => {
    const statuses: PrayerStatusMap = {
      [D1]: { fajr: 'prayed', dhuhr: 'late', asr: 'prayed', maghrib: 'missed', isha: 'prayed' },
    };
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders, statuses }));
    expect(plan.filter((n) => n.kind === 'nudge')).toEqual([]);
    expect(plan.filter((n) => n.kind === 'adhan')).toHaveLength(5);
    expect(plan.filter((n) => n.kind === 'preReminder')).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Exempt days
// ---------------------------------------------------------------------------

describe('planNotifications — exempt days', () => {
  // Everything a user can turn on, the sunrise note included: an exempt day has to silence the
  // maximal configuration, not just the shipped one.
  const { reminders, sunriseNoteEnabled } = EVERYTHING_ON;

  it('produces nothing at all on an exempt day — not even the adhan', () => {
    const plan = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders,
        sunriseNoteEnabled,
        exemptDays: new Set<PrayerDay>([D1]),
      })
    );
    expect(plan).toEqual([]);
  });

  it('a KEPT exempt day speaks the clock and nothing else: adhan and pre-reminder, never a nudge or sunrise note (owner, 2026-08-28)', () => {
    const plan = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders,
        sunriseNoteEnabled,
        exemptDays: new Set<PrayerDay>([D1]),
        reminderKeptDays: new Set<PrayerDay>([D1]),
        maxCount: 1000,
      })
    );
    const kinds = new Set(plan.map((n) => n.kind));
    expect(kinds).toEqual(new Set(['adhan', 'preReminder']));
    // All five prayers keep both obligation-free kinds.
    expect(plan.filter((n) => n.kind === 'adhan')).toHaveLength(5);
    expect(plan.filter((n) => n.kind === 'preReminder')).toHaveLength(5);
  });

  it('keeping the call on one exempt day silences no other exempt day', () => {
    const plan = planNotifications(
      makeInput({
        days: makeDays(2),
        reminders,
        sunriseNoteEnabled,
        exemptDays: new Set<PrayerDay>([D1, D2]),
        reminderKeptDays: new Set<PrayerDay>([D1]),
        maxCount: 1000,
      })
    );
    expect(plan.some((n) => n.day === D1)).toBe(true);
    expect(plan.some((n) => n.day === D2)).toBe(false);
  });

  it('reminderKeptDays without exemption changes nothing — it only ever unmutes exempt days', () => {
    const kept = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders,
        sunriseNoteEnabled,
        reminderKeptDays: new Set<PrayerDay>([D1]),
        maxCount: 1000,
      })
    );
    const plain = planNotifications(
      makeInput({ days: makeDays(1), reminders, sunriseNoteEnabled, maxCount: 1000 })
    );
    expect(keysOf(kept)).toEqual(keysOf(plain));
  });

  it('leaves the surrounding days untouched', () => {
    const plan = planNotifications(
      makeInput({
        days: makeDays(3),
        reminders,
        sunriseNoteEnabled,
        exemptDays: new Set<PrayerDay>([D2]),
        maxCount: 1000,
      })
    );
    expect(plan.some((n) => n.day === D2)).toBe(false);
    // 5 prayers × 3 kinds, plus Fajr's expiry.
    expect(plan.filter((n) => n.day === D1)).toHaveLength(16);
    expect(plan.filter((n) => n.day === D3)).toHaveLength(16);
  });

  it('produces an empty plan when every day is exempt', () => {
    const plan = planNotifications(
      makeInput({
        reminders,
        sunriseNoteEnabled,
        exemptDays: new Set<PrayerDay>([D1, D2, D3, D4, D5]),
      })
    );
    expect(plan).toEqual([]);
  });

  it('ignores exempt days that are not in the planning window', () => {
    const plan = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders,
        sunriseNoteEnabled,
        exemptDays: new Set<PrayerDay>(['2026-09-01']),
      })
    );
    expect(plan).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// The `now` boundary
// ---------------------------------------------------------------------------

describe('planNotifications — past instants are dropped', () => {
  const reminders = everyPrayer({
    adhanEnabled: true,
    preReminderEnabled: true,
    nudgeEnabled: true,
  });

  it('drops everything already in the past on the current day', () => {
    // 17:00 — Fajr, Dhuhr and Asr (16:45) have all started; Asr's nudge is at 19:55.
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders, now: at(D1, 17, 0) }));
    expect(keysOf(plan)).toEqual([
      `nudge:${D1}:asr`,
      `preReminder:${D1}:maghrib`,
      `adhan:${D1}:maghrib`,
      `nudge:${D1}:maghrib`,
      `preReminder:${D1}:isha`,
      `adhan:${D1}:isha`,
      `nudge:${D1}:isha`,
    ]);
  });

  it('drops a notification falling exactly on now', () => {
    const plan = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders: everyPrayer({ adhanEnabled: true }),
        now: at(D1, 13, 0),
      })
    );
    expect(find(plan, `adhan:${D1}:dhuhr`)).toBeUndefined();
    expect(find(plan, `adhan:${D1}:asr`)).toBeDefined();
  });

  it('keeps a notification one millisecond after now', () => {
    const oneMsBefore = new Date(at(D1, 13, 0).getTime() - 1);
    const plan = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders: everyPrayer({ adhanEnabled: true }),
        now: oneMsBefore,
      })
    );
    expect(find(plan, `adhan:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 13, 0));
  });

  it('drops whole days that are entirely in the past', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(3), reminders, now: at(D3, 4, 0), maxCount: 1000 })
    );
    expect(new Set(plan.map((n) => n.day))).toEqual(new Set([D3]));
  });

  it('returns an empty plan when the whole window is behind us', () => {
    const plan = planNotifications(makeInput({ days: makeDays(2), reminders, now: at(D5, 12, 0) }));
    expect(plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ordering & the cap
// ---------------------------------------------------------------------------

describe('planNotifications — ordering and the cap', () => {
  it('breaks fireAt ties by key, deterministically', () => {
    // Asr's pre-reminder at 20 minutes lands on 16:25 — the same instant as Dhuhr's nudge.
    const reminders = everyPrayer();
    reminders.dhuhr = reminder({ nudgeEnabled: true });
    reminders.asr = reminder({ preReminderEnabled: true, preReminderMinutes: 20 });
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders }));

    expect(plan).toHaveLength(2);
    expect(plan[0].fireAt.getTime()).toBe(plan[1].fireAt.getTime());
    expect(keysOf(plan)).toEqual([`nudge:${D1}:dhuhr`, `preReminder:${D1}:asr`]);
  });

  it('caps at maxCount, keeping the earliest and dropping the latest', () => {
    const uncapped = planNotifications(makeInput({ ...EVERYTHING_ON, maxCount: 1000 }));
    // 5 days × (5 prayers × 3 kinds + Fajr's expiry) — everything a user can turn on.
    expect(uncapped).toHaveLength(80);

    const capped = planNotifications(makeInput({ ...EVERYTHING_ON }));
    expect(capped).toHaveLength(DEFAULT_MAX_NOTIFICATIONS);
    expect(keysOf(capped)).toEqual(keysOf(uncapped).slice(0, DEFAULT_MAX_NOTIFICATIONS));

    // Everything kept fires no later than everything dropped.
    const lastKept = capped[capped.length - 1].fireAt.getTime();
    const firstDropped = uncapped[DEFAULT_MAX_NOTIFICATIONS].fireAt.getTime();
    expect(lastKept).toBeLessThanOrEqual(firstDropped);

    // 16 per day, so the cap of 60 buys three whole days and most of a fourth — the price of a
    // maximal configuration, and the arithmetic PRODUCT_SPEC §11 states.
    expect(new Set(capped.map((n) => n.day))).toEqual(new Set([D1, D2, D3, D4]));
    expect(capped.filter((n) => n.day === D4)).toHaveLength(60 - 3 * 16);
  });

  it('honours an explicit maxCount', () => {
    const plan = planNotifications(makeInput({ ...EVERYTHING_ON, maxCount: 7 }));
    expect(plan).toHaveLength(7);
    expect(keysOf(plan)).toEqual([
      `preReminder:${D1}:fajr`,
      `adhan:${D1}:fajr`,
      `nudge:${D1}:fajr`,
      `expiry:${D1}:fajr`,
      `preReminder:${D1}:dhuhr`,
      `adhan:${D1}:dhuhr`,
      `nudge:${D1}:dhuhr`,
    ]);
  });

  it('returns nothing when maxCount is zero', () => {
    expect(planNotifications(makeInput({ ...EVERYTHING_ON, maxCount: 0 }))).toEqual([]);
  });

  it('does not pad when the plan is shorter than the cap', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: everyPrayer({ adhanEnabled: true }), maxCount: 99 })
    );
    expect(plan).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Nothing enabled
// ---------------------------------------------------------------------------

describe('planNotifications — nothing to plan', () => {
  it('returns an empty plan when every reminder is disabled', () => {
    expect(planNotifications(makeInput({ reminders: ALL_OFF }))).toEqual([]);
  });

  it('returns an empty plan when there are no days', () => {
    expect(planNotifications(makeInput({ days: [], ...EVERYTHING_ON }))).toEqual([]);
  });

  it('returns an empty plan when everything is disabled and every day is exempt', () => {
    expect(
      planNotifications(
        makeInput({ reminders: ALL_OFF, exemptDays: new Set<PrayerDay>([D1, D2, D3, D4, D5]) })
      )
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validation & robustness
// ---------------------------------------------------------------------------

describe('planNotifications — validation', () => {
  it('rejects an invalid now', () => {
    expect(() => planNotifications(makeInput({ now: new Date('nope') }))).toThrow(RangeError);
  });

  it('rejects a non-consecutive day list', () => {
    const days = [makeDay(D1), makeDay(D3)];
    expect(() => planNotifications(makeInput({ days }))).toThrow(/consecutive/);
  });

  it('rejects a descending day list', () => {
    const days = [makeDay(D2), makeDay(D1)];
    expect(() => planNotifications(makeInput({ days }))).toThrow(/consecutive/);
  });

  it('rejects a repeated day', () => {
    const days = [makeDay(D1), makeDay(D1)];
    expect(() => planNotifications(makeInput({ days }))).toThrow(/consecutive/);
  });

  it('rejects a malformed day string', () => {
    const bad = { ...makeDay(D1), day: '2026-02-30' };
    expect(() => planNotifications(makeInput({ days: [bad] }))).toThrow(RangeError);
  });

  it('rejects a negative or fractional maxCount', () => {
    expect(() => planNotifications(makeInput({ maxCount: -1 }))).toThrow(RangeError);
    expect(() => planNotifications(makeInput({ maxCount: 3.5 }))).toThrow(RangeError);
  });

  it('rejects a negative nudge lead', () => {
    expect(() => planNotifications(makeInput({ nudgeLeadMinutes: -5 }))).toThrow(RangeError);
    expect(() => planNotifications(makeInput({ nudgeLeadMinutes: Number.NaN }))).toThrow(
      RangeError
    );
  });

  it('accepts a single day', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: everyPrayer({ adhanEnabled: true }) })
    );
    expect(plan).toHaveLength(5);
  });
});

describe('planNotifications — robustness', () => {
  it('skips a prayer whose time could not be resolved, without throwing', () => {
    const day = makeDay(D1);
    const polar: DayTimes = {
      ...day,
      times: { ...day.times, maghrib: new Date(Number.NaN) },
    };
    const plan = planNotifications(makeInput({ days: [polar], reminders: ALL_ON }));

    expect(plan.some((n) => n.prayer === 'maghrib')).toBe(false);
    expect(find(plan, `adhan:${D1}:isha`)).toBeDefined();
    // Asr's window closed at Maghrib, so its nudge goes too — but its adhan survives.
    expect(find(plan, `nudge:${D1}:asr`)).toBeUndefined();
    expect(find(plan, `adhan:${D1}:asr`)).toBeDefined();
  });

  it('skips the Isha nudge when Islamic midnight is unresolved', () => {
    const day = makeDay(D1);
    const polar: DayTimes = {
      ...day,
      times: { ...day.times, middleOfTheNight: new Date(Number.NaN) },
    };
    const plan = planNotifications(makeInput({ days: [polar], reminders: ALL_ON }));
    expect(find(plan, `nudge:${D1}:isha`)).toBeUndefined();
    expect(find(plan, `adhan:${D1}:isha`)).toBeDefined();
  });

  it('is deterministic — identical input yields an identical plan', () => {
    const first = planNotifications(makeInput({ reminders: ALL_ON }));
    const second = planNotifications(makeInput({ reminders: ALL_ON }));
    expect(first).toEqual(second);
  });

  it('does not mutate its input', () => {
    const input = makeInput({
      reminders: ALL_ON,
      statuses: { [D1]: { fajr: 'prayed' } },
      exemptDays: new Set<PrayerDay>([D3]),
      ishaNudgeTimes: { [D2]: at(D2, 23, 0) },
    });
    const before = JSON.stringify({
      now: input.now,
      days: input.days,
      reminders: input.reminders,
      statuses: input.statuses,
      exemptDays: [...input.exemptDays],
      ishaNudgeTimes: input.ishaNudgeTimes,
    });
    planNotifications(input);
    const after = JSON.stringify({
      now: input.now,
      days: input.days,
      reminders: input.reminders,
      statuses: input.statuses,
      exemptDays: [...input.exemptDays],
      ishaNudgeTimes: input.ishaNudgeTimes,
    });
    expect(after).toBe(before);
  });

  it('returns fresh Date instances rather than aliases of the input times', () => {
    const days = makeDays(1);
    const plan = planNotifications(
      makeInput({ days, reminders: everyPrayer({ adhanEnabled: true }) })
    );
    const fajrAdhan = find(plan, `adhan:${D1}:fajr`);
    expect(fajrAdhan?.fireAt).toEqual(days[0].times.fajr);
    expect(fajrAdhan?.fireAt).not.toBe(days[0].times.fajr);
  });
});

// ---------------------------------------------------------------------------
// diffPlans
// ---------------------------------------------------------------------------

describe('diffPlans', () => {
  const desired = planNotifications(
    makeInput({ days: makeDays(1), reminders: everyPrayer({ adhanEnabled: true }) })
  );
  const desiredKeys = keysOf(desired);

  it('schedules everything when the OS holds nothing', () => {
    const { toSchedule, toCancel } = diffPlans(desired, []);
    expect(keysOf(toSchedule)).toEqual(desiredKeys);
    expect(toCancel).toEqual([]);
  });

  it('cancels everything when nothing is desired', () => {
    const { toSchedule, toCancel } = diffPlans([], desiredKeys);
    expect(toSchedule).toEqual([]);
    expect(toCancel).toEqual(desiredKeys);
  });

  it('does nothing when the two sides already agree', () => {
    expect(diffPlans(desired, desiredKeys)).toEqual({ toSchedule: [], toCancel: [] });
  });

  it('computes both directions at once', () => {
    // The OS holds two of the wanted five, plus two stale ones.
    const scheduled = [
      `adhan:${D1}:fajr`,
      `adhan:${D1}:asr`,
      `nudge:${D1}:isha`,
      `adhan:2026-08-18:maghrib`,
    ];
    const { toSchedule, toCancel } = diffPlans(desired, scheduled);

    expect(keysOf(toSchedule)).toEqual([
      `adhan:${D1}:dhuhr`,
      `adhan:${D1}:maghrib`,
      `adhan:${D1}:isha`,
    ]);
    expect(toCancel).toEqual([`nudge:${D1}:isha`, `adhan:2026-08-18:maghrib`]);
  });

  it('cancels the nudge of a prayer that has just been logged, and nothing else', () => {
    const reminders = everyPrayer({ adhanEnabled: true, nudgeEnabled: true });
    const before = planNotifications(makeInput({ days: makeDays(1), reminders }));
    const after = planNotifications(
      makeInput({ days: makeDays(1), reminders, statuses: { [D1]: { dhuhr: 'prayed' } } })
    );

    const { toSchedule, toCancel } = diffPlans(after, keysOf(before));
    expect(toSchedule).toEqual([]);
    expect(toCancel).toEqual([`nudge:${D1}:dhuhr`]);
  });

  it('preserves the order of both inputs', () => {
    const scheduled = ['z:stale:one', 'a:stale:two'];
    const { toSchedule, toCancel } = diffPlans(desired, scheduled);
    expect(keysOf(toSchedule)).toEqual(desiredKeys);
    expect(toCancel).toEqual(scheduled);
  });

  it('collapses duplicate keys on both sides', () => {
    const duplicated = [...desired, desired[0], desired[1]];
    const { toSchedule } = diffPlans(duplicated, []);
    expect(keysOf(toSchedule)).toEqual(desiredKeys);

    const { toCancel } = diffPlans([], ['stale:a:fajr', 'stale:a:fajr', 'stale:b:isha']);
    expect(toCancel).toEqual(['stale:a:fajr', 'stale:b:isha']);
  });

  it('returns the same PlannedNotification objects it was given', () => {
    const { toSchedule } = diffPlans(desired, []);
    expect(toSchedule[0]).toBe(desired[0]);
  });

  it('does not mutate its inputs', () => {
    const scheduled = [`adhan:${D1}:fajr`, 'stale:key:isha'];
    const scheduledCopy = [...scheduled];
    const desiredCopy = [...desired];
    diffPlans(desired, scheduled);
    expect(scheduled).toEqual(scheduledCopy);
    expect(desired).toEqual(desiredCopy);
  });

  it('handles two empty sides', () => {
    expect(diffPlans([], [])).toEqual({ toSchedule: [], toCancel: [] });
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting sanity: the shape every consumer relies on
// ---------------------------------------------------------------------------

describe('PlannedNotification shape', () => {
  it('always carries a consistent kind/day/prayer/sound tuple', () => {
    const plan = planNotifications(
      makeInput({ ...EVERYTHING_ON, statuses: { [D2]: { isha: 'late' } }, maxCount: 1000 })
    );
    const dayList: PrayerDay[] = [D1, D2, D3, D4, D5];
    for (const notification of plan) {
      expect(['adhan', 'preReminder', 'nudge', 'expiry']).toContain(notification.kind);
      expect(PRAYERS).toContain(notification.prayer as Prayer);
      expect(dayList).toContain(notification.day);
      expect(['silent', 'system', 'adhan']).toContain(notification.sound);
      expect(notification.fireAt.getTime()).not.toBeNaN();
      if (notification.kind !== 'adhan') {
        expect(notification.sound).not.toBe('adhan');
      }
    }
    expect(find(plan, `nudge:${D2}:isha`)).toBeUndefined();
    expect(plan).toHaveLength(79);
  });
});

// ---------------------------------------------------------------------------
// expiresAt — the same judgement the tray sweep makes, carried in the request
// ---------------------------------------------------------------------------

describe('planNotifications — expiresAt', () => {
  const plan = planNotifications(makeInput({ ...EVERYTHING_ON, maxCount: 1000 }));
  const expiryOf = (key: string) => find(plan, key)?.expiresAt?.toISOString();

  // The synthetic day: fajr 05:00 · sunrise 06:30 · dhuhr 13:00 · asr 16:45 · maghrib 20:15 ·
  // isha 21:45, so a window end is either sunrise (Fajr) or the next prayer's start.
  const iso = (day: PrayerDay, hours: number, minutes: number) =>
    at(day, hours, minutes).toISOString();

  it('expires every phase of a prayer at its window end', () => {
    expect(expiryOf(`adhan:${D1}:dhuhr`)).toBe(iso(D1, 16, 45));
    expect(expiryOf(`preReminder:${D1}:dhuhr`)).toBe(iso(D1, 16, 45));
    expect(expiryOf(`nudge:${D1}:dhuhr`)).toBe(iso(D1, 16, 45));
  });

  it('expires Fajr’s phases at sunrise, not at Dhuhr (D71)', () => {
    expect(expiryOf(`adhan:${D1}:fajr`)).toBe(iso(D1, 6, 30));
    expect(expiryOf(`nudge:${D1}:fajr`)).toBe(iso(D1, 6, 30));
  });

  it('expires Isha’s phases at the next day’s Fajr', () => {
    expect(expiryOf(`adhan:${D1}:isha`)).toBe(iso(D2, 5, 0));
  });

  // The sunrise note is the one that outlives its own window: it exists to be read after the
  // fact, so what retires it is Dhuhr's arrival — exactly the rule `selectStaleDelivered` uses.
  it('lets the sunrise note live until the next prayer arrives', () => {
    expect(expiryOf(`expiry:${D1}:fajr`)).toBe(iso(D1, 13, 0));
  });

  it('omits it rather than guessing when the end cannot be resolved', () => {
    // Isha on the final day of the horizon: its window ends on a day we hold no times for.
    const short = planNotifications(
      makeInput({ days: makeDays(1), ...EVERYTHING_ON, maxCount: 1000 })
    );
    expect(find(short, `adhan:${D1}:isha`)?.expiresAt).toBeUndefined();
    expect(find(short, `adhan:${D1}:isha`)).toBeDefined();
  });

  it('never expires a notification before it fires', () => {
    for (const notification of plan) {
      if (notification.expiresAt === undefined) continue;
      expect(notification.expiresAt.getTime()).toBeGreaterThan(notification.fireAt.getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// The expiry notification — the one that reports a closed window
// ---------------------------------------------------------------------------

describe('planNotifications — expiry', () => {
  const withNudges = everyPrayer({ adhanEnabled: true, nudgeEnabled: true });
  /** The setting that turns the sunrise note on. It ships off (D90), so every test says so. */
  const noteOn = { sunriseNoteEnabled: true } as const;

  it('fires at sunrise, which is where Fajr’s window actually ends (D71)', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: withNudges, ...noteOn })
    );
    const expiry = find(plan, `expiry:${D1}:fajr`);
    expect(expiry?.fireAt).toEqual(at(D1, 6, 30));
    // The last call sits `DEFAULT_NUDGE_LEAD_MINUTES` earlier; the expiry is pinned to the end.
    expect(find(plan, `nudge:${D1}:fajr`)?.fireAt).toEqual(at(D1, 6, 10));
  });

  it('exists for Fajr and for no other prayer', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: withNudges, ...noteOn, maxCount: 1000 })
    );
    const expiries = plan.filter((n) => n.kind === 'expiry');
    expect(expiries.map((n) => n.prayer)).toEqual(['fajr']);
  });

  it('is always silent, whatever sound the prayer is set to', () => {
    for (const sound of ['silent', 'system', 'adhan'] as const) {
      const reminders = everyPrayer({ adhanEnabled: true, nudgeEnabled: true, sound });
      const plan = planNotifications(makeInput({ days: makeDays(1), reminders, ...noteOn }));
      expect(find(plan, `expiry:${D1}:fajr`)?.sound).toBe('silent');
    }
  });

  it('is absent unless it has been asked for, whatever else is turned on (D90)', () => {
    // The shipped default: every last call on, and still no note. It is the one reminder that
    // arrives after the fact, so it is the one that has to be opted into.
    const plan = planNotifications(makeInput({ days: makeDays(1), reminders: withNudges }));
    expect(find(plan, `expiry:${D1}:fajr`)).toBeUndefined();
    expect(find(plan, `nudge:${D1}:fajr`)).toBeDefined();
    expect(find(plan, `adhan:${D1}:fajr`)).toBeDefined();

    const off = planNotifications(
      makeInput({ days: makeDays(1), reminders: withNudges, sunriseNoteEnabled: false })
    );
    expect(off.some((n) => n.kind === 'expiry')).toBe(false);
  });

  it('no longer rides Fajr’s last call — the two are independent settings (D90)', () => {
    // Someone who turned every last call off, because they do not want to be chased while the
    // time is still open, may still want to be told afterwards that it closed.
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: everyPrayer({ adhanEnabled: true }), ...noteOn })
    );
    expect(find(plan, `expiry:${D1}:fajr`)?.fireAt).toEqual(at(D1, 6, 30));
    expect(find(plan, `nudge:${D1}:fajr`)).toBeUndefined();
    expect(find(plan, `adhan:${D1}:fajr`)).toBeDefined();
  });

  it('is dropped the moment Fajr is logged, in any way', () => {
    for (const status of ['prayed', 'late', 'missed', 'exempt'] as const) {
      const statuses: PrayerStatusMap = { [D1]: { fajr: status } };
      const plan = planNotifications(
        makeInput({ days: makeDays(1), reminders: withNudges, ...noteOn, statuses })
      );
      expect(find(plan, `expiry:${D1}:fajr`)).toBeUndefined();
      expect(find(plan, `nudge:${D1}:fajr`)).toBeUndefined();
      // …and the adhan, which is about the time arriving, is untouched.
      expect(find(plan, `adhan:${D1}:fajr`)).toBeDefined();
    }
  });

  it('is still suppressed by a marked Fajr when the last call is off too', () => {
    // The unlogged condition belongs to the note itself, not to the switch it used to share.
    const plan = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders: everyPrayer({ adhanEnabled: true }),
        ...noteOn,
        statuses: { [D1]: { fajr: 'prayed' } },
      })
    );
    expect(find(plan, `expiry:${D1}:fajr`)).toBeUndefined();
  });

  it('stands even when the lead is longer than dawn-to-sunrise and the last call is dropped', () => {
    // 90 minutes of lead against a 90-minute stretch puts the nudge exactly on Fajr, outside its
    // own open window — but the sun still rises, and the note about it is still right.
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: withNudges, ...noteOn, nudgeLeadMinutes: 90 })
    );
    expect(find(plan, `nudge:${D1}:fajr`)).toBeUndefined();
    expect(find(plan, `expiry:${D1}:fajr`)?.fireAt).toEqual(at(D1, 6, 30));
  });

  it('is silent on an exempt day, like everything else', () => {
    const plan = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders: withNudges,
        ...noteOn,
        exemptDays: new Set<PrayerDay>([D1]),
      })
    );
    expect(plan).toEqual([]);
  });

  it('is not planned once sunrise has passed', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: withNudges, ...noteOn, now: at(D1, 8, 0) })
    );
    expect(find(plan, `expiry:${D1}:fajr`)).toBeUndefined();
    expect(find(plan, `expiry:${D1}:dhuhr`)).toBeUndefined();
  });

  it('contributes nothing when sunrise is unresolvable', () => {
    const [day] = makeDays(1);
    const polar: DayTimes = {
      ...day,
      times: { ...day.times, sunrise: new Date(Number.NaN) },
    };
    const plan = planNotifications(
      makeInput({ days: [polar], reminders: withNudges, ...noteOn })
    );
    expect(plan.some((n) => n.kind === 'expiry')).toBe(false);
    expect(find(plan, `adhan:${D1}:fajr`)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The user's last-call lead
// ---------------------------------------------------------------------------

describe('planNotifications — nudgeLeadMinutes', () => {
  const withNudges = everyPrayer({ nudgeEnabled: true });

  it('moves every non-Isha last call, and leaves Isha on Islamic midnight', () => {
    const plan = planNotifications(
      makeInput({ days: makeDays(1), reminders: withNudges, nudgeLeadMinutes: 10 })
    );
    expect(find(plan, `nudge:${D1}:fajr`)?.fireAt).toEqual(at(D1, 6, 20));
    expect(find(plan, `nudge:${D1}:dhuhr`)?.fireAt).toEqual(at(D1, 16, 35));
    expect(find(plan, `nudge:${D1}:asr`)?.fireAt).toEqual(at(D1, 20, 5));
    expect(find(plan, `nudge:${D1}:maghrib`)?.fireAt).toEqual(at(D1, 21, 35));
    expect(find(plan, `nudge:${D1}:isha`)?.fireAt).toEqual(at(D1, 24, 30));
  });

  it('leaves the expiry where it is — that one is the window end, not a lead', () => {
    const early = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders: everyPrayer({ nudgeEnabled: true }),
        sunriseNoteEnabled: true,
        nudgeLeadMinutes: 5,
      })
    );
    const late = planNotifications(
      makeInput({
        days: makeDays(1),
        reminders: everyPrayer({ nudgeEnabled: true }),
        sunriseNoteEnabled: true,
        nudgeLeadMinutes: 45,
      })
    );
    expect(find(early, `expiry:${D1}:fajr`)?.fireAt).toEqual(at(D1, 6, 30));
    expect(find(late, `expiry:${D1}:fajr`)?.fireAt).toEqual(at(D1, 6, 30));
  });

  it('states bounds a UI can trust', () => {
    expect(MIN_NUDGE_LEAD_MINUTES).toBeGreaterThan(0);
    expect(MIN_NUDGE_LEAD_MINUTES).toBeLessThan(DEFAULT_NUDGE_LEAD_MINUTES);
    expect(MAX_NUDGE_LEAD_MINUTES).toBeGreaterThan(DEFAULT_NUDGE_LEAD_MINUTES);
  });
});

describe('planNotifications — adhanExpiresAfterMinutes', () => {
  const everythingOn = { ...EVERYTHING_ON, days: makeDays(1) } as const;

  it('pulls the adhan expiry in to start + linger, and touches nothing else', () => {
    const plan = planNotifications(makeInput({ ...everythingOn, adhanExpiresAfterMinutes: 30 }));
    // Dhuhr 13:00, window end 16:45 → the linger wins.
    expect(find(plan, `adhan:${D1}:dhuhr`)?.expiresAt).toEqual(at(D1, 13, 30));
    // Every other kind keeps the window end (or, for the sunrise note, its own retirement).
    expect(find(plan, `preReminder:${D1}:dhuhr`)?.expiresAt).toEqual(at(D1, 16, 45));
    expect(find(plan, `nudge:${D1}:dhuhr`)?.expiresAt).toEqual(at(D1, 16, 45));
    expect(find(plan, `expiry:${D1}:fajr`)?.expiresAt).toEqual(at(D1, 13, 0));
  });

  it('never pushes an expiry past the window end — the shorter of the two wins', () => {
    // Fajr's window is 05:00→06:30 (90 minutes); a 120-minute linger must not outlive it.
    const plan = planNotifications(makeInput({ ...everythingOn, adhanExpiresAfterMinutes: 120 }));
    expect(find(plan, `adhan:${D1}:fajr`)?.expiresAt).toEqual(at(D1, 6, 30));
  });

  it('gives an adhan with no known window end the linger alone', () => {
    // Isha on the final planned day has no next-day Fajr, so no window end — and no expiry at
    // all without the knob.
    const bare = planNotifications(makeInput(everythingOn));
    expect(find(bare, `adhan:${D1}:isha`)?.expiresAt).toBeUndefined();
    const plan = planNotifications(makeInput({ ...everythingOn, adhanExpiresAfterMinutes: 30 }));
    expect(find(plan, `adhan:${D1}:isha`)?.expiresAt).toEqual(at(D1, 22, 15));
  });

  it('changes nothing when omitted', () => {
    const plan = planNotifications(makeInput(everythingOn));
    expect(find(plan, `adhan:${D1}:dhuhr`)?.expiresAt).toEqual(at(D1, 16, 45));
  });

  it('rejects a negative or non-finite linger', () => {
    expect(() => planNotifications(makeInput({ adhanExpiresAfterMinutes: -1 }))).toThrow(
      RangeError
    );
    expect(() =>
      planNotifications(makeInput({ adhanExpiresAfterMinutes: Number.POSITIVE_INFINITY }))
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Clearing the tray
// ---------------------------------------------------------------------------

describe('selectStaleDelivered', () => {
  const days = makeDays(2);

  function delivered(
    kind: 'adhan' | 'preReminder' | 'nudge' | 'expiry',
    prayer: Prayer,
    fireAt: Date,
    day: PrayerDay = D1
  ): DeliveredNotification {
    return { key: notificationKey(kind, day, prayer), kind, prayer, day, fireAt };
  }

  const base = {
    days,
    statuses: {} as PrayerStatusMap,
    exemptDays: new Set<PrayerDay>(),
  };

  it('keeps a notification whose window is still open', () => {
    const tray = [delivered('adhan', 'dhuhr', at(D1, 13, 0))];
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 14, 0) })).toEqual([]);
  });

  it('clears one whose window has closed', () => {
    const tray = [delivered('adhan', 'fajr', at(D1, 5, 0))];
    // Fajr's window ends at sunrise (06:30), so at eight it is long past.
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 8, 0) })).toEqual([
      `adhan:${D1}:fajr`,
    ]);
  });

  it('keeps the newest phase of a prayer and clears the ones it superseded', () => {
    const tray = [
      delivered('preReminder', 'dhuhr', at(D1, 12, 45)),
      delivered('adhan', 'dhuhr', at(D1, 13, 0)),
      delivered('nudge', 'dhuhr', at(D1, 16, 25)),
    ];
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 16, 30) })).toEqual([
      `preReminder:${D1}:dhuhr`,
      `adhan:${D1}:dhuhr`,
    ]);
  });

  it('clears everything for a prayer the moment it is logged', () => {
    const tray = [
      delivered('adhan', 'dhuhr', at(D1, 13, 0)),
      delivered('nudge', 'dhuhr', at(D1, 16, 25)),
    ];
    const statuses: PrayerStatusMap = { [D1]: { dhuhr: 'prayed' } };
    expect(selectStaleDelivered(tray, { ...base, statuses, now: at(D1, 16, 30) })).toEqual([
      `adhan:${D1}:dhuhr`,
      `nudge:${D1}:dhuhr`,
    ]);
  });

  it('clears everything on a day that has become exempt', () => {
    const tray = [delivered('adhan', 'dhuhr', at(D1, 13, 0))];
    const exemptDays = new Set<PrayerDay>([D1]);
    expect(selectStaleDelivered(tray, { ...base, exemptDays, now: at(D1, 13, 5) })).toEqual([
      `adhan:${D1}:dhuhr`,
    ]);
  });

  it('lets the sunrise note outlive its own window, and retires it at Dhuhr', () => {
    const tray = [delivered('expiry', 'fajr', at(D1, 6, 30))];
    // Nine in the morning: Fajr's window shut hours ago, and this is exactly the person the
    // notification exists for.
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 9, 0) })).toEqual([]);
    // One o'clock: Dhuhr has come in and says everything the note was for.
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 13, 0) })).toEqual([
      `expiry:${D1}:fajr`,
    ]);
  });

  it('clears an Isha notification once the next day’s Fajr has come in', () => {
    const tray = [delivered('adhan', 'isha', at(D1, 21, 45))];
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 23, 0) })).toEqual([]);
    expect(selectStaleDelivered(tray, { ...base, now: at(D2, 5, 30) })).toEqual([
      `adhan:${D1}:isha`,
    ]);
  });

  it('clears everything left over from a day the horizon has already passed', () => {
    // The whole clutter complaint: the horizon starts at *today*, so before this every
    // notification that fired while the app was shut sat in the tray for good.
    const tray = [
      delivered('adhan', 'fajr', at('2026-08-17', 5, 0), '2026-08-17'),
      delivered('nudge', 'isha', at('2026-08-18', 24, 30), '2026-08-18'),
    ];
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 12, 0) })).toEqual([
      'adhan:2026-08-17:fajr',
      'nudge:2026-08-18:isha',
    ]);
  });

  it('leaves alone a day beyond the far end of the horizon', () => {
    // Nothing should ever have fired there, and a day we hold no times for is one we cannot
    // judge — the conservative half of the rule survives.
    const tray = [delivered('adhan', 'fajr', at('2026-09-01', 5, 0), '2026-09-01')];
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 12, 0) })).toEqual([]);
  });

  it('leaves a past day alone when there is no horizon to compare it against', () => {
    const tray = [delivered('adhan', 'fajr', at('2026-08-01', 5, 0), '2026-08-01')];
    expect(selectStaleDelivered(tray, { ...base, days: [], now: at(D1, 12, 0) })).toEqual([]);
  });

  it('ignores a malformed day rather than throwing', () => {
    const tray = [{ ...delivered('adhan', 'fajr', at(D1, 5, 0)), day: 'not-a-day' }];
    expect(selectStaleDelivered(tray, { ...base, now: at(D1, 12, 0) })).toEqual([]);
  });

  it('never repeats an identifier, and degrades rather than throwing', () => {
    const one = delivered('adhan', 'fajr', at(D1, 5, 0));
    expect(selectStaleDelivered([one, one], { ...base, now: at(D1, 8, 0) })).toEqual([one.key]);
    expect(selectStaleDelivered([], { ...base, now: at(D1, 8, 0) })).toEqual([]);
    expect(selectStaleDelivered([one], { ...base, now: new Date(Number.NaN) })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DST — the plan must be pure instant arithmetic. Real computed days for New
// York across the 2026-03-08 spring-forward (computeDayTimes' instants are
// timezone-independent, so this runs identically on any machine): an
// implementation that reconstructed any fire time from wall-clock fields
// would land exactly an hour wrong on the transition day.
// ---------------------------------------------------------------------------

describe('DST — fire times stay instant-true across the New York spring-forward', () => {
  const NEW_YORK = { latitude: 40.7128, longitude: -74.006, countryCode: 'US' };
  const CALCULATION = {
    method: 'auto',
    madhab: 'shafi',
    highLatitudeRule: 'auto',
    offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    hijriOffset: 0,
  } as const;
  const DAYS: PrayerDay[] = ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'];
  const PRE_MINUTES = 30;

  const computed = DAYS.map((day) => computeDayTimes(day, NEW_YORK, CALCULATION));
  const nudges = Object.fromEntries(
    DAYS.map((day) => [day, getIshaNudgeTime(day, NEW_YORK, CALCULATION)])
  );
  const plan = planNotifications({
    now: new Date(computed[0].times.fajr.getTime() - 60 * 60_000),
    days: computed,
    reminders: everyPrayer({
      adhanEnabled: true,
      preReminderEnabled: true,
      preReminderMinutes: PRE_MINUTES,
      nudgeEnabled: true,
    }),
    statuses: {},
    exemptDays: new Set<PrayerDay>(),
    ishaNudgeTimes: nudges,
    maxCount: 500,
  });

  it('fires every adhan exactly at its computed instant, transition day included', () => {
    for (const dayTimes of computed) {
      for (const prayer of PRAYERS) {
        const planned = find(plan, notificationKey('adhan', dayTimes.day, prayer));
        expect(planned?.fireAt.getTime()).toBe(dayTimes.times[prayer].getTime());
      }
    }
  });

  it('keeps every pre-reminder exactly 30 real minutes early, across the skipped hour', () => {
    for (const dayTimes of computed) {
      for (const prayer of PRAYERS) {
        const planned = find(plan, notificationKey('preReminder', dayTimes.day, prayer));
        expect(planned?.fireAt.getTime()).toBe(
          dayTimes.times[prayer].getTime() - PRE_MINUTES * 60_000
        );
      }
    }
  });

  it('nudges Isha at Islamic midnight of the transition night itself', () => {
    // The 2026-03-07 night contains the 02:00→03:00 jump; the nudge instant must be the
    // computed one, not a wall-clock reconstruction of it.
    const planned = find(plan, notificationKey('nudge', '2026-03-07', 'isha'));
    expect(planned?.fireAt.getTime()).toBe(nudges['2026-03-07'].getTime());
  });
});
