import BuddyNicknames
import ExpoNotifications
import Foundation
import UIKit
import UserNotifications

/**
 What runs when **Prayed** (or **Undo**) is pressed on iOS.

 ## Where this runs, and why there is no extension

 iOS launches the app into the background to deliver a response to a non-foreground action, even
 from a force-quit state, so the handler belongs in the app. There is no extension point for
 notification *actions* the way there is for content — `UNNotificationServiceExtension` only sees
 remote notifications on their way in — so this is the only place it can be.

 It is still native, and still independent of JavaScript. That matters: the React runtime may or
 may not finish starting in a background launch, and a mark that depends on it would be lost
 exactly when the app was most asleep.

 ## Why a delegate of expo's rather than our own

 `UNUserNotificationCenter` has one delegate, and `expo-notifications` claims it —
 `NotificationCenterManager` warns loudly and gives up if something else got there first. It also
 offers `addDelegate`, which is that seam done properly, so this registers there instead of
 fighting for the slot.

 `didReceive` returns `true` only for our two actions. That is what stops the response being kept
 as "pending" and replayed into JavaScript later, which would route the app to Today for a button
 press that was never meant to open anything. Everything else — a plain tap especially — returns
 `false` and travels its normal path untouched.

 ## What it does, and everything it refuses to do

 Appends one queue entry, clears the reminder, posts the confirmation. No prayer day, no database,
 no qada. Those live in `src/domain`, in TypeScript, under test, and the app applies them when it
 next opens (D92).
 */
final class PrayerMarksResponder: NSObject, NotificationDelegate {
  static let shared = PrayerMarksResponder()

  /// Must match `services/notifications`' `MARK_PRAYED_ACTION` and `MARK_UNDO_ACTION`.
  static let prayedAction = "prayed"
  static let undoAction = "undo"

  /// The category the confirmation is posted under, so its Undo button appears. Registered by the
  /// app with `setNotificationCategoryAsync`, which is also where the button's title comes from.
  static let confirmationCategory = "prayerMarkConfirmation"

