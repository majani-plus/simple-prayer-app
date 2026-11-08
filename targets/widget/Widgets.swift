import SwiftUI
import WidgetKit

/**
 The widget bundle (D26): the Schedule widget (medium/large), the Now widget (small + StandBy),
 and the lockscreen accessories (times only — never tracking marks; a lockscreen must not leak
 what the log knows, D60 extended). The Live Activity (D27) joins this bundle in W4.

 Rendering rules inherited from the app, non-negotiable: statuses carry glyph + word, never
 color alone; exempt days rest as crescents saying "not required" and nothing more; nothing on
 any widget counts, scores, or lists the past. RTL follows the SNAPSHOT's flag — the app
 language, not the device locale (D41).
 */
@main
struct SimplePrayerWidgets: WidgetBundle {
  var body: some Widget {
    ScheduleWidget()
    NowWidget()
    PrayerActivityWidget()
  }
}

// MARK: - Shared scaffolding

/// Whether night-paper applies: the in-app override wins; 'system' follows the OS appearance.
func isNight(_ theme: String, _ colorScheme: ColorScheme) -> Bool {
  switch theme {
  case "dark": return true
  case "light": return false
  default: return colorScheme == .dark
  }
}

struct PaperGround: ViewModifier {
  let night: Bool

  func body(content: Content) -> some View {
    content.containerBackground(WidgetPalette.color("bg", night: night), for: .widget)
  }
}

/// The app's signature divider — a hairline with the ◆ ornament in the diamond tone — exactly
/// the in-app section rule, here framing the Now widget's hero band.
struct OrnamentRule: View {
  let night: Bool

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    HStack(spacing: 7) {
      Rectangle().fill(c("hairline")).frame(height: 1)
      Text("\u{25C6}")
        .font(.system(size: 8))
        .foregroundStyle(c("diamond"))
      Rectangle().fill(c("hairline")).frame(height: 1)
    }
    .padding(.horizontal, 6)
  }
}

struct EmptyStateView: View {
  let stale: Bool
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let night = colorScheme == .dark
    let strings = BundledStrings.current()
    VStack(spacing: 4) {
      SealView(skin: stale ? .exempt : .unloggedPast, size: 34, night: night)
      // The face follows the language of the words, which here is the SYSTEM locale's, not the
      // snapshot's — there is no snapshot; that is the whole reason these strings exist (D103).
      // Pinning Lora drew the Arabic pair in a face with no Arabic glyph in it, with a
      // synthesised slant on the body line, for the first sentences the product ever says.
      Text(stale ? strings.staleTitle : strings.emptyTitle)
        .font(WidgetFonts.ui(strings.language, 14, weight: .semibold))
        .foregroundStyle(WidgetPalette.color("inkStrong", night: night))
        .padding(.top, 4)
      Text(stale ? strings.staleBody : strings.emptyBody)
        .font(WidgetFonts.ui(strings.language, 11.5, italic: true))
        .foregroundStyle(WidgetPalette.color("muted", night: night))
        .multilineTextAlignment(.center)
    }
    .modifier(PaperGround(night: night))
  }
}

// MARK: - Schedule (systemMedium / systemLarge)

struct ScheduleWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SPScheduleWidget", provider: PrayerTimelineProvider()) { entry in
      ScheduleEntryView(entry: entry)
        // Widgets are fixed-size boxes: past this size the largest text sizes only clip.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
    .configurationDisplayName("Prayer times")
    .description("Today's five prayers, with a tap to mark them.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

struct ScheduleEntryView: View {
  let entry: PrayerTimelineProvider.Entry
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch entry.content {
    case .empty(let stale):
      EmptyStateView(stale: stale)
    case .day(let snapshot, let day, let segment, let effective):
      let night = isNight(snapshot.theme, colorScheme)
      ScheduleDayView(
        snapshot: snapshot,
        day: day,
        segment: segment,
        effective: effective,
        night: night,
        large: family == .systemLarge
      )
      .environment(\.layoutDirection, snapshot.rtl ? .rightToLeft : .leftToRight)
      .modifier(PaperGround(night: night))
    }
  }
}

