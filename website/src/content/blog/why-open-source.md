---
title: "Simple Prayer is now open source"
description: "The full source of the Simple Prayer app is now public under the MIT license, so you can read it, build it and copy it."
date: "2026-11-08"
order: 1
tags: [open-source, privacy, announcement]
---

The source code of Simple Prayer is now public, under the MIT license. You can read every line of
the app, build it on your own computer, and publish your own copy. This post explains what the app
is, why we opened it, what it sends over the internet and what it does not, and how to help.

## What the app is

Simple Prayer is a prayer times app and a prayer log for iOS and Android. It shows the five daily
prayer times for where you are, the qibla direction, and the Hijri date. It can remind you when a
prayer starts. You can mark each prayer as prayed with one tap, from the app, from a notification,
or from a home-screen widget. It also runs on Apple Watch and Wear OS.

The app is free. It has no ads and no paid features. There is an optional tip in Settings. A tip
unlocks nothing; it is a way to say thank you, and that is the only money in it.

The app is built with Expo and React Native in TypeScript. The widgets and the watch apps are
native code: Kotlin on Android, Swift on iOS and watchOS. Prayer times come from
[adhan-js](https://github.com/batoulapps/adhan-js).

The code is © Majani Plus LLC and released under the MIT license.

## Why open it

**So you can check the privacy promises yourself.** A privacy policy is a list of promises. Before
today you had to trust them. Now you can read the code they describe. The policy names the files
behind each claim: `src/services/location.ts`, `src/services/telemetry.ts`,
`src/services/purchases.ts`, `src/services/notifications.ts`, `src/services/export.ts`, and the
database code in `src/db/`. A test, `src/__tests__/privacyClaims.test.ts`, fails the build if the
words in the app stop matching what the code does.

The server behind buddy mode was already public at
[majani-plus/simple-prayer-relay](https://github.com/majani-plus/simple-prayer-relay). Now the
other half is public too.

**So anyone can build it, or copy it.** The MIT license lets you use the code for any purpose,
including a published app of your own. The license covers the code. It does not cover the name
"Simple Prayer", the app icon or the app's look. Building the app for yourself and your family is
fine as it is. If you publish a copy, give it your own name and your own icon. `TRADEMARKS.md` in
the repository explains exactly what that means.

One more thing to know before you publish a copy. The four adhan recordings in `assets/audio/` are
not covered by the MIT license, and we have not confirmed the rights to them. Replace them with
recordings you have the rights to use. `THIRD_PARTY_NOTICES.md` lists this and the terms for every
font, library and data set in the repository.

**So translators can help.** The app is written in English, Arabic and Turkish today. Arabic and
Turkish are written by people, not copied from English by a machine. More languages need people who
speak them. `docs/TRANSLATING.md` explains how a translation is added and checked.

**So the reasons are public too.** The repository has a file called `docs/DECISIONS.md`. It holds
close to two hundred product and engineering decisions, each with the reason it was made. If
something in the code looks strange, the reason is usually there.

## What the app sends, and what it does not

We want to be exact here. Some things do go over the internet, and we list all of them.

Your prayer log is stored on your phone: your marks, your history, qada counts, exempt days and
your settings. It is a SQLite database and two small key-value stores in the app's private
storage. If you do not use buddy mode, none of what you record is sent anywhere.

Five things do go over the internet. The privacy policy describes each one in full. In short:

1. **Naming your city.** The app turns your approximate position, or the city name you type, into
   a place name. It asks your phone's own map service to do this: Apple's on iOS, Google's on
   Android. Your approximate position goes to Apple or Google at that moment. It never comes to us.
   The app asks only for approximate location, and only when you tap "Use my location".
2. **The update check.** When the app starts, it asks Expo's update service if newer code is
   available. The request carries your platform, the app version and a random install identifier.
   It carries no prayer log, no location and no settings.
3. **Crash reports.** These are **on by default**. If the app crashes, it sends one report to
   Sentry, on servers in the European Union. The report has a stack trace, your device model, the
   OS version and the app version. It also sends a marker when a session starts and ends, so we can
   see how often the app crashes. It has no prayer log, no location and no identity. Sentry deletes
   reports after 90 days. You can turn crash reports off in Settings. The change takes effect the
   next time the app starts.
4. **A tip, if you leave one.** Apple or Google takes the payment. RevenueCat checks the receipt
   for us. If you never open the tip section, none of this happens.
5. **Buddy mode, if you turn it on.** It is off by default. When it is on, each prayer you mark
   as prayed is sent through our relay to the person you paired with. The relay deletes a mark when
   their phone collects it, or after 24 hours. It keeps no logs.

There is no analytics SDK, no advertising, no account and no sign-in. If you use a watch, your
phone copies about two weeks of times and marks to it. That copy goes from phone to watch over the
link the two devices already have. It does not go through us.

The website, simpleprayer.app, sets no cookies and runs no analytics. The prayer times page works
out the times in your browser.

## Build it yourself

The full steps are in `docs/BUILD_YOURSELF.md`. The short version is one environment variable.

The app normally builds with three outside services: Sentry for crash reports, RevenueCat for the
tip jar, and Firebase Cloud Messaging for buddy notifications on Android. A build of your own should
not need our accounts or our keys. So `app.config.ts` has a switch. With `FOSS_BUILD=1` set, it
removes all three, and our Expo project as well:

```ts
export default ({ config }: ConfigContext): ExpoConfig =>
  process.env.FOSS_BUILD === '1'
    ? stripThirdPartyServices(config as ExpoConfig)
    : (config as ExpoConfig);
```

`stripThirdPartyServices` removes the Sentry plugin and its DSN, the RevenueCat keys,
`google-services.json`, and the EAS owner, project ID and update URL. It also switches app updates
off, because without our Expo project there is nowhere to get them from. A test,
`src/__tests__/appConfig.test.ts`, checks that each one is gone.

The app is written to work without them. With no Sentry DSN, `src/services/telemetry.ts` sends no
crash reports at all. With no RevenueCat key, the tip jar does not appear.

## Thank you

Simple Prayer is built on the work of many people who gave it away. We want to name some of them.

- **[adhan-js](https://github.com/batoulapps/adhan-js)** by Batoul Apps computes every prayer time
  in the app and on the website. It is MIT licensed and has sister libraries in Swift and Kotlin.
  We audited it in 2026 and sent fixes back. The next post on this blog tells that story.
- **[Amiri](https://github.com/aliftype/amiri)** is the Arabic typeface for the prayer names, the
  qibla title and the widgets.
- **[Noto Naskh Arabic](https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic)** sets all other
  Arabic text in the app. **Lora** sets the Latin text.
- **[ICU](https://icu.unicode.org/)** carries the Umm al-Qura month-length table. The app's own
  Hijri fallback in `src/domain/hijri.ts` uses that same table, taken from ICU and checked against
  it day by day. The app needs the fallback because the JavaScript engine in React Native does not
  always support the Umm al-Qura calendar.
- **[GeoNames](https://www.geonames.org/)** provides the city list on the website's prayer times
  page, under CC BY 4.0.
- **[Expo](https://expo.dev/)** and React Native are the base of the whole app. They let one small
  team ship to two phone platforms.

## How to help

Read `CONTRIBUTING.md` first. It explains how to set up the project, how to run the checks, and
what a good change looks like.

Some ways to help:

- **Report a wrong prayer time.** Tell us the city, the date, the method and the time your mosque
  publishes. A wrong time can cause real harm, so we treat it as a serious bug.
- **Translate.** Follow `docs/TRANSLATING.md`. Please also read `docs/TONE.md`. Most people who use
  the app do not read English as a first language, so every sentence should be short and plain.
- **Check our privacy claims.** If the code does something the privacy policy does not describe,
  that is a bug. Please tell us.
- **Build a copy of your own.** That is allowed, and it is part of why we opened the code.

## Read the code

- [app.config.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/app.config.ts)
- [docs/PRIVACY_POLICY.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/PRIVACY_POLICY.md)
- [docs/BUILD_YOURSELF.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/BUILD_YOURSELF.md)
- [docs/DECISIONS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/DECISIONS.md)
- [src/services/telemetry.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/services/telemetry.ts)
- [src/__tests__/privacyClaims.test.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/__tests__/privacyClaims.test.ts)
- [CONTRIBUTING.md](https://github.com/majani-plus/simple-prayer-app/blob/main/CONTRIBUTING.md)
- [TRADEMARKS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/TRADEMARKS.md)
- [THIRD_PARTY_NOTICES.md](https://github.com/majani-plus/simple-prayer-app/blob/main/THIRD_PARTY_NOTICES.md)
- [docs/TRANSLATING.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/TRANSLATING.md)
