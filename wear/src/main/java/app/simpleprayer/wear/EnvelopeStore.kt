package app.simpleprayer.wear

import android.content.Context
import android.content.SharedPreferences

/**
 * The one owner of the stored envelope. [EnvelopeListenerService] writes what the phone ships;
 * every surface — app, tile, complication, alerts — reads through here and NEVER caches across
 * process lifetimes: the JSON in prefs is the single truth, and a version the parser refuses is
 * indistinguishable from no envelope at all (the bundled state, never a guess).
 */
internal object EnvelopeStore {
  const val PREFS_NAME = "app.simpleprayer.wear.envelope"
  const val KEY_ENVELOPE = "envelope"

  fun store(context: Context, json: String) {
    prefs(context).edit().putString(KEY_ENVELOPE, json).apply()
  }

  fun load(context: Context): Envelope? = Envelope.parse(prefs(context).getString(KEY_ENVELOPE, null))

  /** Whether anything was ever synced — separates "set up" wording from "refresh" wording. */
  fun hasEverSynced(context: Context): Boolean = prefs(context).contains(KEY_ENVELOPE)

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
