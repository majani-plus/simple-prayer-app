/**
 * Tests for the UI-thread needle's arithmetic.
 *
 * The component itself is a sensor subscription and nothing else — there is no output to assert on
 * a machine with no rotation vector. What decides how the dial behaves is {@link nextNeedleAngle},
 * which is deliberately a plain function so it can be tested here rather than on a phone.
 *
 * Four of these are product requirements, not implementation details:
 *
 * - the sign convention, because a compass that reads backwards is worse than none;
 * - that the reading survives the phone being held **upright**, which is how a person points a
 *   phone at something and the posture where the old yaw-based reading turned to noise;
 * - the short arc across the 0/360 seam, because the alternative is a dial that visibly unwinds
 *   the long way round (PRODUCT_SPEC §9);
 * - continuity across the hand-over from the JS-driven needle, because the owner would see a jump.
 *
 * Samples are built from real rotations rather than from numbers chosen to pass: a quaternion is
 * composed out of axis-angle turns, then put through the same axis shuffle Reanimated's Android
 * listener applies on the way out. So a test that says "upright, facing east" really does describe
 * a phone held upright facing east.
 */

import { nextNeedleAngle, type NeedleRotation } from '../NativeNeedleSource';

// ---------------------------------------------------------------------------
// Building a physical rotation
// ---------------------------------------------------------------------------

/** A rotation in Android's own `(x, y, z, w)` order, taking device coordinates to world ones. */
interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * World axes, as `getRotationMatrixFromVector` defines them: East, North, Up.
 *
 * Composed on the LEFT ({@link then}'s first argument) they turn the phone in the world. Composed
 * on the right they turn it about its own axes instead, where `[1, 0, 0]` is the device X axis
 * (the right-hand edge) and `[0, 0, 1]` is the screen normal — which is how the roll case below
 * is built.
 */
const EAST: [number, number, number] = [1, 0, 0];
const UP: [number, number, number] = [0, 0, 1];
/** The same numbers read as a device axis: straight out of the screen. */
const SCREEN_NORMAL = UP;

/** A right-handed turn of `degrees` about a unit `axis`. */
function turn(axis: [number, number, number], degrees: number): Quaternion {
  const half = (degrees * Math.PI) / 360;
  const s = Math.sin(half);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(half) };
}

