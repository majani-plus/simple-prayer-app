package app.simpleprayer.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import androidx.wear.compose.material.Text
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.sqrt

/**
 * The Today page — the WearApp.dc.html hero at 1:1 (mockup px ÷ 2 = dp/sp), with the day's rows
 * below the fold. The hero claims AT LEAST the first screenful and grows past it when it must —
 * a small round, or a wearer who has turned the system font up — and scroll (touch or rotary)
 * reaches whatever is below, rows included.
 * Sunrise is a hairline marker between Fajr and Dhuhr, never a row. The current row carries the
 * borderStrong outline. All words come from the envelope; the only native formatting is the
 * ticking countdown's numerals (the sanctioned exception, in the app language's own digits).
 */
@Composable
internal fun TodayScreen(
  face: TodayModel.Face,
  now: Long,
  // Hoisted so the Wear Scaffold's PositionIndicator can read it — WO-V8 asks for a scroll bar
  // while the user is scrolling, and the indicator lives outside this page, over the pager.
  scroll: ScrollState,
  onTap: (day: String, prayer: String, tap: TodayModel.Tap) -> Unit
) {
  when (face) {
    is TodayModel.Face.Empty -> EmptyFace(face.stale, scroll)
    is TodayModel.Face.Today -> TodayFace(face, now, scroll, onTap)
  }
}

/** The mosque mark's own width in the header row, and the gap after it. Dp: no font follows it. */
private const val HEADER_MARK_DP = 11f
private const val HEADER_GAP_DP = 5f

/**
 * How far inside the glass circle the header line is solved. Without it the line box's top corners
 * land exactly ON the arc, which is inside by arithmetic and a coin-toss by the time antialiasing
 * and a real bezel have had their say. 2dp costs the row a couple of dp of drop and buys certainty.
 */
private const val HEADER_ARC_INSET_DP = 2f

/** How wide a circle of radius [radius] is at height [y] below its top. */
private fun chordAt(radius: Float, y: Float): Float =
  2f * sqrt((radius * radius - (radius - y) * (radius - y)).coerceAtLeast(0f))

/** The inverse: how far below the top a circle of radius [radius] is finally [width] wide. */
private fun heightForChord(radius: Float, width: Float): Float {
  val half = (width / 2f).coerceAtMost(radius)
  return radius - sqrt((radius * radius - half * half).coerceAtLeast(0f))
}

// Amiri's ascent/descent make every line box ~1.7em even with font padding off (the Compose
// default); an explicit lineHeight with Trim.Both is what actually clamps the box, and is what
// lets the Arabic hero fit inside the circle without shrinking the type further.
private val TrimmedLine = TextStyle(
  platformStyle = PlatformTextStyle(includeFontPadding = false),
  lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both)
)

