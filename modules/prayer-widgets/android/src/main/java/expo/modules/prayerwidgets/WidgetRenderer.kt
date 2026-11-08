package expo.modules.prayerwidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.widget.RemoteViews

/**
 * Draws both widgets from the stored snapshot — data to views and NOTHING else. Every string was
 * translated, every time formatted, every boundary computed by the app; the renderer's whole
 * intelligence is: find the active segment, lay the pending queue over the day, map statuses to
 * seal skins the way `PrayerSeal.tsx` does, tint from the generated palette.
 *
 * Direction: the Arabic layouts are truly RTL (`layoutDirection="rtl"` pinned in the derived
 * XML), so children are always filled in natural order — the layout mirrors itself.
 *
 * The Schedule widget comes in two pickable sizes, exactly like iOS: the 4×2 columns
 * ([ScheduleWidgetProvider]) and the tall row list ([ScheduleListWidgetProvider], the iOS
 * Large's twin). Both share every rule below.
 *
 * Two states are drawn without a snapshot, and they are the honest ones (never a stale time):
 * "open the app to set up" (nothing stored) and "times need a refresh" (stored but past its
 * horizon). Their strings are the module's bundled resources — the one sanctioned exception,
 * keyed to the system locale, because no snapshot exists to carry the app language's copy.
 */
internal object WidgetRenderer {

