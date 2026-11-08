import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo, Text, type LayoutChangeEvent } from 'react-native';
import { withTiming as realWithTiming } from 'react-native-reanimated';
import { getAnimatedStyle } from '@/testing/reanimated';

import { PressableScale } from '../PressableScale';

// Spy on the one call that distinguishes an animated dip from a jump-cut. Partial mock: everything
// else in reanimated (the mock's shared values, `getAnimatedStyle`, the animated components) has to
// keep working exactly as the preset provides it.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return { ...actual, withTiming: jest.fn(actual.withTiming) };
});

const withTiming = realWithTiming as jest.MockedFunction<typeof realWithTiming>;

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

const selectionAsync = Haptics.selectionAsync as jest.MockedFunction<typeof Haptics.selectionAsync>;

/** A layout event shaped like the one the host platform delivers. */
function layoutEvent(width: number, height: number): Partial<LayoutChangeEvent> {
  return { nativeEvent: { layout: { width, height, x: 0, y: 0 } } } as Partial<LayoutChangeEvent>;
}

function seal() {
  return screen.getByLabelText('Set status for Maghrib');
}

async function renderSeal(props: Partial<React.ComponentProps<typeof PressableScale>> = {}) {
  return render(
    <PressableScale accessibilityLabel="Set status for Maghrib" {...props}>
      <Text>seal</Text>
    </PressableScale>
  );
}

/**
 * The reduce-motion probe is stubbed for the whole file (re-installed per test rather than
 * restored — restoring the host mock leaves the module without an implementation, and the
 * mount-time probe would then blow up). Defaults to "motion is fine".
 */
let reduceMotionEnabled = false;
/** The hook's `reduceMotionChanged` handler, so a test can drive the flag synchronously. */
let reduceMotionListener: ((enabled: boolean) => void) | undefined;

beforeEach(() => {
  selectionAsync.mockClear();
  reduceMotionEnabled = false;
  reduceMotionListener = undefined;
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotionEnabled));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    event: string,
    handler: unknown
  ) => {
    if (event === 'reduceMotionChanged') {
      reduceMotionListener = handler as (enabled: boolean) => void;
    }
    return { remove: jest.fn() };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
});

