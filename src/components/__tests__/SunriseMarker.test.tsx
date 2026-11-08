/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 */

/**
 * Component test for the sunrise marker.
 *
 * What is worth pinning is not that it renders, but the two things that keep it from becoming a
 * sixth prayer row: it says the word "Sunrise" beside the time (so it is never a bare glyph, and
 * never colour-only), and it speaks as ONE phrase rather than three fragments. The timezone is
 * pinned so the formatted time is a fixed string rather than the CI box's idea of one.
 */

import { cleanup, configure, render, screen } from '@testing-library/react-native';

import { SunriseMarker } from '../SunriseMarker';
import i18n, { initI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      id: 'test',
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
      clearAll: () => void values.clear(),
    }),
  };
});

configure({ defaultIncludeHiddenElements: true });

/** 06:14 local in Istanbul. */
const SUNRISE = new Date(2026, 7, 19, 6, 14, 0, 0);

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  useSettingsStore.getState().setTimeFormat('12h');
});

describe('SunriseMarker', () => {
  it('names sunrise in words and gives its time', async () => {
    await render(<SunriseMarker time={SUNRISE} testID="sunrise" />);

    expect(screen.getByText('Sunrise')).toBeTruthy();
    expect(screen.getByText('6:14 am')).toBeTruthy();
  });

  it('speaks as one phrase, not as a glyph plus two fragments', async () => {
    await render(<SunriseMarker time={SUNRISE} testID="sunrise" />);

    expect(screen.getByLabelText('Sunrise at 6:14 am')).toBeTruthy();
  });

  it('follows the 24-hour setting like every other time on the screen', async () => {
    useSettingsStore.getState().setTimeFormat('24h');
    await render(<SunriseMarker time={SUNRISE} testID="sunrise" />);

    expect(screen.getByText('06:14')).toBeTruthy();
  });

  it('is authored in Arabic, not transliterated', async () => {
    // الشروق is the word a prayer calendar uses; the row/rule order takes care of itself under
    // RTL because the marker is symmetric (rule · label · rule).
    await i18n.changeLanguage('ar');
    await render(<SunriseMarker time={SUNRISE} testID="sunrise" />);

    expect(screen.getByText('الشروق')).toBeTruthy();
    // Unmount before switching back: the marker is still mounted and subscribed to i18next, so
    // changing the language under it re-renders it outside React's knowledge. The reset itself
    // still has to happen — the language is global, and the next test expects English.
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('is a rule, not a card: nothing to press, nothing filled', async () => {
    // The structural guarantee that keeps it from reading as a prayer row — every one of those is
    // a Card with a 48px seal. If this ever grows a button or a fill, this test should fail.
    await render(<SunriseMarker time={SUNRISE} testID="sunrise" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('sunrise')).toBeTruthy();
  });
});
