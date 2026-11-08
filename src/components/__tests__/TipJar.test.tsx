/**
 * Tests for `TipJar`.
 *
 * What is being defended is mostly *restraint*, so most of these assertions are about what does
 * NOT appear:
 *
 * - nothing at all while no RevenueCat key is configured (which is the state the app ships in
 *   today — the Settings and About screens must look exactly as they did before this existed);
 * - no crash, and one quiet sentence, when the native module is missing — the current dev client,
 *   Expo Go, and this very test file;
 * - **no message whatsoever** when someone opens the store sheet and changes their mind.
 *
 * And one thing that must appear: a sincere thank-you, once, with the tip written into the local
 * ledger, because nothing upstream will remember it for us.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AccessibilityInfo, Dimensions } from 'react-native';

import { TipJar, tipTierLayout } from '../TipJar';
import { initI18n } from '@/i18n';
import {
  TIP_PRODUCT_IDS,
  createFakePurchasesAdapter,
  createTipJarService,
  fakeTipProduct,
  type FakePurchasesAdapter,
  type TipJarService,
} from '@/services/purchases';
import { hasSessionMoment, resetSessionMoments } from '@/services/supportMoments';
import { createMemoryTipStorage, createTipLedgerStore, type TipLedgerStore } from '@/stores/tipLedger';

/**
 * The native module as this app actually meets it today — missing. A throwing factory reproduces
 * a dev client without the pod compiled in (a `require` that raises), rather than a module that
 * quietly returns `undefined`, so the "a key but no native module" case below exercises the real
 * `createRevenueCatAdapter` and not a stand-in.
 */
