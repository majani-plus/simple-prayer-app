import SwiftUI
import UIKit

/**
 The seal, drawn for WidgetKit — `PrayerSeal.tsx`'s face table, one case per state. Every state
 differs by GLYPH and (wherever the layout gives it a caption) by word, never by color alone
 (CLAUDE.md hard rule). Glyph paths mirror the app's Material Rounded set closely enough to read
 as the same family; a widget cannot load the icon font.
 */
struct SealView: View {
  enum Skin {
    case prayed
    case late
    case missed
    case exempt
    case unloggedCurrent
    case unloggedPast
    case future
  }

  let skin: Skin
  let size: CGFloat
  let night: Bool

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    ZStack {
      switch skin {
      case .prayed:
        Circle().fill(c("accent"))
        GlyphCheck().stroke(c("sealFg"), style: glyphStroke(2.8))
          .frame(width: size * 0.5, height: size * 0.5)
      case .late:
        Circle().fill(c("late"))
        GlyphClock(stroke: c("sealFg"), line: glyphStroke(2.2))
          .frame(width: size * 0.5, height: size * 0.5)
      case .missed:
        Circle().strokeBorder(c("missed"), lineWidth: 1.5)
        GlyphClose().stroke(c("missed"), style: glyphStroke(2.4))
          .frame(width: size * 0.45, height: size * 0.45)
      case .exempt:
        Circle().fill(composite(c("bg"), c("cardElevated")))
        Circle().strokeBorder(c("borderMid"), lineWidth: 1)
        GlyphCrescent().fill(c("muted"))
          .frame(width: size * 0.48, height: size * 0.48)
      case .unloggedCurrent:
        Circle().strokeBorder(c("accent"), style: StrokeStyle(lineWidth: 1.5, dash: [3, 2.5]))
        GlyphCheck().stroke(c("accent").opacity(0.7), style: glyphStroke(2.6))
          .frame(width: size * 0.46, height: size * 0.46)
      case .unloggedPast:
        Circle().strokeBorder(c("unlogged"), style: StrokeStyle(lineWidth: 1.5, dash: [3, 2.5]))
        Circle().strokeBorder(c("unlogged"), lineWidth: 1.6)
          .frame(width: size * 0.4, height: size * 0.4)
      case .future:
        Circle().strokeBorder(c("borderMid"), lineWidth: 1)
        Circle().fill(c("soft"))
          .frame(width: size * 0.16, height: size * 0.16)
      }
    }
    .frame(width: size, height: size)
    // Iconography is geometric, not textual: without this pin, RTL mirrors the drawing and the
    // check flips (owner caught it on the Arabic watch capture, 2026-08-28).
    .environment(\.layoutDirection, .leftToRight)
  }

  private func glyphStroke(_ width: CGFloat) -> StrokeStyle {
    StrokeStyle(lineWidth: width * size / 24, lineCap: .round, lineJoin: .round)
  }

  /// A status string + register, mapped exactly as the Kotlin renderer maps them.
  static func skin(status: String, isCurrent: Bool, isFuture: Bool) -> Skin {
    switch status {
    case "prayed": return .prayed
    case "late": return .late
    case "missed": return .missed
    case "exempt": return .exempt
    default:
      if isCurrent { return .unloggedCurrent }
      if isFuture { return .future }
      return .unloggedPast
    }
  }
}

/// src-over compositing of a translucent card onto the paper, mirroring the Kotlin renderer.
func composite(_ bg: Color, _ over: Color) -> Color {
  func parts(_ color: Color) -> (r: Double, g: Double, b: Double, a: Double) {
    let ui = UIColor(color)
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    ui.getRed(&r, green: &g, blue: &b, alpha: &a)
    return (Double(r), Double(g), Double(b), Double(a))
  }
  let base = parts(bg)
  let top = parts(over)
  return Color(
    .sRGB,
    red: top.r * top.a + base.r * (1 - top.a),
    green: top.g * top.a + base.g * (1 - top.a),
    blue: top.b * top.a + base.b * (1 - top.a),
    opacity: 1
  )
}

struct GlyphCheck: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let s = rect.width / 24
    path.move(to: CGPoint(x: 5 * s, y: 12.5 * s))
    path.addLine(to: CGPoint(x: 9.5 * s, y: 17 * s))
    path.addLine(to: CGPoint(x: 19 * s, y: 7.5 * s))
    return path
  }
}

