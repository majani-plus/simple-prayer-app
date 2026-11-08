/**
 * Heading service — the only place the app talks to the device compass.
 *
 * The Qibla tab lives or dies on this file. Market research on the competition is blunt about
 * where they fail: needles that jitter on the magnetometer noise floor, needles that spin the
 * long way round when the heading crosses north, dials that lag half a second behind the phone,
 * and sensors left running after the user has walked away. This module answers the first three
 * (with {@link createHeadingSmoother}) and hands the fourth to `hooks/useHeading`, which owns the
 * subscription's lifetime.
 *
 * It turns three coarse facts reported by `expo-location`'s `watchHeadingAsync` — a true heading,
 * a magnetic heading and a 0–3 accuracy integer — into a {@link HeadingSample} the UI can render
 * honestly:
 *
 *  1. **Which north is this?** True north when the platform can give it, magnetic north when it
 *     cannot, and {@link HeadingSample.reference} always says which. This matters: `domain/qibla`
 *     computes a TRUE-north bearing, so a magnetic reading is wrong by the local declination
 *     (up to ~25° in populated latitudes, more near the poles). Silently drawing a magnetic
 *     heading against a true bearing is exactly the kind of confident lie this app must not tell.
 *  2. **How much should we be believed?** {@link HeadingConfidence} — `high | medium | low |
 *     unavailable` — and {@link HeadingSample.needsCalibration}, which is the figure-8 prompt's
 *     trigger.
 *  3. **What should the needle actually do?** {@link createHeadingSmoother}: a shortest-arc
 *     low-pass filter over `domain/qibla.smoothHeading`, which also maintains an *unwrapped*
 *     angle so a Reanimated rotation can never take the 358° route. See its JSDoc.
 *
 * ## Accuracy: the same number means different things on iOS and Android
 *
 * `expo-location` reports `accuracy` as a single 0–3 integer on both platforms, which hides a real
 * difference in what was measured. Both branches are documented here because "3" is not the same
 * claim on the two operating systems, and the UI's confidence dots are a promise to the user.
 *
 * **iOS** — `CLHeading.headingAccuracy` is a maximum deviation in DEGREES, bucketed by
 * `expo-location` (`ios/LocationUtils.swift`, `normalizeAccuracy`):
 *
 * | `headingAccuracy` (°) | expo `accuracy` | our {@link HeadingConfidence} |
 * |---|---|---|
 * | `0 … 20`      | `3` | `high` |
 * | `> 20 … 35`   | `2` | `medium` |
 * | `> 35 … 50`   | `1` | `low` |
 * | `> 50`, or negative (invalid) | `0` | `unavailable` |
 *
 * **Android** — there are no degrees. `accuracy` is the raw `SensorManager` calibration constant
 * for the **magnetometer** — which is the sensor the figure-8 actually calibrates, and so the only
 * one whose number may decide whether the app asks for it. `expo-location` reads it in
 * `LocationModule.kt`; `modules/qibla-heading`, which supplies the heading on Android since D144,
 * registers the magnetometer alongside the rotation vector for this number and nothing else:
 *
 * | `SensorManager` constant | value | our {@link HeadingConfidence} |
 * |---|---|---|
 * | `SENSOR_STATUS_ACCURACY_HIGH`   | `3`  | `high` |
 * | `SENSOR_STATUS_ACCURACY_MEDIUM` | `2`  | `medium` |
 * | `SENSOR_STATUS_ACCURACY_LOW`    | `1`  | `low` |
 * | `SENSOR_STATUS_UNRELIABLE`      | `0`  | `unavailable` |
 * | `SENSOR_STATUS_NO_CONTACT`      | `-1` | `unavailable` |
 *
 * Two Android consequences the UI must be told about, because they are not bugs here:
 * `onAccuracyChanged` may not fire before the first heading event, so a healthy device can open
 * the screen reporting `unavailable` for a moment (hence `useHeading`'s calibration grace
 * period); and many devices simply never report anything above `medium`.
 *
 * There is also one case where the Android number is *not* purely the magnetometer's. The
 * gyro-fused rotation vector that drives the needle can drift while the magnetometer stays
 * calibrated — a phone left locked on the Qibla tab comes back pointing tens of degrees wrong — and
 * a magnetometer verdict of `medium` or `high` would then be true and beside the point, leaving the
 * app confident and wrong with no figure-8 prompt. So `modules/qibla-heading` cross-checks the fused
 * attitude against a magnetometer-only one, and does one of two things with the disagreement:
 * whenever it can, it corrects the heading it emits (the correction rides along as
 * {@link HeadingSample.needleOffset}, already applied to every angle in the sample); when it cannot
 * — the reference is only trustworthy enough to anchor to while the phone is relatively flat — it
 * reports `1` (`low`) instead, because the needle really is wrong and the figure-8 is the remedy.
 * It only ever lowers the magnetometer's own verdict, never raises it, and nothing changes on this
 * side: the number still means "how much to believe the reading".
 *
 * ## Why the adapter is injectable
 *
 * `expo-location` is a native module — importing it eagerly breaks plain Jest runs. Everything
 * goes through {@link HeadingAdapter}; the app uses {@link createExpoHeadingAdapter} (which
 * `require`s the native module lazily, on first use) and the tests drive
 * {@link createFakeHeadingAdapter}, a hand-cranked emitter. Same seam, same reasoning, as
 * `services/location.ts`.
 *
 * ## Permission
 *
 * Nothing here prompts. iOS refuses to compute a *true* heading without foreground location
 * permission (and `watchDeviceHeading` throws outright), and Android needs a location fix to know
 * the local declination — without one it reports `trueHeading: -1` and we fall back to magnetic.
 * Asking is `stores/locationStore`'s job, from an explicit user action; `useHeading` only reads
 * the answer. See PRODUCT_SPEC §10.
 *
 * Dependency rule: `services → domain`. No React, no React Native, no stores, no user-facing
 * strings — the confidence enum is a machine value the UI maps onto localized copy.
 */

