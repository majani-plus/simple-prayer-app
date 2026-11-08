/**
 * Tests for travel mode's two questions: **is the user travelling on this day**, and **is this tap
 * still on time**.
 *
 * Like `windows.ts`, this module is free of adhan and of the clock, so the windows here are
 * hand-built and the instants are plain numbers. The one property worth stating up front, because
 * every "late" case below rests on it: a traveller's Dhuhr stays on time until **Maghrib** (the end
 * of Asr's window) and their Maghrib until the **next day's Fajr** (the end of Isha's), and those
 * two boundaries are read off the existing windows rather than computed here.
 */

import { PRAYERS, type Prayer, type PrayerDay, type PrayerWindow } from './types';
import { JAM_PARTNER, isTravelingOn, travelPrayedStatusAt, travelWindowFor } from './travel';
import { prayedStatusAt } from './windows';

import type { TravelState } from './travel';

const HOUR = 3_600_000;

/** A day's five windows, tiling from 05:00 with Fajr shutting at sunrise (06:00). */
const T = {
  fajrStart: 5 * HOUR,
  sunrise: 6 * HOUR,
  dhuhr: 12 * HOUR,
  asr: 16 * HOUR,
  maghrib: 19 * HOUR,
  isha: 21 * HOUR,
  nextFajr: 29 * HOUR,
} as const;

const WINDOWS: PrayerWindow[] = [
  { prayer: 'fajr', start: new Date(T.fajrStart), end: new Date(T.sunrise) },
  { prayer: 'dhuhr', start: new Date(T.dhuhr), end: new Date(T.asr) },
  { prayer: 'asr', start: new Date(T.asr), end: new Date(T.maghrib) },
  { prayer: 'maghrib', start: new Date(T.maghrib), end: new Date(T.isha) },
  { prayer: 'isha', start: new Date(T.isha), end: new Date(T.nextFajr) },
];

/** Travel state, active from `startDay` unless overridden. */
function traveling(startDay: PrayerDay, endDay: PrayerDay | null = null): TravelState {
  return { active: true, startDay, endDay };
}

// ===========================================================================
// JAM_PARTNER
// ===========================================================================

describe('JAM_PARTNER', () => {
  it('pairs Dhuhr with Asr and Maghrib with Isha — the only two pairs the rule allows', () => {
    expect(JAM_PARTNER.dhuhr).toBe('asr');
    expect(JAM_PARTNER.maghrib).toBe('isha');
  });

  it('gives Fajr no partner: it stands alone', () => {
    expect(JAM_PARTNER.fajr).toBeUndefined();
  });

  it('names only the earlier half of each pair — Asr and Isha are where the pair is prayed', () => {
    expect(JAM_PARTNER.asr).toBeUndefined();
    expect(JAM_PARTNER.isha).toBeUndefined();
  });
});

// ===========================================================================
// isTravelingOn
// ===========================================================================

describe('isTravelingOn', () => {
  const DAY: PrayerDay = '2026-08-19';

  it('is false while travel is off, whatever days are stored', () => {
    expect(isTravelingOn(DAY, { active: false, startDay: DAY, endDay: null })).toBe(false);
  });

  it('is false before it started', () => {
    expect(isTravelingOn('2026-08-18', traveling(DAY))).toBe(false);
  });

  it('is true on the first day and every day after, when open-ended', () => {
    expect(isTravelingOn(DAY, traveling(DAY))).toBe(true);
    expect(isTravelingOn('2026-08-20', traveling(DAY))).toBe(true);
    expect(isTravelingOn('2026-12-31', traveling(DAY))).toBe(true);
  });

  describe('with an end day', () => {
    /** Three days beginning the 19th: the 19th, 20th and 21st. */
    const THREE_DAYS = traveling(DAY, '2026-08-21');

    it('covers every day up to and including the last', () => {
      expect(isTravelingOn(DAY, THREE_DAYS)).toBe(true);
      expect(isTravelingOn('2026-08-20', THREE_DAYS)).toBe(true);
      expect(isTravelingOn('2026-08-21', THREE_DAYS)).toBe(true);
    });

    it('is over the day after — with nothing having run to end it', () => {
      expect(isTravelingOn('2026-08-22', THREE_DAYS)).toBe(false);
    });

    it('handles a single travel day', () => {
      const oneDay = traveling(DAY, DAY);
      expect(isTravelingOn(DAY, oneDay)).toBe(true);
      expect(isTravelingOn('2026-08-20', oneDay)).toBe(false);
    });

    it('crosses a month boundary', () => {
      const overMonth = traveling('2026-08-30', '2026-09-02');
      expect(isTravelingOn('2026-08-31', overMonth)).toBe(true);
      expect(isTravelingOn('2026-09-02', overMonth)).toBe(true);
      expect(isTravelingOn('2026-09-03', overMonth)).toBe(false);
    });
  });

  describe('a state that describes nothing is off, never on', () => {
    it('is false when active with no start day', () => {
      expect(isTravelingOn(DAY, { active: true, startDay: null, endDay: null })).toBe(false);
    });

    it('is false when the end precedes the start', () => {
      expect(isTravelingOn(DAY, traveling(DAY, '2026-08-18'))).toBe(false);
    });
  });
});

