import { act, render } from '@testing-library/react-native';
import { Activity } from 'react';
import { Text } from 'react-native';

import { SETTLE_MS, useSettledRevision } from './useSettledRevision';
import { useTrackingStore } from '@/stores/trackingStore';

jest.mock('@/stores/trackingStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return { useTrackingStore: create(() => ({ revision: 0 })) };
});

const bump = () =>
  useTrackingStore.setState({ revision: useTrackingStore.getState().revision + 1 });

function Probe() {
  return <Text testID="settled">{useSettledRevision()}</Text>;
}

function Screen({ visible }: { visible: boolean }) {
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <Probe />
    </Activity>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  useTrackingStore.setState({ revision: 0 });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useSettledRevision', () => {
  it('waits for taps to settle while on screen', async () => {
    const { getByTestId } = await render(<Screen visible />);
    await act(async () => bump());
    expect(getByTestId('settled', { includeHiddenElements: true })).toHaveTextContent('0');
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });
    expect(getByTestId('settled', { includeHiddenElements: true })).toHaveTextContent('1');
  });

  it('catches up at once when a hidden screen is shown again', async () => {
    const { getByTestId, rerender } = await render(<Screen visible />);
    await rerender(<Screen visible={false} />);
    await act(async () => {
      bump();
      bump();
    });
    await rerender(<Screen visible />);
    expect(getByTestId('settled', { includeHiddenElements: true })).toHaveTextContent('2');
  });
});
