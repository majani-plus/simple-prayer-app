/**
 * The Arabic bundle's spelling rules, held by test rather than by memory.
 *
 * These are the four defects from the 2026-08-30 audit that a future edit is most likely to
 * reintroduce, because each one *looks* right in isolation and only reads as wrong on screen or in
 * the wrong region. None of them is a translation judgement — every one is mechanical, which is why
 * it belongs here and not in a review.
 */

import ar from '../locales/ar.json';
import enBundle from '../locales/en.json';

/** Every leaf value in the bundle, with its dotted key. */
function entries(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    entries(value, path === '' ? key : `${path}.${key}`)
  );
}

const ALL = entries(ar);

describe('Arabic copy', () => {
  it('has values to check', () => {
    expect(ALL.length).toBeGreaterThan(900);
  });

  it('never hardcodes an Arabic-Indic digit', () => {
    // D40/D136 resolve the numbering system per region and render every number through
    // `formatNumber`. A literal ٣٠ in a sentence ignores that, so a reader in Morocco — whose whole
    // UI is 0123 — meets one string in ٠١٢٣. Numbers that belong in prose are spelled as words.
    // The one place a literal belongs: the Settings row that CHOOSES the numbering system labels
    // its options «٠١٢٣» and «0123». Those are the names of the two systems, not quantities, and
    // the formatter must never touch them — a reader picking Western digits still has to be able
    // to see which option is which.
    const NAMES_A_NUMBERING_SYSTEM = 'settings.home.appearance.numerals.arab';
    const offenders = ALL.filter(
      ([key, value]) => key !== NAMES_A_NUMBERING_SYSTEM && /[٠-٩]/.test(value)
    );
    expect(offenders.map(([key]) => key)).toEqual([]);
  });

  it('never leaves the lām of "for" stranded before a definite noun', () => {
    // `لـ{{prayer}}` renders «لـالفجر», which is not a word. Arabic contracts it to «للفجر», so a
    // string that ends in the tatwīl-lām can never be followed by a definite interpolation.
    const offenders = ALL.filter(([, value]) => /لـ\s*(?:ال|\{\{)/.test(value));
    expect(offenders.map(([key]) => key)).toEqual([]);
  });

  it('quotes with guillemets, never with ASCII double quotes', () => {
    // The file mixed «…» with escaped "…" in exactly one place. One convention, or the quoted
    // button label looks like a different kind of thing on one screen.
    const offenders = ALL.filter(([, value]) => value.includes('"'));
    expect(offenders.map(([key]) => key)).toEqual([]);
  });

  it('uses one word per tracked state, not three', () => {
    // The loudest finding of the audit: one concept had a different Arabic word depending on which
    // screen you were on, and the seal's spoken name shared no substring with its visible label.
    // These are the retired forms — each was a real value in the shipped bundle.
    const retired = [
      'مؤدّاة', // the administrative word for "prayed"; the app says صُلِّيت
      'مؤدَّاة', // …and its second spelling, in the same file
      'التلاوة', // Qur'anic recitation, used as the heading over a list of muezzins
    ];
    for (const word of retired) {
      const offenders = ALL.filter(([, value]) => value.includes(word));
      expect({ word, keys: offenders.map(([key]) => key) }).toEqual({ word, keys: [] });
    }
  });

  it('never invents an interpolation English does not declare, and never drops one outside a plural', () => {
    // A rewrite that drops a {{placeholder}} renders a sentence with a hole in it, and nothing
    // type-checks that. `locales.test.ts` guards the key set; this guards what is inside the values.
    //
    // Plural variants are deliberately exempt from the "never drops" half: Arabic's own word can
    // carry the count, so «صلاة واحدة» has no numeral where English writes "{{count}} prayer", and
    // «ساعتين» IS two hours. Inventing a placeholder is never right, in any form.
    const en = entries(enBundle);
    const arByKey = new Map(ALL);
    const isPluralForm = (key: string) => /_(zero|one|two|few|many|other)$/.test(key);
    const tokens = (value: string) =>
      (value.match(/\{\{\s*([^},\s]+)/g) ?? []).map((t) => t.replace(/^\{\{\s*/, '')).sort();

    /**
     * The one sanctioned omission, and it is a decision rather than an oversight (D111): the
     * English notification title is «{{prayer}} · {{arabic}}», Latin name beside the calligraphic
     * one. In Arabic the name already IS the Arabic, so the companion would print it twice.
     */
    const ARABIC_COMPANION_EXEMPT = new Set([
      'notifications.adhan.title',
      'notifications.preReminder.title',
      'notifications.nudge.title',
    ]);

    const invented: { key: string; extra: string[] }[] = [];
    const dropped: { key: string; missing: string[] }[] = [];
    for (const [key, value] of en) {
      const mine = arByKey.get(key);
      if (mine === undefined) continue;
      const want = new Set(tokens(value));
      const got = tokens(mine);
      const extra = got.filter((t) => !want.has(t));
      if (extra.length > 0) invented.push({ key, extra });
      if (!isPluralForm(key)) {
        const missing = [...want]
          .filter((t) => !got.includes(t))
          .filter((t) => !(t === 'arabic' && ARABIC_COMPANION_EXEMPT.has(key)));
        if (missing.length > 0) dropped.push({ key, missing });
      }
    }
    expect(invented).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
