package expo.modules.exactalarms

import android.app.AlarmManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The two calls that decide whether a reminder arrives *on the minute*, neither of which
 * `expo-notifications` exposes.
 *
 * ## Why the app needs them
 *
 * `expo-notifications` sets every reminder through `AlarmManager`, and asks the same question
 * first (`ExpoSchedulingDelegate.setupAlarm`):
 *
 * ```kotlin
 * if (SDK_INT < S || alarmManager.canScheduleExactAlarms()) setExactAndAllowWhileIdle(...)
 * else                                                      setAndAllowWhileIdle(...)
 * ```
 *
 * The second branch is a **silent** downgrade: the alarm is still set, still survives Doze, and
 * still fires — whenever the system feels like batching it, which can be many minutes late. On
 * Android 14+ that is the default branch for any app targeting API 33 or higher (we target 36):
 * `SCHEDULE_EXACT_ALARM` is declared in the manifest, which makes it *requestable* and nothing
 * more. A late Fajr is not a cosmetic failure, so the app has to be able to ask the question
 * itself, and to offer the one screen that changes the answer.
 *
 * Three functions, and deliberately no more:
 *
 * - `canScheduleExactAlarms()` — `true` when the system will honour an exact alarm. **Also `true`
 *   below Android 12**, where the permission does not exist and every alarm is exact anyway; the
 *   caller wants "will my adhan be on time", not "does this OS have a permission".
 * - `openExactAlarmSettings()` — shows the system's own *Alarms & reminders* screen for this app,
 *   and answers whether anything took the intent. Only ever called from a tap on a control that
 *   says so; this module never opens anything by itself.
 * - `isIgnoringBatteryOptimizations()` — the second flag that decides whether a dead process gets
 *   woken at all. It lives here rather than in a module of its own for the same reason the two
 *   above share a file: it is one more read of one more OS flag about whether a reminder will
 *   arrive on time, with the same contract and the same inability to make anything worse.
 *   `services/batteryGuidance` had been reporting `'unknown'` for want of exactly this call, and
 *   an honest "we cannot check" is what the Reminder reliability screen had to show instead of a
 *   verdict.
 *
 * **None of them ever schedules, posts or cancels a notification.** Like its neighbour
 * `modules/notification-dismissal` this module cannot make delivery worse — it reads one flag and
 * opens one settings screen — which is what makes it safe to add to the path everything else
 * depends on.
 *
 * `SCHEDULE_EXACT_ALARM` is declared once, in `app.json`'s Android permission list, rather than in
 * a manifest here: it belongs to the app that ships it, and a second declaration in a library
 * manifest would hide it from the one place a reviewer looks.
 *
 * ## Deliberately not `USE_EXACT_ALARM`
 *
 * That permission is granted at install and needs no screen — and Play halts the release of any
 * app that declares it without being categorised as a clock or a calendar. Ours is Lifestyle. See
 * DECISIONS D91.
 */
class ExactAlarmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ExactAlarms")

    AsyncFunction("canScheduleExactAlarms") {
      // Below Android 12 there is no such permission and every alarm is exact.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        true
      } else {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        manager.canScheduleExactAlarms()
      }
    }

    AsyncFunction("openExactAlarmSettings") { openSettingsScreen() }

    /**
     * Whether this app sits on Android's battery-optimisation exemption list.
     *
     * This is the stock flag and nothing more. An OEM battery manager — MIUI's per-app *Battery
     * saver*, EMUI's protected apps, Samsung's sleeping apps — is a separate policy that no public
     * API exposes, so `true` here means "Android's own limits are off", never "nothing on this
     * phone will stop a reminder". The copy on the reliability screen says exactly that.
     */
    AsyncFunction("isIgnoringBatteryOptimizations") {
      val manager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      manager.isIgnoringBatteryOptimizations(context.packageName)
    }
  }

  /**
   * Shows this app's *Alarms & reminders* page.
   *
   * `false` below Android 12, where the screen does not exist because the permission does not
   * either. The version check lives here rather than at the call site so the API-31 constant below
   * is guarded in the same function that uses it.
   *
   * Tried twice on purpose. The documented form carries a `package:` URI so the system lands on
   * our own entry rather than the whole list; a ROM that has replaced the Settings app may reject
   * the data URI while still handling the bare action, and that second chance costs one intent.
   *
   * The current activity is preferred over the application context so the screen opens inside the
   * task the user is already in — a `NEW_TASK` launch from a cold reference puts it in a task of
   * its own, and "back" then does not return to the app.
   *
   * @return `true` when something took the intent; `false` when nothing did, which the JS side
   *         turns into the app's own settings page rather than a dead button.
   */
  private fun openSettingsScreen(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false

    val withPackage = Intent(
      Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
      Uri.fromParts("package", context.packageName, null)
    )
    val bare = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
    return start(withPackage) || start(bare)
  }

  /** Starts one intent, answering whether an activity existed for it. Never throws. */
  private fun start(intent: Intent): Boolean {
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      // Some OEM builds guard the screen; treat it exactly like a missing one.
      false
    }
  }
}
