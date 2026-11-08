---
title: "Arabic typography in a three-language app"
description: "How Simple Prayer chooses Arabic fonts, sizes, digits and plural forms, and what we measured in the font files to get there."
date: "2026-11-08"
order: 7
tags: [arabic, typography, i18n, rtl, react-native]
---

Simple Prayer is written in English, Arabic and Turkish. Arabic needs its own typefaces, its own size, its own digits and its own plural rules, and the layout has to turn around. Most of what we got wrong came from numbers we assumed instead of measuring. This post shows what we measured in the font files, what we changed, and the tests that now hold it in place.

## Thanks first

Two Arabic typefaces carry this app, and both are free for anyone to use under the SIL Open Font License 1.1.

**Amiri** is designed by Khaled Hosny and published by Alif Type. The Arabic prayer names on Today, the qibla title and the Wear watch face are set in Amiri.

**Noto Naskh Arabic** is part of Google's Noto project. Its font files credit the Monotype Design Team, David Williams, Mohamad Dakak and Nizar Qandah. It has four real weights, and every line of Arabic interface text in the app is set in it.

We are grateful to everyone who made these fonts and shared them. The app's About screen credits both.

## Two Arabic faces, two jobs

For a while, Amiri did everything. That caused two problems, and the owner summed them up on 2026-08-29: "UI is awful compared to English. Arabic font sizes and readability." (D135)

The first problem was weight. Amiri ships Regular (400) and Bold (700) only, and React Native does not invent weights. The app picked Amiri Bold for anything that asked for 600 or more. The default list text asks for 600, so all Arabic body text came out Bold. The quiet captions ask for 500, so they became Regular and almost disappeared. Arabic had one usable weight where English had four.

So the jobs were split (D135):

- **Lora** sets Latin text.
- **Amiri** sets the text that was designed as Arabic calligraphy: the large Arabic prayer name, the small Arabic name that goes with each Latin prayer name, the qibla title and the watch face.
- **Noto Naskh Arabic** sets everything else once the app language is Arabic.

The mapping from a requested weight to a Noto Naskh file is now direct:

```ts
function arabicUiFamily(weight: AppTextWeight): string {
  if (weight >= 700) return fonts.arabicUiBold;
  if (weight >= 600) return fonts.arabicUiSemiBold;
  if (weight >= 500) return fonts.arabicUiMedium;
  return fonts.arabicUi;
}
```

## 337 against 500: measuring the body of a letter

The second problem was size. Arabic letters draw a smaller body than Latin letters at the same font size. The app makes up for this with one constant, `arabicTypeScale = 1.15`, which multiplies any Latin-designed size that is set in Arabic.

The constant is a ratio of heights. For Lora, that is the x-height: 500 units out of 1000. For Arabic, D135 uses the height of the letter ه (heh) as the body height. The old comment said the constant was 500 / 433.

D135 records what the font files say:

| Face | What was measured | Height (per 1000 units) |
|---|---|---|
| Lora 400 | Latin x-height | 500 |
| Amiri 400 | Arabic ه | 337 |
| Noto Naskh Arabic 400 | Arabic ه | 433 |

433 is the height of Noto Naskh's ه, not of Amiri's, which is about a third shorter than Lora's x. To match Lora, Amiri would have needed a scale near 1.48, not 1.15. Arabic interface text had been rendering about a fifth smaller than the design meant. That is the most likely reason three separate reports (D67, D74, D97) all asked for the same text to be made bigger.

When we re-read the shipped TTF for this post, Amiri's isolated ه measured 331 rather than 337, which moves the needed scale to about 1.51. The conclusion is the same. Amiri's OS/2 table also declares an x-height of 433. That field describes the Latin x, not Arabic letters, so a ratio built from it would be wrong in the same way.

Moving interface text to Noto Naskh made the constant true as written: 500 / 433 is about 1.15. It is applied in one place, the `AppText` component. The two Amiri styles chose their sizes for Amiri already, so the scale skips them.

A few smaller rules sit in the same component:

- **Small text gets one step heavier.** Arabic text below 13 pixels after scaling that asked for less than 600 is set in Noto Naskh SemiBold, so captions stay readable (D54, amended by D135).
- **No letter spacing for Arabic.** Arabic letters join, and extra tracking opens gaps in the joins, so `AppText` removes `letterSpacing` for Arabic.
- **A floor on line height.** Where a line height is set, Arabic interface text gets at least 1.45 em, so the tails below the baseline have room.

## Digits, pinned per region

The Arabic-speaking world uses two sets of digits. Egypt, Saudi Arabia, Iraq, Jordan and others use Arabic-Indic digits (٠١٢٣). Morocco, Algeria, Tunisia, Libya and, in recent CLDR data, the UAE use Western digits (0123). Neither is wrong. A Moroccan reader shown ٥ is served as badly as an Egyptian reader shown 5 (D40).

The app's language picker offers one "العربية", so the language tag is plain `ar`. In current CLDR data, plain `ar` resolves to Western digits; it used to resolve to Arabic-Indic. React Native's Hermes engine uses the phone's own ICU data, so the same build could print `٢٠:٤٧` on one phone and `20:47` on another.

