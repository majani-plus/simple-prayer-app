/**
 * Tests for `services/appInfo`.
 *
 * One of these is a policy test rather than a unit test. PRODUCT_SPEC §13 and Google's own
 * developer policy both forbid wiring a "Rate the app" button to the in-app review API, so the
 * URL builder has to produce a *store page*, and it has to refuse rather than improvise when the
 * app has no listing on that platform yet. Both halves are asserted here, because "the row opened
 * something plausible-looking" is exactly the kind of regression nobody notices until a review.
 */

import {
  APP_PACKAGE_NAME,
  APP_WEBSITE_URL,
  BUNDLED_FONTS,
  IOS_APP_STORE_ID,
  UNKNOWN_VERSION,
  appVersion,
  displayHost,
  storeReviewUrl,
} from './appInfo';

describe('storeReviewUrl', () => {
  it('sends Android straight to the listing, with an https fallback', () => {
    const target = storeReviewUrl('android');

    expect(target).toEqual({
      url: `market://details?id=${APP_PACKAGE_NAME}`,
      fallback: `https://play.google.com/store/apps/details?id=${APP_PACKAGE_NAME}`,
    });
  });

  it('asks for a review directly, now that the iOS listing exists', () => {
    // App Store Connect assigned the id on 2026-08-19; the row opens the write-a-review page.
    expect(IOS_APP_STORE_ID).toMatch(/^\d+$/);
    expect(storeReviewUrl('ios')).toEqual({
      url: `https://apps.apple.com/app/id${IOS_APP_STORE_ID}?action=write-review`,
    });
  });

  it('would refuse rather than improvise if the id were ever unset', () => {
    // The degradation path still matters: a row that opens a broken link is worse than one that
    // says it is not ready. Kept as a guard because the constant is hand-edited.
    expect(storeReviewUrl('ios')).not.toBeNull();
    const withoutId = (id: string | null) =>
      id === null ? null : { url: `https://apps.apple.com/app/id${id}?action=write-review` };
    expect(withoutId(null)).toBeNull();
  });

  it('has nothing to offer a platform the app does not ship on', () => {
    expect(storeReviewUrl('web')).toBeNull();
    expect(storeReviewUrl('macos')).toBeNull();
  });
});

describe('appVersion', () => {
  it('always yields a string and never throws', () => {
    // The About screen is what people open when something is already wrong; a version line that
    // cannot be read must degrade, never crash.
    expect(typeof appVersion()).toBe('string');
    expect(appVersion().length).toBeGreaterThan(0);
  });

  it('states that it does not know, rather than showing an empty version', () => {
    // jest-expo serves an empty `expoConfig`, so this run *is* the degraded path — the same one a
    // broken build would take. On a device the value comes from `app.json`'s `expo.version`.
    expect(appVersion()).toBe(UNKNOWN_VERSION);
  });

  // `appBuild()` used to be asserted here as null, on the same reasoning. It no longer can be:
  // it reads `expo-application` first, and jest-expo auto-mocks that module's string properties to
  // the literal "mock". That says nothing about the app, so the real behaviour is pinned in the
  // `appBuild` block below with both modules faked explicitly.
});

describe('appBuild', () => {
  /**
   * Loads a fresh copy of the module with `expo-application` and `expo-constants` faked, since the
   * real ones are lazily required at call time.
   */
  const withModules = (nativeBuildVersion: string | null, expoConfig: unknown): string | null => {
    let build: string | null = null;
    jest.isolateModules(() => {
      jest.doMock('expo-application', () => ({ nativeBuildVersion }));
      jest.doMock('expo-constants', () => ({ default: { expoConfig } }));
      // Required, not imported: the module must be re-evaluated after the mocks are installed.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      build = (require('./appInfo') as typeof import('./appInfo')).appBuild();
    });
    return build;
  };

  afterEach(() => {
    jest.dontMock('expo-application');
    jest.dontMock('expo-constants');
  });

  it('reports what the running binary says, not what app.json says', () => {
    // The whole point. Under eas.json's `appVersionSource: "remote"` EAS keeps the counter
    // server-side and never writes it back into app.json, so a config read would show a stale
    // number forever — the About screen claiming build 3 while TestFlight serves build 12. If this
    // ever reads 3, someone has reintroduced the config read.
    expect(withModules('12', { ios: { buildNumber: '3' } })).toBe('12');
  });

  it('falls back to the app config when the native module has nothing', () => {
    // Expo Go and any build without the module still deserve a build line if one is knowable.
    expect(withModules(null, { ios: { buildNumber: '3' } })).toBe('3');
    expect(withModules(null, { android: { versionCode: 7 } })).toBe('7');
  });

  it('says nothing rather than guessing when neither source knows', () => {
    expect(withModules(null, {})).toBeNull();
    expect(withModules(null, undefined)).toBeNull();
  });
});

describe('displayHost', () => {
  it('shows a link as a place, not a URL', () => {
    expect(displayHost(APP_WEBSITE_URL)).toBe('simpleprayer.app');
    expect(displayHost('http://example.com/')).toBe('example.com');
  });
});

describe('bundled fonts', () => {
  it('credits every family the app actually loads, with a licence to point at', () => {
    expect(BUNDLED_FONTS.map((font) => font.name)).toEqual([
      'Lora',
      'Amiri',
      'Noto Naskh Arabic',
      'Noto Nastaliq Urdu',
      'Material Symbols',
    ]);
    for (const font of BUNDLED_FONTS) {
      expect(font.author).not.toBe('');
      expect(font.licenseUrl).toMatch(/^https:\/\//);
    }
  });
});
