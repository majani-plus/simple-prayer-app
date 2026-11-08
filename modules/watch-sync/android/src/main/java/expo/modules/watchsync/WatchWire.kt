package expo.modules.watchsync

/**
 * The Data Layer wire contract (Milestone V). Change one side, change both — the Wear app's
 * constants are the twin (`wear/`, V5/V6): neither module can import the other, so the strings
 * ARE the contract, exactly as the D92 queue's field names are between Swift/Kotlin/TypeScript.
 *
 * - **Down (phone → wear):** one data item at [ENVELOPE_PATH] carrying the `WatchEnvelope` JSON
 *   under [KEY_JSON]. DataClient persists it and syncs on change; the envelope's own
 *   `snapshot.generatedAt` differs between real builds, which defeats the Data Layer's
 *   identical-payload no-op (the JS side already dedupes identical content away).
 * - **Up (wear → phone):** one data item PER MARK at `[MARKS_PATH_PREFIX]/<id>`, the mark's JSON
 *   under [KEY_JSON]. Per-item, never a list: two taps must never read-modify-write each other,
 *   the same reasoning as prayer-marks' one-preference-per-entry queue. The phone consumes an
 *   item by writing it into the D92 queue and deleting the data item.
 */
internal object WatchWire {
  const val ENVELOPE_PATH = "/simpleprayer/envelope"
  const val MARKS_PATH_PREFIX = "/simpleprayer/marks"
  const val KEY_JSON = "json"

  /**
   * The prayer-marks queue, written directly by name: SharedPreferences files are per-process
   * state this module shares with `modules/prayer-marks` deliberately (prayer-widgets'
   * `PendingQueue` reads the same file for the same reason). Twins of the constants there —
   * change one, change both (D92).
   */
  const val PENDING_PREFS_NAME = "expo.modules.prayermarks.pending"
  const val MARK_PREFIX = "mark:"
  const val FIELD_ID = "id"
}
