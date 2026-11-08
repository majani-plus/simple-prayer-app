/**
 * Tracking store — the composition point the UI calls to read and change prayer state.
 *
 * It owns exactly three things:
 *
 * 1. **Cached state**: the normalised exempt periods, the current qada debts, and the resolved
 *    `DayRecord`s for whatever ranges the screens have asked for (History asks for a month,
 *    Today for a single day). Every read the UI performs is a synchronous hit against that
 *    cache, so the Today screen never renders a spinner for data it already has.
 * 2. **Persistence orchestration**: it calls `src/db/queries.ts` — never SQL, never a raw row —
 *    and wraps every multi-write action in a single transaction, so a log write and its qada
 *    side effect can never diverge.
 * 3. **Delegation to the domain**: every rule lives in `src/domain/*`. Debt math is
 *    `domain/qada`, exemption ranges are `domain/exemptions`, streaks/stats are their own
 *    modules, and *all* day arithmetic is `domain/dates`. This module contains no business
 *    rule of its own; if something here looks like a calculation, it is a guard or a cache key.
 *
 * ## Qada side effects (PRODUCT_SPEC §7)
 *
 * Logging `missed` increments that prayer's debt (`qada.applyMiss`) and appends an `add` event;
 * changing a `missed` log to anything else decrements it again (`qada.applyUndoMiss`) and
 * appends the mirroring `add` event with a negative delta. Marking a missed prayer as made up
 * decrements the debt and appends a `tick` event — the event type the pace calculation reads —
 * and un-marking it re-adds the debt. A `missed` log that was **already made up** does not
 * decrement a second time when its status is later edited: the debt it created was paid.
 *
 * An event is appended only when the counter actually moved, because a `tick` that paid off
 * nothing would inflate the pace in `qada.computeProgress` (see that module's header). The same
 * rule is why `markMadeUp` refuses outright when the prayer's counter is already zero: a made-up
 * marker with no matching `tick` would resurrect forgiven debt the moment it was cleared.
 *
 * Exempt-period writes carry their own debt side effect (spec-exemption §5, D-x5): a period that
 * comes to cover a day holding outstanding `missed` logs refunds those debts, and one that stops
 * covering such a day re-adds them — both inside the period write's own transaction. See
 * {@link reconcileDebtsForCoverageChange}.
 *
 * ## Guards
 *
 * - **Future days are locked** (PRODUCT_SPEC §8/§4): a status write for a day after the current
 *   prayer day is refused and returns `false`.
 * - **Exempt days are never edited**: on an exempt day all five prayers are `exempt` by
 *   definition (PRODUCT_SPEC §6), so status writes — including the made-up conversion and its
 *   reversal — are refused rather than allowed to leave a `missed` row, or move a debt, under
 *   an exemption.
 * - **The day cache AND the qada counters follow the exemption setting**: `exemptionModeEnabled`
 *   lives in the settings store, so flipping it cannot bump `revision` by itself; the cached
 *   records are dropped and the debts reconciled against the new effective coverage in
 *   `syncExemptionMode` — eagerly via the singleton's settings subscription, lazily from every
 *   action for stores composed without one.
 * - Both guards return `false` instead of throwing: they are reachable through ordinary UI
 *   races (the day rolls over while a seal is open), not programmer errors.
 * - **A database that cannot answer refuses instead of throwing.** Every mutating action runs
 *   through {@link attempt}: after a failed migration (the root layout deliberately survives
 *   one) the tables do not exist, and the first seal tap would otherwise throw a raw SQL error
 *   out of a press handler — which in a release build is a crash, not a red screen. The tap
 *   degrades to "nothing happened" instead, matching the app-wide failure policy.
 *
 * ## Injection
 *
 * Nothing native is touched at import time. The database handle, the settings snapshot, the
 * clock and the current prayer day all arrive through {@link TrackingStoreDeps}, which is what
 * lets the tests run the real SQL against better-sqlite3 with an in-memory settings store.
 *
 * "Today" has a second, *runtime* injection point on top of that constructor dependency:
 * {@link TrackingActions.setTodayDayResolver}. The store must never import the location or the
 * prayer-time engine as a hard dependency of a write — it would tie every log to a module graph
 * that has nothing to do with persistence — so the screen that already knows both hands its
 * resolver down instead (`hooks/usePrayerDay`). Nothing is *required* to: with no resolver
 * installed the store falls back to {@link resolvePrayerDay}, and if that cannot answer either,
 * to the calendar date. Being wrong about the day must never make a log un-writable.
 *
 * Dependency rule: `stores → db + domain`. No React Native imports, no user-facing strings
 * (i18n happens in the UI).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';

import { getDb, type SyncDatabase } from '../db/client';
import * as queries from '../db/queries';
import {
  addDays,
  compareDays,
  isAfterDay,
  isBeforeDay,
  isFutureDay,
  isValidDay,
  prayerDayForInstant,
  todayDay as calendarToday,
} from '../domain/dates';
import * as exemptions from '../domain/exemptions';
import { computeDayTimes } from '../domain/prayerTimes';
import * as qada from '../domain/qada';
import { computeStats } from '../domain/stats';
import { computeStreak, unloggedDayRecord } from '../domain/streaks';
import {
  derivedMisses,
  displayRecord,
  modeViewFor,
  modeViewKey,
  simpleQadaDebts,
  simpleTapTarget,
  type ModeView,
} from '../domain/trackingMode';
import { PRAYERS } from '../domain/types';
import type {
  AppLocation,
  AppSettings,
  CalculationSettings,
  DayRecord,
  ExemptPeriod,
  LoggableStatus,
  Prayer,
  PrayerDay,
  PrayerStatus,
  QadaDebts,
  QadaEvent,
  QadaProgress,
  StatsSummary,
  StreakSummary,
  TrackingMode,
} from '../domain/types';
import { perfMark } from '../utils/perfMarks';
import { getSettingsSnapshot, useSettingsStore } from './settingsStore';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Everything the store needs from the outside world. All four are functions so that nothing is
 * resolved at import time — importing this module must stay safe in Jest and in scripts.
 */
export interface TrackingStoreDeps {
  /** The Drizzle handle. Called on every action; the app passes the lazily-opened singleton. */
  getDb: () => SyncDatabase;
  /** The current settings snapshot. `streakMode` and `exemptionModeEnabled` are read from it. */
  getSettings: () => AppSettings;
  /** Epoch ms "now". Injected so tests can pin timestamps. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * The prayer day the user is currently living in, when nobody has called
   * {@link TrackingActions.setTodayDayResolver}.
   *
   * Defaults to the local **calendar** day (`dates.todayDay`), which is correct *except* between
   * midnight and Fajr — and that is the one window where being wrong is visible. The application
   * store therefore passes {@link resolvePrayerDay}, which applies the Fajr→Fajr boundary for
   * real (PRODUCT_SPEC §3); the calendar default remains for tests, which pin the day outright.
   */
  getTodayDay?: () => PrayerDay;
  /**
   * Runs the deferred database write of a prayer log (D191). Defaults to `setTimeout(run, 0)`:
   * the tap paints first, the write lands on the next tick. Tests pass `(run) => run()` to keep
   * a write synchronous, or a manual queue to look at the state in between.
   */
  scheduleWrite?: (run: () => void) => void;
}

/**
 * A source of "what prayer day is it right now".
 *
 * Implementations are called on every read that needs the day, so they must be cheap and must
 * read the clock themselves rather than close over a captured instant — a resolver that returns
 * a frozen value goes stale the moment the app is backgrounded across Fajr, and a stale "today"
 * turns the real today into a *future* day, which {@link TrackingActions.setStatus} refuses.
 *
 * Throwing is allowed and handled: the store falls through to the next candidate.
 */
export type TodayDayResolver = () => PrayerDay;

/** Statuses this store will persist. `exempt` is derived from periods, never written per-prayer. */
export type SettableStatus = LoggableStatus | 'unlogged';

