/**
 * Tilt service — the only place the app talks to the accelerometer.
 *
 * The Qibla screen's "hold it flatter" hint (`hooks/useTilt`) needs one low-rate signal: the
 * gravity vector, from which `domain/tilt` derives how far the screen is from horizontal. This
 * module is deliberately a small mirror of `services/heading.ts` — same adapter seam, same
 * synchronous `watch` that survives an unsubscribe-before-start race, same lazy `require` so
 * importing it never touches a native module under Jest.
 *
 * Two properties matter more here than anywhere else:
 *
 * - **Graceful absence.** Not every device has a usable accelerometer, and a broken one must
 *   cost the Qibla tab nothing: `watch` reports `unavailable` through `onError` and the hint
 *   simply never appears (D38 — degraded, never blocked). Nothing here throws at a caller.
 * - **Cheapness.** The sensor runs at {@link TILT_UPDATE_INTERVAL_MS} (~5 Hz) — a posture
 *   changes at human speed — and only while the Qibla tab is focused and the app foregrounded,
 *   a lifetime `hooks/useTilt` owns exactly the way `useHeading` does.
 */

import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How often the accelerometer reports, in milliseconds. 200 ms ≈ 5 Hz: postures change at
 * human speed, and `domain/tilt`'s EMA is tuned for this rate. Well under Android 12's 200 Hz
 * `HIGH_SAMPLING_RATE_SENSORS` bar, so no extra permission is involved.
 */
export const TILT_UPDATE_INTERVAL_MS = 200;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * One accelerometer event, in g, in the app's ONE sign convention: a face-up phone on a table
 * reads `z ≈ +1`, a phone held upright with its top edge up reads `y ≈ +1`. That is Android's
 * native sign (`expo-sensors` divides the raw event by `GRAVITY_EARTH`); CoreMotion reports the
 * opposite sign on every axis, so {@link createExpoTiltAdapter} negates iOS. The tilt hint only
 * ever used `|z|` and never noticed; the face-down warning (D172) needs the sign.
 */
export interface RawAccelerometerSample {
  x: number;
  y: number;
  z: number;
}

/** The handle that stops a running stream. `remove` is idempotent. */
export interface TiltSubscription {
  remove(): void;
}

