package expo.modules.buddynicknames

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

/**
 * The seal tap tells the buddies itself (D180).
 *
 * ## Why this is here rather than in the app
 *
 * Before this, a tap on a widget appended to the D92 queue and stopped. The buddies were told when
 * the app was next opened — which for somebody who marks their prayers from the homescreen can be
 * the following evening. The thing a widget is *for* is not opening the app, so the sending had to
 * move to where the tap lands: a broadcast receiver, with no React runtime anywhere near it.
 *
 * ## What it can and cannot know
 *
 * This process has no JavaScript, no MMKV and no translations. Everything it needs the app left
 * behind before the tap happened: the relay credentials in [SecretStore], and an outbox in
 * [BridgeStore] naming the pairs and holding the sentence already written in each buddy's own
 * language. It composes nothing and decides nothing — it posts what it was given.
 *
 * There is no nickname here and there never will be. The sentence with a name in it is the one
 * with `{}` where the name goes; the receiving phone fills the hole from its own roster (D174).
 *
 * ## Failure, and the eight seconds
 *
 * `HttpURLConnection` on one thread per pair, joined under a single deadline. A receiver is not
 * given long — the caller holds the process open with `goAsync` and Android will not wait for ever
 * — so the whole attempt is bounded, and a pair that could not be told stays outstanding for the
 * app to tell on its next open, exactly as before this file existed. Nothing is thrown at the
 * caller: an exception out of a receiver crashes the app from the background, where the person has
 * no idea what happened.
 */
object BuddySender {
  /** Mirrored from `RELAY_ORIGIN` in `src/services/buddyRelay.ts`. The one host this app talks to. */
  private const val ORIGIN = "https://relay.simpleprayer.app"

  private const val CONNECT_TIMEOUT_MS = 5_000
  private const val READ_TIMEOUT_MS = 5_000

  /** Nobody waits on a buddy — the app's own client says the same and uses the same eight seconds. */
  private const val TOTAL_TIMEOUT_MS = 8_000L

  private class Recipient(val pairId: String, val title: String?, val titleNamed: String?)

  private class Outbox(val lang: String, val notify: Boolean, val pairs: JSONArray)

  /**
   * Tell every paired buddy what this mark asserted.
   *
   * @param day The prayer day the mark belongs to — from the snapshot or the payload, never
   *   re-derived here; a day boundary is TypeScript's alone (`src/domain/dates.ts`).
   * @param prayer `fajr` … `isha`.
   * @param state `prayed`, or `cleared` when a mark was taken back.
   */
  @JvmStatic
  fun send(context: Context, day: String, prayer: String, state: String) {
    try {
      if (alreadySent(context, day, prayer, state)) return
      val auth = credentials(context) ?: return
      val outbox = outbox(context) ?: return
      val recipients = recipients(outbox, prayer, state)
      if (recipients.isEmpty()) return

      val settled = AtomicBoolean(false)
      val threads = recipients.map { recipient ->
        Thread {
          if (post(auth, recipient, day, prayer, state, outbox.lang, outbox.notify)) {
            settled.set(true)
          }
        }
      }
      threads.forEach { it.start() }

      val deadline = System.currentTimeMillis() + TOTAL_TIMEOUT_MS
      for (thread in threads) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) break
        thread.join(left)
      }

