package app.simpleprayer.wear

import org.json.JSONObject

/**
 * The watch envelope, parsed — the Kotlin shadow of `src/services/watchEnvelope.ts`, wrapping the
 * TWIN of `modules/prayer-widgets/android/.../Snapshot.kt` (neither module can import the other;
 * change one, change both). Like both parents, this file PARSES and SELECTS; it never computes.
 * Prayer days, windows, Friday names, numerals, the qibla bearing and every user-facing string
 * were resolved by the app in TypeScript, under test. The only logic a watch is allowed is
 * comparing an instant to a precomputed boundary ([Snapshot.segmentAt]) and the pending-marks
 * overlay ([WearPendingMarks]) — both pinned by `modules/prayer-widgets/contract/`.
 *
 * Anything unreadable — wrong version (the envelope's OR the wrapped snapshot's), missing field,
 * malformed JSON — parses to `null`, and the caller renders the bundled "open the phone" state.
 */
internal data class Envelope(
  val snapshot: Snapshot,
  /** `null` when the phone had no location to compute a bearing from — the qibla page hides. */
  val qibla: Qibla?,
  val alerts: Alerts
) {
  internal data class Qibla(
    /** Degrees clockwise from TRUE north, precomputed on the phone. */
    val bearing: Double,
    val alignedLabel: String,
    val toLeftLabel: String,
    val toRightLabel: String,
    /** The dial's cardinal engravings (owner, 2026-08-28); empty on pre-field envelopes. */
    val north: String,
    val east: String,
    val south: String,
    val west: String
  )

  internal data class AlertEntry(
    val day: String,
    val prayer: String,
    /** The prayer's start — when the alarm fires. Epoch ms. */
    val at: Long,
    val title: String,
    val body: String,
    val markedTitle: String
  )

  internal data class Alerts(
    val entries: List<AlertEntry>,
    val prayedLabel: String,
    val undoLabel: String
  )

  companion object {
    /** Must match `WATCH_ENVELOPE_VERSION` in `src/services/watchEnvelope.ts`. */
    const val VERSION = 1

    fun parse(raw: String?): Envelope? {
      if (raw.isNullOrEmpty()) return null
      return runCatching {
        val root = JSONObject(raw)
        if (root.getInt("version") != VERSION) return null
        val snapshot = Snapshot.parse(root.getJSONObject("snapshot").toString()) ?: return null
        val qibla = root.optJSONObject("qibla")?.let {
          Qibla(
            bearing = it.getDouble("bearing"),
            alignedLabel = it.getString("alignedLabel"),
            toLeftLabel = it.getString("toLeftLabel"),
            toRightLabel = it.getString("toRightLabel"),
            north = it.optString("north"),
            east = it.optString("east"),
            south = it.optString("south"),
            west = it.optString("west")
          )
        }
        val alertsJson = root.getJSONObject("alerts")
        val entriesJson = alertsJson.getJSONArray("entries")
        val entries = buildList {
          for (i in 0 until entriesJson.length()) {
            val e = entriesJson.getJSONObject(i)
            add(
              AlertEntry(
                day = e.getString("day"),
                prayer = e.getString("prayer"),
                at = e.getLong("at"),
                title = e.getString("title"),
                body = e.getString("body"),
                markedTitle = e.getString("markedTitle")
              )
            )
          }
        }
        Envelope(
          snapshot = snapshot,
          qibla = qibla,
          alerts = Alerts(
            entries = entries,
            prayedLabel = alertsJson.getString("prayedLabel"),
            undoLabel = alertsJson.getString("undoLabel")
          )
        )
      }.getOrNull()
    }
  }
}

/**
 * The widget snapshot, parsed — TWIN of
 * `modules/prayer-widgets/android/src/main/java/expo/modules/prayerwidgets/Snapshot.kt`
 * (the Kotlin shadow of `src/services/widgetSnapshot.ts`). Change one, change both.
 */
internal data class Snapshot(
  val generatedAt: Long,
  val expiresAt: Long,
  val language: String,
  val rtl: Boolean,
  /** 'system' | 'light' | 'dark' — kept for contract fidelity; the watch is night-paper always. */
  val theme: String,
  val strings: Strings,
  val days: List<Day>,
  val segments: List<Segment>
) {
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
    val untilText: String?,
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
        if (days.isEmpty() || segments.isEmpty()) return null
        Snapshot(
          generatedAt = root.getLong("generatedAt"),
          expiresAt = root.getLong("expiresAt"),
          language = root.getString("language"),
          rtl = root.getBoolean("rtl"),
          theme = root.getString("theme"),
          strings = strings,
          days = days,
          segments = segments
        )
      }.getOrNull()
    }

    private fun JSONObject.optStringOrNull(key: String): String? =
      if (isNull(key) || !has(key)) null else getString(key)

    private fun JSONObject.optLongOrNull(key: String): Long? =
      if (isNull(key) || !has(key)) null else getLong(key)
  }
}
