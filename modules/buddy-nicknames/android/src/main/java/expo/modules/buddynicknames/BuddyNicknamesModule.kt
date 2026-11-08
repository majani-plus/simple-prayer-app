package expo.modules.buddynicknames

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS face of the buddy bridge (`modules/buddy-nicknames/index.ts` documents the contract).
 *
 * A mailbox, like its siblings: it writes, it clears, and it hands back what the widget left. It
 * never schedules a notification, never decides what to send, and never touches the prayer log.
 */
class BuddyNicknamesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BuddyNicknames")

    AsyncFunction("setNicknames") { json: String ->
      NicknameStore.write(context(), json)
    }

    AsyncFunction("clearNicknames") {
      NicknameStore.clear(context())
    }

    AsyncFunction("setOutbox") { json: String ->
      BridgeStore.write(context(), BridgeStore.KEY_OUTBOX, json)
    }

    AsyncFunction("clearOutbox") {
      BridgeStore.clear(context(), BridgeStore.KEY_OUTBOX)
    }

    AsyncFunction("takeWidgetSent") {
      BridgeStore.takeWidgetSent(context())
    }

    AsyncFunction("setSecret") { json: String ->
      SecretStore.write(context(), json)
    }

    AsyncFunction("getSecret") {
      SecretStore.read(context())
    }

    AsyncFunction("deleteSecret") {
      SecretStore.clear(context())
    }
  }

  private fun context() = requireNotNull(appContext.reactContext)
}
