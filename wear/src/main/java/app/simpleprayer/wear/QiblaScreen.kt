package app.simpleprayer.wear

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.inset
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The qibla page — WatchQibla.dc.html at Wear scale. The bearing was precomputed on the phone;
 * the watch only compares the OS heading to that number, which is rendering math, not domain
 * logic. Engage at ≤5°, release past 6° (D86's hysteresis), one haptic on engage. Green appears
 * for alignment and nothing else, and never alone: icon + word, always. The dial never mirrors
 * in RTL — its geometry is geographic.
 */
@Composable
internal fun QiblaScreen(qibla: Envelope.Qibla, language: String) {
  val context = LocalContext.current
  val view = LocalView.current
  // D41: direction and script follow the APP language, which rode in on the envelope — never the
  // watch's own locale.
  val arabic = language == "ar"

  var heading by remember { mutableFloatStateOf(Float.NaN) }
  var aligned by remember { mutableStateOf(false) }

  DisposableEffect(Unit) {
    val manager = context.getSystemService(SensorManager::class.java)
    val sensor = manager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    val listener = object : SensorEventListener {
      private val rotation = FloatArray(9)
      private val orientation = FloatArray(3)
      override fun onSensorChanged(event: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        SensorManager.getOrientation(rotation, orientation)
        val raw = Math.toDegrees(orientation[0].toDouble()).toFloat()
        // EMA on the shortest arc, so 359°→1° never swings the needle the long way round.
        heading =
          if (heading.isNaN()) normalize(raw)
          else normalize(heading + 0.2f * shortestArc(raw - heading))
        // Engage/release live here, once per reading, so the haptic can never double-fire
        // through recomposition. ≤5° in, >6° out — D86's hysteresis.
        val rel = shortestArc(qibla.bearing.toFloat() - heading)
        if (!aligned && abs(rel) <= 5f) {
          aligned = true
          view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        } else if (aligned && abs(rel) > 6f) {
          aligned = false
        }
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }
    if (sensor != null) manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
    onDispose { manager?.unregisterListener(listener) }
  }

  val relative = if (heading.isNaN()) Float.NaN else shortestArc(qibla.bearing.toFloat() - heading)

  val screen = LocalConfiguration.current.screenWidthDp.dp
  val dial = screen * 0.66f

  Column(
    // The guard is what keeps the readout inside the round crop once the user's font setting
    // grows it (WO-V1/WO-V16): the label below the dial is the widest composed line on this page
    // and it sits low, where the circle is already narrowing. Unbounded it could only run wider
    // and wider under the bezel; bounded it wraps to a second line and the dial shifts up.
    modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center
  ) {
    // The engraved cardinals are drawn straight onto the native canvas, and a bare Paint carries
    // no typeface — so the Arabic letters («ش ق ج غ») were leaving the brand for whatever the OEM
    // fallback offered. Named here, where the app language is known. Latin is left as it was
    // rather than quietly restyled: it is a separate call, and en/tr output must not move.
    val cardinalTypeface = remember(arabic) {
      if (arabic) context.resources.getFont(R.font.noto_naskh_arabic_600semibold) else null
    }
    Canvas(modifier = Modifier.size(dial)) {
      // North sits at −heading (the ring is the WORLD); with no heading yet the dial is a
      // plain map, north up — still true, still useful.
      drawDial(
        relative,
        aligned,
        northAngle = if (heading.isNaN()) 0f else -heading,
        letters = listOf(qibla.north, qibla.east, qibla.south, qibla.west),
        letterTypeface = cardinalTypeface
      )
    }
    if (aligned) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.padding(top = 7.dp)
      ) {
        Canvas(modifier = Modifier.size(12.dp)) { drawCheck(pal("alignedText")) }
        val alignedFace = uiFace(arabic, 12f, weight = FontWeight.SemiBold)
        Text(
          text = qibla.alignedLabel,
          fontFamily = alignedFace.family,
          fontWeight = alignedFace.weight,
          fontSize = 12.sp,
          color = pal("alignedText"),
          textAlign = TextAlign.Center
        )
      }
    } else {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.padding(top = 7.dp)
      ) {
        val toRight = !relative.isNaN() && relative >= 0f
        Canvas(modifier = Modifier.size(11.dp)) { drawTurnArrow(pal("muted"), mirrored = !toRight) }
        val degrees =
          if (relative.isNaN()) ""
          else NumberFormat.getIntegerInstance(numericLocale(language))
            .format(abs(relative).roundToInt())
        // 12sp: below the 13sp floor, so Arabic steps up a rung inside [uiFace] (D54/D135).
        val readoutFace = uiFace(arabic, 12f, italic = true)
        Text(
          // The degree readout is the one sanctioned native formatting (app-language numerals);
          // the direction word itself rode in on the envelope.
          text = if (relative.isNaN()) "…"
          else "$degrees° ${if (toRight) qibla.toRightLabel else qibla.toLeftLabel}",
          fontFamily = readoutFace.family,
          fontWeight = readoutFace.weight,
          fontStyle = readoutFace.style,
          fontSize = 12.sp,
          color = pal("muted"),
          textAlign = TextAlign.Center
        )
      }
    }
  }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawDial(
  relative: Float,
  aligned: Boolean,
  northAngle: Float,
  letters: List<String>,
  /** The Arabic UI face for the engraved cardinals; null leaves the system face for Latin. */
  letterTypeface: android.graphics.Typeface?
) {
  val d = size.minDimension
  val c = Offset(d / 2f, d / 2f)
  val ringR = d * 0.467f

  // The compass ring: green tint only while aligned — and the word below always says why.
  if (aligned) {
    drawCircle(pal("alignedTintBg"), ringR, c)
    drawCircle(pal("alignedTintBorder"), ringR, c, style = Stroke(d * 0.008f))
  } else {
    drawCircle(pal("borderMid"), ringR, c, style = Stroke(d * 0.0067f))
  }

  // Eight quiet ticks.
  for (i in 0 until 8) {
    rotate(degrees = i * 45f, pivot = c) {
      drawLine(
        pal("hairline"),
        Offset(c.x, c.y - ringR),
        Offset(c.x, c.y - ringR + d * 0.053f),
        strokeWidth = d * 0.0067f
      )
    }
  }

  // The cardinal engravings (owner, 2026-08-28): letters ride the world's rotation but are
  // DRAWN upright at their computed spot — engraving, not spinning type. Empty letters (an
  // envelope from before the field existed) simply leave the ring quiet.
  if (letters.any { it.isNotEmpty() }) {
    // Sized from a TEXT unit, not from the dial's pixel diameter. `d * 0.075f` was 9.5sp-worth of
    // pixels on a 192dp round — under WO-V14 — and, being pure geometry, it also ignored the
    // user's font setting completely (WO-V1). Going through `.sp.toPx()` answers both at once:
    // DrawScope carries the density AND the font scale.
    val letterPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
      textAlign = android.graphics.Paint.Align.CENTER
      textSize = WEAR_MIN_ESSENTIAL_SP.sp.toPx()
      color = pal("soft").toArgb()
      if (letterTypeface != null) typeface = letterTypeface
    }
    val letterOrbit = d * 0.355f
    letters.forEachIndexed { index, letter ->
      if (letter.isEmpty()) return@forEachIndexed
      val radians = Math.toRadians((northAngle + index * 90f).toDouble() - 90.0)
      val x = c.x + (letterOrbit * Math.cos(radians)).toFloat()
      val y = c.y + (letterOrbit * Math.sin(radians)).toFloat() + letterPaint.textSize * 0.35f
      drawContext.canvas.nativeCanvas.drawText(letter, x, y, letterPaint)
    }
  }

  // The Makkah badge rides at the relative bearing (up = where the wrist points).
  val badgeR = d * 0.07f
  val badgeOrbit = d * 0.387f
  rotate(degrees = if (relative.isNaN()) 0f else relative, pivot = c) {
    val badgeC = Offset(c.x, c.y - badgeOrbit)
    if (aligned) {
      drawCircle(pal("aligned"), badgeR, badgeC)
    } else {
      drawCircle(pal("cardElevated"), badgeR, badgeC)
      drawCircle(pal("borderStrong"), badgeR, badgeC, style = Stroke(d * 0.005f))
    }
    val glyph = badgeR * 1.1f
    translate(left = badgeC.x - glyph, top = badgeC.y - glyph) {
      // drawMosque scales by DrawScope.size, so shrink the canvas it sees to the badge.
      inset(0f, 0f, size.width - glyph * 2f, size.height - glyph * 2f) {
        drawMosque(if (aligned) pal("alignedFg") else pal("inkStrong"))
      }
    }
  }

  // The needle: fixed up — it IS the wrist's heading.
  val needle = if (aligned) pal("aligned") else pal("inkStrong")
  val path = Path().apply {
    moveTo(c.x, d * 0.193f)
    lineTo(c.x + d * 0.03f, d * 0.533f)
    lineTo(c.x, d * 0.573f)
    lineTo(c.x - d * 0.03f, d * 0.533f)
    close()
  }
  drawPath(path, needle)
  drawCircle(needle, d * 0.023f, c)
  // The pivot pinhole: a hole punched through the needle, so it is the CANVAS colour, not a
  // palette one — black since WO-V13 (see the Theme file's header).
  drawCircle(Color.Black, d * 0.01f, c)
}

