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
  /** The opening, faded out. iOS's notification sound, and in-app playback there. */
  clip: string;
  /** Length of {@link AdhanVoiceAssets.clip} in seconds — checked against {@link IOS_SOUND_LIMIT_SECONDS}. */
  clipSeconds: number;
}

/**
 * Apple's hard limit on a notification sound. Longer than this and iOS plays the *default* sound
 * instead — silently, with no error anywhere. Every clip below is trimmed to sit under it, and
 * `adhanVoices.test.ts` fails if one ever is not.
 */
export const IOS_SOUND_LIMIT_SECONDS = 30;

/**
 * The voices, in the order they are offered. Makkah leads because it is the recitation most people
 * recognise, and it is the default.
 */
export const ADHAN_VOICES = ['makkah', 'alqatami', 'menk', 'fakhry'] as const;

/**
 * The voice a fresh install uses, and the fallback for anything unreadable in storage.
 *
 * Makkah rather than "the first one alphabetically": it is the recitation from the Haram, which is
 * the one a user is most likely to have heard before, and choosing a named individual as the
 * default would read as a recommendation the app has no business making.
 */
export const DEFAULT_ADHAN_VOICE: AdhanVoice = 'makkah';

/** What each voice ships as. Lengths from `assets/audio/CREDITS.md`. */
export const ADHAN_VOICE_ASSETS: Readonly<Record<AdhanVoice, AdhanVoiceAssets>> = Object.freeze({
  makkah: { full: 'adhan_makkah.mp3', clip: 'adhan_makkah_clip.caf', clipSeconds: 28 },
  alqatami: { full: 'adhan_alqatami.mp3', clip: 'adhan_alqatami_clip.caf', clipSeconds: 27 },
  menk: { full: 'adhan_menk.mp3', clip: 'adhan_menk_clip.caf', clipSeconds: 28 },
  fakhry: { full: 'adhan_fakhry.mp3', clip: 'adhan_fakhry_clip.caf', clipSeconds: 28 },
});

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
  const assets = ADHAN_VOICE_ASSETS[voice];
  return platform === 'ios' ? assets.clip : assets.full;
}

/** Every filename this module can ever return — what the asset table in the preview must cover. */
export function allAdhanSoundFiles(): string[] {
  return ADHAN_VOICES.flatMap((voice) => [
    ADHAN_VOICE_ASSETS[voice].full,
    ADHAN_VOICE_ASSETS[voice].clip,
  ]);
}
