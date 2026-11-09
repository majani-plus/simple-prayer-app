/**
 * FOSS build stand-in for `react-native-purchases` (aliased by metro.config.js when `FOSS_BUILD=1`).
 *
 * RevenueCat sells through Google Play Billing, a Google library. `services/purchases.ts` reads the
 * SDK from this module's default export and treats `undefined` as "no tip jar in this binary", so
 * the tip jar is not shown (D46). The FOSS config has no RevenueCat key either.
 */
const Purchases: typeof import('react-native-purchases').default | undefined = undefined;

export default Purchases;
