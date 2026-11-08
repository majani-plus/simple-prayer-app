/**
 * The Android ongoing notification's brain: what it is about, what it says, and when it has to
 * be redrawn.
 *
 * The property worth guarding is the trade the module makes (PRODUCT_SPEC §11, D27): the
 * notification must show a *time remaining* without ticking, because a per-second redraw of a
 * persistent notification is a battery complaint and a stale one is a lie. It buys that with a
 * clock time in the title (never stale) and a handful of redraw checkpoints. So these tests care
 * about:
 *
 * 1. Picking the right prayer, including across the day boundary — after Isha the subject is
 *    tomorrow's Fajr, not "nothing".
 * 2. **Following the log, not just the clock** (D83): while a prayer's time is in and nothing is
 *    logged for it, the notification is about *that* prayer; the moment it is marked it advances
 *    to the next one. That is the owner's "when it's Dhuhr, say it's Dhuhr — and after I mark it,
 *    show the next one".
 * 3. The redraw schedule being sparse, monotonic, and never re-firing a checkpoint already past.
 * 4. The copy degrading rather than breaking when the duration cannot be phrased.
 */

import {
  ONGOING_LEAD_CHECKPOINTS_MS,
  ONGOING_REFRESH_GRACE_MS,
  buildOngoingContent,
  nextOngoingRefreshAt,
  selectOngoingState,
} from './ongoingNotification';

import type { PrayerStatusMap } from '../domain/notificationPlan';
import type { DayTimes, PrayerDay, TimeMarker } from '../domain/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOURS: Record<TimeMarker, number> = {
  fajr: 5,
  sunrise: 6,
  dhuhr: 13,
  asr: 16,
  maghrib: 19,
  isha: 21,
  middleOfTheNight: 23,
  lastThirdOfTheNight: 1,
};

function dayTimes(day: PrayerDay): DayTimes {
  const times = {} as Record<TimeMarker, Date>;
  for (const [marker, hour] of Object.entries(HOURS) as [TimeMarker, number][]) {
    times[marker] = new Date(`${day}T00:00:00.000Z`);
    times[marker].setUTCMinutes(hour * 60);
  }
  return { day, times, method: 'muslimWorldLeague' };
}

const DAYS: PrayerDay[] = ['2026-08-19', '2026-08-20', '2026-08-21'];
const PLAN = DAYS.map(dayTimes);

const at = (iso: string): Date => new Date(iso);

/** A translate that echoes key + params, so assertions name keys rather than English copy. */
const echo = (key: string, params?: Record<string, unknown>): string =>
  params === undefined ? key : `${key}(${JSON.stringify(params)})`;

const deps = {
  translate: echo,
  formatClock: (date: Date) => date.toISOString().slice(11, 16),
  formatRemaining: (ms: number) => `${Math.round(ms / 60000)}min`,
};

// ---------------------------------------------------------------------------

