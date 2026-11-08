/**
 * The app's entry point, ahead of Expo Router's.
 *
 * `package.json`'s `main` used to be `expo-router/entry` directly. It now points here for one
 * reason: `TaskManager.defineTask` has to have run before the OS hands us a headless launch, and
 * Expo Router loads every module under `src/app/` lazily, as the router renders. On an Android
 * background start there is no view, so nothing under the router root is ever reached — a task
 * defined in `src/app/_layout.tsx` would be missing exactly when it is needed, and the OS would
 * report the task as undefined instead of running it.
 *
 * So the definition is imported first, for its side effect, and the router's own entry second.
 * Nothing else belongs in this file: anything added here runs before the app does, on every
 * launch, including ones with no screen.
 */

// Side effect: defines the background refresh task at module scope. Must precede the router entry.
import './src/services/backgroundRefresh';

import 'expo-router/entry';
