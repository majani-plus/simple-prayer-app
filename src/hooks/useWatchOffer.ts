/**
 * What the phone can offer somebody with a watch: the one place Settings and first-run setup ask.
 *
 * ## iOS: a hint, not an install
 *
 * There is **no API to install a companion watch app**, on any iOS version. A watch app embedded
 * in the phone app is installed by watchOS itself, and only when *Automatic App Install* is on in
 * the iPhone's Watch app. That setting is on by default, so most people never think about it —
 * but somebody who turned it off, or who paired a watch after installing the app, ends up with the
 * app on the phone and nothing on the wrist, with no reason to suspect there is anything to find.
 * Apple offers no URL that opens the Watch app on our page either, so the honest maximum is to
 * notice the gap and say where the switch lives.
 *
 * ## Android: open the listing on the watch
 *
 * The Wear OS app and the Manuscript face are separate Play listings. The phone can open either
 * ON the watch (`openOnWatch`), never on the phone: the owner already installed the phone app from
 * Play and should not be sent back there (owner, 2026-11-23). The phone cannot tell whether our
 * app is already on the watch, so the offer stands while a watch is connected; opening a listing
 * that is already installed costs nothing.
 *
 * ## When it may speak
 *
 * Only when a watch is genuinely there. Not while the answer is unknown (no bridge, session still
 * activating, tests) — an app that guesses here would tell somebody with no watch at all to go and
 * install something. Never in the FOSS build: it ships outside Play, without the Wear apps.
 *
 * It lives in Settings and in first-run setup, never on Today: the reward loop is never
 * interrupted by housekeeping, and someone who does not care about the watch never meets this.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { hasWatch, openOnWatch, watchState, type WatchState } from '../../modules/watch-sync';
import { isFossBuild, WATCH_LISTINGS } from '@/services/appInfo';

/** What to offer: the Android listings, the iOS hint, or nothing. */
export type WatchOffer = 'android' | 'ios' | null;

/** Whether the iOS "install it on your watch" hint applies to this state. Pure; tested. */
export function shouldOfferWatchInstall(state: WatchState | null): boolean {
  if (state === null) return false;
  return state.paired && !state.appInstalled;
}

/**
 * The whole decision, pure and tested. Anything unknown (`null`) offers nothing.
 *
 * @param input.androidHasWatch - Android: whether a watch is connected; `null` while unread.
 * @param input.iosState - iOS: the paired/installed state; `null` while unread.
 */
export function decideWatchOffer(input: {
  foss: boolean;
  platform: string;
  androidHasWatch: boolean | null;
  iosState: WatchState | null;
}): WatchOffer {
  if (input.foss) return null;
  if (input.platform === 'android') return input.androidHasWatch === true ? 'android' : null;
  if (input.platform === 'ios') return shouldOfferWatchInstall(input.iosState) ? 'ios' : null;
  return null;
}

/**
 * Reads the watch once per mount.
 *
 * @returns The offer, or `null` while the answer is unknown and whenever there is nothing to offer.
 */
export function useWatchOffer(): WatchOffer {
  const [offer, setOffer] = useState<WatchOffer>(null);

  useEffect(() => {
    const foss = isFossBuild();
    if (foss) return;
    let alive = true;
    const platform = Platform.OS;
    const read: Promise<WatchOffer> =
      platform === 'android'
        ? hasWatch().then((connected) =>
            decideWatchOffer({ foss, platform, androidHasWatch: connected, iosState: null })
          )
        : watchState().then((state) =>
            decideWatchOffer({ foss, platform, androidHasWatch: null, iosState: state })
          );
    void read
      .catch(() => null)
      .then((next) => {
        if (alive) setOffer(next);
      });
    return () => {
      alive = false;
    };
  }, []);

  return offer;
}

/** Which Play listing: the Wear OS app or the Manuscript face. */
export type WatchListing = keyof typeof WATCH_LISTINGS;

/** What happened the last time a listing was opened: it reached the watch, or it did not. */
export type WatchOpenResult = 'sent' | 'failed';

/**
 * Opens a listing on the watch and remembers how it went, per listing, for the inline line under
 * the button (no toast).
 */
export function useOpenOnWatch(): {
  results: Partial<Record<WatchListing, WatchOpenResult>>;
  open: (listing: WatchListing) => void;
} {
  const [results, setResults] = useState<Partial<Record<WatchListing, WatchOpenResult>>>({});
  const open = useCallback((listing: WatchListing) => {
    void openOnWatch(WATCH_LISTINGS[listing]).then((sent) => {
      setResults((previous) => ({ ...previous, [listing]: sent ? 'sent' : 'failed' }));
    });
  }, []);
  return { results, open };
}
