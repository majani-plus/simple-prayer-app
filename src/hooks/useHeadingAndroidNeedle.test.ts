/**
 * Tests for the Android side of `useHeading`: the hand-over to the UI-thread needle (D145).
 *
 * Jest runs this project as iOS, so `Platform.OS` is mocked here rather than in the main
 * `useHeading.test.ts` — which is worth keeping that way round, because that file passing unchanged
 * is itself the assertion that **iOS still behaves exactly as it did**.
 *
 * What matters here is the gate, not the sensor. `useAnimatedSensor` registers on mount and
 * unregisters on unmount with no enabled flag, so `nativeNeedle` going null IS how the sensor is
 * switched off — a leak here means the rotation vector runs for the rest of the session on a tab
 * react-navigation never unmounts.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import {
  createFakeHeadingAdapter,
  createHeadingService,
  type FakeHeadingAdapter,
  type HeadingService,
} from '@/services/heading';

import { needleRunsOnUiThread, useHeading } from './useHeading';

const mockPermission = { permission: 'granted' as string, canAskAgain: true };
jest.mock('@/stores/locationStore', () => ({
  useLocationPermission: () => mockPermission,
}));

/**
 * Jest runs as iOS. `useHeading` reads `Platform.OS` when it is called rather than when it is
 * loaded, precisely so this needs no module-registry games — spreading a mocked `react-native`
 * drags FlatList and expo-modules-core in with it.
 */
let realPlatformOs: string;

let appStateListeners: ((state: AppStateStatus) => void)[] = [];
let adapter: FakeHeadingAdapter;
let service: HeadingService;

beforeAll(() => {
  realPlatformOs = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: realPlatformOs, configurable: true });
});

