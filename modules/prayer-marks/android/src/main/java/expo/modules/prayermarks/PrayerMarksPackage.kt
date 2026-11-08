package expo.modules.prayermarks

import android.app.Application
import android.content.Context
import android.util.Log
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.notifications.notifications.NotificationManager

/**
 * Registers [PrayerMarkResponder] at the only moment early enough to be useful.
 *
 * Pressing **Prayed** with the app killed starts the process for a broadcast, and Android
 * guarantees `Application.onCreate` runs before that broadcast is delivered. `MainApplication`
 * calls `ApplicationLifecycleDispatcher.onApplicationCreate`, which reaches every autolinked
 * package's listener — including this one. So by the time `expo-notifications` dispatches the
 * press, our listener is already registered and handles it natively. No JavaScript runtime is
 * started, and none is needed.
 *
 * Registering from the Expo module instead would be too late by a long way: modules are built when
 * the React context is created, which in this scenario never happens at all.
 *
 * Autolinking finds this class because the file is named `*Package.kt` and imports
 * `expo.modules.core.interfaces.Package` — see `expo-modules-autolinking`'s Android scan. It does
 * not need to be listed in `expo-module.config.json`.
 */
class PrayerMarksPackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context
  ): List<ApplicationLifecycleListener> = listOf(
    object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        try {
          NotificationManager.addListener(PrayerMarkResponder(application.applicationContext))
        } catch (e: Throwable) {
          // A build without expo-notifications, or a future version that moved this seam. The
          // reminders themselves are unaffected; only the action button stops working, and the
          // app still logs everything from its own screens.
          Log.e("PrayerMarks", "Could not register the notification action listener", e)
        }
      }
    }
  )
}
