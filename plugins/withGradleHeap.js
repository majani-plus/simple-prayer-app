const { withGradleProperties } = require('expo/config-plugins');

/**
 * Gives the Gradle daemon enough heap to run R8 over this app.
 *
 * ## Why this exists
 *
 * Release builds minify and shrink with R8 (`expo-build-properties`,
 * `enableMinifyInReleaseBuilds`, 2026-09-13 — Google Play's "App optimization" flagged the app at
 * 2% obfuscation and warned it may affect visibility). R8 over a React Native app of this size —
 * Hermes, Reanimated, Sentry, RevenueCat and its Amazon SDK, twenty-odd Expo modules — needs
 * more than the 2 GiB Expo's template leaves in `org.gradle.jvmargs`: the first local release
 * build ran R8 to completion and then the daemon died of garbage-collector thrashing before it
 * could write the APK ("Gradle build daemon has been stopped: since the JVM garbage collector is
 * thrashing"). An EAS worker starts from the same template and would hit the same wall.
 *
 * ## Why a plugin, not a hand edit
 *
 * `android/` is generated (`/android` is gitignored) — anything written there by hand is gone on
 * the next prebuild. `expo-build-properties` exposes no JVM-args option, so this is the one seam.
 *
 * 4 GiB is the usual figure for an R8 build of an app like this, and every EAS Android worker
 * has well over that; on a laptop it is what a release build wants anyway.
 */
const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

/** @param {import('expo/config').ExpoConfig} config */
function withGradleHeap(config) {
  return withGradleProperties(config, (mod) => {
    const key = 'org.gradle.jvmargs';
    const properties = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === key)
    );
    properties.push({ type: 'property', key, value: JVM_ARGS });
    mod.modResults = properties;
    return mod;
  });
}

module.exports = withGradleHeap;
