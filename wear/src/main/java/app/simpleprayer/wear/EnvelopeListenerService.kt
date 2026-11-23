package app.simpleprayer.wear

import android.content.ComponentName
import android.content.Context
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

    requestSurfaceUpdates(this)
    AlertScheduler.rearm(this)
  }
}

/** Tile and complications re-read [EnvelopeStore]. Call after every store of a new envelope. */
internal fun requestSurfaceUpdates(context: Context) {
  requestTileUpdate(context)
  val app = context.applicationContext
  ComplicationDataSourceUpdateRequester
    .create(app, ComponentName(app, PrayerComplicationService::class.java))
    .requestUpdateAll()
}

/**
 * Asks the tile to re-read. Always through the APPLICATION context: the updater binds to the
 * system's tile service, and a BroadcastReceiver's context refuses bindService with
 * ReceiverCallNotAllowedException — the Wear crash Play reported from AlertMarkReceiver
 * (92 reports, 900000009..900000016).
 */
internal fun requestTileUpdate(context: Context) {
  TileService.getUpdater(context.applicationContext).requestUpdate(PrayerTileService::class.java)
}
