/// <reference types="node" />
/**
 * Tests for Qibla geometry and the compass angle helpers.
 *
 * ## Strategy
 *
 * 1. **Absolute correctness** is pinned by published bearings/distances for well-known cities
 *    (Brooklyn ≈ 58°, Istanbul ≈ 152°, Jakarta ≈ 295°).
 * 2. **Formula correctness** is pinned independently of our Kaaba constant by running our
 *    `initialBearing` against `adhan.Qibla` *with adhan's own Kaaba fix* over a global grid —
 *    that must agree to ~1e-12, proving the two implementations are the same mathematics
 *    rearranged. The remaining, deliberately-separate test then measures what our own Kaaba
 *    constant costs (< 0.01° everywhere that matters).
 * 3. **The angle helpers** are tested against the wrap-around cases that actually break compasses
 *    (0/360, ±180, opposite headings) plus algebraic invariants over a swept range, because the
 *    needle has to be right at *every* heading, not just the ones someone thought to enumerate.
 *
 * Nothing here reads a clock, a timezone or a locale, so the file is trivially deterministic and
 * timezone-robust: no `Date` is constructed anywhere in the module under test.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as adhan from 'adhan';

import {
  CARDINAL_KEYS,
  DEFAULT_ALIGNMENT_TOLERANCE_DEG,
  KAABA,
  MEAN_EARTH_RADIUS_KM,
  UNKNOWN_CARDINAL_KEY,
  cardinalKey,
  distanceToKaabaKm,
  greatCircleDistanceKm,
  initialBearing,
  isAligned,
  normalizeAngle,
  qiblaBearing,
  shortestAngleDelta,
  smoothHeading,
} from './qibla';
import type { Coordinates } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BROOKLYN: Coordinates = { latitude: 40.6782, longitude: -73.9442 };
const ISTANBUL: Coordinates = { latitude: 41.0082, longitude: 28.9784 };
const JAKARTA: Coordinates = { latitude: -6.2088, longitude: 106.8456 };
const LONDON: Coordinates = { latitude: 51.5074, longitude: -0.1278 };
const CAIRO: Coordinates = { latitude: 30.0444, longitude: 31.2357 };
const RIYADH: Coordinates = { latitude: 24.7136, longitude: 46.6753 };
const MADINAH: Coordinates = { latitude: 24.4672, longitude: 39.6111 };
const SYDNEY: Coordinates = { latitude: -33.8688, longitude: 151.2093 };
const CAPE_TOWN: Coordinates = { latitude: -33.9249, longitude: 18.4241 };
const TOKYO: Coordinates = { latitude: 35.6762, longitude: 139.6503 };
const KUALA_LUMPUR: Coordinates = { latitude: 3.139, longitude: 101.6869 };
const NORTH_POLE: Coordinates = { latitude: 90, longitude: 0 };
const SOUTH_POLE: Coordinates = { latitude: -90, longitude: 0 };

/** The point diametrically opposite the Kaaba — in the Pacific, south-west of French Polynesia. */
const KAABA_ANTIPODE: Coordinates = {
  latitude: -KAABA.latitude,
  longitude: KAABA.longitude - 180,
};

/**
 * adhan-js's own Kaaba fix (`node_modules/adhan/lib/esm/Qibla.js`), ~104 m from {@link KAABA}.
 * Used only to compare the two *formulas* without the two *constants* getting in the way.
 */
const ADHAN_KAABA: Coordinates = { latitude: 21.4225241, longitude: 39.8261818 };

const adhanQibla = (c: Coordinates): number =>
  adhan.Qibla(new adhan.Coordinates(c.latitude, c.longitude));

/** Absolute angular difference between two bearings, taking the short way round. */
const angularDistance = (a: number, b: number): number => Math.abs(shortestAngleDelta(a, b));

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe('module hygiene', () => {
  it('is pure TypeScript — no React, React Native, Expo or adhan imports', () => {
    const source = fs.readFileSync(path.join(__dirname, 'qibla.ts'), 'utf8');
    const importedModules = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

    expect(importedModules).toEqual(['./types']);
  });
});

// ---------------------------------------------------------------------------
// KAABA
// ---------------------------------------------------------------------------

