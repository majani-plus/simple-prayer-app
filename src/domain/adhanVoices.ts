/**
 * The adhan recitations the app ships, and the one rule that governs which file plays where.
 *
 * ## Why there are two files per voice, and why that is not a preference
 *
 * A notification sound is not a media file the app plays; it is a filename handed to the OS, and
 * the two platforms accept different things:
 *
 * - **iOS caps a notification sound at 30 seconds.** Over the cap it silently substitutes the
 *   *default* sound — no error, no warning, nothing in a log. It also accepts only Linear PCM,
 *   MA4/IMA4, µLaw or aLaw in `.aiff`/`.wav`/`.caf`. So iOS gets the `.caf` clip: the opening of
 *   the adhan, ending on a fade, under the cap with room to spare.
 * - **Android has no such rule.** Its channel sound is the whole recitation, as an `.mp3`.
 *
 * So an iPhone user hears about half a minute; an Android user hears all of it. That asymmetry is
 * stated to the user rather than hidden (`settings.reminders.voice.iosNote`, iOS only) — it is
 * Apple's limit, not a missing feature, and the copy says which.
 *
 * {@link adhanSoundFile} is the single place that decision lives. The notification service uses it
 * to name the sound it schedules; `hooks/useAdhanPreview` uses it to pick the asset it plays, which
 * is what makes the preview honest: **the preview is the same file the reminder will use.** A
 * preview that played three minutes on a phone that will only ever ring for 28 seconds would be a
 * lie, and one shared resolver is what stops the two drifting apart.
 *
 * ## Filenames are load-bearing
 *
 * Android turns each bundled sound into a resource name, which must be lowercase alphanumeric with
 * underscores — hence `adhan_makkah`, never `adhan-makkah`. Renaming one with a hyphen fails the
 * Android build. `assets/audio/CREDITS.md` says the same thing, and is the reference for anything
 * about the recordings themselves: provenance, processing, and what was trimmed from each.
 *
 * ## What is not here
 *
 * The reciters' **names**. They are proper nouns, and they live in the locale files rather than in
 * this table for one reason: three of the four are Arabic names with a real Arabic spelling, so the
 * Arabic bundle renders "ناصر القطامي" where English and Turkish render "Nasser Alqatami". That is
 * the same name written properly, not a translation of it.
 *
 * Dependency rule: pure TypeScript. No React, no React Native, no `expo-*`; the platform is a
 * parameter, never something this module reads for itself.
 */

import { ADHAN_VOICE_SET } from './adhanVoiceSet';
import type { AdhanVoice } from './types';

/**
 * The platforms a sound has to be resolved for. Mirrors `NotificationAdapter['platform']` so the
 * service can pass its own value straight through; `other` (web, and anything without local
 * notifications) is resolved as Android would be, since nothing there enforces Apple's cap.
 */
export type SoundPlatform = 'ios' | 'android' | 'other';

/** The bundled files for one voice, and what is known about the clip's length. */
export interface AdhanVoiceAssets {
  /** Full recitation. Android's channel sound, and in-app playback there. */
  full: string;
  /**
   * The opening, faded out. iOS's notification sound, and in-app playback there. Absent only in the
   * free set, which ships in the Android-only FOSS build.
   */
  clip?: string;
  /** Length of {@link AdhanVoiceAssets.clip} in seconds — checked against {@link IOS_SOUND_LIMIT_SECONDS}. */
  clipSeconds?: number;
}

/**
 * Apple's hard limit on a notification sound. Longer than this and iOS plays the *default* sound
 * instead — silently, with no error anywhere. Every clip below is trimmed to sit under it, and
 * `adhanVoices.test.ts` fails if one ever is not.
 */
export const IOS_SOUND_LIMIT_SECONDS = 30;

/**
 * The voices the normal build offers, in order. Makkah leads because it is the recitation most
 * people recognise, and it is the default.
 */
export const STANDARD_ADHAN_VOICES: readonly AdhanVoice[] = [
  'makkah',
  'alqatami',
  'menk',
  'fakhry',
];

/**
 * The voices the FOSS build offers instead: recordings from Wikimedia Commons under CC0 or CC BY,
 * because F-Droid accepts only free media and the standard four have no licence we could find
 * (`assets/audio/CREDITS.md`). Android only, so mp3 only, with no iOS clip.
 */
