import Foundation

/**
 The seal tap tells the buddies itself (D180).

 ## Why this is here rather than in the app

 Before this, a tap on a widget appended to the D92 queue and stopped. The buddies were told when
 the app was next opened — which for somebody who marks their prayers from the homescreen can be
 the following evening. The thing a widget is *for* is not opening the app, so the sending had to
 move to where the tap lands.

 ## What it can and cannot know

 This process has no JavaScript, no MMKV and no translations. Everything it needs the app left in
 the App Group before the tap happened (`modules/buddy-nicknames`): the relay credentials in the
 keychain, and an outbox naming the pairs and holding the sentence already written in each buddy's
 own language. It composes nothing and decides nothing — it posts what it was given.

 There is no nickname here and there never will be. The sentence with a name in it is the one with
 `{}` where the name goes; the receiving phone fills the hole from its own roster (D174).

 ## Failure

 Every path is silent and bounded. Nothing is thrown at the intent, nothing delays the timeline
 reload, and the whole attempt gives up after eight seconds — a tap must answer under the finger
 whatever the network is doing. A pair that could not be told stays outstanding: the app finds it
 on its next open and tells them then, exactly as it did before this file existed.
 */
enum BuddySender {
  /// Mirrored from `RELAY_ORIGIN` in `src/services/buddyRelay.ts`. The one host this app talks to.
  static let origin = "https://relay.simpleprayer.app"

  /// Shared verbatim with `modules/buddy-nicknames/ios/BuddyBridgeStore.swift`.
  static let outboxKey = "SPBuddyOutbox"
  static let widgetSentKey = "SPBuddyWidgetSent"

  /// Shared verbatim with `modules/buddy-nicknames/ios/BuddySecretStore.swift`.
  static let keychainService = "app.simpleprayer.buddy"
  static let keychainAccount = "relay"

  /// Nobody waits on a buddy — the app's own client says the same and uses the same eight seconds.
  static let timeout: TimeInterval = 8

  private struct Recipient {
    let pairId: String
    let title: String?
    let titleNamed: String?
  }

  /**
   Tell every paired buddy what this tap asserted.

   - Parameters:
     - day: The prayer day the tapped seal belongs to — from the snapshot, never re-derived.
     - prayer: `fajr` … `isha`.
     - state: `prayed`, or `cleared` when the tap toggled a shown `prayed` off.
   */
  static func send(day: String, prayer: String, state: String) async {
    guard !alreadySent(day: day, prayer: prayer, state: state) else { return }
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

    // Recorded only once it has actually gone somewhere, and only as one line for the whole tap —
    // the app's own ledger is per prayer, not per pair, so a flag that reached one buddy and not
    // another counts as sent there too. A pair that heard nothing hears it on the next open.
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

  /// - Returns: True when the relay has taken responsibility for this flag — 202, or 404 for a pair
  ///   that no longer exists, which is settled in the only sense that matters: never retry it.
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
    // Words only for a buddy who wants to be told, and only about a prayer — a retraction is
    // always silent, because there is nothing good to announce about it.
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
      let raw = AppGroup.defaults().string(forKey: outboxKey),
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
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    // The App Group is the only keychain access group the app and this extension share; it is a
    // valid one without a team prefix, and `AppGroup` resolves it the way everything else here does.
    if let group = AppGroup.identifier() {
      query[kSecAttrAccessGroup as String] = group
    }

    var item: CFTypeRef?
    guard
      SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data,
      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let deviceId = parsed["deviceId"] as? String, !deviceId.isEmpty,
      let secret = parsed["secret"] as? String, !secret.isEmpty
    else {
      return nil
    }
    return (deviceId, secret)
  }

  /**
   Whether the buddies have already heard this, and nothing has changed since.

   The app's own rule, applied to the same ledger: what matters is the LAST thing said about this
   prayer today, so prayed → cleared → prayed still sends three times, and two presses of the same
   seal send once. Only the undrained window is covered — the app empties this on its next open,
   and its own ledger takes over from there.
   */
  private static func alreadySent(day: String, prayer: String, state: String) -> Bool {
    guard
      let raw = AppGroup.defaults().string(forKey: widgetSentKey),
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

  /**
   Leave a line for the app: this one is already told.

   Read, append, write — two taps in the same millisecond are not a concern here, because a person
   has one finger on one seal. What this prevents is the far more likely thing: the app opening
   later, seeing a prayer its own ledger has no record of announcing, and announcing it again.
   */
  private static func appendSent(day: String, prayer: String, state: String) {
    let defaults = AppGroup.defaults()
    var entries: [[String: Any]] = []
    if let raw = defaults.string(forKey: widgetSentKey),
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
    defaults.set(json, forKey: widgetSentKey)
  }
}
