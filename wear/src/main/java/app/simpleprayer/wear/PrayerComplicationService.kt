package app.simpleprayer.wear

import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountDownTimeReference
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import java.time.Instant

/**
 * The complication data source — the next prayer on ANY watch face, in the face's own styling.
 * SHORT_TEXT: a face-ticked countdown (to the window's end while a prayer is current, to the
 * next start otherwise) titled by the prayer's envelope-rendered name. RANGED_VALUE: the same,
 * gauged across the running span. Both countdowns are TimeDifference text — the face re-renders
 * them itself, so UPDATE_PERIOD_SECONDS stays 0 and updates are pushed only when an envelope
 * arrives ([EnvelopeListenerService]).
 */
class PrayerComplicationService : SuspendingComplicationDataSourceService() {

  private data class Subject(
    val name: String,
    val target: Long,
    val spanStart: Long,
    /** The deadline as words ("until 6:42 pm") — the ranged gauge's quiet second line. */
    val secondary: String?
  )

  private fun resolve(now: Long): Subject? {
    val envelope = EnvelopeStore.load(this) ?: return null
    val snapshot = envelope.snapshot
    if (snapshot.isExpiredAt(now)) return null
    val segment = snapshot.segmentAt(now) ?: return null
    val day = snapshot.dayFor(segment.day) ?: return null
    val current = segment.current?.let { name -> day.prayers.firstOrNull { it.prayer == name } }
    if (current?.windowEndAt != null) {
      return Subject(current.name, current.windowEndAt, current.at, current.untilText)
    }
    val next = TodayModel.nextPrayerOf(snapshot, segment) ?: return null
    // The gap: the register word + the start it counts to — the phone widget's own join.
    return Subject(next.name, next.at, segment.from, "${snapshot.strings.statusUpcoming} · ${next.timeText}")
  }

  override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
    val now = System.currentTimeMillis()
    val subject = resolve(now) ?: return NoDataComplicationData()
    val countdown = TimeDifferenceComplicationText.Builder(
      TimeDifferenceStyle.SHORT_DUAL_UNIT,
      CountDownTimeReference(Instant.ofEpochMilli(subject.target))
    ).build()
    val name = PlainComplicationText.Builder(subject.name).build()
    return when (request.complicationType) {
      ComplicationType.SHORT_TEXT ->
        ShortTextComplicationData.Builder(countdown, name)
          .setTitle(name)
          .setMonochromaticImage(mark())
          .build()
      ComplicationType.RANGED_VALUE -> {
        // Span-relative seconds rather than raw epoch floats: Float32 cannot carry an epoch
        // without ~2-minute rounding, and the gauge only needs the fraction anyway. max is
        // floored above min — a zero-width span must never hand a face a division by zero.
        val max = ((subject.target - subject.spanStart) / 1000L).toFloat().coerceAtLeast(1f)
        val value = ((now - subject.spanStart) / 1000L).toFloat().coerceIn(0f, max)
        val builder = RangedValueComplicationData.Builder(value = value, min = 0f, max = max, contentDescription = name)
          .setTitle(name)
          .setMonochromaticImage(mark())
        // The SHORT_TEXT slot already carries the live countdown; the gauge's text is the
        // deadline in words instead, so a face showing both never says the same thing twice.
        subject.secondary?.let {
          builder.setText(PlainComplicationText.Builder(it).build())
        }
        builder.build()
      }
      else -> NoDataComplicationData()
    }
  }

  override fun getPreviewData(type: ComplicationType): ComplicationData? {
    val prayer = PlainComplicationText.Builder(getString(R.string.preview_prayer)).build()
    val countdown = PlainComplicationText.Builder(getString(R.string.preview_countdown)).build()
    return when (type) {
      ComplicationType.SHORT_TEXT ->
        ShortTextComplicationData.Builder(countdown, prayer)
          .setTitle(prayer)
          .setMonochromaticImage(mark())
          .build()
      ComplicationType.RANGED_VALUE ->
        RangedValueComplicationData.Builder(value = 0.6f, min = 0f, max = 1f, contentDescription = prayer)
          .setText(countdown)
          .setTitle(prayer)
          .setMonochromaticImage(mark())
          .build()
      else -> null
    }
  }

  private fun mark(): MonochromaticImage =
    MonochromaticImage.Builder(Icon.createWithResource(this, R.drawable.ic_mosque)).build()
}
