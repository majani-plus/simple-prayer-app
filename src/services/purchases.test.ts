/**
 * Tests for the tip jar's plumbing.
 *
 * Four things have to hold, and each of them is a bug someone would otherwise find in production:
 *
 * 1. **No key, no feature.** The service must answer `disabled` — not "empty", not "unavailable" —
 *    so the UI can render literally nothing while there is no RevenueCat project.
 * 2. **A missing native module is a state, not a crash.** `react-native-purchases` is absent from
 *    Jest, from Expo Go and from the dev client currently on the simulator.
 * 3. **A cancellation is not an error.** It has its own outcome, and it must never be reported as
 *    a failure — the difference is the whole tone of the feature.
 * 4. **The three fixed products are the contract (D57).** The service asks the store for exactly
 *    `tip_small` / `tip_medium` / `tip_large`, renders whatever subset the store recognises
 *    (cheapest first, the store's own localized price string untouched), and never hardcodes an
 *    amount or a currency.
 */

import {
  TIP_PRODUCT_IDS,
  createFakePurchasesAdapter,
  createRevenueCatAdapter,
  createTipJarService,
  fakeTipProduct,
  tipJarApiKey,
  tipTierForProduct,
} from './purchases';

/**
 * The native module, as this app will actually meet it for a while yet: absent. `jest.mock` with a
 * throwing factory reproduces the exact failure a dev client without the pod compiled in produces
 * — a `require` that raises rather than a module that returns `undefined`.
 */
jest.mock('react-native-purchases', () => {
  throw new Error('Native module RNPurchases is not installed');
});

describe('the API key', () => {
  it('is absent by default, which is the current state of the world', () => {
    // app.json ships `extra.revenueCat` as empty strings: a placeholder, not a key.
    expect(tipJarApiKey('ios', { extra: { revenueCat: { ios: '', android: '' } }, env: {} })).toBeNull();
  });

  it('reads app.json config first', () => {
    const source = { extra: { revenueCat: { ios: 'appl_ios', android: 'goog_and' } }, env: {} };
    expect(tipJarApiKey('ios', source)).toBe('appl_ios');
    expect(tipJarApiKey('android', source)).toBe('goog_and');
  });

  it('falls back to the EXPO_PUBLIC environment for a build that must not rewrite app.json', () => {
    const key = tipJarApiKey('android', {
      extra: {},
      env: { EXPO_PUBLIC_REVENUECAT_KEY_ANDROID: '  goog_from_env  ' },
    });
    expect(key).toBe('goog_from_env');
  });

  it('never returns a key on a platform with no store', () => {
    expect(tipJarApiKey('web', { extra: { revenueCat: { ios: 'appl_ios' } }, env: {} })).toBeNull();
  });

  it('treats blank and non-string configuration as absent', () => {
    expect(tipJarApiKey('ios', { extra: { revenueCat: { ios: '   ' } }, env: {} })).toBeNull();
    expect(tipJarApiKey('ios', { extra: { revenueCat: { ios: 42 } }, env: {} })).toBeNull();
    expect(tipJarApiKey('ios', { extra: 'nonsense', env: {} })).toBeNull();
  });
});

describe('product identifiers', () => {
  it('names the tier a product belongs to', () => {
    expect(tipTierForProduct(TIP_PRODUCT_IDS.medium)).toBe('medium');
  });

  it('does not pretend to recognise a product it has no copy for', () => {
    // An id outside the fixed three still renders — with the generic caption, not a crash.
    expect(tipTierForProduct('tip_enormous')).toBeNull();
  });
});

