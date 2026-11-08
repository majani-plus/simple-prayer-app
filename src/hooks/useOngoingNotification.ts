/**
 * `useOngoingNotification` — the clock behind the Android ongoing notification (PRODUCT_SPEC §11,
 * decision D27).
 *
 * `services/notifications` presents the notification as part of every sync, and
 * `services/ongoingNotification` decides what it says. Neither knows *when* the thing it says
 * stops being true. That is this module: a self-rearming timer aimed at the next moment the
 * notification's wording changes — the prayer transition itself, and the coarse checkpoints
 * before it (`ONGOING_LEAD_CHECKPOINTS_MS`).
 *
 * ## Why this is not part of `useNotificationSync`
 *
 * That controller's timers exist to keep the *schedule* correct, and the schedule only changes at
 * the day rollover. The ongoing notification is a different clock: it changes five times a day
 * plus a handful of checkpoints, and only while the user has actually asked for it. Wiring it
 * into the rollover timer would either redraw far too rarely (once a day) or force the schedule
 * sync to run on a cadence it has no reason to.
 *
 * When the timer fires it runs a **full sync** rather than presenting the notification directly.
 * A sync in the steady state issues zero platform calls for the scheduled notifications — the
 * diff finds nothing to do — so the only thing it actually changes is the ongoing notification.
 * That keeps a single code path posting it, which is what makes "it never appears on iOS" and
 * "it disappears when the setting is off" true by construction rather than by repetition.
 *
 * ## Cost
 *
 * Off by default, and while off this controller arms nothing at all. While on it wakes at most
 * five times per prayer window — roughly twenty-five times a day — and never on a fixed interval.
 * It does **not** tick: see `services/ongoingNotification` for why the title carries a clock time
 * and the body an approximation.
 *
 * Timers do not run while the process is asleep, so a redraw that was due during a long sleep
 * simply happens on the next foreground; `AppState` is a trigger here for exactly that reason.
 *
 * Dependency rule: `hooks → stores + services + domain`. No user-facing strings.
 */

import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import {
  MAX_TIMER_MS,
  buildSyncInput,
  loggedStatusMap,
  syncNotificationsFromStores,
  trackingSignature,
  type NotificationSyncOptions,
} from './useNotificationSync';
import i18n from '@/i18n';
import { nextOngoingRefreshAt, selectOngoingState } from '@/services/ongoingNotification';
import { getSettingsSnapshot, useSettingsStore } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';

/** Options for {@link startOngoingNotificationRefresh} and {@link useOngoingNotification}. */
export interface UseOngoingNotificationOptions extends NotificationSyncOptions {
  /**
   * Which platform to behave as. Defaults to the real one. The ongoing notification is Android
   * only — iOS gets a Live Activity after v1 (D27) — so on anything else this controller arms
   * nothing and subscribes to nothing.
   */
  platform?: typeof Platform.OS;
  /**
   * What a redraw does. Defaults to a full sync from the stores, which is what re-posts the
   * notification. Injected by tests.
   */
  refresh?: () => Promise<unknown>;
}

/**
 * Starts redrawing the ongoing notification at the right moments. No React in it, so it can be
 * driven from a test (or, later, a background task) without a renderer.
 *
 * @param options - See {@link UseOngoingNotificationOptions}.
 * @returns The stop function: clears the timer and drops both subscriptions.
 */
