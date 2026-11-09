/**
 * Every bundled recitation `useAdhanPreview` can play, keyed by the base filename
 * `domain/adhanVoices.adhanSoundFile` returns.
 *
 * Written out one `require` at a time because Metro resolves asset paths statically — a computed
 * path bundles nothing and fails at runtime with a module that "cannot be found" on a device only.
 * `useAdhanPreview.test.ts` checks this table against `allAdhanSoundFiles()`, so adding a
 * recitation to `domain/adhanVoices` without adding it here fails in CI rather than on a phone.
 *
 * The same eight files are listed in **app.json** under the `expo-notifications` plugin, which is
 * what makes them notification sounds; this table is what makes them playable in-app. Both are
 * needed, and they are the only two places these filenames appear.
 *
 * The FOSS build swaps this file for `src/foss/adhanAssets.ts` (metro.config.js), so it bundles the
 * free recordings and none of these.
 */
export const ADHAN_ASSETS: Readonly<Record<string, number>> = Object.freeze({
  'adhan_makkah.mp3': require('../../assets/audio/adhan_makkah.mp3') as number,
  'adhan_makkah_clip.caf': require('../../assets/audio/adhan_makkah_clip.caf') as number,
  'adhan_alqatami.mp3': require('../../assets/audio/adhan_alqatami.mp3') as number,
  'adhan_alqatami_clip.caf': require('../../assets/audio/adhan_alqatami_clip.caf') as number,
  'adhan_menk.mp3': require('../../assets/audio/adhan_menk.mp3') as number,
  'adhan_menk_clip.caf': require('../../assets/audio/adhan_menk_clip.caf') as number,
  'adhan_fakhry.mp3': require('../../assets/audio/adhan_fakhry.mp3') as number,
  'adhan_fakhry_clip.caf': require('../../assets/audio/adhan_fakhry_clip.caf') as number,
});