struct ScheduleDayView: View {
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  let night: Bool
  let large: Bool

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    let language = snapshot.language
    VStack(alignment: .leading, spacing: large ? 10 : 8) {
      // The app's mark and its hairline-and-◆ rule under the header — the same manuscript
      // character the Now widget carries (owner, 2026-08-25).
      HStack {
        MosqueMark(color: c("accent"), size: 22)
        Text(day.dateText)
          .font(WidgetFonts.ui(language, 13, weight: .semibold))
          .foregroundStyle(c("header"))
          .lineLimit(1)
          .minimumScaleFactor(0.75)
        Spacer(minLength: 6)
        HStack(spacing: 4) {
          GlyphSun(color: c("faint"))
          Text([day.sunriseText, day.hijriText.isEmpty ? nil : day.hijriText].compactMap { $0 }.joined(separator: " · "))
            .font(WidgetFonts.ui(language, 11))
            .foregroundStyle(c("faint"))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
        }
      }
      OrnamentRule(night: night)

      if large {
        VStack(spacing: 4) {
          ForEach(day.prayers, id: \.prayer) { prayer in
            ScheduleRow(prayer: prayer, day: day, segment: segment, effective: effective, night: night, language: language, strings: snapshot.strings, buddies: snapshot.buddies(for: prayer.prayer, on: day.day))
            if prayer.prayer == "fajr" {
              SunriseRule(day: day, night: night, language: language, strings: snapshot.strings)
            }
          }
        }
      } else {
        HStack(spacing: 6) {
          ForEach(day.prayers, id: \.prayer) { prayer in
            ScheduleColumn(prayer: prayer, day: day, segment: segment, effective: effective, night: night, language: language, strings: snapshot.strings)
          }
        }
      }
    }
    // No outer padding and no contentMarginsDisabled: the SYSTEM content margins inset the
    // content on every device and OS — hand-padding under disabled margins left text touching
    // the edges on hardware (owner, 2026-08-26). The paper containerBackground still fills the
    // widget edge-to-edge; backgrounds ignore margins by design.
  }
}

/// Whether a seal tap may mark this prayer (owner rule, 2026-08-25: a future prayer is never
/// tickable, and a mark the tap cannot change — late, missed, exempt — never invites one).
/// Mirrors the Kotlin renderer's `tappable` and the guards in `MarkPrayedIntent`'s drain.
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

struct ScheduleColumn: View {
  let prayer: WidgetSnapshot.DayPrayer
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  let night: Bool
  let language: String
  let strings: WidgetSnapshot.Strings

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    let status = effective[prayer.prayer] ?? prayer.status
    let isCurrent = segment.current == prayer.prayer
    let isFuture = prayer.at > segment.from
    let skin = SealView.skin(status: status, isCurrent: isCurrent, isFuture: isFuture)

    // A centered cluster with fixed gaps — never stretched apart (owner, 2026-08-25).
    VStack(spacing: 0) {
      Spacer(minLength: 0)
      Text(prayer.name)
        .font(WidgetFonts.ui(language, 12, weight: .semibold))
        .foregroundStyle(c("ink"))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      Group {
        if sealTappable(status: status, isFuture: isFuture) {
          Button(intent: MarkPrayedIntent(day: day.day, prayer: prayer.prayer)) {
            SealView(skin: skin, size: 30, night: night)
          }
          .buttonStyle(.plain)
        } else {
          SealView(skin: skin, size: 30, night: night)
        }
      }
      .padding(.vertical, 5)
      Text(prayer.timeText)
        .font(WidgetFonts.ui(language, 11.5, weight: isCurrent ? .bold : .regular))
        .foregroundStyle(c(isCurrent ? "inkStrong" : "muted"))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      Text(captionFor(status: status, isCurrent: isCurrent, isFuture: isFuture, strings: strings))
        .font(WidgetFonts.ui(language, 10, italic: true))
        .foregroundStyle(isCurrent && status == "unlogged" ? c("accent") : c("muted"))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Spacer(minLength: 0)
    }
    .padding(.vertical, 6)
    .padding(.horizontal, 3)
    .padding(.horizontal, 2)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(isCurrent ? composite(c("bg"), c("cardBright")) : composite(c("bg"), c("cardQuiet")))
    )
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .strokeBorder(isCurrent ? c("borderStrong") : .clear, lineWidth: 1)
    )
  }
}

