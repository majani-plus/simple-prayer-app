/**
 * `useTodayDayResolver` — tells the tracking store what prayer day it is, for as long as the app
 * is running.
 *
 * The tracking store decides three things off "today": which day a write is filed under, whether
 * a day is a locked future day, and the window streaks and stats are measured over. The prayer
 * day runs **Fajr → next Fajr** (PRODUCT_SPEC §3), so between midnight and Fajr "today" is
 * *yesterday's* date — and deriving that needs the location and the calculation settings, which
 * the store has no business importing (see its module header: the resolver is an injection
 * point precisely so the store stays free of the prayer-time engine).
 *
 * This hook is that injection, and it belongs to the **root layout** rather than to a screen.
 * It used to live inside `usePrayerDay`, i.e. inside the Today tab, which worked only because
 * the tab navigator keeps Today mounted: any route reachable without Today — a notification deep
 * link into Settings, a standalone modal, a tab that unmounts under memory pressure — silently
 * lost the resolver and dropped the store back to the calendar day for the midnight→Fajr hours.
 * Installed at the root there is no such window: the resolver is in place before the first screen
 * renders and stays for the process's life.
 *
 * Two properties it deliberately keeps:
 *
 * 1. **The resolver reads the clock itself.** It is not `() => day` over a memoised value; a
 *    captured day goes stale the moment the app is backgrounded across Fajr, and a stale "today"
 *    makes the real today look like a *future* day — which `setStatus` refuses, locking the user
 *    out of logging the Fajr they just prayed.
 * 2. **The fallback stays safe.** With no location there is nothing to derive a boundary from, so
 *    nothing is installed and the store keeps its own `resolvePrayerDay` fallback. If the engine
 *    throws for a resolvable-looking location (a polar Fajr that does not exist), the store
 *    catches it and falls back for that call — the app degrades, never breaks.
 *
 * The actions are read through `getTrackingActions()` rather than the `useTrackingActions()`
 * hook on purpose: the root layout must not subscribe to the tracking store, or every logged
 * prayer would re-render the entire app.
 *
 * Dependency rule: `hooks → stores + domain`. No SQL, no user-facing strings.
 */

import { useEffect } from 'react';

import { getCurrentPrayerDay } from '@/domain/prayerTimes';
import { useCalculationSettings, useLocation } from '@/stores/settingsStore';
import { getTrackingActions } from '@/stores/trackingStore';

import type { PrayerDay } from '@/domain/types';

/** How long one answer is reused for. A prayer day cannot turn over inside a single minute. */
const CACHE_MS = 60_000;

/**
 * Installs the app-wide prayer-day resolver on the tracking store.
 *
 * Call it once, from the root layout. It renders nothing and returns nothing; the resolver is
 * released on unmount (i.e. never, in the app — but cleanly, in tests).
 *
 * The answer is memoised for the current clock minute, mirroring the store's own `boundaryCache`
 * (`stores/trackingStore.resolvePrayerDay`), because this runs far more often than it looks:
 * `todayDay()` builds the memo **key** for `streakSummary`, `statsFor` and `qadaProgress` — before
 * the memo is consulted — and `setStatus` calls it for the future-day guard, so a single store
 * write used to cost around nine `getCurrentPrayerDay` runs (two to three adhan computations
 * each) even when every selector hit its memo. Nothing outside this minute is cached: the closure
 * belongs to one (location, calculation) pair and dies with it, and the clock is still read on
 * every call, so property 1 above holds — the day rolls over on its own, within a minute of Fajr.
 */
export function useTodayDayResolver(): void {
  const location = useLocation();
  const calculation = useCalculationSettings();

  useEffect(() => {
    // Nothing to derive a boundary from yet: leave the store's own fallback in charge rather
    // than installing a resolver that could only throw (PRODUCT_SPEC §10 — the app stays usable
    // with no location at all).
    if (location === null) return;

    let cache: { minute: number; day: PrayerDay } | null = null;
    return getTrackingActions().setTodayDayResolver(() => {
      const at = Date.now();
      const minute = Math.floor(at / CACHE_MS);
      if (cache !== null && cache.minute === minute) return cache.day;
      // A throwing engine (a polar Fajr that does not exist) is deliberately not cached: the
      // store falls back for that call, and the next minute may well resolve.
      const day = getCurrentPrayerDay(new Date(at), location, calculation);
      cache = { minute, day };
      return day;
    });
  }, [location, calculation]);
}
