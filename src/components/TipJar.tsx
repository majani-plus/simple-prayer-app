import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { useAnnounceChange } from '@/hooks/useAnnounceChange';
import { getTipJarService, type TipJarService, type TipJarState, type TipTier } from '@/services/purchases';
import { noteSessionMoment } from '@/services/supportMoments';
import { getTipLedger, type TipLedger, type TipLedgerStore } from '@/stores/tipLedger';
import { arabicTypeScale, radius, spacing, useTheme } from '@/theme';

import type { ReactNode } from 'react';

/**
 * The tip jar (PRODUCT_SPEC §14, decision D29).
 *
 * ## The copy is the feature
 *
 * Apple rejects apps that collect *charitable* contributions through in-app purchase
 * (guideline 3.2.2(iv)) and explicitly permits tipping the **developer** (3.1.1). Those are the
 * same transaction; only the words differ. So every string this component renders says "tip", and
 * the headline is the phrase Apple's own guideline uses — "buy the developer a coffee". The words
 * "donate", "donation", "charity", "sadaqah", "zakat", "bağış" and "تبرع" appear nowhere in this
 * component, in the product identifiers (`services/purchases.ts`), or in any locale file, and
 * `src/i18n/__tests__/tipCopy.test.ts` fails the build if one ever does. That test is deliberately
 * cheaper than a rejection.
 *
 * The Arabic and Turkish copy is where this is easiest to get wrong, because the obvious word in
 * both languages is the charity one. Arabic uses **إكرامية** (*ikrāmiyya*, a gratuity — what you
 * leave a waiter, never what you give in charity) and Turkish uses **bahşiş**, for the same
 * reason. Neither language goes anywhere near صدقة / زكاة / zekât / bağış, and the coffee metaphor
 * carries the rest.
 *
 * ## What it will and will not promise
 *
 * - **Consumable, repeatable, unrestorable.** Tips grant nothing, so there is no entitlement and
 *   no restore; `settings.tip.oneOff` says exactly that instead of letting someone find out on a
 *   new phone. The lifetime count is local (`stores/tipLedger.ts`) and the "Supporter" marker is
 *   simply "you have tipped before" — there is no non-consumable badge product (the trade is
 *   explained in `docs/TIP_JAR_RUNBOOK.md`).
 * - **A cancellation is silent.** Someone who opened the store sheet and changed their mind has
 *   not made a mistake and is not shown an error. Only a genuine failure speaks, and it says the
 *   one thing that person actually wants to know: nothing was charged.
 * - **Absent until it exists.** With no RevenueCat key configured — which is the state today —
 *   this renders `null`. Not a disabled row, not a "coming soon": nothing. The feature appears the
 *   day a key is dropped into `app.json`, and until then the Settings and About screens look
 *   exactly as they did before it was written.
 * - **It never crashes a screen.** `react-native-purchases` is a native module that is missing
 *   from Jest, from Expo Go and from the current dev client. The service degrades that to
 *   `status: 'unavailable'` and this renders one quiet sentence.
 *
 * ## Placement
 *
 * Rendered in two places, hence `framed` — the same shape `PledgeCard` uses: as its own card on
 * the About screen, and unframed as a row inside Settings → Support, where the group already
 * draws the card and the pledge card immediately above it is already saying "No ads, ever" (so
 * that placement passes `showNoAds={false}` rather than saying it twice).
 *
 * This component is a *destination*, never an interruption: D29's "never in the same session as a
 * review prompt" governs an unprompted card, and the referee for that lives in
 * `services/supportMoments.ts`. A jar the user navigated to is an answer, not an ask — so
 * *rendering* it is not gated. A completed tip is: it calls `noteSessionMoment('tipPrompt')`, and
 * `hooks/useReviewPrompt` refuses to ask for a review for the rest of that session.
 */

