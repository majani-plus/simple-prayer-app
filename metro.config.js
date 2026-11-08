// Metro config — Expo defaults plus `.sql` as a source extension so the generated
// Drizzle migration files can be imported (and inlined by babel-plugin-inline-import).
//
// `getSentryExpoConfig` wraps `expo/metro-config`'s `getDefaultConfig` unchanged and adds the
// Sentry serializer, which stamps a Debug ID into release bundles and source maps. That stamp is
// what lets Sentry match a crash's minified frames to the source map uploaded at build time
// (docs/RELEASE.md §11) — without it, release stack traces stay unreadable. It affects bundling
// only; nothing about the dev server or Jest changes.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

config.resolver.sourceExts.push('sql');

module.exports = config;
