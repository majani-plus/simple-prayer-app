/**
 * The tip jar's plumbing: RevenueCat, consumables, and the rules that keep it out of trouble.
 *
 * PRODUCT_SPEC §14 / decisions D29, D45, D57. This module owns everything about *taking* a tip —
 * the product identifiers, the API key, the purchase call and its three outcomes — and none of how
 * it looks (`components/TipJar.tsx`) or how many have been left (`stores/tipLedger.ts`).
 *
 * ## Four rules, each of which is a rejection or a crash if broken
 *
 * 1. **Consumables, no entitlement.** A tip is consumed the moment it is made: it unlocks nothing,
 *    so nothing is attached to it. That also means RevenueCat keeps no balance for us and the
 *    stores cannot restore one — Apple's own guidance is that consumables are not restorable — so
 *    the lifetime count is ours to keep (`stores/tipLedger.ts`) and the UI says so out loud
 *    (`settings.tip.oneOff`) rather than letting someone discover it on a new phone.
 * 2. **The word is "tip", never the other one.** Apple 3.2.2(iv) rejects apps collecting
 *    charitable contributions through IAP; 3.1.1 explicitly *permits* tipping the developer. The
 *    distinction lives in the words, and the words reach App Store Connect through the product
 *    identifiers as well as the UI — so {@link TIP_PRODUCT_IDS} say `tip`, and
 *    `src/i18n/__tests__/tipCopy.test.ts` fails the build if "donate"/"charity"/"sadaqah"/
 *    "zakat"/"bağış"/"تبرع" ever appears in a locale file or in the identifiers below.
 * 3. **The native module may simply not be there.** `react-native-purchases` is a native module.
 *    It is absent from Jest, from Expo Go, and — right now — from the installed dev client. Every
 *    entry point therefore goes through {@link createRevenueCatAdapter}, which `require`s it
 *    lazily inside a `try`, and every call is wrapped: a missing module degrades to
 *    `status: 'unavailable'` and can never throw into a render.
 * 4. **No key, no feature.** Without a public SDK key the tip jar is not "broken", it is *absent*:
 *    {@link tipJarApiKey} returns `null`, {@link TipJarService.load} answers `disabled`, and
 *    `TipJar` renders nothing at all. Dropping the key into `app.json`'s `extra.revenueCat` (or
 *    the `EXPO_PUBLIC_REVENUECAT_KEY_*` environment) is the entire switch-on. See
 *    `docs/TIP_JAR_RUNBOOK.md`.
 *
 * ## Why the products are fetched by identifier, not from an Offering (D57)
 *
 * Owner decision: the three consumables — `tip_small`, `tip_medium`, `tip_large` — carry the SAME
 * identifier on iOS, Android and RevenueCat's test store, and the app asks the SDK for exactly
 * those products (`getProducts`) instead of reading a RevenueCat Offering. No paywall, no
 * offering, no dashboard object to configure or misname: products in the store consoles plus a
 * public key is the whole setup. What is deliberately given up is remote *tier* tuning — adding a
 * fourth tier now takes an app update — while remote *price* tuning survives untouched, because
 * prices are set per storefront in the consoles and this module renders whatever `priceString`
 * the store answers with, never a hardcoded amount or currency.
 *
 * One consequence is visible in the console rather than in the app: the native SDK pre-fetches
 * the Offerings list on its own after `configure()`, finds none (because there is none, by
 * design), and logs an error for a request this app never made. {@link OFFERINGS_NOISE} drops it.
 *
 * Dependency rule: `services → domain`. No React, no stores, no user-facing strings — every string
 * here is an identifier, and the copy lives in i18n.
 */

// ---------------------------------------------------------------------------
// Product configuration
// ---------------------------------------------------------------------------

/** The tiers this build knows how to caption, cheapest first. */
export const TIP_TIERS = ['small', 'medium', 'large'] as const;
export type TipTierKey = (typeof TIP_TIERS)[number];

/**
 * Store product identifiers — identical on iOS, Android and the test store (D57), and also App
 * Store Connect / Play Console metadata, hence the word `tip` in every one of them. They are
 * *consumable* products; nothing here is a subscription and nothing grants an entitlement.
 *
 * These identifiers are the contract: {@link createTipJarService} asks the store for exactly this
 * list, so renaming a product in a console silently removes its tier from the jar. The runbook
 * says so in the same breath as the table of ids.
 */
export const TIP_PRODUCT_IDS: Readonly<Record<TipTierKey, string>> = Object.freeze({
  small: 'tip_small',
  medium: 'tip_medium',
  large: 'tip_large',
});

