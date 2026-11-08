/**
 * Tests for `RateAppRow`.
 *
 * The row exists to do one thing correctly: open the *store page*, never the in-app review sheet
 * (PRODUCT_SPEC §13 — the OS quota is not a button's to spend, and Google forbids a CTA on it).
 * What is tested is therefore the URL it opens, the fallback when `market://` resolves to nothing,
 * and the two states where it must speak rather than fail silently.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { RateAppRow } from '../RateAppRow';
import { initI18n } from '@/i18n';
import { APP_PACKAGE_NAME } from '@/services/appInfo';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  await initI18n().changeLanguage('en');
});

describe('RateAppRow', () => {
  it('opens the Play Store listing on Android', async () => {
    const openUrl = jest.fn().mockResolvedValue(true);
    await render(<RateAppRow platform="android" openUrl={openUrl} />);

    await fireEvent.press(screen.getByTestId('settings-row-rate'));

    expect(openUrl).toHaveBeenCalledWith(`market://details?id=${APP_PACKAGE_NAME}`);
  });

  it('falls back to the web listing where there is no Play Store app', async () => {
    const openUrl = jest
      .fn()
      .mockRejectedValueOnce(new Error('no activity found'))
      .mockResolvedValue(true);
    await render(<RateAppRow platform="android" openUrl={openUrl} />);

    await fireEvent.press(screen.getByTestId('settings-row-rate'));

    expect(await screen.findByText(/Opens your app store/)).toBeTruthy();
    expect(openUrl).toHaveBeenLastCalledWith(
      `https://play.google.com/store/apps/details?id=${APP_PACKAGE_NAME}`
    );
  });

  it('says so when nothing can open the store, rather than doing nothing', async () => {
    const openUrl = jest.fn().mockRejectedValue(new Error('nope'));
    await render(<RateAppRow platform="android" openUrl={openUrl} />);

    await fireEvent.press(screen.getByTestId('settings-row-rate'));

    expect(await screen.findByText('Your device could not open the store.')).toBeTruthy();
  });

  it('opens the App Store now that iOS has a listing', async () => {
    const openUrl = jest.fn();
    await render(<RateAppRow platform="ios" openUrl={openUrl} />);

    const row = screen.getByTestId('settings-row-rate');
    expect(row.props.accessibilityState.disabled).toBeFalsy();

    await fireEvent.press(row);
    expect(openUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/apps\.apple\.com\/app\/id\d+\?action=write-review$/)
    );
  });

  it('stays visible but inert on a platform the app has no listing on', async () => {
    const openUrl = jest.fn();
    // The row explains itself instead of disappearing (which would read as a bug) or opening
    // something broken (which would be one). 'web' has no store, so it exercises the same path
    // iOS took before App Store Connect assigned an id.
    await render(<RateAppRow platform="web" openUrl={openUrl} />);

    const row = screen.getByTestId('settings-row-rate');
    expect(screen.getByText('Available once the app is in the store.')).toBeTruthy();
    expect(row.props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(row);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('announces itself as a button with a hint about where it goes', async () => {
    await render(<RateAppRow platform="android" openUrl={jest.fn()} />);

    const row = screen.getByTestId('settings-row-rate');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toContain('Rate the app');
    expect(row.props.accessibilityHint).toBe('Opens the store listing');
  });
});
