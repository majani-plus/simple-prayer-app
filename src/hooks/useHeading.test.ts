/**
 * Tests for `useHeading`.
 *
 * The sensor is a `createFakeHeadingAdapter` driven by hand, so no native module is touched, and
 * the location store is mocked down to the one thing this hook reads from it — the permission —
 * because pulling the real store in would drag MMKV and `expo-location` along with it.
 *
 * The cases that matter are the ones a screen cannot check for itself:
 *
 * - the needle (a shared value) moves on EVERY sample while the numeric readout is throttled to
 *   ~6.7 Hz — the 60 fps / 6 Hz split the whole tab's smoothness rests on;
 * - the shared value never wraps, so a Reanimated rotation cannot spin the long way round;
 * - the sensor is off whenever the tab is unfocused or the app is backgrounded (battery is a
 *   competitor complaint, PRODUCT_SPEC §9);
 * - nothing sets state after unmount.
 */

import { act, renderHook } from '@testing-library/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import {
  createFakeHeadingAdapter,
  createHeadingService,
  type FakeHeadingAdapter,
  type HeadingService,
} from '@/services/heading';

import {
  DEFAULT_CALIBRATION_GRACE_MS,
  STALE_HEADING_MS,
  useHeading,
  type UseHeadingOptions,
} from './useHeading';

// The only thing the hook reads from the store; the real one opens MMKV.
const mockPermission = { permission: 'granted' as string, canAskAgain: true };
jest.mock('@/stores/locationStore', () => ({
  useLocationPermission: () => mockPermission,
}));

/**
 * The iPad half turn (`CLHeading` is portrait-referenced and expo-location never says otherwise).
 * jest-expo's stub answers `addOrientationChangeListener` with a promise and no `remove`, which is
 * not a subscription; this is the shape the real module has.
 */