describe('KAABA', () => {
  it('is the documented Masjid al-Haram fix', () => {
    expect(KAABA.latitude).toBeCloseTo(21.4224779, 7);
    expect(KAABA.longitude).toBeCloseTo(39.8251832, 7);
  });

  it('is frozen, so a caller cannot move the Kaaba for the whole app', () => {
    expect(Object.isFrozen(KAABA)).toBe(true);
  });

  it('sits within ~150 m of the fix adhan-js uses', () => {
    // The whole justification for keeping our own constant: the two are the same building.
    expect(greatCircleDistanceKm(KAABA, ADHAN_KAABA)).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// qiblaBearing — known values
// ---------------------------------------------------------------------------

describe('qiblaBearing', () => {
  it.each([
    ['Brooklyn, NY', BROOKLYN, 58],
    ['Istanbul', ISTANBUL, 151.6],
    ['Jakarta', JAKARTA, 295],
    ['London', LONDON, 119],
    ['Cairo', CAIRO, 136],
    ['Kuala Lumpur', KUALA_LUMPUR, 292.5],
    ['Cape Town', CAPE_TOWN, 23.4],
    ['Sydney', SYDNEY, 277.5],
    ['Tokyo', TOKYO, 293],
  ])('points to Makkah from %s', (_label, from, expected) => {
    expect(angularDistance(qiblaBearing(from), expected)).toBeLessThan(1);
  });

  it('gives Brooklyn a north-easterly bearing — the great circle, not the Mercator intuition', () => {
    const bearing = qiblaBearing(BROOKLYN);
    expect(bearing).toBeGreaterThan(0);
    expect(bearing).toBeLessThan(90);
    expect(cardinalKey(bearing)).toBe('qibla.cardinal.ne');
  });

  it('sends Madinah almost due south, and Riyadh roughly west-south-west', () => {
    expect(angularDistance(qiblaBearing(MADINAH), 176)).toBeLessThan(1);
    expect(angularDistance(qiblaBearing(RIYADH), 244)).toBeLessThan(1);
  });

  it('always returns a bearing in [0, 360)', () => {
    for (let latitude = -85; latitude <= 85; latitude += 5) {
      for (let longitude = -180; longitude < 180; longitude += 5) {
        const bearing = qiblaBearing({ latitude, longitude });
        expect(Number.isFinite(bearing)).toBe(true);
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
      }
    }
  });

  it('is unaffected by an unnormalised longitude', () => {
    const wrapped: Coordinates = { ...BROOKLYN, longitude: BROOKLYN.longitude + 360 };
    expect(qiblaBearing(wrapped)).toBeCloseTo(qiblaBearing(BROOKLYN), 9);
  });

  it('points due south from a point on the Kaaba meridian to the north, due north from the south', () => {
    expect(qiblaBearing({ latitude: KAABA.latitude + 20, longitude: KAABA.longitude })).toBeCloseTo(
      180,
      9
    );
    expect(qiblaBearing({ latitude: KAABA.latitude - 20, longitude: KAABA.longitude })).toBeCloseTo(
      0,
      9
    );
  });

  // --- degenerate geometry -------------------------------------------------

  it('is 0, not NaN, at the Kaaba itself', () => {
    const bearing = qiblaBearing(KAABA);
    expect(Number.isNaN(bearing)).toBe(false);
    expect(bearing).toBe(0);
  });

  it('is 0, not NaN, at a copy of the Kaaba coordinates', () => {
    // Guards against an implementation that only survives via object identity.
    const copy: Coordinates = { latitude: KAABA.latitude, longitude: KAABA.longitude };
    expect(qiblaBearing(copy)).toBe(0);
  });

  it('stays finite a metre away from the Kaaba', () => {
    const oneMetreNorth: Coordinates = { ...KAABA, latitude: KAABA.latitude + 0.000009 };
    expect(Number.isFinite(qiblaBearing(oneMetreNorth))).toBe(true);
    // Directly north of it, so the Qibla is due south.
    expect(angularDistance(qiblaBearing(oneMetreNorth), 180)).toBeLessThan(0.001);
  });

  it('stays finite at the Kaaba antipode, where every direction is equally correct', () => {
    const bearing = qiblaBearing(KAABA_ANTIPODE);
    expect(Number.isFinite(bearing)).toBe(true);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });

  it('stays finite at both poles', () => {
    expect(Number.isFinite(qiblaBearing(NORTH_POLE))).toBe(true);
    expect(Number.isFinite(qiblaBearing(SOUTH_POLE))).toBe(true);
    // From the geographic south pole every direction is north, and the great circle to Makkah
    // leaves along Makkah's own meridian.
    expect(qiblaBearing(SOUTH_POLE)).toBeCloseTo(KAABA.longitude, 6);
  });

  it.each([
    ['NaN latitude', { latitude: Number.NaN, longitude: 10 }],
    ['NaN longitude', { latitude: 10, longitude: Number.NaN }],
    ['infinite latitude', { latitude: Number.POSITIVE_INFINITY, longitude: 10 }],
    ['infinite longitude', { latitude: 10, longitude: Number.NEGATIVE_INFINITY }],
  ])('returns NaN for %s rather than a plausible-looking angle', (_label, from) => {
    expect(qiblaBearing(from)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// Cross-check against adhan
// ---------------------------------------------------------------------------

describe('cross-check against adhan.Qibla', () => {
  it.each([
    ['Brooklyn, NY', BROOKLYN],
    ['Istanbul', ISTANBUL],
    ['Jakarta', JAKARTA],
    ['London', LONDON],
    ['Cairo', CAIRO],
    ['Riyadh', RIYADH],
    ['Kuala Lumpur', KUALA_LUMPUR],
    ['Cape Town', CAPE_TOWN],
    ['Sydney', SYDNEY],
    ['Tokyo', TOKYO],
    ['North Pole', NORTH_POLE],
    ['South Pole', SOUTH_POLE],
  ])('agrees with adhan within 0.01° at %s', (_label, from) => {
    expect(angularDistance(qiblaBearing(from), adhanQibla(from))).toBeLessThan(0.01);
  });

  it('is the same formula as adhan, to floating-point noise, when given adhan’s own Kaaba', () => {
    // Proves the *implementation* rather than the *constant*: adhan divides its terms through by
    // cos(φ₂) (valid because Makkah is north of the equator); we use the textbook arrangement.
    let worst = 0;
    for (let latitude = -87; latitude <= 87; latitude += 3) {
      for (let longitude = -180; longitude < 180; longitude += 5) {
        const from: Coordinates = { latitude, longitude };
        worst = Math.max(
          worst,
          angularDistance(initialBearing(from, ADHAN_KAABA), adhanQibla(from))
        );
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('diverges from adhan by more than 0.01° only close to Makkah, where the 104 m fix gap matters', () => {
    // Documented, expected, and harmless: 0.02° is two orders of magnitude below phone-compass
    // error, and nobody in Madinah needs an app to find the Qibla.
    const divergence = angularDistance(qiblaBearing(MADINAH), adhanQibla(MADINAH));
    expect(divergence).toBeGreaterThan(0.01);
    expect(divergence).toBeLessThan(0.05);
  });

  it('agrees with adhan within 0.01° across the globe outside the Makkah region', () => {
    let worst = 0;
    for (let latitude = -87; latitude <= 87; latitude += 3) {
      for (let longitude = -180; longitude < 180; longitude += 5) {
        const from: Coordinates = { latitude, longitude };
        const distance = distanceToKaabaKm(from);
        // Skip the two ill-conditioned neighbourhoods: near the Kaaba and near its antipode the
        // bearing is dominated by which Kaaba fix you picked, not by the formula.
        if (distance < 600 || distance > 19_500) continue;
        worst = Math.max(worst, angularDistance(qiblaBearing(from), adhanQibla(from)));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// distanceToKaabaKm
// ---------------------------------------------------------------------------

describe('distanceToKaabaKm', () => {
  it.each([
    // Rounded published great-circle figures; the tolerance is generous enough to survive a
    // different-but-reasonable city centroid, tight enough to catch a wrong radius or a
    // degrees/radians slip.
    ['Brooklyn, NY', BROOKLYN, 10_304, 60],
    ['Istanbul', ISTANBUL, 2405, 30],
    ['Jakarta', JAKARTA, 7920, 50],
    ['London', LONDON, 4794, 40],
    ['Cairo', CAIRO, 1287, 20],
    ['Madinah', MADINAH, 339, 10],
  ])('is ~%s km from %s', (_label, from, expected, tolerance) => {
    expect(Math.abs(distanceToKaabaKm(from) - expected)).toBeLessThan(tolerance);
  });

  it('puts Brooklyn around ten thousand kilometres out, as the design mock says', () => {
    // docs/DESIGN.md's info card reads "10,321 km" for a slightly different Brooklyn centroid.
    expect(distanceToKaabaKm(BROOKLYN)).toBeGreaterThan(10_200);
    expect(distanceToKaabaKm(BROOKLYN)).toBeLessThan(10_400);
  });

  it('is exactly 0 at the Kaaba', () => {
    expect(distanceToKaabaKm(KAABA)).toBe(0);
    expect(distanceToKaabaKm({ latitude: KAABA.latitude, longitude: KAABA.longitude })).toBe(0);
  });

  it('is half the great circle at the antipode', () => {
    // Millimetre-level tolerance, not exact: haversine is famously ill-conditioned for
    // near-antipodal pairs (`a` approaches 1, where `asin` loses precision). ~0.2 mm out of
    // 20,015 km is the known, accepted cost of the formula.
    expect(distanceToKaabaKm(KAABA_ANTIPODE)).toBeCloseTo(Math.PI * MEAN_EARTH_RADIUS_KM, 3);
  });

  it('never exceeds half the earth’s circumference, and is never negative', () => {
    const half = Math.PI * MEAN_EARTH_RADIUS_KM;
    for (let latitude = -90; latitude <= 90; latitude += 5) {
      for (let longitude = -180; longitude < 180; longitude += 5) {
        const distance = distanceToKaabaKm({ latitude, longitude });
        expect(distance).toBeGreaterThanOrEqual(0);
        expect(distance).toBeLessThanOrEqual(half + 1e-6);
      }
    }
  });

  it('uses a mean earth radius of 6371 km', () => {
    expect(MEAN_EARTH_RADIUS_KM).toBe(6371);
    // A quarter turn along a meridian is a quarter of the circumference.
    expect(
      greatCircleDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 90, longitude: 0 })
    ).toBeCloseTo((Math.PI / 2) * 6371, 6);
  });

  it('is symmetric', () => {
    expect(greatCircleDistanceKm(BROOKLYN, JAKARTA)).toBeCloseTo(
      greatCircleDistanceKm(JAKARTA, BROOKLYN),
      9
    );
  });

  it('keeps sub-metre precision for very short distances (haversine, not law of cosines)', () => {
    const oneArcSecondNorth: Coordinates = { ...KAABA, latitude: KAABA.latitude + 1 / 3600 };
    const metres = greatCircleDistanceKm(KAABA, oneArcSecondNorth) * 1000;
    expect(metres).toBeGreaterThan(30);
    expect(metres).toBeLessThan(31);
  });

  it('returns NaN for non-finite coordinates', () => {
    expect(distanceToKaabaKm({ latitude: Number.NaN, longitude: 0 })).toBeNaN();
    expect(distanceToKaabaKm({ latitude: 0, longitude: Number.POSITIVE_INFINITY })).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// normalizeAngle
// ---------------------------------------------------------------------------

describe('normalizeAngle', () => {
  it.each([
    [0, 0],
    [1, 1],
    [359.9, 359.9],
    [360, 0],
    [361, 1],
    [720, 0],
    [730, 10],
    [-1, 359],
    [-10, 350],
    [-180, 180],
    [-360, 0],
    [-361, 359],
    [-720, 0],
    [-3610, 350],
    [1_000_000, 280],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeAngle(input)).toBeCloseTo(expected, 9);
  });

  it('always lands in [0, 360)', () => {
    for (let deg = -1440; deg <= 1440; deg += 0.25) {
      const normalized = normalizeAngle(deg);
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThan(360);
    }
  });

  it('never returns 360 for values a hair below a full turn', () => {
    expect(normalizeAngle(-1e-15)).toBeLessThan(360);
    expect(normalizeAngle(-1e-9)).toBeLessThan(360);
    expect(normalizeAngle(360 - 1e-12)).toBeLessThan(360);
  });

  it('is bit-exact for angles already in range — no drift when fed back in', () => {
    // `((x % 360) + 360) % 360` returns 123.45600000000002 here; the needle is re-normalised on
    // every sensor sample, so this has to be lossless.
    for (const deg of [0.1, 1.5, 123.456, 200.0001, 359.999]) {
      expect(normalizeAngle(deg)).toBe(deg);
    }
    let heading = 123.456;
    for (let i = 0; i < 1000; i += 1) heading = normalizeAngle(heading);
    expect(heading).toBe(123.456);
  });

  it('returns positive zero, never -0 (Object.is-sensitive comparisons downstream)', () => {
    expect(Object.is(normalizeAngle(-0), 0)).toBe(true);
    expect(Object.is(normalizeAngle(-360), 0)).toBe(true);
    expect(Object.is(normalizeAngle(0), 0)).toBe(true);
  });

  it('is idempotent', () => {
    for (const deg of [-721, -180.5, -0.5, 0, 17.25, 359.99, 1234.5]) {
      expect(normalizeAngle(normalizeAngle(deg))).toBeCloseTo(normalizeAngle(deg), 12);
    }
  });

  it.each([
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('returns NaN for %s', (_label, input) => {
    expect(normalizeAngle(input)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// shortestAngleDelta
// ---------------------------------------------------------------------------

describe('shortestAngleDelta', () => {
  it('takes the short way round the 0/360 seam', () => {
    expect(shortestAngleDelta(350, 10)).toBeCloseTo(20, 9);
    expect(shortestAngleDelta(10, 350)).toBeCloseTo(-20, 9);
    expect(shortestAngleDelta(359, 1)).toBeCloseTo(2, 9);
    expect(shortestAngleDelta(1, 359)).toBeCloseTo(-2, 9);
    expect(shortestAngleDelta(0, 359)).toBeCloseTo(-1, 9);
    expect(shortestAngleDelta(359, 0)).toBeCloseTo(1, 9);
  });

  it('is signed clockwise-positive: positive means turn right', () => {
    expect(shortestAngleDelta(0, 90)).toBeCloseTo(90, 9);
    expect(shortestAngleDelta(90, 0)).toBeCloseTo(-90, 9);
    expect(shortestAngleDelta(270, 0)).toBeCloseTo(90, 9);
    expect(shortestAngleDelta(0, 270)).toBeCloseTo(-90, 9);
  });

  it('is 0 for identical angles, including across full turns', () => {
    expect(shortestAngleDelta(0, 0)).toBe(0);
    expect(shortestAngleDelta(123.456, 123.456)).toBe(0);
    expect(shortestAngleDelta(10, 370)).toBe(0);
    expect(shortestAngleDelta(-350, 10)).toBe(0);
  });

  // --- the ±180 boundary ---------------------------------------------------

  it('reports exactly opposite angles as +180, never -180', () => {
    expect(shortestAngleDelta(0, 180)).toBe(180);
    expect(shortestAngleDelta(180, 0)).toBe(180);
    expect(shortestAngleDelta(90, 270)).toBe(180);
    expect(shortestAngleDelta(270, 90)).toBe(180);
    expect(shortestAngleDelta(359, 179)).toBe(180);
  });

  it('flips sign just past the antipodal boundary', () => {
    expect(shortestAngleDelta(0, 180.001)).toBeCloseTo(-179.999, 9);
    expect(shortestAngleDelta(0, 179.999)).toBeCloseTo(179.999, 9);
  });

  it('handles the 0/180 half-turn seam without leaving the range', () => {
    for (let to = 179; to <= 181; to += 0.05) {
      const delta = shortestAngleDelta(0, to);
      expect(delta).toBeGreaterThan(-180);
      expect(delta).toBeLessThanOrEqual(180);
    }
  });

  it('always returns a value in (-180, 180]', () => {
    for (let from = -360; from <= 360; from += 17) {
      for (let to = -360; to <= 360; to += 13) {
        const delta = shortestAngleDelta(from, to);
        expect(delta).toBeGreaterThan(-180);
        expect(delta).toBeLessThanOrEqual(180);
      }
    }
  });

  it('lands on the target: normalizeAngle(from + delta) === normalizeAngle(to)', () => {
    for (let from = 0; from < 360; from += 7) {
      for (let to = 0; to < 360; to += 11) {
        expect(normalizeAngle(from + shortestAngleDelta(from, to))).toBeCloseTo(
          normalizeAngle(to),
          9
        );
      }
    }
  });

  it('is antisymmetric except at the +180 tie-break', () => {
    for (let from = 0; from < 360; from += 7) {
      for (let to = 0; to < 360; to += 11) {
        const forward = shortestAngleDelta(from, to);
        const backward = shortestAngleDelta(to, from);
        if (Math.abs(forward) === 180) {
          expect(backward).toBe(180);
        } else {
          expect(backward).toBeCloseTo(-forward, 9);
        }
      }
    }
  });

  it('ignores unnormalised inputs', () => {
    expect(shortestAngleDelta(-10, 730)).toBeCloseTo(shortestAngleDelta(350, 10), 9);
    expect(shortestAngleDelta(710, -350)).toBeCloseTo(shortestAngleDelta(350, 10), 9);
  });

  it('returns NaN when either side is not finite', () => {
    expect(shortestAngleDelta(Number.NaN, 10)).toBeNaN();
    expect(shortestAngleDelta(10, Number.NaN)).toBeNaN();
    expect(shortestAngleDelta(Number.POSITIVE_INFINITY, 10)).toBeNaN();
    expect(shortestAngleDelta(10, Number.NEGATIVE_INFINITY)).toBeNaN();
    expect(shortestAngleDelta(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// isAligned
// ---------------------------------------------------------------------------

describe('isAligned', () => {
  it('defaults to the 5° window from the spec', () => {
    expect(DEFAULT_ALIGNMENT_TOLERANCE_DEG).toBe(5);
    expect(isAligned(0)).toBe(true);
    expect(isAligned(4.9)).toBe(true);
    expect(isAligned(-4.9)).toBe(true);
    expect(isAligned(5.1)).toBe(false);
    expect(isAligned(-5.1)).toBe(false);
  });

  it('is inclusive at exactly the tolerance ("≤5°")', () => {
    expect(isAligned(5)).toBe(true);
    expect(isAligned(-5)).toBe(true);
    expect(isAligned(3, 3)).toBe(true);
  });

  it('treats the delta as an angle, so it wraps', () => {
    expect(isAligned(359)).toBe(true);
    expect(isAligned(356)).toBe(true);
    expect(isAligned(354)).toBe(false);
    expect(isAligned(-359)).toBe(true);
    expect(isAligned(720)).toBe(true);
    expect(isAligned(363)).toBe(true);
  });

  it('is never aligned when facing away', () => {
    expect(isAligned(180)).toBe(false);
    expect(isAligned(-180)).toBe(false);
    expect(isAligned(90)).toBe(false);
    expect(isAligned(270)).toBe(false);
  });

  it('honours a custom tolerance', () => {
    expect(isAligned(9, 10)).toBe(true);
    expect(isAligned(11, 10)).toBe(false);
    expect(isAligned(0.5, 1)).toBe(true);
    expect(isAligned(1.5, 1)).toBe(false);
  });

  it('with a zero tolerance only accepts a dead-exact heading', () => {
    expect(isAligned(0, 0)).toBe(true);
    expect(isAligned(0.001, 0)).toBe(false);
  });

  it('clamps a negative tolerance to zero rather than making alignment impossible at 0°', () => {
    expect(isAligned(0, -5)).toBe(true);
    expect(isAligned(1, -5)).toBe(false);
  });

  it('clamps a tolerance above a half-turn to 180', () => {
    expect(isAligned(180, 900)).toBe(true);
    expect(isAligned(123, 900)).toBe(true);
  });

  it('falls back to the default tolerance when the tolerance is not finite', () => {
    expect(isAligned(4, Number.NaN)).toBe(true);
    expect(isAligned(6, Number.NaN)).toBe(false);
    expect(isAligned(6, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('is false for a non-finite delta — no heading means no alignment claim', () => {
    expect(isAligned(Number.NaN)).toBe(false);
    expect(isAligned(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isAligned(Number.NEGATIVE_INFINITY, 180)).toBe(false);
  });

  it('agrees with the delta the compass actually feeds it', () => {
    const bearing = qiblaBearing(ISTANBUL); // ≈ 151.6°
    expect(isAligned(shortestAngleDelta(bearing, bearing))).toBe(true);
    expect(isAligned(shortestAngleDelta(bearing - 4, bearing))).toBe(true);
    expect(isAligned(shortestAngleDelta(bearing + 4, bearing))).toBe(true);
    expect(isAligned(shortestAngleDelta(bearing + 20, bearing))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cardinalKey
// ---------------------------------------------------------------------------

describe('cardinalKey', () => {
  it('exposes an 8-point rose, clockwise from north', () => {
    expect(CARDINAL_KEYS).toHaveLength(8);
    expect([...CARDINAL_KEYS]).toEqual([
      'qibla.cardinal.n',
      'qibla.cardinal.ne',
      'qibla.cardinal.e',
      'qibla.cardinal.se',
      'qibla.cardinal.s',
      'qibla.cardinal.sw',
      'qibla.cardinal.w',
      'qibla.cardinal.nw',
    ]);
  });

  it.each([
    [0, 'qibla.cardinal.n'],
    [45, 'qibla.cardinal.ne'],
    [90, 'qibla.cardinal.e'],
    [135, 'qibla.cardinal.se'],
    [180, 'qibla.cardinal.s'],
    [225, 'qibla.cardinal.sw'],
    [270, 'qibla.cardinal.w'],
    [315, 'qibla.cardinal.nw'],
  ])('maps the exact point %p', (bearing, expected) => {
    expect(cardinalKey(bearing)).toBe(expected);
  });

  it.each([
    // Sector boundaries round away from the lower point.
    [22.4, 'qibla.cardinal.n'],
    [22.5, 'qibla.cardinal.ne'],
    [67.4, 'qibla.cardinal.ne'],
    [67.5, 'qibla.cardinal.e'],
    [112.5, 'qibla.cardinal.se'],
    [157.5, 'qibla.cardinal.s'],
    [202.5, 'qibla.cardinal.sw'],
    [247.5, 'qibla.cardinal.w'],
    [292.5, 'qibla.cardinal.nw'],
    [337.4, 'qibla.cardinal.nw'],
    [337.5, 'qibla.cardinal.n'],
    [359.999, 'qibla.cardinal.n'],
  ])('maps the boundary %p', (bearing, expected) => {
    expect(cardinalKey(bearing)).toBe(expected);
  });

  it('matches the labels the design mock prints', () => {
    // "58° NE" for Brooklyn — the reason the rose is 8-point and not 16-point (58° is ENE there).
    expect(cardinalKey(58)).toBe('qibla.cardinal.ne');
    expect(cardinalKey(qiblaBearing(BROOKLYN))).toBe('qibla.cardinal.ne');
    expect(cardinalKey(qiblaBearing(ISTANBUL))).toBe('qibla.cardinal.se');
    expect(cardinalKey(qiblaBearing(JAKARTA))).toBe('qibla.cardinal.nw');
  });

  it('normalizes first, so unnormalised bearings still resolve', () => {
    expect(cardinalKey(-45)).toBe('qibla.cardinal.nw');
    expect(cardinalKey(405)).toBe('qibla.cardinal.ne');
    expect(cardinalKey(-1)).toBe('qibla.cardinal.n');
  });

  it('only ever returns a known key, across the whole circle', () => {
    const known = new Set<string>(CARDINAL_KEYS);
    for (let bearing = 0; bearing < 360; bearing += 0.5) {
      expect(known.has(cardinalKey(bearing))).toBe(true);
    }
  });

  it('returns the unknown key rather than undefined for a non-finite bearing', () => {
    expect(cardinalKey(Number.NaN)).toBe(UNKNOWN_CARDINAL_KEY);
    expect(cardinalKey(Number.POSITIVE_INFINITY)).toBe(UNKNOWN_CARDINAL_KEY);
    expect(cardinalKey(qiblaBearing({ latitude: Number.NaN, longitude: 0 }))).toBe(
      UNKNOWN_CARDINAL_KEY
    );
  });
});

// ---------------------------------------------------------------------------
// smoothHeading
// ---------------------------------------------------------------------------

describe('smoothHeading', () => {
  it('interpolates towards the new reading', () => {
    expect(smoothHeading(0, 10, 0.5)).toBeCloseTo(5, 9);
    expect(smoothHeading(100, 200, 0.25)).toBeCloseTo(125, 9);
    expect(smoothHeading(40, 20, 0.5)).toBeCloseTo(30, 9);
  });

  it('takes the short arc across the 359 → 1 seam instead of a full rotation', () => {
    expect(smoothHeading(359, 1, 0.5)).toBeCloseTo(0, 9);
    expect(smoothHeading(1, 359, 0.5)).toBeCloseTo(0, 9);
    expect(smoothHeading(350, 10, 0.25)).toBeCloseTo(355, 9);
    expect(smoothHeading(10, 350, 0.25)).toBeCloseTo(5, 9);
    expect(smoothHeading(358, 2, 0.5)).toBeCloseTo(0, 9);
  });

  it('never moves further than the shortest arc', () => {
    for (let previous = 0; previous < 360; previous += 13) {
      for (let next = 0; next < 360; next += 17) {
        const shortest = Math.abs(shortestAngleDelta(previous, next));
        for (const factor of [0.1, 0.25, 0.5, 0.9]) {
          const moved = Math.abs(
            shortestAngleDelta(previous, smoothHeading(previous, next, factor))
          );
          expect(moved).toBeLessThanOrEqual(shortest + 1e-9);
        }
      }
    }
  });

  it('moves towards the target, never away from it', () => {
    for (let previous = 0; previous < 360; previous += 11) {
      for (let next = 0; next < 360; next += 19) {
        const before = Math.abs(shortestAngleDelta(previous, next));
        const after = Math.abs(shortestAngleDelta(smoothHeading(previous, next, 0.3), next));
        expect(after).toBeLessThanOrEqual(before + 1e-9);
      }
    }
  });

  it('always returns a value in [0, 360), so it can be fed straight back in', () => {
    for (let previous = -720; previous <= 720; previous += 37) {
      for (let next = -720; next <= 720; next += 41) {
        for (const factor of [0, 0.15, 0.5, 0.85, 1]) {
          const result = smoothHeading(previous, next, factor);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(360);
        }
      }
    }
  });

  it('holds exactly at factor 0 and snaps exactly at factor 1', () => {
    expect(smoothHeading(123.456, 300, 0)).toBe(123.456);
    expect(smoothHeading(123.456, 300, 1)).toBe(300);
    expect(smoothHeading(359, 1, 1)).toBe(1);
    expect(smoothHeading(359, 1, 0)).toBe(359);
  });

  it('clamps the factor into [0, 1]', () => {
    expect(smoothHeading(100, 200, -1)).toBe(100);
    expect(smoothHeading(100, 200, 5)).toBe(200);
  });

  it('normalizes both endpoints', () => {
    expect(smoothHeading(-10, 370, 0)).toBeCloseTo(350, 9);
    expect(smoothHeading(-10, 370, 1)).toBeCloseTo(10, 9);
    expect(smoothHeading(-10, 370, 0.5)).toBeCloseTo(0, 9);
  });

  it('turns clockwise for exactly-opposite readings, matching the +180 tie-break', () => {
    expect(smoothHeading(0, 180, 0.5)).toBeCloseTo(90, 9);
    expect(smoothHeading(180, 0, 0.5)).toBeCloseTo(270, 9);
  });

  it('converges on a steady reading without overshooting or oscillating', () => {
    let heading = 350;
    for (let i = 0; i < 200; i += 1) {
      heading = smoothHeading(heading, 10, 0.2);
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
    }
    expect(Math.abs(shortestAngleDelta(heading, 10))).toBeLessThan(1e-6);
  });

  it('damps jitter around the seam instead of amplifying it', () => {
    // A noisy sensor bouncing across north must not make the needle spin.
    const samples = [359.5, 0.5, 359.2, 0.8, 359.9, 0.1, 359.6, 0.4];
    let heading = 0;
    for (const sample of samples) {
      heading = smoothHeading(heading, sample, 0.2);
      expect(Math.abs(shortestAngleDelta(heading, 0))).toBeLessThan(1);
    }
  });

  it('holds the previous value when a sample is dropped', () => {
    expect(smoothHeading(123.456, Number.NaN, 0.5)).toBe(123.456);
    expect(smoothHeading(123.456, Number.POSITIVE_INFINITY, 0.5)).toBe(123.456);
    expect(smoothHeading(-10, Number.NaN, 0.5)).toBeCloseTo(350, 9);
  });

  it('adopts the first sample outright when there is no previous heading', () => {
    expect(smoothHeading(Number.NaN, 42, 0.2)).toBe(42);
    expect(smoothHeading(Number.NaN, -10, 0.2)).toBeCloseTo(350, 9);
    expect(smoothHeading(Number.NEGATIVE_INFINITY, 42, 0.2)).toBe(42);
  });

  it('treats a non-finite factor as a hold', () => {
    expect(smoothHeading(100, 200, Number.NaN)).toBe(100);
    expect(smoothHeading(100, 200, Number.POSITIVE_INFINITY)).toBe(100);
  });

  it('is NaN only when there is nothing at all to go on', () => {
    expect(smoothHeading(Number.NaN, Number.NaN, 0.5)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// End-to-end: the numbers the Qibla screen actually renders
// ---------------------------------------------------------------------------

describe('compass integration', () => {
  it('produces the Brooklyn info-card row from the design mock', () => {
    const bearing = qiblaBearing(BROOKLYN);
    expect(Math.round(bearing)).toBe(59); // "58° NE" in the mock, from a nearby centroid
    expect(cardinalKey(bearing)).toBe('qibla.cardinal.ne');
    expect(Math.round(distanceToKaabaKm(BROOKLYN))).toBe(10_304);
  });

  it('drives the guidance card: turn left when the Qibla is anticlockwise of the heading', () => {
    const bearing = qiblaBearing(ISTANBUL); // ≈ 151.6°
    const delta = shortestAngleDelta(200, bearing);
    expect(delta).toBeLessThan(0); // turn_left
    expect(Math.round(Math.abs(delta))).toBe(48);
    expect(isAligned(delta)).toBe(false);
  });

  it('drives the guidance card: turn right when the Qibla is clockwise of the heading', () => {
    const bearing = qiblaBearing(ISTANBUL);
    const delta = shortestAngleDelta(100, bearing);
    expect(delta).toBeGreaterThan(0); // turn_right
    expect(isAligned(delta)).toBe(false);
  });

  it('flips to aligned as a smoothed heading settles onto the bearing', () => {
    const bearing = qiblaBearing(BROOKLYN);
    let heading = normalizeAngle(bearing + 120);
    let alignedAt = -1;
    for (let step = 0; step < 100; step += 1) {
      heading = smoothHeading(heading, bearing, 0.25);
      if (alignedAt < 0 && isAligned(shortestAngleDelta(heading, bearing))) alignedAt = step;
    }
    expect(alignedAt).toBeGreaterThan(0);
    expect(isAligned(shortestAngleDelta(heading, bearing))).toBe(true);
  });

  it('stays aligned once aligned — the state never flickers on a settled needle', () => {
    const bearing = qiblaBearing(JAKARTA);
    let heading = bearing;
    for (let step = 0; step < 50; step += 1) {
      heading = smoothHeading(heading, bearing + (step % 2 === 0 ? 0.4 : -0.4), 0.2);
      expect(isAligned(shortestAngleDelta(heading, bearing))).toBe(true);
    }
  });
});
