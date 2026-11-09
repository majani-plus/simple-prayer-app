/**
 * FOSS build: the free adhan recordings `useAdhanPreview` can play. Replaces
 * `src/hooks/adhanAssets.ts` (metro.config.js), so the FOSS app bundles only these. One `require`
 * per file, because Metro resolves asset paths statically.
 */
export const ADHAN_ASSETS: Readonly<Record<string, number>> = Object.freeze({
  'adhan_free_makkah.mp3': require('../../assets/audio/free/adhan_free_makkah.mp3') as number,
  'adhan_free_istanbul.mp3': require('../../assets/audio/free/adhan_free_istanbul.mp3') as number,
  'adhan_free_beautiful.mp3': require('../../assets/audio/free/adhan_free_beautiful.mp3') as number,
});
