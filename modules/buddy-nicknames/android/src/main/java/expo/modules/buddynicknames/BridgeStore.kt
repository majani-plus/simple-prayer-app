package expo.modules.buddynicknames

import android.content.Context
import android.content.SharedPreferences

/**
 * The drawer the app leaves things in for the processes that run when no JS can.
 *
 * Its own SharedPreferences file, not the widget snapshot's and not MMKV's: a notification
 * arriving at a phone with nothing running, and a seal tap on a widget, both have to be able to
 * read this. Three tenants, each with exactly one job
 * (`modules/buddy-nicknames/index.ts` explains why they exist):
 *
 * - `nicknames` — `{ pairId: nickname }`, read by [BuddyMessagingService].
 * - `outbox` — who to tell when a prayer is marked with no app running, and the sentence to tell
 *   them in. Never a nickname.
 * - `widgetSent` — what a widget tap already told them, for the app to absorb so it does not say
 *   it twice.
 *
 * Reads are best-effort by design. Unreadable, missing or malformed all mean the same thing to the
 * caller — nothing to do — and the feature quietly behaves as it did before any of this existed.
 */
internal object BridgeStore {
  private const val PREFS_NAME = "expo.modules.buddynicknames"

  const val KEY_NICKNAMES = "nicknames"
  const val KEY_OUTBOX = "outbox"
  const val KEY_WIDGET_SENT = "widgetSent"
  const val KEY_SECRET = "secret"

  fun write(context: Context, key: String, json: String) {
    prefs(context).edit().putString(key, json).apply()
  }

  fun read(context: Context, key: String): String? = prefs(context).getString(key, null)

  fun clear(context: Context, key: String) {
    prefs(context).edit().remove(key).apply()
  }

  /**
   * The widget's ledger, read and emptied in one go.
   *
   * Emptied because the app is about to fold these into its own record of what it has told each
   * buddy: leaving them behind would have the next drain absorb them a second time, which is
   * harmless but untrue. An entry written between the read and the removal is lost — a buddy is
   * then told twice, the only failure this ledger has, and a far smaller one than a mark that is
   * announced twice on every open.
   */
  fun takeWidgetSent(context: Context): String {
    val prefs = prefs(context)
    val raw = prefs.getString(KEY_WIDGET_SENT, null) ?: "[]"
    prefs.edit().remove(KEY_WIDGET_SENT).apply()
    return raw
  }

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