jest.mock('expo-screen-orientation', () => ({
  Orientation: { UNKNOWN: 0, PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
  getOrientationAsync: jest.fn(() => Promise.resolve(1)),
  addOrientationChangeListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const getOrientationAsync = ScreenOrientation.getOrientationAsync as jest.Mock;
const addOrientationChangeListener = ScreenOrientation.addOrientationChangeListener as jest.Mock;

/** Delivers a rotation the way the OS does, to whichever listener the hook registered. */
async function emitOrientation(orientation: ScreenOrientation.Orientation): Promise<void> {
  await act(async () => {
    for (const [listener] of addOrientationChangeListener.mock.calls) {
      (listener as (event: { orientationInfo: { orientation: number } }) => void)({
        orientationInfo: { orientation },
      });
    }
  });
}

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

async function emitAppState(state: AppStateStatus) {
  (AppState as { currentState: AppStateStatus }).currentState = state;
  await act(async () => {
    for (const listener of [...appStateListeners]) listener(state);
  });
}

let adapter: FakeHeadingAdapter;
let service: HeadingService;

beforeEach(() => {
  mockPermission.permission = 'granted';
  mockPermission.canAskAgain = true;
  getOrientationAsync.mockClear();
  getOrientationAsync.mockResolvedValue(ScreenOrientation.Orientation.PORTRAIT_UP);
  addOrientationChangeListener.mockClear();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });
  (AppState as { currentState: AppStateStatus }).currentState = 'active';
  adapter = createFakeHeadingAdapter();
  service = createHeadingService(adapter);
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 6, 2, 18, 40, 12, 0));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Renders the hook and lets the service's start promise resolve. */
async function mount(options: UseHeadingOptions = {}) {
  const view = await renderHook((props: UseHeadingOptions) => useHeading({ service, ...props }), {
    initialProps: options,
  });
  await act(async () => {});
  return view;
}

/** Emits one sensor sample and lets React settle. */
async function emit(trueHeading: number, accuracy = 3) {
  await act(async () => {
    adapter.emit({ trueHeading, magHeading: trueHeading, accuracy });
  });
}

/** Advances fake timers inside `act`, flushing whatever they schedule. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('useHeading lifecycle', () => {
  it('starts the sensor when focused and reports "starting" until the first sample', async () => {
    const { result } = await mount();

    expect(adapter.isWatching).toBe(true);
    expect(result.current.status).toBe('starting');
    expect(result.current.heading).toBeNull();
    expect(result.current.hasFix).toBe(false);

    await emit(96);
    expect(result.current.status).toBe('active');
    expect(result.current.heading).toBe(96);
    expect(result.current.hasFix).toBe(true);
  });

  it('never starts the sensor while the screen is unfocused', async () => {
    const { result } = await mount({ enabled: false });

    expect(adapter.startCount).toBe(0);
    expect(adapter.isWatching).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('stops the sensor when the screen loses focus, and restarts on return', async () => {
    const { result, rerender } = await mount({ enabled: true });
    await emit(96);

    await act(async () => rerender({ enabled: false }));
    expect(adapter.isWatching).toBe(false);
    expect(adapter.removeCount).toBe(1);
    expect(result.current.status).toBe('idle');
    // The last reading stays on screen: returning to the tab must not swing in from north.
    expect(result.current.heading).toBe(96);

    await act(async () => rerender({ enabled: true }));
    expect(adapter.isWatching).toBe(true);
    expect(adapter.startCount).toBe(2);
  });

  it("does not claim to be live off the previous session's sample", async () => {
    const { result, rerender } = await mount({ enabled: true });
    await emit(96);
    expect(result.current.status).toBe('active');
    expect(result.current.confidence).toBe('high');

    await act(async () => rerender({ enabled: false }));
    await act(async () => rerender({ enabled: true }));

    // Subscribed again, but nothing has been measured yet: the old reading is not evidence.
    expect(result.current.status).toBe('starting');
    expect(result.current.confidence).toBe('unavailable');
    expect(result.current.reference).toBeNull();
    // …while the needle keeps its position, so the dial does not swing in from north.
    expect(result.current.sharedHeading.get()).toBe(96);
  });

  it('stops the sensor when the app is backgrounded and restarts on foreground', async () => {
    const { result } = await mount();
    await emit(96);

    await emitAppState('background');
    expect(adapter.isWatching).toBe(false);
    expect(result.current.status).toBe('idle');

    await emitAppState('active');
    expect(adapter.isWatching).toBe(true);
  });

  it('keeps tracking through "inactive" — the app switcher still shows the dial', async () => {
    await mount();
    await emitAppState('inactive');
    expect(adapter.isWatching).toBe(true);
    expect(adapter.removeCount).toBe(0);
  });

  it('releases the sensor and the AppState listener on unmount', async () => {
    const { unmount } = await mount();
    expect(appStateListeners).toHaveLength(1);

    await act(async () => unmount());
    expect(adapter.isWatching).toBe(false);
    expect(adapter.removeCount).toBe(1);
    expect(appStateListeners).toHaveLength(0);
  });

  it('does not update state after unmount', async () => {
    const { result, unmount } = await mount();
    await emit(10);
    const before = result.current.heading;

    await act(async () => unmount());
    // Late events from a subscription the platform had not yet torn down.
    adapter.emit({ trueHeading: 200, magHeading: 200, accuracy: 3 });
    await advance(1000);

    // A trailing publish scheduled before the unmount must not fire either.
    expect(result.current.heading).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

describe('useHeading permission', () => {
  it('never touches the sensor without location permission, and says why', async () => {
    mockPermission.permission = 'denied';
    mockPermission.canAskAgain = false;
    const { result } = await mount();

    expect(adapter.startCount).toBe(0);
    expect(result.current.status).toBe('permissionRequired');
    expect(result.current.permission).toBe('denied');
    expect(result.current.canAskAgain).toBe(false);
  });

  it('does not prompt — it only reports what the location store knows', async () => {
    mockPermission.permission = 'undetermined';
    const { result } = await mount();

    expect(result.current.status).toBe('permissionRequired');
    expect(result.current.canAskAgain).toBe(true);
    expect(adapter.startCount).toBe(0);
  });

  it('reports a platform refusal as permissionRequired too', async () => {
    adapter.failNextStart(new Error('Missing location permissions'));
    const { result } = await mount();

    expect(result.current.status).toBe('permissionRequired');
    expect(result.current.error).toBe('permissionDenied');
  });

  it('reports a device with no compass as unavailable', async () => {
    adapter.failNextStart(new Error('Compass not available'));
    const { result } = await mount();

    expect(result.current.status).toBe('unavailable');
    expect(result.current.error).toBe('sensorUnavailable');
  });
});

// ---------------------------------------------------------------------------
// The 60 fps / 6 Hz split
// ---------------------------------------------------------------------------

describe('useHeading smoothing', () => {
  it('re-targets the needle on every sample while throttling the readout', async () => {
    const { result } = await mount({ smoothingFactor: 1, throttleMs: 150 });

    // The first sample of a session snaps — there is nothing meaningful to animate from — so the
    // shared value carries it synchronously, before any animation frame has run.
    await emit(100);
    expect(result.current.heading).toBe(100);
    expect(result.current.sharedHeading.get()).toBe(100);

    // Later samples drive a UI-thread spring towards the newest target (never asserted mid-flight
    // — the jest build settles on timer drain; what matters is where the needle comes to rest).
    jest.setSystemTime(Date.now() + 40);
    await emit(110);
    jest.setSystemTime(Date.now() + 40);
    await emit(120);

    // No animation frames have run yet: the text is still the value it was published with.
    expect(result.current.heading).toBe(100);

    // Draining the timers settles the spring on the LAST target — a per-sample filter would have
    // frozen short of it — and the trailing edge publishes the value the needle rests at.
    await advance(1000);
    expect(result.current.sharedHeading.get()).toBe(120);
    expect(result.current.heading).toBe(120);
  });

  it('publishes at ~6.7 Hz over a continuous stream', async () => {
    const { result } = await mount({ smoothingFactor: 1, throttleMs: 150 });
    const published: number[] = [];

    // One second of sensor at 20 Hz. (`advanceTimersByTime` moves `Date.now()` too.)
    for (let i = 1; i <= 20; i += 1) {
      await advance(50);
      await emit(i);
      if (published[published.length - 1] !== result.current.heading) {
        published.push(result.current.heading as number);
      }
    }

    // 20 samples in, well under 10 renders of the number out.
    expect(published.length).toBeGreaterThan(2);
    expect(published.length).toBeLessThanOrEqual(9);
    // Once the stream goes quiet the spring settles on the last sample exactly.
    await advance(1000);
    expect(result.current.sharedHeading.get()).toBe(20);
  });

  it('never wraps the animated value, so the needle cannot spin the long way round', async () => {
    const { result } = await mount({ smoothingFactor: 1, throttleMs: 0 });

    // Settle the spring after each sample: the needle must come to rest on the UNWRAPPED angle —
    // 2° after 359° is 362°, never a 357° sweep back through south.
    const continuous: number[] = [];
    for (const deg of [350, 356, 359, 2, 6, 11]) {
      await emit(deg);
      await advance(1000);
      continuous.push(result.current.sharedHeading.get());
    }

    expect(continuous).toEqual([350, 356, 359, 362, 366, 371]);
    // The readout stays a real compass bearing.
    expect(result.current.heading).toBe(11);
  });

  it('converges on the true heading after a turn stops (change-gated sensor stream)', async () => {
    // Both platforms deliver heading events ONLY on change (iOS ≥1°, Android ≥2°/50 ms), so when
    // the phone stops turning the events stop too. The per-sample low-pass this hook used to
    // default to froze ~20° short of the true heading under the Android gate — forever, since
    // convergence needed events that never came. The production default must not do that: once
    // the stream goes quiet, both the needle and the readout must rest on the LAST sample.
    const { result } = await mount(); // production defaults — no smoothingFactor
    // A 90°/s turn as the Android gate delivers it: one event per ~4.5°, 50 ms apart.
    for (let deg = 0; deg <= 90; deg += 4.5) {
      await emit(deg);
      await advance(50);
    }
    // The phone is now still: no further events. Only time passes.
    await advance(3000);

    expect(result.current.sharedHeading.get()).toBe(90);
    expect(result.current.heading).toBe(90);
  });

  it('damps jitter when a low-pass factor is asked for', async () => {
    const { result } = await mount({ smoothingFactor: 0.2, throttleMs: 0 });
    await emit(90);

    // Settled after each sample, so what is measured is the filter, not an unfinished spring.
    const values: number[] = [];
    for (const deg of [93, 87, 92, 88, 91, 89, 92, 88]) {
      await emit(deg);
      await advance(1000);
      values.push(result.current.sharedHeading.get());
    }

    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Honesty
// ---------------------------------------------------------------------------

describe('useHeading reporting', () => {
  it('flags the magnetic fallback', async () => {
    const { result } = await mount();

    await act(async () => {
      adapter.emit({ trueHeading: -1, magHeading: 91, accuracy: 3 });
    });

    expect(result.current.reference).toBe('magnetic');
    expect(result.current.isMagneticFallback).toBe(true);
    expect(result.current.heading).toBe(91);
  });

  it('reports a true heading as such', async () => {
    const { result } = await mount();
    await emit(96);
    expect(result.current.reference).toBe('true');
    expect(result.current.isMagneticFallback).toBe(false);
  });

  it('reports the confidence level', async () => {
    const { result } = await mount();

    await emit(96, 3);
    expect(result.current.confidence).toBe('high');
    await emit(96, 2);
    expect(result.current.confidence).toBe('medium');
    await emit(96, 1);
    expect(result.current.confidence).toBe('low');
    await emit(96, 0);
    expect(result.current.confidence).toBe('unavailable');
  });

  it('waits out the grace period before asking for a figure-8', async () => {
    const { result } = await mount();

    // Android can open the tab reporting `unavailable` before onAccuracyChanged has fired.
    await emit(96, 0);
    expect(result.current.needsCalibration).toBe(false);

    await advance(DEFAULT_CALIBRATION_GRACE_MS - 1);
    expect(result.current.needsCalibration).toBe(false);

    await advance(1);
    expect(result.current.needsCalibration).toBe(true);
  });

  it('drops the calibration prompt the instant accuracy recovers', async () => {
    const { result } = await mount();
    await emit(96, 1);
    await advance(DEFAULT_CALIBRATION_GRACE_MS);
    expect(result.current.needsCalibration).toBe(true);

    await emit(96, 3);
    expect(result.current.needsCalibration).toBe(false);
  });

  it('does not arm the prompt when accuracy recovers inside the grace period', async () => {
    const { result } = await mount();
    await emit(96, 1);
    await advance(DEFAULT_CALIBRATION_GRACE_MS / 2);
    await emit(96, 3);
    await advance(DEFAULT_CALIBRATION_GRACE_MS);

    expect(result.current.needsCalibration).toBe(false);
  });

  it('clears the prompt when the sensor stops', async () => {
    const { result, rerender } = await mount({ enabled: true });
    await emit(96, 0);
    await advance(DEFAULT_CALIBRATION_GRACE_MS);
    expect(result.current.needsCalibration).toBe(true);

    await act(async () => rerender({ enabled: false }));
    expect(result.current.needsCalibration).toBe(false);
  });

  it('reports a stream that dies mid-session', async () => {
    const { result } = await mount();
    await emit(96);

    await act(async () => {
      adapter.emitError('sensor detached');
    });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.error).toBe('sensorUnavailable');
  });
});

// ---------------------------------------------------------------------------
// The stale-stream watchdog
// ---------------------------------------------------------------------------

describe('useHeading staleness', () => {
  it('treats a stream gone silent as needing calibration, on the watchdog schedule', async () => {
    const { result } = await mount();
    await emit(96, 3);
    expect(result.current.needsCalibration).toBe(false);

    // Android under magnetic interference: getRotationMatrix starts failing and expo-location
    // simply stops emitting. Nothing errors — the samples just stop.
    await advance(STALE_HEADING_MS - 1);
    expect(result.current.needsCalibration).toBe(false);

    await advance(1);
    expect(result.current.needsCalibration).toBe(true);
    // Staleness reuses the calibration surface; the session itself is still the live one.
    expect(result.current.status).toBe('active');
  });

  it('never trips while samples keep arriving, however slowly they change', async () => {
    const { result } = await mount();
    for (let i = 0; i < 5; i += 1) {
      await emit(96 + i, 3);
      await advance(STALE_HEADING_MS - 500);
    }
    expect(result.current.needsCalibration).toBe(false);
  });

  it('forgives the moment a good sample arrives', async () => {
    const { result } = await mount();
    await emit(96, 3);
    await advance(STALE_HEADING_MS);
    expect(result.current.needsCalibration).toBe(true);

    await emit(97, 3);
    expect(result.current.needsCalibration).toBe(false);
  });

  it('does not complain before the first sample — that is what "starting" is for', async () => {
    const { result } = await mount();
    await advance(STALE_HEADING_MS * 3);
    expect(result.current.needsCalibration).toBe(false);
    expect(result.current.status).toBe('starting');
  });

  it('stands down when the stream errors instead of stacking claims', async () => {
    const { result } = await mount();
    await emit(96, 3);
    await act(async () => {
      adapter.emitError('sensor detached');
    });
    await advance(STALE_HEADING_MS * 2);
    expect(result.current.needsCalibration).toBe(false);
    expect(result.current.status).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Location (declination)
// ---------------------------------------------------------------------------

/**
 * The hook carries the location for one reason: Android's rotation vector reads against magnetic
 * north and needs coordinates before `modules/qibla-heading` can offer a true one (D144). What
 * matters here is that it is *declination plumbing and nothing more* — pushing it must never
 * disturb the stream, because a needle that restarts every time the location store writes is worse
 * than a needle with no declination.
 */
describe('useHeading location', () => {
  it('pushes the location down to the service', async () => {
    const setLocation = jest.spyOn(service, 'setLocation');

    await mount({ location: { latitude: 21.4225, longitude: 39.8262 } });

    expect(setLocation).toHaveBeenCalledWith({ latitude: 21.4225, longitude: 39.8262 });
  });

  it('pushes null when the app has no location', async () => {
    const setLocation = jest.spyOn(service, 'setLocation');

    await mount();

    expect(setLocation).toHaveBeenCalledWith(null);
  });

  it('does not restart the sensor when the location changes', async () => {
    const view = await mount({ location: { latitude: 51.5, longitude: -0.12 } });
    expect(adapter.startCount).toBe(1);

    await act(async () => {
      view.rerender({ location: { latitude: 41.0, longitude: 29.0 } });
    });

    expect(adapter.startCount).toBe(1);
    expect(adapter.removeCount).toBe(0);
    expect(adapter.isWatching).toBe(true);
  });

  it('re-pushes when the coordinates actually change', async () => {
    const setLocation = jest.spyOn(service, 'setLocation');
    const view = await mount({ location: { latitude: 51.5, longitude: -0.12 } });
    setLocation.mockClear();

    await act(async () => {
      view.rerender({ location: { latitude: 41.0, longitude: 29.0 } });
    });

    expect(setLocation).toHaveBeenCalledWith({ latitude: 41.0, longitude: 29.0 });
  });

  it('ignores a new object carrying the same coordinates', async () => {
    const setLocation = jest.spyOn(service, 'setLocation');
    const view = await mount({ location: { latitude: 51.5, longitude: -0.12 } });
    setLocation.mockClear();

    // `useLocation()` hands back whatever the store holds; a rewrite with identical numbers is
    // not a move, and must not reach the native module.
    await act(async () => {
      view.rerender({ location: { latitude: 51.5, longitude: -0.12 } });
    });

    expect(setLocation).not.toHaveBeenCalled();
  });

  it('keeps publishing headings with no location at all', async () => {
    const view = await mount();

    await emit(120);

    // No declination means magnetic north, which the screen already discloses — never a dead dial.
    expect(view.result.current.heading).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// The interface turned upside down (iOS)
// ---------------------------------------------------------------------------

/**
 * `CLHeading` is measured against the top of the **device**, and `expo-location` never sets
 * `headingOrientation` to say otherwise. An iPad turned upside down (D123 gives it all four
 * orientations) therefore flips the interface while the heading stays where it was, and the dial,
 * the readout, the guidance and the alignment haptic are all 180° out — a compass pointing at the
 * opposite horizon, which is the one failure this tab cannot have.
 *
 * Jest runs this project as iOS, which is exactly the platform this correction belongs to.
 */
describe('useHeading in an upside-down interface', () => {
  it('leaves an upright interface alone', async () => {
    const { result } = await mount();
    await emit(96);

    expect(result.current.heading).toBe(96);
    expect(result.current.sharedHeading.get()).toBe(96);
  });

  it('adds the half turn the platform did not', async () => {
    getOrientationAsync.mockResolvedValue(ScreenOrientation.Orientation.PORTRAIT_DOWN);
    const { result } = await mount();

    await emit(96);

    expect(result.current.heading).toBe(276);
    expect(result.current.sharedHeading.get()).toBe(276);
  });

  it('turns a landscape iPad by a quarter — home button left, device top to the right', async () => {
    // The device top points to the user's right, so the user faces 90° anticlockwise of what
    // CLHeading reports. This is the D124 glance dial's everyday posture on an iPad.
    getOrientationAsync.mockResolvedValue(ScreenOrientation.Orientation.LANDSCAPE_LEFT);
    const { result } = await mount();

    await emit(96);

    expect(result.current.heading).toBe(6);
    expect(result.current.sharedHeading.get()).toBe(6);
  });

  it('turns a landscape iPad by a quarter — home button right, device top to the left', async () => {
    getOrientationAsync.mockResolvedValue(ScreenOrientation.Orientation.LANDSCAPE_RIGHT);
    const { result } = await mount();

    await emit(300);

    expect(result.current.heading).toBe(30);
    expect(result.current.sharedHeading.get()).toBe(30);
  });

  it('follows the interface turning over mid-session', async () => {
    const { result } = await mount();
    await emit(96);
    expect(result.current.heading).toBe(96);

    await emitOrientation(ScreenOrientation.Orientation.PORTRAIT_DOWN);
    await emit(96);
    await advance(1000);
    expect(result.current.heading).toBe(276);

    await emitOrientation(ScreenOrientation.Orientation.PORTRAIT_UP);
    await emit(96);
    await advance(1000);
    expect(result.current.heading).toBe(96);
  });

  it('turns the true and magnetic readings together, so the declination is untouched', async () => {
    getOrientationAsync.mockResolvedValue(ScreenOrientation.Orientation.PORTRAIT_DOWN);
    const { result } = await mount();

    await act(async () => {
      adapter.emit({ trueHeading: 105, magHeading: 100, accuracy: 3 });
    });

    // 5° of declination before the correction and 5° after it: the needle and the number cannot
    // be pulled apart by this.
    expect(result.current.heading).toBe(285);
    expect(result.current.reference).toBe('true');
  });

  it('keeps the compass when the OS will not say which way up it is', async () => {
    getOrientationAsync.mockRejectedValue(new Error('no orientation'));
    const { result } = await mount();

    await emit(96);

    expect(result.current.heading).toBe(96);
    expect(result.current.status).toBe('active');
  });
});
