import Foundation

/**
 The app process's own sender (D194): the notification's Prayed / Undo and the Live Activity seal
 tell the buddies themselves, the way the widget's seal already does (D180).

 ## Why a second copy

 Those two presses run in the APP's process, often with no JavaScript running at all — a
 background launch to answer a notification, an intent run for the lock screen. Before this they
 only queued the mark, and the buddies heard about it whenever the app was next opened. Android
 has sent from both since D180 (`BuddySender.kt`, called from `PrayerMarkResponder.kt`).

 The widget's sender (`targets/widget/BuddySender.swift`) is compiled into the widget extension
 and cannot be reached from a pod. This is the same wire, the same outbox, the same ledger and the
 same eight-second bound, written against this module's own App Group and keychain helpers
 (`BuddyBridgeStore`, `BuddySecretStore`). Keep the two in step: the payload, the 202/404 rule,
 `alreadySent` and `appendSent` must say the same thing in both.

 `send(day:prayer:state:)` has the widget's signature on purpose, so the Live Activity intent —
 a byte-for-byte twin compiled into both processes — calls `BuddySender.send` and gets whichever
 sender its process has.

 Every path is silent and bounded. A pair that could not be told stays outstanding, and the app
 tells them on its next sync, exactly as before.
 */
public enum BuddySender {
  /// Mirrored from `RELAY_ORIGIN` in `src/services/buddyRelay.ts`.
  static let origin = "https://relay.simpleprayer.app"
  static let timeout: TimeInterval = 8

  private struct Recipient {
    let pairId: String
    let title: String?
    let titleNamed: String?
  }

  /**
   Tell every paired buddy what this press asserted.

   - Parameters:
     - day: The prayer day the press belongs to — from the payload, never re-derived here.
     - prayer: `fajr` … `isha`.
     - state: `prayed`, or `cleared` for an undo.
   */
  public static func send(day: String, prayer: String, state: String) async {
    guard !day.isEmpty, !alreadySent(day: day, prayer: prayer, state: state) else { return }
    guard let auth = credentials(), let outbox = outbox() else { return }
    let recipients = outbox.recipients(for: prayer, state: state)
    guard !recipients.isEmpty else { return }

    let session = URLSession(configuration: configuration())
    let settled = await withTaskGroup(of: Bool.self) { group -> Bool in
      for recipient in recipients {
        group.addTask {
          await post(
            session: session,
            auth: auth,
            recipient: recipient,
            day: day,
            prayer: prayer,
            state: state,
            lang: outbox.lang,
            notify: outbox.notify
          )
        }
      }
      var any = false
      for await ok in group where ok {
        any = true
      }
      return any
    }

    if settled {
      appendSent(day: day, prayer: prayer, state: state)
    }
  }

  // MARK: - The wire

  private static func configuration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.timeoutIntervalForResource = timeout
    configuration.waitsForConnectivity = false
    return configuration
  }

  /// True when the relay has the flag (202), or the pair no longer exists (404) — never retried.
  private static func post(
    session: URLSession,
    auth: (deviceId: String, secret: String),
    recipient: Recipient,
    day: String,
    prayer: String,
    state: String,
    lang: String,
    notify: Bool
  ) async -> Bool {
    var body: [String: Any] = [
      "pairId": recipient.pairId,
      "day": day,
      "prayer": prayer,
      "state": state,
      "lang": lang,
      "notify": notify,
    ]
    if let title = recipient.title, let titleNamed = recipient.titleNamed {
      body["title"] = title
      body["titleNamed"] = titleNamed
    }

    guard
      let url = URL(string: "\(origin)/send"),
      let payload = try? JSONSerialization.data(withJSONObject: body)
    else {
      return false
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = payload
    request.setValue("Bearer \(auth.deviceId).\(auth.secret)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    guard
      let (_, response) = try? await session.data(for: request),
      let status = (response as? HTTPURLResponse)?.statusCode
    else {
      return false
    }
    return status == 202 || status == 404
  }

  // MARK: - What the app left behind

  private struct Outbox {
    let lang: String
    let notify: Bool
    let pairs: [[String: Any]]

    func recipients(for prayer: String, state: String) -> [Recipient] {
      pairs.compactMap { pair in
        guard let pairId = pair["pairId"] as? String, !pairId.isEmpty else { return nil }
        // Words only for a buddy who wants to be told, and only about a prayer: a retraction is
        // always silent.
        guard state == "prayed",
              let titles = pair["titles"] as? [String: Any],
              let text = titles[prayer] as? [String: Any],
              let title = text["title"] as? String,
              let titleNamed = text["titleNamed"] as? String
        else {
          return Recipient(pairId: pairId, title: nil, titleNamed: nil)
        }
        return Recipient(pairId: pairId, title: title, titleNamed: titleNamed)
      }
    }
  }

  private static func outbox() -> Outbox? {
    guard
      let raw = BuddyBridgeStore.defaults().string(forKey: BuddyBridgeStore.outboxKey),
      let data = raw.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      (parsed["v"] as? Int) == 1,
      let pairs = parsed["pairs"] as? [[String: Any]]
    else {
      return nil
    }
    return Outbox(
      lang: parsed["lang"] as? String ?? "en",
      notify: parsed["notify"] as? Bool ?? true,
      pairs: pairs
    )
  }

  private static func credentials() -> (deviceId: String, secret: String)? {
    guard
      let raw = BuddySecretStore.read(),
      let data = raw.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let deviceId = parsed["deviceId"] as? String, !deviceId.isEmpty,
      let secret = parsed["secret"] as? String, !secret.isEmpty
    else {
      return nil
    }
    return (deviceId, secret)
  }

  /// The widget's rule on the same ledger: the LAST thing said about this prayer today counts.
  private static func alreadySent(day: String, prayer: String, state: String) -> Bool {
    guard
      let raw = BuddyBridgeStore.defaults().string(forKey: BuddyBridgeStore.widgetSentKey),
      let data = raw.data(using: .utf8),
      let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else {
      return false
    }
    var last: String?
    for entry in entries
    where entry["day"] as? String == day && entry["prayer"] as? String == prayer {
      last = entry["state"] as? String
    }
    return last == state
  }

  /// A line for the app to absorb before it reconciles, so it does not say this a second time.
  private static func appendSent(day: String, prayer: String, state: String) {
    let defaults = BuddyBridgeStore.defaults()
    var entries: [[String: Any]] = []
    if let raw = defaults.string(forKey: BuddyBridgeStore.widgetSentKey),
       let data = raw.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      entries = parsed
    }
    entries.append([
      "day": day,
      "prayer": prayer,
      "state": state,
      "at": Date().timeIntervalSince1970 * 1000,
    ])
    guard
      let data = try? JSONSerialization.data(withJSONObject: entries),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }
    defaults.set(json, forKey: BuddyBridgeStore.widgetSentKey)
  }
}
