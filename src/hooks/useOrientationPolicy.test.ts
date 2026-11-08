/**
 * The Android half of the orientation policy (D123): the manifest locks portrait so a phone can
 * never flash a rotated frame before JS loads, and this hook lifts the lock for screens big enough
 * to deserve it.
 *
 * Pinned here: the smallest-dimension test (a tablet is a tablet whichever way up it is, and
 * whatever share of the screen the app currently owns), the foldable's hinge in both directions,
 * that the request is made once per *change* rather than on every dimensions event, and that iOS
 * is left entirely alone.
 */

import { act, renderHook } from '@testing-library/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Dimensions, Platform } from 'react-native';

import { orientationPolicy, useOrientationPolicy } from './useOrientationPolicy';

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}));

const lockAsync = ScreenOrientation.lockAsync as jest.Mock;
const unlockAsync = ScreenOrientation.unlockAsync as jest.Mock;

type Listener = (dimensions: { screen: { width: number; height: number } }) => void;

let listeners: Listener[] = [];
const removeSubscription = jest.fn();

/** Answers `Dimensions.get('screen')` with this display size. */
function setScreen(width: number, height: number): void {
  jest
    .spyOn(Dimensions, 'get')
    .mockImplementation(() => ({ width, height, scale: 2, fontScale: 1 }));
}

/** Delivers a screen-dimensions change the way the platform does on a fold or a rotation. */
async function emitScreen(width: number, height: number): Promise<void> {
  setScreen(width, height);
  await act(async () => {
    listeners.slice().forEach((listener) => listener({ screen: { width, height } }));
  });
}

beforeEach(() => {
  listeners = [];
  lockAsync.mockClear();
  unlockAsync.mockClear();
  removeSubscription.mockClear();
  Platform.OS = 'android';
  jest.spyOn(Dimensions, 'addEventListener').mockImplementation(((
    _event: string,
    handler: Listener
  ) => {
    listeners.push(handler);
    return { remove: removeSubscription };
  }) as unknown as typeof Dimensions.addEventListener);
});

afterEach(() => {
  Platform.OS = 'ios';
});

describe('orientationPolicy', () => {
  it('keeps a phone portrait whichever way up it is held', () => {
    expect(orientationPolicy({ width: 384, height: 854 })).toBe('portrait');
    expect(orientationPolicy({ width: 854, height: 384 })).toBe('portrait');
  });

  it('unlocks a tablet, in either orientation', () => {
    expect(orientationPolicy({ width: 800, height: 1280 })).toBe('unlock');
    expect(orientationPolicy({ width: 1280, height: 800 })).toBe('unlock');
  });

  it('reads the hinge: a cover screen stays portrait, the open screen rotates', () => {
    expect(orientationPolicy({ width: 374, height: 819 })).toBe('portrait');
    expect(orientationPolicy({ width: 842, height: 903 })).toBe('unlock');
  });

  it('turns exactly at the medium breakpoint', () => {
    expect(orientationPolicy({ width: 599, height: 1000 })).toBe('portrait');
    expect(orientationPolicy({ width: 600, height: 1000 })).toBe('unlock');
  });
});

describe('useOrientationPolicy', () => {
  it('locks a phone to portrait on mount', async () => {
    setScreen(384, 854);
    await renderHook(() => useOrientationPolicy());
    expect(lockAsync).toHaveBeenCalledWith('PORTRAIT_UP');
    expect(unlockAsync).not.toHaveBeenCalled();
  });

  it('unlocks a tablet on mount', async () => {
    setScreen(800, 1280);
    await renderHook(() => useOrientationPolicy());
    expect(unlockAsync).toHaveBeenCalledTimes(1);
    expect(lockAsync).not.toHaveBeenCalled();
  });

  it('unlocks when a foldable opens and re-locks when it shuts', async () => {
    setScreen(374, 819);
    await renderHook(() => useOrientationPolicy());
    expect(lockAsync).toHaveBeenCalledTimes(1);

    await emitScreen(842, 903);
    expect(unlockAsync).toHaveBeenCalledTimes(1);

    await emitScreen(374, 819);
    expect(lockAsync).toHaveBeenCalledTimes(2);
  });

  it('asks the OS once per change, not once per event', async () => {
    setScreen(800, 1280);
    await renderHook(() => useOrientationPolicy());
    expect(unlockAsync).toHaveBeenCalledTimes(1);

    await emitScreen(1280, 800); // a plain rotation — same policy, nothing to say
    await emitScreen(800, 1280);
    expect(unlockAsync).toHaveBeenCalledTimes(1);
    expect(lockAsync).not.toHaveBeenCalled();
  });

  it('leaves iOS entirely to its plist', async () => {
    Platform.OS = 'ios';
    setScreen(1024, 1366);
    await renderHook(() => useOrientationPolicy());
    expect(lockAsync).not.toHaveBeenCalled();
    expect(unlockAsync).not.toHaveBeenCalled();
  });

  it('stops listening when the app root unmounts', async () => {
    setScreen(800, 1280);
    const { unmount } = await renderHook(() => useOrientationPolicy());
    await act(async () => {
      unmount();
    });
    expect(removeSubscription).toHaveBeenCalled();
  });
});
