# Release runbook — Simple Prayer

Everything EAS needs is written and validated. Nothing has been executed: linking the project,
building and submitting all require credentials this repo does not and must not contain (D19).
This file is the procedure, in order, with the exact commands.

Read it top to bottom once before running anything. §1 and §2 must happen before any build.

Related runbooks:

- **`docs/TIP_JAR_RUNBOOK.md`** — RevenueCat products and keys. Do that _before_ the first
  production build if v1 is meant to ship with the tip jar; it needs a **native rebuild**, so it
  cannot be added by an update afterwards.
- **`docs/STORE_LISTINGS.md`** — the ASO kit: names, subtitles, keywords, descriptions, screenshot
  plan, and the App Privacy / Data safety answers.

---

## 0. The placeholders — all resolved (2026-08-20)

Every deliberately-fake value this section used to track has been filled in or removed by the
owner. Verify at any time that none remain:

```sh
grep -rn "EAS_PROJECT_ID_PLACEHOLDER\|OWNER_SUPPLIED_" app.json eas.json   # should print nothing
```

| Where                                    | Status                                                                                     | When |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ---- |
| `app.json` → `extra.eas.projectId`       | **DONE** `e154931d-…b19c0d` (2026-08-19)                                                    | §2   |
| `app.json` → `updates.url`               | **DONE** (2026-08-19)                                                                       | §2   |
| `eas.json` → `submit.production.ios`     | **DONE** — trimmed by the owner to just `ascAppId: "6803004652"`; `eas submit` prompts for the Apple ID interactively (2026-08-19) | §7   |
| `eas.json` → `submit.production.android` | **Trimmed** to `track: "alpha"` — no `serviceAccountKeyPath`, so the Play service-account key must be supplied interactively or re-added before `eas submit -p android` | §7   |
| `src/services/appInfo.ts` → `IOS_APP_STORE_ID` | **DONE** `'6803004652'` — matches `ascAppId`, so Settings → "Rate the app" works on iOS | §8   |

The owner also added a `submit.draft` profile (Android `internal` track, `releaseStatus: "draft"`)
for dry-run submissions.

---

## 1. Prerequisites

1. **Apple Developer Program** membership ($99/yr) — required for TestFlight and the App Store.
2. **Google Play Console** developer account (one-off $25).
3. **Expo account** — <https://expo.dev>. EAS Build's free tier is enough for a handful of builds;
   see <https://expo.dev/pricing>.
4. **EAS CLI.** The config in `eas.json` declares `"cli": { "version": ">= 20.0.0" }`; it was
   written and validated against the 22.x schema. Install or upgrade:

   ```sh
   bun add -g eas-cli
   eas --version
   ```

5. **Log in.** This is the step nobody but the owner can do:

   ```sh
   eas login
   eas whoami
   ```

The project builds with **bun** (D35). `bun.lock` is committed, and EAS Build detects it and uses
bun automatically — no `packageManager` field or `eas.json` override is needed.

---

## 2. Link the project (one time)

```sh
eas init
```

It creates (or links) an EAS project and writes the real UUID into `app.json` at
`extra.eas.projectId`, replacing `EAS_PROJECT_ID_PLACEHOLDER`.

- If it refuses because a project id is already present, the placeholder is what it is seeing:
  `eas init --force`, or delete the `extra.eas.projectId` string by hand first.
- It may also add an `owner` field if your Expo account name differs from the project slug's
  account. That is expected; leave it.

**Then edit the second half by hand.** `updates.url` must contain the same UUID:

```json
"updates": {
  "enabled": true,
  "url": "https://u.expo.dev/0123abcd-4567-89ef-0123-456789abcdef",
  "checkAutomatically": "ON_LOAD",
  "fallbackToCacheTimeout": 0
}
```

(`eas update:configure` will also write that URL. It is safe to run, but check afterwards that it
did **not** rewrite `runtimeVersion` — see §4 for why the policy there is deliberate.)

Verify both halves agree:

```sh
grep -n "projectId\|u.expo.dev" app.json
bunx expo-doctor
```

---

## 3. The version scheme

