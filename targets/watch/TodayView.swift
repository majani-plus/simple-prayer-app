import SwiftUI
import WatchKit

/**
 The Today page — the app's reward loop on the wrist (V0a, canvas `Main.dc.html`): the widget
 hero language at watch scale, the seal as the button, the day's rows one crown-turn below, and
 the qibla one page ABOVE the hero (D171 — the hero's first line says so). The hijri date is the
 first line UNDER the hero (D173), which is what bought the centre its size. The three hero modes
 are layout-identical; switching never reflows (D68).

 Everything shown was resolved by the phone; this file selects, concatenates atoms with "·",
 and never builds a sentence (D102).
 */
struct TodayView: View {
  @ObservedObject var model: WatchModel
  let envelope: WatchEnvelope

  var body: some View {
    // The minute boundary re-evaluates which segment holds "now" (a prayer flipping current);
    // the second-level ticking inside the countdown is the system's own.
    TimelineView(.everyMinute) { context in
      let nowMs = context.date.timeIntervalSince1970 * 1000
      let snapshot = envelope.snapshot
      if snapshot.isExpired(at: nowMs) {
        WatchEmptyView(stale: true)
      } else if let segment = snapshot.segment(at: nowMs), let day = snapshot.day(named: segment.day) {
        content(snapshot: snapshot, day: day, segment: segment)
      } else {
        WatchEmptyView(stale: true)
      }
    }
  }

  @ViewBuilder
  private func content(
    snapshot: WidgetSnapshot,
    day: WidgetSnapshot.Day,
    segment: WidgetSnapshot.Segment
  ) -> some View {
    let effective = model.effective(day: day)
    // The hero owns exactly one screenful — the flexible space lives INSIDE its frame (D109),
    // so every watch size shows the whole hero, seal margin included, with the rows waiting one
    // crown-turn below. A fixed stack either clipped the seal (46mm) or floated it (49mm).
    GeometryReader { geo in
      // The hero owns everything from the content's top to the PHYSICAL bottom of the display —
      // not to the inset-reduced viewport, which ended one date-line short and let the rows'
      // date peek into the Today screen (owner, 2026-08-28: the date must only appear after a
      // scroll, as on the Wear twin). Global position, not inset arithmetic: exact on every size.
      let screenHeight = WKInterfaceDevice.current().screenBounds.height
      let heroHeight = max(geo.size.height, screenHeight - geo.frame(in: .global).minY)
      // The hero was tuned on the 46mm (248pt tall). Smaller watches get its BIG elements —
      // the name, the countdown, the seal, the breathing space — scaled by the same factor, the
      // way the Wear twin scales by `screenHeight / 227` (D164), so the page-fit holds on every
      // size by construction: measured on the simulators, the fixed-size hero was 6pt over the
      // bottom of a 40mm in English and 11pt in Arabic (2.5pt over even before the qibla line,
      // D171), and 1.5pt short of its own 14pt seal margin on a 42mm. Small text keeps its
      // readable floors (see `HeroBlock`); only what has room to give gives.
      let heroScale = min(1, screenHeight / HERO_DESIGN_HEIGHT)
      ScrollViewReader { proxy in
        ScrollView {
          VStack(spacing: 0) {
            HeroBlock(
              model: model, snapshot: snapshot, day: day, segment: segment, effective: effective,
              qiblaHint: envelope.qibla?.titleLabel, scale: heroScale
            )
            .frame(height: heroHeight)
            RowsBlock(model: model, snapshot: snapshot, day: day, segment: segment, effective: effective)
            // The rows breathe off the screen edges the way the hero does (owner, 2026-08-28) —
            // the current row's card keeps its own inner padding on top of this.
            .padding(.top, 6)
            .padding(.horizontal, 10)
            .id("rows")
          }
        }
        .onAppear {
          // Screenshot staging only, the -SPQibla twin: the simulator cannot turn a crown, so
          // `simctl launch … -SPRows` opens on the rows list's END. Inert for every real launch.
          if ProcessInfo.processInfo.arguments.contains("-SPRows") {
            proxy.scrollTo("rows", anchor: .bottom)
          }
        }
      }
    }
    .environment(\.layoutDirection, snapshot.rtl ? .rightToLeft : .leftToRight)
  }
}

