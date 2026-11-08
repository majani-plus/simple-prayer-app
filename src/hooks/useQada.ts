/**
 * `useQada` — the one place the qada feature reads and changes the debt.
 *
 * The Today card, the qada screen and the setup wizard all go through this hook, so the three
 * of them can never disagree about what is owed, what the pace is, or whether a forgiveness is
 * still undoable. It computes nothing: the numbers come from `domain/qada` (through the tracking
 * store's memoised `qadaProgress`), the persistence from `stores/trackingStore`, and the
 * "has the wizard run" flag from `stores/settingsStore`.
 *
 * ## Two things it owns
 *
 * 1. **Nothing is asked of the database before it is open.** The store's derived selectors read
 *    through to SQLite; asking for a progress snapshot during the first render — before
 *    `hydrate()` has run — would query a closed connection. Until then the hook answers with an
 *    idle snapshot, which is also the right answer: no debts have been loaded, so nothing is owed
 *    as far as the UI is concerned.
 * 2. **The undo of a "+1 made up".** A mis-tap on a counter is the single most annoying thing a
 *    qada tracker can do to someone, so every tick is reversible. `tickQada` only ever descends,
 *    so the reversal is a compensating write ({@link QadaView.putBack}) that adds the prayer back
 *    with `domain/qada.applyMiss` — the same function a newly logged miss uses — and records it
 *    as a manual set rather than pretending the tick never happened.
 *
 *    Known limitation: the original `tick` event stays in the audit trail, so a ticked-then-undone
 *    prayer still counts once toward `paidInWindow` for the rest of the pace window. The pace (and
 *    therefore the projection) is very slightly optimistic after an undo. That is the forgiving
 *    direction to be wrong in, and removing an event is not something the store exposes.
 *
 * ## Simple mode (D192)
 *
 * In simple mode the counters also hold the misses simple mode SHOWS (closed, unmarked prayers since
 * it was turned on — `domain/trackingMode`). Those have no row and no event, so making one up moves
 * a counter in settings instead. "Made up" takes the STORED debt first, then that counter;
 * "owe one more" reverses the order, so it is also the undo. "Start fresh" clears both: the stored
 * part is archived and undoable as before, the shown part is absorbed into the counter, which the
 * undo does not bring back (the counter has no archive — a known, forgiving-direction gap).
 *
 * Dependency rule: `hooks → stores + domain`. No SQL, no user-facing strings.
 */

import { useCallback, useMemo } from 'react';

import {
  DEFAULT_PACE_WINDOW_DAYS,
  FORGIVE_UNDO_WINDOW_DAYS,
  applyMiss,
  mostOwedPrayer,
  normalizeDebts,
  totalDebt,
} from '@/domain/qada';
import { makeUpSource, putBackSource } from '@/domain/trackingMode';
import { PRAYERS } from '@/domain/types';
import { useQadaShownDebts } from './useTrackingModeView';
import {
  getSettingsSnapshot,
  useQadaSetupCompleted,
  useSettingsActions,
  useTrackingMode,
} from '@/stores/settingsStore';
import {
  useQadaDebts,
  useTrackingActions,
  useTrackingHydrated,
  useTrackingStore,
  type QadaDebtsSource,
} from '@/stores/trackingStore';

import type { Prayer, QadaDebts, QadaEvent, QadaProgress } from '@/domain/types';

/** What the qada UI reads and calls. Every number here is `domain/qada`'s, never recomputed. */
export interface QadaView {
  /** The five outstanding counters, sanitised. */
  debts: QadaDebts;
  /** Their sum — the number the Today card and the screen's hero show. */
  total: number;
  /** Totals, recent pace and the projected clear day (`null` when it would be meaningless). */
  progress: QadaProgress;
  /** The prayer the Today card's one-tap button acts on, or `null` when nothing is owed. */
  mostOwed: Prayer | null;
  /** Length of the pace window in days, for the copy that names it. */
  paceWindowDays: number;
  /** How many days a forgiveness stays undoable, for the copy that promises it. */
  undoWindowDays: number;
  /** Whether the setup wizard has been completed or skipped. */
  setupCompleted: boolean;
  /** The forgiveness still inside its undo window, or `null`. */
  undoableForgive: QadaEvent | null;
  /** Marks one prayer as made up. `false` when that counter was already at zero. */
  makeUp: (prayer: Prayer) => boolean;
  /** Reverses a {@link makeUp}: the prayer is owed again. */
  putBack: (prayer: Prayer) => boolean;
  /** "Start fresh": archives the counters and zeroes them. `false` when nothing was owed. */
  forgive: () => boolean;
  /** Restores the archived counters, while {@link undoableForgive} is not `null`. */
  restoreForgiven: () => boolean;
  /** Replaces all five counters — the wizard's estimate or its hand-edit. */
  saveDebts: (debts: QadaDebts, source?: QadaDebtsSource) => void;
  /** Marks the wizard as done (or skipped), so it does not open itself again. */
  completeSetup: () => void;
}

/** The snapshot shown before the database has been opened: nothing loaded, nothing owed. */
function idleProgress(debts: QadaDebts): QadaProgress {
  return { debts, total: totalDebt(debts), paidInWindow: 0, perDay: 0, projectedClearDay: null };
}

