/**
 * `useTilt` — is the phone being held like a compass, or like a phone call?
 *
 * The Qibla screen's one tilt consumer. It owns the same three things `useHeading` owns for the
 * compass: the accelerometer subscription's *lifetime* (focused tab + foregrounded app, nothing
 * else), the translation of raw samples into one calm boolean, and the time-based half of the
 * anti-chatter (the angle-based half lives in `domain/tilt`'s gate).
 *
 * ## One boolean, three layers of calm
 *
 * A hint that flickers trains people to ignore it, so `isTilted` may only change slowly:
 *
 * 1. `domain/tilt.createGravityFilter` — an EMA over the gravity vector with a magnitude guard,
 *    so hand-shake and bumps never reach the angle.
 * 2. `domain/tilt.createTiltGate` — engage ≥ {@link DEFAULT_TILT_ENGAGE_DEG}°, release under
 *    {@link DEFAULT_TILT_RELEASE_DEG}° (from `domain/tilt`), so the threshold cannot chatter.
 * 3. This hook — the gate must hold for {@link TILT_SUSTAIN_MS} before the hint appears
 *    ("slow to complain"), and it disappears on the first sample back under the release line
 *    ("quick to forgive") — the same shape as `useHeading`'s calibration grace.
 *
 * ## The face-down warning rides the same stream (D172)
 *
 * `isFaceDown` is the same three layers over the same filtered gravity vector, gated by
 * `domain/tilt.createFaceDownGate` (engage at ≤ 45° from straight down, release past 60°). A
 * screen facing the floor views the horizontal plane from below, so the dial's north–south sense
 * is mirrored there; the owner chose a warning over a mirrored dial. The two booleans never
 * both hold in the steady state — a face-down phone is flat, not tilted — but the screen shows
 * the face-down words first if they ever overlap in a transition.
 *
 * ## Absence costs nothing (D38)
 *
 * No accelerometer, a sensor that refuses to start, or one that claims to exist and then never
 * speaks ({@link TILT_SILENT_START_MS}): `available` goes `false`, `isTilted` stays `false`,
 * and the screen renders exactly what it rendered before this feature existed. Nothing here
 * throws, prompts, or blocks.
 */

import { useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { createFaceDownGate, createGravityFilter, createTiltGate } from '@/domain/tilt';
import { getTiltService, type TiltService } from '@/services/tilt';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How long the tilt gate must stay engaged before the hint appears. A phone is often carried
 * through steep angles for a moment — picked up, glanced at, put down — and a hint that
 * appears during the pick-up would be noise. 1.2 s is long enough to mean "this is how the
 * phone is being *held*", short enough that the hint still feels connected to the posture.
 */
export const TILT_SUSTAIN_MS = 1200;

/**
 * How long a freshly started stream may stay silent before the hook stands down for the
 * session. Some devices report an accelerometer that then never delivers (OEM power
 * management, a broken sensor); waiting on it forever would keep a claim alive that nothing
 * backs. Four seconds is many delivery intervals at the sensor's ~5 Hz.
 */
export const TILT_SILENT_START_MS = 4000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link useTilt}. All optional; the defaults are the production ones. */
export interface UseTiltOptions {
  /**
   * Whether the screen wants the sensor on — normally `useIsFocused()` (ANDed with a gate on
   * the compass being live, so tilt never outruns the heading it advises on). Defaults to
   * `true`. The app's foreground state is ANDed internally.
   */
  enabled?: boolean;
  /** How long the gate must hold before the hint shows. See {@link TILT_SUSTAIN_MS}. */
  sustainMs?: number;
  /** Injected for tests. Defaults to the app-wide `expo-sensors`-backed service. */
  service?: TiltService;
}

