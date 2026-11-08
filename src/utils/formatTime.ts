/**
 * Time & duration formatting — the ONE place a clock time or a countdown becomes a string.
 *
 * Everything here is locale-aware and preference-aware:
 *
 * - **Clock times** go through `Intl.DateTimeFormat`, so hour cycle, digit shape (Latin vs
 *   Arabic-Indic) and day-period placement all follow the active locale. The user's
 *   `settings.timeFormat` (`system` | `12h` | `24h`) overrides the locale's hour cycle.
 * - **Durations** are assembled from i18n keys (`time.*`), never by concatenating English
 *   fragments: Arabic joins with "و" and Turkish puts its countdown marker *after* the
 *   duration ("2 saat sonra"), which a hardcoded "in {x}" could not express.
 *
 * Digits follow the locale's default numbering system (DESIGN.md §RTL), so a countdown and the
 * prayer time next to it always render in the same script.
 *
 * The module is deliberately free of React and of store imports: callers pass the locale and the
 * preference in (or accept the defaults — the active i18n language and `system`). That keeps it
 * unit-testable across locales without mounting anything.
 */

import i18n from '@/i18n';
import {
  activeNumberingSystem,
  enforceNumberingSystem,
  formatNumber as localizedNumber,
  numericLocale,
  resetNumeralCache,
} from '@/i18n/numerals';

import type { AppSettings } from '@/domain/types';

/** 12/24-hour display preference; `system` follows the device/locale clock. */
export type TimeFormatPreference = AppSettings['timeFormat'];

/** How much of the duration to spell out. */
export type DurationStyle = 'long' | 'compact';

export interface FormatTimeOptions {
  /** The user's preference. Defaults to `system`. */
  timeFormat?: TimeFormatPreference;
  /** BCP-47 tag. Defaults to the active i18n language. */
  locale?: string;
  /**
   * The device's 24-hour clock setting (expo-localization's `uses24hourClock`), consulted only
   * when `timeFormat` is `system`. When omitted/null the locale's own hour cycle decides.
   */
  uses24HourClock?: boolean | null;
}

export interface FormatDurationOptions {
  /**
   * `long` → "in 2 hours 7 minutes" (the hero countdown);
   * `compact` → "in 2 h 07 m" (the prayer-row caption). Defaults to `long`.
   */
  style?: DurationStyle;
  /** BCP-47 tag. Defaults to the active i18n language. */
  locale?: string;
  /**
   * Wrap the duration in the localized countdown phrase ("in …" / "… sonra"). Defaults to
   * `true`; pass `false` for a bare duration ("2 hours 7 minutes").
   */
  countdown?: boolean;
}

/** A duration broken into whole hours, minutes and seconds. */
export interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

// ---------------------------------------------------------------------------
// Intl plumbing
// ---------------------------------------------------------------------------

// The countdown re-formats once a second, so the (expensive) Intl objects are cached. The key
// space is tiny and bounded: {locale} × {12h, 24h}. Number formatters are cached by
// `i18n/numerals`, which owns them for the whole app.
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function activeLocale(locale?: string): string {
  return locale ?? i18n.resolvedLanguage ?? i18n.language ?? 'en';
}