/** Where a whole-record debt write came from — decides the audit event type. */
export type QadaDebtsSource = 'estimate' | 'manual';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The cached slice. Everything in it is a mirror of the database, never a source of truth. */
export interface TrackingState {
  /** `true` once {@link TrackingActions.hydrate} has run at least once. */
  hydrated: boolean;
  /** Exempt periods, normalised with `domain/exemptions.normalizePeriods`. */
  exemptPeriods: ExemptPeriod[];
  /** The current outstanding qada debt per prayer. */
  debts: QadaDebts;
  /** Resolved day records, keyed by prayer day. Populated by the `load*` actions. */
  dayRecords: Record<PrayerDay, DayRecord>;
  /**
   * Bumped by every mutation and every cache invalidation. Derived selectors memoise against
   * it, so a component can also use it as a cheap "something changed" subscription.
   */
  revision: number;
}

/** Options for {@link TrackingActions.streakSummary}. */
export interface StreakSummaryOptions {
  /** Whether the still-open current day may extend the streak. Defaults to `true` (§5). */
  includeToday?: boolean;
}

/** The actions and selectors the UI calls. */
export interface TrackingActions {
  // -- lifecycle ------------------------------------------------------------
  /** Loads exempt periods and qada debts from the database and clears the day cache. */
  hydrate(): void;
  /** Drops every cached day record (the periods and debts caches are kept). */
  invalidateDays(): void;
  /**
   * Re-checks `exemptionModeEnabled` and, when it has flipped since last observed, drops the
   * day cache AND reconciles the qada counters against the new effective coverage — the toggle
   * changes what a stored period covers exactly as a period write does. Every mutating action
   * and cache read calls this lazily; the application singleton additionally calls it from a
   * settings-store subscription so the flip settles synchronously inside the toggle itself.
   * A no-op when nothing changed.
   */
  syncExemptionMode(): void;
  /**
   * Installs the resolver the store asks "what prayer day is it" — the runtime injection point
   * described in the module header.
   *
   * The caller is whoever already holds the location and the calculation settings, which in this
   * app is `hooks/useTodayDayResolver`, called once from the root layout: the store then files a
   * write, judges a streak and locks a future day against exactly the day the user is looking at,
   * instead of against a second derivation of the same rule that could drift from it.
   *
   * Installing (or releasing) bumps `revision` when the answer actually changes, so components
   * subscribed to derived selectors re-render on the day the resolver corrected.
   *
   * @param resolver - The resolver to install, or `null` to go back to the injected fallback.
   *   It must read the clock itself — see {@link TodayDayResolver}.
   * @returns A release function. It is a no-op once a *later* resolver has been installed, so
   *   two mounted screens releasing in either order can never drop each other's resolver; pass
   *   it straight back from a `useEffect`.
   */
  setTodayDayResolver(resolver: TodayDayResolver | null): () => void;

  // -- reads ----------------------------------------------------------------
  /** The prayer day the store considers "today" (see {@link TrackingStoreDeps.getTodayDay}). */
  todayDay(): PrayerDay;
  /** Loads and caches one dense inclusive day range; returns it ascending. */
  loadRange(fromDay: PrayerDay, toDay: PrayerDay): DayRecord[];
  /** Loads and caches a single day; returns it. */
  loadDay(day: PrayerDay): DayRecord;
  /** Cached record for a day, reading through to the database on a miss. */
  dayRecordFor(day: PrayerDay): DayRecord;
  /** Whether a day is exempt, honouring the `exemptionModeEnabled` setting. */
  isExemptDay(day: PrayerDay): boolean;

  // -- logging --------------------------------------------------------------
  /**
   * Sets a prayer's status, applying the qada side effects — **optimistically** (D191): the
   * cached day and the debts change at once, and the database write follows on the next tick
   * through an ordered queue. `true` means the write was accepted; if it later fails, the cache
   * is put back to what the database holds and {@link onWriteFailed} listeners hear about it.
   */
  setStatus(day: PrayerDay, prayer: Prayer, status: SettableStatus): boolean;
  /**
   * Writes every queued log to the database now. Every other action that touches the database
   * calls it first, so nothing ever reads around a queued write.
   *
   * @returns `false` when a queued write failed (and was rolled back).
   */
  flushWrites(): boolean;
  /**
   * Subscribes to failed deferred writes — the screen plays an error haptic.
   *
   * @returns The unsubscribe function.
   */
  onWriteFailed(listener: () => void): () => void;
  /** The seal interaction: choosing the status a prayer already has clears it to unlogged. */
  toggleStatus(day: PrayerDay, prayer: Prayer, status: LoggableStatus): boolean;
  /**
   * Simple mode's one tap (D192): a prayer that shows as prayed (stored `prayed` or `late`) is
   * cleared, anything else is stored `prayed`. Goes through {@link setStatus}, so every guard and
   * qada side effect is the same; it never writes `late` or `missed`.
   */
  toggleSimpleStatus(day: PrayerDay, prayer: Prayer): boolean;
  /**
   * Marks a stored `missed` prayer as made up: decrements the debt, records a `tick`.
   * Refused (`false`) when the prayer's counter is already zero — there is nothing to pay off,
   * and a marker with no matching `tick` would let {@link clearMadeUp} re-create the debt.
   */
  markMadeUp(day: PrayerDay, prayer: Prayer): boolean;
  /** Reverses {@link markMadeUp}: the prayer is owed again. */
  clearMadeUp(day: PrayerDay, prayer: Prayer): boolean;

  // -- qada -----------------------------------------------------------------
  /** Ticks one made-up prayer off the debt (the qada screen's button). */
  tickQada(prayer: Prayer): boolean;
  /** Replaces all five counters — the setup wizard's estimate or hand-edit. */
  setQadaDebts(debts: QadaDebts, source?: QadaDebtsSource): QadaDebts;
  /** "Start fresh": zeroes the counters, archiving them in a `forgive` event. */
  forgiveQada(): boolean;
  /**
   * The `forgive` event still inside its 30-day undo window, or `null` — also `null` once the
   * undo has been taken, or once the setup wizard has set the counters again (D79).
   */
  undoableForgive(): QadaEvent | null;
  /**
   * Adds the counters archived by the latest undoable forgiveness back on top of the current
   * ones (D79). Refused (`false`) when {@link undoableForgive} offers nothing.
   */
  undoForgive(): boolean;

  // -- exemptions -----------------------------------------------------------
  /** Marks the user exempt from `day` onward (open-ended). */
  startExemptPeriod(day: PrayerDay): ExemptPeriod[];
  /**
   * Ends the ongoing exemption, `day` being the last exempt day (inclusive). "Ongoing" covers a
   * period begun with an end date as well as an open-ended one, so this also cuts a planned
   * period short.
   */
  endExemptPeriod(day: PrayerDay): ExemptPeriod[];
  /**
   * Records a **closed** period: the historical-entry path (spec-exemption §2b), and equally the
   * path for a period begun with an end date, where `endDay` is in the future and the coverage
   * runs out on its own. Refused (`false`) when a day is malformed or `endDay` precedes
   * `startDay`.
   */
  addExemptPeriod(startDay: PrayerDay, endDay: PrayerDay): boolean;
  /**
   * Rewrites one stored period's days — the edit path for a record entered wrong. `endDay`
   * `null` keeps (or makes) the period open-ended. Refused (`false`) when the id does not
   * exist, a day is malformed, or the range is inverted.
   */
  updateExemptPeriod(id: number, startDay: PrayerDay, endDay: PrayerDay | null): boolean;
  /** Deletes one stored period by row id. */
  deleteExemptPeriod(id: number): boolean;

  // -- derived --------------------------------------------------------------
  /** Streak summary for the active `streakMode`, over the whole logged history. */
  streakSummary(opts?: StreakSummaryOptions): StreakSummary;
  /**
   * Stats over the last `windowDays` days, or lifetime when `null`, as the tracking mode shows
   * them (D192). `mode` overrides the setting — `'detailed'` reads the stored log as it is, which
   * is what a "does this person log at all" gate must look at.
   */
  statsFor(windowDays: number | null, mode?: TrackingMode): StatsSummary;
  /**
   * The qada counters to SHOW: the stored debts in detailed mode; in simple mode the stored debts
   * plus the misses simple mode shows, less the ones made up (`domain/trackingMode`).
   */
  qadaShownDebts(): QadaDebts;
  /** Simple mode's shown-only misses per prayer (all zero in detailed mode). */
  qadaDerivedMisses(): QadaDebts;
  /** Debt totals, recent pace and projected clear day — over {@link qadaShownDebts}. */
  qadaProgress(paceWindowDays?: number): QadaProgress;
}