export function startOngoingNotificationRefresh(
  options: UseOngoingNotificationOptions = {}
): () => void {
  const {
    platform = Platform.OS,
    planDays,
    now,
    refresh = () => syncNotificationsFromStores({ service: options.service, planDays, now }),
  } = options;

  // iOS and web never show this notification, so they never need the clock either.
  if (platform !== 'android') return () => undefined;

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Epoch ms the currently armed timer is aiming at, so a re-arm for the same instant is free. */
  let armedFor: number | null = null;

  const clock = (): Date => now?.() ?? new Date();

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    armedFor = null;
  };

  /**
   * The next instant the notification's wording changes, or `null` when there is nothing to
   * redraw (the setting is off, there is no location yet, or the planned window is exhausted).
   */
  const nextRedrawAt = (): Date | null => {
    if (!getSettingsSnapshot().persistentNotificationEnabled) return null;

    const at = clock();
    const tracking = useTrackingStore.getState();
    const input = buildSyncInput({
      now: at,
      settings: getSettingsSnapshot(),
      todayDay: tracking.todayDay(),
      planDays,
      isExemptDay: (day) => tracking.isExemptDay(day),
      statusesFor: (day) => tracking.dayRecordFor(day).statuses,
      locale: i18n.language,
    });
    if (input === null) return null;

    const state = selectOngoingState(input.days, at, {
      statuses: input.statuses,
      exemptDays: input.exemptDays,
    });
    return state === null ? null : nextOngoingRefreshAt(state, at);
  };

  /** Redraws now, then aims at whatever comes next. */
  const fire = (): void => {
    if (disposed) return;
    clear();
    void Promise.resolve(refresh())
      .catch(() => {
        // A failed redraw is reported inside the sync outcome; the next trigger tries again.
      })
      .finally(() => {
        // Re-arm from the *new* now, which is what advances to the following checkpoint.
        arm();
      });
  };

  function arm(): void {
    if (disposed) return;

    const target = nextRedrawAt();
    if (target === null) {
      clear();
      return;
    }
    // Already aiming there: re-arming would only reset the same countdown.
    if (armedFor === target.getTime() && timer !== null) return;

    clear();
    armedFor = target.getTime();

    // Long waits are split into chunks re-armed from the real clock: a device that slept through
    // a three-hour timer would otherwise fire it late and by an unknowable amount.
    const tick = (): void => {
      if (disposed || armedFor === null) return;
      const remaining = armedFor - clock().getTime();
      if (remaining > 0) {
        timer = setTimeout(tick, Math.min(remaining, MAX_TIMER_MS));
        return;
      }
      fire();
    };
    tick();
  }

  arm();

  const appState = AppState.addEventListener('change', (status) => {
    if (status !== 'active') return;
    // A redraw that fell due while the process was frozen is delivered *now*, not silently
    // deferred to the next checkpoint — the user is looking at the notification this second, and
    // a stale remainder is exactly what this screen exists to prevent.
    if (armedFor !== null && clock().getTime() >= armedFor) fire();
    else arm();
  });

  // Turning the setting on arms the clock; turning it off (or moving city, which moves every
  // prayer time) re-aims it. `arm` is idempotent for an unchanged target, so this is cheap.
  const unsubscribeSettings = useSettingsStore.subscribe(() => arm());

  // A log moves the notification's whole timetable, because it moves the notification's subject:
  // marking Dhuhr flips it from "Now: Dhuhr", which wakes once at Asr, to "Next: Asr", which wants
  // the checkpoints on the way there (`services/ongoingNotification`, D83). Re-aiming is all that
  // is needed — the redraw itself comes from `useNotificationSync`, which is already subscribed
  // here and would otherwise post the same notification twice.
  //
  // The signature is what keeps this off the hot path: the tracking store bumps its revision every
  // time a day is read into cache, and only a genuine change of what is logged reaches `arm`.
  let settle: ReturnType<typeof setTimeout> | null = null;
  let trackingSeen = trackingSignature({
    logged: loggedStatusMap(useTrackingStore.getState().dayRecords),
    exemptPeriods: useTrackingStore.getState().exemptPeriods,
  });
  const unsubscribeTracking = useTrackingStore.subscribe((state) => {
    const signature = trackingSignature({
      logged: loggedStatusMap(state.dayRecords),
      exemptPeriods: state.exemptPeriods,
    });
    if (signature === trackingSeen) return;
    trackingSeen = signature;
    // After the taps stop (D197): `arm` plans days of prayer times on the JS thread, and a second
    // of delay on the ongoing notification's wording is invisible next to a seal that stutters.
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      arm();
    }, 1000);
  });

  return () => {
    disposed = true;
    clear();
    if (settle !== null) clearTimeout(settle);
    appState.remove();
    unsubscribeSettings();
    unsubscribeTracking();
  };
}

/**
 * Keeps the Android ongoing notification's wording current.
 *
 * Call it once from the root layout, beside `useNotificationSync` — the notification outlives any
 * single screen, so no screen owns it. Renders nothing, returns nothing, and does nothing at all
 * on iOS or while the setting is off.
 *
 * @param options - See {@link UseOngoingNotificationOptions}. Pass stable values: a fresh object
 * each render would restart the controller.
 */
export function useOngoingNotification(options: UseOngoingNotificationOptions = {}): void {
  const { service, planDays, now, platform, refresh } = options;

  useEffect(
    () => startOngoingNotificationRefresh({ service, planDays, now, platform, refresh }),
    [service, planDays, now, platform, refresh]
  );
}
