package expo.modules.prayerwidgets

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS face of the widget bridge — a mailbox, nothing more (`modules/prayer-widgets/index.ts`
 * documents the contract). Like every local module here it never schedules a reminder and never
 * writes the prayer log.
 */
class PrayerWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PrayerWidgets")

    AsyncFunction("writeSnapshot") { json: String ->
      val context = requireNotNull(appContext.reactContext) { "React context is gone" }
      SnapshotStore.write(context, json)
      WidgetRenderer.renderAll(context)
    }

    AsyncFunction("clearSnapshot") {
      val context = requireNotNull(appContext.reactContext) { "React context is gone" }
      SnapshotStore.clear(context)
      WidgetRenderer.renderAll(context)
    }

    // A plain redraw from what is already stored. The app calls it on every foreground, because
    // writeSnapshot is skipped when the snapshot is unchanged — and an unchanged snapshot is
    // exactly the case where the drawing went stale across a boundary (D189).
    AsyncFunction("render") {
      val context = requireNotNull(appContext.reactContext) { "React context is gone" }
      WidgetRenderer.renderAll(context)
    }

    AsyncFunction("hasWidgets") {
      val context = requireNotNull(appContext.reactContext) { "React context is gone" }
      WidgetRenderer.hasWidgets(context)
    }
  }
}