jest.mock('react-native-purchases', () => {
  throw new Error('Native module RNPurchases is not installed');
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

/** A configured jar over a fake store, plus the handles a test needs to drive it. */
function configured(
  catalog?: Parameters<typeof createFakePurchasesAdapter>[0],
  productIds?: readonly string[]
): {
  adapter: FakePurchasesAdapter;
  service: TipJarService;
  ledger: TipLedgerStore;
} {
  const adapter = catalog === undefined ? createFakePurchasesAdapter() : createFakePurchasesAdapter(catalog);
  return {
    adapter,
    service: createTipJarService({ adapter, apiKey: 'appl_test_key', productIds }),
    ledger: createTipLedgerStore(createMemoryTipStorage(), () => 1_700_000_000_000),
  };
}

/**
 * Dynamic Type, as the component actually reads it.
 *
 * `jest-expo`'s `Dimensions` mock answers a raw 750×1334 screen with `fontScale: 2` — that is the
 * device's *pixel* ratio, not a text-size setting, and it is not what the value means on a device
 * (there it is the Dynamic Type multiplier: 1 at the default text size, up to 2 at Apple's bar).
 * Left to the mock, every test here would silently exercise the large-type layout. So the scale is
 * stated per test instead, which also lets the layout rule be pinned at both ends.
 */
function setFontScale(fontScale: number): void {
  jest.spyOn(Dimensions, 'get').mockImplementation((dim) =>
    dim === 'window'
      ? { width: 390, height: 844, scale: 3, fontScale }
      : { width: 390, height: 844, scale: 3, fontScale }
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  await initI18n().changeLanguage('en');
  // The D29 referee is process-scoped, so it has to be wound back between tests.
  resetSessionMoments();
  setFontScale(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('while tipping is not configured', () => {
  it('renders nothing at all — not a disabled row, not a "coming soon"', async () => {
    const service = createTipJarService({ adapter: createFakePurchasesAdapter(), apiKey: null });
    const ledger = createTipLedgerStore(createMemoryTipStorage());

    await render(<TipJar service={service} ledger={ledger} />);

    expect(screen.queryByTestId('tip-jar')).toBeNull();
    expect(screen.queryByText(/coffee/i)).toBeNull();
  });
});

describe('with the three fixed products', () => {
  it('renders a tier per product, cheapest first, priced by the store', async () => {
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);

    expect(await screen.findByTestId('tip-jar-tiers')).toBeTruthy();
    expect(screen.getByText('Buy the developer a coffee')).toBeTruthy();
    expect(screen.getByText('$1.99')).toBeTruthy();
    expect(screen.getByText('$4.99')).toBeTruthy();
    expect(screen.getByText('$9.99')).toBeTruthy();
    expect(screen.getByText('A coffee')).toBeTruthy();
    expect(screen.getByText('A burger')).toBeTruthy();
    expect(screen.getByText('A nice dinner')).toBeTruthy();
  });

  it('lays the tiers out across the card while the prices are short', async () => {
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);

    const tiers = await screen.findByTestId('tip-jar-tiers');
    expect(tiers.props.style).toMatchObject({ flexDirection: 'row' });
  });

  it('stacks the tiers once a storefront’s prices are too long to sit side by side', async () => {
    // The owner's report: in EGP the number wrapped inside each button. Three across cannot hold
    // "EGP 149.99" at any phone width, so the cards become full-width rows instead — the price
    // stays whole, at full size, which matters more than the compact shape.
    const { service, ledger } = configured(
      [
        fakeTipProduct(TIP_PRODUCT_IDS.small, 49.99, 'EGP 49.99'),
        fakeTipProduct(TIP_PRODUCT_IDS.medium, 99.99, 'EGP 99.99'),
        fakeTipProduct(TIP_PRODUCT_IDS.large, 149.99, 'EGP 149.99'),
      ],
      [TIP_PRODUCT_IDS.small, TIP_PRODUCT_IDS.medium, TIP_PRODUCT_IDS.large]
    );

    await render(<TipJar service={service} ledger={ledger} />);

    const tiers = await screen.findByTestId('tip-jar-tiers');
    expect(tiers.props.style).not.toMatchObject({ flexDirection: 'row' });
    // Every price is still on screen in full, and still paired with its own words.
    expect(screen.getByText('EGP 149.99')).toBeTruthy();
    expect(screen.getByText('A nice dinner')).toBeTruthy();
  });

  it('stacks the tiers at large Dynamic Type, where even a short price stops fitting', async () => {
    // Apple's *Larger Text* bar is 200%, and its VoiceOver/Larger-Text criteria name the purchase
    // flow explicitly. Three across holds about seven characters at the default text size and
    // three and a half at 2× — so `$4.99` breaks and the word under it truncates. The component
    // already owns the right answer for a price that will not fit; this makes it reach for it.
    setFontScale(2);
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);

    const tiers = await screen.findByTestId('tip-jar-tiers');
    expect(tiers.props.style).not.toMatchObject({ flexDirection: 'row' });
    // The prices and their words all survive the change of shape, whole and unabbreviated.
    expect(screen.getByText('$1.99')).toBeTruthy();
    expect(screen.getByText('$4.99')).toBeTruthy();
    expect(screen.getByText('$9.99')).toBeTruthy();
    expect(screen.getByText('A nice dinner')).toBeTruthy();
  });

  it('captions a product it has no copy for rather than dropping it', async () => {
    const { service, ledger } = configured(
      [
        fakeTipProduct(TIP_PRODUCT_IDS.small, 1.99, '$1.99'),
        fakeTipProduct('tip_enormous', 24.99, '$24.99'),
      ],
      [TIP_PRODUCT_IDS.small, 'tip_enormous']
    );

    await render(<TipJar service={service} ledger={ledger} />);

    expect(await screen.findByTestId('tip-jar-tier-tip_enormous')).toBeTruthy();
    expect(screen.getByText('A tip')).toBeTruthy();
  });

  it('says the no-ads line beside the jar, and can be told not to repeat it', async () => {
    const { service, ledger } = configured();

    const view = await render(<TipJar service={service} ledger={ledger} />);
    expect(await screen.findByTestId('tip-jar-no-ads')).toBeTruthy();
    expect(screen.getByText('This app has no ads and never will.')).toBeTruthy();

    await view.rerender(<TipJar service={service} ledger={ledger} showNoAds={false} />);
    expect(screen.queryByTestId('tip-jar-no-ads')).toBeNull();
  });

  it('is honest that a tip cannot be restored', async () => {
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);

    expect(await screen.findByText(/cannot be restored on another phone/)).toBeTruthy();
  });

  it('announces each tier with its price, for a screen reader', async () => {
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);

    const tier = await screen.findByTestId('tip-jar-tier-medium');
    expect(tier.props.accessibilityLabel).toBe('Leave a tip: A burger, $4.99');
    expect(tier.props.accessibilityRole).toBe('button');
  });
});

