# Store Listings — ASO Kit (App Store + Google Play)

> **Paste-ready copy moved:** the full descriptions, What's New blocks and the face
> listing now live in `docs/STORE_DESCRIPTIONS.md` (rewritten 2026-08-28 — plainer voice,
> per-store platform accuracy). This file keeps the ASO reasoning, keywords and store forms.

Source of truth for all store metadata. Localized en/ar/tr (all three are release requirements).
Wording rules: never "donate/donation/charity/sadaqah/zakat/bağış/تبرع" anywhere (Apple 3.2.2(iv));
lead with the trust promise (free, no ads, private) — it is the category's #1 switching driver (our market research).
Finalize + screenshot production happens in M10; copy below is considered final-draft.

---

## Apple App Store

- **Name (≤30):** `Simple Prayer: Times & Qibla` (28) — owner's decision, 2026-08-20, resolving the conflict this file used to carry. `Simple Prayer & Tracker` was a mechanical-rename remnant that predated D47 and was never actually chosen.
- **Subtitle (≤30):** `Salah Tracker, Athan & Qada` (27) — per D47. Apple tokenises Name and Subtitle into one pool, so the pair is matchable on prayer times / qibla / salah tracker / athan / qada without repeating a word.
- **Keywords (≤100, no words duplicated from name/subtitle, comma-separated, no spaces):**
  `namaz,muslim,islam,fajr,adhan,azan,ramadan,hijri,vakit,islamic,pray,mosque,streak,masjid,quran`
- **Categories:** Primary Lifestyle · Secondary Utilities (revisit vs Reference at submission)
- **Promotional text (≤170, updatable without review):**
  `Every feature is free. No ads, no account, no tracking. Beautiful prayer times, gentle prayer tracking, accurate Qibla — your worship stays between you and Allah.` (162)
- **Description:**

→ `docs/STORE_DESCRIPTIONS.md` (English · App Store description)

- **What's New — 1.1 (en, App Store):**

