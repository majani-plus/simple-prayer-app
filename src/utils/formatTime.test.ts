import { initI18n } from '@/i18n';
import { isolate } from '@/i18n/bidi';
import { numericLocale } from '@/i18n/numerals';
import {
  formatCountdown,
  formatDuration,
  formatTime,
  resetTimeFormatterCache,
  resolveHour12,
  splitDuration,
} from './formatTime';

/**
 * Expectations are built with the same primitive the formatter uses, so what the assertions pin
 * down is the *assembly* — hour cycle, padding, word order, pluralization, conjunctions — rather
 * than the glyphs. Which glyphs Arabic gets is a decision, and it is pinned in
 * `i18n/__tests__/numerals.test.ts`, not here.
 *
 * The tag goes through `numericLocale` because the numbering system is now **pinned** rather than
 * inherited: a bare `'ar'` resolves to `latn` on Node's ICU and to `arab` on several devices, and
 * the app must not render different digits depending on whose ICU data it landed on.
 */
function n(value: number, locale: string, minimumIntegerDigits = 1): string {
  return new Intl.NumberFormat(numericLocale(locale), {
    minimumIntegerDigits,
    useGrouping: false,
  }).format(value);
}

/**
 * The same number as it arrives *inside a translated sentence*.
 *
 * A duration is assembled from i18n keys, so its numerals pass through the interpolation
 * formatter — which bidi-isolates any Latin-digit run heading into a right-to-left string
 * (`i18n/bidi.ts`). The isolate is invisible on screen and is exactly what stops "بعد 2 س و07 د"
 * from coming apart at its neutrals, so the assertions state it rather than strip it.
 *
 * A clock time does **not** go through interpolation — `formatTime` returns `Intl`'s own output —
 * so those expectations keep using {@link n}.
 */
function ni(value: number, locale: string, minimumIntegerDigits = 1): string {
  return isolate(n(value, locale, minimumIntegerDigits));
}

/** A local-time instant, so the assertions hold in any machine time zone. */
function at(hours: number, minutes: number): Date {
  return new Date(2026, 6, 2, hours, minutes, 0, 0);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetTimeFormatterCache();
});

describe('resolveHour12', () => {
  it('honours an explicit preference over the locale', () => {
    expect(resolveHour12('12h', 'tr')).toBe(true);
    expect(resolveHour12('24h', 'en')).toBe(false);
  });

  it('follows the locale hour cycle for "system"', () => {
    expect(resolveHour12('system', 'en')).toBe(true);
    expect(resolveHour12('system', 'ar')).toBe(true);
    expect(resolveHour12('system', 'tr')).toBe(false);
  });

  it('lets the device clock setting override the locale for "system"', () => {
    expect(resolveHour12('system', 'en', true)).toBe(false);
    expect(resolveHour12('system', 'tr', false)).toBe(true);
  });

  it('ignores the device clock setting when the user chose a format', () => {
    expect(resolveHour12('12h', 'en', true)).toBe(true);
    expect(resolveHour12('24h', 'tr', false)).toBe(false);
  });
});