**Versions live in `app.json`. EAS does not keep a copy.** `eas.json` sets
`"cli": { "appVersionSource": "local" }`, which means EAS reads the version out of the app config
and never invents one.

| Field                                      | Meaning                                                | Who bumps it                                        |
| ------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------- |
| `expo.version` — currently `1.0.0`         | the marketing version users see in the stores          | **you, by hand**, once per public release           |
| `expo.ios.buildNumber` — **removed from `app.json`** (was `"2"`) | `CFBundleVersion`; must be unique per App Store upload | EAS remotely (`appVersionSource: "remote"` — see the note below) |
| `expo.android.versionCode` — **removed from `app.json`** (was `3`) | must be unique and increasing per Play upload          | EAS remotely (same)                                 |

Only the `production` profile sets `autoIncrement: true`. `development` and `preview` binaries never
reach a store, and a store is the only thing that requires a unique build number; leaving them alone
keeps day-to-day builds from churning `app.json`.

So a production build does this:

1. `eas build --profile production` bumps `ios.buildNumber` `"1"` → `"2"` and/or
   `android.versionCode` `1` → `2` **in your working tree**.
2. Your git tree is now dirty. EAS CLI notices and offers to commit before uploading. **Say yes**
   (or commit yourself). If you discard the change, the next build reuses the number and the store
   rejects the upload — the single most common release failure.
3. For a public release, bump `expo.version` yourself in the same commit (`1.0.0` → `1.0.1`).

### Why local and not `remote`

> **Out of date as of 2026-08-19: `eas.json` now says `"appVersionSource": "remote"`.** eas-cli
> wrote it during build setup. The section below is the reasoning for the *original* choice, kept
> because it is the argument to weigh if you switch back — not a description of the current repo.
>
> Two consequences are live right now, whichever way you decide:
> - `expo.ios.buildNumber` and `expo.android.versionCode` were dead fields under `remote`, and the
>   owner has since **deleted them from `app.json`** (commit `0b144d2`) — the correct end state.
>   Do not re-add them, and do not "fix" a store rejection by editing them; the counters live on
>   EAS (`eas build:version:get` / `:set`).
> - Reason 1 below (the About screen lying) was real, and is handled: `appBuild()` now reads the
>   binary's own build number via `expo-application`, which is correct under both settings.
>
> Reasons 2 and 3 still stand unaddressed: version bumps no longer appear in a commit diff, and a
> local `expo run:ios --configuration Release` build can now disagree with a cloud build.

`remote` (EAS-hosted counters) is Expo's general recommendation, and it was rejected here for three
specific reasons:

1. **The About screen would lie.** `appBuild()` in `src/services/appInfo.ts` reads
   `expoConfig.ios.buildNumber ?? expoConfig.android.versionCode`. Under `remote`, EAS _ignores and
   never writes back_ those fields — so the app would say "build 1" forever while TestFlight said
   build 12.
2. **The bump is reviewable.** Under `local` every version change is a line in a commit diff, next
   to the change it ships. There is no second source of truth to reconcile.
3. **Local release builds agree.** `bunx expo run:ios --configuration Release` reads the same
   numbers EAS does. Under `remote` a locally built binary and a cloud-built one can differ.

The documented cost of `local` is that CI has to commit the bump itself. This project's CI
(`.github/workflows/ci.yml`) only typechecks, lints and tests — it never builds — so the cost is
zero here. Revisit if release builds ever move into CI.

### If you ever switch to `remote`

Do all four steps or uploads will be rejected:

```sh
eas build:version:set -p ios       # seed with the LAST build number already in App Store Connect
eas build:version:set -p android   # same, from the Play Console
```

then set `"appVersionSource": "remote"` in `eas.json`, delete `ios.buildNumber` and
`android.versionCode` from `app.json`, and change `appBuild()` in `src/services/appInfo.ts` to read
`expo-application`'s `nativeBuildVersion` instead of the app config.

---

## 4. Updates and the runtime version

`app.json` now carries:

```json
"runtimeVersion": { "policy": "appVersion" },
"updates": { "enabled": true, "url": "https://u.expo.dev/…", "enableBsdiffPatchSupport": true, "checkAutomatically": "ON_LOAD", "fallbackToCacheTimeout": 0 }
```

