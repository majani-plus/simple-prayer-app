// Arabic plurals, or the app speaks English grammar in Arabic.
//
// i18next 26 selects a plural form through `Intl.PluralRules`, and **Hermes ships without it** —
// `typeof Intl.PluralRules` is `undefined` on the iOS runtime. i18next then falls back to a
// one/other rule, so every Arabic count landed on `_other`: "2 ساعة" for the dual, "6 دقيقة" where
// Arabic takes the plural, "46 يوم متتالٍ" where it takes the accusative singular. All 76 `_zero`
// / `_two` / `_few` / `_many` forms in `locales/ar.json` were unreachable on device.
//
// It was invisible to the suite because Jest runs on Node, which has full ICU and therefore has
// `Intl.PluralRules` — the tests exercised a resolver the app never had. `__tests__/plurals.test.ts`
// now pins the polyfilled behaviour, and asserts English and Turkish are untouched by it.
//
// The polyfill installs only when the runtime lacks the built-in, so a platform that has it (Node,
// and Hermes on Android's ICU4J build) keeps using its own.
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/ar.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/tr.js';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { applyLayoutDirection } from './direction';
import { createFormatter } from './formatter';
import ar from './locales/ar.json';
import en from './locales/en.json';
import tr from './locales/tr.json';

export const SUPPORTED_LANGUAGES = ['en', 'ar', 'tr'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * The device's language when the app ships it, English otherwise.
 *
 * Exported because "system" is a *preference*, and everything that has to resolve that preference
 * to a concrete language — the root layout, `./useLanguageSwitch` — must resolve it the same way.
 */
export function deviceLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code) ? (code as AppLanguage) : 'en';
}

/**
 * Initialize i18next. The language override from settings (M2) is applied later via
 * i18n.changeLanguage; until then the device language decides.
 *
 * Two things are wired here that the rest of the app then gets for free:
 *
 * - **Layout direction**, on the very first line of the very first render. `I18nManager` reads its
 *   flag once per launch, so telling it the truth has to happen before anything lays out — see
 *   `./direction` for why a *change* still needs a reload.
 * - **A formatter for every interpolation** (`./formatter`), so numbers arrive in the language's
 *   own digits and any run that would reorder inside an Arabic sentence arrives bidi-isolated.
 *   `alwaysFormat` is what makes that unconditional: without it, only placeholders a translator
 *   annotated (`{{n, number}}`) would be seen, and the ones they forgot are exactly the ones that
 *   break.
 */
export function initI18n() {
  if (i18n.isInitialized) return i18n;
  const lng = deviceLanguage();
  // Before any component renders: on a cold launch this is a no-op (the native flag persisted from
  // last time), and on a first launch in Arabic it is what makes the first frame correct.
  applyLayoutDirection(lng);
  // eslint-disable-next-line import/no-named-as-default-member -- fluent .use() is the idiomatic i18next API
  void i18n
    .use(createFormatter())
    .use(initReactI18next)
    .init({
      resources: { en: { translation: en }, ar: { translation: ar }, tr: { translation: tr } },
      lng,
      fallbackLng: 'en',
      interpolation: { escapeValue: false, alwaysFormat: true },
      returnNull: false,
    });
  return i18n;
}

/**
 * Switches the UI language **and** re-points the OS layout flag at it.
 *
 * The single entry point for a language change, so the native direction flag can never drift away
 * from the strings on screen. Idempotent, and safe to call with the language already active — the
 * root layout does exactly that on every mount, which is what repairs the one case `initI18n`
 * cannot see: a stored preference that differs from the device language (the flag it wrote at
 * module scope was for the device, and this call corrects it before the process ends).
 *
 * It deliberately does **not** reload the app; `./useLanguageSwitch` owns the warning and the
 * restart, because only a user-initiated change may restart anything.
 *
 * @param language - The concrete language to render in (never `"system"`).
 * @returns `true` when the layout currently on screen no longer matches the language — the app is
 * mid-flip and a reload is owed.
 */
export async function applyLanguage(language: AppLanguage): Promise<boolean> {
  if (i18n.language !== language) {
    // eslint-disable-next-line import/no-named-as-default-member -- singleton API
    await i18n.changeLanguage(language);
  }
  return applyLayoutDirection(language);
}

export { isRtlLanguage, isLayoutRTL, directionFor } from './direction';

export default i18n;
