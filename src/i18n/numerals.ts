/**
 * Digits — the one place a number becomes a string for the UI.
 *
 * ## The decision (D40): Arabic follows the **formatting region**, and the answer is pinned
 *
 * DESIGN.md §RTL asks for "the locale default, keeping tabular alignment". That instruction turns
 * out to have a sharp edge, and this module exists because of it.
 *
 * There is no single Arabic answer. CLDR splits the Arabic-speaking world down the middle:
 *
 * - **Arabic-Indic (`arab`, ٠١٢٣):** EG, SA, IQ, JO, PS, LB, SY, YE, SD, QA, KW, BH, OM …
 * - **Western (`latn`, 0123):** MA, DZ, TN, LY, EH — and, since a recent CLDR release, **AE**.
 *
 * And the *region-less* tag the app actually holds — the language picker offers one "العربية", so
 * i18next's language is the bare string `ar` — resolves to **`latn`** in current CLDR, having
 * previously resolved to `arab`. That is not a detail: it means `new Intl.NumberFormat('ar')`
 * answers differently depending on which ICU data the running platform ships. Hermes defers to the
 * OS, so the *same build* would print `٢٠:٤٧` on one phone and `20:47` on another, and would
 * change its mind under the user after an OS update. For an app whose entire job is showing
 * numbers, that is a bug waiting to be filed as "the times changed".
 *
 * So the rule is: **decide, then pin.**
 *
 * 1. If the language tag carries a region (`ar-EG`), that region decides.
 * 2. Otherwise the **device's formatting region** decides — `expo-localization`'s `regionCode`,
 *    which is the Region setting under Language & Region, exactly the setting the OS itself uses
 *    to choose number, date and currency shapes. A phone set to Egypt shows ٠٥:١٢; a phone set to
 *    Morocco shows 05:12. Both are correct, and neither user has to translate the other's digits.
 * 3. If there is no region at all, CLDR's own default for bare `ar` stands: `latn` — the form
 *    every Arabic reader can read, including the third of them who do not use `arab` at home.
 * 4. Whatever comes out is written into the tag as `-u-nu-…` before it reaches `Intl`, so the
 *    answer cannot drift with the platform's data — **and the region is written in beside it**.
 *
 * ## Why the region has to be in the tag as well (the bug this cost us)
 *
 * `-u-nu-…` alone is not enough, because **Hermes on iOS ignores the Unicode extension outright**.
 * Measured on the simulator, not assumed:
 *
 * ```
 * new Intl.NumberFormat('ar-u-nu-arab').format(1234.5)  ->  '1,234.5'      // extension ignored
 * new Intl.NumberFormat('ar-SA').format(1234.5)         ->  '١٬٢٣٤٫٥'      // region honoured
 * new Intl.NumberFormat('ar', {numberingSystem:'arab'}) ->  '1,234.5'      // option ignored too
 * ```
 *
 * So every Arabic user on iOS — including in Riyadh and Cairo — was shown Western digits, and the
 * `-u-nu-arab` this module carefully computed never reached the formatter. `Intl.DateTimeFormat`
 * behaves identically, which is why the clock was Latin too.
 *
 * The obvious repair — put the region in the tag, since Hermes reads that — **is a trap, and it
 * shipped for about twenty minutes before the simulator caught it.** `ar-SA` does not merely
 * select Arabic-Indic digits: its CLDR default calendar is `islamic-umalqura`, so every
 * `Intl.DateTimeFormat` built on it silently switches to the Hijri calendar. The Today header,
 * which prints the Hijri date beside the Gregorian one, rendered "١٦ ربيع الأول · ١٦ ربيع الأول".
 * A region carries a whole locale, not one field of it.
 *
 * So the tag stays region-free and the *output* is corrected instead: `formatNumber` rebuilds the
 * string from `formatToParts`, mapping the digits — and the group and decimal separators — into
 * the system this module decided on. That is engine-independent by construction: it does not care
 * whether the extension was honoured, ignored, or resolved to something else entirely, and it
 * cannot leak into a calendar, a date pattern or a currency shape. `utils/formatTime` applies the
 * same mapping to its own parts, which is what puts Arabic-Indic digits on the clock.
 *
 * ## Tabular alignment survives either answer
 *
 * Under Arabic, `AppText` switches *every* variant to an Arabic face (components/AppText.tsx):
 * Noto Naskh Arabic for UI text and Amiri for the calligraphy variants (D135). Both shipped faces
 * give every digit in U+0660–U+0669, and every Latin digit, one identical advance, measured from
 * the shipped TTFs and pinned by `__tests__/tabularFigures.test.ts`. A column of times therefore
 * aligns by construction in both systems, with or without the `tabular-nums` feature. Lora, which has no Arabic-Indic glyphs at all, is never selected while
 * the UI language is Arabic, so nothing can drop to a fallback face mid-column.
 *
 * ## Why one function rather than `Intl.NumberFormat` at each call site
 *
 * Because the bug this fixes was never the digit *shape* — it was a screen showing `٠٥:١٢` beside
 * a stepper reading `+3`, because a handful of call sites reached for `String(n)`. One entry point
 * is what makes "every number in the app agrees" a property rather than a habit.
 */