describe('loading the products', () => {
  it('renders nothing at all while no key is configured', async () => {
    const service = createTipJarService({ adapter: createFakePurchasesAdapter(), apiKey: null });
    expect(service.configured).toBe(false);
    await expect(service.load()).resolves.toEqual({ status: 'disabled' });
  });

  it('asks the store for exactly the three fixed product ids', async () => {
    const adapter = createFakePurchasesAdapter();
    const spy = jest.spyOn(adapter, 'products');
    await createTipJarService({ adapter, apiKey: 'appl_test' }).load();

    expect(spy).toHaveBeenCalledWith(['tip_small', 'tip_medium', 'tip_large']);
  });

  it('turns the products into tiers, cheapest first, whatever order they arrived in', async () => {
    const adapter = createFakePurchasesAdapter([
      fakeTipProduct(TIP_PRODUCT_IDS.large, 9.99, '$9.99'),
      fakeTipProduct(TIP_PRODUCT_IDS.small, 1.99, '$1.99'),
      fakeTipProduct(TIP_PRODUCT_IDS.medium, 4.99, '$4.99'),
    ]);
    const service = createTipJarService({ adapter, apiKey: 'appl_test' });

    const state = await service.load();

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') throw new Error('unreachable');
    expect(state.tiers.map((tier) => tier.tier)).toEqual(['small', 'medium', 'large']);
    // The store's own formatted price is passed through untouched — it is the only string that is
    // correct in every currency, and re-formatting it is how apps end up showing "$4.99 TRY".
    expect(state.tiers.map((tier) => tier.priceString)).toEqual(['$1.99', '$4.99', '$9.99']);
    expect(adapter.configured).toBe(true);
  });

  it('renders the subset the store recognises rather than nothing', async () => {
    // A product still waiting for review simply does not come back from getProducts. Two tips on
    // offer beats a jar that claims to be unavailable while the third clears review.
    const adapter = createFakePurchasesAdapter([
      fakeTipProduct(TIP_PRODUCT_IDS.small, 1.99, '$1.99'),
      fakeTipProduct(TIP_PRODUCT_IDS.large, 9.99, '$9.99'),
    ]);
    const state = await createTipJarService({ adapter, apiKey: 'appl_test' }).load();

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') throw new Error('unreachable');
    expect(state.tiers.map((tier) => tier.tier)).toEqual(['small', 'large']);
  });

  it('keeps a product it has no caption for rather than dropping it', async () => {
    const adapter = createFakePurchasesAdapter([
      fakeTipProduct(TIP_PRODUCT_IDS.small, 1.99, '$1.99'),
      fakeTipProduct('tip_enormous', 24.99, '$24.99'),
    ]);
    const state = await createTipJarService({
      adapter,
      apiKey: 'appl_test',
      productIds: [TIP_PRODUCT_IDS.small, 'tip_enormous'],
    }).load();

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') throw new Error('unreachable');
    expect(state.tiers.map((tier) => tier.tier)).toEqual(['small', null]);
  });

  it('reports unavailable — never disabled — when the native module is missing', async () => {
    const adapter = createFakePurchasesAdapter();
    adapter.setAvailable(false);
    const service = createTipJarService({ adapter, apiKey: 'appl_test' });

    expect(service.configured).toBe(true);
    await expect(service.load()).resolves.toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when the store answers with nothing, or cannot be reached', async () => {
    await expect(
      createTipJarService({ adapter: createFakePurchasesAdapter(null), apiKey: 'k' }).load()
    ).resolves.toEqual({ status: 'unavailable' });
    await expect(
      createTipJarService({ adapter: createFakePurchasesAdapter([]), apiKey: 'k' }).load()
    ).resolves.toEqual({ status: 'unavailable' });
  });

  it('survives an adapter that rejects, rather than throwing into a render', async () => {
    const service = createTipJarService({
      apiKey: 'k',
      adapter: {
        isAvailable: () => true,
        configure: () => true,
        products: () => Promise.reject(new Error('network')),
        purchase: () => Promise.resolve({ kind: 'failed' as const }),
      },
    });
    await expect(service.load()).resolves.toEqual({ status: 'unavailable' });
  });

  it('asks the store once and reuses a successful answer', async () => {
    const adapter = createFakePurchasesAdapter();
    const spy = jest.spyOn(adapter, 'products');
    const service = createTipJarService({ adapter, apiKey: 'k' });

    await Promise.all([service.load(), service.load()]);
    await service.load();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure, so a screen reopened on a better network works', async () => {
    const adapter = createFakePurchasesAdapter();
    adapter.setAvailable(false);
    const service = createTipJarService({ adapter, apiKey: 'k' });

    await expect(service.load()).resolves.toEqual({ status: 'unavailable' });
    adapter.setAvailable(true);
    const second = await service.load();

    expect(second.status).toBe('ready');
  });
});

