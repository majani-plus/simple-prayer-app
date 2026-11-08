package expo.modules.notificationdismissal

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lets a notification be taken out of the tray at a future instant, with the app's process gone.
 *
 * Android is the only platform where this is possible at all (iOS has no expiry for a delivered
 * local notification, by any mechanism — PRODUCT_SPEC §11.5), so this module is Android-only and
 * `expo-module.config.json` declares no other platform. The JS wrapper is a no-op where it does
 * not exist.
 *
 * Two functions, and deliberately no more. See [PendingDismissals] for how it works and, more
 * importantly, for the one convention in `expo-notifications` that it depends on.
 *
 * - `scheduleDismissal(identifier, atEpochMs)` — after `atEpochMs`, take the notification posted
 *   under `identifier` out of the tray. Replaces any previous instant for the same identifier.
 * - `cancelDismissal(identifier)` — forget it; the app dealt with the notification itself.
 *
 * Neither ever posts, schedules, or modifies a notification. This module cannot make the app's
 * reminders less reliable, which is the property that made it worth writing rather than reaching
 * into `expo-notifications`' own scheduling.
 */
class NotificationDismissalModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NotificationDismissal")

    // `atEpochMs` is a Double because that is what a JS number is. Milliseconds since the epoch
    // are well inside the range a double represents exactly, so the conversion is lossless.
    AsyncFunction("scheduleDismissal") { identifier: String, atEpochMs: Double ->
      PendingDismissals.schedule(context, identifier, atEpochMs.toLong())
    }

    AsyncFunction("cancelDismissal") { identifier: String ->
      PendingDismissals.cancel(context, identifier)
    }
  }
}
