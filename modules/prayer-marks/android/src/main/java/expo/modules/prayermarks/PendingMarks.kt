package expo.modules.prayermarks

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * The queue itself: what the user asserted from a notification, waiting for the app to be opened.
 *
 * ## Shape, and why it is this dumb
 *
 * One SharedPreferences file, one string per entry, keyed `mark:<id>`, holding the JSON the app
 * will read back. Appending is a single `putString` — no list to read, merge and write back, which
 * matters because two presses can be handled by two broadcasts at once and a read-modify-write
 * would lose one of them.
 *
 * The entries are never interpreted here. This object does not know what a prayer day is, whether
 * a prayer can be marked twice, or what an undo means; all of that is `src/domain/pendingMarks`,
 * in TypeScript, under test. Native code that decided any of it would be a second copy of the
 * domain — the thing this whole design exists to avoid (D92).
 *
 * ## Read, then acknowledge
 *
 * The app reads without emptying, applies the writes, and only then acknowledges. A crash in
 * between costs nothing: the entries are still here next launch, and applying them a second time
 * is a no-op by construction. A single draining read would be shorter and would occasionally throw
 * away someone's "I prayed", which is the one failure this feature must not have.
 *
 * ## The copy lives here too
 *
 * The confirmation notification is composed with the app gone, so its words have to be on disk
 * before the button is pressed. The app pushes them (already translated) whenever it rebuilds the
 * notification schedule. There is deliberately no English fallback: with nothing stored, the mark
 * is still queued and the reminder still cleared, but no confirmation is posted — a silent gap
 * beats showing an Arabic reader an English word.
 */
internal object PendingMarks {
  private const val PREFS_NAME = "expo.modules.prayermarks.pending"

  private const val MARK_PREFIX = "mark:"
  private const val COPY_TITLE_PREFIX = "copy:title:"
  private const val COPY_TEST_TITLE = "copy:testTitle"
  private const val COPY_UNDO = "copy:undo"
  private const val COPY_CHANNEL_NAME = "copy:channelName"
  private const val COPY_CHANNEL_DESCRIPTION = "copy:channelDescription"

  /** Field names, shared verbatim with `domain/pendingMarks`' `PendingMark`. */
  const val FIELD_ID = "id"
  const val FIELD_DAY = "day"
  const val FIELD_PRAYER = "prayer"
  const val FIELD_DECIDED_AT = "decidedAt"
  const val FIELD_ANNULS = "annuls"
  const val FIELD_CONFIRMATION_ID = "confirmationId"

  /**
   * Payload field marking a **dress rehearsal** (`prayer-marks`' `MARK_TEST_FIELD`): the press is
   * answered on screen but never queued. It is a notification-payload field, not a queue field —
   * a test entry must never exist for the app to drain.
   */
  const val FIELD_TEST = "test"

  /**
   * Payload fields for a press on the **ongoing notification** (D95) — notification-payload
   * fields, not queue fields. `FIELD_ONGOING` says "swap me in place instead of clearing me";
   * the after-content is the localized "Next: …" line the app pre-baked, and the channel is the
   * one the app posts the ongoing notification on. Mirrored in `prayer-marks/index.ts`.
   */
  const val FIELD_ONGOING = "ongoing"
  const val FIELD_AFTER_TITLE = "afterTitle"
  const val FIELD_AFTER_BODY = "afterBody"
  const val FIELD_CHANNEL_ID = "channelId"

  private val lock = Any()

  /** The words the confirmation needs, as the app last pushed them. */
  internal data class Copy(
    val title: String,
    val undo: String,
    val channelName: String,
    val channelDescription: String
  )

  /**
   * Appends one entry.
   *
   * @param mark The entry as JSON; it must carry [FIELD_ID].
   */
  fun append(context: Context, mark: JSONObject) {
    val id = mark.optString(FIELD_ID)
    if (id.isEmpty()) return
    synchronized(lock) {
      prefs(context).edit().putString(MARK_PREFIX + id, mark.toString()).apply()
    }
  }

  /**
   * Every entry, as a JSON array string. Does not remove anything — see the class header.
   *
   * Unparseable entries are returned as they are and left for the app to reject and acknowledge;
   * dropping them here would put two opinions about what a valid entry is in two languages.
   */
  fun readAll(context: Context): String {
    val out = JSONArray()
    synchronized(lock) {
      for ((key, value) in prefs(context).all) {
        if (!key.startsWith(MARK_PREFIX)) continue
        val json = value as? String ?: continue
        out.put(runCatching { JSONObject(json) }.getOrElse { JSONObject().put(FIELD_ID, key.removePrefix(MARK_PREFIX)) })
      }
    }
    return out.toString()
  }

  /**
   * Forgets entries whose writes have landed, and reports the confirmations they left in the tray
   * so the caller can take those out too.
   *
   * @return The `confirmationId` of every acknowledged entry that had one.
   */
  fun acknowledge(context: Context, ids: List<String>): List<String> {
    if (ids.isEmpty()) return emptyList()
    val confirmations = mutableListOf<String>()
    synchronized(lock) {
      val stored = prefs(context)
      val editor = stored.edit()
      for (id in ids) {
        val key = MARK_PREFIX + id
        val json = stored.getString(key, null)
        if (json != null) {
          runCatching { JSONObject(json).optString(FIELD_CONFIRMATION_ID) }
            .getOrNull()
            ?.takeIf { it.isNotEmpty() }
            ?.let(confirmations::add)
        }
        editor.remove(key)
      }
      editor.apply()
    }
    return confirmations
  }

  /** Replaces the stored copy. Called whenever the app rebuilds its notification schedule. */
  fun putCopy(
    context: Context,
    titles: Map<String, String>,
    undo: String,
    channelName: String,
    channelDescription: String,
    testTitle: String?
  ) {
    synchronized(lock) {
      val editor = prefs(context).edit()
      for ((prayer, title) in titles) {
        editor.putString(COPY_TITLE_PREFIX + prayer, title)
      }
      editor.putString(COPY_UNDO, undo)
      editor.putString(COPY_CHANNEL_NAME, channelName)
      editor.putString(COPY_CHANNEL_DESCRIPTION, channelDescription)
      if (testTitle != null) editor.putString(COPY_TEST_TITLE, testTitle)
      editor.apply()
    }
  }

  /**
   * The copy for a **test** press, or `null` when the app has never pushed it — same
   * no-English-fallback rule as [copyFor]: with nothing stored, the press still clears the test
   * notification, and no confirmation is posted.
   */
  fun copyForTest(context: Context): Copy? {
    synchronized(lock) {
      val stored = prefs(context)
      val title = stored.getString(COPY_TEST_TITLE, null) ?: return null
      val undo = stored.getString(COPY_UNDO, null) ?: return null
      val channelName = stored.getString(COPY_CHANNEL_NAME, null) ?: return null
      val channelDescription = stored.getString(COPY_CHANNEL_DESCRIPTION, null) ?: return null
      return Copy(title, undo, channelName, channelDescription)
    }
  }

  /** The copy for one prayer, or `null` when the app has never pushed any. */
  fun copyFor(context: Context, prayer: String): Copy? {
    synchronized(lock) {
      val stored = prefs(context)
      val title = stored.getString(COPY_TITLE_PREFIX + prayer, null) ?: return null
      val undo = stored.getString(COPY_UNDO, null) ?: return null
      val channelName = stored.getString(COPY_CHANNEL_NAME, null) ?: return null
      val channelDescription = stored.getString(COPY_CHANNEL_DESCRIPTION, null) ?: return null
      return Copy(title, undo, channelName, channelDescription)
    }
  }

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
