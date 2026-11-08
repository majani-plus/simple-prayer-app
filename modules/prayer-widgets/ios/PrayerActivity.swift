import ActivityKit
import Foundation

/**
 The Live Activity's shape and lifecycle — the APP-side half (D27, D112).

 ## The one design fact everything follows from

 This app ships NO push entitlement (D49) and never will, so a Live Activity can neither be
 started nor pushed new content in the background. What remains is still worth having: when the
 app is foregrounded around a prayer's moment, it posts one card whose countdown is a native
 timer (ticks with no updates). Two faces share the card (D112):

 - **due** — the open window's countdown, kept for the user-set linger after the prayer came in;
 - **upcoming** — a lead card for the approaching prayer while the current one is still
   unprayed. Its `staleDate` is the subject's start: when it passes, the system re-renders the
   card (`isStale`) and the views draw the subject's due face — the one transition that needs
   no process at all.

 The card stays ACTIVE — ending it at birth would remove it from the Dynamic Island immediately
 (dismissal policies govern only the Lock Screen), and `.after(...)` is capped at ~4 hours,
 shorter than an Isha window. `staleDate` dims it when its face stops being a live question; the
 next reconcile (`services/liveActivity.ts`, every foreground) ends whatever no longer matches
 the world, and the system's own ceiling removes anything a user never returns for. The seal's
 tap (`MarkPrayedActivityIntent`, running in THIS process) is the one in-flight change: it flips
 the state to "prayed" and retires the card itself.

 ## The type is duplicated, deliberately

 `targets/widget/PrayerActivityAttributes.swift` carries a byte-identical copy: ActivityKit
 matches app and extension by the attributes TYPE NAME and Codable shape, and the extension
 cannot import this pod. Change one, change both — the comment there says the same.
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

enum PrayerActivityController {
  /**
   Ends whatever prayer Activities exist, then posts one for the given payload — active, with
   the face's own `staleAt` as its stale date. See the header for why it is NOT pre-finalized.
   */
  @available(iOS 16.2, *)
  static func start(_ attributes: PrayerActivityAttributes, status: String) async {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    await endAll()
    let state = PrayerActivityAttributes.ContentState(status: status)
    let stale = Date(timeIntervalSince1970: attributes.staleAt / 1000)
    let end = Date(timeIntervalSince1970: attributes.endAt / 1000)
    guard end > Date() else { return }
    _ = try? Activity.request(
      attributes: attributes,
      content: ActivityContent(state: state, staleDate: stale)
    )
  }

  @available(iOS 16.2, *)
  static func endAll() async {
    for activity in Activity<PrayerActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
