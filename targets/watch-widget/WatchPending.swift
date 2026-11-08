import Foundation

/**
 The watch's own window onto the D92 pending-marks idea — the optimistic overlay that makes a
 seal flip under the finger while the mark itself travels to the phone at WCSession's pace.

 One entry per tap, one defaults key per entry (`watchMark:<id>`, the race-safe form), in the
 WATCH-side App Group so the complication extension sees the same flip. Every entry is ALSO
 handed to `PhoneSessionClient` for guaranteed transfer; on the phone it lands as a
 `widgetMark:<id>` queue entry and drains through `trackingStore.toggleStatus` like every other
 native mark. Nothing here interprets a mark (D92).

 The overlay rule is the contract's (`modules/prayer-widgets/contract/overlay-cases.json`):
 latest decision per (day, prayer) wins; `prayed` shows only over `unlogged`; a `clears` only
 over `prayed`. This is the same rule `PendingOverlay.swift` (widget extension), `PendingQueue.kt`
 and TypeScript hold — a fourth reader, held by the same review.

 Entries are garbage-collected when a newer envelope already AGREES with them (the drain ran and
 the truth came back) or when their day has fallen off the envelope's horizon. An entry the
 envelope still disagrees with is kept — the phone may simply not have been reachable yet, and
 dropping it would flip a seal back on someone who watched it fill.

 BYTE-FOR-BYTE TWIN of `targets/watch/WatchPending.swift`. Change one, change both.
 */
enum WatchPending {
  static let keyPrefix = "watchMark:"

  static let fieldId = "id"
  static let fieldDay = "day"
  static let fieldPrayer = "prayer"
  static let fieldDecidedAt = "decidedAt"
  static let fieldClears = "clears"

  static let prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"]

  /// Appends what a seal tap asserted and returns the mark for the session transfer.
  /// `clears` when the tap toggles OFF a shown `prayed`.
  @discardableResult
  static func appendTap(day: String, prayer: String, clears: Bool) -> [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    let id = "watch:\(prayer):\(Int64(now)):\(DispatchTime.now().uptimeNanoseconds)"
    var mark: [String: Any] = [
      fieldId: id,
      fieldDay: day,
      fieldPrayer: prayer,
      fieldDecidedAt: now,
    ]
    if clears { mark[fieldClears] = true }
    WatchAppGroup.defaults().set(mark, forKey: keyPrefix + id)
    return mark
  }

  /// A day's statuses with the local taps laid over them — the contract's `effective`.
  static func effectiveStatuses(day: String, base: [String: String]) -> [String: String] {
    struct Entry {
      let id: String
      let day: String
      let prayer: String
      let decidedAt: Double
      let clears: Bool
    }

    let defaults = WatchAppGroup.defaults()
    var entries: [Entry] = []
    for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix(keyPrefix) {
      guard
        let mark = value as? [String: Any],
        let id = mark[fieldId] as? String, !id.isEmpty,
        let entryDay = mark[fieldDay] as? String,
        let prayer = mark[fieldPrayer] as? String, prayers.contains(prayer),
        let decidedAt = (mark[fieldDecidedAt] as? NSNumber)?.doubleValue
      else { continue }
      var clears = false
      if let clearsValue = mark[fieldClears] {
        guard let clearsBool = clearsValue as? Bool else { continue }
        clears = clearsBool
      }
      entries.append(Entry(id: id, day: entryDay, prayer: prayer, decidedAt: decidedAt, clears: clears))
    }

    var latest: [String: Entry] = [:]
    for entry in entries.sorted(by: { ($0.decidedAt, $0.id) < ($1.decidedAt, $1.id) }) {
      guard entry.day == day else { continue }
      latest[entry.prayer] = entry
    }

    var result = base
    for (prayer, entry) in latest {
      if !entry.clears, result[prayer] == "unlogged" {
        result[prayer] = "prayed"
      } else if entry.clears, result[prayer] == "prayed" {
        result[prayer] = "unlogged"
      }
    }
    return result
  }

  /// Drops entries a NEWER envelope has caught up with. Called whenever one is applied.
  ///
  /// The "newer" guard is load-bearing (and the Kotlin twin `WearPendingMarks.gcAgainst` holds
  /// the same line): an envelope generated BEFORE a tap can agree with that tap by coincidence —
  /// mark, then undo, and a stale in-flight context delivery whose base is still `unlogged`
  /// "agrees" with the undo and would delete it, silently reviving the first tap. Dropping a
  /// decision the phone has not drained is the one failure this design forbids (D92).
  static func collect(against envelope: WatchEnvelope) {
    let defaults = WatchAppGroup.defaults()
    let firstDay = envelope.snapshot.days.first?.day
    let generatedAt = envelope.snapshot.generatedAt
    for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix(keyPrefix) {
      guard
        let mark = value as? [String: Any],
        let day = mark[fieldDay] as? String,
        let prayer = mark[fieldPrayer] as? String,
        let decidedAt = (mark[fieldDecidedAt] as? NSNumber)?.doubleValue
      else {
        defaults.removeObject(forKey: key)
        continue
      }
      let fellOffHorizon = firstDay.map { day < $0 } ?? false
      if fellOffHorizon {
        defaults.removeObject(forKey: key)
        continue
      }
      guard decidedAt <= generatedAt else { continue }
      let clears = (mark[fieldClears] as? Bool) == true
      let wanted = clears ? "unlogged" : "prayed"
      let envelopeStatus = envelope.snapshot.day(named: day)?
        .prayers.first { $0.prayer == prayer }?.status
      if envelopeStatus == wanted {
        defaults.removeObject(forKey: key)
      }
    }
  }
}
