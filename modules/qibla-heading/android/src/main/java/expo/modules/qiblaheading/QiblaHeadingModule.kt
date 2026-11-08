package expo.modules.qiblaheading

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import android.view.WindowManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The compass heading, read straight off `TYPE_ROTATION_VECTOR` at a rate we choose.
 *
 * ## Why this exists
 *
 * Every route from JS to an Android heading is capped at 5 Hz, for two unrelated reasons, and the
 * needle steps once or twice a second as a result (owner, 2026-08-30, on a Xiaomi 15T Pro: "it
 * updates once a second or maybe faster but it's not smooth. On iOS it's perfect").
 *
 * 1. `expo-sensors` registers every sensor at `SENSOR_DELAY_NORMAL` — 200_000 us, 5 Hz — unless the
 *    app declares `HIGH_SAMPLING_RATE_SENSORS`, at which point it jumps straight to
 *    `SENSOR_DELAY_FASTEST` (`SensorSubscription.kt`). There is no middle setting, and the library's
 *    own `setUpdateInterval` gates only how often the stored sample is *dispatched*, not how often
 *    it is *refreshed*: asking for 50 ms against a 5 Hz sensor re-sends the same yaw four times in
 *    five.
 * 2. `expo-location`'s own heading registers the magnetometer and accelerometer at
 *    `SENSOR_DELAY_NORMAL` too (`LocationModule.kt`), then gates emission on ">2 degrees AND >50 ms".
 *    Turning slowly, that is ~1 Hz.
 *
 * `SENSOR_DELAY_GAME` — 20_000 us, 50 Hz — is what a compass actually wants, and it sits well below
 * the 200 Hz ceiling that `HIGH_SAMPLING_RATE_SENSORS` exists to lift, so it needs no permission and
 * no negotiation with the OEM. Owning the registration is the whole point of this module: the rate
 * stops being a library's binary choice and becomes a constant we can move.
 *
 * ## What it reads
 *
 * `TYPE_ROTATION_VECTOR` is the platform's own gyroscope + accelerometer + magnetometer fusion — the
 * direct counterpart of the `CLHeading` that makes iOS smooth, and already tilt-compensated. On a
 * device with no gyroscope it falls back to `TYPE_GEOMAGNETIC_ROTATION_VECTOR`, the same quaternion
 * assembled without one. If neither exists the module reports [isAvailable] false and JS keeps the
 * old `expo-location` path.
 *
 * The matrix is remapped for the current display rotation before the azimuth is taken, so the
 * heading is measured against the top of the *screen* rather than the top of the *device*. That
 * matters since D124 put a live dial on the landscape glance pane; `expo-location` never did it.
 *
 * ## Which axis the heading is read off, and why it is not the usual one
 *
 * Everyone, `expo-location` included, calls `SensorManager.getOrientation(R)[0]`. That is
 * `atan2(R[1], R[4])`: the azimuth of the **device Y axis**, the line running up the phone from
 * chin to earpiece. Flat on a table it lies along the ground and its azimuth is the heading
 * exactly. Held **upright**, which is how a person points a phone at something, it points at the
 * sky — its horizontal projection collapses towards zero and the azimuth becomes noise over noise.
 * The rotation vector itself is a correct gyro-fused attitude at any tilt, so the matrix was never
 * the problem; the axis was.
 *
 * This module reads the **screen X axis** instead — column 0 of the remapped matrix, the right-hand
 * edge of the interface as drawn. That axis stays horizontal flat, at 45 degrees and straight up,
 * and only degenerates past about 90 degrees of sideways roll, which is nobody's posture for
 * reading a compass. Its azimuth minus 90 degrees is the direction the user is facing: flat, that
 * is bit-for-bit the old reading; upright, it is where the back camera points. The display remap
 * is what makes it the *screen's* X axis rather than the device's, so no per-rotation branching is
 * needed here. `components/NativeNeedleSource` computes the same axis for the needle, from the same
 * sensor, so the needle and the "Turn N°" text cannot disagree.
 *
 * ## Accuracy is the magnetometer's, deliberately
 *
 * The figure-8 prompt calibrates the magnetometer, so the number that decides whether to show it has
 * to be the magnetometer's own `SENSOR_STATUS_ACCURACY_*` — which is exactly what `expo-location`
 * reports today, and what `services/heading.ts` documents itself as mapping. The rotation vector
 * carries an accuracy of its own, but it describes the confidence of the *fused attitude*: it often
 * sits at HIGH while the magnetometer is uncalibrated, and on some builds at UNRELIABLE forever.
 * Either would silently change when the app asks the user to calibrate. So `TYPE_MAGNETIC_FIELD` is
 * registered alongside, at `SENSOR_DELAY_NORMAL`, and its samples are read for nothing but their
 * accuracy — the same 5 Hz stream `expo-location` was running anyway.
 *
 * ### The one exception: a fused yaw that has drifted
 *
 * A gyroscope-fused yaw can drift while the magnetometer stays perfectly calibrated, and then the
 * magnetometer's verdict is true and beside the point. Owner, on a Xiaomi 15T Pro (HyperOS): "if I
 * lock screen then open it again after a while while on the qibla screen I find the whole compass
 * drifted; if I kill the app then reopen after doing the compass figure-8 calibration then it's
 * ok." The needle was tens of degrees out, the magnetometer still said MEDIUM or HIGH, so the app
 * looked confident and was wrong — and the figure-8 card, which is the exact remedy the owner found
 * by hand, never appeared.
 *
 * So `TYPE_GEOMAGNETIC_ROTATION_VECTOR` is registered as a *reference* whenever the needle is on the
 * gyro-fused vector (on a device that fell back to the geomagnetic one there is nothing to
 * cross-check). It is the same quaternion assembled from accelerometer and magnetometer alone: no
 * gyroscope, so no integrated error, so it cannot drift — it can only be noisy, which is precisely
 * why it is a check and never the needle. Both attitudes go through the same [azimuthDegrees] and
 * their signed short-arc difference is low-passed into [driftEma], which is the one measurement
 * everything below is built on.
 *
 * ### Anchoring the needle, not just warning about it
 *
 * Owner, 2026-09-14: "could we have, in the case the gyro fused and raw compass disagree by more
 * than X degrees, and the phone is relatively flat, to default to raw compass readings rather than
 * gyro fused?" Handing the needle over to the reference outright would trade a wrong needle for a
 * jumpy one — the magnetometer-only attitude is the noisy one, and the swap itself would be a
 * visible jump. So the fused stream keeps supplying the MOTION and the reference supplies the
 * ANCHOR: what is emitted is `fused + correction`, the correction being the smoothed disagreement,
 * eased in.
 *
 * - **Engaging.** The disagreement has to be sustained — [DRIFT_ENGAGE_DEG] for [DRIFT_SUSTAIN_MS],
 *   the hysteresis that was already there — *and* the phone has to be relatively flat at that
 *   moment: `|R[8]| >=` [FLAT_MIN_COS], the up-component of the device Z axis, which is the cosine
 *   of the tilt away from the table, so within 45 degrees either way (face down counts; the screen
 *   X axis is horizontal there too). Flat is where the reference is steadiest, gravity square to
 *   the screen, and an anchor is only worth taking from a reference worth trusting.
 * - **Holding.** Once engaged, tilt stops mattering: a phone lifted upright keeps its correction.
 *   Drift is an error in yaw, so a fixed offset is as true at 80 degrees as it was flat. Tilt gates
 *   the *measurement*, never the *use* of it.
 * - **Tracking.** The target is `-driftEma`, recomputed every sample, so the correction follows the
 *   drift as it grows. The disagreement is always measured against the RAW fused azimuth and never
 *   the corrected one, so there is no loop here to cancel its own evidence.
 * - **Releasing.** When the disagreement falls under [DRIFT_RELEASE_DEG] — the fusion has
 *   re-anchored itself, which is what a figure-8 or a walk does — the target returns to 0 and the
 *   correction eases back out.
 * - **Never jumping.** The applied correction moves [CORRECTION_RAMP] of the way to its target per
 *   emitted sample along the short arc: about a quarter of a second at the 50 Hz this emits at,
 *   which reads as a needle settling rather than one snapping. This is not smoothing of the
 *   heading, and D145's no-smoothing stance is untouched: the needle still follows the sensor
 *   sample for sample, and it is only the offset added to it that moves slowly.
 *
 * `magHeading`, `trueHeading` and the emitted `driftOffset` all carry the correction, so the
 * "Turn N°" readout, the alignment haptic, the JS fallback needle and the Reanimated worklet (which
 * reads the same fused sensor itself, on the UI thread, and adds `driftOffset` to its own target)
 * all move as one. Nothing downstream has to know a correction happened.
 *
 * The card comes out of the same state machine and now means something narrower. `accuracy` is
 * pulled down to `SENSOR_STATUS_ACCURACY_LOW` only while the disagreement is sustained and the
 * correction could NOT engage — the phone was never flat long enough to take an anchor from. There
 * the needle really is wrong and the figure-8 is the only remedy left. While the correction IS
 * engaged the needle is right, so the magnetometer's own verdict stands and the user is left alone.
 * Down only either way: the cross-check can lower the magnetometer's verdict and never raise it, so
 * a device already reporting LOW or UNRELIABLE reads exactly as it does today.
 *
 * 20 degrees, 10 degrees, 3 seconds, the 45 degrees of tilt and the 0.08 ramp are all first
 * guesses: high enough to sit well clear of the geomagnetic vector's own noise, long enough to need
 * a sustained disagreement rather than a passing one, slow enough that the anchor is not seen
 * arriving. They have not yet met the owner's device, and should be expected to move once they
 * have.
 *
 * ## Declination
 *
 * `trueHeading` needs the local declination, which needs a location. JS supplies one through
 * [setLocation] and `GeomagneticField` does the rest — the platform's model, kept current by the
 * OS, which is how `LocationModule.kt` does it too. With no location the module emits `-1`,
 * `expo-location`'s own "no true heading" sentinel, and the app falls back to magnetic north exactly
 * as it does today. Nothing is bundled: a WMM table shipped in the binary would carry a five-year
 * expiry date (D119).
 *
 * ## What it deliberately does not do
 *
 * It never asks for a permission, never resolves a location, and never touches the sensor set
 * beyond the three above — the rotation vector it emits, the magnetometer it reads the accuracy
 * from, and the geomagnetic vector it cross-checks against. It has no opinion about the qibla — it
 * reports where the phone points, and `domain/qibla` owns every angle after that.
 */
class QiblaHeadingModule : Module(), SensorEventListener {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val sensorManager: SensorManager
    get() = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

  /** Reused across events: allocating two 9-float matrices 50 times a second is not free. */
  private val rotationMatrix = FloatArray(9)
  private val remappedMatrix = FloatArray(9)

  /**
   * Only for the OEM builds that report five values; see [azimuthDegrees].
   *
   * The ordinary three- and four-value events are handed to `getRotationMatrixFromVector`
   * untouched, so nothing is copied 50 times a second for them.
   */
  private val truncatedVector = FloatArray(4)

  private var geomagneticField: GeomagneticField? = null

  /**
   * The display's rotation, read when it changes rather than 50 times a second.
   *
   * `Activity.getDisplay()` is a service lookup and it can throw when the activity is not attached
   * to a display, which is not something to discover inside `onSensorChanged`. A
   * [DisplayManager.DisplayListener] is the exact answer: unlike a configuration callback it fires
   * for a half turn between portrait and reverse portrait, which changes no configuration but does
   * turn the compass around — the case a tablet or an opened foldable reaches, since D123 unlocks
   * all four rotations there.
   */
  private var cachedDisplayRotation = Surface.ROTATION_0

  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) = Unit

    override fun onDisplayRemoved(displayId: Int) = Unit

    override fun onDisplayChanged(displayId: Int) {
      cachedDisplayRotation = readDisplayRotation()
    }
  }

  private var displayManager: DisplayManager? = null

  /**
   * The magnetometer's calibration constant, or `-1` until it first speaks.
   *
   * `-1` maps to `unavailable` in JS, which is honest — nothing has reported yet — and is the same
   * opening state `expo-location` produces. `useHeading`'s calibration grace period is what keeps
   * that first moment from flashing a calibration card on a healthy device.
   */
  private var magnetometerAccuracy = -1

  /**
   * Whether the magnetometer-only reference is running alongside the needle's own sensor.
   *
   * False on a device that fell back to `TYPE_GEOMAGNETIC_ROTATION_VECTOR` for the needle (nothing
   * to cross-check: it would be comparing a sensor with itself), and false when the platform has no
   * geomagnetic vector or refused the registration. While it is false the whole cross-check is
   * skipped and `accuracy` is the magnetometer's, exactly as before.
   */
  private var crossCheckEnabled = false

  /** The last reference azimuth in degrees, or `NaN` before the reference has spoken. */
  private var referenceAzimuth = Double.NaN

  /** [SystemClock.elapsedRealtime] at which [referenceAzimuth] was measured. */
  private var referenceAt = 0L

  /**
   * Low-passed signed short-arc difference, fused minus magnetometer-only, in degrees. `NaN` until
   * the first pair, so the first comparison is adopted outright rather than easing up from zero.
   */
  private var driftEma = Double.NaN

  /**
   * [SystemClock.elapsedRealtime] at which the two attitudes first disagreed by more than
   * [DRIFT_ENGAGE_DEG], or `0` while they agree. The card needs the disagreement to have lasted
   * [DRIFT_SUSTAIN_MS], which is what this remembers.
   */
  private var disagreementSince = 0L

  /**
   * How flat the phone was on the last emitted sample: `R[8]`, the up-component of the device Z
   * axis, which is the cosine of the tilt away from lying on a table — `±1` flat, `0` upright.
   *
   * Written only from the primary sensor. How the phone is being held is a fact about the device,
   * and the reference's own attitude has no business answering it.
   */
  private var lastFlatness = 0.0

  /** Whether the anchor is engaged: a sustained disagreement that began with the phone flat. */
  private var correctionEngaged = false

  /** Degrees the anchor is easing towards — `-driftEma` while engaged, `0` otherwise. */
  private var targetCorrection = 0.0

  /** Degrees actually added to the fused azimuth right now. Ramped towards the target, never set. */
  private var appliedCorrection = 0.0

  private var minIntervalMs = DEFAULT_MIN_INTERVAL_MS
  private var lastEmitAt = 0L
  private var isObserving = false

  override fun definition() = ModuleDefinition {
    Name("QiblaHeading")

    Events(HEADING_EVENT)

    /**
     * Whether this device exposes a rotation vector at all. JS uses the answer to choose between
     * this module and the `expo-location` path it replaces, so a device without one keeps exactly
     * today's behaviour rather than losing its compass (D38: no device may regress).
     */
    Function("isAvailable") {
      rotationSensor() != null
    }

    /**
     * The floor on how often a heading event reaches JS, in milliseconds.
     *
     * This throttles *delivery*, not sampling — the sensor stays at [SENSOR_RATE_US] so every
     * emitted value is fresh, which is precisely the distinction `expo-sensors` loses.
     */
    Function("setUpdateInterval") { intervalMs: Int ->
      minIntervalMs = intervalMs.coerceAtLeast(0).toLong()
    }

    /** The location whose declination turns a magnetic heading into a true one. */
    Function("setLocation") { latitude: Double, longitude: Double, altitude: Double ->
      geomagneticField = if (latitude.isFinite() && longitude.isFinite()) {
        GeomagneticField(
          latitude.toFloat(),
          longitude.toFloat(),
          if (altitude.isFinite()) altitude.toFloat() else 0f,
          System.currentTimeMillis()
        )
      } else {
        null
      }
    }

    /** Forgets the location, so `trueHeading` returns to its `-1` sentinel. */
    Function("clearLocation") {
      geomagneticField = null
    }

    OnStartObserving(HEADING_EVENT) { start() }

    OnStopObserving(HEADING_EVENT) { stop() }

    // A backgrounded app must not hold the sensor open. `isObserving` is kept across the pause so
    // returning to the foreground resumes without JS having to re-subscribe.
    OnActivityEntersForeground { if (isObserving) register() }

    OnActivityEntersBackground { if (isObserving) unregister() }

    OnDestroy { stop() }
  }

  // -------------------------------------------------------------------------
  // Sensor plumbing
  // -------------------------------------------------------------------------

  /**
   * The gyro-fused rotation vector, or the magnetometer-only one on a device with no gyroscope.
   *
   * @return The sensor to drive the needle with, or `null` when the device has neither.
   */
  private fun rotationSensor(): Sensor? =
    sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
      ?: sensorManager.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)

  private fun start() {
    if (isObserving) return
    isObserving = true
    register()
  }

  private fun stop() {
    if (!isObserving) return
    isObserving = false
    unregister()
    lastEmitAt = 0L
    magnetometerAccuracy = -1
    resetCrossCheck()
  }

  private fun register() {
    val rotation = rotationSensor() ?: return
    val manager = sensorManager
    manager.registerListener(this, rotation, SENSOR_RATE_US)
    // Read for its accuracy and nothing else — see the class doc.
    manager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)?.let {
      manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
    }
    // The drift cross-check, which starts from nothing on every registration: a session that
    // resumes after a lock has no business inheriting a verdict earned before it.
    resetCrossCheck()
    if (rotation.type == Sensor.TYPE_ROTATION_VECTOR) {
      // Cannot drift, only be noisy — the reference, never the needle. See the class doc.
      val reference = manager.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)
      if (reference != null) {
        crossCheckEnabled = manager.registerListener(this, reference, REFERENCE_RATE_US)
      }
    }
    // Seeded once here so the first event is right even if the display never speaks again.
    cachedDisplayRotation = readDisplayRotation()
    if (displayManager == null) {
      displayManager =
        (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.also {
          it.registerDisplayListener(displayListener, Handler(Looper.getMainLooper()))
        }
    }
  }

  private fun unregister() {
    // The display listener first: it needs no context lookup, so it comes off even on the teardown
    // where the React context has already gone and `sensorManager` throws.
    displayManager?.unregisterDisplayListener(displayListener)
    displayManager = null
    // Before the sensor lookup, for the same reason: this needs no context and must happen even on
    // the teardown where `sensorManager` throws.
    resetCrossCheck()
    sensorManager.unregisterListener(this)
  }

  /**
   * Forgets every cross-check observation, so the next session earns its verdict from scratch —
   * the anchor included: a correction measured before a lock has no claim on the session after it.
   */
  private fun resetCrossCheck() {
    crossCheckEnabled = false
    referenceAzimuth = Double.NaN
    referenceAt = 0L
    driftEma = Double.NaN
    disagreementSince = 0L
    lastFlatness = 0.0
    correctionEngaged = false
    targetCorrection = 0.0
    appliedCorrection = 0.0
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
    if (sensor?.type == Sensor.TYPE_MAGNETIC_FIELD) magnetometerAccuracy = accuracy
  }

  override fun onSensorChanged(event: SensorEvent) {
    val type = event.sensor.type
    if (type == Sensor.TYPE_MAGNETIC_FIELD) {
      // `SensorEvent.accuracy` carries the same constant `onAccuracyChanged` delivers, and arrives
      // even on a device that never fires the callback.
      magnetometerAccuracy = event.accuracy
      return
    }

    if (crossCheckEnabled && type == Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR) {
      // The reference: measured, remembered, never emitted. Reached only when the needle is on the
      // gyro-fused vector, so this is never the sensor the user is looking at.
      recordReference(event)
      return
    }

    val now = SystemClock.elapsedRealtime()
    if (now - lastEmitAt < minIntervalMs) return

    val fused = azimuthDegrees(event, isPrimary = true) ?: return
    lastEmitAt = now

    // One call, both answers, and they are exclusive by construction: either the reference could
    // anchor the needle, or it could only warn about it. See the class doc.
    val askForFigureEight = updateCrossCheck(fused, now)
    // What everything downstream sees — readout, guidance, haptic and the JS fallback needle.
    val heading = normalize(fused + appliedCorrection)

    val declination = geomagneticField?.declination
    sendEvent(
      HEADING_EVENT,
      Bundle().apply {
        putDouble("magHeading", heading)
        putDouble(
          "trueHeading",
          if (declination == null) NO_TRUE_HEADING else normalize(heading + declination.toDouble())
        )
        // The correction on its own, for the UI-thread worklet: it reads the same fused sensor
        // directly and would otherwise be the one path still showing the drifted yaw.
        putDouble("driftOffset", appliedCorrection)
        putInt(
          "accuracy",
          if (askForFigureEight) {
            // Down only, never up: the magnetometer's own verdict still caps this.
            minOf(magnetometerAccuracy, SensorManager.SENSOR_STATUS_ACCURACY_LOW)
          } else {
            magnetometerAccuracy
          }
        )
      }
    )
  }

  /**
   * Stores the magnetometer-only azimuth this event carries, as the yardstick the next fused sample
   * is measured against.
   *
   * The whole body is guarded: `getRotationMatrixFromVector` has historically thrown on value arrays
   * it did not expect, and a sanity check has no business taking the compass — or the app — down
   * with it. A skipped reference simply ages out and the cross-check keeps quiet.
   *
   * @param event A `TYPE_GEOMAGNETIC_ROTATION_VECTOR` event. [azimuthDegrees] takes any
   *              rotation-vector event, five-value OEM builds included.
   */
  private fun recordReference(event: SensorEvent) {
    try {
      val azimuth = azimuthDegrees(event) ?: return
      referenceAzimuth = azimuth
      referenceAt = SystemClock.elapsedRealtime()
    } catch (_: Exception) {
      referenceAzimuth = Double.NaN
    }
  }

  /**
   * Folds one fused sample into the cross-check: moves [appliedCorrection], and reports whether the
   * fusion looks drifted with no anchor to fix it.
   *
   * Called once per emitted sample, so both the filter and the ramp run at the delivery rate rather
   * than the sensor rate — which costs nothing that matters here, since [DRIFT_SUSTAIN_MS] is
   * measured in seconds and even a heavily throttled stream folds in dozens of samples inside it.
   * [CORRECTION_RAMP] is written against that same rate.
   *
   * @param fusedAzimuth The RAW fused heading, before any correction — the correction is derived
   *                     from this comparison, so feeding the corrected value back in would close a
   *                     loop that erases its own evidence.
   * @param now [SystemClock.elapsedRealtime] for this sample.
   * @return `true` while the two attitudes have disagreed for at least [DRIFT_SUSTAIN_MS] *and* the
   *         phone has not been flat enough to anchor the needle instead — the case where the card
   *         is the only remedy left.
   */
  private fun updateCrossCheck(fusedAzimuth: Double, now: Long): Boolean {
    if (!crossCheckEnabled) return false

    val reference = referenceAzimuth
    if (reference.isNaN() || now - referenceAt > REFERENCE_MAX_AGE_MS) {
      // Nothing fresh to compare against, so no opinion — and nothing carried over either. A
      // verdict has to be earned again on evidence rather than remembered through the blind spell.
      // An anchor already engaged is held through a short gap, because it was measured against a
      // reference that was there and easing the needle back onto a yaw known to be drifted would
      // be the worse answer — but not for ever: a reference that has stopped for
      // [REFERENCE_BLIND_MAX_MS] (a sensor-hub stall, the very HyperOS failure this exists for)
      // may have outlived the drift it measured, and an offset held blind past that is pure error
      // with no card to say so. The anchor lets go and the correction ramps back to zero.
      driftEma = Double.NaN
      disagreementSince = 0L
      if (correctionEngaged && (referenceAzimuth.isNaN() || now - referenceAt > REFERENCE_BLIND_MAX_MS)) {
        correctionEngaged = false
        targetCorrection = 0.0
      }
      rampCorrection()
      return false
    }

    val delta = shortestArc(fusedAzimuth - reference)
    if (!delta.isFinite()) {
      rampCorrection()
      return false
    }
    driftEma = if (driftEma.isNaN()) delta else driftEma + DRIFT_SMOOTHING * (delta - driftEma)

    val disagreement = Math.abs(driftEma)
    if (disagreement > DRIFT_ENGAGE_DEG) {
      if (disagreementSince == 0L) disagreementSince = now
    } else if (disagreement < DRIFT_RELEASE_DEG) {
      // Hysteresis: between the two thresholds nothing changes, so a reading sitting on the line
      // can neither flicker the calibration card nor let go of the anchor.
      disagreementSince = 0L
      correctionEngaged = false
    }

    val sustained = disagreementSince != 0L && now - disagreementSince >= DRIFT_SUSTAIN_MS
    // Flat is what makes the reference worth anchoring to, and a magnetometer the platform itself
    // rates at least MEDIUM is what makes it a reference at all: walked past a steel door or a
    // laptop hinge, the magnetometer-only attitude swings at once while the fusion correctly
    // lags — a disagreement whose right answer is the card, never the anchor. Both are checked
    // only on the way in: once the offset is measured, the posture the phone is held in afterwards
    // says nothing about it.
    if (
      sustained &&
      !correctionEngaged &&
      Math.abs(lastFlatness) >= FLAT_MIN_COS &&
      magnetometerAccuracy >= SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM
    ) {
      correctionEngaged = true
    }
    targetCorrection = if (correctionEngaged) -driftEma else 0.0
    rampCorrection()

    return sustained && !correctionEngaged
  }

  /**
   * Eases [appliedCorrection] a fraction of the way towards [targetCorrection], along the short arc
   * so a target on the far side of the seam is approached the near way round.
   *
   * The last fraction of a degree is snapped rather than halved forever: an asymptote nobody can
   * see is not worth the arithmetic on every sample.
   */
  private fun rampCorrection() {
    val remaining = shortestArc(targetCorrection - appliedCorrection)
    if (!remaining.isFinite() || Math.abs(remaining) < CORRECTION_SETTLED_DEG) {
      appliedCorrection = if (targetCorrection.isFinite()) targetCorrection else 0.0
      return
    }
    appliedCorrection = shortestArc(appliedCorrection + remaining * CORRECTION_RAMP)
  }

  /**
   * Wraps a difference of two azimuths into the signed short arc.
   *
   * @return Degrees in `[-180, 180)`: `+10` for 355 to 5, `-10` for 5 to 355 — never the 350 the
   *         plain subtraction gives.
   */
  private fun shortestArc(degrees: Double): Double = ((degrees % 360.0) + 540.0) % 360.0 - 180.0

  /**
   * The screen-referenced azimuth for one rotation-vector event.
   *
   * @param event Any rotation-vector event, five-value OEM builds included.
   * @param isPrimary `true` for the sensor the needle is driven by, which is the only one allowed
   *                  to update [lastFlatness]. The reference passes `false`: it describes the same
   *                  phone, but it arrives on its own schedule and the anchor's flatness test is
   *                  about the posture at the moment of the sample being emitted.
   * @return Degrees clockwise from magnetic north in `[0, 360)`, or `null` when the platform could
   *         not build a rotation matrix from this event.
   */
  private fun azimuthDegrees(event: SensorEvent, isPrimary: Boolean = false): Double? {
    // Some OEM builds report five values here. `getRotationMatrixFromVector` wants three or four
    // and has historically thrown on longer arrays, so those — and only those — are truncated into
    // a buffer; the ordinary event is passed straight through, unallocated.
    val values = event.values
    val vector = if (values.size > 4) {
      System.arraycopy(values, 0, truncatedVector, 0, 4)
      truncatedVector
    } else {
      values
    }

    // Returns void, unlike `getRotationMatrix` — there is no success flag to check here.
    SensorManager.getRotationMatrixFromVector(rotationMatrix, vector)

    // R[8] is the Up component of column 2 — the device Z axis, the screen normal — so it is the
    // cosine of the tilt away from lying flat. Taken before the remap, which only permutes the two
    // in-plane axes and leaves this entry alone. See [lastFlatness].
    if (isPrimary) lastFlatness = rotationMatrix[8].toDouble()

    // Column 0 of the device→world matrix, after the remap: the SCREEN X axis expressed in
    // (East, North, Up). Column j of R is device axis j in world coordinates, so these two entries
    // are that axis's ground track. See the class doc for why this axis and not the device Y one.
    val matrix = remapForDisplay(rotationMatrix, remappedMatrix)
    val east = matrix[0]
    val north = matrix[3]
    if (!east.isFinite() || !north.isFinite()) return null
    // The axis runs along the right-hand edge; the user faces 90 degrees anticlockwise of it.
    return normalize(Math.toDegrees(Math.atan2(east.toDouble(), north.toDouble())) - 90.0)
  }

  /**
   * Rotates the world-to-device matrix into the world-to-*screen* one.
   *
   * Without this the azimuth is measured against the top of the device, so a landscape layout — the
   * glance pane added in D124, or a tablet — reads 90 degrees off.
   *
   * @return [remapped] when a remap applied, otherwise [source] untouched.
   */
  private fun remapForDisplay(source: FloatArray, remapped: FloatArray): FloatArray {
    val axes = when (cachedDisplayRotation) {
      Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
      Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
      Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
      else -> return source
    }
    return if (SensorManager.remapCoordinateSystem(source, axes.first, axes.second, remapped)) {
      remapped
    } else {
      source
    }
  }

  /**
   * Asks the platform which way up the display is. Called on registration and on a display change,
   * never per sensor event — see [cachedDisplayRotation].
   *
   * @return One of the `Surface.ROTATION_*` constants, defaulting to [Surface.ROTATION_0] whenever
   *         the platform cannot answer.
   */
  @Suppress("DEPRECATION")
  private fun readDisplayRotation(): Int = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      appContext.currentActivity?.display?.rotation ?: Surface.ROTATION_0
    } else {
      val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
      windowManager?.defaultDisplay?.rotation ?: Surface.ROTATION_0
    }
  } catch (_: Exception) {
    // `Activity.getDisplay()` throws when the activity is not attached to a display, and the
    // React context can be gone by the time a teardown races a rotation. Portrait is the honest
    // fallback: it is what the manifest locks every phone to.
    Surface.ROTATION_0
  }

  private fun normalize(degrees: Double): Double = ((degrees % 360.0) + 360.0) % 360.0

  companion object {
    private const val HEADING_EVENT = "onHeading"

    /** 20_000 us: `SENSOR_DELAY_GAME`, 50 Hz. Named because it is the entire point of the module. */
    private val SENSOR_RATE_US = SensorManager.SENSOR_DELAY_GAME

    /** 20 ms between events unless JS says otherwise — one per sensor sample at 50 Hz. */
    private const val DEFAULT_MIN_INTERVAL_MS = 20L

    /**
     * `SENSOR_DELAY_UI` — 60_000 us, ~16 Hz — for the drift reference.
     *
     * It is a sanity check, not a needle: nothing renders from it, and a slower stream costs less
     * battery while still delivering many samples inside [DRIFT_SUSTAIN_MS].
     */
    private val REFERENCE_RATE_US = SensorManager.SENSOR_DELAY_UI

    /**
     * Past this age the reference attitude is stale and the cross-check has no opinion. At
     * [REFERENCE_RATE_US] a healthy reference arrives ~16 times inside it, so reaching this means
     * the sensor stopped, not that it was slow.
     */
    private const val REFERENCE_MAX_AGE_MS = 200L

    /**
     * How long an engaged anchor is held through a silent reference before it lets go. A gap of a
     * few reads is a hiccup; ten seconds is a sensor that has stopped, and an offset measured
     * against it may by then be measuring nothing.
     */
    private const val REFERENCE_BLIND_MAX_MS = 10_000L

    /** Fraction of the remaining error the drift filter removes per sample. */
    private const val DRIFT_SMOOTHING = 0.2

    /**
     * Degrees of sustained disagreement that call the fused yaw drifted, and the smaller
     * disagreement it has to fall back to before the verdict clears.
     *
     * First guesses, not measurements: comfortably above the geomagnetic vector's own noise, and
     * well below the drift the owner saw. See the class doc — they await a real device.
     */
    private const val DRIFT_ENGAGE_DEG = 20.0
    private const val DRIFT_RELEASE_DEG = 10.0

    /** How long the disagreement must last before it counts. A momentary one is a bump, not drift. */
    private const val DRIFT_SUSTAIN_MS = 3_000L

    /**
     * How flat "relatively flat" is, as the cosine of the tilt: `cos(45°)`, compared against the
     * absolute value of `R[8]`, so 45 degrees either way and face down as well as face up.
     *
     * Wide on purpose. This gates only where an anchor may be *taken*, and a phone read on a table,
     * a desk or a lap is inside it; a phone held up to point at something is not, and that is the
     * posture where the reference is noisiest.
     */
    private const val FLAT_MIN_COS = 0.7071

    /**
     * Fraction of the remaining correction applied per emitted sample.
     *
     * 0.08 at the 20 ms delivery floor is a time constant of about a quarter of a second: fast
     * enough that the needle is right by the time the user has looked at it, slow enough that they
     * see it settle rather than jump. The ramp lives here rather than in the worklet so the readout
     * and the needle move together — one ramp, one place.
     */
    private const val CORRECTION_RAMP = 0.08

    /** Where the ramp has arrived. A twentieth of a degree is not worth another sample of easing. */
    private const val CORRECTION_SETTLED_DEG = 0.05

    /** `expo-location`'s sentinel for "this platform cannot determine a true heading". */
    private const val NO_TRUE_HEADING = -1.0
  }
}
