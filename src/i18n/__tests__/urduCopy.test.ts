/**
 * Urdu is written with Urdu letters (TONE.md, "Urdu glossary"; D210).
 *
 * Urdu and Arabic share most of the alphabet but not three common letters: Urdu writes ی ک ہ where
 * Arabic writes ي ك ه. They look alike in one font and differently in another, they break search
 * and sorting, and Nastaliq shapes the Arabic forms badly. Digits are Western.
 */
import ur from '../locales/ur.json';

/** Values that are another language's own text by design: its name, and the Arabic digits sample. */
const NOT_URDU = new Set([
  'settings.home.appearance.language.ar',
  'settings.home.appearance.numerals.arab',
]);

function flatten(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`)
  );
}

const ENTRIES = flatten(ur).filter(([key]) => !NOT_URDU.has(key));

describe('the Urdu bundle', () => {
  it('uses Urdu ی ک ہ, never Arabic ي ك ه', () => {
    const offenders = ENTRIES.filter(([, text]) => /[يكه]/.test(text)).map(
      ([key]) => key
    );
    expect(offenders).toEqual([]);
  });

  it('writes Western digits only', () => {
    const offenders = ENTRIES.filter(([, text]) => /[٠-٩۰-۹]/.test(text)).map(
      ([key]) => key
    );
    expect(offenders).toEqual([]);
  });
});
