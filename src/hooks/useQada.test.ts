/**
 * Unit tests for `useQada` — the single door the qada UI reads and writes through.
 *
 * The card and the screen tests already exercise the happy paths end to end, so what is left
 * here is the wiring nobody can see on screen:
 *
 * 1. **Nothing is asked of the database before it is open.** Before `hydrate()` the derived
 *    selectors would query a closed connection, so the hook answers with an idle snapshot and
 *    calls neither `qadaProgress` nor `undoableForgive`.
 * 2. **The pace window is the caller's**, forwarded verbatim to the store.
 * 3. **Undo of a tick is a compensating write** — `domain/qada.applyMiss`, recorded as a manual
 *    set — because `tickQada` only ever descends.
 * 4. **Corrupt stored counters never reach the UI**: they are sanitised on the way in.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useQada } from './useQada';
import { FORGIVE_UNDO_WINDOW_DAYS } from '@/domain/qada';
import type { QadaDebts } from '@/domain/types';
import { useSettingsStore } from '@/stores/settingsStore';

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
    }),
  };
});

const mockState = {
  hydrated: true,
  revision: 0,
  debts: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 } as QadaDebts,
  qadaProgress: jest.fn(() => ({
    debts: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    total: 0,
    paidInWindow: 4,
    perDay: 0.2,
    projectedClearDay: '2027-01-01',
  })),
  undoableForgive: jest.fn(() => null),
  tickQada: jest.fn(() => true),
  setQadaDebts: jest.fn(),
  forgiveQada: jest.fn(() => true),
  undoForgive: jest.fn(() => true),
  todayDay: () => '2026-11-07',
  qadaShownDebts: jest.fn((): QadaDebts => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 })),
  qadaDerivedMisses: jest.fn((): QadaDebts => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 })),
};

jest.mock('@/stores/trackingStore', () => ({
  useTrackingHydrated: () => mockState.hydrated,
  useQadaDebts: () => mockState.debts,
  useTrackingActions: () => mockState,
  useTrackingStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState.hydrated = true;
  mockState.revision = 0;
  mockState.debts = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
  useSettingsStore.getState().setQadaSetupCompleted(false);
});

describe('useQada', () => {
  it('touches nothing before the store has hydrated', async () => {
    mockState.hydrated = false;
    mockState.debts = { fajr: 5, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };

    const { result } = await renderHook(() => useQada());

    expect(mockState.qadaProgress).not.toHaveBeenCalled();
    expect(mockState.undoableForgive).not.toHaveBeenCalled();
    // The counters it already holds are still shown; only the derived figures stand down.
    expect(result.current.total).toBe(5);
    expect(result.current.progress.paidInWindow).toBe(0);
    expect(result.current.progress.projectedClearDay).toBeNull();
    expect(result.current.undoableForgive).toBeNull();
  });

  it('asks the store for the pace over the window it was given', async () => {
    const { result } = await renderHook(() => useQada(7));

    expect(mockState.qadaProgress).toHaveBeenCalledWith(7);
    expect(result.current.paceWindowDays).toBe(7);
    expect(result.current.progress.paidInWindow).toBe(4);
    expect(result.current.undoWindowDays).toBe(FORGIVE_UNDO_WINDOW_DAYS);
  });

  it('sanitises whatever the store hands it, and names the most-owed prayer', async () => {
    // A corrupt row must never inflate a debt or take the screen down.
    mockState.debts = { fajr: -3, dhuhr: 2.9, asr: Number.NaN, maghrib: 4, isha: 4 } as QadaDebts;

    const { result } = await renderHook(() => useQada());

    expect(result.current.debts).toEqual({ fajr: 0, dhuhr: 2, asr: 0, maghrib: 4, isha: 4 });
    expect(result.current.total).toBe(10);
    // Maghrib and Isha tie at four; the canonical prayer order breaks it, so the suggestion
    // cannot jitter between renders.
    expect(result.current.mostOwed).toBe('maghrib');
  });

  it('undoes a tick with a compensating write rather than a second tick', async () => {
    mockState.debts = { fajr: 2, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
    const { result } = await renderHook(() => useQada());

    await act(async () => {
      result.current.makeUp('fajr');
    });
    expect(mockState.tickQada).toHaveBeenCalledWith('fajr');

    await act(async () => {
      result.current.putBack('fajr');
    });
    expect(mockState.setQadaDebts).toHaveBeenCalledWith(
      { fajr: 3, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      'manual'
    );
  });

  it('marks the setup done through the settings store', async () => {
    const { result } = await renderHook(() => useQada());
    expect(result.current.setupCompleted).toBe(false);

    await act(async () => {
      result.current.completeSetup();
    });

    expect(useSettingsStore.getState().qadaSetupCompleted).toBe(true);
  });
});

describe('useQada in simple tracking mode (D192)', () => {
  const zero = (): QadaDebts => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });

  beforeEach(() => {
    useSettingsStore.getState().setTrackingMode('simple', '2026-11-01');
  });
  afterEach(() => {
    useSettingsStore.getState().setTrackingMode('detailed', '2026-11-07');
  });

  it('shows the misses simple mode shows, and makes them up on the counter — not the table', async () => {
    mockState.qadaShownDebts.mockReturnValue({ ...zero(), asr: 2 });
    mockState.qadaDerivedMisses.mockReturnValue({ ...zero(), asr: 2 });
    const { result } = await renderHook(() => useQada());

    expect(result.current.total).toBe(2);
    await act(async () => {
      expect(result.current.makeUp('asr')).toBe(true);
    });
    expect(mockState.tickQada).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().simpleQadaMadeUp.asr).toBe(1);

    // "Owe one more" undoes it on the same counter.
    await act(async () => {
      result.current.putBack('asr');
    });
    expect(useSettingsStore.getState().simpleQadaMadeUp.asr).toBe(0);
    expect(mockState.setQadaDebts).not.toHaveBeenCalled();
  });

  it('makes up the stored debt first', async () => {
    mockState.debts = { ...zero(), asr: 1 };
    mockState.qadaShownDebts.mockReturnValue({ ...zero(), asr: 3 });
    mockState.qadaDerivedMisses.mockReturnValue({ ...zero(), asr: 2 });
    const { result } = await renderHook(() => useQada());

    await act(async () => {
      result.current.makeUp('asr');
    });
    expect(mockState.tickQada).toHaveBeenCalledWith('asr');
    expect(useSettingsStore.getState().simpleQadaMadeUp.asr).toBe(0);
  });

  it('adds a put-back to the STORED counters, never the shown ones', async () => {
    mockState.debts = { ...zero(), asr: 1 };
    mockState.qadaShownDebts.mockReturnValue({ ...zero(), asr: 3 });
    mockState.qadaDerivedMisses.mockReturnValue({ ...zero(), asr: 2 });
    const { result } = await renderHook(() => useQada());

    await act(async () => {
      result.current.putBack('asr');
    });
    expect(mockState.setQadaDebts).toHaveBeenCalledWith({ ...zero(), asr: 2 }, 'manual');
  });

  it('"start fresh" also clears the misses it only shows', async () => {
    mockState.qadaShownDebts.mockReturnValue({ ...zero(), fajr: 2 });
    mockState.qadaDerivedMisses.mockReturnValue({ ...zero(), fajr: 2 });
    mockState.forgiveQada.mockReturnValueOnce(false);
    const { result } = await renderHook(() => useQada());

    await act(async () => {
      expect(result.current.forgive()).toBe(true);
    });
    expect(useSettingsStore.getState().simpleQadaMadeUp.fajr).toBe(2);
  });
});

