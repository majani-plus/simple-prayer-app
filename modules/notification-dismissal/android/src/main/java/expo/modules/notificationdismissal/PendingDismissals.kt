package expo.modules.notificationdismissal

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log

/**
 * The whole mechanism: a set of "dismiss notification X at time T" entries, and one alarm.
 *
 * ## THE COUPLING, WHICH IS THE ONE THING TO KNOW ABOUT THIS MODULE
 *
 * We dismiss notifications that `expo-notifications` posted, and we do it without touching the
 * library. That works because of one convention in its Android source
 * (`ExpoPresentationDelegate.kt`):
 *
 * ```kotlin
 * NotificationManagerCompat.from(context).notify(
 *   notification.notificationRequest.identifier,   // tag  == OUR identifier
 *   getNotifyId(notification.notificationRequest), // id   == ANDROID_NOTIFICATION_ID, the constant 0
 *   androidNotification
 * )
 * ```
 *
 * So the `(tag, id)` pair of every notification the library posts is `(our identifier, 0)`, and
 * `NotificationManager.cancel(tag, id)` — public Android API, no library involvement — removes it.
 *
 * **If that convention ever changes, this module silently stops working**: cancelling a
 * `(tag, id)` that does not exist is not an error, it is a no-op, so every dismissal would quietly
 * do nothing and the tray would fill up again with nothing to say why.
 * `src/services/notificationDismissal.test.ts` reads the library's own source and fails
 * when either half of the convention moves. Do not delete it; if it goes red, read
 * `ExpoPresentationDelegate.kt` and update [EXPO_NOTIFICATION_ID] and/or the way the tag is
 * derived, rather than relaxing the test.
 *
 * ## Why one alarm and a stored set, rather than one alarm each
 *
 * Up to three of a prayer's notifications share a window end, so they expire at the same instant,
 * and `setAndAllowWhileIdle` is rate-limited to roughly one alarm every nine minutes per app while
 * the device is idle. Three alarms at one instant would therefore be spread over eighteen minutes,
 * for no reason. One alarm at the earliest expiry, which dismisses everything due and re-arms for
 * the next, has none of that and is also less state to keep straight.
 *
 * The set is persisted because the process is expected to be dead: the alarm starts it, the
 * receiver reads the set, and nothing else has to be alive for any of it.
 *
 * ## Why the alarm is inexact
 *
 * `setAndAllowWhileIdle` needs no permission. `setExactAndAllowWhileIdle` would need
 * `SCHEDULE_EXACT_ALARM`, which is a permission this app should not be asking for to tidy a tray —
 * and a dismissal that lands a few minutes late costs nobody anything, unlike a reminder that
 * does. It *is* a wakeup alarm (`RTC_WAKEUP`): the tray should be right before the user looks at
 * it, and at most a handful of these fire a day, next to a notification alarm per prayer.
 *
 * A reboot (or an app update) loses the alarm. That used to be waved through — "a reboot also
 * empties the tray" — which is true of the rows showing at that moment and false for every
 * reminder that fires afterwards: `expo-notifications` re-arms its delivery alarms on boot, so the
 * reminders kept coming and nothing expired them until the next sync that happened to schedule
 * something. The receiver now listens for the boot and package-replaced broadcasts and calls
 * [dismissDue], which re-arms from the persisted set. Dismissing a notification that is not
 * showing is still a no-op, so the catch-up costs nothing.
 *
 * Since 2026-09-13 the platform also enforces each row's expiry itself: the `expo-notifications`
 * patch reads the payload's `expiresAt` and calls `setTimeoutAfter`, which needs no alarm, no
 * permission and no process. This module stays as the belt to that brace until the timeout is
 * seen working on the owner's device, and for the two rules the timeout cannot know about (a
 * prayer logged from the tray, an exempt day), which the app's own sweep handles when it runs.
 */
internal object PendingDismissals {
  private const val LOG_TAG = "NotificationDismissal"
  private const val PREFS_NAME = "expo.modules.notificationdismissal.pending"

  /** One alarm for all of them, so one request code. */
  private const val REQUEST_CODE = 0x504D

  /**
   * The notification id `expo-notifications` posts every notification under —
   * `ExpoPresentationDelegate.ANDROID_NOTIFICATION_ID`, which is `0` and is returned by its
   * `getNotifyId()` for every request. See the class header: this constant is half of the only
   * coupling this module has to the library.
   */
  const val EXPO_NOTIFICATION_ID = 0

  /**
   * Absorbs alarm jitter. Without it an alarm that lands a millisecond early would dismiss nothing
   * and re-arm for a millisecond later.
   */
  private const val DUE_GRACE_MS = 1_000L

  private val lock = Any()

  /** Remembers that `identifier` should be taken out of the tray at `atEpochMs`, and arms the alarm. */
  fun schedule(context: Context, identifier: String, atEpochMs: Long) {
    synchronized(lock) {
      prefs(context).edit().putLong(identifier, atEpochMs).apply()
      rearm(context)
    }
  }

  /** Forgets `identifier`. Called when the app cancels or dismisses the notification itself. */
  fun cancel(context: Context, identifier: String) {
    synchronized(lock) {
      prefs(context).edit().remove(identifier).apply()
      rearm(context)
    }
  }

  /**
   * Takes every entry that is due out of the tray and out of the set, then arms the alarm for
   * whatever is left. This is what the alarm actually runs.
   */
  fun dismissDue(context: Context, now: Long) {
    synchronized(lock) {
      val stored = prefs(context)
      val editor = stored.edit()
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      for ((identifier, value) in stored.all) {
        val at = value as? Long
        if (at == null) {
          // Not something we wrote. Drop it rather than trip over it for ever.
          editor.remove(identifier)
          continue
        }
        if (at > now + DUE_GRACE_MS) continue
        // The cancel that does the work. A tag that is not in the tray is a no-op, which is the
        // common case: most reminders are dismissed by the app long before they expire.
        manager.cancel(identifier, EXPO_NOTIFICATION_ID)
        editor.remove(identifier)
      }
      editor.apply()
      rearm(context)
    }
  }

  /**
   * Points the single alarm at the earliest expiry we still hold, or cancels it when there is
   * nothing left. Always called with [lock] held.
   */
  private fun rearm(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pendingIntent = PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      Intent(context, NotificationDismissalReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    alarms.cancel(pendingIntent)

    val next = prefs(context).all.values.filterIsInstance<Long>().minOrNull() ?: return
    try {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent)
    } catch (e: Exception) {
      // An OEM refusing the alarm must not take the caller down with it. The app's own tray sweep
      // still runs on every foreground; this is the part that works without one.
      Log.e(LOG_TAG, "Could not arm the dismissal alarm", e)
    }
  }

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
