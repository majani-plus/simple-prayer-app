# Tip jar — switch-on runbook

Everything in the app is written and tested. Nothing is visible, and nothing can be, until the
owner creates the products and pastes one key per platform. This is that procedure, in order.

The feature is **inert by construction**: with no RevenueCat public key, `TipJar` renders `null`,
the Settings → Support group and the About screen look exactly as they did before it existed, and
no native module is ever touched. There is no "coming soon" state to remove.

---

## 0. The one rule that outranks everything else

Apple guideline **3.2.2(iv)** rejects apps collecting *charitable* contributions through in-app
purchase. Guideline **3.1.1** explicitly *permits* tipping the developer. They are the same
transaction; only the words differ.

So, everywhere a human will type text into a store console — product display names, descriptions,
localizations, review notes, the "What's New" text, the listing itself:

> **Say:** tip, leave a tip, support the app, buy the developer a coffee.
> **Never say:** donate, donation, charity, sadaqah, zakat, bağış, تبرع, صدقة, زكاة.

The in-app copy is already guarded — `src/i18n/__tests__/tipCopy.test.ts` fails the build if any of
those words appears in any locale file or in the product identifiers. **Store Connect and Play
Console are not covered by that test**, so this rule has to be carried by hand into both consoles.
Arabic uses **إكرامية** (a gratuity) and Turkish uses **bahşiş**, for exactly this reason; keep
those words in any store localization too.

---

## 1. App Store Connect (iOS)

1. My Apps → *Simple Prayer* → **Monetization → In-App Purchases**.
2. Create **three Consumable** products. Not non-consumable, not auto-renewable — a tip must be
   repeatable and grants nothing.

   | Product ID | Reference name | Suggested price tier |
   | --- | --- | --- |
   | `tip_small` | Small tip | ≈ $1.99 |
   | `tip_medium` | Medium tip | ≈ $4.99 |
   | `tip_large` | Large tip | ≈ $9.99 |

   The identifiers are fixed by `TIP_PRODUCT_IDS` in `src/services/purchases.ts`, and they are
   the contract (D57): the app asks the store for exactly these three ids, so a product created
   under any other identifier simply never comes back and its tier does not exist. The same three
   ids are used on iOS, Android and RevenueCat's test store.
3. Display name and description per product, in English, Arabic and Turkish. Wording, e.g.:
   *"A tip for the developer — a coffee."* / *"إكرامية للمطوّر — فنجان قهوة."* /
   *"Geliştiriciye bir bahşiş — bir kahve."*
4. Set prices per storefront. **Do not let Apple's automatic conversion set TRY** — a converted USD
   price is routinely absurd in Turkish lira, and Türkiye is a primary market for this app
   (our market research). Pick TRY prices by hand.
5. Provide a screenshot and review notes for each product. Review notes are a good place to say, in
   one sentence, that these are optional tips to the developer and unlock nothing.
6. App Store Connect → **Users and Access → Integrations → In-App Purchase** → generate a key and
   download the `.p8`; RevenueCat needs it to validate receipts.

## 2. Google Play Console (Android)

1. Monetize → Products → **In-app products** → create the same three ids as **Consumable**
   (Play calls it a one-time product that is consumed; the SDK consumes it for us).
2. Same three localizations, same wording rule, same manual TRY pricing.
3. Play requires Play Billing for developer tips — the peer-to-peer exemption does not apply to the
   app's own developer, so this must be an in-app product and not an external link.
4. Grant RevenueCat access: Play Console → Users and permissions → invite the RevenueCat service
   account, and connect the Google Cloud project as RevenueCat's setup guide describes.

## 3. RevenueCat

1. Create the project, and an **app** for each platform (iOS bundle id and Android package are both
   `app.simpleprayer`).
2. Upload the App Store `.p8` in-app-purchase key; connect the Play service account.
3. **Products** → import the three product ids from each store. (The app fetches the products
   from the store directly by identifier, so this import is for RevenueCat's dashboard and
   receipt-validation bookkeeping, not something the app reads at runtime.)
4. **Entitlements** → create **none**. Consumables grant nothing; attaching an entitlement to a tip
   is how an app ends up owing someone a feature it never built.
5. **No Offering, no Paywall** (D57). The owner's call: RevenueCat's paywall does not fit a
   consumable tip flow, so the app renders its own selector and asks the SDK for the three fixed
   product ids (`getProducts`), buying the chosen one directly (`purchaseStoreProduct`). Nothing
   to configure here. What that trades away: *prices* can still be retuned per storefront in the
   store consoles at any time with no release (the app renders whatever `priceString` the store
   answers), but adding or removing a *tier* now takes an app update — a new product id, a
   `TIP_PRODUCT_IDS` entry and a `settings.tip.tier.*` string in all three languages.
