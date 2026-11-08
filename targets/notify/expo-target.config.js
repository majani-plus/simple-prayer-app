/**
 * The notification service extension, generated into the Xcode project by `@bacons/apple-targets`
 * at prebuild. The Swift here is entirely ours and survives `--clean`.
 *
 * It exists for one sentence: a buddy notification arrives saying "Your buddy has prayed." and
 * leaves saying "Amina has prayed." — because the nickname lives on this phone and nowhere else
 * (D174), so this is the only place and the only moment it can be added. iOS hands every push
 * marked `mutable-content` to this extension before showing it, with the app closed and the phone
 * locked, which is exactly when a buddy notification matters.
 *
 * If it does not run — an older build, a failed launch, the 30-second budget spent — iOS shows the
 * notification as it arrived. That is the whole fallback, and it is a correct sentence.
 */
const { APP_GROUP } = require('../../plugins/withAppGroup');

/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'notification-service',
  // NO SPACES: EAS's credentials step addresses the target by this exact name and a spaced name
  // fails its lookup — the one iOS build failure the widget target's config produced.
  name: 'SimplePrayerNotify',
  displayName: 'Simple Prayer Notify',
  // Pinned so a name change can never move it: the provisioning profile and the App Group
  // derivation in NotificationService.swift both assume exactly this id.
  bundleIdentifier: 'app.simpleprayer.notify',
  // The app's own floor (ios/Podfile). A service extension has been available since iOS 10, so
  // there is no reason for this target to ask for more than the app it belongs to.
  deploymentTarget: '16.4',
  frameworks: ['UserNotifications'],
  entitlements: {
    'com.apple.security.application-groups': [APP_GROUP],
  },
};
