import Foundation

/**
 This phone's relay secret, kept where a process with no JS can still reach it.

 ## Why it moved here

 The secret used to live in `expo-secure-store`, which only the app can read. That was right while
 only the app ever talked to the relay. It stopped being right the moment a seal tap on a widget
 had to tell a buddy by itself (D180): a widget extension is a different process, and a secret it
 cannot read is a notification that waits for the next time the app is opened.

 So it is written to the keychain under an **App Group access group**, which every process of this
 app shares — the keychain's equivalent of the `UserDefaults` suite next door in
 [BuddyBridgeStore]. Everything else about it is unchanged: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`,
 because a widget tap can land while the phone is locked but the secret has no business leaving
 this device, not even in a backup.

 What is stored is the same JSON the app has always stored — `{ deviceId, secret }` — so the value
 migrating out of `expo-secure-store` needs no translation (`src/services/buddyCredentials.ts`).

 Every failure is a `nil` or a no-op. A keychain that will not open means buddy mode is not set up,
 which is a feature that quietly does nothing, never a crash.
 */
enum BuddySecretStore {
  static let service = "app.simpleprayer.buddy"
  static let account = "relay"

  private static func query() -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    // An App Group identifier is a valid keychain access group without a team prefix, and it is
    // the only one the widget extension and the app both hold. Absent (a build with no group), the
    // item lands in the app's own group and only the app can read it — buddy mode then behaves
    // exactly as it did before D180.
    if let group = Bundle.main.object(forInfoDictionaryKey: BuddyBridgeStore.appGroupInfoKey) as? String {
      query[kSecAttrAccessGroup as String] = group
    }
    return query
  }

  static func write(_ json: String) {
    guard let data = json.data(using: .utf8) else { return }
    // Delete first: `SecItemUpdate` on an item that is not there fails, and a second `SecItemAdd`
    // fails with `errSecDuplicateItem`. Replacing is one path that is right both times.
    SecItemDelete(query() as CFDictionary)
    var attributes = query()
    attributes[kSecValueData as String] = data
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(attributes as CFDictionary, nil)
  }

  static func read() -> String? {
    var attributes = query()
    attributes[kSecReturnData as String] = true
    attributes[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    guard SecItemCopyMatching(attributes as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data
    else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  static func delete() {
    SecItemDelete(query() as CFDictionary)
  }
}
