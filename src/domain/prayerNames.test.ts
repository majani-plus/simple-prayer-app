/**
 * `domain/prayerNames` — which occurrences of a prayer are named Jumu'ah (D75).
 *
 * The rules under test are the two that make a weekday-dependent *display* name safe:
 *
 * 1. **Only the name changes.** Nothing here returns a `Prayer`, so no caller can be tempted to
 *    fork the data model on a weekday — `dhuhr` stays `dhuhr` for storage, streaks, stats, qada
 *    and notification keys.
 * 2. **Friday means the PRAYER day.** The prayer day runs Fajr→next Fajr, so Friday-ness follows
 *    the day a prayer *belongs to*, never the wall clock at render time. The post-midnight case
 *    (Thursday's Isha logged at 00:30 on Friday morning) is the one that would go wrong under a
 *    `new Date().getDay()` implementation, and it has its own test below.
 */

import { isJumuah, prayerNameKey } from './prayerNames';
import { addDays, weekdayIndex } from './dates';
import { PRAYERS, type Prayer, type PrayerDay } from './types';

/** A Friday, a Thursday and a Saturday, verified against `dates.weekdayIndex` rather than asserted. */
const FRIDAY: PrayerDay = '2026-08-21';
const THURSDAY: PrayerDay = '2026-08-20';
const SATURDAY: PrayerDay = '2026-08-22';

describe('the fixtures really are the weekdays they claim', () => {
  it('anchors on a Friday', () => {
    expect(weekdayIndex(FRIDAY)).toBe(5);
    expect(weekdayIndex(THURSDAY)).toBe(4);
    expect(weekdayIndex(SATURDAY)).toBe(6);
  });
});

describe('isJumuah', () => {
  it('is true for Dhuhr on a Friday', () => {
    expect(isJumuah('dhuhr', FRIDAY)).toBe(true);
  });

  it('is false for Dhuhr on every other day of the week', () => {
    // A whole week from a known Friday: exactly one day may qualify.
    const week = Array.from({ length: 7 }, (_, offset) => addDays(FRIDAY, offset + 1));
    const fridays = week.filter((day) => isJumuah('dhuhr', day));
    expect(fridays).toEqual([addDays(FRIDAY, 7)]);
  });

  it('is false for every prayer that is not Dhuhr, Friday or not', () => {
    for (const prayer of PRAYERS.filter((p) => p !== 'dhuhr')) {
      expect(isJumuah(prayer, FRIDAY)).toBe(false);
      expect(isJumuah(prayer, THURSDAY)).toBe(false);
    }
  });

  it('throws on a day that is not a real calendar date', () => {
    expect(() => isJumuah('dhuhr', '2026-02-30')).toThrow(RangeError);
    expect(() => isJumuah('dhuhr', 'friday' as PrayerDay)).toThrow(RangeError);
  });
});

describe('prayerNameKey', () => {
  it('renames only Friday’s Dhuhr, and only its key', () => {
    expect(prayerNameKey('dhuhr', FRIDAY)).toBe('jumuah');
    expect(prayerNameKey('dhuhr', THURSDAY)).toBe('dhuhr');
    expect(prayerNameKey('dhuhr', SATURDAY)).toBe('dhuhr');
  });

  it('returns every other prayer’s own id untouched, on a Friday included', () => {
    for (const prayer of PRAYERS.filter((p) => p !== 'dhuhr')) {
      expect(prayerNameKey(prayer, FRIDAY)).toBe(prayer);
    }
  });

  it('never invents a key outside the i18n bundle', () => {
    const keys = new Set<string>();
    for (let offset = 0; offset < 14; offset += 1) {
      for (const prayer of PRAYERS) keys.add(prayerNameKey(prayer, addDays(THURSDAY, offset)));
    }
    expect([...keys].sort()).toEqual([...PRAYERS, 'jumuah'].sort());
  });

  /**
   * The regression the prayer-day rule exists to prevent. At 00:30 on Friday morning the wall
   * clock says Friday, but the prayer day is still Thursday's (Fajr→next Fajr) — so Thursday's
   * Isha, and Thursday's Dhuhr with it, must not acquire Friday's name. Equally, Friday's own
   * post-midnight Isha belongs to Friday's prayer day, where Dhuhr IS Jumu'ah.
   */
  it('follows the prayer day across midnight, not the calendar date of the instant', () => {
    // Thursday's prayer day, still being logged into after midnight on Friday.
    expect(prayerNameKey('dhuhr', THURSDAY)).toBe('dhuhr');
    expect(prayerNameKey('isha', THURSDAY)).toBe('isha');
    // Friday's prayer day, whose own Isha is logged after midnight on Saturday.
    expect(prayerNameKey('dhuhr', FRIDAY)).toBe('jumuah');
    expect(prayerNameKey('isha', FRIDAY)).toBe('isha');
  });

  it('is a pure function of its two arguments — no clock is read', () => {
    const realDate = Date.now;
    Date.now = () => {
      throw new Error('prayerNames must not read the clock');
    };
    try {
      expect(prayerNameKey('dhuhr', FRIDAY)).toBe('jumuah');
    } finally {
      Date.now = realDate;
    }
  });

  it('agrees with itself across a whole year of Fridays', () => {
    let fridays = 0;
    for (let offset = 0; offset < 365; offset += 1) {
      const day = addDays(FRIDAY, offset);
      const key = prayerNameKey('dhuhr' as Prayer, day);
      if (key === 'jumuah') fridays += 1;
      expect(key === 'jumuah').toBe(weekdayIndex(day) === 5);
    }
    // 365 days from a Friday inclusive spans 53 Fridays.
    expect(fridays).toBe(53);
  });
});
