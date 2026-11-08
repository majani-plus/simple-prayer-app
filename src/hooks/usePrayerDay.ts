/**
 * `usePrayerDay` — the Today screen's single answer to "what day is it, when is everything, what
 * is next, and what has been logged".
 *
 * It is a *composition* hook: it computes nothing itself. The prayer day, the eight time markers,
 * the five windows and the upcoming prayer all come from `domain/prayerTimes`; the day's statuses
 * come from `stores/trackingStore`; the inputs come from `stores/settingsStore`. What this hook
 * owns is the three things a screen cannot get from a pure function:
 *
 * 1. **Memoisation.** Computing a day is cheap but not free (four adhan runs), and a screen with a
 *    ticking countdown re-renders often. The whole snapshot is memoised on
 *    `(location, calculation settings, boundary)` — never recomputed by a repaint.
 * 2. **Rollover.** A screen that shows "what is next" is wrong the moment that prayer starts. A
 *    self-rearming timer fires once, half a second after the next boundary, and bumps the
 *    boundary — so Asr's window closes, Maghrib's row becomes the current (loud) one, its seal
 *    unlocks, and the hero moves to Isha with no interaction. "The next boundary" is the earlier
 *    of the next prayer's start and the current window's **end**, which are the same instant for
 *    every prayer except Fajr: Fajr's window shuts at sunrise (`domain/windows.ts`), and without
 *    watching that instant a screen left open since dawn would still be calling Fajr "current" at
 *    ten in the morning. At the Fajr boundary the same tick rolls the whole prayer day over: the
 *    day runs **Fajr → Fajr**, so at 00:30 this hook still reports YESTERDAY (via
 *    `prayerTimes.getCurrentPrayerDay`) and an Isha logged then is still filed under yesterday.
 * 3. **Resynchronisation.** OS timers are unreliable in the background, so returning to the
 *    foreground recomputes unconditionally.
 *
 * Telling the *tracking store* what prayer day it is — the thing that stops a streak closing at
 * midnight instead of at Fajr — used to live here too. It does not any more: a screen-scoped
 * install disappears with the screen, so it moved to the root layout as `useTodayDayResolver`,
 * where it covers every route. This hook and that one derive the day the same way, from the same
 * settings, so they cannot drift.
 *
 * What it deliberately does **not** own is the second hand. `msRemaining` is the engine's figure at
 * the last recomputation, not a ticking value; the once-a-second tick lives in `LiveCountdown`, the
 * leaf that actually displays it, so the row list never re-renders for it (DESIGN.md §Animation
 * principles). Everything this hook returns is a pure function of its inputs — no clock is read
 * during render.
 *
 * Dependency rule: `hooks → stores + domain`. No SQL (the tracking store is the only door to the
 * database) and no user-facing strings.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  computeDayTimes,
  getCurrentPrayerDay,
  getNextPrayer,
  getPrayerWindows,
  type TimesLocation,
} from '@/domain/prayerTimes';
import { unloggedDayRecord } from '@/domain/streaks';
import { useCalculationSettings, useExemptionSettings, useLocation } from '@/stores/settingsStore';
import { useDayRecord, useTrackingActions, useTrackingHydrated } from '@/stores/trackingStore';

import type {
  AppLocation,
  CalculationSettings,
  DayRecord,
  DayTimes,
  NextPrayerInfo,
  Prayer,
  PrayerDay,
  PrayerWindow,
} from '@/domain/types';

/**
 * How long after a prayer's start the rollover fires. Half a second absorbs timer jitter, so the
 * recomputation always lands on the far side of the boundary and `getNextPrayer` (which is
 * strictly-after) really does return the *following* prayer instead of the same one again.
 */
const ROLLOVER_GRACE_MS = 500;

/**
 * Longest single `setTimeout` armed. A device asleep for six hours will not honour a six-hour
 * timer, so long waits are split into chunks that re-arm from the real clock. Chunking costs
 * nothing: only the chunk that actually crosses the boundary touches React state.
 */
const MAX_TIMER_MS = 10 * 60 * 1000;

/**
 * How often the clock is double-checked against the boundary the timer is waiting for. A safety
 * net, not the mechanism: on a phone where a long timer is held back (an OEM battery manager, a
 * paused Choreographer) the screen would otherwise sit on yesterday until the next foreground.
 * Each check is one comparison and touches React state only when a boundary was missed.
 */
const BOUNDARY_CHECK_MS = 30 * 1000;

