package expo.modules.prayerwidgets

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * This module's window onto the D92 pending-marks queue — the SAME storage
 * `modules/prayer-marks`' `PendingMarks.kt` owns (`expo.modules.prayermarks.pending`,
 * `mark:<id>` keys, the JSON field names of `domain/pendingMarks`' `PendingMark`).
 *
 * Two things happen here and their limits matter:
 *
 * - **Append** ([appendTap]) — a seal tap writes one entry, a single `putString`, exactly the
 *   pattern `PendingMarks.append` uses (concurrent broadcasts cannot lose each other's writes).
 *   The entry asserts either "prayed" or, with `clears`, "not prayed after all" — never a status,
 *   never a database write. The app drains it through `trackingStore.toggleStatus` like every
 *   other entry; a widget tap and a notification press are indistinguishable by the time they
 *   reach the log, which is the point.
 *
 * - **Overlay** ([effectiveStatuses]) — what the widget shows before the app has drained. This is
 *   the one piece of domain logic duplicated into Kotlin, and it is duplicated by CONTRACT:
 *   `modules/prayer-widgets/contract/overlay-cases.json` pins every case, the TypeScript twin
 *   (`resolvePendingMarks` + `overlayPendingMarks`) is held to it by Jest, and this file is held
 *   to it by review. Keep the rule one sentence long: latest decision per (day, prayer) wins;
 *   `prayed` shows only over `unlogged`; an undo/clears only over `prayed`.
 *
 * It deliberately does NOT read or write the queue's copy keys, confirmations, or acknowledge
 * anything — draining is the app's job alone.
 */
internal object PendingQueue {
  private const val PREFS_NAME = "expo.modules.prayermarks.pending"
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
   * Appends what a seal tap asserted.
   *
   * @param day The prayer day the tapped seal belongs to — from the snapshot, never re-derived.
   * @param clears True when the tap toggles OFF (the seal showed prayed).
   */
  fun appendTap(context: Context, day: String, prayer: String, clears: Boolean) {
    val now = System.currentTimeMillis()
    // nanoTime uniquifies two taps landing in the same millisecond — ids must never collide,
    // because the queue is keyed by them.
    val entry = JSONObject()
      .put(FIELD_ID, "widget:$prayer:$now:${System.nanoTime()}")
      .put(FIELD_DAY, day)
      .put(FIELD_PRAYER, prayer)
      .put(FIELD_DECIDED_AT, now)
    if (clears) entry.put(FIELD_CLEARS, true)
    prefs(context).edit().putString(MARK_PREFIX + entry.getString(FIELD_ID), entry.toString()).apply()
  }

  /** Matches `domain/dates.isValidDay`'s shape check closely enough to reject garbage. */
  private val DAY_SHAPE = Regex("""\d{4}-\d{2}-\d{2}""")

  /**
   * A day's statuses with the undrained queue laid over them — the contract's `effective`.
   *
   * Validation is STRICT and field-typed, mirroring TypeScript's `isPendingMark` exactly: an
   * entry with any present-but-mistyped field (a string `clears`, a null `annuls`, a numeric
   * `confirmationId`) is unreadable EVERYWHERE, so a widget can never paint a mark the drain
   * will then throw away. Annul pairs match across ALL entries, whatever day they carry, and an
   * annuller whose target has no day is held back — both exactly as `resolvePendingMarks` does.
   *
   * @param base Prayer → status, as the snapshot carries it.
   * @return A new map; `base` is never mutated.
   */
  fun effectiveStatuses(context: Context, day: String, base: Map<String, String>): Map<String, String> {
    data class Entry(val id: String, val day: String?, val prayer: String, val decidedAt: Double, val undoes: Boolean, val annuls: String?)

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
      entries.add(Entry(id, entryDay, prayer, decidedAt, annuls != null || clears, annuls))
    }

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

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