/** Full store: the cached state plus the actions. */
export type TrackingStore = TrackingState & TrackingActions;

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

/**
 * Builds a tracking store bound to a database, a settings source and a clock.
 *
 * The store is inert until {@link TrackingActions.hydrate} is called: creating it touches
 * neither the database nor the settings.
 *
 * @param deps - Database handle, settings snapshot, and optional clock / today overrides.
 * @returns A zustand hook with `.getState()`, `.setState()` and `.subscribe()`.
 */
export function createTrackingStore(deps: TrackingStoreDeps) {
  const now = deps.now ?? (() => Date.now());
  const fallbackToday = deps.getTodayDay ?? (() => calendarToday(new Date(now())));

  // The resolver the app installed at runtime, if any (see `setTodayDayResolver`). It is plain
  // closure state rather than store state on purpose: it is a *dependency*, not data the UI
  // renders, and putting a function in an immer-managed slice would freeze it.
  let installedToday: TodayDayResolver | null = null;

  /**
   * "Today", as three candidates tried in order: the installed resolver, the injected fallback,
   * the calendar date. Each candidate may throw or hand back nonsense (an unresolvable polar
   * Fajr, a hook that unmounted mid-call) and is simply skipped — this function is on the path
   * of every write, and a thrown day would take a log with it.
   */
  function resolveTodayDay(): PrayerDay {
    return (
      tryResolveDay(installedToday) ??
      tryResolveDay(fallbackToday) ??
      calendarToday(new Date(now()))
    );
  }

  // Derived selectors are pure functions of (database contents, settings, today), and the
  // database only changes through this store, so `revision` is a sound cache key. The memo is
  // dropped wholesale whenever it changes.
  let memoRevision = -1;
  const memo = new Map<string, unknown>();
  function memoised<T>(revision: number, key: string, compute: () => T): T {
    if (revision !== memoRevision) {
      memo.clear();
      memoRevision = revision;
    }
    if (memo.has(key)) return memo.get(key) as T;
    const value = compute();
    memo.set(key, value);
    return value;
  }

  // Every cached `DayRecord` was resolved against the `exemptionModeEnabled` setting in force
  // when it was read, and that setting lives in a different store whose changes cannot bump
  // `revision`. Remembering the mode the cache was filled under is what stops a stale record
  // rendering an exempt day as missed (or a plain day as exempt) after the toggle.
  let cachedExemptionMode: boolean | null = null;

  // The optimistic write queue (D191) — see `openDb` below.
  const scheduleWrite = deps.scheduleWrite ?? ((run: () => void) => setTimeout(run, 0));
  let queuedWrites: QueuedWrite[] = [];
  // The cache as it stood before the first write still in the queue: the rollback of last
  // resort, when the database cannot even be read back.
  let queueBaseline: QueueBaseline | null = null;
  let writeScheduled = false;
  const writeFailedListeners = new Set<() => void>();

  return create<TrackingStore>()(
    immer<TrackingStore>((set, get) => {
      /**
       * Brings the store in line with `exemptionModeEnabled` when it has flipped since last
       * observed. Called from every action that reads or writes (a no-op in the common case),
       * and eagerly by the application singleton's settings subscription, so in the app the
       * flip is settled synchronously inside the toggle itself.
       *
       * Two things must follow the flag TOGETHER:
       *
       * 1. **The day cache**, which was resolved under the old mode — a stale record would
       *    render an exempt day as missed, or a plain day as exempt.
       * 2. **The qada counters.** Flipping the flag changes *effective* coverage exactly as a
       *    period write does — stored periods are invisible while the mode is off (PRODUCT_SPEC
       *    §6) — so the same reconciliation runs: switching ON refunds the outstanding `missed`
       *    logs the stored periods cover, switching OFF re-adds the ones it reveals. Without
       *    this, a miss logged on a covered day while the mode was off would be *hidden* by the
       *    switch-on while its debt silently stood — she would owe make-up prayers she was never
       *    obliged to make up, reached by a perfectly legal toggle instead of a backdated write.
       *    What the user can see and what the counters believe must never diverge.
       *
       * On a database failure the new mode is deliberately NOT remembered, so the next action
       * retries the reconciliation instead of leaving the counters desynced forever.
       */
      function syncExemptionMode(): void {
        const enabled = deps.getSettings().exemptionModeEnabled;
        if (cachedExemptionMode === enabled) return;

        // A real flip — not the first observation of the session — settles the debts first.
        if (cachedExemptionMode !== null) {
          const reconciled = attempt(false, () => {
            const at = now();
            const debts = queries.withTransaction(openDb(), (tx) => {
              const stored = exemptions.normalizePeriods(queries.listExemptPeriods(tx));
              return reconcileDebtsForCoverageChange(
                tx,
                enabled ? [] : stored,
                enabled ? stored : [],
                at
              );
            });
            set((state) => {
              state.debts = debts;
            });
            return true;
          });
          if (!reconciled) return;
        }

        cachedExemptionMode = enabled;
        set((state) => {
          state.dayRecords = {};
          state.revision += 1;
        });
      }

      /** Exempt days inside a range — empty when exemption mode is off (PRODUCT_SPEC §6). */
      function exemptDaysIn(fromDay: PrayerDay, toDay: PrayerDay): ReadonlySet<PrayerDay> {
        if (!deps.getSettings().exemptionModeEnabled) return new Set();
        return exemptions.expandExemptDays(get().exemptPeriods, fromDay, toDay);
      }

      /** Re-reads one day from the database into the cache and bumps `revision`. */
      function refreshDay(database: SyncDatabase, day: PrayerDay): DayRecord {
        const record = queries.getDayRecord(database, day, exemptDaysIn(day, day));
        set((state) => {
          state.dayRecords[day] = record;
          state.revision += 1;
        });
        return record;
      }

      // -- Optimistic log writes (D191) ----------------------------------------------------
      //
      // A seal tap patches the cached day and the debts at once and queues the SQL; the queue
      // drains on the next tick (`scheduleWrite`), in tap order. Every other database access goes
      // through `openDb`, which drains the queue first — so a read, a streak or another write
      // never sees the database behind the cache. Each queued write still decides its qada side
      // effect from the row it finds at commit time, inside its own transaction, exactly as before.

      /** The database handle, with every queued log written first. */
      function openDb(): SyncDatabase {
        flushWrites();
        return deps.getDb();
      }

      function flushWrites(): boolean {
        if (queuedWrites.length === 0) return true;
        const jobs = queuedWrites;
        const baseline = queueBaseline;
        queuedWrites = [];
        queueBaseline = null;

        let failed = false;
        let committed: QadaDebts | null = null;
        for (const job of jobs) {
          const debts = attempt<QadaDebts | null>(null, () =>
            writeStatus(deps.getDb(), job.day, job.prayer, job.status, job.at)
          );
          if (debts === null) failed = true;
          else committed = debts;
        }
        perfMark('commit');

        if (!failed) {
          // The patch already holds these numbers; this only catches a disagreement.
          const final = committed;
          if (final !== null && !sameDebts(final, get().debts)) {
            set((state) => {
              state.debts = final;
            });
          }
          return true;
        }

        rollBack(
          [...new Set(jobs.map((job) => job.day))],
          baseline ?? { dayRecords: get().dayRecords, debts: get().debts }
        );
        for (const listener of writeFailedListeners) listener();
        return false;
      }

      /**
       * Puts the cache back to what the database holds. When the database cannot even be read
       * (the failed-migration case), the cache goes back to how it was before the first queued
       * tap instead.
       *
       * ponytail: a drain where one write landed and the database died before the next falls to
       * the baseline for that day too; the next read of the day corrects it.
       */
      function rollBack(days: PrayerDay[], baseline: QueueBaseline): void {
        const reread = attempt(false, () => {
          const database = deps.getDb();
          const debts = queries.getQadaDebts(database);
          const records = days.map((day) =>
            queries.getDayRecord(database, day, exemptDaysIn(day, day))
          );
          set((state) => {
            state.debts = debts;
            for (const record of records) state.dayRecords[record.day] = record;
            state.revision += 1;
          });
          return true;
        });
        if (reread) return;
        set((state) => {
          state.debts = baseline.debts;
          for (const day of days) {
            const before = baseline.dayRecords[day];
            if (before === undefined) delete state.dayRecords[day];
            else state.dayRecords[day] = before;
          }
          state.revision += 1;
        });
      }

      /**
       * Applies a domain transform to the STORED exempt periods and persists the result —
       * **together with the qada consequences of the coverage change, in the same transaction**.
       *
       * `replaceExemptPeriods` replaces the whole table, so the list handed to it has to be
       * derived from the rows that are actually there — never from `state.exemptPeriods`, which
       * is `[]` until {@link TrackingActions.hydrate} has run and would therefore delete every
       * period the user ever recorded. Reading, transforming and writing inside ONE transaction
       * also makes the read-modify-write atomic against any other writer of the table.
       *
       * The debt reconciliation is the load-bearing half (spec-exemption §2b/§5, D-x5): a
       * backdated period that comes to cover a day logged `missed` hides the miss from every
       * surface, and hiding it WITHOUT refunding the debt it created would leave the user owing
       * make-up prayers she was never obliged to make up — the single worst outcome this feature
       * can produce. Running both writes in one transaction means the record and the counters can
       * never disagree, whichever one a crash interrupts.
       *
       * @param transform - `exemptions.startPeriod` / `endPeriod` (or a list edit) applied to the
       *   normalised stored periods; returns the complete desired list.
       * @returns The stored periods, normalised.
       */
      function persistPeriods(
        transform: (current: ExemptPeriod[]) => ExemptPeriod[]
      ): ExemptPeriod[] {
        // A pending mode flip is settled first, so the list delta below reconciles on top of
        // counters that already agree with effective coverage.
        syncExemptionMode();
        const database = openDb();
        const at = now();
        const enabled = deps.getSettings().exemptionModeEnabled;
        const result = queries.withTransaction(database, (tx) => {
          const current = exemptions.normalizePeriods(queries.listExemptPeriods(tx));
          const stored = exemptions.normalizePeriods(
            queries.replaceExemptPeriods(tx, transform(current))
          );
          // Reconciled over EFFECTIVE coverage: while the mode is off the stored periods are
          // invisible either way, so an (unreachable-through-UI) edit moves no debt — the
          // switch-on settles everything at once instead (see syncExemptionMode).
          const debts = reconcileDebtsForCoverageChange(
            tx,
            enabled ? current : [],
            enabled ? stored : [],
            at
          );
          return { stored, debts };
        });
        set((state) => {
          state.exemptPeriods = result.stored;
          state.debts = result.debts;
          // Exemption changes re-resolve every cached day, so the whole day cache is dropped.
          state.dayRecords = {};
          state.revision += 1;
        });
        return result.stored;
      }

      /** The dense range a lifetime computation has to walk: first log → today. */
      function lifetimeRange(database: SyncDatabase): { from: PrayerDay; to: PrayerDay } | null {
        const to = get().todayDay();
        const first = queries.firstLoggedDay(database);
        // Stored periods are invisible while exemption mode is off (PRODUCT_SPEC §6), so they
        // must not stretch the lifetime window either — that would fill it with days the user
        // never logged and count them as unlogged.
        const earliestPeriod = deps.getSettings().exemptionModeEnabled
          ? get().exemptPeriods[0]?.startDay
          : undefined;
        // Day ordering is `domain/dates`' job — never a raw string comparison.
        const candidates = [first, earliestPeriod].filter(
          (day): day is PrayerDay => day !== null && day !== undefined && !isAfterDay(day, to)
        );
        if (candidates.length === 0) return null;
        return { from: candidates.reduce((a, b) => (compareDays(a, b) <= 0 ? a : b)), to };
      }

      /** The tracking mode and today's closed prayers, right now (D192). */
      function currentModeView(mode?: TrackingMode): ModeView {
        const settings = deps.getSettings();
        const view = modeViewFor(settings, get().todayDay(), now());
        return mode === undefined || mode === view.mode ? view : { ...view, mode };
      }

      /** Simple mode's shown-only misses, memoised against the revision and the view. */
      function derivedFor(view: ModeView): QadaDebts {
        if (view.mode !== 'simple' || view.since === null || isAfterDay(view.since, view.today)) {
          return qada.emptyDebts();
        }
        const since = view.since;
        // ponytail: reads every day since simple mode began, once per revision. Fine for months;
        // if years of simple mode ever make the qada screen slow, keep a running count instead.
        return memoised(get().revision, `derived:${modeViewKey(view)}:${exemptionKey()}`, () =>
          derivedMisses(readRecords(openDb(), since, view.today), view)
        );
      }

      function exemptionKey(): string {
        return String(deps.getSettings().exemptionModeEnabled);
      }

      /** Dense records for a range, straight from the database (bypassing the cache). */
      function readRecords(
        database: SyncDatabase,
        fromDay: PrayerDay,
        toDay: PrayerDay
      ): DayRecord[] {
        return queries.getDayRecords(database, fromDay, toDay, exemptDaysIn(fromDay, toDay));
      }

      return {
        // -- state ----------------------------------------------------------
        hydrated: false,
        exemptPeriods: [],
        debts: qada.emptyDebts(),
        dayRecords: {},
        revision: 0,

        // -- lifecycle ------------------------------------------------------
        hydrate() {
          syncExemptionMode();
          const database = openDb();
          const periods = exemptions.normalizePeriods(queries.listExemptPeriods(database));
          const debts = queries.getQadaDebts(database);
          set((state) => {
            state.exemptPeriods = periods;
            state.debts = debts;
            state.dayRecords = {};
            state.hydrated = true;
            state.revision += 1;
          });
        },

        invalidateDays() {
          // A queued write lands before its cached day is dropped, or a re-read would miss it.
          flushWrites();
          set((state) => {
            state.dayRecords = {};
            state.revision += 1;
          });
        },

        syncExemptionMode,

        setTodayDayResolver(resolver) {
          const before = resolveTodayDay();
          installedToday = resolver;
          // Only a *changed* answer is worth a re-render; the common case (the screen agreeing
          // with the fallback) must not churn every consumer on mount.
          if (resolveTodayDay() !== before) {
            set((state) => {
              state.revision += 1;
            });
          }

          return () => {
            // A later installer owns the slot now — releasing would drop *their* resolver.
            if (installedToday !== resolver) return;
            const current = resolveTodayDay();
            installedToday = null;
            if (resolveTodayDay() !== current) {
              set((state) => {
                state.revision += 1;
              });
            }
          };
        },

        // -- reads ----------------------------------------------------------
        todayDay() {
          return resolveTodayDay();
        },

        loadRange(fromDay, toDay) {
          syncExemptionMode();
          const records = readRecords(openDb(), fromDay, toDay);
          set((state) => {
            for (const record of records) state.dayRecords[record.day] = record;
          });
          return records;
        },

        loadDay(day) {
          syncExemptionMode();
          return refreshDay(openDb(), day);
        },

        /**
         * Imperative read-through getter: on a cache miss it queries the database AND stores the
         * result. Call it from effects and event handlers; inside a React render use the
         * {@link useDayRecord} hook, which only reads the cache.
         */
        dayRecordFor(day) {
          syncExemptionMode();
          const cached = get().dayRecords[day];
          if (cached !== undefined) return cached;
          if (!isValidDay(day)) return unloggedDayRecord(day);
          return refreshDay(openDb(), day);
        },

        isExemptDay(day) {
          if (!deps.getSettings().exemptionModeEnabled) return false;
          return exemptions.isDayExempt(day, get().exemptPeriods);
        },

        // -- logging --------------------------------------------------------
        setStatus(day, prayer, status) {
          if (!isValidDay(day)) return false;
          // A pending mode flip must settle before this write's own debt delta lands, or the
          // flip's later reconciliation would count this very log a second time.
          syncExemptionMode();
          if (isFutureDay(day, get().todayDay())) return false;
          if (get().isExemptDay(day)) return false;

          perfMark('setStatus');
          return attempt(false, () => {
            // The day as the user sees it — the cache already holds every earlier queued tap.
            const base =
              get().dayRecords[day] ?? queries.getDayRecord(openDb(), day, exemptDaysIn(day, day));
            const previous = base.statuses[prayer];
            const nextDebts = debtsAfterLog(
              get().debts,
              prayer,
              previous,
              base.madeUp[prayer] === true,
              status
            );

            if (queuedWrites.length === 0) {
              queueBaseline = { dayRecords: get().dayRecords, debts: get().debts };
            }
            queuedWrites.push({ day, prayer, status, at: now() });

            // The patch mirrors `setPrayerStatus` + `buildDayRecord`: a non-missed status
            // drops the made-up marker, `unlogged` deletes the row.
            set((state) => {
              const record = state.dayRecords[day] ?? base;
              record.statuses[prayer] = status;
              if (status !== 'missed') delete record.madeUp[prayer];
              state.dayRecords[day] = record;
              state.debts = nextDebts;
              state.revision += 1;
            });
            perfMark('patched');

            if (!writeScheduled) {
              writeScheduled = true;
              scheduleWrite(() => {
                writeScheduled = false;
                flushWrites();
              });
            }
            return true;
          });
        },

        toggleSimpleStatus(day, prayer) {
          if (!isValidDay(day)) return false;
          return attempt(false, () => {
            // The STORED status, queued taps included: the cache holds stored records, not the
            // simple-mode display. A miss reads the database.
            const stored =
              get().dayRecords[day]?.statuses[prayer] ??
              queries.getPrayerLog(openDb(), day, prayer)?.status ??
              'unlogged';
            return get().setStatus(day, prayer, simpleTapTarget(stored));
          });
        },

        flushWrites,

        onWriteFailed(listener) {
          writeFailedListeners.add(listener);
          return () => {
            writeFailedListeners.delete(listener);
          };
        },

        toggleStatus(day, prayer, status) {
          if (!isValidDay(day)) return false;
          return attempt(false, () => {
            // The cache is what the user sees, queued taps included; a miss reads the database.
            const current =
              get().dayRecords[day]?.statuses[prayer] ??
              queries.getPrayerLog(openDb(), day, prayer)?.status ??
              'unlogged';
            // The seal's third tap: the same choice again means "un-log this".
            return get().setStatus(day, prayer, current === status ? 'unlogged' : status);
          });
        },

        markMadeUp(day, prayer) {
          if (!isValidDay(day)) return false;
          syncExemptionMode();
          if (isFutureDay(day, get().todayDay())) return false;
          if (get().isExemptDay(day)) return false;
          return attempt(false, () => {
            const database = openDb();
            const existing = queries.getPrayerLog(database, day, prayer);
            // Only an outstanding miss can be made up, and only once.
            if (existing === null || existing.status !== 'missed') return false;
            if (existing.madeUpAt !== undefined) return false;

            const at = now();
            let paid = false;
            const debts = queries.withTransaction(database, (tx) => {
              const current = queries.getQadaDebts(tx);
              const next = qada.applyTick(current, prayer);
              // Nothing outstanding to pay off — the debt was forgiven or hand-edited to zero
              // since this prayer was logged. Stamping `madeUpAt` anyway would leave a made-up
              // marker with no matching `tick`, and clearing that marker later would hand the
              // user back a debt they had already been relieved of (PRODUCT_SPEC §7: counters
              // only ever descend unless the user logs a new miss).
              if (next[prayer] === current[prayer]) return current;
              paid = true;
              queries.markMadeUp(tx, day, prayer, at);
              return commitDebtChange(tx, current, next, prayer, { type: 'tick', at, day });
            });
            if (!paid) return false;

            set((state) => {
              state.debts = debts;
            });
            refreshDay(database, day);
            return true;
          });
        },

        clearMadeUp(day, prayer) {
          if (!isValidDay(day)) return false;
          syncExemptionMode();
          if (isFutureDay(day, get().todayDay())) return false;
          if (get().isExemptDay(day)) return false;
          return attempt(false, () => {
            const database = openDb();
            const existing = queries.getPrayerLog(database, day, prayer);
            if (existing === null || existing.madeUpAt === undefined) return false;

            const at = now();
            const debts = queries.withTransaction(database, (tx) => {
              queries.clearMadeUp(tx, day, prayer, { now: at });
              const current = queries.getQadaDebts(tx);
              // The prayer is owed again.
              return commitDebtChange(tx, current, qada.applyMiss(current, prayer), prayer, {
                type: 'add',
                at,
                day,
              });
            });

            set((state) => {
              state.debts = debts;
            });
            refreshDay(database, day);
            return true;
          });
        },

        // -- qada -----------------------------------------------------------
        tickQada(prayer) {
          return attempt(false, () => {
            const database = openDb();
            const at = now();
            let moved = false;

            const debts = queries.withTransaction(database, (tx) => {
              const current = queries.getQadaDebts(tx);
              const next = qada.applyTick(current, prayer);
              if (next[prayer] === current[prayer]) return current;
              moved = true;
              return commitDebtChange(tx, current, next, prayer, { type: 'tick', at });
            });

            set((state) => {
              state.debts = debts;
              if (moved) state.revision += 1;
            });
            return moved;
          });
        },

        setQadaDebts(debts, source = 'manual') {
          // On failure the counters simply stay as they were — the refusal value a caller can
          // already see on screen.
          return attempt(get().debts, () => {
            const database = openDb();
            const at = now();

            const stored = queries.withTransaction(database, (tx) => {
              const before = queries.getQadaDebts(tx);
              const after = queries.setQadaDebts(tx, debts, { now: at });
              queries.appendQadaEvent(tx, {
                type: source === 'estimate' ? 'estimateSet' : 'manualSet',
                prayer: null,
                delta: qada.totalDebt(after) - qada.totalDebt(before),
                at,
                meta: { debts: after },
              });
              return after;
            });

            set((state) => {
              state.debts = stored;
              state.revision += 1;
            });
            return stored;
          });
        },

        forgiveQada() {
          return attempt(false, () => {
            const database = openDb();
            const at = now();
            let forgiven = false;

            const debts = queries.withTransaction(database, (tx) => {
              const current = queries.getQadaDebts(tx);
              if (qada.totalDebt(current) === 0) return current;
              const result = qada.forgive(current, new Date(at));
              queries.setQadaDebts(tx, result.debts, { now: at });
              queries.appendQadaEvent(tx, result.event);
              forgiven = true;
              return result.debts;
            });

            set((state) => {
              state.debts = debts;
              if (forgiven) state.revision += 1;
            });
            return forgiven;
          });
        },

        undoableForgive() {
          return attempt(null, () => {
            const database = openDb();
            const event = queries.latestForgiveEvent(database);
            if (event === null) return null;
            if (!qada.canUndoForgive(event, new Date(now()))) return null;
            // Two things retire a pending undo, and both are "something happened after it":
            //
            // - `forgiveUndo` — it has already been taken, and is not offered again.
            // - `estimateSet` — the setup wizard has run since, and an estimate is an absolute
            //   claim about a *stretch of time* that includes the forgiven period. Adding the
            //   archive on top of it would charge those prayers twice, so the offer is withdrawn
            //   rather than left silently wrong (D79): an explicit "my debt is this" supersedes
            //   a pending undo.
            //
            // `manualSet` is deliberately NOT in this list. The two writes that produce one are
            // the wizard's "Begin at zero" and `useQada.putBack`'s reversal of a mis-tapped
            // "+1 made up"; neither re-establishes debt over the forgiven period, so an additive
            // restore on top of them is still exact — and a mis-tap must never quietly cost
            // someone the 30-day promise. A future screen that lets the debt be *typed in*
            // absolutely would belong here; the test is whether the write re-establishes the
            // forgiven period, not whether it happens to replace the whole record.
            const [superseding] = queries.listQadaEvents(database, {
              types: ['forgiveUndo', 'estimateSet'],
              limit: 1,
            });
            if (superseding !== undefined && isAfterEvent(superseding, event)) return null;
            return event;
          });
        },

        /**
         * Reverses a forgiveness **additively**: the archived counters are added to whatever the
         * counters hold now, so a prayer missed and logged between the forgiveness and the undo
         * survives it (D79). The written `forgiveUndo` delta is therefore the exact inverse of
         * the forgive event's `−total`, whatever else moved in between — undo reverses the
         * forgiveness, it does not rewind time.
         */
        undoForgive() {
          return attempt(false, () => {
            const event = get().undoableForgive();
            if (event === null) return false;

            const database = openDb();
            const at = now();
            const debts = queries.withTransaction(database, (tx) => {
              const archived = qada.undoForgive(event);
              const before = queries.getQadaDebts(tx);
              const after = queries.setQadaDebts(tx, qada.addDebts(before, archived), { now: at });
              queries.appendQadaEvent(tx, {
                type: 'forgiveUndo',
                prayer: null,
                delta: qada.totalDebt(after) - qada.totalDebt(before),
                at,
                meta: { forgiveEventId: event.id ?? null },
              });
              return after;
            });

            set((state) => {
              state.debts = debts;
              state.revision += 1;
            });
            return true;
          });
        },

        // -- exemptions -----------------------------------------------------
        startExemptPeriod(day) {
          // On failure the stored periods are unchanged, so the cached ones are still the truth.
          return attempt(get().exemptPeriods, () => {
            const at = now();
            return persistPeriods((current) => exemptions.startPeriod(current, day, at));
          });
        },

        endExemptPeriod(day) {
          return attempt(get().exemptPeriods, () => {
            const at = now();
            const today = get().todayDay();
            // `trimOngoingPeriod`, not `endPeriod`: a period may have been begun WITH an end date
            // ("excused for three days"), and ending early has to be able to cut that short too.
            // For an open-ended period the two are the same call.
            return persistPeriods((current) =>
              exemptions.trimOngoingPeriod(current, day, today, at)
            );
          });
        },

        addExemptPeriod(startDay, endDay) {
          if (!isValidDay(startDay) || !isValidDay(endDay)) return false;
          if (isBeforeDay(endDay, startDay)) return false;
          return attempt(false, () => {
            const at = now();
            persistPeriods((current) => [...current, { startDay, endDay, createdAt: at }]);
            return true;
          });
        },

        updateExemptPeriod(id, startDay, endDay) {
          if (!isValidDay(startDay)) return false;
          if (endDay !== null && (!isValidDay(endDay) || isBeforeDay(endDay, startDay))) {
            return false;
          }
          return attempt(false, () => {
            persistPeriods((current) => {
              const target = current.find((period) => period.id === id);
              // Throwing rolls the transaction back; `attempt` turns it into the refusal value.
              // Ids are reassigned on every period write, so a stale id from a screen that lost
              // a race is an ordinary occurrence, not a programmer error.
              if (target === undefined) throw new RangeError(`No exempt period with id ${id}`);
              return current.map((period) =>
                period === target ? { ...period, startDay, endDay } : period
              );
            });
            return true;
          });
        },

        deleteExemptPeriod(id) {
          return attempt(false, () => {
            syncExemptionMode();
            const database = openDb();
            const at = now();
            const enabled = deps.getSettings().exemptionModeEnabled;
            // One transaction, exactly like `persistPeriods`: un-covering a day whose stored
            // `missed` logs were refunded when the period covered them re-adds that debt in the
            // same write that reveals the misses again — the two can never diverge. Coverage is
            // effective coverage, exactly as in `persistPeriods`.
            const result = queries.withTransaction(database, (tx) => {
              const before = exemptions.normalizePeriods(queries.listExemptPeriods(tx));
              if (!queries.deleteExemptPeriod(tx, id)) return null;
              const after = exemptions.normalizePeriods(queries.listExemptPeriods(tx));
              const debts = reconcileDebtsForCoverageChange(
                tx,
                enabled ? before : [],
                enabled ? after : [],
                at
              );
              return { after, debts };
            });
            if (result === null) return false;
            set((state) => {
              state.exemptPeriods = result.after;
              state.debts = result.debts;
              state.dayRecords = {};
              state.revision += 1;
            });
            return true;
          });
        },

        // -- derived --------------------------------------------------------
        streakSummary(opts = {}) {
          const includeToday = opts.includeToday ?? true;
          const mode = deps.getSettings().streakMode;
          const todayValue = get().todayDay();
          // `exemptionModeEnabled` decides whether exempt days bridge, so it is part of the
          // identity of the computation — it lives in another store and cannot bump `revision`.
          const key = `streak:${mode}:${todayValue}:${String(includeToday)}:${String(
            deps.getSettings().exemptionModeEnabled
          )}`;

          return memoised(get().revision, key, () => {
            const database = openDb();
            const range = lifetimeRange(database);
            const records = range === null ? [] : readRecords(database, range.from, range.to);
            return computeStreak(records, { mode, todayDay: todayValue, includeToday });
          });
        },

        statsFor(windowDays, mode) {
          const todayValue = get().todayDay();
          const view = currentModeView(mode);
          const key = `stats:${String(windowDays)}:${todayValue}:${exemptionKey()}:${modeViewKey(view)}`;

          return memoised(get().revision, key, () => {
            const database = openDb();
            let from: PrayerDay | null;
            if (windowDays === null) {
              from = lifetimeRange(database)?.from ?? null;
              // Simple mode shows misses on days nobody logged, so its lifetime starts no later
              // than the day it was turned on — or a never-logging user would read "nothing yet".
              const since = view.mode === 'simple' ? view.since : null;
              if (since !== null && !isAfterDay(since, todayValue)) {
                from = from === null || isBeforeDay(since, from) ? since : from;
              }
            } else {
              from = addDays(todayValue, -(windowDays - 1));
            }
            const records = from === null ? [] : readRecords(database, from, todayValue);
            // Applied to the input, never inside `computeStats`: the domain counts what it is
            // handed, and simple mode is a way of LOOKING at the log (D192).
            const shown = records.map((record) => displayRecord(record, view));
            return computeStats(shown, { windowDays, todayDay: todayValue });
          });
        },

        qadaDerivedMisses() {
          return derivedFor(currentModeView());
        },

        qadaShownDebts() {
          const view = currentModeView();
          const stored = get().debts;
          if (view.mode !== 'simple') return stored;
          const madeUp = deps.getSettings().simpleQadaMadeUp;
          const key = `qadaShown:${modeViewKey(view)}:${exemptionKey()}:${JSON.stringify(madeUp)}`;
          return memoised(get().revision, key, () =>
            simpleQadaDebts(stored, derivedFor(view), madeUp)
          );
        },

        qadaProgress(paceWindowDays = qada.DEFAULT_PACE_WINDOW_DAYS) {
          const todayValue = get().todayDay();
          const shown = get().qadaShownDebts();
          const key = `qada:${String(paceWindowDays)}:${todayValue}:${JSON.stringify(shown)}`;

          return memoised(get().revision, key, () => {
            const database = openDb();
            // Only `tick` events inside the pace window can contribute (see computeProgress).
            const events = queries.listQadaEvents(database, {
              types: ['tick'],
              sinceDay: addDays(todayValue, -(paceWindowDays - 1)),
            });
            return qada.computeProgress(shown, events, {
              todayDay: todayValue,
              paceWindowDays,
            });
          });
        },
      };
    })
  );
}

