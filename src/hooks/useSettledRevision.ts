import { useEffect, useLayoutEffect, useState } from 'react';

import { useTrackingStore } from '@/stores/trackingStore';

/**
 * How long the tracking store must be quiet before the summaries recompute. Longer than the gap
 * between two quick seal taps, short enough that the streak has moved before the eye gets there.
 */
export const SETTLE_MS = 600;

/**
 * The tracking store's `revision`, as it was once taps stopped arriving for {@link SETTLE_MS}.
 *
 * For the whole-history summaries (streak, stats, qada pace) on screens that also hold seals
 * (D197). `useDeferredValue` used to stand here, and it only moved the work one render later: the
 * deferred render ran right after the tap's own frame, read the history from SQLite in one
 * uninterruptible call, and was still on the JS thread when the next seal was tapped. Waiting for
 * the taps to settle runs it once per burst instead of once per tap, after the burst.
 *
 * The summaries themselves read the store's CURRENT state when they run, so a settled revision is
 * never stale data, only a later trigger.
 *
 * @param active - `false` pins it at 0 and subscribes to nothing, for a caller that only needs the
 *   revision in some modes.
 */
export function useSettledRevision(active = true): number {
  const revision = useTrackingStore((state) => (active ? state.revision : 0));
  const [settled, setSettled] = useState(revision);
  // A hidden `Activity` (History's tab) drops effects and keeps state, so on re-show `settled` is
  // whatever it was when the tab was left, and the summaries visibly jumped a beat later. No burst
  // can be pending on a screen that was not on screen: catch up before the first paint. On a
  // plain mount this sets the value it already holds, which React skips.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the re-render before paint IS the point
    setSettled(revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on (re)show only, by design
  }, []);
  useEffect(() => {
    if (revision === settled) return;
    const timer = setTimeout(() => setSettled(revision), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [revision, settled]);
  return settled;
}
