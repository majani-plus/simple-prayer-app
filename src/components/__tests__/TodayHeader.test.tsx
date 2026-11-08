import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { TodayHeader } from '../TodayHeader';
import i18n, { initI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { ThemePreferenceContext, fonts, nightPaper, paperLight } from '@/theme';

// `react-native-mmkv` is a native module and cannot load under Jest; the settings singleton
// hydrates through it at import time, so it is replaced with an in-memory map.
jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
    }),
  };
});

/** 2025-07-11 is 16 Muharram 1447 — the mockup's date, computed rather than hardcoded. */
const DAY = '2025-07-11';

function styleOf(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  useSettingsStore.getState().setHijriOffset(0);
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

describe('TodayHeader', () => {
  it('composes the Hijri and Gregorian date from the domain, not a literal', async () => {
    await render(<TodayHeader day={DAY} streak={24} />);
    expect(screen.getByText('16 Muharram · July 11')).toBeTruthy();
  });

  it('applies the user’s Hijri offset', async () => {
    useSettingsStore.getState().setHijriOffset(1);
    await render(<TodayHeader day={DAY} streak={24} />);
    expect(screen.getByText('17 Muharram · July 11')).toBeTruthy();
  });

  it('sets the date line at the header-meta size and tone', async () => {
    await render(<TodayHeader day={DAY} streak={24} />);
    expect(styleOf('16 Muharram · July 11')).toMatchObject({
      fontFamily: fonts.medium,
      fontSize: 14, // raised from the design's 13 (D74)
      color: paperLight.header,
    });
  });

  it('sets the streak number at 20/600 in the diamond tone, with tabular figures', async () => {
    await render(<TodayHeader day={DAY} streak={24} />);
    expect(styleOf('24')).toMatchObject({
      fontFamily: fonts.semiBold,
      fontSize: 20,
      color: paperLight.diamond,
      fontVariant: ['tabular-nums'],
    });
  });

  it('sets the “day streak” label in caption italic', async () => {
    await render(<TodayHeader day={DAY} streak={24} />);
    expect(styleOf('day streak')).toMatchObject({
      fontFamily: fonts.regularItalic,
      fontSize: 13.5, // the caption size, raised from the design's 12 (D74)
      color: paperLight.header,
    });
  });

  it('renders a zero streak calmly — a number, never a broken state', async () => {
    await render(<TodayHeader day={DAY} streak={0} />);
    // The same number, in the same tone, with the same label. Nothing else appears.
    expect(styleOf('0').color).toBe(paperLight.diamond);
    expect(screen.getByText('day streak')).toBeTruthy();
    expect(screen.queryByText(/broke|lost|missed/i)).toBeNull();
  });

  it('falls back to 0 before the tracking store has read the database', async () => {
    await render(<TodayHeader day={DAY} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('announces the streak as one labelled value', async () => {
    await render(<TodayHeader day={DAY} streak={24} />);
    expect(screen.getByLabelText('24 day streak')).toBeTruthy();
  });

  it('localizes month, digits and label in Arabic', async () => {
    await i18n.changeLanguage('ar');
    await render(<TodayHeader day={DAY} streak={24} />);
    // «محرّم», shadda only — the tashkeel rule keeps the mark that distinguishes a derived form
    // and drops the decorative vowels the file used to carry («مُحرَّم»).
    expect(screen.getByText(/محرّم/)).toBeTruthy();
    expect(screen.getByText('يومًا متتاليًا')).toBeTruthy();
    // Numerals go through `Intl`, so they follow the locale's numbering system — whichever the
    // platform's ICU resolves for `ar` — exactly like the times rendered beneath the header.
    expect(
      screen.getByText(new Intl.NumberFormat('ar', { useGrouping: false }).format(24))
    ).toBeTruthy();
  });

  it('follows the night-paper palette in dark mode', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <TodayHeader day={DAY} streak={24} />
      </ThemePreferenceContext.Provider>
    );
    expect(styleOf('24').color).toBe(nightPaper.diamond);
    expect(styleOf('16 Muharram · July 11').color).toBe(nightPaper.header);
  });
});

describe('the ⋯ overflow affordance (spec-exemption §2b)', () => {
  it('renders nothing at all when the screen passes no handler', async () => {
    await render(<TodayHeader day={DAY} streak={0} testID="header" />);
    expect(screen.queryByTestId('header-overflow')).toBeNull();
  });

  it('is a quiet, labelled button in the footnote gold when the screen wires it', async () => {
    const onPress = jest.fn();
    await render(
      <TodayHeader day={DAY} streak={0} testID="header" onOverflowPress={onPress} />
    );

    const button = screen.getByTestId('header-overflow');
    // Silent to a glance — literally three dots — but named for a screen reader.
    expect(button.props.accessibilityLabel).toBe('More');
    expect(styleOf('⋯').color).toBe(paperLight.faint);

    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