import { Platform } from 'react-native';

import { normalizeAngle, shortestAngleDelta, smoothHeading } from '../domain/qibla';
import { createNativeCompassAdapter } from './nativeCompass';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Which north a reading is measured against. */
export type HeadingReference = 'true' | 'magnetic';

/** How much the platform believes its own compass. See the module header for the mapping. */
export const HEADING_CONFIDENCES = ['high', 'medium', 'low', 'unavailable'] as const;
export type HeadingConfidence = (typeof HEADING_CONFIDENCES)[number];

/**
 * The confidence levels at which the UI must offer the figure-8 calibration prompt
 * (PRODUCT_SPEC §9 — "low accuracy → calibration prompt").
 */
export const CALIBRATION_CONFIDENCES: readonly HeadingConfidence[] = Object.freeze([
  'low',
  'unavailable',
]);

/** Machine-readable failure reasons. The UI maps these onto localized copy. */
export const HEADING_ERRORS = [
  /** The platform refused the sensor because foreground location permission is not granted. */
  'permissionDenied',
  /** No compass on this device, or the sensor stream failed. */
  'sensorUnavailable',
] as const;
export type HeadingErrorCode = (typeof HEADING_ERRORS)[number];

/**
 * The sentinel both platforms use for "there is no true heading": iOS returns a negative
 * `CLHeading.trueHeading` when it cannot be determined, and Android's
 * `LocationModule.calcTrueNorth` returns `-1f` when it has no location fix to derive the magnetic
 * declination from.
 *
 * It is compared for **exactly** `-1` rather than "any negative", because Android computes
 * `(magneticHeading + declination) % 360`, which is legitimately negative wherever declination is
 * west (the Americas, most of the Atlantic): a true heading of 352° arrives as `-8`. Treating all
 * negatives as invalid would drop every westerly-declination device onto the magnetic fallback.
 *
 * The cost of that choice is a single sample per full turn: a genuine Android true heading of
 * exactly 359° (`-1`) is read as unavailable and that one sample falls back to magnetic. It is
 * one frame, inside the smoother, and invisible.
 */
