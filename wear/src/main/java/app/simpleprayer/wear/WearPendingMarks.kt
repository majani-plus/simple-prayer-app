package app.simpleprayer.wear

import android.content.Context
import android.content.SharedPreferences
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

/**
 * The wrist's window onto the D92 pending-marks queue. A seal tap does two things at once:
 *
 * - **Sends the mark up** — one data item per mark at `/simpleprayer/marks/<id>` ([WearWire]).
 *   The Data Layer persists it through disconnection; the phone drains it into the real queue
 *   and deletes the item. By the time it reaches the log, a wrist tap and a notification press
 *   are indistinguishable, which is the point.
 * - **Keeps a local copy** — so the tile and app can show the flip immediately, laid over the
 *   snapshot's statuses under the SAME overlay contract every reader obeys
 *   (`modules/prayer-widgets/contract/overlay-cases.json`; [effectiveStatuses] is the twin of
 *   prayer-widgets' `PendingQueue.effectiveStatuses` — change one, change both). The copy is
 *   render state only: the upstream send already happened, so [gcAgainst] may drop entries the
 *   moment a fresh envelope reflects them.
 *
 * The rule stays one sentence long: latest decision per (day, prayer) wins; `prayed` shows only
 * over `unlogged`; an undo/clears only over `prayed`.
 */
internal object WearPendingMarks {
  private const val PREFS_NAME = "app.simpleprayer.wear.pending"
  private const val MARK_PREFIX = "mark:"

  private const val FIELD_ID = "id"
  private const val FIELD_DAY = "day"
  private const val FIELD_PRAYER = "prayer"
  private const val FIELD_DECIDED_AT = "decidedAt"
  private const val FIELD_ANNULS = "annuls"
  private const val FIELD_CLEARS = "clears"
  private const val FIELD_CONFIRMATION_ID = "confirmationId"

  private val PRAYERS = listOf("fajr", "dhuhr", "asr", "maghrib", "isha")

  /**
   * Appends what a seal tap asserted and ships it to the phone.
   *
   * @param day The prayer day the tapped seal belongs to — from the snapshot, never re-derived.
   * @param clears True when the tap toggles OFF (the seal showed prayed).
   * @return The entry's id, so a notification's Undo can annul exactly this decision.
   */
  fun appendTap(context: Context, day: String, prayer: String, clears: Boolean): String {
    val now = System.currentTimeMillis()
    // nanoTime uniquifies two taps landing in the same millisecond — ids must never collide,
    // because the queue is keyed by them.
    val entry = JSONObject()
      .put(FIELD_ID, "wear:$prayer:$now:${System.nanoTime()}")
      .put(FIELD_DAY, day)
      .put(FIELD_PRAYER, prayer)
      .put(FIELD_DECIDED_AT, now)
    if (clears) entry.put(FIELD_CLEARS, true)
    return persistAndSend(context, entry)
  }

  /**
   * Appends the notification Undo's answer: a fresh entry annulling [targetId] (the pair cancels
   * under the overlay contract, and the phone's drain treats it exactly as the notification
   * action's own undo).
   */
  fun appendAnnul(context: Context, day: String, prayer: String, targetId: String): String {
    val now = System.currentTimeMillis()
    val entry = JSONObject()
      .put(FIELD_ID, "wear:$prayer:$now:${System.nanoTime()}")
      .put(FIELD_DAY, day)
      .put(FIELD_PRAYER, prayer)
      .put(FIELD_DECIDED_AT, now)
      .put(FIELD_ANNULS, targetId)
    return persistAndSend(context, entry)
  }

  private fun persistAndSend(context: Context, entry: JSONObject): String {
    val id = entry.getString(FIELD_ID)
    val json = entry.toString()
    prefs(context).edit().putString(MARK_PREFIX + id, json).apply()
    // Urgent: a mark is one tiny item and the whole reward loop — no batching delay wanted.
    val request = PutDataMapRequest.create("${WearWire.MARKS_PATH_PREFIX}/$id").apply {
      dataMap.putString(WearWire.KEY_JSON, json)
    }.asPutDataRequest().setUrgent()
    Wearable.getDataClient(context).putDataItem(request)
    return id
  }

  /** Matches `domain/dates.isValidDay`'s shape check closely enough to reject garbage. */
  private val DAY_SHAPE = Regex("""\d{4}-\d{2}-\d{2}""")

  private data class Entry(
    val key: String,
    val id: String,
    val day: String?,
    val prayer: String,
    val decidedAt: Double,
    val undoes: Boolean,
    val annuls: String?
  )

