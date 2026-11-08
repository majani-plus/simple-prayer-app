import SwiftUI
import WidgetKit

/**
 The watch complications (V0a, canvas `Complications.dc.html`): the accessory families plus the
 corner, on every face the system offers slots for, and the same rectangular view in the Smart
 Stack. One timeline entry per precomputed segment boundary — flipping "current" costs no budget
 (`targets/widget/Provider.swift`'s reasoning, twinned at watch scale).

 The rectangular carries the day's seals as a quiet micro-row — the wrist may carry seals, an
 owner decision (D101 stays untouched for phone lockscreens); circular, corner and inline stay
 times-only purely for space. Some faces tint complications monochrome: shape and words carry
 everything, gold shows where the face allows it. In always-on (luminance-reduced) the micro-row
 hides and the secondary text steps back. Tapping any complication opens the watch app.
 */
@main
struct SimplePrayerWatchWidgets: WidgetBundle {
  var body: some Widget {
    NowComplication()
    QiblaComplication()
  }
}

struct NowComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SPWatchNow", provider: WatchTimelineProvider()) { entry in
      ComplicationView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Simple Prayer")
    .description(WatchBundledStrings.current().emptyTitle)
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
  }
}

// MARK: - Timeline

struct WatchTimelineProvider: TimelineProvider {
  struct Entry: TimelineEntry {
    let date: Date

    enum Content {
      case empty(stale: Bool)
      case day(
        snapshot: WidgetSnapshot,
        day: WidgetSnapshot.Day,
        segment: WidgetSnapshot.Segment,
        effective: [String: String]
      )
    }

    let content: Content
    var relevance: TimelineEntryRelevance?
  }

  private static let horizonMs: Double = 36 * 60 * 60 * 1000