/**
 * Maps a store product id onto the tier whose copy describes it.
 *
 * @param productId - The identifier the store reported for a product.
 * @returns The tier key, or `null` for a product this build has no caption for (a custom
 * `productIds` list, or a store echoing an identifier variant) — which renders with the generic
 * label rather than disappearing.
 */
export function tipTierForProduct(productId: string): TipTierKey | null {
  return TIP_TIERS.find((tier) => TIP_PRODUCT_IDS[tier] === productId) ?? null;
}

// ---------------------------------------------------------------------------
// The API key
// ---------------------------------------------------------------------------

/** Where a key may be configured, in the order they are consulted. */
export interface TipJarKeySource {
  /** `expo.extra.revenueCat` from `app.json`, as read back through `expo-constants`. */
  extra?: unknown;
  /** `process.env`, for the `EXPO_PUBLIC_REVENUECAT_KEY_*` pair. */
  env?: Record<string, string | undefined>;
}

/** Trims a candidate and rejects anything that is not a usable key. */
function usableKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Loads `expo-constants` lazily; `null` where it does not exist (plain Jest, a node script). */
function constants(): typeof import('expo-constants').default | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-constants') as typeof import('expo-constants')).default;
  } catch {
    return null;
  }
}

/** Reads `Platform.OS` lazily, so this module stays importable without React Native. */
function currentPlatform(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native') as typeof import('react-native')).Platform.OS;
  } catch {
    return 'unknown';
  }
}

/**
 * The RevenueCat **public SDK key** for a platform.
 *
 * Public SDK keys are publishable — they are designed to ship inside the binary — so this reads
 * from app config rather than from a secret store. There is no key yet; until one exists this
 * returns `null` everywhere and the whole feature stays invisible.
 *
 * Two sources, in order:
 *
 * 1. `expo.extra.revenueCat.{ios,android}` in `app.json` — the durable home, visible in the
 *    config and swappable per build profile.
 * 2. `EXPO_PUBLIC_REVENUECAT_KEY_IOS` / `_ANDROID` — the escape hatch for a local or CI build that
 *    should not rewrite `app.json`. `EXPO_PUBLIC_*` variables are inlined at bundle time.
 *
 * @param platform - Usually `Platform.OS`; defaults to the running platform.
 * @param source - Overridden by tests. Defaults to the real app config and `process.env`.
 * @returns The key, or `null` when this platform has none configured.
 */
