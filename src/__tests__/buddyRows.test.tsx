/**
 * Rendering tests for the buddy selector that feeds the Today rows.
 *
 * These exist because of a bug that a green suite could not see. The selector used to build its
 * table inside `useShallow`, and `Array.prototype.filter` returns a new array every call — so the
 * snapshot never settled, `useSyncExternalStore` re-rendered forever, and the Today screen died
 * with "Maximum update depth exceeded". Every existing test exercised the *store*; none rendered a
 * component through the selector, and both of its empty paths return the same frozen object, so the
 * loop could only start once a buddy actually marked something.
 *
 * Hence: render, with a mark present.
 */

import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { NO_BUDDY_MARKS } from '../domain/buddies';
import type { PrayerDay } from '../domain/types';
import { EMPTY_BUDDY_STATE, useBuddiesByPrayer, useBuddyStore } from '../stores/buddyStore';

const TODAY = '2026-09-15' as PrayerDay;
const YESTERDAY = '2026-09-14' as PrayerDay;
const AMINA = 'a'.repeat(32);
const YUSUF = 'b'.repeat(32);

function pair(pairId: string, nickname: string) {
  return {
    pairId,
    icon: 'crescent' as const,
    color: 'ocean' as const,
    nickname,
    lang: 'en',
    notify: true,
    pending: false,
    addedAt: 0,
  };
}

function Probe({ day }: { day: PrayerDay | null }) {
  const table = useBuddiesByPrayer(day);
  return (
    <Text testID="probe">
      {`maghrib:${table.maghrib.map((b) => b.nickname).join(',')}|fajr:${table.fajr.length}`}
    </Text>
  );
}

function seed(overrides: Partial<ReturnType<typeof useBuddyStore.getState>> = {}) {
  useBuddyStore.setState((state) => ({ ...state, ...EMPTY_BUDDY_STATE, ...overrides }));
}

beforeEach(() => {
  seed();
});

describe('useBuddiesByPrayer', () => {
  it('renders a prayer that a buddy has marked, without looping', async () => {
    seed({
      enabled: true,
      day: TODAY,
      marks: { ...NO_BUDDY_MARKS, maghrib: [AMINA] },
      pairs: [pair(AMINA, 'Amina')],
    });

    await render(<Probe day={TODAY} />);
    expect(screen.getByTestId('probe').props.children).toBe('maghrib:Amina|fajr:0');
  });

  it('renders several buddies on one prayer', async () => {
    seed({
      enabled: true,
      day: TODAY,
      marks: { ...NO_BUDDY_MARKS, maghrib: [AMINA, YUSUF] },
      pairs: [pair(AMINA, 'Amina'), pair(YUSUF, 'Yusuf')],
    });

    await render(<Probe day={TODAY} />);
    expect(screen.getByTestId('probe').props.children).toBe('maghrib:Amina,Yusuf|fajr:0');
  });

  it('shows nothing for a stored day that is not the day being rendered', async () => {
    seed({
      enabled: true,
      day: YESTERDAY,
      marks: { ...NO_BUDDY_MARKS, maghrib: [AMINA] },
      pairs: [pair(AMINA, 'Amina')],
    });

    await render(<Probe day={TODAY} />);
    expect(screen.getByTestId('probe').props.children).toBe('maghrib:|fajr:0');
  });

  it('shows nothing at all while buddy mode is off', async () => {
    seed({
      enabled: false,
      day: TODAY,
      marks: { ...NO_BUDDY_MARKS, maghrib: [AMINA] },
      pairs: [pair(AMINA, 'Amina')],
    });

    await render(<Probe day={TODAY} />);
    expect(screen.getByTestId('probe').props.children).toBe('maghrib:|fajr:0');
  });

  it('survives a store update while mounted', async () => {
    seed({ enabled: true, day: TODAY, pairs: [pair(AMINA, 'Amina')] });
    await render(<Probe day={TODAY} />);

    // The moment that used to start the loop: a mark arriving while the screen is on screen.
    seed({
      enabled: true,
      day: TODAY,
      marks: { ...NO_BUDDY_MARKS, maghrib: [AMINA] },
      pairs: [pair(AMINA, 'Amina')],
    });

    expect(await screen.findByTestId('probe')).toBeTruthy();
    expect(screen.getByTestId('probe').props.children).toBe('maghrib:Amina|fajr:0');
  });
});