  private fun readEntries(context: Context): List<Entry> {
    val entries = mutableListOf<Entry>()
    for ((key, value) in prefs(context).all) {
      if (!key.startsWith(MARK_PREFIX)) continue
      val json = value as? String ?: continue
      val parsed = runCatching { JSONObject(json) }.getOrNull() ?: continue

      val id = parsed.opt(FIELD_ID) as? String ?: continue
      if (id.isEmpty()) continue
      val prayer = parsed.opt(FIELD_PRAYER) as? String ?: continue
      if (prayer !in PRAYERS) continue
      val decidedAt = (parsed.opt(FIELD_DECIDED_AT) as? Number)?.toDouble() ?: continue
      val entryDay: String?
      if (parsed.has(FIELD_DAY) && !parsed.isNull(FIELD_DAY)) {
        entryDay = parsed.opt(FIELD_DAY) as? String ?: continue
        if (!DAY_SHAPE.matches(entryDay)) continue
      } else {
        entryDay = null
      }
      val annuls: String?
      if (parsed.has(FIELD_ANNULS) && !parsed.isNull(FIELD_ANNULS)) {
        annuls = parsed.opt(FIELD_ANNULS) as? String ?: continue
      } else {
        annuls = null
      }
      val clears: Boolean
      if (parsed.has(FIELD_CLEARS) && !parsed.isNull(FIELD_CLEARS)) {
        clears = parsed.opt(FIELD_CLEARS) as? Boolean ?: continue
      } else {
        clears = false
      }
      if (parsed.has(FIELD_CONFIRMATION_ID) && !parsed.isNull(FIELD_CONFIRMATION_ID) &&
        parsed.opt(FIELD_CONFIRMATION_ID) !is String
      ) {
        continue
      }
      entries.add(Entry(key, id, entryDay, prayer, decidedAt, annuls != null || clears, annuls))
    }
    return entries
  }

  /**
   * A day's statuses with the local queue laid over them — the contract's `effective`.
   *
   * Validation is STRICT and field-typed, mirroring TypeScript's `isPendingMark` exactly: an
   * entry with any present-but-mistyped field is unreadable EVERYWHERE, so the wrist can never
   * paint a mark the drain will then throw away. Annul pairs match across ALL entries, whatever
   * day they carry, and an annuller whose target has no day is held back — both exactly as
   * `resolvePendingMarks` does.
   *
   * @param base Prayer → status, as the snapshot carries it.
   * @return A new map; `base` is never mutated.
   */
  fun effectiveStatuses(context: Context, day: String, base: Map<String, String>): Map<String, String> {
    val entries = readEntries(context)

    // Undatable entries (no day) are held by the drain, never rendered; an annuller pointing at
    // one is held with it. Pairs cancel GLOBALLY — an undo cancels its mark whatever day either
    // carries — then the rendered day resolves latest-wins.
    val undatable = entries.filter { it.day == null }.mapTo(mutableSetOf()) { it.id }
    val present = entries.filter { it.day != null }.mapTo(mutableSetOf()) { it.id }
    val annulled = mutableSetOf<String>()
    val held = mutableSetOf<String>()
    for (entry in entries) {
      val target = entry.annuls ?: continue
      if (target in undatable) held.add(entry.id)
      else if (target in present) {
        annulled.add(target)
        annulled.add(entry.id)
      }
    }

    val latest = mutableMapOf<String, Entry>()
    for (entry in entries.sortedWith(compareBy({ it.decidedAt }, { it.id }))) {
      if (entry.day != day || entry.id in annulled || entry.id in held) continue
      latest[entry.prayer] = entry
    }

    val result = base.toMutableMap()
    for ((prayer, entry) in latest) {
      val current = result[prayer]
      if (!entry.undoes && current == "unlogged") result[prayer] = "prayed"
      else if (entry.undoes && current == "prayed") result[prayer] = "unlogged"
    }
    return result
  }

  /**
   * Drops local render copies a fresh envelope has made redundant. Safe to be eager — the
   * upstream send happened at tap time; these copies exist only so the drawing doesn't lag.
   *
   * An entry goes when its day predates the envelope's horizon, or when the envelope was built
   * AFTER the decision and its base status already says what the entry wanted (prayed for a
   * mark, unlogged for a clears). An annul pair is judged — and dropped — as a unit, because a
   * surviving annuller with no target would repaint someone's in-app mark as undone.
   */
  fun gcAgainst(context: Context, envelope: Envelope) {
    val snapshot = envelope.snapshot
    val firstDay = snapshot.days.first().day
    val entries = readEntries(context)
    val byId = entries.associateBy { it.id }
    val annulledBy = entries.filter { it.annuls != null }.associateBy { it.annuls!! }

    fun baseStatus(day: String?, prayer: String): String? =
      day?.let { snapshot.dayFor(it) }?.prayers?.firstOrNull { it.prayer == prayer }?.status

    val doomed = mutableSetOf<String>()
    for (entry in entries) {
      if (entry.day != null && entry.day < firstDay) {
        doomed.add(entry.key)
        continue
      }
      if (entry.decidedAt > snapshot.generatedAt) continue
      if (entry.annuls != null) {
        // Judged with its target below (or already gone with a pre-horizon target).
        val target = byId[entry.annuls]
        if (target == null || (target.day != null && target.day < firstDay)) doomed.add(entry.key)
        continue
      }
      val annuller = annulledBy[entry.id]
      if (annuller != null) {
        // Pair net effect: no change. Reflected once the envelope postdates both decisions.
        if (annuller.decidedAt <= snapshot.generatedAt) {
          doomed.add(entry.key)
          doomed.add(annuller.key)
        }
        continue
      }
      val wanted = if (entry.undoes) "unlogged" else "prayed"
      if (baseStatus(entry.day, entry.prayer) == wanted) doomed.add(entry.key)
    }

    if (doomed.isNotEmpty()) {
      val editor = prefs(context).edit()
      for (key in doomed) editor.remove(key)
      editor.apply()
    }
  }

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