describe('formatTime', () => {
  it('renders the design’s 12-hour style: lowercase day period, plain space', () => {
    expect(formatTime(at(20, 47), { locale: 'en', timeFormat: '12h' })).toBe('8:47 pm');
    expect(formatTime(at(5, 4), { locale: 'en', timeFormat: '12h' })).toBe('5:04 am');
  });

  it('renders zero-padded 24-hour times so a column stays aligned', () => {
    expect(formatTime(at(20, 47), { locale: 'en', timeFormat: '24h' })).toBe('20:47');
    expect(formatTime(at(8, 5), { locale: 'en', timeFormat: '24h' })).toBe('08:05');
  });

  it('handles midnight in both formats', () => {
    expect(formatTime(at(0, 0), { locale: 'en', timeFormat: '12h' })).toBe('12:00 am');
    expect(formatTime(at(0, 0), { locale: 'en', timeFormat: '24h' })).toBe('00:00');
    expect(formatTime(at(0, 30), { locale: 'en', timeFormat: '24h' })).toBe('00:30');
  });

  it('handles noon in both formats', () => {
    expect(formatTime(at(12, 0), { locale: 'en', timeFormat: '12h' })).toBe('12:00 pm');
    expect(formatTime(at(12, 0), { locale: 'en', timeFormat: '24h' })).toBe('12:00');
    expect(formatTime(at(12, 59), { locale: 'en', timeFormat: '12h' })).toBe('12:59 pm');
  });

  it('follows the locale when the preference is "system"', () => {
    expect(formatTime(at(20, 47), { locale: 'en', timeFormat: 'system' })).toBe('8:47 pm');
    // Turkish is a 24-hour locale.
    expect(formatTime(at(20, 47), { locale: 'tr', timeFormat: 'system' })).toBe('20:47');
  });

  it('follows the device clock setting when the preference is "system"', () => {
    expect(formatTime(at(20, 47), { locale: 'en', uses24HourClock: true })).toBe('20:47');
    expect(formatTime(at(20, 47), { locale: 'tr', uses24HourClock: false })).toContain(
      `${n(8, 'tr')}:${n(47, 'tr')}`
    );
  });

  it('keeps Turkish day-period placement (it precedes the time)', () => {
    const formatted = formatTime(at(20, 47), { locale: 'tr', timeFormat: '12h' });
    expect(formatted).toBe(`ös ${n(8, 'tr')}:${n(47, 'tr')}`);
  });

  it('renders Arabic in the locale’s own digits and day period', () => {
    expect(formatTime(at(20, 47), { locale: 'ar', timeFormat: '12h' })).toBe(
      `${n(8, 'ar')}:${n(47, 'ar')} م`
    );
    expect(formatTime(at(8, 5), { locale: 'ar', timeFormat: '12h' })).toBe(
      `${n(8, 'ar')}:${n(5, 'ar', 2)} ص`
    );
    expect(formatTime(at(20, 47), { locale: 'ar', timeFormat: '24h' })).toBe(
      `${n(20, 'ar')}:${n(47, 'ar')}`
    );
  });

  it('never leaks a narrow no-break space into the output', () => {
    for (const locale of ['en', 'ar', 'tr']) {
      expect(formatTime(at(20, 47), { locale, timeFormat: '12h' })).not.toMatch(/[  ]/);
    }
  });

  it('falls back to the active i18n language when no locale is given', () => {
    expect(formatTime(at(20, 47), { timeFormat: '24h' })).toBe('20:47');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatTime(new Date(Number.NaN), { locale: 'en', timeFormat: '24h' })).toBe('');
  });
});

