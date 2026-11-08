/**
 * `useLocationRefresh` — keeps an auto-followed location current, silently.
 *
 * PRODUCT_SPEC §10 says the auto location is "re-resolve[d] on launch", and
 * `stores/locationStore.refresh` was built as exactly that silent flow — but nothing ever called
 * it: a user who granted permission, flew to another city and opened the app kept seeing their
 * old city's times until they happened to visit the location settings. This hook is the missing
 * caller, and like `useTodayDayResolver` and `useNotificationSync` it belongs to the **root
 * layout**: staying current is app-wide behaviour, not a screen's job.
 *
 * It does two things, on mount and on every return to the foreground, and only when the OS
 * permission is **already granted**:
 *
 * 1. `syncPermission()` — absorbs the granted permission into `locationStore`, which is what lets
 *    the Qibla compass start on launch. `useHeading` reads the store's permission field and will
 *    not touch the sensor while it still says `undetermined`; without this step every cold start
 *    showed a "compass needs permission" card to a user who had long since said yes.
 * 2. `refresh()` — the never-prompting resolution. It already carries its own guards: a manual
 *    city is never overwritten (`useAutoLocation` off → no-op), a fix younger than
 *    `REFRESH_MIN_INTERVAL_MS` is kept, and concurrent calls share one flight.
 *
 * The permission gate up front is load-bearing, not an optimisation. Calling `syncPermission`
 * (or `refresh`) with the permission still `undetermined` flips the store's flow status to
 * `denied`, and the first-run Today/Qibla cards would then explain a refusal that never happened
 * instead of making the friendly first ask. A user who has not answered yet must look exactly
 * like a user we have not asked — so when the permission is anything but granted, this hook
 * touches nothing at all. It can never show a prompt: `getPermission` reads, and only reads.
 *
 * Dependency rule: `hooks → stores + services`. No SQL, no user-facing strings.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { getLocationService, type LocationService } from '@/services/location';
import { getLocationActions, type LocationActions } from '@/stores/locationStore';

/** Options for {@link startLocationRefresh} and {@link useLocationRefresh}. Tests inject both. */
export interface LocationRefreshOptions {
  /** Permission reader. Defaults to the app-wide expo-location service. MUST NOT prompt. */
  service?: Pick<LocationService, 'getPermission'>;
  /** The location store's actions. Defaults to the singleton's. */
  actions?: () => Pick<LocationActions, 'syncPermission' | 'refresh'>;
}

/**
 * Starts the launch/foreground refresh — the whole mechanism, with no React in it, so it can be
 * driven from a test (or a future background task) without a renderer.
 *
 * @param options - See {@link LocationRefreshOptions}.
 * @returns The stop function: drops the AppState subscription and refuses any pass still queued.
 */
export function startLocationRefresh(options: LocationRefreshOptions = {}): () => void {
  const service = options.service ?? getLocationService();
  const actions = options.actions ?? getLocationActions;

  let disposed = false;
  // One pass at a time: a foreground event landing while the mount pass is still resolving must
  // not stack a second geocoder round-trip (the store's own single-flight guard would coalesce
  // the resolution, but not the permission read).
  let running = false;

  const pass = async (): Promise<void> => {
    if (disposed || running) return;
    running = true;
    try {
      const permission = await service.getPermission();
      // Not granted — undetermined or refused — means hands off: no store writes, no status
      // change, and certainly no prompt. See the module header for why this gate matters.
      if (disposed || !permission.granted) return;
      const { syncPermission, refresh } = actions();
      await syncPermission();
      if (disposed) return;
      await refresh();
    } catch {
      // Both layers already degrade instead of throwing; a failure here means only that this
      // pass resolved nothing, and the next foreground tries again.
    } finally {
      running = false;
    }
  };

  void pass();

  const subscription = AppState.addEventListener('change', (status) => {
    if (status === 'active') void pass();
  });

  return () => {
    disposed = true;
    subscription.remove();
  };
}

/**
 * Keeps the stored auto location fresh across launches and foregrounds, without ever prompting.
 *
 * Call it once, from the root layout. It renders nothing and returns nothing.
 *
 * @param options - See {@link LocationRefreshOptions}. Pass stable values: a fresh object each
 * render would restart the controller.
 */
export function useLocationRefresh(options: LocationRefreshOptions = {}): void {
  const { service, actions } = options;
  useEffect(() => startLocationRefresh({ service, actions }), [service, actions]);
}
