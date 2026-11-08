package expo.modules.notificationdismissal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * What the dismissal alarm wakes up. The app's process is usually not running when this happens —
 * that is the entire point of the module — so the broadcast starts it, this runs, and it ends.
 * Nothing here touches React Native or the JS runtime.
 *
 * Declared in this module's `AndroidManifest.xml`; a runtime-registered receiver would die with
 * the process and never fire.
 *
 * The same receiver also hears the system's boot and package-replaced broadcasts (see the
 * manifest). Both drop every pending alarm, and the stored set of expiries survives them in
 * SharedPreferences, so the work is identical: dismiss whatever fell due while the alarm was gone
 * and re-arm for the rest. Before this, a reboot left the reminders firing (`expo-notifications`
 * re-arms its own alarms on boot) and the dismissals silent until the next sync that scheduled
 * something — which, in the steady state, is the next day.
 */
class NotificationDismissalReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      // Whether the alarm fired or the device came back, the answer is the same call:
      // `dismissDue` cancels what is due and re-arms for the earliest expiry still held.
      PendingDismissals.dismissDue(context, System.currentTimeMillis())
    } catch (e: Exception) {
      // A broadcast receiver that throws crashes the app from the background, where the user has
      // no idea what happened. A tray that stays untidy is the better failure.
      Log.e("NotificationDismissal", "Dismissal alarm failed", e)
    }
  }
}
