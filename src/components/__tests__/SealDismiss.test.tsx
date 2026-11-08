import { act, render, screen } from '@testing-library/react-native';
import { useRef } from 'react';
import { View, type ViewInstance } from 'react-native';

import { SealDismissBoundary, useSealDismissRegion } from '../SealDismiss';

/**
 * The boundary's contract, tested against a bare probe (the screen-level behaviour — real rows,
 * real seals — is covered in todayScreen.test and DayDetail.test):
 *
 * 1. a touch starting inside the boundary dismisses the registered pill;
 * 2. the boundary never claims the touch (capture always answers `false`);
 * 3. dismissal fires at most once per open — a second finger must never re-toggle;
 * 4. with nothing registered (pill closed, or no boundary at all) it is inert.
 */

function Probe({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  const ref = useRef<ViewInstance>(null);
  const remeasure = useSealDismissRegion(active, ref, onDismiss);
  return <View ref={ref} onLayout={remeasure} testID="probe-pill" />;
}

/**
 * Starts a touch by invoking the capture prop directly (rather than through `fireEvent`, which
 * discards the handler's return value — and the return value *is* the contract here).
 */
function touch(pageX = 30, pageY = 600): unknown {
  const handler = (
    screen.getByTestId('boundary').props as {
      onStartShouldSetResponderCapture: (event: unknown) => unknown;
    }
  ).onStartShouldSetResponderCapture;
  return handler({ nativeEvent: { pageX, pageY } });
}

describe('SealDismissBoundary', () => {
  it('dismisses the registered pill on an outside touch, without claiming it', async () => {
    const onDismiss = jest.fn();
    await render(
      <SealDismissBoundary testID="boundary">
        <Probe active onDismiss={onDismiss} />
      </SealDismissBoundary>
    );

    let claimed: unknown;
    await act(async () => {
      claimed = touch();
    });
    // `false` is the whole trick: the touch continues to whatever it was aimed at — a scroll,
    // another row's seal — and closing the pill is a side effect, never a swallowed tap.
    expect(claimed).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses at most once per open', async () => {
    const onDismiss = jest.fn();
    await render(
      <SealDismissBoundary testID="boundary">
        <Probe active onDismiss={onDismiss} />
      </SealDismissBoundary>
    );

    await act(async () => {
      touch();
      // A second finger lands before React has applied the first close: the callback is a
      // *toggle* upstream, so firing it twice would re-open the pill.
      touch();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores touches while no pill is registered', async () => {
    const onDismiss = jest.fn();
    await render(
      <SealDismissBoundary testID="boundary">
        <Probe active={false} onDismiss={onDismiss} />
      </SealDismissBoundary>
    );

    let claimed: unknown;
    await act(async () => {
      claimed = touch();
    });
    expect(claimed).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('unregisters when the pill closes', async () => {
    const onDismiss = jest.fn();
    const view = await render(
      <SealDismissBoundary testID="boundary">
        <Probe active onDismiss={onDismiss} />
      </SealDismissBoundary>
    );
    await view.rerender(
      <SealDismissBoundary testID="boundary">
        <Probe active={false} onDismiss={onDismiss} />
      </SealDismissBoundary>
    );

    await act(async () => {
      touch();
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('is inert without a boundary above it', async () => {
    const onDismiss = jest.fn();
    // A row rendered outside any boundary (a bare test, a future embed) must simply not register.
    await render(<Probe active onDismiss={onDismiss} />);
    expect(screen.getByTestId('probe-pill')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
