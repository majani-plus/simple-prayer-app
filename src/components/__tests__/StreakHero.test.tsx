/**
 * `StreakHero` — the head of the History tab.
 *
 * The streak is the number this app is most able to shame somebody with, so what is pinned here
 * is mostly the copy: a zero renders as calmly as a sixty, the hint offers the next step instead
 * of naming what ended, and no word for a lost run appears anywhere on the card at any value
 * (CLAUDE.md, PRODUCT_SPEC §5). The rest is formatting — the mode's own name, the best run's start
 * date, and the week's rate as a percentage or an em dash.
 */

import { configure, render, screen } from '@testing-library/react-native';

import { StreakHero } from '../StreakHero';
import { initI18n } from '@/i18n';

import type { StreakSummary } from '@/domain/types';

configure({ defaultIncludeHiddenElements: true });

const STREAK: StreakSummary = {
  mode: 'soft',
  current: 4,
  best: 61,
  currentStartedOn: '2026-08-16',
  bestStartedOn: '2026-06-09',
};

async function renderHero(overrides: Partial<React.ComponentProps<typeof StreakHero>> = {}) {
  return render(<StreakHero streak={STREAK} streakMode="soft" weekRate={0.86} {...overrides} />);
}

beforeAll(() => {
  initI18n();
});

describe('StreakHero', () => {
  it('leads with the current streak and shows the best run beside it', async () => {
    await renderHero();

    expect(screen.getByTestId('stat-streak')).toBeTruthy();
    expect(screen.getByTestId('stat-streak-current').props.children).toBe('4');
    expect(screen.getByTestId('stat-streak-best').props.children).toBe('61');
    expect(screen.getByText('day streak')).toBeTruthy();
  });

  it('names the active mode and the day the best run began', async () => {
    await renderHero();

    expect(screen.getByText(/Relaxed/)).toBeTruthy();
    expect(screen.getByText(/June 9/)).toBeTruthy();
  });

  it('names the committed mode when that is the active one', async () => {
    await renderHero({ streakMode: 'hard' });
    expect(screen.getByText(/Committed/)).toBeTruthy();
  });

  it('falls back to the mode line when there is no best run to date', async () => {
    await renderHero({
      streak: {
        mode: 'soft',
        current: 3,
        best: 3,
        currentStartedOn: '2026-08-17',
        bestStartedOn: null,
      },
    });

    expect(screen.getByText('Relaxed streaks')).toBeTruthy();
  });

  it('offers the next step at zero, and never names what ended', async () => {
    await renderHero({
      streak: { mode: 'soft', current: 0, best: 0, currentStartedOn: null, bestStartedOn: null },
      weekRate: 0,
    });

    expect(screen.getByTestId('stat-streak-current').props.children).toBe('0');
    expect(screen.getByText('Mark a prayer to start one.')).toBeTruthy();
    expect(screen.queryByText(/broke/i)).toBeNull();
    expect(screen.queryByText(/lost/i)).toBeNull();
    expect(screen.queryByText(/again/i)).toBeNull();
  });

  it('keeps the mode line while the store is still reading the database', async () => {
    // `null` is "not loaded yet", not "no streak" — inviting somebody to start one they may
    // already have would be wrong for the frame it took to find out.
    await renderHero({ streak: null, weekRate: null });

    expect(screen.getByTestId('stat-streak-current').props.children).toBe('0');
    expect(screen.getByText('Relaxed streaks')).toBeTruthy();
    expect(screen.queryByText('Mark a prayer to start one.')).toBeNull();
  });

  it('draws the week’s rate in the ring and prints it in the middle', async () => {
    await renderHero();

    expect(screen.getByTestId('stat-week-rate').props.children).toBe('86%');
    expect(screen.getByTestId('stat-week-ring-arc')).toBeTruthy();
    expect(screen.getByText('this week')).toBeTruthy();
  });

  it('shows an em dash and an empty ring when there is nothing to divide', async () => {
    await renderHero({ weekRate: null });

    expect(screen.getByTestId('stat-week-rate').props.children).toBe('—');
    expect(screen.queryByTestId('stat-week-ring-arc')).toBeNull();
    expect(screen.getByTestId('stat-week-ring-track')).toBeTruthy();
  });
});
