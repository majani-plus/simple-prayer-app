import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  type ColorValue,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { scriptFamilyFor, type ScriptFamily } from '@/i18n/direction';
import { fonts, type as typeScale, typeScaleFor, urduMinLeading, useTheme } from '@/theme';

/** Built up field by field; RN 0.87's style types are read-only. */
type MutableTextStyle = { -readonly [K in keyof TextStyle]: TextStyle[K] };

/**
 * Every piece of text in the app goes through here, so a screen never repeats a
 * fontFamily/fontSize/colour triple and the design's type scale stays in one place.
 *
 * Two rules the wrapper enforces on its own:
 *
 * - **The font family carries the weight.** Lora ships as separate files per weight, and setting
 *   `fontWeight` on top of a weighted family makes Android synthesise a second, uglier bold. The
 *   `weight` prop therefore selects a family and never emits `fontWeight`.
 * - **Arabic is set in Amiri.** The `heroArabic`/`rowArabic` variants always are, and when the UI
 *   language is Arabic every variant switches over (DESIGN.md §RTL: Amiri becomes the primary
 *   face). Amiri has no italic, and Arabic typography does not use one, so `italic` is ignored
 *   there rather than faked.
 * - **Arabic sizes carry the per-language scale.** Amiri renders optically smaller than Lora at
 *   the same nominal size, so a Latin-designed size that ends up set in Amiri is multiplied by
 *   `arabicTypeScale` here — never bumped at a call site.
 */

/** The type roles the design actually uses (docs/DESIGN.md §Typography). */
export type AppTextVariant =
  | 'headerMeta'
  | 'hero'
  | 'heroArabic'
  | 'rowName'
  | 'rowArabic'
  | 'time'
  | 'caption'
  | 'hint'
  | 'tabLabel';

/** Named colours from the palette, so tone never becomes a hardcoded hex at a call site. */
export type AppTextTone =
  'ink' | 'strong' | 'header' | 'muted' | 'faint' | 'soft' | 'accent' | 'diamond';

/** Lora's shipped weights. */
export type AppTextWeight = 400 | 500 | 600 | 700;

export type AppTextScript = 'auto' | 'latin' | 'arabic';

interface VariantSpec {
  size: number;
  weight: AppTextWeight;
  tone: AppTextTone;
  script: 'latin' | 'arabic';
  italic?: boolean;
  tabularNums?: boolean;
  lineHeight?: number;
  letterSpacing?: number;
}

const VARIANTS: Record<AppTextVariant, VariantSpec> = {
  // "16 Muharram · July 2" and the streak label.
  headerMeta: {
    size: typeScale.headerDate,
    weight: 500,
    tone: 'header',
    script: 'latin',
    letterSpacing: 0.28, // .02em at 14px
  },
  // The hero prayer name; pair with `tone="strong" weight={700} tabularNums` for the hero time.
  hero: { size: typeScale.heroName, weight: 600, tone: 'ink', script: 'latin' },
  // المغرب — line-height 1.1 per the mockup.
  heroArabic: {
    size: typeScale.heroArabic,
    weight: 400,
    tone: 'accent',
    script: 'arabic',
    lineHeight: Math.round(typeScale.heroArabic * 1.13),
  },
  rowName: { size: typeScale.rowName, weight: 600, tone: 'ink', script: 'latin' },
  rowArabic: { size: typeScale.rowArabic, weight: 400, tone: 'faint', script: 'arabic' },
  time: {
    size: typeScale.rowTime,
    weight: 400,
    tone: 'muted',
    script: 'latin',
    tabularNums: true,
  },
  caption: {
    size: typeScale.caption,
    weight: 400,
    tone: 'muted',
    script: 'latin',
    italic: true,
  },
  hint: { size: typeScale.hint, weight: 400, tone: 'faint', script: 'latin', italic: true },
  tabLabel: { size: typeScale.tabLabel, weight: 400, tone: 'soft', script: 'latin' },
};

export interface AppTextProps extends Omit<TextProps, 'style'> {
  /** Type role from the design's scale. Defaults to `rowName`-sized body text. */
  variant?: AppTextVariant;
  /** Palette colour. Defaults to the variant's own tone. */
  tone?: AppTextTone;
  /**
   * Escape hatch for a colour the palette exposes but the tone list does not (e.g. status hues).
   * Typed as `ColorValue` rather than `string` because React Navigation hands its render props a
   * `ColorValue`, and the tab bar renders its labels through this component.
   */
  color?: ColorValue;
  /** Overrides the variant's weight (which selects a Lora file, never a synthetic bold). */
  weight?: AppTextWeight;
  /** Overrides the variant's slant. Ignored for Arabic, which has no italic. */
  italic?: boolean;
  /** Overrides the variant's script. `auto` follows the variant, or the UI language when Arabic. */
  script?: AppTextScript;
  /** Lining, fixed-width figures — on by default for the `time` variant. */
  tabularNums?: boolean;
  style?: StyleProp<TextStyle>;
}

