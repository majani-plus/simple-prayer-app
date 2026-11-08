/**
 * `useAdhanPreview` — plays one of the bundled adhan recitations on demand, and stops it the moment
 * the user stops looking.
 *
 * ## Why this exists
 *
 * Someone choosing between "device sound" and "the adhan" — and then between four recitations —
 * cannot make that choice without hearing it, and being *sent a notification* to find out is a
 * strange thing to have happen (owner, 2026-08-20: "I'd like a way test the adhan in the settings,
 * so people can see what it sounds like"). So the recitation plays in the app, from a control that
 * says what it is doing.
 *
 * ## The preview is the same file the reminder will use
 *
 * Not "a preview of the adhan": *the* file. {@link adhanSoundFile} decides which one, and the
 * notification service asks the same function the same question, so the two cannot drift. That
 * matters because the two platforms get different files — iOS the `.caf` clip, Android the full
 * `.mp3` — and a three-minute preview on a phone that will only ever ring for 28 seconds would be
 * a lie about what the user is choosing. On an iPhone the preview ends on the same fade the
 * notification will.
 *
 * ## What this is NOT
 *
 * It is **not** a test of whether reminders work. The preview is media the user asked for, so it
 * plays through the silent switch (see below); a notification is an alert, and does not. Somebody
 * who hears the preview has learned what the adhan sounds like, and nothing at all about whether
 * their phone will make a sound at Fajr — that is what "send a test notification" is for, and the
 * two controls are worded to stay apart.
 *
 * ## One player, therefore one voice
 *
 * There is exactly one `AudioPlayer` for the whole screen and switching recitation `replace()`s its
 * source. Two overlapping adhans is the worst thing this hook could do, and this is why it cannot:
 * it is not a rule enforced by careful calling, it is the absence of a second player.
 *
 * ## Stopping — three layers, deliberately overlapping
 *
 * Half a minute of adhan still playing from an app the user thought they had left is the failure to
 * avoid — three minutes of it on Android, which is worse — and it is bad enough to be worth belt,
 * braces and a second belt:
 *
 * 1. **The audio session itself.** `enableBackgroundPlayback: false` in the `expo-audio` config
 *    plugin (app.json) means the binary declares no `audio` background mode on iOS and no media
 *    foreground service on Android, and `shouldPlayInBackground: false` says the same at runtime.
 *    The OS therefore suspends playback when the app leaves the foreground **whether or not any
 *    JavaScript runs** — this is the layer that cannot be missed.
 * 2. **`AppState`.** Any change out of `active` — backgrounding, the app switcher, the screen
 *    locking, a call arriving — stops and rewinds, so returning to the app finds it idle rather
 *    than paused mid-adhan (owner: "navigating away from the app should also stop the sound").
 * 3. **Unmount.** Leaving the screen stops it; `useAudioPlayer` also releases the player for us.
 *
 * ## The silent switch
 *
 * `playsInSilentMode: true`. A user who has pressed a play button has asked for sound in as many
 * words, and iOS's own convention is that the ringer switch governs *alerts* — ringtones,
 * notifications — not media a person started deliberately. Muting it would make the one control
 * whose entire job is "let me hear this" fail silently, which reads as a broken app. The cost is
 * that the preview cannot double as proof that reminders are audible; the reminders screen says
 * so, and the delivery warning on the test-notification row covers that ground instead.
 *
 * Dependency rule: `hooks → services + domain`. No user-facing strings live here — the screen owns
 * the words, this owns the behaviour.
 */

import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { setAdhanPlaying } from '@/services/adhanPlayback';
import { DEFAULT_ADHAN_VOICE, adhanSoundFile, type SoundPlatform } from '@/domain/adhanVoices';

import type { AdhanVoice } from '@/domain/types';

/**
 * Every bundled recitation, keyed by the base filename {@link adhanSoundFile} returns.
 *
 * Written out one `require` at a time because Metro resolves asset paths statically — a computed
 * path bundles nothing and fails at runtime with a module that "cannot be found" on a device only.
 * `useAdhanPreview.test.ts` checks this table against {@link allAdhanSoundFiles}, so adding a
 * recitation to `domain/adhanVoices` without adding it here fails in CI rather than on a phone.
 *
 * The same eight files are listed in **app.json** under the `expo-notifications` plugin, which is
 * what makes them notification sounds; this table is what makes them playable in-app. Both are
 * needed, and they are the only two places these filenames appear.
 */
const ADHAN_ASSETS: Readonly<Record<string, number>> = Object.freeze({
  'adhan_makkah.mp3': require('../../assets/audio/adhan_makkah.mp3') as number,
  'adhan_makkah_clip.caf': require('../../assets/audio/adhan_makkah_clip.caf') as number,
  'adhan_alqatami.mp3': require('../../assets/audio/adhan_alqatami.mp3') as number,
  'adhan_alqatami_clip.caf': require('../../assets/audio/adhan_alqatami_clip.caf') as number,
  'adhan_menk.mp3': require('../../assets/audio/adhan_menk.mp3') as number,
  'adhan_menk_clip.caf': require('../../assets/audio/adhan_menk_clip.caf') as number,
  'adhan_fakhry.mp3': require('../../assets/audio/adhan_fakhry.mp3') as number,
  'adhan_fakhry_clip.caf': require('../../assets/audio/adhan_fakhry_clip.caf') as number,
});