const NO_TRUE_HEADING = -1;

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/**
 * A raw compass event, exactly as `expo-location`'s `LocationHeadingObject` delivers it.
 * Nothing is normalised yet: angles may be out of range or carry the {@link NO_TRUE_HEADING}
 * sentinel, and `accuracy` is the platform integer described in the module header.
 */
export interface RawHeading {
  /** Degrees clockwise from true north, or `-1` when the platform cannot determine one. */
  trueHeading: number;
  /** Degrees clockwise from magnetic north. */
  magHeading: number;
  /** Platform calibration integer, `0`–`3`. */
  accuracy: number;
  /**
   * Android only, and absent unless `modules/qibla-heading` is correcting a drifted fusion: the
   * degrees it has already added to both headings above. See {@link HeadingSample.needleOffset}.
   */
  driftOffset?: number;
}

/** A handle that stops a stream. Idempotent: calling `remove` twice is safe. */
export interface HeadingSubscription {
  remove(): void;
}

/**
 * Where the phone is, for the one purpose of turning a magnetic heading into a true one.
 *
 * Deliberately not `AppLocation`: an adapter needs two numbers, not a label, a country code or a
 * provenance, and the narrower type keeps `services` from depending on the shape a store happens to
 * persist.
 */
export interface HeadingLocation {
  latitude: number;
  longitude: number;
  /** Metres above sea level. Barely moves the declination; `0` is a fine answer.  */
  altitude?: number;
}

/** Everything the service needs from the platform. */
export interface HeadingAdapter {
  /**
   * Starts the compass stream.
   *
   * @param onHeading - Called on every sensor event, many times a second.
   * @param onError - Called when the stream fails after having started.
   * @returns The handle that stops it. Rejects when the sensor cannot be started at all.
   */
  watchHeading(
    onHeading: (raw: RawHeading) => void,
    onError: (reason: string) => void
  ): Promise<HeadingSubscription>;

