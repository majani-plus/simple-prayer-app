/**
 * Turning instants and durations into words, in three languages.
 *
 * The app has `src/utils/formatTime.ts` and `src/i18n/numerals.ts` for this. Neither is vendored:
 * they are built around React Native's constraints — chiefly that Hermes ships a cut-down `Intl`
 * that ignores the `-u-nu-` extension — and a browser has none of those problems. What IS carried
 * across is the decision they encode, because a reader with both should not meet two answers.
 *
 * Nothing here imports the string tables. The locale dictionaries hold every language at once, and
 * importing them from a browser module drags all three into the bundle — which is exactly how this
 * page first shipped 48 KB of marketing copy nobody reads. Strings arrive as parameters, from the
 * page that already knows its own language.
 */
export type Locale = 'en' | 'ar' | 'tr';

/** The duration vocabulary, lifted from the app's locale files (see appStrings.generated). */
export interface TimeStrings {
  countdown: string;
  now: string;
  durationPair: string;
  unit: Record<string, string>;
}

/**
 * The BCP-47 tag to hand `Intl`, following D40's ladder.
 *
 * D40: there is no single Arabic answer — CLDR splits the Arabic-speaking world between
 * Arabic-Indic (`٠١٢`, Egypt, Saudi, Iraq …) and Western digits (`012`, Morocco, Algeria, Tunisia,
 * and now the UAE). The app resolves it from the device's *formatting region* and pins the result
 * so it cannot drift when platform data updates. On the web the equivalent signal is
 * `navigator.language`, which is the browser's own formatting locale; when it carries no region we
 * fall to D40's step 3 — bare `ar` means `latn`, the digits every Arabic reader can read.
 *
 * The tag is pinned either way, so a CLDR update cannot silently change what the page shows.
 */
export function localeTag(locale: Locale): string {
  if (locale !== 'ar') return locale;
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  const region = /^ar-([A-Za-z]{2})\b/.exec(nav ?? '');
  return region ? `ar-${region[1].toUpperCase()}` : 'ar-u-nu-latn';
}

/**
 * Placeholder substitution, accepting both shapes in use here.
 *
 * The app's locale files (i18next) write `{{name}}`, sometimes with a formatter after a comma as
 * in `{{degrees, number}}`; this site's own dictionaries write `{name}`, as in
 * "Version {version} · {size} MB". Strings from both sources meet in this module, so all three
 * shapes are accepted — supporting one and silently ignoring the rest is a trap that has now
 * caught this code twice, once shipping the literal text "Times follow {method}."
 *
 * The formatter name is parsed and discarded: the values reaching here are already formatted for
 * the locale by `formatNumber`, which knows about D40's numbering systems in a way a generic
 * `number` hint does not.
 */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{?(\w+)(?:\s*,\s*[^}]+?)?\}?\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  );
}

/**
 * Today's calendar date **in a given zone**, as the `YYYY-MM-DD` string the domain expects.
 *
 * This is what lets the site render a city's own clock (D148). `en-CA` is not a display choice —
 * it is the shortest reliable way to get ISO order out of `Intl`.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A clock-time formatter for one locale and zone. Build once, reuse — constructing these is slow. */
export function timeFormatter(locale: Locale, timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The long date, e.g. "31 August" — the Gregorian half of the header line. */
export function dateFormatter(locale: Locale, timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(localeTag(locale), { timeZone, month: 'long', day: 'numeric' });
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale)).format(value);
}

/**
 * A duration as words: "2 hours 7 minutes", or compact "2 h 07 m".
 *
 * Plural selection goes through `Intl.PluralRules`, which matters well beyond English — the app's
 * Arabic file carries the full zero/one/two/few/many/other set, including the dual ("ساعتين"), and
 * picking `_other` for everything would produce sentences an Arabic reader would wince at.
 */
export function formatDuration(
  ms: number,
  locale: Locale,
  s: TimeStrings,
  style: 'long' | 'compact' = 'long'
): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const tag = localeTag(locale);

  if (style === 'compact') {
    const parts: string[] = [];
    if (hours > 0) parts.push(fill(s.unit.hourShort, { value: formatNumber(hours, locale) }));
    // Beside an hour the minutes are zero-padded, so the line does not change width as it counts
    // down past ten. The padding is done by Intl rather than `padStart('0')` because a locale using
    // Arabic-Indic digits needs ٠, not 0.
    const padded = new Intl.NumberFormat(tag, {
      minimumIntegerDigits: hours > 0 ? 2 : 1,
      useGrouping: false,
    }).format(minutes);
    parts.push(fill(s.unit.minuteShort, { value: padded }));
    return parts.join(' ');
  }

  const plural = new Intl.PluralRules(tag);
  const unit = (kind: 'hour' | 'minute', value: number): string => {
    const category = value === 0 ? 'zero' : plural.select(value);
    const template =
      s.unit[`${kind}_${category}`] ?? s.unit[`${kind}_other`] ?? `{{value}} ${kind}`;
    return fill(template, { value: formatNumber(value, locale) });
  };

  if (hours > 0 && minutes > 0) {
    return fill(s.durationPair, { first: unit('hour', hours), second: unit('minute', minutes) });
  }
  if (hours > 0) return unit('hour', hours);
  return unit('minute', minutes);
}
