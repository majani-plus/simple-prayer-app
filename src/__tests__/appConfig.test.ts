/**
 * The FOSS build switch (`FOSS_BUILD=1`, docs/BUILD_YOURSELF.md): it must strip every
 * third-party service, and the normal build must stay exactly as app.json says.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import appJson from '../../app.json';
import packageJson from '../../package.json';
import resolveConfig, { freeAdhanSounds, stripThirdPartyServices } from '../../app.config';
import { FREE_ADHAN_VOICE_ASSETS, FREE_ADHAN_VOICES } from '../domain/adhanVoices';

const config = appJson.expo as unknown as ExpoConfig;
const pluginNames = (c: ExpoConfig) => (c.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));

describe('app.config.ts', () => {
  const original = process.env.FOSS_BUILD;
  afterEach(() => {
    process.env.FOSS_BUILD = original;
  });

  it('passes app.json through untouched without the flag', () => {
    delete process.env.FOSS_BUILD;
    expect(resolveConfig({ config } as never)).toBe(config);
  });

  it('strips Sentry, RevenueCat, FCM and our EAS project with FOSS_BUILD=1', () => {
    process.env.FOSS_BUILD = '1';
    const foss = resolveConfig({ config } as never);
    expect(pluginNames(foss)).not.toContain('@sentry/react-native');
    expect(foss.extra?.sentryDsn).toBeUndefined();
    expect(foss.extra?.revenueCat).toBeUndefined();
    expect(foss.extra?.eas).toBeUndefined();
    expect(foss.android?.googleServicesFile).toBeUndefined();
    expect(foss.owner).toBeUndefined();
    expect(foss.updates?.url).toBeUndefined();
    expect(foss.updates?.enabled).toBe(false);
    // Everything else survives: the strip is surgical.
    expect(foss.android?.package).toBe(config.android?.package);
    expect(foss.android?.permissions).toEqual(config.android?.permissions);
    expect(foss.android?.blockedPermissions).toEqual(config.android?.blockedPermissions);
    expect(pluginNames(foss)).toEqual(
      pluginNames(config).filter(
        (name) =>
          !['@sentry/react-native', 'expo-location', './plugins/withWearApp'].includes(name ?? '')
      )
    );
  });

  it('drops the plugins of the libraries the FOSS build does not link', () => {
    const foss = stripThirdPartyServices(config);
    expect(pluginNames(config)).toEqual(
      expect.arrayContaining(['expo-location', './plugins/withWearApp'])
    );
    expect(pluginNames(foss)).not.toContain('expo-location');
    expect(pluginNames(foss)).not.toContain('./plugins/withWearApp');
  });

  it('gives the FOSS build exactly the free adhan sounds, and keeps the other options', () => {
    const notifications = (c: ExpoConfig) =>
      (c.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as [
        string,
        Record<string, unknown>,
      ];
    const [, options] = notifications(stripThirdPartyServices(config));
    const [, original] = notifications(config);
    expect(options.sounds).toEqual(freeAdhanSounds());
    expect({ ...options, sounds: undefined }).toEqual({ ...original, sounds: undefined });
    // The same files the free voice table names, and nothing else in that folder.
    expect((options.sounds as string[]).map((s) => s.split('/').pop()).sort()).toEqual(
      FREE_ADHAN_VOICES.map((voice) => FREE_ADHAN_VOICE_ASSETS[voice]?.full).sort()
    );
    expect(readdirSync(join(__dirname, '../../assets/audio/free')).sort()).toEqual(
      (options.sounds as string[]).map((s) => s.split('/').pop()).sort()
    );
  });

  it('keeps the notification sounds through resource shrinking, once', () => {
    const keep = './plugins/withKeepNotificationSounds';
    // app.json has it (the normal build needs it too); the FOSS config must not add a second.
    expect(pluginNames(config)).toContain(keep);
    expect(pluginNames(stripThirdPartyServices(config)).filter((n) => n === keep)).toHaveLength(1);
    const without = { ...config, plugins: (config.plugins ?? []).filter((p) => p !== keep) };
    expect(pluginNames(stripThirdPartyServices(without)).filter((n) => n === keep)).toHaveLength(1);
  });

  it('compresses native libraries in the FOSS APK only, keeping the other build options', () => {
    const buildProps = (c: ExpoConfig) =>
      (c.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-build-properties') as [
        string,
        { android?: Record<string, unknown> },
      ];
    const normal = buildProps(config)[1].android ?? {};
    const foss = buildProps(stripThirdPartyServices(config))[1].android ?? {};
    expect(normal.useLegacyPackaging).toBeUndefined();
    expect(foss).toEqual({ ...normal, useLegacyPackaging: true });
  });

  it('sets the FOSS versionCode from package.json, and the normal config has none', () => {
    expect(stripThirdPartyServices(config).android?.versionCode).toBe(packageJson.versionCode);
    expect(config.android?.versionCode).toBeUndefined();
  });

  /**
   * F-Droid shows `fastlane/metadata/android/<locale>/changelogs/<versionCode>.txt`, the same file
   * Play does, so the FOSS versionCode follows the Play one. The Play number is written down in the
   * newest changelog's name; adding one without moving package.json's `versionCode` fails here.
   */
  it('keeps package.json versionCode equal to the newest Play changelog', () => {
    const root = join(__dirname, '../../fastlane/metadata/android');
    const locales = readdirSync(root).filter((name) => existsSync(join(root, name, 'changelogs')));
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const codes = readdirSync(join(root, locale, 'changelogs')).map((f) => parseInt(f, 10));
      expect({ locale, newest: Math.max(...codes) }).toEqual({
        locale,
        newest: packageJson.versionCode,
      });
    }
  });

  it('leaves the input alone', () => {
    stripThirdPartyServices(config);
    expect(config.extra?.sentryDsn).toBeTruthy();
    expect(pluginNames(config)).toContain('@sentry/react-native');
  });
});