→ `docs/STORE_DESCRIPTIONS.md` (English · What's New 1.1, both store variants)

  Play variant: swap the two iOS lines for "A Wear OS app, a tile, complications — and our own
  watch face, Manuscript" and "The optional always-on notification carries the 'I prayed'
  button". tr/ar What's New live in their own sections below.

- **Screenshots.** One size serves both stores: **6.5" (1242×2688)**, light theme primary, under
  `docs/screenshots/<locale>/light/6.5/` — 3 locales × 5 device captures, plus the composed
  store screens from `scripts/build-store-screens.py` in `docs/store-screens/` (the 6.7"/6.1"
  sets and the two extra slots the older text here described were deliberately deleted;
  `docs/screenshots/README.md` and `docs/STORE_SCREENS.md` are the authority). Watch captures
  live under `docs/screenshots/<locale>/watch/`. The 2026-08 release adds slots for the new
  surfaces — the current slot list and captions live in `docs/STORE_SCREENS.md`; the manual
  upload steps live in the internal notes.
- **Privacy policy URL:** `https://simpleprayer.app/privacy` — content is
  `docs/PRIVACY_POLICY.md`; hosting requirements are in `docs/WEBSITE.md`. **Support URL:**
  `https://simpleprayer.app`. Both must be live before submission.
- **Age rating:** 4+.

### App Privacy (nutrition label) — answers to enter, and why

The label is entered per data type in App Store Connect → App Privacy. Apple's definition of
*collect* is what decides every line: "transmitting data off the device in a manner that allows you
and/or your third-party partners to access it for a period longer than what is necessary to service
the transmitted request in real time." Of the things this app sends off the device, the city
lookup and the update check fail that test and are therefore **not** collection; crash reporting
passes it and is declared below; the tip jar's RevenueCat traffic also passes it, and is the
subject of the owner-decision subsection at the end of this section.

**Enter exactly this:**

| Category | Data type | Collected | Linked to the user | Purpose | Tracking |
|---|---|---|---|---|---|
| Diagnostics | **Crash Data** | Yes | **No** | App Functionality | No |
| Diagnostics | **Other Diagnostic Data** *(anonymous session markers — see below)* | Yes | **No** | App Functionality | No |
| Identifiers | **Device ID** *(buddy mode only — see below)* | Yes | **No** | App Functionality | No |
| Other Data | **Other Data** *(buddy mode only — the prayers you choose to send)* | Yes | **No** | App Functionality | No |

Concretely, everything else — Contact Info · Health & Fitness · Location · Sensitive Info ·
Contacts · User Content · Browsing History · Search History · Usage Data — and the remaining
Diagnostics type (Performance Data) and Identifiers type (User ID, Advertising Data) →
**not collected**.

**The two buddy-mode rows, and why they are declared even though the feature is off by default.**
Apple's definition of collection is transmission off the device, and it does not care that the
user opted in — an opt-in feature that transmits is still collection, and under-declaring is the
one mistake that gets a listing pulled. So:

- **Device ID** is the random identifier the relay issues to an installation (D175). It is not the
  IDFA, not the IDFV, not a hardware id and not derived from one; it is 128 random bits generated
  by our relay. **Not linked to the user** is honest: there is no name, email, account or any other
  identifier on the relay to link it to, and we could not resolve one to a person if asked.
- **Other Data** is the marks themselves — one flag per prayer, "prayed" or a retraction — held
  until the buddy's phone collects it or 24 hours, whichever comes first.
- **Health & Fitness stays "not collected"**, deliberately and after checking. Excused-period days
  are the health-adjacent data in this app, and buddy mode never transmits them: `markStateFor` in
  `src/domain/buddies.ts` returns nothing for an exempt day, and `domain/buddies.test.ts` pins
  that. If that ever changes, this row changes with it.
- **Used for tracking stays "No".** Nothing here is shared with a data broker or joined with data
  from other apps, and there is no advertising anywhere in this app. (Purchases /
Financial Info is the one category this blanket line deliberately does not cover — see the
owner-decision subsection below.) "Used for tracking" → **No**, everywhere; there is no IDFA, no
`NSUserTrackingUsageDescription`, no ad network and no data broker, so no ATT prompt is required.

Reasoning, so the owner can defend each answer rather than re-derive it:

- **Diagnostics → Crash Data is real collection.** Sentry (`@sentry/react-native`,
  `src/services/telemetry.ts`) receives and retains crash reports: stack trace, device model, OS
  version, app version. No breadcrumbs, no screenshots, no view hierarchy — `maxBreadcrumbs: 0`
  and a scrubbing `beforeSend`, pinned by `telemetry.test.ts`. Retention is beyond a real-time
  request, and a bundled SDK vendor's collection is the developer's to declare.
- **Diagnostics → Other Diagnostic Data is ALSO collected**, and honesty requires declaring it:
  `enableAutoSessionTracking: true` sends an anonymous session start/end marker (app version,
  device class) so a crash-free-sessions rate exists — that is diagnostic data received and
  retained even on launches with no crash. Same answers as Crash Data: Not Linked, App
  Functionality, no Tracking. If session tracking is ever turned off, this row (and Play's
  Diagnostics row) can be deleted.
- **Diagnostics → Performance Data is NOT collected**, because tracing is off (`tracesSampleRate`
  unset / 0, no profiling, no session replay). If anyone ever turns performance tracing on, this
  answer flips — revisit the label in the same PR.
- **Crash Data is Not Linked to the User.** `sendDefaultPii: false`, no `setUser`, no account, no
  email, no custom identifiers — Apple's test for "linked" is whether the data is connected to the
  user's identity, and this app has no user identity at all. Not used for Tracking either: "tracking"
  in Apple's sense means linking with third-party data for advertising or data brokerage. Sentry is
  our processor, not an ad network, and no advertising identifier exists in the binary.
- **The user can switch it off** (Settings toggle, ON by default). Apple's label has no "optional"
  field, so this appears only in our own copy — but it is why the honest declaration costs so
  little.
- **Location is not collected.** The coarse fix reaches Apple's `CLGeocoder` (or Google's Geocoder
  on Android) and comes back as a city name that stays on the phone. Apple's own system geocoder is
  not one of "your third-party partners", nothing is retained by us, and no server of ours exists.
  This is the *opposite* of the Play answer below, and deliberately so — the two stores define
  collection differently.
