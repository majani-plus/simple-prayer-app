import { render, screen } from '@testing-library/react-native';

import { QiblaTiltHint } from '../QiblaTiltHint';
import { initI18n } from '@/i18n';

/**
 * The "hold it flatter" hint (audit B-2). All the intelligence lives upstream in
 * `domain/tilt` + `hooks/useTilt`; what this component owes the app is the accessibility rule
 * (PRODUCT_SPEC §16): the state is carried by an icon AND words, localized, and announced when
 * it appears.
 */

/** Material Symbols codepoint for `compass_calibration` (see components/Icon.tsx). */
const COMPASS_CALIBRATION = String.fromCodePoint(0xe57c);
/** Material Symbols codepoint for `screen_rotation`, the face-down warning's glyph. */
const SCREEN_ROTATION = String.fromCodePoint(0xf2d5);

beforeAll(() => {
  initI18n();
});

describe('QiblaTiltHint', () => {
  it('says it in words and a glyph, never colour alone', async () => {
    await render(<QiblaTiltHint />);

    expect(
      screen.getByText('Hold your phone flatter — the compass is steadiest lying flat.')
    ).toBeTruthy();
    expect(screen.getByText(COMPASS_CALIBRATION)).toBeTruthy();
  });

  it('is one accessible node, announced politely when it appears', async () => {
    await render(<QiblaTiltHint />);

    const hint = screen.getByTestId('qibla-tilt-hint');
    expect(hint.props.accessible).toBe(true);
    expect(hint.props.accessibilityRole).toBe('text');
    expect(hint.props.accessibilityLiveRegion).toBe('polite');
  });

  it('turns into the face-down warning — other words, other glyph, its own test id (D172)', async () => {
    await render(<QiblaTiltHint reason="faceDown" />);
    expect(
      screen.getByText('Your screen is facing down — turn the phone over to read the compass.')
    ).toBeTruthy();
    expect(screen.getByText(SCREEN_ROTATION)).toBeTruthy();
    expect(screen.queryByText(COMPASS_CALIBRATION)).toBeNull();
    const hint = screen.getByTestId('qibla-face-down-hint');
    expect(hint.props.accessibilityLiveRegion).toBe('polite');
  });
});
