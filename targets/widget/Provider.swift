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
    completion(Timeline(entries: entries, policy: .after(nextBoundary)))
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
