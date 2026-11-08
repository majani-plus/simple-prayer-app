import SwiftUI
import WidgetKit

/**
 The Now widget: the current prayer with a LIVE countdown to its window end (a native ticking
 `Text`, free of refresh budget), or the next prayer with a countdown to its start — plus
 today's five seals. The seal strip is one button: mark the current prayer prayed, tap again to
 undo, exactly the in-app seal's direct tap (D58).

 Two homescreen faces: the small (the manuscript miniature) and the medium (D182, D184) — the
 same hero laid out wide, with the day's seals in its eyebrow and the current prayer's buddies
 beside a big seal. iOS has no one-row family, so the medium stands in for Android's 4×1 strip.

 The accessory (lockscreen) families carry TIMES ONLY — no seals, no dots. A lockscreen is
 visible without unlocking, and what the log knows must never be (D60 extended).
 */
struct NowWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SPNowWidget", provider: PrayerTimelineProvider(minuteEntries: true)) { entry in
      NowEntryView(entry: entry)
        // Widgets are fixed-size boxes: past this size the largest text sizes only clip.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
    .configurationDisplayName("Next prayer")
    .description("The current prayer and what comes next.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryRectangular, .accessoryCircular])
  }
}

struct NowEntryView: View {
  let entry: PrayerTimelineProvider.Entry
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch entry.content {
    case .empty(let stale):
      if family == .systemSmall || family == .systemMedium {
        EmptyStateView(stale: stale)
      } else {
        // Accessories must adopt containerBackground too, or iOS 17 shows its adoption
        // placeholder instead of the view — first-install lockscreen widgets hit this state.
        AccessoryEmptyView(stale: stale)
          .containerBackground(for: .widget) { Color.clear }
      }
    case .day(let snapshot, let day, let segment, let effective):
      let night = isNight(snapshot.theme, colorScheme)
      switch family {
      case .systemSmall:
        NowSmallView(snapshot: snapshot, day: day, segment: segment, effective: effective, night: night, date: entry.date)
          .environment(\.layoutDirection, snapshot.rtl ? .rightToLeft : .leftToRight)
          .modifier(PaperGround(night: night))
      case .systemMedium:
        NowStripView(snapshot: snapshot, day: day, segment: segment, effective: effective, night: night, date: entry.date)
          .environment(\.layoutDirection, snapshot.rtl ? .rightToLeft : .leftToRight)
          .modifier(PaperGround(night: night))
      default:
        AccessoryView(snapshot: snapshot, day: day, segment: segment, family: family)
          .environment(\.layoutDirection, snapshot.rtl ? .rightToLeft : .leftToRight)
          .containerBackground(for: .widget) { Color.clear }
      }
    }
  }
}

// MARK: - The homescreen small

struct NowSmallView: View {
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  let night: Bool
  /// The timeline entry's date — what the calm H:MM is counted from (D198), never `Date()`.
  let date: Date

  private var current: WidgetSnapshot.DayPrayer? {
    segment.current.flatMap { name in day.prayers.first { $0.prayer == name } }
  }

  private var next: WidgetSnapshot.DayPrayer? {
    guard let next = segment.next else { return nil }
    return snapshot.day(named: next.day)?.prayers.first { $0.prayer == next.prayer }
  }

