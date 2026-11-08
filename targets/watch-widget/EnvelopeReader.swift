import Foundation

/**
 The watch envelope, parsed — the Swift shadow of `src/services/watchEnvelope.ts`, wrapping the
 same `WidgetSnapshot` the widgets read (this file's snapshot half is a byte-for-byte twin of
 `targets/widget/SnapshotReader.swift`'s struct; the watch targets cannot import the widget
 extension's module, so the struct IS the contract).

 This file PARSES and SELECTS; it never computes. The only intelligence a watch surface is
 allowed is comparing an instant to a precomputed boundary (`segment(at:)`) and the local pending
 overlay (`WatchPending.swift`). Anything unreadable — wrong version, either layer — decodes to
 `nil` and the caller renders the bundled "open the app on your phone" state.

 BYTE-FOR-BYTE TWIN of `targets/watch/EnvelopeReader.swift`. Change one, change both.
 */
struct WidgetSnapshot: Decodable {
  static let supportedVersion = 1

  struct Strings: Decodable {
    let sunrise: String
    let statusPrayed: String
    let statusLate: String
    let statusMissed: String
    let statusNotMarked: String
    let statusNotRequired: String
    let statusUpcoming: String
    let now: String
    let next: String
    let leftToPray: String
  }

  struct DayPrayer: Decodable {
    let prayer: String
    let name: String
    let arabicName: String?
    let at: Double
    let timeText: String
    let windowEndAt: Double?
    let dueCaption: String
    let untilText: String?
    let status: String
  }

  struct Day: Decodable {
    let day: String
    let startsAt: Double
    let endsAt: Double
    let dateText: String
    let hijriText: String
    let isExempt: Bool
    let sunriseAt: Double?
    let sunriseText: String?
    let prayers: [DayPrayer]
  }

  struct SegmentNext: Decodable {
    let day: String
    let prayer: String
  }

  struct Segment: Decodable {
    let from: Double
    let to: Double
    let day: String
    let current: String?
    let next: SegmentNext?
  }

  let version: Int
  let generatedAt: Double
  let expiresAt: Double
  let language: String
  let rtl: Bool
  let theme: String
  let strings: Strings
  let days: [Day]
  let segments: [Segment]

  func day(named name: String) -> Day? {
    days.first { $0.day == name }
  }

  func segment(at nowMs: Double) -> Segment? {
    segments.first { nowMs >= $0.from && nowMs < $0.to }
  }

  func isExpired(at nowMs: Double) -> Bool {
    nowMs >= expiresAt
  }
}

struct WatchEnvelope: Decodable {
  /// Must match `WATCH_ENVELOPE_VERSION` in `src/services/watchEnvelope.ts`.
  static let supportedVersion = 1

  struct Qibla: Decodable {
    let bearing: Double
    /// "Qibla" — names the page in the Today footer's scroll hint. Optional: envelopes shipped
    /// before the field existed stay valid (additive v1 field, not a version bump).
    let titleLabel: String?
    /// The dial's cardinal engravings (owner, 2026-08-28) — same additive-optional rule.
    let north: String?
    let east: String?
    let south: String?
    let west: String?
    let alignedLabel: String
    let toLeftLabel: String
    let toRightLabel: String
  }

  let version: Int
  let snapshot: WidgetSnapshot
  let qibla: Qibla?

  /// Reads and validates what the phone last shipped, or `nil` — never a guess.
  static func load() -> WatchEnvelope? {
    guard
      let raw = WatchAppGroup.defaults().string(forKey: WatchAppGroup.envelopeKey),
      let data = raw.data(using: .utf8),
      let envelope = try? JSONDecoder().decode(WatchEnvelope.self, from: data),
      envelope.version == supportedVersion,
      envelope.snapshot.version == WidgetSnapshot.supportedVersion,
      !envelope.snapshot.days.isEmpty,
      !envelope.snapshot.segments.isEmpty
    else {
      return nil
    }
    return envelope
  }

  /// Whether ANY envelope is stored (stale or broken counts) — picks the empty vs stale wording.
  static func exists() -> Bool {
    WatchAppGroup.defaults().string(forKey: WatchAppGroup.envelopeKey) != nil
  }
}

/**
 The WATCH-side App Group container (same group name as the phone's, different device, different
 container). The watch targets carry `SPAppGroupIdentifier` in their own Info.plist, so the
 suffix-derivation fallback the widget extension needed does not exist here.
 */
enum WatchAppGroup {
  static let infoKey = "SPAppGroupIdentifier"
  /// Twin of the watch app's `WatchEnvelopeStore.envelopeKey` — change one, change both.
  static let envelopeKey = "SPWatchEnvelope"

  static func defaults() -> UserDefaults {
    let group = Bundle.main.object(forInfoDictionaryKey: infoKey) as? String
    return group.flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
  }
}
