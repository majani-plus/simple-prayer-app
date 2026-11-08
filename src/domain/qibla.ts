/**
 * Qibla geometry: where the Kaaba is, how far it is, and the angle helpers the compass
 * needle is driven by (design 3a — docs/DESIGN.md §Qibla, PRODUCT_SPEC §9).
 *
 * This module owns exactly two things:
 *
 *  1. **Great-circle math.** {@link qiblaBearing} (initial bearing, degrees clockwise from
 *     TRUE north) and {@link distanceToKaabaKm} (haversine on a sphere). Both are derived from
 *     the general {@link initialBearing} / {@link greatCircleDistanceKm} primitives so the same
 *     code path is exercised whichever the caller reaches for.
 *  2. **Angle plumbing for a live sensor.** {@link normalizeAngle}, {@link shortestAngleDelta},
 *     {@link isAligned}, {@link cardinalKey} and {@link smoothHeading}. These exist because a
 *     compass is one long argument with the number 360: without shortest-arc handling the needle
 *     spins the long way round every time the heading crosses north, and without smoothing it
 *     shivers on the magnetometer noise floor.
 *
 * ## Conventions fixed here (the UI depends on all of them)
 *
 * - **Bearings are TRUE-north referenced**, degrees, clockwise-positive, in `[0, 360)`.
 *   Magnetic declination is NOT applied anywhere in this module: `expo-location`'s
 *   `watchHeadingAsync` already reports a fused `trueHeading`, and applying declination twice
 *   would be worse than not applying it at all (PRODUCT_SPEC §9, "True north (not magnetic)").
 * - **Signed deltas are clockwise-positive**: a positive {@link shortestAngleDelta} means "turn
 *   right". The guidance card's turn_left/turn_right icon is chosen from that sign.
 * - **The earth is a sphere** of mean radius {@link MEAN_EARTH_RADIUS_KM}. This is a deliberate
 *   simplification: an ellipsoidal (Vincenty/Karney) solution would change the *distance* by up
 *   to ~0.5% and the *bearing* by a few hundredths of a degree — both far inside the ±5°
 *   alignment tolerance and invisible next to real phone-compass error (typically 2–15°).
 *   Every published Qibla figure quoted in the design mock is a spherical one.
 *
 * ## Robustness contract
 *
 * Every function here is fed either persisted coordinates or a hardware sensor stream, so none
 * of them throw. Non-finite inputs propagate as `NaN` (or, where a sane hold-last-value answer
 * exists, are absorbed — see {@link smoothHeading}). Each function's JSDoc says which.
 *
 * PURE TypeScript: no React, no React Native, no `adhan`, no I/O, no clock reads.
 */

import type { Coordinates } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The Kaaba, Masjid al-Haram, Makkah — the point every bearing and distance in the app is
 * measured to.
 *
 * NOTE: adhan-js carries its own, slightly different Kaaba fix (21.4225241, 39.8261818), about
 * 104 m north-east of this one. Both are "the Kaaba" to within the building's own footprint;
 * the app standardises on the value here so the compass never disagrees with itself between
 * screens. The practical consequence is bounded and tiny: the two references differ by less than
 * 0.005° of bearing beyond ~600 km, and only become visible within a few hundred kilometres of
 * Makkah (~0.02° at Madinah) — orders of magnitude below phone-compass accuracy. See
 * `qibla.test.ts` ("cross-check against adhan.Qibla").
 */
export const KAABA: Coordinates = Object.freeze({
  latitude: 21.4224779,
  longitude: 39.8251832,
});

/** IUGG mean earth radius, in kilometres. The sphere {@link greatCircleDistanceKm} assumes. */
export const MEAN_EARTH_RADIUS_KM = 6371;

/**
 * Default alignment tolerance, in degrees: the compass reads "Facing the Qibla" when the heading
 * is within 5° of the bearing (PRODUCT_SPEC §9 — "when aligned (≤5°)"). Inclusive.
 */
export const DEFAULT_ALIGNMENT_TOLERANCE_DEG = 5;

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

const toRadians = (deg: number): number => deg * RAD_PER_DEG;
const toDegrees = (rad: number): number => rad * DEG_PER_RAD;

const isFiniteCoordinate = (c: Coordinates | null | undefined): c is Coordinates =>
  c != null && Number.isFinite(c.latitude) && Number.isFinite(c.longitude);

// ---------------------------------------------------------------------------
// Angle helpers
// ---------------------------------------------------------------------------

