import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { Card } from '../Card';
import { ThemePreferenceContext, nightPaper, paperLight } from '@/theme';

function styleOf(testID: string): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as ViewStyle;
}

describe('Card', () => {
  it('renders its children', async () => {
    await render(
      <Card testID="card">
        <Text>Maghrib</Text>
      </Card>
    );
    expect(screen.getByText('Maghrib')).toBeTruthy();
  });

  it('is a 14pt hairline-bordered paper surface by default', async () => {
    await render(<Card testID="card" />);
    expect(styleOf('card')).toMatchObject({
      borderRadius: 14,
      borderWidth: 1,
      backgroundColor: paperLight.card,
      borderColor: paperLight.borderFaint,
    });
    expect(styleOf('card').boxShadow).toBeUndefined();
  });

  it('maps each variant to its palette fill', async () => {
    await render(
      <>
        <Card testID="quiet" variant="quiet" />
        <Card testID="bright" variant="bright" />
        <Card testID="elevated" variant="elevated" />
      </>
    );
    expect(styleOf('quiet').backgroundColor).toBe(paperLight.cardQuiet);
    expect(styleOf('bright').backgroundColor).toBe(paperLight.cardBright);
    expect(styleOf('elevated').backgroundColor).toBe(paperLight.cardElevated);
  });

  it('gives the emphasised card the gold border and the design’s glow', async () => {
    await render(<Card testID="card" variant="bright" emphasised />);
    const style = styleOf('card');
    expect(style.borderColor).toBe(paperLight.borderStrong);
    expect(style.boxShadow).toEqual([
      {
        offsetX: 0,
        offsetY: 2,
        blurRadius: 10,
        spreadDistance: -4,
        color: paperLight.shadowGold,
      },
    ]);
  });

  it('accepts an explicit border weight, including none', async () => {
    await render(
      <>
        <Card testID="mid" border="mid" />
        <Card testID="bare" border="none" emphasised />
      </>
    );
    expect(styleOf('mid').borderColor).toBe(paperLight.borderMid);
    expect(styleOf('bare').borderColor).toBe('transparent');
    // A bare border does not cancel the emphasis glow.
    expect(styleOf('bare').boxShadow).toBeDefined();
  });

  it('accepts a radius override and lets the style prop win', async () => {
    await render(<Card testID="card" radius={24} style={{ padding: 14 }} />);
    expect(styleOf('card')).toMatchObject({ borderRadius: 24, padding: 14 });
  });

  it('follows the night-paper palette in dark mode', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <Card testID="card" emphasised />
      </ThemePreferenceContext.Provider>
    );
    expect(styleOf('card')).toMatchObject({
      backgroundColor: nightPaper.card,
      borderColor: nightPaper.borderStrong,
    });
  });
});
