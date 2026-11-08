import Foundation

/**
 The App Group drawer the widget and the notification service extension read from.

 Same container as the widget snapshot and the D92 queue — `plugins/withAppGroup.js` writes the
 identifier into the app's Info.plist once, for everyone. The extensions have no Info.plist key of
 their own (the target plugin offers no field for one), so each derives the group from its own
 bundle id instead; `targets/widget/SnapshotReader.swift` and `targets/notify/NotificationService.swift`
 hold the other halves of this, and the KEYS below are shared verbatim between them.

 Three drawers, each with one tenant (`modules/buddy-nicknames/index.ts` explains why they exist):

 - `SPBuddyNicknames` — `{ pairId: nickname }`, read by the notification rewriter.
 - `SPBuddyOutbox` — who to tell when a prayer is marked with no app running, and the sentence to
   tell them in. Never a nickname.
 - `SPBuddyWidgetSent` — what the widget already told them, for the app to absorb so it does not
   say it twice.
 */
enum BuddyBridgeStore {
  /// Where `plugins/withAppGroup.js` records the App Group it added to the entitlements.
  static let appGroupInfoKey = "SPAppGroupIdentifier"

  static let nicknamesKey = "SPBuddyNicknames"
  static let outboxKey = "SPBuddyOutbox"
  static let widgetSentKey = "SPBuddyWidgetSent"

  static func defaults() -> UserDefaults {
    let group = Bundle.main.object(forInfoDictionaryKey: appGroupInfoKey) as? String
    return group.flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
  }

  static func write(_ json: String, forKey key: String) {
    defaults().set(json, forKey: key)
  }

  static func clear(_ key: String) {
    defaults().removeObject(forKey: key)
  }

  /**
   The widget's ledger, read and emptied in one go.

   Emptied because the app is about to fold these into its own record of what it has told each
   buddy: leaving them behind would have the next drain absorb them a second time, which is
   harmless but untrue. An entry written between the read and the removal is lost — a buddy is
   then told twice, the only failure this ledger has, and a far smaller one than a mark that is
   announced twice on every open.
   */
  static func takeWidgetSent() -> String {
    let defaults = defaults()
    let raw = defaults.string(forKey: widgetSentKey) ?? "[]"
    defaults.removeObject(forKey: widgetSentKey)
    return raw
  }
}
