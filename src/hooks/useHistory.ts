/**
 * `useHistory` — the History tab's single answer to "which month am I looking at, what happened
 * on those days, and what do the numbers say".
 *
 * Like `usePrayerDay` it is a *composition* hook and computes nothing of its own. The month grid
 * comes from `domain/dates.monthGrid`, the Hijri span from `domain/hijri`, every statistic from
 * `domain/stats` / `domain/streaks` **through the tracking store**, and the day's times from
 * `domain/prayerTimes`. What it owns is the three things a screen cannot get from a pure function:
 *
 * 1. **Which month is visible, and the guard that it can never be a future one.** Navigation is
 *    clamped to the month containing the current prayer day (PRODUCT_SPEC §4: future days are
 *    locked, so paging into them would only show inert cells).
 * 2. **Bounded loading.** A user with years of history must not stall, so only a three-month
 *    window around the visible month is read — one dense range query per month first visited,
 *    remembered in a ref so paging back and forth re-queries nothing, and asked again only when
 *    the store has thrown that answer away. Statistics stay bounded by the store's own
 *    memoisation (`statsFor`/`streakSummary` are cached against its revision).
 * 3. **The selection.** Which day the detail panel is showing, whether that day may be edited at
 *    all, and the times its rows need.
 *
 * Dependency rule: `hooks → stores + domain`. No SQL (the tracking store is the only door to the
 * database) and no user-facing strings — every label the History tab renders is an i18n key
 * resolved in the components.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { endOfMonth, isFutureDay, monthKey as toMonthKey, startOfMonth } from '@/domain/dates';
import { useSettledRevision } from '@/hooks/useSettledRevision';
import { computeDayTimes } from '@/domain/prayerTimes';
import { mostLatePrayer, mostMissedPrayer } from '@/domain/stats';
import { displayRecord } from '@/domain/trackingMode';
import { useTrackingModeView } from './useTrackingModeView';
import {
  useCalculationSettings,
  useExemptionSettings,
  useLocation,
  useStreakMode,
} from '@/stores/settingsStore';
import { useTrackingActions, useTrackingHydrated, useTrackingStore } from '@/stores/trackingStore';

import type {
  DayRecord,
  Prayer,
  PrayerDay,
  StatsSummary,
  StreakMode,
  StreakSummary,
  TimeMarker,
} from '@/domain/types';

/** The stats windows the section offers (PRODUCT_SPEC §8). */
export const STATS_WINDOWS = [7, 30] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];

/**
 * How many months on each side of the visible one are read ahead. One is enough to make the
 * *next* swipe instant while keeping a page-in to ~92 days of rows.
 */
export const PRELOAD_MONTHS = 1;

/** A Gregorian month the calendar can render. */
export interface HistoryMonth {
  year: number;
  /** **Zero-based**, `0` = January … `11` = December (matches `Date` and `dates.monthGrid`). */
  monthIndex0: number;
  /** `YYYY-MM`, the stable identity of the month. */
  key: string;
}

/** Everything the History tab reads. */
export interface HistoryView {
  /** The current prayer day (Fajr→Fajr), as the tracking store resolves it. */
  today: PrayerDay;
  /** The month the calendar is showing. */
  month: HistoryMonth;
  /** Whether a later month exists that is not in the future. */
  canGoNext: boolean;
  /** Whether the visible month is already the current one. */
  isCurrentMonth: boolean;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  /** Jumps back to the month containing today. */
  goToToday: () => void;

  /** Resolved records for every day the store has cached; a miss renders as unlogged. */
  records: Record<PrayerDay, DayRecord>;
  /**
   * {@link records} as the tracking mode SHOWS them (D192) — for the calendar and the month bar.
   * The same object as `records` in detailed mode. Never hand these to a write or to the day
   * detail, which needs the stored statuses.
   */
  shownRecords: Record<PrayerDay, DayRecord>;

