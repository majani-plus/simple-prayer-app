package app.simpleprayer.wear

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Typeface
import androidx.wear.protolayout.ResourceBuilders
import java.security.MessageDigest
import kotlin.math.ceil

/**
 * The tile's manuscript, rendered by hand. ProtoLayout text knows only the system font and its
 * images cannot be tinted, so the hero's Lora/Amiri lines, the ornament rules and every seal are
 * rasterized here — tinted from [WidgetPalette] (never a literal) and shipped as inline ARGB
 * images. Ids are content-keyed, so the layout pass and the resources pass — separate calls —
 * agree by construction, and repeated content (five prayer names across a 36-hour timeline)
 * costs one image, not one per entry. Only the ticking countdown stays native ProtoLayout text:
 * the system-rendered countdown is the widgets' own sanctioned exception.
 */
internal class ImageBank(private val context: Context) {
  internal data class Img(val id: String, val widthDp: Float, val heightDp: Float)

  /**
   * Which script a face can actually draw. Lora contains no Arabic glyph and no Arabic-Indic digit
   * at all — measured from the shipped TTF, not assumed — so this is not a stylistic distinction.
   * Enforced in [resolveFont].
   */
  internal enum class Script { LATIN, ARABIC }

  internal enum class FontKind(val resId: Int, val script: Script) {
    LORA(R.font.lora_regular, Script.LATIN),
    LORA_SEMIBOLD(R.font.lora_semibold, Script.LATIN),
    LORA_ITALIC(R.font.lora_italic, Script.LATIN),

    /** Arabic **calligraphy** (D135): the hero prayer name, the Arabic companion name. */
    AMIRI(R.font.amiri_regular, Script.ARABIC),
    AMIRI_BOLD(R.font.amiri_bold, Script.ARABIC),

    /** Arabic **UI** text (D135) — the tile's twin of `Theme.kt`'s [NotoNaskh]. */
    NOTO_NASKH(R.font.noto_naskh_arabic_400regular, Script.ARABIC),
    NOTO_NASKH_SEMIBOLD(R.font.noto_naskh_arabic_600semibold, Script.ARABIC),
    NOTO_NASKH_BOLD(R.font.noto_naskh_arabic_700bold, Script.ARABIC)
  }

  private val density = context.resources.displayMetrics.density

  /**
   * The user's font-size setting, which `density` does not carry. Every word on this tile is a
   * hand-rasterized bitmap, so nothing here scaled with the setting the way ProtoLayout's own
   * `sp` text does: the tile was frozen at Normal however large the wearer had set their type.
   * That is a straight WO-V1 failure ("must conform to font size set by user in system settings")
   * and the most font-shaped defect in the module.
   */
  private val fontScale = context.resources.configuration.fontScale
  private val bitmaps = LinkedHashMap<String, Bitmap>()
  private val debuggable =
    context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0

  private fun id(vararg parts: Any?): String {
    val digest = MessageDigest.getInstance("MD5")
      .digest(parts.joinToString("|").toByteArray())
    return digest.joinToString("") { "%02x".format(it) }.take(16)
  }

  /** Geometry — seals, rules, wrap boxes. Deliberately NOT font-scaled. */
  private fun px(dp: Float): Float = dp * density

  /** Type. The one difference from [px] is the whole of WO-V1 on this surface. */
  private fun textPx(sp: Float): Float = sp * density * fontScale

  private fun typeface(font: FontKind): Typeface =
    context.resources.getFont(font.resId)

  /**
   * The tile's font selector — every drawn line goes through it, so the two rules that a call site
   * can silently forget live here instead of at twenty of them.
   *
   * **1. Script.** A Latin [FontKind] handed a string with Arabic in it is a bug, not a style: Lora
   * has no Arabic glyph and no Arabic-Indic digit, so the line leaves the brand for whatever the
   * OEM's fallback chain offers. This is the single assertion the audit asked for — it is what
   * would have caught the fallback headline pinned to Lora under Arabic, and the bundled
   * empty/stale sentences drawn in Lora, both in this very file. Wear has no Kotlin test harness
   * (there is no `src/test`, and Gradle never runs in CI here), so it is a runtime assertion
   * rather than a unit test: loud in a debuggable build, self-healing in a shipped one, because a
   * throwing [ImageBank] would take the whole tile down on a wrist.
   *
   * **2. The sub-13sp step-up.** D54, as amended by D135: below 13sp Arabic UI text set lighter
   * than SemiBold steps up one rung — into Noto Naskh's own SemiBold, never Amiri Bold, so a
   * caption never changes typeface under its row. Calligraphy ([FontKind.AMIRI], AMIRI_BOLD) is
   * exempt; it chose its sizes for the face it is drawn in.
   */
  private fun resolveFont(text: String, sizeSp: Float, font: FontKind): FontKind {
    var resolved = font
    if (font.script == Script.LATIN && text.any { it in ARABIC_BLOCK }) {
      val message = "${font.name} cannot draw Arabic — asked for: \"$text\""
      if (debuggable) error(message)
      android.util.Log.e("ImageBank", message)
      resolved = ARABIC_SUBSTITUTE.getValue(font)
    }
    if (resolved == FontKind.NOTO_NASKH && sizeSp < ARABIC_SMALL_SP) {
      resolved = FontKind.NOTO_NASKH_SEMIBOLD
    }
    return resolved
  }