- **Health & Fitness is not collected.** Exempt-period days are health-adjacent data, and they are
  written to the on-device SQLite database only. Nothing transmits them. (Do not confuse "the app
  stores it" with "the app collects it" — Apple's label is about transmission.) The crash reporter
  cannot see the database either — it sends no breadcrumbs, no screenshots and no view hierarchy,
  so no screen content or user action ever rides along with a stack trace.

**The "Data Not Collected" badge is gone, and that was the price.** Until Sentry, this app
qualified for the App Store's "Data Not Collected" badge — a visible trust signal in a category
where privacy is the #1 switching driver (our market research). Declaring Crash Data, however
minimal, forfeits it. The owner chose crash visibility over the badge deliberately (DECISIONS.md
D51): a 1.0 with no crash reporting cannot hit the ≥99.5% crash-free bar or fix what it cannot see.
The label will read "Data Not Linked to You: Crash Data" — the second-best tier, still strong, and
every word of our own copy (pledge, policy, description) explains it honestly. Do not try to win
the badge back by under-declaring; the only honest way back is removing the DSN.

#### Purchase History — not declared

Owner decision, final: no Purchases row. Rationale and the facts it was weighed against are recorded once in DECISIONS.md **D52** — do not restate them here.

### Accessibility Nutrition Labels — what to tick, and what to leave blank

App Store Connect → your app → Accessibility. Apple's rule for every one of these: tick it only if a
person who relies on that feature can complete **all** of the app's common tasks with it. A generous
tick is a review risk and, worse, a broken promise to the person who most needed it to be true. The
per-feature criteria and their sources are in the internal notes.

| Feature | Tick? | Why / what it still needs |
|---|---|---|
| **Sufficient Contrast** | ✅ after re-verifying | Both palettes now clear 4.5:1 for text and 3:1 for state-carrying graphics on the surfaces they actually sit on, pinned by computed assertions in `tokens.test.ts` (D53, D56). Apple checks **both** modes; night paper always passed, light paper was the blocker. |
| **Differentiate Without Color Alone** | ✅ **— but for a different reason than we assumed** | A hard project rule since day one — every state carries an icon and a word, never a hue alone. The calendar ring was the open question, and it is now *simulated* rather than eyeballed (Viénot dichromacy, 2026-08-20): under protanopia *prayed* gold and *late* orange are *identical* (1.00:1), and **prayed vs missed is 1.02:1 for normal colour vision too** — same lightness, ~21° of hue apart. So the ring is a **count** for everyone, not a status readout; per-status detail is one tap away in DayDetail with icon and word. What the ring actually carries — logged vs the unlogged track — survives every simulation in both themes at 3.14–4.39:1. That is spec-accessibility §2.6 option (a), and **the DECISIONS.md entry it required was never written** — write it before relying on this row. |
| **Reduced Motion** | ✅ | The app contains none of Apple's enumerated vestibular classes (no parallax, spin, auto-advance), and every animation site now honours the OS flag through `useReduceMotion` (D54-era work). |
| **Dark Interface** | ✅ | Night paper qualifies via the "a mode the user can enable" path — system-following with a manual override, AA-pinned, dark splash and icon. Sweep once for bright flashes on launch and in modals before ticking. |
| **Larger Text** | ✅ verified on device at 200% | Apple's bar is 200%. **Verified by rendering the app on an iPhone 11 Pro Max simulator at `accessibility-medium` (34pt body = 200%)** — Today, Settings, History and Qibla in English, and Today and Settings in Turkish, which the audit measured as the worst case (its strings are longer than the English, not Arabic's). Two truncations were found this way that no test could have caught, because layout only happens on a device, and both are fixed: Settings' first row truncated to "Your locati…" (rows now stack their value under the label past 1.5x), and Today's header ran the streak off the right edge in Turkish, "0 günl…" (the header now wraps). Earlier fixes hold: tip-jar tiers stack, the hero countdown takes a second line, the calendar's month title and the qibla labels wrap, and the open seal derives its geometry from the type scale (D82). Default-size layout is unchanged, checked on device. **Not covered by this pass, in the interest of an honest row:** the open seal pill — this environment cannot deliver a touch to a simulator, so the state D82 fixed was verified by its geometry tests and not by eye; Arabic, which was reasoned about but not rendered; and sizes above 200% (at AX5, ~310%, the Today hero does overflow — beyond Apple's stated bar, but worth knowing). |
| **VoiceOver** | ⏳ after a device pass — **the code gaps are closed** | Labelling is genuinely strong — every pressable in the app carries a label and a role bar one, and that one is `accessible={false}` on purpose (the seal's dismiss overlay); all a11y strings are authored in en/ar/tr, not mirrored. But "no construction gaps" was **wrong**, twice. First: `accessibilityLiveRegion` is Android-only in React Native (`@platform android`, `ViewAccessibility.d.ts`), so all ten of the app's live regions were silent under VoiceOver — including the qibla alignment pill and the tip-jar outcome, and Apple's criteria name the purchase flow explicitly. Fixed in 37393e7 via `useAnnounceChange`. Second: the seal never spoke what it recorded — a pick announced only "Choices closed", and focus died with the button that vanished, so the app's core reward loop was silent. Fixed in D82: a pick speaks its outcome ("Maghrib marked as prayed", authored per language) instead of the closing line, and hands focus to the seal's own face. **Still do not tick it until someone drives the app blind on a device, in en, ar and tr** — specifically: first launch and the location-denied state, Today (seal picks in both modes, jamaah custom action), History (calendar, day detail, stats), Qibla, Settings, the qada wizard, and the tip jar. Nothing in this app's announcement or focus behaviour can be proven by a test: the assertions here mock `AccessibilityInfo`, which says the app asked for the right thing, not that VoiceOver did it. |
| **Voice Control** | ❌ | Never tested. Labels are intent-phrased ("Mark Maghrib as prayed"), which is fine for "Show numbers" but not necessarily for "Tap ‹name›". Leave blank until someone tests it. |
| **Captions** | ❌ | Owner decision: no adhan transcript. The adhan is standard and known throughout Islam, so a transcript adds nothing for the people who would read it. An honest blank. |
| **Audio Descriptions** | ❌ | There is no video, no cut scene, no time-based visual-only sequence. Ticking it would be decorative claim-stacking, which is exactly what Apple polices. An honest blank. |

**Google Play has no equivalent structured field.** Its accessibility surface is the pre-launch
report (automated, informational, never blocks a release — it checks a 48dp touch floor, which D55
now clears) and whatever the description says in prose. Any accessibility sentence added to the Play
description must be true of the shipped build and authored in Turkish and Arabic, not mirrored.

**Keep the website in step.** `website/` states accessibility claims in user language, and the same
honesty bar applies: it was already corrected once for claiming "the whole app works with VoiceOver"
before any device pass, and for quoting a 44pt touch floor that D55 had raised to 48.

## Google Play

- **Title (≤30):** `Simple Prayer: Times & Qibla` (28) — same as the App Store name, per the owner's 2026-08-20 decision.
- **Short description (≤80):** `Prayer times, azan, Qibla & a kind salah tracker. Every feature free. No ads.` (77)
- **Full description (≤4000):** reuse App Store description with these Play-ASO adjustments:
  keyword-relevant phrasing woven naturally ("prayer times", "salah tracker", "namaz vakitleri",
  "qibla finder", "athan/azan alarm", "muslim prayer app", "qada tracker", "ramadan", "hijri calendar")
  in headings and first 3 lines (Play indexes description text, Apple doesn't).
  **AND swap the everywhere section for the Android surfaces** — the iOS block names Lock
  Screen/StandBy/Live Activity/Apple Watch/iPad, which do not exist here. The Play version:

→ `docs/STORE_DESCRIPTIONS.md` (English · Play description)
- **Category:** Lifestyle. **Tags:** Prayer, Religion.
- **Privacy policy URL:** `https://simpleprayer.app/privacy` (content: `docs/PRIVACY_POLICY.md`).
  **Support email:** `hello@simpleprayer.app`, the general inbox (D205). It was
  `privacy@simpleprayer.app` until 2026-11-09; change it in Play Console (Store settings →
  Store listing contact details). Play sends a verification to it, so the mailbox must deliver.

### Data safety form — answers to enter, and why

Play's definitions differ from Apple's in two ways that change the answers, so do not copy the
nutrition label across. Play counts **any** transmission off the device as collection unless it
qualifies as *ephemeral processing* (used in memory only, retained no longer than needed to service
the request in real time), and it has a separate **service provider** carve-out that means
processing done *for* the developer under contract is collection but not *sharing*.

Declare exactly these data types; everything else in the form → **not collected, not shared**,
with one exception this blanket line deliberately does not cover: Financial info → Purchase
history, which is the owner-decision subsection below.

| Data type | Collected | Shared | Ephemeral | Required? | Purpose |
|---|---|---|---|---|---|
| Location → **Approximate location** | **Yes** | No | **Yes** | Optional | App functionality |
| App info and performance → **Crash logs** | **Yes** | No | No | **Optional** | Analytics |
| App info and performance → **Diagnostics** *(anonymous session markers)* | **Yes** | No | No | **Optional** | Analytics |
| Device or other IDs → **Device or other IDs** *(buddy mode only)* | **Yes** | No | No | **Optional** | App functionality |
| Personal info → **Other info** *(buddy mode only — the prayers you choose to send)* | **Yes** | No | No | **Optional** | App functionality |

#### The two buddy-mode rows (new with D174/D175)

Play counts **any** transmission off the device as collection, so buddy mode is declared even
though it is off until the user turns it on — hence **Optional** rather than Required on both rows.

- **Not ephemeral.** The relay holds a mark until the buddy's phone collects it, or 24 hours,
  whichever comes first. That is short, but it is not "used in memory only while servicing the
  request", so answering *Ephemeral: Yes* would be wrong. The approximate-location row above is the
  genuine ephemeral case; this is not it, and the difference is worth keeping straight.
- **Not shared.** The relay is ours, and Expo's push service is a processor delivering on our
  behalf — Play's service-provider carve-out, the same reasoning already applied to Sentry. Nothing
  reaches a data broker, an advertiser, or any other app.
- **Device or other IDs** is the random identifier the relay issues per installation. It is not the
  Android advertising id (the app has none) and is not derived from any hardware identifier.
- **Not Health and fitness.** Excused-period days never travel — `markStateFor` returns nothing for
  an exempt day, pinned by `src/domain/buddies.test.ts`. If that ever changes, this changes too.

App-level security section:

- *Is all user data encrypted in transit?* → **Yes** (HTTPS to the platform geocoder, to Sentry,
  to Play Billing / RevenueCat if a key ever ships, to the update service, and to the buddy relay —
  which refuses plaintext and sends HSTS).
- *Do you provide a way for users to request that their data be deleted?* → **Yes**, via
  `privacy@simpleprayer.app`, **and in the app**: turning buddy mode off in Settings deletes the
  installation's record and every pairing from the relay, which is an in-app deletion path Play
  likes to see. Play's separate **account-deletion** requirement still does not apply: the app has
  no accounts to create or delete, and buddy mode's identifier is issued by the relay rather than
  registered by the user. Everything the app stores is removed by uninstalling, crash reports
  delete themselves from Sentry after 90 days, and an abandoned pairing is dropped by the relay
  after 90 quiet days.
- *Does your app collect data from children?* → No. Target audience 13+ or all ages per the content
  rating; nothing collected differs by age, and nothing collected identifies anyone of any age.

#### The crash-logs answer (new with Sentry, 2026-08-19)

The form's category is **App info and performance → Crash logs** (some older console copies file it
under "Diagnostics" — it is the same declaration). Each field, and why:

- **Collected: Yes.** Sentry receives and retains crash reports (stack trace, device model, OS
  version, app version — no breadcrumbs, no screenshots, no view hierarchy) for 90 days. Retention
  means it is not ephemeral, so this is unambiguous collection under Play's definition.
- **Shared: No.** Sentry processes crash reports *on our behalf* — Play's service-provider
  carve-out, the same reasoning as RevenueCat below. No "Data shared" line appears on the store
  page.
- **Ephemeral: No** — 90-day retention is the whole point of a crash queue you can work through.
- **Optional: Yes — and say so.** This is both true and favourable: the Settings toggle (ON by
  default) genuinely stops collection, the app works identically without it, and Play renders
  "optional" on the label. This answer is only honest while the toggle exists; if the toggle is
  ever removed, flip this to Required in the same release.
- **Purpose: Analytics.** Counter-intuitive but correct: Play's own definition of the Analytics
  purpose explicitly includes "to diagnose and fix crashes". It does not mean marketing analytics,
  and choosing "App functionality" instead would misfile it against Play's published examples.
- **The Diagnostics row alongside it** covers the anonymous session start/end markers
  (`enableAutoSessionTracking: true` — app version and device class, sent so a crash-free-sessions
  rate exists). Same field answers as Crash logs, and the same Settings toggle stops both.
- **No other type comes with it**: no Device or other IDs (Sentry is not given an advertising ID or
  any custom identifier; `sendDefaultPii: false`), no App interactions, and no performance data
  (tracing is off).

#### The location answer — resolved (this was the flagged open question)

**Recommendation: declare Approximate location as collected, marked "processed ephemerally", not
shared, optional.** The owner should confirm this rather than research it. The reasoning:

1. **The transmission is real.** `resolveAutoLocation` takes a coarse fix and calls
   `reverseGeocodeAsync`, which on Android is `android.location.Geocoder` — a network service. The
   position leaves the phone. A flat "no location collected" is not defensible against Play's own
   definition, and Play's automated review pairs the declared answers against the manifest
   permissions and observed network behaviour; a mismatch is an enforcement action (app removal),
   not a rejection you can argue about afterwards.
2. **"Ephemeral" is exactly this shape.** The coordinates are sent, a city name comes back, and
   nothing is retained by anyone acting for us. That is what the checkbox exists for. Play does
   allow answering "not collected" for purely ephemeral processing, but the checkbox path declares
   the same truth *and* survives a reviewer who reads it the other way — a one-way bet.
3. **Optional, not required**, because the app is fully usable with a hand-typed city; that is a
   true and favourable answer, and it matches the permission being genuinely skippable.
4. **Not shared**, because the recipient is the platform's own geocoder invoked by the OS on the
   user's behalf, not a partner we hand data to for their own purposes.
5. **It reads better than silence.** The store page will show approximate location processed
   ephemerally, which for this app is a *supporting* fact — the in-app pledge footnote and
   `docs/PRIVACY_POLICY.md` already say the same thing in plain words. A label that contradicted our
   own copy would be the worst of both.

Note the deliberate asymmetry with Apple, where the same behaviour is **not** collection: Apple's
test is whether *you or your partners* can access the data beyond the real-time request, and the
system geocoder is neither. Both answers are correct under their own store's rules.

#### Purchase history — not declared

Owner decision, final: no Financial info row. See DECISIONS.md **D52**.

#### Not declared, and why

- **Device or other IDs, App interactions → No.** No analytics SDK exists in this build; the only
  telemetry is the Sentry crash reporter declared above, which is given no advertising ID and no
  custom identifier (`sendDefaultPii: false`, no `setUser`). The crash data in Android vitals is
  collected by Google Play itself, not by the app, and is not declarable by the developer — the
  Crash logs declaration above covers Sentry only.
- **Health and fitness → No.** Exempt-period days never leave the device.
- **Personal info, Messages, Photos, Files, Contacts, Calendar, Audio → No.** Never accessed;
  camera, microphone, contacts, activity recognition and precise location are in
  `android.blockedPermissions`, so they cannot even be requested.
- **The EAS Update check** (`u.expo.dev`, `checkAutomatically: ON_LOAD`) sends platform, runtime
  version, channel and a random per-install client id. Recommended: **not declared** — no data type
  in the form matches an app-version cache token, and it is neither a user nor a device identifier.
  If the owner wants to over-declare, the nearest fit is *App info and performance → Other app
  performance data*, collected, not shared, App functionality. Same open question as on the Apple
  side; decide both the same way.
- **Feature graphic — DONE:** `docs/screenshots/graphics/play-feature-graphic.png` (1024x500, RGB,
  no alpha — Play rejects transparency). Generated by `scripts/generate-marketing-graphics.py`, which
  also produces the website's `og.png`; re-run it rather than editing either by hand.
  Generated, never hand-edited: the mosque mark from the same geometry the app icon is built
  from, the app's own paper-grain tile (`assets/images/paper-noise.png`) over `#ECE1C5`, and real
  Lora converted to outlines so no font has to be installed. Re-render with
  `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib uv run --with cairosvg --with fonttools python3 scripts/generate-brand-assets.py --feature-only`;
  change `feature_graphic()` in that script rather than the PNG.
- **Phone screenshots:** same narrative and captions as iOS — but the raw iOS captures are the
  **wrong aspect ratio for Play as-is**. Play caps a phone screenshot's long side at twice its
  short side, and both capture sizes are 2.17:1 (2796÷1290, 2556÷1179). Compose the Play frames
  (caption band + device frame on the paper ground) at **1080×1920** using
  `docs/screenshots/<locale>/light/6.7/*.png` as the device content. Owner task — it is a
  marketing composite, not a capture.
- **Android vitals bar:** crash-free ≥99.5% before store submission.

## Localized metadata

## Google Play — the watch face listing (separate app: `app.simpleprayer.face`)

A Watch Face Format face must ship as its own Play app (D129). Minimal listing, same voice:

- **Title (≤30):** `Manuscript · Simple Prayer` (26)
- **Short description (≤80):** en `A calm watch face: the next prayer and a live countdown. Free, no ads.` (70) · tr `Sakin bir kadran: sıradaki namaz ve canlı geri sayım. Ücretsiz, reklamsız.` (74) · ar `واجهة ساعة هادئة: الصلاة التالية وعدّ تنازلي حي. مجانية وبلا إعلانات.` (69)
- **Full description (en; tr/ar author from it, same rules):**

```
Manuscript is Simple Prayer's own watch face: warm gold on deep night paper, the time in a serif hand, the Hijri date, and the next prayer with a live countdown that never goes stale.

It is fed by the Simple Prayer app on your phone through the Simple Prayer Wear OS app — install both, and the face keeps up to two weeks of prayer times even when your phone is far.

Every feature is free. No ads, no account, no tracking — like everything we make.
```

- **Category/tag:** "Watch face" is NOT a Play Console category — the category dropdown (Store
  settings → App category) only offers general categories; pick **Personalization** there, then
  add **Watch face** as one of the (max 5) tags, which is what actually places it in the
  storefront's watch-face section. **Icon:** the face itself, circular, scaled to the icon edges
  (WO-G4).
- Store screenshots: round-display captures of the face, interactive + always-on.

### Türkçe (tr / tr-TR)

**Apple App Store**
- **Name (≤30):** `Namaz Vakitleri, Kıble, Kaza` (28)
- **Subtitle (≤30):** `Ezan, Cuma, Hicri Takvim` (24)
- **Keywords (≤100):** `imsak,ramazan,müslüman,akşam,yatsı,öğle,ikindi,diyanet,fazilet,temkin,cami,hatırlatma,simple,prayer` (99) — `simple,prayer` buys back brand search, which the Turkish Name gives up (see the note below). Paid for by dropping `seccade` (a prayer rug — this app does not do that) and `sabah` (ambiguous "morning"; `imsak` and `yatsı` carry the dawn/night intent).
- **Promotional text (≤170):** `Her özellik ücretsiz. Reklam yok, hesap yok, izleyici yok. Güzel namaz vakitleri, sade namaz takibi, doğru kıble — ibadetin sadece seninle Allah arasında kalır.` (160)

**Google Play**
- **Title (≤30):** `Namaz Vakitleri, Kıble, Kaza` (28)
- **Short description (≤80):** `Namaz vakitleri, ezan, kıble ve sade takip. Tüm özellikler ücretsiz, reklamsız.` (79)

**Full description (≤4000, shared by both stores):**

→ `docs/STORE_DESCRIPTIONS.md` (Türkçe · full description, both stores)

**What's New (1.0 launch):**

```
Simple Prayer'a hoş geldin.

Bu ilk sürümde: çevrimdışı ve doğru namaz vakitleri (ülkene göre otomatik seçilen yöntem, dakika bazında ayarlanabilir), iki dokunuşla nazik namaz takibi, kaza namazların için azalan bir sayaç, özel günler modu, net bir kıble pusulası, güvenilir hatırlatmalar ve karanlık tema.

Her özellik ücretsiz. Reklam yok, hesap yok, izleyici yok — namazın sadece seninle Allah arasında.

Türkçe, Arapça ve İngilizceyi destekler.
```

**What's New (1.1):**

→ `docs/STORE_DESCRIPTIONS.md` (Türkçe · What's New 1.1)

**Terminology notes for future maintainers:**
- The Name/Title deliberately drops the "Simple Prayer" brand in favor of a fully
  keyword-forward Turkish name (`Namaz Vakitleri, Kıble, Kaza`), since the brand has
  zero pre-existing recognition in Turkey and Turkish searchers type in Turkish (our
  market research: "vakitler yanlış" 1★s land on generic-sounding apps). **Owner
  decision, 2026-08-20: keep the local name, and buy brand search back through the
  keyword field instead.**

  This note used to say the brand was "preserved in the description's opening and
  closing lines". That is true on Play, whose full description IS indexed, and false
  on the App Store, which indexes only Name, Subtitle and the hidden Keywords field —
  never the description. So on iOS a Turkish user who heard the name "Simple Prayer"
  from a friend or from the website could not have found it. `simple,prayer` in the
  Keywords field fixes that at no cost to the visible name: the field is invisible to
  users, and the words are not duplicated from the Turkish Name/Subtitle, so nothing
  is wasted.
- "Diyanet" appears only as a keyword and inside the description body as a factual
  calculation-method name — never in the Name or Title field (misleading-name
  complaints, per our market research).
- Excused days uses the app's own term "özel günler" throughout — never "muafiyet".
- Qada is never framed as a "debt" (`borç`). The app's own copy frames it as a count
  that goes down and, if the user chooses, is set aside (`bırakabilirsin` / `sıfırdan
  başla`) — never "forgiven" (there is no `bağışla` in-app). Store copy mirrors this
  exactly.
- "Takip" is reserved for the prayer-tracking feature (matches Settings' "Takip"
  section) everywhere in this copy. The no-tracking privacy pledge instead says
  "izleyici yok" (no trackers), reusing the exact noun from the in-app pledge screen
  (`settings.pledge.points.tracking`) — this avoids the two meanings colliding.
- Keywords field deliberately excludes every word already spent in Name/Subtitle
  (namaz, vakitleri, kıble, kaza, ezan, cuma, hicri, takvim).

### العربية (ar / ar-SA)

**Apple App Store**
- **الاسم (≤30):** `مواقيت الصلاة، قبلة وقضاء` (25)
- **العنوان الفرعي (≤30):** `أذان، متابعة لطيفة، جمعة` (24)
- **الكلمات المفتاحية (≤100):** `اذان,صلاة,فجر,مسجد,رمضان,هجري,تقويم,منبه,مسلم,فوائت,عذر,قبلة,كعبة,اتجاه,وقت,simple,prayer` (89) — `simple,prayer` buys back brand search, which the Arabic Name gives up (see the note below). Pure addition; the field had 19 characters spare.
- **النص الترويجي (≤170):** `كل الميزات مجانية. بلا إعلانات، بلا حساب، بلا متتبعات. مواقيت دقيقة، متابعة لطيفة لصلاتك، وقبلة صحيحة — عبادتك بينك وبين الله وحده.` (131)

**Google Play**
- **العنوان (≤30):** `مواقيت الصلاة، قبلة وقضاء` (25)
- **الوصف المختصر (≤80):** `مواقيت الصلاة والأذان والقبلة ومتابعة لطيفة. كل الميزات مجانية وبلا إعلانات.` (76)

**الوصف الكامل (≤4000، مشترك بين المتجرين):**

→ `docs/STORE_DESCRIPTIONS.md` (العربية · full description, both stores)

**ما الجديد (إصدار 1.0):**

```
أهلًا بك في مواقيت الصلاة.

في هذا الإصدار الأول: مواقيت صلاة دقيقة تعمل دون إنترنت (بطريقة حساب تُختار تلقائيًا حسب بلدك، وقابلة للضبط بالدقيقة)، متابعة لطيفة لصلاتك بنقرتين، عدّاد قضاء الفوائت يتناقص مع كل صلاة تقضيها، وضع العذر لأيام العذر الشرعي، بوصلة قبلة واضحة، تذكيرات يمكن الاعتماد عليها، وسمة داكنة.

كل الميزات مجانية. بلا إعلانات، بلا حساب، بلا متتبعات — صلاتك بينك وبين الله وحده.

يدعم التطبيق العربية والتركية والإنجليزية.
```

**ما الجديد (1.1):**

```
مواقيت الصلاة يعيش الآن خارج التطبيق أيضًا:
• أدوات للشاشة الرئيسية بعدّ تنازلي حي — سجّل الصلاة من الأداة نفسها
• (App Store) تطبيق Apple Watch ومعلومات حية على واجهة الساعة: صلوات اليوم، تسجيل بنقرة، والقبلة على معصمك
• (Play) تطبيق Wear OS وبطاقة ومعلومات حية — وواجهة ساعة من صنعنا: «مخطوطة»
• وضع السفر يفهم القصر والجمع
• أيام العذر يمكن أن تنتهي من تلقاء نفسها — حدد المدة التي تريد
• واجهة من لوحين للأجهزة اللوحية
• البوصلة تلاحظ الآن كيف تمسك الهاتف
```

**ملاحظات مصطلحات لمن يتابع هذا الملف لاحقًا:**
- الاسم يستبدل العلامة التجارية "Simple Prayer" باسم عربي كامل غني بالكلمات
  المفتاحية (`مواقيت الصلاة، قبلة وقضاء`) لأن العلامة لا تحمل أي رصيد تعرّف مسبق في
  السوق العربي. **قرار صاحب المنتج بتاريخ 2026-08-20: يبقى الاسم العربي، ويُستعاد
  البحث بالعلامة التجارية عبر حقل الكلمات المفتاحية.**

  كان هذا الموضع يقول إن العلامة التجارية محفوظة في أول وآخر سطر من الوصف الكامل. هذا
  صحيح في Google Play لأن الوصف الكامل مفهرس فيه، وغير صحيح في App Store لأن آبل تفهرس
  الاسم والعنوان الفرعي وحقل الكلمات المفتاحية المخفي فقط — ولا تفهرس الوصف إطلاقًا.
  لذلك أضيفت `simple,prayer` إلى حقل الكلمات المفتاحية: الحقل غير مرئي للمستخدم،
  والكلمتان غير مكررتين من الاسم أو العنوان الفرعي العربي، فلا تضيع أي مساحة.
- الكلمة المفتاحية `اذان` (بلا همزة) مضافة عمدًا رغم أن `أذان` (بالهمزة) موجودة في
  العنوان الفرعي — فالكلمتان سلسلتان مختلفتان حرفيًا، والمستخدمون يكتبون الهمزة أو
  يُسقطونها بلا فرق، ومحرك بحث المتجر لا يوحّد الهمزات. **نقطة يجب أن يراجعها صاحب
  المنتج** إن أراد نهجًا أكثر تحفظًا في التزام قاعدة "لا تكرار".
- "وضع العذر" و"أيام العذر" هما المصطلحان الوحيدان المستخدمان لميزة الإعفاء —
  مطابقة تامة لما تستخدمه شاشة الإعدادات نفسها؛ لا يُستخدم أبدًا "الإعفاء".
- قضاء الفوائت لا يُقدَّم أبدًا بوصفه "دينًا" — النسخة داخل التطبيق تصف الرقم بأنه
  يمكن أن يُوضع جانبًا (`بإمكانك أن تضعه جانبًا`) ويبدأ المستخدم من جديد
  (`ابدأ من جديد`)، لا أن "يُغفر". النسخة التسويقية تكرر الصياغة نفسها بالضبط.
- "متابعة" محجوزة لميزة تتبّع الصلاة (تطابق قسم "المتابعة" في الإعدادات) في كل
  مكان بهذه النسخة. أما تعهد الخصوصية بعدم التتبع فيستخدم بدلًا منه "متتبعات" —
  الاسم نفسه المستخدم في شاشة التعهد داخل التطبيق (`settings.pledge.points.tracking`)
  — لتفادي تصادم المعنيين.
- الكلمات المفتاحية تستثني عمدًا كل كلمة أُنفقت بالفعل في الاسم والعنوان الفرعي
  (مواقيت، الصلاة، قبلة، قضاء، أذان، متابعة، لطيفة، جمعة).

---

## Conversion principles (both stores)

1. First screenshot + first description line carry the whole pitch: two-tap tracking + every feature is free + no ads.
2. The pledge is the differentiator — say "No ads, ever. No account." verbatim in every locale.
3. Never promise what breaks Apple/Google rules: no "donation" wording, no review incentives, no "best app" superlatives in Apple metadata (rejection risk).
4. Reply to every store review (owner task post-launch); negative-review themes feed the internal task board.
5. simpleprayer.app mirrors the listing and carries the support URL + privacy policy URL both
   stores require. **Done in M10:** the publishable policy text is `docs/PRIVACY_POLICY.md` and what
   the site must host (plus the constraints that keep the policy true — no analytics, no cookies, no
   third-party embeds) is `docs/WEBSITE.md`.
