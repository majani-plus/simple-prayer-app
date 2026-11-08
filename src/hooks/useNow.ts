import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

/**
 * A ticking clock. Returns the current `Date`, refreshed on every `intervalMs` boundary.
 *
 * This drives the live countdown on Today, so it is careful about three things:
 *
 * 1. **Boundary alignment.** Each tick is scheduled for the next multiple of `intervalMs` on the
 *    wall clock rather than `intervalMs` after the previous one, so a one-second clock flips when
 *    the second actually changes and never drifts.
 * 2. **Backgrounding.** Timers are torn down when the app goes to the background (a paused clock
 *    cannot keep re-rendering a screen nobody is looking at, and OS timer throttling makes them
 *    unreliable anyway) and re-armed on return — with an immediate resync, since an arbitrary
 *    amount of time has passed. Only `background` pauses: iOS reports `inactive` for transient
 *    interruptions such as the app switcher or a Control Center pull, where the UI is still
 *    visible and should keep ticking.
 * 3. **Cleanup.** The pending timeout and the AppState subscription are always released, so no
 *    timer survives an unmount.
 *
 * Because every tick returns a new `Date`, mount this as close to the text that displays it as
 * possible (e.g. inside the countdown component, not in the screen that renders the prayer list).
 *
 * @param intervalMs - Tick period in milliseconds; defaults to one second. Non-finite or
 * non-positive values fall back to one second.
 * @returns The current time, stable between ticks.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const period = Number.isFinite(intervalMs) && intervalMs >= 1 ? Math.floor(intervalMs) : 1000;

    let timeout: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const schedule = () => {
      // Delay to the next boundary; always in (0, period], never 0 (which would spin).
      const delay = period - (Date.now() % period);
      timeout = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };

    const start = (resync: boolean) => {
      clear();
      if (resync) setNow(new Date());
      schedule();
    };

    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'background') clear();
      else start(true);
    };

    const subscription: NativeEventSubscription = AppState.addEventListener(
      'change',
      handleAppStateChange
    );

    // Mounting while backgrounded (e.g. a headless re-render) must not arm a timer.
    if (AppState.currentState !== 'background') start(false);

    return () => {
      clear();
      subscription.remove();
    };
  }, [intervalMs]);

  return now;
}
