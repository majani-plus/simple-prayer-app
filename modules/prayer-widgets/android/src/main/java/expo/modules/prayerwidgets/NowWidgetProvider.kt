package expo.modules.prayerwidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** The Now widget (~2×2): the current or next prayer plus today's five seals. See [WidgetRenderer]. */
class NowWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    WidgetRenderer.renderAll(context)
  }

  override fun onEnabled(context: Context) {
    WidgetRenderer.renderAll(context)
  }

  override fun onDisabled(context: Context) {
    WidgetRenderer.renderAll(context)
  }
}