struct GlyphClose: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let s = rect.width / 24
    path.move(to: CGPoint(x: 7 * s, y: 7 * s))
    path.addLine(to: CGPoint(x: 17 * s, y: 17 * s))
    path.move(to: CGPoint(x: 17 * s, y: 7 * s))
    path.addLine(to: CGPoint(x: 7 * s, y: 17 * s))
    return path
  }
}

struct GlyphClock: View {
  let stroke: Color
  let line: StrokeStyle

  var body: some View {
    ZStack {
      Circle().strokeBorder(stroke, lineWidth: line.lineWidth)
      GlyphClockHands().stroke(stroke, style: line)
    }
  }
}

struct GlyphClockHands: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let s = rect.width / 24
    path.move(to: CGPoint(x: 12 * s, y: 7.6 * s))
    path.addLine(to: CGPoint(x: 12 * s, y: 12 * s))
    path.addLine(to: CGPoint(x: 15 * s, y: 14 * s))
    return path
  }
}

struct GlyphCrescent: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let s = rect.width / 24
    path.move(to: CGPoint(x: 14.5 * s, y: 3.5 * s))
    path.addArc(
      center: CGPoint(x: 11.5 * s, y: 12 * s),
      radius: 9 * s,
      startAngle: .degrees(-70),
      endAngle: .degrees(70),
      clockwise: false
    )
    path.addArc(
      center: CGPoint(x: 16.5 * s, y: 11 * s),
      radius: 7.2 * s,
      startAngle: .degrees(80),
      endAngle: .degrees(-60),
      clockwise: true
    )
    path.closeSubpath()
    return path
  }
}

/**
 The app mark — the mosque silhouette from `src/components/Logo.tsx` at its MEDIUM optical size
 (dome, finial, minarets, ground), so the Now widget is recognizably this app before a single
 word is read. The geometry is the source's, translated into a 56×36 box cropped to the drawing
 (the original 64×64 viewBox left the mark tiny in any square frame). `size` is the WIDTH; the
 height follows the 56:36 aspect. Keep in sync with Logo.tsx if the mark ever changes.
 */
struct MosqueMark: View {
  let color: Color
  let size: CGFloat

  var body: some View {
    let s = size / 56
    let stroke = StrokeStyle(lineWidth: 4.2 * s, lineCap: .round)
    ZStack {
      // Dome: the (14,29)→(42,29) semicircle, apex up — one cubic with the 4r/3 control offset,
      // which sidesteps addArc's flipped-space direction pitfall entirely.
      Path { path in
        path.move(to: CGPoint(x: 14 * s, y: 29 * s))
        path.addCurve(
          to: CGPoint(x: 42 * s, y: 29 * s),
          control1: CGPoint(x: 14 * s, y: 10.33 * s),
          control2: CGPoint(x: 42 * s, y: 10.33 * s)
        )
      }
      .stroke(color, style: stroke)
      // Finial: the stem and its dot.
      Path { path in
        path.move(to: CGPoint(x: 28 * s, y: 13 * s))
        path.addLine(to: CGPoint(x: 28 * s, y: 9 * s))
      }
      .stroke(color, style: StrokeStyle(lineWidth: 3.2 * s, lineCap: .round))
      Circle()
        .fill(color)
        .frame(width: 6 * s, height: 6 * s)
        .position(x: 28 * s, y: 5 * s)
      // Minarets.
      Path { path in
        path.move(to: CGPoint(x: 6.5 * s, y: 29 * s))
        path.addLine(to: CGPoint(x: 6.5 * s, y: 16 * s))
        path.move(to: CGPoint(x: 49.5 * s, y: 29 * s))
        path.addLine(to: CGPoint(x: 49.5 * s, y: 16 * s))
      }
      .stroke(color, style: stroke)
      // Ground line.
      Path { path in
        path.move(to: CGPoint(x: 3 * s, y: 33 * s))
        path.addLine(to: CGPoint(x: 53 * s, y: 33 * s))
      }
      .stroke(color, style: stroke)
    }
    .frame(width: size, height: size * 36 / 56)
    .environment(\.layoutDirection, .leftToRight)
  }
}

struct GlyphSun: View {
  let color: Color

  var body: some View {
    ZStack {
      Circle().fill(color).frame(width: 5, height: 5)
      ForEach(0..<8, id: \.self) { index in
        Capsule()
          .fill(color)
          .frame(width: 1.4, height: 2.6)
          .offset(y: -4.6)
          .rotationEffect(.degrees(Double(index) * 45))
      }
    }
    .frame(width: 11, height: 11)
  }
}
