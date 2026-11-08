---
title: "Prayer times above the Arctic Circle"
description: "What goes wrong when you calculate prayer times in Tromsø, how Simple Prayer checks and repairs the times, and how tests keep the app and the website in agreement."
date: "2027-01-19"
tags: [prayer-times, high-latitude, adhan-js, testing]
---

Prayer times are defined by the sun. Far from the equator, the sun stops doing some of the things
those definitions expect. In Tromsø, Norway, at 69.6° north, there are weeks when the sun never
sets and weeks when it never rises. This post explains the three things that break at these
latitudes, what Simple Prayer does about each one, and the tests that keep the app and our website
showing the same times.

## How the times are defined

Each prayer time is tied to an event in the sky:

- **Fajr** starts when the sun is a set angle below the horizon before sunrise. For the Muslim
  World League method, that angle is 18°.
- **Dhuhr** starts just after the sun passes its highest point.
- **Asr** starts when a shadow reaches a set length. For the Shafi school it is the object's height
  plus its shadow at noon. For the Hanafi school it is twice the height plus the noon shadow.
- **Maghrib** starts at sunset.
- **Isha** starts when the sun is a set angle below the horizon after sunset, 17° for the Muslim
  World League.

The app computes all of these with [adhan-js](https://github.com/batoulapps/adhan-js). Our own code
in `src/domain/` decides which method and settings to pass in, and checks what comes back.

## Problem one: the night never gets dark enough

In summer, from about 48° latitude northward, the sun may not go 18° below the horizon at all.
Paris and Munich are near that line. The sky never gets dark enough for the usual Fajr or Isha. The
formula has no answer.

Scholars give three common rules for this case. Each one uses a part of the night, measured from
sunset to sunrise:

| Rule | Isha is no later than | Fajr is no earlier than |
|---|---|---|
| Middle of the night | sunset + ½ of the night | sunrise − ½ of the night |
| Seventh of the night | sunset + 1/7 of the night | sunrise − 1/7 of the night |
| Twilight angle | sunset + (angle ÷ 60) of the night | sunrise − (angle ÷ 60) of the night |

The library uses the rule's time whenever the normal time is missing or falls outside that limit.

You can pick a rule in Settings. The default is "auto", which asks the library for its
recommendation: seventh of the night above 48°, middle of the night below. When your location is
at 48° or more, north or south, the Settings screen opens this choice for you and says it applies
to you. Below that line, it says the choice changes nothing where you are.

"North or south" matters. The library's `recommended()` tested `latitude > 48`, with no
`Math.abs`. So places far south, such as Ushuaia in Argentina, got the mild rule. We fixed this in
`src/domain/methods.ts` by passing the latitude's absolute value. We also sent the fix to the
library, and it was merged there (D121; adhan-js
[#233](https://github.com/batoulapps/adhan-js/pull/233)).

## Problem two: the sun does not rise or set

Above the polar circle there are days with no sunrise or no sunset. Then there is no night to
divide, and the rules above have nothing to work with.

The library offers a setting called `PolarCircleResolution`. The app sets it to `AqrabBalad`,
Arabic for "the nearest city". For a day with no sunrise or sunset, the library moves the latitude
toward the equator in steps of 0.5° until it finds a place where every time exists. It uses that
place's times. From `buildParameters` in `src/domain/methods.ts`:

```ts
params.highLatitudeRule = adhanHighLatitudeRule(opts.highLatitudeRule, opts.coordinates);
params.polarCircleResolution = adhan.PolarCircleResolution.AqrabBalad;
```

Without it, the library's old default returned invalid dates for these days, and the app would
have had no times to show.

This approach can make times jump between one day and the next near the start and end of polar
day. We measured jumps of up to an hour and reported them upstream. The maintainer explained why
this is the intended behaviour: half a degree is about 30 miles, a realistic distance to the next
city. We accepted that and use the setting as it is (adhan-js
[#214](https://github.com/batoulapps/adhan-js/issues/214)).

## Problem three: Asr after Maghrib

This one was a bug, not a gap in the definitions. In deep winter above about 66°, the sun can rise
and set while its height at noon stays at or below zero. A shadow never gets short enough to
measure Asr from. The library's Asr formula uses `tan(|latitude − declination|)`. Past 90°, the
tangent changes sign, and the library returned a time that looked normal but was wrong.

Here is Tromsø on 14 January 2026 with adhan 4.4.4, in local time:

| | adhan 4.4.4 |
|---|---|
| Sunrise | 11:05 |
| Dhuhr | 11:54 |
| Asr | **12:46** |
| Maghrib | 12:42 |

Asr comes four minutes after Maghrib. In 2026, Tromsø had 45 days like this. Other days had Asr on
the next calendar day. The polar setting did not help, because sunrise and sunset did exist on
those days (D121).

## How the app checks and repairs

Every prayer time the app shows passes through one function, `computeRaw` in
`src/domain/prayerTimes.ts`. The day screen, the reminders and the widgets all use it. So any check
placed there covers them all. The Asr check is `repairAsr`:

```ts
if (!Number.isFinite(dhuhr) || !Number.isFinite(maghrib)) return;
if (maghrib <= dhuhr) return;
if (Number.isFinite(asr) && (asr as number) > dhuhr && (asr as number) < maghrib) return;

const estimated = dhuhr + (maghrib - dhuhr) * ASR_TAQDIR_FRACTION;
```

If Asr is missing, or falls outside Dhuhr to Maghrib, the app places it halfway between them. This
is an estimate (taqdir). It is the same idea the night rules above use for Fajr and Isha. On these
days the shadow never reaches either school's length, so one estimate serves Shafi and Hanafi
alike. A healthy Asr is never changed.

We also sent a fix to the library. The maintainer wrote a broader one
([#232](https://github.com/batoulapps/adhan-js/pull/232)). It checks that the sun really reaches
the Asr angle on that day. If any two times are out of order, or less than five minutes apart, it
marks the whole day as invalid. Then the library uses `AqrabBalad` for that day. The app now carries this upstream
code as a patch until it is released on npm (D187). Here is the same day with the patch:

| | adhan 4.4.4 | App today |
|---|---|---|
| Sunrise | 11:05 | 10:26 |
| Dhuhr | 11:54 | 11:54 |
| Asr | 12:46 | 12:16 |
| Maghrib | 12:42 | 13:21 |

Notice that sunrise and Maghrib moved too, not only Asr. On a day the library marks invalid, the
whole day is taken from the nearest latitude where all five prayers exist. `repairAsr` stays in the
app as a fallback, in case a future version of the library lets a bad Asr through again.

These times are estimates. Many Muslims who live this far north follow the timetable of their local
mosque. The app lets you shift each prayer by up to 30 minutes in Settings so it matches.

## The tests

Tromsø has its own set of tests in `src/domain/prayerTimes.test.ts`. Among them:

- Asr falls strictly between Dhuhr and Maghrib on **every** day of 2026. The test does not skip
  days, because the bug is seasonal and a weekly sample could miss it.
- One day from every week of the year is computed under each of the four high-latitude settings,
  and none of them throws an error.
- On midsummer's day the night is short but real: under three hours from Maghrib to the next
  Fajr.
- Svalbard, at 78.2° north, gets valid times in midsummer and midwinter.

These tests check that times are in order. They do not check exact minutes. A library update that
moved every time by two minutes would pass them. For that we have golden tests.

## Golden values

A golden test freezes exact output and fails if any of it changes.
`src/domain/prayerTimes.golden.test.ts` freezes the times for eleven cities, each under its own
method, on one day in January and one in August, plus a few far-future dates (D118). The app allows adhan
updates, and these values are what make that safe. An update that moves any frozen minute fails
the build. Then someone has to check the new time against the authority's own timetable before
accepting it (D120).

The website shows prayer times too, at simpleprayer.app/times. It does not have its own prayer
time code. At build time, `website/scripts/generate-domain.ts` copies the app's `src/domain` files
into the website. Then `website/scripts/verify-times.ts` checks the result against
`website/data/prayer-goldens.json`. That file holds 1,274 values: 13 cities, including Tromsø and
Reykjavik, six days each, both schools of Asr, eight times per day, plus the qibla for each city.
If one value does not match to the millisecond, the website does not build (D152).

The first version did this differently, and it taught us something. It compared the website's code
with the app's code, live, in one process. That passed on our computers. On the first deploy to
Cloudflare, it reported 99 differences. The reason: our patch to adhan is applied by bun, the
package manager we use. Cloudflare installed the app's packages with npm, which ignores bun's patch
setting. So the "app" side of the comparison was running unpatched adhan. One of the differences
was Tromsø's December Asr, by 14 minutes. The site was right. The baseline was wrong.

So now the baseline is a file of frozen numbers. Nothing in the website build depends on how
someone else installed the app's packages. Before it checks a single value, `verify-times.ts` also
confirms that the website's own copy of adhan has the patch applied.

## Read the code

- [src/domain/prayerTimes.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/domain/prayerTimes.ts)
- [src/domain/methods.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/domain/methods.ts)
- [src/domain/prayerTimes.test.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/domain/prayerTimes.test.ts)
- [src/domain/prayerTimes.golden.test.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/domain/prayerTimes.golden.test.ts)
- [website/data/prayer-goldens.json](https://github.com/majani-plus/simple-prayer-app/blob/main/website/data/prayer-goldens.json)
- [website/scripts/verify-times.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/website/scripts/verify-times.ts)
- [patches/adhan@4.4.6.patch](https://github.com/majani-plus/simple-prayer-app/blob/main/patches/adhan@4.4.6.patch)
- [docs/DECISIONS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/DECISIONS.md) (D118, D120, D121, D122, D152, D187)
