/**
 * Tests for the window-end rule and the one-tap log classification.
 *
 * This module is deliberately free of adhan and of the clock, so everything here is table-driven
 * against hand-built `PrayerWindow`s. The *astronomical* consequences of the rule (Fajr really
 * ending at sunrise for a real city, the morning gap, the Fajr nudge moving) are asserted where
 * they belong: `prayerTimes.test.ts` and `notificationPlan.test.ts`.
 */

import {
  PRAYERS,
  type DayTimes,
  type Prayer,
  type PrayerDay,
  type PrayerWindow,
  type TimeMarker,
} from './types';
import { WINDOW_END_MARKER, isWindowClosed, prayedStatusAt, windowEndFor } from './windows';

const MINUTE = 60_000;

function windowOf(prayer: Prayer, startMs: number, endMs: number): PrayerWindow {
  return { prayer, start: new Date(startMs), end: new Date(endMs) };
}

// ===========================================================================
// WINDOW_END_MARKER
// ===========================================================================

describe('WINDOW_END_MARKER', () => {
  it('ends Fajr at SUNRISE — the whole point of this module', () => {
    expect(WINDOW_END_MARKER.fajr).toBe('sunrise');
  });

  it('ends the middle three at the next prayer', () => {
    expect(WINDOW_END_MARKER.dhuhr).toBe('asr');
    expect(WINDOW_END_MARKER.asr).toBe('maghrib');
    expect(WINDOW_END_MARKER.maghrib).toBe('isha');
  });

  it('ends Isha at the next day’s Fajr, which is not a marker of its own day', () => {
    // `null` is the sentinel for "tomorrow", not an oversight — Isha is the only entry that
    // cannot name a marker of the day it belongs to.
    expect(WINDOW_END_MARKER.isha).toBeNull();
  });

  it('covers every prayer exactly once, and never names Fajr as an end', () => {
    expect(Object.keys(WINDOW_END_MARKER).sort()).toEqual([...PRAYERS].sort());
    expect(Object.values(WINDOW_END_MARKER)).not.toContain('fajr');
  });

  it('is the ONLY prayer whose window can shut before the next prayer begins', () => {
    // A marker that is not itself a prayer means "this window closes early". Exactly one entry
    // may be like that; if a second ever appears, the "no gaps after Dhuhr" reasoning in
    // prayerTimes/usePrayerDay has to be revisited deliberately.
    const early = Object.entries(WINDOW_END_MARKER).filter(
      ([, marker]) => marker !== null && !(PRAYERS as readonly string[]).includes(marker)
    );
    expect(early).toEqual([['fajr', 'sunrise']]);
  });
});

// ===========================================================================
// windowEndFor
// ===========================================================================

describe('windowEndFor', () => {
  const HOURS: Record<TimeMarker, number> = {
    fajr: 5,
    sunrise: 6,
    dhuhr: 13,
    asr: 16,
    maghrib: 19,
    isha: 21,
    middleOfTheNight: 23,
    lastThirdOfTheNight: 25,
  };

  function dayTimes(day: PrayerDay): DayTimes {
    const times = {} as Record<TimeMarker, Date>;
    for (const [marker, hour] of Object.entries(HOURS) as [TimeMarker, number][]) {
      times[marker] = new Date(`${day}T00:00:00.000Z`);
      times[marker].setUTCHours(hour);
    }
    return { day, times, method: 'muslimWorldLeague' };
  }

  const DAYS = ['2026-08-19', '2026-08-20'] as const;
  const days = DAYS.map(dayTimes);

  const endOf = (prayer: Prayer, day: PrayerDay = DAYS[0]) =>
    windowEndFor(days, day, prayer)?.toISOString();

  it('ends Fajr at sunrise, not at Dhuhr', () => {
    expect(endOf('fajr')).toBe('2026-08-19T06:00:00.000Z');
  });

  it('ends the middle three at the next prayer of the same day', () => {
    expect(endOf('dhuhr')).toBe('2026-08-19T16:00:00.000Z');
    expect(endOf('asr')).toBe('2026-08-19T19:00:00.000Z');
    expect(endOf('maghrib')).toBe('2026-08-19T21:00:00.000Z');
  });

  it('ends Isha at the NEXT day’s Fajr — the case a single day cannot answer', () => {
    expect(endOf('isha')).toBe('2026-08-20T05:00:00.000Z');
  });

  it('has no answer for the Isha of the last day it can see', () => {
    // The day after it is beyond the horizon, so its end is genuinely unknown here. Answering
    // with this day's Fajr would put the deadline sixteen hours in the past.
    expect(windowEndFor(days, DAYS[1], 'isha')).toBeUndefined();
  });

  it('answers undefined rather than guessing when it cannot resolve the end', () => {
    expect(windowEndFor(days, '2026-09-01', 'dhuhr')).toBeUndefined();
    expect(windowEndFor([], DAYS[0], 'dhuhr')).toBeUndefined();
    const broken = { ...dayTimes(DAYS[0]) };
    broken.times = { ...broken.times, asr: new Date(Number.NaN) };
    expect(windowEndFor([broken], DAYS[0], 'dhuhr')).toBeUndefined();
  });
});