@Composable
private fun TodayFace(
  face: TodayModel.Face.Today,
  now: Long,
  scroll: ScrollState,
  onTap: (day: String, prayer: String, tap: TodayModel.Tap) -> Unit
) {
  val configuration = LocalConfiguration.current
  val screenHeight = configuration.screenHeightDp.dp
  // The hero was tuned on a 227dp display; smaller rounds (192dp small-round) get every hero
  // dimension scaled by the same factor so the page-fit holds on any watch by construction.
  val k = (configuration.screenHeightDp / 227f).coerceAtMost(1f)
  val arabicPrimary = usesArabicScript(face.snapshot.language)
  val focusRequester = remember { FocusRequester() }
  LaunchedEffect(Unit) { focusRequester.requestFocus() }

  // --- The header line, solved against the round crop AND the user's font setting ---
  //
  // A round display is only [chordAt] wide at height y, and near the crown that is far less than
  // the display itself. The date used to be sized DOWN to that chord (9.5, which arrived on a
  // 192dp round as 8.04sp). The date is essential text in a prayer app, so the floor wins and the
  // chord gives way: the row drops to the height where the circle is finally wide enough to carry
  // the whole line, and is capped to the chord there so a longer date still ellipsises INSIDE the
  // circle rather than vanishing under the bezel (WO-V16). Never higher than the design's own guard.
  //
  // The line is MEASURED, not estimated, and that is the WO-V1 fix. The old constant (142dp) was
  // the longest Latin date at 12sp at font scale 1 — but when the user picks a larger system font
  // only the TEXT half of that line grows, because sp carries the font scale and the mosque mark's
  // dp does not. The row then sat too high for a line it no longer fitted, and the date lost a
  // glyph at each edge of the circle: exactly Play's screenshot. A TextMeasurer knows the true
  // width of the true string in the true font at whatever scale the wearer has chosen, in every
  // language, so nothing below is guessed and nothing has to be re-derived per script.
  val hijriSize = essentialSp(if (arabicPrimary) 11f * k else 9.5f * k)
  val hijriTypeface = uiFace(arabicPrimary, hijriSize, italic = true)
  val hijriStyle = TrimmedLine.copy(
    fontFamily = hijriTypeface.family,
    fontWeight = hijriTypeface.weight,
    fontStyle = hijriTypeface.style,
    fontSize = hijriSize.sp,
    // Tied to the resolved size (the old 13 × k was BELOW the floored size, which would trim the
    // glyphs vertically under TrimmedLine); 1.37 is the ratio it always had.
    lineHeight = (hijriSize * 1.37f).sp
  )
  val measurer = rememberTextMeasurer()
  val density = LocalDensity.current
  // Keyed on the density because that is where the font scale lives: change the system font size
  // and this re-measures, which is the whole point.
  val headerLayout = remember(face.day.hijriText, hijriStyle, density) {
    measurer.measure(text = face.day.hijriText, style = hijriStyle)
  }
  // The chord maths is all in dp, so the measurement comes back out of px here — and this is the
  // one conversion through which the font scale reaches the layout.
  val headerLineDp = with(density) {
    HEADER_MARK_DP * k + HEADER_GAP_DP + headerLayout.size.width.toDp().value
  }
  val round = configuration.isScreenRound
  // The circle the header is allowed to touch: the glass, pulled in by [HEADER_ARC_INSET_DP]. It
  // is concentric with the screen, so its own top sits [HEADER_ARC_INSET_DP] below the screen's
  // and every depth below converts by that offset.
  val safeRadius = configuration.screenWidthDp / 2f - HEADER_ARC_INSET_DP
  // Everything below is solved for the TOP of the line box rather than its centre, because the
  // circle is narrower at the top of a line than at its middle — and that difference is precisely
  // where the first and last glyphs were losing their corners even when the line "fitted". Solve
  // the top, and the rest of the box is inside by construction.
  val headerTop =
    if (!round) 12f * k
    else maxOf(12f * k, HEADER_ARC_INSET_DP + heightForChord(safeRadius, headerLineDp))
      // A line wider than the whole display can only sit at the equator, where the chord is the
      // diameter; the ellipsis takes it from there.
      .coerceAtMost(safeRadius)
  val headerGuard = headerTop.coerceAtLeast(0f)
  // Capped at the chord where the line box STARTS — its narrowest point, for the same reason.
  val headerChord =
    if (round) chordAt(safeRadius, headerGuard - HEADER_ARC_INSET_DP).dp
    else configuration.screenWidthDp.dp

  Column(
    modifier = Modifier
      .fillMaxSize()
      .verticalScroll(scroll)
      // The bezel/rotary scrolls to the rows — the whole difference from the Apple twin.
      .rotaryScrollable(RotaryScrollableDefaults.behavior(scroll), focusRequester),
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    // --- The hero: one full screen, and the seal is what that screen is FOR ---
    //
    // The hero SHEDS, in order, until it fits the glass in one screenful. It has to: the seal is
    // the reward tap, and a tap the wearer must go looking for is not the product — nothing may
    // sit between them and it. Play's own rejection frame was this hero with the seal half under
    // the page dots, and "you can scroll to it" is not an answer to that frame.
    //
    // The order is the order of what can be given up:
    //   1. FULL — everything. A 227dp round at the system default still lands here, so the
    //      shipped store capture stays the shipped store capture.
    //   2. NO COMPANION — the Arabic calligraphy line above a LATIN prayer name goes first. It
    //      is the one line on the hero that says again, in a second script, what the line below
    //      it already says. An Arabic-primary hero has no companion at all, so the tier does not
    //      exist there and is never offered.
    //   3. NO HEADER — then the hijri date leaves the crown. It is not lost: [HeroFoot] puts it
    //      back as the first line under the seal, above the Gregorian date that was always
    //      there, one small scroll away. It goes before the seal because a date is something you
    //      look up and the seal is something you reach for.
    //   4. Whatever tier 3 measures, placed anyway and scrolling as before. A wrist and a font
    //      setting can always ask for more than a circle holds, and then honesty is all there is.
    //
    // Measured, not budgeted. Every tier's hero carries `heightIn(min = screenHeight)`, so one
    // that fits measures EXACTLY one screenful and one that does not measures more: the test is a
    // single integer comparison against the real laid-out height, in the real font, at the real
    // scale, in the real language. Nothing here has to be kept in step with the design by hand.
    val companion = if (arabicPrimary) null else face.subject.arabicName
    val tiers = remember(companion) {
      if (companion == null) listOf(HeroTier.FULL, HeroTier.NO_HEADER)
      else listOf(HeroTier.FULL, HeroTier.NO_COMPANION, HeroTier.NO_HEADER)
    }
    // The countdown repaints every second, and re-running the search per tick would be three
    // subcompositions a second for an answer that cannot have changed: the numerals are the same
    // size on the same single line. So the choice is remembered against everything that CAN move
    // a line — the density, which is where the font scale lives, the screen, the script, and the
    // strings whose length or presence changes the layout — and the ticking text is deliberately
    // not among them. A plain holder rather than state, because it is written during measure and
    // must not itself ask for a recomposition.
    val tierChoice = remember(
      density, configuration.screenWidthDp, configuration.screenHeightDp, arabicPrimary,
      face.day.hijriText, face.day.dateText, face.subject.name, companion, face.caption,
      face.sealWord, face.staticBig, face.countdownTarget != null
    ) { arrayOfNulls<HeroTier>(1) }

    SubcomposeLayout(modifier = Modifier.fillMaxWidth()) { constraints ->
      val screenPx = screenHeight.roundToPx()
      // Width fixed, height free — the hero's own `heightIn` is what makes "fits" measurable.
      val tierConstraints =
        Constraints(minWidth = constraints.maxWidth, maxWidth = constraints.maxWidth)

      fun measureTier(tier: HeroTier): List<Placeable> =
        subcompose(tier) {
          HeroColumn(
            tier = tier,
            face = face,
            now = now,
            k = k,
            arabicPrimary = arabicPrimary,
            screenHeight = screenHeight,
            headerGuard = headerGuard,
            headerChord = headerChord,
            hijriStyle = hijriStyle,
            onTap = onTap
          )
          HeroFoot(tier = tier, face = face, arabicPrimary = arabicPrimary, hijriStyle = hijriStyle)
        }.map { it.measure(tierConstraints) }

      var chosen = tierChoice[0]
      var parts = chosen?.let { measureTier(it) }
      if (parts == null) {
        for ((index, tier) in tiers.withIndex()) {
          val measured = measureTier(tier)
          // The last tier is placed whether it fits or not — there is nothing left to shed.
          if (measured[0].height <= screenPx || index == tiers.lastIndex) {
            chosen = tier
            parts = measured
            break
          }
        }
      }
      tierChoice[0] = chosen
      val hero = parts!![0]
      val foot = parts[1]
      layout(constraints.maxWidth, hero.height + foot.height) {
        hero.place(0, 0)
        foot.place(0, hero.height)
      }
    }
    for ((index, prayer) in face.day.prayers.withIndex()) {
      PrayerRow(face, prayer, now, arabicPrimary, onTap)
      if (index == 0 && face.day.sunriseText != null) {
        SunriseMarker(face.day.sunriseText, arabicPrimary)
      }
    }
    Spacer(modifier = Modifier.height(34.dp))
  }
}

