package app.simpleprayer.wear

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.TypeBuilders
import androidx.wear.protolayout.expression.DynamicBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.time.Instant

/**
 * The "Now" tile — one swipe from the face, the WearTile.dc.html canvas: the D109 widget grammar
 * on a round screen. The countdown is ProtoLayout time-difference text, ticked by the renderer
 * with ZERO wakeups; segment boundaries switch by timeline validity, also without waking us; the
 * current prayer's seal rides the caption line as the button (tap marks, tap again undoes — the
 * D92 queue, the D108 guard). The foot's five seals read as a quiet ornament band to anyone who
 * never tracks.
 *
 * The layout pass and the resources pass build the same [ImageBank] from the same stored
 * envelope, so the content-keyed image ids always agree between the two.
 */
class PrayerTileService : TileService() {

  override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
    handleClick(requestParams.currentState.lastClickableId)
    val bank = ImageBank(this)
    val timeline = buildTimeline(bank, System.currentTimeMillis())
    val tile = TileBuilders.Tile.Builder()
      .setResourcesVersion(bank.contentVersion())
      .setFreshnessIntervalMillis(5 * 60_000L)
      .setTileTimeline(timeline)
      .build()
    return immediate(tile)
  }

  override fun onTileResourcesRequest(
    requestParams: RequestBuilders.ResourcesRequest
  ): ListenableFuture<ResourceBuilders.Resources> {
    val bank = ImageBank(this)
    // Populate the bank exactly as the layout pass did; content keys make the ids line up.
    buildTimeline(bank, System.currentTimeMillis())
    return immediate(bank.toResources(requestParams.version))
  }

  /** A seal press arrives as the clickable's id on the NEXT tile request — act, then render. */
  private fun handleClick(clickableId: String) {
    val parts = clickableId.split(":")
    if (parts.size != 3 || parts[0] != "seal") return
    val (_, dayId, prayerId) = parts
    val now = System.currentTimeMillis()
    val envelope = EnvelopeStore.load(this) ?: return
    val day = envelope.snapshot.dayFor(dayId) ?: return
    val prayer = day.prayers.firstOrNull { it.prayer == prayerId } ?: return
    val effective = WearPendingMarks.effectiveStatuses(
      this, day.day, day.prayers.associate { it.prayer to it.status }
    )
    // The guard runs against a FRESH clock: a stale drawing must not buy a future mark (D108).
    val tap = TodayModel.tapFor(day, prayer, effective[prayer.prayer] ?: prayer.status, now) ?: return
    WearPendingMarks.appendTap(this, day.day, prayer.prayer, clears = tap == TodayModel.Tap.UNDO)
  }

  // ---------------------------------------------------------------------------
  // Timeline
  // ---------------------------------------------------------------------------

  /** ~36h of entries, one per segment; the bundled state is the default (and the post-expiry). */
  private fun buildTimeline(bank: ImageBank, now: Long): TimelineBuilders.Timeline {
    val timeline = TimelineBuilders.Timeline.Builder()
    val envelope = EnvelopeStore.load(this)

    // The fallback entry (no validity): honest words whenever nothing else is valid.
    timeline.addTimelineEntry(
      TimelineBuilders.TimelineEntry.Builder()
        .setLayout(layoutOf(bundledLayout(bank, stale = EnvelopeStore.hasEverSynced(this))))
        .build()
    )
    if (envelope == null) return timeline.build()

    val snapshot = envelope.snapshot
    val horizon = now + 36L * 60 * 60 * 1000
    // A slightly padded window so the resources pass still covers a boundary the clock crossed
    // between the two calls.
    val from = now - 6L * 60 * 60 * 1000
    for (segment in snapshot.segments) {
      if (segment.to <= from || segment.from >= horizon) continue
      if (segment.from >= snapshot.expiresAt) break
      val face = TodayModel.resolveSegment(this, envelope, segment, maxOf(now, segment.from)) ?: continue
      timeline.addTimelineEntry(
        TimelineBuilders.TimelineEntry.Builder()
          .setValidity(
            TimelineBuilders.TimeInterval.Builder()
              .setStartMillis(segment.from)
              .setEndMillis(minOf(segment.to, snapshot.expiresAt))
              .build()
          )
          .setLayout(layoutOf(heroLayout(bank, face)))
          .build()
      )
    }
    return timeline.build()
  }

  private fun layoutOf(root: LayoutElementBuilders.LayoutElement): LayoutElementBuilders.Layout =
    LayoutElementBuilders.Layout.Builder().setRoot(root).build()

  // ---------------------------------------------------------------------------
  // Layouts
  // ---------------------------------------------------------------------------

  private fun image(img: ImageBank.Img, modifiers: ModifiersBuilders.Modifiers? = null): LayoutElementBuilders.Image {
    val builder = LayoutElementBuilders.Image.Builder()
      .setResourceId(img.id)
      .setWidth(DimensionBuilders.dp(img.widthDp))
      .setHeight(DimensionBuilders.dp(img.heightDp))
    if (modifiers != null) builder.setModifiers(modifiers)
    return builder.build()
  }

  private fun spacer(heightDp: Float): LayoutElementBuilders.Spacer =
    LayoutElementBuilders.Spacer.Builder().setHeight(DimensionBuilders.dp(heightDp)).build()

  private fun hSpacer(widthDp: Float): LayoutElementBuilders.Spacer =
    LayoutElementBuilders.Spacer.Builder().setWidth(DimensionBuilders.dp(widthDp)).build()

  private fun heroLayout(bank: ImageBank, face: TodayModel.Face.Today): LayoutElementBuilders.LayoutElement {
    val snapshot = face.snapshot
    val arabicPrimary = snapshot.language == "ar"
    val column = LayoutElementBuilders.Column.Builder()
      .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)

    column.addContent(image(bank.mosque(14f, "faint", 0.8f)))
    if (arabicPrimary) {
      column.addContent(spacer(2f))
      // Calligraphy, so it stays in Amiri (D135) — the phone's `heroArabic`, at its own size.
      column.addContent(image(bank.text(face.subject.name, 27f, ImageBank.FontKind.AMIRI_BOLD, "ink")))
    } else {
      face.subject.arabicName?.let {
        column.addContent(spacer(1f))
        // The Arabic companion over a Latin name — the phone's `rowArabic`, calligraphy, Amiri.
        column.addContent(image(bank.text(it, 14f, ImageBank.FontKind.AMIRI, "soft")))
      }
      column.addContent(image(bank.text(face.subject.name, 21f, ImageBank.FontKind.LORA_SEMIBOLD, "ink")))
    }
    column.addContent(spacer(6f))
    column.addContent(image(bank.ornament(105f)))
    column.addContent(spacer(3f))

    val target = face.countdownTarget
    if (target != null) {
      column.addContent(countdownText(target))
    } else {
      // The two states where the countdown cannot tick — no resolvable window end, or a logged
      // prayer with nothing after it — put a status word on the tile's LARGEST line, and in
      // Arabic that word is Arabic ("صُلِّيت", "فاتت"). It was pinned to Lora, which has no Arabic
      // glyph at all, while the lines directly above and below both branched correctly.
      //
      // The size is stated per script rather than shared: the two faces do not draw the same body
      // at one nominal size, and a shared literal here is a decision by omission. A one-word line
      // with no wrap risk, so Arabic takes the app's full 1.15 optical step (15 × 1.15).
      column.addContent(
        image(
          if (arabicPrimary)
            bank.text(face.staticBig ?: "", 17f, ImageBank.FontKind.NOTO_NASKH_SEMIBOLD, "inkStrong")
          else
            bank.text(face.staticBig ?: "", 15f, ImageBank.FontKind.LORA_SEMIBOLD, "inkStrong")
        )
      )
    }

    // The caption line, the seal riding beside it (44dp visual, padded to the 48dp floor).
    // Deliberately 12 in both scripts, unlike the line above: this is the widest composed line on
    // the tile ("prayed · Maghrib · 6:42 pm") and it shares its row with 8dp of gap and a 44dp
    // seal inside the round crop, so it can spend the optical step on body but not on width —
    // which is what the face change alone gives it (Noto Naskh's body is 433/1000 to Amiri's 337,
    // and its Arabic-Indic digits are NARROWER, 449 against 585). Under 13sp, so [ImageBank]
    // steps the weight up a rung on its own (D54/D135).
    val captionImg =
      if (arabicPrimary) bank.text(face.caption, 12f, ImageBank.FontKind.NOTO_NASKH, "muted")
      else bank.text(face.caption, 12f, ImageBank.FontKind.LORA_ITALIC, "muted")
    val sealImg = bank.seal(face.sealFace, 44f)
    // The instant this entry describes: a future segment draws as it will look when it shows.
    // The press itself is still guarded against the true clock in [handleClick] (D108).
    val entryAt = maxOf(System.currentTimeMillis(), face.segment.from)
    val sealTap = face.sealPrayer?.let { prayer ->
      TodayModel.tapFor(
        face.day, prayer,
        face.effective[prayer.prayer] ?: prayer.status,
        entryAt
      )
    }
    val sealModifiers = ModifiersBuilders.Modifiers.Builder()
      .setPadding(ModifiersBuilders.Padding.Builder().setAll(DimensionBuilders.dp(2f)).build())
      .apply {
        if (sealTap != null && face.sealPrayer != null) {
          setClickable(
            ModifiersBuilders.Clickable.Builder()
              .setId("seal:${face.day.day}:${face.sealPrayer.prayer}")
              .setOnClick(ActionBuilders.LoadAction.Builder().build())
              .build()
          )
        }
      }
      .build()
    val captionRow = LayoutElementBuilders.Row.Builder()
      .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
    val pieces = listOf<LayoutElementBuilders.LayoutElement>(
      image(captionImg),
      hSpacer(8f),
      image(sealImg, sealModifiers)
    )
    // Mirrored by hand: ProtoLayout rows know no layout direction.
    for (piece in if (snapshot.rtl) pieces.reversed() else pieces) captionRow.addContent(piece)
    column.addContent(spacer(2f))
    column.addContent(captionRow.build())

    column.addContent(spacer(3f))
    column.addContent(image(bank.ornament(105f)))
    column.addContent(spacer(6f))

    // The foot band: the day's five seals — ornament to non-trackers, Fajr rightmost in RTL.
    val foot = LayoutElementBuilders.Row.Builder()
      .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
    val prayers = if (snapshot.rtl) face.day.prayers.reversed() else face.day.prayers
    for ((index, prayer) in prayers.withIndex()) {
      if (index > 0) foot.addContent(hSpacer(6.5f))
      val status = face.effective[prayer.prayer] ?: prayer.status
      val miniFace =
        if (face.day.isExempt) TodayModel.SealFace.EXEMPT
        else TodayModel.sealFaceOf(status, TodayModel.registerOf(prayer, face.segment, entryAt))
      foot.addContent(image(bank.seal(miniFace, 11f)))
    }
    column.addContent(foot.build())

    return centered(column.build())
  }

  /**
   * The live countdown: renderer-ticked time-difference text — the one native formatting the
   * design sanctions (system font and numerals, exactly like the widgets' Chronometer).
   */
  private fun countdownText(targetMs: Long): LayoutElementBuilders.LayoutElement {
    val remaining = DynamicBuilders.DynamicInstant.platformTimeWithSecondsPrecision()
      .durationUntil(DynamicBuilders.DynamicInstant.withSecondsPrecision(Instant.ofEpochMilli(targetMs)))
    val one = DynamicBuilders.DynamicInt32.IntFormatter.Builder().setGroupingUsed(false).build()
    val two = DynamicBuilders.DynamicInt32.IntFormatter.Builder()
      .setMinIntegerDigits(2)
      .setGroupingUsed(false)
      .build()
    val colon = DynamicBuilders.DynamicString.constant(":")
    val withHours = remaining.hoursPart.format(one)
      .concat(colon).concat(remaining.minutesPart.format(two))
      .concat(colon).concat(remaining.secondsPart.format(two))
    val withoutHours = remaining.minutesPart.format(one)
      .concat(colon).concat(remaining.secondsPart.format(two))
    val text = DynamicBuilders.DynamicString.onCondition(remaining.hoursPart.gt(0))
      .use(withHours)
      .elseUse(withoutHours)
    return LayoutElementBuilders.Text.Builder()
      .setText(
        TypeBuilders.StringProp.Builder("0:00")
          .setDynamicValue(text)
          .build()
      )
      .setLayoutConstraintsForDynamicText(
        TypeBuilders.StringLayoutConstraint.Builder("8:88:88")
          .setAlignment(LayoutElementBuilders.TEXT_ALIGN_CENTER)
          .build()
      )
      .setFontStyle(
        LayoutElementBuilders.FontStyle.Builder()
          .setSize(DimensionBuilders.sp(31f))
          .setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
          .setColor(argb(WidgetPalette.color("inkStrong", night = true)))
          .build()
      )
      .build()
  }

  private fun bundledLayout(bank: ImageBank, stale: Boolean): LayoutElementBuilders.LayoutElement {
    // These two sentences are the one place on the tile where the words do not come from the
    // envelope (D103), so the face cannot come from the envelope either — there may be no envelope
    // at all. `getString` resolved them through the resource qualifiers, and the font follows the
    // SAME locale that chose values-ar/, read from the configuration rather than from a snapshot.
    val arabicSystem = resources.configuration.locales[0].language == "ar"
    val titleFont =
      if (arabicSystem) ImageBank.FontKind.NOTO_NASKH_SEMIBOLD else ImageBank.FontKind.LORA_SEMIBOLD
    // Under 13sp: [ImageBank] steps the Arabic body up a rung on its own (D54/D135).
    val bodyFont =
      if (arabicSystem) ImageBank.FontKind.NOTO_NASKH else ImageBank.FontKind.LORA_ITALIC
    val column = LayoutElementBuilders.Column.Builder()
      .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
      .addContent(image(bank.mosque(22f, "header", 0.9f)))
      .addContent(spacer(9f))
      .addContent(image(bank.ornament(105f)))
      .addContent(spacer(8f))
      .addContent(
        image(
          bank.paragraph(
            getString(if (stale) R.string.wear_stale_title else R.string.wear_empty_title),
            15.5f, titleFont, "ink", 150f
          )
        )
      )
      .addContent(spacer(4f))
      .addContent(
        image(
          bank.paragraph(
            // The only sentence on the tile when there is nothing else to say, so it is essential
            // text: WO-V14's floor, not the 11.5 it was. The wrap box is unchanged and the
            // paragraph simply grows a line taller, which the centred column absorbs.
            getString(if (stale) R.string.wear_stale_body else R.string.wear_empty_body),
            WEAR_MIN_ESSENTIAL_SP, bodyFont, "muted", 150f
          )
        )
      )
    return centered(column.build())
  }

  private fun centered(content: LayoutElementBuilders.LayoutElement): LayoutElementBuilders.LayoutElement =
    LayoutElementBuilders.Box.Builder()
      .setWidth(DimensionBuilders.expand())
      .setHeight(DimensionBuilders.expand())
      .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
      .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
      .addContent(content)
      .build()

  private fun <T : Any> immediate(value: T): ListenableFuture<T> =
    CallbackToFutureAdapter.getFuture { completer ->
      completer.set(value)
      "immediate"
    }
}
