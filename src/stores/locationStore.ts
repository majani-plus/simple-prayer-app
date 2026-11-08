/**
 * Location store — the UI's entry point to "where is the user", and nothing else.
 *
 * It owns the *transient* state of the location flow (are we asking? did the user refuse? did
 * the fix fail?) and orchestrates `services/location.ts`. It deliberately does **not** own the
 * location itself: `settings.location` is the single source of truth, persisted through
 * `settingsStore`, so a resolved city survives a restart and every consumer (prayer times,
 * qibla, method auto-selection, notification scheduling) reads it from exactly one place.
 *
 * ## What the status means (PRODUCT_SPEC §10)
 *
 * `status` describes the **device-location flow**, not "do we have a location". A user who
 * refused the permission but picked a city manually is `denied` *and* fully functional — the
 * UI reads `useLocation()` from the settings store to know whether it can compute times, and
 * this status only to decide what to offer (a "Use my location" button, a permission
 * explanation, a retry). That separation is what lets the app work before any permission is
 * granted, which is the whole point of the privacy posture.
 *
 * - `idle`     — nothing attempted yet and no location stored.
 * - `requesting` — a resolution is in flight (the only spinner state).
 * - `ready`    — a location is available.
 * - `denied`   — permission is not granted; `canAskAgain` says whether a prompt is still
 *                possible or the user must go to the OS settings.
 * - `error`    — permission is fine but the fix or the geocoder failed; `error` carries which.
 *
 * ## Prompting rules
 *
 * Only {@link LocationActions.requestAndResolve} may show the OS dialog, and it exists so the
 * UI can bind it to an explicit "Set your location" tap. {@link LocationActions.refresh} —
 * the one called on app foreground — passes `prompt: false` and can therefore never surprise
 * anyone at launch. Nothing in this module runs at import time.
 *
 * ## Auto vs manual
 *
 * `refresh` is a no-op unless `settings.useAutoLocation` is on, so a manually chosen city is
 * never silently overwritten by the device. Choosing a city
 * ({@link LocationActions.selectManualLocation}) turns auto-following off; asking for the
 * device location turns it back on. Refreshes are also skipped while the stored auto location
 * is younger than {@link REFRESH_MIN_INTERVAL_MS}, so returning to the app ten times an hour
 * does not mean ten geocoder round-trips (pass `{ force: true }` for a user-initiated refresh).
 *
 * Dependency rule: `stores → services + domain`. No React Native imports, no user-facing
 * strings (i18n happens in the UI; the only string here is the place label, which comes from
 * the OS geocoder).
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import type { AppLocation, AppSettings } from '../domain/types';
import {
  createLocationService,
  createExpoLocationAdapter,
  type CitySearchResult,
  type LocationErrorCode,
  type LocationPermissionStatus,
  type LocationService,
  type PermissionState,
  type SearchOptions,
} from '../services/location';
import { getSettingsActions, getSettingsSnapshot, type SettingsActions } from './settingsStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const LOCATION_STATUSES = ['idle', 'requesting', 'ready', 'denied', 'error'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

/**
 * Minimum age of the stored auto location before {@link LocationActions.refresh} will re-resolve.
 * Fifteen minutes: long enough that foreground churn is free, short enough that a user who
 * flies somewhere and opens the app gets the right times within one manual refresh.
 */
export const REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;

export interface LocationState {
  status: LocationStatus;
  /** Last known OS permission state. Updated by every action that touches the platform. */
  permission: LocationPermissionStatus;
  /** `false` when the OS will not prompt again — the UI must offer "Open Settings" instead. */
  canAskAgain: boolean;
  /** Why the last attempt failed, or `null`. Set alongside `denied`/`error`. */
  error: LocationErrorCode | null;
  /** Epoch ms of the last *successful* auto resolution, or `null`. */
  lastResolvedAt: number | null;
  /** `true` while a {@link LocationActions.searchCity} call is in flight. */
  isSearching: boolean;
}

