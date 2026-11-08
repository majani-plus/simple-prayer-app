/**
 * Screen test for Settings → Buddies (`src/app/settings/buddies.tsx`).
 *
 * Two things are load-bearing here and neither is about layout.
 *
 * The first is that **the explanation is on screen before anything can be switched on**. Somebody
 * arriving here is being asked to let something about their worship leave their phone for the
 * first time in this app's life, and D174 says they are told what a buddy sees, what they never
 * see, and what actually travels — in that order, unprompted, without tapping anything.
 *
 * The second is that **switching the feature off forgets everything**, including telling the relay
 * to forget its side. "We keep it in case you come back" is the ordinary thing to do and would be
 * a quiet betrayal of the sentence above it.
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import BuddiesScreen from '../app/settings/buddies';
import { initI18n } from '../i18n';
import { EMPTY_BUDDY_STATE, useBuddyStore } from '../stores/buddyStore';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

const mockForgetDevice = jest.fn(async () => ({ ok: true as const, value: null }));
const mockRegister = jest.fn(async () => ({
  ok: true as const,
  value: { deviceId: 'd'.repeat(32), secret: 'secret-secret-secret-secret' },
}));
const mockCreateInvite = jest.fn(async () => ({
  ok: true as const,
  value: { code: 'ABCD2345', display: 'ABCD-2345', expiresAt: Date.now() + 86_400_000 },
}));
const mockUnpair = jest.fn(async () => ({ ok: true as const, value: null }));
const mockWithdraw = jest.fn(async () => ({ ok: true as const, value: null }));

jest.mock('../services/buddyRelay', () => ({
  RELAY_ORIGIN: 'https://relay.simpleprayer.app',
  getBuddyRelay: () => ({
    register: mockRegister,
    forgetDevice: mockForgetDevice,
    createInvite: mockCreateInvite,
    unpair: mockUnpair,
    withdrawInvite: mockWithdraw,
    setPushToken: jest.fn(async () => ({ ok: true, value: null })),
  }),
}));

const mockReadCredentials = jest.fn(async () => ({
  deviceId: 'd'.repeat(32),
  secret: 'secret-secret-secret-secret',
}));
const mockClearCredentials = jest.fn(async () => undefined);
let mockNotificationsAllowed = true;
jest.mock('../services/buddyCredentials', () => ({
  createBuddyCredentialStore: () => ({
    read: mockReadCredentials,
    save: jest.fn(async () => true),
    clear: mockClearCredentials,
  }),
}));

jest.mock('../services/buddyPush', () => ({
  getBuddyPushToken: jest.fn(async () => null),
  buddyNotificationsAllowed: jest.fn(async () => mockNotificationsAllowed),
  subscribeToBuddyPushes: jest.fn(() => () => undefined),
  configureBuddyNotifications: jest.fn(async () => undefined),
  composeBuddyNotification: jest.fn(() => ({ title: 'x', titleNamed: '{} y' })),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificationsAllowed = true;
  useBuddyStore.setState((state) => ({ ...state, ...EMPTY_BUDDY_STATE }));
});

function enable(pairs: { pairId: string; nickname: string }[] = []) {
  useBuddyStore.setState((state) => ({
    ...state,
    enabled: true,
    pairs: pairs.map((pair, index) => ({
      pairId: pair.pairId,
      icon: 'crescent' as const,
      color: 'ocean' as const,
      nickname: pair.nickname,
      lang: 'en',
      notify: true,
      pending: false,
      addedAt: index,
    })),
  }));
}

describe('what the screen says before anything is switched on', () => {
  it('says what a buddy sees, what they never see, and what leaves the phone', async () => {
    await render(<BuddiesScreen />);

    expect(screen.getByText(/A buddy sees that you prayed/)).toBeTruthy();
    expect(screen.getByText(/never see a prayer you missed/)).toBeTruthy();
    expect(screen.getByText(/sent to their phone through our relay/)).toBeTruthy();
  });

  it('offers the relay source, because "trust us" is not the claim being made', async () => {
    await render(<BuddiesScreen />);
    expect(screen.getByTestId('buddies-source')).toBeTruthy();
  });

  it('shows nothing else until it is on — no invite, no list, no notification switch', async () => {
    await render(<BuddiesScreen />);

    expect(screen.queryByTestId('buddies-add')).toBeNull();
    expect(screen.queryByTestId('buddies-notify')).toBeNull();
    expect(screen.queryByTestId('buddies-invite')).toBeNull();
  });
});

describe('switching it on and off', () => {
  it('registers with the relay when switched on', async () => {
    await render(<BuddiesScreen />);
    mockReadCredentials.mockResolvedValueOnce(null as never);

    fireEvent(screen.getByTestId('buddies-enable'), 'valueChange', true);

    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    await waitFor(() => expect(useBuddyStore.getState().enabled).toBe(true));
  });

  it('tells the relay to forget this phone when switched off, and forgets it locally', async () => {
    enable([{ pairId: 'a'.repeat(32), nickname: 'Amina' }]);
    await render(<BuddiesScreen />);

    fireEvent(screen.getByTestId('buddies-enable'), 'valueChange', false);

    // Not "kept in case they come back": the relay is told, the keychain is cleared, and the
    // roster goes. All three, or the sentence at the top of this screen is not true.
    await waitFor(() => expect(mockForgetDevice).toHaveBeenCalled());
    await waitFor(() => expect(mockClearCredentials).toHaveBeenCalled());
    expect(useBuddyStore.getState().pairs).toEqual([]);
    expect(useBuddyStore.getState().enabled).toBe(false);
  });
});

describe('once it is on', () => {
  it('offers a way to invite and a way to accept', async () => {
    enable();
    await render(<BuddiesScreen />);

    expect(screen.getByTestId('buddies-add')).toBeTruthy();
    expect(screen.getByTestId('buddies-have-code')).toBeTruthy();
    expect(screen.getByTestId('buddies-notify')).toBeTruthy();
  });

  it('shows a code that can be scanned, read aloud, or shared — in a sheet, who first', async () => {
    enable();
    await render(<BuddiesScreen />);

    // Who first, then the code. Being asked to name a stranger hours later is what made pairing
    // feel one-directional, so the name is collected while the answer is obvious.
    fireEvent.press(screen.getByTestId('buddies-add'));
    await waitFor(() => expect(screen.getByTestId('buddies-naming')).toBeTruthy());
    expect(mockCreateInvite).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('buddies-naming-name'), 'Amina');
    await waitFor(() =>
      expect(screen.getByTestId('buddies-naming-name').props.value).toBe('Amina')
    );
    fireEvent.press(screen.getByTestId('buddies-naming-next'));

    await waitFor(() => expect(mockCreateInvite).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('buddies-invite')).toBeTruthy());
    expect(screen.getByText('ABCD-2345')).toBeTruthy();
    expect(screen.getByTestId('buddies-share')).toBeTruthy();
    // With the time it has left, live, rather than a fixed "24 hours".
    expect(screen.getByTestId('buddies-invite-expiry').props.children).toMatch(/hours/);
    // And the name is held for whoever takes it.
    expect(useBuddyStore.getState().inviteFor).toMatchObject({ nickname: 'Amina' });
  });

  it('keeps an invite that is still out on the list, and reopens it from there', async () => {
    // Closing the sheet loses nothing. The invite is a row with the time it has left; the Add row
    // steps aside while one is out (one at a time — the code is single-use and so is the name).
    enable();
    useBuddyStore.getState().actions.setInviteFor({ icon: 'crescent', color: 'ocean', nickname: 'Amina' });
    useBuddyStore.getState().actions.setInvite({ code: 'ABCD2345', expiresAt: Date.now() + 86_400_000 });
    await render(<BuddiesScreen />);

    const row = screen.getByTestId('buddies-pending-invite');
    expect(row).toBeTruthy();
    expect(screen.getByText('Amina')).toBeTruthy();
    expect(screen.getByText(/Invite sent/)).toBeTruthy();
    expect(screen.queryByTestId('buddies-add')).toBeNull();

    fireEvent.press(row);
    await waitFor(() => expect(screen.getByTestId('buddies-invite')).toBeTruthy());
    expect(screen.getByText('ABCD-2345')).toBeTruthy();
  });

  it('cancels an invite locally at once, and withdraws it on the relay', async () => {
    enable();
    useBuddyStore.getState().actions.setInviteFor({ icon: 'crescent', color: 'ocean', nickname: 'Amina' });
    useBuddyStore.getState().actions.setInvite({ code: 'ABCD2345', expiresAt: Date.now() + 86_400_000 });
    await render(<BuddiesScreen />);

    fireEvent.press(screen.getByTestId('buddies-pending-invite'));
    await waitFor(() => expect(screen.getByTestId('buddies-invite-cancel')).toBeTruthy());
    fireEvent.press(screen.getByTestId('buddies-invite-cancel'));

    expect(useBuddyStore.getState().invite).toBeNull();
    await waitFor(() => expect(mockWithdraw).toHaveBeenCalledWith(expect.anything(), 'ABCD2345'));
    await waitFor(() => expect(screen.queryByTestId('buddies-pending-invite')).toBeNull());
    expect(screen.getByTestId('buddies-add')).toBeTruthy();
  });

  it('lets a buddy be renamed and re-faced from their row', async () => {
    enable([{ pairId: 'a'.repeat(32), nickname: 'Amina' }]);
    await render(<BuddiesScreen />);

    fireEvent.press(screen.getByTestId(`buddies-row-${'a'.repeat(32)}`));
    await waitFor(() => expect(screen.getByTestId('buddies-edit-name')).toBeTruthy());
    expect(screen.getByTestId('buddies-edit-name').props.value).toBe('Amina');

    fireEvent.changeText(screen.getByTestId('buddies-edit-name'), 'Mama');
    await waitFor(() => expect(screen.getByTestId('buddies-edit-name').props.value).toBe('Mama'));
    fireEvent.press(screen.getByTestId('buddy-color-brick'));
    // Async rendering: the save button's closure only carries the new colour once the picker has
    // re-rendered with it selected.
    await waitFor(() =>
      expect(screen.getByTestId('buddy-color-brick').props.accessibilityState).toMatchObject({ selected: true })
    );
    fireEvent.press(screen.getByTestId('buddies-edit-save'));

    expect(useBuddyStore.getState().pairs[0]).toMatchObject({ nickname: 'Mama', color: 'brick' });
  });

  it('lists buddies by the name this phone gave them', async () => {
    enable([
      { pairId: 'a'.repeat(32), nickname: 'Amina' },
      { pairId: 'b'.repeat(32), nickname: 'Yusuf' },
    ]);
    await render(<BuddiesScreen />);

    expect(screen.getByText('Amina')).toBeTruthy();
    expect(screen.getByText('Yusuf')).toBeTruthy();
  });

  it('removes a buddy from the screen at once, and tells the relay after', async () => {
    enable([{ pairId: 'a'.repeat(32), nickname: 'Amina' }]);
    await render(<BuddiesScreen />);

    // Removing lives in the buddy's own sheet, not on the row, so a scrolling thumb cannot end a
    // link by accident.
    fireEvent.press(screen.getByTestId(`buddies-row-${'a'.repeat(32)}`));
    await waitFor(() => expect(screen.getByTestId(`buddies-remove-${'a'.repeat(32)}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId(`buddies-remove-${'a'.repeat(32)}`));

    // Local first: leaving is not something to wait on a network for.
    expect(useBuddyStore.getState().pairs).toEqual([]);
    await waitFor(() => expect(mockUnpair).toHaveBeenCalled());
  });

  it('stops offering to add a sixth buddy, and says why', async () => {
    enable(
      Array.from({ length: 5 }, (_, i) => ({
        pairId: String(i).repeat(32).slice(0, 32),
        nickname: `Buddy ${i}`,
      }))
    );
    await render(<BuddiesScreen />);

    expect(screen.queryByTestId('buddies-add')).toBeNull();
    expect(screen.getByText(/Five buddies is the most/)).toBeTruthy();
  });

  it('says once that a link ended, and never who ended it or why', async () => {
    enable();
    useBuddyStore.setState((state) => ({ ...state, endedPairs: ['a'.repeat(32)] }));
    await render(<BuddiesScreen />);

    const notice = screen.getByTestId('buddies-ended');
    expect(notice).toBeTruthy();
    // No name, no reason, no way to ask.
    expect(screen.getByText('A buddy link ended.')).toBeTruthy();

    fireEvent.press(screen.getByTestId('buddies-ended-ack'));
    expect(useBuddyStore.getState().endedPairs).toEqual([]);
  });

  it('stops showing a code once it has been redeemed', async () => {
    // The pending card and a dead single-use code side by side invites the user to share something
    // that can never work again.
    enable();
    useBuddyStore.getState().actions.setInvite({ code: 'ABCD2345', expiresAt: Date.now() + 86_400_000 });
    useBuddyStore.getState().actions.reconcilePairs(['a'.repeat(32)], 1_000, useBuddyStore.getState().epoch);
    await render(<BuddiesScreen />);

    expect(screen.queryByTestId('buddies-invite')).toBeNull();
    expect(screen.queryByTestId('buddies-pending-invite')).toBeNull();
    // The moment itself belongs to the "new buddy" sheet (`BuddyPairedSheet.test.tsx`).
    expect(useBuddyStore.getState().justPaired).toEqual(['a'.repeat(32)]);
  });

  it('explains itself when notifications are switched off, rather than just going quiet', async () => {
    // Buddy mode still works without permission — marks arrive when the app is opened — but
    // silently, which is indistinguishable from it being broken.
    mockNotificationsAllowed = false;
    enable();
    await render(<BuddiesScreen />);

    await waitFor(() => expect(screen.getByTestId('buddies-permission')).toBeTruthy());
    expect(screen.getByTestId('buddies-permission-action')).toBeTruthy();
  });

  it('says nothing about permission when notifications are allowed', async () => {
    enable();
    await render(<BuddiesScreen />);
    await waitFor(() => expect(screen.getByTestId('buddies-add')).toBeTruthy());
    expect(screen.queryByTestId('buddies-permission')).toBeNull();
  });

  it('keeps the device secret when the relay could not be told it is leaving', async () => {
    // Clearing it anyway would strand the relay row for ninety days with nothing able to
    // authenticate against it — the buddy would never see the link end.
    mockForgetDevice.mockResolvedValueOnce({ ok: false, reason: 'offline' } as never);
    enable([{ pairId: 'a'.repeat(32), nickname: 'Amina' }]);
    await render(<BuddiesScreen />);

    fireEvent(screen.getByTestId('buddies-enable'), 'valueChange', false);

    await waitFor(() => expect(mockForgetDevice).toHaveBeenCalled());
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  it('says so, without blocking anything, when the relay cannot be reached', async () => {
    enable();
    mockCreateInvite.mockResolvedValueOnce({ ok: false, reason: 'offline' } as never);
    await render(<BuddiesScreen />);

    fireEvent.press(screen.getByTestId('buddies-add'));
    await waitFor(() => expect(screen.getByTestId('buddies-naming')).toBeTruthy());
    fireEvent.press(screen.getByTestId('buddies-naming-next'));

    await waitFor(() => expect(screen.getByTestId('buddies-failed')).toBeTruthy());
    // The sheet stays on its first step with the button back; nothing is torn down because a
    // network call failed, and the invite that never was leaves no row behind.
    expect(screen.getByTestId('buddies-naming-next')).toBeTruthy();
    expect(useBuddyStore.getState().invite).toBeNull();
  });

});
