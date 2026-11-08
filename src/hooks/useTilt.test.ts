/**
 * Tests for `useTilt` — lifetime, the three-layer calm, and graceful absence (D38).
 *
 * The harness mirrors `useHeading.test.ts`: a hand-cranked adapter, a mocked AppState, fake
 * timers. `emit` speaks in gravity vectors; the helpers below name the two postures the hook
 * exists to tell apart.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { createFakeTiltAdapter, createTiltService, type TiltService } from '@/services/tilt';

import { TILT_SILENT_START_MS, TILT_SUSTAIN_MS, useTilt, type UseTiltOptions } from './useTilt';

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

async function setAppState(state: AppStateStatus) {
  (AppState as { currentState: AppStateStatus }).currentState = state;
  await act(async () => {
    for (const listener of [...appStateListeners]) listener(state);
  });
}

let adapter: ReturnType<typeof createFakeTiltAdapter>;
let service: TiltService;

beforeEach(() => {
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
  adapter = createFakeTiltAdapter();
  service = createTiltService(adapter);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Renders the hook and lets the service's availability probe and start settle. */
async function mount(options: UseTiltOptions = {}) {
  const view = await renderHook((props: UseTiltOptions) => useTilt({ service, ...props }), {
    initialProps: options,
  });
  await act(async () => {});
  return view;
}

/** One accelerometer sample, in g. */
async function emit(x: number, y: number, z: number) {
  await act(async () => {
    adapter.emit({ x, y, z });
  });
}

const flat = () => emit(0, 0, 1);
const upright = () => emit(0, 1, 0);
/** Screen on the floor: the app's sign convention puts gravity at z = −1 there. */
const faceDown = () => emit(0, 0, -1);

/** Advances fake timers inside `act`, flushing whatever they schedule. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Feeds upright samples until the sustain period has fully elapsed. */
async function holdUpright() {
  await upright();
  // The EMA needs a few samples to cross the engage line from flat; give it a stream.
  for (let elapsed = 0; elapsed <= TILT_SUSTAIN_MS; elapsed += 200) {
    await advance(200);
    await upright();
  }
}

/** Feeds face-down samples until the sustain period has fully elapsed. */
async function holdFaceDown() {
  await faceDown();
  for (let elapsed = 0; elapsed <= TILT_SUSTAIN_MS; elapsed += 200) {
    await advance(200);
    await faceDown();
  }
}

// ---------------------------------------------------------------------------
// The hint's three layers
// ---------------------------------------------------------------------------