/** Everything the service needs from the platform. */
export interface TiltAdapter {
  /** Whether this device has a usable accelerometer at all. Never throws. */
  isAvailable(): Promise<boolean>;
  /**
   * Starts the accelerometer stream at the adapter's own rate.
   *
   * @param onSample - Called on every sensor event.
   * @returns The handle that stops it. Rejects when the sensor cannot be started.
   */
  watchAcceleration(onSample: (raw: RawAccelerometerSample) => void): Promise<TiltSubscription>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Called with every raw sample. Filtering and gating live in `domain/tilt`. */
export type TiltListener = (sample: RawAccelerometerSample) => void;

/** Optional callbacks for {@link TiltService.watch}. */
export interface WatchTiltOptions {
  /**
   * Called at most once per subscription, when the sensor is missing, refuses to start, or the
   * availability probe itself fails. The subscription is dead afterwards; the hint stands down.
   */
  onUnavailable?: (message?: string) => void;
}

/** The service surface consumed by `hooks/useTilt`. */
export interface TiltService {
  /**
   * Subscribes to the accelerometer.
   *
   * Returns **synchronously** for the same reason `HeadingService.watch` does: a screen that
   * unmounts between the call and the platform's answer must still be able to stop the sensor
   * from a `useEffect` cleanup. Calling `remove()` before the stream has started cancels it —
   * the listener is never called and the native subscription is torn down the moment it
   * materialises.
   *
   * @param listener - Called with every finite sample. Non-finite events are dropped silently.
   * @param options - See {@link WatchTiltOptions}.
   * @returns An idempotent handle. Never throws.
   */
  watch(listener: TiltListener, options?: WatchTiltOptions): TiltSubscription;
}

/**
 * Builds a {@link TiltService} over an adapter.
 *
 * @param adapter - Platform access; the app passes {@link createExpoTiltAdapter}.
 * @returns A service whose `watch` never throws.
 */
export function createTiltService(adapter: TiltAdapter): TiltService {
  return {
    watch(listener, { onUnavailable }: WatchTiltOptions = {}) {
      let removed = false;
      let platform: TiltSubscription | null = null;

      const fail = (error: unknown): void => {
        if (removed) return;
        removed = true;
        const message =
          error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
        onUnavailable?.(message);
      };

      // `Promise.resolve().then(...)` so a synchronous throw from a badly behaved adapter also
      // reaches `fail` instead of escaping into the caller's render.
      void Promise.resolve()
        .then(() => adapter.isAvailable())
        .then((available) => {
          if (removed) return null;
          if (!available) {
            fail('accelerometer unavailable');
            return null;
          }
          return adapter.watchAcceleration((raw) => {
            if (removed) return;
            if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)) {
              return;
            }
            listener(raw);
          });
        })
        .then((subscription) => {
          if (subscription === null) return;
          // Lost the race: the caller already unsubscribed, so stop the sensor immediately.
          if (removed) subscription.remove();
          else platform = subscription;
        })
        .catch(fail);

      return {
        remove() {
          removed = true;
          const subscription = platform;
          platform = null;
          subscription?.remove();
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// expo-sensors adapter
// ---------------------------------------------------------------------------

type ExpoSensorsModule = typeof import('expo-sensors');

/**
 * The real adapter, over `expo-sensors`' `Accelerometer`.
 *
 * The native module is `require`d lazily on first use (the same trick `services/heading.ts`
 * uses), so importing this file stays safe under Jest and in node scripts. The update interval
 * is set before each subscribe; `expo-sensors` applies it per-sensor, globally, which is fine —
 * this app has exactly one accelerometer consumer.
 *
 * @returns A {@link TiltAdapter} bound to the device accelerometer.
 */
export function createExpoTiltAdapter(): TiltAdapter {
  let module: ExpoSensorsModule | null = null;
  const load = (): ExpoSensorsModule => {
    if (module === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      module = require('expo-sensors') as ExpoSensorsModule;
    }
    return module;
  };

  return {
    async isAvailable() {
      try {
        return await load().Accelerometer.isAvailableAsync();
      } catch {
        return false;
      }
    },
    async watchAcceleration(onSample) {
      const { Accelerometer } = load();
      Accelerometer.setUpdateInterval(TILT_UPDATE_INTERVAL_MS);
      // CoreMotion's acceleration is the negative of Android's on every axis (face-up z = −1
      // there, +1 here). One sign for the whole app, decided at the platform seam.
      const sign = Platform.OS === 'ios' ? -1 : 1;
      const subscription = Accelerometer.addListener((measurement) => {
        onSample({ x: sign * measurement.x, y: sign * measurement.y, z: sign * measurement.z });
      });
      return { remove: () => subscription.remove() };
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests, and any device without an accelerometer)
// ---------------------------------------------------------------------------

/** A hand-cranked {@link TiltAdapter}: the test's fake accelerometer. */
export interface FakeTiltAdapter extends TiltAdapter {
  /** Delivers one raw event to every live subscription. No-op when none is active. */
  emit(raw: Partial<RawAccelerometerSample>): void;
  /** Makes the availability probe answer `false` from now on. */
  setUnavailable(): void;
  /** Makes the NEXT `watchAcceleration` reject with this error, then clears itself. */
  failNextStart(error: unknown): void;
  /**
   * Holds `watchAcceleration`'s promise open until {@link releaseStart} is called, so a test
   * can unsubscribe while the platform is still starting up.
   */
  deferStart(): void;
  /** Resolves a start held by {@link deferStart}. */
  releaseStart(): void;
  /** How many times a stream was started. */
  readonly startCount: number;
  /** How many times a stream was stopped. */
  readonly removeCount: number;
  /** Whether a stream is currently running — i.e. whether the sensor is on. */
  readonly isWatching: boolean;
}

/**
 * Builds an in-memory {@link TiltAdapter}.
 *
 * Exported from the production module for the same reason `createFakeHeadingAdapter` is: the
 * seam has to be reachable without importing a test file.
 *
 * @returns A fake adapter whose events are emitted by hand.
 */
export function createFakeTiltAdapter(): FakeTiltAdapter {
  type Live = (raw: RawAccelerometerSample) => void;

  const live = new Set<Live>();
  let available = true;
  let startCount = 0;
  let removeCount = 0;
  let failNext: { error: unknown } | null = null;
  let pending: (() => void)[] | null = null;

  return {
    async isAvailable() {
      return available;
    },
    async watchAcceleration(onSample) {
      startCount += 1;
      if (pending !== null) {
        await new Promise<void>((resolve) => pending?.push(resolve));
      }
      if (failNext !== null) {
        const { error } = failNext;
        failNext = null;
        throw error;
      }
      live.add(onSample);
      return {
        remove() {
          if (live.delete(onSample)) removeCount += 1;
        },
      };
    },
    emit(raw) {
      const event: RawAccelerometerSample = { x: raw.x ?? 0, y: raw.y ?? 0, z: raw.z ?? 1 };
      for (const entry of [...live]) entry(event);
    },
    setUnavailable() {
      available = false;
    },
    failNextStart(error) {
      failNext = { error };
    },
    deferStart() {
      pending ??= [];
    },
    releaseStart() {
      const waiting = pending ?? [];
      pending = null;
      for (const resolve of waiting) resolve();
    },
    get startCount() {
      return startCount;
    },
    get removeCount() {
      return removeCount;
    },
    get isWatching() {
      return live.size > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultService: TiltService | null = null;

/**
 * The app-wide service, created on first use so that no native module is touched at import.
 *
 * @returns The singleton {@link TiltService} backed by {@link createExpoTiltAdapter}.
 */
export function getTiltService(): TiltService {
  if (defaultService === null) {
    defaultService = createTiltService(createExpoTiltAdapter());
  }
  return defaultService;
}
