/**
 * `useHeading` — the Qibla screen's live compass.
 *
 * It owns the three things a screen cannot get from `services/heading.ts` on its own: the
 * subscription's *lifetime*, the split between what animates and what re-renders, and the
 * calibration prompt's hysteresis.
 *
 * ## The 60 fps / 6 Hz split (the reason this hook exists)
 *
 * A magnetometer fires tens of times a second. Turning each event into a React state update would
 * re-render the dial, the three info cards and the guidance card ~30 times a second — the exact
 * stutter the competition is criticised for. So the stream forks:
 *
 * - **{@link HeadingView.sharedHeading}** — a Reanimated `SharedValue` re-targeted on *every*
 *   sample with a spring ({@link HEADING_SPRING}), whose frames run on the UI thread
 *   (PRODUCT_SPEC §9, D15). Writing a shared value does not render React at all; the dial, needle
 *   and Makkah badge read it from `useAnimatedStyle` and keep tracking even while JS is busy. It
 *   carries the **continuous (unwrapped)** angle from `services/heading.createHeadingSmoother`, so
 *   a rotation driven from it can never take the long way round at the 0/360 wrap — no wrap
 *   handling is needed in the animation code, because the value simply never wraps.
 * - **{@link HeadingView.heading}** — ordinary React state, quantised to whole degrees and
 *   published at most once per {@link DEFAULT_HEADING_THROTTLE_MS} (~6.7 Hz), and only when the
 *   degree actually changed. This is the "96°" readout and the turn-left / turn-right guidance:
 *   numbers a human reads, which are *more* legible for updating calmly (every consumer rounds to
 *   whole degrees anyway). The final value of a movement is always published (the throttle has a
 *   trailing edge), so the text never rests one sample behind the needle.
 *
 * Both come from one smoother, so the number and the needle can never disagree.
 *
 * ## Why a spring, not a per-sample low-pass filter
 *
 * Both platforms deliver heading events **only on change**: iOS's `CLLocationManager` ships with a
 * 1° `headingFilter`, and expo-location's Android module drops anything under ~2° and 50 ms
 * (`LocationModule.kt`, `DEGREE_DELTA`/`TIME_DELTA`). An exponential filter that eases a fraction
 * towards each *event* therefore freezes the moment you stop turning — the events stop, the
 * remaining error is never removed, and the needle (and the readout) park visibly short of the
 * true heading until the next movement. Measured against expo's own gates: ~21° short after a
 * 90°/s turn under the Android gate, ~5° short under the iOS one. A spring animates towards the
 * *latest* target on its own clock, so it converges completely between events, smooths jitter, and
 * costs no JS after the retarget.
 *
 * ## Lifetime: the sensor is off unless someone is looking at it
 *
 * Battery drain is a recurring complaint about competing compasses, and a magnetometer left
 * running is a real cost. The subscription exists only while BOTH hold:
 *
 * - `options.enabled` — the screen's focus. The Qibla tab passes `useIsFocused()`; leaving the tab
 *   stops the sensor within a frame. (Focus is a *parameter* rather than something read here so
 *   the hook stays testable without a navigation container, and so a preview or a settings sheet
 *   can drive it however it likes.)
 * - The app is not backgrounded. Handled internally, on `AppState`. Only `background` stops it:
 *   iOS reports `inactive` for the app switcher and Control Center, where the dial is still on
 *   screen and must keep tracking.
 *
 * Stopping keeps the last heading on screen rather than blanking it — coming back to the tab
 * should resume the needle where it was, not swing it in from north — but reports `idle`, so the
 * UI can mark the reading stale if it wants to.
 *
 * ## Permission
 *
 * The compass needs foreground location permission (iOS refuses a true heading without it and
 * `watchHeadingAsync` throws; Android cannot compute declination without a fix and degrades to
 * magnetic). This hook **never prompts** — it reads `stores/locationStore` and reports
 * `permissionRequired`, leaving the ask to an explicit user action on the screen
 * (PRODUCT_SPEC §10). If the platform refuses anyway, the error path lands on the same status.
 *
 * ## Honesty
 *
 * {@link HeadingView.reference} says whether the reading is true-north or the magnetic fallback —
 * the Qibla bearing is true-north referenced, so a magnetic heading is off by the local
 * declination and the UI must say so rather than draw a confident wrong needle.
 * {@link HeadingView.confidence} and {@link HeadingView.needsCalibration} drive the accuracy dots
 * and the figure-8 prompt (PRODUCT_SPEC §9).
 *
 * Dependency rule: `hooks → stores + services + domain`. No SQL, no user-facing strings — every
 * value here is a machine enum the screen maps onto localized copy.
 */

