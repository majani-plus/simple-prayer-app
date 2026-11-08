/**
 * The i18next formatter — where every interpolated value gets its digits and its bidi isolation.
 *
 * i18next hands each `{{placeholder}}` to a formatter module before splicing it into the string.
 * With `interpolation.alwaysFormat`, that happens for *every* placeholder, not only the ones a
 * translator remembered to annotate — which is the whole point. Two guarantees follow from one
 * choke point:
 *
 * 1. **A number is never a `String(n)`.** It goes through `./numerals`, so an Arabic sentence
 *    cannot end up carrying `3` while the time beside it reads `٠٣`.
 * 2. **A run never reorders.** Anything that would form an island in the target paragraph is
 *    wrapped in FSI…PDI by `./bidi` — automatically, for all three languages, in accessibility
 *    labels and notification bodies as much as on screen.
 *
 * Replacing i18next's built-in formatter (rather than wrapping it) is deliberate: the built-in
 * `number` format calls `Intl.NumberFormat(lng)`, which resolves the *plain* tag and so cannot be
 * pinned to a numbering system. `{{distance, number}}` in the locale files keeps working — it is
 * reimplemented here, on `./numerals` — and an unknown format name degrades to the plain value
 * rather than throwing inside a render.
 *
 * The module never imports the i18next singleton, so it cannot participate in a cycle with
 * `./index`.
 */

import { isolateFor } from './bidi';
import { directionFor } from './direction';
import { formatNumber } from './numerals';

import type { FormatterModule, InitOptions, Services } from 'i18next';

/** Option shapes for the format names the locale files actually use. */
const NUMBER_FORMATS: Record<string, Intl.NumberFormatOptions | undefined> = {
  number: {},
  percent: { style: 'percent', maximumFractionDigits: 0 },
};

/**
 * Renders one interpolated value.
 *
 * @param value - Whatever the caller passed in `t(key, { … })`.
 * @param format - The annotation after the comma (`{{n, number}}`), or `undefined`.
 * @param language - The language the surrounding string is being rendered in.
 * @returns The value as text, localized and isolated.
 */
export function formatInterpolatedValue(
  value: unknown,
  format: string | undefined,
  language: string
): string {
  const text = stringify(value, format, language);
  return isolateFor(text, directionFor(language));
}

function stringify(value: unknown, format: string | undefined, language: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    const options = format === undefined ? {} : (NUMBER_FORMATS[format.trim()] ?? {});
    return formatNumber(value, language, options);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  // Arrays and objects have no sensible localized form; `String` is at least stable and visible
  // in a test rather than silently empty.
  return String(value);
}

/**
 * The formatter module handed to `i18n.use(...)`.
 *
 * `add`/`addCached` exist because the `Formatter` interface requires them; this app registers no
 * named formats of its own, and a silently-ignored registration would be worse than none, so they
 * are wired to the same table the built-in names come from.
 */
export function createFormatter(): FormatterModule {
  const extra = new Map<string, (value: unknown, lng: string | undefined) => string>();

  return {
    type: 'formatter',
    init(_services: Services, _options: InitOptions) {
      // Nothing to bind: every input this formatter needs arrives with the call.
    },
    add(name, fc) {
      extra.set(name.toLowerCase().trim(), (value, lng) => fc(value, lng, {}));
    },
    addCached(name, fc) {
      extra.set(name.toLowerCase().trim(), (value, lng) => fc(lng, {})(value));
    },
    format(value: unknown, format: string | undefined, lng: string | undefined): string {
      const language = lng ?? 'en';
      const named = format === undefined ? undefined : extra.get(format.toLowerCase().trim());
      if (named !== undefined) return isolateFor(named(value, lng), directionFor(language));
      return formatInterpolatedValue(value, format, language);
    },
  };
}
