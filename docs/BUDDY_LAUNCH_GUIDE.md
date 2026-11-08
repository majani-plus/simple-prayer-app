# Shipping buddy mode — the owner's guide

Everything that needs a human, in the order it needs doing. Buddy mode (D174–D176) is built, reviewed
twice, merged, and tagged as **1.4.0**; nothing below is code. Allow about an hour for steps 1–4, then
the usual release.

**Read this first:** buddy mode does not work at all until steps 1 and 2 are done, and invite links
open a web page instead of the app until step 3 is done. The app degrades quietly without any of it —
the Buddies screen says it cannot reach the relay, and nothing else in the app notices — so a build
can ship early, but the feature will be dead for everybody until the relay is live.

---

## 1. The relay (~20 minutes)

The whole server side is one Cloudflare Worker in its own public repository:
**https://github.com/majani-plus/simple-prayer-relay** (local clone at `~/Developer/simple-prayer-relay`).

You need a Cloudflare account (the free plan is enough — it covers roughly 10k users) and an Expo
access token.

```sh
cd ~/Developer/simple-prayer-relay
bun install
bunx wrangler login
```

**a. Create the database**

```sh
bunx wrangler d1 create simple-prayer-relay
```

It prints the `database_id` inside a ready-made snippet, like this:

```jsonc
{ "binding": "simple_prayer_relay", "database_name": "simple-prayer-relay", "database_id": "…" }
```

**Do not paste that snippet in as a second block.** The binding *name* is ours to choose — wrangler
just suggests one derived from the database name — and every statement in `src/db.ts` reaches for
`env.DB`. So take the `database_id` out of the snippet and put it into the existing `"binding": "DB"`
block, replacing `REPLACE_WITH_D1_DATABASE_ID`, and leave the binding name alone.

Adding it as a second block gives the Worker a live binding nothing uses and a `DB` pointing at a
placeholder. Check before deploying:

```sh
bunx wrangler deploy --dry-run
# Binding                                 Resource
# env.DB (simple-prayer-relay)            D1 Database
# env.BURST_LIMITER (60 requests/60s)     Rate Limit
# env.PAIR_LIMITER (10 requests/60s)      Rate Limit
```

Those three and nothing else. Then commit — the id is an account-scoped handle, not a secret, which
is why it lives in a public repo.

*(Already done: the database created on 2026-09-16 is on `DB` in `wrangler.jsonc` on `main`.)*

**b. Set the four secrets**

```sh
bunx wrangler secret put TOKEN_KEY          # paste: openssl rand -base64 32
bunx wrangler secret put IP_SECRET          # paste: openssl rand -hex 32
bunx wrangler secret put EXPO_ACCESS_TOKEN  # https://expo.dev/settings/access-tokens (step 2a)
bunx wrangler secret put SENTRY_DSN         # optional; leave it out and Sentry is never initialised
```

`TOKEN_KEY` encrypts push tokens at rest and `IP_SECRET` is what lets rate limits count per caller
without the relay ever storing an IP address. **Generate both fresh** and do not reuse them anywhere.
If you ever rotate `TOKEN_KEY`, every stored push token becomes unreadable and buddies stop being
notified until each phone re-registers — so rotate it only deliberately.

**c. Deploy**

```sh
bun run db:remote     # applies migrations/0001_init.sql to the real database
bun run deploy
```

**d. Point the domain at it**

In the Cloudflare dashboard → Workers & Pages → `simple-prayer-relay` → Settings → Domains & Routes →
**Add custom domain** → `relay.simpleprayer.app`. Cloudflare creates the DNS record itself if the zone
is already there.

Check it:

```sh
curl -s https://relay.simpleprayer.app/health
# {"ok":true,"ttl":7776000000}
```

**e. Turn on the protections that are not in code**

Still in the dashboard, for the `simpleprayer.app` zone:

- **Security → Bots → Bot Fight Mode: on.**
- Leave **Workers Logs** and **Logpush** **off**. They are off in `wrangler.jsonc` and the privacy
  policy says the relay keeps no logs. Turning either on makes that sentence false.

**f. If you set a Sentry DSN**

**The platform is Cloudflare Workers, not Node.** The relay runs on workerd, not Node — the
`nodejs_compat` flag in `wrangler.jsonc` only provides the few shims `@sentry/cloudflare` needs. Node
auto-instrumentation (`@sentry/node` + OpenTelemetry) does not apply here and should not be added;
the Worker is already instrumented in code with `withSentry` in `src/index.ts`.

