package expo.modules.prayerwidgets

import org.json.JSONObject

/**
 * The widget snapshot, parsed — the Kotlin shadow of `src/services/widgetSnapshot.ts`.
 *
 * This file PARSES and SELECTS; it never computes. Prayer days, windows, Friday names, numerals
 * and every user-facing string were resolved by the app in TypeScript, under test. The only logic
 * a widget is allowed is comparing an instant to a precomputed boundary ([Snapshot.segmentAt]) and
 * the queue overlay ([PendingQueue]) — both pinned by `modules/prayer-widgets/contract/`.
 *
 * Anything unreadable — wrong version, missing field, malformed JSON — parses to `null`, and the
 * caller renders the bundled "open the app" state. A widget that asks for a launch after an app
 * update is honest; one that misreads a stale layout is not.
 */
internal data class Snapshot(
  val generatedAt: Long,
  val expiresAt: Long,
  val language: String,
  val rtl: Boolean,
  /** 'system' | 'light' | 'dark' — the in-app override. */
  val theme: String,
  val strings: Strings,
  val days: List<Day>,
  val segments: List<Segment>,
  /** Today's buddy badges (D177), or null whenever buddy mode is off — which is most installs. */
  val buddies: Buddies? = null
) {
  /**
   * Who else prayed each prayer, and the day they belong to.
   *
   * The day travels with them so the renderer can check rather than assume: the schedule widget can
   * be asked for any day in the horizon, and yesterday's row borrowing today's badges would be a
   * quiet little lie.
   */
  internal data class Buddies(
    val day: String,
    val marks: Map<String, List<Buddy>>
  )

  /**
   * One buddy's face. A colour name and two letters — **never a name**: a widget is read across a
   * room. Both were chosen on this phone by the person reading it.
   */
  internal data class Buddy(
    val color: String,
    val initials: String
  )

  /** Who else prayed this one, in roster order. Empty unless `day` is the day they belong to. */
  fun buddiesFor(prayer: String, day: String): List<Buddy> {
    val held = buddies ?: return emptyList()
    if (held.day != day) return emptyList()
    return held.marks[prayer] ?: emptyList()
  }

  internal data class Strings(
    val sunrise: String,
    val statusPrayed: String,
    val statusLate: String,
    val statusMissed: String,
    val statusNotMarked: String,
    val statusNotRequired: String,
    val statusUpcoming: String,
    val now: String,
    val next: String,
    val leftToPray: String
  )

  internal data class DayPrayer(
    val prayer: String,
    val name: String,
    val arabicName: String?,
    val at: Long,
    val timeText: String,
    val windowEndAt: Long?,
    val dueCaption: String,
    /** "until 6:42 pm" — the bare deadline; null when unresolvable or written by an older app. */
    val untilText: String?,
    /** "until Asr" — the calm countdown's caption (D190); null from older apps (use the name). */
    val untilStartText: String?,
    /** The status as the app last wrote it; overlay the queue before rendering. */
    val status: String
  )

  internal data class Day(
    val day: String,
    val startsAt: Long,
    val endsAt: Long,
    val dateText: String,
    val hijriText: String,
    val isExempt: Boolean,
    val sunriseAt: Long?,
    val sunriseText: String?,
    val prayers: List<DayPrayer>
  )

  internal data class Segment(
    val from: Long,
    val to: Long,
    val day: String,
    val current: String?,
    val nextDay: String?,
    val nextPrayer: String?
  )

  fun dayFor(day: String): Day? = days.firstOrNull { it.day == day }

  /** The segment containing `now` — the same half-open search `segmentAt` runs in TypeScript. */
  fun segmentAt(now: Long): Segment? = segments.firstOrNull { now >= it.from && now < it.to }

  /** Past this the snapshot must not be drawn (see `WidgetSnapshot.expiresAt`). */
  fun isExpiredAt(now: Long): Boolean = now >= expiresAt

  companion object {
    /** Must match `WIDGET_SNAPSHOT_VERSION` in `src/services/widgetSnapshot.ts`. */
    const val VERSION = 1

    fun parse(raw: String?): Snapshot? {
      if (raw.isNullOrEmpty()) return null
      return runCatching {
        val root = JSONObject(raw)
        if (root.getInt("version") != VERSION) return null
        val strings = root.getJSONObject("strings").let {
          Strings(
            sunrise = it.getString("sunrise"),
            statusPrayed = it.getString("statusPrayed"),
            statusLate = it.getString("statusLate"),
            statusMissed = it.getString("statusMissed"),
            statusNotMarked = it.getString("statusNotMarked"),
            statusNotRequired = it.getString("statusNotRequired"),
            statusUpcoming = it.getString("statusUpcoming"),
            now = it.getString("now"),
            next = it.getString("next"),
            leftToPray = it.getString("leftToPray")
          )
        }
        val daysJson = root.getJSONArray("days")
        val days = buildList {
          for (i in 0 until daysJson.length()) {
            val day = daysJson.getJSONObject(i)
            val prayersJson = day.getJSONArray("prayers")
            val prayers = buildList {
              for (j in 0 until prayersJson.length()) {
                val p = prayersJson.getJSONObject(j)
                add(
                  DayPrayer(
                    prayer = p.getString("prayer"),
                    name = p.getString("name"),
                    arabicName = p.optStringOrNull("arabicName"),
                    at = p.getLong("at"),
                    timeText = p.getString("timeText"),
                    windowEndAt = p.optLongOrNull("windowEndAt"),
                    dueCaption = p.getString("dueCaption"),
                    untilText = p.optStringOrNull("untilText"),
                    untilStartText = p.optStringOrNull("untilStartText"),
                    status = p.getString("status")
                  )
                )
              }
            }
            if (prayers.size != 5) return null
            add(
              Day(
                day = day.getString("day"),
                startsAt = day.getLong("startsAt"),
                endsAt = day.getLong("endsAt"),
                dateText = day.getString("dateText"),
                hijriText = day.getString("hijriText"),
                isExempt = day.getBoolean("isExempt"),
                sunriseAt = day.optLongOrNull("sunriseAt"),
                sunriseText = day.optStringOrNull("sunriseText"),
                prayers = prayers
              )
            )
          }
        }
        val segmentsJson = root.getJSONArray("segments")
        val segments = buildList {
          for (i in 0 until segmentsJson.length()) {
            val s = segmentsJson.getJSONObject(i)
            val next = s.optJSONObject("next")
            add(
              Segment(
                from = s.getLong("from"),
                to = s.getLong("to"),
                day = s.getString("day"),
                current = s.optStringOrNull("current"),
                nextDay = next?.optStringOrNull("day"),
                nextPrayer = next?.optStringOrNull("prayer")
              )
            )
          }
        }
        val buddiesJson = root.optJSONObject("buddies")
        val buddies = buddiesJson?.let { held ->
          val marksJson = held.optJSONObject("marks")
          val marks = mutableMapOf<String, List<Buddy>>()
          if (marksJson != null) {
            for (prayer in marksJson.keys()) {
              val rowJson = marksJson.optJSONArray(prayer) ?: continue
              val row = buildList {
                for (k in 0 until rowJson.length()) {
                  val face = rowJson.optJSONObject(k) ?: continue
                  add(Buddy(color = face.optString("color"), initials = face.optString("initials")))
                }
              }
              if (row.isNotEmpty()) marks[prayer] = row
            }
          }
          if (marks.isEmpty()) null else Buddies(day = held.optString("day"), marks = marks)
        }

        if (days.isEmpty() || segments.isEmpty()) return null
        Snapshot(
          generatedAt = root.getLong("generatedAt"),
          expiresAt = root.getLong("expiresAt"),
          language = root.getString("language"),
          rtl = root.getBoolean("rtl"),
          theme = root.getString("theme"),
          strings = strings,
          days = days,
          segments = segments,
          buddies = buddies
        )
      }.getOrNull()
    }

    private fun JSONObject.optStringOrNull(key: String): String? =
      if (isNull(key) || !has(key)) null else getString(key)

    private fun JSONObject.optLongOrNull(key: String): Long? =
      if (isNull(key) || !has(key)) null else getLong(key)
  }
}
