/**
 * The pure transform behind the derived Arabic widget layouts — shared by the runner
 * (`scripts/derive-arabic-layouts.ts`, bun-only) and the drift test
 * (`src/__tests__/widgetLayouts.test.ts`), so they can never disagree. See the runner's header
 * for why the variants exist at all.
 *
 * **Named for the language, not the face.** It used to be `amiri-layout-source.ts` and it emitted
 * `*_amiri.xml`, which stopped being true at D135: Arabic UI text is Noto Naskh Arabic now, and
 * Amiri is kept only where a layout draws the *calligraphic* prayer name. A file called
 * `widget_now_amiri.xml` whose body is Noto Naskh is a trap for the next reader, so the whole
 * pipeline says `arabic`.
 */

import { arabicTypeScale } from '../src/theme/scriptScale';

/**
 * Live widget layouts. The renderer picks the twin from the SNAPSHOT language (D41: the APP
 * language decides, not the launcher's locale), so the twin lives beside the original under a
 * `_arabic` suffix rather than in a `layout-ar/` qualifier.
 */
export const LIVE_SOURCES = [
  'widget_schedule',
  'widget_schedule_rows',
  'widget_now',
  'widget_now_strip',
] as const;

/**
 * The bundled empty/stale layout. It is drawn exactly when no snapshot exists, so there is no app
 * language to consult and its strings come from the module's own `values-ar/` (D103) — the twin is
 * therefore chosen by the renderer from the SYSTEM locale, the same `Configuration` that resolved
 * those strings, so the sentence and the face can never disagree.
 */
export const BUNDLED_SOURCES = ['widget_empty'] as const;

/**
 * Widget-picker previews. The launcher inflates these itself, before the app has ever run, with
 * its own configuration — so these are the one family where a `layout-ar/` qualifier is exactly
 * right, and `previewLayout` in `res/xml/widget_*_info.xml` needs no edit at all.
 */
export const PREVIEW_SOURCES = [
  'widget_now_preview',
  'widget_now_strip_preview',
  'widget_schedule_preview',
  'widget_schedule_list_preview',
] as const;

/**
 * Locale qualifiers that get the picker-preview twins. Urdu is written in the Arabic script and
 * these native surfaces draw it in the same Noto Naskh as Arabic (Nastaliq is the app's choice,
 * not the widgets'), so `layout-ur/` is byte-identical to `layout-ar/`; only `values-ur/` differs.
 */
export const PREVIEW_DIRS = ['layout-ar', 'layout-ur'] as const;

export type DerivedLayout = {
  /** Basename of the Lora original in `res/layout/`. */
  source: string;
  /** Resource directory the derived file is written to. */
  dir: 'layout' | (typeof PREVIEW_DIRS)[number];
  /** Basename of the derived file. */
  name: string;
};

export const DERIVED_LAYOUTS: readonly DerivedLayout[] = [
  ...[...LIVE_SOURCES, ...BUNDLED_SOURCES].map(
    (source): DerivedLayout => ({ source, dir: 'layout', name: `${source}_arabic` })
  ),
  ...PREVIEW_DIRS.flatMap((dir) =>
    PREVIEW_SOURCES.map((source): DerivedLayout => ({ source, dir, name: source }))
  ),
];

/**
 * Layouts in `res/layout/` that deliberately have no Arabic variant, each with a reason. Empty by
 * design — and it is meant to stay that way. `widget_empty` sat outside this pipeline for a whole
 * release and drew its Arabic in Lora, which contains no Arabic letter and no Arabic-Indic digit
 * (AR-06); the drift test now refuses any layout that is neither a source, a derived twin, nor
 * listed here.
 */
export const NO_ARABIC_VARIANT: readonly string[] = [];

/** Below this resolved size, Arabic steps up a weight — D54, as amended by D135. */
export const WEIGHT_BUMP_BELOW_SP = 13;

/**
 * Lora face → weight rung. The italic maps to its upright rung: Arabic has no italic, and since
 * D135 the quiet tier rides on weight instead.
 */
const LORA_RUNGS: Record<string, number> = {
  lora_400regular: 400,
  lora_400regular_italic: 400,
  lora_500medium: 500,
  lora_500medium_italic: 500,
  lora_600semibold: 600,
  lora_700bold: 700,
};

/** The Noto Naskh Arabic faces bundled in `res/font/`. There is deliberately no 500 here. */
const NASKH_FACES: Record<number, string> = {
  400: 'noto_naskh_arabic_400regular',
  600: 'noto_naskh_arabic_600semibold',
  700: 'noto_naskh_arabic_700bold',
};

