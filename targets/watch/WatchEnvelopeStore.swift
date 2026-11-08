import Foundation

/**
 Where the watch keeps the envelope the phone last shipped: the WATCH-side App Group container
 (same group name as the phone's, different device, different container — the group here exists
 so the complication extension can read what the app received). One JSON string under one key,
 version-gated by the readers; this store never interprets it.
 */
enum WatchEnvelopeStore {
  /// Same plist key the phone-side code reads (`plugins/withAppGroup.js` writes it there; the
  /// watch targets carry it in their own Info.plist).
  private static let appGroupInfoKey = "SPAppGroupIdentifier"
  /// The stored envelope. Twin of the Wear app's preferences key — change one, change both.
  static let envelopeKey = "SPWatchEnvelope"

  static func defaults() -> UserDefaults {
    let group = Bundle.main.object(forInfoDictionaryKey: appGroupInfoKey) as? String
    return group.flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
  }

  static func write(_ json: String) {
    defaults().set(json, forKey: envelopeKey)
  }

  static func clear() {
    defaults().removeObject(forKey: envelopeKey)
  }

  static func read() -> String? {
    defaults().string(forKey: envelopeKey)
  }
}