// ---------------------------------------------------------------------------
// Shared write helpers
// ---------------------------------------------------------------------------

/**
 * Runs one mutating action's work, absorbing an **environment** failure into the action's
 * refusal value.
 *
 * The store's own guards pre-validate every input (`isValidDay`, status/prayer unions), so the
 * query layer's loud `RangeError`s are unreachable from here; what this catches is the database
 * itself failing — tables missing after a failed migration, a corrupt file, a full disk. Those
 * are reachable from a press handler (the Today seals render without any database), and an
 * exception escaping a press handler is a hard crash in a release build. A refused write the UI
 * simply does not reflect is the honest degradation; nothing partial can be left behind, because
 * every multi-step body runs inside one transaction.
 *
 * @param fallback - The action's ordinary refusal value.
 * @param work - The action body.
 * @returns Whatever `work` returns, or `fallback` when it threw.
 */
function attempt<T>(fallback: T, work: () => T): T {
  try {
    return work();
  } catch {
    return fallback;
  }
}

/**
 * Runs one day resolver defensively.
 *
 * @param resolver - The candidate, or `null` when there is none.
 * @returns The day it produced, or `null` when there was no resolver, it threw, or it answered
 *   with something that is not a real `YYYY-MM-DD` date.
 */
function tryResolveDay(resolver: TodayDayResolver | null): PrayerDay | null {
  if (resolver === null) return null;
  try {
    const day = resolver();
    return isValidDay(day) ? day : null;
  } catch {
    return null;
  }
}

