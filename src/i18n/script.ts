/**
 * Script families: which fonts draw a language's text. Pure (no React Native), so services and
 * the domain-adjacent code can ask too. Re-exported from `./direction`.
 */

/** The script families the app sets text in; see {@link scriptFamilyFor}. */
export type ScriptFamily = 'arabic' | 'urdu' | 'latin';

/**
 * Which script family a language's UI text is set in, and so which fonts draw it (D210).
 *
 * - `'arabic'`: Arabic, in Noto Naskh Arabic (UI) and Amiri (calligraphy).
 * - `'urdu'`: Urdu, in Noto Nastaliq Urdu in the app. Native surfaces (widgets, watches) have no
 *   room for Nastaliq's height and draw Urdu like Arabic, in Naskh.
 * - `'latin'`: everything else, in Lora.
 *
 * This is the question most `'ar'` checks were really asking. Direction is a separate question
 * ({@link isRtlLanguage}); digits are another again (`./numerals`): Urdu is right-to-left and
 * Arabic-script, but its digits are Western.
 *
 * @param language - BCP-47 tag, or `null`/`undefined` before i18next has resolved one.
 */
export function scriptFamilyFor(language: string | null | undefined): ScriptFamily {
  const subtag = (language ?? '').toLowerCase().split(/[-_]/)[0];
  if (subtag === 'ar') return 'arabic';
  if (subtag === 'ur') return 'urdu';
  return 'latin';
}
