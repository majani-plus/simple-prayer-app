package app.simpleprayer.wear

import android.content.ComponentName
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/**
 * Where the phone's envelope lands. The Data Layer wakes this service on every sync of
 * [WearWire.ENVELOPE_PATH]; everything downstream — tile, complications, alerts — is told to
 * re-read [EnvelopeStore] rather than handed the payload, so a missed broadcast costs one stale
 * render, never a divergent one.
 */
class EnvelopeListenerService : WearableListenerService() {
  override fun onDataChanged(events: DataEventBuffer) {
    var received = false
    for (event in events) {
      if (event.type != DataEvent.TYPE_CHANGED) continue
      val item = event.dataItem
      if (item.uri.path?.startsWith(WearWire.ENVELOPE_PATH) != true) continue
      val json = DataMapItem.fromDataItem(item).dataMap.getString(WearWire.KEY_JSON) ?: continue
      EnvelopeStore.store(this, json)
      received = true
    }
    if (!received) return

    // A fresh envelope carries the drained truth: local render copies it reflects can go.
    EnvelopeStore.load(this)?.let { WearPendingMarks.gcAgainst(this, it) }

    TileService.getUpdater(this).requestUpdate(PrayerTileService::class.java)
    ComplicationDataSourceUpdateRequester
      .create(this, ComponentName(this, PrayerComplicationService::class.java))
      .requestUpdateAll()
    AlertScheduler.rearm(this)
  }
}