// MARK: - Hero

/// The display height the hero's point sizes were tuned on: the Series 11 46mm (208×248pt).
private let HERO_DESIGN_HEIGHT: CGFloat = 248

private struct HeroBlock: View {
  @ObservedObject var model: WatchModel
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  /// The qibla page's name; `nil` (no qibla page, or an older envelope) hides the first line.
  let qiblaHint: String?
  /// `screenHeight / HERO_DESIGN_HEIGHT`, capped at 1 — see `TodayView` for why.
  let scale: CGFloat

  private var current: WidgetSnapshot.DayPrayer? {
    segment.current.flatMap { name in day.prayers.first { $0.prayer == name } }
  }

  private var next: WidgetSnapshot.DayPrayer? {
    guard let next = segment.next else { return nil }
    return snapshot.day(named: next.day)?.prayers.first { $0.prayer == next.prayer }
  }

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    let language = snapshot.language
    let strings = snapshot.strings
    let currentStatus = current.map { effective[$0.prayer] ?? $0.status }

    // The hero's NAME never changes on a tap — mid-Isha the watch keeps saying Isha however
    // the seal stands (owner, 2026-08-28: the post-tap flip to the next name read as confusing).
    // WAITING only redirects the countdown and caption toward what comes next.
    let waiting = current != nil && currentStatus != "unlogged" && !day.isExempt
    let subject = current ?? next

