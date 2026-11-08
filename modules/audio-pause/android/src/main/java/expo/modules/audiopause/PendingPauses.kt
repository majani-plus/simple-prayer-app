package expo.modules.audiopause

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * The whole mechanism: a set of "pause other audio at time T" entries, and one alarm (D96).
 *
 * ## What "pause" actually is
 *
 * A request for **permanent audio focus** (`AUDIOFOCUS_GAIN`), immediately followed by a polite
 * abandon a few seconds later. Well-behaved players — music apps, podcast apps — treat a
 * permanent loss as "stop and do not resume on your own", which is exactly the behaviour asked
 * for: whatever is playing goes quiet when the prayer's time comes in, and the user starts it
 * again when they are ready. The reminder's own sound is a notification stream and plays
 * regardless of who holds media focus, so the adhan is unaffected.
 *
 * Nothing is paused when nothing is playing (`isMusicActive` is checked first), and this module
 * never touches a notification, ours or anyone's.
 *
 * ## Why an alarm and not a notification listener
 *
 * `expo-notifications` dispatches `onNotificationReceived` to its listeners **only while the app
 * is in the foreground** (`ExpoHandlingDelegate.handleNotification` checks `isAppInForeground`);
 * a scheduled reminder firing with the process dead is presented without any callback reaching
 * us. An `AlarmManager` alarm at the reminder's own fire instant is the mechanism this project
 * already trusts for exactly this shape of problem (`modules/notification-dismissal`, D88), so
 * this module is its sibling: same one-alarm-over-a-stored-set design, same manifest-declared
 * receiver, same "the process is expected to be dead" assumptions.
 *
 * ## Why this alarm is exact where the dismissal one is not
 *
 * A dismissal that lands minutes late costs nobody anything. A pause that lands minutes late
 * pauses someone's podcast at a random moment, which is worse than not pausing at all — so the
 * alarm is `setExactAndAllowWhileIdle` wherever the exact-alarm permission allows (the app
 * already asks for it for the reminders themselves, D91), falls back to inexact where it does
 * not, and [pauseDue] simply drops an entry that has gone more than [STALE_MS] past instead of
 * acting on it. Late means silence, never a surprise.
 *
 * A reboot loses the alarm and that is fine: the stored entries are rebuilt on the next sync,
 * and a stale set pauses nothing (see [STALE_MS]).
 */
internal object PendingPauses {
  private const val LOG_TAG = "AudioPause"
  private const val PREFS_NAME = "expo.modules.audiopause.pending"

  /** One alarm for all of them, so one request code. */
  private const val REQUEST_CODE = 0x4150

  /** Absorbs alarm jitter, exactly as the dismissal module's grace does. */
  private const val DUE_GRACE_MS = 1_000L

  /**
   * An entry further past than this is dropped without pausing anything. The moment for the pause
   * was the adhan; minutes later the user has heard it (or missed it), and stopping their audio
   * out of nowhere would read as a bug.
   */
  private const val STALE_MS = 3 * 60 * 1_000L

  /** How long the polite focus hold lasts before it is given back. See [pauseOtherAudio]. */
  private const val ABANDON_DELAY_MS = 5_000L

  private val lock = Any()

  /** Remembers that other audio should pause at `atEpochMs`, and arms the alarm. */
  fun schedule(context: Context, identifier: String, atEpochMs: Long) {
    synchronized(lock) {
      prefs(context).edit().putLong(identifier, atEpochMs).apply()
      rearm(context)
    }
  }

  /** Forgets `identifier` — its reminder was cancelled, so its pause must not fire. */
  fun cancel(context: Context, identifier: String) {
    synchronized(lock) {
      prefs(context).edit().remove(identifier).apply()
      rearm(context)
    }
  }

  /**
   * Acts on every due entry — at most one focus request however many are due at once — drops the
   * stale ones, and re-arms for whatever is left. This is what the alarm actually runs.
   */
  fun pauseDue(context: Context, now: Long) {
    var pause = false
    synchronized(lock) {
      val stored = prefs(context)
      val editor = stored.edit()
      for ((identifier, value) in stored.all) {
        val at = value as? Long
        if (at == null) {
          // Not something we wrote. Drop it rather than trip over it for ever.
          editor.remove(identifier)
          continue
        }
        if (at > now + DUE_GRACE_MS) continue
        editor.remove(identifier)
        // Due and fresh: this is the adhan's own minute (or near enough). Anything older missed
        // its moment and is silently dropped — see STALE_MS.
        if (now - at <= STALE_MS) pause = true
      }
      editor.apply()
      rearm(context)
    }
    if (pause) pauseOtherAudio(context)
  }

  /**
   * The pause itself. Skipped entirely when nothing is playing — requesting focus then would be
   * harmless but pointless, and "does nothing you could notice unless it has a job to do" is the
   * behaviour a background feature owes.
   */
  private fun pauseOtherAudio(context: Context) {
    try {
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      @Suppress("DEPRECATION")
      if (!audio.isMusicActive) return

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
              .build()
          )
          .build()
        if (audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
          // The abandon is politeness, not the mechanism: a permanent loss already told the
          // player to stop for good, and if the process dies before this runs the system
          // releases the focus of its dead client anyway.
          Handler(Looper.getMainLooper()).postDelayed({
            runCatching { audio.abandonAudioFocusRequest(request) }
          }, ABANDON_DELAY_MS)
        }
      } else {
        @Suppress("DEPRECATION")
        val listener = AudioManager.OnAudioFocusChangeListener { }
        @Suppress("DEPRECATION")
        val granted = audio.requestAudioFocus(
          listener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN
        )
        if (granted == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
          Handler(Looper.getMainLooper()).postDelayed({
            @Suppress("DEPRECATION")
            runCatching { audio.abandonAudioFocus(listener) }
          }, ABANDON_DELAY_MS)
        }
      }
    } catch (e: Exception) {
      // Someone's music not pausing is the better failure than anything louder.
      Log.e(LOG_TAG, "Could not take audio focus", e)
    }
  }

  /**
   * Points the single alarm at the earliest instant we still hold, or cancels it when there is
   * nothing left. Exact where allowed — see the class header. Always called with [lock] held.
   */
  private fun rearm(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pendingIntent = PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      Intent(context, AudioPauseReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    alarms.cancel(pendingIntent)

    val next = prefs(context).all.values.filterIsInstance<Long>().minOrNull() ?: return
    try {
      val exactAllowed =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
      if (exactAllowed) {
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent)
      } else {
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent)
      }
    } catch (e: SecurityException) {
      // The permission was revoked between the check and the set. Inexact still fires; a pause
      // that would land too late is dropped by pauseDue rather than delivered wrong.
      try {
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent)
      } catch (inner: Exception) {
        Log.e(LOG_TAG, "Could not arm the pause alarm", inner)
      }
    } catch (e: Exception) {
      // An OEM refusing the alarm must not take the caller down with it.
      Log.e(LOG_TAG, "Could not arm the pause alarm", e)
    }
  }

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
