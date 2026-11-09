/**
 * Per-script type scale and leading. Pure (no React Native), so build scripts such as
 * `scripts/derive-arabic-layouts.ts` can read the same numbers the app renders with.
 * Re-exported from `./typography`.
 */

import type { ScriptFamily } from '../i18n/script';

/**
 * Per-language optical compensation: an Arabic face draws a smaller body than Lora at the same
 * nominal size, and Arabic legibility lives in exactly that body — the loops, teeth and
 * diacritics that tell letters apart. Every Latin-designed size that ends up set in Arabic is
 * multiplied by the ratio of the two x-heights.
 *
 * **The number was measured against the wrong font, and that is most of why Arabic looked small.**
 * Read straight out of the shipped TTFs (`__tests__/faceMetrics.test.ts` now pins all of these):
 *
 * ```
 * Lora 400           Latin x-height   500/1000
 * Amiri 400          Arabic body (ه)  337/1000     <- the face that was actually rendering
 * Amiri 400          Latin x-height   420/1000
 * Noto Naskh 400     Arabic body (ه)  433/1000
 * ```
 *
 * The 433 this constant was derived from is **Noto Naskh's** number, not Amiri's. Compensating
 * Amiri properly would have needed 500/337 ≈ 1.48, so Arabic UI text has been rendering about a
 * fifth smaller than the design intended for as long as the scale has existed — which is the
 * likeliest reason three separate owner reports (D67, D74, and the 2026-08-24 one behind D97) all
 * asked for the same tier to be raised again. Raising the shared sizes moved English too; the
 * miss was never in the sizes.
 *
 * With Noto Naskh carrying Arabic UI text the constant is finally true as written: 500/433 ≈ 1.15.
 *
 * Applied in ONE place, `AppText` (to the resolved font size *and* any explicit line height, so
 * tightened leading keeps its proportion), never as a bump at a call site. The Arabic-designed
 * variants (`heroArabic`, `rowArabic`) picked their sizes for Amiri already and are exempt.
 */
export const arabicTypeScale = 1.15;

/**
 * Urdu's size step, applied in `AppText` exactly like {@link arabicTypeScale}. Nastaliq at the
 * same nominal size already reads about as large as Lora, so it starts at 1 (D210).
 */
export const urduTypeScale = 1;

/**
 * The tightest leading an Urdu line may be set at, in ems (D210). Shaped Nastaliq ink, measured
 * from the shipped TTF, reaches 1.79 em above the baseline and 0.60 em below it, against Naskh's
 * 0.82 and 0.31. A Latin leading would clip the stacked letters, so every Urdu line gets at least
 * this, whether or not the variant set a line height.
 */
export const urduMinLeading = 2;

/**
 * The size step for a Latin-designed size set in another script — the one number `AppText`, the
 * seal pill and the tip cards all multiply by, so they can never disagree.
 */
export function typeScaleFor(script: ScriptFamily): number {
  if (script === 'urdu') return urduTypeScale;
  if (script === 'arabic') return arabicTypeScale;
  return 1;
}