export function tipJarApiKey(
  platform: string = currentPlatform(),
  source?: TipJarKeySource
): string | null {
  if (platform !== 'ios' && platform !== 'android') return null;

  const extra = source?.extra ?? constants()?.expoConfig?.extra;
  const configured =
    isRecord(extra) && isRecord(extra.revenueCat) ? extra.revenueCat[platform] : undefined;

  // Each `process.env.EXPO_PUBLIC_*` is spelled out as a **direct member access**, because that
  // is the only form Expo's babel plugin replaces with a literal at bundle time; reading them
  // through a variable would work in Jest and silently return `undefined` in a release build.
  const env = source?.env ?? {
    EXPO_PUBLIC_REVENUECAT_KEY_IOS: process.env.EXPO_PUBLIC_REVENUECAT_KEY_IOS,
    EXPO_PUBLIC_REVENUECAT_KEY_ANDROID: process.env.EXPO_PUBLIC_REVENUECAT_KEY_ANDROID,
  };
  const fromEnv =
    platform === 'ios'
      ? env.EXPO_PUBLIC_REVENUECAT_KEY_IOS
      : env.EXPO_PUBLIC_REVENUECAT_KEY_ANDROID;

  return usableKey(configured) ?? usableKey(fromEnv);
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/** The bits of a store product the tip jar needs. */
export interface StoreProduct {
  /** The store's product identifier, e.g. `tip_small`. */
  identifier: string;
  /** The price already formatted in the user's currency by the store, e.g. `"£2.49"`. */
  priceString: string;
  /** The numeric price, used only to sort the tiers. */
  price: number;
  /**
   * The platform object this product was built from, handed straight back to
   * {@link PurchasesAdapter.purchase}. Opaque on purpose: nothing outside the adapter that made
   * it may look inside.
   */
  raw?: unknown;
}

/** What a purchase attempt ended as. A cancellation is *not* a failure. */
export type TipOutcome =
  /** The store took the payment. The only branch that may thank anybody. */
  | { kind: 'purchased' }
  /** The user backed out of the store sheet. Say nothing at all. */
  | { kind: 'cancelled' }
  /** Anything else: network, store outage, a missing native module. */
  | { kind: 'failed' };

/** Everything the service needs from the platform. Implemented over RevenueCat, or faked. */
export interface PurchasesAdapter {
  /** Whether the native module could be loaded at all. Never throws. */
  isAvailable(): boolean;
  /** Configures the SDK with a public key. Called at most once per adapter. Never throws. */
  configure(apiKey: string): boolean;
  /**
   * Fetches the store products for a list of identifiers, in the user's storefront.
   *
   * @param identifiers - The product ids to ask for, i.e. {@link TIP_PRODUCT_IDS}.
   * @returns The products the store recognised (possibly fewer than asked for — an unapproved
   * product simply does not come back), or `null` when the store could not be reached at all.
   * Never throws.
   */
  products(identifiers: readonly string[]): Promise<StoreProduct[] | null>;
  /** Runs the store's purchase sheet. Never throws — a rejection becomes an outcome. */
  purchase(product: StoreProduct): Promise<TipOutcome>;
}

// ---------------------------------------------------------------------------
// The RevenueCat adapter
// ---------------------------------------------------------------------------

type PurchasesModule = typeof import('react-native-purchases');

/**
 * The SDK's own "error fetching offerings" chatter — **not ours**, and not a fault.
 *
 * Nothing in this app ever calls `getOfferings`: D57 fetches the three consumables by identifier
 * precisely so no Offering has to exist. The native SDK nonetheless warms its caches the moment
 * `configure()` returns, and one of the things it pre-fetches is the Offerings list. With no
 * Offering configured in the RevenueCat dashboard — which is the deliberate D57 state — that
 * background fetch fails and the SDK logs an error, repeatedly, for a request the app neither
 * made nor needs. The tip jar is unaffected: `getProducts` is a separate call and answers fine.
 *
 * So the message is dropped here rather than left to alarm whoever is reading the console. It is
 * matched on the SDK's own wording; a message that stops matching simply becomes visible again,
 * which is the safe direction to fail in.
 */
const OFFERINGS_NOISE = /offering/i;

/** What the SDK's log handler is allowed to do with a message it is handed. */
export type SdkLogSink = (level: string, message: string) => void;

/**
 * Quietens the SDK's own logging: errors only, and the offerings chatter dropped outright.
 *
 * Everything that survives the filter goes to `sink`, which is a **no-op by default** — the app
 * keeps no console logging of its own (`src/__tests__/architecture.test.ts` enforces that, and
 * this is not the one startup failure that earns the exception). Nothing is lost that the user or
 * the owner needs: the jar has exactly three visible states — absent, "not available right now",
 * and a purchase that plainly failed — and every one of them is decided by this module's own
 * return values rather than by anything the SDK prints. A sink is taken as an argument so a test
 * can see what the filter passes and what it swallows.
 *
 * @param purchases - The loaded `react-native-purchases` default export.
 * @param sink - Where surviving messages go. Defaults to discarding them.
 */
function quietenSdkLogging(
  purchases: NonNullable<PurchasesModule['default']>,
  sink: SdkLogSink = () => undefined
): void {
  try {
    // The SDK's default is DEBUG in debug builds, which floods Metro on its own.
    void purchases.setLogLevel(purchases.LOG_LEVEL.ERROR).catch(() => {
      // An SDK build without the setter must never break configuration.
    });
    purchases.setLogHandler((level, message) => {
      if (OFFERINGS_NOISE.test(message)) return;
      sink(String(level), message);
    });
  } catch {
    // Logging configuration is a nicety; a version without these APIs changes nothing else.
  }
}

/**
 * The real adapter: `getProducts` by identifier, `purchaseStoreProduct` to buy — the direct
 * consumable path, with no paywall and no offering in between (D57).
 *
 * `react-native-purchases` is `require`d lazily inside a `try`, exactly like `expo-location` in
 * `services/heading.ts` — but with a sharper reason: the dev client currently installed on the
 * simulator does **not** contain this native module, so an eager import would not degrade, it
 * would take the app down at startup. Every call is individually guarded as well, because a
 * module that imports cleanly can still throw from its first native call.
 *
 * @param logSink - Where SDK messages that survive {@link quietenSdkLogging}'s filter go. The app
 * passes nothing, which discards them; tests pass a spy to see what the filter let through.
 * @returns An adapter that answers `false`/`null`/`{ kind: 'failed' }` wherever the platform is
 * not there, and never throws.
 */
export function createRevenueCatAdapter(logSink?: SdkLogSink): PurchasesAdapter {
  let module: PurchasesModule | null | undefined;

  const load = (): PurchasesModule | null => {
    if (module === undefined) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        module = require('react-native-purchases') as PurchasesModule;
      } catch {
        module = null;
      }
    }
    return module;
  };

  return {
    isAvailable() {
      return load()?.default !== undefined;
    },

    configure(apiKey) {
      const purchases = load()?.default;
      if (purchases === undefined) return false;
      try {
        // Before `configure`, so the cache warm-up it kicks off is already inside the filter.
        quietenSdkLogging(purchases, logSink);
        purchases.configure({ apiKey });
        return true;
      } catch {
        return false;
      }
    },

    async products(identifiers) {
      const purchases = load()?.default;
      if (purchases === undefined) return null;
      try {
        // NON_SUBSCRIPTION matters on Android: Google Play queries in-app products and
        // subscriptions separately, and the default there is the subscription list — which would
        // make three perfectly configured consumables come back as "not found".
        const products = await purchases.getProducts(
          [...identifiers],
          purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION
        );
        return products.map((product) => ({
          identifier: product.identifier,
          priceString: product.priceString,
          price: product.price,
          raw: product,
        }));
      } catch {
        return null;
      }
    },

    async purchase(product) {
      const purchases = load()?.default;
      if (purchases === undefined) return { kind: 'failed' };
      const raw = product.raw;
      if (raw === undefined || raw === null) return { kind: 'failed' };
      try {
        await purchases.purchaseStoreProduct(
          raw as Parameters<typeof purchases.purchaseStoreProduct>[0]
        );
        return { kind: 'purchased' };
      } catch (error) {
        // The RN SDK marks a dismissed sheet with `userCancelled`. It is the one "failure" that
        // must stay completely silent: someone who changed their mind has not hit an error.
        const cancelled = isRecord(error) && error.userCancelled === true;
        return cancelled ? { kind: 'cancelled' } : { kind: 'failed' };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** One renderable tier: a price, the copy key that captions it, and the product behind it. */
export interface TipTier {
  /** Stable key for React and for test ids — the store product identifier. */
  id: string;
  /** The store product id, e.g. `tip_small`. */
  productId: string;
  /** Which caption to use, or `null` for a tier this build does not know (generic caption). */
  tier: TipTierKey | null;
  /** The store's own localized price string. Never re-formatted by us. */
  priceString: string;
  /** The product to hand back to {@link TipJarService.tip}. */
  product: StoreProduct;
}

/** What the UI should render. */
export type TipJarState =
  /** No API key on this platform: the feature does not exist yet. Render **nothing**. */
  | { status: 'disabled' }
  /** Configured, but the store could not be reached (or the native module is absent). */
  | { status: 'unavailable' }
  /** Ready to take a tip. `tiers` is non-empty. */
  | { status: 'ready'; tiers: TipTier[] };

/** The surface `components/TipJar.tsx` consumes. Nothing here ever throws. */
export interface TipJarService {
  /** `false` when no key is configured — the caller should render nothing at all. */
  readonly configured: boolean;
  /** Loads the products. Repeated calls reuse the first successful answer. */
  load(): Promise<TipJarState>;
  /** Runs one purchase. See {@link TipOutcome}; a cancellation is not an error. */
  tip(tier: TipTier): Promise<TipOutcome>;
}

/** Construction-time dependencies of {@link createTipJarService}. */
export interface TipJarServiceOptions {
  /** Platform access. Defaults to {@link createRevenueCatAdapter}. */
  adapter?: PurchasesAdapter;
  /**
   * The public SDK key. Defaults to {@link tipJarApiKey} for the running platform; pass `null`
   * explicitly to model "not configured yet".
   */
  apiKey?: string | null;
  /** The product identifiers to fetch. Defaults to the three in {@link TIP_PRODUCT_IDS}. */
  productIds?: readonly string[];
}

/**
 * Builds the tip jar service.
 *
 * The tiers are sorted by price ascending, which is both the anchoring order the research calls
 * for (a low anchor first, the generous option beside it) and the only ordering that survives the
 * owner retuning prices in the store consoles.
 *
 * @param options - See {@link TipJarServiceOptions}.
 * @returns A service whose every method resolves rather than throwing.
 */
export function createTipJarService(options: TipJarServiceOptions = {}): TipJarService {
  const adapter = options.adapter ?? createRevenueCatAdapter();
  const apiKey = options.apiKey === undefined ? tipJarApiKey() : options.apiKey;
  const productIds = options.productIds ?? TIP_TIERS.map((tier) => TIP_PRODUCT_IDS[tier]);

  let configured = false;
  let inFlight: Promise<TipJarState> | null = null;
  let ready: TipJarState | null = null;

  const ensureConfigured = (key: string): boolean => {
    if (configured) return true;
    if (!adapter.isAvailable()) return false;
    configured = adapter.configure(key);
    return configured;
  };

  const read = async (key: string): Promise<TipJarState> => {
    if (!ensureConfigured(key)) return { status: 'unavailable' };
    const products = await adapter.products(productIds);
    if (products === null || products.length === 0) return { status: 'unavailable' };

    const tiers: TipTier[] = products
      .map((product) => ({
        id: product.identifier,
        productId: product.identifier,
        tier: tipTierForProduct(product.identifier),
        priceString: product.priceString,
        product,
      }))
      .sort((a, b) => a.product.price - b.product.price);

    return { status: 'ready', tiers };
  };

  return {
    get configured() {
      return apiKey !== null;
    },

    load() {
      if (apiKey === null) return Promise.resolve<TipJarState>({ status: 'disabled' });
      // A successful load is cached; a failed one is not, so pulling the screen up again after
      // the network came back retries rather than staying stuck on "unavailable".
      if (ready !== null) return Promise.resolve(ready);
      inFlight ??= read(apiKey)
        .catch((): TipJarState => ({ status: 'unavailable' }))
        .then((state) => {
          inFlight = null;
          if (state.status === 'ready') ready = state;
          return state;
        });
      return inFlight;
    },

    async tip(tier) {
      if (apiKey === null) return { kind: 'failed' };
      if (!ensureConfigured(apiKey)) return { kind: 'failed' };
      try {
        return await adapter.purchase(tier.product);
      } catch {
        return { kind: 'failed' };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests, and anywhere without a store)
// ---------------------------------------------------------------------------

/** A hand-cranked {@link PurchasesAdapter}. */
export interface FakePurchasesAdapter extends PurchasesAdapter {
  /** What the next {@link PurchasesAdapter.purchase} resolves as. Defaults to `purchased`. */
  setOutcome(outcome: TipOutcome): void;
  /** Makes the adapter behave as if the native module were missing. */
  setAvailable(available: boolean): void;
  /** Products purchased so far, oldest first. */
  readonly purchased: StoreProduct[];
  /** Whether {@link PurchasesAdapter.configure} has run. */
  readonly configured: boolean;
}

/** Builds a plausible store product, for tests and for the fake adapter's default. */
export function fakeTipProduct(
  productId: string,
  price: number,
  priceString: string
): StoreProduct {
  return { identifier: productId, price, priceString, raw: { identifier: productId } };
}

/**
 * Builds an in-memory {@link PurchasesAdapter}.
 *
 * Exported from the production module for the same reason `createFakeHeadingAdapter` is: the seam
 * has to be reachable without importing a test file.
 *
 * @param catalog - What the store "has configured", or `null` to model "the store could not be
 * reached". Like the real `getProducts`, only the products whose identifiers are actually asked
 * for come back — asking for three ids against a two-product catalog yields two.
 * @returns A fake adapter driven by hand.
 */
export function createFakePurchasesAdapter(
  catalog: StoreProduct[] | null = [
    fakeTipProduct(TIP_PRODUCT_IDS.small, 1.99, '$1.99'),
    fakeTipProduct(TIP_PRODUCT_IDS.medium, 4.99, '$4.99'),
    fakeTipProduct(TIP_PRODUCT_IDS.large, 9.99, '$9.99'),
  ]
): FakePurchasesAdapter {
  let available = true;
  let configured = false;
  let outcome: TipOutcome = { kind: 'purchased' };
  const purchased: StoreProduct[] = [];

  return {
    isAvailable: () => available,
    configure() {
      if (!available) return false;
      configured = true;
      return true;
    },
    products(identifiers) {
      if (!available || catalog === null) return Promise.resolve(null);
      return Promise.resolve(catalog.filter((product) => identifiers.includes(product.identifier)));
    },
    purchase(product) {
      if (!available) return Promise.resolve<TipOutcome>({ kind: 'failed' });
      if (outcome.kind === 'purchased') purchased.push(product);
      return Promise.resolve(outcome);
    },
    setOutcome(next) {
      outcome = next;
    },
    setAvailable(next) {
      available = next;
    },
    get purchased() {
      return purchased;
    },
    get configured() {
      return configured;
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultService: TipJarService | null = null;

/**
 * The app-wide service, built on first use so no native module is touched at import time.
 *
 * @returns The singleton {@link TipJarService} over {@link createRevenueCatAdapter}.
 */
export function getTipJarService(): TipJarService {
  defaultService ??= createTipJarService();
  return defaultService;
}
