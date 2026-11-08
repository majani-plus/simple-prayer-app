import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { HealthNotice } from '../HealthNotice';
import { initI18n } from '@/i18n';
import { ThemePreferenceContext, nightPaper, paperLight } from '@/theme';

/**
 * The verdict card the reliability screen is built from.
 *
 * The one rule worth a test is the accessibility rule the whole app follows (PRODUCT_SPEC §16):
 * **state is never colour-only**. Severity here is carried by a glyph, a word and a tint, and the
 * word is what survives greyscale, colour-blindness and a screen reader. So: the word is on
 * screen, the glyphs differ per level, the tint tracks the palette in both themes, and a disabled
 * action says so rather than merely looking faded.
 */

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

/** Material Symbols codepoints (see components/Icon.tsx). */
const TASK_ALT = String.fromCodePoint(0xe2e6);
const WARNING = String.fromCodePoint(0xf083);
const ERROR = String.fromCodePoint(0xf8b6);
const INFO = String.fromCodePoint(0xe88e);

function statusStyle(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

beforeAll(() => {
  initI18n();
});

describe('HealthNotice', () => {
  it('states the severity in words, not only in colour', async () => {
    await render(
      <HealthNotice level="problem" statusLabel="Not working" title="Nothing is scheduled" />
    );

    expect(screen.getByText('Not working')).toBeTruthy();
    expect(screen.getByText(ERROR)).toBeTruthy();
  });

  it.each([
    ['ok', TASK_ALT],
    ['attention', WARNING],
    ['problem', ERROR],
    ['info', INFO],
  ] as const)('gives %s its own glyph', async (level, glyph) => {
    await render(<HealthNotice level={level} statusLabel={level} title="t" />);

    expect(screen.getByText(glyph)).toBeTruthy();
  });

  it('reads as one node: severity, then verdict, then explanation', async () => {
    await render(
      <HealthNotice
        level="attention"
        statusLabel="Needs a moment"
        title="Reminders are paused"
        body="Your phone is holding none of them."
      />
    );

    expect(
      screen.getByLabelText(
        'Needs a moment. Reminders are paused. Your phone is holding none of them.'
      )
    ).toBeTruthy();
  });

  it('takes its tint from the paper palette', async () => {
    await render(<HealthNotice level="attention" statusLabel="Needs a moment" title="t" />);

    expect(statusStyle('Needs a moment').color).toBe(paperLight.late);
  });

  it('takes its tint from the night-paper palette in the dark theme', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <HealthNotice level="attention" statusLabel="Needs a moment" title="t" />
      </ThemePreferenceContext.Provider>
    );

    expect(statusStyle('Needs a moment').color).toBe(nightPaper.late);
  });

  it('runs an action, and announces a disabled one rather than only dimming it', async () => {
    const onPress = jest.fn();
    await render(
      <HealthNotice
        level="info"
        statusLabel="Try it"
        title="Send yourself a test"
        actions={[
          { label: 'Send', icon: 'notifications_active', onPress, testID: 'send' },
          {
            label: 'Wait',
            icon: 'schedule',
            onPress: jest.fn(),
            disabled: true,
            testID: 'wait',
          },
        ]}
      />
    );

    fireEvent.press(screen.getByTestId('send'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('wait').props.accessibilityState.disabled).toBe(true);
  });
});