**There is no monitor to create.** The hourly sweep's check-in carries its own monitor config, so
Sentry creates `relay-sweep` on the first run, with the schedule, the margin and the timezone
already set. Nothing to click. (The schedule lives in `src/index.ts` next to the check-in rather
than in the dashboard, so it cannot drift from `triggers.crons` — if you ever change the cron,
change both.) Just confirm the monitor appears after the first hour.

The only thing worth adding by hand is an **uptime check** on
`https://relay.simpleprayer.app/health`. The monitor tells you the sweep stopped; the uptime check
tells you the relay did.

---

## 2. Expo push (~5 minutes)

**a. The access token, and enhanced push security.** Both live on one page, and it is an **account**
page, not a project one — which is why there is nothing about push under the project's settings:

**https://expo.dev/settings/access-tokens** (account settings → *Access Tokens*), with the
`lazuli-global` account selected.

Create a token there for the relay, and enable push security on the same page. Without it, anybody
holding a leaked push token could send notifications to that phone directly — which is the whole
reason the relay bothers to encrypt tokens at rest.

**One caveat, because the setting is account-wide.** It applies to every project under
`lazuli-global`, not just this one. Any other app on that account that sends Expo pushes without an
`Authorization: Bearer` header starts failing with `UNAUTHORIZED` the moment you turn it on. Simple
Prayer is the only app here that sends pushes at all, so this should be a non-event — but check
before flipping it if anything else lives on that account.

The token is the value you paste into `wrangler secret put EXPO_ACCESS_TOKEN` in step 1b. If it ever
leaks, revoke it on the same page and set a new one; nothing else has to change.

**b. The App ID capability.** `app.simpleprayer` needs **Push Notifications** enabled. You do not have
to do this by hand: running the first iOS build interactively (step 5) makes EAS do it for you.

---

## 3. The two association files — invite links break silently without these

Both are committed with `REPLACE_WITH_…` placeholders. Fill them in, then deploy the website.

**a. `website/public/.well-known/apple-app-site-association`**

Replace `REPLACE_WITH_APPLE_TEAM_ID` with your Apple Team ID (Apple Developer → Membership details),
so the line reads e.g. `"appIDs": ["A1B2C3D4E5.app.simpleprayer"]`.

While you are there: `app.json` has no `ios.appleTeamId`, which is why `expo config` prints a warning
from `@bacons/apple-targets` on every run. Setting it there too fixes the warning and keeps one copy
of the number.

**b. `website/public/.well-known/assetlinks.json`**

Play Console → Test and release → Setup → **App integrity** → *App signing key certificate*. Copy the
**SHA-256** fingerprints into the `sha256_cert_fingerprints` array.

**Use the app signing certificate, not the upload certificate.** The upload key signs what you send
to Google; the app signing key signs what users actually install. Getting this wrong breaks links for
everybody who installed from Play, and works perfectly for you testing a local build — which is the
worst possible failure shape.

**If the console offers post-quantum *and* classical, take all of them.** With quantum-ready hybrid
signing Play holds three keys, and which one verifies an install depends on the device:

| key | used by |
|---|---|
| classical (older devices) | Android 16 and below — i.e. essentially everyone today |
| new classical (v3.2) | Android 17+ |
| post-quantum ML-DSA-65 | Android 17+, alongside the new classical one |

`sha256_cert_fingerprints` is an **array**, and listing a fingerprint that a given device does not use
costs nothing. Listing too few is what breaks links — and it breaks them per Android version, so
taking only the post-quantum one would work on a brand-new test device and fail for every real user.
Google's own instruction is *"copy the fingerprints for three keys and register each of them"*.

If the console shows only one fingerprint, hybrid signing is not on for this app: use that one and
delete the placeholder line.

**c. Verify after deploying**

```sh
curl -sI https://simpleprayer.app/.well-known/apple-app-site-association | grep content-type
# content-type: application/json
```

If that header is missing, **iOS ignores the file without an error** and every invite link opens a web
page instead of the app. Apple also caches the file, so allow a little time and reinstall to retest.

---

## 4. The website

The privacy policy, the landing page and the pairing-link fallback all changed. Deploy as usual
(`docs/WEBSITE.md`). What is new:

- **`/privacy`** gains a "Prayer buddies" section: what a buddy sees, what the relay holds and for
  how long, that it keeps no logs, and a link to its source. It also now says "five things leave your
  phone" instead of four.
