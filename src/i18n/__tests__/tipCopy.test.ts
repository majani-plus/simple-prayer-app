/**
 * The word guard — the cheapest insurance in the repository.
 *
 * Apple guideline **3.2.2(iv)** rejects apps that collect charitable contributions through in-app
 * purchase; **3.1.1** explicitly permits tipping the developer. The transaction is identical, so
 * the entire difference is vocabulary — and the vocabulary does not stay inside the app. Product
 * names, descriptions and localizations are typed into App Store Connect and Play Console from the
 * same copy the UI shows, and `locales/*.json` at the repository root becomes `Info.plist` strings
 * in the shipped binary. One translator reaching for the obvious word turns a passing build into a
 * rejection, weeks late, in a language the reviewer reads and we might not.
 *
 * So: no locale file, in any language, may contain a charity word — not in the tip strings, not
 * anywhere else — and neither may the store product identifiers. That is a broader rule than the
 * guideline needs, and it is broader on purpose: an exact-scope rule would have to be re-scoped
 * every time a string moves, and this one costs nothing to keep.
 *
 * The words are exactly the ones PRODUCT_SPEC §14 and our market research name, in the three
 * shipped languages, plus the spellings a translator would plausibly reach for instead. Arabic is
 * matched with an optional shadda, because تبرّع and تبرع are the same word and only one of them
 * is a plain substring of the other.
 *
 * **Source files are deliberately not scanned.** `components/TipJar.tsx` and
 * `services/purchases.ts` document the rule, which means they quote every forbidden word; the
 * things that can actually reach a store reviewer are the locale bundles and the identifiers, and
 * those are what this file reads.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import ar from '../locales/ar.json';
import en from '../locales/en.json';
import tr from '../locales/tr.json';
import { TIP_PRODUCT_IDS, TIP_TIERS } from '@/services/purchases';

/** Every word that must never appear, and the language that would produce it. */
const FORBIDDEN: readonly { label: string; pattern: RegExp }[] = [
  { label: 'donate/donation (en)', pattern: /donat/i },
  { label: 'donasyon (tr)', pattern: /donasyon/i },
  { label: 'charity/charitable (en)', pattern: /charit/i },
  { label: 'sadaqah/sadaka (en, tr)', pattern: /sadaq|sadak/i },
  { label: 'zakat/zekat/zekât (en, tr)', pattern: /zakat|zak[āa]t|zek[aâ]t/i },
  { label: 'bağış (tr)', pattern: /ba[ğg]i[şs]|ba[ğg][ıi][şs]/i },
  { label: 'تبرع (ar)', pattern: /تبرّ?ع/ },
  { label: 'صدقة (ar)', pattern: /صدق[ةه]/ },
  { label: 'زكاة (ar)', pattern: /زكا[ةه]/ },
];

/** `{ a: { b: 'c' } }` → `[['a.b', 'c']]`. */
function entries(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    entries(child, prefix === '' ? key : `${prefix}.${key}`)
  );
}

const BUNDLES: Record<string, unknown> = { en, ar, tr };

/**
 * The Expo `locales/` directory: the strings that become `Info.plist` / Android resource values
 * in the shipped binary, which is as close to "store metadata" as anything in the tree gets.
 */
const NATIVE_LOCALES = join(__dirname, '..', '..', '..', 'locales');

describe('no charity wording anywhere in the localized copy', () => {
  it.each(Object.keys(BUNDLES))('%s', (language) => {
    const offenders = entries(BUNDLES[language]).flatMap(([key, value]) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(value)).map(
        ({ label }) => `${language}:${key} contains ${label} — "${value}"`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('nor in the native permission strings that ship inside the binary', () => {
    const files = readdirSync(NATIVE_LOCALES).filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) => {
      const text = readFileSync(join(NATIVE_LOCALES, file), 'utf8');
      return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(
        ({ label }) => `locales/${file} contains ${label}`
      );
    });
    expect(offenders).toEqual([]);
  });

  it('nor in the store product identifiers, which are App Store Connect metadata', () => {
    const identifiers = Object.values(TIP_PRODUCT_IDS);
    const offenders = identifiers.flatMap((identifier) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(identifier)).map(
        ({ label }) => `${identifier} contains ${label}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('would catch every forbidden word if one were introduced', () => {
    // The guard is only worth having if it actually fires, so each pattern is proved against the
    // string a well-meaning translator would write.
    const samples = [
      'Donate to the developer',
      'Bir donasyon yap',
      'Support our charity',
      'Leave a sadaqah',
      'Sadaka bırak',
      'Give zakat here',
      'Zekât ver',
      'Bağış yap',
      'تبرّع للمطوّر',
      'اترك صدقة',
      'ادفع زكاة مالك',
    ];
    for (const sample of samples) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(sample))).toBe(true);
    }
  });
});

describe('the tip copy says "tip" in every language', () => {
  /** The word each language uses for a gratuity — never the charity word. */
  const TIP_WORD: Record<string, RegExp> = {
    // Apple's own guideline wording: "tip"/"buy the developer a coffee".
    en: /\btip\b/i,
    // إكرامية — a gratuity, the word for what you leave a waiter. Arabic's charity words
    // (صدقة, زكاة) are religious acts and are exactly what 3.2.2(iv) is about.
    ar: /إكرامي/,
    // bahşiş — likewise a gratuity. Turkish's "bağış" is a donation and is banned above.
    tr: /bahşiş/i,
  };

  it.each(Object.keys(BUNDLES))('%s', (language) => {
    const tip = Object.fromEntries(entries(BUNDLES[language]).filter(([key]) => key.startsWith('settings.tip.')));
    expect(Object.keys(tip).length).toBeGreaterThan(10);
    const joined = Object.values(tip).join(' ');
    expect(TIP_WORD[language].test(joined)).toBe(true);
  });

  it('captions every tier this build knows about, in every language', () => {
    for (const language of Object.keys(BUNDLES)) {
      const flat = Object.fromEntries(entries(BUNDLES[language]));
      for (const tier of [...TIP_TIERS, 'other']) {
        expect(flat[`settings.tip.tier.${tier}`]).toBeTruthy();
      }
    }
  });
});
