/**
 * The lifetime tip ledger — the one thing about tipping that only this phone knows.
 *
 * Tips are **consumable** in-app purchases (PRODUCT_SPEC §14, D29). A consumable is spent the
 * instant it is bought: it grants no entitlement, RevenueCat keeps no balance for it, and the
 * stores will not restore it. That is the correct product shape — it is what lets someone tip
 * again next year — but it means nobody upstream can answer "have you tipped before?". So we keep
 * the count, here, on the device, and the UI is honest that it lives here and nowhere else
 * (`settings.tip.oneOff`).
 *
 * It is deliberately the *smallest* record that can carry the two things the UI needs:
 *
 * - **`tipCount`** — the lifetime counter §14 asks for, and the whole of the "Supporter" marker.
 *   No non-consumable badge product is involved: adding one would mean a second product type, an
 *   entitlement to attach it to, and a restore flow, in exchange for surviving a reinstall. It was
 *   not worth those three things (see `docs/TIP_JAR_RUNBOOK.md`), so the marker is local and the
 *   copy says so rather than implying a promise the store will not keep.
 * - **`promptDismissed`** — because the optional one-time card §14 allows is *dismissible forever*,
 *   and "forever" has to outlive the process.
 *
 * MMKV rather than SQLite for the same reason the settings live there (D13): this is read during
 * the first render of a screen, and an async rehydrate would flash the wrong state. MMKV is a
 * native module, so it is `require`d lazily and every access is wrapped — a storage failure
 * degrades to "no tips recorded", never to a crash in a screen someone opened to be generous.
 *
 * Lives under `stores/` because that is the only layer allowed to touch `react-native-mmkv`
 * (`src/__tests__/architecture.test.ts`). It holds no React state and exposes no hook: the tip jar
 * reads it once on mount and again after a purchase, which is all the reactivity it needs.
 */

/** Everything the device remembers about tipping. */
export interface TipLedger {
  /** How many tips have been left on this device, ever. `0` for almost everybody. */
  tipCount: number;
  /** Epoch ms of the most recent tip, or `null` when there has never been one. */
  lastTipAt: number | null;
  /** Whether the one-time proactive card has been dismissed. Dismissal is permanent. */
  promptDismissed: boolean;
}

/** The state of a device that has never tipped. */
export const EMPTY_TIP_LEDGER: Readonly<TipLedger> = Object.freeze({
  tipCount: 0,
  lastTipAt: null,
  promptDismissed: false,
});

/** MMKV instance id; also the namespace the ledger is stored in. */
export const TIP_LEDGER_STORAGE_ID = 'simple-prayer-times.support';

/** Key the serialized ledger lives under. */
export const TIP_LEDGER_STORAGE_KEY = 'tipLedger';

/** The synchronous string storage the ledger persists through — the subset of MMKV we need. */
export interface TipStorage {
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Creates an in-memory {@link TipStorage}.
 *
 * @param seed - Optional initial contents.
 * @returns A storage adapter backed by a `Map`; used by tests and as the fallback anywhere MMKV
 * cannot be constructed.
 */
export function createMemoryTipStorage(seed?: Record<string, string>): TipStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * Creates the MMKV-backed {@link TipStorage}.
 *
 * The native module is required lazily on first access, so importing this module is safe under
 * Jest and in node scripts as long as they inject their own storage.
 *
 * @returns A storage adapter over a dedicated MMKV instance ({@link TIP_LEDGER_STORAGE_ID}).
 */
export function createMmkvTipStorage(): TipStorage {
  let instance: ReturnType<typeof import('react-native-mmkv').createMMKV> | null = null;
  const mmkv = () => {
    if (instance === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
      instance = createMMKV({ id: TIP_LEDGER_STORAGE_ID });
    }
    return instance;
  };
  return {
    getItem: (key) => mmkv().getString(key) ?? null,
    setItem: (key, value) => mmkv().set(key, value),
    removeItem: (key) => void mmkv().remove(key),
  };
}

/** A finite, non-negative integer, or the fallback. Storage is never trusted. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Rebuilds a complete {@link TipLedger} from an untrusted payload.
 *
 * @param value - Whatever was parsed out of storage: an older shape, a partial write, or garbage.
 * @returns A valid ledger; every unrecognisable field falls back to {@link EMPTY_TIP_LEDGER}.
 */
export function sanitizeTipLedger(value: unknown): TipLedger {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_TIP_LEDGER };
  const record = value as Record<string, unknown>;
  const lastTipAt = record.lastTipAt;
  return {
    tipCount: count(record.tipCount),
    lastTipAt:
      typeof lastTipAt === 'number' && Number.isFinite(lastTipAt) && lastTipAt > 0
        ? lastTipAt
        : null,
    promptDismissed: record.promptDismissed === true,
  };
}

/** The ledger's read/write surface. Every method returns the ledger as it now stands. */
export interface TipLedgerStore {
  /** Reads the ledger. Never throws; a broken payload reads as {@link EMPTY_TIP_LEDGER}. */
  read(): TipLedger;
  /**
   * Records one completed tip.
   *
   * @param at - Epoch ms; defaults to now.
   * @returns The updated ledger, so a caller can render the new count without a second read.
   */
  recordTip(at?: number): TipLedger;
  /** Marks the one-time proactive card as dismissed, permanently. */
  dismissPrompt(): TipLedger;
}

/**
 * Builds a ledger over a storage adapter.
 *
 * @param storage - Defaults to MMKV; tests inject {@link createMemoryTipStorage}.
 * @param now - Epoch-ms clock, injected so tests can pin `lastTipAt`.
 * @returns A {@link TipLedgerStore} whose methods never throw.
 */
export function createTipLedgerStore(
  storage: TipStorage = createMmkvTipStorage(),
  now: () => number = () => Date.now()
): TipLedgerStore {
  const read = (): TipLedger => {
    let raw: string | null | undefined;
    try {
      raw = storage.getItem(TIP_LEDGER_STORAGE_KEY);
    } catch {
      return { ...EMPTY_TIP_LEDGER };
    }
    if (typeof raw !== 'string' || raw.length === 0) return { ...EMPTY_TIP_LEDGER };
    try {
      return sanitizeTipLedger(JSON.parse(raw));
    } catch {
      return { ...EMPTY_TIP_LEDGER };
    }
  };

  const write = (ledger: TipLedger): TipLedger => {
    try {
      storage.setItem(TIP_LEDGER_STORAGE_KEY, JSON.stringify(ledger));
    } catch {
      // A tip that cannot be written down is still a tip that was paid for; the thank-you on
      // screen is the part that matters, and losing the counter is not worth a crash.
    }
    return ledger;
  };

  return {
    read,
    recordTip(at = now()) {
      const current = read();
      return write({
        ...current,
        tipCount: current.tipCount + 1,
        lastTipAt: Number.isFinite(at) && at > 0 ? at : current.lastTipAt,
      });
    },
    dismissPrompt() {
      return write({ ...read(), promptDismissed: true });
    },
  };
}

let defaultStore: TipLedgerStore | null = null;

/**
 * The app-wide ledger, created on first use so MMKV is never touched at import time.
 *
 * @returns The singleton {@link TipLedgerStore}.
 */
export function getTipLedger(): TipLedgerStore {
  defaultStore ??= createTipLedgerStore();
  return defaultStore;
}
