/**
 * The Apple Watch app target (Milestone V) — generated into the Xcode project by
 * `@bacons/apple-targets` at prebuild, exactly like `targets/widget`. All runtime code is ours.
 *
 * - The name has NO spaces: EAS's credentials step looks the target up by this exact string
 *   (the widget round's one iOS build failure was a renamed target).
 * - `WKCompanionAppBundleIdentifier` is written by the plugin from the main app target; the
 *   watch-specific plist keys live in `Info.plist` beside this file.
 * - watchOS 10 floor: Smart Stack + the modern SwiftUI watch idioms are the feature.
 */
const { APP_GROUP } = require('../../plugins/withAppGroup');

module.exports = {
  type: 'watch',
  name: 'SimplePrayerWatch',
  displayName: 'Simple Prayer',
  bundleIdentifier: 'app.simpleprayer.watchkitapp',
  deploymentTarget: '10.0',
  // The watch app MUST carry its own AppIcon asset catalog: App Store validation rejects the
  // whole iOS submission without it ("CFBundleIconName is missing in the bundle
  // …watchkitapp", 2026-08-28). The plugin generates the watchOS appiconset from this file and
  // sets ASSETCATALOG_COMPILER_APPICON_NAME; the source is the app's own icon (alpha-free —
  // watchOS validation also rejects transparency).
  icon: '../../assets/images/icon.png',
  entitlements: {
    'com.apple.security.application-groups': [APP_GROUP],
  },
};