> **Out of date as of 2026-08-19: the owner switched the policy from `fingerprint` to
> `appVersion`** (commit `862b8a7`). Under `appVersion` the runtime version is simply
> `expo.version`, so every build of `1.0.0` — whatever native modules it contains — accepts every
> update published for `1.0.0`. The original `fingerprint` reasoning is kept below because it
> names the exact failure this reintroduces.
>
> **The discipline that replaces the fingerprint under `appVersion`:** whenever the native layer
> changes — a new native dependency, a config-plugin option, a permission — **bump `expo.version`
> before building, and never publish an update for the old version that calls the new module.**
> This is live right now: `expo-audio` (+ `expo-asset`) landed on 2026-08-20 as new native
> modules, *after* builds 2 (iOS) / 3 (Android) of `1.0.0` were made. An `eas update` published to
> `production` today would be offered to those older binaries and would crash them at the adhan
> preview. Either bump to `1.0.1` before the next build, or make sure no update is ever published
> while a pre-expo-audio `1.0.0` binary is installed anywhere.

**Why `fingerprint` was the original choice.** This is a CNG project — `ios/` and `android/` are
generated and gitignored, so the native layer is entirely a function of `package.json`, `app.json`
and the config plugins. `@expo/fingerprint` hashes exactly that set, so the runtime version changes
automatically the moment the native layer changes. The alternative policies both need a human to
remember something: `appVersion` silently ships a JS update to a binary that lacks the native
module it calls, and `nativeVersion` needs a manual bump per build. With `fingerprint`, an
incompatible update is simply never offered — the desired failure mode. (Its cost, presumably the
reason for the switch: every config edit changes the runtime version, so updates only reach the
very latest build.)

Verify what either policy resolves to at any time:

```sh
bunx expo-updates runtimeversion:resolve --platform ios
bunx expo-updates runtimeversion:resolve --platform android
```

**`fallbackToCacheTimeout: 0`** means the app never blocks its own launch waiting on the network. A
downloaded update applies at the next launch. For an app whose first screen is a prayer time, a
launch that waits on a server is the wrong trade.

### What this fixes in the app

`src/i18n/reload.ts` calls `Updates.reloadAsync()` to restart the app when the language change flips
the layout direction (D41). One nuance, checked against the installed `expo-updates@57.0.15` rather
than assumed: in a **release** build the restart already worked without any update config —
`DisabledAppController` (iOS) / `DisabledUpdatesController` (Android) still recreate the React
context. `reloadAsync()` only throws in development builds, where the JS guard fires. So this
configuration does not repair a broken release path; it removes the ambiguity, and it is what makes
OTA possible at all. The user-facing "applies next launch" fallback stays correct either way, and
stays correct in the dev client.

### Publishing an update

An update may only ever contain JS, images and other bundled assets. Anything native — a new
dependency, a plugin option, a permission, an icon set — needs a new build.

```sh
eas update --branch production --message "Fix the Isha nudge off-by-one"
```

Branches map to the `channel` values in `eas.json`: `production` builds read channel `production`,
`preview` builds read `preview`. Development builds ignore channels entirely.

Publish to `preview` and test on a preview build before promoting anything to `production`.

---

## 5. Credentials

Let EAS manage signing. It is the default and it is the right answer for one developer on one
machine.

```sh
eas credentials
```

- **iOS.** On the first build EAS offers to create the Distribution Certificate and Provisioning
  Profile for you; say yes. It needs your Apple ID and will handle 2FA interactively.
  For internal (`preview`) iOS builds you must register each test device first:

  ```sh
  eas device:create        # emails/QR a registration link; run once per device
  ```

  A device registered after a build was made needs a **new build** — the device list is baked into
  the provisioning profile.

- **Android.** EAS generates and stores an upload keystore on the first build. **Back it up**
  (`eas credentials` → Android → download), because losing it means losing the ability to update
  the Play listing under that key. Store it outside this repo.

`.gitignore` already excludes `*.p8`, `*.p12`, `*.jks`, `*.key`, `*.mobileprovision`,
`credentials.json` and `google-service-account*.json`. Keep it that way; never commit a key.