  /** The day the detail panel is showing, or `null` when it is closed. */
  selectedDay: PrayerDay | null;
  /** Opens the detail panel. A future day is refused (PRODUCT_SPEC §4). */
  selectDay: (day: PrayerDay | null) => void;
  /** Closes the detail panel. */
  clearSelection: () => void;
  selectedRecord: DayRecord | undefined;
  /**
   * The five prayer times of the selected day, or `null` when there is no location (or the engine
   * could not resolve them). The detail panel needs them for its rows.
   */
  selectedTimes: Record<Prayer, Date> | null;
  /**
   * The same five times for the current day, whatever is selected. The expanded layout's day panel
   * shows today until a cell is tapped, so it needs these even with no selection (D124).
   */
  todayTimes: Record<Prayer, Date> | null;

  /** Which stats window is active. */
  window: StatsWindow;
  setWindow: (window: StatsWindow) => void;

  /** `true` once the tracking store has read the database; nothing is queried before that. */
  hydrated: boolean;
  /** The active streak mode — the one the streak card reports (PRODUCT_SPEC §5). */
  streakMode: StreakMode;
  /** Streak summary for the active mode, or `null` before hydration. */
  streak: StreakSummary | null;
  /** Stats over the active window, or `null` before hydration. */
  stats: StatsSummary | null;
  /** Lifetime stats, or `null` before hydration. */
  lifetime: StatsSummary | null;
  /**
   * The last seven days' completion rate, whatever window the switch is on — the streak hero's
   * ring is always "this week" (D183). `null` before hydration or when nothing was obligated.
   */
  weekRate: number | null;
  /** The prayer missed most often in the active window, or `null` when none was. */
  mostMissed: Prayer | null;
  /** The prayer prayed late most often in the active window, or `null` when none was. */
  mostLate: Prayer | null;
  /** `true` when nothing has ever been logged — the calm empty state. */
  isEmpty: boolean;
}

/** The month a prayer day belongs to. */
function monthOf(day: PrayerDay): HistoryMonth {
  const [year, month] = day.split('-');
  return { year: Number(year), monthIndex0: Number(month) - 1, key: toMonthKey(day) };
}

/** Shifts a month by whole months, normalising the year. */
function shiftMonth(month: HistoryMonth, delta: number): HistoryMonth {
  const absolute = month.year * 12 + month.monthIndex0 + delta;
  const year = Math.floor(absolute / 12);
  const monthIndex0 = absolute - year * 12;
  return {
    year,
    monthIndex0,
    key: `${String(year).padStart(4, '0')}-${String(monthIndex0 + 1).padStart(2, '0')}`,
  };
}

/** The 1st of a month, as a prayer day. */
function firstDayOf(month: HistoryMonth): PrayerDay {
  return `${String(month.year).padStart(4, '0')}-${String(month.monthIndex0 + 1).padStart(2, '0')}-01`;
}

/**
 * A day's five *tracked* prayer times, or `null` when they cannot be had.
 *
 * Narrowed to the five deliberately: the detail rows have no use for sunrise or the night markers,
 * and handing them out would invite a sixth row.
 *
 * @param day - The day to resolve, or `null` for "no day".
 * @param location - The active location, or `null` when there is none.
 * @returns The five times, or `null` without a day, without a location, or when the engine cannot
 *   resolve the day (a polar latitude, an impossible offset) — which must never white-screen a tab.
 */
function trackedTimesFor(
  day: PrayerDay | null,
  location: Parameters<typeof computeDayTimes>[1] | null,
  calculation: Parameters<typeof computeDayTimes>[2]
): Record<Prayer, Date> | null {
  if (day === null || location === null) return null;
  try {
    const { times } = computeDayTimes(day, location, calculation);
    const pick = (marker: TimeMarker) => times[marker];
    return {
      fajr: pick('fajr'),
      dhuhr: pick('dhuhr'),
      asr: pick('asr'),
      maghrib: pick('maghrib'),
      isha: pick('isha'),
    };
  } catch {
    return null;
  }
}

