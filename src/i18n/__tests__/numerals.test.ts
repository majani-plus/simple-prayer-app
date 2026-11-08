/**
 * The numeral decision, pinned (D40 — see `i18n/numerals.ts` for the reasoning).
 *
 * This file exists because the decision is *invisible* until it is wrong: nothing crashes when
 * Arabic renders `٠٥:١٢` on one phone and `05:12` on another, and nothing crashes when a screen
 * shows a clock in one system and a counter beside it in the other. Both are silent, and both are
 * the sort of thing an Arabic reader notices in the first second (our market research).
 *
 * So what is asserted here is not "Arabic uses these glyphs" — it is:
 *
 * 1. the digits are **resolved from the region**, both directions,
 * 2. the resolution is **pinned into the tag**, so no ICU version can quietly change it, and
 * 3. the *same* answer reaches every surface — a clock, a counter and a translated sentence.
 */

import {
  DIGIT_CHARACTERS,
  NON_DIGIT_CHARACTERS,
  deviceRegionCode,
  formatNumber,
  numberingSystemFor,
  numericLocale,
  regionFromLanguageTag,
  resetNumeralCache,
  toAsciiDigits,
} from '../numerals';
import i18n, { initI18n } from '../index';
import { formatTime } from '@/utils/formatTime';

/** Arabic-Indic ٠…٩ and Western 0…9, for readable assertions. */
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

beforeAll(() => {
  initI18n();
});

afterEach(() => {
  resetNumeralCache();
});

describe('regionFromLanguageTag', () => {
  it('reads the region out of a tag, whatever else the tag carries', () => {
    expect(regionFromLanguageTag('ar-EG')).toBe('EG');
    expect(regionFromLanguageTag('ar-Arab-MA')).toBe('MA');
    expect(regionFromLanguageTag('ar-eg')).toBe('EG');
    expect(regionFromLanguageTag('es-419')).toBe('419');
  });

  it('answers null when there is no region to read', () => {
    expect(regionFromLanguageTag('ar')).toBeNull();
    expect(regionFromLanguageTag('en')).toBeNull();
    // A `-u-` extension is not a region.
    expect(regionFromLanguageTag('ar-u-nu-arab')).toBeNull();
  });
});

describe('numberingSystemFor', () => {
  it('gives Arabic-Indic digits to the regions that write them', () => {
    for (const region of ['EG', 'SA', 'IQ', 'JO', 'PS', 'QA', 'KW', 'YE', 'SD']) {
      expect(numberingSystemFor(`ar-${region}`)).toBe('arab');
    }
  });

  it('gives Western digits to the Maghreb and the UAE, which write them', () => {
    for (const region of ['MA', 'DZ', 'TN', 'LY', 'AE', 'EH']) {
      expect(numberingSystemFor(`ar-${region}`)).toBe('latn');
    }
  });

  it('falls back to the device region when the tag has none', () => {
    expect(numberingSystemFor('ar', 'EG')).toBe('arab');
    expect(numberingSystemFor('ar', 'MA')).toBe('latn');
    expect(numberingSystemFor('ar', 'eg')).toBe('arab');
  });

  it('lets the tag win over the device region', () => {
    // A Moroccan phone reading an ar-EG bundle still gets that bundle's digits.
    expect(numberingSystemFor('ar-EG', 'MA')).toBe('arab');
    expect(numberingSystemFor('ar-MA', 'EG')).toBe('latn');
  });

  it('takes the universally readable form when nothing says otherwise', () => {
    // CLDR's own default for the bare `ar` tag, and the safe answer for a reader we cannot place.
    expect(numberingSystemFor('ar')).toBe('latn');
    expect(numberingSystemFor('ar', null)).toBe('latn');
  });

  it('never gives a non-Arabic language Arabic-Indic digits, whatever the region', () => {
    expect(numberingSystemFor('en', 'EG')).toBe('latn');
    expect(numberingSystemFor('tr', 'SA')).toBe('latn');
    // `arabic` is not `ar`.
    expect(numberingSystemFor('arn')).toBe('latn');
  });
});

describe('numericLocale', () => {
  it('pins the numbering system into the tag rather than leaving it to the platform', () => {
    expect(numericLocale('ar-EG')).toBe('ar-EG-u-nu-arab');
    expect(numericLocale('ar-MA')).toBe('ar-MA-u-nu-latn');
    expect(numericLocale('tr')).toBe('tr-u-nu-latn');
  });

  it('leaves a tag that already states its own extension alone', () => {
    expect(numericLocale('ar-u-nu-arab')).toBe('ar-u-nu-arab');
  });

  it('resolves the bare app tag against the device region', () => {
    // The Jest device is en-US, so the bare Arabic tag lands on Western digits.
    expect(deviceRegionCode()).toBe('US');
    expect(numericLocale('ar')).toBe('ar-u-nu-latn');
  });

  it('never grows a region, because a region carries a calendar with it', () => {
    // Attaching the device region is the tempting fix for Hermes ignoring `-u-nu-…`, and it is
    // wrong: `ar-SA`'s CLDR default calendar is islamic-umalqura, so every DateTimeFormat built
    // on it switches to Hijri and the Today header prints its Gregorian date twice in Hijri.
    // The digits are corrected in the output instead (see `localizePart`).
    for (const tag of ['ar', 'en', 'tr']) {
      expect(numericLocale(tag)).not.toMatch(/^[a-z]{2}-[A-Z]{2}/);
    }
  });

  it('actually changes what Intl produces', () => {
    expect(new Intl.NumberFormat(numericLocale('ar-EG')).format(2026)).toContain(ARABIC_INDIC[2]);
    expect(new Intl.NumberFormat(numericLocale('ar-MA')).format(2026)).toContain('2');
  });
});

