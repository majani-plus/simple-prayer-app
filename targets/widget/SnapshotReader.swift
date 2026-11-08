import Foundation

/**
 The widget snapshot, parsed — the Swift shadow of `src/services/widgetSnapshot.ts`, and the
 twin of the Kotlin `Snapshot.kt`.

 This file PARSES and SELECTS; it never computes. Prayer days, windows, Friday names, numerals
 and every user-facing string were resolved by the app in TypeScript, under test. The only logic
 a widget is allowed is comparing an instant to a precomputed boundary (`segment(at:)`) and the
 queue overlay (`PendingOverlay.swift`) — both pinned by `modules/prayer-widgets/contract/`.

 Anything unreadable — wrong version, missing field — decodes to `nil`, and the caller renders
 the bundled "open the app" state rather than guessing at a stale layout.
 */
struct WidgetSnapshot: Decodable {
  /// Must match `WIDGET_SNAPSHOT_VERSION` in `src/services/widgetSnapshot.ts`.
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
    /// Epoch ms, as everywhere in the snapshot.
    let at: Double
    let timeText: String
    let windowEndAt: Double?
    let dueCaption: String
    /// "until 6:42 pm" — the bare deadline; nil when unresolvable or written by an older app.
    let untilText: String?
    /// "until Asr" — the calm countdown's caption (D190); nil from older apps (use the name).
    let untilStartText: String?
    /// The status as the app last wrote it; overlay the queue before rendering.
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

  /// One buddy's face on today's rows (D177). Large widget only — see `ScheduleView`.
  ///
  /// There is no name here and there never will be: a widget is read at arm's length by whoever is
  /// in the room. The colour, the letters and the glyph were all chosen on the phone this is
  /// rendering on.
  struct Buddy: Decodable {
    let color: String
    /// Always letters — the app sends initials even for a buddy wearing a picture, because these
    /// widgets draw glyphs as hand-built shapes rather than from a font.
    let initials: String
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
  /// Today's buddy badges, carrying the day they belong to. Absent whenever buddy mode is off.
  struct Buddies: Decodable {
    let day: String
    let marks: [String: [Buddy]]
  }

  let buddies: Buddies?

  /// Who else prayed this one, in roster order.
  ///
  /// The app only ever sends today's, so `day` is checked rather than assumed: the schedule widget
  /// can be asked to render a different day, and yesterday's row must not borrow today's badges.
  /// Empty for every install without buddy mode, which is most of them.
  func buddies(for prayer: String, on day: String) -> [Buddy] {
    guard let buddies, buddies.day == day else { return [] }
    return buddies.marks[prayer] ?? []
  }

  func day(named name: String) -> Day? {
    days.first { $0.day == name }
  }

  /// The segment containing `now` — the same half-open search as TypeScript's `segmentAt`.
  func segment(at nowMs: Double) -> Segment? {
    segments.first { nowMs >= $0.from && nowMs < $0.to }
  }

  func isExpired(at nowMs: Double) -> Bool {
    nowMs >= expiresAt
  }

  /// Reads and validates what the app stored, or `nil` — never a guess.
  static func load() -> WidgetSnapshot? {
    guard
      let raw = AppGroup.defaults().string(forKey: AppGroup.snapshotKey),
      let data = raw.data(using: .utf8),
      let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
      snapshot.version == supportedVersion,
      !snapshot.days.isEmpty,
      !snapshot.segments.isEmpty
    else {
      return nil
    }
    return snapshot
  }
}

/**
 The shared container, resolved the way the app resolves it — from the bundle's
 `SPAppGroupIdentifier` (written by `plugins/withAppGroup.js` / `expo-target.config.js`). The
 derivation fallback exists because an extension without its Info.plist key is otherwise mute:
 the extension's own bundle id is `<app>.widget`, so the group is `group.<app>`.
 */
enum AppGroup {
  static let infoKey = "SPAppGroupIdentifier"
  static let snapshotKey = "SPWidgetSnapshot"

  static func identifier() -> String? {
    if let fromPlist = Bundle.main.object(forInfoDictionaryKey: infoKey) as? String {
      return fromPlist
    }
    guard let bundle = Bundle.main.bundleIdentifier else { return nil }
    let appBundle = bundle.hasSuffix(".widget") ? String(bundle.dropLast(".widget".count)) : bundle
    return "group.\(appBundle)"
  }

  static func defaults() -> UserDefaults {
    identifier().flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
  }
}
