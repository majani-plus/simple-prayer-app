import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { BuddyPairedSheet } from '../BuddyPairedSheet';
import { initI18n } from '@/i18n';
import { EMPTY_BUDDY_STATE, useBuddyStore } from '@/stores/buddyStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
}));

const AMINA = 'a'.repeat(32);

function seed(pending: boolean) {
  useBuddyStore.setState((state) => ({
    ...state,
    ...EMPTY_BUDDY_STATE,
    enabled: true,
    pairs: [
      {
        pairId: AMINA,
        icon: 'crescent' as const,
        color: 'ocean' as const,
        nickname: pending ? '' : 'Amina',
        lang: 'en',
        notify: true,
        pending,
        addedAt: 0,
      },
    ],
    justPaired: [AMINA],
  }));
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  useBuddyStore.setState((state) => ({ ...state, ...EMPTY_BUDDY_STATE }));
});

describe('the "new buddy" moment', () => {
  it('shows nothing when there is nothing new', async () => {
    await render(<BuddyPairedSheet />);
    expect(screen.queryByTestId('buddy-paired-sheet')).toBeNull();
  });

  it('names the buddy the inviter already named, and Done puts it away', async () => {
    seed(false);
    await render(<BuddyPairedSheet />);

    await waitFor(() => expect(screen.getByTestId('buddy-paired')).toBeTruthy());
    expect(screen.getByText('Amina is your buddy now')).toBeTruthy();

    fireEvent.press(screen.getByTestId('buddy-paired-done'));
    expect(useBuddyStore.getState().justPaired).toEqual([]);
  });

  it('asks who somebody is when they accepted before they had a name, and remembers', async () => {
    seed(true);
    await render(<BuddyPairedSheet />);

    await waitFor(() => expect(screen.getByTestId('buddy-paired-form-name')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('buddy-paired-form-name'), 'Amina');
    await waitFor(() => expect(screen.getByTestId('buddy-paired-form-name').props.value).toBe('Amina'));
    fireEvent.press(screen.getByTestId('buddy-paired-save'));

    expect(useBuddyStore.getState().pairs[0]).toMatchObject({ nickname: 'Amina', pending: false });
    expect(useBuddyStore.getState().justPaired).toEqual([]);
  });

  it('stays out of the way while the invite sheet is showing the same moment', async () => {
    seed(false);
    useBuddyStore.getState().actions.setInviteSheetOpen(true);
    await render(<BuddyPairedSheet />);
    expect(screen.queryByTestId('buddy-paired')).toBeNull();
  });
});
