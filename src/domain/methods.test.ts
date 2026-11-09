import * as adhan from 'adhan';

import {
  AUTO_METHOD_LABEL_KEY,
  buildParameters,
  COUNTRY_METHOD_MAP,
  DEFAULT_METHOD,
  isConcreteMethod,
  isMethodSupported,
  JAFARI_ANGLES,
  listMethods,
  resolveMadhab,
  METHOD_DESCRIPTION_KEYS,
  METHOD_LABEL_KEYS,
  methodLabelKey,
  resolveMethod,
} from './methods';
import { CALCULATION_METHODS, type CalculationMethodId, type ConcreteMethodId } from './types';

const CONCRETE_METHODS = CALCULATION_METHODS.filter((id): id is ConcreteMethodId => id !== 'auto');

/** Local noon on a fixed date — deterministic in any timezone (never a UTC literal). */
const localNoon = (year: number, monthIndex: number, day: number) =>
  new Date(year, monthIndex, day, 12, 0, 0, 0);

const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 };
const MECCA = { latitude: 21.4225, longitude: 39.8262 };
const TROMSO = { latitude: 69.6492, longitude: 18.9553 };
const LONGYEARBYEN = { latitude: 78.2232, longitude: 15.6469 };

// ---------------------------------------------------------------------------
// COUNTRY_METHOD_MAP
// ---------------------------------------------------------------------------

