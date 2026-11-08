import Foundation

/**
 Where the app leaves the snapshot for the widget extension: the App Group `UserDefaults` — the
 same shared container the D92 queue lives in (`plugins/withAppGroup.js` writes the identifier
 into Info.plist once, for everyone). Without the group (an older build, a provisioning gap) this
 falls back to the app's own defaults, where the store still works and only a widget — which
 cannot exist without the group either — would fail to see it.

 The KEY and the JSON shape are shared verbatim with the extension's `SnapshotReader.swift` and
 produced only by `src/services/widgetSnapshot.ts`. Nothing here interprets the payload.
 */
enum WidgetSnapshotStore {
  /// Where `plugins/withAppGroup.js` records the App Group it added to the entitlements.
  static let appGroupInfoKey = "SPAppGroupIdentifier"

  /// The one key the snapshot lives under. Version lives INSIDE the JSON, checked by readers.
  static let snapshotKey = "SPWidgetSnapshot"

  static func defaults() -> UserDefaults {
    let group = Bundle.main.object(forInfoDictionaryKey: appGroupInfoKey) as? String
    return group.flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
  }

  static func write(_ json: String) {
    defaults().set(json, forKey: snapshotKey)
  }

  static func clear() {
    defaults().removeObject(forKey: snapshotKey)
  }
}