  func placeholder(in context: Context) -> Entry {
    entry(at: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(entry(at: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let now = Date()
    let nowMs = now.timeIntervalSince1970 * 1000

    guard let envelope = WatchEnvelope.load(), !envelope.snapshot.isExpired(at: nowMs) else {
      let stale = WatchEnvelope.exists()
      let retry = now.addingTimeInterval(60 * 60)
      completion(
        Timeline(entries: [Entry(date: now, content: .empty(stale: stale), relevance: nil)], policy: .after(retry))
      )
      return
    }

    let snapshot = envelope.snapshot
    var entries: [Entry] = []
    let end = min(nowMs + Self.horizonMs, snapshot.expiresAt)
    for segment in snapshot.segments where segment.to > nowMs && segment.from < end {
      let at = max(segment.from, nowMs)
      guard let day = snapshot.day(named: segment.day) else { continue }
      var base: [String: String] = [:]
      for prayer in day.prayers {
        base[prayer.prayer] = prayer.status
      }
      let effective = WatchPending.effectiveStatuses(day: segment.day, base: base)
      entries.append(
        Entry(
          date: Date(timeIntervalSince1970: at / 1000),
          content: .day(snapshot: snapshot, day: day, segment: segment, effective: effective),
          // The Smart Stack surfaces this widget while a window is open — the moment the glance
          // matters — and lets it sink between prayers.
          relevance: TimelineEntryRelevance(score: segment.current != nil ? 80 : 10)
        )
      )
    }

    if entries.isEmpty {
      entries.append(Entry(date: now, content: .empty(stale: true), relevance: nil))
    }
    completion(Timeline(entries: entries, policy: .after(Date(timeIntervalSince1970: end / 1000))))
  }

  private func entry(at now: Date) -> Entry {
    let nowMs = now.timeIntervalSince1970 * 1000
    guard
      let envelope = WatchEnvelope.load(),
      !envelope.snapshot.isExpired(at: nowMs),
      let segment = envelope.snapshot.segment(at: nowMs),
      let day = envelope.snapshot.day(named: segment.day)
    else {
      return Entry(date: now, content: .empty(stale: WatchEnvelope.exists()), relevance: nil)
    }
    var base: [String: String] = [:]
    for prayer in day.prayers {
      base[prayer.prayer] = prayer.status
    }
    let effective = WatchPending.effectiveStatuses(day: segment.day, base: base)
    return Entry(date: now, content: .day(snapshot: envelope.snapshot, day: day, segment: segment, effective: effective), relevance: nil)
  }
}

// MARK: - Views

struct ComplicationView: View {
  let entry: WatchTimelineProvider.Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch entry.content {
    case .empty(let stale):
      EmptyComplicationView(stale: stale)
    case .day(let snapshot, let day, let segment, let effective):
      FamilyView(snapshot: snapshot, day: day, segment: segment, effective: effective, family: family)
        .environment(\.layoutDirection, snapshot.rtl ? .rightToLeft : .leftToRight)
    }
  }
}

private struct FamilyView: View {
  let snapshot: WidgetSnapshot
  let day: WidgetSnapshot.Day
  let segment: WidgetSnapshot.Segment
  let effective: [String: String]
  let family: WidgetFamily
  @Environment(\.isLuminanceReduced) private var dimmed

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
    // language is this?" (D103, and see `WatchBundledStrings.Table.language`).
    let bundled = WatchBundledStrings.current()

    switch family {
    case .accessoryInline:
      // One honest line — exactly the phone lockscreen's.
      if let current {
        Text("\(current.name) · \(current.dueCaption)")
      } else if let next {
        Text("\(next.name) \(next.timeText)")
      } else {
        Text(bundled.staleTitle)
      }

    case .accessoryCorner:
      // Fifth cut (owner, 2026-08-28): the NAME takes the corner itself — large, curved into
      // the bend — and the bezel carries the window gauge with the closing time as its word.
      // The coin ornament is gone: the name is the fact a face needs, the bar is the clock,
      // and the seal's state lives in the families with room for it.
      Text(subject?.name ?? "·")
        .font(WidgetFonts.ui(language, 15, weight: .semibold))
        .foregroundStyle(WidgetPalette.color("accent", night: true))
        .widgetCurvesContent()
        .widgetLabel {
          if let current, let end = current.windowEndAt,
             (effective[current.prayer] ?? current.status) == "unlogged", !day.isExempt {
            ProgressView(
              timerInterval: Date(timeIntervalSince1970: current.at / 1000)...Date(timeIntervalSince1970: end / 1000),
              countsDown: false
            ) {
              // A live countdown, minutes-deep (owner, 2026-08-28: no static time, no seconds
              // — and the words inside the curve are what keep the bar from hogging it). The
              // trailing no-break spaces are the breathing room between the digits and the bar.
              Text(Date(timeIntervalSince1970: end / 1000), style: .relative) + Text("\u{00A0}\u{00A0}")
            } currentValueLabel: { EmptyView() }
          } else if let subject {
            Text(subject.timeText)
          }
        }

    case .accessoryCircular:
      // The window gauge: it fills as the window passes; it counts nothing against anyone.
      ZStack {
        if let current, let end = current.windowEndAt {
          ProgressView(
            timerInterval: Date(timeIntervalSince1970: current.at / 1000)...Date(timeIntervalSince1970: end / 1000),
            countsDown: false
          ) { EmptyView() } currentValueLabel: { EmptyView() }
            .progressViewStyle(.circular)
        } else {
          Circle().strokeBorder(.tertiary, lineWidth: 4)
        }
        VStack(spacing: 0) {
          Text(subject?.name ?? "·")
            .font(WidgetFonts.ui(language, 12, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          if let subject {
            Text(subject.timeText)
              .font(WidgetFonts.ui(language, 9))
              .foregroundStyle(.secondary)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
        }
        .padding(5)
      }

    default: // .accessoryRectangular — also the Smart Stack card
      VStack(alignment: .leading, spacing: 0) {
        if let subject {
          HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(subject.name)
              .font(WidgetFonts.ui(language, 13, weight: .semibold))
              .lineLimit(1)
            Text(subject.timeText)
              .font(WidgetFonts.ui(language, 11))
              .foregroundStyle(.secondary)
          }
          // Minutes-deep, in the accent gold (owner, 2026-08-28: no ticking seconds — a
          // Smart Stack card is a glance, not a stopwatch).
          if let current, let end = current.windowEndAt {
            Text(Date(timeIntervalSince1970: end / 1000), style: .relative)
              .font(WidgetFonts.ui(language, 17, weight: .bold))
              .foregroundStyle(WidgetPalette.color("accent", night: true))
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          } else if current == nil {
            Text(Date(timeIntervalSince1970: subject.at / 1000), style: .relative)
              .font(WidgetFonts.ui(language, 17, weight: .bold))
              .foregroundStyle(WidgetPalette.color("accent", night: true))
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
          if !dimmed {
            // The seal micro-row — the day at a glance, ornament to a non-tracker. Hidden in
            // always-on: the fewer lit pixels, the better the face behaves.
            HStack(spacing: 5) {
              ForEach(day.prayers, id: \.prayer) { prayer in
                SealView(
                  skin: SealView.skin(
                    status: effective[prayer.prayer] ?? prayer.status,
                    isCurrent: segment.current == prayer.prayer,
                    isFuture: prayer.at > segment.from
                  ),
                  size: 11,
                  night: true
                )
              }
            }
            .padding(.top, 2)
          }
        } else {
          Text(bundled.staleTitle)
            .font(WidgetFonts.ui(bundled.language, 13, weight: .semibold))
          Text(bundled.staleBody)
            .font(WidgetFonts.ui(bundled.language, 10.5))
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct EmptyComplicationView: View {
  let stale: Bool
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let strings = WatchBundledStrings.current()
    switch family {
    case .accessoryInline:
      Text(stale ? strings.staleTitle : strings.emptyTitle)
    case .accessoryCircular:
      ZStack {
        Circle().strokeBorder(.tertiary, lineWidth: 4)
        GlyphCrescent().fill(.secondary).frame(width: 18, height: 18)
      }
    case .accessoryCorner:
      Text("·")
        .widgetCurvesContent()
        .widgetLabel { Text(stale ? strings.staleTitle : strings.emptyTitle) }
    default:
      VStack(alignment: .leading, spacing: 1) {
        Text(stale ? strings.staleTitle : strings.emptyTitle)
          .font(.system(size: 13, weight: .semibold))
        Text(stale ? strings.staleBody : strings.emptyBody)
          .font(.system(size: 10.5))
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}


// MARK: - The qibla complication (owner, 2026-08-28)

/**
 A second, quieter complication: WHERE the qibla lies. A complication has no compass — widget
 processes read no sensors — so this is a MAP, not a needle: north up, the Makkah badge at the
 precomputed bearing, the cardinal letters from the envelope. Honest and still useful: it is the
 same picture the app's dial shows before a heading arrives. Tapping opens the watch app, one
 swipe from the live compass.
 */
struct QiblaComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SPWatchQibla", provider: WatchTimelineProvider()) { entry in
      QiblaComplicationView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Qibla")
    .description(WatchBundledStrings.current().emptyTitle)
    .supportedFamilies([.accessoryCircular, .accessoryCorner])
  }
}

private struct QiblaComplicationView: View {
  @Environment(\.widgetFamily) private var family
  let entry: WatchTimelineProvider.Entry

  var body: some View {
    let qibla = WatchEnvelope.load()?.qibla
    switch family {
    case .accessoryCorner:
      QiblaMap(qibla: qibla, diameter: 30)
        .widgetLabel {
          Text(qibla?.titleLabel ?? WatchBundledStrings.current().emptyTitle)
        }
    default:
      ZStack {
        AccessoryWidgetBackground()
        QiblaMap(qibla: qibla, diameter: 44)
      }
    }
  }
}

/// The north-up map: ring, the envelope's cardinal letters, the Makkah badge at the bearing.
private struct QiblaMap: View {
  let qibla: WatchEnvelope.Qibla?
  let diameter: CGFloat

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: true) }
    ZStack {
      Circle()
        .strokeBorder(c("borderMid"), lineWidth: 1)
      if let qibla {
        if let north = qibla.north, !north.isEmpty {
          Text(north)
            .font(.system(size: diameter * 0.22, weight: .medium))
            .foregroundStyle(c("soft"))
            .offset(y: -diameter * 0.30)
        }
        ZStack {
          Circle().fill(c("accent"))
          MosqueMark(color: c("sealFg"), size: diameter * 0.28)
        }
        .frame(width: diameter * 0.42, height: diameter * 0.42)
        .offset(y: -diameter * 0.31)
        .rotationEffect(.degrees(qibla.bearing))
      } else {
        Circle().fill(c("soft")).frame(width: 3, height: 3)
      }
    }
    .frame(width: diameter, height: diameter)
  }
}
