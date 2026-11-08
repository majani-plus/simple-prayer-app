import Combine
import Foundation
import SwiftUI
import WatchKit
import WidgetKit

/**
 The watch app's one observable: the parsed envelope plus an overlay generation counter that
 bumps on every local tap, so a seal flips in the same gesture. Reloads whenever
 `PhoneSessionClient` applies a new envelope (it posts `.spEnvelopeChanged`) and on foreground.
 */
final class WatchModel: ObservableObject {
  @Published private(set) var envelope: WatchEnvelope?
  @Published private(set) var overlayGeneration = 0

  private var observer: NSObjectProtocol?

  init() {
    envelope = WatchEnvelope.load()
    observer = NotificationCenter.default.addObserver(
      forName: .spEnvelopeChanged,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.envelope = WatchEnvelope.load()
    }
  }

  deinit {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  var hasStoredEnvelope: Bool { WatchEnvelope.exists() }

  func reload() {
    envelope = WatchEnvelope.load()
  }

  /// The seal's whole vocabulary: mark, or unmark a mark. Optimistic locally, guaranteed to the
  /// phone, drained into the log by the app (D92) — degraded, never wrong.
  func tap(day: String, prayer: String, shownStatus: String) {
    let clears = shownStatus == "prayed"
    let mark = WatchPending.appendTap(day: day, prayer: prayer, clears: clears)
    PhoneSessionClient.shared.send(mark: mark)
    WKInterfaceDevice.current().play(clears ? .click : .success)
    // The one animation the app has: everything the tap changes — the seal's fill, the hero's
    // flip to the next prayer — moves on a spring instead of jump-cutting.
    withAnimation(.spring(duration: 0.35, bounce: 0.25)) {
      overlayGeneration += 1
    }
    WidgetCenter.shared.reloadAllTimelines()
  }

  /// A day's statuses with the local taps laid over (reads fresh on every overlay bump).
  func effective(day: WidgetSnapshot.Day) -> [String: String] {
    _ = overlayGeneration
    var base: [String: String] = [:]
    for prayer in day.prayers {
      base[prayer.prayer] = prayer.status
    }
    return WatchPending.effectiveStatuses(day: day.day, base: base)
  }
}

extension Notification.Name {
  static let spEnvelopeChanged = Notification.Name("SPEnvelopeChanged")
}
