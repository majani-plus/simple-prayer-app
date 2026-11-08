/**
 * The one reduce-motion probe every small animation site shares (spec-accessibility §2.7).
 * Pinned here: the initial read, live updates while mounted, unsubscription on unmount, the
 * default when the platform cannot answer — "motion is fine" — and that the probe and the
 * listener are shared, not one per consumer.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { __resetReduceMotionForTests, useReduceMotion } from './useReduceMotion';

let reduceMotionEnabled = false;
let listener: ((enabled: boolean) => void) | undefined;
const removeSubscription = jest.fn();

/** `reduceMotionChanged` registrations in this test — the count the shared source holds down. */
function listenerCount(): number {
  // The overload TS picks first is `announcementFinished`, so the event name is read positionally.
  const calls = jest.mocked(AccessibilityInfo.addEventListener).mock.calls as unknown as [
    string,
    unknown,
  ][];
  return calls.filter(([event]) => event === 'reduceMotionChanged').length;
}

beforeEach(() => {
  // Module-level state outlives a render, so a flag left set by the last test would leak in.
  __resetReduceMotionForTests();
  reduceMotionEnabled = false;
  listener = undefined;
  removeSubscription.mockClear();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotionEnabled));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    event: string,
    handler: unknown
  ) => {
    if (event === 'reduceMotionChanged') listener = handler as (enabled: boolean) => void;
    return { remove: removeSubscription };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
  // Spying on an already-spied method hands back the SAME mock, so its calls would otherwise
  // accumulate across the whole file and the counts below would measure its history.
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockClear();
  jest.mocked(AccessibilityInfo.addEventListener).mockClear();
});

describe('useReduceMotion', () => {
  it('reads the system setting once on mount', async () => {
    reduceMotionEnabled = true;
    const { result } = await renderHook(() => useReduceMotion());
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('follows the setting while mounted and unsubscribes on unmount', async () => {
    const { result, unmount } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);

    await act(async () => {
      listener?.(true);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      listener?.(false);
    });
    expect(result.current).toBe(false);

    await unmount();
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });

  it('treats a platform that cannot answer as "motion is fine"', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => Promise.reject(new Error('unavailable')));
    const { result } = await renderHook(() => useReduceMotion());
    // Flush the rejected probe; the hook must swallow it and keep the default.
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('probes and listens ONCE however many consumers there are', async () => {
    // Today mounts ~35 of these right after first paint (seals, options, rows, hero, sheets).
    // One native round trip and one listener between them all is the whole point of the module
    // scope: the per-instance version cost 35 of each in the window where the first tap lands.
    reduceMotionEnabled = true;
    const view = await renderHook(() => [useReduceMotion(), useReduceMotion(), useReduceMotion()]);

    await waitFor(() => {
      expect(view.result.current).toEqual([true, true, true]);
    });
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(1);

    await view.unmount();
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });

  it('re-probes for a consumer that arrives after the last one left', async () => {
    const first = await renderHook(() => useReduceMotion());
    await first.unmount();

    reduceMotionEnabled = true;
    const second = await renderHook(() => useReduceMotion());
    await waitFor(() => {
      expect(second.result.current).toBe(true);
    });
    expect(listenerCount()).toBe(2);
  });
});
