/**
 * The expanded-width spread (D124): two panes and the seam between them.
 *
 * The load-bearing assertion is the one about *direction*. This layout must never name a physical
 * edge, because a right-to-left page has to mirror by itself — a hand-mirrored spread is the one
 * that gets it wrong, and `src/i18n/__tests__/rtlLayout.test.tsx` pins the same rule from the
 * language's side.
 */

import { configure, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { TwoPaneLayout, paneWidth } from '../TwoPaneLayout';
import { DIVIDER_WIDTH } from '../VerticalDivider';

configure({ defaultIncludeHiddenElements: true });

async function renderPanes(props: Partial<Parameters<typeof TwoPaneLayout>[0]> = {}) {
  return render(
    <TwoPaneLayout
      testID="panes"
      start={<Text>The reward loop</Text>}
      end={<Text>The month</Text>}
      {...props}
    />
  );
}

/** The flattened style of one pane. */
function paneStyle(side: 'start' | 'end'): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId(`panes-${side}`).props.style) as ViewStyle;
}

describe('TwoPaneLayout', () => {
  it('renders both panes and the seam', async () => {
    await renderPanes();
    expect(screen.getByText('The reward loop')).toBeTruthy();
    expect(screen.getByText('The month')).toBeTruthy();
    expect(screen.getByTestId('panes-seam')).toBeTruthy();
  });

  it('gives the primary pane the larger share by default', async () => {
    await renderPanes();
    expect(paneStyle('start').flex).toBe(55);
    expect(paneStyle('end').flex).toBe(45);
  });

  it('lets a screen choose its own split', async () => {
    await renderPanes({ startFlex: 60, endFlex: 40 });
    expect(paneStyle('start').flex).toBe(60);
    expect(paneStyle('end').flex).toBe(40);
  });

  it('lays the panes in a logical row, naming no physical edge', async () => {
    await renderPanes();
    const styles: ViewStyle[] = [];
    const walk = (node: unknown) => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const element = node as { props?: { style?: unknown }; children?: unknown };
      if (element.props?.style !== undefined) {
        styles.push(StyleSheet.flatten(element.props.style) as ViewStyle);
      }
      if (element.children !== undefined) walk(element.children);
    };
    walk(screen.toJSON());

    // A plain 'row' — never 'row-reverse', which would mirror twice in Arabic and cancel out.
    expect(styles.some((style) => style.flexDirection === 'row')).toBe(true);
    for (const style of styles) {
      expect(style.flexDirection).not.toBe('row-reverse');
      expect(style.marginLeft).toBeUndefined();
      expect(style.marginRight).toBeUndefined();
      expect(style.left).toBeUndefined();
      expect(style.right).toBeUndefined();
    }
  });

  it('leaves the panes unnamed when the layout has no testID', async () => {
    await render(<TwoPaneLayout start={<Text>a</Text>} end={<Text>b</Text>} />);
    expect(screen.queryByTestId('panes-start')).toBeNull();
    expect(screen.getByText('a')).toBeTruthy();
  });
});

describe('paneWidth', () => {
  it('is the pane’s share of the window, less the seam', async () => {
    // A landscape 11" iPad: (1194 − 14) × 55/100.
    expect(paneWidth(1194)).toBeCloseTo(((1194 - DIVIDER_WIDTH) * 55) / 100, 5);
  });

  it('answers for the trailing pane too', () => {
    expect(paneWidth(1194, 45)).toBeCloseTo(((1194 - DIVIDER_WIDTH) * 45) / 100, 5);
    // The two panes and the seam account for the whole window.
    expect(paneWidth(1194) + paneWidth(1194, 45) + DIVIDER_WIDTH).toBeCloseTo(1194, 5);
  });
});
