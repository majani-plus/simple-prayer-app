/**
 * Layout direction — the half of "Arabic" that is not translation (PRODUCT_SPEC §12, D24).
 *
 * Our market research is blunt about the failure mode: most "bilingual" apps are English apps
 * with machine-translated strings, and Arabic readers spot it in the first second — because the
 * *layout* never turned around. Strings are a file; direction is a native flag.
 *
 * ## The three facts React Native forces on us
 *
 * 1. **`I18nManager.isRTL` is a constant, captured when the JS bundle boots.** `forceRTL()` writes
 *    a persisted native preference (`NSUserDefaults` on iOS, `SharedPreferences` on Android) that
 *    the *next* launch reads. Nothing in the running session changes: Yoga has already laid the
 *    tree out, `flexDirection: 'row'` has already resolved. Hence {@link needsReloadFor} and the
 *    restart flow in `./useLanguageSwitch` — there is no "apply now" to reach for.
 * 2. **`allowRTL` and `forceRTL` must move together, and both must follow the app language.**
 *    RN resolves `isRTL = forced || (allowed && devicePreferredLanguageIsRTL)`. Leaving
 *    `allowRTL(true)` standing while the user reads the app in English would mirror the *English*
 *    UI on an Arabic phone — the layout would follow the SIM instead of the setting. So both take
 *    the same value: the direction of the language the app is actually rendering.
 * 3. **Physical edges are already logical.** With `doLeftAndRightSwapInRTL` (RN's default, still
 *    true in 0.86), Fabric rewrites `left/right`, `margin/padding-left/right`, `border*Radius` and
 *    even `textAlign: 'left' | 'right'` to their start/end equivalents when the surface is RTL.
 *    Writing `start`/`end` says the intent out loud and is preferred for anything new, but a
 *    `textAlign: 'right'` already in the tree is *not* a bug and must not be "fixed" by flipping
 *    it on `isRTL` — that would swap it twice and land it back on the wrong edge.
 *
 * ## What this module does not decide
 *
 * Direction is a property of *layout*, not of geography or of clocks. The compass dial, its
 * cardinal letters and the Qibla needle are a map: they never mirror (DESIGN.md §RTL is explicit,
 * and every one of their absolute offsets is a symmetric centring so the auto-swap above cannot
 * disturb them either). "Turn left"/"turn right" on the Qibla screen are instructions about the
 * user's body, so their glyphs stay put too. Clock times are read left-to-right in Arabic as
 * everywhere else; only the *digits* change (see `./numerals`).
 */

import { I18nManager } from 'react-native';

import type { TextDirection } from './bidi';

export type { TextDirection };

/**
 * The languages this app renders right-to-left. A `Set` rather than a regex so adding Hebrew or
 * Farsi later is a one-line change with a matching test, not a pattern nobody dares touch.
 */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'fa', 'he', 'ur']);

/**
 * Whether a language tag is written right-to-left.
 *
 * Matches on the *language subtag* only, so `ar`, `ar-EG` and `AR` all agree.
 *
 * @param language - BCP-47 tag, or `null`/`undefined` before i18next has resolved one.
 */
export function isRtlLanguage(language: string | null | undefined): boolean {
  if (language === null || language === undefined) return false;
  const subtag = language.toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(subtag);
}

/**
 * The direction a language should be laid out in.
 *
 * @param language - BCP-47 tag.
 */
export function directionFor(language: string | null | undefined): TextDirection {
  return isRtlLanguage(language) ? 'rtl' : 'ltr';
}

/**
 * The direction the **current session** is actually laid out in.
 *
 * This is what a component must consult when it picks a chevron or mirrors a glyph: between the
 * moment the user picks Arabic and the moment the app reloads, the strings are Arabic but the
 * tree is still LTR, and an affordance that jumped ahead of the layout would point the wrong way.
 */
export function isLayoutRTL(): boolean {
  return I18nManager.isRTL;
}

/** {@link isLayoutRTL} as a direction. */
export function layoutDirection(): TextDirection {
  return I18nManager.isRTL ? 'rtl' : 'ltr';
}

/**
 * Whether switching to `language` would change the layout direction, i.e. whether a reload is
 * required before the app is coherent.
 *
 * @param language - The language being switched to.
 */
export function needsReloadFor(language: string): boolean {
  return isRtlLanguage(language) !== I18nManager.isRTL;
}

/**
 * Tells the OS which direction the app must be laid out in, for this launch and every one after.
 *
 * Safe to call on every startup and on every language change: writing the same value twice is a
 * no-op, and writing it *early* is what makes a cold launch already correct.
 *
 * @param language - The language the app is (about to be) rendering.
 * @returns `true` when the native direction now disagrees with the tree on screen — the caller
 * owes the user a reload, or an honest sentence about the next launch.
 */
export function applyLayoutDirection(language: string): boolean {
  const shouldBeRTL = isRtlLanguage(language);
  // Both, and both to the same value — see fact 2 in the module docs. `allowRTL` alone would hand
  // the decision to the device locale.
  I18nManager.allowRTL(shouldBeRTL);
  I18nManager.forceRTL(shouldBeRTL);
  return shouldBeRTL !== I18nManager.isRTL;
}

/**
 * The glyph for "go back" / "the way navigation goes", mirrored with the layout.
 *
 * A back affordance points *against* the reading direction, so it is `chevron_left` in an LTR tree
 * and `chevron_right` in an RTL one. Reading {@link isLayoutRTL} at call time (rather than at
 * module scope) means a reload picks the change up without a stale import in the way.
 */
export function backChevron(): 'chevron_left' | 'chevron_right' {
  return I18nManager.isRTL ? 'chevron_right' : 'chevron_left';
}

/** The glyph for "forward" — the disclosure chevron on a navigation row. */
export function forwardChevron(): 'chevron_left' | 'chevron_right' {
  return I18nManager.isRTL ? 'chevron_left' : 'chevron_right';
}
