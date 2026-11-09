#!/usr/bin/env bun

/**
 * Prepares a checkout for the FOSS Android build: no Google, proprietary or tracking libraries.
 *
 *   FOSS_BUILD=1 bun scripts/foss-prepare.ts
 *   FOSS_BUILD=1 bunx expo prebuild -p android --clean
 *   cd android && FOSS_BUILD=1 ./gradlew :app:assembleRelease
 *
 * The single entry point that CI (`.github/workflows/foss-android.yml`) and F-Droid run after
 * `bun install` and before `expo prebuild`. Without `FOSS_BUILD=1` it does nothing at all.
 *
 * !!! IT CHANGES TRACKED FILES AND DELETES SOME. Run it only in a throwaway checkout (CI, F-Droid's
 * !!! build server, a scratch clone). Never in a working tree you want to keep: undo it with git.
 *
 * What it does, each step safe to repeat:
 *
 * 1. **Autolinking.** Sets `expo.autolinking.android.exclude` in package.json, so these are not
 *    linked into the Android app at all: `expo-location` (Play services location; replaced by
 *    `modules/foss-location`, which the normal build excludes instead), `expo-store-review` (Play
 *    In-App Review), `expo-application` (Play Install Referrer), `react-native-purchases` (Play
 *    Billing), `@sentry/react-native` (Sentry) and `modules/watch-sync` (Play services wearable).
 *    Their JavaScript is swapped for the stand-ins in `src/foss/` by metro.config.js.
 * 2. **expo-notifications without Firebase.** Applies `patches/foss/expo-notifications@58.1.7.patch`
 *    on top of the bun patch: removes the FCM service and the firebase-messaging dependency, and
 *    makes push-token calls fail. Local notifications, which are all prayer reminders are, do not
 *    use Firebase and work as before.
 * 3. **buddy-nicknames without Firebase.** Removes `BuddyMessagingService` (it only rewrites FCM
 *    pushes) and its firebase-messaging dependency. The module itself stays: prayer-marks and
 *    prayer-widgets send buddy marks through it. Without a push token, buddy marks arrive when the
 *    app is opened (docs/BUILD_YOURSELF.md).
 * 4. **Non-free files removed.** The four adhan recordings with no known licence
 *    (`assets/audio/CREDITS.md`), the Wear OS apps and `google-services.json`. The FOSS build uses `assets/audio/free/`
 *    instead (app.config.ts, metro.config.js), so a leftover reference fails the build instead of
 *    shipping a non-free file.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

/** Packages and local modules the FOSS Android build does not link. */
export const FOSS_ANDROID_EXCLUDE = [
  '@sentry/react-native',
  'expo-application',
  // The development client. It is linked into release builds too, and with expo-updates off (the
  // FOSS build has no update server) its launcher took over at startup and looked for Metro on
  // 127.0.0.1:8081 instead of running the bundled app. A release APK never needs it.
  'expo-dev-client',
  'expo-dev-launcher',
  'expo-dev-menu',
  'expo-dev-menu-interface',
  'expo-location',
  'expo-store-review',
  'react-native-purchases',
  'watch-sync',
] as const;

const NOTIFICATIONS_PATCH = 'patches/foss/expo-notifications@58.1.7.patch';
const NOTIFICATIONS_DIR = 'node_modules/expo-notifications';
const BUDDY_ANDROID = 'modules/buddy-nicknames/android';

/** Deleted outright, besides the unlicensed recordings ({@link nonFreePaths}): Wear OS and Firebase config. */
const NON_FREE_DIRS = ['wear', 'wear-face', 'modules/watch-sync/android', 'google-services.json'];

type PackageJson = {
  expo?: {
    autolinking?: { android?: { exclude?: string[] } & Record<string, unknown> } & Record<
      string,
      unknown
    >;
  } & Record<string, unknown>;
} & Record<string, unknown>;

/**
 * package.json with the FOSS Android exclude list. Replaces the normal list (which excludes only
 * `foss-location`), because the FOSS build is the one that links it.
 */