function latinFamily(weight: AppTextWeight, italic: boolean): string {
  // Lora ships italics for 400 and 500 only; heavier italic requests round down to the closest.
  if (italic) return weight >= 500 ? fonts.mediumItalic : fonts.regularItalic;
  if (weight >= 700) return fonts.bold;
  if (weight >= 600) return fonts.semiBold;
  if (weight >= 500) return fonts.medium;
  return fonts.regular;
}

/**
 * Amiri, for the two Arabic-*designed* variants only — `heroArabic` and `rowArabic`, plus the
 * qibla title. Amiri ships 400 and 700 and nothing between, which is fine here: both variants ask
 * for 400, and 400 is the brand.
 */
function arabicCalligraphyFamily(weight: AppTextWeight): string {
  return weight >= 600 ? fonts.arabicBold : fonts.arabic;
}

/**
 * Noto Naskh Arabic, for Arabic UI text — every Latin-designed variant once the language is `ar`.
 *
 * This mirrors `latinFamily` one weight for one weight, and that is the whole point. Amiri used to
 * do this job with two files behind `weight >= 600 ? bold : regular`, which collapsed the ladder
 * from both ends: the default variant (`rowName`) asks for 600, so *all* Arabic body copy came out
 * Bold while English read as a semibold serif, and the eight `weight={500}` call sites — the quiet
 * tier in `SettingRow`, `SheetKit`, `CountdownHero`, `TipJar`, `ExemptionSheets` — rounded down to
 * Regular and disappeared. Arabic had one usable weight where English has four.
 *
 * There is no italic, and there must not be a synthesized one: Arabic has no italic, and a slanted
 * naskh is a Latin habit imposed on a script that does not want it. The whisper tier that Lora
 * carries with `regularItalic` is carried here by weight and tone instead (see `VARIANTS`).
 */
function arabicUiFamily(weight: AppTextWeight): string {
  if (weight >= 700) return fonts.arabicUiBold;
  if (weight >= 600) return fonts.arabicUiSemiBold;
  if (weight >= 500) return fonts.arabicUiMedium;
  return fonts.arabicUi;
}

/**
 * Urdu UI text in Noto Nastaliq Urdu (D210). Two files: 600 and up is Bold, the rest Regular.
 * Like Arabic, no italic.
 */
function urduUiFamily(weight: AppTextWeight): string {
  return weight >= 600 ? fonts.urduUiBold : fonts.urduUi;
}

/**
 * The script a variant renders in under a UI language.
 *
 * The calligraphy variants (`heroArabic`, `rowArabic`, the qibla title) stay Arabic in Amiri for
 * every language but one: in Urdu their text is Urdu (`prayers.arabic.*` holds the Urdu names in
 * ur.json), and Nastaliq is itself the calligraphy, so they are set in it (D210).
 */
function scriptFor(specScript: VariantSpec['script'], language: string): ScriptFamily {
  const family = scriptFamilyFor(language);
  if (specScript === 'arabic') return family === 'urdu' ? 'urdu' : 'arabic';
  return family;
}

/** The family for one resolved script; `specScript` picks Amiri over Naskh for calligraphy. */
function familyFor(
  script: ScriptFamily,
  specScript: VariantSpec['script'],
  weight: AppTextWeight,
  italic: boolean
): string {
  if (script === 'urdu') return urduUiFamily(weight);
  if (script === 'arabic') {
    return specScript === 'arabic' ? arabicCalligraphyFamily(weight) : arabicUiFamily(weight);
  }
  return latinFamily(weight, italic);
}



/**
 * The family, size and alignment an `<AppText>` of this variant would resolve to — for the two
 * `TextInput`s, which cannot be `AppText`.
 *
 * They were the only text in the app outside this file's rules, and it showed. The city field
 * declared `fonts.regular`, and **Lora contains no Arabic glyph and no Arabic-Indic digit at all**
 * (measured from the shipped TTF, not assumed), so the placeholder «ابحث عن مدينة» and every
 * character typed into it dropped to whatever the OS offered — a different face from the result
 * rows directly beneath, at a raw size with none of the Arabic optical step. The qada estimate
 * field declared no family whatsoever. Both sit on first-run paths.
 *
 * It also states `textAlign`, for the reason spelled out at the bottom of this file: RN writes no
 * paragraph alignment unless asked, and iOS then resolves `natural` from the app bundle rather
 * than from the text, which leaves Arabic hard against the wrong edge inside a mirrored row.
 * `left`, never `right` — Fabric rewrites it to the leading edge on an RTL surface.
 */