describe('PressableScale', () => {
  it('renders its children and reports presses', async () => {
    const onPress = jest.fn();
    await renderSeal({ onPress });

    expect(screen.getByText('seal')).toBeTruthy();
    await fireEvent.press(seal());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('defaults to the button role and forwards the label', async () => {
    await renderSeal();
    expect(seal().props.accessibilityRole).toBe('button');
  });

  it('lets the role be overridden', async () => {
    await renderSeal({ accessibilityRole: 'switch', accessibilityState: { checked: true } });
    expect(seal().props.accessibilityRole).toBe('switch');
    expect(seal().props.accessibilityState).toMatchObject({ checked: true });
  });

  it('scales down while held and springs back on release', async () => {
    await renderSeal({ scale: 0.93 });
    expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }] });

    await fireEvent(seal(), 'pressIn');
    await waitFor(() => {
      expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 0.93 }] });
    });

    await fireEvent(seal(), 'pressOut');
    await waitFor(() => {
      expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }] });
    });
  });

  it('uses 0.95 when no scale is given', async () => {
    await renderSeal();
    await fireEvent(seal(), 'pressIn');
    await waitFor(() => {
      expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 0.95 }] });
    });
  });

  it('dims instead of moving when a large surface asks for pressedOpacity', async () => {
    // The full-width settings rows: scale 1 (nothing travels), content dips like ink under a
    // thumb, and it comes all the way back on release.
    await renderSeal({ scale: 1, pressedOpacity: 0.7 });
    expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }], opacity: 1 });

    await fireEvent(seal(), 'pressIn');
    await waitFor(() => {
      expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }], opacity: 0.7 });
    });

    await fireEvent(seal(), 'pressOut');
    await waitFor(() => {
      expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }], opacity: 1 });
    });
  });

  it('never emits an animated opacity while disabled — the caller’s static grey-out wins', async () => {
    // OptionCard paints `opacity: 0.55` on a disabled card; an animated `opacity: 1` layered on
    // top would silently un-grey it.
    await renderSeal({ scale: 1, pressedOpacity: 0.7, disabled: true });
    expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }] });
  });

  it('plays selection haptics when the press commits, only when asked', async () => {
    const onPress = jest.fn();
    await renderSeal({ haptics: true, onPress });
    await fireEvent.press(seal());
    expect(selectionAsync).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    // The tick is sent before the caller's handler, so a slow handler cannot delay it.
    expect(selectionAsync.mock.invocationCallOrder[0]).toBeLessThan(
      onPress.mock.invocationCallOrder[0]
    );
  });

  it('stays silent on touch-down — a finger that lands to scroll must not buzz', async () => {
    // A touch that begins on the control and turns into a scroll fires `pressIn` and then
    // `pressOut` (the ScrollView takes the responder); `press` never arrives. Owner, 2026-09-13:
    // "vibration should only be on click".
    await renderSeal({ haptics: true });
    await fireEvent(seal(), 'pressIn');
    expect(selectionAsync).not.toHaveBeenCalled();
    await fireEvent(seal(), 'pressOut');
    expect(selectionAsync).not.toHaveBeenCalled();
  });

  it('stays silent by default', async () => {
    await renderSeal();
    await fireEvent.press(seal());
    expect(selectionAsync).not.toHaveBeenCalled();
  });

  it('honours disabled: no press, no haptics, no scale', async () => {
    const onPress = jest.fn();
    await renderSeal({ onPress, disabled: true, haptics: true });

    await fireEvent.press(seal());
    await fireEvent(seal(), 'pressIn');

    expect(onPress).not.toHaveBeenCalled();
    expect(selectionAsync).not.toHaveBeenCalled();
    expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }] });
    expect(seal().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('forwards the caller’s press handlers alongside the animation', async () => {
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    await renderSeal({ onPressIn, onPressOut });

    await fireEvent(seal(), 'pressIn');
    await fireEvent(seal(), 'pressOut');

    expect(onPressIn).toHaveBeenCalledTimes(1);
    expect(onPressOut).toHaveBeenCalledTimes(1);
  });

  it('grows the touch target of a small control to 48pt', async () => {
    // 48, not 44 (spec-accessibility §2.5): Google's 48dp floor is what the Play pre-launch
    // report checks, and Apple's 44pt is exceeded for free.
    await renderSeal();
    await fireEvent(seal(), 'layout', layoutEvent(20, 24));
    expect(seal().props.hitSlop).toEqual({ top: 12, bottom: 12, left: 14, right: 14 });
  });

  it('adds no slop to a control that is already big enough', async () => {
    await renderSeal();
    await fireEvent(seal(), 'layout', layoutEvent(48, 48));
    expect(seal().props.hitSlop).toBeUndefined();
  });

  it('respects a custom minimum and an explicit hitSlop', async () => {
    await renderSeal({ minTouchTarget: 60 });
    await fireEvent(seal(), 'layout', layoutEvent(48, 48));
    expect(seal().props.hitSlop).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });

    await renderSeal({ hitSlop: 8 });
    await fireEvent(seal(), 'layout', layoutEvent(20, 20));
    expect(seal().props.hitSlop).toBe(8);
  });

  it('still calls a caller’s onLayout while measuring', async () => {
    const onLayout = jest.fn();
    await renderSeal({ onLayout });
    await fireEvent(seal(), 'layout', layoutEvent(20, 20));
    expect(onLayout).toHaveBeenCalledTimes(1);
  });

  it('jump-cuts the press dip when the system asks for less motion', async () => {
    // spec-accessibility §2.7: the pressed state still shows, it just arrives without
    // travelling — so the scale is at its target IMMEDIATELY, with no frames in between.
    reduceMotionEnabled = true;
    await renderSeal({ scale: 0.9 });
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();

    // Drive the flag through the LISTENER, which is synchronous, rather than relying on the hook's
    // mount-time promise having resolved. That promise is why this test raced — green locally,
    // intermittently red on CI (99577e0), where a loaded runner lets `pressIn` beat the microtask and
    // the component, still believing motion is fine, animates instead of cutting.
    //
    // Awaiting a flush is not enough and polling is not possible: at rest the component looks
    // identical whether or not the flag has landed, so there is nothing for `waitFor` to wait on, and
    // relaxing the assertions below to `waitFor` would pass for the animated path too — destroying
    // the one distinction this test exists to make.
    await act(async () => {
      reduceMotionListener?.(true);
    });

    // Asserted on the DECISION, not on the pixel. Three attempts at reading the rendered scale
    // straight after the gesture all stayed flaky (2 in 12, received `1` — the write had not reached
    // the animated style yet), because reanimated's test build gives no bound on when a shared
    // value's write propagates. Any exact-value assertion immediately after an event is therefore a
    // race by construction, and `waitFor` would not help: it accepts the animated path too, which is
    // the one thing this test exists to rule out.
    //
    // What IS deterministic is which branch ran. `PressableScale` sets the shared value to either the
    // target outright (reduced motion) or `withTiming(...)` (normal), so a `withTiming` that is never
    // called IS the jump-cut, exactly and without timing.
    withTiming.mockClear();

    await act(async () => {
      fireEvent(seal(), 'pressIn');
    });
    expect(withTiming).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(seal(), 'pressOut');
    });
    expect(withTiming).not.toHaveBeenCalled();

    // And the end state is still right — polled, since only its arrival matters here.
    await waitFor(() => {
      expect(getAnimatedStyle(seal())).toEqual({ transform: [{ scale: 1 }] });
    });
  });

  it('does animate the press dip when motion is fine', async () => {
    // The counter-case that keeps the test above honest: same gesture, motion allowed, and now
    // `withTiming` IS used. Without this, "never called" would also pass if the dip stopped working.
    await renderSeal({ scale: 0.9 });
    withTiming.mockClear();

    await act(async () => {
      fireEvent(seal(), 'pressIn');
    });
    expect(withTiming).toHaveBeenCalled();
  });
});
