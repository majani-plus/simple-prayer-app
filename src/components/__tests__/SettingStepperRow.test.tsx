/**
 * Tests for `SettingStepperRow` — the one − value + control in the app, behind every bounded
 * number (the per-prayer minute offsets, the Hijri day offset, pre-reminder minutes).
 *
 * The contract, in the order it matters:
 *
 * 1. It never reports a value outside `[min, max]`, and never wraps around at a bound — either
 *    would corrupt a prayer time rather than merely look wrong.
 * 2. It never reports a value that did not move.
 * 3. The bound it has reached is *announced* as disabled, not merely faded.
 * 4. It stays operable without being seen: the cluster is one `adjustable` element carrying the
 *    formatted figure, and each button is separately labelled.
 * 5. The figure goes through the caller's formatter, so units and locale digits stay the screen's
 *    business.
 *
 * This file absorbed the former `OffsetStepper` suite when the two steppers were merged.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import { AppText } from '../AppText';
import { SettingStepperRow } from '../SettingStepperRow';
import { initI18n } from '@/i18n';

import type { ComponentProps } from 'react';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
    }),
  };
});

// The stepper cluster is an `accessible` element, which RNTL treats as hiding everything beneath
// it; the two buttons inside must still be reachable by test id and by label.
configure({ defaultIncludeHiddenElements: true });

beforeAll(() => {
  initI18n();
});

/** Formats a minute offset the way the offsets screen does. */
function minutes(value: number): string {
  return value === 0 ? 'no change' : `${value > 0 ? '+' : '−'}${Math.abs(value)} min`;
}

/**
 * Presses, then lets the press animation settle.
 *
 * `PressableScale` runs a Reanimated timing on both press-in and press-out; two of those left
 * unflushed inside one test leave the animation queue mid-flight, and the *next* test's async
 * `render` then resolves against an empty tree.
 */
async function press(testID: string): Promise<void> {
  const target = screen.getByTestId(testID);
  await act(async () => {
    fireEvent.press(target);
  });
}

async function renderStepper(
  value: number,
  onChange = jest.fn(),
  extra: Partial<ComponentProps<typeof SettingStepperRow>> = {}
) {
  await render(
    <SettingStepperRow
      testID="stepper"
      label="Fajr adjustment"
      value={value}
      min={-30}
      max={30}
      onChange={onChange}
      formatValue={minutes}
      decreaseLabel="One minute earlier"
      increaseLabel="One minute later"
      {...extra}
    />
  );
  return { onChange };
}

describe('SettingStepperRow', () => {
  it('renders the formatted value and the two labelled buttons', async () => {
    await renderStepper(0);

    expect(screen.getByTestId('stepper-value')).toHaveTextContent('no change');
    expect(screen.getByLabelText('One minute earlier')).toBeTruthy();
    expect(screen.getByLabelText('One minute later')).toBeTruthy();
  });

  it('falls back to the raw number when no formatter is given', async () => {
    await render(
      <SettingStepperRow
        testID="stepper"
        label="Pre-reminder"
        value={15}
        min={0}
        max={60}
        onChange={jest.fn()}
        decreaseLabel="Less"
        increaseLabel="More"
      />
    );

    expect(screen.getByTestId('stepper-value')).toHaveTextContent('15');
  });

  it('steps up and down by one by default', async () => {
    const { onChange } = await renderStepper(3);

    await press('stepper-increase');
    expect(onChange).toHaveBeenLastCalledWith(4);

    await press('stepper-decrease');
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('honours a step larger than one', async () => {
    const { onChange } = await renderStepper(0, jest.fn(), { step: 5 });

    await press('stepper-increase');
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('clamps a step that would overshoot the bound', async () => {
    const { onChange } = await renderStepper(28, jest.fn(), { step: 5 });

    await press('stepper-increase');
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('stops dead at the upper bound rather than wrapping around', async () => {
    const { onChange } = await renderStepper(30);

    const increase = screen.getByTestId('stepper-increase');
    expect(increase.props.accessibilityState).toMatchObject({ disabled: true });

    await press('stepper-increase');
    expect(onChange).not.toHaveBeenCalled();

    // The other direction is still available at the same bound.
    await press('stepper-decrease');
    expect(onChange).toHaveBeenCalledWith(29);
  });

  it('stops dead at the lower bound too', async () => {
    const { onChange } = await renderStepper(-30);

    expect(screen.getByTestId('stepper-decrease').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    await press('stepper-decrease');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('carries the formatted value in its accessibility value, not only on screen', async () => {
    await renderStepper(-2, jest.fn(), { min: -2, max: 2 });

    const control = screen.getByTestId('stepper-control');
    expect(control.props.accessibilityRole).toBe('adjustable');
    expect(control.props.accessibilityValue).toMatchObject({
      min: -2,
      max: 2,
      now: -2,
      text: '−2 min',
    });
  });

  it('names what is being adjusted after the row label by default', async () => {
    await renderStepper(0);
    expect(screen.getByTestId('stepper-control').props.accessibilityLabel).toBe('Fajr adjustment');
  });

  it('lets the screen name the adjustment more precisely than the label does', async () => {
    await renderStepper(0, jest.fn(), { accessibilityLabel: 'Fajr minute adjustment' });
    expect(screen.getByTestId('stepper-control').props.accessibilityLabel).toBe(
      'Fajr minute adjustment'
    );
  });

  it('responds to the increment and decrement accessibility actions', async () => {
    const { onChange } = await renderStepper(0, jest.fn(), { min: -2, max: 2 });

    const control = screen.getByTestId('stepper-control');
    await act(async () => {
      fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    });
    expect(onChange).toHaveBeenLastCalledWith(1);

    await act(async () => {
      fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    });
    expect(onChange).toHaveBeenLastCalledWith(-1);
  });

  it('ignores an accessibility action that would leave the range', async () => {
    const { onChange } = await renderStepper(2, jest.fn(), { min: -2, max: 2 });

    const control = screen.getByTestId('stepper-control');
    await act(async () => {
      fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is inert when disabled — both buttons and the adjustable action', async () => {
    const { onChange } = await renderStepper(0, jest.fn(), { disabled: true });

    expect(screen.getByTestId('stepper-increase').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    await press('stepper-increase');
    await act(async () => {
      fireEvent(screen.getByTestId('stepper-control'), 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders live leading content beside the label, for the offsets screen', async () => {
    await renderStepper(0, jest.fn(), {
      leading: <AppText testID="stepper-time">05:12</AppText>,
    });

    expect(screen.getByTestId('stepper-time')).toHaveTextContent('05:12');
    expect(screen.getByText('Fajr adjustment')).toBeTruthy();
  });

  it('exposes a live description under the row label', async () => {
    await renderStepper(0, jest.fn(), { description: '3 Rajab 1447 AH' });

    expect(screen.getByTestId('stepper-description')).toHaveTextContent('3 Rajab 1447 AH');
  });
});