    // The Arabic UI face carries the app's ×1.15 optical scale inside `WidgetFonts.ui`, so
    // Arabic gets a smaller NOMINAL size for the same drawn one (this hero once outgrew the
    // display and clipped the seal). The comment used to name Amiri; the face under this line
    // is Noto Naskh now (D135), and the compensation still lands in the same place — 17 × 1.15
    // is 19.55 against Latin's 19.
    // D173: the hijri header left the hero (it is the first line under it now) and the space
    // went to the centre — the name and the countdown each grew two to three points.
    let nameSize: CGFloat = WidgetFonts.isArabicScript(language) ? 19 : 21
    VStack(spacing: 0) {
      if let subject {
        // The hero's first line points one page UP — the qibla lives above the hero now (D171),
        // and without a word nothing says it exists (owner, 2026-08-28: "we need some
        // indicator"; it used to close the rows list and point down). One small italic line in
        // the hint register, the dial miniature naming the page in the app's own vocabulary.
        if let qiblaHint {
          HStack(spacing: 4) {
            GlyphChevronUp(color: c("soft"))
            GlyphQiblaDial(color: c("soft"))
            Text(qiblaHint)
              .font(WidgetFonts.ui(language, 9.5, italic: true))
              .foregroundStyle(c("soft"))
              .lineLimit(1)
          }
          .padding(.bottom, 3 * scale)
        }

        // The mosque mark + hijri date header that used to sit here (the phone Today header at
        // watch scale) is the first line under the hero now — owner, 2026-09-15: "move the hijra
        // calendar date to below the hero screen … giving a bit more vertical space to enlarge
        // the center a bit" (D173). The hint line above is the hero's only eyebrow.

        Spacer(minLength: 3)

        if let arabic = subject.arabicName {
          Text(arabic)
            .font(WidgetFonts.amiri(14.5 * scale))
            .foregroundStyle(c("soft"))
        }
        Text(subject.name)
          .font(WidgetFonts.ui(language, nameSize * scale, weight: .semibold))
          .foregroundStyle(c("ink"))
          .lineLimit(1)
          .minimumScaleFactor(0.6)

        WatchOrnamentRule()
          .padding(.top, 3 * scale)

        centerBlock(subject: subject, waiting: waiting, c: c, language: language, strings: strings)
          .padding(.top, 3 * scale)

        WatchOrnamentRule()
          .padding(.top, 3 * scale)

        Spacer(minLength: 3)

        sealBlock(c: c, language: language, strings: strings)

        // The seal never sits flush with the bezel, and the rows' date line below the fold
        // needs clear air under it (owner, 2026-08-28 — twice; the margin is design).
        Spacer(minLength: 14)
      }
    }
    .frame(maxWidth: .infinity)
  }

  @ViewBuilder
  private func centerBlock(
    subject: WidgetSnapshot.DayPrayer,
    waiting: Bool,
    c: (String) -> Color,
    language: String,
    strings: WidgetSnapshot.Strings
  ) -> some View {
    // Countdown target: the deadline while a prayer is DUE; the next start otherwise. Both
    // modes count to a precomputed instant — the watch computes nothing (D102).
    let target: Double? = {
      if let current, effective[current.prayer] ?? current.status == "unlogged", !day.isExempt {
        return current.windowEndAt
      }
      // WAITING counts to the NEXT start while the hero keeps the current prayer's name;
      // in the sunrise gap the subject already IS the next prayer.
      if waiting, let next { return next.at }
      return subject.at
    }()

    VStack(spacing: 1) {
      if let target {
        Text(timerInterval: Date()...Date(timeIntervalSince1970: target / 1000), countsDown: true)
          .font(WidgetFonts.ui(language, (WidgetFonts.isArabicScript(language) ? 29 : 31) * scale, weight: .semibold))
          .foregroundStyle(c("inkStrong"))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .multilineTextAlignment(.center)
      }
      Text(caption(waiting: waiting, subject: subject, strings: strings))
        .font(WidgetFonts.ui(language, max(10, 11.5 * scale), italic: true))
        .foregroundStyle(c("muted"))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
  }

  private func caption(
    waiting: Bool,
    subject: WidgetSnapshot.DayPrayer,
    strings: WidgetSnapshot.Strings
  ) -> String {
    if day.isExempt {
      return strings.statusNotRequired
    }
    if let current, waiting {
      // "prayed · Fajr · 4:48 am" — the status word keeps the state icon+word (the gold seal
      // is the icon), and the caption is now the one place the NEXT prayer is named, since the
      // hero's name stays with the current prayer (owner, 2026-08-28; amends D109 on the wrist).
      let word = captionFor(
        status: effective[current.prayer] ?? current.status,
        isCurrent: true,
        isFuture: false,
        strings: strings
      )
      if let next { return "\(word) · \(next.name) · \(next.timeText)" }
      return "\(current.name) · \(word)"
    }
    if let current, current.prayer == subject.prayer {
      return current.untilText ?? strings.leftToPray
    }
    return "\(strings.statusUpcoming) · \(subject.timeText)"
  }

  @ViewBuilder
  private func sealBlock(
    c: (String) -> Color,
    language: String,
    strings: WidgetSnapshot.Strings
  ) -> some View {
    // The hero seal always belongs to the CURRENT prayer (the thing a tap can assert). With no
    // current prayer (the sunrise gap) the next prayer's dormant ring holds the slot so the
    // layout never reflows (D68) — structurally inert, never color-alone-different (DESIGN).
    // The drawn seal scales with the screen (never under 36pt); the TAP target does not — the
    // button's label is a 44pt box that overflows the seal's own layout height, so the column
    // pays only for the seal and the finger still gets the full target.
    let sealSize = max(36, 42 * scale)
    if day.isExempt {
      VStack(spacing: 4) {
        SealView(skin: .exempt, size: max(36, 44 * scale), night: watchNight)
        Text(strings.statusNotRequired)
          .font(WidgetFonts.ui(language, 10, italic: true))
          .foregroundStyle(c("soft"))
      }
    } else if let current {
      let status = effective[current.prayer] ?? current.status
      let skin = SealView.skin(status: status, isCurrent: true, isFuture: false)
      if sealTappable(status: status, isFuture: false) {
        Button {
          model.tap(day: day.day, prayer: current.prayer, shownStatus: status)
        } label: {
          SealView(skin: skin, size: sealSize, night: watchNight)
            .frame(width: max(44, sealSize), height: max(44, sealSize))
        }
        .buttonStyle(.plain)
        .frame(height: sealSize)
      } else {
        SealView(skin: skin, size: sealSize, night: watchNight)
      }
    } else {
      SealView(skin: .future, size: sealSize, night: watchNight)
    }
  }
}

// MARK: - Rows

