/**
 * Bidi safety, end to end.
 *
 * The bug this file guards against cannot be seen in a string dump — it happens in the *renderer*,
 * when the Unicode Bidirectional Algorithm reorders a Latin or digit run inside an Arabic
 * sentence and drags the punctuation around it to the wrong side. What a test *can* pin down is
 * that the isolate is there, that it wraps the right run, and that it survives the whole path from
 * `t()` to the string a `<Text>` receives.
 *
 * So the assertions are structural: which run is wrapped, which is deliberately left bare, and that
 * the wrapper is a *first-strong* isolate rather than an embedding or a mark — the property that
 * lets a value whose direction nobody knows at authoring time (a city name from the OS geocoder)
 * come out right in both cases.
 */

import { FSI, PDI, isolate, isolateFor, needsIsolation, stripBidi } from '../bidi';
import i18n, { initI18n } from '../index';

beforeAll(() => {
  initI18n();
});

describe('needsIsolation', () => {
  it('protects a Latin or digit run heading into right-to-left text', () => {
    expect(needsIsolation('05:12', 'rtl')).toBe(true);
    expect(needsIsolation('GMT+3', 'rtl')).toBe(true);
    expect(needsIsolation('Diyanet', 'rtl')).toBe(true);
    expect(needsIsolation('1.0.0', 'rtl')).toBe(true);
  });

  it('leaves Arabic-Indic digits alone inside Arabic', () => {
    // U+0660…U+0669 are bidi class AN, which does not reorder against the AL letters around it.
    // Wrapping them would put an invisible control into every countdown for nothing.
    expect(needsIsolation('٠٥:١٢', 'rtl')).toBe(false);
    expect(needsIsolation('الرياض', 'rtl')).toBe(false);
  });

  it('protects an Arabic run heading into left-to-right text', () => {
    expect(needsIsolation('الرياض', 'ltr')).toBe(true);
    expect(needsIsolation('المغرب', 'ltr')).toBe(true);
  });

  it('leaves an ordinary Latin value in English alone', () => {
    expect(needsIsolation('05:12', 'ltr')).toBe(false);
    expect(needsIsolation('Istanbul', 'ltr')).toBe(false);
    expect(needsIsolation('', 'ltr')).toBe(false);
  });

  it('does not wrap a run whose islands are already isolated', () => {
    // Durations are assembled key-by-key, so the same value passes the formatter several times.
    // Three nested isolates around one number are correct but unreadable; one is enough.
    expect(needsIsolation(`${FSI}7${PDI} دقائق`, 'rtl')).toBe(false);
  });
});

describe('isolate', () => {
  it('wraps in FSI … PDI, the pair that contains a run rather than nudging it', () => {
    expect(isolate('05:12')).toBe(`${FSI}05:12${PDI}`);
    expect(isolate('x')).toBe(`${FSI}x${PDI}`);
  });

  it('never wraps twice, and never wraps nothing', () => {
    expect(isolate(isolate('42'))).toBe(isolate('42'));
    expect(isolate('')).toBe('');
  });

  it('is invisible once stripped, which is what the reader sees', () => {
    expect(stripBidi(isolate('05:12'))).toBe('05:12');
    expect(stripBidi('\u200e5\u200f')).toBe('5');
  });

  it('isolateFor only pays the cost where the paragraph would reorder', () => {
    expect(isolateFor('05:12', 'rtl')).toBe(isolate('05:12'));
    expect(isolateFor('05:12', 'ltr')).toBe('05:12');
  });
});

describe('the interpolation formatter applies it without anyone remembering to', () => {
  it('isolates a number dropped into an Arabic sentence', () => {
    const arabic = i18n.t('qada.card.a11yLabel', { lng: 'ar', total: '7' });
    expect(arabic).toContain(isolate('7'));
    expect(stripBidi(arabic)).toContain('7');
  });

  it('leaves the same sentence in English untouched', () => {
    const english = i18n.t('qada.card.a11yLabel', { lng: 'en', total: '7' });
    expect(english).not.toContain(FSI);
  });

  it('isolates an Arabic value dropped into an English sentence — the mirror case', () => {
    const english = i18n.t('qibla.header', { lng: 'en', city: 'الرياض' });
    expect(english).toContain(isolate('الرياض'));
  });

  it('localizes the number and protects it in the same pass — but only where it needs it', () => {
    // `{{degrees, number}}` is localized by our own formatter, so the digits follow the numeral
    // decision (i18n/numerals.ts) *and* the isolation decision together.
    const bearing = (lng: string) =>
      i18n.t('qibla.value.bearing', {
        lng,
        degrees: 58,
        cardinal: i18n.t('qibla.cardinal.ne', { lng }),
      });

    // A Western-digit region: `58` is bidi class EN, an LTR island in Arabic, so it is wrapped.
    expect(bearing('ar-MA')).toContain(isolate('58'));
    // An Arabic-Indic region: `٥٨` is class AN, which sits inside Arabic without reordering. No
    // isolate, because there is nothing to isolate it from — and an invisible control on every
    // bearing, countdown and counter for nothing is a cost, not a safety net.
    expect(bearing('ar-EG')).toContain('٥٨');
    expect(bearing('ar-EG')).not.toContain(FSI);
  });
});

describe('a sentence that mixes Arabic, a number and a Latin abbreviation', () => {
  /**
   * The worst realistic case in this app: an Arabic city note carrying a clock time *and* a
   * zone abbreviation. Every neutral character in it — the space, the `+`, the colon, the
   * brackets — is up for grabs by whichever side of the boundary wins.
   */
  /** Built per test: `describe` bodies run before `beforeAll`, so i18next is not ready yet. */
  const CITY = 'Doha (GMT+3) 05:12';
  const build = () => i18n.t('qibla.header', { lng: 'ar', city: CITY });

  it('isolates the whole mixed run as one object', () => {
    expect(build()).toContain(`${FSI}${CITY}${PDI}`);
  });

  it('keeps the Arabic around it un-isolated, so only the island is wrapped', () => {
    expect(build().replace(`${FSI}${CITY}${PDI}`, '')).not.toContain(FSI);
  });

  it('changes nothing a reader can see', () => {
    const sentence = build();
    expect(stripBidi(sentence)).toBe(sentence.replace(FSI, '').replace(PDI, ''));
    expect(stripBidi(sentence)).toContain(CITY);
  });

  it('uses a *first-strong* isolate, so a value of unknown direction is handled either way', () => {
    // The city label comes from the OS geocoder: on the same Arabic phone it can arrive as
    // "الرياض" or as "Doha". FSI asks the run itself which way it goes, so neither case needs the
    // call site to know — which is exactly why this is FSI and not LRE/RLE or a bare LRM.
    const latin = i18n.t('qibla.header', { lng: 'ar', city: 'Doha' });
    const arabic = i18n.t('qibla.header', { lng: 'ar', city: 'الرياض' });

    expect(latin).toContain(`${FSI}Doha${PDI}`);
    // The Arabic city needs no protection *in* Arabic, and does not get any.
    expect(arabic).not.toContain(FSI);
    expect(arabic).toContain('الرياض');
  });

  it('protects the value even when it opens or closes on a neutral', () => {
    // The characters with no direction of their own — brackets, +, :, ° — are the ones that get
    // pulled to the wrong side, and a value that *begins* with one has nothing but the isolate
    // holding it together.
    for (const city of ['(Doha)', '+3 GMT', '05:12 AM', '"Doha"']) {
      expect(i18n.t('qibla.header', { lng: 'ar', city })).toContain(`${FSI}${city}${PDI}`);
    }
  });
});