export function useTextFieldStyle(
  variant: AppTextVariant = 'rowName',
  weight?: AppTextWeight
): Pick<TextStyle, 'fontFamily' | 'fontSize' | 'textAlign'> {
  const { i18n } = useTranslation();
  const spec = VARIANTS[variant];
  const resolvedWeight = weight ?? spec.weight;
  const script = scriptFor(spec.script, i18n.language);
  return {
    fontFamily: familyFor(script, spec.script, resolvedWeight, false),
    fontSize: spec.script === 'latin' ? spec.size * typeScaleFor(script) : spec.size,
    textAlign: 'left',
  };
}

/** The tightest leading an Arabic line may be set at, in ems. See the floor applied below. */
const ARABIC_MIN_LEADING = 1.45;

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Applies tabular figures to everything *except* whitespace.
 *
 * Lora's `tnum` feature widens the space to a full figure width, which tore "6:10 am" apart into
 * three pieces — the gap before the day period grew wider than the design's 10pt gap between the
 * prayer name and its time. Splitting on whitespace keeps the digits fixed-width (so a column of
 * times still aligns, and a ticking countdown never reflows) while the spaces keep their natural
 * width. Only plain-string children can be split; anything else falls back to the whole node.
 *
 * A string with no whitespace has nothing to protect, so it never reaches here — `AppText` puts
 * the feature straight on its own node instead of wrapping a lone span around it.
 */
function tabularSpans(text: string): ReactNode {
  const parts = text.split(/(\s+)/);
  return parts.map((part, index) =>
    part === '' || /^\s+$/.test(part) ? (
      part
    ) : (
      // The index is a stable identity here: the split is positional and re-runs on every render.
      <Text key={index} style={TABULAR}>
        {part}
      </Text>
    )
  );
}

/**
 * Themed text bound to the design's type scale.
 *
 * @param variant - Type role; see {@link AppTextVariant}.
 * @returns A `Text` whose family, size, colour and slant come from the theme.
 */
