import { useEffect, useState } from 'react';

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
 */
export function useSettledRevision(): number {
  const revision = useTrackingStore((state) => state.revision);
  const [settled, setSettled] = useState(revision);
  useEffect(() => {
    if (revision === settled) return;
    const timer = setTimeout(() => setSettled(revision), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [revision, settled]);
  return settled;
}