const SIZE_ATTRS = ['textSize', 'autoSizeMinTextSize', 'autoSizeMaxTextSize'] as const;

/** Matches one start tag with its whole attribute block; quoted values are consumed atomically. */
const START_TAG = /<([A-Za-z][\w.]*)((?:"[^"]*"|[^<>"])*)>/g;

const opticalSize = (sp: number): number => Math.round(sp * arabicTypeScale * 2) / 2;

// Widget hero numerals and names are sized in dp so system font scale cannot push them out of a
// fixed-size cell; they take the same optical scale as sp sizes, unit kept.
function readSize(attrs: string, attr: string): number | null {
  const match = new RegExp(`android:${attr}="([0-9.]+)(?:sp|dp)"`).exec(attrs);
  return match ? Number(match[1]) : null;
}

/**
 * One element's attributes, Arabicised.
 *
 * Two rules, in this order:
 *
 * 1. **Amiri is calligraphy and is left completely alone** — face *and* size. Its sizes were
 *    picked for Amiri already, exactly as `arabicTypeScale` exempts `heroArabic`/`rowArabic` on
 *    the phone; scaling them by a constant derived from Noto Naskh's body height would be the
 *    same mistake in a different place.
 * 2. Everything else takes the optical scale on every size it declares — `autoSizeMin/MaxTextSize`
 *    included, without which an autosizing view silently caps Arabic back at the Latin size — and
 *    a Lora face is swapped for the Noto Naskh rung of the same weight, stepped up to SemiBold if
 *    the smallest size the view can render at lands below 13sp (D54 as amended by D135).
 */
function deriveAttributes(attrs: string): string {
  const familyMatch = /android:fontFamily="@font\/([A-Za-z0-9_]+)"/.exec(attrs);
  const family = familyMatch?.[1];
  if (family?.startsWith('amiri_')) return attrs;

  let out = attrs;
  for (const attr of SIZE_ATTRS) {
    const declared = readSize(out, attr);
    if (declared !== null) {
      out = out.replace(
        new RegExp(`android:${attr}="[0-9.]+(sp|dp)"`),
        (_match, unit: string) => `android:${attr}="${opticalSize(declared)}${unit}"`
      );
    }
  }
  if (family === undefined) return out;

  const rung = LORA_RUNGS[family];
  if (rung === undefined) {
    throw new Error(
      `arabic-layout-source: no Arabic rung for "@font/${family}". Add it to LORA_RUNGS (and bundle the matching Noto Naskh face) before shipping a layout that uses it.`
    );
  }
  // "Final resolved size" for D54 is the SMALLEST size the view can render at, which for an
  // autosizing view is its floor, not its nominal.
  const floor = Math.min(
    ...[readSize(out, 'textSize'), readSize(out, 'autoSizeMinTextSize')].filter(
      (size): size is number => size !== null
    )
  );
  const stepped = Number.isFinite(floor) && floor < WEIGHT_BUMP_BELOW_SP ? Math.max(rung, 600) : rung;
  const face = NASKH_FACES[stepped];
  if (face === undefined) {
    throw new Error(
      `arabic-layout-source: no Noto Naskh face bundled for weight ${stepped} (from @font/${family}).`
    );
  }
  return out.replace(`@font/${family}`, `@font/${face}`);
}

/**
 * Lora → Noto Naskh Arabic, at the app's own optical scale, with Amiri left where the layout is
 * drawing calligraphy.
 *
 * The live and bundled variants are also truly RTL: the root's pinned `layoutDirection` flips to
 * `"rtl"`. An EXPLICIT direction is deterministic however the launcher's system locale is set —
 * the double-mirroring hazard D41 guards against only exists for an inherited direction — so the
 * renderer fills children in natural order and the layout mirrors itself (seals to the leading
 * edge, start/end margins resolved), instead of the old reversed-fill trick that could only
 * reorder columns, never mirror a row's insides. The previews pin `"locale"` instead and are
 * therefore untouched by that rule, which is correct: a `layout-ar/` file is only ever inflated
 * under an Arabic configuration, where `"locale"` already resolves to RTL.
 */
export function deriveArabic(source: string): string {
  return source
    .replace(
      /^<\?xml[^\n]*\n<!--[\s\S]*?-->/,
      (header) =>
        `${header}\n<!-- DERIVED by scripts/derive-arabic-layouts.ts — edit the Lora original, then regenerate. -->`
    )
    .replace(/android:layoutDirection="ltr"/g, 'android:layoutDirection="rtl"')
    .replace(START_TAG, (_all, name: string, attrs: string) => `<${name}${deriveAttributes(attrs)}>`);
}