describe('choosing the prayer', () => {
  it('names the prayer whose time is in while nothing is logged for it', () => {
    // 14:00 sits inside Dhuhr's window, which began at 13:00 — so the notification says Dhuhr,
    // not Asr. This is the owner's first ask, and the reason the state takes statuses at all.
    const state = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'));

    expect(state?.phase).toBe('due');
    expect(state?.prayer).toBe('dhuhr');
    expect(state?.at.toISOString()).toBe('2026-08-19T13:00:00.000Z');
    // Due-ness ends when Dhuhr's window does, which for Dhuhr is Asr's start.
    expect(state?.until.toISOString()).toBe('2026-08-19T16:00:00.000Z');
    expect(state?.next?.prayer).toBe('asr');
    expect(state?.next?.at.toISOString()).toBe('2026-08-19T16:00:00.000Z');
  });

  it('advances to the next prayer the moment the current one is logged', () => {
    const statuses: PrayerStatusMap = { '2026-08-19': { dhuhr: 'prayed' } };

    const state = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'), { statuses });

    expect(state?.phase).toBe('upcoming');
    expect(state?.prayer).toBe('asr');
    expect(state?.at.toISOString()).toBe('2026-08-19T16:00:00.000Z');
  });

  it('advances on any log, not only on "prayed"', () => {
    for (const status of ['late', 'missed', 'exempt'] as const) {
      const state = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'), {
        statuses: { '2026-08-19': { dhuhr: status } },
      });
      expect(state?.prayer).toBe('asr');
    }
    // An explicit 'unlogged' is nothing logged at all, so Dhuhr still stands.
    const unlogged = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'), {
      statuses: { '2026-08-19': { dhuhr: 'unlogged' } },
    });
    expect(unlogged?.prayer).toBe('dhuhr');
  });

  it('stops naming a prayer once its window shuts, logged or not', () => {
    // Fajr's window ends at sunrise (06:00). At eight the app does not know whether the user
    // prayed, so it says nothing about Fajr at all — it simply looks forward.
    const state = selectOngoingState(PLAN, at('2026-08-19T08:00:00.000Z'));

    expect(state?.phase).toBe('upcoming');
    expect(state?.prayer).toBe('dhuhr');
  });

  it('holds Fajr only until sunrise, and points past it at Dhuhr', () => {
    const state = selectOngoingState(PLAN, at('2026-08-19T05:30:00.000Z'));

    expect(state?.phase).toBe('due');
    expect(state?.prayer).toBe('fajr');
    // Fajr is the one prayer whose window end is not the next prayer's start (D71).
    expect(state?.until.toISOString()).toBe('2026-08-19T06:00:00.000Z');
    expect(state?.next?.prayer).toBe('dhuhr');
  });

  it('keeps Isha standing through the night, and crosses the day boundary once it is logged', () => {
    const due = selectOngoingState(PLAN, at('2026-08-19T22:30:00.000Z'));
    expect(due?.phase).toBe('due');
    expect(due?.prayer).toBe('isha');
    // Isha's window runs to the next day's Fajr (D71), which is also what comes next.
    expect(due?.until.toISOString()).toBe('2026-08-20T05:00:00.000Z');

    const logged = selectOngoingState(PLAN, at('2026-08-19T22:30:00.000Z'), {
      statuses: { '2026-08-19': { isha: 'prayed' } },
    });
    expect(logged?.phase).toBe('upcoming');
    expect(logged?.prayer).toBe('fajr');
    expect(logged?.day).toBe('2026-08-20');
    expect(logged?.at.toISOString()).toBe('2026-08-20T05:00:00.000Z');
  });

  it('never says a prayer is due on an exempt day', () => {
    const state = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'), {
      exemptDays: new Set(['2026-08-19']),
    });

    expect(state?.phase).toBe('upcoming');
    expect(state?.prayer).toBe('asr');
  });

  it('looks forward before the first prayer of the window', () => {
    const state = selectOngoingState(PLAN, at('2026-08-19T02:00:00.000Z'));

    expect(state?.phase).toBe('upcoming');
    expect(state?.prayer).toBe('fajr');
    expect(state?.until).toEqual(state?.at);
  });

  it('treats a prayer exactly at now as begun, not as next', () => {
    const state = selectOngoingState(PLAN, at('2026-08-19T16:00:00.000Z'));

    expect(state?.phase).toBe('due');
    expect(state?.prayer).toBe('asr');
    expect(state?.next?.prayer).toBe('maghrib');
  });

  it('answers null when the planned window holds nothing ahead', () => {
    expect(selectOngoingState(PLAN, at('2026-09-01T00:00:00.000Z'))).toBeNull();
    expect(selectOngoingState([], at('2026-08-19T00:00:00.000Z'))).toBeNull();
  });

  it('ignores unusable times rather than throwing', () => {
    const broken: DayTimes = {
      day: '2026-08-19',
      // A polar day can leave a marker unresolvable; the notification must still work.
      times: { ...dayTimes('2026-08-19').times, asr: new Date(Number.NaN) },
      method: 'muslimWorldLeague',
    };

    // Dhuhr's window end is Asr, which cannot be resolved here — so Dhuhr cannot be declared due
    // and the notification falls back to the forward-looking form rather than guessing.
    const state = selectOngoingState([broken], at('2026-08-19T14:00:00.000Z'));

    expect(state?.phase).toBe('upcoming');
    expect(state?.prayer).toBe('maghrib');
  });
});

