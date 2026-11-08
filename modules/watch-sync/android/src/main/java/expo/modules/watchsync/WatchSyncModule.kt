package expo.modules.watchsync

import android.net.Uri
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS face of the watch bridge — a mailbox, nothing more (`modules/watch-sync/index.ts`
 * documents the contract). Like every local module here it never schedules a reminder and never
 * writes the prayer log; marks from the watch arrive at [WatchSyncListenerService], not here.
 *
 * Every Data Layer call can fail on a device without Play services (or with it disabled). Each
 * failure resolves rather than rejects: a watch is an enhancement, and the JS side treats the
 * whole module as optional anyway.
 */
class WatchSyncModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WatchSync")

    AsyncFunction("pushEnvelope") { json: String, promise: Promise ->
      val context = requireNotNull(appContext.reactContext) { "React context is gone" }
      val request = PutDataMapRequest.create(WatchWire.ENVELOPE_PATH).apply {
        dataMap.putString(WatchWire.KEY_JSON, json)
      }
      Wearable.getDataClient(context)
        .putDataItem(request.asPutDataRequest().setUrgent())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.resolve(null) }
    }

    AsyncFunction("clearEnvelope") { promise: Promise ->
      val context = requireNotNull(appContext.reactContext) { "React context is gone" }
      Wearable.getDataClient(context)
        .deleteDataItems(Uri.parse("wear://*${WatchWire.ENVELOPE_PATH}"))
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.resolve(null) }
    }

    AsyncFunction("hasWatch") { promise: Promise ->
      val context = requireNotNull(appContext.reactContext) { "React context is gone" }
      Wearable.getNodeClient(context).connectedNodes
        .addOnSuccessListener { nodes -> promise.resolve(nodes.isNotEmpty()) }
        .addOnFailureListener { promise.resolve(false) }
    }
  }
}
