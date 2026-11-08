/**
 * Component test for the location prompt card — the one place the app may ask for the device
 * location (PRODUCT_SPEC §10).
 *
 * What is pinned here is the promise the owner asked for in so many words: nobody is *forced*
 * through GPS. Every state of the card that asks for (or explains) the device location must
 * carry a tappable manual route — offered alongside the ask, not only after a refusal — and it
 * must lead somewhere useful even when the OS permission is blocked for good:
 *
 * 1. "Choose a city" is on the card in all four location states, idle (never asked) included.
 * 2. It stays tappable while a resolution is running — refusing to wait is allowed.
 * 3. It presents the city picker OVER the current screen (or runs the caller's override) —
 *    never a detour into the Settings tab, which is what it used to do.
 * 4. The two compass states do NOT carry it: they only appear when a location already exists
 *    and the heading sensor wants the permission — a chosen city cannot turn the dial.
 */

import { configure, fireEvent, render, screen } from '@testing-library/react-native';

import { LocationPromptCard, type LocationPromptState } from '../LocationPromptCard';
import { initI18n } from '@/i18n';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (target: unknown) => mockPush(target) } }));

configure({ defaultIncludeHiddenElements: true });

const LOCATION_STATES: LocationPromptState[] = ['idle', 'denied', 'blocked', 'error'];
const COMPASS_STATES: LocationPromptState[] = ['compass', 'compassBlocked'];

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  mockPush.mockClear();
});

describe('the manual route', () => {
  it.each(LOCATION_STATES)('is offered alongside the ask in the %s state', async (state) => {
    await render(<LocationPromptCard state={state} onPress={jest.fn()} />);
    expect(screen.getByTestId('location-prompt-choose-city')).toBeTruthy();
  });

  it('presents the city picker over the current screen', async () => {
    await render(<LocationPromptCard state="denied" onPress={jest.fn()} />);
    fireEvent.press(screen.getByTestId('location-prompt-choose-city'));
    // Not `/settings/location`: answering a question asked on Today must not move the user to
    // the Settings tab and leave them to find their way back.
    expect(mockPush).toHaveBeenCalledWith('/city');
  });

  it('is still usable when the OS will never prompt again (blocked)', async () => {
    await render(<LocationPromptCard state="blocked" onPress={jest.fn()} />);
    fireEvent.press(screen.getByTestId('location-prompt-choose-city'));
    expect(mockPush).toHaveBeenCalled();
  });

  it('stays tappable while a resolution is running', async () => {
    await render(<LocationPromptCard state="idle" busy onPress={jest.fn()} />);
    fireEvent.press(screen.getByTestId('location-prompt-choose-city'));
    expect(mockPush).toHaveBeenCalled();
  });

  it('lets a caller that already has a search on screen take over', async () => {
    const onChooseCity = jest.fn();
    await render(
      <LocationPromptCard state="idle" onPress={jest.fn()} onChooseCity={onChooseCity} />
    );
    fireEvent.press(screen.getByTestId('location-prompt-choose-city'));
    expect(onChooseCity).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each(COMPASS_STATES)('is not offered in the %s state — a city cannot turn the dial', async (state) => {
    await render(<LocationPromptCard state={state} onPress={jest.fn()} />);
    expect(screen.queryByTestId('location-prompt-choose-city')).toBeNull();
  });
});

describe('the primary action', () => {
  it('still belongs to the caller', async () => {
    const onPress = jest.fn();
    await render(<LocationPromptCard state="idle" onPress={onPress} />);
    fireEvent.press(screen.getByTestId('location-prompt-action'));
    expect(onPress).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('stops accepting taps while busy', async () => {
    const onPress = jest.fn();
    await render(<LocationPromptCard state="idle" busy onPress={onPress} />);
    fireEvent.press(screen.getByTestId('location-prompt-action'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
