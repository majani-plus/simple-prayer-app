import { SensorType, useAnimatedReaction, useAnimatedSensor } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

/**
 * Drives the Qibla needle from the rotation vector **on the UI thread**. Renders nothing.
 *
 * ## Why this exists
 *
 * D144 fixed the *sensor* rate (5 Hz → 50 Hz) and the needle still did not feel real time. The
 * sensor was never the last bottleneck: the needle was, because every sample reached it by way of
 * the JS thread. The old path crossed three threads per sample —
 *
 * ```
 * sensor (main thread) → sendEvent → JS thread → sharedHeading.set(withSpring(…)) → UI thread
 * ```
 *
 * — and did real JS work on each one (a cleared and re-armed stale timer, the smoother, a throttle
 * check, a serialised spring config). So the needle's update rate was whatever the JS thread could
 * service, not what the sensor produced, and it moved with whatever jitter the JS thread's
 * scheduling had that moment. On top of that `HEADING_SPRING` is a second-order filter with
 * **exactly 100 ms** of steady-state lag by construction (ωn 17.32, ζ 0.866 → 2ζ/ωn = 0.1 s), which
 * was invisible when samples arrived every 200 ms and dominant once they arrived every 20 ms.
 *
 * `useAnimatedSensor` removes all of it. Reanimated reads `TYPE_ROTATION_VECTOR` — the same sensor
 * `modules/qibla-heading` reads — and its registered callback is a **worklet**: it writes straight
 * into a shared value from C++, on the UI thread, with the JS thread never involved. The reaction
 * below runs there too. Nothing about the needle now depends on JS-thread scheduling, and no
 * animation stands between the sensor and the dial: the needle simply *is* the phone's orientation,
 * a frame later.
 *
 * It also sidesteps the `expo-sensors` cap D144 documented, and for a different reason worth
 * knowing: Reanimated passes `interval * 1000` **microseconds** to `registerListener`
 * (`ReanimatedSensor.kt`) rather than one of the four `SENSOR_DELAY_*` constants, so the rate is
 * ours to name and no `HIGH_SAMPLING_RATE_SENSORS` question arises.
 *
 * ## Why it is a component and not a hook call inside `useHeading`
 *
 * `useAnimatedSensor` registers on mount and unregisters on unmount, with no enabled flag. Mounting
 * *is* the gate — and the gate matters, because react-navigation keeps the Qibla tab mounted once
 * visited, so a hook called unconditionally would leave the rotation vector running for the rest of
 * the session. `useHeading` hands back its `nativeNeedle` object only while the sensor should run,
 * and hands back `null` otherwise; rendering this against that is what starts and stops the sensor.
 *
 * iOS never mounts it. `CLHeading` is fast, and the existing spring-driven path is the behaviour the
 * owner calls perfect — see `useHeading`.
 */

/** Everything this needs, assembled by `useHeading` so no screen has to know the mechanism. */
export interface NativeNeedleHandle {
  /**
   * The dial's rotation, in **continuous** degrees — it accumulates past 360 and below 0 so the
   * needle never unwinds the long way round the seam. Written here, read by `CompassDial`.
   */
  heading: SharedValue<number>;
  /** Degrees to add to a magnetic reading to make it a true one. `0` until a location is known. */
  declination: SharedValue<number>;
  /**
   * Degrees to add on top, to anchor a drifted gyro fusion onto the magnetometer-only reference.
   * `0` whenever nothing is being corrected, which is most of the time.
   *
   * `modules/qibla-heading` measures this, ramps it, and has already folded it into the heading it
   * emits — so the readout, the guidance and the haptic carry it without knowing. This stream does
   * not go through that module: it reads the same fused sensor itself, on the UI thread, so the
   * correction has to be handed across and added here or the needle would sit exactly this far from
   * the number printed beside it. See the Kotlin module for how it is measured.
   */
  offset: SharedValue<number>;
  /**
   * `1` once the UI-thread stream has produced a sample, `0` before that.
   *
   * `useHeading` reads it to decide whether to keep driving the needle from JS. A device whose
   * rotation vector never reports leaves this at `0` and simply keeps the old path — the same
   * "the data decides" rule `services/nativeCompass` follows (D38: no device may regress).
   */
  alive: SharedValue<number>;
}