/** One accepted tap waiting for its database write (D191). */
interface QueuedWrite {
  day: PrayerDay;
  prayer: Prayer;
  status: SettableStatus;
  /** The tap's instant, stamped on the row — not the instant the queue drained. */
  at: number;
}

/** The part of the cache a failed write can have touched. */
interface QueueBaseline {
  dayRecords: Record<PrayerDay, DayRecord>;
  debts: QadaDebts;
}

/**
 * The qada consequence of changing one prayer's log — the single rule both the optimistic patch
 * and the database write apply, so the two can never disagree.
 *
 * Logging `missed` adds the prayer's debt; leaving `missed` takes it back — unless the miss was
 * already made up, whose debt was settled by its `tick` and must not be paid off twice.
 */
function debtsAfterLog(
  current: QadaDebts,
  prayer: Prayer,
  previous: PrayerStatus,
  wasMadeUp: boolean,
  status: SettableStatus
): QadaDebts {
  if (status === 'missed' && previous !== 'missed') return qada.applyMiss(current, prayer);
  if (previous === 'missed' && status !== 'missed' && !wasMadeUp) {
    return qada.applyUndoMiss(current, prayer);
  }
  return current;
}

/**
 * Writes one prayer log and its qada side effect. One transaction: the log row, the debt
 * counters and the audit event either all land or none of them do. The side effect is decided
 * from the row found at commit time.
 *
 * @returns The counters as stored afterwards.
 */