import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { normalizeAngle, shortestAngleDelta } from '@/domain/qibla';
import {
  createHeadingSmoother,
  getHeadingService,
  type HeadingConfidence,
  type HeadingErrorCode,
  type HeadingReference,
  type HeadingSample,
  type HeadingService,
} from '@/services/heading';
import { useLocationPermission } from '@/stores/locationStore';

import type { NativeNeedleHandle } from '@/components/NativeNeedleSource';
import type { LocationPermissionStatus } from '@/services/location';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How often the numeric readout may update, in milliseconds. 150 ms ≈ 6.7 Hz — inside the 4–8 Hz
 * band where a changing number still reads as "live" but stops being a blur. The needle is not
 * affected: it moves on every sample, on the UI thread.
 */
export const DEFAULT_HEADING_THROTTLE_MS = 150;

/**
 * How the needle chases each new sample, on the UI thread. Tuned against the platforms'
 * change-gated event streams (≥1° iOS, ≥2°/50 ms Android): stiff enough that a 90°/s turn trails
 * by under ~10° and settles in ~200 ms once you stop, damped just under critical so the arrival
 * reads as a needle coming to rest, not a wobble. This spring — not a per-sample filter — is the
 * smoothing PRODUCT_SPEC §9 and D15 call for; see the module header for why the filter freezes.
 */
export const HEADING_SPRING = { stiffness: 300, damping: 30, mass: 1 } as const;

/**
 * Whether the needle is driven from the UI thread instead of by {@link HEADING_SPRING} (D145).
 *
 * Android only. The spring above is a second-order filter with **exactly 100 ms** of steady-state
 * lag (2ζ/ωn), which was invisible against a 5 Hz stream and dominant once D144 made the stream
 * fast — and the JS thread it was driven from could not deliver samples at a fixed rate anyway.
 * `components/NativeNeedleSource` bypasses both. iOS keeps the spring: `CLHeading` is fast, and
 * that path is the behaviour the owner calls perfect.
 */
export function needleRunsOnUiThread(): boolean {
  return Platform.OS === 'android';
}

/**
 * The hook's own smoothing default: `1`, i.e. **no** low-pass on the JS side. The smoother is kept
 * for its unwrapping (the continuous angle); the actual smoothing is {@link HEADING_SPRING}. A
 * fractional factor remains available to tests and previews via `options.smoothingFactor`.
 */
const RAW_SMOOTHING_FACTOR = 1;

/**
 * How long the accuracy must stay poor before the figure-8 prompt appears.
 *
 * Android does not necessarily deliver `onAccuracyChanged` before the first heading event, so a
 * perfectly healthy device can open the tab reporting `unavailable` for a few hundred
 * milliseconds. Without this grace period every visit to the Qibla tab would flash a calibration
 * prompt at the user, which is both wrong and the kind of noise that trains people to ignore it.
 * Recovery is not delayed: the prompt disappears the instant accuracy improves.
 */
export const DEFAULT_CALIBRATION_GRACE_MS = 1500;