- **The landing page** gains a *Prayer buddies* card, and the line "Nobody can see your log except
  you" now names the exception.
- **`_redirects`** sends `/b/*` to `/install`, so somebody without the app who taps an invite link
  gets the install page. The code is deliberately dropped rather than carried into a query string.

---

## 5. The build

**The first iOS build of 1.4.x must be run interactively**, for two reasons now. Buddy mode adds the
Push Notifications capability, and D179 adds a second **iOS target** — the notification service
extension, bundle id `app.simpleprayer.notify`. EAS only registers a new App ID and syncs a new
capability when it has an Apple session, which `--non-interactive` never opens. This is the same
rule that bit 1.3.0.

When EAS asks, let it **create the App ID for `app.simpleprayer.notify`** and generate its
provisioning profile. It also needs the App Group `group.app.simpleprayer` on that new App ID — the
same group the widget extension already uses. If EAS does not offer it, add it in the Apple Developer
portal: Identifiers → `app.simpleprayer.notify` → App Groups → `group.app.simpleprayer`, then rebuild.
Without the group the extension still runs and simply finds no nicknames, so notifications read
"Your buddy has prayed." — correct, just not personal.

**The version is already bumped.** 1.4.0 is committed and tagged `release/v1.4.0` on `main`, with
the changelog rolled and both Wear `versionCode`s stepped. **Do not run `version:bump` again** — it
would take you to 1.5.0.

```sh
bun run pre-release          # lint + typecheck + test
bunx eas build --profile production --platform ios --auto-submit
```

Log in when asked. EAS prints *Syncing capabilities*, enables Push Notifications on
`app.simpleprayer`, regenerates the now-invalid provisioning profile, then builds. Every later build
is non-interactive again.

Android needs nothing extra: the messaging service that does the same job there is an ordinary part
of the app, merged in from `modules/buddy-nicknames`. Build it and the two Wear artefacts exactly as
in the release steps (internal notes).

**Redeploy the relay before this build ships.** D179 added `bodyNamed` and `mutableContent` to
`POST /send`. Nothing breaks if you forget — an older relay ignores a field it does not know, so
marks still arrive and notifications simply read "Your buddy has prayed." — but the nickname will
not appear until you do:

```sh
cd ~/Developer/simple-prayer-relay && git pull && bunx wrangler deploy
```

---

## 6. Store listings

**Descriptions and release notes** for both stores in all three languages are written and ready to
paste from `docs/STORE_DESCRIPTIONS.md` (look for the 1.4.0 sections). Three things changed beyond
the new buddy paragraph, and they are changes rather than additions:

- "your prayer record never leaves your phone" → "stays on your phone";
- the pledge paragraph now names the relay;
- the promotional line "your worship stays between you and Allah" is gone. It is still true of anyone
  who does not use the feature, but it was doing promotional work that the code no longer backs.

**D179 changes none of this.** Naming the buddy in the notification adds nothing to what leaves the
phone: the nickname is put in by the receiving phone, after the push has arrived. The descriptions,
the pledge and both privacy declarations stay true exactly as written, and there is no new data type
to declare.

**The privacy declarations are the part that matters.** Exact answers and the reasoning behind each
are in `docs/STORE_LISTINGS.md`. In short:

| | Apple App Privacy | Play Data safety |
|---|---|---|
| add | Identifiers → **Device ID** | Device or other IDs |
| add | Other Data → **Other Data** | Personal info → **Other info** |
| both | App Functionality · **not** linked to the user · **not** used for tracking | **Optional**, **not** ephemeral, **not** shared |

Two answers are easy to get wrong:

- **Play's "ephemeral" is No.** A mark rests in the inbox until the buddy's phone collects it, up to
  24 hours. That is short, but it is not "used in memory only while servicing the request".
- **Health & Fitness stays "not collected" in both.** Excused-period days are the health-adjacent
  data in this app and they never travel — `markStateFor` returns nothing for an exempt day, and
  `src/domain/buddies.test.ts` pins it. If that ever changes, these answers change with it.

Play also asks about deletion: you now have an **in-app** deletion path — turning buddy mode off
deletes the device and every pairing from the relay — which is worth saying in the form.

---

## 7. Screenshots

`scripts/capture-store-screenshots.sh` gains a frame **08-buddies**: the real Today screen with
buddies on three of the five rows, and two rows with nothing on them, because "nothing arrived" is a
normal state and the frame should not suggest otherwise.

