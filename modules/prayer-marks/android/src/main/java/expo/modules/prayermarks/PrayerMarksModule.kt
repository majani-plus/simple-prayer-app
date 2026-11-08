package expo.modules.prayermarks

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app's side of the queue: push the copy down, read what is waiting, forget what has landed.
 *
 * Everything that happens when the button is actually pressed is in [PrayerMarkResponder] and
 * [MarkUndoReceiver], which run without this module ever being built — the React context does not
 * exist when the app is killed. This module is only what the app talks to once it is open.
 *
 * Three functions, and deliberately no more:
 *
 * - `configure(copy)` — store the already-translated words the confirmation will need. Called
 *   whenever the notification schedule is rebuilt, so a language change is carried down with it.
 * - `readPendingMarks()` — every entry, as a JSON array string, **without emptying the queue**.
 * - `acknowledgePendingMarks(ids)` — forget entries whose writes have landed, and take their
 *   confirmations out of the tray.
 *
 * Read-then-acknowledge rather than a draining read: a crash between reading and writing must cost
 * nothing, and applying an entry twice is a no-op by construction (`domain/pendingMarks`).
 */
class PrayerMarksModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PrayerMarks")

    AsyncFunction("configure") { copy: Map<String, Any?> ->
      @Suppress("UNCHECKED_CAST")
      val titles = (copy["confirmationTitle"] as? Map<String, Any?>)
        ?.mapNotNull { (prayer, title) -> (title as? String)?.let { prayer to it } }
        ?.toMap()
        ?: emptyMap()
      PendingMarks.putCopy(
        context,
        titles,
        copy["undo"] as? String ?: return@AsyncFunction,
        copy["channelName"] as? String ?: return@AsyncFunction,
        copy["channelDescription"] as? String ?: return@AsyncFunction,
        // Nullable so an app shipping an older JS bundle can still push the rest of the copy.
        copy["testConfirmationTitle"] as? String
      )
    }

    AsyncFunction("readPendingMarks") {
      PendingMarks.readAll(context)
    }

    AsyncFunction("acknowledgePendingMarks") { ids: List<String> ->
      for (confirmationId in PendingMarks.acknowledge(context, ids)) {
        MarkConfirmation.cancel(context, confirmationId)
      }
    }
  }
}
