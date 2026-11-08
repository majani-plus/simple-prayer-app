package expo.modules.prayerwidgets

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import expo.modules.buddynicknames.BuddySender

/**
 * A seal tap on a widget — the whole feature, in one receiver.
 *
 * Native, manifest-declared, and process-independent on purpose (the `MarkUndoReceiver` pattern):
 * the press must land instantly with the app swiped away, on any OEM, with no JS runtime boot in
 * the hot path. What it does is exactly what the notification's Prayed button does (D92):
 *
 * 1. Read the tapped prayer's EFFECTIVE status (snapshot + undrained queue).
 * 2. Assert the toggle: `unlogged` → append prayed; `prayed` → append `clears`.
 *    `late`, `missed`, `exempt` → do NOTHING. A deliberate mark is never overwritten by a tap,
 *    and an exempt day is inert (D58/D64 — the same guards the in-app seal enforces).
 * 3. Redraw, so the seal answers under the finger.
 * 4. Tell the buddies, if there are any (D180) — from here rather than waiting for the app to be
 *    opened, which is the one thing somebody who marks from the homescreen never does.
 *
 * It never writes the prayer log — the app drains the queue through `trackingStore.toggleStatus`
 * on its next open, the same door every mark goes through.
 */
class WidgetTapReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_TAP) return
    val day = intent.getStringExtra(EXTRA_DAY) ?: return
    val prayer = intent.getStringExtra(EXTRA_PRAYER) ?: return

    val snapshot = SnapshotStore.read(context) ?: return
    val dayData = snapshot.dayFor(day) ?: return
    if (dayData.isExempt) return
    // A prayer whose time has not come cannot be marked (owner rule, 2026-08-25). The widget
    // never offers the tap, but a stale drawing might still deliver one — refuse it here too.
    val tapped = dayData.prayers.firstOrNull { it.prayer == prayer } ?: return
    if (tapped.at > System.currentTimeMillis()) return

    val effective = PendingQueue.effectiveStatuses(
      context,
      day,
      dayData.prayers.associate { it.prayer to it.status }
    )
    val clears = when (effective[prayer]) {
      "unlogged" -> false
      "prayed" -> true
      else -> return
    }
    PendingQueue.appendTap(context, day, prayer, clears = clears)
    WidgetRenderer.renderAll(context)

    // 4. Tell the buddies, off the main thread and after the redraw — never in front of it.
    //
    // `goAsync` is what buys the time: a receiver's process is otherwise a candidate for death the
    // moment `onReceive` returns, and the post would be killed mid-flight. The token is finished
    // in every case, including a sender that throws, because a receiver that never finishes is a
    // process Android eventually kills with a complaint in the log.
    val pending = goAsync()
    Thread {
      try {
        BuddySender.send(context, day, prayer, if (clears) "cleared" else "prayed")
      } catch (_: Throwable) {
        // The mark is already in the queue; the app tells them on its next open.
      } finally {
        pending.finish()
      }
    }.start()
  }

  companion object {
    const val ACTION_TAP = "expo.modules.prayerwidgets.TAP"
    const val EXTRA_DAY = "day"
    const val EXTRA_PRAYER = "prayer"
  }
}