/**
 * The longest price string three side-by-side cards can hold without the number itself wrapping.
 *
 * Three across leaves roughly 80pt of text width on a 6.1" phone; at the price's type size that is
 * about seven characters. `$4.99` and `₺149,99` fit; `EGP 149.99` and `SAR 19.99` do not — and a
 * price broken across two lines mid-number is the one thing a payment control must never do.
 */
const ROW_PRICE_LIMIT = 7;

/**
 * Picks the tier layout from the prices the store actually returned, and the size the text is
 * actually set at.
 *
 * Deliberately decided from the strings rather than from a measured layout: the store's
 * `priceString` is known before the first paint, so the cards land in their final shape with no
 * reflow, and the choice is the same on every device of a given storefront. Shrinking the type
 * was the alternative and was rejected — the audience skews older, and an unreadable price is a
 * worse failure than a taller card.
 *
 * **Which is exactly why `scale` exists.** The seven-character budget is measured at the system's
 * default text size. Turn Dynamic Type up and the budget shrinks in proportion — at Apple's 200%
 * bar three across holds three and a half characters, so `$4.99` breaks and the label under it
 * truncates. This is Apple's *Larger Text* criterion and it lands on the purchase flow, which the
 * criterion names explicitly. The answer is the layout the component already has: the same
 * full-width rows that long prices get. Nothing new is designed, nothing is shrunk, and at the
 * default text size the arithmetic is unchanged, so the card is pixel-identical to before.
 *
 * @param priceStrings - The localized price of each tier, as the store formatted it.
 * @param scale - Multiplier the price text is actually rendered at: the OS font scale, times the
 *   Arabic optical scale where that applies. Defaults to `1`, the untouched system size.
 * @returns `'row'` for three across, `'stack'` for three full-width rows.
 */
export function tipTierLayout(priceStrings: readonly string[], scale = 1): 'row' | 'stack' {
  const budget = ROW_PRICE_LIMIT / Math.max(scale, 1);
  return priceStrings.some((price) => price.trim().length > budget) ? 'stack' : 'row';
}

/** How the paid-for state is presented, and what the user is allowed to do next. */
type Phase =
  /** Tiers on screen, waiting. */
  | { kind: 'idle' }
  /** A store sheet is up for this tier; every button is inert until it closes. */
  | { kind: 'busy'; tierId: string }
  /** The purchase went through. The quiet thank-you, for the rest of this visit. */
  | { kind: 'thanks' }
  /** Something genuinely went wrong — never a cancellation. */
  | { kind: 'failed' };