/**
 * Requested delivery interval, in milliseconds.
 *
 * **Not** one frame at 60 Hz, which is what this used to ask for. Two reasons it is 8:
 *
 * - the owner's phone has a 120 Hz panel, so 16 ms advanced the needle every second or third frame
 *   and read as fine stepping rather than motion;
 * - Reanimated's Android listener throttles on the **wall clock**
 *   (`ReanimatedSensorListener.kt`: `if (current - lastRead < interval) return`), so a sample that
 *   lands at 15.8 ms is simply dropped and the effective rate oscillates between about 31 and
 *   62 Hz — uneven, which is more visible than slow.
 *
 * 8 ms is Reanimated's own default (`ReanimatedSensor.kt`, `DEFAULT_INTERVAL`), 125 Hz requested,
 * well under the 200 Hz ceiling `HIGH_SAMPLING_RATE_SENSORS` exists to lift. The gyroscope is
 * already spinning for the fusion, so the extra cost is small and lasts only while the tab is open.
 */
export const NEEDLE_INTERVAL_MS = 8;

/** Radians → degrees. */
const DEG_PER_RAD = 180 / Math.PI;

/**
 * Below this squared norm a quaternion is not a rotation at all.
 *
 * Reanimated seeds its rotation shared value with `{ qw: 0, qx: 0, qy: 0, qz: 0 }` before the
 * sensor has spoken, and the mapper runs once on registration — so without this the needle would
 * be aimed, and {@link NativeNeedleHandle.alive} raised, off a placeholder. On a device whose
 * rotation vector never reports that would stand the JS path down for nothing (D38).
 */
const MIN_QUATERNION_NORM_SQ = 1e-6;

/**
 * The parts of Reanimated's rotation sample this needs — `sensor.sensor.get()` satisfies it.
 *
 * Android only. iOS never mounts this component, and its quaternion is in Core Motion's frame.
 */
export interface NeedleRotation {
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Reanimated's `InterfaceOrientation`: the display rotation in degrees — 0, 90, 180 or 270. */
  interfaceOrientation: number;
}

/**
 * Where the needle should sit after one sensor sample.
 *
 * Marked `'worklet'` so it can be called from the UI thread, but it is a plain function with no
 * shared values in it — which is the point: the arithmetic that decides the whole feel of the dial
 * is unit-testable rather than trapped behind a sensor.
 *
 * ## Why the SCREEN X axis, and not the yaw
 *
 * Reanimated hands over a yaw, and this used to use it. A yaw — Android's
 * `SensorManager.getOrientation(R)[0]`, which is `atan2(R[1], R[4])` — is the azimuth of the
 * **device Y axis**, the line running up the phone from chin to earpiece. Held flat that axis lies
 * along the ground and its azimuth is exactly the heading. Held **upright**, the way a person
 * actually points a phone at something, it points at the sky: its horizontal projection collapses
 * towards zero and the azimuth becomes noise divided by noise. The rotation vector is a correct
 * gyro-fused attitude at any tilt, so the matrix was never the problem; the axis was.
 *
 * The **screen X axis** — the right-hand edge of the interface as drawn — has no such posture. It
 * stays horizontal whether the phone is flat, at 45 degrees, or straight up, and it only degenerates
 * past about 90 degrees of sideways roll, which is nobody's idea of holding a compass. Its azimuth
 * minus 90 degrees is the direction the user is facing: flat, that is bit-for-bit the old yaw;
 * upright, it is where the back camera points, which is the answer the dial should have been giving
 * all along.
 *
 * ## Why this reads the quaternion rather than the yaw
 *
 * The screen X axis is column 0 of the device→world rotation matrix, so the matrix has to be
 * rebuilt here from the quaternion Reanimated ships. Two conversions on the way:
 *
 * - Reanimated shuffles Android's axes to match iOS (`ReanimatedSensorListener.kt` emits
 *   `qx = x`, `qy = z`, `qz = -y`, `qw = w` out of `getQuaternionFromVector`'s `[w, x, y, z]`), so
 *   that is undone first.
 * - The display rotation is applied here too, which is why the component asks for
 *   `adjustToInterfaceOrientation: false`. Reanimated's own adjustment recomputes the quaternion
 *   from Euler angles and, for a 180 degree display rotation, **negates** the yaw — a mirror about
 *   north, not a half turn, so a heading of 30 came out as 330 instead of 210. Unreachable on a
 *   phone (the manifest locks portrait) but reachable on a tablet or an opened foldable, where
 *   D123 unlocks all four rotations.
 *
 * @param rotation - One sample; see {@link NeedleRotation}.
 * @param declinationDeg - Added to the magnetic reading to make it a true one; `0` when unknown.
 * @param offsetDeg - The drift correction, added on top; `0` when nothing is being corrected. See
 *                    {@link NativeNeedleHandle.offset}.
 * @param current - Where the needle is now, as a continuous (unwrapped) angle.
 * @returns The new continuous angle, or `null` for a sample carrying no usable rotation.
 */