---

## 6. Builds

### development — the dev client

iOS is configured for the **simulator** (`ios.simulator: true`), matching how this project has been
verified all along.

```sh
eas build --profile development --platform ios          # .app for the simulator
eas build --profile development --platform android      # .apk
```

Then serve JS to it:

```sh
bunx expo start --dev-client
```

For a dev client on a **physical iPhone**, use the sibling profile (same settings, real device
signing — it needs a registered device per §5):

```sh
eas build --profile development-device --platform ios
```

You can also keep building the dev client locally with `bunx expo run:ios`, which costs no EAS
build minutes. Note that `react-native-purchases` (M9) is a native module: **any client built before
it landed does not contain it**, and the tip jar will stay absent there no matter what keys are set.

### preview — release binaries you can hand to people

```sh
eas build --profile preview --platform all
```

Produces a Release-configured `.ipa` (ad-hoc, installable only on devices registered per §5) and a
Release `.apk`. EAS gives you a shareable install page for each.

**This profile does not feed TestFlight.** TestFlight requires an App Store distribution-signed
build, which is `distribution: "store"` — i.e. the `production` profile. Use `preview` for direct
installs and squad testing; use `production` + `eas submit` for TestFlight. This is why `preview`
does not auto-increment: nothing it produces is ever uploaded to a store.

Expect roughly 10–25 minutes per platform on the free tier, queue time included.

### production — store binaries

```sh
eas build --profile production --platform all
```

Produces a store `.ipa` and an Android `.aab` (Play requires an App Bundle). This is the profile
that bumps the build numbers — see §3 and commit the bump.

**Before the first production build**, make sure these are all true:

- [ ] `docs/TIP_JAR_RUNBOOK.md` is done, or you have deliberately decided to ship v1 without the tip
      jar (the jar is absent, not disabled, without a key — D46).
- [ ] The privacy-policy page is live at `https://simpleprayer.app` — `src/services/appInfo.ts`
      links to it, and both stores require a reachable URL.
- [ ] `docs/STORE_LISTINGS.md` reflects the final privacy answers (RevenueCat changes the App
      Privacy label from "Data Not Collected" — see TIP_JAR_RUNBOOK §4b).
- [ ] `SENTRY_AUTH_TOKEN` is set as an EAS secret, or you accept unreadable release stack traces
      until it is — see §11.
- [ ] `bun run typecheck && bun run lint && bun run test && bunx expo-doctor` are all clean.

---

## 7. Submitting

Fill in the `submit.production` block in `eas.json` first. The schema validates these fields
**eagerly**: with the placeholders in place, `eas submit -p ios` fails immediately with
_"Invalid Apple ID was specified… Invalid Apple App Store Connect App ID… Invalid Apple Team ID"_.
That is the intended behaviour — it is a checklist, not a bug.

### iOS

| Field         | What it is                                        | Where to find it                                           |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `appleId`     | your Apple ID email                               | you                                                        |
| `appleTeamId` | 10 characters, uppercase letters/digits           | <https://developer.apple.com/account> → Membership         |
| `ascAppId`    | the numeric App Store Connect app id              | create the app record first; <https://expo.fyi/asc-app-id> |
| `companyName` | the name shown on the App Store                   | you — required on the **first** submission only            |
| `sku`         | pre-filled with the bundle id; immutable once set | —                                                          |

You must create the app record in App Store Connect before the first submit (My Apps → **+** → New
App; bundle id `app.simpleprayer`, SKU as above). Then:

```sh
eas submit --profile production --platform ios --latest
```

`--latest` submits the most recent production build; use `--id <build-id>` to pick one. The build
lands in TestFlight within ~15 minutes after Apple finishes processing. Ship it to internal testers,
then to App Review from App Store Connect.

