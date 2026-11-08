/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Pacific/Kiritimati"}
 *
 * The dateline regression: a device timezone and a manually chosen city MORE than 24 hours
 * apart. Timezones span UTC−12…UTC+14, so this is reachable — a phone on Kiritimati (UTC+14)
 * with the city set to Alofi, Niue (UTC−11) is 25 hours out — and there the device's calendar
 * date sits TWO days from the prayer day at the city. The old one-step boundary rule
 * (calendar date, minus one when before that date's Fajr) could only correct by a single day,
 * so `getCurrentPrayerDay` answered a day late: the current prayer was unfindable (Today went
 * blank in the middle of Isha) and — the part that matters — a seal tap would have filed the
 * log under the wrong prayer day.
 *
 * `dates.resolvePrayerDayForInstant` now walks until fajr(D) <= now < fajr(D+1) actually
 * holds; these tests pin the walk against real adhan times, with the process really running
 * on UTC+14 (see fixedTimezoneEnvironment.js for why a beforeAll cannot fake that).
 */

import { getCurrentPrayer, getCurrentPrayerDay, getPrayerWindows } from './prayerTimes';
import type { CalculationSettings } from './types';

const NIUE = { latitude: -19.05, longitude: -169.92 };

const SETTINGS: CalculationSettings = {
  method: 'muslimWorldLeague',
  madhab: 'shafi',
  highLatitudeRule: 'auto',
  offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  hijriOffset: 0,
};

describe('device UTC+14, city UTC−11 (25 hours apart)', () => {
  it('really runs on Kiritimati time', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Kiritimati');
    expect(new Date(Date.UTC(2026, 7, 20, 10, 30)).getDate()).toBe(21);
  });

  it('resolves the prayer day TWO days behind the device calendar date during the city’s Isha', () => {
    // 23:30 of Aug 19 in Niue == 00:30 of Aug 21 on the device. Niue's Aug 19 Isha window is
    // wide open; the prayer day is Aug 19, a full two days off the device's calendar label.
    const now = new Date(Date.UTC(2026, 7, 20, 10, 30));
    expect(getCurrentPrayerDay(now, NIUE, SETTINGS)).toBe('2026-08-19');
  });

  it('still finds the open Isha window there instead of answering null', () => {
    const now = new Date(Date.UTC(2026, 7, 20, 10, 30));
    expect(getCurrentPrayer(now, NIUE, SETTINGS)).toEqual({
      prayer: 'isha',
      day: '2026-08-19',
    });

    // The claim is the window's, not the test's: that instant really is inside Aug 19's Isha.
    const isha = getPrayerWindows('2026-08-19', NIUE, SETTINGS)[4];
    expect(isha.prayer).toBe('isha');
    expect(now.getTime()).toBeGreaterThanOrEqual(isha.start.getTime());
    expect(now.getTime()).toBeLessThan(isha.end.getTime());
  });

  it('flips to the next prayer day exactly at that day’s Fajr, even across the two-day gap', () => {
    const fajr = getPrayerWindows('2026-08-20', NIUE, SETTINGS)[0];
    expect(getCurrentPrayerDay(new Date(fajr.start.getTime() - 1), NIUE, SETTINGS)).toBe(
      '2026-08-19'
    );
    expect(getCurrentPrayerDay(fajr.start, NIUE, SETTINGS)).toBe('2026-08-20');
  });

  it('stays self-consistent for a Kiritimati resident (the label skew is upstream, and stable)', () => {
    // Kiritimati's civil clock (UTC+14) runs ~24.5 hours ahead of its solar time (~UTC−10.5),
    // so adhan's civil-date-keyed computation places label D's prayers on civil day D+1 there.
    // The one-step rule and the walk both answer the previous label for that reason — this is
    // NOT a regression from the walk (both rules agree), it is an upstream property of
    // date-keyed solar computation at a +14 zone. What the app guarantees, and what this test
    // pins, is self-consistency: the day it names is the day whose window contains now, so the
    // clock times shown, the current prayer and the log destination all agree with each other.
    const kiritimati = { latitude: 1.87, longitude: -157.43 };
    const now = new Date(Date.UTC(2026, 7, 20, 1, 0)); // 15:00 Aug 20 on the device
    const day = getCurrentPrayerDay(now, kiritimati, SETTINGS);
    const current = getCurrentPrayer(now, kiritimati, SETTINGS);
    expect(current?.day).toBe(day);
    const window = getPrayerWindows(day, kiritimati, SETTINGS).find(
      (candidate) => candidate.prayer === current?.prayer
    );
    expect(window).toBeDefined();
    expect(now.getTime()).toBeGreaterThanOrEqual(window!.start.getTime());
    expect(now.getTime()).toBeLessThan(window!.end.getTime());
  });
});