/**
 * How long a live session may go without a sample before the reading is treated as stale.
 *
 * Both platforms deliver heading events only on change, but a hand is never still enough to go
 * three seconds without crossing the 1–2° gates — a session this quiet has almost always died
 * silently instead. The verified case is Android under magnetic interference:
 * `SensorManager.getRotationMatrix` starts returning `false` near a magnet or a laptop hinge and
 * expo-location simply stops emitting, leaving the needle frozen on the last sample while the
 * screen still claims an `active`, `high`-confidence compass. Staleness therefore flips the
 * *existing* `needsCalibration` machinery — interference is exactly what the figure-8 card's
 * "away from magnets and metal" copy treats — and the first sample that arrives afterwards
 * clears it through the usual quick-to-forgive path.
 */
export const STALE_HEADING_MS = 3000;

// ---------------------------------------------------------------------------
// iOS: the heading is measured against the top of the DEVICE
// ---------------------------------------------------------------------------

/**
 * Turns a whole sample by `offsetDeg`, keeping every angle in it consistent with the others.
 *
 * All three angles move together on purpose: the readout reads {@link HeadingSample.heading}, the
 * needle's declination is the gap between the other two, and a correction applied to one of them
 * alone would open a gap that is not there.
 *
 * @param sample - The sample as the platform reported it.
 * @param offsetDeg - Degrees to add. `0` returns the sample untouched, allocating nothing.
 */
function turnSample(sample: HeadingSample, offsetDeg: number): HeadingSample {
  if (offsetDeg === 0) return sample;
  return {
    ...sample,
    heading: normalizeAngle(sample.heading + offsetDeg),
    trueHeading:
      sample.trueHeading === null ? null : normalizeAngle(sample.trueHeading + offsetDeg),
    magneticHeading:
      sample.magneticHeading === null ? null : normalizeAngle(sample.magneticHeading + offsetDeg),
  };
}

/**
 * How far the *interface* is turned from the device, in degrees, on iOS.
 *
 * `CLHeading` is measured against the top of the **device**, always: `CLLocationManager` has a
 * `headingOrientation` property for exactly this, and `expo-location` never sets it
 * (`BaseLocationProvider.swift` configures the accuracy, the distance filter and the delegate, and
 * nothing else), so it keeps Apple's default of portrait. The app cannot reach that manager.
 *
 * That is correct everywhere the interface is portrait — which is everywhere on an iPhone. On an
 * **iPad** it is not: with `supportsTablet`, prebuild writes all four orientations into
 * `UISupportedInterfaceOrientations~ipad` whatever `orientation` says for the phone, and an iPad
 * honours them. Turned, the interface rotates while the heading does not, so the dial, the
 * readout, the turn-by guidance and the alignment haptic would all be out by the same angle — the
 * one failure this tab cannot have, and one the landscape glance dial (D124) meets every time an
 * iPad is used on its side.
 *
 * The offsets follow from where the *device top* has gone, since that is what `CLHeading` measures:
 * - `PORTRAIT_DOWN` — the top points behind the user: +180.
 * - `LANDSCAPE_LEFT` (`UIInterfaceOrientationLandscapeLeft`, home button on the LEFT) — the top
 *   points to the user's right, so the user faces 90° anticlockwise of it: −90.
 * - `LANDSCAPE_RIGHT` (home button on the right) — the top points left: +90.
 *
 * Android needs none of this: both Android paths remap for the display rotation themselves.
 *
 * @param orientation - What `expo-screen-orientation` last reported.
 */
