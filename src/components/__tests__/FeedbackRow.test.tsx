/**
 * Tests for `FeedbackRow`.
 *
 * The app had no way for anyone to reach the people who make it. This row is that way, and the
 * three things worth pinning are the three that would quietly go wrong: it opens the configured
 * board and nothing else, it says so rather than dying silently when the device cannot, and it
 * disappears cleanly rather than offering a tap into nowhere when there is no board at all.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { FeedbackRow } from '../FeedbackRow';
import { initI18n } from '@/i18n';
import { FEEDBACK_URL } from '@/services/appInfo';

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

describe('FeedbackRow', () => {
  it('opens the feedback page', async () => {
    const openUrl = jest.fn().mockResolvedValue(true);
    await render(<FeedbackRow url="https://example.test/board" openUrl={openUrl} />);

    await fireEvent.press(screen.getByTestId('settings-row-feedback'));

    expect(openUrl).toHaveBeenCalledWith('https://example.test/board');
  });

  it('says so when the device cannot open it, instead of doing nothing', async () => {
    const openUrl = jest.fn().mockRejectedValue(new Error('no browser'));
    await render(<FeedbackRow url="https://example.test/board" openUrl={openUrl} />);

    await fireEvent.press(screen.getByTestId('settings-row-feedback'));

    expect(screen.getByText('Your device could not open that page.')).toBeTruthy();
  });

  it('renders nothing when there is no board to open', async () => {
    await render(<FeedbackRow url={null} />);

    expect(screen.queryByTestId('settings-row-feedback')).toBeNull();
  });

  it('says no account is needed, which is why this destination is allowed at all', async () => {
    // The pledge sits two rows above this one saying "No account, no sign-in, no email address".
    // A board that made people sign up to be heard would read as that promise breaking the moment
    // anyone followed the link. Anonymous posting is on, so the row says so — and this assertion
    // is what fails first if it is ever turned off.
    await render(<FeedbackRow url="https://example.test/board" />);

    expect(screen.getByTestId('settings-row-feedback')).toBeTruthy();
    expect(screen.getByText(/No account needed/)).toBeTruthy();
  });

  it('ships pointed at the real board', async () => {
    // The row is only worth anything if the constant is actually set (D87).
    expect(FEEDBACK_URL).toBe('https://simpleprayer.featurebase.app/');
  });
});