export function nextNeedleAngle(
  rotation: NeedleRotation,
  declinationDeg: number,
  offsetDeg: number,
  current: number
): number | null {
  'worklet';
  if (rotation === null || rotation === undefined) return null;
  if (!Number.isFinite(declinationDeg) || !Number.isFinite(current)) return null;
  if (!Number.isFinite(offsetDeg)) return null;

  // Back to Android's own (x, y, z, w) — see the header.
  const x = rotation.qx;
  const y = -rotation.qz;
  const z = rotation.qy;
  const w = rotation.qw;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(w)
  ) {
    return null;
  }
  if (x * x + y * y + z * z + w * w < MIN_QUATERNION_NORM_SQ) return null;

  // The device→world (East, North, Up) rotation matrix, of which only the first two columns
  // matter. These are exactly `getRotationMatrixFromVector`'s R[0], R[3], R[1] and R[4]; column j
  // is device axis j expressed in world coordinates, so `r00`/`r10` are the East and North
  // components of the device X axis and `r01`/`r11` those of the device Y axis.
  const r00 = 1 - 2 * (y * y + z * z);
  const r10 = 2 * (x * y + w * z);
  const r01 = 2 * (x * y - w * z);
  const r11 = 1 - 2 * (x * x + z * z);

  // Which device axis the SCREEN X axis is, per display rotation. These are the same pairings
  // Android's own `remapCoordinateSystem` uses — ROTATION_90 is `(AXIS_Y, AXIS_MINUS_X)`, i.e.
  // the new X axis is minus the device Y axis, and ROTATION_270 is its mirror — so the two Android
  // paths, this one and `modules/qibla-heading`, agree in every orientation.
  let east: number;
  let north: number;
  if (rotation.interfaceOrientation === 90) {
    east = -r01;
    north = -r11;
  } else if (rotation.interfaceOrientation === 180) {
    east = -r00;
    north = -r10;
  } else if (rotation.interfaceOrientation === 270) {
    east = r01;
    north = r11;
  } else {
    east = r00;
    north = r10;
  }

  // The axis points along the right-hand edge; the user faces 90 degrees anticlockwise of it. The
  // drift correction is added here rather than ramped here: the native module owns the ramp, so
  // this needle and the readout beside it slide onto the anchor together.
  const target = Math.atan2(east, north) * DEG_PER_RAD - 90 + declinationDeg + offsetDeg;
  // Move by the SHORT arc from wherever the needle is. This is what keeps the continuous angle
  // continuous, and it needs no state of its own: the phone cannot turn more than 180 degrees
  // between two frames, so the nearest representation of the target is always the right one. It
  // also makes the hand-over from the JS path seamless — the needle carries on from where it was
  // rather than snapping to a different revolution.
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + delta;
}

interface Props {
  source: NativeNeedleHandle;
}

/**
 * @param source - From `useHeading().nativeNeedle`; render this only while that is non-null.
 * @returns Nothing. The whole effect is on the shared values in {@link Props.source}.
 */
export function NativeNeedleSource({ source }: Props): null {
  const { heading, declination, offset, alive } = source;

  const sensor = useAnimatedSensor(SensorType.ROTATION, {
    interval: NEEDLE_INTERVAL_MS,
    // The heading still has to be measured against the top of the SCREEN rather than the top of
    // the DEVICE — a landscape dial (the glance pane, D124) would otherwise be 90 degrees out —
    // but `nextNeedleAngle` does that itself, from the display rotation Reanimated reports
    // alongside each sample. Reanimated's own adjustment is refused because it rebuilds the
    // quaternion out of Euler angles and mirrors, rather than rotates, the 180 degree case.
    adjustToInterfaceOrientation: false,
  });

  useAnimatedReaction(
    () => sensor.sensor.get(),
    (rotation) => {
      const next = nextNeedleAngle(rotation, declination.get(), offset.get(), heading.get());
      if (next === null) return;
      heading.set(next);
      if (alive.get() === 0) alive.set(1);
    }
  );

  return null;
}