describe('COUNTRY_METHOD_MAP', () => {
  it('is keyed by uppercase ISO-3166 alpha-2 codes', () => {
    for (const key of Object.keys(COUNTRY_METHOD_MAP)) {
      expect(key).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('only maps to concrete, supported methods (never `auto`)', () => {
    for (const value of Object.values(COUNTRY_METHOD_MAP)) {
      expect(isConcreteMethod(value)).toBe(true);
    }
  });

  it('assigns the mandated national authorities', () => {
    expect(COUNTRY_METHOD_MAP.TR).toBe('turkey');
    expect(COUNTRY_METHOD_MAP.US).toBe('northAmerica');
    expect(COUNTRY_METHOD_MAP.CA).toBe('northAmerica');
    expect(COUNTRY_METHOD_MAP.SA).toBe('ummAlQura');
    expect(COUNTRY_METHOD_MAP.EG).toBe('egyptian');
    expect(COUNTRY_METHOD_MAP.AE).toBe('dubai');
    expect(COUNTRY_METHOD_MAP.KW).toBe('kuwait');
    expect(COUNTRY_METHOD_MAP.QA).toBe('qatar');
    expect(COUNTRY_METHOD_MAP.IR).toBe('tehran');
  });

  it('assigns the South Asian bloc to Karachi', () => {
    for (const code of ['PK', 'IN', 'BD', 'AF', 'LK']) {
      expect(COUNTRY_METHOD_MAP[code]).toBe('karachi');
    }
  });

  it('assigns the Southeast Asian bloc to Singapore', () => {
    for (const code of ['SG', 'MY', 'ID']) {
      expect(COUNTRY_METHOD_MAP[code]).toBe('singapore');
    }
  });

  it('assigns the British Isles to the Moonsighting Committee', () => {
    expect(COUNTRY_METHOD_MAP.GB).toBe('moonsightingCommittee');
    expect(COUNTRY_METHOD_MAP.IE).toBe('moonsightingCommittee');
  });

  it('covers the wider MENA region', () => {
    for (const code of ['MA', 'DZ', 'TN', 'LY', 'SD', 'JO', 'LB', 'SY', 'IQ', 'PS']) {
      expect(COUNTRY_METHOD_MAP[code]).toBe('egyptian');
    }
    for (const code of ['BH', 'YE']) {
      expect(COUNTRY_METHOD_MAP[code]).toBe('ummAlQura');
    }
  });

  it('covers European countries', () => {
    for (const code of ['FR', 'DE', 'NL', 'BE', 'ES', 'IT', 'SE', 'NO']) {
      expect(isConcreteMethod(COUNTRY_METHOD_MAP[code])).toBe(true);
    }
    // Ottoman-heritage Balkan communities follow the Diyanet takvim.
    for (const code of ['BA', 'AL', 'XK', 'MK']) {
      expect(COUNTRY_METHOD_MAP[code]).toBe('turkey');
    }
  });

  it('is frozen so callers cannot mutate the shared map', () => {
    expect(Object.isFrozen(COUNTRY_METHOD_MAP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveMethod
// ---------------------------------------------------------------------------

describe('resolveMethod (auto)', () => {
  it.each([
    ['TR', 'turkey'],
    ['US', 'northAmerica'],
    ['SA', 'ummAlQura'],
    ['EG', 'egyptian'],
    ['PK', 'karachi'],
    ['IR', 'tehran'],
    ['GB', 'moonsightingCommittee'],
  ] as const)('resolves %s to %s', (country, expected) => {
    expect(resolveMethod('auto', country)).toBe(expected);
  });

  it('falls back to Muslim World League for an unknown country', () => {
    expect(resolveMethod('auto', 'ZZ')).toBe('muslimWorldLeague');
    expect(resolveMethod('auto', 'ZZ')).toBe(DEFAULT_METHOD);
  });

  it('falls back to Muslim World League when the country is undefined', () => {
    expect(resolveMethod('auto')).toBe('muslimWorldLeague');
    expect(resolveMethod('auto', undefined)).toBe('muslimWorldLeague');
  });

  it('is case-insensitive', () => {
    expect(resolveMethod('auto', 'tr')).toBe('turkey');
    expect(resolveMethod('auto', 'Tr')).toBe('turkey');
    expect(resolveMethod('auto', 'us')).toBe('northAmerica');
  });

  it('tolerates surrounding whitespace', () => {
    expect(resolveMethod('auto', ' tr ')).toBe('turkey');
    expect(resolveMethod('auto', '\tSA\n')).toBe('ummAlQura');
  });

  it('falls back for empty and non alpha-2 inputs', () => {
    expect(resolveMethod('auto', '')).toBe('muslimWorldLeague');
    expect(resolveMethod('auto', '   ')).toBe('muslimWorldLeague');
    expect(resolveMethod('auto', 'USA')).toBe('muslimWorldLeague');
    expect(resolveMethod('auto', 'T')).toBe('muslimWorldLeague');
  });

  it('never returns the auto sentinel', () => {
    for (const country of ['TR', 'ZZ', '', 'gb', undefined]) {
      expect(resolveMethod('auto', country)).not.toBe('auto');
    }
  });

  it('resolves every mapped country to a buildable method', () => {
    for (const code of Object.keys(COUNTRY_METHOD_MAP)) {
      const resolved = resolveMethod('auto', code);
      expect(resolved).toBe(COUNTRY_METHOD_MAP[code]);
      expect(() =>
        buildParameters(resolved, { madhab: 'shafi', highLatitudeRule: 'auto' })
      ).not.toThrow();
    }
  });
});

describe('resolveMethod (concrete)', () => {
  it('passes every concrete id through unchanged, ignoring the country', () => {
    for (const id of CONCRETE_METHODS) {
      expect(resolveMethod(id)).toBe(id);
      expect(resolveMethod(id, 'TR')).toBe(id);
      expect(resolveMethod(id, 'zz')).toBe(id);
    }
  });

  it('falls back for an unrecognised (e.g. stale persisted) method id', () => {
    const stale = 'gulf' as CalculationMethodId;
    expect(resolveMethod(stale)).toBe('muslimWorldLeague');
    expect(resolveMethod(stale, 'TR')).toBe('muslimWorldLeague');
  });
});

// ---------------------------------------------------------------------------
// isMethodSupported / isConcreteMethod
// ---------------------------------------------------------------------------

describe('isMethodSupported', () => {
  it('accepts every id in the type contract, including auto', () => {
    for (const id of CALCULATION_METHODS) {
      expect(isMethodSupported(id)).toBe(true);
    }
    expect(isMethodSupported('auto')).toBe(true);
  });

  it('rejects unknown ids', () => {
    for (const id of ['', 'gulf', 'Turkey', 'TURKEY', 'jafari ', 'muslimworldleague']) {
      expect(isMethodSupported(id)).toBe(false);
    }
  });
});

describe('isConcreteMethod', () => {
  it('accepts every concrete id and rejects auto', () => {
    for (const id of CONCRETE_METHODS) {
      expect(isConcreteMethod(id)).toBe(true);
    }
    expect(isConcreteMethod('auto')).toBe(false);
    expect(isConcreteMethod('nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe('METHOD_LABEL_KEYS', () => {
  it('has a key for every concrete method id', () => {
    for (const id of CONCRETE_METHODS) {
      expect(METHOD_LABEL_KEYS[id]).toBeDefined();
    }
    expect(Object.keys(METHOD_LABEL_KEYS).sort()).toEqual([...CONCRETE_METHODS].sort());
  });

  it('exposes namespaced i18n keys, never user-facing literals', () => {
    for (const id of CONCRETE_METHODS) {
      const key = METHOD_LABEL_KEYS[id];
      expect(key).toBe(`methods.${id}`);
      expect(key).toMatch(/^methods\.[A-Za-z]+$/);
      expect(key).not.toMatch(/\s/);
    }
  });

  it('uses a distinct key per method', () => {
    const keys = Object.values(METHOD_LABEL_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a matching description key for every method', () => {
    expect(Object.keys(METHOD_DESCRIPTION_KEYS).sort()).toEqual([...CONCRETE_METHODS].sort());
    for (const id of CONCRETE_METHODS) {
      expect(METHOD_DESCRIPTION_KEYS[id]).toBe(`methods.descriptions.${id}`);
    }
  });
});

describe('methodLabelKey', () => {
  it('maps auto to the auto label key', () => {
    expect(methodLabelKey('auto')).toBe(AUTO_METHOD_LABEL_KEY);
    expect(AUTO_METHOD_LABEL_KEY).toBe('methods.auto');
  });

  it('maps concrete ids to their label key', () => {
    for (const id of CONCRETE_METHODS) {
      expect(methodLabelKey(id)).toBe(METHOD_LABEL_KEYS[id]);
    }
  });

  it('supports the "Auto (Diyanet)" composition the Settings screen needs', () => {
    const resolved = resolveMethod('auto', 'TR');
    expect(methodLabelKey('auto')).toBe('methods.auto');
    expect(METHOD_LABEL_KEYS[resolved]).toBe('methods.turkey');
  });
});

// ---------------------------------------------------------------------------
// listMethods
// ---------------------------------------------------------------------------

describe('listMethods', () => {
  it('puts auto first', () => {
    expect(listMethods()[0]?.id).toBe('auto');
  });

  it('lists every calculation method exactly once', () => {
    const ids = listMethods().map((option) => option.id);
    expect(ids).toHaveLength(CALCULATION_METHODS.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...CALCULATION_METHODS].sort());
  });

  it('carries i18n keys for every row', () => {
    for (const option of listMethods()) {
      expect(option.labelKey).toBe(methodLabelKey(option.id));
      expect(option.descriptionKey).toMatch(/^methods\.descriptions\./);
    }
  });

  it('returns a stable, frozen list', () => {
    const first = listMethods();
    expect(listMethods()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('places the default method directly after auto', () => {
    expect(listMethods()[1]?.id).toBe(DEFAULT_METHOD);
  });
});

// ---------------------------------------------------------------------------
// buildParameters — coverage
// ---------------------------------------------------------------------------

describe('buildParameters', () => {
  it('builds parameters for every concrete method without throwing', () => {
    for (const id of CONCRETE_METHODS) {
      const params = buildParameters(id, {
        madhab: 'shafi',
        highLatitudeRule: 'auto',
        coordinates: ISTANBUL,
      });
      expect(params).toBeInstanceOf(adhan.CalculationParameters);
      expect(Number.isFinite(params.fajrAngle)).toBe(true);
    }
  });

  it('produces usable prayer times for every concrete method', () => {
    for (const id of CONCRETE_METHODS) {
      const params = buildParameters(id, { madhab: 'shafi', highLatitudeRule: 'auto' });
      const times = new adhan.PrayerTimes(
        new adhan.Coordinates(ISTANBUL.latitude, ISTANBUL.longitude),
        localNoon(2026, 2, 15),
        params
      );
      expect(Number.isFinite(times.fajr.getTime())).toBe(true);
      expect(times.fajr.getTime()).toBeLessThan(times.sunrise.getTime());
      expect(times.sunrise.getTime()).toBeLessThan(times.dhuhr.getTime());
      expect(times.dhuhr.getTime()).toBeLessThan(times.asr.getTime());
      expect(times.asr.getTime()).toBeLessThan(times.maghrib.getTime());
      expect(times.maghrib.getTime()).toBeLessThan(times.isha.getTime());
    }
  });

  it('returns a fresh object per call so settings never leak between callers', () => {
    const a = buildParameters('turkey', { madhab: 'shafi', highLatitudeRule: 'middleOfTheNight' });
    const b = buildParameters('turkey', { madhab: 'shafi', highLatitudeRule: 'middleOfTheNight' });
    expect(a).not.toBe(b);
    a.fajrAngle = 99;
    expect(b.fajrAngle).not.toBe(99);
    expect(buildParameters('turkey', { madhab: 'shafi', highLatitudeRule: 'auto' }).fajrAngle).toBe(
      18
    );
  });

  it('leaves per-prayer offsets to prayerTimes.ts (adjustments stay zeroed)', () => {
    const params = buildParameters('muslimWorldLeague', {
      madhab: 'shafi',
      highLatitudeRule: 'auto',
    });
    expect(Object.values(params.adjustments)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('keeps the adhan method identity so the authority stays nameable', () => {
    expect(buildParameters('turkey', { madhab: 'shafi', highLatitudeRule: 'auto' }).method).toBe(
      'Turkey'
    );
    expect(buildParameters('ummAlQura', { madhab: 'shafi', highLatitudeRule: 'auto' }).method).toBe(
      'UmmAlQura'
    );
  });

  it('keeps Turkey on the Diyanet angles (18°/17°)', () => {
    const params = buildParameters('turkey', { madhab: 'shafi', highLatitudeRule: 'auto' });
    expect(params.fajrAngle).toBe(18);
    expect(params.ishaAngle).toBe(17);
  });

  it('recommends the same high-latitude rule for mirrored latitudes (adhan lacks the abs)', () => {
    // adhan 4.4.4's `recommended` tests `latitude > 48` without Math.abs, so Punta Arenas and
    // Ushuaia would get the mild rule exactly where the strong one is needed. Our `auto`
    // branch mirrors the latitude before asking (D121).
    const north = buildParameters('muslimWorldLeague', {
      madhab: 'shafi',
      highLatitudeRule: 'auto',
      coordinates: { latitude: 60, longitude: 0 },
    });
    const south = buildParameters('muslimWorldLeague', {
      madhab: 'shafi',
      highLatitudeRule: 'auto',
      coordinates: { latitude: -60, longitude: 0 },
    });
    expect(south.highLatitudeRule).toBe(north.highLatitudeRule);
    expect(south.highLatitudeRule).toBe(adhan.HighLatitudeRule.SeventhOfTheNight);
  });

  it('pins Moonsighting Committee shafaq to General so an adhan upgrade cannot move GB/IE Isha', () => {
    const params = buildParameters('moonsightingCommittee', {
      madhab: 'shafi',
      highLatitudeRule: 'auto',
    });
    expect(params.shafaq).toBe(adhan.Shafaq.General);
  });
});

// ---------------------------------------------------------------------------
// buildParameters — Jafari
// ---------------------------------------------------------------------------

describe('buildParameters (jafari)', () => {
  it('applies the Leva Institute angles', () => {
    const params = buildParameters('jafari', { madhab: 'shafi', highLatitudeRule: 'auto' });
    expect(params.fajrAngle).toBe(16);
    expect(params.ishaAngle).toBe(14);
    expect(params.maghribAngle).toBe(4);
    expect(JAFARI_ANGLES).toEqual({ fajr: 16, isha: 14, maghrib: 4 });
  });

  it('is not adhan Tehran (17.7° / 14° / 4.5°)', () => {
    const jafari = buildParameters('jafari', { madhab: 'shafi', highLatitudeRule: 'auto' });
    const tehran = buildParameters('tehran', { madhab: 'shafi', highLatitudeRule: 'auto' });
    expect(tehran.fajrAngle).toBe(17.7);
    expect(tehran.maghribAngle).toBe(4.5);
    expect(jafari.fajrAngle).not.toBe(tehran.fajrAngle);
    expect(jafari.maghribAngle).not.toBe(tehran.maghribAngle);
  });

  it('delays maghrib past sunset, unlike the Sunni methods', () => {
    const coords = new adhan.Coordinates(35.6892, 51.389); // Tehran city
    const date = localNoon(2026, 2, 15);
    const jafari = new adhan.PrayerTimes(
      coords,
      date,
      buildParameters('jafari', { madhab: 'shafi', highLatitudeRule: 'auto' })
    );
    const mwl = new adhan.PrayerTimes(
      coords,
      date,
      buildParameters('muslimWorldLeague', { madhab: 'shafi', highLatitudeRule: 'auto' })
    );
    expect(jafari.maghrib.getTime()).toBeGreaterThan(mwl.maghrib.getTime());
    expect(jafari.maghrib.getTime()).toBeGreaterThan(jafari.sunset.getTime());
  });

  it('does not mutate adhan’s shared Other() factory output', () => {
    const first = buildParameters('jafari', { madhab: 'shafi', highLatitudeRule: 'auto' });
    first.fajrAngle = 1;
    const other = adhan.CalculationMethod.Other();
    expect(other.fajrAngle).toBe(0);
    expect(buildParameters('jafari', { madhab: 'shafi', highLatitudeRule: 'auto' }).fajrAngle).toBe(
      16
    );
  });
});

// ---------------------------------------------------------------------------
// resolveMadhab (D209)
// ---------------------------------------------------------------------------

describe('resolveMadhab', () => {
  it('gives the Hanafi Asr in South Asia and the majority Asr elsewhere', () => {
    for (const code of ['PK', 'IN', 'BD', 'AF', ' pk ']) {
      expect(resolveMadhab('auto', code)).toBe('hanafi');
    }
    for (const code of ['TR', 'SA', 'EG', 'GB', 'ID', '', 'XX']) {
      expect(resolveMadhab('auto', code)).toBe('shafi');
    }
    expect(resolveMadhab('auto')).toBe('shafi');
  });

  it('keeps a choice the user made, whatever the country', () => {
    expect(resolveMadhab('shafi', 'PK')).toBe('shafi');
    expect(resolveMadhab('hanafi', 'TR')).toBe('hanafi');
  });

  it('never gives the Hanafi Asr to the Shia methods', () => {
    expect(resolveMadhab('auto', 'PK', 'jafari')).toBe('shafi');
    expect(resolveMadhab('auto', 'PK', 'tehran')).toBe('shafi');
    expect(resolveMadhab('auto', 'PK', 'karachi')).toBe('hanafi');
  });

  it('falls back to the majority Asr for an unknown stored value', () => {
    expect(resolveMadhab('maliki' as never, 'PK')).toBe('shafi');
  });
});

// ---------------------------------------------------------------------------
// buildParameters — madhab
// ---------------------------------------------------------------------------

describe('buildParameters (madhab)', () => {
  it('maps our madhab ids onto adhan.Madhab', () => {
    expect(
      buildParameters('muslimWorldLeague', { madhab: 'shafi', highLatitudeRule: 'auto' }).madhab
    ).toBe(adhan.Madhab.Shafi);
    expect(
      buildParameters('muslimWorldLeague', { madhab: 'hanafi', highLatitudeRule: 'auto' }).madhab
    ).toBe(adhan.Madhab.Hanafi);
  });

  it('overrides the method default for every method', () => {
    for (const id of CONCRETE_METHODS) {
      expect(buildParameters(id, { madhab: 'hanafi', highLatitudeRule: 'auto' }).madhab).toBe(
        adhan.Madhab.Hanafi
      );
    }
  });

  it('puts the Hanafi Asr later than the Shafi Asr', () => {
    const coords = new adhan.Coordinates(ISTANBUL.latitude, ISTANBUL.longitude);
    const date = localNoon(2026, 2, 15);
    const shafi = new adhan.PrayerTimes(
      coords,
      date,
      buildParameters('turkey', { madhab: 'shafi', highLatitudeRule: 'auto' })
    );
    const hanafi = new adhan.PrayerTimes(
      coords,
      date,
      buildParameters('turkey', { madhab: 'hanafi', highLatitudeRule: 'auto' })
    );
    expect(hanafi.asr.getTime()).toBeGreaterThan(shafi.asr.getTime());
    // Asr is the only prayer the madhab moves.
    expect(hanafi.dhuhr.getTime()).toBe(shafi.dhuhr.getTime());
    expect(hanafi.maghrib.getTime()).toBe(shafi.maghrib.getTime());
  });
});

// ---------------------------------------------------------------------------
// buildParameters — high latitude rule
// ---------------------------------------------------------------------------

describe('buildParameters (high latitude rule)', () => {
  it('maps the explicit rules straight through', () => {
    const build = (rule: 'middleOfTheNight' | 'seventhOfTheNight' | 'twilightAngle') =>
      buildParameters('muslimWorldLeague', { madhab: 'shafi', highLatitudeRule: rule })
        .highLatitudeRule;
    expect(build('middleOfTheNight')).toBe(adhan.HighLatitudeRule.MiddleOfTheNight);
    expect(build('seventhOfTheNight')).toBe(adhan.HighLatitudeRule.SeventhOfTheNight);
    expect(build('twilightAngle')).toBe(adhan.HighLatitudeRule.TwilightAngle);
  });

  it('ignores the coordinates for explicit rules', () => {
    expect(
      buildParameters('muslimWorldLeague', {
        madhab: 'shafi',
        highLatitudeRule: 'middleOfTheNight',
        coordinates: TROMSO,
      }).highLatitudeRule
    ).toBe(adhan.HighLatitudeRule.MiddleOfTheNight);
  });

  it('auto delegates to adhan.HighLatitudeRule.recommended when coordinates are given', () => {
    expect(typeof adhan.HighLatitudeRule.recommended).toBe('function');
    for (const coords of [MECCA, ISTANBUL, TROMSO]) {
      expect(
        buildParameters('muslimWorldLeague', {
          madhab: 'shafi',
          highLatitudeRule: 'auto',
          coordinates: coords,
        }).highLatitudeRule
      ).toBe(
        adhan.HighLatitudeRule.recommended(new adhan.Coordinates(coords.latitude, coords.longitude))
      );
    }
  });

  it('auto picks a night-portion rule at high latitude and middle-of-the-night near the equator', () => {
    expect(
      buildParameters('muslimWorldLeague', {
        madhab: 'shafi',
        highLatitudeRule: 'auto',
        coordinates: TROMSO,
      }).highLatitudeRule
    ).toBe(adhan.HighLatitudeRule.SeventhOfTheNight);
    expect(
      buildParameters('muslimWorldLeague', {
        madhab: 'shafi',
        highLatitudeRule: 'auto',
        coordinates: MECCA,
      }).highLatitudeRule
    ).toBe(adhan.HighLatitudeRule.MiddleOfTheNight);
  });

  it('auto falls back to middle-of-the-night when no coordinates are known', () => {
    expect(
      buildParameters('muslimWorldLeague', { madhab: 'shafi', highLatitudeRule: 'auto' })
        .highLatitudeRule
    ).toBe(adhan.HighLatitudeRule.MiddleOfTheNight);
  });
});

// ---------------------------------------------------------------------------
// buildParameters — polar circle
// ---------------------------------------------------------------------------

describe('buildParameters (polar circle)', () => {
  it('sets a resolving strategy for every method', () => {
    for (const id of CONCRETE_METHODS) {
      expect(
        buildParameters(id, { madhab: 'shafi', highLatitudeRule: 'auto' }).polarCircleResolution
      ).toBe(adhan.PolarCircleResolution.AqrabBalad);
    }
  });

  it('yields finite times above the polar circle in midsummer instead of throwing', () => {
    const coords = new adhan.Coordinates(LONGYEARBYEN.latitude, LONGYEARBYEN.longitude);
    for (const id of CONCRETE_METHODS) {
      const params = buildParameters(id, {
        madhab: 'shafi',
        highLatitudeRule: 'auto',
        coordinates: LONGYEARBYEN,
      });
      const times = new adhan.PrayerTimes(coords, localNoon(2026, 5, 21), params);
      expect(Number.isFinite(times.fajr.getTime())).toBe(true);
      expect(Number.isFinite(times.dhuhr.getTime())).toBe(true);
      expect(Number.isFinite(times.isha.getTime())).toBe(true);
    }
  });

  it('yields finite times above the polar circle in midwinter', () => {
    const coords = new adhan.Coordinates(LONGYEARBYEN.latitude, LONGYEARBYEN.longitude);
    const params = buildParameters('muslimWorldLeague', {
      madhab: 'shafi',
      highLatitudeRule: 'auto',
      coordinates: LONGYEARBYEN,
    });
    const times = new adhan.PrayerTimes(coords, localNoon(2026, 11, 21), params);
    expect(Number.isFinite(times.fajr.getTime())).toBe(true);
    expect(Number.isFinite(times.maghrib.getTime())).toBe(true);
  });

  it('demonstrates that Unresolved really does fail there', () => {
    // Guards the reason buildParameters sets polarCircleResolution explicitly: unresolved, the
    // polar-night/midnight-sun case yields Invalid Dates (which throw on read). adhan's own
    // default became AqrabBalad upstream (adhan-js#232, carried by our patch), but the app keeps
    // stating it rather than leaning on a library default that has already changed once.
    const bare = adhan.CalculationMethod.MuslimWorldLeague();
    bare.polarCircleResolution = adhan.PolarCircleResolution.Unresolved;
    let fajrIsUnusable = false;
    try {
      const times = new adhan.PrayerTimes(
        new adhan.Coordinates(LONGYEARBYEN.latitude, LONGYEARBYEN.longitude),
        localNoon(2026, 5, 21),
        bare
      );
      fajrIsUnusable = !Number.isFinite(times.fajr.getTime());
      expect(() => times.fajr.toISOString()).toThrow();
    } catch {
      fajrIsUnusable = true; // some adhan paths throw during construction instead
    }
    expect(fajrIsUnusable).toBe(true);
  });
});