describe('the redraw schedule', () => {
  // Dhuhr logged, so the notification is counting down to Asr — the phase that carries a
  // remainder, and therefore the only one with checkpoints.
  const state = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'), {
    statuses: { '2026-08-19': { dhuhr: 'prayed' } },
  });

  it('aims at the furthest checkpoint still ahead', () => {
    // Asr is at 16:00; from 14:00 the first checkpoint still ahead is the one-hour mark.
    expect(nextOngoingRefreshAt(state!, at('2026-08-19T14:00:00.000Z'))?.toISOString()).toBe(
      '2026-08-19T15:00:00.000Z'
    );
  });

  it('skips checkpoints already behind instead of firing a burst', () => {
    // 15:40 is past the 60- and 30-minute marks; the next is the quarter-hour one at 15:45.
    expect(nextOngoingRefreshAt(state!, at('2026-08-19T15:40:00.000Z'))?.toISOString()).toBe(
      '2026-08-19T15:45:00.000Z'
    );
  });

  it('lands just past the prayer once every checkpoint is spent', () => {
    const target = nextOngoingRefreshAt(state!, at('2026-08-19T15:58:00.000Z'));

    expect(target?.getTime()).toBe(state!.at.getTime() + ONGOING_REFRESH_GRACE_MS);
    // The grace matters: a redraw armed for the exact instant would re-select the same prayer.
    expect(target!.getTime()).toBeGreaterThan(state!.at.getTime());
  });

  it('walks each checkpoint exactly once, in order', () => {
    let cursor = at('2026-08-19T13:00:00.000Z');
    const stops: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = nextOngoingRefreshAt(state!, cursor);
      if (next === null) break;
      stops.push(next.toISOString());
      cursor = next;
      if (next.getTime() > state!.at.getTime()) break;
    }

    expect(stops).toEqual([
      '2026-08-19T15:00:00.000Z',
      '2026-08-19T15:30:00.000Z',
      '2026-08-19T15:45:00.000Z',
      '2026-08-19T15:55:00.000Z',
      '2026-08-19T16:00:01.000Z',
    ]);
    // One redraw per checkpoint plus the transition: this is the whole battery argument.
    expect(stops).toHaveLength(ONGOING_LEAD_CHECKPOINTS_MS.length + 1);
  });

  it('answers null once the transition itself is behind', () => {
    expect(nextOngoingRefreshAt(state!, at('2026-08-19T17:00:00.000Z'))).toBeNull();
  });

  it('wakes once, at the window end, while a prayer is due', () => {
    // The due phase names no duration, so there is nothing to keep fresh between now and the
    // moment it stops being true. One redraw per prayer instead of five.
    const due = selectOngoingState(PLAN, at('2026-08-19T13:05:00.000Z'))!;
    expect(due.phase).toBe('due');

    const stops: string[] = [];
    let cursor = at('2026-08-19T13:05:00.000Z');
    for (let i = 0; i < 5; i += 1) {
      const next = nextOngoingRefreshAt(due, cursor);
      if (next === null) break;
      stops.push(next.toISOString());
      cursor = next;
    }

    expect(stops).toEqual(['2026-08-19T16:00:01.000Z']);
  });
});

