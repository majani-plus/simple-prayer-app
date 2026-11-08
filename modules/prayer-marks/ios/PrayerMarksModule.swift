import ExpoModulesCore
import UserNotifications

/**
 The app's side of the queue: push the copy down, read what is waiting, forget what has landed.

 Everything that happens when the button is actually pressed is in `PrayerMarksResponder`, which
 runs without this module ever being built — a background launch may never create a React context.
 This module is only what the app talks to once it is open.

 Read-then-acknowledge rather than a draining read: a crash between reading and writing must cost
 nothing, and applying an entry twice is a no-op by construction (`domain/pendingMarks`).
 */
public class PrayerMarksModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrayerMarks")

    AsyncFunction("configure") { (copy: [String: Any]) in
      // Only the titles are stored. The Undo button's words come from the notification category
      // the app registers, and Android's channel copy has no iOS counterpart.
      guard let titles = copy["confirmationTitle"] as? [String: String] else { return }
      PendingMarks.shared.putTitles(titles)
      if let testTitle = copy["testConfirmationTitle"] as? String {
        PendingMarks.shared.putTestTitle(testTitle)
      }
    }

    AsyncFunction("readPendingMarks") { () -> String in
      PendingMarks.shared.readAll()
    }

    AsyncFunction("acknowledgePendingMarks") { (ids: [String]) in
      let confirmations = PendingMarks.shared.acknowledge(ids)
      if !confirmations.isEmpty {
        UNUserNotificationCenter.current()
          .removeDeliveredNotifications(withIdentifiers: confirmations)
      }
    }
  }
}