private struct RowsBlock: View {
  @ObservedObject var model: WatchModel
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    VStack(spacing: 2) {
      // The hijri date leads the rows (D173): it left the hero's crown so the centre could grow,
      // and it is the first thing one crown-turn reveals — same face, same faint ink it had.
      Text(day.hijriText)
        .font(WidgetFonts.ui(snapshot.language, 10.5, italic: true))
        .foregroundStyle(c("faint"))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Text(day.dateText)
        .font(WidgetFonts.ui(snapshot.language, 10.5, italic: true))
        .foregroundStyle(c("faint"))
        .padding(.bottom, 2)
      ForEach(day.prayers, id: \.prayer) { prayer in
        PrayerRow(model: model, snapshot: snapshot, day: day, segment: segment, effective: effective, prayer: prayer)
        if prayer.prayer == "fajr", let sunriseText = day.sunriseText {
          HStack(spacing: 5) {
            Rectangle().fill(c("hairline")).frame(height: 1)
            GlyphSun(color: c("soft"))
            Text(sunriseText)
              .font(WidgetFonts.ui(snapshot.language, 9.5, italic: true))
              .foregroundStyle(c("soft"))
            Rectangle().fill(c("hairline")).frame(height: 1)
          }
          .padding(.vertical, 1)
        }
      }
      // The list ends on its last prayer. Its old last word ("qibla ↓") pointed at a page that
      // is above the hero now (D171); the hero's first line carries the hint instead.
    }
    .padding(.bottom, 4)
  }
}

/// A miniature of the qibla page's dial — ring plus needle — so the hero's hint names the page
/// in the app's own vocabulary rather than a system symbol.
private struct GlyphQiblaDial: View {
  let color: Color

  var body: some View {
    ZStack {
      Circle().strokeBorder(color, lineWidth: 1)
      Path { path in
        path.move(to: CGPoint(x: 5.5, y: 2.6))
        path.addLine(to: CGPoint(x: 6.9, y: 6.4))
        path.addLine(to: CGPoint(x: 5.5, y: 5.4))
        path.addLine(to: CGPoint(x: 4.1, y: 6.4))
        path.closeSubpath()
      }
      .fill(color)
    }
    .frame(width: 11, height: 11)
    .environment(\.layoutDirection, .leftToRight)
  }
}

private struct GlyphChevronUp: View {
  let color: Color

  var body: some View {
    Path { path in
      path.move(to: CGPoint(x: 1, y: 6))
      path.addLine(to: CGPoint(x: 4.5, y: 2.5))
      path.addLine(to: CGPoint(x: 8, y: 6))
    }
    .stroke(color, style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
    .frame(width: 9, height: 8)
  }
}

private struct PrayerRow: View {
  @ObservedObject var model: WatchModel
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  let prayer: WidgetSnapshot.DayPrayer

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    let language = snapshot.language
    let status = effective[prayer.prayer] ?? prayer.status
    let isCurrent = segment.current == prayer.prayer
    let isFuture = prayer.at > segment.from
    let skin = SealView.skin(status: status, isCurrent: isCurrent, isFuture: isFuture)

    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 0) {
        Text(prayer.name)
          .font(WidgetFonts.ui(language, isCurrent ? 15.5 : 14.5, weight: .semibold))
          .foregroundStyle(c("ink"))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        HStack(spacing: 4) {
          Text(prayer.timeText)
            .font(WidgetFonts.ui(language, 11, weight: isCurrent ? .bold : .regular))
            .foregroundStyle(c(isCurrent ? "inkStrong" : "muted"))
          if isCurrent {
            Text("· \(snapshot.strings.now)")
              .font(WidgetFonts.ui(language, 10, italic: true))
              .foregroundStyle(c("muted"))
          }
        }
      }
      Spacer(minLength: 4)
      if sealTappable(status: status, isFuture: isFuture), !day.isExempt {
        Button {
          model.tap(day: day.day, prayer: prayer.prayer, shownStatus: status)
        } label: {
          SealView(skin: skin, size: 32, night: watchNight)
        }
        .buttonStyle(.plain)
      } else {
        SealView(skin: skin, size: 32, night: watchNight)
      }
    }
    .padding(.vertical, isCurrent ? 6 : 4)
    .padding(.horizontal, isCurrent ? 8 : 0)
    .background(
      RoundedRectangle(cornerRadius: 13)
        .fill(isCurrent ? composite(c("bg"), c("card")) : Color.clear)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 13)
        .strokeBorder(isCurrent ? c("borderStrong") : .clear, lineWidth: 1)
    )
  }
}