export interface LocationActions {
  /**
   * The user-initiated flow: prompts for foreground permission if needed, resolves a coarse
   * position, reverse-geocodes it and stores it (turning `useAutoLocation` back on).
   *
   * Safe to call repeatedly — concurrent calls share one in-flight resolution.
   *
   * @returns The stored location, or `null` when the user refused or the fix failed.
   */
  requestAndResolve(): Promise<AppLocation | null>;
  /**
   * The silent flow, for app foreground / launch. **Never prompts.** No-ops when auto-location
   * is off, when permission is not granted, or when the stored fix is still fresh.
   *
   * @param options - `force: true` skips the freshness check (a pull-to-refresh, say).
   * @returns The stored location, or `null` when nothing was resolved.
   */
  refresh(options?: { force?: boolean }): Promise<AppLocation | null>;
  /**
   * Reads the OS permission without prompting and reconciles `status` with it. Useful when
   * returning from the system settings screen.
   *
   * @returns The permission state as the OS now reports it.
   */
  syncPermission(): Promise<PermissionState>;
  /**
   * Forward-geocodes a typed city name for the Settings picker. Does not change the stored
   * location; call {@link selectManualLocation} with the candidate the user picks.
   *
   * @param query - Raw user input; blank queries resolve to an empty, error-free result.
   * @param options - See {@link SearchOptions}.
   */
  searchCity(query: string, options?: SearchOptions): Promise<CitySearchResult>;
  /** Stores a manually picked city and stops following the device. */
  selectManualLocation(location: AppLocation): void;
  /** Forgets the stored location (e.g. "stop using my location"). */
  clearLocation(): void;
  /** Resets the transient flow state; the stored location is untouched. */
  reset(): void;
}

export type LocationStore = LocationState & LocationActions;

