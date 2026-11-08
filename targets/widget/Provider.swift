import WidgetKit

/**
 One timeline provider for both widgets: an entry per precomputed segment boundary, so "current
 prayer" flips at the exact minute with no refresh budget spent and no app awake — displaying
 successive entries of a delivered timeline is free; only building a new one costs.

 The queue overlay is applied when the timeline is BUILT: a tap's `AppIntent` appends and asks
 for a reload, so the seal repaints in the same gesture. Between reloads the queue cannot change
 (only taps and the app write it, and both reload).
 */
struct PrayerTimelineProvider: TimelineProvider {
  struct Entry: TimelineEntry {
    let date: Date

    enum Content {
      /// No snapshot at all (first install) or one past its horizon (`stale`).
      case empty(stale: Bool)
      case day(
        snapshot: WidgetSnapshot,
        day: WidgetSnapshot.Day,
        segment: WidgetSnapshot.Segment,
        effective: [String: String]
      )
    }

    let content: Content
  }

  /// The Now widget's calm countdown is H:MM text, not a ticking timer (D198), so its timeline
  /// also carries an entry per minute while one shows. Off for the Schedule widget.
  var minuteEntries = false

  /// ponytail: at most two hours of minute entries per build; the timeline reloads at the last
  /// one, so a long calm stretch (Isha → Fajr) costs one reload every two hours.
  private static let maxMinuteEntries = 120

  /// How far ahead one timeline reaches. WidgetKit re-asks at `.after(...)`; ~36 hours is a
  /// handful of entries and always spans at least one full prayer day.
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

    guard let snapshot = WidgetSnapshot.load(), !snapshot.isExpired(at: nowMs) else {
      let stale = WidgetSnapshot.load() != nil
      // Ask again in an hour: the app may have written a fresh snapshot by then, and an empty
      // widget re-checking hourly costs nearly nothing against the daily budget.
      let retry = now.addingTimeInterval(60 * 60)
      completion(Timeline(entries: [Entry(date: now, content: .empty(stale: stale))], policy: .after(retry)))
      return
    }

    var entries: [Entry] = []
    let end = min(nowMs + Self.horizonMs, snapshot.expiresAt)
    for segment in snapshot.segments where segment.to > nowMs && segment.from < end {
      let at = max(segment.from, nowMs)
      guard let day = snapshot.day(named: segment.day) else { continue }
      var base: [String: String] = [:]
      for prayer in day.prayers {
        base[prayer.prayer] = prayer.status
      }
      let effective = PendingOverlay.effectiveStatuses(day: segment.day, base: base)
      entries.append(
        Entry(
          date: Date(timeIntervalSince1970: at / 1000),
          content: .day(snapshot: snapshot, day: day, segment: segment, effective: effective)
        )
      )
    }

    if entries.isEmpty {
      entries.append(Entry(date: now, content: .empty(stale: true)))
    }
    // Reload at the NEXT boundary, not at the horizon: the entries already cover every boundary,
    // but a fresh build there re-reads the pending-tap overlay and any snapshot the app wrote
    // meanwhile (D189). Seven reloads a day sits far inside WidgetKit's budget.
    let nextBoundary = entries.count > 1 ? entries[1].date : Date(timeIntervalSince1970: end / 1000)
    var reloadAt = nextBoundary
    if minuteEntries, case .day(let snap, let day, let segment, let effective) = entries[0].content,
      let target = calmTarget(snapshot: snap, day: day, segment: segment, effective: effective, atMs: nowMs) {
      // One entry each time the shown minute changes (the text rounds up, so at whole minutes
      // before the target), up to the segment's end, where the next boundary entry takes over.
      let stop = min(target, segment.to)
      var minutes: [Entry] = []
      var k = ((target - nowMs) / 60_000).rounded(.up) - 1
      while k >= 1, minutes.count < Self.maxMinuteEntries {
        let at = target - k * 60_000
        if at >= stop { break }
        minutes.append(Entry(date: Date(timeIntervalSince1970: at / 1000), content: entries[0].content))
        k -= 1
      }
      entries.insert(contentsOf: minutes, at: 1)
      if minutes.count == Self.maxMinuteEntries, let last = minutes.last {
        reloadAt = min(reloadAt, last.date)
      }
    }
    completion(Timeline(entries: entries, policy: .after(reloadAt)))
  }

  private func entry(at now: Date) -> Entry {
    let nowMs = now.timeIntervalSince1970 * 1000
    guard
      let snapshot = WidgetSnapshot.load(),
      !snapshot.isExpired(at: nowMs),
      let segment = snapshot.segment(at: nowMs),
      let day = snapshot.day(named: segment.day)
    else {
      return Entry(date: now, content: .empty(stale: WidgetSnapshot.load() != nil))
    }
    var base: [String: String] = [:]
    for prayer in day.prayers {
      base[prayer.prayer] = prayer.status
    }
    let effective = PendingOverlay.effectiveStatuses(day: segment.day, base: base)
    return Entry(date: now, content: .day(snapshot: snapshot, day: day, segment: segment, effective: effective))
  }
}

/// The range a countdown `Text(timerInterval:)` runs over, clamped so it can never be built
/// backwards. `Date()...end` traps when a view renders after `end` — a timeline entry drawn late,
/// or a snapshot read across a boundary — and a trapped widget extension draws nothing (D189).
func countdownRange(to end: Date) -> ClosedRange<Date> {
  min(Date(), end)...end
}

/// The calm countdown's target (D190/D198) — the next prayer's start when the current prayer is
/// marked, Dhuhr / Jumu'ah in the sunrise gap — or nil when the Now widget shows anything else.
/// Mirrors the branches of `NowSmallView.centerBlock` and `NowStripView.hero`.
func calmTarget(
  snapshot: WidgetSnapshot,
  day: WidgetSnapshot.Day,
  segment: WidgetSnapshot.Segment,
  effective: [String: String],
  atMs: Double
) -> Double? {
  if day.isExempt { return nil }
  guard let n = segment.next, let next = snapshot.day(named: n.day)?.prayers.first(where: { $0.prayer == n.prayer })
  else { return nil }
  if let name = segment.current, let current = day.prayers.first(where: { $0.prayer == name }) {
    let status = effective[current.prayer] ?? current.status
    if status == "unlogged" && current.windowEndAt != nil { return nil }
  }
  return next.at > atMs ? next.at : nil
}

/// The calm countdown as "H:MM" — minutes rounded UP, so the last minute reads 0:01, never 0:00
/// while there is still time. Digits follow the app's own choice (D40) as the snapshot already
/// applied it to `sample` (a pre-formatted time): Arabic-Indic there, Arabic-Indic here.
func calmClock(_ remainingMs: Double, sample: String) -> String {
  let minutes = Int((max(remainingMs, 0) / 60_000).rounded(.up))
  let text = "\(minutes / 60):\(minutes % 60 < 10 ? "0" : "")\(minutes % 60)"
  guard sample.unicodeScalars.contains(where: { (0x660...0x669).contains($0.value) }) else { return text }
  let scalars = text.unicodeScalars.map { s in
    (0x30...0x39).contains(s.value) ? Unicode.Scalar(s.value - 0x30 + 0x660)! : s
  }
  return String(String.UnicodeScalarView(scalars))
}
