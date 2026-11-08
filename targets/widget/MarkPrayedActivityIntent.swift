import ActivityKit
import AppIntents
import Foundation
import WidgetKit
// The app's copy of the sender lives in the bridge pod; the extension has its own `BuddySender`
// compiled in beside this file, so the same call reaches whichever one this process has (D194).
#if canImport(BuddyNicknames)
import BuddyNicknames
#endif

/**
 The Live Activity's seal tap (D112) — a `LiveActivityIntent`, which the system runs in the
 APP's process: the only process that may update or end this app's Activities (no push, D49).

 BYTE-FOR-BYTE TWIN: `modules/prayer-widgets/ios/MarkPrayedActivityIntent.swift` and
 `targets/widget/MarkPrayedActivityIntent.swift`. AppIntents matches the button in the extension
 to the handler in the app by the intent's type name and shape, exactly like the attributes
 struct. Change one, change both, in the same commit.

 It does what the homescreen widgets' seal does (D26/D92): asserts "prayed" into the
 pending-marks queue — the race-safe per-key form (`widgetMark:<id>`), never the shared array —
 and the app writes the log on its next open, through the same drain as every other mark; the
 drain refuses an invalid transition, so a stale press records nothing. Then it answers under
 the finger: every prayer card flips to its marked face and retires two minutes later. Should
 the press ever run in the extension's process instead (no Activities visible there), the mark
 still lands; only the flip waits for the next foreground — degraded, never wrong.
 */
@available(iOS 17.0, *)
struct MarkPrayedActivityIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Mark prayed"
  // Never bounce to the app; the whole point is answering on the lock screen.
  static let openAppWhenRun: Bool = false

  @Parameter(title: "Day")
  var day: String

  @Parameter(title: "Prayer")
  var prayer: String

  init() {}

  init(day: String, prayer: String) {
    self.day = day
    self.prayer = prayer
  }

  func perform() async throws -> some IntentResult {
    let allowed = ["fajr", "dhuhr", "asr", "maghrib", "isha"]
    guard !day.isEmpty, allowed.contains(prayer) else { return .result() }

    let now = Date().timeIntervalSince1970 * 1000
    // The nanosecond suffix uniquifies two taps in the same millisecond; ids must never collide.
    let id = "widget:\(prayer):\(Int64(now)):\(DispatchTime.now().uptimeNanoseconds)"
    let mark: [String: Any] = ["id": id, "day": day, "prayer": prayer, "decidedAt": now]
    sharedDefaults().set(mark, forKey: "widgetMark:" + id)

    for activity in Activity<PrayerActivityAttributes>.activities {
      let state = PrayerActivityAttributes.ContentState(status: "prayed")
      await activity.end(
        ActivityContent(state: state, staleDate: nil),
        dismissalPolicy: .after(Date().addingTimeInterval(120))
      )
    }

    WidgetCenter.shared.reloadAllTimelines()
    // Last, and never in the way: the card has already flipped. The buddies are told from here
    // rather than on the app's next sync (D194), silently and within eight seconds — see
    // `BuddySender`. What does not go stays outstanding for the app.
    await BuddySender.send(day: day, prayer: prayer, state: "prayed")
    return .result()
  }

  /// The App Group the D92 queue lives in, resolved the way each process can: the bundle's
  /// `SPAppGroupIdentifier` (the app has the Info.plist key), else derived from the bundle id
  /// (the extension's is `<app>.widget`, so the group is `group.<app>`).
  private func sharedDefaults() -> UserDefaults {
    if let fromPlist = Bundle.main.object(forInfoDictionaryKey: "SPAppGroupIdentifier") as? String,
       let suite = UserDefaults(suiteName: fromPlist) {
      return suite
    }
    if let bundle = Bundle.main.bundleIdentifier {
      let appBundle = bundle.hasSuffix(".widget") ? String(bundle.dropLast(".widget".count)) : bundle
      if let suite = UserDefaults(suiteName: "group.\(appBundle)") {
        return suite
      }
    }
    return UserDefaults.standard
  }
}
