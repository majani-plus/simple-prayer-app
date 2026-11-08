/**
 * Guards on the notification sounds declared in `app.json`.
 *
 * These exist because the failure they catch is invisible locally and only appears four minutes
 * into a remote Android build. `expo-notifications`' config plugin copies every file in its
 * `sounds` array to BOTH platforms: into the Xcode project on iOS, and into
 * `android/app/src/main/res/raw` on Android. Android then derives a resource name from each
 * file — and a resource name is the filename **without its extension**.
 *
 * So `adhan_makkah.caf` and `adhan_makkah.mp3` — two different files, one per platform, exactly
 * as the two playback paths need — both become `raw/adhan_makkah`, and `mergeReleaseResources`
 * fails with "Duplicate resources". Nothing about that is visible in a JS test, a typecheck, an
 * iOS build or `expo-doctor`; it cost a full EAS build to discover. Hence the distinct `_clip`
 * stem on the iOS files, and hence this test.
 *
 * The second guard is the older one: Android resource names must be lowercase alphanumeric with
 * underscores. A hyphen is a build error too, with an equally unhelpful message.
 */

import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import appJson from '../../app.json';
import { adhanSoundFile, ADHAN_VOICES, allAdhanSoundFiles } from '../domain/adhanVoices';

const ROOT = resolve(__dirname, '..', '..');

function declaredSounds(): string[] {
  const plugins = appJson.expo.plugins as unknown[];
  for (const plugin of plugins) {
    if (!Array.isArray(plugin)) continue;
    const [name, options] = plugin as [string, Record<string, unknown> | undefined];
    if (name !== 'expo-notifications') continue;
    const sounds = options?.sounds;
    if (Array.isArray(sounds)) return sounds as string[];
  }
  throw new Error('expo-notifications is not configured with a sounds array in app.json');
}

describe('bundled notification sounds', () => {
  const sounds = declaredSounds();

  it('declares at least one sound', () => {
    expect(sounds.length).toBeGreaterThan(0);
  });

  it('every declared file exists on disk', () => {
    for (const soundPath of sounds) {
      expect({ soundPath, exists: existsSync(join(ROOT, soundPath)) }).toEqual({
        soundPath,
        exists: true,
      });
    }
  });

  /**
   * The one that cost an EAS build. Android's resource name is the stem, so two files that
   * differ only by extension collide, however sensible the pair is on the JS side.
   */
  it('no two sounds share a filename stem, which Android would merge into one resource', () => {
    const byStem = new Map<string, string[]>();
    for (const soundPath of sounds) {
      const file = basename(soundPath);
      const stem = basename(file, extname(file));
      byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
    }
    const collisions = [...byStem.entries()].filter(([, files]) => files.length > 1);
    expect(collisions).toEqual([]);
  });

  it('every stem is a legal Android resource name: lowercase, alphanumeric, underscores', () => {
    for (const soundPath of sounds) {
      const file = basename(soundPath);
      const stem = basename(file, extname(file));
      expect({ stem, legal: /^[a-z][a-z0-9_]*$/.test(stem) }).toEqual({ stem, legal: true });
    }
  });

  /** Every file the voice table can name has to be a file the build actually ships. */
  it('covers every filename the adhan voice table can resolve to', () => {
    const declared = new Set(sounds.map((s) => basename(s)));
    for (const file of allAdhanSoundFiles()) {
      expect({ file, declared: declared.has(file) }).toEqual({ file, declared: true });
    }
  });
});

/**
 * Android plays a channel's sound from `res/raw`, and `res/raw` holds BOTH files for every voice
 * — the `.mp3` Android needs and the `.caf` clip iOS needs, because the config plugin copies
 * every declared sound to both platforms.
 *
 * That makes a wrong filename silent rather than loud: `adhan_makkah_clip` is a real resource on
 * Android, so `SoundResolver` resolves it happily and hands the OS a CAF that Android's media
 * stack cannot decode. No error, no fallback — just a reminder that arrives without a sound. And
 * because a channel's sound is frozen at creation, it would stay that way until CHANNEL_VERSION
 * moved.
 */
describe('per-platform adhan sound resolution', () => {
  it('gives Android the mp3 and iOS the caf, for every voice', () => {
    for (const voice of ADHAN_VOICES) {
      expect({ voice, android: adhanSoundFile(voice, 'android') }).toEqual({
        voice,
        android: `adhan_${voice === 'fakhry' ? 'fakhry' : voice}.mp3`,
      });
      expect(adhanSoundFile(voice, 'ios').endsWith('.caf')).toBe(true);
    }
  });

  it('never hands Android a container it cannot decode', () => {
    for (const voice of ADHAN_VOICES) {
      for (const platform of ['android', 'other'] as const) {
        expect({ voice, platform, file: adhanSoundFile(voice, platform) }).toEqual({
          voice,
          platform,
          file: expect.stringMatching(/\.mp3$/) as unknown as string,
        });
      }
    }
  });
});
