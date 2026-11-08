package expo.modules.prayerwidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/**
 * The large Schedule widget (~4×4): the day as a LIST — one row per prayer with the Arabic name
 * and the sunrise rule, the iOS Large's twin. Its own picker entry on purpose (owner,
 * 2026-08-25: "on iOS we have 3 widgets… I want that on Android too") — a face hidden behind a
 * resize gesture is a face nobody finds. Deliberately thin — every answer lives in
 * [WidgetRenderer], so the providers can never drift apart.
 */
class ScheduleListWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    WidgetRenderer.renderAll(context)
  }

  override fun onEnabled(context: Context) {
    WidgetRenderer.renderAll(context)
  }

  override fun onDisabled(context: Context) {
    // The renderer cancels the transition alarm itself when the last widget is gone.
    WidgetRenderer.renderAll(context)
  }
}
