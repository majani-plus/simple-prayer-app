# Build it yourself

Simple Prayer is free. It has no ads and nothing to pay for. The code is open (MIT, see
`LICENSE`), so anyone can build it and copy it.

The app we publish uses three outside services:

- **Sentry**, for crash reports;
- **RevenueCat**, for the tip jar;
- **Firebase Cloud Messaging (FCM)**, so Android can receive buddy notifications.

You do not need any of them. One switch, `FOSS_BUILD=1`, builds the app without all three. You
need no accounts and no keys of ours.

On Android the switch goes further. It builds an app with no Google, closed or tracking libraries
at all, and with only freely licensed adhan recordings. This is the version for F-Droid. Section 2
shows how.

---

## 1. What you need

- **bun.** This project uses bun, not npm or yarn. Install it from <https://bun.sh>.
- **Node.js 20 or newer.** Some Expo tools still run on Node.
- **For Android:** Android Studio, with the Android SDK, and **JDK 17**. Set `ANDROID_HOME` to
  the SDK folder and `JAVA_HOME` to the JDK.
- **For iOS:** a Mac with a recent Xcode, and CocoaPods (`brew install cocoapods`).

The app uses **Expo SDK 58** (React Native 0.88). Expo changes a lot between versions. If
something in this guide does not match what you see, check the SDK 58 docs:
<https://docs.expo.dev/versions/v58.0.0/>.

Get the code and install it:

```sh
git clone https://github.com/majani-plus/simple-prayer-app.git
cd simple-prayer-app
bun install
```

---

## 2. Build it for yourself

First, turn the switch on for this terminal window:

```sh
export FOSS_BUILD=1
```

Keep it on for **every** step below, not only `prebuild`. The build reads the app settings
again when it packs the app. If the switch is off at that moment, our Sentry and RevenueCat
keys are packed into your app.

**For the fully free Android app** (no Google libraries, as on F-Droid), prepare the code first:

```sh
bun scripts/foss-prepare.ts
```

**Warning:** this changes and deletes files that git tracks (see "What the switch removes" below).
Run it only in a copy of the code you can throw away, such as a fresh `git clone`. Undo it with
git. It does nothing unless `FOSS_BUILD=1` is set. Skip it for iOS: the iOS app keeps Apple's own
location and review services, and leaves out only our keys.

Then create the native projects without the outside services:

```sh
bunx expo prebuild --clean          # or: bunx expo prebuild -p android --clean
```

This writes the `android/` and `ios/` folders.

Then build and install a release version on a connected phone or emulator:

```sh
# Android
bunx expo run:android --variant release

# iOS
bunx expo run:ios --configuration Release
```

Or build with the platform tools yourself, in the same terminal window:

```sh
# Android: an APK in android/app/build/outputs/apk/release/
cd android && ./gradlew :app:assembleRelease

# iOS: an archive in build/SimplePrayer.xcarchive
xcodebuild -workspace ios/SimplePrayer.xcworkspace -scheme SimplePrayer \
  -configuration Release archive -archivePath build/SimplePrayer.xcarchive
```

If you build in the Xcode app instead, Xcode does not see `FOSS_BUILD=1` from your terminal.
Our keys are then packed into the app. Build from the terminal, as above.

Notes:

- **Android signing.** The generated project signs release builds with a debug key. That is
  fine for your own phone. To publish, make your own upload key and set it in
  `android/app/build.gradle`.
- **iOS signing.** `app.json` has our Apple team ID (`ios.appleTeamId`). Change it to yours, or
  pick your team in Xcode. The widgets and the Apple Watch app share data through an App Group.
  Xcode may not allow App Groups with a free Apple account.
- **Our own builds.** Without `FOSS_BUILD=1` you get our configuration. A release build then
  tries to upload debug files to Sentry. That needs `SENTRY_AUTH_TOKEN`, which only we have.

### What the switch removes

`app.config.ts` reads `app.json` and, when `FOSS_BUILD=1` is set, removes:

| Removed | What it was for |
|---|---|
| the `@sentry/react-native` plugin | uploads debug files to Sentry during a release build |
| `extra.sentryDsn` | where crash reports are sent |
| `extra.revenueCat` | the tip jar keys |
| `android.googleServicesFile` | Firebase, for Android push notifications |
| `extra.eas`, `owner`, `updates.url` | our Expo project and its app updates (updates are turned off) |

With `FOSS_BUILD=1` it also, for Android:

| Changed | Why |
|---|---|
| removes the `expo-location` plugin | Android location uses `modules/foss-location` instead (below) |
| removes the Wear OS app (`./plugins/withWearApp`) | watch sync needs Google Play services |
| uses the free adhan recordings as notification sounds | see section 7 |
| adds `./plugins/withKeepNotificationSounds` | keeps those sounds when a release build shrinks its resources |
| sets `android.versionCode` from `versionCode` in `package.json` | F-Droid reads the version from the code |

Everything else in `app.json` stays the same. You can check the result:

```sh
FOSS_BUILD=1 bunx expo config --type public
```

