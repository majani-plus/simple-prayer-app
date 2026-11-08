/* global jest */
/**
 * Test-run setup: silence the one warning the suite cannot avoid, so the console is a signal
 * again.
 *
 * `expo-notifications`' entry point imports `DevicePushTokenAutoRegistration.fx`, which calls
 * `addPushTokenListener` at module scope, which calls `warnOfExpoGoPushUsage` — a warning about
 * *remote* push in Expo Go. This app has no remote push at all: it strips the APNs entitlement
 * (D49), declares no Firebase, and every reminder is a local notification. The warning is
 * therefore never about anything we do; it fires purely because the module got required, which
 * happens the moment any test exercises the notification service.
 *
 * It was printing a 20-line stack per suite that touches notifications. Real `console.error` and
 * `console.warn` output is left completely alone — the point of removing this one is that the
 * others become visible.
 */

const IGNORED_WARNINGS = [
  // expo-notifications, on require. Remote push, which this app does not have.
  'Android Push notifications (remote notifications) functionality provided by expo-notifications',
];

const realWarn = console.warn.bind(console);

console.warn = (...args) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (IGNORED_WARNINGS.some((needle) => first.includes(needle))) return;
  realWarn(...args);
};

/**
 * Gesture Handler 3 binds itself to Reanimated's UI runtime on import, in a queued microtask that
 * asks Worklets for the UI runtime holder. Under Jest, Reanimated's resolver loads the web build of
 * Worklets, which throws for that call ("`getUIRuntimeHolder` is not supported on web") after the
 * importing suite has already passed — failing it anyway. There is no UI runtime in a test, so the
 * binding has nothing to do: make it a no-op.
 */
// Both builds, as RNGH's own jestSetup does: which one Jest loads depends on the entry it resolves.
for (const build of ['src', 'lib/module']) {
  jest.mock(
    `react-native-gesture-handler/${build}/handlers/gestures/installUIRuntimeBindings`,
    () => ({ installUIRuntimeBindings: () => {} })
  );
}
