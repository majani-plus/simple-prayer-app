/**
 * The pane seam (D125) — `SectionDivider` turned ninety degrees.
 *
 * What matters here is that it is the *same* ornament on the same hairline as the horizontal rule,
 * so a two-pane spread reads as one divided sheet rather than two screens pushed together, and that
 * it is as invisible to assistive technology as the rule it mirrors.
 */

import { configure, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { DIVIDER_WIDTH, VerticalDivider } from '../VerticalDivider';
import { ThemePreferenceContext, nightPaper, paperLight } from '@/theme';

configure({ defaultIncludeHiddenElements: true });

/** Every style object in the rendered tree, flattened. */
function renderedStyles(): ViewStyle[] {
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
  return styles;
}

describe('VerticalDivider', () => {
  it('carries the ◆ ornament by default', async () => {
    await render(<VerticalDivider testID="seam" />);
    expect(screen.getByText('◆')).toBeTruthy();
  });

  it('can be a bare hairline', async () => {
    await render(<VerticalDivider ornament={false} testID="seam" />);
    expect(screen.queryByText('◆')).toBeNull();
  });

  it('draws the rule as two 1pt hairline segments in the theme colour', async () => {
    await render(<VerticalDivider testID="seam" />);
    const rules = renderedStyles().filter(
      (style) => style.backgroundColor === paperLight.hairline
    );
    // One segment above the ornament, one below — the vertical counterpart of the section rule.
    expect(rules).toHaveLength(2);
    rules.forEach((rule) => expect(rule).toMatchObject({ width: 1, flex: 1 }));
  });

  it('breaks the rule around the ornament without painting over the paper', async () => {
    await render(<VerticalDivider testID="seam" />);
    expect(renderedStyles().some((style) => style.backgroundColor === paperLight.bg)).toBe(false);

    expect(StyleSheet.flatten(screen.getByText('◆').props.style)).toMatchObject({
      fontSize: 12,
      color: paperLight.diamond,
      marginVertical: 12,
    });
  });

  it('is a narrow column that centres its rule', async () => {
    await render(<VerticalDivider testID="seam" />);
    const container = StyleSheet.flatten(screen.getByTestId('seam').props.style) as ViewStyle;
    expect(container).toMatchObject({ width: DIVIDER_WIDTH, alignItems: 'center' });
    // No height, no direction: the seam takes the row's height and the row's direction.
    expect(container.height).toBeUndefined();
    expect(container.flexDirection).toBeUndefined();
  });

  it('states no physical edge, so a right-to-left page needs no special case', async () => {
    await render(<VerticalDivider testID="seam" />);
    for (const style of renderedStyles()) {
      expect(style.marginLeft).toBeUndefined();
      expect(style.marginRight).toBeUndefined();
      expect(style.left).toBeUndefined();
      expect(style.right).toBeUndefined();
    }
  });

  it('is decorative — hidden from assistive technology', async () => {
    await render(<VerticalDivider testID="seam" />);
    const seam = screen.getByTestId('seam');
    expect(seam.props.accessibilityElementsHidden).toBe(true);
    expect(seam.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.queryByTestId('seam', { includeHiddenElements: false })).toBeNull();
  });

  it('follows the night-paper palette in dark mode', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <VerticalDivider testID="seam" />
      </ThemePreferenceContext.Provider>
    );
    expect(renderedStyles().some((style) => style.backgroundColor === nightPaper.hairline)).toBe(
      true
    );
    expect(StyleSheet.flatten(screen.getByText('◆').props.style)).toMatchObject({
      color: nightPaper.diamond,
    });
  });
});
