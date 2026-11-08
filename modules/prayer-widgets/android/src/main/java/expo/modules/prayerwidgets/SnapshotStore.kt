package expo.modules.prayerwidgets

import android.content.Context
import android.content.SharedPreferences

/**
 * Where the app leaves the snapshot for the widgets. One SharedPreferences file, one key — this
 * module's own mailbox, deliberately separate from the prayer-marks queue it only ever reads.
 */
internal object SnapshotStore {
  private const val PREFS_NAME = "expo.modules.prayerwidgets.snapshot"
  private const val KEY_SNAPSHOT = "snapshot"

  fun write(context: Context, json: String) {
    prefs(context).edit().putString(KEY_SNAPSHOT, json).apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().remove(KEY_SNAPSHOT).apply()
  }

  /** The parsed snapshot, or `null` when absent/unreadable/wrong-version. */
  fun read(context: Context): Snapshot? = Snapshot.parse(prefs(context).getString(KEY_SNAPSHOT, null))

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