// ===========================================================================
// isWindowClosed
// ===========================================================================

describe('isWindowClosed', () => {
  const window = windowOf('fajr', 1_000, 5_000);

  it('is half-open: open at the start, open a millisecond before the end, shut AT the end', () => {
    expect(isWindowClosed(window, 1_000)).toBe(false);
    expect(isWindowClosed(window, 4_999)).toBe(false);
    expect(isWindowClosed(window, 5_000)).toBe(true);
    expect(isWindowClosed(window, 9_999)).toBe(true);
  });

  it('does not care how far before the start the instant is (that is not this question)', () => {
    expect(isWindowClosed(window, 0)).toBe(false);
  });

  it('never declares a prayer late on a guess', () => {
    // No window, an unresolvable one (polar day/night), or a nonsense instant: answer "open".
    expect(isWindowClosed(undefined, 5_000)).toBe(false);
    expect(isWindowClosed(null, 5_000)).toBe(false);
    expect(isWindowClosed(windowOf('fajr', 1_000, Number.NaN), 5_000)).toBe(false);
    expect(isWindowClosed(window, Number.NaN)).toBe(false);
    expect(isWindowClosed({ prayer: 'fajr', start: new Date(0) } as PrayerWindow, 5_000)).toBe(
      false
    );
  });

  it('reports a degenerate window (end ≤ start) as shut, because it is', () => {
    // Extreme latitudes and aggressive offsets can invert a window. "Closed" is the honest read.
    expect(isWindowClosed(windowOf('dhuhr', 5_000, 1_000), 3_000)).toBe(true);
  });
});

// ===========================================================================
// prayedStatusAt
// ===========================================================================

describe('prayedStatusAt', () => {
  // A Fajr window with a realistic shape: dawn 04:52, sunrise 06:14.
  const dawn = Date.UTC(2026, 7, 19, 4, 52);
  const sunrise = Date.UTC(2026, 7, 19, 6, 14);
  const fajr = windowOf('fajr', dawn, sunrise);

  it('records "prayed" inside the window', () => {
    expect(prayedStatusAt(fajr, dawn)).toBe('prayed');
    expect(prayedStatusAt(fajr, dawn + 30 * MINUTE)).toBe('prayed');
    expect(prayedStatusAt(fajr, sunrise - 1)).toBe('prayed');
  });

  it('records "late" from the moment the sun is up', () => {
    expect(prayedStatusAt(fajr, sunrise)).toBe('late');
    expect(prayedStatusAt(fajr, sunrise + MINUTE)).toBe('late');
    // The old bug's blast radius: every one of these hours used to record a clean "prayed".
    expect(prayedStatusAt(fajr, sunrise + 6 * 60 * MINUTE)).toBe('late');
  });

  it('falls back to "prayed" when the window is unknown', () => {
    // Being unable to place the prayer in time must never manufacture a late.
    expect(prayedStatusAt(undefined, sunrise + MINUTE)).toBe('prayed');
  });
});
