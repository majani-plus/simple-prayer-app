import Foundation
import WatchConnectivity

/**
 The phone's half of the WCSession wire (Milestone V).

 ## The wire contract (change one side, change both — the watch app's session is the twin)

 - **Down (phone → watch):** `updateApplicationContext` with either
   `["envelope": <WatchEnvelope JSON string>]` or `["cleared": true]`. Application context is
   latest-value and coalesced — exactly right, because only the newest envelope means anything.
   The watch persists the JSON into its own App Group container (watch-local; an App Group never
   bridges devices) and reloads its complications.
 - **Up (watch → phone):** `transferUserInfo` with `["marks": [<mark dictionaries>]]`. FIFO and
   guaranteed — WCSession retries until the phone takes delivery, which is the property the D92
   queue's "losing an 'I prayed' is the one failure this feature must not have" demands.

 ## What arriving marks become

 One App Group defaults key per mark, `widgetMark:<id>` — the race-safe per-key form
 `PendingMarks.readAll`/`acknowledge` (modules/prayer-marks) already merge and clear. The prefix
 and the App Group lookup are deliberate twins of the constants there and in the widget
 extension's `PendingOverlay`: none of these processes can import each other, so the string IS
 the contract (D92). This class never interprets a mark — no day math, no status rules; the
 fields ride through untouched for `src/domain/pendingMarks` to judge.

 Delivery can happen with the app launched into the background and no React context alive, which
 is why activation lives in `WatchSyncAppDelegateSubscriber`, not in the Expo module.
 */
final class WatchSessionManager: NSObject, WCSessionDelegate {
  static let shared = WatchSessionManager()

  /// Where `plugins/withAppGroup.js` records the App Group (same key `PendingMarks` reads).
  private static let appGroupInfoKey = "SPAppGroupIdentifier"
  /// The per-key queue form. Twin of `PendingMarks.widgetMarkPrefix` — change one, change both.
  private static let widgetMarkPrefix = "widgetMark:"
  /// The one queue field this side must validate: an entry with no id can never be acknowledged.
  private static let fieldId = "id"

  /// Down-wire keys.
  static let contextEnvelopeKey = "envelope"
  static let contextClearedKey = "cleared"
  /// Up-wire key.
  static let userInfoMarksKey = "marks"

  /// The latest payload asked for before activation finished; sent on activation.
  private var pendingContext: [String: Any]?
  private let queue = DispatchQueue(label: "app.simpleprayer.watchSync")

  /// Called from `didFinishLaunching` — early enough for a background delivery.
  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated {
      session.activate()
    }
  }

  /// Ships the envelope. Safe to call any time; stashes until the session activates.
  func push(envelope json: String) {
    send(context: [WatchSessionManager.contextEnvelopeKey: json])
  }

  /// Tells the watch there is nothing to say (no location) — it shows its bundled state.
  func clear() {
    send(context: [WatchSessionManager.contextClearedKey: true])
  }

  /// Whether a watch is paired with our watch app installed. A hint, never a gate.
  func hasWatch() -> Bool {
    let state = watchState()
    return state.paired && state.appInstalled
  }

  /// The two facts kept APART, because the interesting case is the one in between: a watch is
  /// paired but our app is not on it. watchOS installs a companion app by itself when "Automatic
  /// App Install" is on (its default), so anyone who turned that off — or who installed the phone
  /// app before pairing a watch — has to add it by hand and has no way of knowing that. There is
  /// no API to install it for them, so the app can only say so; see `useWatchInstallHint`.
  func watchState() -> (paired: Bool, appInstalled: Bool) {
    guard WCSession.isSupported() else { return (false, false) }
    let session = WCSession.default
    guard session.activationState == .activated else { return (false, false) }
    return (session.isPaired, session.isWatchAppInstalled)
  }

  private func send(context: [String: Any]) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    queue.sync {
      guard session.activationState == .activated else {
        pendingContext = context
        return
      }
      // `updateApplicationContext` throws on a byte-identical payload; the JS side dedupes on
      // content already (and `generatedAt` differs between real builds), so a throw here is
      // a harmless repeat, not a lost update.
      try? session.updateApplicationContext(context)
    }
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard activationState == .activated else { return }
    queue.sync {
      if let stashed = pendingContext {
        pendingContext = nil
        try? session.updateApplicationContext(stashed)
      }
    }
  }

  /// Marks from the watch. Guaranteed-delivery FIFO; each lands as one per-key queue entry.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    guard let marks = userInfo[WatchSessionManager.userInfoMarksKey] as? [[String: Any]] else {
      return
    }
    let group = Bundle.main.object(forInfoDictionaryKey: WatchSessionManager.appGroupInfoKey) as? String
    let defaults = group.flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
    for mark in marks {
      guard let id = mark[WatchSessionManager.fieldId] as? String, !id.isEmpty else { continue }
      guard JSONSerialization.isValidJSONObject(mark) else { continue }
      // A single-key set cannot race the app's array drain (PendingMarks' own reasoning).
      defaults.set(mark, forKey: WatchSessionManager.widgetMarkPrefix + id)
    }
  }

  // The phone must keep the session alive across watch switches: deactivate → reactivate.
  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}