export interface TipJarProps {
  /**
   * Draws the paper card around the content. Defaults to `true`; pass `false` when the parent
   * (a `SettingGroup`) is already a card.
   */
  framed?: boolean;
  /**
   * Shows the "no ads, ever" line §14 asks to sit beside the jar. Defaults to `true`; pass
   * `false` where `PledgeCard` is already adjacent and would say it twice.
   */
  showNoAds?: boolean;
  /** Overridden by tests; defaults to the app-wide RevenueCat-backed service. */
  service?: TipJarService;
  /** Overridden by tests; defaults to the app-wide MMKV-backed ledger. */
  ledger?: TipLedgerStore;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The tip jar.
 *
 * @param framed - Whether to draw the card (default `true`).
 * @param showNoAds - Whether to render the no-ads line (default `true`).
 * @returns The tiers, the thank-you, one quiet unavailable line — or `null` when tipping is not
 * configured for this build, which is the current state of the world.
 */
export function TipJar({
  framed = true,
  showNoAds = true,
  service,
  ledger,
  style,
  testID = 'tip-jar',
}: TipJarProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();

  // Resolved once: both singletons touch a native module on first use, so they must not be
  // constructed during a render that might never commit.
  const jar = useMemo(() => service ?? getTipJarService(), [service]);
  const book = useMemo(() => ledger ?? getTipLedger(), [ledger]);

  // Read synchronously, because it decides whether this component exists at all. Nothing else is
  // touched for a build with no key — not even the local ledger: an unconfigured tip jar must be
  // indistinguishable from one that was never written.
  const configured = jar.configured;

  const [state, setState] = useState<TipJarState | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // The ledger is a synchronous MMKV read, so it is taken once as the initial state rather than in
  // an effect — the count is on screen in the first paint, with no flash of "not a supporter".
  const [record, setRecord] = useState<TipLedger | null>(() => (configured ? book.read() : null));

  useEffect(() => {
    if (!configured) return;
    let live = true;
    void jar.load().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [configured, jar]);

  const leaveTip = useCallback(
    async (tier: TipTier) => {
      setPhase({ kind: 'busy', tierId: tier.id });
      const outcome = await jar.tip(tier);
      if (outcome.kind === 'purchased') {
        // D29's other half. `services/supportMoments` already stops a proactive tip card
        // appearing after a review sheet; this is the reverse, and it is the direction that
        // actually happens today — the jar is a destination the user can reach at any time, and
        // asking somebody for stars minutes after they paid the developer is exactly the "this
        // app wants something" moment the whole positioning is against. Recorded only on a
        // completed purchase: a cancelled sheet cost the user nothing and gates nothing.
        noteSessionMoment('tipPrompt');
        setRecord(book.recordTip());
        setPhase({ kind: 'thanks' });
        return;
      }
      // A cancellation returns to exactly the state the user left: no message, no highlight,
      // nothing that reads as "are you sure?".
      setPhase(outcome.kind === 'cancelled' ? { kind: 'idle' } : { kind: 'failed' });
    },
    [book, jar]
  );

  // The store sheet takes the screen and hands it back, and what happened is written in a line
  // that was not there before — which VoiceOver has no reason to be looking at. Apple's VoiceOver
  // criterion names the purchase flow specifically, so the outcome is spoken rather than merely
  // rendered. Cancelling stays silent, exactly as it stays silent on screen.
  useAnnounceChange(
    phase.kind === 'thanks'
      ? t('settings.tip.thanks.title')
      : phase.kind === 'failed'
        ? t('settings.tip.failed')
        : null
  );

  // The price cards' layout has to know how big the type actually is, not how big it was designed
  // to be; see `tipTierLayout`. Arabic carries its own optical scale on top of the OS one.
  const priceScale = fontScale * (i18n.language.startsWith('ar') ? arabicTypeScale : 1);

  if (!configured || state === null || state.status === 'disabled') return null;

  const title = t('settings.tip.title');
  const noAds = showNoAds ? (
    <AppText testID={`${testID}-no-ads`} variant="caption" tone="muted">
      {t('settings.tip.noAds')}
    </AppText>
  ) : null;

  let content: ReactNode;

  if (phase.kind === 'thanks') {
    // Sincere and short. No confetti, no badge animation, no "share this" — the design's quietest
    // register, which is the only one that reads as meant.
    content = (
      <View testID={`${testID}-thanks`} accessibilityLiveRegion="polite" style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="favorite" size={16} color={colors.accent} />
          <AppText variant="rowName" weight={600} tone="strong">
            {t('settings.tip.thanks.title')}
          </AppText>
        </View>
        <AppText variant="caption" tone="muted">
          {t('settings.tip.thanks.body')}
        </AppText>
        {record === null || record.tipCount === 0 ? null : (
          <AppText testID={`${testID}-count`} variant="hint">
            {t('settings.tip.count', { count: record.tipCount })}
          </AppText>
        )}
        {noAds}
      </View>
    );
  } else if (state.status === 'unavailable') {
    content = (
      <View style={{ gap: spacing.sm }}>
        <AppText variant="rowName" weight={600} tone="strong">
          {title}
        </AppText>
        <AppText testID={`${testID}-unavailable`} variant="caption" tone="muted">
          {t('settings.tip.unavailable')}
        </AppText>
        {noAds}
      </View>
    );
  } else {
    const busy = phase.kind === 'busy';
    const stacked =
      tipTierLayout(
        state.tiers.map((tier) => tier.priceString),
        priceScale
      ) === 'stack';
    content = (
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="rowName" weight={600} tone="strong" style={{ flex: 1 }}>
            {title}
          </AppText>
          {record !== null && record.tipCount > 0 ? (
            <View
              testID={`${testID}-supporter`}
              accessible
              accessibilityRole="text"
              accessibilityLabel={t('settings.tip.count', { count: record.tipCount })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingVertical: 3,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.borderMid,
                backgroundColor: colors.cardQuiet,
              }}
            >
              <Icon name="workspace_premium" size={13} color={colors.accent} />
              <AppText variant="hint" tone="accent" italic={false}>
                {t('settings.tip.supporter')}
              </AppText>
            </View>
          ) : null}
        </View>

        <AppText variant="caption" tone="muted">
          {t('settings.tip.body')}
        </AppText>

        {noAds}

        {/* Cheapest first. The store's own price string is the headline of each card — it is the
            only number that is correct in every currency, and it is what the person is actually
            deciding between, so it is never shrunk, truncated or re-formatted. Three across while
            the prices are short; three full-width rows once a storefront's prices are long (EGP,
            SAR, TRY…), which is the only way the number stays whole and legible. */}
        <View
          testID={`${testID}-tiers`}
          style={
            stacked
              ? { gap: spacing.sm, marginTop: spacing.xs }
              : { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }
          }
        >
          {state.tiers.map((tier) => {
            const label = t(`settings.tip.tier.${tier.tier ?? 'other'}`);
            const pending = phase.kind === 'busy' && phase.tierId === tier.id;
            return (
              <PressableScale
                key={tier.id}
                testID={`${testID}-tier-${tier.tier ?? tier.productId}`}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('settings.tip.a11yTier', {
                  label,
                  price: tier.priceString,
                })}
                accessibilityState={{ disabled: busy, busy: pending }}
                onPress={() => void leaveTip(tier)}
                style={{
                  ...(stacked
                    ? {
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: spacing.md,
                      }
                    : { flex: 1, alignItems: 'center', gap: 2 }),
                  paddingVertical: spacing.md,
                  paddingHorizontal: stacked ? spacing.lg : spacing.sm,
                  borderRadius: radius.card,
                  borderWidth: 1,
                  borderColor: pending ? colors.accent : colors.borderMid,
                  backgroundColor: pending ? colors.cardBright : colors.card,
                  opacity: busy && !pending ? 0.5 : 1,
                }}
              >
                {/* Stacked, the words lead and the number closes the row — the reading order of
                    a menu. Across, the number leads, because at that size it is the only thing
                    a glance takes in. */}
                {stacked ? (
                  <AppText
                    variant="rowName"
                    weight={500}
                    numberOfLines={2}
                    style={{ flexShrink: 1 }}
                  >
                    {label}
                  </AppText>
                ) : null}
                <AppText variant="rowName" weight={600} tone="strong" tabularNums>
                  {tier.priceString}
                </AppText>
                {stacked ? null : (
                  <AppText
                    variant="caption"
                    tone="muted"
                    numberOfLines={2}
                    style={{ textAlign: 'center' }}
                  >
                    {label}
                  </AppText>
                )}
              </PressableScale>
            );
          })}
        </View>

        {phase.kind === 'failed' ? (
          <AppText
            testID={`${testID}-failed`}
            variant="caption"
            color={colors.missed}
            accessibilityLiveRegion="polite"
          >
            {t('settings.tip.failed')}
          </AppText>
        ) : null}

        <AppText variant="hint">{t('settings.tip.oneOff')}</AppText>
      </View>
    );
  }

  if (!framed) {
    return (
      <View
        testID={testID}
        style={[{ paddingVertical: spacing.md, paddingHorizontal: spacing.lg }, style]}
      >
        {content}
      </View>
    );
  }

  return (
    <Card testID={testID} variant="quiet" border="faint" style={[{ padding: spacing.lg }, style]}>
      {content}
    </Card>
  );
}
