/**
 * Tests for the local tip ledger.
 *
 * The ledger exists because consumables leave no trace anywhere else: the store consumes them,
 * RevenueCat keeps no balance, and nothing can be restored. So this file is the only record that a
 * tip ever happened, and it has to behave like one — count correctly, survive a corrupt payload,
 * and never take a screen down when storage misbehaves.
 */

import {
  EMPTY_TIP_LEDGER,
  TIP_LEDGER_STORAGE_KEY,
  createMemoryTipStorage,
  createTipLedgerStore,
  sanitizeTipLedger,
} from './tipLedger';

describe('reading a fresh device', () => {
  it('has never tipped', () => {
    expect(createTipLedgerStore(createMemoryTipStorage()).read()).toEqual(EMPTY_TIP_LEDGER);
  });
});

describe('recording a tip', () => {
  it('counts up and remembers when', () => {
    const storage = createMemoryTipStorage();
    const ledger = createTipLedgerStore(storage, () => 1_700_000_000_000);

    expect(ledger.recordTip()).toEqual({
      tipCount: 1,
      lastTipAt: 1_700_000_000_000,
      promptDismissed: false,
    });
    expect(ledger.recordTip(1_700_000_001_000).tipCount).toBe(2);
  });

  it('persists, so the Supporter marker survives a relaunch', () => {
    const storage = createMemoryTipStorage();
    createTipLedgerStore(storage).recordTip();

    // A second store over the same storage is what the next app launch looks like.
    expect(createTipLedgerStore(storage).read().tipCount).toBe(1);
  });

  it('keeps the dismissal flag while counting', () => {
    const storage = createMemoryTipStorage();
    const ledger = createTipLedgerStore(storage);

    ledger.dismissPrompt();
    expect(ledger.recordTip().promptDismissed).toBe(true);
  });
});

describe('dismissing the one-time card', () => {
  it('is permanent', () => {
    const storage = createMemoryTipStorage();
    createTipLedgerStore(storage).dismissPrompt();

    expect(createTipLedgerStore(storage).read().promptDismissed).toBe(true);
  });
});

describe('trusting nothing from storage', () => {
  it.each([
    ['not JSON at all', 'not json'],
    ['a JSON scalar', '7'],
    ['null', 'null'],
    ['an empty string', ''],
  ])('reads %s as a fresh device', (_label, raw) => {
    const storage = createMemoryTipStorage({ [TIP_LEDGER_STORAGE_KEY]: raw });
    expect(createTipLedgerStore(storage).read()).toEqual(EMPTY_TIP_LEDGER);
  });

  it('rebuilds a partial or nonsensical payload field by field', () => {
    expect(sanitizeTipLedger({ tipCount: -4, lastTipAt: 'yesterday', promptDismissed: 'yes' })).toEqual(
      EMPTY_TIP_LEDGER
    );
    expect(sanitizeTipLedger({ tipCount: 2.7 })).toEqual({
      tipCount: 2,
      lastTipAt: null,
      promptDismissed: false,
    });
  });

  it('does not throw when storage itself does', () => {
    const broken = {
      getItem: () => {
        throw new Error('MMKV is having a day');
      },
      setItem: () => {
        throw new Error('MMKV is having a day');
      },
      removeItem: () => undefined,
    };
    const ledger = createTipLedgerStore(broken);

    // Someone has just paid. Losing the counter is a disappointment; crashing the thank-you is
    // unforgivable.
    expect(ledger.read()).toEqual(EMPTY_TIP_LEDGER);
    expect(() => ledger.recordTip()).not.toThrow();
  });
});