/** `a` after `b` — the rotation matrix product `R(a)·R(b)`. */
function then(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** A phone lying flat, screen up, its top edge pointing `headingDeg` clockwise from north. */
function flat(headingDeg: number): Quaternion {
  return turn(UP, -headingDeg);
}

/** A phone held vertically, screen towards the reader, back camera pointing at `headingDeg`. */
function upright(headingDeg: number): Quaternion {
  return then(turn(UP, -headingDeg), turn(EAST, 90));
}

/**
 * One sample as the worklet receives it.
 *
 * Reanimated's Android listener reorders the axes to match iOS (`qx = x`, `qy = z`, `qz = -y`,
 * `qw = w`), so the shuffle is applied here too — otherwise these tests would be checking a
 * different function from the one that runs.
 */
function sample(q: Quaternion, interfaceOrientation = 0): NeedleRotation {
  return { qx: q.x, qy: q.z, qz: -q.y, qw: q.w, interfaceOrientation };
}

/**
 * What the needle used to read: Android's `getOrientation(R)[0]`, the azimuth of the device Y
 * axis, in degrees. Kept as the reference the flat cases are held against — flat, the old reading
 * and the new one must be the same number, because only the upright case was ever broken.
 */
function deviceYAxisAzimuth(q: Quaternion): number {
  const r01 = 2 * (q.x * q.y - q.w * q.z);
  const r11 = 1 - 2 * (q.x * q.x + q.z * q.z);
  return (Math.atan2(r01, r11) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------

describe('nextNeedleAngle', () => {
  it('reads a north-facing phone as 0', () => {
    expect(nextNeedleAngle(sample(flat(0)), 0, 0, 0)).toBeCloseTo(0, 6);
  });

  it('turns the same way the phone does', () => {
    // East is +90. A needle that went to -90 here would be a compass read backwards.
    expect(nextNeedleAngle(sample(flat(90)), 0, 0, 0)).toBeCloseTo(90, 6);
    // West is 270, which is -90 away — the short arc, from a needle sitting at 0.
    expect(nextNeedleAngle(sample(flat(270)), 0, 0, 0)).toBeCloseTo(-90, 6);
  });

  it('adds declination to reach true north', () => {
    expect(nextNeedleAngle(sample(flat(10)), 5, 0, 0)).toBeCloseTo(15, 6);
    expect(nextNeedleAngle(sample(flat(10)), -5, 0, 0)).toBeCloseTo(5, 6);
  });

  describe('the drift correction', () => {
    it('adds it on top of declination', () => {
      // The native module has already folded this into the "Turn N°" readout, the guidance and the
      // haptic. This stream reads the fused sensor itself, so it has to add the same number — a
      // needle that skipped it would sit exactly this far from the number printed beside it.
      expect(nextNeedleAngle(sample(flat(10)), 0, 12, 0)).toBeCloseTo(22, 6);
      expect(nextNeedleAngle(sample(flat(10)), 5, -12, 0)).toBeCloseTo(3, 6);
    });

    it('still takes the short arc when the correction crosses the seam', () => {
      // 355° corrected by +10° is 5°, which is 10° forwards and must not be 350° backwards.
      expect(nextNeedleAngle(sample(flat(355)), 0, 10, 355)).toBeCloseTo(365, 6);
    });
  });

  it('agrees with the device-Y azimuth it replaced, flat', () => {
    // Flat is the posture where the old reading was exact. The new one must not move it by so
    // much as a rounding error, or every existing report of "the compass is right" is invalidated.
    // A needle already sitting on the old reading must therefore not move at all.
    for (const heading of [0, 17, 90, 123.4, 180, 271.5, 359]) {
      const q = flat(heading);
      const reference = deviceYAxisAzimuth(q);
      expect(nextNeedleAngle(sample(q), 0, 0, reference)).toBeCloseTo(reference, 9);
    }
  });

  describe('held upright, where the old yaw went to noise', () => {
    it('reads the direction the back camera points, not the sky', () => {
      // Pitched a full 90°: the device Y axis is now vertical and its azimuth is meaningless.
      expect(nextNeedleAngle(sample(upright(0)), 0, 0, 0)).toBeCloseTo(0, 6);
      expect(nextNeedleAngle(sample(upright(90)), 0, 0, 0)).toBeCloseTo(90, 6);
    });

    it('does not care that the phone is rolled sideways', () => {
      // 30° of roll about the screen normal. The screen X axis swings out of horizontal but its
      // ground track does not turn, which is the whole reason this axis was chosen.
      const rolled = then(upright(0), turn(SCREEN_NORMAL, 30));
      expect(nextNeedleAngle(sample(rolled), 0, 0, 0)).toBeCloseTo(0, 6);
    });

    it('is measuring something the old reading no longer had', () => {
      // Documents the defect rather than the fix. The old azimuth was `atan2(r01, r11)`, the ground
      // track of the device Y axis — and upright that axis points at the sky, so both components
      // vanish. Whatever the old formula returned here came out of the last bit of a float.
      const q = upright(90);
      const r01 = 2 * (q.x * q.y - q.w * q.z);
      const r11 = 1 - 2 * (q.x * q.x + q.z * q.z);
      expect(Math.hypot(r01, r11)).toBeLessThan(1e-9);
    });
  });

  describe('the display rotation, applied here rather than by Reanimated', () => {
    it('measures against the top of the SCREEN in every rotation', () => {
      // Each of these is a phone lying flat with the INTERFACE's top edge pointing north, held at
      // a different display rotation. All four must read 0 (D124: the landscape glance dial).
      expect(nextNeedleAngle(sample(flat(0), 0), 0, 0, 0)).toBeCloseTo(0, 6);
      expect(nextNeedleAngle(sample(flat(-90), 90), 0, 0, 0)).toBeCloseTo(0, 6);
      expect(nextNeedleAngle(sample(flat(180), 180), 0, 0, 0)).toBeCloseTo(0, 6);
      expect(nextNeedleAngle(sample(flat(90), 270), 0, 0, 0)).toBeCloseTo(0, 6);
    });

    it('rotates the upside-down case instead of mirroring it', () => {
      // The bug this replaced: Reanimated negates the yaw for a 180° display rotation, so a screen
      // heading of 30 came back as 330. Reachable on a tablet or an opened foldable (D123).
      expect(nextNeedleAngle(sample(flat(210), 180), 0, 0, 0)).toBeCloseTo(30, 6);
    });

    it('treats an unknown rotation as no rotation rather than dropping the sample', () => {
      expect(nextNeedleAngle(sample(flat(45), 45), 0, 0, 0)).toBeCloseTo(45, 6);
    });
  });

  describe('the short arc', () => {
    it('crosses 359° → 1° forwards, not 358° backwards', () => {
      expect(nextNeedleAngle(sample(flat(1)), 0, 0, 359)).toBeCloseTo(361, 6);
    });

    it('crosses 1° → 359° backwards, not 358° forwards', () => {
      expect(nextNeedleAngle(sample(flat(359)), 0, 0, 1)).toBeCloseTo(-1, 6);
    });

    it('keeps accumulating past a full turn instead of wrapping', () => {
      // Three quarter-turns from 350°: the continuous angle must climb, never reset.
      let angle = 350;
      for (const heading of [20, 110, 200]) {
        angle = nextNeedleAngle(sample(flat(heading)), 0, 0, angle) as number;
      }
      expect(angle).toBeCloseTo(560, 6);
    });

    it('takes the half-turn either way at exactly 180°', () => {
      const next = nextNeedleAngle(sample(flat(180)), 0, 0, 0) as number;
      expect(Math.abs(next)).toBeCloseTo(180, 6);
    });
  });

  describe('the hand-over from the JS-driven needle', () => {
    it('continues from wherever the spring left the needle', () => {
      // The JS path unwraps too, so it can hand over an angle several turns from zero. The needle
      // must move by the short arc from THERE, not snap back into the first revolution.
      expect(nextNeedleAngle(sample(flat(10)), 0, 0, 730)).toBeCloseTo(730, 6);
      expect(nextNeedleAngle(sample(flat(350)), 0, 0, 730)).toBeCloseTo(710, 6);
    });
  });

  describe('refusing a sample rather than guessing', () => {
    it.each([NaN, Infinity, -Infinity])('drops a quaternion component of %p', (bad) => {
      expect(nextNeedleAngle({ ...sample(flat(10)), qx: bad }, 0, 0, 12)).toBeNull();
      expect(nextNeedleAngle({ ...sample(flat(10)), qy: bad }, 0, 0, 12)).toBeNull();
      expect(nextNeedleAngle({ ...sample(flat(10)), qz: bad }, 0, 0, 12)).toBeNull();
      expect(nextNeedleAngle({ ...sample(flat(10)), qw: bad }, 0, 0, 12)).toBeNull();
    });

    it('drops the all-zero quaternion Reanimated starts out holding', () => {
      // The mapper runs once on registration, before any sensor event. Aiming the needle off this
      // placeholder — and worse, raising `alive` — would stand the JS path down for nothing on a
      // device whose rotation vector never reports (D38).
      expect(
        nextNeedleAngle({ qx: 0, qy: 0, qz: 0, qw: 0, interfaceOrientation: 0 }, 0, 0, 12)
      ).toBeNull();
    });

    it('drops a sample whose declination is not a number', () => {
      expect(nextNeedleAngle(sample(flat(10)), NaN, 0, 0)).toBeNull();
    });

    it.each([NaN, Infinity, -Infinity])('drops a drift correction of %p', (bad) => {
      expect(nextNeedleAngle(sample(flat(10)), 0, bad, 0)).toBeNull();
    });

    it('drops a sample when the needle itself is not a number', () => {
      expect(nextNeedleAngle(sample(flat(10)), 0, 0, NaN)).toBeNull();
    });

    it('survives a sample arriving as undefined', () => {
      expect(nextNeedleAngle(undefined as unknown as NeedleRotation, 0, 0, 0)).toBeNull();
    });
  });
});