/** Everything the Today screen reads. Every field is `null`/empty until a location exists. */
export interface PrayerDayView {
  /** The stored location, or `null` when the user has not set one yet. */
  location: AppLocation | null;
  /** The CURRENT prayer day (Fajr→Fajr), or `null` without a location. */
  day: PrayerDay | null;
  /** All eight markers for `day`, offsets applied. */
  times: DayTimes | null;
  /**
   * The five windows of `day`, in prayer order. Empty without a location. They do NOT tile the
   * day: Fajr's ends at sunrise, so sunrise→Dhuhr belongs to no window (`domain/windows.ts`).
   */
  windows: PrayerWindow[];
  /** The upcoming prayer — which may belong to tomorrow, after Isha. */
  next: NextPrayerInfo | null;
  /**
   * Milliseconds until `next` as of the last recomputation (never negative), or `null`. It does
   * not tick — pass it to `LiveCountdown`, which owns the second hand.
   */
  msRemaining: number | null;
  /** The day's statuses. Falls back to an all-unlogged record until the store answers. */
  record: DayRecord | null;
  /** Whether the day falls inside an exempt period (PRODUCT_SPEC §6). */
  isExempt: boolean;
  /** `true` once the day's record has actually been read from the database. */
  isLoaded: boolean;
  /** A computation failure (impossible coordinates, unresolvable polar day), or `null`. */
  error: Error | null;
  /** Whether a prayer's time has arrived — the condition for its seal being loggable. */
  hasStarted: (prayer: Prayer) => boolean;
  /** Whether a prayer is the upcoming one *of this day* (the hero's prayer). */
  isNext: (prayer: Prayer) => boolean;
  /**
   * Whether a prayer's window contains now — the row that carries the primary emphasis
   * (spec-today-interaction §1). Measured against the same `boundary` as `hasStarted`, so the
   * rollover tick that unlocks the next prayer is the same tick that moves "current" along.
   * `false` for every prayer on an exempt day (nothing is due), **between sunrise and Dhuhr**
   * (Fajr's window has shut and Dhuhr's has not opened), and when no window covers the instant
   * (degenerate extreme-latitude days) — never a crash path.
   */
  isCurrent: (prayer: Prayer) => boolean;
  /**
   * The boundary instant the whole snapshot answers for, in epoch ms. For callers that need to
   * place one more marker on the same clock (the Fajr row's "before sunrise" caption) without
   * reading `Date.now()` in a render.
   */
  asOf: number;
  /** Recomputes now. The screen never needs this; it exists for pull-to-refresh and tests. */
  refresh: () => void;
}

/** The memoised computation, or the error it failed with. */
interface Snapshot {
  day: PrayerDay;
  times: DayTimes;
  windows: PrayerWindow[];
  next: NextPrayerInfo;
}

/**
 * The next instant at which this hook's answers could change: the upcoming prayer's start, or the
 * earliest window END still ahead. Only Fajr's end (sunrise) is ever a boundary of its own — for
 * the other four it coincides with the following prayer's start, so this is a `min` over a set
 * that is usually one instant.
 *
 * @param snapshot - The current computation, or `null` without a location.
 * @param after - Only boundaries strictly after this epoch-ms instant count.
 * @returns The boundary in epoch ms, or `null` when there is nothing to wait for.
 */
function nextBoundaryMs(snapshot: Snapshot | null, after: number): number | null {
  if (snapshot === null) return null;
  let earliest: number | null = null;
  const consider = (candidate: number): void => {
    if (!Number.isFinite(candidate) || candidate <= after) return;
    if (earliest === null || candidate < earliest) earliest = candidate;
  };
  consider(snapshot.next.at.getTime());
  for (const window of snapshot.windows) consider(window.end.getTime());
  return earliest;
}

function computeSnapshot(
  at: Date,
  location: TimesLocation,
  calculation: CalculationSettings
): Snapshot {
  const day = getCurrentPrayerDay(at, location, calculation);
  return {
    day,
    times: computeDayTimes(day, location, calculation),
    windows: getPrayerWindows(day, location, calculation),
    next: getNextPrayer(at, location, calculation),
  };
}

/**
 * The Today screen's data.
 *
 * @returns A {@link PrayerDayView}; safe to call without a location (every field degrades to
 * `null`/empty rather than throwing, so the screen can render its empty state).
 */
