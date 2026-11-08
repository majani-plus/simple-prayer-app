import { render } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { Icon, iconOpticalShift } from '../Icon';

describe('Icon', () => {
  it('renders the requested glyph codepoint', async () => {
    const { getByText } = await render(<Icon name="check" />);
    expect(getByText(String.fromCodePoint(0xe668))).toBeTruthy();
  });

  it('centres the glyph optically inside its square box on iOS', async () => {
    // The style pins lineHeight to the icon size, and iOS then keeps the baseline pinned
    // `descent` above the box bottom instead of re-centring the shrunken line box the way
    // Android does — every glyph rode high by half the trimmed leading. The correction is the
    // font's own metrics (ascent 1056 + descent 96 − 960 units/em, halved): 10% of the size,
    // exactly the "icons sit slightly high in their circles" offset it repairs.
    const { getByText } = await render(<Icon name="circle" size={20} />);
    const style = StyleSheet.flatten(
      getByText(String.fromCodePoint(0xef4a)).props.style
    ) as TextStyle;
    expect(style.lineHeight).toBe(20);
    expect(style.transform).toEqual([{ translateY: 2 }]);
    expect(iconOpticalShift(20)).toBe(Platform.OS === 'ios' ? 2 : 0);
  });

  it('scales the optical correction with the icon size', () => {
    // A metric, not a magic number: it must stay proportional at every size the app uses.
    if (Platform.OS === 'ios') {
      expect(iconOpticalShift(48)).toBeCloseTo(4.8);
      expect(iconOpticalShift(9)).toBeCloseTo(0.9);
    }
  });

  it('follows Dynamic Type modestly instead of freezing (spec-accessibility §2.4)', async () => {
    // A 1.4× cap lets icon-only affordances grow with the user's type size without bursting
    // the fixed geometry around them (tab bar, seal, calendar cells).
    const { getByText } = await render(<Icon name="check" />);
    const node = getByText(String.fromCodePoint(0xe668));
    expect(node.props.maxFontSizeMultiplier).toBe(1.4);
    expect(node.props.allowFontScaling).not.toBe(false);
  });
});
