/**
 * "Your watch is here, the app is not" — the one thing the phone can do about a missing watch app.
 *
 * ## Why a hint and not an install
 *
 * There is **no API to install a companion watch app**, on any iOS version. A watch app embedded
 * in the phone app is installed by watchOS itself, and only when *Automatic App Install* is on in
 * the iPhone's Watch app. That setting is on by default, so most people never think about it —
 * but somebody who turned it off, or who paired a watch after installing the app, ends up with the
 * app on the phone and nothing on the wrist, with no reason to suspect there is anything to find.
 * Apple offers no URL that opens the Watch app on our page either, so the honest maximum is to
 * notice the gap and say where the switch lives.
 *
 * ## When it may speak
 *
 * Only when a watch is genuinely paired AND our app is genuinely absent from it. Not while the
 * answer is unknown (no bridge, session still activating, Android, tests) — an app that guesses
 * here would tell somebody with no watch at all to go and install something.
 *
 * It lives in Settings rather than on Today: the reward loop is never interrupted by housekeeping,
 * and someone who does not care about the watch never meets this.
 */

import { useEffect, useState } from 'react';

import { watchState, type WatchState } from '../../modules/watch-sync';

/** Whether the "install it on your watch" row should appear for this state. Pure; tested. */
export function shouldOfferWatchInstall(state: WatchState | null): boolean {
  if (state === null) return false;
  return state.paired && !state.appInstalled;
}

/**
 * Reads the watch state once per mount.
 *
 * @returns `true` only while a paired watch is missing our app.
 */
export function useWatchInstallHint(): boolean {
  const [state, setState] = useState<WatchState | null>(null);

  useEffect(() => {
    let alive = true;
    void watchState().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return shouldOfferWatchInstall(state);
}
