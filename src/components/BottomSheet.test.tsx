/**
 * The sheet wrapper's closing contract.
 *
 * It was written for the travel sheet that flickered and vanished when Today's ⋯ menu handed off
 * to it (owner, 2026-08-28), and both halves of that defect are pinned here.
 *
 * The first half was structural: `visible: false` used to return `null`, tearing the library's
 * modal out of the tree mid-presentation and skipping its own teardown — the only place it reports
 * the dismissal and leaves the provider's sheet queue. The sheet no longer decides its own
 * mounting at all: the library holds its content between `present()` and `dismiss()`, so a close
 * is always a dismissal and the exit always gets to play.
 *
 * The second half was who gets told. `onClose` means *the user left*: a close the caller asked for
 * by turning `visible` off is not reported back to it. Told anyway, it used to arrive after the
 * caller had already opened the next sheet — and a handler that reasonably closed "the sheet" then
 * shut the one it had just opened.
 */

import { act, render, screen, fireEvent } from '@testing-library/react-native';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BottomSheet } from './BottomSheet';

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, left: 0, right: 0, bottom: 34 };

function Harness({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <BottomSheetModalProvider>
        <BottomSheet visible={visible} dismissLabel="Close" onClose={onClose} testID="sheet">
          <Text testID="sheet-body">content</Text>
        </BottomSheet>
      </BottomSheetModalProvider>
    </SafeAreaProvider>
  );
}

/** Renders open, then flips `visible` false and lets the exit play out. */
async function openThenClose(onClose: () => void) {
  await act(async () => {
    render(<Harness visible onClose={onClose} />);
  });
  await act(async () => {
    screen.rerender(<Harness visible={false} onClose={onClose} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe('BottomSheet', () => {
  it('renders its content while open', async () => {
    await act(async () => {
      render(<Harness visible onClose={jest.fn()} />);
    });

    expect(screen.getByTestId('sheet-body')).toBeTruthy();
  });

  it('renders nothing at all while closed', async () => {
    await act(async () => {
      render(<Harness visible={false} onClose={jest.fn()} />);
    });

    expect(screen.queryByTestId('sheet-body')).toBeNull();
  });

  it('leaves the tree once it has closed — through the library, so its teardown runs', async () => {
    await openThenClose(jest.fn());

    expect(screen.queryByTestId('sheet-body')).toBeNull();
  });

  it('does not report a close the caller asked for: it knows, and the next sheet may be open', async () => {
    const onClose = jest.fn();
    await openThenClose(onClose);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports a dismissal the USER made — the other half of the same contract', async () => {
    const onClose = jest.fn();
    await act(async () => {
      render(<Harness visible onClose={onClose} />);
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('sheet-backdrop'));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens again after it has been closed', async () => {
    const onClose = jest.fn();
    await openThenClose(onClose);
    await act(async () => {
      screen.rerender(<Harness visible onClose={onClose} />);
    });

    expect(screen.getByTestId('sheet-body')).toBeTruthy();
  });
});
