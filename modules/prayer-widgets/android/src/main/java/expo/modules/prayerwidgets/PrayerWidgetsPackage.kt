package expo.modules.prayerwidgets

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Redraws the widgets whenever the screen comes on or the phone is unlocked (D189).
 *
 * The countdown Chronometer ticks inside the launcher and cannot stop at zero, so if the
 * transition alarm is delayed or dropped (OEM battery managers do both) it runs into negative
 * time. Screen-on and unlock are the moments somebody can actually SEE the widget, so a redraw
 * there means a stale countdown is never looked at. Android delivers these two broadcasts only to
 * receivers registered at runtime, so this lives as long as the app's process — which starts for
 * every alarm, widget update and push, not only when the app is opened.
 */
class PrayerWidgetsPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
          }
          val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
              WidgetRenderer.renderAll(context)
            }
          }
          // Both are protected system broadcasts, so NOT_EXPORTED still receives them.
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            application.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
          } else {
            application.registerReceiver(receiver, filter)
          }
        }
      }
    )
}
