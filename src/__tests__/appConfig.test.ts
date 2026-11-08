/**
 * The FOSS build switch (`FOSS_BUILD=1`, docs/BUILD_YOURSELF.md): it must strip every
 * third-party service, and the normal build must stay exactly as app.json says.
 */
import type { ExpoConfig } from 'expo/config';

import appJson from '../../app.json';
import resolveConfig, { stripThirdPartyServices } from '../../app.config';

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
    expect(pluginNames(foss)).toHaveLength(pluginNames(config).length - 1);
  });

  it('leaves the input alone', () => {
    stripThirdPartyServices(config);
    expect(config.extra?.sentryDsn).toBeTruthy();
    expect(pluginNames(config)).toContain('@sentry/react-native');
  });
});
