package expo.modules.audiopause

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * What the pause alarm wakes up. The app's process is usually not running when this happens —
 * that is the entire point of the module — so the broadcast starts it, this runs, and it ends.
 * Nothing here touches React Native or the JS runtime.
 *
 * Declared in this module's `AndroidManifest.xml`; a runtime-registered receiver would die with
 * the process and never fire.
 */
class AudioPauseReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      PendingPauses.pauseDue(context, System.currentTimeMillis())
    } catch (e: Exception) {
      // A broadcast receiver that throws crashes the app from the background, where the user has
      // no idea what happened. Music that keeps playing is the better failure.
      Log.e("AudioPause", "Pause alarm failed", e)
    }
  }
}