// ===========================================================================
// travelWindowFor
// ===========================================================================

describe('travelWindowFor', () => {
  it('judges Dhuhr against Asr’s window, so Dhuhr runs to Maghrib', () => {
    expect(travelWindowFor(WINDOWS, 'dhuhr')?.end.getTime()).toBe(T.maghrib);
  });

  it('judges Maghrib against Isha’s window, so Maghrib runs to the next Fajr', () => {
    expect(travelWindowFor(WINDOWS, 'maghrib')?.end.getTime()).toBe(T.nextFajr);
  });

  it('leaves the unpaired prayers on their own windows', () => {
    expect(travelWindowFor(WINDOWS, 'fajr')?.end.getTime()).toBe(T.sunrise);
    expect(travelWindowFor(WINDOWS, 'asr')?.end.getTime()).toBe(T.maghrib);
    expect(travelWindowFor(WINDOWS, 'isha')?.end.getTime()).toBe(T.nextFajr);
  });

  it('answers undefined when the window it needs is absent', () => {
    const withoutAsr = WINDOWS.filter((window) => window.prayer !== 'asr');
    expect(travelWindowFor(withoutAsr, 'dhuhr')).toBeUndefined();
  });
});

// ===========================================================================
// travelPrayedStatusAt
// ===========================================================================

describe('travelPrayedStatusAt', () => {
  describe('Dhuhr, which a traveller may pray in Asr’s time', () => {
    it('is prayed inside its own window', () => {
      expect(travelPrayedStatusAt(WINDOWS, 'dhuhr', T.dhuhr + HOUR)).toBe('prayed');
    });

    it('is prayed once Asr has come in — the case this whole module exists for', () => {
      // Marked at 17:00, an hour into Asr. Not travelling this would be `late`.
      expect(travelPrayedStatusAt(WINDOWS, 'dhuhr', T.asr + HOUR)).toBe('prayed');
      expect(prayedStatusAt(WINDOWS[1], T.asr + HOUR)).toBe('late');
    });

    it('is prayed right up to the instant before Maghrib', () => {
      expect(travelPrayedStatusAt(WINDOWS, 'dhuhr', T.maghrib - 1)).toBe('prayed');
    });

    it('is late at Maghrib and after: the concession has a limit', () => {
      expect(travelPrayedStatusAt(WINDOWS, 'dhuhr', T.maghrib)).toBe('late');
      expect(travelPrayedStatusAt(WINDOWS, 'dhuhr', T.isha)).toBe('late');
    });
  });

  describe('Maghrib, which a traveller may pray in Isha’s time', () => {
    it('is prayed once Isha has come in', () => {
      expect(travelPrayedStatusAt(WINDOWS, 'maghrib', T.isha + HOUR)).toBe('prayed');
      expect(prayedStatusAt(WINDOWS[3], T.isha + HOUR)).toBe('late');
    });

    it('is prayed until the instant before the next Fajr', () => {
      expect(travelPrayedStatusAt(WINDOWS, 'maghrib', T.nextFajr - 1)).toBe('prayed');
    });

    it('is late at the next Fajr', () => {
      expect(travelPrayedStatusAt(WINDOWS, 'maghrib', T.nextFajr)).toBe('late');
    });
  });

  describe('the prayers travel does not move', () => {
    const UNPAIRED: Prayer[] = ['fajr', 'asr', 'isha'];

    it.each(UNPAIRED)('answers exactly as the settled rule does for %s', (prayer) => {
      const own = WINDOWS.find((window) => window.prayer === prayer);
      for (const at of [T.fajrStart, T.sunrise, T.dhuhr, T.maghrib, T.nextFajr, T.nextFajr + HOUR]) {
        expect(travelPrayedStatusAt(WINDOWS, prayer, at)).toBe(prayedStatusAt(own, at));
      }
    });

    it('still calls Fajr late after sunrise — travel is no excuse for the one hard edge', () => {
      expect(travelPrayedStatusAt(WINDOWS, 'fajr', T.sunrise)).toBe('late');
    });
  });

  it('never declares a prayer late on a guess', () => {
    // No windows at all: the same mercy `prayedStatusAt` shows.
    for (const prayer of PRAYERS) {
      expect(travelPrayedStatusAt([], prayer, T.nextFajr + HOUR)).toBe('prayed');
    }
  });

  it('is never harsher than the settled rule, at any instant, for any prayer', () => {
    // The property that matters: travel may forgive lateness, never invent it.
    for (const prayer of PRAYERS) {
      const own = WINDOWS.find((window) => window.prayer === prayer);
      for (let at = 0; at <= T.nextFajr + HOUR; at += HOUR) {
        if (travelPrayedStatusAt(WINDOWS, prayer, at) === 'late') {
          expect(prayedStatusAt(own, at)).toBe('late');
        }
      }
    }
  });
});

// ===========================================================================
// Purity
// ===========================================================================

describe('the module stays domain-pure', () => {
  it('imports nothing but the day helpers, the window rule and the types', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reading the source, not it
    const fs = require('node:fs') as typeof import('node:fs');
    const source = fs.readFileSync(`${__dirname}/travel.ts`, 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(new Set(imports)).toEqual(new Set(['./dates', './windows', './types']));
  });
});
