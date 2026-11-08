package expo.modules.prayermarks

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * The notification that replaces the reminder once the user has pressed **Prayed**.
 *
 * It says one thing — *"You marked Maghrib as prayed"* (D130) — carries **Undo**, and takes itself out of the tray
 * after about fifteen seconds. It never congratulates: the reward for praying is not this app's to
 * hand out, and a lock screen is the wrong place to try (`docs/TONE.md`).
 *
 * ## The fifteen seconds are the system's, not ours
 *
 * `setTimeoutAfter` is Android's own "cancel this after N milliseconds", honoured by the system
 * whether or not this app is alive. That is strictly better than the alarm
 * `modules/notification-dismissal` arms for the reminders themselves — it is exact, it needs no
 * `AlarmManager`, and there is no rate limit to trip over — and it is available because *we* build
 * this notification, while the reminders are built inside `expo-notifications` where the flag
 * cannot be reached. Below API 26 it does nothing and the confirmation simply waits to be swiped,
 * which is a small cost on a platform version this app barely sees.
 *
 * ## Why its own channel
 *
 * A confirmation of something the user just did must never make a sound or push anything else off
 * the screen, and the adhan channels are (correctly) loud. So it gets a silent, low-importance
 * channel of its own, which also gives the user one switch to turn exactly this off without
 * touching their reminders.
 *
 * ## Why every builder here declares `CATEGORY_STATUS`
 *
 * All three notifications below are standing information about where the day is — a confirmation
 * of something already done, and the ongoing row's next line. None of them competes for
 * attention, so `status` is the honest label (D146). Android asks apps to name a system-wide
 * category so it can rank and filter correctly; on Android 16 it also feeds the classifier that
 * decides what gets bundled and silenced, which is what prompted us to start declaring one.
 */
internal object MarkConfirmation {
  private const val LOG_TAG = "PrayerMarks"

  /** Silent, low importance, and named by the app in the user's own language. */
  const val CHANNEL_ID = "prayer-mark-confirmation"

  /**
   * How long the confirmation stays. Long enough to notice and undo a mistap while the phone is
   * still in your hand; short enough that it is never something to tidy up later.
   */
  // 15 seconds (owner, 2026-08-28): read it, undo a mistap, gone — the tray never holds
  // yesterday's good news, and a missed undo still has the seal everywhere else.
  const val SELF_DISMISS_MS = 15_000L

  /** The `(tag, id)` convention every notification in this app is posted under; see D88. */
  private const val NOTIFICATION_ID = 0

  /** Identifies the Undo press, and carries what the annulling entry needs. */
  const val EXTRA_MARK_ID = "markId"
  const val EXTRA_DAY = "day"
  const val EXTRA_PRAYER = "prayer"
  const val EXTRA_CONFIRMATION_ID = "confirmationId"

  /** The confirmation for one prayer on one day. Deterministic, so a second press replaces it. */
  fun identifierFor(day: String, prayer: String): String = "prayer-mark:$day:$prayer"

