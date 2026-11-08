import Foundation

/**
 The extension's window onto the D92 pending-marks queue — reader AND (for the seal tap) writer.

 Storage is the App Group `UserDefaults` the app's `PendingMarks.swift` owns: the app appends
 notification presses to the `pendingMarks` array; THIS process appends taps as per-key entries
 (`widgetMark:<id>`) because a cross-process read-modify-write of the array could race a drain
 and lose a mark, while a single-key `set` cannot. The app reads and acknowledges both.

 The overlay itself is the one piece of domain logic duplicated here, BY CONTRACT:
 `modules/prayer-widgets/contract/overlay-cases.json` pins every case; the TypeScript twin is
 held to it by Jest, the Kotlin twin by review, this file by the same review. The rule stays one
 sentence: latest decision per (day, prayer) wins; `prayed` shows only over `unlogged`; an
 undo/`clears` only over `prayed`. A tap never writes the log — the app drains through
 `trackingStore.toggleStatus` on its next open.
 */
enum PendingOverlay {
  static let arrayKey = "pendingMarks"
  static let widgetMarkPrefix = "widgetMark:"

  static let fieldId = "id"
  static let fieldDay = "day"
  static let fieldPrayer = "prayer"
  static let fieldDecidedAt = "decidedAt"
  static let fieldAnnuls = "annuls"
  static let fieldClears = "clears"
  static let fieldConfirmationId = "confirmationId"

  static let prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"]

  private struct Entry {
    let id: String
    let day: String?
    let prayer: String
    let decidedAt: Double
    let undoes: Bool
    let annuls: String?
  }

  /// Appends what a seal tap asserted. `clears` when the tap toggles OFF a shown `prayed`.
  static func appendTap(day: String, prayer: String, clears: Bool) {
    let now = Date().timeIntervalSince1970 * 1000
    // The nanosecond suffix uniquifies two taps in the same millisecond; ids must never collide.
    let id = "widget:\(prayer):\(Int64(now)):\(DispatchTime.now().uptimeNanoseconds)"
    var mark: [String: Any] = [
      fieldId: id,
      fieldDay: day,
      fieldPrayer: prayer,
      fieldDecidedAt: now,
    ]
    if clears { mark[fieldClears] = true }
    AppGroup.defaults().set(mark, forKey: widgetMarkPrefix + id)
  }

  /**
   A day's statuses with the undrained queue laid over them — the contract's `effective`.

   Validation is STRICT and field-typed, mirroring TypeScript's `isPendingMark` exactly: an entry
   with any present-but-mistyped field is unreadable EVERYWHERE, so a widget can never paint a
   mark the drain will then throw away. Annul pairs match across ALL entries, whatever day either
   carries, and an annuller whose target has no day is held back — as `resolvePendingMarks` does.
   */
  static func effectiveStatuses(day: String, base: [String: String]) -> [String: String] {
    let defaults = AppGroup.defaults()
    var entries: [Entry] = []

    var raw: [[String: Any]] = defaults.array(forKey: arrayKey) as? [[String: Any]] ?? []
    for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix(widgetMarkPrefix) {
      if let mark = value as? [String: Any] {
        raw.append(mark)
      }
    }

    for mark in raw {
      guard
        let id = mark[fieldId] as? String, !id.isEmpty,
        let prayer = mark[fieldPrayer] as? String, prayers.contains(prayer),
        let decidedAt = (mark[fieldDecidedAt] as? NSNumber)?.doubleValue
      else {
        continue
      }
      var entryDay: String?
      if let dayValue = mark[fieldDay], !(dayValue is NSNull) {
        guard let dayString = dayValue as? String, isDayShaped(dayString) else { continue }
        entryDay = dayString
      }
      var annuls: String?
      if let annulsValue = mark[fieldAnnuls], !(annulsValue is NSNull) {
        guard let annulsString = annulsValue as? String else { continue }
        annuls = annulsString
      }
      var clears = false
      if let clearsValue = mark[fieldClears], !(clearsValue is NSNull) {
        guard let clearsBool = clearsValue as? Bool else { continue }
        clears = clearsBool
      }
      if let confirmation = mark[fieldConfirmationId], !(confirmation is NSNull), !(confirmation is String) {
        continue
      }
      entries.append(Entry(id: id, day: entryDay, prayer: prayer, decidedAt: decidedAt, undoes: annuls != nil || clears, annuls: annuls))
    }

    // Undatable entries (no day) are the drain's to hold, never rendered; an annuller pointing
    // at one is held with it. Pairs cancel GLOBALLY, then the rendered day resolves latest-wins.
    let undatable = Set(entries.filter { $0.day == nil }.map(\.id))
    let present = Set(entries.filter { $0.day != nil }.map(\.id))
    var annulled = Set<String>()
    var held = Set<String>()
    for entry in entries {
      guard let target = entry.annuls else { continue }
      if undatable.contains(target) {
        held.insert(entry.id)
      } else if present.contains(target) {
        annulled.insert(target)
        annulled.insert(entry.id)
      }
    }

    var latest: [String: Entry] = [:]
    for entry in entries.sorted(by: { ($0.decidedAt, $0.id) < ($1.decidedAt, $1.id) }) {
      if entry.day != day || annulled.contains(entry.id) || held.contains(entry.id) { continue }
      latest[entry.prayer] = entry
    }

    var result = base
    for (prayer, entry) in latest {
      if !entry.undoes, result[prayer] == "unlogged" {
        result[prayer] = "prayed"
      } else if entry.undoes, result[prayer] == "prayed" {
        result[prayer] = "unlogged"
      }
    }
    return result
  }

  /// Enough of `domain/dates.isValidDay` to reject garbage: `YYYY-MM-DD`, digits only.
  private static func isDayShaped(_ value: String) -> Bool {
    guard value.count == 10 else { return false }
    for (index, character) in value.enumerated() {
      if index == 4 || index == 7 {
        if character != "-" { return false }
      } else if !character.isNumber {
        return false
      }
    }
    return true
  }
}
