/**
 * Tilt — how far the phone's screen is from horizontal, from the gravity vector alone.
 *
 * The compass heading itself never passes through this module. Both platforms hand the app an
 * OS-fused heading (`services/heading.ts`), and on iOS that heading is genuinely
 * tilt-compensated — but Android's is built from the raw accelerometer with no gyro help
 * (expo-location's `LocationModule.kt`), so its azimuth turns to noise as the phone approaches
 * vertical, and even iOS reads best lying flat. The Qibla screen therefore wants one honest
 * fact: *is this phone being held like a compass, or like a phone call?* — so it can offer a
 * gentle hint instead of letting a wandering needle take the blame.
 *
 * Everything here is pure math over accelerometer samples in g:
 *
 * - {@link tiltFromGravityDeg} — the angle between the screen plane and the horizontal, 0°
 *   (flat, either face) to 90° (upright). Uses `|z|`, so it is indifferent to face-up vs
 *   face-down.
 * - {@link faceDownFromGravityDeg} — the angle between the screen's normal and straight DOWN:
 *   0° with the screen facing the floor, 90° upright, 180° face-up. This one needs the sign of
 *   `z`, so the app carries one convention for it (face-up reads `z ≈ +1`; `services/tilt`'s
 *   adapter negates iOS, whose CoreMotion reports the opposite) — the "screen facing the floor"
 *   warning (D172) is the only consumer.
 * - {@link createGravityFilter} — an EMA over the raw vector with a magnitude guard: a sample
 *   that is not mostly gravity (a shake, a bump — the very noise that corrupts Android's
 *   heading) says nothing about tilt and is held out of the average.
 * - {@link createTiltGate} — the engage/release hysteresis, so the hint cannot chatter on the
 *   threshold. Time-based sustain lives in `hooks/useTilt`, which owns the clock.
 * - {@link createFaceDownGate} — the same hysteresis for the face-down warning, measured from
 *   the floor instead of from the horizontal.
 *
 * Pure TypeScript: no React, no Expo, no clock reads. Exhaustively tested in `tilt.test.ts`.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * The tilt at which the "hold it flatter" hint engages, in degrees from horizontal.
 *
 * 55° is "held like a phone call, not a compass": iOS's fused heading is genuinely fine at
 * moderate tilt and Android's error grows steeply only past ~60°, so normal in-hand angles —
 * the 20–40° everyone actually reads a phone at — are never policed. The hint is for the
 * posture that really does break the needle.
 */
export const DEFAULT_TILT_ENGAGE_DEG = 55;

/**
 * The tilt below which the hint releases, in degrees from horizontal.
 *
 * A 10° band under {@link DEFAULT_TILT_ENGAGE_DEG} — far wider than the filtered signal's
 * residual wobble, so a hand hovering at the threshold sees one calm transition, not a
 * flicker.
 */
export const DEFAULT_TILT_RELEASE_DEG = 45;

/**
 * Default EMA weight for {@link createGravityFilter}: the fraction of the remaining error
 * removed per sample. At the ~5 Hz the tilt sensor runs (`services/tilt.ts`), 0.3 settles ~90%
 * of a posture change within about a second and a half — the hint reads a *posture*, which
 * changes at human speed, so calm beats instant.
 */
export const DEFAULT_GRAVITY_SMOOTHING = 0.3;

/**
 * The angle from straight down at or under which the "screen facing the floor" warning
 * engages (D172).
 *
 * A screen that faces the floor looks at the horizontal plane from below, so no dial drawn on
 * it can be right on both axes at once: the needle still turns the correct way (left/right),
 * but the rose's north–south sense is mirrored. The owner asked for a warning rather than a
 * mirrored dial. 45° is "clearly facing the floor" — the phone rolled over, or held above a
 * lying-down reader — and leaves the phone tilted back past vertical on a couch alone.
 */
export const DEFAULT_FACE_DOWN_ENGAGE_DEG = 45;

/**
 * The angle from straight down above which the face-down warning releases. A 15° band over
 * {@link DEFAULT_FACE_DOWN_ENGAGE_DEG}, for the same calm as the tilt hint's.
 */
export const DEFAULT_FACE_DOWN_RELEASE_DEG = 60;

/**
 * Magnitude band, in g, inside which an accelerometer sample is treated as gravity.
 *
 * Outside it the phone is being shaken, dropped or swung — linear acceleration is drowning the
 * gravity vector, and folding such a sample into the average would tilt the estimate with
 * motion that has nothing to do with posture. The filter holds its last answer instead.
 */