/** The "turn this way" arrow beside the degree count; mirrored when the turn is leftward. */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawTurnArrow(color: Color, mirrored: Boolean) {
  val s = size.minDimension / 24f
  val stroke = Stroke(width = 2.2f * s, cap = StrokeCap.Round, join = StrokeJoin.Round)
  scale(scaleX = if (mirrored) -1f else 1f, scaleY = 1f) {
    val curve = Path().apply {
      moveTo(5f * s, 18f * s)
      lineTo(5f * s, 13f * s)
      arcTo(Rect(5f * s, 9f * s, 13f * s, 17f * s), 180f, 90f, false)
      lineTo(17f * s, 9f * s)
    }
    drawPath(curve, color, style = stroke)
    val head = Path().apply {
      moveTo(13.5f * s, 5.5f * s)
      lineTo(17f * s, 9f * s)
      lineTo(13.5f * s, 12.5f * s)
    }
    drawPath(head, color, style = stroke)
  }
}

private fun normalize(degrees: Float): Float {
  var d = degrees % 360f
  if (d < 0f) d += 360f
  return d
}

/** The signed shortest way round, in (-180, 180]. */
private fun shortestArc(delta: Float): Float {
  var d = delta % 360f
  if (d > 180f) d -= 360f
  if (d <= -180f) d += 360f
  return d
}
