package app.simpleprayer.wear

import android.content.Context

/**
 * What the wrist says at one instant — resolved ONCE here, drawn three ways (app, tile,
 * complication). This file selects from the envelope and lays the pending queue over it; it
 * never computes a time, a name, or a sentence beyond the middot joins the phone widgets
 * already sanctioned (`WidgetRenderer.kt`'s own compositions).
 *
 * The hero grammar is the approved V0a canvas (the watch mockups):
 * - **DUE** — the current prayer, unlogged: ticking window countdown, "until 6:42 pm".
 * - **WAITING** — the current prayer is logged: the hero KEEPS the current prayer's name (a tap
 *   never changes what the wrist says it is — owner, 2026-08-28) and counts to the next start;
 *   the caption names what comes next ("prayed · Maghrib · 6:42 pm").
 * - **PLAIN** — the sunrise→Dhuhr gap: counting to the next start, dormant seal.
 * - **EXEMPT** — the day is excused: times keep their place (a times-only user loses nothing);
 *   only the seal changes — the inert crescent with its word, never a verdict (D64).
 */
internal object TodayModel {

  enum class Register { CURRENT, FUTURE, PAST }

  /** How a seal draws — PrayerSeal.tsx's face table, the widgets' exact grammar. */
  enum class SealFace { PRAYED, LATE, MISSED, EXEMPT, CURRENT_UNLOGGED, FUTURE, PAST_UNLOGGED }

  /** What one tap would assert, or `null` when the seal is inert. */
  enum class Tap { MARK, UNDO }

  sealed interface Face {
    /** No drawable envelope: first install ([stale]=false) or one past its horizon (true). */
    data class Empty(val stale: Boolean) : Face

    data class Today(
      val snapshot: Snapshot,
      val day: Snapshot.Day,
      val segment: Snapshot.Segment,
      /** The prayer the hero names (the current one whatever its seal says; next in the gap). */
      val subject: Snapshot.DayPrayer,
      /** Ticking target, epoch ms — or `null` when [staticBig] speaks instead. */
      val countdownTarget: Long?,
      /** The line in the countdown's place when no boundary is resolvable. */
      val staticBig: String?,
      /** The one caption line under the countdown. */
      val caption: String,
      /** The prayer the hero seal belongs to — the CURRENT prayer, or `null` in the gap. */
      val sealPrayer: Snapshot.DayPrayer?,
      val sealFace: SealFace,
      /** The word under the seal on an exempt day; empty otherwise. */
      val sealWord: String,
      /** Statuses with the pending queue laid over, for the rows and foot seals. */
      val effective: Map<String, String>
    ) : Face
  }

  /** The face at [now], or the bundled state. Overlay included — call it fresh per render. */
  fun resolve(context: Context, envelope: Envelope?, now: Long): Face {
    val snapshot = envelope?.snapshot
      ?: return Face.Empty(stale = EnvelopeStore.hasEverSynced(context))
    if (snapshot.isExpiredAt(now)) return Face.Empty(stale = true)
    val segment = snapshot.segmentAt(now) ?: return Face.Empty(stale = true)
    val today: Face? = resolveSegment(context, envelope, segment, now)
    return today ?: Face.Empty(stale = true)
  }