export function withFossAutolinking(pkg: PackageJson): PackageJson {
  const autolinking = pkg.expo?.autolinking ?? {};
  return {
    ...pkg,
    expo: {
      ...pkg.expo,
      autolinking: {
        ...autolinking,
        android: { ...autolinking.android, exclude: [...FOSS_ANDROID_EXCLUDE] },
      },
    },
  };
}

/** buddy-nicknames' build.gradle with its `dependencies` block (Firebase) removed. */
export function withoutDependencies(gradle: string): string {
  return gradle.replace(/\ndependencies \{[\s\S]*?\n\}\n?/, '\n');
}

/** The unlicensed recordings, the Wear apps and the Firebase config, relative to the repo root. */
export function nonFreePaths(root: string): string[] {
  const audio = join(root, 'assets', 'audio');
  const recordings = existsSync(audio)
    ? readdirSync(audio)
        .filter((file) => /^adhan_.*\.(mp3|caf)$/.test(file))
        .map((file) => `assets/audio/${file}`)
    : [];
  return [...recordings, ...NON_FREE_DIRS];
}

function git(root: string, args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function prepare(root: string): void {
  // 1. Autolinking.
  const pkgPath = join(root, 'package.json');
  const before = readFileSync(pkgPath, 'utf8');
  const after = `${JSON.stringify(withFossAutolinking(JSON.parse(before) as PackageJson), null, 2)}\n`;
  if (after !== before) writeFileSync(pkgPath, after);
  console.log(`autolinking: Android excludes ${FOSS_ANDROID_EXCLUDE.join(', ')}`);

  // 2. expo-notifications. `--reverse --check` succeeding means it is already applied.
  const patchArgs = ['apply', '-p1', `--directory=${NOTIFICATIONS_DIR}`, NOTIFICATIONS_PATCH];
  if (git(root, [patchArgs[0], '--reverse', '--check', ...patchArgs.slice(1)])) {
    console.log('expo-notifications: FOSS patch already applied');
  } else {
    execFileSync('git', patchArgs, { cwd: root, stdio: 'inherit' });
    console.log('expo-notifications: FOSS patch applied (no Firebase)');
  }

  // 3. buddy-nicknames.
  const buddy = join(root, BUDDY_ANDROID);
  rmSync(join(buddy, 'src/main/java/expo/modules/buddynicknames/BuddyMessagingService.kt'), {
    force: true,
  });
  writeFileSync(
    join(buddy, 'src/main/AndroidManifest.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n'
  );
  const gradlePath = join(buddy, 'build.gradle');
  writeFileSync(gradlePath, withoutDependencies(readFileSync(gradlePath, 'utf8')));
  console.log('buddy-nicknames: BuddyMessagingService and Firebase removed');

  // 4. Non-free files.
  for (const path of nonFreePaths(root)) rmSync(join(root, path), { recursive: true, force: true });
  console.log(
    'removed: unlicensed adhan recordings, Wear OS apps, watch-sync native code, google-services.json'
  );

  // Nothing of ours, and nothing in expo-notifications, may still name Firebase.
  const leftovers = [
    join(buddy, 'build.gradle'),
    join(buddy, 'src/main/AndroidManifest.xml'),
    join(root, NOTIFICATIONS_DIR, 'android/build.gradle'),
    join(root, NOTIFICATIONS_DIR, 'android/src/main/AndroidManifest.xml'),
  ].filter((file) => /firebase/i.test(readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '')));
  if (leftovers.length > 0)
    throw new Error(`Firebase is still referenced in: ${leftovers.join(', ')}`);
}

// Only when run as a script, so tests can import the helpers above.
if (process.argv[1]?.endsWith('foss-prepare.ts') === true) {
  if (process.env.FOSS_BUILD !== '1') {
    console.log('FOSS_BUILD is not 1: nothing to do.');
  } else {
    console.log('foss-prepare: this changes tracked files. Use a throwaway checkout.');
    prepare(resolve(__dirname, '..'));
    console.log('foss-prepare: done. Next: FOSS_BUILD=1 bunx expo prebuild -p android --clean');
  }
}
