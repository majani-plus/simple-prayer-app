/**
 * The tracking mode as screens need it (D192): a {@link ModeView} that re-measures which of
 * today's prayers have ended, and the qada counters simple mode shows.
 *
 * Both live in the SETTINGS store as much as in the tracking store, and a settings change cannot
 * bump the tracking store's revision — so these hooks subscribe to the settings that matter and
 * re-ask the store, rather than reading it through a tracking-store selector alone.
 *
 * Dependency rule: `hooks → stores + domain`. No user-facing strings.
 */

import { useMemo } from 'react';

import { useNow } from './useNow';
import { modeViewFor, modeViewKey, type ModeView } from '@/domain/trackingMode';
import type { QadaDebts } from '@/domain/types';
import {
  getSettingsSnapshot,
  useCalculationSettings,
  useLocation,
  useSimpleModeSince,
  useSimpleQadaMadeUp,
  useTrackingMode,
} from '@/stores/settingsStore';
import { useQadaDebts, useTrackingHydrated, useTrackingStore } from '@/stores/trackingStore';

/** A minute is fine-grained enough for "has this prayer's time ended". */
const VIEW_TICK_MS = 60_000;
/** Detailed mode reads no clock at all; the tick only has to be valid. */
const IDLE_TICK_MS = 86_400_000;

/**
 * @returns The current {@link ModeView}. Stable between the moments a prayer's time ends, so a
 *   memo keyed on it does not recompute every minute.
 */
export function useTrackingModeView(): ModeView {
  const mode = useTrackingMode();
  const since = useSimpleModeSince();
  const location = useLocation();
  const calculation = useCalculationSettings();
  // Detailed mode is the identity everywhere, so it asks for no day, no times and no ticking clock.
  const simple = mode === 'simple';
  const today = useTrackingStore((state) => (simple ? state.todayDay() : ''));
  const now = useNow(simple ? VIEW_TICK_MS : IDLE_TICK_MS).getTime();

  const fresh: ModeView = simple
    ? modeViewFor(
        {
          ...getSettingsSnapshot(),
          trackingMode: mode,
          simpleModeSince: since,
          location,
          calculation,
        },
        today,
        now
      )
    : { mode, since, today, closedToday: [] };
  const key = modeViewKey(fresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key IS the view's identity
  return useMemo(() => fresh, [key]);
}

/**
 * @returns The qada counters to show — stored debts in detailed mode; stored + shown-only misses −
 *   made up in simple mode. Re-reads on any tracking write and on any change of mode, start day,
 *   made-up counter or closed prayer.
 */
export function useQadaShownDebts(): QadaDebts {
  const view = useTrackingModeView();
  const madeUp = useSimpleQadaMadeUp();
  const hydrated = useTrackingHydrated();
  const stored = useQadaDebts();
  const simple = view.mode === 'simple';
  const revision = useTrackingStore((state) => (simple ? state.revision : 0));
  const read = useTrackingStore((state) => (simple ? state.qadaShownDebts : null));
  return useMemo(() => {
    void revision;
    void view;
    void madeUp;
    if (!hydrated || read === null) return stored;
    try {
      return read();
    } catch {
      // A database that cannot answer shows what is stored, never a crash.
      return stored;
    }
  }, [hydrated, stored, revision, read, view, madeUp]);
}