import { getLocales } from 'expo-localization';

import type { NumeralPreference } from '@/domain/types';

/** The two numbering systems this app can render. */
export type NumberingSystem = 'latn' | 'arab';

/**
 * Regions whose CLDR default for Arabic is Arabic-Indic. Everything else — the Maghreb, the UAE,
 * and any region CLDR does not associate with Arabic at all — takes Western digits.
 *
 * Listed explicitly rather than derived, because the list is the decision: it is what someone
 * comes to read when they ask "why does my phone show 5 and my brother's shows ٥".
 */
/** Matches `ar` and every Arabic tag (`ar-EG`, `ar_SA`, `AR`), and nothing else. */
const ARABIC_TAG = /^ar(?:[-_]|$)/i;

const ARABIC_INDIC_REGIONS: ReadonlySet<string> = new Set([
  'BH',
  'DJ',
  'EG',
  'ER',
  'IL',
  'IQ',
  'JO',
  'KM',
  'KW',
  'LB',
  'MR',
  'OM',
  'PS',
  'QA',
  'SA',
  'SD',
  'SO',
  'SS',
  'SY',
  'TD',
  'YE',
]);

/** `ar-Arab-MA` → `MA`; `ar` → `null`. Accepts the UN M.49 numeric form (`es-419`) too. */
export function regionFromLanguageTag(tag: string): string | null {
  const match = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2}|\d{3})(?:-|$)/.exec(tag);
  return match === null ? null : match[1].toUpperCase();
}

/**
 * The numbering system a language should render its digits in.
 *
 * @param tag - BCP-47 tag, e.g. `"ar"`, `"ar-EG"`, `"en-GB"`.
 * @param deviceRegion - The device's formatting region, consulted only when the tag has none.
 * @returns `arab` only for Arabic in an Arabic-Indic region; `latn` for everything else.
 */
export function numberingSystemFor(tag: string, deviceRegion?: string | null): NumberingSystem {
  if (!ARABIC_TAG.test(tag)) return 'latn';
  const region = regionFromLanguageTag(tag) ?? deviceRegion?.toUpperCase() ?? null;
  if (region === null) return 'latn';
  return ARABIC_INDIC_REGIONS.has(region) ? 'arab' : 'latn';
}

/**
 * The device's formatting region, or `null`.
 *
 * Memoized: it cannot change without the OS restarting the app, and `getLocales()` crosses the
 * bridge. Wrapped because a platform that cannot answer must not take a render down with it.
 *
 * **Why it reads more than the first entry.** D40's premise — "the Region setting under Language &
 * Region, exactly the setting the OS itself uses" — is an iOS premise. Android has no separate
 * formatting region: `getLocales()` is the *language* list, and entry zero's region is whatever
 * country happens to be attached to the top language. A phone in Morocco whose first language is
 * `ar` with no country, or `ar-EG` from a keyboard the owner once added, reports a region that is
 * not where the reader lives. So the scan takes the first entry that actually carries one, which
 * on iOS is still entry zero and on Android is the first language specific enough to be believed.
 * When nothing carries a region the answer stays `latn`, which every Arabic reader can read.
 */
let cachedRegion: string | null | undefined;

export function deviceRegionCode(): string | null {
  if (cachedRegion === undefined) {
    try {
      const locales = getLocales();
      cachedRegion =
        locales.find((locale) => (locale?.regionCode ?? '').length > 0)?.regionCode ?? null;
    } catch {
      cachedRegion = null;
    }
  }
  return cachedRegion;
}

/**
 * The language tag to hand `Intl`, with the numbering system pinned as a Unicode extension.
 *
 * A tag that already carries a `-u-` extension is returned untouched — the caller was explicit.
 *
 * @param tag - BCP-47 tag from i18next.
 * @returns e.g. `"ar-u-nu-latn"`, `"ar-EG-u-nu-arab"`, `"en-u-nu-latn"`.
 */