/**
 * The qada feature's state and actions.
 *
 * @param paceWindowDays - Days the pace is measured over. Defaults to
 *   {@link DEFAULT_PACE_WINDOW_DAYS} (30, PRODUCT_SPEC §7).
 * @returns A {@link QadaView}; safe to call before the store has hydrated.
 */
export function useQada(paceWindowDays: number = DEFAULT_PACE_WINDOW_DAYS): QadaView {
  const hydrated = useTrackingHydrated();
  const stored = useQadaDebts();
  const revision = useTrackingStore((state) => state.revision);
  const readProgress = useTrackingStore((state) => state.qadaProgress);
  const readUndoableForgive = useTrackingStore((state) => state.undoableForgive);
  const { tickQada, setQadaDebts, forgiveQada, undoForgive } = useTrackingActions();

  const setupCompleted = useQadaSetupCompleted();
  const { setQadaSetupCompleted, setSimpleQadaMadeUp } = useSettingsActions();
  const trackingMode = useTrackingMode();
  const shownDebts = useQadaShownDebts();
  const readDerived = useTrackingStore((state) => state.qadaDerivedMisses);

  // Corrupt or partially-written counters must not be able to take this screen down; the domain
  // sanitiser is cheap and total, so it runs on the way in rather than at every call site.
  const storedDebts = useMemo(() => normalizeDebts(stored), [stored]);
  const debts = useMemo(() => normalizeDebts(shownDebts), [shownDebts]);
  const total = useMemo(() => totalDebt(debts), [debts]);
  const mostOwed = useMemo(() => mostOwedPrayer(debts), [debts]);

  // `revision` is the store's "something changed" clock — the memo's only reason to age, since
  // `qadaProgress` is itself memoised against it inside the store.
  const progress = useMemo<QadaProgress>(() => {
    void revision;
    if (!hydrated) return idleProgress(debts);
    return readProgress(paceWindowDays);
  }, [hydrated, readProgress, paceWindowDays, revision, debts]);

  // Memoised against the same revision, exactly like the store's own derived selectors: the
  // answer is a pure function of (stored events, now), so re-asking on a repaint would be a
  // wasted query and asking in an effect would render the wrong thing for one frame — the
  // "start fresh" undo would flash in and out every time the screen mounted.
  const undoableForgive = useMemo<QadaEvent | null>(() => {
    void revision;
    if (!hydrated) return null;
    try {
      return readUndoableForgive();
    } catch {
      // A database that cannot answer must cost the user the undo *offer*, never the screen.
      return null;
    }
  }, [hydrated, readUndoableForgive, revision]);

  const makeUp = useCallback(
    (prayer: Prayer) => {
      if (trackingMode !== 'simple') return tickQada(prayer);
      const source = makeUpSource(storedDebts, debts, prayer);
      if (source === 'stored') return tickQada(prayer);
      if (source === null) return false;
      const madeUp = getSettingsSnapshot().simpleQadaMadeUp[prayer];
      setSimpleQadaMadeUp(prayer, Math.min(madeUp, readDerived()[prayer]) + 1);
      return true;
    },
    [trackingMode, storedDebts, debts, tickQada, readDerived, setSimpleQadaMadeUp]
  );

  const putBack = useCallback(
    (prayer: Prayer) => {
      if (trackingMode === 'simple') {
        const derived = readDerived();
        const madeUp = getSettingsSnapshot().simpleQadaMadeUp;
        if (putBackSource(derived, madeUp, prayer) === 'counter') {
          setSimpleQadaMadeUp(prayer, Math.min(madeUp[prayer], derived[prayer]) - 1);
          return true;
        }
      }
      // The STORED counters, never the shown ones: in simple mode the shown number also holds
      // misses that live only on screen, and writing them into the table would count them twice.
      // `storedDebts` is the render's snapshot — the counter cannot have moved between the render
      // and the handler without a re-render having happened first.
      setQadaDebts(applyMiss(storedDebts, prayer), 'manual');
      return true;
    },
    [trackingMode, storedDebts, setQadaDebts, readDerived, setSimpleQadaMadeUp]
  );

  const forgive = useCallback(() => {
    const forgaveStored = forgiveQada();
    if (trackingMode !== 'simple') return forgaveStored;
    const derived = readDerived();
    let absorbed = false;
    for (const prayer of PRAYERS) {
      if (derived[prayer] > getSettingsSnapshot().simpleQadaMadeUp[prayer]) {
        setSimpleQadaMadeUp(prayer, derived[prayer]);
        absorbed = true;
      }
    }
    return forgaveStored || absorbed;
  }, [forgiveQada, trackingMode, readDerived, setSimpleQadaMadeUp]);
  const restoreForgiven = useCallback(() => undoForgive(), [undoForgive]);

  const saveDebts = useCallback(
    (next: QadaDebts, source: QadaDebtsSource = 'estimate') => {
      setQadaDebts(normalizeDebts(next), source);
    },
    [setQadaDebts]
  );

  const completeSetup = useCallback(() => {
    setQadaSetupCompleted(true);
  }, [setQadaSetupCompleted]);

  return {
    debts,
    total,
    progress,
    mostOwed,
    paceWindowDays,
    undoWindowDays: FORGIVE_UNDO_WINDOW_DAYS,
    setupCompleted,
    undoableForgive,
    makeUp,
    putBack,
    forgive,
    restoreForgiven,
    saveDebts,
    completeSetup,
  };
}