export const FREE_ADHAN_VOICES: readonly AdhanVoice[] = ['makkah', 'istanbul', 'beautiful'];

/**
 * The voices this build offers. Which set is decided by `domain/adhanVoiceSet`, which the FOSS
 * build swaps for `src/foss/adhanVoiceSet` (metro.config.js), together with the asset table in
 * `hooks/adhanAssets`.
 */
export const ADHAN_VOICES: readonly AdhanVoice[] =
  ADHAN_VOICE_SET === 'free' ? FREE_ADHAN_VOICES : STANDARD_ADHAN_VOICES;

/**
 * The voice a fresh install uses, and the fallback for anything unreadable in storage.
 *
 * Makkah rather than "the first one alphabetically": it is the recitation from the Haram, which is
 * the one a user is most likely to have heard before, and choosing a named individual as the
 * default would read as a recommendation the app has no business making.
 */
export const DEFAULT_ADHAN_VOICE: AdhanVoice = 'makkah';

/** What each standard voice ships as. Lengths from `assets/audio/CREDITS.md`. */
export const STANDARD_ADHAN_VOICE_ASSETS: Readonly<Partial<Record<AdhanVoice, AdhanVoiceAssets>>> =
  Object.freeze({
    makkah: { full: 'adhan_makkah.mp3', clip: 'adhan_makkah_clip.caf', clipSeconds: 28 },
    alqatami: { full: 'adhan_alqatami.mp3', clip: 'adhan_alqatami_clip.caf', clipSeconds: 27 },
    menk: { full: 'adhan_menk.mp3', clip: 'adhan_menk_clip.caf', clipSeconds: 28 },
    fakhry: { full: 'adhan_fakhry.mp3', clip: 'adhan_fakhry_clip.caf', clipSeconds: 28 },
  });

/** What each free voice ships as, from `assets/audio/free/`. */
export const FREE_ADHAN_VOICE_ASSETS: Readonly<Partial<Record<AdhanVoice, AdhanVoiceAssets>>> =
  Object.freeze({
    makkah: { full: 'adhan_free_makkah.mp3' },
    istanbul: { full: 'adhan_free_istanbul.mp3' },
    beautiful: { full: 'adhan_free_beautiful.mp3' },
  });

/** What each voice of this build ships as. */
export const ADHAN_VOICE_ASSETS =
  ADHAN_VOICE_SET === 'free' ? FREE_ADHAN_VOICE_ASSETS : STANDARD_ADHAN_VOICE_ASSETS;

/** A voice this build does not ship falls back to the default, so a lookup can never miss. */
function assetsOf(voice: AdhanVoice): AdhanVoiceAssets {
  return ADHAN_VOICE_ASSETS[voice] ?? (ADHAN_VOICE_ASSETS[DEFAULT_ADHAN_VOICE] as AdhanVoiceAssets);
}

/**
 * Narrows an untrusted value to an {@link AdhanVoice}.
 *
 * @param value - Anything: a value read back from storage, a channel id fragment, `undefined`.
 * @returns `true` when it names one of the shipped voices.
 */
export function isAdhanVoice(value: unknown): value is AdhanVoice {
  return typeof value === 'string' && (ADHAN_VOICES as readonly string[]).includes(value);
}

/**
 * The bundled file a voice plays on a given platform — **the one place the iOS/Android split is
 * decided**, and the reason the preview and the reminder can never disagree.
 *
 * The return value is a *base filename*, which is all both platform APIs accept: it resolves only
 * because `app.json` lists every one of these in the `expo-notifications` plugin's `sounds` array,
 * which copies them into the iOS bundle and into Android's `res/raw` at prebuild time.
 *
 * @param voice - The chosen recitation.
 * @param platform - Where it is going to be heard.
 * @returns `adhan_menk_clip.caf` on iOS, `adhan_menk.mp3` everywhere else.
 */
export function adhanSoundFile(voice: AdhanVoice, platform: SoundPlatform): string {
  const assets = assetsOf(voice);
  return platform === 'ios' && assets.clip !== undefined ? assets.clip : assets.full;
}

/** Every filename this module can ever return — what the asset table in the preview must cover. */
export function allAdhanSoundFiles(): string[] {
  return ADHAN_VOICES.flatMap((voice) => {
    const { full, clip } = assetsOf(voice);
    return clip === undefined ? [full] : [full, clip];
  });
}