/**
 * Wrap any angle in degrees into the canonical `[0, 360)` range.
 *
 * The single place the app is allowed to do modular arithmetic on angles — `%` alone is wrong
 * for negatives (`-10 % 360 === -10`), which is exactly how a needle ends up at -350°.
 *
 * - Handles arbitrarily large magnitudes and negative input: `-10 → 350`, `730 → 10`, `-360 → 0`.
 * - The upper bound is exclusive: the result is never `360`, and never `-0`.
 * - **Bit-exact for angles already in range.** An in-range value is returned untouched rather
 *   than round-tripped through `(x + 360) % 360`, which is not lossless (`123.456` comes back as
 *   `123.45600000000002`). The smoothed heading is fed back into this function on every sensor
 *   sample, so a per-call rounding error is not something to wave away.
 * - Non-finite input (`NaN`, `±Infinity`) yields `NaN`; it is never coerced to a plausible-looking
 *   angle, because a silently-plausible heading is worse than a visibly broken one.
 *
 * @param deg angle in degrees, any magnitude, any sign
 * @returns the equivalent angle in `[0, 360)`, or `NaN` if `deg` is not finite
 */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return Number.NaN;

  const remainder = deg % 360;
  if (remainder > 0) return remainder;
  // Collapses `-0` (which `%` propagates) to `+0`, so `Object.is` comparisons downstream hold.
  if (remainder === 0) return 0;

  const shifted = remainder + 360;
  // A remainder a hair below zero rounds up to exactly 360 when shifted; that is a full turn.
  return shifted < 360 ? shifted : 0;
}

/**
 * The signed shortest rotation from `from` to `to`, in degrees.
 *
 * This is what stops the compass needle taking the long way round: rotating from 350° to 10° is
 * a 20° nudge to the right, not a 340° sweep to the left.
 *
 * - Result is in `(-180, 180]`. **Positive means clockwise / turn right**, negative means
 *   counter-clockwise / turn left.
 * - Exactly opposite headings are reported as `+180`, never `-180` — the rotation is genuinely
 *   ambiguous there, so the tie is broken clockwise, consistently, so the needle cannot flip-flop
 *   between the two answers on sensor noise while the user is facing backwards.
 * - Inputs need not be normalised; `shortestAngleDelta(-10, 730)` is the same as
 *   `shortestAngleDelta(350, 10)`.
 * - Non-finite input yields `NaN`.
 *
 * @param from current angle in degrees
 * @param to target angle in degrees
 * @returns signed degrees to rotate, in `(-180, 180]`, or `NaN` if either input is not finite
 */
export function shortestAngleDelta(from: number, to: number): number {
  const forward = normalizeAngle(to - from);
  if (!Number.isFinite(forward)) return Number.NaN;
  return forward > 180 ? forward - 360 : forward;
}

/**
 * Whether the user is facing the Qibla closely enough to show the aligned state.
 *
 * `headingDelta` is the offset between the device heading and the Qibla bearing — normally
 * `shortestAngleDelta(heading, qiblaBearing)` — but any equivalent angle works, since the value
 * is wrapped to its shortest arc before being compared (so `359` counts as `-1`).
 *
 * - The comparison is **inclusive**: exactly `5°` off is aligned (PRODUCT_SPEC §9, "≤5°").
 * - A finite `toleranceDeg` is clamped to `[0, 180]`; a non-finite one falls back to
 *   {@link DEFAULT_ALIGNMENT_TOLERANCE_DEG}.
 * - A non-finite `headingDelta` is `false`: no heading means no alignment claim.
 *
 * Reminder for callers: alignment must never be signalled by colour alone — the design pairs
 * this boolean with an icon swap, a label change and the needle snap (docs/DESIGN.md §Qibla).
 *
 * @param headingDelta degrees between the device heading and the Qibla bearing, any sign
 * @param toleranceDeg half-width of the aligned window in degrees; defaults to 5
 */
export function isAligned(
  headingDelta: number,
  toleranceDeg: number = DEFAULT_ALIGNMENT_TOLERANCE_DEG
): boolean {
  const delta = shortestAngleDelta(0, headingDelta);
  if (!Number.isFinite(delta)) return false;
  const tolerance = Number.isFinite(toleranceDeg)
    ? Math.min(Math.max(toleranceDeg, 0), 180)
    : DEFAULT_ALIGNMENT_TOLERANCE_DEG;
  return Math.abs(delta) <= tolerance;
}

/**
 * i18n keys for the **8-point** compass rose, indexed clockwise from north:
 * `N, NE, E, SE, S, SW, W, NW`.
 *
 * 8-point rather than 16-point is a product decision, not an oversight: the design's bearing card
 * reads "58° NE" (docs/DESIGN.md §Qibla, PRODUCT_SPEC §9) — 58° is ENE on a 16-point rose. The
 * precise number is already on the card; the letters are there to orient, not to add precision.
 */
