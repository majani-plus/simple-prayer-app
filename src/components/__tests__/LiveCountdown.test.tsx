import { act, render, screen } from '@testing-library/react-native';

import { LiveCountdown } from '../LiveCountdown';
import i18n, { initI18n } from '@/i18n';

const NOW = new Date(2025, 6, 11, 18, 39, 30);
const TARGET = new Date(2025, 6, 11, 20, 47, 0);

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LiveCountdown', () => {
  it('spells the remaining time out in the long style by default', async () => {
    await render(<LiveCountdown target={TARGET} />);
    expect(screen.getByText('in 2 hours 7 minutes')).toBeTruthy();
  });

  it('pads the minutes in the compact style so the caption keeps its width', async () => {
    await render(<LiveCountdown target={TARGET} durationStyle="compact" />);
    expect(screen.getByText('in 2 h 07 m')).toBeTruthy();
  });

  it('re-renders on each tick and settles on “now” at the target', async () => {
    await render(<LiveCountdown target={TARGET} />);
    await advance(31_000);
    expect(screen.getByText('in 2 hours 6 minutes')).toBeTruthy();

    await advance(TARGET.getTime() - NOW.getTime());
    expect(screen.getByText('now')).toBeTruthy();
  });

  it('uses the supplied fallback when the target is not a real date', async () => {
    await render(<LiveCountdown target={new Date(NaN)} fallbackMs={90_000} />);
    expect(screen.getByText('in 1 minute')).toBeTruthy();
  });

  it('re-phrases the countdown when the language changes', async () => {
    await render(<LiveCountdown target={TARGET} />);
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    // Turkish puts the marker after the duration.
    expect(screen.getByText('2 saat 7 dakika sonra')).toBeTruthy();
  });
});
