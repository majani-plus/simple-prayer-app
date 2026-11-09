/**
 * Dynamic app config. `app.json` stays the source of truth; this file only edits it for a
 * FOSS build (`FOSS_BUILD=1`), which strips the third-party services so anyone can build the
 * app with no accounts or keys of ours, and which F-Droid can accept. See
 * docs/BUILD_YOURSELF.md. The native side of the FOSS build (which libraries are linked at all)
 * is `scripts/foss-prepare.ts`.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Plugins the FOSS build drops: Sentry, `expo-location` (replaced by `modules/foss-location`, which
 * needs no plugin; the coarse permission is already in `android.permissions`), and the Wear OS app,
 * whose watch sync needs Google Play services.
 */
const FOSS_DROPPED_PLUGINS = new Set([
  '@sentry/react-native',
  'expo-location',
  './plugins/withWearApp',
]);

/**
 * Keeps the adhan notification sounds through release resource shrinking (see the plugin). The
 * FOSS build adds it if app.json does not already have it.
 */
const KEEP_SOUNDS_PLUGIN = './plugins/withKeepNotificationSounds';

/** Where the free adhan recordings live; the FOSS build's notification sounds are exactly these. */
const FREE_AUDIO_DIR = 'assets/audio/free';

/** The FOSS build's notification sounds: every mp3 in {@link FREE_AUDIO_DIR}. */
export function freeAdhanSounds(root: string = __dirname): string[] {
  return readdirSync(join(root, FREE_AUDIO_DIR))
    .filter((file) => file.endsWith('.mp3'))
    .sort()
    .map((file) => `./${FREE_AUDIO_DIR}/${file}`);
}

/**
 * The Android versionCode the FOSS build ships, from `versionCode` in package.json.
 *
 * Kept equal to the Play versionCode of the same release, so F-Droid shows the same
 * `fastlane/metadata/android/<locale>/changelogs/<versionCode>.txt` as Play does. EAS owns the Play
 * counter remotely, so this number is set by hand when that changelog is written
 * (docs/RELEASE.md), and `appConfig.test.ts` fails if the two ever disagree. The normal build does
 * not read it.
 */
export function fossVersionCode(root: string = __dirname): number {
  const { versionCode } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    versionCode?: unknown;
  };
  if (typeof versionCode !== 'number') throw new Error('package.json has no numeric versionCode');
  return versionCode;
}

const pluginName = (plugin: NonNullable<ExpoConfig['plugins']>[number]) =>
  Array.isArray(plugin) ? plugin[0] : plugin;

/**
 * Makes the FOSS config: removes Sentry, RevenueCat, Firebase (FCM), our EAS project, Google's
 * location plugin and the Wear app, swaps the adhan notification sounds for the free set, and
 * keeps those sounds through resource shrinking.
 *
 * @param config - The config read from app.json.
 * @returns A copy with no Sentry plugin or DSN, no tip-jar keys, no google-services.json, no EAS
 *   owner, project ID or update URL (updates are switched off), the free adhan sounds, and the
 *   versionCode from package.json.
 */
export function stripThirdPartyServices(config: ExpoConfig): ExpoConfig {
  const { owner: _owner, ...rest } = config;
  const { revenueCat: _rc, sentryDsn: _dsn, eas: _eas, ...extra } = config.extra ?? {};
  const { googleServicesFile: _gs, ...android } = config.android ?? {};
  const { url: _url, ...updates } = config.updates ?? {};
  return {
    ...rest,
    android: { ...android, versionCode: fossVersionCode() },
    // Without our EAS project there is nowhere to fetch updates from.
    updates: { ...updates, enabled: false },
    extra,
    plugins: [
      ...(config.plugins ?? [])
        .filter((plugin) => !FOSS_DROPPED_PLUGINS.has(pluginName(plugin) ?? ''))
        .map((plugin): NonNullable<ExpoConfig['plugins']>[number] => {
          if (!Array.isArray(plugin)) return plugin;
          if (plugin[0] === 'expo-notifications') {
            return [plugin[0], { ...plugin[1], sounds: freeAdhanSounds() }];
          }
          // Compress native libraries. The FOSS APK is one file for every ABI (GitHub, website),
          // and stored uncompressed they made it ~134 MB. Play's bundle keeps the default.
          if (plugin[0] === 'expo-build-properties') {
            const options = plugin[1] ?? {};
            return [
              plugin[0],
              { ...options, android: { ...options.android, useLegacyPackaging: true } },
            ];
          }
          return plugin;
        }),
      ...((config.plugins ?? []).some((plugin) => pluginName(plugin) === KEEP_SOUNDS_PLUGIN)
        ? []
        : [KEEP_SOUNDS_PLUGIN]),
    ],
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  process.env.FOSS_BUILD === '1'
    ? stripThirdPartyServices(config as ExpoConfig)
    : (config as ExpoConfig);