function writeStatus(
  database: SyncDatabase,
  day: PrayerDay,
  prayer: Prayer,
  status: SettableStatus,
  at: number
): QadaDebts {
  return queries.withTransaction(database, (tx) => {
    const existing = queries.getPrayerLog(tx, day, prayer);
    queries.setPrayerStatus(tx, day, prayer, status, { now: at });
    const current = queries.getQadaDebts(tx);
    const next = debtsAfterLog(
      current,
      prayer,
      existing?.status ?? 'unlogged',
      existing?.madeUpAt !== undefined,
      status
    );
    return commitDebtChange(tx, current, next, prayer, { type: 'add', at, day });
  });
}

/** Whether two sets of counters agree on every prayer. */
function sameDebts(a: QadaDebts, b: QadaDebts): boolean {
  return PRAYERS.every((prayer) => a[prayer] === b[prayer]);
}

/** Identity of the audit event a debt change should leave behind. */
interface DebtEventSpec {
  type: 'tick' | 'add';
  at: number;
  /** The prayer day the change originated from, for traceability. Omitted for qada-screen taps. */
  day?: PrayerDay;
  /**
   * Marks the event as a coverage refund/re-add written by
   * {@link reconcileDebtsForCoverageChange}, as opposed to an `add` caused by the user editing
   * a log. The marker is what lets a later uncover know whether covering this (day, prayer)
   * actually refunded anything — see the reconciliation function for why that matters.
   */
  coverage?: boolean;
}

