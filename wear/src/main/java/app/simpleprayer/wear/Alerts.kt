package app.simpleprayer.wear

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import androidx.wear.tiles.TileService
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit

/**
 * The Wear-only conditional adhan (Milestone V scope): watch-local alerts exist here BECAUSE the
 * duplicate can be ruled out — at the alarm's own moment the watch asks who is connected, and a
 * phone in range means the phone's bridged notification already covers the wrist, so this module
 * stays silent. It schedules exactly ONE alarm — the next future entry — and re-arms after each
 * fire, on every envelope arrival, and on boot. It reminds nobody while a phone is in range, and
 * it never schedules anything but what `alerts.entries` pre-rendered.
 */
internal object AlertScheduler {
  const val CHANNEL_ID = "wear-adhan"
  const val ADHAN_NOTIFICATION_ID = 71
  const val CONFIRM_NOTIFICATION_ID = 72
  private const val ALARM_REQUEST_CODE = 70

  const val EXTRA_DAY = "day"
  const val EXTRA_PRAYER = "prayer"
  const val EXTRA_AT = "at"
  const val EXTRA_MARK_ID = "markId"

  /** Points the single alarm slot at the next future entry (or clears it when none is left). */
  fun rearm(context: Context) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val entry = EnvelopeStore.load(context)?.alerts?.entries
      ?.firstOrNull { it.at > System.currentTimeMillis() }
    val intent = Intent(context, AlertFireReceiver::class.java)
    if (entry == null) {
      alarms.cancel(
        PendingIntent.getBroadcast(
          context, ALARM_REQUEST_CODE, intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
      return
    }
    intent.putExtra(EXTRA_DAY, entry.day).putExtra(EXTRA_PRAYER, entry.prayer).putExtra(EXTRA_AT, entry.at)
    val pending = PendingIntent.getBroadcast(
      context, ALARM_REQUEST_CODE, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    // Inexact-while-idle is enough: the adhan marks a window opening, not a stopwatch, and it
    // spares both the exact-alarm permission and the battery.
    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.at, pending)
  }

  /** True when a paired phone is reachable — whose bridged notification then covers the wrist. */
  fun phoneIsInRange(context: Context): Boolean =
    runCatching {
      Tasks.await(
        com.google.android.gms.wearable.Wearable.getNodeClient(context).connectedNodes,
        5, TimeUnit.SECONDS
      ).isNotEmpty()
    }.getOrDefault(true) // Unknown reads as "in range": a missed buzz beats a duplicate one.

  fun ensureChannel(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      context.getString(R.string.wear_channel_name),
      NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      description = context.getString(R.string.wear_channel_description)
      enableVibration(true)
    }
    manager.createNotificationChannel(channel)
  }

  fun canNotify(context: Context): Boolean =
    context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED

  fun builder(context: Context): Notification.Builder =
    Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(Icon.createWithResource(context, R.drawable.ic_mosque))
}

/** The alarm's moment: ask who is connected, then either stay silent or speak the entry. */
class AlertFireReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val result = goAsync()
    Thread {
      try {
        // Re-arm first: whatever happens below, the next entry must not be lost.
        AlertScheduler.rearm(context)

        val envelope = EnvelopeStore.load(context) ?: return@Thread
        val day = intent.getStringExtra(AlertScheduler.EXTRA_DAY) ?: return@Thread
        val prayer = intent.getStringExtra(AlertScheduler.EXTRA_PRAYER) ?: return@Thread
        val at = intent.getLongExtra(AlertScheduler.EXTRA_AT, 0L)
        // The entry is re-read from the CURRENT envelope: a schedule replaced since this alarm
        // was set means the extras describe a plan that no longer exists — say nothing.
        val entry = envelope.alerts.entries
          .firstOrNull { it.day == day && it.prayer == prayer && it.at == at } ?: return@Thread

        if (AlertScheduler.phoneIsInRange(context)) return@Thread
        if (!AlertScheduler.canNotify(context)) return@Thread

        AlertScheduler.ensureChannel(context)
        val markIntent = Intent(context, AlertMarkReceiver::class.java)
          .putExtra(AlertScheduler.EXTRA_DAY, entry.day)
          .putExtra(AlertScheduler.EXTRA_PRAYER, entry.prayer)
          .putExtra(AlertScheduler.EXTRA_AT, entry.at)
        val markPending = PendingIntent.getBroadcast(
          context, 73, markIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = AlertScheduler.builder(context)
          .setContentTitle(entry.title)
          .setContentText(entry.body)
          .addAction(
            Notification.Action.Builder(null as Icon?, envelope.alerts.prayedLabel, markPending).build()
          )
          .setAutoCancel(true)
          .build()
        context.getSystemService(NotificationManager::class.java)
          ?.notify(AlertScheduler.ADHAN_NOTIFICATION_ID, notification)
      } finally {
        result.finish()
      }
    }.start()
  }
}

/** The "I prayed" action: append the mark, confirm quietly, offer one Undo, then get out of the way. */
class AlertMarkReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val day = intent.getStringExtra(AlertScheduler.EXTRA_DAY) ?: return
    val prayer = intent.getStringExtra(AlertScheduler.EXTRA_PRAYER) ?: return
    val at = intent.getLongExtra(AlertScheduler.EXTRA_AT, 0L)
    val envelope = EnvelopeStore.load(context)

    val markId = WearPendingMarks.appendTap(context, day, prayer, clears = false)
    TileService.getUpdater(context).requestUpdate(PrayerTileService::class.java)

    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.cancel(AlertScheduler.ADHAN_NOTIFICATION_ID)
    if (envelope == null || !AlertScheduler.canNotify(context)) return
    val markedTitle = envelope.alerts.entries
      .firstOrNull { it.day == day && it.prayer == prayer && it.at == at }?.markedTitle ?: return

    val undoIntent = Intent(context, AlertUndoReceiver::class.java)
      .putExtra(AlertScheduler.EXTRA_DAY, day)
      .putExtra(AlertScheduler.EXTRA_PRAYER, prayer)
      .putExtra(AlertScheduler.EXTRA_MARK_ID, markId)
    val undoPending = PendingIntent.getBroadcast(
      context, 74, undoIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    AlertScheduler.ensureChannel(context)
    val confirmation = AlertScheduler.builder(context)
      .setContentTitle(markedTitle)
      .addAction(Notification.Action.Builder(null as Icon?, envelope.alerts.undoLabel, undoPending).build())
      // The confirmation is a receipt, not a resident: it excuses itself.
      .setTimeoutAfter(15_000)
      .setAutoCancel(true)
      .build()
    manager.notify(AlertScheduler.CONFIRM_NOTIFICATION_ID, confirmation)
  }
}

/** The confirmation's Undo: annul exactly the decision the action made — never a bare clears. */
class AlertUndoReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val day = intent.getStringExtra(AlertScheduler.EXTRA_DAY) ?: return
    val prayer = intent.getStringExtra(AlertScheduler.EXTRA_PRAYER) ?: return
    val markId = intent.getStringExtra(AlertScheduler.EXTRA_MARK_ID) ?: return
    WearPendingMarks.appendAnnul(context, day, prayer, targetId = markId)
    TileService.getUpdater(context).requestUpdate(PrayerTileService::class.java)
    context.getSystemService(NotificationManager::class.java)
      ?.cancel(AlertScheduler.CONFIRM_NOTIFICATION_ID)
  }
}

/** Alarms do not survive a reboot; the plan does. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED) AlertScheduler.rearm(context)
  }
}