  /**
   How long the confirmation stays.

   Android hands this to the system (`setTimeoutAfter`) and it is exact. iOS has no equivalent for
   a delivered local notification — the same gap `modules/notification-dismissal` documents — so
   this is a timer inside the background execution the system grants for handling the response. It
   normally holds; when the app is suspended first, the confirmation waits, and the next drain
   removes it. A confirmation that outstays its welcome is a small cost, and it is still true.
   */
  // 15 seconds (owner, 2026-08-28): long enough to read and undo a mistap, short enough that the
  // tray never holds yesterday's good news. A missed undo window costs nothing — the seal in the
  // app, the widget and the watch all still toggle.
  private static let selfDismissSeconds: TimeInterval = 15

  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    switch response.actionIdentifier {
    case PrayerMarksResponder.prayedAction:
      handlePrayed(response)
      return true
    case PrayerMarksResponder.undoAction:
      handleUndo(response)
      return true
    default:
      return false
    }
  }

  // MARK: - Prayed

  private func handlePrayed(_ response: UNNotificationResponse) {
    let request = response.notification.request
    let identifier = request.identifier
    let info = request.content.userInfo

    // A dress rehearsal (D93): the test notification's press runs the visible half of the loop —
    // clear the notification, show a confirmation — and records nothing, ever. Checked before the
    // prayer guard because a test payload names no prayer on purpose.
    if (info[PendingMarks.fieldTest] as? Bool) == true {
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
      if let title = PendingMarks.shared.testTitle() {
        postTestConfirmation(title: title)
        scheduleSelfDismissal(of: PrayerMarksResponder.testConfirmationId)
      }
      return
    }

    guard
      let prayer = info[PendingMarks.fieldPrayer] as? String,
      PrayerMarksResponder.prayers.contains(prayer)
    else {
      return
    }
    // Absent only if a payload ever arrives without one; the app dates such an entry from
    // `decidedAt` through `domain/dates`, the only place that boundary is allowed to live.
    let day = info[PendingMarks.fieldDay] as? String ?? ""

    let decidedAt = Date().timeIntervalSince1970 * 1000
    let markId = "\(identifier)@\(Int64(decidedAt))"
    let confirmationId = day.isEmpty
      ? "prayer-mark:\(markId)"
      : "prayer-mark:\(day):\(prayer)"

    // The reminder goes first: whatever else fails after this, the user has answered it and it
    // should not still be sitting there asking.
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])

    var mark: [String: Any] = [
      PendingMarks.fieldId: markId,
      PendingMarks.fieldPrayer: prayer,
      PendingMarks.fieldDecidedAt: decidedAt
    ]
    if !day.isEmpty {
      mark[PendingMarks.fieldDay] = day
    }

    if let title = PendingMarks.shared.title(for: prayer) {
      mark[PendingMarks.fieldConfirmationId] = confirmationId
      postConfirmation(
        title: title,
        identifier: confirmationId,
        markId: markId,
        day: day,
        prayer: prayer
      )
      scheduleSelfDismissal(of: confirmationId)
    }

    PendingMarks.shared.append(mark)

    // The buddies, told from here rather than on the app's next sync (D194) — the same reason the
    // widget's seal sends for itself, and what Android's `PrayerMarkResponder` already does.
    tellBuddies(day: day, prayer: prayer, state: "prayed")
  }

  // MARK: - Undo

  private func handleUndo(_ response: UNNotificationResponse) {
    let info = response.notification.request.content.userInfo
    guard
      let markId = info[PendingMarks.fieldAnnuls] as? String,
      let prayer = info[PendingMarks.fieldPrayer] as? String
    else {
      return
    }
    let day = info[PendingMarks.fieldDay] as? String ?? ""
    let decidedAt = Date().timeIntervalSince1970 * 1000

    var mark: [String: Any] = [
      PendingMarks.fieldId: "undo@\(markId)@\(Int64(decidedAt))",
      PendingMarks.fieldPrayer: prayer,
      PendingMarks.fieldDecidedAt: decidedAt,
      PendingMarks.fieldAnnuls: markId
    ]
    if !day.isEmpty {
      mark[PendingMarks.fieldDay] = day
    }
    PendingMarks.shared.append(mark)
    // A buddy who was told is told it was taken back — silently: a retraction carries no words.
    tellBuddies(day: day, prayer: prayer, state: "cleared")

    // The confirmation has said everything it had to say. Nothing replaces it: putting the reminder
    // back would be an accusation, and confirming the undo of a confirmation is exactly the kind of
    // chatter this app does not do.
    UNUserNotificationCenter.current()
      .removeDeliveredNotifications(withIdentifiers: [response.notification.request.identifier])
  }

  // MARK: - The buddies

  /**
   Post the flag, held open by a background task for as long as the post takes. The sender is
   bounded at eight seconds and silent; a flag that does not land stays outstanding and goes out
   on the app's next sync. An undatable mark is skipped — the day is TypeScript's to derive.
   */
  private func tellBuddies(day: String, prayer: String, state: String) {
    guard !day.isEmpty else { return }
    var task = UIBackgroundTaskIdentifier.invalid
    task = UIApplication.shared.beginBackgroundTask(withName: "buddy-send") {
      UIApplication.shared.endBackgroundTask(task)
    }
    let held = task
    Task {
      await BuddySender.send(day: day, prayer: prayer, state: state)
      await MainActor.run {
        if held != .invalid { UIApplication.shared.endBackgroundTask(held) }
      }
    }
  }

  // MARK: - The confirmation

  private func postConfirmation(
    title: String,
    identifier: String,
    markId: String,
    day: String,
    prayer: String
  ) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.sound = nil
    content.categoryIdentifier = PrayerMarksResponder.confirmationCategory
    // Everything the Undo press will need. It is read back out of this same dictionary, so the
    // confirmation carries its own undo and nothing has to be looked up.
    var info: [String: Any] = [
      PendingMarks.fieldAnnuls: markId,
      PendingMarks.fieldPrayer: prayer
    ]
    if !day.isEmpty {
      info[PendingMarks.fieldDay] = day
    }
    content.userInfo = info
    // Notification Centre, never a banner over whatever the user is doing: this confirms something
    // they did a second ago, and interrupting them to say so would be absurd.
    content.interruptionLevel = .passive

    let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  /**
   The confirmation for a **test** press (D93). Two honest differences from the real one: the title
   says nothing was saved, and it is posted without the confirmation category — no Undo, because
   there is nothing to undo.
   */
  private func postTestConfirmation(title: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.sound = nil
    content.interruptionLevel = .passive
    let request = UNNotificationRequest(
      identifier: PrayerMarksResponder.testConfirmationId,
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request)
  }

  /// Best-effort fifteen seconds; see `selfDismissSeconds`.
  private func scheduleSelfDismissal(of identifier: String) {
    var task = UIBackgroundTaskIdentifier.invalid
    task = UIApplication.shared.beginBackgroundTask(withName: "prayer-mark-confirmation") {
      UIApplication.shared.endBackgroundTask(task)
      task = .invalid
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + PrayerMarksResponder.selfDismissSeconds) {
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
      if task != .invalid {
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
      }
    }
  }

  /// Mirrors `domain/types`' `PRAYERS`. A payload naming anything else is not ours to act on.
  private static let prayers: Set<String> = ["fajr", "dhuhr", "asr", "maghrib", "isha"]

  /// Deterministic, so pressing the test button twice replaces rather than stacks.
  private static let testConfirmationId = "prayer-mark:test"
}
