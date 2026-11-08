import CoreText
import SwiftUI

/**
 The brand faces, registered by hand: a widget extension has no `UIAppFonts` plumbing of its own
 here, but `CTFontManagerRegisterFontsForURL` works in any process, so the TTFs ride as target
 resources (`targets/widget/fonts/`) and get registered once per process. Registration failing
 (or a name mismatch) degrades to the system serif — visibly imperfect, never broken.

 Three faces, three jobs — the same split the phone makes in `src/theme/typography.ts` (D135):

 - **Lora** carries every Latin surface.
 - **Noto Naskh Arabic** carries Arabic *UI* text: every Latin-designed size, once the snapshot's
   language is Arabic. It exists here because Amiri cannot do that job — Amiri ships 400 and 700
   and nothing between, and this selector's old `weight == .bold ? Bold : Regular` map collapsed
   the ladder from both ends: a `.semibold` heading and the `.regular` caption beneath it resolved
   to the *same file*, so nothing but size separated a title from its footnote.
 - **Amiri** carries Arabic *calligraphy* only — the prayer's Arabic companion name, which is the
   brand, at the size it was drawn for.

 BYTE-FOR-BYTE TWIN of `targets/watch/WidgetFonts.swift` and `targets/watch-widget/WidgetFonts.swift`
 — an extension cannot import another target's module. Change one, change all three.
 */
enum WidgetFonts {
  private static let registered: Void = {
    let names = [
      "Lora-Regular", "Lora-Italic", "Lora-SemiBold", "Lora-Bold",
      "Amiri-Regular", "Amiri-Bold",
      "NotoNaskhArabic-Regular", "NotoNaskhArabic-SemiBold", "NotoNaskhArabic-Bold",
    ]
    for name in names {
      if let url = Bundle.main.url(forResource: name, withExtension: "ttf") {
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
      }
    }
  }()

  /**
   The per-language optical step (`arabicTypeScale`, D135), and it belongs to Noto Naskh alone.

   Measured from the shipped TTFs: Noto Naskh's Arabic body (ه) is 433/1000 em against Lora's
   500 x-height, so a Latin-designed size set in Arabic UI text is multiplied by 500/433 ≈ 1.15.
   That 433 is *Noto Naskh's* number — Amiri's body is 337/1000, which would have needed ≈1.48 —
   so the old `size * 1.15` beside an Amiri name never compensated the face it was applied to.
   `amiri(_:)` below therefore takes the size it is given.
   */
  private static let arabicUIScale: CGFloat = 1.15

  static func lora(_ size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false) -> Font {
    _ = registered
    let name: String
    if italic {
      name = "Lora-Italic"
    } else {
      switch weight {
      case .semibold: name = "Lora-SemiBold"
      case .bold: name = "Lora-Bold"
      default: name = "Lora-Regular"
      }
    }
    return .custom(name, size: size)
  }

  /**
   Amiri, for Arabic *calligraphy*: the prayer's Arabic companion name, and nothing else.

   The size arrives already chosen for Amiri, the way the phone's `heroArabic`/`rowArabic`
   variants are exempt from the optical step because they picked their sizes for this face in the
   first place. The four call sites carry the tuned number directly (13.8 · 16.1 · 17.25); those
   are the sizes that were on screen before, when a nominal 12/14/15 was multiplied inside here.
   Same rendering, stated honestly — and the multiplier that was wrong for Amiri is gone.
   */
  static func amiri(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
    _ = registered
    return .custom(weight == .bold ? "Amiri-Bold" : "Amiri-Regular", size: size)
  }

  /**
   Arabic UI text: Noto Naskh at the optical step, with D54's sub-13px rule folded in so that no
   call site can forget it — the reason the rule lives in the selector and not in a comment.

   **Sub-13px Arabic steps up a weight** (D54, as amended by D135). Arabic's stroke weight is what
   tells its letters apart, and at caption sizes a Regular naskh starts to vanish; SemiBold reads
   as definition where Bold would read as shouting. The threshold is checked against the FINAL
   size — after the optical step — exactly as `AppText` checks it on the phone.

   The test is written as "is this still the Regular file?" rather than as a comparison on the
   requested weight, deliberately. `Font.Weight` is not `Comparable`, so `weight < .semibold` does
   not compile; and a version that reassigns the weight and then falls through a
   `weight == .bold ? Bold : Regular` map sets the rung and immediately throws it away — the bump
   silently does nothing. Asking about the resolved *name* cannot fail that way.
   */
  private static func arabicUI(_ size: CGFloat, weight: Font.Weight) -> Font {
    _ = registered
    let resolved = size * arabicUIScale
    var name: String
    switch weight {
    // Noto Naskh ships no Medium in this bundle; 500 takes the nearest rung it has.
    case .medium, .semibold: name = "NotoNaskhArabic-SemiBold"
    case .bold, .heavy, .black: name = "NotoNaskhArabic-Bold"
    default: name = "NotoNaskhArabic-Regular"
    }
    if resolved < 13 && name == "NotoNaskhArabic-Regular" {
      name = "NotoNaskhArabic-SemiBold"
    }
    return .custom(name, size: resolved)
  }

  /**
   The UI face for a snapshot language: Noto Naskh carries Arabic UI text (DESIGN.md §RTL, D135).

   `italic` is dropped for Arabic rather than faked — Arabic has no italic, and a slanted naskh is
   a Latin habit imposed on a script that does not want it. What replaces it is the weight ladder
   above: a `.regular` caption now resolves to Noto Naskh Regular under a `.semibold` heading in
   Noto Naskh SemiBold, where both used to be the one Amiri file. The quiet register is carried by
   weight and tone, which is how Arabic typography carries it.
   */
  static func ui(_ language: String, _ size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false) -> Font {
    language == "ar" ? arabicUI(size, weight: weight) : lora(size, weight: weight, italic: italic)
  }
}