  /** Redraws every placed instance of all four widgets and re-arms the transition alarm. */
  fun renderAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val scheduleIds = manager.getAppWidgetIds(ComponentName(context, ScheduleWidgetProvider::class.java))
    val listIds = manager.getAppWidgetIds(ComponentName(context, ScheduleListWidgetProvider::class.java))
    val nowIds = manager.getAppWidgetIds(ComponentName(context, NowWidgetProvider::class.java))
    val stripIds = manager.getAppWidgetIds(ComponentName(context, NowStripWidgetProvider::class.java))
    if (scheduleIds.isEmpty() && listIds.isEmpty() && nowIds.isEmpty() && stripIds.isEmpty()) {
      TransitionAlarms.cancel(context)
      return
    }
    val snapshot = SnapshotStore.read(context)
    val now = System.currentTimeMillis()
    if (scheduleIds.isNotEmpty()) {
      manager.updateAppWidget(scheduleIds, buildSchedule(context, snapshot, now, asRows = false))
    }
    if (listIds.isNotEmpty()) {
      manager.updateAppWidget(listIds, buildSchedule(context, snapshot, now, asRows = true))
    }
    // The calm countdown's target, if any Now face is showing one: it has no seconds and no
    // Chronometer, so it needs a redraw each minute (D198).
    var calmTarget: Long? = null
    if (nowIds.isNotEmpty()) {
      manager.updateAppWidget(nowIds, buildNow(context, snapshot, now, strip = false) { calmTarget = it })
    }
    if (stripIds.isNotEmpty()) {
      manager.updateAppWidget(stripIds, buildNow(context, snapshot, now, strip = true) { calmTarget = it })
    }
    TransitionAlarms.armNext(context, snapshot, now)
    TransitionAlarms.armMinute(context, calmTarget, now)
  }

  fun hasWidgets(context: Context): Boolean {
    val manager = AppWidgetManager.getInstance(context)
    return manager.getAppWidgetIds(ComponentName(context, ScheduleWidgetProvider::class.java)).isNotEmpty() ||
      manager.getAppWidgetIds(ComponentName(context, ScheduleListWidgetProvider::class.java)).isNotEmpty() ||
      manager.getAppWidgetIds(ComponentName(context, NowWidgetProvider::class.java)).isNotEmpty() ||
      manager.getAppWidgetIds(ComponentName(context, NowStripWidgetProvider::class.java)).isNotEmpty()
  }

  // -------------------------------------------------------------------------
  // Schedule — shared prep, then the columns or the rows face
  // -------------------------------------------------------------------------

  private fun buildSchedule(context: Context, snapshot: Snapshot?, now: Long, asRows: Boolean): RemoteViews {
    val usable = usableSnapshot(context, snapshot, now) ?: return buildEmpty(context, stale = snapshot != null)
    val day = usable.day
    val night = isNight(context, usable.snapshot.theme)
    val strings = usable.snapshot.strings

    val arabic = usable.snapshot.language == "ar"
    val layout =
      when {
        asRows && arabic -> R.layout.widget_schedule_rows_arabic
        asRows -> R.layout.widget_schedule_rows
        arabic -> R.layout.widget_schedule_arabic
        else -> R.layout.widget_schedule
      }
    val views = RemoteViews(context.packageName, layout)
    tintChrome(views, night)

    views.setTextViewText(R.id.header_date, day.dateText)
    views.setTextColor(R.id.header_date, palette("header", night))
    val meta = listOfNotNull(day.sunriseText, day.hijriText.ifEmpty { null }).joinToString(" · ")
    views.setTextViewText(R.id.header_meta, meta)
    views.setTextColor(R.id.header_meta, palette("faint", night))
    views.setInt(R.id.header_sun, "setColorFilter", palette("faint", night))
    // The app's mark and its signature hairline-and-◆ rule under the header — the same
    // manuscript character the Now widget carries (owner, 2026-08-25: the big widgets felt
    // bland without it).
    views.setInt(R.id.header_mark, "setColorFilter", palette("accent", night))
    views.setInt(R.id.hrule_l, "setColorFilter", palette("hairline", night))
    views.setInt(R.id.hrule_r, "setColorFilter", palette("hairline", night))
    views.setTextViewText(R.id.horn, "◆")
    views.setTextColor(R.id.horn, palette("diamond", night))

    val effective = PendingQueue.effectiveStatuses(
      context,
      day.day,
      day.prayers.associate { it.prayer to it.status }
    )

    if (asRows) {
      bindScheduleRows(context, views, usable, effective, now, night, strings)
    } else {
      bindScheduleColumns(context, views, usable, effective, now, night, strings)
    }

    views.setOnClickPendingIntent(R.id.root, openAppIntent(context))
    return views
  }

  private fun bindScheduleColumns(
    context: Context,
    views: RemoteViews,
    usable: Usable,
    effective: Map<String, String>,
    now: Long,
    night: Boolean,
    strings: Snapshot.Strings
  ) {
    val (day, segment) = usable
    for ((index, prayer) in day.prayers.withIndex()) {
      val col = COLUMNS[index]
      val status = effective[prayer.prayer] ?: prayer.status
      val register = registerOf(prayer, segment, now)
      val isCurrent = register == Register.CURRENT

      views.setTextViewText(col.name, prayer.name)
      views.setTextColor(col.name, palette("ink", night))
      views.setTextViewText(col.time, prayer.timeText)
      views.setTextColor(col.time, palette(if (isCurrent) "inkStrong" else "muted", night))
      views.setTextViewText(col.cap, captionFor(status, register, strings))
      views.setTextColor(col.cap, palette(if (isCurrent && status == "unlogged") "accent" else "muted", night))

      val cardColor =
        if (isCurrent) composite(palette("bg", night), palette("cardBright", night))
        else composite(palette("bg", night), palette("cardQuiet", night))
      views.setInt(col.bg, "setColorFilter", cardColor)
      // The border is a FILLED card behind the inset bg (see the layout header): tinting a
      // stroke-only shape paints the whole card, so the ring is two fills instead.
      views.setViewVisibility(col.border, if (isCurrent) android.view.View.VISIBLE else android.view.View.GONE)
      if (isCurrent) views.setInt(col.border, "setColorFilter", palette("borderStrong", night))

      applySealSkin(views, col.sealFill, col.sealGlyph, status, register, night)
      views.setOnClickPendingIntent(
        col.root,
        // Only a seal that answers may invite the finger: current or past, unlogged or prayed.
        // Everything else — future, exempt, late, missed — opens the app like the chrome does.
        if (tappable(status, register, day.isExempt)) tapIntent(context, day.day, prayer.prayer, index)
        else openAppIntent(context)
      )
    }
  }

  private fun bindScheduleRows(
    context: Context,
    views: RemoteViews,
    usable: Usable,
    effective: Map<String, String>,
    now: Long,
    night: Boolean,
    strings: Snapshot.Strings
  ) {
    val (day, segment) = usable

    // The sunrise rule between Fajr and Dhuhr — hairlines are tinted fills, like every border.
    if (day.sunriseText != null) {
      views.setViewVisibility(R.id.sunrise_row, android.view.View.VISIBLE)
      views.setTextViewText(R.id.sun_label, strings.sunrise)
      views.setTextColor(R.id.sun_label, palette("faint", night))
      views.setTextViewText(R.id.sun_time, day.sunriseText)
      views.setTextColor(R.id.sun_time, palette("faint", night))
      views.setInt(R.id.sun_glyph, "setColorFilter", palette("faint", night))
      views.setInt(R.id.sun_line_l, "setColorFilter", palette("borderMid", night))
      views.setInt(R.id.sun_line_r, "setColorFilter", palette("borderMid", night))
    } else {
      views.setViewVisibility(R.id.sunrise_row, android.view.View.GONE)
    }

    for ((index, prayer) in day.prayers.withIndex()) {
      val row = ROWS[index]
      val status = effective[prayer.prayer] ?: prayer.status
      val register = registerOf(prayer, segment, now)
      val isCurrent = register == Register.CURRENT

      views.setTextViewText(row.name, prayer.name)
      views.setTextColor(row.name, palette("ink", night))
      if (prayer.arabicName != null) {
        views.setViewVisibility(row.arabic, android.view.View.VISIBLE)
        views.setTextViewText(row.arabic, prayer.arabicName)
        views.setTextColor(row.arabic, palette("muted", night))
      } else {
        views.setViewVisibility(row.arabic, android.view.View.GONE)
      }
      views.setTextViewText(row.time, prayer.timeText)
      views.setTextColor(row.time, palette(if (isCurrent) "inkStrong" else "muted", night))
      // The current unlogged row carries the deadline sentence, exactly like the iOS Large.
      val caption =
        if (isCurrent && status == "unlogged") prayer.dueCaption
        else captionFor(status, register, strings)
      views.setTextViewText(row.cap, caption)
      views.setTextColor(row.cap, palette(if (isCurrent && status == "unlogged") "accent" else "muted", night))

      val cardColor =
        if (isCurrent) composite(palette("bg", night), palette("cardBright", night))
        else composite(palette("bg", night), palette("cardQuiet", night))
      views.setInt(row.bg, "setColorFilter", cardColor)
      views.setViewVisibility(row.border, if (isCurrent) android.view.View.VISIBLE else android.view.View.GONE)
      if (isCurrent) views.setInt(row.border, "setColorFilter", palette("borderStrong", night))

      applyBuddyBadges(context, views, row.buddies, usable.snapshot.buddiesFor(prayer.prayer, day.day), night)
      applySealSkin(views, row.sealFill, row.sealGlyph, status, register, night)
      views.setOnClickPendingIntent(
        row.root,
        if (tappable(status, register, day.isExempt)) tapIntent(context, day.day, prayer.prayer, index)
        else openAppIntent(context)
      )
    }
  }

  // -------------------------------------------------------------------------
  // Now — the 2×2 face, and the one-row strip (D182) bound by the same code
  // -------------------------------------------------------------------------

  /**
   * @param strip the 4×1 face (D182, redesigned by D185): the names over a big countdown on the
   *   leading side, the buddies and a big seal trailing — or the day's five seals when nothing is
   *   markable. No ornament rules. Both layouts share their view ids.
   */
  private fun buildNow(
    context: Context,
    snapshot: Snapshot?,
    now: Long,
    strip: Boolean,
    onCalm: (target: Long) -> Unit
  ): RemoteViews {
    val usable = usableSnapshot(context, snapshot, now) ?: return buildEmpty(context, stale = snapshot != null)
    val (day, segment) = usable
    val night = isNight(context, usable.snapshot.theme)
    val strings = usable.snapshot.strings

    val arabic = usable.snapshot.language == "ar"
    val layout =
      when {
        strip && arabic -> R.layout.widget_now_strip_arabic
        strip -> R.layout.widget_now_strip
        arabic -> R.layout.widget_now_arabic
        else -> R.layout.widget_now
      }
    val views = RemoteViews(context.packageName, layout)
    tintChrome(views, night)
    // The app mark, in the accent — what makes this recognizably a prayer widget before a
    // single word is read (owner, 2026-08-25) — and the manuscript ornament rules that frame
    // the hero band, exactly the in-app divider (hairline + ◆ in the diamond tone).
    views.setInt(R.id.mark, "setColorFilter", palette("accent", night))
    if (strip) {
      // One rule, stood upright between the hero and the seal; its ◆ is a drawable (D186).
      for (line in intArrayOf(R.id.orn1_l, R.id.orn1_r)) {
        views.setInt(line, "setColorFilter", palette("hairline", night))
        // Upright, the night hairline reads as a bar; halve it to the weight it has lying down.
        views.setInt(line, "setImageAlpha", if (night) 110 else 255)
      }
      views.setInt(R.id.orn1, "setColorFilter", palette("diamond", night))
    } else {
      for (line in intArrayOf(R.id.orn1_l, R.id.orn1_r, R.id.orn2_l, R.id.orn2_r)) {
        views.setInt(line, "setColorFilter", palette("hairline", night))
      }
      for (diamond in intArrayOf(R.id.orn1, R.id.orn2)) {
        views.setTextViewText(diamond, "◆")
        views.setTextColor(diamond, palette("diamond", night))
      }
    }

    val effective = PendingQueue.effectiveStatuses(
      context,
      day.day,
      day.prayers.associate { it.prayer to it.status }
    )

    val current = segment.current?.let { name -> day.prayers.firstOrNull { it.prayer == name } }
    val next = nextPrayerOf(usable.snapshot, segment)

    val subject = current ?: next
    if (subject == null) {
      // Horizon's edge inside a still-valid snapshot: nothing to name.
      return buildEmpty(context, stale = true)
    }

    // The eyebrow: which prayer this is about, and nothing else.
    views.setTextViewText(R.id.name, subject.name)
    views.setTextColor(R.id.name, palette("ink", night))
    if (subject.arabicName != null) {
      views.setTextViewText(R.id.arabic, subject.arabicName)
      views.setTextColor(R.id.arabic, palette("muted", night))
      views.setViewVisibility(R.id.arabic, android.view.View.VISIBLE)
    } else {
      views.setViewVisibility(R.id.arabic, android.view.View.GONE)
    }

    // The hero: a live Chronometer wherever a deadline exists (it ticks inside the launcher's
    // process, so it stays true however stale this drawing is), the static line everywhere else.
    fun showBig(text: String, color: Int) {
      views.setViewVisibility(R.id.countdown, android.view.View.GONE)
      views.setViewVisibility(R.id.calm, android.view.View.GONE)
      views.setViewVisibility(R.id.big, android.view.View.VISIBLE)
      views.setTextViewText(R.id.big, text)
      views.setTextColor(R.id.big, color)
    }
    // Two countdowns that must never be mistaken for each other (D190): the DEADLINE — time
    // left to pray the current prayer — in strong ink over an accent "until 4:51 pm"; the calm
    // UPCOMING one — time until the next prayer starts — in muted ink over "until Asr".
    fun showCountdown(target: Long) {
      views.setViewVisibility(R.id.big, android.view.View.GONE)
      views.setViewVisibility(R.id.calm, android.view.View.GONE)
      views.setViewVisibility(R.id.countdown, android.view.View.VISIBLE)
      views.setChronometer(
        R.id.countdown,
        android.os.SystemClock.elapsedRealtime() + (target - now),
        null,
        true
      )
      views.setTextColor(R.id.countdown, palette("inkStrong", night))
    }
    // The calm one is hours and minutes only (owner, 2026-11-07: "no seconds counter needed"),
    // so it is plain text, not a Chronometer, and the caller re-arms a minute redraw (D198).
    fun showCalm(target: Long) {
      views.setViewVisibility(R.id.big, android.view.View.GONE)
      views.setViewVisibility(R.id.countdown, android.view.View.GONE)
      views.setViewVisibility(R.id.calm, android.view.View.VISIBLE)
      views.setTextViewText(R.id.calm, calmClock(target - now, subject.timeText))
      views.setTextColor(R.id.calm, palette("muted", night))
      onCalm(target)
    }
    fun showCap(text: String, color: Int) {
      views.setTextViewText(R.id.cap, text)
      views.setTextColor(R.id.cap, color)
    }

    views.setViewVisibility(R.id.big_glyph, android.view.View.GONE)
    val currentStatus = current?.let { effective[it.prayer] }
    val windowEnd = current?.windowEndAt
    when {
      day.isExempt -> {
        views.setViewVisibility(R.id.big_glyph, android.view.View.VISIBLE)
        views.setImageViewResource(R.id.big_glyph, R.drawable.glyph_crescent)
        views.setInt(R.id.big_glyph, "setColorFilter", palette("muted", night))
        showBig(strings.statusNotRequired, palette("muted", night))
        showCap("", palette("muted", night))
      }
      // Only a deadline still AHEAD gets a Chronometer: one drawn at or past its end would start
      // life negative (D189). Past it, the static caption below stays true until the redraw.
      current != null && currentStatus == "unlogged" && windowEnd != null && windowEnd > now -> {
        // Ticking time left in the open window. The caption is ONE word and the deadline —
        // "until 4:51 pm" (owner, 2026-08-25: anything longer truncates on a 2×2).
        showCountdown(windowEnd)
        showCap(current.untilText ?: strings.leftToPray, palette("accent", night))
      }
      current != null && currentStatus == "unlogged" -> {
        // No resolvable deadline (horizon edge, polar day): the pre-rendered caption stays true.
        showBig(current.dueCaption, palette("inkStrong", night))
        val after = nextPrayerOf(usable.snapshot, segment)
        showCap(after?.let { "${it.name} · ${it.timeText}" } ?: "", palette("accent", night))
      }
      current != null && next != null && next.at > now -> {
        // Marked: the calm countdown to the next prayer's START (owner, 2026-11-07), and the
        // caption keeps the recorded status in words — "Prayed · until Asr". Fajr marked
        // therefore stays "prayed" until sunrise and counts to Dhuhr / Jumu'ah (D190).
        val status = captionFor(currentStatus ?: current.status, Register.CURRENT, strings)
        showCalm(next.at)
        showCap("$status · ${next.untilStartText ?: next.name}", palette("muted", night))
      }
      current != null -> {
        // Marked with nothing left to count to (the horizon's edge): say what was recorded.
        showBig(captionFor(currentStatus ?: current.status, Register.CURRENT, strings), palette("muted", night))
        showCap("", palette("muted", night))
      }
      else -> {
        // The sunrise→Dhuhr gap: the calm countdown to Dhuhr — Jumu'ah on a Friday, by the
        // snapshot's own name (D190, reversing the 2026-08-28 "nothing ticks" ruling at the
        // owner's request). It cannot read as Dhuhr counting down twice: Dhuhr's own segment
        // counts to Asr. The sun stays as the morning's mark.
        views.setViewVisibility(R.id.big_glyph, android.view.View.VISIBLE)
        views.setImageViewResource(R.id.big_glyph, R.drawable.glyph_sun)
        views.setInt(R.id.big_glyph, "setColorFilter", palette("soft", night))
        if (subject.at > now) {
          showCalm(subject.at)
          showCap(subject.untilStartText ?: subject.name, palette("muted", night))
        } else {
          showBig(day.sunriseText ?: subject.timeText, palette("inkStrong", night))
          showCap("${strings.statusUpcoming} · ${subject.timeText}", palette("accent", night))
        }
      }
    }

    // The hero seal — the visible "I prayed" button (owner, 2026-08-25): the current prayer's
    // own seal beside the countdown, filling gold under the finger, tap again to undo — the
    // in-app reward loop carried onto the widget. Absent when nothing is markable (the sunrise
    // gap, an exempt day), because a button that answers nothing is furniture pretending.
    val heroStatus = currentStatus ?: current?.status
    if (current != null && !day.isExempt && heroStatus != null) {
      views.setViewVisibility(R.id.now_seal, android.view.View.VISIBLE)
      applySealSkin(views, R.id.now_seal_fill, R.id.now_seal_glyph, heroStatus, Register.CURRENT, night)
      views.setOnClickPendingIntent(
        R.id.now_seal,
        if (tappable(heroStatus, Register.CURRENT, day.isExempt)) tapIntent(context, day.day, current.prayer, 8)
        else openAppIntent(context)
      )
    } else {
      views.setViewVisibility(R.id.now_seal, android.view.View.GONE)
    }

    if (strip) {
      // Who else prayed the current prayer, beside the seal (D182). Nobody can have prayed a
      // prayer that has not started, so the sunrise gap — where the subject is the NEXT prayer —
      // shows none. When there is no seal to press, the day's five seals take its place (D185).
      applyBuddyBadges(
        context,
        views,
        R.id.buddies,
        current?.let { usable.snapshot.buddiesFor(it.prayer, day.day) } ?: emptyList(),
        night
      )
      val sealShown = current != null && !day.isExempt && heroStatus != null
      views.setViewVisibility(R.id.dots, if (sealShown) android.view.View.GONE else android.view.View.VISIBLE)
    }

    for ((index, prayer) in day.prayers.withIndex()) {
      val dot = DOTS[index]
      applySealSkin(
        views,
        dot.fill,
        dot.glyph,
        effective[prayer.prayer] ?: prayer.status,
        registerOf(prayer, segment, now),
        night
      )
    }

    // The dots strip marks the CURRENT prayer prayed; without one it opens the app like the rest.
    if (current != null && !day.isExempt) {
      views.setOnClickPendingIntent(R.id.dots, tapIntent(context, day.day, current.prayer, 9))
    } else {
      views.setOnClickPendingIntent(R.id.dots, openAppIntent(context))
    }
    views.setOnClickPendingIntent(R.id.root, openAppIntent(context))
    return views
  }

  // -------------------------------------------------------------------------
  // Empty / stale
  // -------------------------------------------------------------------------

  private fun buildEmpty(context: Context, stale: Boolean): RemoteViews {
    val night = isNight(context, "system")
    // These are the D103 strings — the only copy that does NOT travel in the snapshot, because
    // they render exactly when no snapshot exists. They resolve against this process's
    // Configuration (values-ar/values-tr), so the FACE has to be chosen off the same
    // Configuration: the Lora layout carries no Arabic letter and no Arabic-Indic digit, so an
    // Arabic device reading the base layout gets its first sentence from the product drawn by an
    // OEM fallback. Asking the resource system with a `layout-ar/` qualifier would not do: the
    // launcher inflates RemoteViews under its OWN configuration, which a per-app language
    // override moves apart from ours. Same question, same answer, always.
    val views = RemoteViews(
      context.packageName,
      if (isArabicConfiguration(context)) R.layout.widget_empty_arabic else R.layout.widget_empty
    )
    tintChrome(views, night)
    views.setImageViewResource(R.id.empty_seal_fill, if (stale) R.drawable.seal_ring_thin else R.drawable.seal_ring_dashed)
    views.setInt(R.id.empty_seal_fill, "setColorFilter", palette(if (stale) "borderMid" else "unlogged", night))
    views.setImageViewResource(R.id.empty_seal_glyph, if (stale) R.drawable.glyph_crescent else R.drawable.glyph_ring)
    views.setInt(R.id.empty_seal_glyph, "setColorFilter", palette(if (stale) "muted" else "unlogged", night))
    views.setTextViewText(
      R.id.empty_title,
      context.getString(if (stale) R.string.widget_stale_title else R.string.widget_empty_title)
    )
    views.setTextColor(R.id.empty_title, palette("inkStrong", night))
    views.setTextViewText(
      R.id.empty_body,
      context.getString(if (stale) R.string.widget_stale_body else R.string.widget_empty_body)
    )
    views.setTextColor(R.id.empty_body, palette("muted", night))
    views.setOnClickPendingIntent(R.id.root, openAppIntent(context))
    return views
  }

  // -------------------------------------------------------------------------
  // Skins — PrayerSeal.tsx's face table, one row per state
  // -------------------------------------------------------------------------

  private enum class Register { CURRENT, FUTURE, PAST }

  private fun registerOf(prayer: Snapshot.DayPrayer, segment: Snapshot.Segment, now: Long): Register =
    when {
      segment.current == prayer.prayer -> Register.CURRENT
      prayer.at > now -> Register.FUTURE
      else -> Register.PAST
    }

  /**
   * Whether a seal tap may mark this prayer (owner rule, 2026-08-25: a future prayer is never
   * tickable). Mirrors [WidgetTapReceiver]'s own guard — the receiver stays the authority; this
   * merely keeps the widget from inviting a press it would refuse.
   */
  private fun tappable(status: String, register: Register, isExempt: Boolean): Boolean =
    !isExempt && register != Register.FUTURE && (status == "unlogged" || status == "prayed")

  private fun applySealSkin(
    views: RemoteViews,
    fillId: Int,
    glyphId: Int,
    status: String,
    register: Register,
    night: Boolean
  ) {
    data class Skin(val fill: Int, val fillColor: Int, val glyph: Int, val glyphColor: Int)

    val skin = when (status) {
      "prayed" -> Skin(R.drawable.seal_fill, palette("accent", night), R.drawable.glyph_check, palette("sealFg", night))
      "late" -> Skin(R.drawable.seal_fill, palette("late", night), R.drawable.glyph_clock, palette("sealFg", night))
      "missed" -> Skin(R.drawable.seal_ring_thin, palette("missed", night), R.drawable.glyph_close, palette("missed", night))
      "exempt" -> Skin(
        R.drawable.seal_fill,
        composite(palette("bg", night), palette("cardElevated", night)),
        R.drawable.glyph_crescent,
        palette("muted", night)
      )
      else -> when (register) {
        // The dashed accent ring + ghosted check: "awaiting your hand".
        Register.CURRENT -> Skin(
          R.drawable.seal_ring_dashed,
          palette("accent", night),
          R.drawable.glyph_check,
          withAlpha(palette("accent", night), 0.7f)
        )
        Register.FUTURE -> Skin(R.drawable.seal_ring_thin, palette("borderMid", night), R.drawable.glyph_dot, palette("soft", night))
        Register.PAST -> Skin(R.drawable.seal_ring_dashed, palette("unlogged", night), R.drawable.glyph_ring, palette("unlogged", night))
      }
    }

    views.setImageViewResource(fillId, skin.fill)
    views.setInt(fillId, "setColorFilter", skin.fillColor)
    views.setImageViewResource(glyphId, skin.glyph)
    views.setInt(glyphId, "setColorFilter", skin.glyphColor)
  }

  /** The caption word — always a word, never color alone (CLAUDE.md hard rule). */
  private fun captionFor(status: String, register: Register, strings: Snapshot.Strings): String =
    when (status) {
      "prayed" -> strings.statusPrayed
      "late" -> strings.statusLate
      "missed" -> strings.statusMissed
      "exempt" -> strings.statusNotRequired
      else -> when (register) {
        Register.CURRENT -> strings.now
        Register.FUTURE -> strings.statusUpcoming
        Register.PAST -> strings.statusNotMarked
      }
    }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private class Usable(val snapshot: Snapshot, val day: Snapshot.Day, val segment: Snapshot.Segment) {
    operator fun component1() = day
    operator fun component2() = segment
  }

  private fun usableSnapshot(context: Context, snapshot: Snapshot?, now: Long): Usable? {
    if (snapshot == null || snapshot.isExpiredAt(now)) return null
    val segment = snapshot.segmentAt(now) ?: return null
    val day = snapshot.dayFor(segment.day) ?: return null
    return Usable(snapshot, day, segment)
  }

  private fun nextPrayerOf(snapshot: Snapshot, segment: Snapshot.Segment): Snapshot.DayPrayer? {
    val day = segment.nextDay ?: return null
    val prayer = segment.nextPrayer ?: return null
    return snapshot.dayFor(day)?.prayers?.firstOrNull { it.prayer == prayer }
  }

  private fun tintChrome(views: RemoteViews, night: Boolean) {
    views.setInt(R.id.bg, "setColorFilter", palette("bg", night))
  }

  private fun palette(role: String, night: Boolean): Int = WidgetPalette.color(role, night)

  private fun buddyColor(name: String, night: Boolean): Int = WidgetPalette.buddyColor(name, night)

  /**
   * The calm countdown as "H:MM" — minutes rounded UP, so the last minute reads 0:01, never 0:00
   * while there is still time. Digits follow the app's own choice (D40) as the snapshot already
   * applied it to [sample] (a pre-formatted time): Arabic-Indic there, Arabic-Indic here.
   */
  internal fun calmClock(remainingMs: Long, sample: String): String {
    val minutes = ((remainingMs.coerceAtLeast(0) + 59_999) / 60_000).toInt()
    val text = "${minutes / 60}:${(minutes % 60).toString().padStart(2, '0')}"
    if (sample.none { it in '\u0660'..'\u0669' }) return text
    return text.map { if (it in '0'..'9') '\u0660' + (it - '0') else it }.joinToString("")
  }

  private fun isNight(context: Context, theme: String): Boolean =
    when (theme) {
      "dark" -> true
      "light" -> false
      else ->
        (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
          Configuration.UI_MODE_NIGHT_YES
    }

  /**
   * Whether `context.getString` will resolve this module's bundled strings out of `values-ar/`.
   * Read from the same `Configuration` the resource system matches against, so the bundled
   * sentence and the layout that draws it always come from one answer — including under an
   * Android 13 per-app language, which moves both together.
   */
  private fun isArabicConfiguration(context: Context): Boolean {
    val locales = context.resources.configuration.locales
    return !locales.isEmpty() && locales.get(0).language == "ar"
  }

  /** src-over compositing of a translucent card onto the paper, so tints stay opaque. */
  private fun composite(bg: Int, over: Int): Int {
    val oa = (over ushr 24 and 0xff) / 255f
    fun channel(shift: Int): Int {
      val b = bg ushr shift and 0xff
      val o = over ushr shift and 0xff
      return ((o * oa) + b * (1 - oa)).toInt().coerceIn(0, 255)
    }
    return (0xff shl 24) or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
  }

  private fun withAlpha(color: Int, alpha: Float): Int =
    (color and 0x00ffffff) or ((alpha * 255).toInt().coerceIn(0, 255) shl 24)

  private fun tapIntent(context: Context, day: String, prayer: String, slot: Int): PendingIntent {
    val intent = Intent(context, WidgetTapReceiver::class.java)
      .setAction(WidgetTapReceiver.ACTION_TAP)
      .putExtra(WidgetTapReceiver.EXTRA_DAY, day)
      .putExtra(WidgetTapReceiver.EXTRA_PRAYER, prayer)
    return PendingIntent.getBroadcast(
      context,
      // One live PendingIntent per slot: day/prayer travel in extras, so the request code only
      // has to keep the five columns (and the dots strip, slot 9) from colliding.
      slot,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun openAppIntent(context: Context): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      100,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /**
   * The buddy badges on a large-widget row (D177) and on the one-row Now strip (D182).
   *
   * Drawn as a bitmap into one ImageView, because RemoteViews cannot compose a stack of overlapping
   * circles from XML without nine views per row. The result is the same shape the app draws: a
   * coloured disc with two letters, a ring in the paper's colour so overlapping discs stay
   * countable, and a slight overlap so a row of them reads as one group.
   *
   * Never a name — a widget is read across a room — and the view is GONE for every install without
   * buddy mode, which is most of them.
   */
  private fun applyBuddyBadges(
    context: Context,
    views: RemoteViews,
    viewId: Int,
    buddies: List<Snapshot.Buddy>,
    night: Boolean
  ) {
    if (buddies.isEmpty()) {
      views.setViewVisibility(viewId, android.view.View.GONE)
      return
    }

    val density = context.resources.displayMetrics.density
    // 22dp, up from 18: the first device pass could not read the letters at arm's length. The row
    // ImageViews are 24dp tall to hold it (`widget_schedule_rows*.xml`).
    val size = 22f * density
    val overlap = 6f * density
    // At most three. A fourth would push the seal, and the seal is the point of the row.
    val shown = buddies.take(3)
    val width = (size + (shown.size - 1) * (size - overlap)).toInt().coerceAtLeast(1)

    val bitmap = android.graphics.Bitmap.createBitmap(width, size.toInt(), android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val fill = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    val ring = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
      style = android.graphics.Paint.Style.STROKE
      strokeWidth = 1.5f * density
      color = palette("bg", night)
    }
    val text = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
      color = palette("sealFg", night)
      textAlign = android.graphics.Paint.Align.CENTER
      textSize = size * 0.42f
      isFakeBoldText = true
    }

    // Later discs tuck BEHIND earlier ones, so they are drawn back to front — the same reading
    // order as the app, where the first buddy in the roster sits on top.
    for ((index, buddy) in shown.withIndex().reversed()) {
      val left = index * (size - overlap)
      val cx = left + size / 2f
      val cy = size / 2f
      fill.color = buddyColor(buddy.color, night)
      canvas.drawCircle(cx, cy, size / 2f, fill)
      canvas.drawCircle(cx, cy, size / 2f - ring.strokeWidth / 2f, ring)
      if (buddy.initials.isNotEmpty()) {
        val baseline = cy - (text.descent() + text.ascent()) / 2f
        canvas.drawText(buddy.initials, cx, baseline, text)
      }
    }

    views.setImageViewBitmap(viewId, bitmap)
    views.setViewVisibility(viewId, android.view.View.VISIBLE)
  }

  private data class Column(val root: Int, val bg: Int, val border: Int, val name: Int, val sealFill: Int, val sealGlyph: Int, val time: Int, val cap: Int)
  private data class Row(val root: Int, val bg: Int, val border: Int, val name: Int, val arabic: Int, val sealFill: Int, val sealGlyph: Int, val time: Int, val cap: Int, val buddies: Int)
  private data class Dot(val fill: Int, val glyph: Int)

  private val COLUMNS = listOf(
    Column(R.id.col1, R.id.col1_bg, R.id.col1_border, R.id.col1_name, R.id.col1_seal_fill, R.id.col1_seal_glyph, R.id.col1_time, R.id.col1_cap),
    Column(R.id.col2, R.id.col2_bg, R.id.col2_border, R.id.col2_name, R.id.col2_seal_fill, R.id.col2_seal_glyph, R.id.col2_time, R.id.col2_cap),
    Column(R.id.col3, R.id.col3_bg, R.id.col3_border, R.id.col3_name, R.id.col3_seal_fill, R.id.col3_seal_glyph, R.id.col3_time, R.id.col3_cap),
    Column(R.id.col4, R.id.col4_bg, R.id.col4_border, R.id.col4_name, R.id.col4_seal_fill, R.id.col4_seal_glyph, R.id.col4_time, R.id.col4_cap),
    Column(R.id.col5, R.id.col5_bg, R.id.col5_border, R.id.col5_name, R.id.col5_seal_fill, R.id.col5_seal_glyph, R.id.col5_time, R.id.col5_cap)
  )

  private val ROWS = listOf(
    Row(R.id.row1, R.id.row1_bg, R.id.row1_border, R.id.row1_name, R.id.row1_arabic, R.id.row1_seal_fill, R.id.row1_seal_glyph, R.id.row1_time, R.id.row1_cap, R.id.row1_buddies),
    Row(R.id.row2, R.id.row2_bg, R.id.row2_border, R.id.row2_name, R.id.row2_arabic, R.id.row2_seal_fill, R.id.row2_seal_glyph, R.id.row2_time, R.id.row2_cap, R.id.row2_buddies),
    Row(R.id.row3, R.id.row3_bg, R.id.row3_border, R.id.row3_name, R.id.row3_arabic, R.id.row3_seal_fill, R.id.row3_seal_glyph, R.id.row3_time, R.id.row3_cap, R.id.row3_buddies),
    Row(R.id.row4, R.id.row4_bg, R.id.row4_border, R.id.row4_name, R.id.row4_arabic, R.id.row4_seal_fill, R.id.row4_seal_glyph, R.id.row4_time, R.id.row4_cap, R.id.row4_buddies),
    Row(R.id.row5, R.id.row5_bg, R.id.row5_border, R.id.row5_name, R.id.row5_arabic, R.id.row5_seal_fill, R.id.row5_seal_glyph, R.id.row5_time, R.id.row5_cap, R.id.row5_buddies)
  )

  private val DOTS = listOf(
    Dot(R.id.d1_fill, R.id.d1_glyph),
    Dot(R.id.d2_fill, R.id.d2_glyph),
    Dot(R.id.d3_fill, R.id.d3_glyph),
    Dot(R.id.d4_fill, R.id.d4_glyph),
    Dot(R.id.d5_fill, R.id.d5_glyph)
  )
}