`scripts/foss-prepare.ts` changes what is linked into the Android app. Each library below
needs Google Play services, Google Play or Sentry, so it is left out. Its JavaScript is replaced by
a stand-in in `src/foss/` (`metro.config.js`):

| Left out | It was for | Instead |
|---|---|---|
| `expo-location` (Google's location service) | your location, the city name, the compass | `modules/foss-location`: Android's own location, geocoder and compass. Approximate location only, as before. |
| Firebase Cloud Messaging, in `expo-notifications` and `buddy-nicknames` | buddy notifications when the app is closed | nothing; buddy marks arrive when you open the app. Prayer reminders are local notifications and work as before. |
| `react-native-purchases` (Google Play Billing) | the tip jar | no tip jar |
| `expo-store-review` (Google Play In-App Review) | the "rate the app" prompt | no prompt. The "Rate the app" rows still open the store page. |
| `expo-application` (Google Play Install Referrer) | the build number on the About screen | the number from the app config |
| `@sentry/react-native` | crash reports | none |
| `modules/watch-sync` and the Wear OS apps | the watch app | no watch app |

It also deletes the four adhan recordings we have no licence for, and `google-services.json`. The
expo-notifications change is a patch, `patches/foss/expo-notifications@58.1.7.patch`.

`.github/workflows/foss-android.yml` builds this app on every push and fails if any of these
libraries comes back.

---

## 3. What is different without each service

**No crash reports.** Sentry never starts. The "Crash reports" switch is not shown in Settings.
The privacy note in Settings no longer lists crash reports.

**No tip jar.** Without a RevenueCat key the tip jar is not shown at all.

**Buddy marks arrive when you open the app.** Without FCM an Android phone cannot get a push
token. Buddy mode still works: the app asks the relay for new marks when it opens, when it comes
back to the front, and about every 30 seconds while it is open. You just do not get a
notification when the app is closed. On iOS, push uses Apple's service (APNs) through Expo's
push service, and that needs an Expo project, so the same is true there.

**No over-the-air updates.** Updates come from our Expo project, so they are turned off. To
get a new version, build again.

---

## 4. Adding your own keys

Each service is optional. Add only the ones you want. Then turn the switch off with
`unset FOSS_BUILD`, and run `prebuild` and the build again. The switch would remove your keys
too.

**Sentry (crash reports).**
1. Make a project at <https://sentry.io>.
2. Put its DSN in `app.json` at `expo.extra.sentryDsn`.
3. In the `@sentry/react-native` plugin entry in `app.json`, set `organization`, `project` and
   `url` to yours.
4. Set `SENTRY_AUTH_TOKEN` when you build a release, so the debug files can be uploaded.

If you keep a DSN, the app must say so to its users. `src/__tests__/privacyClaims.test.ts`
checks that the privacy note and `docs/PRIVACY_POLICY.md` mention crash reports.

**RevenueCat (tip jar).** Put your public SDK keys in `app.json` at `expo.extra.revenueCat.ios`
and `.android`. Create the products `tip_small`, `tip_medium` and `tip_large` in App Store
Connect and Google Play. `docs/TIP_JAR_RUNBOOK.md` has the details.

**FCM (Android push).**
1. Make a Firebase project and add an Android app with your package name.
2. Download its `google-services.json` to the project root.
3. Keep `android.googleServicesFile` in `app.json`.
4. Add the FCM credentials to your Expo project, so Expo's push service can send to Android.

**Expo (EAS) project.** Run `bunx eas init` to make your own project. It sets `extra.eas.projectId`
and `owner`. Set `updates.url` to `https://u.expo.dev/<your project id>`. Buddy push on both
platforms needs this project, because the push token comes from Expo.

---

## 5. Publishing a fork

You may publish your own version. Read `TRADEMARKS.md` first. In short: **give it your own name
and icon.** Do not call it "Simple Prayer", and do not use the mosque mark.

A fork also needs its own app IDs, because ours are taken in the stores. Change every item
below. Search the repo for `simpleprayer` to check you found them all.

**Name and icon**
- [ ] `app.json`: `expo.name`, `expo.slug`
- [ ] the icons and splash images in `assets/images/`, and `assets/appicon.icon`
- [ ] `CFBundleDisplayName` in `locales/en.json`, `ar.json`, `tr.json` and `ur.json` (the name under the
  icon on iPhone)
- [ ] store texts and screenshots, if you reuse anything from `docs/` or `docs/store-screens/`

**Phone app IDs**
- [ ] `app.json`: `ios.bundleIdentifier` and `android.package` (now `app.simpleprayer`)
- [ ] `app.json`: `ios.appleTeamId`
- [ ] `src/services/appInfo.ts`: `APP_PACKAGE_NAME`, `IOS_APP_STORE_ID` (used for "Rate the app"),
  `APP_WEBSITE_URL` and `FEEDBACK_URL`
- [ ] `app.json`: `scheme` (now `simpleprayer`)

**iOS extras: widgets, notifications, Apple Watch**
- [ ] `targets/widget/expo-target.config.js`: `app.simpleprayer.widget`
- [ ] `targets/notify/expo-target.config.js`: `app.simpleprayer.notify`
- [ ] `targets/watch/expo-target.config.js`: `app.simpleprayer.watchkitapp`
- [ ] `targets/watch-widget/expo-target.config.js`: `app.simpleprayer.watchkitapp.watchwidget`
- [ ] The App Group `group.app.simpleprayer`: in `plugins/withAppGroup.js` (`APP_GROUP`), in
  each `targets/*/expo-target.config.js`, and in `targets/watch/Info.plist` and
  `targets/watch-widget/Info.plist`. The widget works out the group from its own bundle ID
  (`<id>.widget` becomes `group.<id>`), so keep that pattern.
- [ ] The keychain name `app.simpleprayer.buddy` in
  `modules/buddy-nicknames/ios/BuddySecretStore.swift` and `targets/widget/BuddySender.swift`.
  These two must match each other.

**Wear OS app and watch face**
- [ ] `wear/build.gradle`: `applicationId` must equal your phone package. `namespace` can stay.
- [ ] `wear-face/build.gradle`: `applicationId` (now `app.simpleprayer.face`)
- [ ] `wear-face/src/main/res/raw/watchface.xml`: `primaryProvider` names the phone package
  (`app.simpleprayer/app.simpleprayer.wear.PrayerComplicationService`). Change the part before
  the `/`.
- [ ] The Kotlin package `app.simpleprayer.wear` in `wear/src/` does not have to change. Android
  only cares about the `applicationId`.

**Links that open the app (buddy invites)**
- [ ] `app.json`: `ios.associatedDomains` and the `android.intentFilters` host (`simpleprayer.app`)
- [ ] `src/components/InviteBuddySheet.tsx`: `PAIR_LINK_BASE` (`https://simpleprayer.app/b/`)
- [ ] On your own website: `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json`. Ours are in `website/public/.well-known/`. Put your team ID,
  bundle ID, package name and signing key fingerprint in them.

**Our services**
- [ ] Build with `FOSS_BUILD=1`, or add your own keys (section 4). Do not ship our Sentry DSN
  or RevenueCat keys.
- [ ] Delete our `google-services.json` and use your own, or none.
- [ ] Run your own buddy relay (section 6), or remove buddy mode.

**Privacy texts**
- [ ] `docs/PRIVACY_POLICY.md` and `docs/TERMS_OF_USE.md` name us. Write your own.
- [ ] The privacy note in the app (`settings.pledge.*` in `src/i18n/locales/`) says the buddy
  relay is "a relay of ours". Make sure it is true for your app.

The Kotlin packages in `modules/` start with `expo.modules.`, which is fine to keep.

---

## 6. Running your own buddy relay

Buddy mode sends one small message per prayer through a relay server. The relay code is open
too: <https://github.com/majani-plus/simple-prayer-relay>. It runs on Cloudflare Workers.
`docs/BUDDY_LAUNCH_GUIDE.md` shows how we deploy ours: the database, the secrets and the deploy
command. The relay sends notifications through Expo's push service, so it needs an Expo access
token from your own Expo account.

The app has the relay address in four places. Change all four to your relay's address:

- `src/services/buddyRelay.ts`: `RELAY_ORIGIN`
- `modules/buddy-nicknames/android/src/main/java/expo/modules/buddynicknames/BuddySender.kt`: `ORIGIN`
- `modules/buddy-nicknames/ios/BuddySender.swift`: `origin`
- `targets/widget/BuddySender.swift`: `origin`

The native ones are used when you mark a prayer from a notification or a widget, without
opening the app. The tests also name our relay address
(`src/__tests__/privacyClaims.test.ts` and `src/__tests__/buddiesScreen.test.tsx`). Change it
there too.

If you do not want buddy mode, you can leave the relay as it is. Buddy mode is off until a
person turns it on, and nothing is sent before that.

---

## 7. The adhan recordings

The app ships four adhan recordings (`assets/audio/`). `assets/audio/CREDITS.md` explains where
they came from: we could not find a licence for any of them. **A fork should replace them** with
recordings it has the right to use.

The FOSS Android build already does: it ships three recordings from Wikimedia Commons, under CC0
or CC BY, from `assets/audio/free/`. `CREDITS.md` and `THIRD_PARTY_NOTICES.md` list their authors
and licences. A fork can use these too, and must keep the credit for the CC BY ones.

To change them:

1. Put your files in `assets/audio/`. Each voice needs a full `.mp3` (Android) and a clip of
   30 seconds or less as `.caf` (iOS notification sounds have a 30-second limit).
2. List the files in the `expo-notifications` plugin's `sounds` in `app.json`.
3. Update `src/domain/adhanVoices.ts` and the `require` list in `src/hooks/adhanAssets.ts` (for
   the FOSS build: `src/foss/adhanAssets.ts`).
4. Update the reciters' names in the locale files and the credits on the About screen.