/**
 * The order in which the hero gives things up so the seal can stay on the first screen. The
 * reasoning for this order, and not another, is at the tier search in [TodayFace].
 */
private enum class HeroTier { FULL, NO_COMPANION, NO_HEADER }

/**
 * The hero at one [tier]. Every tier draws the same page; they differ only in what has been shed,
 * and nothing is ever shed by making type smaller — WO-V14's floors hold in all of them.
 */
@Composable
private fun HeroColumn(
  tier: HeroTier,
  face: TodayModel.Face.Today,
  now: Long,
  k: Float,
  arabicPrimary: Boolean,
  screenHeight: Dp,
  headerGuard: Float,
  headerChord: Dp,
  hijriStyle: TextStyle,
  onTap: (day: String, prayer: String, tap: TodayModel.Tap) -> Unit
) {
  // Top/Center/Bottom, not Arrangement.Center: a centered stack lets the header ride past the
  // round crop the moment content grows — the Apple twin's page-fit structure (guards at the
  // bezel, flexible space around the middle) is what keeps every line inside the circle.
  // heightIn, not height: a hard height cannot grow, so the system font setting (or WO-V14's
  // floors) pushed the content past the box and it was CLIPPED — the words WO-V1 and WO-V16 both
  // use. It is also what makes the tier search one comparison: a tier that fits measures exactly
  // this, a tier that does not measures more, and the weight(1f) spacers still centre whatever
  // fits.
  Column(
    // No horizontal padding on the hero itself. The 22dp guard that used to live here now sits
    // on the middle stack alone, because the header must NOT have it: that row is chord-capped
    // already, and a flat inset on top of the chord was what ellipsised the date long before
    // the circle did once the system font grew.
    modifier = Modifier.fillMaxWidth().heightIn(min = screenHeight),
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    if (tier == HeroTier.NO_HEADER) {
      // The crown keeps only the design's own top guard — the chord solve has nothing to solve
      // for any more, because the date has moved down to [HeroFoot].
      Spacer(modifier = Modifier.height((12 * k).dp))
    } else {
      Spacer(modifier = Modifier.height(headerGuard.dp))
      // The mark and the Hijri date share the top line — the Apple twin's header (owner asked
      // for the date visible without a scroll; parity keeps the twins twins).
      Row(
        modifier = Modifier.widthIn(max = headerChord),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(HEADER_GAP_DP.dp)
      ) {
        MosqueMark(size = (HEADER_MARK_DP * k).dp, color = pal("faint"), alpha = 0.8f)
        Text(
          text = face.day.hijriText,
          color = pal("faint"),
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          // The same style the line was measured with, so the solve and the glyphs below it can
          // never drift apart.
          style = hijriStyle
        )
      }
    }
    Spacer(modifier = Modifier.weight(1f))
    // The middle of the hero — the prayer, the countdown, the caption — inside the design's
    // 22dp guard, where the circle is wide and a long caption should wrap rather than run out.
    Column(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp),
      horizontalAlignment = Alignment.CenterHorizontally
    ) {
      if (arabicPrimary) {
        Text(
          text = face.subject.name,
          // Calligraphy, and it stays in Amiri (D135): this is the hero prayer name, the phone's
          // `heroArabic`, an Arabic-designed line rather than a Latin one rendered in Arabic.
          fontFamily = Amiri,
          fontWeight = FontWeight.Bold,
          // Amiri carries the app's 1.15 optical scale AND tall line metrics, so Arabic gets a
          // smaller nominal size for the same visual weight (27 once pushed the seal off-circle).
          fontSize = (21 * k).sp,
          lineHeight = (25 * k).sp,
          color = pal("ink"),
          style = TrimmedLine
        )
      } else {
        // The companion is the first thing the hero sheds — it is the only line here that says
        // again, in a second script, what the line under it already says.
        if (tier == HeroTier.FULL) {
          face.subject.arabicName?.let {
            Text(
              text = it,
              // The Arabic companion over a Latin name — the phone's `rowArabic`, calligraphy, Amiri.
              fontFamily = Amiri,
              fontSize = (14 * k).sp,
              lineHeight = (17 * k).sp,
              color = pal("soft"),
              modifier = Modifier.padding(top = 1.dp),
              style = TrimmedLine
            )
          }
        }
        Text(
          text = face.subject.name,
          fontFamily = Lora,
          fontWeight = FontWeight.SemiBold,
          fontSize = (21 * k).sp,
          color = pal("ink")
        )
      }
      Ornament(width = 105.dp, modifier = Modifier.padding(top = 3.dp))
      val big = face.countdownTarget?.let { formatCountdown(it - now, face.snapshot.language) }
        ?: face.staticBig
        ?: ""
      val counting = face.countdownTarget != null
      // Every size here is stated per script on purpose. The two faces do not draw the same body
      // at one nominal size, so a shared literal is a decision by omission — the thing that put
      // the tile's own fallback headline in a font with no Arabic glyphs.
      val bigSize = when {
        // The Arabic countdown was tuned smaller for Amiri's tall box; Noto Naskh's is shorter
        // (1.703 em against 1.758) and its Arabic-Indic digits are much narrower (449/1000
        // against 585), so 25 now has room on both axes rather than needing it.
        counting && arabicPrimary -> 25f
        counting -> 28f
        // A one-word status line ("prayed", "missed") — no wrap risk, so it takes the app's full
        // 1.15 optical step: 15 × 1.15.
        arabicPrimary -> 17f
        else -> 15f
      }
      val bigLine = when {
        counting -> 31f
        arabicPrimary -> 21f
        else -> 19f
      }
      val bigFace = uiFace(arabicPrimary, bigSize * k, weight = FontWeight.SemiBold)
      Text(
        text = big,
        fontFamily = bigFace.family,
        fontWeight = bigFace.weight,
        fontSize = (bigSize * k).sp,
        lineHeight = (bigLine * k).sp,
        color = pal("inkStrong"),
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 2.dp),
        style = TrimmedLine
      )
      if (face.caption.isNotEmpty()) {
        // The caption stays at 12 in both scripts: it is the widest composed line on the page
        // ("prayed · Maghrib · 6:42 pm") inside a round crop, and Noto Naskh's larger body buys
        // back the optical difference at this size without buying width.
        // ...and it never goes below 12 either: `12 * k` resolved to 10.15sp on a 192dp round,
        // under WO-V14's essential floor. It wraps rather than shrinks now (the hero can grow).
        val captionSize = essentialSp(12f * k)
        val captionFace = uiFace(arabicPrimary, captionSize, italic = true)
        Text(
          text = face.caption,
          fontFamily = captionFace.family,
          fontWeight = captionFace.weight,
          fontStyle = captionFace.style,
          fontSize = captionSize.sp,
          lineHeight = (captionSize * 1.25f).sp,
          color = pal("muted"),
          textAlign = TextAlign.Center,
          modifier = Modifier.padding(top = 1.dp),
          style = TrimmedLine
        )
      }
      Ornament(width = 105.dp, modifier = Modifier.padding(top = 3.dp))
    }
    Spacer(modifier = Modifier.weight(1f))
    val sealTap = face.sealPrayer?.let { prayer ->
      TodayModel.tapFor(face.day, prayer, face.effective[prayer.prayer] ?: prayer.status, now)
    }
    // The visual seal is 44 × k dp — 37dp on a 192dp round, under WO-V2's 48dp floor — so the
    // touch target is a 48dp box around it, exactly the pattern the rows already use.
    //
    // The outer box is what the COLUMN pays for, and it pays the seal's own height, not the
    // touch target's: `wrapContentHeight(unbounded)` lets the 48dp box overflow it and centres
    // it, the way hit-slop works everywhere else. Without that the hero was charged 48dp twice
    // over on a small round — once for the seal and once for whitespace it already had — and
    // the 11dp difference is what pushed the seal down into the page dots the Play reviewer
    // photographed. Nothing moves on the glass except the seal, upward, off the dots.
    Box(
      modifier = Modifier.height((44 * k).dp).wrapContentHeight(unbounded = true),
      contentAlignment = Alignment.Center
    ) {
      Box(
        modifier = Modifier
          .size(48.dp)
          .let { m ->
            if (sealTap != null && face.sealPrayer != null) {
              m.clickable { onTap(face.day.day, face.sealPrayer.prayer, sealTap) }
            } else m
          },
        contentAlignment = Alignment.Center
      ) {
        Seal(face = face.sealFace, size = (44 * k).dp)
      }
    }
    if (face.sealWord.isNotEmpty()) {
      // One word under a seal that already says the same thing in glyph and colour: ornament,
      // so it takes WO-V14's 10sp floor rather than the essential one.
      val sealWordSize = ornamentSp(9.5f)
      val sealWordFace = uiFace(arabicPrimary, sealWordSize, italic = true)
      Text(
        text = face.sealWord,
        fontFamily = sealWordFace.family,
        fontWeight = sealWordFace.weight,
        fontStyle = sealWordFace.style,
        fontSize = sealWordSize.sp,
        color = pal("soft"),
        // 6, not 4: the seal's box used to hand this line 2dp of its own slack on the 227dp
        // round it was drawn for, and that slack is now gone. Same gap on the glass there.
        modifier = Modifier.padding(top = 6.dp)
      )
    }
    // The seal never sits flush with the bezel — this margin is part of the design.
    Spacer(modifier = Modifier.height((14 * k).dp))
  }
}