export const CARDINAL_KEYS = Object.freeze([
  'qibla.cardinal.n',
  'qibla.cardinal.ne',
  'qibla.cardinal.e',
  'qibla.cardinal.se',
  'qibla.cardinal.s',
  'qibla.cardinal.sw',
  'qibla.cardinal.w',
  'qibla.cardinal.nw',
] as const);

/** Fallback key for a bearing that could not be computed (no location fix, bad coordinates). */
export const UNKNOWN_CARDINAL_KEY = 'qibla.cardinal.unknown';

/**
 * The i18n key naming the 8-point compass sector a bearing falls in.
 *
 * Each sector is 45° wide and **centred** on its point, so north is `[337.5, 360) ∪ [0, 22.5)`
 * and north-east is `[22.5, 67.5)`. Boundaries round up (away from north): `22.5 → NE`.
 *
 * Returns an i18n KEY, never a letter — the compass rose is transliterated per language
 * (ARCHITECTURE "Conventions": no user-facing literals in the domain).
 *
 * @param bearing degrees clockwise from true north; normalised first, so any magnitude works
 * @returns one of {@link CARDINAL_KEYS}, or {@link UNKNOWN_CARDINAL_KEY} if `bearing` is not finite
 */
export function cardinalKey(bearing: number): string {
  const normalized = normalizeAngle(bearing);
  if (!Number.isFinite(normalized)) return UNKNOWN_CARDINAL_KEY;
  const index = Math.round(normalized / 45) % CARDINAL_KEYS.length;
  return CARDINAL_KEYS[index] ?? UNKNOWN_CARDINAL_KEY;
}

/**
 * Shortest-arc exponential low-pass filter for the raw heading stream.
 *
 * `watchHeadingAsync` emits a jittery value many times a second; feeding it straight to the
 * needle makes it shiver. This moves `previous` a `factor` fraction of the way towards `next`
 * **along the short arc**, so a 359° → 1° step is a 2° nudge rather than a 358° spin:
 * `smoothHeading(359, 1, 0.5) === 0`.
 *
 * Pick `factor` from the sample rate, not by feel: it is the fraction of the remaining error
 * removed per sample (~0.2 is responsive-but-calm at typical heading update rates). Then let
 * Reanimated animate towards the returned value — the two together are the "shortest-arc
 * interpolation + spring" the spec asks for (PRODUCT_SPEC §9).
 *
 * Guarantees:
 * - The result is always in `[0, 360)` (or `NaN`, see below) — it is safe to feed straight back
 *   in as the next call's `previous`, so the filter cannot drift out of range over time.
 * - `factor <= 0` holds `previous` exactly; `factor >= 1` snaps to `next` exactly (both
 *   normalised). Values in between are clamped to `[0, 1]`.
 * - When `previous` and `next` are exactly opposite the turn is clockwise, matching
 *   {@link shortestAngleDelta}'s `+180` tie-break.
 *
 * Sensor-stream guards:
 * - A non-finite `next` (dropped or invalid sample) **holds** `previous` — one bad reading must
 *   not poison the needle.
 * - A non-finite `previous` (cold start, before the first sample) **adopts** `next` outright, so
 *   the needle springs from the true heading rather than easing in from an arbitrary north.
 * - A non-finite `factor` is treated as `0` (hold).
 * - Only if `previous` and `next` are *both* non-finite is the result `NaN`.
 *
 * @param previous last smoothed heading in degrees (pass `NaN` on the first sample)
 * @param next newly measured heading in degrees
 * @param factor smoothing weight in `[0, 1]`: 0 holds, 1 snaps
 * @returns the smoothed heading in `[0, 360)`
 */
export function smoothHeading(previous: number, next: number, factor: number): number {
  const hasPrevious = Number.isFinite(previous);
  const hasNext = Number.isFinite(next);
  if (!hasNext) return hasPrevious ? normalizeAngle(previous) : Number.NaN;
  if (!hasPrevious) return normalizeAngle(next);

  const weight = Number.isFinite(factor) ? Math.min(Math.max(factor, 0), 1) : 0;
  // Short-circuit the endpoints so "holds exactly" / "snaps exactly" are float-exact promises,
  // not merely almost-true after `previous + 1 * delta`.
  if (weight === 0) return normalizeAngle(previous);
  if (weight === 1) return normalizeAngle(next);

  return normalizeAngle(previous + weight * shortestAngleDelta(previous, next));
}

// ---------------------------------------------------------------------------
// Great-circle math
// ---------------------------------------------------------------------------

