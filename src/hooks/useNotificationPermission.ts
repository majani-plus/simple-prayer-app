/**
 * `useNotificationPermission` — the OS notification permission, as component state.
 *
 * Exists for the reminder affordances that live *outside* Settings → Reminders (today the hero's
 * `ReminderPill`): they must render honestly against the real permission and be able to ask for
 * it at the moment the user expresses intent (spec-accessibility §4.1). The rules it encodes:
 *
 * - **Reading never prompts.** The permission is read on mount and re-read on every foreground —
 *   returning from the system settings is the one moment a refusal becomes a grant without the
 *   app doing anything.
 * - **Asking is explicit.** {@link NotificationPermissionControl.request} is only ever wired to a
 *   tap (PRODUCT_SPEC §11: never on launch), is guarded against double-taps, and never rejects.
 * - **A grant schedules immediately.** The user just said "yes" to being reminded; making them
 *   wait for the next foreground sync would look like the answer was ignored. This is the same
 *   post-grant sync Settings → Reminders performs.
 *
 * The permission starts as `null` — "not read yet". Callers should treat `null` as "assume the
 * happy path" rather than flashing a warning at every mount: the read resolves within
 * milliseconds, and on the platforms without notifications it never resolves into a denial the
 * user could act on anyway.
 *
 * Dependency rule: `hooks → services + stores`. No user-facing strings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import { syncNotificationsFromStores } from './useNotificationSync';

import { getNotificationService, type NotificationPermission } from '@/services/notifications';

/** What a reminder affordance needs to render honestly and ask at the right moment. */
export interface NotificationPermissionControl {
  /** The current permission, or `null` while the first read is still in flight. */
  permission: NotificationPermission | null;
  /**
   * Shows the OS permission dialog, then reconciles the schedule if the answer was yes. Call
   * only from an explicit user action. Fire-and-forget; a second call while one is in flight is
   * ignored, so a double tap cannot produce two dialogs.
   */
  request: () => void;
  /** Deep-links to the system settings, for when the OS will no longer show its dialog. */
  openSystemSettings: () => void;
}

/**
 * Reads (and re-reads on foreground) the notification permission, and exposes the two ways a
 * user action can change it.
 *
 * @returns See {@link NotificationPermissionControl}.
 */
export function useNotificationPermission(): NotificationPermissionControl {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  // Ref rather than state: the second tap of a double tap can arrive in the same frame, before
  // React has re-rendered with any flag set (the same guard Settings → Reminders uses).
  const askingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const read = (): void => {
      void getNotificationService()
        .getPermission()
        .then((next) => {
          if (mountedRef.current) setPermission(next);
        })
        .catch(() => {
          // An unreadable permission stays `null`; the caller renders the happy path.
        });
    };

    read();
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') read();
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, []);

  const request = useCallback(() => {
    if (askingRef.current) return;
    askingRef.current = true;
    void (async () => {
      try {
        const next = await getNotificationService().requestPermission();
        if (mountedRef.current) setPermission(next);
        // The first "yes" must schedule something immediately, not at the next foreground.
        if (next.granted) await syncNotificationsFromStores();
      } catch {
        // `requestPermission` swallows expected failures already; anything left is not fatal.
      } finally {
        askingRef.current = false;
      }
    })();
  }, []);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      // Some OEM builds refuse the deep link. Nothing else depends on it.
    });
  }, []);

  return { permission, request, openSystemSettings };
}
