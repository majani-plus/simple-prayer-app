import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { Dimensions, Platform, type ScaledSize } from 'react-native';

import { breakpoints } from '@/theme';

/** A screen's measurements, as `Dimensions.get('screen')` reports them. */
export interface ScreenSize {
  width: number;
  height: number;
}

/**
 * Whether a device whose physical screen measures this much may rotate (D123).
 *
 * The test is the *smallest* dimension, not the current width: it asks "is this a big screen",
 * which is a fact about the hardware and cannot flip when the user turns the device or takes half
 * of it away. A tablet in a half-width split is still a tablet and stays unlocked; a phone is
 * narrow whichever way up it is held.
 *
 * @param screen - The display's size in points — `Dimensions.get('screen')`, never `'window'`.
 */
export function orientationPolicy(screen: ScreenSize): 'unlock' | 'portrait' {
  return Math.min(screen.width, screen.height) >= breakpoints.medium ? 'unlock' : 'portrait';
}

/**
 * Lets big Android screens rotate, and keeps phones portrait (D123).
 *
 * iOS needs none of this — the plist decides, and prebuild writes iPhone portrait plus iPad
 * all-four from `supportsTablet`. Android has no such per-form-factor switch: `screenOrientation`
 * in the manifest takes no resource qualifier, so it is set to `portrait` there (a phone must not
 * be able to flash a rotated frame before JS has loaded) and lifted here for the devices that
 * deserve it. The manifest is the floor; this is the exception.
 *
 * Re-evaluated on every screen-dimension change, because that is how a foldable reports the hinge:
 * unfolding swaps the display and the policy has to follow, and folding again re-locks — otherwise
 * a device left in landscape would fold into a sideways phone.
 *
 * Mounted once, at the root. Failures are swallowed: an OS that will not take the request simply
 * keeps whatever orientation it was already in, which is the manifest's portrait.
 */
export function useOrientationPolicy(): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let current: 'unlock' | 'portrait' | null = null;

    function apply(screen: ScreenSize): void {
      const next = orientationPolicy(screen);
      if (next === current) return;
      current = next;
      const request =
        next === 'unlock'
          ? ScreenOrientation.unlockAsync()
          : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      void request.catch(() => {
        // A device that refuses the request keeps the manifest's portrait. Nothing to recover.
        current = null;
      });
    }

    apply(Dimensions.get('screen'));
    const subscription = Dimensions.addEventListener('change', ({ screen }: { screen?: ScaledSize }) => {
      if (screen) apply(screen);
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