      // Recorded only once it has actually gone somewhere, and only as one line for the whole mark
      // — the app's own ledger is per prayer, not per pair, so a flag that reached one buddy and
      // not another counts as sent there too. A pair that heard nothing hears it on the next open,
      // and so does everybody if a late answer arrives after the deadline above.
      if (settled.get()) appendSent(context, day, prayer, state)
    } catch (_: Throwable) {
      // Silent by design: the mark itself is already in the queue, which is the part that matters.
    }
  }

  // ---------------------------------------------------------------------------
  // The wire
  // ---------------------------------------------------------------------------

  /**
   * @return True when the relay has taken responsibility for this flag — 202, or 404 for a pair
   *   that no longer exists, which is settled in the only sense that matters: never retry it.
   */
  private fun post(
    auth: Pair<String, String>,
    recipient: Recipient,
    day: String,
    prayer: String,
    state: String,
    lang: String,
    notify: Boolean
  ): Boolean {
    var connection: HttpURLConnection? = null
    return try {
      val body = JSONObject()
        .put("pairId", recipient.pairId)
        .put("day", day)
        .put("prayer", prayer)
        .put("state", state)
        .put("lang", lang)
        .put("notify", notify)
      // Words only for a buddy who wants to be told, and only about a prayer — a retraction is
      // always silent, because there is nothing good to announce about it.
      if (recipient.title != null && recipient.titleNamed != null) {
        body.put("title", recipient.title)
        body.put("titleNamed", recipient.titleNamed)
      }

      connection = (URL("$ORIGIN/send").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        doOutput = true
        setRequestProperty("Authorization", "Bearer ${auth.first}.${auth.second}")
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Accept", "application/json")
      }
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

      val status = connection.responseCode
      status == 202 || status == 404
    } catch (_: Throwable) {
      false
    } finally {
      connection?.disconnect()
    }
  }

  // ---------------------------------------------------------------------------
  // What the app left behind
  // ---------------------------------------------------------------------------

  private fun recipients(outbox: Outbox, prayer: String, state: String): List<Recipient> {
    val recipients = mutableListOf<Recipient>()
    for (index in 0 until outbox.pairs.length()) {
      val pair = outbox.pairs.optJSONObject(index) ?: continue
      val pairId = pair.optString("pairId").ifBlank { null } ?: continue
      val text = if (state == "prayed") {
        pair.optJSONObject("titles")?.optJSONObject(prayer)
      } else {
        null
      }
      val title = text?.optString("title")?.ifBlank { null }
      val titleNamed = text?.optString("titleNamed")?.ifBlank { null }
      recipients.add(Recipient(pairId, title, titleNamed))
    }
    return recipients
  }

  private fun outbox(context: Context): Outbox? {
    val raw = BridgeStore.read(context, BridgeStore.KEY_OUTBOX) ?: return null
    val parsed = runCatching { JSONObject(raw) }.getOrNull() ?: return null
    if (parsed.optInt("v") != 1) return null
    val pairs = parsed.optJSONArray("pairs") ?: return null
    return Outbox(
      lang = parsed.optString("lang").ifBlank { "en" },
      notify = parsed.optBoolean("notify", true),
      pairs = pairs
    )
  }

  /** This phone's relay id and the secret that proves it, as the app stored them. */
  private fun credentials(context: Context): Pair<String, String>? {
    val raw = SecretStore.read(context) ?: return null
    val parsed = runCatching { JSONObject(raw) }.getOrNull() ?: return null
    val deviceId = parsed.optString("deviceId").ifBlank { null } ?: return null
    val secret = parsed.optString("secret").ifBlank { null } ?: return null
    return deviceId to secret
  }

  /**
   * Whether the buddies have already heard this, and nothing has changed since.
   *
   * The app's own rule, applied to the same ledger: what matters is the LAST thing said about this
   * prayer today, so prayed → cleared → prayed still sends three times, and two presses of the same
   * button send once. Only the undrained window is covered — the app empties this on its next open,
   * and its own ledger takes over from there.
   */
  private fun alreadySent(context: Context, day: String, prayer: String, state: String): Boolean {
    val raw = BridgeStore.read(context, BridgeStore.KEY_WIDGET_SENT) ?: return false
    val entries = runCatching { JSONArray(raw) }.getOrNull() ?: return false
    var last: String? = null
    for (index in 0 until entries.length()) {
      val entry = entries.optJSONObject(index) ?: continue
      if (entry.optString("day") != day || entry.optString("prayer") != prayer) continue
      last = entry.optString("state")
    }
    return last == state
  }

  /**
   * Leave a line for the app: this one is already told.
   *
   * Read, append, write — two taps in the same millisecond are not a concern here, because a person
   * has one finger on one seal. What this prevents is the far more likely thing: the app opening
   * later, seeing a prayer its own ledger has no record of announcing, and announcing it again.
   */
  private fun appendSent(context: Context, day: String, prayer: String, state: String) {
    val existing = BridgeStore.read(context, BridgeStore.KEY_WIDGET_SENT)
    val entries = runCatching { JSONArray(existing ?: "[]") }.getOrDefault(JSONArray())
    entries.put(
      JSONObject()
        .put("day", day)
        .put("prayer", prayer)
        .put("state", state)
        .put("at", System.currentTimeMillis())
    )
    BridgeStore.write(context, BridgeStore.KEY_WIDGET_SENT, entries.toString())
  }
}