/**
 * What sits between the hero and the rows: the day's date, in one line or two.
 *
 * The Gregorian line was always here. The hijri line joins it only when the hero shed the header
 * to keep the seal on the first screen — same face, same 12sp floor, same `faint` ink it had in
 * the crown, so it reads as the line that MOVED rather than a new one, and it is the first thing
 * a scroll reveals. The mosque mark does not come down with it: it is an eyebrow for a header,
 * and here it would only cost the line the width it needs on a small round.
 */
@Composable
private fun HeroFoot(
  tier: HeroTier,
  face: TodayModel.Face.Today,
  arabicPrimary: Boolean,
  hijriStyle: TextStyle
) {
  Column(
    modifier = Modifier.fillMaxWidth(),
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    if (tier == HeroTier.NO_HEADER) {
      Text(
        text = face.day.hijriText,
        color = pal("faint"),
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(start = 26.dp, end = 26.dp),
        style = hijriStyle
      )
    }
    val dateSize = essentialSp(10f)
    val dateFace = uiFace(arabicPrimary, dateSize, italic = true)
    Text(
      text = face.day.dateText,
      fontFamily = dateFace.family,
      fontWeight = dateFace.weight,
      fontStyle = dateFace.style,
      fontSize = dateSize.sp,
      color = pal("faint"),
      textAlign = TextAlign.Center,
      // The one line in the rows that carried no side guard at all — it could grow to the full
      // width of the display and hang over the arc at either end once the system font grew.
      // Bounded to the rows' own margin, it wraps to a second centred line instead (WO-V1).
      modifier = Modifier.fillMaxWidth().padding(start = 26.dp, end = 26.dp, bottom = 2.dp)
    )
  }
}

