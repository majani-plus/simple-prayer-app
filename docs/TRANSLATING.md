# Translating Simple Prayer

Simple Prayer is in English, Arabic, Turkish and Urdu. If you speak another language, or you can
make one of these better, thank you. This page explains how.

## First step: open a translation issue

Before you start, please
[open a translation issue](https://github.com/majani-plus/simple-prayer-app/issues/new?template=translation.yml).
Tell us the language, and whether you want to fix something or add a whole language. A new
language is a lot of work, for you and for us, so it helps to agree on it first. We can also put
you in touch with others working on the same language.

## The rule

**Write for the reader, and say how the text was made.** A language may start from a machine or
AI draft. Urdu did (D210). A fluent speaker's review is always welcome, and a correction from
someone who reads the language every day is the most useful help we get. If a language has not yet
been checked by a native speaker, the website says so plainly.

Write the language the way its readers speak it. A locale file is not a copy of the English one.
If a sentence would sound better said another way in your language, say it the other way. Keep
the meaning exactly the same, and keep every promise exactly as strong as the English.

All text follows [TONE.md](TONE.md): plain words, short sentences, no idioms, no marketing voice.
TONE.md also lists the habits to avoid in Arabic and Turkish. Each new language will have its own,
and we would be glad if you wrote them down there.

## Religious words

Use the words people in your language already use, at home and at the mosque. Do not invent a
translation, and do not explain a word that everyone knows.

- **Prayer names.** Use the names people say: in Turkish, *sabah, öğle, ikindi, akşam, yatsı*; in
  Arabic, *الفجر، الظهر، العصر، المغرب، العشاء*. If your language uses the Arabic names, use them
  in the spelling your readers know.
- **Other terms** (qada, qibla, adhan, imsak, the words for menstruation and the time after
  childbirth): use the common local word. Turkish uses *kaza, kıble, ezan*. If there are two
  common words, choose the one an ordinary person would use, not the scholarly one.
- **Calculation authorities** keep their own names ("Diyanet", "Umm al-Qura", "ISNA").
- **Tips.** Use the word for a tip you leave a waiter. Never a word for donation, charity, sadaqah
  or zakat. Apple rejects apps that use those words for in-app purchases.

If you are not sure which word is most common, ask in the issue. Getting these words right is part
of why people trust the app.

## Improving an existing language

1. Find the text in `src/i18n/locales/ar.json`, `tr.json`, `ur.json` or `en.json`. Search for
   the English words you see in the app.
2. Change the value, not the key. Keep any `{{placeholders}}` exactly as they are.
3. Some text also lives outside those files: widgets, watches and the website. The list below
   shows where. If the same sentence is there too, change it there as well.
4. Run `bun run test src/i18n` to check nothing broke.
5. Open a pull request, and say why the new wording is better. A second fluent speaker will
   review it.

## Adding a new language

This is everything a new language touches. `xx` stands for the language code (for example `ur`
or `id`). Copy what Turkish does, or Arabic if the language is written right to left.

### The app

- `src/i18n/locales/xx.json`: every string in the app. Start from `en.json` and write each one.
- `src/i18n/index.ts`: add `xx` to `SUPPORTED_LANGUAGES` and to `resources`, and add
  `import '@formatjs/intl-pluralrules/locale-data/xx.js';` beside the others so plurals work.
- `src/i18n/direction.ts`: if the language is written right to left, make sure it is in
  `RTL_LANGUAGES`.
- `src/i18n/script.ts`: `scriptFamilyFor` decides which fonts draw the language. A new script
  needs a font in `src/theme/typography.ts` and `app.json`, and a case in `AppText`, like Urdu's
  Nastaliq (D210).
- `src/i18n/numerals.ts`: decides which digits a language shows. If your readers use their own
  digits (as many Arabic readers do), check what `numberingSystemFor` does for your language.
- `src/domain/types.ts`: add `'xx'` to `LanguagePreference`.
- `src/stores/settingsStore.ts`: add `'xx'` to `LANGUAGE_PREFERENCES`.
- `src/app/(tabs)/settings.tsx`: add the language to the language picker.
- `settings.home.appearance.language.xx` in **every** locale file. It is the language's name in
  its own language (like "Türkçe"), so it is the same in every file.
- `src/i18n/__tests__/locales.test.ts`: add `settings.home.appearance.language.xx` to
  `SHARED_WITH_ENGLISH`, since it is the same in every file.
- `src/components/CalendarMonth.tsx`: `weekStartForLanguage` decides whether the week starts on
  Sunday or Monday. Set it for your language.

### What the phone shows outside the app

- `locales/xx.json` (at the top of the repository): the text the phone itself shows, such as the
  location permission question. Add it to `expo.locales` in `app.json` as well.
- iPhone widgets and Apple Watch: `targets/widget/BundledStrings.swift`,
  `targets/watch/WatchBundledStrings.swift` and `targets/watch-widget/WatchBundledStrings.swift`.
  Each has a `case` per language.
- Android widgets: `modules/prayer-widgets/android/src/main/res/values-xx/strings.xml`.
- Wear OS: `wear/src/main/res/values-xx/strings.xml` and
  `wear-face/src/main/res/values-xx/strings.xml`.

### The website

- `website/src/i18n/xx.ts`: the site's text. Register it in `website/src/i18n/index.ts`.
- `website/src/pages/xx/`: the pages for the language. Copy `website/src/pages/tr/`.
- `website/scripts/generate-domain.ts` and `website/scripts/generate-cities.ts`: add `xx` to
  `LOCALES`.
- `website/scripts/build-fonts.py`: if the language needs letters outside the Latin and Arabic
  ranges already there, add them.

### The stores

- `docs/STORE_DESCRIPTIONS.md`: the store name, short text and full description, written in the
  language.
- `fastlane/metadata/android/<locale>/changelogs/`: release notes for Google Play.

## The tests that guard it

Run `bun run test` before you open the pull request. These tests check translations:

- `src/i18n/__tests__/locales.test.ts`: every file has the same keys and plural forms, every key
  the app asks for exists, and no value is left in English by mistake.
- `src/i18n/__tests__/plurals.test.ts`: plural forms work for each language.
- `src/i18n/__tests__/tipCopy.test.ts`: no donation or charity word in any language, and the tip
  text uses the tip word. Add your language's tip word to `TIP_WORD`, and its donation and charity
  words to `FORBIDDEN`.
- `src/__tests__/privacyClaims.test.ts`: the privacy text in each language says what the app
  really does. It has a small list of phrases per language (for crash reports, location, buddies
  and phrases that claim too much). A new language needs its own entries. Until it has them, both
  this test and `bun run typecheck` fail.
- `src/i18n/__tests__/direction.test.ts`, `rtlLayout.test.tsx` and `mirroring.test.tsx`: right to
  left layout, if your language needs it.
- `src/i18n/__tests__/numerals.test.ts`: which digits are shown.

If a test fails and you are not sure why, say so in the pull request. We will help.