describe('leaving a tip', () => {
  it('thanks the user and writes the tip into the local ledger', async () => {
    const { adapter, service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);
    await fireEvent.press(await screen.findByTestId('tip-jar-tier-medium'));

    expect(await screen.findByTestId('tip-jar-thanks')).toBeTruthy();
    expect(screen.getByText('Thank you.')).toBeTruthy();
    // Nobody upstream remembers a consumable, so the count has to be ours.
    expect(ledger.read()).toEqual({
      tipCount: 1,
      lastTipAt: 1_700_000_000_000,
      promptDismissed: false,
    });
    expect(screen.getByText('You have left 1 tip.')).toBeTruthy();
    expect(adapter.purchased[0].identifier).toBe(TIP_PRODUCT_IDS.medium);
  });

  it('speaks the outcome, because the store sheet took the screen and gave it back', async () => {
    // Apple's VoiceOver criterion names the purchase flow specifically. The thank-you is marked as
    // a live region, which does nothing on iOS — so without this the tip completed in silence, and
    // a cancellation and a success were indistinguishable to a blind user. A cancellation stays
    // silent here exactly as it stays silent on screen.
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    announce.mockClear();
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);
    await fireEvent.press(await screen.findByTestId('tip-jar-tier-small'));
    await screen.findByTestId('tip-jar-thanks');

    expect(announce).toHaveBeenCalledWith('Thank you.');
  });

  it('stays as silent as the screen does when the user backs out', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    announce.mockClear();
    const { adapter, service, ledger } = configured();
    adapter.setOutcome({ kind: 'cancelled' });

    await render(<TipJar service={service} ledger={ledger} />);
    await fireEvent.press(await screen.findByTestId('tip-jar-tier-small'));
    await screen.findByTestId('tip-jar-tiers');

    expect(announce).not.toHaveBeenCalled();
  });

  it('closes the session to review prompting (D29), but only on a completed tip', async () => {
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);
    expect(hasSessionMoment('tipPrompt')).toBe(false);

    await fireEvent.press(await screen.findByTestId('tip-jar-tier-small'));
    await screen.findByTestId('tip-jar-thanks');

    // `hooks/useReviewPrompt` reads exactly this into `ReviewMoment.alreadyGaveThisSession`.
    // Without it, somebody could pay the developer and be asked for stars minutes later.
    expect(hasSessionMoment('tipPrompt')).toBe(true);
  });

  it('records nothing when the user backs out of the store sheet', async () => {
    const { adapter, service, ledger } = configured();
    adapter.setOutcome({ kind: 'cancelled' });

    await render(<TipJar service={service} ledger={ledger} />);
    await fireEvent.press(await screen.findByTestId('tip-jar-tier-small'));
    await screen.findByTestId('tip-jar-tiers');

    // A cancelled sheet cost the user nothing, so it must not cost them a review prompt either.
    expect(hasSessionMoment('tipPrompt')).toBe(false);
  });

  it('says nothing at all when the user cancels', async () => {
    const { adapter, service, ledger } = configured();
    adapter.setOutcome({ kind: 'cancelled' });

    await render(<TipJar service={service} ledger={ledger} />);
    await fireEvent.press(await screen.findByTestId('tip-jar-tier-small'));

    // Back exactly where they were: tiers still up, no thank-you, and above all no error.
    expect(await screen.findByTestId('tip-jar-tiers')).toBeTruthy();
    expect(screen.queryByTestId('tip-jar-thanks')).toBeNull();
    expect(screen.queryByTestId('tip-jar-failed')).toBeNull();
    expect(ledger.read().tipCount).toBe(0);
  });

  it('says what happened when the purchase genuinely fails, and that nothing was charged', async () => {
    const { service, ledger } = configured();
    // A store outage, not a change of mind.
    jest.spyOn(service, 'tip').mockResolvedValue({ kind: 'failed' });

    await render(<TipJar service={service} ledger={ledger} />);
    await fireEvent.press(await screen.findByTestId('tip-jar-tier-small'));

    expect(await screen.findByTestId('tip-jar-failed')).toBeTruthy();
    expect(screen.getByText('That did not go through. Nothing was charged.')).toBeTruthy();
    expect(screen.queryByTestId('tip-jar-thanks')).toBeNull();
    expect(ledger.read().tipCount).toBe(0);
  });

  it('marks someone who has tipped before as a supporter, and still lets them tip again', async () => {
    const { service, ledger } = configured();
    ledger.recordTip();

    await render(<TipJar service={service} ledger={ledger} />);

    expect(await screen.findByTestId('tip-jar-supporter')).toBeTruthy();
    expect(screen.getByText('Supporter')).toBeTruthy();
    // Consumables are repeatable on purpose: the tiers are still there.
    expect(screen.getByTestId('tip-jar-tiers')).toBeTruthy();
  });
});

/**
 * Three different ways for tipping to be absent, which are easy to conflate and behave
 * differently. Only the first is what Jest sees by default, so all three are written out.
 */
