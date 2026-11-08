import ExpoModulesCore

/**
 The JS face of the buddy bridge (`modules/buddy-nicknames/index.ts` documents the contract).

 A mailbox, like its siblings: it writes, it clears, and it hands back what the widget left. It
 never schedules a notification, never decides what to send, and never touches the prayer log.
 */
public class BuddyNicknamesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BuddyNicknames")

    AsyncFunction("setNicknames") { (json: String) in
      BuddyBridgeStore.write(json, forKey: BuddyBridgeStore.nicknamesKey)
    }

    AsyncFunction("clearNicknames") {
      BuddyBridgeStore.clear(BuddyBridgeStore.nicknamesKey)
    }

    AsyncFunction("setOutbox") { (json: String) in
      BuddyBridgeStore.write(json, forKey: BuddyBridgeStore.outboxKey)
    }

    AsyncFunction("clearOutbox") {
      BuddyBridgeStore.clear(BuddyBridgeStore.outboxKey)
    }

    AsyncFunction("takeWidgetSent") { () -> String in
      BuddyBridgeStore.takeWidgetSent()
    }

    AsyncFunction("setSecret") { (json: String) in
      BuddySecretStore.write(json)
    }

    AsyncFunction("getSecret") { () -> String? in
      BuddySecretStore.read()
    }

    AsyncFunction("deleteSecret") {
      BuddySecretStore.delete()
    }
  }
}
