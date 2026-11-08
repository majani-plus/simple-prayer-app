import Foundation
import WatchConnectivity
import WidgetKit

/**
 The watch's half of the WCSession wire. Twin of the phone's `WatchSessionManager`
 (modules/watch-sync/ios) — neither side can import the other, so the dictionary keys ARE the
 contract: change one, change both.

 - **Down:** `applicationContext` carries `["envelope": json]` or `["cleared": true]`. Both are
   also read from `receivedApplicationContext` on activation, so an envelope shipped while this
   app was dead is picked up the moment it next runs.
 - **Up:** `transferUserInfo(["marks": [mark]])` — FIFO, guaranteed, retried by the system until
   the phone takes delivery. A mark is composed by the UI (V4) with the same field names the D92
   queue uses; nothing here interprets it.
 */
final class PhoneSessionClient: NSObject, WCSessionDelegate {
  static let shared = PhoneSessionClient()

  /// Wire keys — twins of `WatchSessionManager`'s.
  private static let contextEnvelopeKey = "envelope"
  private static let contextClearedKey = "cleared"
  private static let userInfoMarksKey = "marks"

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated {
      session.activate()
    }
  }

  /// Queues one mark for the phone's D92 queue. Safe with the phone away — delivery is retried.
  func send(mark: [String: Any]) {
    guard WCSession.isSupported() else { return }
    WCSession.default.transferUserInfo([PhoneSessionClient.userInfoMarksKey: [mark]])
  }

  private func apply(context: [String: Any]) {
    if let json = context[PhoneSessionClient.contextEnvelopeKey] as? String, !json.isEmpty {
      WatchEnvelopeStore.write(json)
      // A fresh envelope carries the drained truth: local optimistic marks it now agrees with
      // are done, and holding them would only mask the next disagreement.
      if let envelope = WatchEnvelope.load() {
        WatchPending.collect(against: envelope)
      }
    } else if context[PhoneSessionClient.contextClearedKey] as? Bool == true {
      WatchEnvelopeStore.clear()
    } else {
      return
    }
    WidgetCenter.shared.reloadAllTimelines()
    DispatchQueue.main.async {
      NotificationCenter.default.post(name: .spEnvelopeChanged, object: nil)
    }
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard activationState == .activated else { return }
    // Whatever the phone last said while this app was not running.
    let stored = session.receivedApplicationContext
    if !stored.isEmpty {
      apply(context: stored)
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(context: applicationContext)
  }
}
