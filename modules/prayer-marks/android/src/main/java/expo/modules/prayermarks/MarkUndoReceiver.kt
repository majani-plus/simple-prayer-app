package expo.modules.prayermarks

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import expo.modules.buddynicknames.BuddySender
import org.json.JSONObject

/**
 * The **Undo** on the confirmation.
 *
 * It does not reach back into anything. It appends a *second* queue entry naming the first, and
 * takes the confirmation off the screen. If both entries reach the app together — the usual case,
 * because the app was not opened in between — they cancel and nothing was ever written to undo. If
 * the app was opened and drained in between, the orphan undo clears the prayer it names. Either
 * way there is nothing to reverse, which is the whole reason the queue exists (D92).
 *
 * The receiver is declared in this module's manifest rather than registered at runtime: the press
 * usually arrives with the app's process gone, and a runtime-registered receiver dies with it.
 */
class MarkUndoReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      val markId = intent.getStringExtra(MarkConfirmation.EXTRA_MARK_ID) ?: return
      val prayer = intent.getStringExtra(MarkConfirmation.EXTRA_PRAYER) ?: return
      val day = intent.getStringExtra(MarkConfirmation.EXTRA_DAY).orEmpty()
      val confirmationId = intent.getStringExtra(MarkConfirmation.EXTRA_CONFIRMATION_ID)

      val decidedAt = System.currentTimeMillis()
      PendingMarks.append(
        context,
        JSONObject().apply {
          put(PendingMarks.FIELD_ID, "undo@$markId@$decidedAt")
          if (day.isNotEmpty()) put(PendingMarks.FIELD_DAY, day)
          put(PendingMarks.FIELD_PRAYER, prayer)
          put(PendingMarks.FIELD_DECIDED_AT, decidedAt)
          put(PendingMarks.FIELD_ANNULS, markId)
        }
      )

      // The confirmation has said everything it had to say. Nothing replaces it: putting the
      // reminder back would be an accusation, and a second notification confirming the undo of a
      // confirmation is exactly the kind of chatter this app does not do.
      confirmationId?.let { MarkConfirmation.cancel(context, it) }

      // A buddy who was told about the mark is told it was taken back (D180) — silently: a
      // retraction carries no words, and nothing pops up on their phone to announce it.
      // `goAsync` holds the process open for the post; the token is finished in every case.
      if (day.isNotEmpty()) {
        val pending = goAsync()
        Thread {
          try {
            BuddySender.send(context, day, prayer, "cleared")
          } catch (_: Throwable) {
            // The undo is already in the queue; the app tells them on its next open.
          } finally {
            pending.finish()
          }
        }.start()
      }
    } catch (e: Exception) {
      // Throwing from a background broadcast crashes the app where the user cannot see why.
      Log.e("PrayerMarks", "Could not record an undo", e)
    }
  }
}