export const GRAVITY_MIN_G = 0.5;
export const GRAVITY_MAX_G = 1.5;

// ---------------------------------------------------------------------------
// Tilt from gravity
// ---------------------------------------------------------------------------

/**
 * The screen plane's angle from horizontal, in degrees.
 *
 * With the phone flat on a table the gravity vector is all z and the answer is 0° — face-up or
 * face-down, because only `|z|` enters. Upright (any edge leading) the vector lies in the
 * screen plane, z ≈ 0, and the answer is 90°. In between it is the honest angle, independent
 * of the phone's compass direction and of the portrait lock.
 *
 * @param x - Acceleration along the device X axis, in g.
 * @param y - Acceleration along the device Y axis, in g.
 * @param z - Acceleration along the device Z axis, in g.
 * @returns Tilt in `[0, 90]` degrees, or `NaN` when the inputs are not finite or the vector
 *   has no length (free fall) — callers hold their last value rather than guess.
 */
export function tiltFromGravityDeg(x: number, y: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return Number.NaN;
  const norm = Math.sqrt(x * x + y * y + z * z);
  if (norm === 0) return Number.NaN;
  const cosine = Math.min(1, Math.max(0, Math.abs(z) / norm));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * The angle between the screen's outward normal and straight down, in degrees.
 *
 * Uses the app's one sign convention — a face-up phone on a table reads `z ≈ +1` — so the
 * answer is 180° face-up, 90° upright (any edge leading) and 0° with the screen facing the
 * floor. Unlike {@link tiltFromGravityDeg} this cannot be sign-blind: the whole point is which
 * face is up.
 *
 * @param x - Acceleration along the device X axis, in g.
 * @param y - Acceleration along the device Y axis, in g.
 * @param z - Acceleration along the device Z axis, in g, face-up positive.
 * @returns Degrees in `[0, 180]`, or `NaN` when the inputs are not finite or the vector has no
 *   length — callers hold their last value rather than guess.
 */
export function faceDownFromGravityDeg(x: number, y: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return Number.NaN;
  const norm = Math.sqrt(x * x + y * y + z * z);
  if (norm === 0) return Number.NaN;
  const cosine = Math.min(1, Math.max(-1, -z / norm));
  return (Math.acos(cosine) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Gravity filter
// ---------------------------------------------------------------------------

/** A low-pass gravity estimate that ignores samples which are not mostly gravity. */
export interface GravityFilter {
  /** The current tilt estimate in `[0, 90]` degrees, or `NaN` before the first usable sample. */
  readonly tilt: number;
  /**
   * The current angle from straight down in `[0, 180]` degrees (see
   * {@link faceDownFromGravityDeg}), or `NaN` before the first usable sample.
   */
  readonly faceDown: number;
  /**
   * Folds one accelerometer sample (in g) into the estimate and returns the updated tilt.
   * Samples outside the {@link GRAVITY_MIN_G}–{@link GRAVITY_MAX_G} magnitude band, and
   * non-finite ones, leave the estimate untouched.
   */
  push(x: number, y: number, z: number): number;
  /** Forgets everything, as if freshly created. */
  reset(): void;
}

/**
 * Builds a {@link GravityFilter}.
 *
 * The EMA runs over the raw vector *components* — not over the tilt angle — so two samples on
 * opposite sides of vertical average to the honest in-between posture instead of whipping the
 * angle through its extremes.
 *
 * @param factor - EMA weight in `(0, 1]`; `1` adopts every sample outright. Non-finite or
 *   out-of-range values fall back to {@link DEFAULT_GRAVITY_SMOOTHING}.
 * @returns A filter; one per subscription, not thread-safe.
 */
export function createGravityFilter(factor: number = DEFAULT_GRAVITY_SMOOTHING): GravityFilter {
  const weight = Number.isFinite(factor) && factor > 0 && factor <= 1 ? factor : DEFAULT_GRAVITY_SMOOTHING;

  let hasEstimate = false;
  let gx = 0;
  let gy = 0;
  let gz = 0;

  const tiltOf = (): number => (hasEstimate ? tiltFromGravityDeg(gx, gy, gz) : Number.NaN);
  const faceDownOf = (): number =>
    hasEstimate ? faceDownFromGravityDeg(gx, gy, gz) : Number.NaN;

  return {
    get tilt() {
      return tiltOf();
    },
    get faceDown() {
      return faceDownOf();
    },
    push(x, y, z) {
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude >= GRAVITY_MIN_G && magnitude <= GRAVITY_MAX_G) {
          if (hasEstimate) {
            gx += (x - gx) * weight;
            gy += (y - gy) * weight;
            gz += (z - gz) * weight;
          } else {
            hasEstimate = true;
            gx = x;
            gy = y;
            gz = z;
          }
        }
      }
      return tiltOf();
    },
    reset() {
      hasEstimate = false;
      gx = 0;
      gy = 0;
      gz = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Hysteresis gate
// ---------------------------------------------------------------------------

/** Options for {@link createTiltGate}. Both default to the production thresholds. */
export interface TiltGateOptions {
  /** Tilt at or above which the gate turns on. */
  engageDeg?: number;
  /** Tilt below which the gate turns off. Must sit under `engageDeg`. */
  releaseDeg?: number;
}

/** A two-threshold gate over the tilt angle: on past engage, off under release. */
export interface TiltGate {
  /** Whether the gate is currently engaged. */
  readonly engaged: boolean;
  /** Feeds one tilt reading (degrees) and returns the gate's new state. `NaN` holds it. */
  push(tiltDeg: number): boolean;
  /** Back to disengaged, as if freshly created. */
  reset(): void;
}

/**
 * Builds a {@link TiltGate}.
 *
 * The same anti-chatter shape as the alignment band (D86): a state may only flip by crossing
 * the *far* threshold for the direction it is moving, so a reading resting exactly on either
 * line cannot oscillate. `NaN` (no estimate yet, or free fall) holds the current state — the
 * gate never guesses.
 *
 * @param options - See {@link TiltGateOptions}. Invalid or inverted thresholds fall back to
 *   the defaults.
 * @returns A gate; one per subscription, not thread-safe.
 */
export function createTiltGate(options: TiltGateOptions = {}): TiltGate {
  let engage = options.engageDeg ?? DEFAULT_TILT_ENGAGE_DEG;
  let release = options.releaseDeg ?? DEFAULT_TILT_RELEASE_DEG;
  if (!Number.isFinite(engage) || !Number.isFinite(release) || release >= engage) {
    engage = DEFAULT_TILT_ENGAGE_DEG;
    release = DEFAULT_TILT_RELEASE_DEG;
  }

  let engaged = false;

  return {
    get engaged() {
      return engaged;
    },
    push(tiltDeg) {
      if (Number.isFinite(tiltDeg)) {
        if (engaged) {
          if (tiltDeg < release) engaged = false;
        } else if (tiltDeg >= engage) {
          engaged = true;
        }
      }
      return engaged;
    },
    reset() {
      engaged = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Face-down gate
// ---------------------------------------------------------------------------

/** Options for {@link createFaceDownGate}. Both default to the production thresholds. */
export interface FaceDownGateOptions {
  /** Angle from straight down at or under which the gate turns on. */
  engageDeg?: number;
  /** Angle from straight down above which the gate turns off. Must sit over `engageDeg`. */
  releaseDeg?: number;
}

/**
 * Builds a {@link TiltGate} over the angle from straight down: on at or under engage, off past
 * release. The mirror image of {@link createTiltGate} — a small angle here means the screen
 * faces the floor — with the same anti-chatter rule: a state flips only by crossing the far
 * threshold for its direction, and `NaN` holds it.
 *
 * @param options - See {@link FaceDownGateOptions}. Invalid or inverted thresholds fall back
 *   to the defaults.
 * @returns A gate; one per subscription, not thread-safe.
 */
export function createFaceDownGate(options: FaceDownGateOptions = {}): TiltGate {
  let engage = options.engageDeg ?? DEFAULT_FACE_DOWN_ENGAGE_DEG;
  let release = options.releaseDeg ?? DEFAULT_FACE_DOWN_RELEASE_DEG;
  if (!Number.isFinite(engage) || !Number.isFinite(release) || release <= engage) {
    engage = DEFAULT_FACE_DOWN_ENGAGE_DEG;
    release = DEFAULT_FACE_DOWN_RELEASE_DEG;
  }

  let engaged = false;

  return {
    get engaged() {
      return engaged;
    },
    push(faceDownDeg) {
      if (Number.isFinite(faceDownDeg)) {
        if (engaged) {
          if (faceDownDeg > release) engaged = false;
        } else if (faceDownDeg <= engage) {
          engaged = true;
        }
      }
      return engaged;
    },
    reset() {
      engaged = false;
    },
  };
}
