/**
 * `useBackgroundRefresh` — asks the OS, once per process, to start waking the app.
 *
 * The work itself lives in `services/backgroundRefresh`, which also *defines* the task at module
 * scope (see the repo-root `index.ts` for why that cannot happen in a component). All this hook
 * does is the one call the definition needs to become a schedule, and it belongs to the root layout
 * for the same reason `useWidgetSync` does: it is app-wide, and it must not depend on any screen
 * being open.
 *
 * It is deliberately fire-and-forget. Registration is persistent — `TaskManager` restores it on the
 * next launch — so there is nothing to unregister on unmount, and a failure means only that the app
 * behaves exactly as it did before this feature existed: every sync still runs on foreground.
 *
 * Dependency rule: `hooks → services`. No SQL, no user-facing strings.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerBackgroundRefresh } from '@/services/backgroundRefresh';

/**
 * Registers the background refresh task once startup has settled.
 *
 * @param ready - Gate on migrations + hydration (`startup.done`), like `useWidgetSync`. The task
 * prepares the database for itself, but there is no reason to have the OS wake a process that is
 * still opening it — and registering after startup keeps this off the cold-start path.
 */
export function useBackgroundRefresh(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    // Inert on web, where there is no background execution to ask for and the status call would
    // only ever answer "restricted".
    if (Platform.OS === 'web') return;
    void registerBackgroundRefresh().catch(() => {
      // `registerBackgroundRefresh` already swallows its own failures; this is belt and braces so
      // the root layout can never be taken down by a platform that behaves unexpectedly.
    });
  }, [ready]);
}
