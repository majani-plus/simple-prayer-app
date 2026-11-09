import { Platform } from 'react-native';


/**
 * Font families, embedded in the native app by the `expo-font` config plugin (`app.json`).
 *
 * Three faces, three jobs:
 * - **Lora** carries all Latin UI text, in six files plus italics.
 * - **Amiri** carries Arabic *calligraphy* — the `heroArabic` and `rowArabic` variants, the qibla
 *   title and the watch face. Its 400 is the brand, and it stays exactly where it was.
 * - **Noto Naskh Arabic** carries Arabic *UI* text: everything a Latin-designed variant renders
 *   once the language is Arabic. It exists here because Amiri cannot do that job — see below.
 * - **Noto Nastaliq Urdu** carries Urdu UI text (D210). Urdu readers expect Nastaliq, and read
 *   Naskh as Arabic. Its ink is about twice as tall as Naskh's, so `AppText` gives it its own
 *   leading floor ({@link urduMinLeading}).
 *
 * **Why the names differ per platform.** The fourteen files used to be loaded at runtime by
 * `useFonts` in the root layout, and the splash stayed up until all ~2.5 MB were read and
 * registered — on every cold start, in every language, Arabic files included. Embedding them
 * makes them available the instant the process starts, and the root layout no longer waits for
 * anything but the database. The cost is that each platform names an embedded font its own way:
 * Android resolves `fontFamily` to `assets/fonts/<name>.ttf`, so the file name is the name; iOS
 * registers the file with CoreText and resolves `fontFamily` by the font's *PostScript* name from
 * its `name` table. The PostScript names below were read out of the shipped TTFs
 * (`__tests__/faceMetrics.test.ts` pins the files; the names are `nameID 6`). Nothing else in the
 * app spells a font family — every call site goes through these tokens.
 */
function family(fileName: string, postScriptName: string): string {
  return Platform.OS === 'ios' ? postScriptName : fileName;
}

export const fonts = {
  regular: family('Lora_400Regular', 'Lora-Regular'),
  regularItalic: family('Lora_400Regular_Italic', 'Lora-Italic'),
  medium: family('Lora_500Medium', 'Lora-Medium'),
  mediumItalic: family('Lora_500Medium_Italic', 'Lora-MediumItalic'),
  semiBold: family('Lora_600SemiBold', 'Lora-SemiBold'),
  bold: family('Lora_700Bold', 'Lora-Bold'),
  arabic: family('Amiri_400Regular', 'Amiri-Regular'),
  arabicBold: family('Amiri_700Bold', 'Amiri-Bold'),
  arabicUi: family('NotoNaskhArabic_400Regular', 'NotoNaskhArabic-Regular'),
  arabicUiMedium: family('NotoNaskhArabic_500Medium', 'NotoNaskhArabic-Medium'),
  arabicUiSemiBold: family('NotoNaskhArabic_600SemiBold', 'NotoNaskhArabic-SemiBold'),
  arabicUiBold: family('NotoNaskhArabic_700Bold', 'NotoNaskhArabic-Bold'),
  // Urdu UI text (D210). Two weights, not four: Nastaliq's strokes carry less weight contrast, and
  // each file is ~0.5 MB.
  urduUi: family('NotoNastaliqUrdu_400Regular', 'NotoNastaliqUrdu-Regular'),
  urduUiBold: family('NotoNastaliqUrdu_700Bold', 'NotoNastaliqUrdu-Bold'),
  iconFilled: family('MaterialSymbolsRounded-Filled', 'MaterialSymbolsRounded-Regular'),
  iconOutlined: family('MaterialSymbolsRounded-Outlined', 'MaterialSymbolsOutline-Regular'),
} as const;

export {
  arabicTypeScale,
  nastaliqOverflow,
  typeScaleFor,
  urduMinLeading,
  urduTypeScale,
} from './scriptScale';


/** Key type sizes from the 2a design (at 390pt reference width), retuned for legibility (D74). */
export const type = {
  // Raised from the design's 13 (D74): the section titles in Settings borrow this role, and once
  // captions moved to 13.5 a *title* smaller than the descriptions under it read upside-down.
  headerDate: 14,
  // The History tab's one big number (D183): the current streak, set as the page's headline so
  // the eye lands on the run before it lands on any rate. `streakNumber` stays what it always
  // was — the size every *small* figure beside a caption uses.
  streakHero: 40,
  streakNumber: 20,
  streakLabel: 13.5,
  heroArabic: 30,
  heroName: 23,
  countdown: 14,
  // Raised from the design's 17 (D74, owner: "Settings ⇒ labels are all too small … just a
  // pinch"). One point, everywhere the role appears — settings labels, prayer names, body text —
  // so the label scale stays single. The emphasised sizes (rowNameNext 20, hero 23) hold their
  // ground, which narrows the gap by exactly that point; the emphasis tiers never rested on size
  // alone (fill, border, weight and the time's own size carry it).
  rowName: 18,
  rowNameNext: 20,
  rowArabic: 16,
  // Raised from the design's 12.5 to meet `rowTimeQuiet` (D74): the role is the same — a value
  // beside a label (a settings row's trailing value, the stats table's figures, calendar
  // numerals) — and D67 had already found 14 to be the readable size for it on the prayer rows.
  rowTime: 14,
  rowTimeNext: 19,
  // The prayer rows' secondary line — raised for the THIRD time at the owner's request (D67,
  // D74, and 2026-08-24: "the time of the prayer and stuff is currently too small and hard to
  // read"). Three reports about one line settle it: this line is what the app is FOR — the next
  // decision the user makes reads it — so it gets a decisive step up rather than another half
  // point. The row-scoped names exist precisely so the rows can move without dragging every
  // app-wide caption with them; `rowTime`/`caption` deliberately stay put (a settings
  // description was never the complaint). Hierarchy holds: rowName 18 / time 15.5 / caption 15
  // still reads name-first, and the emphasised sizes (rowTimeNext 19) keep their ground.
  rowTimeQuiet: 15.5,
  rowCaption: 15,
  // Raised from the design's 12 to the 13.5 step D67 established (D74, the owner's fourth
  // too-small report: "a lot of fonts here need increase in size, specifically descriptions").
  // Captions are the app's descriptive voice — settings descriptions, stat labels, streak label —
  // and the audience skews older; hints stay a half-step down so the quiet register survives.
  caption: 13.5,
  hint: 13,
  // Raised from the design's 10.5 (owner: the tab bar reads too small — and the a11y audit had
  // already measured its inactive labels as the smallest text in the app). 12 keeps the label on
  // an existing step of the scale (caption/hint), and its Arabic resolution (12 × 1.15 = 13.8)
  // clears the D54 sub-13px threshold, so Arabic tab labels regain the active-bold/inactive-
  // regular distinction Latin always had. The seal options and the compass badge, which borrow
  // this variant for its ROLE, pin their own sizes at the call site and are untouched.
  tabLabel: 12,
  // Raised from the design's 8.5 (spec-accessibility §2.3): the smallest functional text in the
  // app, under the two tightest colours. Rule going forward: no word-carrying text below 10.
  sealOptionLabel: 10,
} as const;
