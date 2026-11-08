/**
 * The translation guard.
 *
 * Three locale files drift the moment a feature lands in one of them and not the others: a key is
 * added to `en.json`, the screen ships, and Arabic silently falls back to English forever — a
 * failure nobody sees because i18next's `fallbackLng` hides it perfectly. This suite makes that
 * drift a red test instead.
 *
 * It checks five things:
 *
 * 1. **Identical key sets.** Every key present in one file is present in all three.
 * 2. **Correct plural families.** Plurals are compared by their *base* key, because the number of
 *    variants is a property of the language, not of the string: English and Turkish need `one` and
 *    `other`, Arabic needs all six CLDR categories. The required set is derived from
 *    `Intl.PluralRules`, so adding a language cannot get this wrong.
 * 3. **Nothing empty.** A blank string is worse than a missing key — it renders as nothing at all.
 * 4. **No stray interpolations.** Every `{{placeholder}}` in a translation must be one the English
 *    source also supplies, so a typo (`{{prayr}}`) cannot ship as literal braces on screen.
 * 5. **No untranslated leftovers.** Arabic and Turkish must not simply repeat the English text for
 *    the keys where that would mean the translator never got to it.
 *
 * A sixth check lives at the bottom: every key the app actually asks for — the literal `t('…')`
 * calls scanned out of `src/`, plus the dynamic families built from domain constants — must exist.
 * That is the other half of the same guarantee: parity means nothing if all three files are
 * missing the key the screen needs.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import ar from '../locales/ar.json';
import en from '../locales/en.json';
import tr from '../locales/tr.json';
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../index';
import { HIJRI_ERA_KEY, HIJRI_MONTH_KEYS } from '@/domain/hijri';
import {
  CALCULATION_METHODS,
  NOTIFICATION_KINDS,
  PRAYERS,
  PRAYER_STATUSES,
  type LoggableStatus,
} from '@/domain/types';
import { ADHAN_VOICES } from '@/domain/adhanVoices';
import { AGGRESSIVE_OEMS } from '@/services/batteryGuidance';

/**
 * The three choices the seal offers. Typed as `LoggableStatus[]` so the compiler — not this test —
 * is what breaks if the domain ever gains or renames one.
 */
const LOGGABLE_STATUSES: LoggableStatus[] = ['prayed', 'late', 'missed'];

/** The i18next plural suffixes, longest-first so `_other` never loses to a shorter match. */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const;

const BUNDLES: Record<AppLanguage, unknown> = { en, ar, tr };

