package expo.modules.buddynicknames

import android.content.Context
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/**
 * Puts the buddy's nickname into a notification that was sent without one.
 *
 * ## Why this class is allowed to exist
 *
 * expo-notifications registers its own `ExpoFirebaseMessagingService` with
 * `<intent-filter android:priority="-1">` — deliberately below the default, so that an app can put
 * a service of its own in front. Firebase delivers to the single highest-priority match, so ours
 * (registered at the default priority in this module's manifest) receives every push, rewrites the
 * one kind it cares about, and hands the result to `super`. Everything downstream — the channel,
 * the tray behaviour, the tap, the JS listeners — stays Expo's code on Expo's path.
 *
 * ## Why the rewrite happens here and not on the sender
 *
 * The sending phone writes the notification, in the receiver's language, because the relay holds no
 * copy and no translations. What it cannot write is the name: the nickname, icon and colour of a
 * buddy are chosen by the person looking at them and have never left their phone (D174). So the
 * sender sends both "Your buddy prayed Dhuhr" and "{} prayed Dhuhr", and the hole is filled here,
 * against a map the app mirrored into [NicknameStore]. The nickname is read on this device, used on
 * this device, and goes nowhere.
 *
 * ## Why every failure is silent
 *
 * The plain sentence the sender wrote is always present and always correct. Anything that goes
 * wrong here — no nickname for this pair, malformed payload, a Firebase internal that moved —
 * leaves the message exactly as it arrived. Slightly less warm, never wrong, and never a push
 * that fails to arrive.
 */
class BuddyMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    super.onMessageReceived(rechanneled(named(this, remoteMessage)))
  }

  internal companion object {
    /** Where Expo puts the developer payload, and the two visible lines, in an Android push. */
    private const val DATA_KEY = "body"
    private const val TITLE_KEY = "title"
    private const val MESSAGE_KEY = "message"

    /**
     * The two characters the sender left where a name belongs.
     *
     * They arrive already bidi-isolated: the sender writes the sentence with ordinary i18next
     * interpolation, so `src/i18n/formatter.ts` wraps the hole in the isolates every interpolated
     * value in this app gets, and the name dropped into it inherits them. That is what keeps a
     * Latin nickname inside an Arabic sentence from dragging the full stop to the wrong end — and
     * it is why nothing is added here: doing it twice would be wrong, and the relay allows exactly
     * those four characters through for exactly this reason.
     */
    private const val HOLE = "{}"

    /** Expo reads a data push's channel from this key (`FirebaseNotificationTrigger`). */
    private const val CHANNEL_KEY = "channelId"

    /**
     * The relay names the first buddy channel, which was created LOW and cannot be raised; this
     * build's channel is the HIGH one (D196). Old app versions still have only the first, so the
     * relay keeps sending its name and each phone maps it to the channel it has.
     */
    private const val LEGACY_CHANNEL = "buddies"
    private const val CHANNEL = "buddies_v2"

    /** The same push on the current buddy channel, or the push untouched. */
    fun rechanneled(remoteMessage: RemoteMessage): RemoteMessage {
      return try {
        if (remoteMessage.data[CHANNEL_KEY] != LEGACY_CHANNEL) return remoteMessage
        val bundle = remoteMessage.toIntent().extras ?: return remoteMessage
        bundle.putString(CHANNEL_KEY, CHANNEL)
        RemoteMessage(bundle)
      } catch (_: Exception) {
        remoteMessage
      }
    }

    /**
     * The same notification with the buddy's nickname in it, or the notification untouched.
     *
     * A buddy mark is one line — the title — so `titleNamed` is the template that matters;
     * `bodyNamed` is read too, for a sender on an older app version that still writes one.
     *
     * Rebuilt rather than mutated: `RemoteMessage`'s data map is derived from its bundle and is not
     * ours to change in place. `toIntent().extras` and `RemoteMessage(Bundle)` are both public and
     * round-trip everything else — message id, sent time, priority, the rest of the payload.
     */
    fun named(context: Context, remoteMessage: RemoteMessage): RemoteMessage {
      return try {
        val data = remoteMessage.data
        val payload = data[DATA_KEY]?.let { JSONObject(it) } ?: return remoteMessage
        if (payload.optString("type") != "mark") return remoteMessage

        val pairId = payload.optString("pairId").ifBlank { null } ?: return remoteMessage
        val nickname = NicknameStore.nicknameFor(context, pairId) ?: return remoteMessage

        // Only ever rewrites a line that was already going to be shown. A silent push has neither,
        // and giving it one here would turn a data push into a visible one.
        val title =
          if (data[TITLE_KEY].isNullOrBlank()) null
          else filled(payload.optString("titleNamed"), nickname)
        val message =
          if (data[MESSAGE_KEY].isNullOrBlank()) null
          else filled(payload.optString("bodyNamed"), nickname)
        if (title == null && message == null) return remoteMessage

        val bundle = remoteMessage.toIntent().extras ?: return remoteMessage
        title?.let { bundle.putString(TITLE_KEY, it) }
        message?.let { bundle.putString(MESSAGE_KEY, it) }
        RemoteMessage(bundle)
      } catch (_: Exception) {
        remoteMessage
      }
    }

    /** The template with the name in the hole, or null when there is no template or no hole in it. */
    private fun filled(template: String?, nickname: String): String? {
      if (template.isNullOrBlank() || !template.contains(HOLE)) return null
      return template.replace(HOLE, nickname)
    }
  }
}