export function numericLocale(tag: string): string {
  if (tag.includes('-u-')) return tag;
  // `activeNumberingSystem`, not `numberingSystemFor`: the pinned tag is what the widget, watch and
  // Wear snapshots carry across the bridge, so an explicit preference has to be inside it or those
  // surfaces would quietly keep resolving the region while the phone showed the chosen digits.
  return `${tag}-u-nu-${activeNumberingSystem(tag)}`;
}

/**
 * The numbering system the UI should be rendering in, for the language i18next currently holds.
 *
 * `utils/formatTime` needs the same answer `formatNumber` uses, so both call this rather than each
 * re-deriving it.
 */
/**
 * The user's explicit choice, when they have made one.
 *
 * Set from the root layout beside `applyLanguage`, the same way the direction flag is — rather than
 * read from the settings store here, which would point `src/i18n` at `src/stores` and invert the
 * dependency every other module in this folder respects.
 *
 * It exists because D40's region rule is a *guess* on Android: there is no formatting region there,
 * only the language list, so a reader whose top entry carries the wrong country (or none) had no
 * way to correct it. `auto` — the default, and what almost everyone keeps — leaves D40 untouched.
 */
let preference: NumeralPreference = 'auto';

export function setNumeralPreference(next: NumeralPreference): void {
  if (next === preference) return;
  preference = next;
  resetNumeralCache();
}

/** For tests and for the Settings row's own preview. */
export function numeralPreference(): NumeralPreference {
  return preference;
}

export function activeNumberingSystem(tag: string): NumberingSystem {
  // A tag that already names its system was pinned by a caller who knew better — the widget and
  // watch snapshots carry `numericLocale()`'s answer across the bridge, and must not be re-resolved
  // against the device region on the way out.
  const pinned = /-u-(?:.*-)?nu-([a-z0-9]+)/i.exec(tag);
  if (pinned !== null) return pinned[1].toLowerCase() === 'arab' ? 'arab' : 'latn';
  // The explicit choice wins, and only for Arabic: it is the Arabic digits the row is about, and a
  // preference left behind after switching to English must not turn English into ٠١٢٣.
  if (preference !== 'auto' && ARABIC_TAG.test(tag)) return preference;
  return numberingSystemFor(tag, deviceRegionCode());
}

const ARABIC_INDIC_ZERO = 0x0660;
const ASCII_ZERO = 0x30;

/**
 * Rewrites the digits in `text` into `system`, leaving every other character alone.
 *
 * Only ever called when an engine has disagreed with the tag it was handed — the digits are then
 * wrong, and wrong digits beside right ones is the exact failure D40 exists to prevent.
 */
export function enforceNumberingSystem(text: string, system: NumberingSystem): string {
  return system === 'arab'
    ? text.replace(/[0-9]/g, (d) =>
        String.fromCharCode(ARABIC_INDIC_ZERO + d.charCodeAt(0) - ASCII_ZERO)
      )
    : text.replace(/[\u0660-\u0669]/g, (d) =>
        String.fromCharCode(ASCII_ZERO + d.charCodeAt(0) - ARABIC_INDIC_ZERO)
      );
}

/** U+066C ARABIC THOUSANDS SEPARATOR — the grouping mark that belongs beside ٠١٢٣. */
const ARABIC_GROUP_SEPARATOR = '\u066C';
/** U+066B ARABIC DECIMAL SEPARATOR. */
const ARABIC_DECIMAL_SEPARATOR = '\u066B';

/**
 * Rewrites a formatted *number* into `system` — its digits and, for Arabic, its separators.
 *
 * Takes the finished string rather than `formatToParts`, because **Hermes' `Intl.NumberFormat` has
 * no `formatToParts`**: reaching for it crashed the Today screen with "undefined is not a function"
 * on the first render, while Jest sailed through on Node's complete implementation. The same trap
 * as the missing `Intl.PluralRules`, one method along. `__tests__/numerals.test.ts` now runs this
 * against a stubbed formatter with the method removed.
 *
 * Operating on the whole string is safe here in a way it would not be for a date: a formatted
 * number contains only digits, separators, a sign and possibly a percent mark, so there is no
 * literal text whose commas and stops must survive.
 */
export function localizeNumericText(text: string, system: NumberingSystem): string {
  if (system === 'latn') return enforceNumberingSystem(text, 'latn');
  return enforceNumberingSystem(text, 'arab')
    .replace(/,/g, ARABIC_GROUP_SEPARATOR)
    .replace(/\./g, ARABIC_DECIMAL_SEPARATOR);
}

