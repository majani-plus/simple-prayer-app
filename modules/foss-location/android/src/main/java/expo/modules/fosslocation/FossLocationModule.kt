package expo.modules.fosslocation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Address
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import kotlin.math.abs

private const val COARSE = Manifest.permission.ACCESS_COARSE_LOCATION

/**
 * The FOSS build's location: `expo-location`'s job, done with platform APIs only.
 *
 * `expo-location` on Android is built on Google Play services' fused provider, which F-Droid does
 * not accept. This module answers the handful of calls the app makes (`src/foss/expo-location.ts`
 * maps them) using `LocationManager`, `android.location.Geocoder` and `SensorManager`, which every
 * Android phone has, with or without Google.
 *
 * Coarse only, always (CLAUDE.md hard rule): the only permission it ever asks for is
 * ACCESS_COARSE_LOCATION, and it never asks for background location.
 *
 * Only the FOSS build links this module (`scripts/foss-prepare.ts`); the normal build excludes it in
 * package.json and keeps `expo-location`.
 */
class FossLocationModule : Module(), SensorEventListener {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "No React context", null)
  private val locationManager: LocationManager
    get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private val sensorManager: SensorManager
    get() = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

  private var gravity: FloatArray? = null
  private var geomagnetic: FloatArray? = null
  private var geofield: GeomagneticField? = null
  private var lastAzimuth = 0f
  private var lastUpdate = 0L
  private var accuracy = 0

  override fun definition() = ModuleDefinition {
    Name("FossLocation")
    Events("onHeading")

    AsyncFunction("getForegroundPermissionsAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, COARSE)
    }

    AsyncFunction("requestForegroundPermissionsAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, COARSE)
    }

    AsyncFunction("getCurrentPositionAsync") { promise: Promise ->
      requirePermission()
      val provider = currentProviders().firstOrNull()
        ?: throw CodedException("E_LOCATION_SERVICES_DISABLED", "No location provider is on", null)
      // Times out by itself (about 30 s) and then hands back null.
      LocationManagerCompat.getCurrentLocation(
        locationManager,
        provider,
        null as CancellationSignal?,
        ContextCompat.getMainExecutor(context)
      ) { location ->
        if (location == null) {
          promise.reject("E_LOCATION_UNAVAILABLE", "No location fix", null)
        } else {
          promise.resolve(location.toMap())
        }
      }
    }

    AsyncFunction("getLastKnownPositionAsync") { maxAge: Double? ->
      requirePermission()
      val newest = lastKnown() ?: return@AsyncFunction null
      if (maxAge != null && System.currentTimeMillis() - newest.time > maxAge) null else newest.toMap()
    }

    // AsyncFunction bodies run off the main thread, so the blocking Geocoder calls are fine here.
    AsyncFunction("geocodeAsync") { address: String ->
      @Suppress("DEPRECATION")
      geocoder().getFromLocationName(address, 1).orEmpty().map {
        mapOf("latitude" to it.latitude, "longitude" to it.longitude)
      }
    }

    AsyncFunction("reverseGeocodeAsync") { latitude: Double, longitude: Double ->
      @Suppress("DEPRECATION")
      geocoder().getFromLocation(latitude, longitude, 1).orEmpty().map { it.toMap() }
    }

    /** Starts `onHeading` events. Answers false on a phone with no compass. */
    Function("startHeading") {
      val magnetometer = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
      val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      if (magnetometer == null || accelerometer == null) return@Function false
      geofield = runCatching { lastKnown() }.getOrNull()?.let {
        GeomagneticField(it.latitude.toFloat(), it.longitude.toFloat(), it.altitude.toFloat(), System.currentTimeMillis())
      }
      sensorManager.registerListener(this@FossLocationModule, magnetometer, SensorManager.SENSOR_DELAY_NORMAL)
      sensorManager.registerListener(this@FossLocationModule, accelerometer, SensorManager.SENSOR_DELAY_NORMAL)
      true
    }

    Function("stopHeading") { stopHeading() }

    OnDestroy { stopHeading() }
  }

  private fun requirePermission() {
    if (ContextCompat.checkSelfPermission(context, COARSE) != PackageManager.PERMISSION_GRANTED) {
      throw CodedException("E_LOCATION_UNAUTHORIZED", "Location permission is not granted", null)
    }
  }

  /**
   * Providers to ask for a fresh fix, best first. From Android 12 an app with only coarse
   * permission may use any provider, and the system blurs the result; before that, GPS needs fine
   * permission, so it is left out.
   */
  private fun currentProviders(): List<String> {
    val candidates = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      listOf(LocationManager.FUSED_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
    } else {
      listOf(LocationManager.NETWORK_PROVIDER)
    }
    return candidates.filter { runCatching { locationManager.isProviderEnabled(it) }.getOrDefault(false) }
  }

  private fun lastKnown(): Location? =
    locationManager.getProviders(true)
      .mapNotNull { runCatching { locationManager.getLastKnownLocation(it) }.getOrNull() }
      .maxByOrNull { it.time }

  private fun geocoder(): Geocoder {
    requirePermission()
    if (!Geocoder.isPresent()) throw CodedException("E_NO_GEOCODER", "This phone has no geocoder", null)
    return Geocoder(context, Locale.getDefault())
  }

  private fun stopHeading() {
    runCatching { sensorManager.unregisterListener(this) }
    gravity = null
    geomagnetic = null
  }

  override fun onSensorChanged(event: SensorEvent) {
    when (event.sensor.type) {
      Sensor.TYPE_ACCELEROMETER -> gravity = event.values.clone()
      Sensor.TYPE_MAGNETIC_FIELD -> {
        geomagnetic = event.values.clone()
        accuracy = event.accuracy
      }
    }
    val g = gravity ?: return
    val m = geomagnetic ?: return
    val rotation = FloatArray(9)
    if (!SensorManager.getRotationMatrix(rotation, null, g, m)) return
    val orientation = FloatArray(3)
    SensorManager.getOrientation(rotation, orientation)
    // Same gate as expo-location: ~2 degrees and 50 ms, so a still phone sends nothing.
    val now = System.currentTimeMillis()
    if (abs(orientation[0] - lastAzimuth) <= 0.0355f || now - lastUpdate <= 50) return
    lastAzimuth = orientation[0]
    lastUpdate = now
    val magHeading = (Math.toDegrees(orientation[0].toDouble()).toFloat() + 360) % 360
    val trueHeading = geofield?.let { (magHeading + it.declination + 360) % 360 } ?: -1f
    sendEvent(
      "onHeading",
      mapOf("trueHeading" to trueHeading, "magHeading" to magHeading, "accuracy" to accuracy)
    )
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
}

private fun Location.toMap(): Map<String, Any?> = mapOf(
  "coords" to mapOf(
    "latitude" to latitude,
    "longitude" to longitude,
    "altitude" to (if (hasAltitude()) altitude else null),
    "accuracy" to (if (hasAccuracy()) accuracy.toDouble() else null),
    "altitudeAccuracy" to null,
    "heading" to (if (hasBearing()) bearing.toDouble() else null),
    "speed" to (if (hasSpeed()) speed.toDouble() else null)
  ),
  "timestamp" to time.toDouble(),
  "mocked" to false
)

/** Same fields, from the same `Address` getters, as expo-location's `ReverseGeocodeResponse`. */
private fun Address.toMap(): Map<String, Any?> = mapOf(
  "city" to locality,
  "district" to subLocality,
  "streetNumber" to subThoroughfare,
  "street" to thoroughfare,
  "region" to adminArea,
  "subregion" to subAdminArea,
  "country" to countryName,
  "postalCode" to postalCode,
  "name" to featureName,
  "isoCountryCode" to countryCode,
  "timezone" to null,
  "formattedAddress" to (0..maxAddressLineIndex).joinToString(", ") { getAddressLine(it) }.ifEmpty { null }
)
