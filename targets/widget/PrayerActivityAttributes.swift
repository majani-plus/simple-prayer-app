import ActivityKit
import Foundation

/**
 BYTE-FOR-BYTE TWIN of the struct in `modules/prayer-widgets/ios/PrayerActivity.swift` — the
 extension cannot import that pod, and ActivityKit matches app and extension by the attributes
 type name and Codable shape. Change one, change both, in the same commit.
 */
struct PrayerActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// The face: "due" or "upcoming" at birth; "prayed" set by the seal's intent on the way out.
    var status: String
  }

  /// Everything below is pre-rendered by the app (translated, formatted, numeral-correct).
  /// The window and texts describe the card's SUBJECT — the current prayer on the due face, the
  /// approaching one on the lead face. `markDay`/`markPrayer` are what the LEAD face's seal
  /// asserts (the current prayer); the due face's seal asserts the subject itself.
  var day: String
  var prayer: String
  var name: String
  var arabicName: String?
  var timeText: String
  var untilText: String
  var leftToPray: String
  var startAt: Double
  var endAt: Double
  var staleAt: Double
  var startsCaption: String?
  var untilStartLabel: String?
  var stillToPray: String?
  var markDay: String
  var markPrayer: String
  var prayedLabel: String
  var markedText: String
  var language: String
  var rtl: Bool
  var theme: String
}
