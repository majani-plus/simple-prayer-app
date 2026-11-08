package expo.modules.prayermarks

import android.content.Context
import android.util.Log
import expo.modules.buddynicknames.BuddySender
import expo.modules.notifications.notifications.interfaces.NotificationListener
import expo.modules.notifications.notifications.model.NotificationResponse
import org.json.JSONObject

/**
 * What runs when **Prayed** is pressed, with the app's process almost always gone.
 *
 * ## Why this is a `NotificationListener` and not a receiver of our own
 *
 * The button is one of `expo-notifications`' category actions, so the `PendingIntent` behind it is
 * built by the library and points at the library's own broadcast receiver. There is no way to slip
 * a receiver of ours into a notification the library builds, and the two alternatives are both
 * worse: overriding the library's receiver means handling *every* notification event it dispatches
 * (triggers, boot, presentation) and forwarding what we do not want, and posting the reminders
 * ourselves means reimplementing the scheduling this app's reliability rests on.
 *
 * `NotificationManager.addListener` is the library's documented seam for exactly this — "register
 * and be notified of new message events" — and it costs nothing: the library dispatches to it from
 * the receiver it already runs. [PrayerMarksPackage] registers this listener from
 * `Application.onCreate`, which Android calls before it delivers any broadcast, so the listener is
 * in place by the time the press arrives even on a process started *by* that press.
 *
 * ## What it does, and everything it refuses to do
 *
 * Appends one queue entry, clears the reminder, posts the confirmation, and — if buddy mode is on
 * — tells the buddies (D180). It computes no prayer day, touches no database, applies no qada
 * rule. Those live in `src/domain`, in TypeScript, under test, and the app applies them when it
 * next opens (D92).
 *
 * ## Failure
 *
 * Everything is wrapped. A listener that throws here throws inside a broadcast receiver, which
 * crashes the app from the background where the user has no idea what happened — and the mark is
 * lost either way. A press that does nothing is the better failure, and the reminder is still on
 * screen to press again.
 */
internal class PrayerMarkResponder(private val context: Context) : NotificationListener {
  override fun onNotificationResponseReceived(response: NotificationResponse): Boolean {
    if (response.actionIdentifier != ACTION_PRAYED) return false
    try {
      handle(response)
    } catch (e: Exception) {
      Log.e(LOG_TAG, "Could not record a mark from the notification", e)
    }
    return true
  }

  private fun handle(response: NotificationResponse) {
    val request = response.notification.notificationRequest
    val identifier = request.identifier ?: return
    // `content.body` is the `data` payload the app scheduled the reminder with — the same object
    // `services/notifications` writes and `parsePayload` reads back.
    val payload = request.content.body

    // A dress rehearsal (D93): the test notification's press runs the visible half of the loop —
    // clear the notification, show a confirmation — and records nothing, ever. Checked before the
    // prayer guard because a test payload names no prayer on purpose.
    if (payload?.optBoolean(PendingMarks.FIELD_TEST) == true) {
      MarkConfirmation.cancelReminder(context, identifier)
      runCatching { MarkConfirmation.postTest(context) }
      return
    }

    val prayer = payload?.optString(PendingMarks.FIELD_PRAYER).orEmpty()
    if (!PRAYERS.contains(prayer)) return
    // Absent only if a payload ever arrives without one; the app dates such an entry from
    // `decidedAt` through `domain/dates`, which is the only place that boundary is allowed to live.
    val day = payload?.optString(PendingMarks.FIELD_DAY).orEmpty()

    val decidedAt = System.currentTimeMillis()
    val markId = "$identifier@$decidedAt"
    val confirmationId =
      if (day.isEmpty()) "prayer-mark:$markId" else MarkConfirmation.identifierFor(day, prayer)

    // The pressed notification is answered first: whatever else fails after this, the user has
    // spoken and it should not still be sitting there asking. The ongoing notification (D95) is
    // furniture rather than a question, so it is swapped in place — re-posted with the "Next: …"
    // content the app pre-baked — instead of cleared; with no after-content carried (the far end
    // of the planned window) it comes down, and the next foreground redraws whatever is true.
    if (payload?.optBoolean(PendingMarks.FIELD_ONGOING) == true) {
      val swapped = runCatching {
        MarkConfirmation.swapOngoing(
          context,
          identifier,
          payload.optString(PendingMarks.FIELD_AFTER_TITLE).takeIf { it.isNotEmpty() },
          payload.optString(PendingMarks.FIELD_AFTER_BODY).takeIf { it.isNotEmpty() },
          payload.optString(PendingMarks.FIELD_CHANNEL_ID).takeIf { it.isNotEmpty() }
        )
      }.getOrDefault(false)
      if (!swapped) MarkConfirmation.cancelReminder(context, identifier)
    } else {
      MarkConfirmation.cancelReminder(context, identifier)
    }

    // Wrapped, because the queue entry below must be written even if the confirmation cannot be.
    // A press that records nothing is the one failure this feature must not have; a press that
    // records the prayer and shows nothing is merely disappointing.
    val posted = runCatching {
      MarkConfirmation.post(context, day, prayer, markId, confirmationId)
    }.getOrDefault(false)

    PendingMarks.append(
      context,
      JSONObject().apply {
        put(PendingMarks.FIELD_ID, markId)
        if (day.isNotEmpty()) put(PendingMarks.FIELD_DAY, day)
        put(PendingMarks.FIELD_PRAYER, prayer)
        put(PendingMarks.FIELD_DECIDED_AT, decidedAt)
        if (posted) put(PendingMarks.FIELD_CONFIRMATION_ID, confirmationId)
      }
    )

    // The buddies, told from here rather than on the app's next open (D180) — the same reason the
    // widget's tap sends for itself: pressing Prayed on a notification is a whole way of using
    // this app that never opens it.
    //
    // A thread, and no more than that: this runs inside `expo-notifications`' own receiver, so
    // there is no `goAsync` token to hold the process open the way `WidgetTapReceiver` can. The
    // send is bounded at eight seconds and may be cut short with the process; a flag that did not
    // land stays outstanding and goes out on the next open, which is exactly where it was before.
    // An undatable mark is skipped — the day is TypeScript's to derive, never this file's.
    if (day.isNotEmpty()) {
      Thread {
        runCatching { BuddySender.send(context, day, prayer, "prayed") }
      }.start()
    }
  }

  companion object {
    private const val LOG_TAG = "PrayerMarks"

    /**
     * The action identifier the app registers its category with
     * (`services/notifications`' `MARK_PRAYED_ACTION`). The two must stay identical; nothing
     * enforces it but a press that matches nothing, which is why it is a constant on both sides
     * rather than a literal at either.
     */
    const val ACTION_PRAYED = "prayed"

    /** Mirrors `domain/types`' `PRAYERS`. A payload naming anything else is not ours to act on. */
    private val PRAYERS = setOf("fajr", "dhuhr", "asr", "maghrib", "isha")
  }
}
