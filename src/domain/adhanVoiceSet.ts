/**
 * Which adhan voice set this build ships: `standard` here.
 *
 * The FOSS build (`FOSS_BUILD=1`) swaps this file for `src/foss/adhanVoiceSet.ts`, which says
 * `free`, and swaps `hooks/adhanAssets` the same way (metro.config.js). That is the whole switch:
 * `domain/adhanVoices` reads this value, and nothing else changes in the normal build.
 */
export const ADHAN_VOICE_SET: 'standard' | 'free' = 'standard';
