const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

/**
 * The App Group this app's iOS processes share, and the one place its name is written.
 *
 * ## What it is for
 *
 * An App Group is a container more than one process of the same app can read and write. Two things
 * need it, and the second is why it is named here as shared infrastructure rather than tucked
 * inside whichever feature happened to arrive first:
 *
 * 1. **Marking a prayer from a notification** (D92). The queue a press writes to lives in this
 *    group's `UserDefaults`.
 * 2. **Widgets** (D26, post-v1). A widget is a separate process with no access to the app's own
 *    container, so anything it displays has to come through a group. Moving a storage location
 *    after people have data in it is a migration; choosing it once is free.
 *
 * ## Owner action, once
 *
 * The identifier below must exist in the Apple Developer account and be enabled for the App ID.
 * EAS creates and syncs App Group capabilities during `eas build` when it sees the entitlement, so
 * in the normal flow there is nothing to do by hand — but if a build fails to sign with a
 * provisioning error naming `application-groups`, that is what it is asking for.
 *
 * ## Why the name is also in Info.plist
 *
 * Native code has to know which suite to open, and hardcoding the string in Swift would put the
 * same identifier in two files that nothing keeps in step. The plugin writes it into `Info.plist`
 * instead, and `modules/prayer-marks/ios/PendingMarks.swift` reads it from there — one source of
 * truth, and a build without the group falls back to the app's own defaults rather than crashing.
 */

/** Apple requires the `group.` prefix; the rest matches the bundle identifier. */
/**
 * REGISTERED AGAIN on the `widgets-ios-config` branch (2026-08-24, D26): the widget extension
 * reads the shared container, which is exactly the "only a widget ever needs it" case below.
 * This branch merges to main ONLY after the owner's Apple-side pass
 * (docs/WIDGETS_APPLE_RUNBOOK.md) — the history that follows is why:
 *
 * An App Group is a *provisioning capability*, not just an entitlement string. The comment below
 * assumed `eas build` would see the entitlement and sync the capability; it did not. It reused an
 * existing App Store profile (dated 2026-08-19) and Xcode failed the build three times over:
 *
 *   Provisioning profile "…" doesn't include the App Groups capability.
 *   … doesn't support the group.app.simpleprayer App Group.
 *   … doesn't include the com.apple.security.application-groups entitlement.
 *
 * Nothing needs the group yet. The notification action is handled in the app's own process, and
 * `PendingMarks.swift` already falls back to the app's own `UserDefaults` when the group is
 * absent — so the queue works exactly the same without it. Only a widget, reading from a separate
 * process, would ever need the shared container.
 *
 * So this waits for the widget work (D26), which needs an Apple-side setup pass anyway: enable
 * App Groups on the App ID, create `group.app.simpleprayer`, and let EAS regenerate the profile
 * rather than reuse one. Shipping an entitlement nothing exercises only buys an App Review
 * question in the meantime.
 *
 * Re-enabling is one line in app.json's `plugins`, plus that Apple-side pass. The queue is drained
 * on every launch and foreground, so it is empty almost always and the storage move costs nothing.
 */

const APP_GROUP = 'group.app.simpleprayer';

/** The `Info.plist` key native code reads the group identifier from. */
const INFO_PLIST_KEY = 'SPAppGroupIdentifier';

module.exports = function withAppGroup(config) {
  const withGroupEntitlement = withEntitlementsPlist(config, (modConfig) => {
    const existing = modConfig.modResults['com.apple.security.application-groups'];
    const groups = Array.isArray(existing) ? existing : [];
    if (!groups.includes(APP_GROUP)) {
      groups.push(APP_GROUP);
    }
    modConfig.modResults['com.apple.security.application-groups'] = groups;
    return modConfig;
  });

  return withInfoPlist(withGroupEntitlement, (modConfig) => {
    modConfig.modResults[INFO_PLIST_KEY] = APP_GROUP;
    return modConfig;
  });
};

module.exports.APP_GROUP = APP_GROUP;
module.exports.INFO_PLIST_KEY = INFO_PLIST_KEY;
