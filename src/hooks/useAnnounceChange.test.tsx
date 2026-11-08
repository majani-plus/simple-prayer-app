/**
 * The iOS half of every status announcement in the app.
 *
 * `accessibilityLiveRegion` is Android-only in React Native, so the live regions dotted through
 * the app said nothing whatsoever under VoiceOver. This hook is what speaks there; pinned here
 * are the four rules that make it safe: it never talks on mount, it only speaks on a real change,
 * it stays quiet with nothing to say, and it leaves Android to the live region so no status is
 * ever spoken twice.
 */

import { renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { useAnnounceChange } from './useAnnounceChange';

const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

beforeEach(() => {
  announce.mockClear().mockImplementation(() => undefined);
  Platform.OS = 'ios';
});

afterAll(() => {
  Platform.OS = 'ios';
});

describe('useAnnounceChange', () => {
  it('says nothing on mount — the reader is already reading the screen', async () => {
    await renderHook(() => {
      useAnnounceChange('Facing the Qibla');
    });

    expect(announce).not.toHaveBeenCalled();
  });

  it('speaks the new status when it changes', async () => {
    const { rerender } = await renderHook(
      ({ message }: { message: string }) => {
        useAnnounceChange(message);
      },
      { initialProps: { message: 'Turn to find the Qibla' } }
    );

    await rerender({ message: 'Facing the Qibla' });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Facing the Qibla');
  });

  it('stays quiet while the status is unchanged, however often it re-renders', async () => {
    const { rerender } = await renderHook(
      ({ message }: { message: string }) => {
        useAnnounceChange(message);
      },
      { initialProps: { message: 'Turn to find the Qibla' } }
    );

    await rerender({ message: 'Facing the Qibla' });
    await rerender({ message: 'Facing the Qibla' });
    await rerender({ message: 'Facing the Qibla' });

    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('has nothing to say when the status clears', async () => {
    const { rerender } = await renderHook(
      ({ message }: { message: string | null }) => {
        useAnnounceChange(message);
      },
      { initialProps: { message: 'Sending…' as string | null } }
    );

    await rerender({ message: null });

    expect(announce).not.toHaveBeenCalled();
  });

  it('speaks again when a status returns after clearing', async () => {
    const { rerender } = await renderHook(
      ({ message }: { message: string | null }) => {
        useAnnounceChange(message);
      },
      { initialProps: { message: null as string | null } }
    );

    await rerender({ message: 'Sent' });
    await rerender({ message: null });
    await rerender({ message: 'Sent' });

    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('leaves Android to its live region, so nothing is ever said twice', async () => {
    Platform.OS = 'android';

    const { rerender } = await renderHook(
      ({ message }: { message: string }) => {
        useAnnounceChange(message);
      },
      { initialProps: { message: 'Turn to find the Qibla' } }
    );

    await rerender({ message: 'Facing the Qibla' });

    expect(announce).not.toHaveBeenCalled();
  });
});