export function AppText({
  variant = 'rowName',
  tone,
  color,
  weight,
  italic,
  script = 'auto',
  tabularNums,
  style,
  children,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  const spec = VARIANTS[variant];

  const resolvedWeight = weight ?? spec.weight;
  const resolvedScript: ScriptFamily =
    script === 'auto' ? scriptFor(spec.script, i18n.language) : script;
  const resolvedItalic = (italic ?? spec.italic ?? false) && resolvedScript === 'latin';

  const tones: Record<AppTextTone, string> = {
    ink: colors.ink,
    strong: colors.inkStrong,
    header: colors.header,
    muted: colors.muted,
    faint: colors.faint,
    soft: colors.soft,
    accent: colors.accent,
    diamond: colors.diamond,
  };

  // Calligraphy or UI: the variant decides, not the language. `heroArabic` and `rowArabic` are
  // set in Arabic whatever the UI language, and they are the two that stay in Amiri.
  const resolved: MutableTextStyle = {
    fontFamily: familyFor(resolvedScript, spec.script, resolvedWeight, resolvedItalic),
    fontSize: spec.size,
    color: color ?? tones[tone ?? spec.tone],
  };
  // Deliberately no `fontStyle: 'italic'`: the italic Lora file *is* the italic, and asking
  // Android for an italic of an already-italic family makes it fake a second slant.
  if (spec.lineHeight !== undefined) resolved.lineHeight = spec.lineHeight;
  // Arabic is cursive: `letterSpacing` inserts a gap between letters that are meant to join, so a
  // tracked-out label turns into disconnected glyphs. The design's tracking is a Latin refinement
  // and is simply dropped for Amiri.
  if (spec.letterSpacing !== undefined && resolvedScript === 'latin') {
    resolved.letterSpacing = spec.letterSpacing;
  }
  // **Say the alignment out loud.** iOS resolves `NSTextAlignmentNatural` from the *app's* bundle
  // localization, not from the text: with the layout forced RTL by `I18nManager` on a device whose
  // OS language is still English, every block of Arabic stayed hard left while the boxes around it
  // mirrored — section titles on the wrong edge, a settings row's title floating away from its
  // icon. `left` (not `right`) is the correct thing to write: Fabric rewrites `left` → `start` on
  // an RTL surface, so this lands on the leading edge in both directions, and writing `right` here
  // would be swapped a second time straight back to the wrong one (see i18n/direction.ts).
  resolved.textAlign = 'left';
  const wantsTabular = tabularNums ?? spec.tabularNums ?? false;
  // Only a string with a space inside it needs splitting; everything else — a lone token like a
  // streak count, or non-string children — takes the feature on the node itself.
  const splitTabular = wantsTabular && typeof children === 'string' && /\s/.test(children);
  if (wantsTabular && !splitTabular) resolved.fontVariant = ['tabular-nums'];

  // The per-language type scale (see `arabicTypeScale`): a Latin-designed size set in Amiri gets
  // the compensating multiplier. It is applied to the *merged* style — after the call site's
  // overrides — so that a screen saying "the next prayer's name is 20, not 17" scales exactly
  // like the variant it adjusted, and no call site ever needs its own Arabic special case. Any
  // explicit line height scales with it, keeping tightened leading proportional rather than
  // clipping the taller Amiri glyphs. The Arabic-designed variants (heroArabic, rowArabic) chose
  // their sizes for Amiri already and pass through untouched.
  const merged: MutableTextStyle = { ...resolved, ...StyleSheet.flatten(style) };
  // The same cursive rule as above, applied again *after* the merge. The guard on `spec` alone
  // left a hole: a call site passing `letterSpacing` in `style` tracked out Arabic anyway, which
  // is how the Makkah badge on the compass and the reminder-health notice ended up with their
  // kashida joins opened. Deleting it here fixes both call sites without editing either, and
  // closes the hole for the next one. Latin keeps every value it asked for.
  if (resolvedScript !== 'latin') delete merged.letterSpacing;
  if (resolvedScript !== 'latin' && spec.script === 'latin') {
    const scale = typeScaleFor(resolvedScript);
    merged.fontSize = (merged.fontSize ?? spec.size) * scale;
    if (merged.lineHeight !== undefined) merged.lineHeight *= scale;
  }
  // **A Latin leading is not a floor an Arabic line can stand on.** Latin sets its leading against
  // an x-height and a shallow descender; Arabic stacks marks above the letter and drops tails well
  // below the baseline, and RN's `CustomLineHeightSpan` clamps the glyph box to exactly the line
  // height it is given. Two call sites had derived their leading from the Latin design and were
  // reserving less room than the ink needs: the qibla title at 1.2 em, where the kasra of «القِبلة»
  // fell outside the box the title was vocalised for, and the compass cardinals at 1.25 em, where
  // the tails of ج and غ did — on letters pinned `allowFontScaling={false}`, so that was the only
  // size they ever rendered at.
  //
  // Raising it here rather than at the call site fixes it without the call site knowing the
  // language, and holds for the next one. 1.45 em clears Noto Naskh's measured ink (tails reach
  // ~0.31 em below the baseline) while still fitting the compass's 28pt cardinal box at its
  // largest size. It is a FLOOR: a call site asking for more keeps it, and Latin is untouched.
  //
  // The Arabic-*designed* variants are exempt, because their leading is not a Latin value that
  // nobody re-derived — it is a chosen one. `heroArabic` sets 30/34, and inflating that to 43.5
  // would silently redesign the one part of the Arabic UI that already looked right. Where such a
  // variant genuinely needs more room, the call site says so.
  if (resolvedScript === 'arabic' && spec.script === 'latin' && merged.lineHeight !== undefined) {
    const size = merged.fontSize ?? spec.size;
    merged.lineHeight = Math.max(merged.lineHeight, size * ARABIC_MIN_LEADING);
  }
  // **Nastaliq gets a floor on every line, set or not** (D210). Its ink stacks diagonally and
  // reaches twice as high as Naskh's (see `urduMinLeading`). Left unset, RN would take the font's
  // own 2.5 em line box, which wastes half a line on every row; set too low, the stacks clip.
  if (resolvedScript === 'urdu') {
    const size = merged.fontSize ?? spec.size;
    merged.lineHeight = Math.max(merged.lineHeight ?? 0, size * urduMinLeading);
  }
  // **Sub-13px Arabic steps up a weight** (spec-accessibility §3, owner item B, D54).
  //
  // D54 wrote this as "step up to the *Bold* file", because Amiri ships 400 and 700 and nothing
  // between and RN never synthesizes weights — Bold was the only rung available. Noto Naskh
  // Arabic ships a real 500 and 600, so the rule now takes the rung it always wanted: SemiBold
  // reads as *definition* at caption sizes where Bold reads as shouting.
  //
  // Keeping `fonts.arabicBold` here would now be a defect rather than a compromise: it names
  // *Amiri* Bold, so every sub-13px label would jump face mid-screen — a caption in Amiri under a
  // row in Noto Naskh. The threshold is still checked against the FINAL size, after the
  // per-language scale and any call-site override, and it still never touches `rowArabic` (16) or
  // `heroArabic` (30), whose elegance is the brand.
  if (
    resolvedScript === 'arabic' &&
    spec.script === 'latin' &&
    resolvedWeight < 600 &&
    (merged.fontSize ?? spec.size) < 13
  ) {
    merged.fontFamily = fonts.arabicUiSemiBold;
  }

  return (
    <Text style={merged} {...rest}>
      {splitTabular ? tabularSpans(children as string) : children}
    </Text>
  );
}