describe('the copy while a prayer is due', () => {
  const state = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'))!;

  it('says which prayer it is, and when it came in', () => {
    const content = buildOngoingContent(state, at('2026-08-19T14:00:00.000Z'), deps);

    expect(content.title).toContain('notifications.ongoing.titleNow');
    expect(content.title).toContain('prayers.dhuhr');
    expect(content.title).toContain('13:00');
  });

  it('carries the next prayer in the body, so the times audience still has what it came for', () => {
    const content = buildOngoingContent(state, at('2026-08-19T14:00:00.000Z'), deps);

    expect(content.body).toContain('notifications.ongoing.bodyNext');
    expect(content.body).toContain('prayers.asr');
    expect(content.body).toContain('16:00');
    // No countdown here: for every prayer but Fajr the next one's start IS the deadline, and a
    // fact with no duration in it never goes stale between redraws.
    expect(content.body).not.toContain('remaining');
  });

  it('names Friday’s midday prayer Jumu’ah', () => {
    const friday = selectOngoingState(PLAN, at('2026-08-21T14:00:00.000Z'))!;
    const content = buildOngoingContent(friday, at('2026-08-21T14:00:00.000Z'), deps);

    expect(content.title).toContain('prayers.jumuah');
  });

  it('falls back to the plain body when nothing follows in the planned window', () => {
    // A polar day where only dawn and sunrise resolved: Fajr is genuinely due, and there is
    // nothing after it to point at. The body must degrade, never print "Next:  · ".
    const unresolved = new Date(Number.NaN);
    const sparse: DayTimes = {
      day: '2026-08-19',
      times: {
        ...dayTimes('2026-08-19').times,
        dhuhr: unresolved,
        asr: unresolved,
        maghrib: unresolved,
        isha: unresolved,
      },
      method: 'muslimWorldLeague',
    };
    const state = selectOngoingState([sparse], at('2026-08-19T05:30:00.000Z'))!;

    expect(state.phase).toBe('due');
    expect(state.next).toBeNull();
    expect(buildOngoingContent(state, at('2026-08-19T05:30:00.000Z'), deps).body).toBe(
      'notifications.ongoing.body'
    );
  });
});

describe('the copy while a prayer is upcoming', () => {
  const state = selectOngoingState(PLAN, at('2026-08-19T14:00:00.000Z'), {
    statuses: { '2026-08-19': { dhuhr: 'prayed' } },
  })!;

  it('puts the prayer and its clock time in the title', () => {
    const content = buildOngoingContent(state, at('2026-08-19T14:00:00.000Z'), deps);

    expect(content.title).toContain('notifications.ongoing.title');
    expect(content.title).toContain('prayers.asr');
    // The clock time is the half of the message that never goes stale between redraws.
    expect(content.title).toContain('16:00');
  });

  it('states the remainder as an approximation', () => {
    const content = buildOngoingContent(state, at('2026-08-19T14:00:00.000Z'), deps);

    expect(content.body).toContain('notifications.ongoing.bodyRemaining');
    expect(content.body).toContain('notifications.ongoing.remaining');
    expect(content.body).toContain('120min');
  });

  it('says "less than a minute" rather than counting seconds', () => {
    const content = buildOngoingContent(state, at('2026-08-19T15:59:30.000Z'), deps);

    expect(content.body).toContain('notifications.ongoing.remainingSoon');
    expect(content.body).not.toContain('remaining(');
  });

  it('says the time has come once the prayer has begun', () => {
    const content = buildOngoingContent(state, at('2026-08-19T16:00:05.000Z'), deps);

    expect(content.body).toContain('notifications.ongoing.remainingNow');
  });

  it('falls back to the plain body when the duration cannot be phrased', () => {
    const content = buildOngoingContent(state, at('2026-08-19T14:00:00.000Z'), {
      ...deps,
      formatRemaining: () => {
        throw new Error('no formatter');
      },
    });

    expect(content.body).toBe('notifications.ongoing.body');
    // The title still carries the whole message — a broken formatter must not blank the
    // notification.
    expect(content.title).toContain('prayers.asr');
  });
});