beforeEach(() => {
  mockPermission.permission = 'granted';
  mockPermission.canAskAgain = true;
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
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function mount(options: Record<string, unknown> = {}) {
  const view = await renderHook(
    (props: Record<string, unknown>) => useHeading({ service, ...props }),
    { initialProps: options }
  );
  await act(async () => {});
  return view;
}

async function emit(trueHeading: number) {
  await act(async () => {
    adapter.emit({ trueHeading, magHeading: trueHeading, accuracy: 3 });
  });
}

it('takes the UI-thread path on Android at all', () => {
  expect(needleRunsOnUiThread()).toBe(true);
});

describe('the gate that switches the sensor on and off', () => {
  it('offers a needle handle while the tab is focused and permitted', async () => {
    const { result } = await mount({ enabled: true });

    expect(result.current.nativeNeedle).not.toBeNull();
  });

  it('withdraws it when the tab loses focus', async () => {
    const view = await mount({ enabled: true });

    await act(async () => {
      view.rerender({ enabled: false });
    });

    // Null is what unmounts `NativeNeedleSource`, which is what unregisters the sensor.
    expect(view.result.current.nativeNeedle).toBeNull();
  });

  it('withdraws it when the app is backgrounded', async () => {
    const view = await mount({ enabled: true });

    await act(async () => {
      (AppState as { currentState: AppStateStatus }).currentState = 'background';
      for (const listener of [...appStateListeners]) listener('background');
    });

    expect(view.result.current.nativeNeedle).toBeNull();
  });

  it('never offers one without location permission', async () => {
    mockPermission.permission = 'denied';

    const { result } = await mount({ enabled: true });

    expect(result.current.nativeNeedle).toBeNull();
  });
});

describe('the hand-over', () => {
  it('keeps driving the needle from JS until the UI thread proves itself', async () => {
    // A device whose rotation vector never reports leaves `alive` at 0 forever, and must keep
    // exactly the behaviour that shipped before this (D38).
    const { result } = await mount({ enabled: true });

    await emit(100);

    expect(result.current.sharedHeading.get()).toBe(100);
  });

  it('stands down once the UI-thread stream has spoken', async () => {
    const { result } = await mount({ enabled: true });
    await emit(100);

    // What `NativeNeedleSource` does on its first sample.
    const needle = result.current.nativeNeedle;
    expect(needle).not.toBeNull();
    await act(async () => {
      needle?.alive.set(1);
      needle?.heading.set(222);
    });
    await emit(150);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    // JS must not have re-targeted the needle: 222 is where the UI thread left it.
    expect(result.current.sharedHeading.get()).toBe(222);
    // The readout is still published, though — it is not driven by the needle.
    expect(result.current.heading).toBe(150);
  });

  it('publishes declination for the UI thread rather than recomputing it per frame', async () => {
    const { result } = await mount({ enabled: true });

    await act(async () => {
      adapter.emit({ trueHeading: 105, magHeading: 100, accuracy: 3 });
    });

    expect(result.current.nativeNeedle?.declination.get()).toBeCloseTo(5, 6);
  });

  it('drops declination back to zero when the true heading goes away', async () => {
    const { result } = await mount({ enabled: true });
    await act(async () => {
      adapter.emit({ trueHeading: 105, magHeading: 100, accuracy: 3 });
    });
    expect(result.current.nativeNeedle?.declination.get()).toBeCloseTo(5, 6);

    await act(async () => {
      // What `clearLocation` produces: -1, the "no true heading" sentinel. The readout drops to
      // magnetic here, and a needle still quietly adding the old declination would sit up to 20°
      // away from the number printed beside it.
      adapter.emit({ trueHeading: -1, magHeading: 100, accuracy: 3 });
    });

    expect(result.current.nativeNeedle?.declination.get()).toBe(0);
    expect(result.current.reference).toBe('magnetic');
  });
});

describe('the drift correction', () => {
  it('forwards it to the UI thread when it changes', async () => {
    // The native module measures the correction, ramps it and has already applied it to the numbers
    // arriving here. The worklet reads the fused sensor directly, so this shared value is the only
    // way it learns about the anchor — without it the needle and the readout would part company by
    // exactly the drift.
    const { result } = await mount({ enabled: true });
    expect(result.current.nativeNeedle?.offset.get()).toBe(0);

    await act(async () => {
      adapter.emit({ trueHeading: 100, magHeading: 100, accuracy: 3, driftOffset: 14 });
    });

    expect(result.current.nativeNeedle?.offset.get()).toBeCloseTo(14, 6);
  });

  it('leaves declination untouched by a correction — each is applied exactly once', async () => {
    // Kotlin corrects BOTH headings by the same offset before adding declination to the true one,
    // so the hook's `shortestAngleDelta(magnetic, true)` still reads the bare declination and the
    // worklet adds declination and offset as two separate terms. If a future change corrected
    // only one of the pair, this is the test that would say so.
    const { result } = await mount({ enabled: true });
    await act(async () => {
      adapter.emit({ trueHeading: 119, magHeading: 114, accuracy: 3, driftOffset: 14 });
    });

    expect(result.current.nativeNeedle?.declination.get()).toBeCloseTo(5, 6);
    expect(result.current.nativeNeedle?.offset.get()).toBeCloseTo(14, 6);
  });

  it('follows it back to zero when the fusion re-anchors itself', async () => {
    const { result } = await mount({ enabled: true });
    await act(async () => {
      adapter.emit({ trueHeading: 100, magHeading: 100, accuracy: 3, driftOffset: 14 });
    });

    await act(async () => {
      adapter.emit({ trueHeading: 100, magHeading: 100, accuracy: 3, driftOffset: 0 });
    });

    expect(result.current.nativeNeedle?.offset.get()).toBe(0);
  });

  it('drops it when the session ends', async () => {
    // The module throws its own correction away on every registration, so a needle that kept adding
    // one would be alone in remembering a measurement nothing else believes any more.
    const view = await mount({ enabled: true });
    await act(async () => {
      adapter.emit({ trueHeading: 100, magHeading: 100, accuracy: 3, driftOffset: 14 });
    });
    const offset = view.result.current.nativeNeedle?.offset;
    expect(offset?.get()).toBeCloseTo(14, 6);

    await act(async () => {
      view.rerender({ enabled: false });
    });

    expect(offset?.get()).toBe(0);
  });
});