function interfaceOffsetDegrees(orientation: ScreenOrientation.Orientation): number {
  switch (orientation) {
    case ScreenOrientation.Orientation.PORTRAIT_DOWN:
      return 180;
    case ScreenOrientation.Orientation.LANDSCAPE_LEFT:
      return -90;
    case ScreenOrientation.Orientation.LANDSCAPE_RIGHT:
      return 90;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * What the compass is doing. Distinct from `confidence`, which is how good the readings are.
 *
 * - `idle`               — not subscribed: the tab is unfocused or the app is backgrounded. Any
 *                          heading still shown is the last one read.
 * - `permissionRequired` — foreground location permission is not granted, so there is no heading
 *                          to read. The screen should offer to ask (or to open OS settings).
 * - `starting`           — subscribed, waiting for the first usable sample.
 * - `active`             — samples are arriving.
 * - `unavailable`        — the platform refused: no compass on this device, or the stream died.
 */
export const HEADING_STATUSES = [
  'idle',
  'permissionRequired',
  'starting',
  'active',
  'unavailable',
] as const;
export type HeadingStatus = (typeof HEADING_STATUSES)[number];

/** Options for {@link useHeading}. All optional; the defaults are the production ones. */
export interface UseHeadingOptions {
  /**
   * Whether the screen wants the sensor on — normally `useIsFocused()`. Defaults to `true`.
   * The app's foreground state is ANDed with this internally; a backgrounded app never watches.
   */
  enabled?: boolean;
  /**
   * Low-pass weight; see `services/heading.createHeadingSmoother`. Defaults to `1` (no JS-side
   * filtering — {@link HEADING_SPRING} does the smoothing); see the module header for why a
   * per-sample filter is wrong for a change-gated sensor stream.
   */
  smoothingFactor?: number;
  /** Minimum gap between numeric-readout updates. See {@link DEFAULT_HEADING_THROTTLE_MS}. */
  throttleMs?: number;
  /** How long poor accuracy must persist before `needsCalibration` flips. */
  calibrationGraceMs?: number;
  /** How long a live session may go silent before it is treated as stale. See {@link STALE_HEADING_MS}. */
  staleAfterMs?: number;
  /**
   * Where the phone is, used only to turn a magnetic heading into a true one.
   *
   * Android's rotation vector knows its angle to *magnetic* north and nothing about declination,
   * so `modules/qibla-heading` needs coordinates to compute one (D144). Pass the same location the
   * qibla bearing is computed from. Without it the needle reads against magnetic north — a
   * degraded mode the screen already discloses, and the same one a denied location produces.
   *
   * iOS ignores this: `CLHeading` resolves its own fix natively.
   */
  location?: { latitude: number; longitude: number } | null;
  /** Injected for tests. Defaults to the app-wide `expo-location`-backed service. */
  service?: HeadingService;
}

/** Everything the Qibla screen reads. */
export interface HeadingView {
  /** What the compass is doing. See {@link HeadingStatus}. */
  status: HeadingStatus;
  /**
   * The heading in whole degrees in `[0, 360)`, throttled to ~6.7 Hz and published only when the
   * degree changes, or `null` before the first fix. For text and arithmetic; drive animations
   * from {@link sharedHeading}.
   */
  heading: number | null;
  /**
   * The heading as a **continuous** angle (may exceed 360 or go negative), spring-animated on the
   * UI thread towards every sensor sample ({@link HEADING_SPRING}) without rendering React. Read
   * it inside `useAnimatedStyle`; because the target never wraps, `rotate` interpolation always
   * takes the short arc.
   */
  sharedHeading: SharedValue<number>;
  /** Which north the reading is measured against, or `null` before the first fix. */
  reference: HeadingReference | null;
  /**
   * `true` when the platform could only give a magnetic heading. The Qibla bearing is
   * true-north referenced, so the UI must disclose this rather than imply a precision it lacks.
   */
  isMagneticFallback: boolean;
  /** How much to believe the reading. `unavailable` until the first sample. */
  confidence: HeadingConfidence;
  /** `true` when the figure-8 calibration prompt should be shown. */
  needsCalibration: boolean;
  /** `true` once a heading has been read at least once this session. */
  hasFix: boolean;
  /** The OS location permission, as `locationStore` last saw it. Nothing here prompts. */
  permission: LocationPermissionStatus;
  /** `false` when the OS will not prompt again — the UI must offer "Open Settings" instead. */
  canAskAgain: boolean;
  /** Why the sensor is unavailable, or `null`. */
  error: HeadingErrorCode | null;
  /**
   * Android only, and `null` whenever the sensor should be off.
   *
   * Render `<NativeNeedleSource source={…} />` for exactly as long as this is non-null: mounting is
   * what starts the UI-thread rotation-vector stream that drives the needle, and unmounting is what
   * stops it (D145). `null` on iOS, without permission, and while the tab is away or the app is
   * backgrounded — so a screen that honours it can never leave the sensor running.
   */
  nativeNeedle: NativeNeedleHandle | null;
}

/**
 * What one subscription has learnt so far — everything the sensor itself reports, as opposed to
 * what the app already knew (focus, permission).
 *
 * It is tagged with the `session` token that was current when it was written. That tag is what
 * lets a *new* subscription start from a clean slate without the effect setting state on mount:
 * the render simply ignores a reading belonging to a session that has ended. Reporting `active`
 * off a previous session's sample — a stale claim about a sensor that may not even have started —
 * is exactly the kind of small lie this screen cannot afford.
 */
interface SensorState {
  session: object;
  reference: HeadingReference | null;
  confidence: HeadingConfidence;
  error: HeadingErrorCode | null;
  /** `true` once this session has produced a usable sample. */
  hasSample: boolean;
  needsCalibration: boolean;
}

const BLANK_SENSOR = {
  reference: null,
  confidence: 'unavailable',
  error: null,
  hasSample: false,
  needsCalibration: false,
} as const satisfies Omit<SensorState, 'session'>;

function sameSensor(a: SensorState, b: SensorState): boolean {
  return (
    a.session === b.session &&
    a.reference === b.reference &&
    a.confidence === b.confidence &&
    a.error === b.error &&
    a.hasSample === b.hasSample &&
    a.needsCalibration === b.needsCalibration
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to the device compass for as long as the screen is focused and the app is in the
 * foreground.
 *
 * @param options - See {@link UseHeadingOptions}; pass `enabled: useIsFocused()` from a screen.
 * @returns A {@link HeadingView}. Safe to call without permission and on devices with no compass
 * — every field degrades to a `null`/`unavailable` state the screen can render.
 */
export function useHeading(options: UseHeadingOptions = {}): HeadingView {
  const {
    enabled = true,
    smoothingFactor = RAW_SMOOTHING_FACTOR,
    throttleMs = DEFAULT_HEADING_THROTTLE_MS,
    calibrationGraceMs = DEFAULT_CALIBRATION_GRACE_MS,
    staleAfterMs = STALE_HEADING_MS,
    location = null,
    service: injectedService,
  } = options;

  const { permission, canAskAgain } = useLocationPermission();
  // Resolved lazily so importing this hook never touches `expo-location`.
  const service = useMemo(() => injectedService ?? getHeadingService(), [injectedService]);

  // Declination, not subscription: pushed straight down to the adapter rather than folded into
  // `session`, so moving does not tear down and restart the sensor. Depending on the two numbers
  // rather than the object keeps a store that rebuilds its location on every write from
  // re-running this every time.
  const latitude = location?.latitude ?? null;
  const longitude = location?.longitude ?? null;
  useEffect(() => {
    service.setLocation(
      latitude === null || longitude === null ? null : { latitude, longitude }
    );
  }, [service, latitude, longitude]);

  const sharedHeading = useSharedValue(0);
  // Read by the UI-thread needle, written here: declination moves with the user's location, not
  // with the phone's orientation, so it belongs on the slow side of the seam.
  const declination = useSharedValue(0);
  // Read by the UI-thread needle for the same reason as declination, and written the same way: the
  // drift correction the Android module has already folded into the numbers on this side. The
  // worklet reads the fused sensor directly, so it is the one path the correction does not reach on
  // its own. Zero everywhere else, and zero on Android whenever nothing is being corrected.
  const needleOffset = useSharedValue(0);
  // `1` once the UI-thread stream has spoken. Until then — and forever, on a device whose rotation
  // vector never reports — the JS path below keeps driving the needle exactly as it did before.
  const nativeNeedleAlive = useSharedValue(0);
  // The numeric readout deliberately OUTLIVES a session: leaving the tab and coming back should
  // resume the needle where it was rather than blank the dial.
  const [heading, setHeading] = useState<number | null>(null);
  // Read inside the sensor callback, where a state value would always be one render stale.
  const calibrationRef = useRef(false);

  // How far the interface is turned from the device on iOS; see {@link interfaceOffsetDegrees}.
  // A ref rather than state: it is read inside the sensor callback, where a state value would
  // always be one render stale, and it must never cost a render of its own.
  const interfaceOffset = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let watching = true;
    const apply = (orientation: ScreenOrientation.Orientation) => {
      if (watching) interfaceOffset.current = interfaceOffsetDegrees(orientation);
    };
    let subscription: { remove(): void } | null = null;
    try {
      void ScreenOrientation.getOrientationAsync().then(apply, () => {
        // An OS that will not answer leaves the offset at 0 — portrait, which is the common case
        // and the one every iPhone is locked to anyway.
      });
      subscription = ScreenOrientation.addOrientationChangeListener((event) => {
        apply(event.orientationInfo.orientation);
      });
    } catch {
      // Same answer: no correction rather than no compass. Nothing here may cost the tab its dial.
    }
    return () => {
      watching = false;
      try {
        subscription?.remove();
      } catch {
        // A listener that will not come off is one the OS never really registered.
      }
    };
  }, []);

  // The app's foreground state. `inactive` (app switcher, Control Center) keeps the sensor on —
  // the dial is still visible there; only a real background stop is worth the interruption.
  const [isForeground, setIsForeground] = useState(() => AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      setIsForeground(state !== 'background');
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const active = enabled && isForeground;
  const granted = permission === 'granted';

  // Identity of the current subscription: a fresh token every time the effect below will
  // resubscribe. Comparing it during render is what lets a new session start from a blank slate
  // WITHOUT the effect setting state on mount (which would cost a cascading render on every
  // focus change). See {@link SensorState}.
  const session = useMemo(
    () => ({}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the identity IS the value
    [active, granted, service, smoothingFactor, throttleMs, calibrationGraceMs, staleAfterMs]
  );
  const [reported, setReported] = useState<SensorState>(() => ({ session, ...BLANK_SENSOR }));
  // Anything the previous subscription reported is not evidence about this one.
  const sensor: SensorState =
    reported.session === session ? reported : { session, ...BLANK_SENSOR };

  useEffect(() => {
    // Not watching: the last heading stays on screen, but nothing claims to be live.
    if (!active || !granted) {
      calibrationRef.current = false;
      return;
    }

    let alive = true;
    const smoother = createHeadingSmoother(smoothingFactor);
    const gap = Number.isFinite(throttleMs) && throttleMs > 0 ? throttleMs : 0;
    const grace =
      Number.isFinite(calibrationGraceMs) && calibrationGraceMs > 0 ? calibrationGraceMs : 0;

    const staleMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : 0;

    let lastPublishedAt = Number.NEGATIVE_INFINITY;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    let calibrationTimer: ReturnType<typeof setTimeout> | null = null;
    let staleWatchdog: ReturnType<typeof setInterval> | null = null;
    /** When the last sample arrived. Read by the watchdog; written on every sample. */
    let lastSampleAt = 0;
    /** The last value written across to the UI thread, so identical ones are not written again. */
    let lastDeclination = Number.NaN;
    /** Likewise for the drift correction, which is 0 for whole sessions at a time. */
    let lastNeedleOffset = Number.NaN;
    // The session's own view of what it has reported, so each update can be built from the last
    // one without reading (and therefore depending on) React state.
    let current: SensorState = { session, ...BLANK_SENSOR };

    const clearPublishTimer = () => {
      if (publishTimer !== null) {
        clearTimeout(publishTimer);
        publishTimer = null;
      }
    };
    const clearCalibrationTimer = () => {
      if (calibrationTimer !== null) {
        clearTimeout(calibrationTimer);
        calibrationTimer = null;
      }
    };
    const clearStaleWatchdog = () => {
      if (staleWatchdog !== null) {
        clearInterval(staleWatchdog);
        staleWatchdog = null;
      }
    };
    /**
     * Arms the silent-stream watchdog. See {@link STALE_HEADING_MS}.
     *
     * One interval for the whole session, checking a timestamp — rather than a `setTimeout` torn
     * down and rebuilt on every sample, which on Android meant fifty timer allocations a second on
     * the JS thread for a check that fires at most once. It polls at half the stale window, so
     * silence is noticed somewhere between one and one and a half windows: the same behaviour, an
     * interval later at worst, and nothing the user can perceive in a card that takes 1.2 s of
     * sustained trouble to appear anyway.
     */
    const armStaleWatchdog = () => {
      if (staleMs === 0) return;
      staleWatchdog = setInterval(
        () => {
          if (!alive || !current.hasSample) return;
          if (Date.now() - lastSampleAt < staleMs) return;
          calibrationRef.current = true;
          report({ ...current, needsCalibration: true });
        },
        Math.max(1, Math.round(staleMs / 2))
      );
    };

    /** Publishes a sensor-state change, and only when it really is a change. */
    const report = (next: SensorState) => {
      if (!alive || sameSensor(current, next)) return;
      current = next;
      setReported(next);
    };

    /**
     * The one place the numeric readout is written. `alive` is the unmount guard. Quantised to
     * whole degrees — every consumer rounds anyway — so sub-degree drift re-renders nothing.
     */
    let lastPublished: number | null = null;
    const publish = (value: number) => {
      if (!alive) return;
      lastPublishedAt = Date.now();
      const degrees = Math.round(normalizeAngle(value)) % 360;
      if (degrees === lastPublished) return;
      lastPublished = degrees;
      setHeading(degrees);
    };

    calibrationRef.current = false;

    // Whether THIS session has already aimed the needle once. The first sample of a session snaps
    // (there is nothing meaningful to animate from — the dial is either blank or showing another
    // session's angle); every later sample re-targets the spring.
    let aimed = false;

    armStaleWatchdog();

    const subscription = service.watch(
      (raw) => {
        if (!alive) return;
        lastSampleAt = Date.now();

        // Everything downstream — the readout, the needle, the turn-by guidance, the alignment
        // haptic — reads the sample from here on, so the interface's own rotation is answered once,
        // at the door. Off iOS, and in portrait, this is the same object.
        const sample = turnSample(raw, interfaceOffset.current);

        // Declination changes with where you are, not with how you are holding the phone, so it
        // crosses to the UI thread here rather than being recomputed per frame — and only when it
        // has actually changed, which is when the location has. A sample with no true heading
        // (the location was cleared, or never arrived) puts it back to zero: the readout drops to
        // magnetic at the same moment, and a needle still quietly adding declination would sit up
        // to 20° away from the number printed beside it.
        const nextDeclination =
          sample.trueHeading !== null && sample.magneticHeading !== null
            ? shortestAngleDelta(sample.magneticHeading, sample.trueHeading)
            : 0;
        if (nextDeclination !== lastDeclination) {
          lastDeclination = nextDeclination;
          declination.set(nextDeclination);
        }

        // The Android drift correction, on the same terms: it moves with the sensor's own anchor
        // rather than with the phone's orientation, it is already inside every angle on this side,
        // and it crosses only when it changes. The module ramps it, so it arrives as a slow slide
        // and the needle and the readout land together.
        if (sample.needleOffset !== lastNeedleOffset) {
          lastNeedleOffset = sample.needleOffset;
          needleOffset.set(sample.needleOffset);
        }

        const smoothed = smoother.push(sample.heading);

        // On Android the needle is driven from the UI thread instead (D145) — but only once that
        // stream has actually produced a sample. Until it does, and on any device where it never
        // does, this is still the needle.
        if (nativeNeedleAlive.get() === 0) {
          // Straight into the shared value: this costs no render at all. The spring's frames run
          // on the UI thread; JS only moves the target.
          if (aimed) {
            sharedHeading.set(withSpring(smoothed.continuous, HEADING_SPRING));
          } else {
            aimed = true;
            sharedHeading.set(smoothed.continuous);
          }
        }

        // Calibration hysteresis: slow to complain, quick to forgive.
        if (sample.needsCalibration) {
          if (!calibrationRef.current && calibrationTimer === null) {
            calibrationTimer = setTimeout(() => {
              calibrationTimer = null;
              if (!alive) return;
              calibrationRef.current = true;
              report({ ...current, needsCalibration: true });
            }, grace);
          }
        } else {
          clearCalibrationTimer();
          calibrationRef.current = false;
        }

        report({
          session,
          reference: sample.reference,
          confidence: sample.confidence,
          error: null,
          hasSample: true,
          needsCalibration: calibrationRef.current,
        });

        // Throttled readout, with a trailing edge so the resting value is always the true one.
        const elapsed = Date.now() - lastPublishedAt;
        if (elapsed >= gap) {
          clearPublishTimer();
          publish(smoothed.heading);
        } else if (publishTimer === null) {
          publishTimer = setTimeout(() => {
            publishTimer = null;
            publish(smoother.heading);
          }, gap - elapsed);
        }
      },
      {
        onError: (code) => {
          clearCalibrationTimer();
          clearStaleWatchdog();
          calibrationRef.current = false;
          report({ session, ...BLANK_SENSOR, error: code });
        },
      }
    );

    return () => {
      // Order matters: stop the sensor first, then refuse anything already in flight.
      subscription.remove();
      alive = false;
      // The UI-thread stream is torn down alongside this one (its component unmounts with the same
      // gate), so the next session has to prove itself again rather than inherit a stale claim.
      nativeNeedleAlive.set(0);
      // The correction belongs to the sensor session that measured it: the native module throws its
      // own away on every registration, so a needle still adding it would be alone in remembering.
      needleOffset.set(0);
      clearPublishTimer();
      clearCalibrationTimer();
      clearStaleWatchdog();
      smoother.reset();
    };
  }, [
    session,
    active,
    granted,
    service,
    smoothingFactor,
    throttleMs,
    calibrationGraceMs,
    staleAfterMs,
    sharedHeading,
    declination,
    needleOffset,
    nativeNeedleAlive,
  ]);

  const status: HeadingStatus = !active
    ? 'idle'
    : sensor.error === 'permissionDenied' || !granted
      ? 'permissionRequired'
      : sensor.error !== null
        ? 'unavailable'
        : sensor.hasSample
          ? 'active'
          : 'starting';

  // Non-null only while the sensor should actually be running. The screens mount
  // `<NativeNeedleSource>` against this, so the gate below IS the sensor's on/off switch.
  const nativeNeedle = useMemo<NativeNeedleHandle | null>(
    () =>
      needleRunsOnUiThread() && active && granted
        ? { heading: sharedHeading, declination, offset: needleOffset, alive: nativeNeedleAlive }
        : null,
    [active, granted, sharedHeading, declination, needleOffset, nativeNeedleAlive]
  );

  return {
    status,
    heading,
    sharedHeading,
    nativeNeedle,
    reference: sensor.reference,
    isMagneticFallback: sensor.reference === 'magnetic',
    confidence: sensor.confidence,
    needsCalibration: sensor.needsCalibration,
    hasFix: heading !== null,
    permission,
    canAskAgain,
    error: sensor.error,
  };
}
