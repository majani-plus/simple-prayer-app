package expo.modules.prayerwidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/**
 * The Now widget's one-row face (4×1, D182): the current or next prayer, the countdown, today's
 * buddies for it and the seal, laid out sideways. Its own provider because a picker entry is
 * the only face people find (D109); the drawing is [WidgetRenderer.buildNow] with `strip = true`.
 */
class NowStripWidgetProvider : AppWidgetProvider() {
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
