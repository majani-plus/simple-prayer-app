/**
 * Bidi safety — keeping a number inside an Arabic sentence where the author put it.
 *
 * The Unicode Bidirectional Algorithm resolves a paragraph's direction first, then reorders runs
 * inside it. In an Arabic (RTL) paragraph, a run of Latin letters or European digits is a
 * left-to-right island, and the *neutral* characters around it — spaces, `+`, `-`, `:`, `(`, `°`,
 * `%` — join whichever side wins. That is why an Arabic sentence carrying "GMT+3" lands it on the
 * wrong side of the line, why "(+3 min)" loses its parenthesis to the wrong end, and why a
 * version number can come apart at the seam. Nothing is wrong with the string;
 * the *renderer* is doing exactly what the standard says.
 *
 * The fix is an **isolate**, not a mark. `U+2068 FIRST STRONG ISOLATE` … `U+2069 POP DIRECTIONAL
 * ISOLATE` wraps a run so that
 *
 * - the run's own direction is decided by its first strong character (so it needs no per-value
 *   decision from us), and
 * - the run counts as a single neutral object to the text around it, so it cannot drag the
 *   surrounding punctuation across the sentence.
 *
 * `U+200E/U+200F` (LRM/RLM) are the older tool and are deliberately not used for this: a mark
 * only nudges the boundary, it does not contain the run, so a two-token value ("GMT+3") still
 * comes apart inside it.
 *
 * ## What actually gets wrapped
 *
 * Isolation is applied by {@link isolateFor}, and only where the run and the paragraph
 * disagree — an invisible control character has no cost, but a locale file full of them is a
 * locale file nobody can diff:
 *
 * - **RTL paragraph** → isolate any value containing an ASCII letter or an ASCII digit. Those are
 *   bidi classes `L` and `EN`, the two that form LTR islands.
 * - **LTR paragraph** → isolate any value containing a strong RTL character (Arabic, Hebrew,
 *   Syriac, Thaana). An Arabic city name in an English sentence has the same problem mirrored.
 * - **Arabic-Indic digits inside Arabic are left alone.** U+0660–U+0669 are bidi class `AN`,
 *   which does not reorder against the Arabic letters (`AL`) around it. Wrapping them would add
 *   noise to every countdown for no reordering that could ever happen.
 *
 * This module is pure string work: no React, no i18next, no platform. `./formatter` applies it to
 * every interpolated value automatically, so a translator never has to remember it.
 */

/** `U+2068 FIRST STRONG ISOLATE` — opens a run whose direction its own content decides. */
export const FSI = '\u2068';
/** `U+2069 POP DIRECTIONAL ISOLATE` — closes the innermost isolate. */
export const PDI = '\u2069';
/** Every isolate/embedding/override control, for {@link stripBidi}. */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Strong right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, Arabic Supplement/Extended,
 * plus the Arabic presentation forms.
 */
const RTL_STRONG =
  /[\u0590-\u05ff\u0600-\u065f\u066a-\u06ef\u06fa-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;

/** An LTR island inside RTL text: a Latin letter, or a European (ASCII) digit. */
const LTR_ISLAND = /[A-Za-z0-9]/;

/** Text directionality of a paragraph. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Whether a value would reorder if it were dropped into a paragraph of the given direction.
 *
 * @param value - The already-formatted run (a time, a count, a city, an abbreviation).
 * @param paragraph - The direction of the sentence it is going into.
 */
export function needsIsolation(value: string, paragraph: TextDirection): boolean {
  if (value === '') return false;
  // A value that already carries an isolate came out of this same pipeline with its islands
  // already contained, and wrapping the wrapper adds nothing: "بعد ⁦2⁩ س و⁦07⁩ د" is complete, while
  // a second and third layer around the same digits only makes the string unreadable in a diff.
  // (The one case this gives up on is a *hand-written* locale string that isolates one island and
  // leaves another bare — which no string in this app does, and which the surrounding paragraph's
  // own resolution handles adequately anyway.)
  if (value.includes(FSI)) return false;
  return paragraph === 'rtl' ? LTR_ISLAND.test(value) : RTL_STRONG.test(value);
}

/**
 * Wraps a run in FSI … PDI unconditionally.
 *
 * @param value - The run.
 * @returns The isolated run; an already-isolated run is not wrapped twice.
 */
export function isolate(value: string): string {
  if (value === '') return '';
  if (value.startsWith(FSI) && value.endsWith(PDI)) return value;
  return `${FSI}${value}${PDI}`;
}

/**
 * Isolates a run only if the surrounding paragraph would reorder it.
 *
 * @param value - The run.
 * @param paragraph - The paragraph direction the run is being interpolated into.
 * @returns The run, isolated when it needs to be and untouched when it does not.
 */
export function isolateFor(value: string, paragraph: TextDirection): string {
  return needsIsolation(value, paragraph) ? isolate(value) : value;
}

/**
 * Removes every bidi control character.
 *
 * For tests and for anything that compares strings the *user* sees — an isolate is invisible on
 * screen, so a snapshot or an equality check should not be able to fail on one.
 *
 * @param value - Any string.
 */
export function stripBidi(value: string): string {
  return value.replace(BIDI_CONTROLS, '');
}
