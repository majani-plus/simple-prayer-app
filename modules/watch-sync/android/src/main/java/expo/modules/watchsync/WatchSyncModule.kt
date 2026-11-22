package expo.modules.watchsync

import android.content.Intent
import android.net.Uri
import androidx.wear.remote.interactions.RemoteActivityHelper
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

    // Opens `uri` (a Play listing) on the first connected watch. Resolves true once the watch
    // accepted the request, false on anything else: no watch, no Play services, a refused intent.
    // Never rejects; the screen shows a "search for it on your watch" line instead.
    AsyncFunction("openOnWatch") { uri: String, promise: Promise ->
      try {
        val context = requireNotNull(appContext.reactContext) { "React context is gone" }
        Wearable.getNodeClient(context).connectedNodes
          .addOnSuccessListener { nodes ->
            val node = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
            if (node == null) {
              promise.resolve(false)
              return@addOnSuccessListener
            }
            try {
              val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
                .addCategory(Intent.CATEGORY_BROWSABLE)
              val future = RemoteActivityHelper(context).startRemoteActivity(intent, node.id)
              future.addListener(
                { promise.resolve(runCatching { future.get() }.isSuccess) },
                { it.run() }
              )
            } catch (e: Exception) {
              promise.resolve(false)
            }
          }
          .addOnFailureListener { promise.resolve(false) }
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }
  }
}