  /**
   * The face for one segment (the tile builds a timeline entry per segment; [at] is any instant
   * inside it). `null` at the horizon's edge, where there is nothing left to name.
   */
  fun resolveSegment(context: Context, envelope: Envelope, segment: Snapshot.Segment, at: Long): Face.Today? {
    val snapshot = envelope.snapshot
    val day = snapshot.dayFor(segment.day) ?: return null
    val effective = WearPendingMarks.effectiveStatuses(
      context,
      day.day,
      day.prayers.associate { it.prayer to it.status }
    )
    val current = segment.current?.let { name -> day.prayers.firstOrNull { it.prayer == name } }
    val next = nextPrayerOf(snapshot, segment)
    val strings = snapshot.strings

    val currentStatus = current?.let { effective[it.prayer] ?: it.status }
    val windowEnd = current?.windowEndAt

    val subject: Snapshot.DayPrayer
    val countdownTarget: Long?
    val staticBig: String?
    val caption: String
    when {
      current != null && currentStatus == "unlogged" && windowEnd != null -> {
        subject = current
        countdownTarget = windowEnd
        staticBig = null
        caption = current.untilText ?: strings.leftToPray
      }
      current != null && currentStatus == "unlogged" -> {
        // No resolvable deadline (horizon edge, polar day): the pre-rendered caption stays true.
        subject = current
        countdownTarget = null
        staticBig = current.dueCaption
        caption = next?.let { "${it.name} · ${it.timeText}" } ?: ""
      }
      current != null && next != null -> {
        // Logged: the hero KEEPS the current prayer's name (the post-tap flip to the next name
        // read as confusing — owner, 2026-08-28) and only the countdown looks forward. The
        // caption carries the state word (the gold seal is its icon) and is now the one place
        // the next prayer is named.
        subject = current
        countdownTarget = next.at
        staticBig = null
        caption = "${statusWord(currentStatus ?: current.status, strings)} · ${next.name} · ${next.timeText}"
      }
      current != null -> {
        // Logged with nothing after it (horizon edge inside a valid snapshot): say the record.
        subject = current
        countdownTarget = null
        staticBig = statusWord(currentStatus ?: current.status, strings)
        caption = ""
      }
      next != null -> {
        // The sunrise→Dhuhr gap: the eyebrow already names the next prayer, so the caption
        // frames the register — "upcoming · 12:47 pm" (the phone widget's own composition).
        subject = next
        countdownTarget = next.at
        staticBig = null
        caption = "${strings.statusUpcoming} · ${next.timeText}"
      }
      else -> return null
    }

    val sealFace: SealFace
    val sealWord: String
    when {
      day.isExempt -> {
        sealFace = SealFace.EXEMPT
        sealWord = strings.statusNotRequired
      }
      current != null -> {
        sealFace = sealFaceOf(currentStatus ?: current.status, Register.CURRENT)
        sealWord = ""
      }
      else -> {
        sealFace = SealFace.FUTURE
        sealWord = ""
      }
    }

    return Face.Today(
      snapshot = snapshot,
      day = day,
      segment = segment,
      subject = subject,
      countdownTarget = countdownTarget,
      staticBig = staticBig,
      caption = caption,
      sealPrayer = current,
      sealFace = sealFace,
      sealWord = sealWord,
      effective = effective
    )
  }

  fun nextPrayerOf(snapshot: Snapshot, segment: Snapshot.Segment): Snapshot.DayPrayer? {
    val day = segment.nextDay ?: return null
    val prayer = segment.nextPrayer ?: return null
    return snapshot.dayFor(day)?.prayers?.firstOrNull { it.prayer == prayer }
  }

  fun registerOf(prayer: Snapshot.DayPrayer, segment: Snapshot.Segment, now: Long): Register =
    when {
      segment.current == prayer.prayer -> Register.CURRENT
      prayer.at > now -> Register.FUTURE
      else -> Register.PAST
    }

  fun sealFaceOf(status: String, register: Register): SealFace =
    when (status) {
      "prayed" -> SealFace.PRAYED
      "late" -> SealFace.LATE
      "missed" -> SealFace.MISSED
      "exempt" -> SealFace.EXEMPT
      else -> when (register) {
        Register.CURRENT -> SealFace.CURRENT_UNLOGGED
        Register.FUTURE -> SealFace.FUTURE
        Register.PAST -> SealFace.PAST_UNLOGGED
      }
    }

  /** The caption word — always a word, never color alone (CLAUDE.md hard rule). */
  fun statusWord(status: String, strings: Snapshot.Strings): String =
    when (status) {
      "prayed" -> strings.statusPrayed
      "late" -> strings.statusLate
      "missed" -> strings.statusMissed
      "exempt" -> strings.statusNotRequired
      else -> strings.statusNotMarked
    }

  /**
   * D108's one rule, evaluated against a FRESH clock: only an unlogged current/past prayer
   * (mark) or a prayed one (undo) accepts a tap; future, exempt, late and missed are inert —
   * and a prayer whose start hasn't arrived is refused even if a stale drawing invited the
   * press.
   */
  fun tapFor(day: Snapshot.Day, prayer: Snapshot.DayPrayer, effectiveStatus: String, now: Long): Tap? {
    if (day.isExempt) return null
    if (prayer.at > now) return null
    return when (effectiveStatus) {
      "unlogged" -> Tap.MARK
      "prayed" -> Tap.UNDO
      else -> null
    }
  }
}
