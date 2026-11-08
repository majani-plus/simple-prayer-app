import Foundation

/**
 The queue itself: what the user asserted from a notification, waiting for the app to be opened.

 ## Where it lives, and why there

 An App Group `UserDefaults` suite rather than the app's own. Nothing outside the app writes to it
 *today* — the action is handled in the app's process, which iOS launches into the background for
 exactly this — but the widgets this project has planned since D26 need the same shared container,
 and a storage location is much easier to choose once than to move later. The group identifier is
 written into `Info.plist` by `plugins/withAppGroup.js`, which is also what puts it in the
 entitlements, so the name exists in one place. Without it (an older build, a provisioning problem)
 this falls back to the app's own defaults: the queue still works, and only a future widget would
 be unable to see it.

 ## Shape

 One array of dictionaries under one key. The entries are never interpreted here — this file does
 not know what a prayer day is, whether a prayer can be marked twice, or what an undo means. All of
 that is `src/domain/pendingMarks`, in TypeScript, under test (D92).

 Writes are serialised on a private queue. iOS delivers notification responses one at a time, but
 the app's own `read`/`acknowledge` calls arrive from the JS thread, and a read-modify-write racing
 an append would lose a mark.
 */
final class PendingMarks {
  static let shared = PendingMarks()

  /// Where `plugins/withAppGroup.js` records the App Group it added to the entitlements.
  private static let appGroupInfoKey = "SPAppGroupIdentifier"

  private static let marksKey = "pendingMarks"
  private static let copyKeyPrefix = "confirmationTitle."
  private static let testTitleKey = "confirmationTitle.test"

  /**
   Entries written by the WIDGET extension (D26) — one defaults key per entry, `widgetMark:<id>`,
   never the shared array. The array's read-modify-write is serialised on this class's queue,
   which only exists in the APP's process; an extension appending to the same array from its own
   process could race a drain and lose a mark. A single-key `set` cannot. The widget's AppIntent
   writes these; only `readAll`/`acknowledge` below ever touch them from the app side.
   */
  private static let widgetMarkPrefix = "widgetMark:"

  /// Field names, shared verbatim with `domain/pendingMarks`' `PendingMark`.
  static let fieldId = "id"
  static let fieldDay = "day"
  static let fieldPrayer = "prayer"
  static let fieldDecidedAt = "decidedAt"
  static let fieldAnnuls = "annuls"
  static let fieldConfirmationId = "confirmationId"

  /// Payload field marking a dress rehearsal (`prayer-marks`' `MARK_TEST_FIELD`, D93): the press
  /// is answered on screen and never queued. A notification-payload field, not a queue field.
  static let fieldTest = "test"

  private let defaults: UserDefaults
  private let queue = DispatchQueue(label: "app.simpleprayer.pendingMarks")

  private init() {
    let group = Bundle.main.object(forInfoDictionaryKey: PendingMarks.appGroupInfoKey) as? String
    defaults = group.flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
  }

  /// Appends one entry.
  func append(_ mark: [String: Any]) {
    guard let id = mark[PendingMarks.fieldId] as? String, !id.isEmpty else { return }
    queue.sync {
      var stored = defaults.array(forKey: PendingMarks.marksKey) as? [[String: Any]] ?? []
      stored.append(mark)
      defaults.set(stored, forKey: PendingMarks.marksKey)
    }
  }

  /// Every entry — the app's array plus the widget's per-key entries — as a JSON array string.
  /// Does not remove anything; see `readPendingMarks`.
  func readAll() -> String {
    let stored: [[String: Any]] = queue.sync {
      var all = defaults.array(forKey: PendingMarks.marksKey) as? [[String: Any]] ?? []
      for (key, value) in defaults.dictionaryRepresentation() {
        guard key.hasPrefix(PendingMarks.widgetMarkPrefix) else { continue }
        if let mark = value as? [String: Any] {
          all.append(mark)
        }
      }
      return all
    }
    // Serialized per entry, so one unencodable value drops that entry alone rather than turning
    // the whole queue invisible (which the widget overlay, reading the dicts directly, would
    // keep rendering — a permanent app/widget split). Android's readAll has the same rule.
    let sane = stored.filter { JSONSerialization.isValidJSONObject($0) }
    guard
      let data = try? JSONSerialization.data(withJSONObject: sane),
      let json = String(data: data, encoding: .utf8)
    else {
      return "[]"
    }
    return json
  }

  /**
   Forgets entries whose writes have landed.

   - Returns: The `confirmationId` of every acknowledged entry that had one, so the caller can take
     those notifications out of the tray.
   */
  func acknowledge(_ ids: [String]) -> [String] {
    guard !ids.isEmpty else { return [] }
    let wanted = Set(ids)
    return queue.sync {
      let stored = defaults.array(forKey: PendingMarks.marksKey) as? [[String: Any]] ?? []
      var confirmations: [String] = []
      var kept: [[String: Any]] = []
      for mark in stored {
        let id = mark[PendingMarks.fieldId] as? String
        if let id, wanted.contains(id) {
          if let confirmation = mark[PendingMarks.fieldConfirmationId] as? String {
            confirmations.append(confirmation)
          }
          continue
        }
        // An entry with no usable id can never be named by an acknowledgment, so keeping it
        // would replay it forever. Dropped here, on the write the array is being rewritten anyway.
        guard id?.isEmpty == false else { continue }
        kept.append(mark)
      }
      defaults.set(kept, forKey: PendingMarks.marksKey)
      // The widget's per-key entries acknowledge by key removal — atomic, race-free.
      for id in wanted {
        defaults.removeObject(forKey: PendingMarks.widgetMarkPrefix + id)
      }
      return confirmations
    }
  }

  /**
   Replaces the stored confirmation titles.

   The confirmation is composed with the app possibly gone, so its words have to be on disk before
   the button is pressed. There is deliberately no English fallback: with nothing stored, the mark
   is still queued and the reminder still cleared, but no confirmation is posted — a silent gap
   beats showing an Arabic reader an English word.
   */
  func putTitles(_ titles: [String: String]) {
    queue.sync {
      for (prayer, title) in titles {
        defaults.set(title, forKey: PendingMarks.copyKeyPrefix + prayer)
      }
    }
  }

  /// The confirmation title for one prayer, or `nil` when the app has never pushed any.
  func title(for prayer: String) -> String? {
    queue.sync { defaults.string(forKey: PendingMarks.copyKeyPrefix + prayer) }
  }

  /// Replaces the stored **test** confirmation title (D93). Same no-fallback rule as the others.
  func putTestTitle(_ title: String) {
    queue.sync { defaults.set(title, forKey: PendingMarks.testTitleKey) }
  }

  /// The confirmation title for a test press, or `nil` when the app has never pushed it.
  func testTitle() -> String? {
    queue.sync { defaults.string(forKey: PendingMarks.testTitleKey) }
  }
}
