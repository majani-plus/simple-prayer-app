package app.simpleprayer.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.inset
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The night-paper manuscript, in Compose.
 *
 * The watch CANVAS is black — pure `Color.Black`, per Wear OS quality guideline WO-V13, which
 * asks every app screen and tile for a black background (Play's finding on version 900000005).
 * It is the one colour on this watch that does not come from the palette, and it is painted in
 * exactly two places: `BlackCanvas` in `MainActivity`, and the needle's pivot pinhole on the
 * qibla dial, which exists to show the canvas through the needle.
 *
 * Every OTHER colour is still `WidgetPalette.night` — the cards, the hairlines, the gold, the
 * ink — reached only through [pal], never as a literal. So the manuscript survives intact; it is
 * simply lit against black now rather than printed on brown, and reads a touch higher-contrast
 * for it.
 */
internal fun pal(role: String): Color = Color(WidgetPalette.color(role, night = true))

internal val Lora = FontFamily(
  Font(R.font.lora_regular, FontWeight.Normal),
  Font(R.font.lora_semibold, FontWeight.SemiBold),
  Font(R.font.lora_bold, FontWeight.Bold),
  Font(R.font.lora_italic, FontWeight.Normal, FontStyle.Italic)
)

/**
 * Amiri — Arabic **calligraphy** only (D135): the hero prayer name and the Arabic companion that
 * rides above a Latin one. It ships 400 and 700 and nothing between, which is exactly why it
 * cannot carry UI text: behind a `weight >= 600 ? bold : regular` selector every default line of
 * body copy came out Bold while its Latin twin read as a semibold serif.
 */
internal val Amiri = FontFamily(
  Font(R.font.amiri_regular, FontWeight.Normal),
  Font(R.font.amiri_bold, FontWeight.Bold)
)

/**
 * Noto Naskh Arabic — Arabic **UI** text (D135): every Latin-designed line on this watch once the
 * app language is Arabic. Three rungs map one-for-one against Lora's, so the ladder Arabic used to
 * lose at both ends is here.
 *
 * There is no italic and there must not be a synthesized one — Arabic has no italic, and a slanted
 * naskh is a Latin habit imposed on a script that does not want it. The quiet register Lora carries
 * with `lora_italic` is carried here by weight and tone instead.
 *
 * Measured from the shipped TTFs rather than assumed: Noto Naskh's Arabic body (ه) is 433/1000
 * against Lora's 500 x-height, where Amiri's is 337 — so the same nominal size draws a body about
 * a quarter larger than Amiri did, which is most of what "Arabic looks small" was. Its
 * Arabic-Indic digits are uniform-width in all three weights (449/475/488), so a column of times
 * still aligns and a ticking countdown never reflows.
 */
internal val NotoNaskh = FontFamily(
  Font(R.font.noto_naskh_arabic_400regular, FontWeight.Normal),
  Font(R.font.noto_naskh_arabic_600semibold, FontWeight.SemiBold),
  Font(R.font.noto_naskh_arabic_700bold, FontWeight.Bold)
)

/** The family, weight and slant one line of watch UI text resolves to. */
internal data class WearFace(
  val family: FontFamily,
  val weight: FontWeight,
  val style: FontStyle
)

/** Below this an Arabic UI line steps up a rung — D54, as amended by D135. */
internal const val ARABIC_SMALL_SP = 13f

/**
 * Wear OS quality requirement WO-V14, as a number: **12sp** for essential text, **10sp** for
 * ornament. Both floors apply to the size that actually reaches the glass — AFTER the hero's
 * small-round `k` factor — because that is what a reviewer measures and what an older eye reads.
 * A 192dp round (WO-V16's own floor) shrinks every `n * k` line by ~15%, which is how a hero
 * tuned at 9.5 arrived on a wrist at 8.
 *
 * Use [essentialSp] / [ornamentSp] rather than the constants: the floored value must be the one
 * handed to BOTH [uiFace] and `fontSize`, since the sub-13sp Arabic step-up keys off it, and a
 * call site that floors one and not the other changes weight without changing size.
 *
 * The layout absorbs the growth (the hero column grows and the page scrolls); type is never
 * shrunk back to fit.
 */
internal const val WEAR_MIN_ESSENTIAL_SP = 12f

/** WO-V14's floor for text that carries no information on its own. See [WEAR_MIN_ESSENTIAL_SP]. */
internal const val WEAR_MIN_ORNAMENT_SP = 10f

/** A resolved size raised to the essential floor (WO-V14). */
internal fun essentialSp(sizeSp: Float): Float = maxOf(sizeSp, WEAR_MIN_ESSENTIAL_SP)

/** A resolved size raised to the ornament floor (WO-V14). */
internal fun ornamentSp(sizeSp: Float): Float = maxOf(sizeSp, WEAR_MIN_ORNAMENT_SP)

/**
 * The one selector for UI text on the watch: Lora for Latin, Noto Naskh for Arabic, and the
 * sub-13sp weight step-up applied HERE so no call site can forget it — the same single choke point
 * `AppText` is on the phone.
 *
 * Pass the **resolved** size (after the small-round `k` factor): the rule is about the size that
 * actually reaches the glass, not the one written in the source.
 *
 * Calligraphy does not come through here. The Arabic hero name and the Arabic companion name
 * ask for [Amiri] themselves, at their own sizes, because they are Arabic-designed lines rather
 * than Latin ones rendered in Arabic.
 */
internal fun uiFace(
  arabic: Boolean,
  sizeSp: Float,
  weight: FontWeight = FontWeight.Normal,
  italic: Boolean = false
): WearFace {
  if (!arabic) {
    return WearFace(Lora, weight, if (italic) FontStyle.Italic else FontStyle.Normal)
  }
  // D54 as amended by D135: sub-13sp Arabic asking for less than SemiBold gets SemiBold — Noto
  // Naskh's own next rung, not Amiri Bold, so a caption never changes typeface under its row.
  // D54 asked for Bold only because Amiri had no rung between 400 and 700.
  val stepped =
    if (sizeSp < ARABIC_SMALL_SP && weight.weight < FontWeight.SemiBold.weight) FontWeight.SemiBold
    else weight
  return WearFace(NotoNaskh, stepped, FontStyle.Normal)
}

// ---------------------------------------------------------------------------
// Glyphs — the widget drawables' vocabulary, drawn as paths (no tinted resources needed here)
// ---------------------------------------------------------------------------

/** The mosque mark, `Logo.tsx`'s 'small' variant (64-viewport paths). */
internal fun DrawScope.drawMosque(color: Color, alpha: Float = 1f) {
  val s = size.minDimension / 64f
  val stroke = Stroke(width = 6f * s, cap = StrokeCap.Round)
  val dome = Path().apply {
    moveTo(18f * s, 42f * s)
    arcTo(Rect(18f * s, 28f * s, 46f * s, 56f * s), 180f, 180f, false)
  }
  drawPath(dome, color, alpha = alpha, style = stroke)
  drawLine(color, Offset(11f * s, 42f * s), Offset(11f * s, 30f * s), stroke.width, StrokeCap.Round, alpha = alpha)
  drawLine(color, Offset(53f * s, 42f * s), Offset(53f * s, 30f * s), stroke.width, StrokeCap.Round, alpha = alpha)
  drawLine(color, Offset(8f * s, 47f * s), Offset(56f * s, 47f * s), stroke.width, StrokeCap.Round, alpha = alpha)
}

/** The seal's check (24-viewport). */
internal fun DrawScope.drawCheck(color: Color, alpha: Float = 1f) {
  val s = size.minDimension / 24f
  val path = Path().apply {
    moveTo(5.5f * s, 12.5f * s)
    lineTo(9.7f * s, 16.7f * s)
    lineTo(18.5f * s, 8f * s)
  }
  drawPath(path, color, alpha = alpha, style = Stroke(width = 2.8f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

/** The rest crescent — a disc with the moon's shadow lifted out of it. */
internal fun DrawScope.drawCrescent(color: Color) {
  val r = size.minDimension * 0.38f
  val c = Offset(size.width / 2f, size.height / 2f)
  // A layer so the clearing circle punches through the disc, not through the seal behind it.
  drawContext.canvas.saveLayer(Rect(Offset.Zero, size), Paint())
  drawCircle(color, r, c)
  drawCircle(Color.Black, r * 0.82f, c + Offset(r * 0.5f, -r * 0.35f), blendMode = BlendMode.Clear)
  drawContext.canvas.restore()
}

/** The late clock: a ring and two honest hands. */
internal fun DrawScope.drawClock(color: Color) {
  val r = size.minDimension * 0.36f
  val c = Offset(size.width / 2f, size.height / 2f)
  val stroke = size.minDimension * 0.1f
  drawCircle(color, r, c, style = Stroke(stroke))
  drawLine(color, c, c + Offset(0f, -r * 0.55f), stroke, StrokeCap.Round)
  drawLine(color, c, c + Offset(r * 0.45f, r * 0.2f), stroke, StrokeCap.Round)
}

/** The missed ✕. */
internal fun DrawScope.drawClose(color: Color) {
  val r = size.minDimension * 0.26f
  val c = Offset(size.width / 2f, size.height / 2f)
  val stroke = size.minDimension * 0.11f
  drawLine(color, c + Offset(-r, -r), c + Offset(r, r), stroke, StrokeCap.Round)
  drawLine(color, c + Offset(r, -r), c + Offset(-r, r), stroke, StrokeCap.Round)
}

/** The sunrise marker's little sun (24-viewport). */
internal fun DrawScope.drawSunrise(color: Color) {
  val s = size.minDimension / 24f
  val stroke = Stroke(width = 1.8f * s, cap = StrokeCap.Round)
  drawCircle(color, 4.5f * s, Offset(12f * s, 15f * s), style = stroke)
  drawLine(color, Offset(4f * s, 19f * s), Offset(20f * s, 19f * s), stroke.width, StrokeCap.Round)
  drawLine(color, Offset(12f * s, 7f * s), Offset(12f * s, 5f * s), stroke.width, StrokeCap.Round)
  drawLine(color, Offset(6.4f * s, 9.4f * s), Offset(5f * s, 8f * s), stroke.width, StrokeCap.Round)
  drawLine(color, Offset(17.6f * s, 9.4f * s), Offset(19f * s, 8f * s), stroke.width, StrokeCap.Round)
}

// ---------------------------------------------------------------------------
// The seal — PrayerSeal.tsx's face table at watch scale, one drawing per state
// ---------------------------------------------------------------------------

@Composable
internal fun Seal(face: TodayModel.SealFace, size: Dp, modifier: Modifier = Modifier) {
  Canvas(modifier = modifier.size(size)) {
    val d = this.size.minDimension
    val c = Offset(d / 2f, d / 2f)
    val ringInset = d * 0.034f
    val r = d / 2f - ringInset
    fun ring(color: Color, width: Float, dashed: Boolean) {
      drawCircle(
        color, r, c,
        style = Stroke(
          width = width,
          pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(d * 0.09f, d * 0.075f)) else null
        )
      )
    }
    fun glyphScope(fraction: Float, block: DrawScope.() -> Unit) {
      val g = d * fraction
      inset((d - g) / 2f) { block() }
    }
    when (face) {
      TodayModel.SealFace.PRAYED -> {
        drawCircle(pal("accent"), d / 2f, c)
        glyphScope(0.46f) { drawCheck(pal("sealFg")) }
      }
      TodayModel.SealFace.LATE -> {
        drawCircle(pal("late"), d / 2f, c)
        glyphScope(0.5f) { drawClock(pal("sealFg")) }
      }
      TodayModel.SealFace.MISSED -> {
        ring(pal("missed"), d * 0.045f, dashed = false)
        glyphScope(0.5f) { drawClose(pal("missed")) }
      }
      TodayModel.SealFace.EXEMPT -> {
        drawCircle(pal("cardElevated"), d / 2f, c)
        ring(pal("borderMid"), d * 0.045f, dashed = false)
        glyphScope(0.9f) { drawCrescent(pal("muted")) }
      }
      TodayModel.SealFace.CURRENT_UNLOGGED -> {
        ring(pal("accent"), d * 0.068f, dashed = true)
        // The ghosted check: the only invitation, ornament to a non-tracker.
        glyphScope(0.46f) { drawCheck(pal("accent"), alpha = 0.7f) }
      }
      TodayModel.SealFace.FUTURE -> {
        ring(pal("borderMid"), d * 0.045f, dashed = false)
        drawCircle(pal("soft"), d * 0.085f, c)
      }
      TodayModel.SealFace.PAST_UNLOGGED -> {
        ring(pal("unlogged"), d * 0.068f, dashed = true)
        drawCircle(pal("unlogged"), d * 0.1f, c)
      }
    }
  }
}

/** The ornament rule: hairline · ◆ · hairline, framing the hero. */
@Composable
internal fun Ornament(width: Dp, modifier: Modifier = Modifier) {
  Row(
    modifier = modifier.width(width),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(5.dp)
  ) {
    val hairline = pal("hairline")
    val diamond = pal("diamond")
    HairlineRule(hairline, Modifier.weight(1f))
    Canvas(modifier = Modifier.size(6.dp)) {
      val half = size.minDimension / 2f
      val path = Path().apply {
        moveTo(half, 0f)
        lineTo(size.minDimension, half)
        lineTo(half, size.minDimension)
        lineTo(0f, half)
        close()
      }
      drawPath(path, diamond)
    }
    HairlineRule(hairline, Modifier.weight(1f))
  }
}

@Composable
internal fun HairlineRule(color: Color, modifier: Modifier = Modifier) {
  Canvas(modifier = modifier.height(1.dp)) {
    drawLine(color, Offset(0f, size.height / 2f), Offset(size.width, size.height / 2f), strokeWidth = 1.dp.toPx())
  }
}

/** The mosque eyebrow / bundled-state mark as a composable. */
@Composable
internal fun MosqueMark(size: Dp, color: Color, alpha: Float = 1f, modifier: Modifier = Modifier) {
  Box(modifier = modifier) {
    Canvas(modifier = Modifier.size(size)) { drawMosque(color, alpha) }
  }
}