If Apple's 2FA prompts get in the way (or you automate this later), swap the three `appleId` /
`appleTeamId` / password fields for an App Store Connect API key — replace them with
`ascApiKeyPath`, `ascApiKeyIssuerId`, `ascApiKeyId` (<https://expo.fyi/creating-asc-api-key>) and
keep the `.p8` outside the repo.

### Android

1. Play Console → Create app; package name `app.simpleprayer`.
2. Create a Google service account and grant it release permissions:
   <https://expo.fyi/creating-google-service-account>. Download the JSON.
3. Save it **outside the repo** (for example `~/.secrets/simple-prayer-times-play.json`) and put
   that absolute path in `submit.production.android.serviceAccountKeyPath`. `.gitignore` covers
   `google-service-account*.json` as a second line of defence, not a first.

```sh
eas submit --profile production --platform android --latest
```

The production profile now targets the **`alpha`** (closed-testing) track — the owner changed it
from `internal`+`completed` on 2026-08-19 — and the `draft` profile targets `internal` with
`releaseStatus: "draft"` for dry runs. Promote alpha → open → production from the Play Console
when you are ready. Google's first-release review can take
several days; budget for it.

Note that Play's very first release for a brand-new app usually has to be created through the
console UI (data safety form, content rating, target audience and the rest must be completed
first). `eas submit` handles every release after that.

### Build and submit in one step

Once the profile is filled in and a first manual submission has succeeded:

```sh
eas build --profile production --platform ios --auto-submit
```

---

## 8. After the listing exists

**DONE (2026-08-20):** the App Store Connect app id is set both in `eas.json` (`ascAppId`) and in
the app — `IOS_APP_STORE_ID = '6803004652'` in `src/services/appInfo.ts` — so Settings → "Rate the
app" opens the real write-review deep link on iOS. Android needs nothing — its store URL is derived
from the package name.

Also do, once the listing is live:

- Paste the RevenueCat keys and rebuild — `docs/TIP_JAR_RUNBOOK.md` §4 (native module: update will
  not do).
- Fill in the App Privacy answers and Data safety form from `docs/STORE_LISTINGS.md`.
- Upload screenshots per `docs/STORE_LISTINGS.md` (en/ar/tr, light and dark).

---

## 9. Cutting a release, end to end

```sh
# 1. Bump the marketing version, roll the changelog, tag and push — one command.
#    It runs lint + typecheck + tests first and refuses to tag a red tree.
bun run version:bump patch        # or minor / major

# 2. Build
eas build --profile production --platform all

# 3. Submit
eas submit --profile production --platform ios --latest
eas submit --profile production --platform android --latest
```

`bun run version:bump` (`scripts/bump-version.ts`) is the whole of step 1. It reads `expo.version`
from `app.json` as the source of truth, mirrors it into `package.json`, moves everything under
`## [Unreleased]` in `CHANGELOG.md` into a dated section for the new version, opens a fresh empty
one, fixes the compare links, commits as `Bump version to X.Y.Z`, tags `release/vX.Y.Z` and pushes
both. Run it with no arguments to print the current version and do nothing.

It stops rather than guessing when:

- you are not on `main`;
- `app.json`, `package.json`, `CHANGELOG.md` or either Wear `build.gradle` already carry
  uncommitted edits — those would otherwise ride along inside a commit labelled "Bump version";
- `app.json` and `package.json` disagree about the current version (they drifted once already, and
  silently picking one would hide whichever is wrong);
- the tag already exists locally or on `origin`;
- lint, typecheck or tests fail. `--skip-checks` bypasses this if you have just run them yourself.

It deliberately does **not** touch `ios.buildNumber` or `android.versionCode` in `app.json` — under
`appVersionSource: "remote"` those fields are dead (see §3), and writing them would only manufacture
something that looks authoritative and is not.

It **does** step the `versionCode` in `wear/build.gradle` and `wear-face/build.gradle`, because
nothing else will. Those are custom Gradle modules outside the CNG-managed tree, so EAS's remote
counter never reaches them: each carries a hardcoded number, and Play refuses a duplicate. The
rejection lands at **upload**, long after a green build — 1.2.0 hit exactly that and had to be
patched by hand (`f68283f`). Each counter steps by one, and they are deliberately unrelated: `wear/`
shares the phone's `applicationId` so it lives in a 9xx-million block that can never collide with
EAS's remote numbers, while `wear-face/` is its own Play listing counting up from 1.

Their `versionName` needs no help — both `build.gradle` files already parse `expo.version` out of
`app.json` at build time, so the marketing version follows the bump for free. That half has always
worked; only the counters were manual.

Write `CHANGELOG.md` entries under `[Unreleased]` as you merge work, in language a user would
recognise. The script only moves what is already there; it cannot invent release notes.

For a JS-only fix to an already-shipped build, the whole thing collapses to `eas update` — see
below.

For a JS-only fix to an already-shipped build, steps 2–5 collapse to:

```sh
eas update --branch production --message "…"
```

---

## 10. Troubleshooting

| Symptom                                                                             | Cause                                                                  | Fix                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eas init` says the project is already linked                                       | it is reading `EAS_PROJECT_ID_PLACEHOLDER`                             | `eas init --force`, then fix `updates.url` too                                                                                                                         |
| App Store: "The bundle version must be higher than the previously uploaded version" | the auto-increment bump was discarded instead of committed             | check `ios.buildNumber` in `app.json`, raise it past the store's, commit                                                                                               |
| Play: "Version code N has already been used"                                        | same, on `android.versionCode`                                         | same                                                                                                                                                                   |
| `eas submit -p ios` fails on Apple ID / Team ID / ASC app ID format                 | the §7 placeholders are still there                                    | fill them in                                                                                                                                                           |
| Updates never arrive on a build                                                     | the runtime version moved                                              | compare `bunx expo-updates runtimeversion:resolve --platform ios` against the build's; if they differ the native layer changed and you need a new build, not an update |
| Language change still says "applies next launch" on device                          | expected in a **development** build; `reloadAsync()` is guarded in dev | test it in a `preview` or `production` build                                                                                                                           |
| Tip jar invisible with keys set                                                     | the client predates `react-native-purchases`, or the three `tip_*` products are not yet approved in the store consoles (no Offering exists — D57) | rebuild natively; see TIP_JAR_RUNBOOK §4                                                                                                                               |

---

## 11. Sentry crash reporting

What is already wired (no action needed to *ship*; action needed to *symbolicate*):

- **In the app.** `src/services/telemetry.ts` initialises `@sentry/react-native` at startup —
  only while Settings → Support → "Crash reports" is on (on by default, opt-out; the setting is
  read once per launch). The configuration is deliberately minimal and pinned by
  `src/services/telemetry.test.ts`: no session replay, no screenshots, no view hierarchy, no
  breadcrumbs, no tracing, no user identity, `sendDefaultPii: false`. Anonymous session
  start/end markers are sent so Sentry can compute crash-free rates. The DSN in that file is a
  publishable client key (org `lazuli-global`, project `simple-prayer`, **EU** ingest region).
- **In the build.** The `@sentry/react-native` config plugin in `app.json` (org/project/EU url)
  writes the native build hooks that upload source maps and debug symbols, and
  `metro.config.js` uses `getSentryExpoConfig`, which stamps the Debug IDs that match a crash to
  its source map. dSYM/ProGuard and source-map upload run automatically inside `eas build` —
  **when the auth token is present**.

### The auth token (the one secret — never commit it)

Uploads authenticate with `SENTRY_AUTH_TOKEN`. **On Android a missing token fails the build.** That
is not a soft degradation, and it killed a production build on 2026-08-19 after four minutes of
Gradle work:

```
> Task :app:createBundleReleaseJsAndAssets_SentryUpload_app.simpleprayer@1.0.0+3_3 FAILED
error: Auth token is required for this request. Please run `sentry-cli login` and try again!
```

The platforms are not symmetrical, and only one has an escape hatch:

| Platform | Missing token | Escape hatch |
|---|---|---|
| iOS | upload step fails | `SENTRY_ALLOW_FAILURE=true` downgrades it to a warning |
| Android | **Gradle task fails, whole build dies** | none — `sentry.gradle` has no allow-failure path, only `SENTRY_DISABLE_AUTO_UPLOAD=true`, which skips uploading entirely |

So the token must exist in **every environment that builds a release variant**: `production` *and*
`preview`, since the preview profile builds a Release APK and runs the same task. `development` is
unaffected — the upload task is attached to release bundling only, so dev-client builds never
invoke it.

Once the token is in place the failure mode is the mild one everybody expects: crashes still
arrive, but release stack traces would show minified frames instead of source lines.

1. Create the token: <https://lazuli-global.sentry.io> → **Settings → Auth Tokens →
   Create New Token** (an organization auth token; the default scopes it offers cover source-map
   upload — it needs `project:releases` and `org:read`).
2. Store it where EAS Build can see it, as a **secret**:

   ```sh
   eas env:create --scope project --name SENTRY_AUTH_TOKEN --visibility sensitive
   # paste the token when prompted, and tick BOTH the production and preview environments —
   # a token present in only one of them fails the other's Android build (see the table above).
   # Verify afterwards, per environment:
   eas env:list production
   eas env:list preview
   ```

   `sensitive` and `secret` both work for builds; they differ only in whether the value can be read
   back afterwards. Note that `eas env:list` prints one environment at a time, so checking only
   `production` will not tell you that `preview` is missing it.

   (Older CLIs: `eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>`.)
   If release builds ever move into CI, set the same name as a CI secret there.
3. Never put it in `app.json`, `eas.json`, or a `sentry.properties` file in this repo —
   `.gitignore` blocks `sentry.properties` and `.sentryclirc` as a second line of defence, not a
   first. The config plugin warns loudly if it ever sees an inline `authToken`; keep it that way.

### Verifying, once

After the first build with the token in place:

1. **Uploads:** <https://lazuli-global.sentry.io> → project `simple-prayer` → Settings → Source
   Maps (and, for iOS, Debug Files) should show artifacts for the new release.
2. **Wiring:** install the build, launch it, and check Releases → the new version → sessions:
   session tracking is on, so a healthy launch appears within minutes as a crash-free session —
   proof the pipeline works without needing a real crash.
3. **Symbolication (optional but conclusive):** force one crash in a **preview** build (e.g.
   throw from a button handler in a scratch branch), and confirm the event's stack trace shows
   TypeScript file names and line numbers, not minified frames.

Local Jest/dev runs never send anything: under Jest the SDK is never loaded (the service
lazy-requires it and degrades silently), and dev-client events are tagged
`environment: development` so they never pollute release health.

---

## 12. The local native module

The app ships one native module of its own: **`modules/notification-dismissal`**, which takes a
delivered Android notification out of the tray when its prayer's window closes, with the app's
process gone (D88, PRODUCT_SPEC §11.5).

| what | where |
|---|---|
| the module | `modules/notification-dismissal/` — `index.ts`, `expo-module.config.json`, `android/` |
| how it is linked | Expo autolinking finds any module under `modules/`; nothing to configure, on a local build or on EAS |
| what it uses | `AlarmManager` and `NotificationManager.cancel(tag, id)` — public Android APIs only |
| the guard | `src/services/notificationDismissal.test.ts` |

Verify the linking at any time without a build:

```sh
bunx expo-modules-autolinking resolve --platform android --json | grep notification-dismissal
```

That is the same command `settings.gradle` runs at configure time, so if the module appears there
it will be compiled into the app.

### It is native, so a rebuild is required

A binary built before the module existed does not contain it. That is handled rather than broken:
`isSupported()` answers `false`, both calls become no-ops, and the app's own tray sweep carries on
as before. But **dismissals only start working after a new dev-client / preview / production
build** — an OTA update cannot deliver a native module.

### The one thing that could break it quietly

The module dismisses notifications that `expo-notifications` posted, using the pair that library
posts them under: `(tag = the identifier we scheduled it with, id = 0)`. That convention is read
out of its source, not out of a documented API. **If it ever changes, `cancel` addresses a
notification that does not exist — which Android treats as success** — so every dismissal would
silently do nothing.

`src/services/notificationDismissal.test.ts` asserts both halves against
`node_modules/expo-notifications/…/ExpoPresentationDelegate.kt`, so an upgrade that moves either
one fails `bun run test` (and therefore `bun run pre-release`) instead of failing on users' phones
weeks later. If it goes red: read that file, fix `PendingDismissals.kt` to match, and never relax
the assertions.

Nothing else in the module depends on `expo-notifications` at all — it does not import it, extend
it, or patch it — so an SDK upgrade has one thing to check, not a diff to re-apply.
