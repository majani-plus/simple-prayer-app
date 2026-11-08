package expo.modules.audiopause

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lets other apps' audio be paused at a future instant — a prayer's time coming in — with the
 * app's process gone (D96, "Pause what's playing").
 *
 * Android-only by nature: iOS gives a dead app no way to touch another app's audio, by any
 * mechanism Apple ships or permits, so `expo-module.config.json` declares no other platform and
 * the JS wrapper is a no-op where this does not exist. What iOS gives instead, for free, is the
 * system's own brief ducking while a notification sound plays.
 *
 * Two functions, and deliberately no more. See [PendingPauses] for how it works, what "pause"
 * precisely is, and why it is an alarm rather than a notification listener.
 *
 * - `schedulePause(identifier, atEpochMs)` — at `atEpochMs`, pause whatever is playing. Keyed by
 *   the reminder's identifier so it replaces and cancels along with it.
 * - `cancelPause(identifier)` — forget it; the reminder it belonged to is gone.
 *
 * It never posts, schedules, or modifies a notification, so it cannot make the reminders less
 * reliable — the same property `notification-dismissal` was built around.
 */
class AudioPauseModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AudioPause")

    // `atEpochMs` is a Double because that is what a JS number is. Milliseconds since the epoch
    // are well inside the range a double represents exactly, so the conversion is lossless.
    AsyncFunction("schedulePause") { identifier: String, atEpochMs: Double ->
      PendingPauses.schedule(context, identifier, atEpochMs.toLong())
    }

    AsyncFunction("cancelPause") { identifier: String ->
      PendingPauses.cancel(context, identifier)
    }
  }
}