/**
 * Persists a debt change and its audit event, but only when a counter actually moved.
 *
 * A `tick` that paid off nothing would inflate the pace in `qada.computeProgress`, and an `add`
 * with a zero delta would be a lie in the audit trail, so an unchanged counter writes nothing.
 *
 * @param tx - Transaction handle; the caller owns the transaction.
 * @param before - Counters as they stand.
 * @param after - Counters the domain produced.
 * @param prayer - The prayer whose counter the change concerns.
 * @param spec - Event type, timestamp and optional originating day.
 * @returns The counters now stored (`before` when nothing moved).
 */
function commitDebtChange(
  tx: SyncDatabase,
  before: QadaDebts,
  after: QadaDebts,
  prayer: Prayer,
  spec: DebtEventSpec
): QadaDebts {
  const delta = after[prayer] - before[prayer];
  if (delta === 0) return before;
  const stored = queries.setQadaDebts(tx, after, { now: spec.at });
  queries.appendQadaEvent(tx, {
    type: spec.type,
    prayer,
    delta,
    at: spec.at,
    ...(spec.day === undefined
      ? {}
      : { meta: { day: spec.day, ...(spec.coverage === true ? { coverage: true } : {}) } }),
  });
  return stored;
}

/**
 * Settles the qada counters after an exempt-period write changed which days are covered.
 *
 * The rule is symmetric with how the debt arose (spec-exemption §5, D-x5). Logging `missed`
 * incremented a counter; therefore:
 *
 * - A day **newly covered** by a period refunds each of its outstanding `missed` logs
 *   (`qada.applyUndoMiss` + a negative `add` event) — no prayer was owed on that day, so the
 *   debt it fed must not survive the correction. Without this, backdating a period over days
 *   honestly logged `missed` would hide the misses while silently keeping the make-up burden.
 * - A day **newly uncovered** (a deleted, shortened or corrected period) re-adds the debt of
 *   each `missed` log that becomes visible again (`qada.applyMiss` + a positive `add` event).
 *
 * A `missed` log already **made up** moves nothing in either direction: its debt was settled by
 * a `tick`, so there is nothing outstanding to refund, and re-adding it on uncover would charge
 * a prayer twice. Counters are clamped at zero by the domain (a hand-edit or forgiveness may
 * have already zeroed them), and `commitDebtChange` writes an event only when a counter actually
 * moved.
 *
 * **Uncovering restores exactly what covering refunded — including nothing.** A refund can be
 * clamped away entirely: the miss's debt may already have been forgiven, paid off by a
 * qada-screen tick (which marks no log made up), or hand-edited to zero. Re-adding on uncover
 * regardless would mint debt out of a cover/uncover round trip — resurrecting forgiven debt, or
 * charging a prayer the user already made up — which violates both D63's symmetry and the
 * domain's "forgiveness is not clawed back" contract. So every refund/re-add this function
 * writes carries a `coverage: true` marker in its event `meta`, and the re-add on uncover runs
 * only when the (day, prayer) slot has an unmatched coverage refund in the audit trail
 * (net coverage delta < 0). A slot whose covering refunded nothing therefore uncovers to
 * nothing, and every round trip nets to zero.
 *
 * Callers pass **effective** coverage, not raw stored lists: while the mode is off the stored
 * periods cover nothing the user can see, so a caller substitutes `[]` for the list on the
 * off side (`persistPeriods`, `deleteExemptPeriod`), and the mode flip itself reconciles
 * `[] ↔ stored` (`syncExemptionMode`). That single convention is what makes the visible record
 * and the counters provably agree after every action, whichever door the change came through.
 *
 * @param tx - Transaction handle; the caller owns the transaction the period write ran in.
 * @param before - Normalised periods as they were stored before the write.
 * @param after - Normalised periods as stored now.
 * @param at - Epoch ms stamped on the audit events.
 * @returns The counters as stored after reconciliation.
 */
