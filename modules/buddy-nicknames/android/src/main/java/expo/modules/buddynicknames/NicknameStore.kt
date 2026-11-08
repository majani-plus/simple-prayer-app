package expo.modules.buddynicknames

import android.content.Context
import org.json.JSONObject

/**
 * Where the app leaves `{ pairId: nickname }` for [BuddyMessagingService].
 *
 * One tenant of [BridgeStore]'s drawer, and the fenced one: what a notification rewriter is
 * allowed to read is a nickname and a pair id — never a mark, a day or anything about the prayer
 * log. The neighbouring drawers carry no name, and this one carries nothing else.
 *
 * Reads are best-effort by design. Unreadable, missing or malformed all mean the same thing to the
 * caller — no nickname — and the notification then shows the sentence the sender wrote.
 */
internal object NicknameStore {
  fun write(context: Context, json: String) {
    BridgeStore.write(context, BridgeStore.KEY_NICKNAMES, json)
  }

  fun clear(context: Context) {
    BridgeStore.clear(context, BridgeStore.KEY_NICKNAMES)
  }

  /** The nickname this phone gave that pair, or null — which is not an error, just an unnamed pair. */
  fun nicknameFor(context: Context, pairId: String): String? {
    val raw = BridgeStore.read(context, BridgeStore.KEY_NICKNAMES) ?: return null
    val nickname = try {
      JSONObject(raw).optString(pairId, "")
    } catch (_: Exception) {
      return null
    }
    return nickname.ifBlank { null }
  }
}
