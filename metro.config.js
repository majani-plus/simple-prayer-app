// Metro config — Expo defaults plus `.sql` as a source extension so the generated
// Drizzle migration files can be imported (and inlined by babel-plugin-inline-import).
//
// `getSentryExpoConfig` wraps `expo/metro-config`'s `getDefaultConfig` unchanged and adds the
// Sentry serializer, which stamps a Debug ID into release bundles and source maps. That stamp is
// what lets Sentry match a crash's minified frames to the source map uploaded at build time
// (docs/RELEASE.md §11) — without it, release stack traces stay unreadable. It affects bundling
// only; nothing about the dev server or Jest changes.
//
// The FOSS build (`FOSS_BUILD=1`, docs/BUILD_YOURSELF.md) has no Sentry, so it uses plain
// `getDefaultConfig`, and it swaps the packages whose native side `scripts/foss-prepare.ts` leaves
// out for inert stand-ins in `src/foss/`, plus the adhan voice set for the free one.
const path = require('path');

const FOSS = process.env.FOSS_BUILD === '1';

/** @type {import('expo/metro-config').MetroConfig} */
const config = FOSS
  ? require('expo/metro-config').getDefaultConfig(__dirname)
  : require('@sentry/react-native/metro').getSentryExpoConfig(__dirname);

config.resolver.sourceExts.push('sql');

if (FOSS) {
  const foss = (file) => path.join(__dirname, 'src', 'foss', file);

  /** Package name → stand-in. Every import of the package, ours or a library's, gets the stand-in. */
  const PACKAGES = {
    '@sentry/react-native': foss('sentry-react-native.ts'),
    'expo-application': foss('expo-application.ts'),
    'expo-location': foss('expo-location.ts'),
    'expo-store-review': foss('expo-store-review.ts'),
    'react-native-purchases': foss('react-native-purchases.ts'),
  };

  /** Our own files the FOSS build replaces: the adhan voice set and its bundled recordings. */
  const FILES = {
    [path.join(__dirname, 'src', 'domain', 'adhanVoiceSet.ts')]: foss('adhanVoiceSet.ts'),
    [path.join(__dirname, 'src', 'hooks', 'adhanAssets.ts')]: foss('adhanAssets.ts'),
  };

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (PACKAGES[moduleName] !== undefined) {
      return { type: 'sourceFile', filePath: PACKAGES[moduleName] };
    }
    const resolution = context.resolveRequest(context, moduleName, platform);
    if (resolution.type === 'sourceFile' && FILES[resolution.filePath] !== undefined) {
      return { type: 'sourceFile', filePath: FILES[resolution.filePath] };
    }
    return resolution;
  };
}

module.exports = config;
