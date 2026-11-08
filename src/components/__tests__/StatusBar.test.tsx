/**
 * The stacked bar's contract: a fill is its share of the *total*, and unlogged is never a fill.
 *
 * The bar is the one place on the History tab where a number becomes a shape, so the shares are
 * what has to be right. If unlogged ever leaked into a fill, a month nobody marked would draw
 * itself as a month of misses — the exact reading PRODUCT_SPEC §5 forbids.
 */

import { configure, render, screen, waitFor } from '@testing-library/react-native';

import { getAnimatedStyle } from '@/testing/reanimated';

import { StatusBar } from '../StatusBar';

// The bar hides itself from the accessibility tree by design — the words beside it announce.
configure({ defaultIncludeHiddenElements: true });

/** A fill's share of the bar, as flexbox sees it. */
function shareOf(testID: string): number | undefined {
  return (getAnimatedStyle(screen.getByTestId(testID)) as { flexGrow?: number }).flexGrow;
}

describe('StatusBar', () => {
  it('gives every fill its share of the total, leaving the rest as track', async () => {
    await render(<StatusBar testID="bar" prayed={3} late={1} missed={1} total={10} />);

    expect(shareOf('bar-prayed')).toBeCloseTo(0.3);
    expect(shareOf('bar-late')).toBeCloseTo(0.1);
    expect(shareOf('bar-missed')).toBeCloseTo(0.1);
  });

  it('counts the unlogged remainder as track, never as a fill', async () => {
    // Five obligated prayers of which one was prayed, and twenty never marked: the bar must read
    // as one twenty-fifth gold over an empty track, not as a wall of misses.
    await render(<StatusBar testID="bar" prayed={1} late={0} missed={0} total={25} />);

    expect(shareOf('bar-prayed')).toBeCloseTo(0.04);
    expect(shareOf('bar-late')).toBe(0);
    expect(shareOf('bar-missed')).toBe(0);
  });

  it('renders the empty track when nothing is tracked at all', async () => {
    await render(<StatusBar testID="bar" prayed={0} late={0} missed={0} total={0} />);

    expect(screen.getByTestId('bar')).toBeTruthy();
    for (const fill of ['prayed', 'late', 'missed']) {
      expect(shareOf(`bar-${fill}`)).toBe(0);
    }
  });

  it('travels to the new shares when the numbers change', async () => {
    const view = await render(<StatusBar testID="bar" prayed={2} late={0} missed={0} total={10} />);
    expect(shareOf('bar-prayed')).toBeCloseTo(0.2);

    await view.rerender(<StatusBar testID="bar" prayed={8} late={2} missed={0} total={10} />);
    await waitFor(() => {
      expect(shareOf('bar-prayed')).toBeCloseTo(0.8);
    });
    expect(shareOf('bar-late')).toBeCloseTo(0.2);
  });

  it('stays out of the accessibility tree — the words beside it carry the meaning', async () => {
    await render(<StatusBar testID="bar" prayed={1} late={1} missed={1} total={3} />);
    expect(screen.getByTestId('bar').props.accessible).toBe(false);
  });
});