struct ScheduleRow: View {
  let prayer: WidgetSnapshot.DayPrayer
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  let night: Bool
  let language: String
  let strings: WidgetSnapshot.Strings
  /// Today's buddies for this prayer (D177). Empty on every other day, and for every install
  /// without buddy mode — which is most of them.
  var buddies: [WidgetSnapshot.Buddy] = []

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    let status = effective[prayer.prayer] ?? prayer.status
    let isCurrent = segment.current == prayer.prayer
    let isFuture = prayer.at > segment.from
    let skin = SealView.skin(status: status, isCurrent: isCurrent, isFuture: isFuture)
    let caption = isCurrent && status == "unlogged"
      ? prayer.dueCaption
      : captionFor(status: status, isCurrent: isCurrent, isFuture: isFuture, strings: strings)

    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 1) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(prayer.name)
            .font(WidgetFonts.ui(language, isCurrent ? 15 : 13.5, weight: .semibold))
            .foregroundStyle(c("ink"))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
          if let arabic = prayer.arabicName {
            Text(arabic)
              .font(WidgetFonts.amiri(13.8))
              .foregroundStyle(c("muted"))
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
        }
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(prayer.timeText)
            .font(WidgetFonts.ui(language, isCurrent ? 13 : 11.5, weight: isCurrent ? .bold : .regular))
            .foregroundStyle(c(isCurrent ? "inkStrong" : "muted"))
          Text(caption)
            .font(WidgetFonts.ui(language, 10.5, italic: true))
            .foregroundStyle(isCurrent && status == "unlogged" ? c("accent") : c("muted"))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
      }
      Spacer(minLength: 6)
      // Who else prayed it (D177). Beside the seal, on the seal's own row, which is what costs the
      // widget the two lines of body text it used to have room for — the large family only.
      BuddyBadges(buddies: buddies, night: night, language: language)
      if sealTappable(status: status, isFuture: isFuture) {
        Button(intent: MarkPrayedIntent(day: day.day, prayer: prayer.prayer)) {
          SealView(skin: skin, size: isCurrent ? 32 : 28, night: night)
        }
        .buttonStyle(.plain)
      } else {
        SealView(skin: skin, size: isCurrent ? 32 : 28, night: night)
      }
    }
    .padding(.vertical, isCurrent ? 5 : 3)
    .padding(.horizontal, 12)
    // Elastic: rows stretch evenly when the canvas is roomy (the paper cards fill, never a
    // naked gap) and compress to their text'"'"'s own height when it is tight — the
    // iPad-compatibility large canvas is ~60pt shorter than an iPhone'"'"'s (owner, 2026-08-27,
    // the header and Isha row were clipping there).
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(
      RoundedRectangle(cornerRadius: 14)
        .fill(isCurrent ? composite(c("bg"), c("cardBright")) : composite(c("bg"), c("cardQuiet")))
    )
    .overlay(
      RoundedRectangle(cornerRadius: 14)
        .strokeBorder(isCurrent ? c("borderStrong") : .clear, lineWidth: 1)
    )
  }
}

struct SunriseRule: View {
  let day: WidgetSnapshot.Day
  let night: Bool
  let language: String
  let strings: WidgetSnapshot.Strings

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    if let sunriseText = day.sunriseText {
      HStack(spacing: 8) {
        Rectangle().fill(c("hairline")).frame(height: 1)
        GlyphSun(color: c("faint"))
        Text(strings.sunrise)
          .font(WidgetFonts.ui(language, 10.5, italic: true))
          .foregroundStyle(c("faint"))
        Text(sunriseText)
          .font(WidgetFonts.ui(language, 10.5))
          .foregroundStyle(c("faint"))
        Rectangle().fill(c("hairline")).frame(height: 1)
      }
      .padding(.horizontal, 4)
    }
  }
}

/// The buddy badges on a large-widget row (D177).
///
/// The same shape the app draws: a coloured disc with two letters, a ring in the paper's colour so
/// overlapping discs stay countable, and a slight overlap so a row of them reads as a group. Never
/// a name — a widget is read across a room.
///
/// It renders nothing at all when there is nobody, which is the case for every install without
/// buddy mode and for most prayers of most days in the ones that have it.
struct BuddyBadges: View {
  let buddies: [WidgetSnapshot.Buddy]
  let night: Bool
  let language: String

  /// At most three. A fourth would push the seal, and the seal is the point of the row.
  private let maxShown = 3
  /// 22, up from 18: the first device pass could not read the letters at arm's length.
  private let size: CGFloat = 22

  var body: some View {
    if buddies.isEmpty {
      EmptyView()
    } else {
      HStack(spacing: -6) {
        ForEach(Array(buddies.prefix(maxShown).enumerated()), id: \.offset) { item in
          ZStack {
            Circle()
              .fill(WidgetPalette.buddyColor(item.element.color, night: night))
            Circle()
              .strokeBorder(WidgetPalette.color("bg", night: night), lineWidth: 1.5)
            Text(item.element.initials)
              .font(WidgetFonts.ui(language, size * 0.42, weight: .bold))
              .foregroundStyle(WidgetPalette.color("sealFg", night: night))
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
          .frame(width: size, height: size)
          .zIndex(Double(maxShown - item.offset))
        }
      }
      .padding(.trailing, 2)
    }
  }
}
