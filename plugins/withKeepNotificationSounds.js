const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Keeps the adhan notification sounds (`res/raw/adhan_*`) in a release build.
 *
 * ## Why this exists
 *
 * Release builds shrink resources (`expo-build-properties`, `enableShrinkResourcesInReleaseBuilds`).
 * The shrinker keeps a resource only if something reaches it, and nothing in the compiled code
 * names these: `expo-notifications` finds a channel's sound with `Resources.getIdentifier(name,
 * "raw", …)`, and the names live only in JavaScript. So the shrinker deletes them
 * (`mapping/release/resources.txt`: "raw:adhan_free_makkah … is not reachable"), `getIdentifier`
 * answers 0, and the reminder plays the phone's default sound instead of the adhan.
 *
 * A `tools:keep` file in `res/raw` is the documented way to keep resources that are looked up by
 * name. `adhan_*` covers both voice sets.
 *
 * `android/` is generated, so the file is written at prebuild, like every other native edit.
 */
const KEEP_FILE = 'keep_notification_sounds.xml';

const CONTENTS = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by plugins/withKeepNotificationSounds.js: notification sounds are found by name. -->
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@raw/adhan_*" />
`;

/**
 * Writes the keep file into a generated Android project.
 *
 * @param {string} androidRoot - The `android/` directory.
 * @returns {string} The path written.
 */
function writeKeepFile(androidRoot) {
  const raw = path.join(androidRoot, 'app/src/main/res/raw');
  fs.mkdirSync(raw, { recursive: true });
  const file = path.join(raw, KEEP_FILE);
  fs.writeFileSync(file, CONTENTS);
  return file;
}

/** @param {import('expo/config').ExpoConfig} config */
function withKeepNotificationSounds(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      writeKeepFile(mod.modRequest.platformProjectRoot);
      return mod;
    },
  ]);
}

module.exports = withKeepNotificationSounds;
module.exports.writeKeepFile = writeKeepFile;