export function usePrayerDay(): PrayerDayView {
  const location = useLocation();
  const calculation = useCalculationSettings();
  const hydrated = useTrackingHydrated();
  const { loadDay } = useTrackingActions();

  // Bumped whenever the world moved on: a prayer started, or the app came back to the foreground.
  // It is the memo's clock — the ONLY thing that lets an otherwise pure computation age.
  const [boundary, setBoundary] = useState(() => Date.now());
  const refresh = useCallback(() => {
    setBoundary(Date.now());
  }, []);

  // `boundary` is the instant the snapshot is computed *for*, which keeps this memo a pure
  // function of its dependencies (no clock read during render). It is never meaningfully stale:
  // a boundary is guaranteed to have been crossed before any prayer starts, so `getNextPrayer`
  // and `getCurrentPrayerDay` answer the same for `boundary` as they would for `Date.now()`.
  const computed = useMemo((): { snapshot: Snapshot | null; error: Error | null } => {
    if (location === null) return { snapshot: null, error: null };
    try {
      return { snapshot: computeSnapshot(new Date(boundary), location, calculation), error: null };
    } catch (cause) {
      // A location or an offset the engine cannot resolve must not white-screen the tab; the
      // screen renders a calm explanation instead (PRODUCT_SPEC §10 — the app stays usable).
      return { snapshot: null, error: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }, [location, calculation, boundary]);

  const snapshot = computed.snapshot;
  const day = snapshot?.day ?? null;

  // Rollover. One effect, one live timer, and exactly one state update per boundary crossed.
  //
  // The boundary to watch is the earliest instant at which any answer this hook gives could
  // change: the next prayer's start, or a window END still ahead of us. For four of the five
  // prayers those coincide; for Fajr the end is sunrise, hours before Dhuhr, and it is the
  // instant "current" stops being Fajr.
  useEffect(() => {
    const target = nextBoundaryMs(snapshot, boundary);
    if (target === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      const remaining = target + ROLLOVER_GRACE_MS - Date.now();
      if (remaining <= 0) {
        setBoundary(Date.now());
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
    };
    arm();

    // The net under the timer: if the clock has passed the boundary and the timer has not
    // fired, move on now. Owner, 2026-11-07: Today did not switch to the new day at Fajr.
    const check = setInterval(() => {
      if (Date.now() >= target + ROLLOVER_GRACE_MS) setBoundary(Date.now());
    }, BOUNDARY_CHECK_MS);

    return () => {
      if (timer !== null) clearTimeout(timer);
      clearInterval(check);
    };
  }, [snapshot, boundary]);

  // Timers do not survive a backgrounded app, and the day may have rolled over while it was away.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') setBoundary(Date.now());
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // The store's cache is read synchronously (no spinner for data already in memory) and filled by
  // an effect. `hydrate()` runs at startup; asking before it has would query a closed database.
  //
  // `exemptionMode` is a dependency, not decoration: a cached `DayRecord` was resolved against
  // the exemption setting in force when it was read, and that setting lives in the SETTINGS
  // store, whose changes cannot bump the tracking store's revision. Without this, turning
  // exemption mode on would leave today's rows rendering the `missed` they were logged with —
  // the one thing PRODUCT_SPEC §6 says an exempt day must never show. `loadDay` re-reads through
  // the store's `syncExemptionMode`, which drops the stale cache.
  const cached = useDayRecord(day ?? '');
  const { enabled: exemptionMode } = useExemptionSettings();
  useEffect(() => {
    if (!hydrated || day === null) return;
    loadDay(day);
  }, [hydrated, day, loadDay, exemptionMode]);

  const record = cached ?? (day === null ? null : unloggedDayRecord(day));

  const windows = useMemo(() => snapshot?.windows ?? [], [snapshot]);
  // Measured against `boundary`, not a fresh clock read: the rollover timer bumps the boundary
  // just after every prayer starts, so this flips at exactly the right render and stays pure.
  const hasStarted = useCallback(
    (prayer: Prayer): boolean => {
      const window = windows.find((candidate) => candidate.prayer === prayer);
      if (window === undefined) return false;
      return window.start.getTime() <= boundary;
    },
    [windows, boundary]
  );

  // Same clock as `hasStarted`, same windows. For four of the five prayers the window end IS the
  // next prayer's start, so the rollover tick that starts a prayer retires the previous one; for
  // Fajr the end is sunrise, which the rollover timer watches in its own right. Between sunrise
  // and Dhuhr NO prayer is current and every call answers `false` — nothing is due, which is the
  // truth and not a hole to paper over. No day-boundary logic here: `dates.ts` owns Fajr→Fajr.
  const isExempt = record?.isExempt ?? false;
  const isCurrent = useCallback(
    (prayer: Prayer): boolean => {
      if (isExempt) return false;
      const window = windows.find((candidate) => candidate.prayer === prayer);
      if (window === undefined) return false;
      return window.start.getTime() <= boundary && boundary < window.end.getTime();
    },
    [windows, boundary, isExempt]
  );

  const next = snapshot?.next ?? null;
  const isNext = useCallback(
    (prayer: Prayer): boolean =>
      next !== null && day !== null && next.day === day && next.prayer === prayer,
    [next, day]
  );

  return {
    location,
    day,
    times: snapshot?.times ?? null,
    windows,
    next,
    // The engine's own figure, measured from `boundary`. It is a *starting* value, not a ticking
    // one: `LiveCountdown` counts down from `next.at` on its own clock, so nothing here has to
    // re-render the screen once a second.
    msRemaining: next === null ? null : Math.max(0, next.msRemaining),
    record,
    isExempt,
    isLoaded: cached !== undefined,
    error: computed.error,
    hasStarted,
    isNext,
    isCurrent,
    asOf: boundary,
    refresh,
  };
}
