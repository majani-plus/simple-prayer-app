/**
 * Arabic plurals, pinned — and the polyfill that makes them reachable.
 *
 * ## The bug this file exists for
 *
 * Arabic has six CLDR plural categories where English has two, and `locales/ar.json` carries all
 * six for each of its 19 count-bearing keys. On device, none of them were reachable: i18next 26
 * selects a form through `Intl.PluralRules`, and **Hermes ships without `Intl.PluralRules`**. It
 * fell back to a one/other rule, so every Arabic count above one landed on `_other`:
 *
 *   ساعتين  ->  "٢ ساعة"        (the dual, printed as a singular with a numeral beside it)
 *   ٦ دقائق ->  "٦ دقيقة"        (3–10 takes the plural)
 *   ٤٦ يومًا متتاليًا -> "٤٦ يوم متتالٍ"  (11–99 takes the accusative singular)
 *
 * ## Why the suite did not catch it
 *
 * Jest runs on Node, which has full ICU and therefore *has* `Intl.PluralRules`. Every existing
 * assertion about Arabic plurals was exercising a resolver the shipped app did not own. That is
 * the trap this file has to stay awake to: **a behavioural test here can never fail for the
 * original reason**, because the environment it runs in cannot reproduce it.
 *
 * So there are two halves below, and the second is the one that guards the regression:
 *   1. the categories behave (readable, and catches a mis-authored form), and
 *   2. the polyfill is still imported, and still covers every language the app offers.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import i18n, { SUPPORTED_LANGUAGES, initI18n } from '../index';

beforeAll(() => {
  initI18n();
});

const INDEX_SOURCE = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

describe('the Intl.PluralRules polyfill', () => {
  it('is imported before anything can ask for a plural form', () => {
    // Hermes has no built-in. Without this import Arabic silently speaks English grammar, and
    // nothing in this suite can tell, because Node's ICU answers correctly either way.
    expect(INDEX_SOURCE).toContain('@formatjs/intl-pluralrules/polyfill');
  });

  it('carries plural data for every language the app offers', () => {
    // Adding a language to SUPPORTED_LANGUAGES without its plural data would leave that language
    // falling back to the polyfill's default rule — the same silent failure, one locale over.
    for (const language of SUPPORTED_LANGUAGES) {
      expect(INDEX_SOURCE).toContain(`@formatjs/intl-pluralrules/locale-data/${language}`);
    }
  });

  it('resolves the six Arabic categories the bundle is authored against', () => {
    const select = (n: number) => new Intl.PluralRules('ar').select(n);
    expect(select(0)).toBe('zero');
    expect(select(1)).toBe('one');
    expect(select(2)).toBe('two');
    expect(select(3)).toBe('few');
    expect(select(10)).toBe('few');
    expect(select(11)).toBe('many');
    expect(select(46)).toBe('many');
    expect(select(100)).toBe('other');
  });
});

describe('Arabic counts read as Arabic', () => {
  /** The formatter wraps interpolated values in FSI…PDI (D42); strip them for readable asserts. */
  const strip = (value: string) => value.replace(/[\u2066-\u2069]/g, '');

  /** The interpolation names differ per key; pass every one the families use. */
  const t = (key: string, count: number) =>
    i18n.t(key, { lng: 'ar', count, value: count, days: count });

  it('never says "two" twice — a numeral beside the noun keeps the noun singular', () => {
    // The owner's counted-noun rule (2026-08-30, D139): wherever a FIGURE is rendered next to its
    // noun, the noun does not also carry the count. "٢ صلاتان" reads as "2 two-prayers".
    expect(strip(t('qada.count', 2))).toBe('2 صلاة');
    expect(strip(t('qada.count', 1))).toBe('1 صلاة');
    // `streakLabel` is the same rule seen from the other side: TodayHeader draws the figure in a
    // sibling node, so the label itself must never inflect for one or two.
    expect(t('today.streakLabel', 1)).toBe('يوم متتالٍ');
    expect(t('today.streakLabel', 2)).toBe('يوم متتالٍ');
  });

  it('keeps the dual where the word REPLACES the numeral rather than joining it', () => {
    // A duration is the opposite case and must not be "corrected" to match the rule above: these
    // strings carry no {{value}} at one and two, so "ساعتين" IS the whole phrase — "بعد ساعتين",
    // after two hours. Writing "٢ ساعة" here would be the stilted half of the trade.
    expect(t('time.unit.hour', 1)).toBe('ساعة');
    expect(t('time.unit.hour', 2)).toBe('ساعتين');
    expect(t('time.unit.minute', 2)).toBe('دقيقتين');
  });

  it('uses the plural for three to ten', () => {
    expect(t('time.unit.minute', 6)).toContain('دقائق');
    expect(t('time.unit.hour', 6)).toContain('ساعات');
    expect(t('settings.reminders.pre.minutes', 10)).toContain('دقائق');
    expect(t('history.stats.windowLabel', 7)).toContain('أيام');
  });

  it('uses the accusative singular from eleven up', () => {
    expect(t('today.streakLabel', 46)).toBe('يومًا متتاليًا');
    expect(t('history.stats.windowLabel', 30)).toContain('يومًا');
  });

  it('never renders a bare Latin-grammar fallback for a count Arabic inflects', () => {
    // The shape of the original bug: every one of these came back as the `_other` form.
    const other = i18n.t('time.unit.hour', { lng: 'ar', count: 100, value: 100 });
    for (const count of [2, 3, 6, 10]) {
      expect(t('time.unit.hour', count)).not.toBe(other.replace('100', String(count)));
    }
  });
});

describe('English and Turkish are untouched by the polyfill', () => {
  it('keeps the two-form languages on one and other', () => {
    for (const lng of ['en', 'tr'] as const) {
      const categories = new Intl.PluralRules(lng).resolvedOptions().pluralCategories;
      expect(categories.sort()).toEqual(['one', 'other']);
    }
    expect(i18n.t('settings.reminders.pre.minutes', { lng: 'en', count: 1 })).toBe('1 min');
    expect(i18n.t('settings.reminders.pre.minutes', { lng: 'en', count: 5 })).toBe('5 min');
    expect(i18n.t('settings.reminders.pre.minutes', { lng: 'tr', count: 1 })).toBe('1 dk');
  });
});
