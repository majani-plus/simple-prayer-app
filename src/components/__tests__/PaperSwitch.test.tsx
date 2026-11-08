/**
 * The paper switch is a *display* of state (SettingSwitchRow owns the gesture and the a11y
 * node), so what is pinned here is the drawing contract: the knob's position tracks the value,
 * the whole face stays out of the accessibility tree, and — spec-accessibility §2.7 — when the
 * system asks for less motion the knob jump-cuts between its two ends instead of sliding.
 */

import { configure, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { getAnimatedStyle } from '@/testing/reanimated';

import { PaperSwitch, SWITCH_TRAVEL } from '../PaperSwitch';

let reduceMotionEnabled = false;

// The whole switch hides itself from the accessibility tree by design (the row announces), so
// the queries here must be told to look at hidden elements — that hiding IS the contract.
configure({ defaultIncludeHiddenElements: true });

beforeEach(() => {
  reduceMotionEnabled = false;
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotionEnabled));
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((() => ({ remove: jest.fn() })) as unknown as
      typeof AccessibilityInfo.addEventListener);
});

/** The knob's animated translateX, or undefined before any transform lands. */
function knobX(): number | undefined {
  const style = getAnimatedStyle(screen.getByTestId('sw-knob')) as {
    transform?: { translateX?: number }[];
  };
  return style.transform?.find((entry) => entry.translateX !== undefined)?.translateX;
}

describe('PaperSwitch', () => {
  it('rests the knob on the leading edge when off and the trailing edge when on', async () => {
    const view = await render(<PaperSwitch value={false} testID="sw" />);
    expect(knobX()).toBe(0);

    await view.rerender(<PaperSwitch value testID="sw" />);
    await waitFor(() => {
      expect(knobX()).toBe(SWITCH_TRAVEL);
    });
  });

  it('stays out of the accessibility tree — the row announces, not the face', async () => {
    await render(<PaperSwitch value testID="sw" />);
    expect(screen.getByTestId('sw').props.accessibilityElementsHidden).toBe(true);
  });

  it('jump-cuts the knob when the system asks for less motion', async () => {
    // §2.7: both states stay fully legible — the knob is at its destination immediately,
    // with no slide across frames.
    reduceMotionEnabled = true;
    const view = await render(<PaperSwitch value={false} testID="sw" />);
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();
    await waitFor(() => {
      expect(knobX()).toBe(0);
    });

    await view.rerender(<PaperSwitch value testID="sw" />);
    await waitFor(() => {
      expect(knobX()).toBe(SWITCH_TRAVEL);
    });

    // What this test can and cannot prove. Reanimated's test build settles a `withTiming` only
    // when the harness pumps it, so BOTH paths need `waitFor` here and "arrived without sliding"
    // is not observable from the rendered style. What is observable, and is the contract that
    // matters: the control consulted the OS flag, and both states still reach their end
    // positions under reduced motion rather than sticking mid-track. The no-slide guarantee
    // itself lives in the `useDerivedValue` branch in PaperSwitch.tsx, which returns the target
    // outright instead of calling `withTiming` when the flag is set.
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();
  });
});