@Composable
private fun PrayerRow(
  face: TodayModel.Face.Today,
  prayer: Snapshot.DayPrayer,
  now: Long,
  arabicPrimary: Boolean,
  onTap: (day: String, prayer: String, tap: TodayModel.Tap) -> Unit
) {
  val status = face.effective[prayer.prayer] ?: prayer.status
  val register = TodayModel.registerOf(prayer, face.segment, now)
  val isCurrent = register == TodayModel.Register.CURRENT
  val sealFace =
    if (face.day.isExempt) TodayModel.SealFace.EXEMPT
    else TodayModel.sealFaceOf(status, register)
  val tap = TodayModel.tapFor(face.day, prayer, status, now)

  val rowModifier =
    if (isCurrent) {
      Modifier
        .fillMaxWidth()
        .padding(horizontal = 26.dp, vertical = 2.dp)
        .background(pal("card"), RoundedCornerShape(16.dp))
        .border(1.dp, pal("borderStrong"), RoundedCornerShape(16.dp))
        .padding(horizontal = 10.dp, vertical = 4.dp)
    } else {
      Modifier.fillMaxWidth().padding(horizontal = 34.dp, vertical = 2.dp)
    }

  Row(modifier = rowModifier, verticalAlignment = Alignment.CenterVertically) {
    Column(modifier = Modifier.weight(1f)) {
      // The row's name is the app language's own word — the phone's `rowName`, a Latin-designed
      // line, so in Arabic it is UI text and takes SemiBold like its Latin twin, not Amiri Bold.
      val nameSize = if (isCurrent) 15f else 14f
      val nameFace = uiFace(arabicPrimary, nameSize, weight = FontWeight.SemiBold)
      Text(
        text = prayer.name,
        fontFamily = nameFace.family,
        fontWeight = nameFace.weight,
        fontSize = nameSize.sp,
        color = pal("ink")
      )
      // The prayer's time is the most essential line in a prayer-times app, and it was set at 11 —
      // under WO-V14. At the 12sp floor it is still below [ARABIC_SMALL_SP], so Arabic keeps its
      // rung step-up inside [uiFace] (D54/D135).
      val timeSize = essentialSp(11f)
      val timeFace = uiFace(arabicPrimary, timeSize)
      Text(
        text = if (isCurrent) "${prayer.timeText} · ${face.snapshot.strings.now}" else prayer.timeText,
        fontFamily = timeFace.family,
        fontWeight = timeFace.weight,
        fontSize = timeSize.sp,
        color = if (isCurrent) pal("accentDeep") else pal("muted")
      )
    }
    // The visual seal is 29dp; the touch target pads to the 48dp floor.
    Box(
      modifier = Modifier
        .size(48.dp)
        .let { m ->
          if (tap != null) m.clickable(onClickLabel = null) { onTap(face.day.day, prayer.prayer, tap) }
          else m
        },
      contentAlignment = Alignment.Center
    ) {
      Seal(face = sealFace, size = 29.dp)
    }
  }
}