/** Where this build is running, in the terms `domain/adhanVoices` speaks. */
function currentPlatform(): SoundPlatform {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
}

/** The bundled asset a voice plays here — the same file its notification will use. */
function assetFor(voice: AdhanVoice): number {
  return ADHAN_ASSETS[adhanSoundFile(voice, currentPlatform())];
}

/** What the screen needs to draw the control and drive it. */
export interface AdhanPreview {
  /** The recitation sounding right now, or `null` when nothing is. */
  playing: AdhanVoice | null;
  /**
   * Starts a recitation from the beginning — or stops it, if that same one is already sounding.
   * Pressing a *different* voice while one plays switches to it rather than layering.
   */
  toggle: (voice: AdhanVoice) => void;
  /** Stops and rewinds. Safe to call when nothing is playing. */
  stop: () => void;
}

/**
 * Owns the one preview player on a screen.
 *
 * Call it **once** per screen: the player is a native resource, and two of them would let the user
 * start two adhans over each other.
 *
 * @returns The playing recitation and the two controls. See {@link AdhanPreview}.
 */
export function useAdhanPreview(): AdhanPreview {
  const player = useAudioPlayer(assetFor(DEFAULT_ADHAN_VOICE));
  const status = useAudioPlayerStatus(player);

  /** Which recitation the user last asked for; `null` once anything has stopped it. */
  const [requested, setRequested] = useState<AdhanVoice | null>(null);
  // Both halves have to agree: the state alone would keep saying "playing" after the recitation
  // reached its end on its own, and the status alone cannot say *which* one is sounding.
  const playing = status?.playing === true ? requested : null;

  // `player` is stable for the life of the component, but reading it through a ref keeps the
  // callbacks below out of every effect's dependency list — and keeps `stop` safe to call from a
  // listener that fires after an unmount has begun. Assigned in an effect, never during render.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  /** The source currently loaded, so a repeat press does not pay for a needless `replace`. */
  const loadedRef = useRef<AdhanVoice>(DEFAULT_ADHAN_VOICE);

  const stop = useCallback(() => {
    setRequested(null);
    try {
      playerRef.current.pause();
      // Rewind, so the next press starts at the takbir rather than wherever it was abandoned.
      playerRef.current.seekTo(0);
    } catch {
      // A player already released by unmount throws; there is nothing left to stop.
    }
  }, []);

  const toggle = useCallback(
    (voice: AdhanVoice) => {
      // A second press on the recitation that is sounding means "enough".
      if (playerRef.current.playing && loadedRef.current === voice) {
        stop();
        return;
      }
      // Claimed before the await so the row marks itself immediately; cleared again if the audio
      // route turns out not to exist.
      setRequested(voice);
      void (async () => {
        try {
          // Set every time rather than once at mount: another part of the app (or another app)
          // may have moved the shared audio session since, and the preview must not inherit it.
          await setAudioModeAsync({
            playsInSilentMode: true,
            // The OS-level half of "leaving the app stops the sound" — see the module header.
            shouldPlayInBackground: false,
            // Lower whatever else is playing rather than stopping it: a preview is not important
            // enough to end somebody's podcast.
            interruptionMode: 'duckOthers',
          });
          if (loadedRef.current !== voice) {
            // Replacing the source is also what stops the outgoing recitation — there is one
            // player, so switching voices cannot leave two of them sounding at once.
            playerRef.current.replace(assetFor(voice));
            loadedRef.current = voice;
          }
          playerRef.current.seekTo(0);
          playerRef.current.play();
        } catch {
          // No audio route, or a player released mid-press. Nothing plays and nothing breaks; the
          // row simply goes back to offering to play.
          setRequested(null);
        }
      })();
    },
    [stop]
  );

  // The review prompt's "never while the adhan is playing" exclusion (PRODUCT_SPEC §13) reads a
  // module-scoped flag rather than this state, because it is mounted above the tabs while this
  // hook lives on one settings screen. Mirroring it here rather than inside `stop`/`toggle` is
  // what makes it total: `playing` is derived from the player's own status, so a recitation that
  // simply reaches its end clears the flag too, and so does the cleanup on unmount.
  useEffect(() => {
    setAdhanPlaying(playing !== null);
    return () => {
      setAdhanPlaying(false);
    };
  }, [playing]);

  // Layer 2: anything that takes the app out of the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stop();
    });
    return () => subscription.remove();
  }, [stop]);

  // Layer 3: leaving the screen. `useAudioPlayer` releases the player after this runs.
  useEffect(() => stop, [stop]);

  return { playing, toggle, stop };
}
