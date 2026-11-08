/**
 * The watch complications extension (Milestone V) — WidgetKit on watchOS, embedded in the
 * SimplePrayerWatch app (apple-targets v5 wires the embed + dependency). The accessory-family
 * views land in V4 against the approved V0a canvases; V3 proves the target builds.
 *
 * The bundle id is prefixed by the WATCH APP's id — an embedded extension's rule.
 */
const { APP_GROUP } = require('../../plugins/withAppGroup');

module.exports = {
  type: 'watch-widget',
  name: 'SimplePrayerWatchWidgets',
  displayName: 'Simple Prayer Complications',
  bundleIdentifier: 'app.simpleprayer.watchkitapp.watchwidget',
  deploymentTarget: '10.0',
  entitlements: {
    'com.apple.security.application-groups': [APP_GROUP],
  },
};
