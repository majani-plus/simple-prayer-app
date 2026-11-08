import SwiftUI

/**
 Shared scaffolding for the watch surfaces — the watch-scale halves of what
 `targets/widget/Widgets.swift` gives the phone widgets. The watch canvas is night-paper ALWAYS
 (V0a): there is no theme to resolve, so `watchNight` is a named constant rather than a computed
 answer, and every palette call goes through it.
 */
let watchNight = true

/// The app's signature divider — hairline + ◆ — framing the hero band (D109 at watch scale).
struct WatchOrnamentRule: View {
  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    HStack(spacing: 5) {
      Rectangle().fill(c("hairline")).frame(height: 1)
      Text("\u{25C6}")
        .font(.system(size: 6))
        .foregroundStyle(c("diamond"))
      Rectangle().fill(c("hairline")).frame(height: 1)
    }
    // Wider than the first cut (104): the hero was leaving broad idle margins on every watch
    // size, and the rules are what set the composition's visual width (owner, 2026-08-28).
    .frame(maxWidth: 138)
  }
}

/// Whether a seal tap may mark this prayer — D108's one rule, worded once per platform.
func sealTappable(status: String, isFuture: Bool) -> Bool {
  !isFuture && (status == "unlogged" || status == "prayed")
}

/// Status + register → the caption word. Always a word — never color alone.
func captionFor(
  status: String,
  isCurrent: Bool,
  isFuture: Bool,
  strings: WidgetSnapshot.Strings
) -> String {
  switch status {
  case "prayed": return strings.statusPrayed
  case "late": return strings.statusLate
  case "missed": return strings.statusMissed
  case "exempt": return strings.statusNotRequired
  default:
    if isCurrent { return strings.now }
    if isFuture { return strings.statusUpcoming }
    return strings.statusNotMarked
  }
}

/// The watch's ground: night paper vignetting to black at the bezel — the manuscript by
/// lamplight, melting into the case (V0a).
struct NightPaperGround: View {
  var body: some View {
    RadialGradient(
      colors: [
        Color(argb: 0xFF261D10),
        Color(argb: 0xFF20190E),
        Color(argb: 0xFF0A0703),
      ],
      center: UnitPoint(x: 0.5, y: 0.26),
      startRadius: 0,
      endRadius: 240
    )
    .ignoresSafeArea()
  }
}

/// The bundled empty/stale face — the two states no envelope can describe (D103's exception).
struct WatchEmptyView: View {
  let stale: Bool

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    let strings = WatchBundledStrings.current()
    VStack(spacing: 6) {
      MosqueMark(color: c("header"), size: 34)
      WatchOrnamentRule()
        .padding(.vertical, 6)
      // The face follows the language of the words, which here is the SYSTEM locale's, not the
      // envelope's — there is no envelope; that is the whole reason these strings exist (D103).
      // Pinning Lora drew the Arabic pair in a face with no Arabic glyph in it, with a
      // synthesised slant on the body line, for the first sentences the watch ever says.
      Text(stale ? strings.staleTitle : strings.emptyTitle)
        .font(WidgetFonts.ui(strings.language, 15, weight: .semibold))
        .foregroundStyle(c("ink"))
        .multilineTextAlignment(.center)
      Text(stale ? strings.staleBody : strings.emptyBody)
        .font(WidgetFonts.ui(strings.language, 11.5, italic: true))
        .foregroundStyle(c("muted"))
        .multilineTextAlignment(.center)
    }
    .padding(.horizontal, 10)
  }
}