/**
 * Initial great-circle bearing from `from` to `to`, in degrees clockwise from TRUE north.
 *
 * "Initial" matters: a great circle is not a constant-heading path, so this is the direction to
 * set off in, which is precisely what a Qibla compass shows. (The common "but the arrow points
 * north-east from New York" objection is answered by this being a sphere, not a Mercator map.)
 *
 *     θ = atan2( sin Δλ · cos φ₂ , cos φ₁ · sin φ₂ − sin φ₁ · cos φ₂ · cos Δλ )
 *
 * Degenerate cases return a finite number rather than `NaN`, so the UI always has something to
 * render:
 * - `from` exactly equal to `to` → `0` (there is no direction; north is the harmless answer, and
 *   at the Kaaba there is no Qibla to face anyway).
 * - `from` antipodal to `to` → some finite bearing; every direction is equally correct there.
 * - At the poles the bearing is measured against the pole's own meridian, per `atan2`.
 *
 * Non-finite or missing coordinates yield `NaN`. Latitudes are assumed to be valid degrees in
 * `[-90, 90]`; longitudes may be unnormalised (only `sin`/`cos` of the difference are used).
 *
 * @param from origin
 * @param to destination
 * @returns bearing in `[0, 360)`, or `NaN` for non-finite input
 */
export function initialBearing(from: Coordinates, to: Coordinates): number {
  if (!isFiniteCoordinate(from) || !isFiniteCoordinate(to)) return Number.NaN;

  const phi1 = toRadians(from.latitude);
  const phi2 = toRadians(to.latitude);
  const deltaLambda = toRadians(to.longitude - from.longitude);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return normalizeAngle(toDegrees(Math.atan2(y, x)));
}

/**
 * Great-circle (haversine) distance between two points, in kilometres, on a sphere of radius
 * {@link MEAN_EARTH_RADIUS_KM}.
 *
 * The haversine form is used rather than the spherical law of cosines because the latter loses
 * precision for small distances — and "0 km" at the Kaaba itself must be exactly 0, not the
 * square root of a rounding error.
 *
 * - Symmetric: `d(a, b) === d(b, a)`.
 * - `0` for identical points; `π · R ≈ 20015.09 km` for antipodal ones.
 * - Non-finite or missing coordinates yield `NaN`.
 *
 * @param from first point
 * @param to second point
 * @returns distance in kilometres, `>= 0`, or `NaN` for non-finite input
 */
export function greatCircleDistanceKm(from: Coordinates, to: Coordinates): number {
  if (!isFiniteCoordinate(from) || !isFiniteCoordinate(to)) return Number.NaN;

  const phi1 = toRadians(from.latitude);
  const phi2 = toRadians(to.latitude);
  const deltaPhi = phi2 - phi1;
  const deltaLambda = toRadians(to.longitude - from.longitude);

  const sinHalfPhi = Math.sin(deltaPhi / 2);
  const sinHalfLambda = Math.sin(deltaLambda / 2);
  const a =
    sinHalfPhi * sinHalfPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;

  // Clamp before `asin`: `a` can exceed 1 by an ulp for near-antipodal points, and `asin(1+ε)`
  // is `NaN`.
  return 2 * MEAN_EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The Qibla: the initial great-circle bearing from `from` to the {@link KAABA}, in degrees
 * clockwise from TRUE north, in `[0, 360)`.
 *
 * This is the number the Makkah badge is placed at on the dial, and the reference the needle's
 * offset is measured from. It is a property of the *location* only — it does not change through
 * the day, so compute it once per location fix, not once per heading sample.
 *
 * Verified equal to `adhan.Qibla()` to within 0.01° for any location more than a few hundred
 * kilometres from Makkah; the residual is the two libraries' differing Kaaba fixes, not the
 * formula (see {@link KAABA} and the cross-check in `qibla.test.ts`).
 *
 * Returns `0` at the Kaaba itself (never `NaN`), and `NaN` for non-finite coordinates.
 *
 * @param from the user's location
 * @see initialBearing for the formula and the degenerate cases
 */
export function qiblaBearing(from: Coordinates): number {
  return initialBearing(from, KAABA);
}

/**
 * Distance from `from` to the {@link KAABA} in kilometres — the "Distance · 10,303 km" info card.
 *
 * Haversine on a sphere of mean radius {@link MEAN_EARTH_RADIUS_KM}; see
 * {@link greatCircleDistanceKm} for the error model. Unrounded: formatting (thousands separator,
 * locale numerals, km/mi) belongs to the UI, not the domain.
 *
 * `0` at the Kaaba itself; `NaN` for non-finite coordinates.
 *
 * @param from the user's location
 */
export function distanceToKaabaKm(from: Coordinates): number {
  return greatCircleDistanceKm(from, KAABA);
}