So the app decides, and then pins the answer (`src/i18n/numerals.ts`):

1. If the language tag has a region, that region decides.
2. Otherwise the phone's formatting region decides.
3. If there is no region at all, the answer is Western digits, which every Arabic reader can read.

A setting also lets people choose directly, because Android has no separate formatting region and the guess in step 2 can be wrong there.

Pinning turned out to be harder than writing the answer into the tag. On iOS, Hermes ignores the `-u-nu-arab` extension. This was measured on the simulator. Putting the region in the tag instead, as `ar-SA`, switches the whole locale, including the calendar. The Today header, which shows the Gregorian and Hijri dates side by side, printed the Hijri date twice (D136).

The fix is to correct the output. Every number and date the app shows goes through `formatNumber` or `formatDate`, and those rewrite the digits they get back:

```ts
export function enforceNumberingSystem(text: string, system: NumberingSystem): string {
  return system === 'arab'
    ? text.replace(/[0-9]/g, (d) =>
        String.fromCharCode(ARABIC_INDIC_ZERO + d.charCodeAt(0) - ASCII_ZERO)
      )
    : text.replace(/[\u0660-\u0669]/g, (d) =>
        String.fromCharCode(ASCII_ZERO + d.charCodeAt(0) - ARABIC_INDIC_ZERO)
      );
}
```

## Tabular figures, measured from the TTFs

A column of prayer times must line up, and a countdown must not shift every second, so digits must be of equal width. Lora's default digits are proportional, so the app asks for its `tabular-nums` feature.

For Arabic, alignment rests on the default digits being equal width. That could change in a font update, so `tabularFigures.test.ts` checks it. It reads each digit's advance width straight from the shipped TTF's `cmap` and `hmtx` tables, with no font library:

- Amiri 400 and 700: every Arabic-Indic digit is 585 units wide, and every Western digit is 532.
- Noto Naskh Arabic: each weight has one width for all ten Arabic-Indic digits (449, 462, 475 and 488 from Regular to Bold) and one for Western digits.
- Lora has no Arabic-Indic digits at all. The test records that too, because it is why Lora must never set Arabic text: the digits would fall back to a system font mid-column.

## Counted nouns

Arabic has a dual. One day is يوم, two days is يومان. That is good grammar in a sentence, but the app shows a large number next to its noun. With CLDR's dual form, the streak read «٢ يومان متتاليان», which says "two" twice.

The rule since D139: when a digit is shown next to its noun, the noun does not also carry the count. So the streak reads «٢ يوم متتالٍ», and «٦ أيام متتالية» and «٤٦ يومًا متتاليًا» follow the normal number agreement. All six CLDR forms are still in the file, written to this rule.

The opposite case stays as it is. Where the Arabic word replaces the number, as in a duration, the dual stands alone: «ساعتين» means "two hours", and «٢ ساعة» would read worse.

None of this worked at first: Hermes has no `Intl.PluralRules`. Without it, i18next fell back to a one-or-other rule, and all 76 Arabic zero, two, few and many forms could never be reached (D136). The app now loads `@formatjs/intl-pluralrules` with Arabic, English and Turkish data. Jest runs on Node, which has full ICU, so `plurals.test.ts` checks the polyfill import itself.

## Widgets that turn around

The app's direction follows the app language, not the phone's (D41). Widgets run in another process, which takes its direction from the system. So the widget snapshot carries an explicit `rtl` flag.

On iOS, the widget views set `.environment(\.layoutDirection, …)` from that flag. The Live Activity's Dynamic Island regions once missed it, so an Arabic user on an English phone saw the lock screen card mirrored and the Island not. Each expanded region now sets it too.

On Android, a home-screen widget is a `RemoteViews` layout, and it cannot change a `TextView`'s font at runtime. So each widget layout has an Arabic twin with `android:layoutDirection="rtl"` and the Arabic fonts and sizes. `scripts/derive-arabic-layouts.ts` generates these twins from the Latin layouts, and `widgetLayouts.test.ts` fails if they drift. A `layout-ar/` folder would not work for live widgets, because the launcher picks resources by the system language, not the app's.

## Read the code

- [src/theme/typography.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/theme/typography.ts): the faces, the scale and its measurements
- [src/components/AppText.tsx](https://github.com/majani-plus/simple-prayer-app/blob/main/src/components/AppText.tsx): where every rule above is applied
- [src/i18n/numerals.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/i18n/numerals.ts): choosing and enforcing digits
- [src/i18n/__tests__/tabularFigures.test.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/i18n/__tests__/tabularFigures.test.ts): digit widths from the TTFs
- [src/i18n/__tests__/plurals.test.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/i18n/__tests__/plurals.test.ts): the counted-noun rule and the polyfill
- [scripts/derive-arabic-layouts.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/scripts/derive-arabic-layouts.ts): Arabic widget layouts on Android
- [docs/DECISIONS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/DECISIONS.md): D40, D41, D54, D135, D136 and D139