/**
 * The History tab's data.
 *
 * @returns A {@link HistoryView}. Safe to call before the store has hydrated and without a
 * location: the numbers come back `null` and the calendar renders as an empty month rather than
 * throwing.
 */
export function useHistory(): HistoryView {
  const hydrated = useTrackingHydrated();
  const streakMode = useStreakMode();
  const location = useLocation();
  const calculation = useCalculationSettings();
  const { enabled: exemptionMode } = useExemptionSettings();
  const { loadRange } = useTrackingActions();

  // The store owns the Fajr→Fajr boundary; asking it (rather than reading the calendar date) is
  // what keeps History agreeing with Today between midnight and Fajr.
  const today = useTrackingStore((state) => state.todayDay());
  const currentMonth = useMemo(() => monthOf(today), [today]);

  // The visible month is stored as a **non-positive offset from the current month**, never as an
  // absolute month. That single choice is what makes "never page into the future" structural
  // rather than a rule to enforce: `0` is always this month whatever day it is, so a rollover at
  // Fajr on the 1st cannot leave the calendar sitting on a month the user has not lived through,
  // and no effect has to reach back and correct the state after the fact.
  const [monthsBack, setMonthsBack] = useState(0);
  const [selection, setSelection] = useState<PrayerDay | null>(null);
  const [window, setWindow] = useState<StatsWindow>(STATS_WINDOWS[0]);

  const visible = useMemo(() => shiftMonth(currentMonth, monthsBack), [currentMonth, monthsBack]);
  const canGoNext = monthsBack < 0;

  const goToPreviousMonth = useCallback(() => {
    setMonthsBack((offset) => offset - 1);
  }, []);

  const goToNextMonth = useCallback(() => {
    setMonthsBack((offset) => Math.min(0, offset + 1));
  }, []);

  const goToToday = useCallback(() => {
    setMonthsBack(0);
  }, []);

  const cachedDays = useTrackingStore((state) => state.dayRecords);
  const modeView = useTrackingModeView();
  const shownRecords = useMemo(() => {
    if (modeView.mode === 'detailed') return cachedDays;
    const shown: Record<PrayerDay, DayRecord> = {};
    for (const [day, record] of Object.entries(cachedDays)) shown[day] = displayRecord(record, modeView);
    return shown;
  }, [cachedDays, modeView]);
  const revision = useTrackingStore((state) => state.revision);

  /**
   * Which (month, exemption mode) pairs have been read, and at which store revision.
   *
   * The exemption mode is half the key because it changes how every day in the range resolves
   * (PRODUCT_SPEC §6) and lives in a store that cannot invalidate this one.
   *
   * The rest is about *staying* read. A log refreshes only the day it touched, but recording an
   * exempt period, re-hydrating, or `invalidateDays` drops the store's day cache **wholesale** —
   * so "July was read" is not a fact that keeps: the month's own days have to still be there. The
   * recorded revision is the loop guard behind that check, so a store that answers a read with
   * nothing is asked again on the next change rather than on the next render.
   */
  const attempts = useRef(new Map<string, number>());
  useEffect(() => {
    if (!hydrated) return;
    for (let offset = -PRELOAD_MONTHS; offset <= PRELOAD_MONTHS; offset += 1) {
      // Never read forward past today: those days cannot hold a log.
      if (monthsBack + offset > 0) continue;
      const month = shiftMonth(currentMonth, monthsBack + offset);
      const cacheKey = `${String(exemptionMode)}:${month.key}`;
      const { from, to } = monthRange(month);
      const attempt = attempts.current.get(cacheKey);
      if (attempt !== undefined && (attempt === revision || cachedDays[from] !== undefined)) {
        continue;
      }
      attempts.current.set(cacheKey, revision);
      loadRange(from, to);
    }
  }, [hydrated, monthsBack, currentMonth, exemptionMode, loadRange, cachedDays, revision]);

  const selectDay = useCallback(
    (day: PrayerDay | null) => {
      // The guard belongs here rather than in the calendar: a future day has nothing to show and
      // nothing to edit, so it must not be able to open the panel from anywhere.
      if (day !== null && isFutureDay(day, today)) return;
      setSelection(day);
    },
    [today]
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  // Derived, not corrected: a stored selection that has become a future day (the clock was moved
  // backwards, or the boundary re-resolved) simply stops being a selection, with no effect writing
  // state back on the next render.
  const selectedDay = selection !== null && isFutureDay(selection, today) ? null : selection;

  const selectedRecord = selectedDay === null ? undefined : cachedDays[selectedDay];

  const selectedTimes = useMemo(
    () => trackedTimesFor(selectedDay, location, calculation),
    [selectedDay, location, calculation]
  );

  // The same five times for the current day, whether or not anything is selected. The expanded
  // History layout shows a day *panel* rather than a sheet (D124), and a panel is never empty — it
  // falls back to today until the user picks a cell, so it needs today's times even when the
  // selection is null.
  const todayTimes = useMemo(
    () => trackedTimesFor(today, location, calculation),
    [today, location, calculation]
  );

  // Every number is read through the store, which memoises each summary against its revision.
  // Read in a render keyed on a SETTLED revision, never in a selector: a selector runs inside
  // every store write, so the summaries — whole-history SQLite reads — ran inside the seal tap
  // itself. Settled, they run once a burst of taps is over (D191, D197), exactly as
  // `TodayHeader`'s streak does.
  const deferredRevision = useSettledRevision();
  const streakSummary = useTrackingStore((state) => state.streakSummary);
  const statsFor = useTrackingStore((state) => state.statsFor);
  const summaries = useMemo(() => {
    // Not read here, but each changes the answers: the revision, and three things that cannot bump it.
    void [deferredRevision, streakMode, today, exemptionMode];
    if (!hydrated) return null;
    return {
      streak: streakSummary(),
      stats: statsFor(window),
      lifetime: statsFor(null),
      weekRate: statsFor(STATS_WINDOWS[0]).completionRate,
    };
  }, [hydrated, deferredRevision, streakSummary, statsFor, window, streakMode, today, exemptionMode]);
  const streak = summaries?.streak ?? null;
  const stats = summaries?.stats ?? null;
  const lifetime = summaries?.lifetime ?? null;
  const weekRate = summaries?.weekRate ?? null;

  return {
    today,
    month: visible,
    canGoNext,
    isCurrentMonth: monthsBack === 0,
    goToPreviousMonth,
    goToNextMonth,
    goToToday,
    records: cachedDays,
    shownRecords,
    selectedDay,
    selectDay,
    clearSelection,
    selectedRecord,
    selectedTimes,
    todayTimes,
    window,
    setWindow,
    hydrated,
    streakMode,
    streak,
    stats,
    lifetime,
    weekRate,
    // The callouts are domain functions over a summary the store already computed — the component
    // never derives a statistic of its own (PRODUCT_SPEC §8).
    mostMissed: stats === null ? null : mostMissedPrayer(stats),
    mostLate: stats === null ? null : mostLatePrayer(stats),
    isEmpty: lifetime !== null && lifetime.totalTracked === 0 && lifetime.unlogged === 0,
  };
}

/**
 * The days a month's calendar covers, as an inclusive range.
 *
 * @param month - The month to bound.
 * @returns `{ from, to }` — the 1st and the last day of the month, via `domain/dates`.
 */
export function monthRange(month: HistoryMonth): { from: PrayerDay; to: PrayerDay } {
  const from = startOfMonth(firstDayOf(month));
  return { from, to: endOfMonth(from) };
}