/** `{ a: { b: 'c' } }` → `{ 'a.b': 'c' }`. Throws on anything that is not a string leaf. */
function flatten(value: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Locale root at "${prefix}" is not an object`);
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof child === 'string') out[path] = child;
    else if (typeof child === 'object' && child !== null) Object.assign(out, flatten(child, path));
    else throw new Error(`Locale value at "${path}" must be a string or an object`);
  }
  return out;
}

/** `time.unit.hour_other` → `time.unit.hour`; a non-plural key is returned unchanged. */
function baseKey(key: string): string {
  const suffix = PLURAL_SUFFIXES.find((candidate) => key.endsWith(candidate));
  return suffix === undefined ? key : key.slice(0, -suffix.length);
}

function isPlural(key: string): boolean {
  return baseKey(key) !== key;
}

/** The CLDR plural categories the language genuinely needs — two for en/tr, six for ar. */
function requiredCategories(language: AppLanguage): string[] {
  return [...new Intl.PluralRules(language).resolvedOptions().pluralCategories].sort();
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((match) => match[1]);
}

const FLAT: Record<AppLanguage, Record<string, string>> = {
  en: flatten(en),
  ar: flatten(ar),
  tr: flatten(tr),
};

/** Every key, with plural variants collapsed to their base. This is the set that must match. */
function baseKeys(language: AppLanguage): Set<string> {
  return new Set(Object.keys(FLAT[language]).map(baseKey));
}

/**
 * A string that is nothing but placeholders and punctuation — `"{{day}} {{month}}"`,
 * `"{{prayer}}, {{time}}, {{caption}}"`. It carries no words, so being byte-identical across
 * languages is correct rather than a missed translation.
 */
function isPureLayout(value: string): boolean {
  return !/\p{L}/u.test(value.replace(/\{\{[^}]*\}\}/g, ''));
}

/**
 * Keys whose translation is legitimately identical to English: proper nouns and the Arabic
 * calligraphy, which is Arabic in all three files by design.
 */
const SHARED_WITH_ENGLISH = new Set<string>([
  'app.name',
  'hijri.era.ah',
  // The Qibla screen's calligraphy, like the prayer names below it.
  'qibla.arabic',
  // "{{distance, number}} km" — Turkish writes the SI symbol exactly as English does. The number
  // itself is still localized, by the interpolation's `number` formatter.
  'qibla.value.distance',
  // The language picker names every language in ITS OWN language ("English", "العربية",
  // "Türkçe"), so someone who set the app to a language they cannot read can still find their
  // way back. Being identical in all three bundles is the whole point.
  'settings.home.appearance.language.en',
  'settings.home.appearance.language.ar',
  'settings.home.appearance.language.tr',
  // A calculation authority's SHORT name is a proper noun — "Diyanet", "Umm al-Qura", "ISNA",
  // "Dubai" — and naming it is the whole point of the picker (our market research: the
  // authority has to be recognisable, which a translated-away name is not). Turkish and English
  // therefore legitimately agree on several of them. Their `methods.descriptions.*` lines carry
  // the actual prose and are NOT exempt.
  ...CALCULATION_METHODS.map((method) => `methods.${method}`),
  // Phone manufacturers, for the same reason: the whole point of naming Xiaomi or Samsung in the
  // battery guidance is that the user recognises their own phone in it (our market research),
  // and Turkish writes those names exactly as English does. Arabic transliterates them, so it is
  // not relying on this exemption.
  ...[...AGGRESSIVE_OEMS].map((oem) => `settings.reminderHealth.battery.oem.${oem}`),
  // The reciters, for the third time and the same reason: a name is the whole of the credit the
  // app gives them (assets/audio/CREDITS.md), and a translated name is not a name anyone can
  // check. Turkish writes all three exactly as English does. Arabic does NOT rely on this — it
  // writes them in Arabic script, which is the same name written properly.
  ...ADHAN_VOICES.filter((voice) => voice !== 'makkah').map(
    (voice) => `settings.reminders.voice.${voice}`
  ),
  ...PRAYERS.map((prayer) => `prayers.${prayer}`),
  ...PRAYERS.map((prayer) => `prayers.arabic.${prayer}`),
  // Friday's midday prayer (D75), by the same rule: `prayers.arabic.jumuah` is calligraphy and is
  // identical in every bundle. `prayers.jumuah` is deliberately NOT exempt — every language
  // authors its own "Jumu’ah · Dhuhr" pair ("Cuma · Öğle", "الجمعة · الظهر").
  'prayers.arabic.jumuah',
  // The short Friday name's calligraphy (owner, 2026-08-28) — identical everywhere by the same rule.
  'prayers.arabic.jumuahShort',
  ...HIJRI_MONTH_KEYS,
]);

describe('locale bundles', () => {
  it('registers exactly the supported languages', () => {
    expect(Object.keys(BUNDLES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('parses every bundle into flat string leaves', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(Object.keys(FLAT[language]).length).toBeGreaterThan(0);
    }
  });
});

describe('key parity', () => {
  const reference = baseKeys('en');

  it.each(SUPPORTED_LANGUAGES.filter((language) => language !== 'en'))(
    '%s has no key English is missing',
    (language) => {
      expect([...baseKeys(language)].filter((key) => !reference.has(key)).sort()).toEqual([]);
    }
  );

  it.each(SUPPORTED_LANGUAGES.filter((language) => language !== 'en'))(
    '%s is missing no English key',
    (language) => {
      const keys = baseKeys(language);
      expect([...reference].filter((key) => !keys.has(key)).sort()).toEqual([]);
    }
  );

  it('agrees on which keys are plural', () => {
    const pluralBases = (language: AppLanguage) =>
      [...new Set(Object.keys(FLAT[language]).filter(isPlural).map(baseKey))].sort();
    for (const language of SUPPORTED_LANGUAGES) {
      expect(pluralBases(language)).toEqual(pluralBases('en'));
    }
  });
});

describe('plural families', () => {
  it.each(SUPPORTED_LANGUAGES)('%s supplies every CLDR category it needs', (language) => {
    const required = requiredCategories(language);
    const byBase = new Map<string, string[]>();
    for (const key of Object.keys(FLAT[language])) {
      if (!isPlural(key)) continue;
      const base = baseKey(key);
      const category = key.slice(base.length + 1);
      byBase.set(base, [...(byBase.get(base) ?? []), category]);
    }

    expect(byBase.size).toBeGreaterThan(0);
    for (const [base, categories] of byBase) {
      expect({ base, categories: [...categories].sort() }).toEqual({ base, categories: required });
    }
  });
});

describe('translation values', () => {
  it.each(SUPPORTED_LANGUAGES)('%s has no empty string', (language) => {
    const blank = Object.entries(FLAT[language])
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s interpolates only placeholders English supplies', (language) => {
    const englishFor = (key: string): string | undefined =>
      FLAT.en[key] ?? FLAT.en[`${baseKey(key)}_other`] ?? FLAT.en[baseKey(key)];

    const offenders: string[] = [];
    for (const [key, value] of Object.entries(FLAT[language])) {
      const source = englishFor(key);
      if (source === undefined) continue;
      const allowed = new Set(placeholders(source));
      for (const name of placeholders(value)) {
        if (!allowed.has(name)) offenders.push(`${language}:${key} → {{${name}}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES.filter((language) => language !== 'en'))(
    '%s is actually translated',
    (language) => {
      const untranslated = Object.entries(FLAT[language])
        .filter(
          ([key, value]) =>
            !SHARED_WITH_ENGLISH.has(baseKey(key)) && !isPureLayout(value) && FLAT.en[key] === value
        )
        .map(([key]) => key);
      expect(untranslated).toEqual([]);
    }
  );
});