describe('the three absence cases', () => {
  it('no key and no native module (Jest, and the app as it ships today): renders nothing', async () => {
    const adapter = createFakePurchasesAdapter();
    adapter.setAvailable(false);
    const service = createTipJarService({ adapter, apiKey: null });

    await render(<TipJar service={service} ledger={createTipLedgerStore(createMemoryTipStorage())} />);

    expect(screen.queryByTestId('tip-jar')).toBeNull();
    expect(screen.queryByTestId('tip-jar-unavailable')).toBeNull();
  });

  it('a key but no native module (the dev client on the simulator): one quiet line, no crash', async () => {
    // The real adapter over a `require` that throws — exactly what a client without the pod
    // compiled in produces. Nothing is faked between the component and the missing module.
    const service = createTipJarService({ apiKey: 'appl_test_key' });

    await render(<TipJar service={service} ledger={createTipLedgerStore(createMemoryTipStorage())} />);

    expect(await screen.findByTestId('tip-jar-unavailable')).toBeTruthy();
    expect(screen.getByText('Tipping is not available on this device right now.')).toBeTruthy();
    expect(screen.queryByTestId('tip-jar-tiers')).toBeNull();
  });

  it('the native module but no key (a store build before switch-on): renders nothing, and never touches the module', async () => {
    const adapter = createFakePurchasesAdapter();
    const isAvailable = jest.spyOn(adapter, 'isAvailable');
    const products = jest.spyOn(adapter, 'products');
    const ledger = createTipLedgerStore(createMemoryTipStorage());
    const read = jest.spyOn(ledger, 'read');

    await render(<TipJar service={createTipJarService({ adapter, apiKey: null })} ledger={ledger} />);

    expect(screen.queryByTestId('tip-jar')).toBeNull();
    expect(isAvailable).not.toHaveBeenCalled();
    expect(products).not.toHaveBeenCalled();
    // Not even the local ledger: an unconfigured jar is indistinguishable from an unwritten one.
    expect(read).not.toHaveBeenCalled();
  });
});

describe('the two surfaces it is rendered from', () => {
  /**
   * The jar is invisible until a key exists, which means a screen test cannot notice if someone
   * deletes it from a screen — the screens would keep passing. This reads the two files instead.
   */
  it.each([
    ['Settings → Support', 'app/(tabs)/settings.tsx'],
    ['About', 'app/settings/about.tsx'],
  ])('%s renders it', (_label, file) => {
    const source = readFileSync(join(__dirname, '..', '..', file), 'utf8');
    expect(source).toContain('<TipJar');
  });

  it('does not repeat the no-ads line where PledgeCard already says it', () => {
    const settings = readFileSync(join(__dirname, '..', '..', 'app/(tabs)/settings.tsx'), 'utf8');
    expect(settings).toMatch(/<TipJar[^>]*showNoAds=\{false\}/);
  });
});

describe('the tier layout rule', () => {
  const SHORT = ['$1.99', '$4.99', '$9.99'];
  const LONG = ['EGP 49.99', 'EGP 99.99', 'EGP 149.99'];

  it('puts short prices across the card at the default text size', () => {
    expect(tipTierLayout(SHORT)).toBe('row');
    expect(tipTierLayout(SHORT, 1)).toBe('row');
  });

  it('stacks a price that cannot fit three across at any text size', () => {
    expect(tipTierLayout(LONG)).toBe('stack');
    expect(tipTierLayout(LONG, 1)).toBe('stack');
    expect(tipTierLayout(LONG, 2)).toBe('stack');
  });

  it('stacks short prices too, once the type is large enough to burst the card', () => {
    // The seven-character budget shrinks in proportion to the type: at 1.5× it holds four
    // characters and "$1.99" is five. Apple's 200% bar is comfortably past the crossing point.
    expect(tipTierLayout(SHORT, 1.5)).toBe('stack');
    expect(tipTierLayout(SHORT, 2)).toBe('stack');
  });

  it('never reads a shrunk text size as licence to cram more in', () => {
    // A scale below 1 (the smallest accessibility sizes) must not widen the budget past the
    // width the cards actually have — the constraint is the card, not the glyphs.
    expect(tipTierLayout(LONG, 0.5)).toBe('stack');
    expect(tipTierLayout(SHORT, 0.5)).toBe('row');
  });
});

describe('in Arabic', () => {
  it('offers a gratuity, never the charity word', async () => {
    await initI18n().changeLanguage('ar');
    const { service, ledger } = configured();

    await render(<TipJar service={service} ledger={ledger} />);

    expect(await screen.findByTestId('tip-jar-tiers')).toBeTruthy();
    const tier = screen.getByTestId('tip-jar-tier-small');
    expect(tier.props.accessibilityLabel).toContain('إكرامية');
    expect(tier.props.accessibilityLabel).not.toMatch(/تبرّ?ع|صدق[ةه]|زكا[ةه]/);
  });
});