/** Everything the store needs from the outside world; all lazy so nothing resolves at import. */
export interface LocationStoreDeps {
  /** Platform access. Defaults to the real expo-location–backed service. */
  service?: LocationService;
  /** Current settings snapshot. Defaults to the settings singleton. */
  getSettings?: () => AppSettings;
  /** Settings mutators. Defaults to the settings singleton. */
  getSettingsActions?: () => SettingsActions;
  /** Epoch-ms clock, injected so tests can control the freshness window. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Builds a location store bound to the given dependencies.
 *
 * @param deps - See {@link LocationStoreDeps}; every field has a production default.
 * @returns A zustand hook with `.getState()`, `.setState()` and `.subscribe()`.
 */
export function createLocationStore(deps: LocationStoreDeps = {}) {
  const service = deps.service ?? createLocationService(createExpoLocationAdapter());
  const settings = deps.getSettings ?? getSettingsSnapshot;
  const actions = deps.getSettingsActions ?? getSettingsActions;
  const now = deps.now ?? (() => Date.now());

  // Single-flight guard. Two foreground events (or a tap racing a foreground) must not fire two
  // permission prompts or two geocoder round-trips; `prompt` is remembered so a user-initiated
  // call is never satisfied by a silent one that is about to fail with `permissionDenied`.
  let inFlight: { prompt: boolean; promise: Promise<AppLocation | null> } | null = null;

  return create<LocationStore>()((set, get) => {
    /** Applies a permission answer to the state without deciding the status. */
    function absorbPermission(permission: PermissionState): void {
      set({ permission: permission.status, canAskAgain: permission.canAskAgain });
    }

    async function resolve(prompt: boolean): Promise<AppLocation | null> {
      set({ status: 'requesting' });
      const result = await service.resolveAutoLocation({ prompt });
      absorbPermission(result.permission);

      if (!result.ok) {
        set({
          status: result.reason === 'permissionDenied' ? 'denied' : 'error',
          error: result.reason,
        });
        return null;
      }

      actions().setLocation(result.location);
      actions().setUseAutoLocation(true);
      set({ status: 'ready', error: null, lastResolvedAt: result.location.resolvedAt });
      // Read back through settings so callers get the sanitized value the app will actually
      // use, not the one we happened to hand over.
      return settings().location ?? result.location;
    }

    /** Runs `resolve` under the single-flight guard. */
    function resolveOnce(prompt: boolean): Promise<AppLocation | null> {
      const pending = inFlight;
      // Reuse only when the in-flight call is at least as capable as this one.
      if (pending !== null && (pending.prompt || !prompt)) return pending.promise;

      const start = (): Promise<AppLocation | null> => {
        const promise = resolve(prompt).finally(() => {
          if (inFlight?.promise === promise) inFlight = null;
        });
        inFlight = { prompt, promise };
        return promise;
      };

      // A prompting call arriving behind a silent one waits for it, then runs for real.
      if (pending !== null) {
        const chained = pending.promise.then(start, start);
        inFlight = { prompt, promise: chained };
        return chained;
      }
      return start();
    }

    return {
      // `ready` at construction when a location was restored from storage: the app can compute
      // times immediately and must not render an empty state while it re-checks the device.
      status: settings().location === null ? 'idle' : 'ready',
      permission: 'undetermined',
      canAskAgain: true,
      error: null,
      lastResolvedAt: settings().location?.resolvedAt ?? null,
      isSearching: false,

      requestAndResolve() {
        return resolveOnce(true);
      },

      refresh({ force = false } = {}) {
        const current = settings();
        // A manually chosen city outranks the device until the user says otherwise.
        if (!current.useAutoLocation) return Promise.resolve(current.location);

        const stored = current.location;
        const isFresh =
          stored !== null &&
          stored.source === 'auto' &&
          now() - stored.resolvedAt < REFRESH_MIN_INTERVAL_MS;
        if (!force && isFresh) return Promise.resolve(stored);

        return resolveOnce(false);
      },

      async syncPermission() {
        const permission = await service.getPermission();
        absorbPermission(permission);
        if (permission.granted) {
          // Granting in the OS settings clears a stale refusal, but does not invent a location.
          if (get().status === 'denied') {
            set({ status: settings().location === null ? 'idle' : 'ready', error: null });
          }
        } else if (get().status !== 'requesting') {
          set({ status: 'denied', error: 'permissionDenied' });
        }
        return permission;
      },

      async searchCity(query, options) {
        set({ isSearching: true });
        try {
          return await service.searchCity(query, options);
        } finally {
          set({ isSearching: false });
        }
      },

      selectManualLocation(location) {
        actions().setLocation({ ...location, source: 'manual', resolvedAt: now() });
        actions().setUseAutoLocation(false);
        set({ status: 'ready', error: null, lastResolvedAt: null });
      },

      clearLocation() {
        actions().setLocation(null);
        set({ status: 'idle', error: null, lastResolvedAt: null });
      },

      reset() {
        set({
          status: settings().location === null ? 'idle' : 'ready',
          permission: 'undetermined',
          canAskAgain: true,
          error: null,
          lastResolvedAt: null,
          isSearching: false,
        });
      },
    };
  });
}

/** The application-wide location store. */
export const useLocationStore = createLocationStore();

/**
 * Reads the location actions outside React (app-foreground handlers, services).
 *
 * @returns The singleton store's action set; identities are stable for the app's lifetime.
 */
export function getLocationActions(): LocationActions {
  return useLocationStore.getState();
}

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------

/** @returns The current flow status (see the module header for what each value means). */
export const useLocationStatus = () => useLocationStore((s) => s.status);

/** @returns `true` while a resolution is in flight — the only legitimate spinner condition. */
export const useIsResolvingLocation = () => useLocationStore((s) => s.status === 'requesting');

/** @returns The machine-readable failure reason of the last attempt, or `null`. */
export const useLocationError = () => useLocationStore((s) => s.error);

/** @returns Permission status plus whether a prompt is still possible. */
export const useLocationPermission = () =>
  useLocationStore(useShallow((s) => ({ permission: s.permission, canAskAgain: s.canAskAgain })));

/** @returns The action set, with stable identities (safe in dependency arrays). */
export const useLocationActions = (): LocationActions =>
  useLocationStore(
    useShallow((s) => ({
      requestAndResolve: s.requestAndResolve,
      refresh: s.refresh,
      syncPermission: s.syncPermission,
      searchCity: s.searchCity,
      selectManualLocation: s.selectManualLocation,
      clearLocation: s.clearLocation,
      reset: s.reset,
    }))
  );