/** Everything the Qibla screen reads. */
export interface TiltView {
  /** `true` while the phone is held steeply enough that the hint should show. */
  isTilted: boolean;
  /** `true` while the screen has faced the floor long enough that the warning should show. */
  isFaceDown: boolean;
  /**
   * `false` once this session has learnt the accelerometer cannot be used — missing, refused,
   * or silent. Purely informational: `isTilted` is already `false` in every such case.
   */
  available: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Watches the accelerometer for as long as the screen is focused and the app is foregrounded,
 * and answers with one calm boolean.
 *
 * @param options - See {@link UseTiltOptions}; pass `enabled` from focus + compass state.
 * @returns A {@link TiltView}. Safe on devices with no accelerometer — it degrades to
 *   `{ isTilted: false, available: false }` and stays there.
 */
export function useTilt(options: UseTiltOptions = {}): TiltView {
  const { enabled = true, sustainMs = TILT_SUSTAIN_MS, service: injectedService } = options;

  // Resolved lazily so importing this hook never touches `expo-sensors`.
  const service = useMemo(() => injectedService ?? getTiltService(), [injectedService]);

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

  // Identity of the current subscription — the same trick as `useHeading`'s SensorState: a
  // fresh token per (re)subscription lets the render ignore a previous session's claim without
  // the effect ever calling setState synchronously. Off screen the posture is unknowable, so a
  // dead session's `true` must never be re-shown on refocus.
  const session = useMemo(
    () => ({}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the identity IS the value
    [active, service, sustainMs]
  );
  const [tilted, setTilted] = useState<{ session: object; value: boolean }>(() => ({
    session,
    value: false,
  }));
  const [faceDown, setFaceDown] = useState<{ session: object; value: boolean }>(() => ({
    session,
    value: false,
  }));
  const [available, setAvailable] = useState(true);
  const isTilted = active && tilted.session === session ? tilted.value : false;
  const isFaceDown = active && faceDown.session === session ? faceDown.value : false;

  useEffect(() => {
    if (!active) return;

    let alive = true;
    const filter = createGravityFilter();
    const gate = createTiltGate();
    const faceDownGate = createFaceDownGate();
    const sustain = Number.isFinite(sustainMs) && sustainMs > 0 ? sustainMs : 0;

    let sustainTimer: ReturnType<typeof setTimeout> | null = null;
    let faceDownTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let shown = false;
    let faceDownShown = false;

    const clearSustainTimer = () => {
      if (sustainTimer !== null) {
        clearTimeout(sustainTimer);
        sustainTimer = null;
      }
    };
    const clearFaceDownTimer = () => {
      if (faceDownTimer !== null) {
        clearTimeout(faceDownTimer);
        faceDownTimer = null;
      }
    };
    const clearSilenceTimer = () => {
      if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    };

    const standDown = () => {
      if (!alive) return;
      clearSustainTimer();
      clearFaceDownTimer();
      clearSilenceTimer();
      shown = false;
      faceDownShown = false;
      setTilted({ session, value: false });
      setFaceDown({ session, value: false });
      setAvailable(false);
      subscription.remove();
    };

    // A sensor that never says anything is not a sensor. See {@link TILT_SILENT_START_MS}.
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      standDown();
    }, TILT_SILENT_START_MS);

    const subscription = service.watch(
      (sample) => {
        if (!alive) return;
        clearSilenceTimer();
        setAvailable(true);

        const engaged = gate.push(filter.push(sample.x, sample.y, sample.z));
        if (engaged) {
          if (!shown && sustainTimer === null) {
            sustainTimer = setTimeout(() => {
              sustainTimer = null;
              if (!alive || !gate.engaged) return;
              shown = true;
              setTilted({ session, value: true });
            }, sustain);
          }
        } else {
          clearSustainTimer();
          if (shown) {
            shown = false;
            setTilted({ session, value: false });
          }
        }

        // The face-down warning: same filtered vector, its own gate and its own sustain — slow
        // to complain (a phone rolled over for a moment says nothing), quick to forgive.
        const facing = faceDownGate.push(filter.faceDown);
        if (facing) {
          if (!faceDownShown && faceDownTimer === null) {
            faceDownTimer = setTimeout(() => {
              faceDownTimer = null;
              if (!alive || !faceDownGate.engaged) return;
              faceDownShown = true;
              setFaceDown({ session, value: true });
            }, sustain);
          }
        } else {
          clearFaceDownTimer();
          if (faceDownShown) {
            faceDownShown = false;
            setFaceDown({ session, value: false });
          }
        }
      },
      { onUnavailable: standDown }
    );

    return () => {
      // Order matters: stop the sensor first, then refuse anything already in flight.
      subscription.remove();
      alive = false;
      clearSustainTimer();
      clearFaceDownTimer();
      clearSilenceTimer();
      filter.reset();
      gate.reset();
      faceDownGate.reset();
    };
  }, [session, active, service, sustainMs]);

  return { isTilted, isFaceDown, available };
}
