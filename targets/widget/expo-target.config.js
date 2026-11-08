/**
 * The WidgetKit extension target (D26), generated into the Xcode project by
 * `@bacons/apple-targets` at prebuild. The Swift here is entirely ours and survives `--clean`.
 *
 * iOS 17 floor: interactive widgets (`Button(intent:)`) are the feature; below 17 the widgets
 * simply do not appear, and the app itself is untouched.
 *
 * The App Group identifier is imported from `plugins/withAppGroup.js` so it keeps existing in
 * exactly one place (D92 recorded that rule). NOTE: this target only BUILDS for the store once
 * the owner's Apple-side pass is done (docs/WIDGETS_APPLE_RUNBOOK.md) — simulator builds need
 * none of that.
 */
const { APP_GROUP } = require('../../plugins/withAppGroup');

/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'widget',
  // NO SPACES: EAS's credentials step addresses the target by this exact name and a spaced name
  // fails its lookup ("Could not find target 'SimplePrayerWidgets' in project.pbxproj" — the one
  // iOS build failure this config produced). The pretty name lives in displayName.
  name: 'SimplePrayerWidgets',
  displayName: 'Simple Prayer Widgets',
  // Pinned so a name change can never move it: the provisioning profile, the App Group
  // derivation in SnapshotReader.swift, and the runbook all assume exactly this id.
  bundleIdentifier: 'app.simpleprayer.widget',
  deploymentTarget: '17.0',
  entitlements: {
    'com.apple.security.application-groups': [APP_GROUP],
  },
  // The plugin offers no infoPlist field, so the extension cannot carry the app's
  // SPAppGroupIdentifier key: `AppGroup.identifier()` (SnapshotReader.swift) derives the group
  // from the extension's own bundle id instead (`app.simpleprayer.widget` → `group.app.simpleprayer`),
  // which the generated appex's CFBundleIdentifier has been verified to satisfy.
};
