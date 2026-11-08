/**
 * Dynamic app config. `app.json` stays the source of truth; this file only edits it for a
 * FOSS build (`FOSS_BUILD=1`), which strips the three third-party services so anyone can
 * build the app with no accounts or keys of ours. See docs/BUILD_YOURSELF.md.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Removes Sentry, RevenueCat, Firebase (FCM) and our EAS project from a config.
 *
 * @param config - The config read from app.json.
 * @returns A copy with no Sentry plugin or DSN, no tip-jar keys, no google-services.json,
 *   and no EAS owner, project ID or update URL (updates are switched off).
 */
export function stripThirdPartyServices(config: ExpoConfig): ExpoConfig {
  const { owner: _owner, ...rest } = config;
  const { revenueCat: _rc, sentryDsn: _dsn, eas: _eas, ...extra } = config.extra ?? {};
  const { googleServicesFile: _gs, ...android } = config.android ?? {};
  const { url: _url, ...updates } = config.updates ?? {};
  return {
    ...rest,
    android,
    // Without our EAS project there is nowhere to fetch updates from.
    updates: { ...updates, enabled: false },
    extra,
    plugins: (config.plugins ?? []).filter(
      (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== '@sentry/react-native'
    ),
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  process.env.FOSS_BUILD === '1'
    ? stripThirdPartyServices(config as ExpoConfig)
    : (config as ExpoConfig);
