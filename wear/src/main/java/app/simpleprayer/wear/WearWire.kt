package app.simpleprayer.wear

/**
 * The Data Layer wire contract, wear side. BYTE-FOR-BYTE TWIN of
 * `modules/watch-sync/android/src/main/java/expo/modules/watchsync/WatchWire.kt` — neither module
 * can import the other, so the strings ARE the contract. Change one, change both.
 *
 * - **Down (phone → wear):** one data item at [ENVELOPE_PATH] carrying the `WatchEnvelope` JSON
 *   under [KEY_JSON].
 * - **Up (wear → phone):** one data item PER MARK at `[MARKS_PATH_PREFIX]/<id>`, the mark's JSON
 *   under [KEY_JSON]. Per-item, never a list: two taps must never read-modify-write each other.
 *   The phone consumes an item by writing it into the D92 queue and deleting the data item.
 */
internal object WearWire {
  const val ENVELOPE_PATH = "/simpleprayer/envelope"
  const val MARKS_PATH_PREFIX = "/simpleprayer/marks"
  const val KEY_JSON = "json"
}