function timeFormatter(locale: string, hour12: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${hour12 ? '12' : '24'}`;
  let formatter = timeFormatters.get(key);
  if (formatter === undefined) {
    // `hour12: false` is deliberately avoided: in several locales it resolves to the h24 cycle,
    // which renders midnight as "24:00". Asking for `h23` states the intent directly.
    //
    // The tag carries the numbering system (`ar-u-nu-arab`), so the clock and every counter beside
    // it are drawn from the same digits — see i18n/numerals.ts for the decision and why it is
    // pinned rather than left to whatever ICU data the device happens to ship.
    formatter = new Intl.DateTimeFormat(
      numericLocale(locale),
      hour12
        ? { hour: 'numeric', minute: '2-digit', hour12: true }
        : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    );
    timeFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats an integer in the locale's numbering system, zero-padded to `minimumIntegerDigits`.
 *
 * Padding happens inside `Intl.NumberFormat` on purpose: an Arabic-Indic "٠٧" cannot be produced
 * by padding a Latin string.
 *
 * Delegates to `i18n/numerals`, which is the single decision point for digit shape — so a
 * countdown, the clock beside it and a qada counter three screens away cannot disagree.
 */
function formatNumber(value: number, locale: string, minimumIntegerDigits = 1): string {
  return localizedNumber(value, locale, { minimumIntegerDigits, useGrouping: false });
}

/**
 * Resolves whether to render a 12-hour clock.
 *
 * @param timeFormat - The user's preference; `system` defers to `uses24HourClock`, then to the
 * locale's own hour cycle.
 */
export function resolveHour12(
  timeFormat: TimeFormatPreference = 'system',
  locale?: string,
  uses24HourClock?: boolean | null
): boolean {
  if (timeFormat === '12h') return true;
  if (timeFormat === '24h') return false;
  if (typeof uses24HourClock === 'boolean') return !uses24HourClock;
  const resolved = new Intl.DateTimeFormat(activeLocale(locale), {
    hour: 'numeric',
  }).resolvedOptions();
  // `hour12` is optional in the resolved options; the hour cycle is the reliable signal.
  return resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12' || resolved.hour12 === true;
}

// ---------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------

/**
 * Formats a clock time for display: "8:47 pm" (12-hour) or "20:47" (24-hour).
 *
 * The 12-hour form is lower-cased and uses a plain space before the day period (the design's
 * house style; ICU emits "PM" behind a narrow no-break space). The 24-hour form is zero-padded so
 * a column of times stays optically aligned.
 *
 * @param date - The instant to render. An invalid `Date` yields an empty string.
 * @param options - Preference, locale and the device clock setting.
 * @returns The localized time, ready to drop into a `<AppText variant="time">`.
 */
export function formatTime(date: Date, options: FormatTimeOptions = {}): string {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return '';

  const locale = activeLocale(options.locale);
  const hour12 = resolveHour12(options.timeFormat, locale, options.uses24HourClock);

  // The clock's digits are decided here, not by the tag: Hermes ignores `-u-nu-…`, so a time built
  // from `ar-u-nu-arab` came out as "4:51 م" beside Arabic-Indic numbers everywhere else. Mapping
  // the parts is what makes the whole screen agree (see i18n/numerals.ts).
  const system = activeNumberingSystem(locale);

  return timeFormatter(locale, hour12)
    .formatToParts(date)
    .map((part) => {
      if (part.type === 'dayPeriod') return part.value.toLowerCase();
      // ICU separates the day period with U+202F / U+00A0; normalise to a plain space so the
      // string measures and wraps predictably.
      if (part.type === 'literal') return part.value.replace(/[\s\u202f\u00a0]+/g, ' ');
      return enforceNumberingSystem(part.value, system);
    })
    .join('')
    .trim();
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * Splits a duration into whole hours/minutes/seconds, truncating (never rounding up) so the hero
 * countdown and the row caption built from the same instant always agree.
 *
 * @param ms - Milliseconds; negative input is clamped to zero.
 */
export function splitDuration(ms: number): DurationParts {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MS_PER_SECOND) : 0;
  return {
    hours: Math.floor(totalSeconds / SECONDS_PER_HOUR),
    minutes: Math.floor(totalSeconds / SECONDS_PER_MINUTE) % SECONDS_PER_MINUTE,
    seconds: totalSeconds % SECONDS_PER_MINUTE,
  };
}

function unit(
  key: 'hour' | 'minute' | 'second',
  count: number,
  locale: string,
  style: DurationStyle,
  minimumIntegerDigits = 1
): string {
  const value = formatNumber(count, locale, minimumIntegerDigits);
  if (style === 'compact') {
    // Short units do not inflect, so they take no plural `count` — just the pre-formatted value.
    return i18n.t(`time.unit.${key}Short`, { lng: locale, value });
  }
  return i18n.t(`time.unit.${key}`, { lng: locale, count, value });
}

function joinPair(first: string, second: string, locale: string): string {
  return i18n.t('time.durationPair', { lng: locale, first, second });
}

/**
 * Formats a remaining duration the way the design writes it.
 *
 * - `long`   → "in 2 hours 7 minutes", "in 7 minutes", "in 42 seconds"
 * - `compact`→ "in 2 h 07 m", "in 7 m", "in 42 s"
 *
 * Zero or negative input means the moment has arrived: the countdown form collapses to the
 * localized "now", the bare form to "0 seconds".
 *
 * @param ms - Milliseconds remaining.
 * @param options - Style, locale, and whether to wrap it as a countdown (default: yes).
 * @returns The localized phrase.
 */
export function formatDuration(ms: number, options: FormatDurationOptions = {}): string {
  const { style = 'long', countdown = true } = options;
  const locale = activeLocale(options.locale);

  if (!Number.isFinite(ms) || ms <= 0) {
    if (countdown) return i18n.t('time.now', { lng: locale });
    return unit('second', 0, locale, style);
  }

  const { hours, minutes, seconds } = splitDuration(ms);

  let duration: string;
  if (hours > 0) {
    const hoursPart = unit('hour', hours, locale, style);
    // The compact form pads the minutes ("2 h 07 m") so the caption keeps a fixed width as the
    // countdown runs down.
    duration =
      minutes > 0
        ? joinPair(
            hoursPart,
            unit('minute', minutes, locale, style, style === 'compact' ? 2 : 1),
            locale
          )
        : hoursPart;
  } else if (minutes > 0) {
    duration = unit('minute', minutes, locale, style);
  } else {
    duration = unit('second', seconds, locale, style);
  }

  return countdown ? i18n.t('time.countdown', { lng: locale, duration }) : duration;
}

/**
 * Convenience wrapper for a countdown to a moment in the future.
 *
 * @param target - When the prayer (or window) begins.
 * @param now - The current instant, typically from `useNow()`.
 */
export function formatCountdown(
  target: Date,
  now: Date,
  options: FormatDurationOptions = {}
): string {
  return formatDuration(target.getTime() - now.getTime(), options);
}

/** Clears the cached `Intl` formatters. Only needed by tests that swap locales aggressively. */
export function resetTimeFormatterCache(): void {
  timeFormatters.clear();
  resetNumeralCache();
}