It needs a dev build installed on a booted simulator with Metro running — the usual runbook in
`docs/screenshots/README.md`. It does **not** need the relay to be live, and it does not need a *new*
dev build: the frame pins what the row displays rather than switching the feature on, so nothing
native is called.

```sh
bunx expo start --dev-client
python3 scripts/seed-screenshot-data.py --udid <UDID>
./scripts/run-capture-matrix.sh        # all locales and themes
```

I could not run this: no dev build was installed on the simulator here, and D38 says device work never
blocks a milestone. The existing store screenshots are still accurate — buddy mode is off by default,
so every one of them shows what a new user sees.

---

## 8. Two real phones

This is the step I would not skip. Three separate bugs in this feature were caught only by rendering
or tracing the real path, and unit tests were green through all of them. Nothing here has ever run
against a live relay or a second device.

Pair two phones, then check:

1. pairing by **link**, by **typed code**, and by **QR** through the other phone's camera app;
2. mark a prayer on each, with both apps open — the avatar appears on the other within a few seconds;
3. mark with the other app **closed** — a quiet notification arrives, and opening the app fills the row;
4. **swipe the notification away** before opening the app — the row must still fill on next open
   (this is the inbox doing its job rather than the push);
5. **undo** a mark — the avatar disappears on the other phone;
6. **remove a buddy** — the other side says a link ended, once, without naming anyone;
7. turn buddy mode **off** — the other side's next mark is refused and their list empties;
8. one phone in **Arabic** — its buddy's notification arrives in Arabic, not English;
9. the notification **uses the nickname** — "Amina has prayed.", not "Your buddy has prayed." — on
   iOS and on Android, with the receiving app fully closed. This is D179, and it is the one thing
   in this feature that has never executed anywhere: the iOS extension and the Android messaging
   service are both new, and neither runs under Jest or in a simulator without a real push. If it
   says "Your buddy" instead, the rewriter did not run and everything else is still correct — check
   the App Group on `app.simpleprayer.notify` first (§5);
10. the same notification with a **nickname in the other script** — an Arabic nickname on an English
    phone, or a Latin one on an Arabic phone. The name is bidi-isolated as it goes in, so the full
    stop must stay at the end of the sentence;
11. a buddy you have **not named yet** (accept an invite, leave the nickname empty) — their
    notification must read "Your buddy prayed Dhuhr" and never an empty gap;
12. **the invite sheet, watched** (D181): make an invite on phone A and leave the sheet open; accept
    on phone B. Within a few seconds A's code must collapse into "… is your buddy now" with a tap of
    haptic — that is the 4 s roster poll working, not the push;
13. **the invite sheet, closed early**: make an invite, close the sheet, see the dashed pending row
    with "expires in 23 hours"; kill phone A entirely; accept on B; launch A — the "new buddy" sheet
    must be the first thing it shows;
14. **cancel an invite** on A, then try the code on B: it must be refused;
15. **a widget tap tells the buddy** (D180): with phone A's app fully closed (swiped away), tap a
    seal on A's large widget. B must get "… prayed Dhuhr" within seconds. Then open A: the mark is
    in the log and B did NOT get a second notification. Both platforms — the Android receiver and
    the iOS intent are separate code. Watch the seal flip on iOS: if it lags on a slow network,
    the intent is waiting on the send. Note the iOS **notification** Prayed
    button and the Live Activity seal do NOT send yet — only the widget does on iOS;
16. tap a buddy row, change the colour, Save — the badge on Today and on the widget follows.

And two that are quick and worth it:

- a phone with **tracking switched off entirely** still shows its buddy's marks and is never asked to
  mark anything back;
- nothing buddy-related appears on a **widget, watch, Live Activity or lock screen**.

---

## Known gaps, deliberately

- **No "Prayed" button on a buddy notification.** It was planned. The action identifier did not match
  the native one — and fixing that alone is not enough: iOS reads the prayer at the top level of the
  payload while an Expo *remote* push nests it, and the `day` in a buddy push is the *sender's* prayer
  day, so a tap from another timezone would write the mark on the wrong day. One is a rename, one is a
  native change nobody can verify without a device. Tapping opens Today, where the seal is one tap
  away. Worth revisiting in its own milestone.
- **No in-app QR scanner.** `CAMERA` is in `blockedPermissions` and unblocking it is a visible
  store-listing change. The QR is scanned with the phone's own camera app, which works today.
- **No buddy history, no nudges, no shared streaks, no groups.** Not gaps — fences, written into D174.
