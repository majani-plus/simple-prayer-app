/**
 * The one probe every screen uses to ask how wide it is (D123).
 *
 * The point worth testing beyond the pure functions in `src/theme/layout.test.ts` is that the hook
 * *reacts*: an iPad Split View drag and a foldable's hinge both arrive as a window-dimensions
 * change while the screen stays mounted, and a layout that only read the width once would be wrong
 * until the next navigation.
 *
 * `Dimensions.get` is spied rather than trusted — jest-expo's mock answers 750×1334, which is a
 * *medium* window, so a test that wants a phone has to say so (the same trap
 * `src/components/__tests__/PrayerSeal.test.tsx` documents for `fontScale`).
 */

import { act, renderHook } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { maxContentWidth } from '@/theme';

import { useLayout } from './useLayout';

type Listener = (dimensions: unknown) => void;

let listeners: Listener[] = [];

/** Answers `Dimensions.get` with a window of this width until the next call. */
function setWindowWidth(width: number): void {
  jest
    .spyOn(Dimensions, 'get')
    .mockImplementation(() => ({ width, height: 1000, scale: 2, fontScale: 1 }));
}

/** Delivers a dimensions change the way the platform does, to whatever RN has subscribed. */
async function emitWindowWidth(width: number): Promise<void> {
  setWindowWidth(width);
  await act(async () => {
    listeners.slice().forEach((listener) =>
      listener({ window: { width, height: 1000, scale: 2, fontScale: 1 } })
    );
  });
}

beforeEach(() => {
  listeners = [];
  jest.spyOn(Dimensions, 'addEventListener').mockImplementation(((
    _event: string,
    handler: Listener
  ) => {
    listeners.push(handler);
    return {
      remove: () => {
        listeners = listeners.filter((entry) => entry !== handler);
      },
    };
  }) as unknown as typeof Dimensions.addEventListener);
});

describe('useLayout', () => {
  it('reports a phone window as compact, with no clamp at all', async () => {
    setWindowWidth(390);
    const { result } = await renderHook(() => useLayout());
    expect(result.current.widthClass).toBe('compact');
    expect(result.current.isExpanded).toBe(false);
    expect(result.current.contentWidth).toBe(390);
    expect(result.current.contentClampStyle).toEqual({});
    expect(result.current.windowWidth).toBe(390);
  });

  it('clamps a tablet portrait window to the content column', async () => {
    setWindowWidth(834);
    const { result } = await renderHook(() => useLayout());
    expect(result.current.widthClass).toBe('medium');
    expect(result.current.isExpanded).toBe(false);
    expect(result.current.contentWidth).toBe(maxContentWidth);
    expect(result.current.contentClampStyle).toMatchObject({ maxWidth: maxContentWidth });
  });

  it('calls a tablet landscape window expanded', async () => {
    setWindowWidth(1194);
    const { result } = await renderHook(() => useLayout());
    expect(result.current.widthClass).toBe('expanded');
    expect(result.current.isExpanded).toBe(true);
  });

  it('follows a live window change — the Split View drag', async () => {
    setWindowWidth(1194);
    const { result } = await renderHook(() => useLayout());
    expect(result.current.widthClass).toBe('expanded');

    await emitWindowWidth(507); // dragged to a third of a 12.9" iPad
    expect(result.current.widthClass).toBe('compact');
    expect(result.current.contentClampStyle).toEqual({});

    await emitWindowWidth(678); // and back out to two thirds
    expect(result.current.widthClass).toBe('medium');
  });

  it('follows a foldable through the hinge', async () => {
    setWindowWidth(374); // folded, on the cover screen
    const { result } = await renderHook(() => useLayout());
    expect(result.current.widthClass).toBe('compact');

    await emitWindowWidth(842); // opened
    expect(result.current.isExpanded).toBe(true);

    await emitWindowWidth(374); // shut again
    expect(result.current.isExpanded).toBe(false);
  });

  it('subscribes to window changes rather than reading the width once', async () => {
    setWindowWidth(390);
    await renderHook(() => useLayout());
    expect(Dimensions.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
