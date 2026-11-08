import ExpoModulesCore
import WidgetKit

/**
 The JS face of the widget bridge — a mailbox, nothing more (`modules/prayer-widgets/index.ts`
 documents the contract). Never schedules a reminder, never writes the prayer log.
 */
public class PrayerWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrayerWidgets")

    AsyncFunction("writeSnapshot") { (json: String) in
      WidgetSnapshotStore.write(json)
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    AsyncFunction("clearSnapshot") {
      WidgetSnapshotStore.clear()
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    // A plain redraw from what is stored: the app calls it on every foreground, because an
    // unchanged snapshot skips writeSnapshot (D189).
    AsyncFunction("render") {
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    AsyncFunction("hasWidgets") { (promise: Promise) in
      guard #available(iOS 14.0, *) else {
        promise.resolve(false)
        return
      }
      WidgetCenter.shared.getCurrentConfigurations { result in
        promise.resolve(((try? result.get()) ?? []).isEmpty == false)
      }
    }

    /** Whether this device can show the prayer-window Live Activity (D27). */
    Constant("liveActivitiesSupported") {
      if #available(iOS 16.2, *) {
        return true
      }
      return false
    }

    /**
     Starts the single-window Live Activity from a payload `src/services/liveActivity.ts`
     pre-rendered (translated, formatted). Replaces any previous prayer Activity; self-dismisses
     at the window's end. See `PrayerActivity.swift` for the no-push design this follows.
     */
    AsyncFunction("startPrayerWindowActivity") { (payload: [String: Any]) in
      guard #available(iOS 16.2, *) else { return }
      let endAt = (payload["endAt"] as? NSNumber)?.doubleValue ?? 0
      let attributes = PrayerActivityAttributes(
        day: payload["day"] as? String ?? "",
        prayer: payload["prayer"] as? String ?? "",
        name: payload["name"] as? String ?? "",
        arabicName: payload["arabicName"] as? String,
        timeText: payload["timeText"] as? String ?? "",
        untilText: payload["untilText"] as? String ?? "",
        leftToPray: payload["leftToPray"] as? String ?? "",
        startAt: (payload["startAt"] as? NSNumber)?.doubleValue ?? 0,
        endAt: endAt,
        // A payload from an older JS bundle carries no staleAt; the window's end is what the
        // old design used, so it is the honest fallback.
        staleAt: (payload["staleAt"] as? NSNumber)?.doubleValue ?? endAt,
        startsCaption: payload["startsCaption"] as? String,
        untilStartLabel: payload["untilStartLabel"] as? String,
        stillToPray: payload["stillToPray"] as? String,
        markDay: payload["markDay"] as? String ?? payload["day"] as? String ?? "",
        markPrayer: payload["markPrayer"] as? String ?? payload["prayer"] as? String ?? "",
        prayedLabel: payload["prayedLabel"] as? String ?? "",
        markedText: payload["markedText"] as? String ?? "",
        language: payload["language"] as? String ?? "en",
        rtl: payload["rtl"] as? Bool ?? false,
        theme: payload["theme"] as? String ?? "system"
      )
      guard !attributes.day.isEmpty, !attributes.prayer.isEmpty, attributes.endAt > 0 else { return }
      let status = payload["status"] as? String ?? "due"
      Task { await PrayerActivityController.start(attributes, status: status) }
    }

    AsyncFunction("endPrayerWindowActivities") {
      guard #available(iOS 16.2, *) else { return }
      Task { await PrayerActivityController.endAll() }
    }
  }
}