  /**
   * Posts the confirmation, replacing whatever the reminder left on screen.
   *
   * @return `true` when it was posted; `false` when the app has not pushed its copy yet, which is
   *   a reason to stay silent rather than to invent words.
   */
  fun post(
    context: Context,
    day: String,
    prayer: String,
    markId: String,
    confirmationId: String
  ): Boolean {
    val copy = PendingMarks.copyFor(context, prayer) ?: return false
    ensureChannel(context, copy)

    val undo = Intent(context, MarkUndoReceiver::class.java).apply {
      // A distinct data Uri per confirmation: PendingIntent equality ignores extras, so two
      // confirmations sharing one would quietly share the older one's payload.
      data = android.net.Uri.parse("prayer-marks://undo/$confirmationId")
      putExtra(EXTRA_MARK_ID, markId)
      putExtra(EXTRA_DAY, day)
      putExtra(EXTRA_PRAYER, prayer)
      putExtra(EXTRA_CONFIRMATION_ID, confirmationId)
    }
    val undoIntent = PendingIntent.getBroadcast(
      context,
      confirmationId.hashCode(),
      undo,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(iconOf(context))
      .setContentTitle(copy.title)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setSilent(true)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setTimeoutAfter(SELF_DISMISS_MS)
      .addAction(0, copy.undo, undoIntent)

    colorOf(context)?.let(builder::setColor)
    launchIntent(context)?.let(builder::setContentIntent)

    return try {
      NotificationManagerCompat.from(context).notify(confirmationId, NOTIFICATION_ID, builder.build())
      true
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS was revoked between the reminder arriving and the button being pressed.
      // The mark is already queued, which is the part that matters.
      Log.w(LOG_TAG, "Could not post the confirmation", e)
      false
    }
  }

  /**
   * Posts the confirmation for a **test** press (D93). Same silent channel and self-dismissal as
   * the real one, two honest differences: the title says nothing was saved, and there is no Undo —
   * a button undoing nothing would be chrome pretending to be a control.
   *
   * @return `true` when it was posted; `false` when the app has not pushed its copy yet.
   */
  fun postTest(context: Context): Boolean {
    val copy = PendingMarks.copyForTest(context) ?: return false
    ensureChannel(context, copy)

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(iconOf(context))
      .setContentTitle(copy.title)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setSilent(true)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setTimeoutAfter(SELF_DISMISS_MS)

    colorOf(context)?.let(builder::setColor)
    launchIntent(context)?.let(builder::setContentIntent)

    return try {
      NotificationManagerCompat.from(context).notify("prayer-mark:test", NOTIFICATION_ID, builder.build())
      true
    } catch (e: SecurityException) {
      Log.w(LOG_TAG, "Could not post the test confirmation", e)
      false
    }
  }

  /**
   * Re-posts the **ongoing notification** with the after-content its payload carried (D95), so
   * pressing Prayed on it swaps the furniture instead of removing it. Posted under the same
   * `(tag = identifier, id = 0)` expo-notifications uses, which is what makes this a replacement.
   *
   * @return `true` when the swap was posted. `false` — content or channel missing, or the post
   *   refused — tells the caller to take the notification down instead; a sticky notification
   *   whose text has gone stale is worse than a gap the next foreground fills.
   */
  fun swapOngoing(
    context: Context,
    identifier: String,
    title: String?,
    body: String?,
    channelId: String?
  ): Boolean {
    // The channel must already exist: the app created it to post the notification this replaces.
    // Creating one here with made-up properties would fork it; missing means take it down.
    if (title == null || channelId == null) return false

    val builder = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(iconOf(context))
      .setContentTitle(title)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setSilent(true)
      // The same furniture contract the app posts it with: stays until the app takes it down.
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)

    body?.let(builder::setContentText)
    colorOf(context)?.let(builder::setColor)
    launchIntent(context)?.let(builder::setContentIntent)

    return try {
      NotificationManagerCompat.from(context).notify(identifier, NOTIFICATION_ID, builder.build())
      true
    } catch (e: SecurityException) {
      Log.w(LOG_TAG, "Could not swap the ongoing notification", e)
      false
    }
  }

  /** Takes a confirmation out of the tray. A tag that is not there is a no-op. */
  fun cancel(context: Context, confirmationId: String) {
    runCatching {
      NotificationManagerCompat.from(context).cancel(confirmationId, NOTIFICATION_ID)
    }
  }

  /**
   * Takes the reminder that was just answered out of the tray.
   *
   * An action button press does NOT dismiss its notification — `setAutoCancel` covers only a tap
   * on the body — so this is what makes the reminder actually go away. It works on the same
   * `(tag = the identifier we scheduled under, id = 0)` convention `notification-dismissal`
   * documents at length; if `expo-notifications` ever changes it, the reminder would linger
   * beside the confirmation rather than anything breaking.
   */
  fun cancelReminder(context: Context, identifier: String) {
    runCatching {
      NotificationManagerCompat.from(context).cancel(identifier, NOTIFICATION_ID)
    }
  }

  private fun ensureChannel(context: Context, copy: PendingMarks.Copy) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      copy.channelName,
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = copy.channelDescription
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    // Recreating an existing channel updates only its name and description — importance and sound
    // stay wherever the user put them, which is the correct and unavoidable behaviour.
    manager.createNotificationChannel(channel)
  }

  /** The same monochrome icon the reminders use, read from the meta-data expo's plugin writes. */
  private fun iconOf(context: Context): Int {
    return try {
      val info = context.packageManager.getApplicationInfo(
        context.packageName,
        PackageManager.GET_META_DATA
      )
      val key = "expo.modules.notifications.default_notification_icon"
      if (info.metaData?.containsKey(key) == true) {
        info.metaData.getInt(key)
      } else {
        context.applicationInfo.icon
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "Could not read the notification icon", e)
      context.applicationInfo.icon
    }
  }

  /** The reminders' accent colour, so the confirmation is visibly the same app. */
  private fun colorOf(context: Context): Int? {
    return try {
      val info = context.packageManager.getApplicationInfo(
        context.packageName,
        PackageManager.GET_META_DATA
      )
      val key = "expo.modules.notifications.default_notification_color"
      if (info.metaData?.containsKey(key) == true) {
        context.resources.getColor(info.metaData.getInt(key), null)
      } else {
        null
      }
    } catch (e: Exception) {
      null
    }
  }

  /** Tapping the confirmation opens the app, like every other notification this app posts. */
  private fun launchIntent(context: Context): PendingIntent? {
    val launch = runCatching {
      context.packageManager.getLaunchIntentForPackage(context.packageName)
    }.getOrNull() ?: return null
    return PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