describe('leaving a tip', () => {
  const ready = async () => {
    const adapter = createFakePurchasesAdapter();
    const service = createTipJarService({ adapter, apiKey: 'k' });
    const state = await service.load();
    if (state.status !== 'ready') throw new Error('unreachable');
    return { adapter, service, tiers: state.tiers };
  };

  it('purchases the product behind the tier, directly — no paywall in between', async () => {
    const { adapter, service, tiers } = await ready();

    await expect(service.tip(tiers[1])).resolves.toEqual({ kind: 'purchased' });

    expect(adapter.purchased).toHaveLength(1);
    expect(adapter.purchased[0].identifier).toBe(TIP_PRODUCT_IDS.medium);
  });

  it('reports a cancellation as its own outcome, never as a failure', async () => {
    const { adapter, service, tiers } = await ready();
    adapter.setOutcome({ kind: 'cancelled' });

    await expect(service.tip(tiers[0])).resolves.toEqual({ kind: 'cancelled' });
    expect(adapter.purchased).toHaveLength(0);
  });

  it('reports a real failure as a failure', async () => {
    const { adapter, service, tiers } = await ready();
    adapter.setOutcome({ kind: 'failed' });

    await expect(service.tip(tiers[0])).resolves.toEqual({ kind: 'failed' });
    expect(adapter.purchased).toHaveLength(0);
  });

  it('fails quietly when an adapter throws instead of resolving', async () => {
    const { tiers } = await ready();
    const service = createTipJarService({
      apiKey: 'k',
      adapter: {
        isAvailable: () => true,
        configure: () => true,
        products: () => Promise.resolve([]),
        purchase: () => {
          throw new Error('native blew up');
        },
      },
    });

    await expect(service.tip(tiers[0])).resolves.toEqual({ kind: 'failed' });
  });
});

describe('the RevenueCat adapter', () => {
  /**
   * The whole reason the adapter exists. `react-native-purchases` is not installed in the running
   * dev client, so this is the code path the app takes *today* on a real device — and it has to be
   * a boring `false`, not an exception.
   */
  it('degrades to a disabled state when the native module cannot be required', async () => {
    const adapter = createRevenueCatAdapter();

    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.configure('k')).toBe(false);
    await expect(adapter.products(Object.values(TIP_PRODUCT_IDS))).resolves.toBeNull();
    await expect(
      adapter.purchase({ identifier: 'y', price: 1, priceString: '$1', raw: {} })
    ).resolves.toEqual({ kind: 'failed' });
  });

  /**
   * The owner's report: "I sometimes get revenue cat error fetching offering. Why is it trying to
   * fetch offering." It is not — nothing in this app calls `getOfferings` (D57 fetches products by
   * identifier so no Offering has to exist). The native SDK warms its own caches after
   * `configure()`, and with no Offering in the dashboard that background request fails and logs.
   * Nothing user-facing comes of it, so the adapter drops it and leaves every other error alone.
   */
  describe('the SDK’s own logging', () => {
    /** A hand-built stand-in for `react-native-purchases`, capturing what the adapter installs. */
    function withFakeSdk(sink: (level: string, message: string) => void): {
      adapter: ReturnType<typeof createRevenueCatAdapter>;
      sdk: {
        setLogLevel: jest.Mock;
        logHandler: ((level: string, message: string) => void) | null;
      };
    } {
      const sdk = {
        LOG_LEVEL: { ERROR: 'ERROR' },
        setLogLevel: jest.fn(() => Promise.resolve()),
        setLogHandler: jest.fn((handler: (level: string, message: string) => void) => {
          state.logHandler = handler;
        }),
        configure: jest.fn(),
      };
      const state: { setLogLevel: jest.Mock; logHandler: null | ((l: string, m: string) => void) } =
        { setLogLevel: sdk.setLogLevel, logHandler: null };

      let adapter!: ReturnType<typeof createRevenueCatAdapter>;
      jest.isolateModules(() => {
        jest.doMock('react-native-purchases', () => ({ __esModule: true, default: sdk }));
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const module = require('./purchases') as typeof import('./purchases');
        adapter = module.createRevenueCatAdapter(sink);
      });
      return { adapter, sdk: state };
    }

    it('turns the SDK down to errors and swallows the offerings chatter', () => {
      const sink = jest.fn();
      const { adapter, sdk } = withFakeSdk(sink);

      expect(adapter.configure('appl_key')).toBe(true);
      expect(sdk.setLogLevel).toHaveBeenCalledWith('ERROR');
      expect(sdk.logHandler).not.toBeNull();

      sdk.logHandler?.(
        'ERROR',
        'Error fetching offerings - There is an issue with your configuration.'
      );
      expect(sink).not.toHaveBeenCalled();

      sdk.logHandler?.('ERROR', 'There was a problem with the App Store.');
      expect(sink).toHaveBeenCalledWith('ERROR', 'There was a problem with the App Store.');
    });

    it('discards everything by default — the app keeps no console logging of its own', () => {
      const { adapter, sdk } = withFakeSdk(() => undefined);
      expect(adapter.configure('appl_key')).toBe(true);
      // Nothing to assert but that handing it a message is harmless: the app's own three visible
      // states are decided by this module's return values, never by what the SDK prints.
      expect(() => sdk.logHandler?.('ERROR', 'anything at all')).not.toThrow();
    });
  });
});