describe('useTilt gating', () => {
  it('stays quiet lying flat', async () => {
    const { result } = await mount();
    await flat();
    await advance(TILT_SUSTAIN_MS * 2);
    expect(result.current.isTilted).toBe(false);
    expect(result.current.available).toBe(true);
  });

  it('stays quiet at a normal in-hand reading angle (~30°)', async () => {
    const { result } = await mount();
    for (let i = 0; i < 10; i += 1) {
      await emit(0, 0.5, Math.sqrt(3) / 2);
      await advance(200);
    }
    await advance(TILT_SUSTAIN_MS);
    expect(result.current.isTilted).toBe(false);
  });

  it('shows the hint only after the posture has been held, not on the way up', async () => {
    const { result } = await mount();
    await upright();
    expect(result.current.isTilted).toBe(false);

    await advance(TILT_SUSTAIN_MS - 200);
    await upright();
    expect(result.current.isTilted).toBe(false);

    await advance(200);
    await upright();
    expect(result.current.isTilted).toBe(true);
  });

  it('a brief steep moment — picked up and put down — never shows the hint', async () => {
    const { result } = await mount();
    await upright();
    await advance(TILT_SUSTAIN_MS / 2);
    // Back to flat before the sustain elapses; the EMA needs a few samples to cross back.
    for (let i = 0; i < 12; i += 1) {
      await flat();
      await advance(100);
    }
    await advance(TILT_SUSTAIN_MS);
    expect(result.current.isTilted).toBe(false);
  });

  it('forgives the moment the phone comes back down', async () => {
    const { result } = await mount();
    await holdUpright();
    expect(result.current.isTilted).toBe(true);

    for (let i = 0; i < 12 && result.current.isTilted; i += 1) {
      await flat();
      await advance(100);
    }
    expect(result.current.isTilted).toBe(false);
  });

  it('shaking does not fake a posture (magnitude guard end to end)', async () => {
    const { result } = await mount();
    await flat();
    for (let i = 0; i < 10; i += 1) {
      await emit(0, 3, 0); // a 3 g swing that reads upright if believed
      await advance(200);
    }
    await advance(TILT_SUSTAIN_MS);
    expect(result.current.isTilted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The face-down warning (D172)
// ---------------------------------------------------------------------------

describe('useTilt face-down', () => {
  it('stays quiet face-up, flat or at a reading angle', async () => {
    const { result } = await mount();
    await flat();
    await advance(TILT_SUSTAIN_MS * 2);
    expect(result.current.isFaceDown).toBe(false);
    for (let i = 0; i < 8; i += 1) {
      await emit(0, Math.SQRT1_2, Math.SQRT1_2); // 45° reading angle, face-up
      await advance(200);
    }
    expect(result.current.isFaceDown).toBe(false);
  });

  it('warns only after the screen has faced the floor for the sustain period', async () => {
    const { result } = await mount();
    await faceDown();
    await advance(TILT_SUSTAIN_MS - 100);
    expect(result.current.isFaceDown).toBe(false);
    await holdFaceDown();
    expect(result.current.isFaceDown).toBe(true);
    // Face-down is flat, not steep: the tilt hint has nothing to say.
    expect(result.current.isTilted).toBe(false);
  });

  it('a phone rolled over for a moment never warns', async () => {
    const { result } = await mount();
    await faceDown();
    await advance(400);
    // Back face-up, and the sensor keeps streaming at ~5 Hz: the EMA walks the vector back
    // through the release line well inside the sustain period, so the timer is cancelled.
    for (let elapsed = 0; elapsed <= TILT_SUSTAIN_MS * 2; elapsed += 200) {
      await flat();
      await advance(200);
    }
    expect(result.current.isFaceDown).toBe(false);
  });

  it('forgives the moment the phone is turned back over', async () => {
    const { result } = await mount();
    await holdFaceDown();
    expect(result.current.isFaceDown).toBe(true);
    // A few face-up samples walk the EMA back past the 60° release line.
    for (let i = 0; i < 6; i += 1) await flat();
    expect(result.current.isFaceDown).toBe(false);
  });

  it('leaves a couch reader alone: 30° past vertical is not "facing the floor"', async () => {
    const { result } = await mount();
    for (let elapsed = 0; elapsed <= TILT_SUSTAIN_MS * 2; elapsed += 200) {
      await emit(0, Math.sqrt(3) / 2, -0.5); // 60° from the floor
      await advance(200);
    }
    expect(result.current.isFaceDown).toBe(false);
  });

  it('clears the warning with the sensor when disabled', async () => {
    const { result, rerender } = await mount({ enabled: true });
    await holdFaceDown();
    expect(result.current.isFaceDown).toBe(true);
    await act(async () => {
      rerender({ enabled: false });
    });
    expect(result.current.isFaceDown).toBe(false);
  });
});

describe('useTilt lifecycle', () => {
  it('never starts the sensor while disabled', async () => {
    await mount({ enabled: false });
    expect(adapter.startCount).toBe(0);
  });

  it('stops the sensor when disabled, and clears the hint with it', async () => {
    const { result, rerender } = await mount({ enabled: true });
    await holdUpright();
    expect(result.current.isTilted).toBe(true);

    await act(async () => rerender({ enabled: false }));
    expect(adapter.isWatching).toBe(false);
    expect(result.current.isTilted).toBe(false);
  });

  it('stops the sensor when the app is backgrounded and restarts on foreground', async () => {
    await mount();
    expect(adapter.isWatching).toBe(true);

    await setAppState('background');
    expect(adapter.isWatching).toBe(false);

    await setAppState('active');
    expect(adapter.isWatching).toBe(true);
  });

  it('keeps tracking through "inactive" — the dial is still on screen there', async () => {
    await mount();
    await setAppState('inactive');
    expect(adapter.isWatching).toBe(true);
  });

  it('releases the sensor, its timers and the AppState listener on unmount', async () => {
    // React's own mount/unmount bookkeeping parks timers of its own; let them drain first, the
    // way timerLeaks.test.tsx does, so the count isolates what THIS hook armed.
    const settled = async () => {
      await advance(1);
      return jest.getTimerCount();
    };
    const baseline = await settled();
    const view = await mount();
    await upright(); // sustain timer armed (and the silence watchdog before it)
    await view.unmount();

    expect(adapter.isWatching).toBe(false);
    expect(adapter.startCount).toBe(adapter.removeCount);
    expect(appStateListeners).toHaveLength(0);
    expect(await settled()).toBe(baseline);
  });

  it('does not update state after unmount', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const view = await mount();
    await upright();
    await view.unmount();

    adapter.emit({ x: 0, y: 1, z: 0 });
    jest.advanceTimersByTime(TILT_SUSTAIN_MS * 2);

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Graceful absence (D38)
// ---------------------------------------------------------------------------

describe('useTilt absence', () => {
  it('degrades to {isTilted: false, available: false} on a device with no accelerometer', async () => {
    adapter.setUnavailable();
    const { result } = await mount();

    expect(result.current.isTilted).toBe(false);
    expect(result.current.available).toBe(false);
    expect(adapter.startCount).toBe(0);
  });

  it('degrades the same way when the stream refuses to start', async () => {
    adapter.failNextStart(new Error('no sensor for you'));
    const { result } = await mount();

    expect(result.current.available).toBe(false);
    expect(result.current.isTilted).toBe(false);
  });

  it('stands down when a sensor that claims to exist never speaks', async () => {
    const { result } = await mount();
    expect(result.current.available).toBe(true);

    await advance(TILT_SILENT_START_MS);

    expect(result.current.available).toBe(false);
    expect(adapter.isWatching).toBe(false);
  });

  it('a live sample defuses the silence watchdog', async () => {
    const { result } = await mount();
    await advance(TILT_SILENT_START_MS - 1);
    await flat();
    await advance(TILT_SILENT_START_MS * 2);

    expect(result.current.available).toBe(true);
    expect(adapter.isWatching).toBe(true);
  });

  it('recovers on a later session when the sensor starts speaking again', async () => {
    const { result, rerender } = await mount({ enabled: true });
    await advance(TILT_SILENT_START_MS); // stood down
    expect(result.current.available).toBe(false);

    await act(async () => rerender({ enabled: false }));
    await act(async () => rerender({ enabled: true }));
    await act(async () => {});
    await flat();

    expect(result.current.available).toBe(true);
  });
});
