import AppIntents
import WidgetKit

/**
 The seal tap (D26) — runs in THIS extension's process, never opening or waking the app.

 It does exactly what the notification's Prayed button does (D92): reads the tapped prayer's
 EFFECTIVE status, asserts the toggle into the queue (`unlogged` → prayed, `prayed` → clears),
 refuses everything else — `late`, `missed` and `exempt` are deliberate marks and rest states
 the in-app seal will not overwrite with a single tap either (D58/D64) — and asks WidgetKit to
 redraw so the seal answers under the finger. The log itself is written by the app on its next
 open, through the same drain as every other mark.

 The buddies, though, are told from here (D180): waiting for the app to be opened is the one thing
 somebody who marks from the homescreen never does.
 */
struct MarkPrayedIntent: AppIntent {
  static let title: LocalizedStringResource = "Mark prayed"
  // Never bounce to the app; the whole point is staying on the homescreen.
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
    guard
      let snapshot = WidgetSnapshot.load(),
      let dayData = snapshot.day(named: day),
      !dayData.isExempt
    else {
      return .result()
    }

    // A prayer whose time has not come cannot be marked (owner rule, 2026-08-25). The views
    // never offer the button, but a stale timeline entry might still deliver a press.
    if let tapped = dayData.prayers.first(where: { $0.prayer == prayer }),
       tapped.at > Date().timeIntervalSince1970 * 1000 {
      return .result()
    }

    var base: [String: String] = [:]
    for entry in dayData.prayers {
      base[entry.prayer] = entry.status
    }
    let effective = PendingOverlay.effectiveStatuses(day: day, base: base)

    let clears: Bool
    switch effective[prayer] {
    case "unlogged":
      clears = false
    case "prayed":
      clears = true
    default:
      return .result()
    }
    PendingOverlay.appendTap(day: day, prayer: prayer, clears: clears)

    WidgetCenter.shared.reloadAllTimelines()
    // Last, and never in the way: the seal has already answered under the finger, and the buddies
    // are told from here rather than waiting for the app to be opened (D180). Everything about it
    // is silent and bounded — see `BuddySender`.
    await BuddySender.send(day: day, prayer: prayer, state: clears ? "cleared" : "prayed")
    return .result()
  }
}