  fun text(text: String, sizeSp: Float, font: FontKind, colorRole: String, alpha: Float = 1f): Img {
    val resolved = resolveFont(text, sizeSp, font)
    // Keyed on the RESOLVED face: the layout pass and the resources pass are separate calls, and
    // they must agree on the bitmap they are naming.
    // `fontScale` is part of the key: the setting changes, the bitmap must not be served from
    // the cache at the old size.
    val key = "t:" + id(text, sizeSp, resolved.name, colorRole, alpha, density, fontScale)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      this.typeface = typeface(resolved)
      textSize = textPx(sizeSp)
      color = WidgetPalette.color(colorRole, night = true)
      this.alpha = (alpha * 255).toInt()
    }
    val fm = paint.fontMetricsInt
    val width = ceil(paint.measureText(text).toDouble()).toInt().coerceAtLeast(1)
    val height = (fm.descent - fm.ascent).coerceAtLeast(1)
    if (key !in bitmaps) {
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      Canvas(bitmap).drawText(text, 0f, -fm.ascent.toFloat(), paint)
      bitmaps[key] = bitmap
    }
    return Img(key, width / density, height / density)
  }

  /** Center-aligned wrapped text, for the bundled state's sentences. */
  fun paragraph(text: String, sizeSp: Float, font: FontKind, colorRole: String, maxWidthDp: Float): Img {
    val resolved = resolveFont(text, sizeSp, font)
    val key = "p:" + id(text, sizeSp, resolved.name, colorRole, maxWidthDp, density, fontScale)
    val paint = android.text.TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      this.typeface = typeface(resolved)
      textSize = textPx(sizeSp)
      color = WidgetPalette.color(colorRole, night = true)
    }
    val maxWidth = px(maxWidthDp).toInt().coerceAtLeast(1)
    val layout = android.text.StaticLayout.Builder
      .obtain(text, 0, text.length, paint, maxWidth)
      .setAlignment(android.text.Layout.Alignment.ALIGN_CENTER)
      .build()
    if (key !in bitmaps) {
      val bitmap = Bitmap.createBitmap(maxWidth, layout.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
      layout.draw(Canvas(bitmap))
      bitmaps[key] = bitmap
    }
    // Width reports the full wrap box so the centered lines keep their centering.
    return Img(key, maxWidth / density, bitmaps[key]!!.height / density)
  }

  fun seal(face: TodayModel.SealFace, sizeDp: Float): Img {
    val key = "s:" + id(face.name, sizeDp, density)
    if (key !in bitmaps) bitmaps[key] = sealBitmap(face, px(sizeDp).toInt())
    return Img(key, sizeDp, sizeDp)
  }

  fun mosque(sizeDp: Float, colorRole: String, alpha: Float): Img {
    val key = "m:" + id(sizeDp, colorRole, alpha, density)
    if (key !in bitmaps) {
      val d = px(sizeDp).toInt().coerceAtLeast(1)
      val bitmap = Bitmap.createBitmap(d, d, Bitmap.Config.ARGB_8888)
      drawMosque(Canvas(bitmap), d.toFloat(), WidgetPalette.color(colorRole, night = true), alpha)
      bitmaps[key] = bitmap
    }
    return Img(key, sizeDp, sizeDp)
  }

  /** The hairline · ◆ · hairline rule, one strip. */
  fun ornament(widthDp: Float): Img {
    val key = "o:" + id(widthDp, density)
    val heightDp = 7f
    if (key !in bitmaps) {
      val w = px(widthDp).toInt()
      val h = px(heightDp).toInt()
      val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      val mid = h / 2f
      val diamond = px(6f)
      val gap = px(5f)
      val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = WidgetPalette.color("hairline", night = true)
        strokeWidth = density
      }
      canvas.drawLine(0f, mid, w / 2f - diamond / 2f - gap, mid, line)
      canvas.drawLine(w / 2f + diamond / 2f + gap, mid, w.toFloat(), mid, line)
      val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = WidgetPalette.color("diamond", night = true)
      }
      val path = Path().apply {
        moveTo(w / 2f, mid - diamond / 2f)
        lineTo(w / 2f + diamond / 2f, mid)
        lineTo(w / 2f, mid + diamond / 2f)
        lineTo(w / 2f - diamond / 2f, mid)
        close()
      }
      canvas.drawPath(path, fill)
      bitmaps[key] = bitmap
    }
    return Img(key, widthDp, heightDp)
  }

  fun toResources(version: String): ResourceBuilders.Resources {
    val builder = ResourceBuilders.Resources.Builder().setVersion(version)
    for ((key, bitmap) in bitmaps) {
      // PNG, not raw ARGB: these mostly-transparent strips at 4 bytes/px once summed to a 769KB
      // payload — past the binder transaction ceiling, so the tile rendered BLACK on device.
      // Format UNDEFINED tells the renderer to decode the bytes as a compressed image.
      val stream = java.io.ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
      builder.addIdToImageMapping(
        key,
        ResourceBuilders.ImageResource.Builder()
          .setInlineResource(
            ResourceBuilders.InlineImageResource.Builder()
              .setData(stream.toByteArray())
              .setWidthPx(bitmap.width)
              .setHeightPx(bitmap.height)
              .setFormat(ResourceBuilders.IMAGE_FORMAT_UNDEFINED)
              .build()
          )
          .build()
      )
    }
    return builder.build()
  }

  /** All ids in creation order — hashed together they name the resources version. */
  fun contentVersion(): String = id(bitmaps.keys.joinToString(","))

  // -------------------------------------------------------------------------
  // android.graphics twins of Theme.kt's drawings (Compose DrawScope cannot paint a Bitmap here)
  // -------------------------------------------------------------------------

  private fun color(role: String): Int = WidgetPalette.color(role, night = true)

  private fun withAlpha(argb: Int, alpha: Float): Int =
    (argb and 0x00ffffff) or ((alpha * 255).toInt().coerceIn(0, 255) shl 24)

  private fun sealBitmap(face: TodayModel.SealFace, sizePx: Int): Bitmap {
    val d = sizePx.coerceAtLeast(1).toFloat()
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val c = d / 2f
    val r = d / 2f - d * 0.034f

    fun fillPaint(argb: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = argb }
    fun ringPaint(argb: Int, width: Float, dashed: Boolean) =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = argb
        style = Paint.Style.STROKE
        strokeWidth = width
        if (dashed) pathEffect = DashPathEffect(floatArrayOf(d * 0.09f, d * 0.075f), 0f)
      }
    fun glyphCanvas(fraction: Float, block: (Canvas, Float) -> Unit) {
      val g = d * fraction
      canvas.save()
      canvas.translate((d - g) / 2f, (d - g) / 2f)
      block(canvas, g)
      canvas.restore()
    }

    when (face) {
      TodayModel.SealFace.PRAYED -> {
        canvas.drawCircle(c, c, d / 2f, fillPaint(color("accent")))
        glyphCanvas(0.46f) { cv, g -> drawCheckOn(cv, g, color("sealFg")) }
      }
      TodayModel.SealFace.LATE -> {
        canvas.drawCircle(c, c, d / 2f, fillPaint(color("late")))
        glyphCanvas(0.5f) { cv, g -> drawClockOn(cv, g, color("sealFg")) }
      }
      TodayModel.SealFace.MISSED -> {
        canvas.drawCircle(c, c, r, ringPaint(color("missed"), d * 0.045f, dashed = false))
        glyphCanvas(0.5f) { cv, g -> drawCloseOn(cv, g, color("missed")) }
      }
      TodayModel.SealFace.EXEMPT -> {
        canvas.drawCircle(c, c, d / 2f, fillPaint(color("cardElevated")))
        canvas.drawCircle(c, c, r, ringPaint(color("borderMid"), d * 0.045f, dashed = false))
        glyphCanvas(0.9f) { cv, g -> drawCrescentOn(cv, g, color("muted")) }
      }
      TodayModel.SealFace.CURRENT_UNLOGGED -> {
        canvas.drawCircle(c, c, r, ringPaint(color("accent"), d * 0.068f, dashed = true))
        glyphCanvas(0.46f) { cv, g -> drawCheckOn(cv, g, withAlpha(color("accent"), 0.7f)) }
      }
      TodayModel.SealFace.FUTURE -> {
        canvas.drawCircle(c, c, r, ringPaint(color("borderMid"), d * 0.045f, dashed = false))
        canvas.drawCircle(c, c, d * 0.085f, fillPaint(color("soft")))
      }
      TodayModel.SealFace.PAST_UNLOGGED -> {
        canvas.drawCircle(c, c, r, ringPaint(color("unlogged"), d * 0.068f, dashed = true))
        canvas.drawCircle(c, c, d * 0.1f, fillPaint(color("unlogged")))
      }
    }
    return bitmap
  }

  private fun drawMosque(canvas: Canvas, size: Float, argb: Int, alpha: Float) {
    val s = size / 64f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = withAlpha(argb, alpha)
      style = Paint.Style.STROKE
      strokeWidth = 6f * s
      strokeCap = Paint.Cap.ROUND
    }
    val dome = Path().apply {
      moveTo(18f * s, 42f * s)
      arcTo(RectF(18f * s, 28f * s, 46f * s, 56f * s), 180f, 180f)
    }
    canvas.drawPath(dome, paint)
    canvas.drawLine(11f * s, 42f * s, 11f * s, 30f * s, paint)
    canvas.drawLine(53f * s, 42f * s, 53f * s, 30f * s, paint)
    canvas.drawLine(8f * s, 47f * s, 56f * s, 47f * s, paint)
  }

  private fun drawCheckOn(canvas: Canvas, size: Float, argb: Int) {
    val s = size / 24f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = argb
      style = Paint.Style.STROKE
      strokeWidth = 2.8f * s
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    val path = Path().apply {
      moveTo(5.5f * s, 12.5f * s)
      lineTo(9.7f * s, 16.7f * s)
      lineTo(18.5f * s, 8f * s)
    }
    canvas.drawPath(path, paint)
  }

  private fun drawClockOn(canvas: Canvas, size: Float, argb: Int) {
    val r = size * 0.36f
    val c = size / 2f
    val stroke = size * 0.1f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = argb
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeCap = Paint.Cap.ROUND
    }
    canvas.drawCircle(c, c, r, paint)
    canvas.drawLine(c, c, c, c - r * 0.55f, paint)
    canvas.drawLine(c, c, c + r * 0.45f, c + r * 0.2f, paint)
  }

  private fun drawCloseOn(canvas: Canvas, size: Float, argb: Int) {
    val r = size * 0.26f
    val c = size / 2f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = argb
      style = Paint.Style.STROKE
      strokeWidth = size * 0.11f
      strokeCap = Paint.Cap.ROUND
    }
    canvas.drawLine(c - r, c - r, c + r, c + r, paint)
    canvas.drawLine(c + r, c - r, c - r, c + r, paint)
  }

  private fun drawCrescentOn(canvas: Canvas, size: Float, argb: Int) {
    val r = size * 0.38f
    val c = size / 2f
    val layer = canvas.saveLayer(0f, 0f, size, size, null)
    canvas.drawCircle(c, c, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = argb })
    val clear = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    }
    canvas.drawCircle(c + r * 0.5f, c - r * 0.35f, r * 0.82f, clear)
    canvas.restoreToCount(layer)
  }

  private companion object {
    /**
     * The Arabic block. Arabic-Indic digits (U+0660–U+0669) sit inside it, which is the half that
     * matters most here: a countdown or a prayer time can be nothing but digits and still be
     * undrawable in Lora.
     */
    val ARABIC_BLOCK = '\u0600'..'\u06FF'

    /**
     * What a Latin face becomes when a shipped build catches it holding Arabic. The italic has no
     * Arabic answer and must not get a synthesized slant — Arabic has no italic — so it lands on
     * Regular, where the sub-13sp rule may then step it up.
     */
    val ARABIC_SUBSTITUTE = mapOf(
      FontKind.LORA to FontKind.NOTO_NASKH,
      FontKind.LORA_ITALIC to FontKind.NOTO_NASKH,
      FontKind.LORA_SEMIBOLD to FontKind.NOTO_NASKH_SEMIBOLD
    )
  }
}
