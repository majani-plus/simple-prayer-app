package expo.modules.watchsync

import android.content.Context
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * Receives the watch's pending marks (Milestone V). Play services starts this service itself —
 * the app's process may be long gone when a mark syncs over — and each mark becomes one
 * `mark:<id>` entry in the prayer-marks SharedPreferences queue, exactly what a notification
 * press writes. The app drains it through `trackingStore.toggleStatus` on the next foreground;
 * nothing here interprets a mark (D92 — no day math, no status rules, in any language but
 * TypeScript).
 *
 * After a successful queue write the data item is deleted: consumed, so a later sync does not
 * replay it. A replay would be harmless anyway — the drain's guards make marks idempotent — but
 * a clean store keeps the Data Layer from growing forever.
 */
class WatchSyncListenerService : WearableListenerService() {
  override fun onDataChanged(events: DataEventBuffer) {
    for (event in events) {
      if (event.type != DataEvent.TYPE_CHANGED) continue
      val item = event.dataItem
      val path = item.uri.path ?: continue
      if (!path.startsWith(WatchWire.MARKS_PATH_PREFIX)) continue

      val json = runCatching {
        DataMapItem.fromDataItem(item).dataMap.getString(WatchWire.KEY_JSON)
      }.getOrNull() ?: continue
      val mark = runCatching { JSONObject(json) }.getOrNull() ?: continue
      val id = mark.optString(WatchWire.FIELD_ID)
      if (id.isEmpty()) continue

      // A single putString cannot race the drain's read-then-acknowledge (PendingMarks' rule).
      getSharedPreferences(WatchWire.PENDING_PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(WatchWire.MARK_PREFIX + id, mark.toString())
        .apply()

      Wearable.getDataClient(this).deleteDataItems(item.uri)
    }
  }
}
