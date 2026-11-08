package expo.modules.prayerwidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/**
 * The Schedule widget (4×2+): today's five prayers, the current one emphasized, a seal per
 * column. Deliberately thin — every answer lives in [WidgetRenderer], so the two providers can
 * never drift apart.
 */
class ScheduleWidgetProvider : AppWidgetProvider() {
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
