/**
 * `qibla-heading` — the Android compass, sampled at a rate we choose.
 *
 * ## Why this exists
 *
 * Every JS route to an Android heading is capped at 5 Hz, so the needle steps once or twice a second
 * while the same code is smooth on iOS (owner, 2026-08-30, on a Xiaomi 15T Pro). `expo-sensors`
 * registers sensors at `SENSOR_DELAY_NORMAL` unless the app declares `HIGH_SAMPLING_RATE_SENSORS`,
 * whereupon it jumps to `SENSOR_DELAY_FASTEST` — there is no setting in between, and its
 * `setUpdateInterval` throttles *dispatch* rather than *sampling*, so asking for 50 ms against a
 * 5 Hz sensor re-sends the same yaw four times in five. `expo-location`'s own heading registers at
 * `SENSOR_DELAY_NORMAL` too and then gates on ">2 degrees AND >50 ms", which is ~1 Hz on a slow turn.
 *
 * This module registers `TYPE_ROTATION_VECTOR` itself, at `SENSOR_DELAY_GAME` (50 Hz) — below the
 * 200 Hz ceiling that permission exists to lift, so it needs no permission. See the Kotlin module
 * for the sensor choice, the display remap, why accuracy comes from the magnetometer, and the one
 * case that lowers it below what the magnetometer claims.
 *
 * ## Where it does nothing
 *
 * iOS, web and Jest have no such module: {@link isAvailable} answers `false` and
 * {@link watchHeading} refuses, so `services/nativeCompass` keeps the `expo-location` path that
 * shipped before this. iOS is not a fallback but the intended behaviour there — `CLHeading` is
 * already gyro-fused, tilt-compensated and fast, which is why iOS never had this bug.
 *
 * ## Rebuild required
 *
 * This is a native module. A dev client or store build made before it existed does not contain it,
 * and {@link isAvailable} answers `false` there — correctly, and without crashing.
 */

/** One heading event, shaped exactly like `expo-location`'s so `services/heading` needs no new case. */
export interface NativeHeadingEvent {
  /** Degrees clockwise from true north, or `-1` when no location has been set. */
  trueHeading: number;
  /** Degrees clockwise from magnetic north, in `[0, 360)`. */
  magHeading: number;
  /**
   * The magnetometer's `SensorManager` calibration constant, `0`-`3`, or `-1` before it speaks.
   *
   * One exception, which is still that constant and still means the same thing to the app: while
   * the gyro-fused attitude disagrees with the magnetometer-only one and the phone has never been
   * flat enough for {@link driftOffset} to correct it, the module reports
   * `SENSOR_STATUS_ACCURACY_LOW` (`1`) rather than the higher number the magnetometer claims,
   * because a drifted fused yaw is wrong however well calibrated the magnetometer is. The value is
   * only ever lowered this way, never raised. See the Kotlin module for the cross-check.
   */
  accuracy: number;
  /**
   * Degrees already ADDED to the two headings above to anchor the drifted fusion onto the
   * magnetometer-only reference; `0`, or absent, when nothing is being corrected.
   *
   * Reported so the one path that does not go through this module — the Reanimated worklet in
   * `components/NativeNeedleSource`, which reads the same fused sensor itself on the UI thread —
   * can add the same number and land on the same heading. Anything reading `magHeading` or
   * `trueHeading` needs no part of it: the correction is already in them.
   */
  driftOffset?: number;
}

/** A handle that stops the stream. Idempotent. */
export interface NativeHeadingSubscription {
  remove(): void;
}

/** The surface the native module exposes. See the Kotlin module for the contract. */
interface QiblaHeadingNativeModule {
  isAvailable(): boolean;
  setUpdateInterval(intervalMs: number): void;
  setLocation(latitude: number, longitude: number, altitude: number): void;
  clearLocation(): void;
  addListener(
    event: 'onHeading',
    listener: (event: NativeHeadingEvent) => void
  ): NativeHeadingSubscription;
}

/**
 * `null` until first use, then the module or `null` forever.
 *
 * Resolved lazily and behind a `try`, exactly as `modules/exact-alarms` does: importing `expo`'s
 * native-module bridge eagerly is what breaks plain Jest runs, and a build without this module has
 * to degrade rather than throw at import time.
 */
let resolved: QiblaHeadingNativeModule | null | undefined;

function nativeModule(): QiblaHeadingNativeModule | null {
  if (resolved !== undefined) return resolved;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };
    resolved = requireOptionalNativeModule<QiblaHeadingNativeModule>('QiblaHeading');
  } catch {
    resolved = null;
  }
  return resolved;
}

/**
 * Whether this binary can drive the needle from the rotation vector.
 *
 * False on iOS, on web, under Jest, on a build made before this module existed, and on an Android
 * device that exposes no rotation vector at all. Every one of those keeps the `expo-location` path.
 *
 * @returns `true` when {@link watchHeading} will actually produce events.
 */
export function isAvailable(): boolean {
  const native = nativeModule();
  if (native === null) return false;
  try {
    return native.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Sets the location whose declination turns a magnetic heading into a true one.
 *
 * Passing `null` forgets it, after which events carry `trueHeading: -1` and the app falls back to
 * magnetic north — the same degraded mode it already renders when the OS cannot determine one.
 *
 * @param location - Coordinates, or `null` to forget the previous ones.
 */
export function setLocation(
  location: { latitude: number; longitude: number; altitude?: number } | null
): void {
  const native = nativeModule();
  if (native === null) return;
  try {
    if (location === null) native.clearLocation();
    else native.setLocation(location.latitude, location.longitude, location.altitude ?? 0);
  } catch {
    // A stale binary without these calls must not take the compass down with it.
  }
}

/**
 * Starts the heading stream.
 *
 * @param onEvent - Called with every sample, up to once per `intervalMs`.
 * @param intervalMs - Floor on delivery to JS. Sampling stays at 50 Hz regardless.
 * @returns The handle that stops it, or `null` when this binary has no such module — the signal
 *          for the caller to use its fallback.
 */
export function watchHeading(
  onEvent: (event: NativeHeadingEvent) => void,
  intervalMs?: number
): NativeHeadingSubscription | null {
  const native = nativeModule();
  if (native === null) return null;
  try {
    if (intervalMs !== undefined) native.setUpdateInterval(intervalMs);
    return native.addListener('onHeading', onEvent);
  } catch {
    return null;
  }
}