@Composable
private fun SunriseMarker(sunriseText: String, arabicPrimary: Boolean) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 1.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(5.dp)
  ) {
    HairlineRule(pal("hairline"), Modifier.weight(1f))
    Canvas(modifier = Modifier.size(8.dp)) { drawSunrise(pal("soft")) }
    // A time, so it is essential text however quiet the marker looks: WO-V14's 12sp floor. The
    // two hairlines carry weight(1f) and simply give the width back.
    val sunriseSize = essentialSp(9f)
    val sunriseFace = uiFace(arabicPrimary, sunriseSize, italic = true)
    Text(
      text = sunriseText,
      fontFamily = sunriseFace.family,
      fontWeight = sunriseFace.weight,
      fontStyle = sunriseFace.style,
      fontSize = sunriseSize.sp,
      color = pal("soft")
    )
    HairlineRule(pal("hairline"), Modifier.weight(1f))
  }
}

/** The bundled state — WatchStates.dc.html's honest quiet card, in the SYSTEM locale (D103). */
@Composable
internal fun EmptyFace(stale: Boolean, scroll: ScrollState) {
  // These two sentences are the ONE place on the watch where the words do not come from the
  // envelope, so the face cannot come from the envelope's language either: `stringResource`
  // resolved them through the resource qualifiers, and the font has to follow the same locale it
  // was handed. Read from the configuration rather than Locale.getDefault() so it is literally
  // the locale that chose values-ar/.
  val arabicSystem = usesArabicScript(LocalConfiguration.current.locales[0].language)
  val screenHeight = LocalConfiguration.current.screenHeightDp.dp
  val focusRequester = remember { FocusRequester() }
  LaunchedEffect(Unit) { focusRequester.requestFocus() }
  // Two sentences centred on the glass — until the wearer's font setting makes them four, at
  // which point a fixed screenful clips both ends of the paragraph. Same answer as the hero: the
  // content keeps its size and the page scrolls (WO-V1), touch or rotary, and stays centred
  // whenever it still fits in one screenful.
  Column(
    modifier = Modifier
      .fillMaxSize()
      .verticalScroll(scroll)
      .rotaryScrollable(RotaryScrollableDefaults.behavior(scroll), focusRequester),
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Column(
      modifier = Modifier.fillMaxWidth().heightIn(min = screenHeight).padding(horizontal = 30.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center
    ) {
      MosqueMark(size = 22.dp, color = pal("header"), alpha = 0.9f)
      Ornament(width = 105.dp, modifier = Modifier.padding(top = 9.dp))
      val titleFace = uiFace(arabicSystem, 15.5f, weight = FontWeight.SemiBold)
      Text(
        text = androidx.compose.ui.res.stringResource(
          if (stale) R.string.wear_stale_title else R.string.wear_empty_title
        ),
        fontFamily = titleFace.family,
        fontWeight = titleFace.weight,
        fontSize = 15.5.sp,
        color = pal("ink"),
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 8.dp)
      )
      // The only sentence on the screen when there is nothing else: essential by definition, so it
      // takes WO-V14's 12sp floor and the paragraph grows a line taller if it must.
      val bodySize = essentialSp(11.5f)
      val bodyFace = uiFace(arabicSystem, bodySize, italic = true)
      Text(
        text = androidx.compose.ui.res.stringResource(
          if (stale) R.string.wear_stale_body else R.string.wear_empty_body
        ),
        fontFamily = bodyFace.family,
        fontWeight = bodyFace.weight,
        fontStyle = bodyFace.style,
        fontSize = bodySize.sp,
        color = pal("muted"),
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 4.dp)
      )
    }
  }
}

