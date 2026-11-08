package expo.modules.prayerwidgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The redraws between app opens: one alarm at the next segment boundary, re-armed after every
 * fire and every snapshot write.
 *
 * Exact when the app may schedule exact alarms (see [armNext]), inexact otherwise. The countdown
 * Chronometer cannot stop at zero, so a late redraw shows negative time; D189 backs this alarm
 * with screen-on / unlock redraws ([PrayerWidgetsPackage]) and a 30-minute system tick, so the
 * first time anyone LOOKS at the widget after a boundary it is drawn fresh. D91 stays untouched —
 * the module rule "it never schedules a reminder" holds: this redraws pixels, it reminds nobody.
 */
internal object TransitionAlarms {
  private const val REQUEST_CODE = 200
  private const val MINUTE_REQUEST_CODE = 201

  fun armNext(context: Context, snapshot: Snapshot?, now: Long) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val boundary = snapshot?.segmentAt(now)?.to
    if (snapshot == null || boundary == null) {
      alarmManager.cancel(pendingIntent(context))
      return
    }
    // The LAST fire lands just past expiry and draws the honest "times need a refresh" state —
    // cancelling there instead would leave the final day's schedule up forever, the exact
    // staleness this module promises never to show. Past expiry there is nothing left to arm.
    val fireAt = if (boundary >= snapshot.expiresAt) snapshot.expiresAt else boundary
    if (fireAt <= now) {
      alarmManager.cancel(pendingIntent(context))
      return
    }
    // A second past the boundary, so the fire lands on the far side and draws the NEW segment.
    val triggerAt = fireAt + 1000
    val pending = pendingIntent(context)
    // Exact where the OS lets us (the app already declares SCHEDULE_EXACT_ALARM for reminders):
    // the inexact alarm was batched or deferred by OEM battery savers (Xiaomi HyperOS), so the
    // Chronometer ran past zero into negative time before the redraw came. Exact still redraws
    // pixels only; it reminds nobody. Falls back to inexact if the grant is missing or revoked.
    val canExact =
      android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S ||
        alarmManager.canScheduleExactAlarms()
    if (canExact) {
      try {
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
        return
      } catch (_: SecurityException) {
        // Permission revoked between the check and the call: fall through to inexact.
      }
    }
    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC, triggerAt, pending)
  }

  /**
   * The calm countdown's minute tick (D198): it shows H:MM as plain text, so it is redrawn when
   * the shown minute changes — only while one is showing ([calmTarget] non-null); otherwise the
   * tick is cancelled and never re-armed. NON-wakeup (`RTC`): a sleeping phone is not woken to
   * repaint a widget nobody sees; the tick lands when it next wakes, and screen-on / unlock
   * redraw anyway (D189). Same receiver as the boundary alarm, since a redraw is a redraw.
   */
  fun armMinute(context: Context, calmTarget: Long?, now: Long) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pending = pendingIntent(context, MINUTE_REQUEST_CODE)
    if (calmTarget == null || calmTarget <= now) {
      alarmManager.cancel(pending)
      return
    }
    // The text rounds minutes up, so it changes when the time left drops to a whole minute.
    val shown = (calmTarget - now + 59_999) / 60_000
    val triggerAt = calmTarget - (shown - 1) * 60_000 + 500
    val canExact =
      android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S ||
        alarmManager.canScheduleExactAlarms()
    if (canExact) {
      try {
        alarmManager.setExact(AlarmManager.RTC, triggerAt, pending)
        return
      } catch (_: SecurityException) {
        // Revoked between the check and the call: fall through to the window.
      }
    }
    // ponytail: Android 12+ may stretch a short window toward 10 minutes without the exact grant;
    // screen-on / unlock still redraw, so the minute is right whenever somebody looks.
    alarmManager.setWindow(AlarmManager.RTC, triggerAt, 10_000, pending)
  }

  fun cancel(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarmManager.cancel(pendingIntent(context))
    alarmManager.cancel(pendingIntent(context, MINUTE_REQUEST_CODE))
  }

  private fun pendingIntent(context: Context, requestCode: Int = REQUEST_CODE): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      requestCode,
      Intent(context, TransitionReceiver::class.java).setAction(TransitionReceiver.ACTION_TRANSITION),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}

/**
 * Fires at a prayer transition (and after reboots and clock/timezone changes, which silently
 * killed the armed alarm or moved the ground under it) and redraws — [WidgetRenderer.renderAll]
 * re-arms the next boundary itself.
 */
class TransitionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_TRANSITION,
      ACTION_QUICKBOOT,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_TIME_CHANGED -> WidgetRenderer.renderAll(context)
    }
  }

  companion object {
    const val ACTION_TRANSITION = "expo.modules.prayerwidgets.TRANSITION"
    /** Sent instead of BOOT_COMPLETED by some OEM fast-boot paths (HTC, some Xiaomi builds). */
    const val ACTION_QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON"
  }
}