  /**
   * Tells the adapter where the phone is, so it can compute the local declination.
   *
   * Optional because most adapters do not need it: `expo-location` resolves its own fix natively,
   * and the fakes have nothing to compute. `services/nativeCompass` implements it, because the
   * rotation vector knows its angle to magnetic north and nothing at all about true north.
   *
   * @param location - Coordinates, or `null` to forget the previous ones.
   */
  setLocation?(location: HeadingLocation | null): void;
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

/** One normalised compass reading — what the hook and, through it, the dial consume. */
export interface HeadingSample {
  /**
   * The heading the UI should use, in `[0, 360)`: the true heading when there is one, otherwise
   * the magnetic one. Always finite.
   */
  heading: number;
  /** Which north {@link heading} is measured against. `magnetic` is the degraded case. */
  reference: HeadingReference;
  /** True heading in `[0, 360)`, or `null` when the platform could not determine one. */
  trueHeading: number | null;
  /** Magnetic heading in `[0, 360)`, or `null` when the platform did not report one. */
  magneticHeading: number | null;
  /** How much to believe the reading. See the module header for the platform mapping. */
  confidence: HeadingConfidence;
  /** The platform's raw accuracy integer, kept for diagnostics; nothing branches on it. */
  rawAccuracy: number;
  /**
   * Degrees the platform has already added to {@link heading} to anchor a drifted gyro fusion onto
   * the magnetometer-only reference. `0` everywhere but Android, and `0` there whenever nothing is
   * being corrected.
   *
   * Do not add it to anything read from this sample — it is already in every angle here. It exists
   * for the one consumer that bypasses this service: the UI-thread worklet in
   * `components/NativeNeedleSource` reads the fused sensor itself and has to apply the same
   * correction, or the needle and the number beside it would disagree by exactly this much.
   */
  needleOffset: number;
  /** `true` when the UI should show the figure-8 calibration prompt. */
  needsCalibration: boolean;
  /** Epoch ms the sample was normalised. */
  timestamp: number;
}

/**
 * Maps a platform accuracy integer onto the app's confidence enum.
 *
 * Only the four documented values are recognised; anything else (a future constant, `NaN`, a
 * fractional value) is `unavailable`, because an unrecognised claim is not a claim.
 *
 * @param accuracy - The `accuracy` field of a {@link RawHeading}.
 * @returns The confidence level to render. See the module header for what it means per platform.
 */
export function toHeadingConfidence(accuracy: number): HeadingConfidence {
  switch (accuracy) {
    case 3:
      return 'high';
    case 2:
      return 'medium';
    case 1:
      return 'low';
    default:
      return 'unavailable';
  }
}

/** Whether a confidence level should trigger the figure-8 prompt. */
export function needsCalibration(confidence: HeadingConfidence): boolean {
  return CALIBRATION_CONFIDENCES.includes(confidence);
}

/** `null` for the {@link NO_TRUE_HEADING} sentinel and non-finite junk; `[0, 360)` otherwise. */
function usableAngle(value: number): number | null {
  if (!Number.isFinite(value) || value === NO_TRUE_HEADING) return null;
  const normalized = normalizeAngle(value);
  return Number.isFinite(normalized) ? normalized : null;
}

/**
 * Normalises one raw platform event.
 *
 * True heading is preferred and magnetic is the documented fallback (PRODUCT_SPEC §9 — the
 * bearing math is true-north referenced, so a magnetic reading is a *degraded* mode the UI has to
 * disclose, not an equivalent one).
 *
 * @param raw - The platform event.
 * @param timestamp - Epoch ms to stamp the sample with.
 * @returns The normalised sample, or `null` when the event carried no usable angle at all — a
 * sample that cannot say where the phone is pointing is dropped rather than guessed at.
 */
export function normalizeHeadingSample(
  raw: RawHeading | null | undefined,
  timestamp: number
): HeadingSample | null {
  if (raw === null || raw === undefined) return null;

  const trueHeading = usableAngle(raw.trueHeading);
  const magneticHeading = usableAngle(raw.magHeading);
  const heading = trueHeading ?? magneticHeading;
  if (heading === null) return null;

  const confidence = toHeadingConfidence(raw.accuracy);
  const offset = raw.driftOffset;
  return {
    heading,
    reference: trueHeading === null ? 'magnetic' : 'true',
    trueHeading,
    magneticHeading,
    confidence,
    rawAccuracy: raw.accuracy,
    // Absent on every platform but Android, and on Android whenever nothing is being corrected.
    // Junk is read as "no correction" rather than propagated into the needle.
    needleOffset: typeof offset === 'number' && Number.isFinite(offset) ? offset : 0,
    needsCalibration: needsCalibration(confidence),
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// Smoothing — the part the whole tab is judged on
// ---------------------------------------------------------------------------

/**
 * Default low-pass weight: the fraction of the remaining error removed per sample.
 *
 * **Not what production runs.** `hooks/useHeading` passes `1` (no JS-side filtering) and lets a
 * UI-thread spring do the smoothing, because both platforms deliver events only on change and a
 * per-sample filter parks the needle short of the true heading the moment events stop (measured
 * ~21° short under the Android gate — see the 2026-08-20 lag fix and `useHeading`'s header).
 * This default serves callers that want a plain filter — tests, previews, one-shot readings —
 * where 0.2 settles ~90% of a step within half a second at the platforms' delivery rates.
 */
export const DEFAULT_SMOOTHING_FACTOR = 0.2;

/** One filtered reading: the same angle expressed two ways. See {@link HeadingSmoother}. */
export interface SmoothedHeading {
  /** The smoothed heading wrapped into `[0, 360)` — what the numeric readout shows. */
  heading: number;
  /**
   * The same heading as a **continuous** angle, free to grow past 360 or below 0 — what an
   * animated rotation is driven by. See {@link HeadingSmoother} for why the distinction exists.
   */
  continuous: number;
}

/**
 * A stateful shortest-arc low-pass filter over the raw heading stream.
 *
 * Two problems, one object:
 *
 * 1. **Jitter.** Each sample is eased towards with `domain/qibla.smoothHeading`, which moves a
 *    `factor` fraction along the SHORT arc — so 359° → 1° is a 2° nudge, never a 358° sweep.
 * 2. **The wrap.** Even a perfectly smoothed value is useless to an animation if it is handed
 *    over wrapped: an animated rotation told to go from 359 to 1 interpolates *down* through 180,
 *    and the needle spins a full turn backwards on every pass through north. So the filter also
 *    keeps an **unwrapped** angle, accumulating the signed shortest delta of every step: 358 →
 *    2 → 6 arrives as 358 → 362 → 366. Feed {@link SmoothedHeading.continuous} to Reanimated and
 *    the short arc is structurally guaranteed, on the UI thread, with no wrap handling in the
 *    animation code at all. Feed {@link SmoothedHeading.heading} to the "96°" text.
 *
 * The filter is deliberately not a worklet: it runs once per sensor event on the JS thread (where
 * the events already arrive) and its output is pushed into a shared value, which costs no React
 * render. Doing the same arithmetic in a `runOnUI` hop per sample would be strictly more work.
 *
 * Sensor-stream behaviour is inherited from `smoothHeading`: the first sample is adopted outright
 * (the needle springs from the true heading rather than easing in from north), and a non-finite
 * sample holds the last value rather than poisoning it.
 *
 * @param factor - Low-pass weight in `[0, 1]`; defaults to {@link DEFAULT_SMOOTHING_FACTOR}.
 * `1` disables smoothing (snap to every sample), `0` freezes the needle. Non-finite values fall
 * back to the default.
 * @returns A smoother; not thread-safe, one per subscription.
 */
export interface HeadingSmoother {
  /** The last smoothed heading in `[0, 360)`, or `NaN` before the first sample. */
  readonly heading: number;
  /** The last continuous (unwrapped) heading; `0` before the first sample. */
  readonly continuous: number;
  /** `true` once at least one usable sample has been pushed. */
  readonly hasFix: boolean;
  /**
   * Feeds one measured heading in.
   *
   * @param next - Degrees clockwise from north; any magnitude, any sign.
   * @returns The filtered value in both forms. A non-finite `next` returns the held value.
   */
  push(next: number): SmoothedHeading;
  /** Forgets everything, so the next sample is adopted outright again. */
  reset(): void;
}

export function createHeadingSmoother(factor: number = DEFAULT_SMOOTHING_FACTOR): HeadingSmoother {
  const weight = Number.isFinite(factor)
    ? Math.min(Math.max(factor, 0), 1)
    : DEFAULT_SMOOTHING_FACTOR;

  let heading = Number.NaN;
  let continuous = 0;

  return {
    get heading() {
      return heading;
    },
    get continuous() {
      return continuous;
    },
    get hasFix() {
      return Number.isFinite(heading);
    },
    push(next: number): SmoothedHeading {
      const previous = heading;
      const smoothed = smoothHeading(previous, next, weight);
      if (!Number.isFinite(smoothed)) return { heading, continuous };

      if (!Number.isFinite(previous)) {
        // Cold start: adopt the reading, and start the unwrapped angle from the same place so the
        // dial's first paint is already correct rather than swinging in from north.
        continuous = smoothed;
      } else {
        // The ONLY way `continuous` ever moves: by the signed short arc. Accumulating deltas
        // rather than re-deriving from the wrapped value is what makes the long-way-round spin
        // unrepresentable instead of merely unlikely.
        continuous += shortestAngleDelta(previous, smoothed);
      }
      heading = smoothed;
      return { heading, continuous };
    },
    reset() {
      heading = Number.NaN;
      continuous = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Called with every normalised sample. */
export type HeadingListener = (sample: HeadingSample) => void;

/** Optional callbacks for {@link HeadingService.watch}. */
export interface WatchHeadingOptions {
  /**
   * Called at most once per subscription, when the stream cannot be started or dies. The
   * subscription is dead afterwards; the caller decides whether to retry.
   */
  onError?: (code: HeadingErrorCode, message?: string) => void;
}

/** The service surface consumed by `hooks/useHeading`. */
export interface HeadingService {
  /**
   * Subscribes to the compass.
   *
   * Returns **synchronously**, even though starting the native stream is asynchronous. That is
   * the whole point: a screen that unmounts (or a tab that loses focus) between the call and the
   * platform's answer must still be able to stop the sensor, and it cannot await anything from a
   * `useEffect` cleanup. Calling `remove()` on the returned handle before the stream has started
   * cancels it — the listener is never called, and the native subscription is torn down the
   * moment it materialises.
   *
   * @param listener - Called with every usable sample. Unusable events are dropped silently.
   * @param options - See {@link WatchHeadingOptions}.
   * @returns An idempotent handle. Never throws.
   */
  watch(listener: HeadingListener, options?: WatchHeadingOptions): HeadingSubscription;

  /**
   * Passes the current location down to the adapter, for declination.
   *
   * Safe to call at any time, including before and between subscriptions, and safe to call on an
   * adapter that does not care — which is every adapter but `services/nativeCompass`.
   *
   * @param location - Coordinates, or `null` when the app has none; the needle then reads against
   *                   magnetic north, the degraded mode the UI already discloses.
   */
  setLocation(location: HeadingLocation | null): void;
}

/** Construction-time dependencies of {@link createHeadingService}. */
export interface HeadingServiceOptions {
  /** Epoch-ms clock, injected so tests can pin `timestamp`. Defaults to `Date.now`. */
  now?: () => number;
}

/** Best-effort classification of a platform start-up failure. */
function classifyError(error: unknown): { code: HeadingErrorCode; message: string } {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  // iOS throws `Missing location permissions` from `ensureForegroundLocationPermissions`; Android
  // reports a similar phrase. Anything else is "there is no usable compass here".
  const code: HeadingErrorCode = /permission/i.test(message)
    ? 'permissionDenied'
    : 'sensorUnavailable';
  return { code, message };
}

/**
 * Builds a {@link HeadingService} over an adapter.
 *
 * @param adapter - Platform access; the app passes {@link createExpoHeadingAdapter}.
 * @param options - See {@link HeadingServiceOptions}.
 * @returns A service whose `watch` never throws.
 */
export function createHeadingService(
  adapter: HeadingAdapter,
  options: HeadingServiceOptions = {}
): HeadingService {
  const now = options.now ?? (() => Date.now());

  return {
    watch(listener, { onError }: WatchHeadingOptions = {}) {
      let removed = false;
      let platform: HeadingSubscription | null = null;

      const fail = (error: unknown): void => {
        if (removed) return;
        removed = true;
        const { code, message } = classifyError(error);
        onError?.(code, message);
      };

      // `Promise.resolve().then(...)` rather than a bare call: a synchronous throw from a badly
      // behaved adapter has to reach `fail` too, not escape into the caller's render.
      void Promise.resolve()
        .then(() =>
          adapter.watchHeading(
            (raw) => {
              if (removed) return;
              const sample = normalizeHeadingSample(raw, now());
              if (sample !== null) listener(sample);
            },
            (reason) => fail(reason)
          )
        )
        .then((subscription) => {
          // Lost the race: the caller already unsubscribed, so stop the sensor immediately. This
          // is the branch that keeps a backgrounded app from leaving the magnetometer running.
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

    setLocation(location) {
      adapter.setLocation?.(location);
    },
  };
}

// ---------------------------------------------------------------------------
// expo-location adapter
// ---------------------------------------------------------------------------

type ExpoLocationModule = typeof import('expo-location');

/**
 * The real adapter, over `expo-location`'s `watchHeadingAsync`.
 *
 * The native module is `require`d lazily on first use (the same trick `services/location.ts`
 * uses), so importing this file stays safe under Jest and in node scripts.
 *
 * @returns A {@link HeadingAdapter} bound to the device compass.
 */
export function createExpoHeadingAdapter(): HeadingAdapter {
  let module: ExpoLocationModule | null = null;
  const load = (): ExpoLocationModule => {
    if (module === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      module = require('expo-location') as ExpoLocationModule;
    }
    return module;
  };

  return {
    async watchHeading(onHeading, onError) {
      const subscription = await load().watchHeadingAsync(
        (heading) => {
          onHeading({
            trueHeading: heading.trueHeading,
            magHeading: heading.magHeading,
            accuracy: heading.accuracy,
          });
        },
        (reason) => onError(String(reason))
      );
      return { remove: () => subscription.remove() };
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests, and any device without a compass)
// ---------------------------------------------------------------------------

/** A hand-cranked {@link HeadingAdapter}: the test's fake magnetometer. */
export interface FakeHeadingAdapter extends HeadingAdapter {
  /** Delivers one raw event to every live subscription. No-op when none is active. */
  emit(raw: Partial<RawHeading>): void;
  /** Delivers a stream failure to every live subscription. */
  emitError(reason: string): void;
  /** Makes the NEXT `watchHeading` reject with this error, then clears itself. */
  failNextStart(error: unknown): void;
  /**
   * Holds `watchHeading`'s promise open until {@link releaseStart} is called, so a test can
   * unsubscribe while the platform is still starting up.
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
 * Builds an in-memory {@link HeadingAdapter}.
 *
 * Exported from the production module for the same reason `createFakeLocationAdapter` is: the
 * seam has to be reachable without importing a test file.
 *
 * @returns A fake adapter whose events are emitted by hand.
 */
export function createFakeHeadingAdapter(): FakeHeadingAdapter {
  interface Live {
    onHeading: (raw: RawHeading) => void;
    onError: (reason: string) => void;
  }

  const live = new Set<Live>();
  let startCount = 0;
  let removeCount = 0;
  let failNext: { error: unknown } | null = null;
  let pending: (() => void)[] | null = null;

  return {
    async watchHeading(onHeading, onError) {
      startCount += 1;
      if (pending !== null) {
        await new Promise<void>((resolve) => pending?.push(resolve));
      }
      if (failNext !== null) {
        const { error } = failNext;
        failNext = null;
        throw error;
      }
      const entry: Live = { onHeading, onError };
      live.add(entry);
      return {
        remove() {
          if (live.delete(entry)) removeCount += 1;
        },
      };
    },
    emit(raw) {
      const event: RawHeading = {
        trueHeading: raw.trueHeading ?? NO_TRUE_HEADING,
        magHeading: raw.magHeading ?? NO_TRUE_HEADING,
        accuracy: raw.accuracy ?? 3,
        driftOffset: raw.driftOffset ?? 0,
      };
      for (const entry of [...live]) entry.onHeading(event);
    },
    emitError(reason) {
      for (const entry of [...live]) entry.onError(reason);
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

let defaultService: HeadingService | null = null;

/**
 * The app-wide service, created on first use so that no native module is touched at import.
 *
 * On Android the expo-location adapter is wrapped in `createNativeCompassAdapter` (D144), which
 * drives the needle from `TYPE_ROTATION_VECTOR` at 50 Hz through `modules/qibla-heading` and keeps
 * the wrapped adapter as its fallback. Both JS routes to an Android heading are capped at 5 Hz —
 * see that module's header — which is why the needle stepped there while iOS was smooth.
 *
 * iOS gets the bare adapter, unchanged and deliberately: `CLHeading` is already gyro-fused,
 * tilt-compensated and fast, which is why none of this was ever needed there.
 *
 * @returns The singleton {@link HeadingService} backed by {@link createExpoHeadingAdapter}.
 */
export function getHeadingService(): HeadingService {
  if (defaultService === null) {
    const base = createExpoHeadingAdapter();
    const adapter = Platform.OS === 'android' ? createNativeCompassAdapter(base) : base;
    defaultService = createHeadingService(adapter);
  }
  return defaultService;
}
