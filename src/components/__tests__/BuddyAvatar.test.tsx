import { render, screen } from '@testing-library/react-native';

import { BuddyAvatars } from '../BuddyAvatar';
import { initI18n } from '@/i18n';
import type { BuddyPair } from '@/stores/buddyStore';

beforeAll(() => {
  initI18n();
});

function buddy(overrides: Partial<BuddyPair> = {}): BuddyPair {
  return {
    pairId: 'a'.repeat(32),
    icon: 'crescent',
    color: 'ocean',
    nickname: 'Amina',
    lang: 'en',
    notify: true,
    pending: false,
    addedAt: 0,
    ...overrides,
  };
}

describe('BuddyAvatars', () => {
  it('draws nothing at all when no buddy has marked the prayer', async () => {
    // The fence, rendered: an empty slot is not "no one yet" or a dash or a grey placeholder. A
    // prayer nothing arrived for must never read as a prayer somebody failed.
    await render(<BuddyAvatars buddies={[]} testID="row-buddies" />);
    expect(screen.queryByTestId('row-buddies')).toBeNull();
  });

  it('speaks one buddy as a sentence rather than an unlabelled circle', async () => {
    await render(<BuddyAvatars buddies={[buddy()]} testID="row-buddies" />);
    expect(screen.getByTestId('row-buddies').props.accessibilityLabel).toBe('Amina prayed');
  });

  it('joins two buddies with "and"', async () => {
    await render(
      <BuddyAvatars
        buddies={[buddy(), buddy({ pairId: 'b'.repeat(32), nickname: 'Yusuf' })]}
        testID="row-buddies"
      />
    );
    expect(screen.getByTestId('row-buddies').props.accessibilityLabel).toBe('Amina and Yusuf prayed');
  });

  it('joins three with commas and a final "and"', async () => {
    await render(
      <BuddyAvatars
        buddies={[
          buddy(),
          buddy({ pairId: 'b'.repeat(32), nickname: 'Yusuf' }),
          buddy({ pairId: 'c'.repeat(32), nickname: 'Hana' }),
        ]}
        testID="row-buddies"
      />
    );
    expect(screen.getByTestId('row-buddies').props.accessibilityLabel).toBe(
      'Amina, Yusuf and Hana prayed'
    );
  });

  it('falls back to "Your buddy" for someone not yet named on this phone', async () => {
    // The inviter has a real pair before they have chosen a nickname for it. A blank there would
    // read to a screen reader as nothing having happened.
    await render(<BuddyAvatars buddies={[buddy({ nickname: '' })]} testID="row-buddies" />);
    expect(screen.getByTestId('row-buddies').props.accessibilityLabel).toBe('Your buddy prayed');
  });
});
