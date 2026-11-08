import { configure, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { SectionDivider } from '../SectionDivider';
import { ThemePreferenceContext, nightPaper, paperLight } from '@/theme';

// The divider is deliberately hidden from assistive technology, and RNTL's queries skip hidden
// elements by default — that exclusion is itself asserted below.
configure({ defaultIncludeHiddenElements: true });

/** Every style object in the rendered tree, flattened — the rule and the chip are plain views. */
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

describe('SectionDivider', () => {
  it('carries the ◆ ornament at the top of a section', async () => {
    await render(<SectionDivider testID="divider" />);
    expect(screen.getByText('◆')).toBeTruthy();
  });

  it('is a bare hairline at the bottom of a section', async () => {
    await render(<SectionDivider placement="bottom" testID="divider" />);
    expect(screen.queryByText('◆')).toBeNull();
  });

  it('lets the ornament be forced on for a bottom rule', async () => {
    await render(<SectionDivider placement="bottom" ornament testID="divider" />);
    expect(screen.getByText('◆')).toBeTruthy();
  });

  it('lets the ornament be forced off for a top rule', async () => {
    await render(<SectionDivider placement="top" ornament={false} testID="divider" />);
    expect(screen.queryByText('◆')).toBeNull();
  });

  it('draws the rule as two 1pt hairline segments in the theme colour', async () => {
    await render(<SectionDivider testID="divider" />);
    const rules = renderedStyles().filter(
      (style) => style.backgroundColor === paperLight.hairline
    );
    // One segment either side of the ornament, each flexing to fill its half.
    expect(rules).toHaveLength(2);
    rules.forEach((rule) => expect(rule).toMatchObject({ height: 1, flex: 1 }));
  });

  it('breaks the rule around the ornament without painting over the paper', async () => {
    await render(<SectionDivider testID="divider" />);
    // A flat `colors.bg` chip cannot match the paper's noise and vignette, so the line is broken
    // by two segments instead and the texture runs straight through the gap.
    expect(renderedStyles().some((style) => style.backgroundColor === paperLight.bg)).toBe(false);

    const ornament = StyleSheet.flatten(screen.getByText('◆').props.style) as {
      fontSize: number;
      color: string;
      letterSpacing: number;
      marginHorizontal: number;
    };
    expect(ornament).toMatchObject({
      fontSize: 12,
      color: paperLight.diamond,
      marginHorizontal: 12,
    });
    // .3em of tracking, per the design.
    expect(ornament.letterSpacing).toBeCloseTo(3.6, 5);
  });

  it('centres the rule inside the ornamented row', async () => {
    await render(<SectionDivider testID="divider" />);
    const container = StyleSheet.flatten(screen.getByTestId('divider').props.style) as ViewStyle & {
      height: number;
    };
    expect(container.height).toBe(14);
    // The segments are centred by the row rather than positioned by hand.
    expect(container).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
  });

  it('collapses to a single line when there is no ornament', async () => {
    await render(<SectionDivider placement="bottom" testID="divider" />);
    const container = StyleSheet.flatten(screen.getByTestId('divider').props.style) as ViewStyle;
    expect(container.height).toBe(1);
  });

  it('is decorative — hidden from assistive technology', async () => {
    await render(<SectionDivider testID="divider" />);
    const divider = screen.getByTestId('divider');
    expect(divider.props.accessibilityElementsHidden).toBe(true);
    expect(divider.props.importantForAccessibility).toBe('no-hide-descendants');
    // …and therefore invisible to a query that respects hidden elements.
    expect(screen.queryByTestId('divider', { includeHiddenElements: false })).toBeNull();
  });

  it('follows the night-paper palette in dark mode', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <SectionDivider testID="divider" />
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