  var body: some View {
    // Three tiers and nothing else (owner design round, 2026-08-25): the EYEBROW naming the
    // prayer, the HERO countdown, and a CAPTION carrying the deadline. The current prayer's
    // start time earned no line — the countdown's target is the fact that matters, and the
    // schedule widget owns the list.
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    let language = snapshot.language
    let strings = snapshot.strings
    let subject = current ?? next

    // CENTERED MANUSCRIPT, a miniature of the app's own Today hero (owner, 2026-08-25: the
    // left-anchored list read as unintentional emptiness): the mark and the prayer's name as a
    // centered eyebrow, the app's hairline-and-◆ ornament rules framing a centered hero band,
    // the day's seals centered at the foot. The flexible space lives INSIDE the framed band.
    VStack(spacing: 0) {
      if let subject {
        // Sized for the narrowest canvas iOS ever proposes (an iPhone-family small widget
        // inside iPad's compatibility mode leaves ~116pt after margins): everything scales
        // down before anything truncates or clips.
        HStack(spacing: 6) {
          MosqueMark(color: c("accent"), size: 22)
          Text(subject.name)
            .font(WidgetFonts.ui(language, 18, weight: .semibold))
            .foregroundStyle(c("ink"))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          if let arabic = subject.arabicName {
            Text(arabic)
              .font(WidgetFonts.amiri(16.1))
              .foregroundStyle(c("muted"))
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
        }

        OrnamentRule(night: night)
          .padding(.top, 8)

        Spacer(minLength: 0)

        centerBlock(subject: subject, c: c, language: language, strings: strings)

        Spacer(minLength: 0)

        OrnamentRule(night: night)
          .padding(.bottom, 8)
      }

      dotsStrip(c: c)
    }
    // No outer padding: the SYSTEM content margins inset the content (see ScheduleDayView's
    // note) — this also returns the lockscreen accessories their platform insets.
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder
  private func centerBlock(
    subject: WidgetSnapshot.DayPrayer,
    c: (String) -> Color,
    language: String,
    strings: WidgetSnapshot.Strings
  ) -> some View {
    let currentStatus = current.map { effective[$0.prayer] ?? $0.status }

    if day.isExempt {
      HStack(spacing: 8) {
        SealView(skin: .exempt, size: 26, night: night)
        Text(strings.statusNotRequired)
          .font(WidgetFonts.ui(language, 13, italic: true))
          .foregroundStyle(c("muted"))
      }
    } else if let current, currentStatus == "unlogged", let end = current.windowEndAt {
      // Live countdown beside the current prayer's SEAL — the visible "I prayed" button, the
      // in-app reward loop carried onto the widget (owner, 2026-08-25). The caption is one word
      // and the deadline; anything longer truncates on the small widget.
      VStack(spacing: 3) {
        Text(timerInterval: countdownRange(to: Date(timeIntervalSince1970: end / 1000)), countsDown: true)
          .font(WidgetFonts.ui(language, 28, weight: .bold))
          .foregroundStyle(c("inkStrong"))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          // A ticking Text claims the full proposed width and left-aligns its digits; this
          // centers them within that claim (the classic WidgetKit timer quirk).
          .multilineTextAlignment(.center)
        HStack(spacing: 9) {
          Text(current.untilText ?? strings.leftToPray)
            .font(WidgetFonts.ui(language, 13, italic: true))
            .foregroundStyle(c("accent"))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          sealButton(current)
        }
      }
    } else if let current, let status = currentStatus, let next, next.at > nowMs {
      // Marked: the CALM countdown to the next prayer's start (owner, 2026-11-07) — muted, never
      // the deadline's strong ink and accent — with the recorded status kept in words: "Prayed ·
      // until Asr". Fajr marked stays "prayed" until sunrise, counting to Dhuhr / Jumu'ah (D190).
      VStack(spacing: 3) {
        calmTimer(to: next, from: date, size: 26, c: c, language: language)
          .multilineTextAlignment(.center)
        HStack(spacing: 9) {
          Text("\(captionFor(status: status, isCurrent: true, isFuture: false, strings: strings)) · \(next.untilStartText ?? next.name)")
            .font(WidgetFonts.ui(language, 13, italic: true))
            .foregroundStyle(c("muted"))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          sealButton(current)
        }
      }
    } else if let current, let status = currentStatus {
      // Marked with nothing left to count to (the horizon's edge): say what was recorded.
      VStack(spacing: 3) {
        Text(captionFor(status: status, isCurrent: true, isFuture: false, strings: strings))
          .font(WidgetFonts.ui(language, 19, weight: .semibold))
          .foregroundStyle(c("muted"))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        sealButton(current)
      }
    } else if subject.at > nowMs {
      // The sunrise→Dhuhr gap: the calm countdown to Dhuhr — Jumu'ah on Friday, by the snapshot's
      // own name (D190, reversing the 2026-08-28 "nothing ticks" ruling at the owner's request).
      // Dhuhr's own segment counts to Asr, so the same name never counts down twice.
      VStack(spacing: 3) {
        HStack(spacing: 7) {
          GlyphSun(color: c("soft"))
          calmTimer(to: subject, from: date, size: 24, c: c, language: language)
        }
        Text(subject.untilStartText ?? subject.name)
          .font(WidgetFonts.ui(language, 13, italic: true))
          .foregroundStyle(c("muted"))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      }
    } else {
      VStack(spacing: 3) {
        HStack(spacing: 7) {
          GlyphSun(color: c("soft"))
          Text(day.sunriseText ?? subject.timeText)
            .font(WidgetFonts.ui(language, 24, weight: .semibold))
            .foregroundStyle(c("inkStrong"))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
        Text("\(strings.statusUpcoming) · \(subject.timeText)")
          .font(WidgetFonts.ui(language, 13, italic: true))
          .foregroundStyle(c("accent"))
          .lineLimit(1)
          .minimumScaleFactor(0.75)
      }
    }
  }

  @ViewBuilder
  private func sealButton(_ prayer: WidgetSnapshot.DayPrayer) -> some View {
    NowSealButton(day: day.day, prayer: prayer, status: effective[prayer.prayer] ?? prayer.status, size: 30, night: night)
  }

  @ViewBuilder
  private func dotsStrip(c: (String) -> Color) -> some View {
    let strip = HStack(spacing: 7) {
      ForEach(day.prayers, id: \.prayer) { prayer in
        let status = effective[prayer.prayer] ?? prayer.status
        SealView(
          skin: SealView.skin(
            status: status,
            isCurrent: segment.current == prayer.prayer,
            isFuture: prayer.at > segment.from
          ),
          size: 16,
          night: night
        )
      }
    }

    if let current, !day.isExempt {
      Button(intent: MarkPrayedIntent(day: day.day, prayer: current.prayer)) { strip }
        .buttonStyle(.plain)
    } else {
      strip
    }
  }
}

/// The current prayer's own seal as the mark-prayed button — filling gold under the finger,
/// tap again to undo, exactly the in-app seal (D58/D100). Shared by the small and the strip.
struct NowSealButton: View {
  let day: String
  let prayer: WidgetSnapshot.DayPrayer
  let status: String
  let size: CGFloat
  let night: Bool

  var body: some View {
    let skin = SealView.skin(status: status, isCurrent: true, isFuture: false)
    if sealTappable(status: status, isFuture: false) {
      Button(intent: MarkPrayedIntent(day: day, prayer: prayer.prayer)) {
        SealView(skin: skin, size: size, night: night)
      }
      .buttonStyle(.plain)
    } else {
      SealView(skin: skin, size: size, night: night)
    }
  }
}

// MARK: - The homescreen medium (D182, reworked by D184)

/**
 The Now widget at medium size. iOS has no one-row family, so this is the strip's home here (D182)
 — but it is two rows tall, and the first version left that height as empty paper. It now uses
 it like the small does, laid out wide (D184):

 - the EYEBROW: the mark, the prayer's name and its Arabic companion, and on the trailing edge
   the day's five seals, small — the day at a glance;
 - the app's hairline-and-◆ ornament rules framing the HERO band: the live countdown large, the
   one-word deadline caption under it, and on the trailing side the buddies who prayed this one
   and the current prayer's seal, big, as the "I prayed" button.

 The flexible space lives inside the framed band, so extra height is breathing room around the
 hero, never a void (D109).
 */
struct NowStripView: View {
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  let night: Bool
  /// The timeline entry's date — what the calm H:MM is counted from (D198), never `Date()`.
  let date: Date

  private var current: WidgetSnapshot.DayPrayer? {
    segment.current.flatMap { name in day.prayers.first { $0.prayer == name } }
  }

  private var next: WidgetSnapshot.DayPrayer? {
    guard let next = segment.next else { return nil }
    return snapshot.day(named: next.day)?.prayers.first { $0.prayer == next.prayer }
  }

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: night) }
    let language = snapshot.language
    let strings = snapshot.strings

    VStack(spacing: 0) {
      if let subject = current ?? next {
        HStack(spacing: 7) {
          MosqueMark(color: c("accent"), size: 26)
          Text(subject.name)
            .font(WidgetFonts.ui(language, 20, weight: .semibold))
            .foregroundStyle(c("ink"))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .layoutPriority(2)
          if let arabic = subject.arabicName {
            Text(arabic)
              .font(WidgetFonts.amiri(17.5))
              .foregroundStyle(c("muted"))
              .lineLimit(1)
              .minimumScaleFactor(0.7)
          }
          Spacer(minLength: 8)
          daySeals
        }

        OrnamentRule(night: night)
          .padding(.top, 8)

        Spacer(minLength: 0)

        HStack(spacing: 10) {
          hero(subject: subject, c: c, language: language, strings: strings)
          Spacer(minLength: 6)
          if let current, !day.isExempt {
            // Who else prayed it (D182). Nobody can have prayed a prayer that has not started,
            // so the sunrise gap — where the subject is the NEXT prayer — shows none.
            BuddyBadges(buddies: snapshot.buddies(for: current.prayer, on: day.day), night: night, language: language)
            NowSealButton(day: day.day, prayer: current, status: effective[current.prayer] ?? current.status, size: 46, night: night)
          }
        }

        Spacer(minLength: 0)

        OrnamentRule(night: night)
      }
    }
    // No outer padding: the SYSTEM content margins inset the content (see ScheduleDayView's note).
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  /// The day's five seals, small and quiet in the eyebrow — a glance, not a button: the big seal
  /// beside the hero is the one that answers a tap.
  private var daySeals: some View {
    HStack(spacing: 5) {
      ForEach(day.prayers, id: \.prayer) { prayer in
        SealView(
          skin: SealView.skin(
            status: effective[prayer.prayer] ?? prayer.status,
            isCurrent: segment.current == prayer.prayer,
            isFuture: prayer.at > segment.from
          ),
          size: 14,
          night: night
        )
      }
    }
  }

  /// The same states as the small's centre block: the big element over its caption.
  @ViewBuilder
  private func hero(
    subject: WidgetSnapshot.DayPrayer,
    c: (String) -> Color,
    language: String,
    strings: WidgetSnapshot.Strings
  ) -> some View {
    let currentStatus = current.map { effective[$0.prayer] ?? $0.status }

    VStack(alignment: .leading, spacing: 2) {
      if day.isExempt {
        HStack(spacing: 8) {
          SealView(skin: .exempt, size: 26, night: night)
          Text(strings.statusNotRequired)
            .font(WidgetFonts.ui(language, 18, italic: true))
            .foregroundStyle(c("muted"))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
      } else if let current, currentStatus == "unlogged", let end = current.windowEndAt {
        // A ticking Text claims the whole proposed width (the classic WidgetKit timer quirk);
        // here that is fine — the seal and badges are fixed, so the timer takes the rest and
        // keeps its digits at the leading edge.
        Text(timerInterval: countdownRange(to: Date(timeIntervalSince1970: end / 1000)), countsDown: true)
          .font(WidgetFonts.ui(language, 34, weight: .bold))
          .foregroundStyle(c("inkStrong"))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .multilineTextAlignment(.leading)
        caption(current.untilText ?? strings.leftToPray, color: c("accent"), language: language)
      } else if let current, let status = currentStatus, let next, next.at > nowMs {
        // Marked: the calm countdown to the next prayer's start, status kept in words (D190).
        calmTimer(to: next, from: date, size: 30, c: c, language: language)
          .multilineTextAlignment(.leading)
        caption(
          "\(captionFor(status: status, isCurrent: true, isFuture: false, strings: strings)) · \(next.untilStartText ?? next.name)",
          color: c("muted"),
          language: language
        )
      } else if let current, let status = currentStatus {
        Text(captionFor(status: status, isCurrent: true, isFuture: false, strings: strings))
          .font(WidgetFonts.ui(language, 26, weight: .semibold))
          .foregroundStyle(c("muted"))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      } else if subject.at > nowMs {
        // The sunrise→Dhuhr gap: the calm countdown to Dhuhr / Jumu'ah (D190).
        HStack(spacing: 9) {
          GlyphSun(color: c("soft"))
            .scaleEffect(1.4)
          calmTimer(to: subject, from: date, size: 28, c: c, language: language)
            .multilineTextAlignment(.leading)
        }
        caption(subject.untilStartText ?? subject.name, color: c("muted"), language: language)
      } else {
        HStack(spacing: 9) {
          GlyphSun(color: c("soft"))
            .scaleEffect(1.4)
          Text(day.sunriseText ?? subject.timeText)
            .font(WidgetFonts.ui(language, 28, weight: .semibold))
            .foregroundStyle(c("inkStrong"))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
        caption("\(strings.statusUpcoming) · \(subject.timeText)", color: c("accent"), language: language)
      }
    }
  }

  private func caption(_ text: String, color: Color, language: String) -> some View {
    Text(text)
      .font(WidgetFonts.ui(language, 14, italic: true))
      .foregroundStyle(color)
      .lineLimit(1)
      .minimumScaleFactor(0.75)
  }
}

// MARK: - Lockscreen accessories (times only)

struct AccessoryView: View {
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let family: WidgetFamily

  private var current: WidgetSnapshot.DayPrayer? {
    segment.current.flatMap { name in day.prayers.first { $0.prayer == name } }
  }

  private var next: WidgetSnapshot.DayPrayer? {
    guard let next = segment.next else { return nil }
    return snapshot.day(named: next.day)?.prayers.first { $0.prayer == next.prayer }
  }

  var body: some View {
    let language = snapshot.language
    let subject = current ?? next
    // The bundled fallback line, in the SYSTEM locale's words — and therefore in the SYSTEM
    // locale's face. Reading `.language` off the same table that gave us the sentence is the
    // whole fix: the text and the font can no longer come from two different answers to "which
    // language is this?" (D103, and see `BundledStrings.Table.language`).
    let bundled = BundledStrings.current()

    // A lockscreen is read in one glance, so the hierarchy answers the glance's own question
    // first: HOW LONG DO I HAVE — the ticking countdown is the biggest, boldest element. Which
    // prayer it belongs to is the quiet eyebrow above it; what comes after is the footnote.
    switch family {
    case .accessoryInline:
      if let current {
        Text("\(current.name) · \(current.dueCaption)")
      } else if let next {
        Text("\(next.name) \(next.timeText)")
      } else {
        Text(bundled.staleTitle)
      }

    case .accessoryCircular:
      ZStack {
        if let current, let end = current.windowEndAt {
          ProgressView(
            timerInterval: Date(timeIntervalSince1970: current.at / 1000)...Date(timeIntervalSince1970: end / 1000),
            countsDown: false
          ) { EmptyView() } currentValueLabel: { EmptyView() }
            .progressViewStyle(.circular)
        } else {
          Circle().strokeBorder(.tertiary, lineWidth: 4.5)
        }
        VStack(spacing: 0) {
          Text(subject?.name ?? "·")
            .font(WidgetFonts.ui(language, 13, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          if let subject {
            Text(subject.timeText)
              .font(WidgetFonts.ui(language, 10))
              .foregroundStyle(.secondary)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
        }
        .padding(6)
      }

    default: // .accessoryRectangular
      VStack(alignment: .leading, spacing: 0) {
        if let subject {
          HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(subject.name)
              .font(WidgetFonts.ui(language, 13, weight: .semibold))
              .lineLimit(1)
              .minimumScaleFactor(0.75)
            Text(subject.timeText)
              .font(WidgetFonts.ui(language, 12))
              .foregroundStyle(.secondary)
          }
          if let current, let end = current.windowEndAt {
            Text(timerInterval: countdownRange(to: Date(timeIntervalSince1970: end / 1000)), countsDown: true)
              .font(WidgetFonts.ui(language, 19, weight: .bold))
              .lineLimit(1)
              .minimumScaleFactor(0.7)
          } else if current == nil {
            Text(timerInterval: countdownRange(to: Date(timeIntervalSince1970: subject.at / 1000)), countsDown: true)
              .font(WidgetFonts.ui(language, 19, weight: .bold))
              .lineLimit(1)
              .minimumScaleFactor(0.7)
          }
          // Only when a CURRENT prayer holds the top line is `next` the following prayer.
          if current != nil, let after = next {
            Text("\(after.name) \(after.timeText)")
              .font(WidgetFonts.ui(language, 11))
              .foregroundStyle(.secondary)
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
        } else {
          Text(bundled.staleTitle)
            .font(WidgetFonts.ui(bundled.language, 13, weight: .semibold))
          Text(bundled.staleBody)
            .font(WidgetFonts.ui(bundled.language, 11))
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

struct AccessoryEmptyView: View {
  let stale: Bool
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let strings = BundledStrings.current()
    switch family {
    case .accessoryInline:
      Text(stale ? strings.staleTitle : strings.emptyTitle)
    case .accessoryCircular:
      ZStack {
        Circle().strokeBorder(.tertiary, lineWidth: 4.5)
        GlyphCrescent().fill(.secondary).frame(width: 20, height: 20)
      }
    default:
      VStack(alignment: .leading, spacing: 1) {
        Text(stale ? strings.staleTitle : strings.emptyTitle)
          .font(.system(size: 13, weight: .semibold))
        Text(stale ? strings.staleBody : strings.emptyBody)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// The calm countdown (D190): time until the next prayer STARTS, in muted ink — never the
/// deadline's strong ink, so the two can't be mistaken for each other. Hours and minutes only
/// (D198): static text, kept current by the timeline's minute entries (`Provider`).
func calmTimer(
  to prayer: WidgetSnapshot.DayPrayer,
  from date: Date,
  size: CGFloat,
  c: (String) -> Color,
  language: String
) -> some View {
  Text(calmClock(prayer.at - date.timeIntervalSince1970 * 1000, sample: prayer.timeText))
    .font(WidgetFonts.ui(language, size, weight: .semibold))
    .foregroundStyle(c("muted"))
    .lineLimit(1)
    .minimumScaleFactor(0.6)
}

/// Now, in the snapshot's epoch-ms units. Read at render: a timeline entry drawn after a
/// boundary must not start a countdown that has already ended.
var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

