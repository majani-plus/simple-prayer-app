/**
 * The Android heading adapter, over `modules/qibla-heading`.
 *
 * ## Why
 *
 * Both JS routes to an Android heading are capped at 5 Hz, and the cap is invisible from JS:
 *
 * - `expo-sensors` registers every sensor at `SENSOR_DELAY_NORMAL` (200 ms) unless the app declares
 *   `HIGH_SAMPLING_RATE_SENSORS`, whereupon it jumps to `SENSOR_DELAY_FASTEST` — no setting between
 *   the two. Worse, its `setUpdateInterval` gates how often the stored sample is *dispatched*, not
 *   how often it is *refreshed*, so the 20 Hz `services/fusedHeading` asked for was 20 dispatches of
 *   5 fresh values (`SensorSubscription.kt`).
 * - `expo-location` registers the magnetometer and accelerometer at `SENSOR_DELAY_NORMAL` too, then
 *   emits only past ">2 degrees AND >50 ms" (`LocationModule.kt`) — roughly 1 Hz on a slow turn.
 *
 * That is the stepping the owner reported on 2026-08-30, and it is why D142 — which correctly
 * removed a veto that was keeping the fused stream switched off — shipped in 1.2.0 and did not fix
 * it: the stream it unlocked was itself capped. See D144.
 *
 * The native module registers `TYPE_ROTATION_VECTOR` at `SENSOR_DELAY_GAME` (50 Hz) and hands back
 * events shaped exactly like `expo-location`'s, so everything downstream — `normalizeHeadingSample`,
 * the smoother, `useHeading`, the spring, the dial — is untouched.
 *
 * ## Why it replaces the fused adapter rather than joining it
 *
 * `services/fusedHeading` existed to reach the *same* `TYPE_ROTATION_VECTOR` indirectly, through
 * `expo-sensors` `DeviceMotion`, and then to learn its frame offset by observation because that
 * indirection hid it. Reading the sensor directly makes the frame ours, so the learn-and-prove
 * machinery has nothing left to prove. It is not a useful fallback either: it reads the same sensor,
 * so any device where this module finds nothing is a device where the fused path also found nothing.
 *
 * ## What happens when it is not there
 *
 * iOS, web, Jest, a binary built before the module existed, and any Android device with no rotation
 * vector all take {@link createNativeCompassAdapter}'s fallback, which is the `expo-location`
 * adapter that shipped in 1.2.0 (D38 - no device may regress).
 *
 * The native stream has no error channel: a sensor that stops delivering simply goes quiet, and
 * `useHeading`'s 3 s stale watchdog is what notices. `onError` therefore only ever fires for the
 * fallback, which is the same contract it had before.
 *
 * Dependency rule: `services -> domain`. No React, no stores, no user-facing strings.
 */

import * as qiblaHeading from '../../modules/qibla-heading';

import type { HeadingAdapter, HeadingLocation, RawHeading } from './heading';

/** The slice of `modules/qibla-heading` this adapter uses, injectable so tests need no native code. */
export interface NativeCompassModule {
  /** Whether this binary and this device can drive the needle from the rotation vector. */
  isAvailable(): boolean;
  /** Sets (or with `null`, forgets) the coordinates the declination is computed from. */
  setLocation(location: HeadingLocation | null): void;
  /**
   * Starts the stream.
   *
   * @returns The handle, or `null` when the module is absent — the signal to fall back.
   */
  watchHeading(
    onEvent: (event: RawHeading) => void,
    intervalMs?: number
  ): { remove(): void } | null;
}

/**
 * Delivery floor in ms — one event per sensor sample at `SENSOR_DELAY_GAME`.
 *
 * This throttles delivery to JS, never sampling, so every value that arrives is fresh. Each one
 * costs a shared-value write and a re-targeted spring on the UI thread; no React render happens
 * here, because `useHeading` publishes its readout on a separate 150 ms throttle.
 */
export const NATIVE_HEADING_INTERVAL_MS = 20;

/** The real module, wrapped to the interface above. */
const defaultModule: NativeCompassModule = {
  isAvailable: () => qiblaHeading.isAvailable(),
  setLocation: (location) => qiblaHeading.setLocation(location),
  watchHeading: (onEvent, intervalMs) => qiblaHeading.watchHeading(onEvent, intervalMs),
};

/**
 * Wraps a fallback adapter so the needle uses the native rotation vector wherever one exists.
 *
 * Availability is checked per subscription rather than once at construction: the singleton in
 * `getHeadingService` is built at first use, and this keeps that from freezing an answer.
 *
 * @param fallback - Used whole when the native module is unavailable; the app passes
 *                   `createExpoHeadingAdapter()`.
 * @param module - Injected for tests. Defaults to `modules/qibla-heading`.
 * @returns A {@link HeadingAdapter} — the same contract `createHeadingService` already consumes.
 */
export function createNativeCompassAdapter(
  fallback: HeadingAdapter,
  module: NativeCompassModule = defaultModule
): HeadingAdapter {
  return {
    async watchHeading(onHeading, onError) {
      if (!module.isAvailable()) return fallback.watchHeading(onHeading, onError);

      let removed = false;
      const subscription = module.watchHeading((event) => {
        if (removed) return;
        onHeading(event);
      }, NATIVE_HEADING_INTERVAL_MS);

      // Present but refusing: treat it exactly like absent rather than leaving a dead needle.
      if (subscription === null) return fallback.watchHeading(onHeading, onError);

      return {
        remove() {
          if (removed) return;
          removed = true;
          subscription.remove();
        },
      };
    },

    setLocation(location) {
      module.setLocation(location);
      fallback.setLocation?.(location);
    },
  };
}
