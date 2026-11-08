/**
 * Wires the Wear OS module (`wear/`, at the repo root) into the generated Android project
 * (Milestone V). CNG regenerates `android/` at every prebuild, so BOTH edits live here and are
 * idempotent — running prebuild twice must not duplicate a line:
 *
 * 1. `settings.gradle` gains the `:wear` include, pointed at `../wear` (outside the regenerated
 *    directory, which is the whole reason the module survives `--clean`).
 * 2. The ROOT `build.gradle`'s buildscript classpath gains the Kotlin 2.x Compose compiler
 *    Gradle plugin — the root-level, easy-to-miss detail the prior art warns about. Its version
 *    is read from React Native's own version catalog so an SDK upgrade carries it automatically
 *    (a hardcoded version here would drift from the Kotlin the build actually uses).
 *
 * The wear module itself is a plain `com.android.application` — Play requires the Wear app as a
 * separate artifact under the same applicationId, so nothing else about the phone app changes.
 */
const { withSettingsGradle, withProjectBuildGradle } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const INCLUDE_MARKER = "include ':wear'";
const CLASSPATH_MARKER = 'compose-compiler-gradle-plugin';

function kotlinVersion(projectRoot) {
  const tomlPath = path.join(
    projectRoot,
    'node_modules',
    'react-native',
    'gradle',
    'libs.versions.toml'
  );
  const toml = fs.readFileSync(tomlPath, 'utf8');
  const match = toml.match(/^kotlin\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(
      "[withWearApp] Could not read the kotlin version from react-native's libs.versions.toml — " +
        'the Compose compiler classpath must match it. Did an RN upgrade move the catalog?'
    );
  }
  return match[1];
}

module.exports = function withWearApp(config) {
  config = withSettingsGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(INCLUDE_MARKER)) {
      mod.modResults.contents +=
        '\n' +
        '// Simple Prayer Wear OS app (plugins/withWearApp.js) — the module lives outside the\n' +
        '// regenerated android/ directory so it survives prebuild --clean.\n' +
        "include ':wear'\n" +
        "project(':wear').projectDir = new File(rootProject.projectDir, '../wear')\n";
    }
    // The Watch Face Format face is its own Play listing and therefore its own application
    // module (`wear-face/`, V6b). Included only once it exists, so the wear app never waits.
    const facePath = path.join(mod.modRequest.projectRoot, 'wear-face', 'build.gradle');
    if (fs.existsSync(facePath) && !mod.modResults.contents.includes("include ':wear-face'")) {
      mod.modResults.contents +=
        "include ':wear-face'\n" +
        "project(':wear-face').projectDir = new File(rootProject.projectDir, '../wear-face')\n";
    }
    return mod;
  });

  config = withProjectBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(CLASSPATH_MARKER)) {
      const version = kotlinVersion(mod.modRequest.projectRoot);
      // Anchors on whichever form the template's Kotlin classpath line takes: SDK 57's bare
      // `classpath('…kotlin-gradle-plugin')`, or SDK 58's ternary on `android.kotlinVersion`. The
      // Compose compiler must match Kotlin exactly, so it follows the same property and falls back
      // to React Native's catalog version, which is what the bare plugin line resolves to.
      mod.modResults.contents = mod.modResults.contents.replace(
        /^(\s*)(classpath\(.*org\.jetbrains\.kotlin:kotlin-gradle-plugin.*\))[ \t]*$/m,
        `$1$2\n$1// Compose compiler for the :wear module (plugins/withWearApp.js); must match Kotlin.\n` +
          `$1classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:\${findProperty('android.kotlinVersion') ?: '${version}'}")`
      );
      if (!mod.modResults.contents.includes(CLASSPATH_MARKER)) {
        throw new Error(
          '[withWearApp] Could not add the Compose compiler classpath — the root build.gradle no ' +
            'longer carries the kotlin-gradle-plugin line this plugin anchors on.'
        );
      }
    }
    return mod;
  });

  return config;
};