// The countdown re-formats once a second, so the (expensive) Intl objects are cached. The key
// space is bounded by {language} × {the handful of option shapes the UI actually asks for}.
const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(tag: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${tag}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    try {
      formatter = new Intl.NumberFormat(numericLocale(tag), options);
    } catch {
      // An engine that rejects the extension (or the tag) still has to render the number, and a
      // default-locale fallback is far better than a thrown render.
      formatter = new Intl.NumberFormat(undefined, options);
    }
    formatters.set(key, formatter);
  }
  return formatter;
}

// Dates go through the same door as numbers, for the same reason: `Intl.DateTimeFormat` reads the
// `-u-nu-…` extension exactly as unreliably as `Intl.NumberFormat` does, so a clock or a calendar
// built straight from `numericLocale()` printed Western digits beside Arabic-Indic ones.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatterFor(tag: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tag}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat(numericLocale(tag), options);
    } catch {
      formatter = new Intl.DateTimeFormat(undefined, options);
    }
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats a date for display in the given UI language, with the digits this module decided on.
 *
 * The counterpart to `formatNumber`, and the reason both exist: a screen that builds its own
 * `Intl.DateTimeFormat` gets whatever the engine felt like, and the Today header ends up printing
 * a Hijri date in Arabic-Indic beside a Gregorian one in Western digits.
 *
 * Only the numeric parts are rewritten — month names, weekday names and the literals between them
 * are passed through untouched, so nothing reshapes a word.
 *
 * @param date - The instant to render.
 * @param tag - BCP-47 tag, normally `i18n.language`.
 * @param options - Passed straight to `Intl.DateTimeFormat`.
 */
export function formatDate(
  date: Date,
  tag: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const system = activeNumberingSystem(tag);
  const formatter = dateFormatterFor(tag, options);
  // Hermes has `DateTimeFormat.formatToParts` but not `NumberFormat.formatToParts`; the guard is
  // here so a runtime missing either one degrades instead of throwing mid-render.
  if (typeof formatter.formatToParts !== 'function') {
    return enforceNumberingSystem(formatter.format(date), system);
  }
  return formatter
    .formatToParts(date)
    .map((part) =>
      part.type === 'literal' ? part.value : enforceNumberingSystem(part.value, system)
    )
    .join('');
}

/**
 * Formats a number for display in the given UI language.
 *
 * **Every** number the UI renders goes through here (or through `utils/formatTime`, which is built
 * on the same resolution): times, countdowns, day numbers, streaks, qada counters, minute offsets,
 * percentages, degrees. A bare `String(n)` in a screen is a bug — it is how Arabic ended up with a
 * clock and a stepper disagreeing on the same row.
 *
 * @param value - The number. A non-finite value renders as an empty string rather than "NaN".
 * @param tag - BCP-47 tag, normally `i18n.language`.
 * @param options - Passed straight to `Intl.NumberFormat` (`style: 'percent'`, padding, …).
 * @returns The localized digits.
 */
export function formatNumber(
  value: number,
  tag: string,
  options: Intl.NumberFormatOptions = {}
): string {
  if (!Number.isFinite(value)) return '';
  const text = formatterFor(tag, options).format(value);
  return localizeNumericText(text, activeNumberingSystem(tag));
}

/**
 * Every decimal digit a user can type into a numeric field, in the scripts this app can meet:
 * ASCII, Arabic-Indic (U+0660…) and Extended Arabic-Indic (Persian/Urdu, U+06F0…).
 *
 * A number pad on an Arabic-locale phone emits `٣`, not `3`. A field that filters with `[^0-9]`
 * therefore deletes every keystroke as it arrives and simply cannot be typed into — a bug that is
 * invisible in English and total in Arabic.
 */
export const DIGIT_CHARACTERS = /[0-9\u0660-\u0669\u06f0-\u06f9]/;

/** {@link DIGIT_CHARACTERS} negated, for stripping a field down to its digits. */
export const NON_DIGIT_CHARACTERS = /[^0-9\u0660-\u0669\u06f0-\u06f9]/g;

/**
 * Rewrites Arabic-Indic and Extended Arabic-Indic digits as ASCII, leaving everything else alone.
 *
 * The counterpart of {@link formatNumber}: that one is how a number reaches the user, this one is
 * how it comes back. `Number.parseInt` only understands ASCII, so any field the user types digits
 * into has to pass through here before it is parsed.
 *
 * @param text - Raw text from a `TextInput`.
 */
export function toAsciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/** Clears the cached formatters and the device region. Tests only. */
export function resetNumeralCache(): void {
  formatters.clear();
  dateFormatters.clear();
  cachedRegion = undefined;
}