6. Copy the two **public SDK keys** (they start `appl_` and `goog_`). Public SDK keys are
   publishable — they are designed to ship inside the binary. Do not use a secret key here.

## 4. Turn it on in the app

Paste the keys into `app.json`:

```json
"extra": {
  "revenueCat": {
    "ios": "appl_xxxxxxxxxxxxxxxxxxxxxxxx",
    "android": "goog_xxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

Or, for a build that must not rewrite `app.json`, set `EXPO_PUBLIC_REVENUECAT_KEY_IOS` /
`EXPO_PUBLIC_REVENUECAT_KEY_ANDROID` in the environment (or as EAS environment variables).
`app.json` wins when both are present.

Then **rebuild the native app**. `react-native-purchases` is a native module: the tip jar stays in
its "not available on this device" state in any client that does not contain it — including the dev
client currently installed on the simulator. A key alone is not enough; an EAS Update cannot add a
native module.

The order is deliberate — key last. Until the products exist and are approved, a configured key
would fetch an empty product list, which the app shows as "Tipping is not available on this device
right now." That is honest but pointless: leave the key out and the whole surface stays absent.
(A product still waiting for review is handled gracefully: the store returns the subset it
recognises and the jar renders two tiers instead of three.)

### 4b. The privacy copy changes in the SAME release as the key

Pasting the key is the only change in this repo that turns a true sentence false without touching
a string. `react-native-purchases` is a client for **RevenueCat's servers**: a purchase sends the
receipt, an anonymous app-user id and device metadata to a third party. So the pledge's
"the one thing that ever leaves it is the city lookup" (`settings.pledge.footnote`, all three
languages) has to name the purchase path too, and `src/__tests__/privacyClaims.test.ts` →
*"the pledge and the tip jar"* fails the build until it does. Also review, in the same pass:

- `settings.pledge.points.tracking` ("No analytics, no trackers") — RevenueCat markets itself as
  purchase *analytics*. The line is defensible only if it is read as "nothing reports on you";
  decide deliberately rather than by omission.
- `docs/STORE_LISTINGS.md` — the App Privacy nutrition label stops being "Data Not Collected" and
  the Play Data safety form gains Purchase history (collected **and shared**). Both are noted
  inline there.

## 5. Verify

- iOS: a **sandbox** Apple ID (Users and Access → Sandbox Testers) on a device, then Settings →
  Support and About. Tiers should show *sandbox* prices in the tester's storefront currency.
- Android: an internal-testing track release and a licence-tested account.
- Check all three languages, and check Turkish and Arabic prices specifically.
- Cancel a purchase once and confirm the UI says **nothing**. That silence is a feature.
- Tip twice and confirm it is allowed and the count reaches 2 — consumables must be repeatable.

---

## Decisions baked into the code

**No non-consumable "Supporter" product.** PRODUCT_SPEC §14 allows one, and it was skipped. Buying
it would mean a second product type, an entitlement to hang it on, a restore flow, and a restore
button in the UI — in exchange for the badge surviving a reinstall. Instead the marker is derived
from the local ledger (`src/stores/tipLedger.ts`): tip once and the jar shows "Supporter" and the
lifetime count. It does not survive a reinstall or move to a new phone, and the UI says so
(`settings.tip.oneOff`) rather than implying a promise the store will not keep. Should this ever be
wanted, it is one non-consumable product, one entitlement, and a `restorePurchases()` call.

**No balance is tracked upstream.** RevenueCat does not count consumables, so `tipCount` in the
local ledger is the only record that a tip happened. It is MMKV, on the device, never synced.

**The jar is a destination, not an interruption.** Settings → Support and About render it; nothing
pops it up. If a proactive card is ever added (§14 permits one after a genuine value moment), it
must go through `canOfferTipPrompt()` in `src/services/supportMoments.ts`, which enforces D29:
never in the same session as a review prompt, never before the app has demonstrably been useful,
never again once dismissed, and never to someone who has already tipped. The review-prompt code
must call `noteSessionMoment('reviewPrompt')` when it fires the native sheet for that gate to work.

## Where the code is

| File | What it owns |
| --- | --- |
| `src/services/purchases.ts` | Product ids (the fixed three, D57), the API key, the lazy RevenueCat adapter (`getProducts` + `purchaseStoreProduct`), the three purchase outcomes |
| `src/services/supportMoments.ts` | D29's "never in the same session as a review prompt" referee — both directions: a completed tip blocks review prompting for the rest of the session (`ReviewMoment.alreadyGaveThisSession`), and a fired review sheet blocks any future proactive tip card |
| `src/stores/tipLedger.ts` | The local lifetime tip count and the dismissal flag (MMKV) |
| `src/components/TipJar.tsx` | The jar: tiers, thank-you, unavailable state, supporter marker |
| `src/i18n/__tests__/tipCopy.test.ts` | The word guard — no charity wording in any locale or identifier |