/**
 * The live countdown, in the app language's numerals — the one sanctioned native formatting
 * (the same class of exception as the widgets' system-ticked Chronometer). H:MM:SS with an hour
 * on the clock, M:SS under it.
 */
// The app's Arabic uses Arabic-Indic numerals (the phone's numericLocale convention); a bare
// "ar" tag resolves to Latin digits on some Android builds, so the numbering system is explicit.
// Urdu is the opposite: Western digits (docs/TONE.md), pinned so a "ur-IN" default can't switch.
internal fun numericLocale(language: String): Locale =
  Locale.forLanguageTag(
    when (language) {
      "ar" -> "ar-u-nu-arab"
      "ur" -> "ur-u-nu-latn"
      else -> language
    }
  )

internal fun formatCountdown(remainingMs: Long, language: String): String {
  val total = (remainingMs.coerceAtLeast(0L)) / 1000
  val hours = total / 3600
  val minutes = (total % 3600) / 60
  val seconds = total % 60
  val locale = numericLocale(language)
  val one = NumberFormat.getIntegerInstance(locale).apply { isGroupingUsed = false }
  val two = NumberFormat.getIntegerInstance(locale).apply {
    isGroupingUsed = false
    minimumIntegerDigits = 2
  }
  return if (hours > 0) "${one.format(hours)}:${two.format(minutes)}:${two.format(seconds)}"
  else "${one.format(minutes)}:${two.format(seconds)}"
}
