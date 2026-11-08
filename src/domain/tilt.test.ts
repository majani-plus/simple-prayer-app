/**
 * Tests for `domain/tilt` — the pure math under the Qibla screen's "hold it flatter" hint.
 */

import {
  DEFAULT_FACE_DOWN_ENGAGE_DEG,
  DEFAULT_FACE_DOWN_RELEASE_DEG,
  DEFAULT_TILT_ENGAGE_DEG,
  DEFAULT_TILT_RELEASE_DEG,
  GRAVITY_MAX_G,
  GRAVITY_MIN_G,
  createFaceDownGate,
  createGravityFilter,
  createTiltGate,
  faceDownFromGravityDeg,
  tiltFromGravityDeg,
} from './tilt';

// ---------------------------------------------------------------------------
// tiltFromGravityDeg
// ---------------------------------------------------------------------------

describe('tiltFromGravityDeg', () => {
  it('reads 0° flat on a table, whichever face is up (both z-sign conventions)', () => {
    // iOS reports face-up z ≈ -1, Android ≈ +1; |z| makes both read flat.
    expect(tiltFromGravityDeg(0, 0, 1)).toBeCloseTo(0, 10);
    expect(tiltFromGravityDeg(0, 0, -1)).toBeCloseTo(0, 10);
  });

  it('reads 90° upright, whichever edge leads', () => {
    expect(tiltFromGravityDeg(0, 1, 0)).toBeCloseTo(90, 10);
    expect(tiltFromGravityDeg(0, -1, 0)).toBeCloseTo(90, 10);
    expect(tiltFromGravityDeg(1, 0, 0)).toBeCloseTo(90, 10);
    expect(tiltFromGravityDeg(-1, 0, 0)).toBeCloseTo(90, 10);
  });

  it('reads the honest in-between angle', () => {
    // 45°: gravity split evenly between the screen normal and the screen plane.
    expect(tiltFromGravityDeg(0, Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(45, 10);
    // 60°: cos(60°) = 1/2 of gravity along the normal.
    expect(tiltFromGravityDeg(0, Math.sqrt(3) / 2, 0.5)).toBeCloseTo(60, 10);
  });

  it('does not care about the vector’s length, only its direction', () => {
    expect(tiltFromGravityDeg(0, 0.3, 0.3)).toBeCloseTo(45, 10);
    expect(tiltFromGravityDeg(0, 3, 3)).toBeCloseTo(45, 10);
  });

  it('answers NaN for free fall and for non-finite input, never a made-up angle', () => {
    expect(tiltFromGravityDeg(0, 0, 0)).toBeNaN();
    expect(tiltFromGravityDeg(Number.NaN, 0, 1)).toBeNaN();
    expect(tiltFromGravityDeg(0, Number.POSITIVE_INFINITY, 1)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// createGravityFilter
// ---------------------------------------------------------------------------

describe('createGravityFilter', () => {
  it('has no opinion before the first sample', () => {
    expect(createGravityFilter().tilt).toBeNaN();
  });

  it('adopts the first usable sample outright', () => {
    const filter = createGravityFilter(0.3);
    expect(filter.push(0, 1, 0)).toBeCloseTo(90, 10);
  });

  it('eases towards a new posture instead of jumping', () => {
    const filter = createGravityFilter(0.3);
    filter.push(0, 0, 1); // flat
    const first = filter.push(0, 1, 0); // snapped upright
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(90);
    for (let i = 0; i < 20; i += 1) filter.push(0, 1, 0);
    expect(filter.tilt).toBeGreaterThan(85);
  });

  it('holds its answer through a shake (magnitude outside the gravity band)', () => {
    const filter = createGravityFilter(0.3);
    filter.push(0, 0, 1);
    // A swing: 3 g along Y would read as upright if it were believed.
    expect(filter.push(0, 3, 0)).toBeCloseTo(0, 10);
    // Free-fall-ish: nearly no force at all.
    expect(filter.push(0, 0.1, 0.1)).toBeCloseTo(0, 10);
    expect(filter.tilt).toBeCloseTo(0, 10);
  });

  it('accepts the whole plausible-gravity band and nothing outside it', () => {
    const filter = createGravityFilter(1);
    filter.push(0, 0, GRAVITY_MIN_G);
    expect(filter.tilt).toBeCloseTo(0, 10);
    filter.push(0, GRAVITY_MAX_G, 0);
    expect(filter.tilt).toBeCloseTo(90, 10);
    filter.push(0, 0, GRAVITY_MAX_G * 1.01);
    expect(filter.tilt).toBeCloseTo(90, 10);
  });

  it('ignores non-finite samples', () => {
    const filter = createGravityFilter(1);
    filter.push(0, 0, 1);
    expect(filter.push(Number.NaN, 0, 1)).toBeCloseTo(0, 10);
  });

  it('averages the vector, not the angle, across vertical', () => {
    const filter = createGravityFilter(0.5);
    filter.push(0, 1, 0.02); // just past vertical one way (~89°)
    filter.push(0, 1, -0.02); // just past the other (~89°)
    // Angle-averaging traps live here; the vector average stays honestly near 90°.
    expect(filter.tilt).toBeGreaterThan(85);
  });

  it('falls back to the default weight on nonsense factors', () => {
    for (const factor of [0, -1, 2, Number.NaN]) {
      const filter = createGravityFilter(factor);
      filter.push(0, 0, 1);
      filter.push(0, 1, 0);
      // A working EMA has moved off 0° but not adopted 90° outright.
      expect(filter.tilt).toBeGreaterThan(0);
      expect(filter.tilt).toBeLessThan(90);
    }
  });

  it('reset() forgets the estimate', () => {
    const filter = createGravityFilter();
    filter.push(0, 0, 1);
    filter.reset();
    expect(filter.tilt).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// createTiltGate
// ---------------------------------------------------------------------------

describe('createTiltGate', () => {
  it('starts disengaged and stays put below the engage line', () => {
    const gate = createTiltGate();
    expect(gate.engaged).toBe(false);
    expect(gate.push(DEFAULT_TILT_ENGAGE_DEG - 1)).toBe(false);
  });

  it('engages at the line, inclusively', () => {
    const gate = createTiltGate();
    expect(gate.push(DEFAULT_TILT_ENGAGE_DEG)).toBe(true);
  });

  it('holds through the whole hysteresis band and releases under the release line', () => {
    const gate = createTiltGate();
    gate.push(DEFAULT_TILT_ENGAGE_DEG);
    // Anywhere in [release, engage) keeps the current state.
    expect(gate.push(DEFAULT_TILT_RELEASE_DEG)).toBe(true);
    expect(gate.push(DEFAULT_TILT_ENGAGE_DEG - 1)).toBe(true);
    expect(gate.push(DEFAULT_TILT_RELEASE_DEG - 1)).toBe(false);
    // And coming back up inside the band does not re-engage.
    expect(gate.push(DEFAULT_TILT_ENGAGE_DEG - 1)).toBe(false);
  });

  it('a reading resting exactly on either line cannot chatter', () => {
    const gate = createTiltGate();
    for (let i = 0; i < 5; i += 1) expect(gate.push(DEFAULT_TILT_RELEASE_DEG)).toBe(false);
    gate.push(DEFAULT_TILT_ENGAGE_DEG);
    for (let i = 0; i < 5; i += 1) expect(gate.push(DEFAULT_TILT_ENGAGE_DEG)).toBe(true);
  });

  it('NaN holds the current state instead of guessing', () => {
    const gate = createTiltGate();
    expect(gate.push(Number.NaN)).toBe(false);
    gate.push(90);
    expect(gate.push(Number.NaN)).toBe(true);
  });

  it('rejects inverted or non-finite thresholds and runs on the defaults', () => {
    for (const options of [
      { engageDeg: 30, releaseDeg: 40 },
      { engageDeg: Number.NaN },
      { releaseDeg: Number.POSITIVE_INFINITY },
    ]) {
      const gate = createTiltGate(options);
      expect(gate.push(DEFAULT_TILT_ENGAGE_DEG - 1)).toBe(false);
      expect(gate.push(DEFAULT_TILT_ENGAGE_DEG)).toBe(true);
      expect(gate.push(DEFAULT_TILT_RELEASE_DEG - 1)).toBe(false);
    }
  });

  it('reset() disengages', () => {
    const gate = createTiltGate();
    gate.push(90);
    gate.reset();
    expect(gate.engaged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// faceDownFromGravityDeg (D172)
// ---------------------------------------------------------------------------

describe('faceDownFromGravityDeg', () => {
  it('reads 180° face-up on a table and 0° with the screen on the floor (app sign: face-up z > 0)', () => {
    expect(faceDownFromGravityDeg(0, 0, 1)).toBeCloseTo(180, 10);
    expect(faceDownFromGravityDeg(0, 0, -1)).toBeCloseTo(0, 10);
  });

  it('reads 90° upright, whichever edge leads', () => {
    expect(faceDownFromGravityDeg(0, 1, 0)).toBeCloseTo(90, 10);
    expect(faceDownFromGravityDeg(0, -1, 0)).toBeCloseTo(90, 10);
    expect(faceDownFromGravityDeg(1, 0, 0)).toBeCloseTo(90, 10);
  });

  it('reads the honest angle past vertical', () => {
    // 45° from the floor: the phone rolled three-quarters of the way over.
    expect(faceDownFromGravityDeg(0, Math.SQRT1_2, -Math.SQRT1_2)).toBeCloseTo(45, 10);
    // 60° from the floor: tilted 30° past vertical, a couch reader.
    expect(faceDownFromGravityDeg(0, Math.sqrt(3) / 2, -0.5)).toBeCloseTo(60, 10);
    // 135° from the floor: a normal 45° reading angle, face-up.
    expect(faceDownFromGravityDeg(0, Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(135, 10);
  });

  it('does not care about the vector’s length, only its direction', () => {
    expect(faceDownFromGravityDeg(0, 0, -9.81)).toBeCloseTo(0, 10);
    expect(faceDownFromGravityDeg(0, 0, 0.2)).toBeCloseTo(180, 10);
  });

  it('answers NaN for non-finite input and for free fall', () => {
    expect(faceDownFromGravityDeg(Number.NaN, 0, 1)).toBeNaN();
    expect(faceDownFromGravityDeg(0, Number.POSITIVE_INFINITY, 1)).toBeNaN();
    expect(faceDownFromGravityDeg(0, 0, 0)).toBeNaN();
  });
});

describe('createGravityFilter faceDown', () => {
  it('is NaN before the first usable sample, then follows the filtered vector', () => {
    const filter = createGravityFilter(1);
    expect(filter.faceDown).toBeNaN();
    filter.push(0, 0, -1);
    expect(filter.faceDown).toBeCloseTo(0, 10);
    filter.push(0, 0, 1);
    expect(filter.faceDown).toBeCloseTo(180, 10);
    filter.reset();
    expect(filter.faceDown).toBeNaN();
  });

  it('holds its answer through a shake, like tilt does', () => {
    const filter = createGravityFilter(1);
    filter.push(0, 0, -1);
    filter.push(0, 3, 0); // 3 g: not gravity
    expect(filter.faceDown).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// createFaceDownGate
// ---------------------------------------------------------------------------

describe('createFaceDownGate', () => {
  it('ships the production thresholds: engage at or under 45°, release past 60°', () => {
    expect(DEFAULT_FACE_DOWN_ENGAGE_DEG).toBe(45);
    expect(DEFAULT_FACE_DOWN_RELEASE_DEG).toBe(60);
    expect(DEFAULT_FACE_DOWN_ENGAGE_DEG).toBeLessThan(DEFAULT_FACE_DOWN_RELEASE_DEG);
  });

  it('starts off, engages at the engage line, and stays on until past the release line', () => {
    const gate = createFaceDownGate();
    expect(gate.engaged).toBe(false);
    expect(gate.push(90)).toBe(false); // upright
    expect(gate.push(DEFAULT_FACE_DOWN_ENGAGE_DEG + 1)).toBe(false);
    expect(gate.push(DEFAULT_FACE_DOWN_ENGAGE_DEG)).toBe(true);
    expect(gate.push(DEFAULT_FACE_DOWN_RELEASE_DEG)).toBe(true); // resting on the line holds
    expect(gate.push(DEFAULT_FACE_DOWN_RELEASE_DEG + 1)).toBe(false);
  });

  it('a face-up phone never engages, however it is tilted', () => {
    const gate = createFaceDownGate();
    for (const deg of [180, 150, 135, 120, 95]) expect(gate.push(deg)).toBe(false);
  });

  it('NaN holds the current state in both directions', () => {
    const gate = createFaceDownGate();
    expect(gate.push(Number.NaN)).toBe(false);
    gate.push(0);
    expect(gate.push(Number.NaN)).toBe(true);
  });

  it('falls back to the defaults on inverted or non-finite thresholds', () => {
    const inverted = createFaceDownGate({ engageDeg: 70, releaseDeg: 50 });
    expect(inverted.push(50)).toBe(false); // 50 > 45: the defaults are in force
    expect(inverted.push(45)).toBe(true);
    const bad = createFaceDownGate({ engageDeg: Number.NaN });
    expect(bad.push(46)).toBe(false);
    expect(bad.push(45)).toBe(true);
  });

  it('reset returns it to off', () => {
    const gate = createFaceDownGate();
    gate.push(0);
    gate.reset();
    expect(gate.engaged).toBe(false);
  });
});
