import UserNotifications

/**
 Puts the buddy's nickname into a notification that was sent without one.

 The relay forwards two sentences — "Your buddy prayed Dhuhr" and "{} prayed Dhuhr" — and no name,
 because it has never had one to forward. The nickname, the icon and the colour of a buddy are
 chosen by the person looking at them and have never crossed a network (D174). So the hole is
 filled here, in the half-second between the push arriving and iOS drawing it, from a map the app
 mirrored into the App Group. The name is read on this device, used on this device, and goes
 nowhere.

 Every failure path ends in `contentHandler(request.content)`: the sentence the sender wrote is
 already correct, and a notification that arrives slightly less warm is not a notification that
 fails to arrive.
 */
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var pending: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler

    guard let copy = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    self.pending = copy

    let named = BuddyNickname.named(request.content)
    if let title = named.title {
      copy.title = title
    }
    if let body = named.body {
      copy.body = body
    }
    contentHandler(copy)
  }

  /**
   iOS is about to stop waiting. Deliver whatever we have — which is either the rewritten body or,
   if nothing had been decided yet, the one that arrived.
   */
  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let pending {
      contentHandler(pending)
    }
  }
}

/**
 The nickname half, kept apart from the extension's lifecycle so it is one readable thing.

 The App Group and its key are shared verbatim with `modules/buddy-nicknames/ios/`. The derivation
 fallback exists because an extension carries no `SPAppGroupIdentifier` in its Info.plist — the
 target plugin offers no field for one — and the extension's own bundle id is `<app>.notify`, so
 the group is `group.<app>`. The widget target resolves its container exactly this way.
 */
enum BuddyNickname {
  static let infoKey = "SPAppGroupIdentifier"
  static let nicknamesKey = "SPBuddyNicknames"

  /**
   The two characters the sender left where a name belongs.

   They arrive already bidi-isolated: the sender writes the sentence with ordinary i18next
   interpolation, so `src/i18n/formatter.ts` wraps the hole in the isolates every interpolated
   value in this app gets, and the name dropped into it inherits them. That is what keeps a Latin
   nickname inside an Arabic sentence from dragging the full stop to the wrong end — and it is why
   nothing is added here: doing it twice would be wrong, and the relay allows exactly those four
   characters through for exactly this reason.
   */
  static let hole = "{}"

  static func identifier() -> String? {
    if let fromPlist = Bundle.main.object(forInfoDictionaryKey: infoKey) as? String {
      return fromPlist
    }
    guard let bundle = Bundle.main.bundleIdentifier else { return nil }
    let appBundle = bundle.hasSuffix(".notify") ? String(bundle.dropLast(".notify".count)) : bundle
    return "group.\(appBundle)"
  }

  static func defaults() -> UserDefaults {
    identifier().flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
  }

  /**
   The lines this notification should show, each nil to leave it as it arrived.

   A buddy mark is one line — the title — so `titleNamed` is the template that matters; `bodyNamed`
   is read too, for a sender on an older app version that still writes one. Both nil covers every
   ordinary case as well as every broken one: a notification that is not a buddy mark, a sender who
   sent no template at all, and a pair this phone has not named yet — an inviter has a real pair
   before they have chosen a nickname for it.
   */
  static func named(_ content: UNNotificationContent) -> (title: String?, body: String?) {
    guard let payload = payload(from: content.userInfo),
          payload["type"] as? String == "mark",
          let pairId = payload["pairId"] as? String,
          let nickname = nickname(for: pairId)
    else {
      return (nil, nil)
    }
    return (
      filled(payload["titleNamed"] as? String, with: nickname),
      filled(payload["bodyNamed"] as? String, with: nickname)
    )
  }

  /// The template with the name in the hole, or nil when there is no template or no hole in it.
  private static func filled(_ template: String?, with nickname: String) -> String? {
    guard let template, template.contains(hole) else { return nil }
    return template.replacingOccurrences(of: hole, with: nickname)
  }

  /**
   Expo nests a remote push's `data` under the top-level `body` key of `userInfo`. It arrives as a
   dictionary over APNs and as a JSON string on some paths, so both are read.
   */
  private static func payload(from userInfo: [AnyHashable: Any]) -> [String: Any]? {
    if let dictionary = userInfo["body"] as? [String: Any] {
      return dictionary
    }
    guard let raw = userInfo["body"] as? String,
          let data = raw.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return nil
    }
    return parsed
  }

  private static func nickname(for pairId: String) -> String? {
    guard let raw = defaults().string(forKey: nicknamesKey),
          let data = raw.data(using: .utf8),
          let map = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let nickname = map[pairId] as? String,
          !nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }
    return nickname
  }
}
