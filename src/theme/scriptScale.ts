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
 * Noto Nastaliq Urdu's vertical metrics, in ems, read from the shipped TTF: the font's own box
 * (hhea ascent 1.904, descent 0.596) and the furthest its shaped ink reaches (the kaf's top stroke
 * in «علیکم» at 2.02 above the baseline in Bold; tails at 0.68 below). `AppText` uses them on iOS,
 * which centres the glyphs in a line shorter than the font box and clips at the text view's edge.
 */
export const NASTALIQ_METRICS = Object.freeze({
  ascent: 1.904,
  descent: 0.596,
  inkTop: 2.05,
  inkBottom: 0.7,
});

/**
 * The extra room, in ems, an Urdu text view needs above its first line and below its last on iOS,
 * so the tallest Nastaliq letters are not cut off. Only the view's two outer edges clip; the lines
 * inside may overlap each other's spare space freely.
 *
 * iOS places the font's box centred in the line (React Native's baseline offset), so a line
 * shorter than the box loses half the difference at each end.
 *
 * @param lineHeightEm - The line height in ems.
 * @returns Room to add at the top and at the bottom, never negative.
 */
export function nastaliqOverflow(lineHeightEm: number): { top: number; bottom: number } {
  const { ascent, descent, inkTop, inkBottom } = NASTALIQ_METRICS;
  const shift = (ascent + descent - lineHeightEm) / 2;
  return {
    top: Math.max(0, inkTop - (ascent - shift)),
    bottom: Math.max(0, inkBottom - (descent - shift)),
  };
}

/**
 * The size step for a Latin-designed size set in another script — the one number `AppText`, the
 * seal pill and the tip cards all multiply by, so they can never disagree.
 */
export function typeScaleFor(script: ScriptFamily): number {
  if (script === 'urdu') return urduTypeScale;
  if (script === 'arabic') return arabicTypeScale;
  return 1;
}
