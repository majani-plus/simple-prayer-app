/**
 * The ring's contract: an arc over a track, and **no arc at all** when there is nothing to divide.
 *
 * An empty ring and a 0% ring are different facts — one is about a week with no obligated prayer
 * in it, the other is about the person using the app — and only the second one may be drawn.
 */

import { configure, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ProgressRing } from '../ProgressRing';

configure({ defaultIncludeHiddenElements: true });

describe('ProgressRing', () => {
  it('draws the track and an arc for a real rate', async () => {
    await render(<ProgressRing testID="ring" rate={0.86} />);

    expect(screen.getByTestId('ring-track')).toBeTruthy();
    expect(screen.getByTestId('ring-arc')).toBeTruthy();
  });

  it('draws the bare track when there is nothing to divide', async () => {
    await render(<ProgressRing testID="ring" rate={null} />);

    expect(screen.getByTestId('ring-track')).toBeTruthy();
    expect(screen.queryByTestId('ring-arc')).toBeNull();
  });

  it('dashes the arc by the ring’s own circumference, so the offset can fill it', async () => {
    await render(<ProgressRing testID="ring" rate={0.5} size={76} stroke={7} />);

    const circumference = 2 * Math.PI * ((76 - 7) / 2);
    // react-native-svg normalises the dash pattern to a list of lengths.
    const dashes = screen.getByTestId('ring-arc').props.strokeDasharray as number[];
    expect(dashes[0]).toBeCloseTo(circumference);
  });

  it('centres whatever it is given, so the number sits inside the shape', async () => {
    await render(
      <ProgressRing testID="ring" rate={0.5}>
        <Text>86%</Text>
      </ProgressRing>
    );

    expect(screen.getByText('86%')).toBeTruthy();
  });
});
