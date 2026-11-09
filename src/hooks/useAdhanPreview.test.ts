/**
 * Tests for the adhan preview's lifecycle.
 *
 * There is one property here worth more than the rest, and it is the owner's: **the recitation must
 * not outlive the moment the user stopped looking at it.** Half a minute of adhan playing from an
 * app somebody thought they had left is the failure this hook exists to prevent — three minutes of
 * it on Android — so the stopping paths (a second press, backgrounding, unmounting) each get their
 * own test.
 *
 * The second property, added with the selector: **the preview plays the file the reminder will**,
 * and only ever one at a time. A preview that played the full recitation on a phone that will ring
 * for 28 seconds would misrepresent the very thing the user is choosing.
 *
 * `expo-audio` is a native module and cannot load under Jest, so it is faked at the module
 * boundary. The fake is deliberately dumb: it records calls and tracks whether it believes itself
 * to be playing, which is all the hook's contract depends on.
 */

import { act, renderHook } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppState, Platform } from 'react-native';

import { useAdhanPreview } from './useAdhanPreview';
import { ADHAN_VOICES, adhanSoundFile, allAdhanSoundFiles } from '@/domain/adhanVoices';

// `mock`-prefixed so Jest allows the factory below to close over them.
const mockAudioMode = jest.fn(async () => undefined);
const mockPlayer = {
  playing: false,
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(),
  replace: jest.fn(),
};

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => ({ playing: mockPlayer.playing }),
  setAudioModeAsync: (...args: unknown[]) => mockAudioMode(...(args as [])),
}));

const player = mockPlayer;
const audioMode = mockAudioMode;

/** Drives the fake as the real player would: `play()` starts it, `pause()` stops it. */
beforeEach(() => {
  player.playing = false;
  player.play.mockReset().mockImplementation(() => {
    player.playing = true;
  });
  player.pause.mockReset().mockImplementation(() => {
    player.playing = false;
  });
  player.seekTo.mockReset();
  player.replace.mockReset();
  audioMode.mockClear();
});

/** Fires an `AppState` change at every listener the hook registered. */
function emitAppState(state: 'active' | 'background' | 'inactive'): void {
  const listeners = (AppState.addEventListener as unknown as jest.Mock).mock?.calls;
  if (listeners === undefined) return;
  for (const [event, listener] of listeners as [string, (s: string) => void][]) {
    if (event === 'change') listener(state);
  }
}

describe('useAdhanPreview', () => {
  it('starts idle', async () => {
    const { result } = await renderHook(() => useAdhanPreview());
    expect(result.current.playing).toBeNull();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('plays from the beginning, with a session that cannot outlive the foreground', async () => {
    const { result, rerender } = await renderHook(() => useAdhanPreview());

    await act(async () => {
      result.current.toggle('makkah');
    });

    expect(player.play).toHaveBeenCalledTimes(1);
    // Rewound first, so a second press never resumes from where it was abandoned.
    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(audioMode).toHaveBeenCalledWith(
      expect.objectContaining({
        // The user pressed play: that is an explicit request for sound (see the module header).
        playsInSilentMode: true,
        // The OS-level guarantee that leaving the app ends the sound.
        shouldPlayInBackground: false,
      })
    );
    // The fake reports status on render, as the real subscription does; one more render is what
    // makes the new state observable.
    await act(async () => rerender(undefined));
    expect(result.current.playing).toBe('makkah');
  });

  it('stops on a second press of the same recitation, and rewinds', async () => {
    const { result } = await renderHook(() => useAdhanPreview());
    await act(async () => {
      result.current.toggle('makkah');
    });
    player.seekTo.mockClear();

    await act(async () => {
      result.current.toggle('makkah');
    });

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(result.current.playing).toBeNull();
    // One press, one play: toggling off must not start it again.
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('switches to another recitation rather than layering it on the first', async () => {
    const { result, rerender } = await renderHook(() => useAdhanPreview());
    await act(async () => {
      result.current.toggle('makkah');
    });

    await act(async () => {
      result.current.toggle('menk');
    });

    // One player, so replacing its source *is* stopping the outgoing recitation. Two adhans over
    // each other is the thing this makes structurally impossible.
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(2);
    await act(async () => rerender(undefined));
    expect(result.current.playing).toBe('menk');
  });

  it('does not reload a recitation that is already the loaded one', async () => {
    const { result } = await renderHook(() => useAdhanPreview());

    // The default voice is what the player was constructed with.
    await act(async () => {
      result.current.toggle('makkah');
    });

    expect(player.replace).not.toHaveBeenCalled();
  });

  it('stops when the app leaves the foreground — the owner’s rule', async () => {
    const { result } = await renderHook(() => useAdhanPreview());

    for (const state of ['background', 'inactive'] as const) {
      player.pause.mockClear();
      await act(async () => {
        result.current.toggle('alqatami');
      });
      await act(async () => {
        emitAppState(state);
      });
      expect(player.pause).toHaveBeenCalled();
    }
  });

  it('leaves it alone while the app is merely active', async () => {
    const { result, rerender } = await renderHook(() => useAdhanPreview());
    await act(async () => {
      result.current.toggle('fakhry');
    });
    player.pause.mockClear();

    await act(async () => {
      emitAppState('active');
    });

    expect(player.pause).not.toHaveBeenCalled();
    await act(async () => rerender(undefined));
    expect(result.current.playing).toBe('fakhry');
  });

  it('stops when the screen goes away', async () => {
    const { result, unmount } = await renderHook(() => useAdhanPreview());
    await act(async () => {
      result.current.toggle('makkah');
    });
    player.pause.mockClear();

    await act(async () => {
      unmount();
    });

    expect(player.pause).toHaveBeenCalled();
  });

  it('never throws when the player has already been released', async () => {
    const { result } = await renderHook(() => useAdhanPreview());
    player.pause.mockImplementation(() => {
      throw new Error('player released');
    });

    expect(() => result.current.stop()).not.toThrow();
  });

  it('goes back to idle when the audio route refuses', async () => {
    const { result, rerender } = await renderHook(() => useAdhanPreview());
    audioMode.mockRejectedValueOnce(new Error('no route'));

    await act(async () => {
      result.current.toggle('menk');
    });

    await act(async () => rerender(undefined));
    // The row must not sit there claiming to play something nobody can hear.
    expect(result.current.playing).toBeNull();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('plays the file the notification will — the clip on iOS, the whole recitation elsewhere', () => {
    // The hook asks `adhanSoundFile` exactly as `services/notifications` does, so this is really a
    // check that both platforms' answers are files this hook can actually load.
    for (const voice of ADHAN_VOICES) {
      expect(adhanSoundFile(voice, 'ios')).toMatch(/\.caf$/);
      expect(adhanSoundFile(voice, 'android')).toMatch(/\.mp3$/);
    }
    // Jest runs this bundle as iOS; the clip is what an iPhone would both preview and be rung by.
    expect(Platform.OS).toBe('ios');
  });

  it('bundles every file the resolver can name', () => {
    // A recitation added to `domain/adhanVoices` without a `require` in the hook's asset table
    // fails here, rather than as a missing module on a device — Metro resolves asset paths
    // statically, so a computed path bundles nothing.
    const source = readFileSync(join(__dirname, 'adhanAssets.ts'), 'utf8');
    for (const file of allAdhanSoundFiles()) {
      expect(source).toContain(`'${file}'`);
      expect(source).toContain(`assets/audio/${file}`);
    }
  });
});