describe('splitDuration', () => {
  it('truncates to whole units', () => {
    expect(splitDuration(2 * HOUR + 7 * MINUTE + 59 * SECOND)).toEqual({
      hours: 2,
      minutes: 7,
      seconds: 59,
    });
    expect(splitDuration(999)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it('clamps negative and non-finite input to zero', () => {
    expect(splitDuration(-5 * MINUTE)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(splitDuration(Number.NaN)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });
});

describe('formatDuration — long (hero countdown)', () => {
  it('matches the mockup', () => {
    expect(formatDuration(2 * HOUR + 7 * MINUTE, { locale: 'en' })).toBe('in 2 hours 7 minutes');
  });

  it('drops the minutes when they are zero and uses singulars', () => {
    expect(formatDuration(2 * HOUR, { locale: 'en' })).toBe('in 2 hours');
    expect(formatDuration(HOUR, { locale: 'en' })).toBe('in 1 hour');
    expect(formatDuration(HOUR + MINUTE, { locale: 'en' })).toBe('in 1 hour 1 minute');
  });

  it('falls back to minutes, then to seconds', () => {
    expect(formatDuration(7 * MINUTE, { locale: 'en' })).toBe('in 7 minutes');
    expect(formatDuration(MINUTE, { locale: 'en' })).toBe('in 1 minute');
    expect(formatDuration(42 * SECOND, { locale: 'en' })).toBe('in 42 seconds');
    expect(formatDuration(SECOND, { locale: 'en' })).toBe('in 1 second');
  });

  it('ignores the seconds once there is at least a minute left', () => {
    expect(formatDuration(7 * MINUTE + 59 * SECOND, { locale: 'en' })).toBe('in 7 minutes');
  });

  it('collapses zero and negative durations to "now"', () => {
    expect(formatDuration(0, { locale: 'en' })).toBe('now');
    expect(formatDuration(-90 * MINUTE, { locale: 'en' })).toBe('now');
    expect(formatDuration(Number.NaN, { locale: 'en' })).toBe('now');
  });

  it('can render a bare duration without the countdown wrapper', () => {
    expect(formatDuration(2 * HOUR + 7 * MINUTE, { locale: 'en', countdown: false })).toBe(
      '2 hours 7 minutes'
    );
    expect(formatDuration(0, { locale: 'en', countdown: false })).toBe('0 seconds');
  });
});

describe('formatDuration — compact (row caption)', () => {
  it('matches the mockup, zero-padding the minutes', () => {
    expect(formatDuration(2 * HOUR + 7 * MINUTE, { locale: 'en', style: 'compact' })).toBe(
      'in 2 h 07 m'
    );
    expect(formatDuration(2 * HOUR + 47 * MINUTE, { locale: 'en', style: 'compact' })).toBe(
      'in 2 h 47 m'
    );
  });

  it('drops empty units', () => {
    expect(formatDuration(2 * HOUR, { locale: 'en', style: 'compact' })).toBe('in 2 h');
    expect(formatDuration(7 * MINUTE, { locale: 'en', style: 'compact' })).toBe('in 7 m');
    expect(formatDuration(42 * SECOND, { locale: 'en', style: 'compact' })).toBe('in 42 s');
  });

  it('never pluralizes the short units', () => {
    expect(formatDuration(HOUR + MINUTE, { locale: 'en', style: 'compact' })).toBe('in 1 h 01 m');
  });
});

describe('formatDuration — localization', () => {
  it('puts the Turkish countdown marker after the duration', () => {
    expect(formatDuration(2 * HOUR + 7 * MINUTE, { locale: 'tr' })).toBe('2 saat 7 dakika sonra');
    expect(formatDuration(7 * MINUTE, { locale: 'tr' })).toBe('7 dakika sonra');
    expect(formatDuration(42 * SECOND, { locale: 'tr' })).toBe('42 saniye sonra');
    expect(formatDuration(0, { locale: 'tr' })).toBe('şimdi');
  });

  it('uses the Turkish short units', () => {
    expect(formatDuration(2 * HOUR + 7 * MINUTE, { locale: 'tr', style: 'compact' })).toBe(
      '2 sa 07 dk sonra'
    );
    expect(formatDuration(42 * SECOND, { locale: 'tr', style: 'compact' })).toBe('42 sn sonra');
  });

  it('joins Arabic units with "و" and prefixes with "بعد"', () => {
    expect(formatDuration(2 * HOUR + 7 * MINUTE, { locale: 'ar' })).toBe(
      `بعد ساعتين و${ni(7, 'ar')} دقائق`
    );
    expect(formatDuration(0, { locale: 'ar' })).toBe('الآن');
  });

  it('uses the Arabic plural categories', () => {
    // one → no numeral at all; two → the dual; 3–10 → the paucal; 11+ → the accusative singular,
    // which carries its tanwīn: «١١ دقيقةً» is the tamyīz, and dropping the mark there is a
    // spelling error rather than a tashkeel preference.
    expect(formatDuration(HOUR, { locale: 'ar', countdown: false })).toBe('ساعة');
    expect(formatDuration(2 * HOUR, { locale: 'ar', countdown: false })).toBe('ساعتين');
    expect(formatDuration(3 * HOUR, { locale: 'ar', countdown: false })).toBe(
      `${ni(3, 'ar')} ساعات`
    );
    expect(formatDuration(11 * MINUTE, { locale: 'ar', countdown: false })).toBe(
      `${ni(11, 'ar')} دقيقةً`
    );
    expect(formatDuration(2 * MINUTE, { locale: 'ar', countdown: false })).toBe('دقيقتين');
    expect(formatDuration(2 * SECOND, { locale: 'ar', countdown: false })).toBe('ثانيتين');
  });

  it('uses the Arabic short units and pads the minutes in the same numbering system', () => {
    expect(formatDuration(2 * HOUR + 7 * MINUTE, { locale: 'ar', style: 'compact' })).toBe(
      `بعد ${ni(2, 'ar')} س و${ni(7, 'ar', 2)} د`
    );
  });

  it('formats every locale without falling back to a raw key', () => {
    for (const locale of ['en', 'ar', 'tr']) {
      for (const style of ['long', 'compact'] as const) {
        const value = formatDuration(HOUR + 5 * MINUTE, { locale, style });
        expect(value).not.toContain('time.');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('formatCountdown', () => {
  it('counts down from now to the target', () => {
    const now = at(18, 40);
    const target = at(20, 47);
    expect(formatCountdown(target, now, { locale: 'en' })).toBe('in 2 hours 7 minutes');
    expect(formatCountdown(target, now, { locale: 'en', style: 'compact' })).toBe('in 2 h 07 m');
  });

  it('says "now" once the target has passed', () => {
    expect(formatCountdown(at(18, 0), at(18, 40), { locale: 'en' })).toBe('now');
  });
});