describe('the Hermes shape of Intl', () => {
  /**
   * Node has a complete `Intl`; the shipped engine does not. Both bugs this suite now guards
   * were invisible here until the simulator found them, so these two cases deliberately take the
   * methods away rather than trusting the environment.
   */
  it('formats without Intl.NumberFormat.prototype.formatToParts', () => {
    const real = Intl.NumberFormat.prototype.formatToParts;
    // @ts-expect-error — reproducing Hermes, which simply does not define it.
    delete Intl.NumberFormat.prototype.formatToParts;
    try {
      resetNumeralCache();
      expect(formatNumber(2026, 'ar-EG')).toBe('٢٬٠٢٦');
      expect(formatNumber(2026, 'en')).toBe('2,026');
    } finally {
      Intl.NumberFormat.prototype.formatToParts = real;
      resetNumeralCache();
    }
  });

  it('puts Arabic separators around Arabic digits', () => {
    expect(formatNumber(2405, 'ar-EG', { useGrouping: true })).toBe('٢٬٤٠٥');
    expect(formatNumber(1.5, 'ar-EG')).toBe('١٫٥');
  });

  it('leaves a Western-digit Arabic region with its own separators', () => {
    // The Maghreb writes 0123; nothing here may reshape the marks around them.
    expect(formatNumber(2405, 'ar-MA', { useGrouping: true })).not.toContain('٬');
  });
});

describe('formatNumber', () => {
  it('renders the same figure in each of the three languages', () => {
    expect(formatNumber(1234, 'en', { useGrouping: false })).toBe('1234');
    expect(formatNumber(1234, 'tr', { useGrouping: false })).toBe('1234');
    expect(formatNumber(1234, 'ar', { useGrouping: false })).toBe('1234');
    expect(formatNumber(1234, 'ar-EG', { useGrouping: false })).toBe('١٢٣٤');
  });

  it('pads inside the formatter, because "٠٧" cannot be made by padding a Latin string', () => {
    expect(formatNumber(7, 'ar-EG', { minimumIntegerDigits: 2 })).toBe('٠٧');
    expect(formatNumber(7, 'en', { minimumIntegerDigits: 2 })).toBe('07');
  });

  it('carries options through', () => {
    expect(formatNumber(0.75, 'en', { style: 'percent', maximumFractionDigits: 0 })).toBe('75%');
    expect(formatNumber(0.75, 'ar-EG', { style: 'percent', maximumFractionDigits: 0 })).toContain(
      '٧٥'
    );
  });

  it('renders nothing rather than "NaN" for a value that is not a number', () => {
    expect(formatNumber(Number.NaN, 'en')).toBe('');
    expect(formatNumber(Number.POSITIVE_INFINITY, 'ar')).toBe('');
  });
});

describe('one decision, every surface', () => {
  /**
   * The failure this guards against is not a wrong digit — it is *two* digit systems on one
   * screen: a clock from `Intl.DateTimeFormat`, a counter from `Intl.NumberFormat`, and a
   * countdown assembled out of i18n keys, all rendering the same number differently because each
   * resolved the locale for itself.
   */
  it.each([
    ['ar-EG', ARABIC_INDIC],
    ['ar-MA', '0123456789'],
    ['en', '0123456789'],
    ['tr', '0123456789'],
  ])('%s draws its clock and its counters from the same numerals', (locale, digits) => {
    const clock = formatTime(new Date(2026, 6, 2, 20, 47), { locale, timeFormat: '24h' });
    const counter = formatNumber(2047, locale, { useGrouping: false });

    const expected = `${digits[2]}${digits[0]}:${digits[4]}${digits[7]}`;
    expect(clock).toBe(expected);
    expect(counter).toBe(`${digits[2]}${digits[0]}${digits[4]}${digits[7]}`);
  });

  it('sends the same numerals through a translated sentence', () => {
    // `{{count}}` goes through the interpolation formatter, which is built on this module — so a
    // sentence and the clock above it cannot disagree.
    const sentence = i18n.t('qada.count', { lng: 'ar-EG', count: 12 });
    expect(sentence).toContain('١٢');
    expect(sentence).not.toContain('12');
  });
});

describe('digits coming back in', () => {
  /**
   * A number pad on an Arabic-locale phone emits U+0660–U+0669. Every field the user types a
   * count into has to accept them, and every parse has to normalize them — `Number.parseInt`
   * reads ASCII and nothing else.
   */
  it('rewrites Arabic-Indic and Persian digits as ASCII', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(toAsciiDigits('٤٢')).toBe('42');
  });

  it('leaves everything that is not a digit exactly as it was', () => {
    expect(toAsciiDigits('صلاة ٥')).toBe('صلاة 5');
    expect(toAsciiDigits('42')).toBe('42');
    expect(toAsciiDigits('')).toBe('');
  });

  it('round-trips a formatted number', () => {
    expect(
      Number.parseInt(toAsciiDigits(formatNumber(3057, 'ar-EG', { useGrouping: false })), 10)
    ).toBe(3057);
  });

  it('recognises a digit of any script, so a field filter cannot eat Arabic keystrokes', () => {
    expect(DIGIT_CHARACTERS.test('٣')).toBe(true);
    expect(DIGIT_CHARACTERS.test('3')).toBe(true);
    expect(DIGIT_CHARACTERS.test('س')).toBe(false);
    // The exact filter the qada wizard's fields run on their input.
    expect('٣ا4'.replace(NON_DIGIT_CHARACTERS, '')).toBe('٣4');
  });
});