function reconcileDebtsForCoverageChange(
  tx: SyncDatabase,
  before: ExemptPeriod[],
  after: ExemptPeriod[],
  at: number
): QadaDebts {
  let debts = queries.getQadaDebts(tx);
  const first = queries.firstLoggedDay(tx);
  const last = queries.lastLoggedDay(tx);
  if (first === null || last === null) return debts;

  // Net coverage delta per `${day}:${prayer}` slot, from the marked events this function has
  // written before: a refund is −1, a re-add +1, so a slot with an unmatched refund nets < 0.
  const coverageNet = new Map<string, number>();
  for (const event of queries.listQadaEvents(tx, { types: ['add'] })) {
    if (event.meta?.coverage !== true) continue;
    if (event.prayer === null || typeof event.meta.day !== 'string') continue;
    const slot = `${event.meta.day}:${event.prayer}`;
    coverageNet.set(slot, (coverageNet.get(slot) ?? 0) + event.delta);
  }

  for (const log of queries.listPrayerLogs(tx, first, last)) {
    if (log.status !== 'missed' || log.madeUpAt !== undefined) continue;
    const coveredBefore = exemptions.isDayExempt(log.day, before);
    const coveredAfter = exemptions.isDayExempt(log.day, after);
    if (coveredBefore === coveredAfter) continue;
    // Re-add only what covering actually refunded: a slot with no unmatched refund (the debt
    // was already forgiven, ticked off, or hand-zeroed when it was covered) uncovers to nothing.
    if (!coveredAfter && (coverageNet.get(`${log.day}:${log.prayer}`) ?? 0) >= 0) continue;
    const next = coveredAfter
      ? qada.applyUndoMiss(debts, log.prayer)
      : qada.applyMiss(debts, log.prayer);
    debts = commitDebtChange(tx, debts, next, log.prayer, {
      type: 'add',
      at,
      day: log.day,
      coverage: true,
    });
  }
  return debts;
}

/** Whether `candidate` was recorded after `reference`, using the row id to break ties. */
function isAfterEvent(candidate: QadaEvent, reference: QadaEvent): boolean {
  if (candidate.at !== reference.at) return candidate.at > reference.at;
  return (candidate.id ?? 0) > (reference.id ?? 0);
}

// ---------------------------------------------------------------------------
// The prayer day
// ---------------------------------------------------------------------------

/** Memo for {@link resolvePrayerDay}: one Fajr per (calendar date, location, settings). */
interface BoundaryCache {
  calendarDay: PrayerDay;
  location: AppLocation;
  calculation: CalculationSettings;
  fajrMs: number;
}

let boundaryCache: BoundaryCache | null = null;

/**
 * The prayer day an instant belongs to — **Fajr → next Fajr**, not midnight → midnight
 * (PRODUCT_SPEC §3).
 *
 * This is what {@link TrackingStoreDeps.getTodayDay} must be bound to. The difference is only
 * ever visible between midnight and Fajr, but in that window it decides three things that the
 * user can see and would rightly call wrong:
 *
 * 1. **Whether an Isha logged at 00:30 is writable at all.** `setStatus` refuses future days;
 *    with the calendar date as "today" the still-open previous day is merely *past*, which is
 *    harmless — but the calendar date itself is a prayer day that has NOT begun, and editing it
 *    (from History) would be allowed.
 * 2. **Whether the streak reads as broken.** `computeStreak` refuses to judge `todayDay`,
 *    because a prayer day is only final at the next Fajr (§3/§5). Hand it the calendar date at
 *    00:30 and the still-open day is judged as closed, so four-of-five-logged collapses a hard
 *    streak to 0 while the user can still log the fifth. That is the shaming this product
 *    explicitly forbids, produced by arithmetic rather than by copy.
 * 3. **Which window stats and qada pace are measured over.**
 *
 * Failure is never allowed to make a log un-writable, so an absent location or an engine that
 * cannot resolve Fajr (impossible coordinates, a polar night) falls back to the calendar date.
 *
 * The Fajr instant is memoised on the calendar date plus the identities of the location and the
 * calculation settings, because this runs inside the `streakSummary` selector — i.e. on renders,
 * not just on writes.
 *
 * @param settings - The current settings snapshot (`location` and `calculation` are read).
 * @param now - The instant to classify. Defaults to the real clock.
 * @returns The prayer day as `YYYY-MM-DD`.
 */
export function resolvePrayerDay(settings: AppSettings, now: Date = new Date()): PrayerDay {
  const calendarDay = calendarToday(now);
  const location = settings.location;
  if (location === null) return calendarDay;

  const cached = boundaryCache;
  let fajrMs: number;
  if (
    cached !== null &&
    cached.calendarDay === calendarDay &&
    cached.location === location &&
    cached.calculation === settings.calculation
  ) {
    fajrMs = cached.fajrMs;
  } else {
    try {
      fajrMs = computeDayTimes(calendarDay, location, settings.calculation).times.fajr.getTime();
    } catch {
      // A location the engine cannot resolve must not lock the user out of logging.
      return calendarDay;
    }
    boundaryCache = { calendarDay, location, calculation: settings.calculation, fajrMs };
  }
  return prayerDayForInstant(now, new Date(fajrMs));
}

// ---------------------------------------------------------------------------
// Singleton & hooks
// ---------------------------------------------------------------------------

/**
 * The application-wide tracking store, bound to the on-device database and the settings store.
 *
 * Creating it opens nothing: the database handle is resolved on the first action, so the app
 * must call `hydrate()` after migrations have run.
 *
 * "Today" is the **prayer day**, not the calendar date — see {@link resolvePrayerDay}. Leaving
 * this at its default would make the store disagree with the Today screen for the hours between
 * midnight and Fajr, which is exactly when the disagreement is visible.
 *
 * {@link resolvePrayerDay} is the *floor*, not the last word: the root layout installs the app's
 * own resolver through {@link TrackingActions.setTodayDayResolver} (`hooks/useTodayDayResolver`),
 * so the store and the screens can never derive the boundary differently. This binding is what
 * answers before that install has happened — and if it ever throws.
 */
export const useTrackingStore = createTrackingStore({
  getDb,
  getSettings: getSettingsSnapshot,
  getTodayDay: () => resolvePrayerDay(getSettingsSnapshot()),
});

// `exemptionModeEnabled` lives in the settings store, so flipping it can neither bump
// `revision` nor reconcile the qada counters by itself. Subscribing makes the flip settle
// synchronously, inside the toggle gesture — before the qada screen could ever render debts
// that disagree with what History shows — rather than at the next day-cache read. Every other
// settings change lands in `syncExemptionMode`'s cheap no-op path.
useSettingsStore.subscribe(() => {
  useTrackingStore.getState().syncExemptionMode();
});

/**
 * Reads the actions outside React (services, notification rescheduling, exports).
 *
 * @returns The singleton store's full state; action identities are stable for the app's life.
 */
export function getTrackingActions(): TrackingStore {
  return useTrackingStore.getState();
}

/**
 * Cached record for one day — render-safe: it reads the cache only and returns `undefined`
 * until a `load*` action has populated it.
 *
 * @param day - Prayer day (`YYYY-MM-DD`).
 * @returns The cached `DayRecord`, or `undefined` when the day has not been loaded.
 */
export const useDayRecord = (day: PrayerDay): DayRecord | undefined =>
  useTrackingStore((s) => s.dayRecords[day]);

/** @returns The current outstanding qada debt per prayer. */
export const useQadaDebts = (): QadaDebts => useTrackingStore((s) => s.debts);

/** @returns The normalised exempt periods. */
export const useExemptPeriods = (): ExemptPeriod[] => useTrackingStore((s) => s.exemptPeriods);

/** @returns `true` once the store has loaded periods and debts from the database. */
export const useTrackingHydrated = (): boolean => useTrackingStore((s) => s.hydrated);

const selectActions = (s: TrackingStore) => ({
  hydrate: s.hydrate,
  invalidateDays: s.invalidateDays,
  setTodayDayResolver: s.setTodayDayResolver,
  loadRange: s.loadRange,
  loadDay: s.loadDay,
  setStatus: s.setStatus,
  toggleStatus: s.toggleStatus,
  toggleSimpleStatus: s.toggleSimpleStatus,
  flushWrites: s.flushWrites,
  onWriteFailed: s.onWriteFailed,
  markMadeUp: s.markMadeUp,
  clearMadeUp: s.clearMadeUp,
  tickQada: s.tickQada,
  setQadaDebts: s.setQadaDebts,
  forgiveQada: s.forgiveQada,
  undoForgive: s.undoForgive,
  startExemptPeriod: s.startExemptPeriod,
  endExemptPeriod: s.endExemptPeriod,
  addExemptPeriod: s.addExemptPeriod,
  updateExemptPeriod: s.updateExemptPeriod,
  deleteExemptPeriod: s.deleteExemptPeriod,
});

/**
 * @returns Every mutating action, plus {@link TrackingActions.setTodayDayResolver}. Shallow-
 * compared, so it never causes a re-render on its own.
 */
export const useTrackingActions = () => useTrackingStore(useShallow(selectActions));