/* ------------------------------------------------------------------------------------------- */

const SRC = join(__dirname, '..', '..');

/** Every non-test source file under `src/`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'migrations') continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

/** Literal `t('some.key')` / `t("some.key")` calls. Template literals are handled separately. */
function literalKeysIn(source: string): string[] {
  return [...source.matchAll(/\bt\(\s*(['"])([\w.]+)\1/g)].map((match) => match[2]);
}

/** A key resolves if it exists outright, or exists as a plural family. */
function resolves(language: AppLanguage, key: string): boolean {
  if (FLAT[language][key] !== undefined) return true;
  return PLURAL_SUFFIXES.some((suffix) => FLAT[language][`${key}${suffix}`] !== undefined);
}

describe('keys the app asks for', () => {
  const used = [
    ...new Set(sourceFiles(SRC).flatMap((file) => literalKeysIn(readFileSync(file, 'utf8')))),
  ].sort();

  it('finds the literal t() calls in the source tree', () => {
    expect(used.length).toBeGreaterThan(10);
    expect(used).toContain('today.footerHint');
  });

  it.each(SUPPORTED_LANGUAGES)('%s defines every literal key', (language) => {
    expect(used.filter((key) => !resolves(language, key))).toEqual([]);
  });

  /**
   * The families built at runtime from a domain constant. A literal-only scan cannot see these,
   * and they are exactly the ones that break when a prayer, a status or a month is added.
   */
  const dynamic = [
    ...PRAYERS.map((prayer) => `prayers.${prayer}`),
    ...PRAYERS.map((prayer) => `prayers.arabic.${prayer}`),
    ...PRAYER_STATUSES.map((status) => `seal.status.${status}`),
    ...LOGGABLE_STATUSES.map((status) => `seal.option.${status}`),
    ...LOGGABLE_STATUSES.map((status) => `seal.a11y.mark.${status}`),
    ...LOGGABLE_STATUSES.map((status) => `seal.a11y.clear.${status}`),
    ...LOGGABLE_STATUSES.map((status) => `seal.a11y.recorded.${status}`),
    ...HIJRI_MONTH_KEYS,
    HIJRI_ERA_KEY,
    ...['hour', 'minute', 'second'].flatMap((unit) => [
      `time.unit.${unit}`,
      `time.unit.${unit}Short`,
    ]),
    'today.caption.upcoming',
    // The calculation-method picker builds every row from `domain/methods.listMethods()`, so a
    // method added to the domain must arrive with its name AND its authority line in all three
    // bundles — the exact failure this whole file exists to catch.
    ...CALCULATION_METHODS.map((method) => `methods.${method}`),
    ...CALCULATION_METHODS.map((method) => `methods.descriptions.${method}`),
    // The Prayer-times screen maps these two unions onto label + explanation keys.
    ...['shafi', 'hanafi'].flatMap((madhab) => [
      `settings.calculation.madhab.option.${madhab}`,
      `settings.calculation.madhab.description.${madhab}`,
    ]),
    ...['auto', 'middleOfTheNight', 'seventhOfTheNight', 'twilightAngle'].flatMap((rule) => [
      `settings.calculation.highLatitude.option.${rule}`,
      `settings.calculation.highLatitude.explain.${rule}`,
    ]),
    // The reminder-health screen names every notification kind it reads back from the OS, and
    // labels its own verdicts and severities from unions rather than literals.
    // The four recitations name themselves in the selector, in the Android channel a reminder
    // rides on, and in the About screen's credit — all three built from the domain list.
    ...ADHAN_VOICES.map((voice) => `settings.reminders.voice.${voice}`),
    ...NOTIFICATION_KINDS.map((kind) => `settings.reminderHealth.schedule.kind.${kind}`),
    ...['ok', 'attention', 'problem', 'info'].map(
      (level) => `settings.reminderHealth.level.${level}`
    ),
    ...['permissionMissing', 'permissionDenied', 'noReminders', 'empty', 'ok'].flatMap(
      (verdict) => [
        `settings.reminderHealth.verdict.${verdict}.title`,
        `settings.reminderHealth.verdict.${verdict}.body`,
      ]
    ),
    ...['idle', 'sending', 'sent', 'failed'].flatMap((state) => [
      `settings.reminderHealth.test.status.${state}`,
      `settings.reminderHealth.test.${state}.title`,
      `settings.reminderHealth.test.${state}.body`,
    ]),
    ...[...AGGRESSIVE_OEMS].map((oem) => `settings.reminderHealth.battery.oem.${oem}`),
  ];

  it.each(SUPPORTED_LANGUAGES)('%s defines every runtime-built key', (language) => {
    expect(dynamic.filter((key) => !resolves(language, key))).toEqual([]);
  });
});
