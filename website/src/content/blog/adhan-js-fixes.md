---
title: "Auditing adhan-js, and the fixes we sent upstream"
description: "We audited the prayer-time library behind Simple Prayer, found five defects and one packaging bug, and sent a fix for each one back to the library."
date: "2027-01-12"
tags: [adhan-js, prayer-times, open-source, upstream]
---

Every prayer time in Simple Prayer comes from [adhan-js](https://github.com/batoulapps/adhan-js), an
open-source library by Batoul Apps. In August 2026 we audited version 4.4.4. The
astronomy was sound. We did find five real defects and one packaging bug. We sent a fix for each
one back to the library. Today all six are fixed in the library's source code. One is already
released; the other five are waiting for the next release. This post explains what we found, who
fixed what, and how the app carried the fixes while it waited for a release.

## The library

Adhan is a family of libraries for Islamic prayer times. Batoul Apps maintains
[adhan-js](https://github.com/batoulapps/adhan-js),
[adhan-swift](https://github.com/batoulapps/adhan-swift) and
[adhan-kotlin](https://github.com/batoulapps/adhan-kotlin), plus
[adhan-testdata](https://github.com/batoulapps/adhan-testdata), a shared set of prayer times that
all three test against. The main [Adhan](https://github.com/batoulapps/Adhan) repository also lists
ports by other people in C#, C, Rust, Dart, Python and Go. All of it is MIT licensed.

The solar math comes from Jean Meeus's book *Astronomical Algorithms*. Many prayer apps, websites
and mosque screens are built on one of these libraries. That is why a bug fixed there helps far
more people than a bug fixed in one app.

## Why we audited it

Our own tests checked that prayer times were in order and in a plausible range. They did not check
exact minutes. A library update that moved every time by two minutes would have passed them all.
So on 2026-08-27 we added "golden" tests that freeze exact times for many cities, methods and
seasons (D118). The same day, we asked a second question: had anyone checked the library itself?
(D121)

The audit found the astronomy faithful. It reproduces Meeus's own worked examples to the last
digit. It drifts by no more than five minutes over 2,100 years. It has no tables that will expire.
The problems were in the code around the astronomy.

## What we found, and what happened to each fix

Ronny Majani (`ronnymajani`) opened six pull requests and one issue on 2026-08-27. The maintainer,
Ameir Al-Zoubi (`z3bi`), reviewed all of them. Here is where each one ended up.

### Asr in deep polar winter: #208, fixed by #232

Above about 66° latitude in deep winter, the sun can rise and set while its height at noon stays at
or below zero. The Asr formula uses `tan(|latitude − declination|)`. Past 90° the tangent changes
sign, and the library returned a time that looked normal but was not. In Tromsø, stock adhan 4.4.4
gave this for 14 January 2026, in UTC:

```
dhuhr   10:54
maghrib 11:42
asr     11:46   (after Maghrib)
```

We counted 45 days like this in Tromsø in 2026. Our pull request,
[#208](https://github.com/batoulapps/adhan-js/pull/208), made the function return "no such time"
when the Asr condition cannot happen.

The maintainer went further. [#232](https://github.com/batoulapps/adhan-js/pull/232) is the
maintainer's own, broader rewrite. It checks that the Asr angle is one the sun really reaches that
day, and that the result falls after noon. It refines the hour-angle step the way Meeus
recommends. As a final guard, it marks a whole day invalid if any two prayer times are out of order
or less than five minutes apart. It adds a test that sweeps the whole globe. #208 was closed in its
favour: "this has now been resolved in #232".

### The southern hemisphere: #209, rebased as #233

`HighLatitudeRule.recommended()` picks a stronger rule above 48° latitude. It tested
`latitude > 48` with no `Math.abs`, so places far south, such as Ushuaia, got the mild rule.
[#233](https://github.com/batoulapps/adhan-js/pull/233) fixes it. Its description says "Rebased
from #209 by @ronnymajani".

### Rounding up an exact minute: #210, merged as #234

The Singapore method rounds times up to the next minute. The code added `60 − seconds`. For a
time already on the minute, that is 60 seconds, so 05:30:00 became 05:31:00. A second problem: the
rounding kept milliseconds, so some "rounded" times were not on the minute at all.
[#234](https://github.com/batoulapps/adhan-js/pull/234) keeps our commit and adds the maintainer's
change to round the same way as the Swift and Kotlin ports. In our own golden tests, this fix moved
Jakarta's Asr on 15 January 2026 from 15:28 to 15:27. The old value was the bug (D122).

### Sunnah times ignored rounding: #213, merged as #235

The middle of the night and the last third of the night were always rounded to the nearest
minute, whatever the method said. [#235](https://github.com/batoulapps/adhan-js/pull/235) keeps our
commit, which passes the rounding setting through, and adds the maintainer's tests.

### Errors thrown as strings: #211, merged as #236

Two places threw a bare string instead of an `Error`. A string has no stack trace and no
`message`, so crash reporters handle it badly.
[#236](https://github.com/batoulapps/adhan-js/pull/236) keeps our commit and adds a test from the
maintainer.

### The CommonJS build: #212, merged directly

The package says `"type": "module"`, so Node read the CommonJS build as an ES module and
`require('adhan')` failed. Bundlers hid this, so app users never saw it. Plain Node scripts did.
[#212](https://github.com/batoulapps/adhan-js/pull/212) writes a small `package.json` with
`"type": "commonjs"` into `lib/cjs`. It was merged on 2026-08-31 and shipped the same day in
[adhan 4.4.6](https://github.com/batoulapps/adhan-js/releases/tag/v4.4.6).

### Day-to-day jumps near the polar circle: issue #214, declined

When the sun does not rise or set, the `AqrabBalad` setting ("nearest city") borrows times from
the nearest latitude where it does. We measured jumps of up to about an hour from one night to the
next, for example Isha in Tromsø between 14 and 15 September. We named two causes: the search
moves in steps of 0.5° of latitude, and a day is replaced when only tomorrow is unresolvable. We
filed [#214](https://github.com/batoulapps/adhan-js/issues/214) as an issue, not a pull request,
because the fix changes outputs at every polar location. That is the maintainer's decision to make.

The maintainer closed it, and the reasons are fair. Half a degree of latitude is about 30 miles,
which is a realistic distance to the next city, and "aqrab balad" means "the nearest city". And at
these latitudes the prayer times depend on the length of the night. If tomorrow's sunrise cannot
be found, the length of the night is not known, so treating the day as unresolved is correct. We
accept that answer. The app uses `AqrabBalad` as it is.

## How the app carried the fixes

Fixes merged upstream do not reach an app until they are released. We needed correct times in the
meantime. This happened in three steps.

**First, repairs at our own seam (D121).** We did not edit the library. In
`src/domain/prayerTimes.ts`, every computation passes through one function, and `repairAsr` runs
there. If Asr is missing or falls outside Dhuhr to Maghrib, it places Asr halfway between them.
This is an estimate (taqdir), the same idea the library already uses for Fajr and Isha at high
latitudes. A healthy Asr is never touched:

```ts
if (Number.isFinite(asr) && (asr as number) > dhuhr && (asr as number) < maghrib) return;

const estimated = dhuhr + (maghrib - dhuhr) * ASR_TAQDIR_FRACTION;
```

For the southern hemisphere bug, `src/domain/methods.ts` passes `Math.abs(latitude)` to
`recommended()`. When the library gained its own `Math.abs`, this became a no-op.

**Second, a patch to the package (D122).** We then used `bun patch` to apply the same fixes we had
sent upstream to the installed library, in both `lib/cjs` and `lib/esm`. Bun ties a patch file to
one exact version. So we pinned adhan to that exact version. Any upgrade had to be deliberate: drop
or remake the patch, then let the golden tests decide.

**Third, carrying upstream's own code (D187, corrected by D201).** By 29 October 2026, fixes for
all five defects were merged into adhan-js's development branch: three with our commits, two
written by the maintainer. None of it was on npm yet. So
the app's patch, `patches/adhan@4.4.6.patch`, now carries upstream's `develop` branch at commit
`93b3ede`. We built it from upstream's source with the app's own Babel and `tsc`, and replaced only
the ten changed modules. Two behaviours changed: the library's default polar setting is now
`AqrabBalad`, which the app already used, and Tromsø's winter Asr now comes from the library
instead of from `repairAsr`. `repairAsr` stays in place as a fallback.

At the time of writing, in November 2026, the newest version on npm is still 4.4.6. The plan is
simple: on the day adhan publishes a newer version, we delete the patch.

## Thank you

Thank you to Ameir Al-Zoubi and Batoul Apps. We sent seven reports in one afternoon, and each one
was read and answered. Where the maintainer saw a better fix, the better fix was written, tested
across the whole globe, and merged. Where our commits could be used, they were kept with our name
on them. Where a fix was rebuilt, the pull request said whose work it came from. Where the
maintainer disagreed, the reasons were written down clearly.

A lot of Islamic software is built on adhan-js and its sister libraries. If your app depends on
it, consider reading its code, testing it at unusual places and dates, and sending what you find
back.

## Other building blocks

Simple Prayer also relies on:

- **[Amiri](https://github.com/aliftype/amiri)**, the Arabic typeface for prayer names in the app
  and on the widgets.
- **The Umm al-Qura calendar data in [ICU](https://icu.unicode.org/)**. Our Hijri fallback in
  `src/domain/hijri.ts` uses the same month-length table, taken from ICU and checked against it day
  by day.
- **[GeoNames](https://www.geonames.org/)**, the source of the city list on our website's prayer
  times page (CC BY 4.0).

## Read the code

- [src/domain/prayerTimes.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/domain/prayerTimes.ts)
- [src/domain/methods.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/domain/methods.ts)
- [patches/adhan@4.4.6.patch](https://github.com/majani-plus/simple-prayer-app/blob/main/patches/adhan@4.4.6.patch)
- [src/domain/prayerTimes.golden.test.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/domain/prayerTimes.golden.test.ts)
- [docs/DECISIONS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/DECISIONS.md) (D118, D120, D121, D122, D187, D201)
