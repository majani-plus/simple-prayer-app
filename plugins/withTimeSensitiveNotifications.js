const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Adds the `com.apple.developer.usernotifications.time-sensitive` entitlement, which is what lets
 * a reminder carry `interruptionLevel: 'timeSensitive'` on iOS.
 *
 * ## Why the app needs it
 *
 * Without the entitlement every notification this app schedules is delivered at the default level,
 * and iOS is entitled to hold those. A Focus mode that does not list this app keeps them until the
 * Focus ends; the Scheduled Summary keeps them until the next digest. Both are hours, and both
 * look from the user's seat exactly like "the adhan did not fire" — a prayer time is not a piece
 * of news that can wait for a summary.
 *
 * `timeSensitive` is the one level that goes through both, and a prayer reminder is the case
 * Apple's own guidance names for it. The user keeps the last word: iOS shows a per-app
 * "Time Sensitive Notifications" switch, and they can turn it off without touching anything else.
 *
 * ## Why this is not the same call as D49
 * This is the app's only entitlement mod. Its sibling `withoutPushEntitlement` — which used to
 * strip `aps-environment` on the grounds that the app sent no remote notifications — was deleted
 * when buddy mode arrived (D175 reversing D49): the app now does send remote notifications, so it
 * declares the capability rather than hiding it. Nothing here depends on plugin ordering any more.
 */
module.exports = function withTimeSensitiveNotifications(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    modConfig.modResults['com.apple.developer.usernotifications.time-sensitive'] = true;
    return modConfig;
  });
};
