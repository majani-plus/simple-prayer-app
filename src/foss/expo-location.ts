/**
 * FOSS build stand-in for `expo-location` (metro.config.js aliases the package here when
 * `FOSS_BUILD=1`; docs/BUILD_YOURSELF.md).
 *
 * `expo-location` on Android needs Google Play services. This file has the same names and shapes
 * for exactly the calls the app makes (`services/location.ts`, `services/heading.ts`) and answers
 * them from `modules/foss-location`, which uses Android's own `LocationManager`, `Geocoder` and
 * compass sensors. App code does not change. `src/foss/stubs.test.ts` fails if the app starts using
 * a name this file does not have.
 *
 * Coarse location only, as everywhere in the app: the native side asks only for
 * ACCESS_COARSE_LOCATION, never for background location.
 *
 * Only types come from `expo-location`. Importing a value from it would load its native module,
 * which this build does not have.
 */
import { requireNativeModule } from 'expo';
import type * as ExpoLocation from 'expo-location';

/** `modules/foss-location`'s native side. */
interface FossLocationNative {
  getForegroundPermissionsAsync(): Promise<ExpoLocation.LocationPermissionResponse>;
  requestForegroundPermissionsAsync(): Promise<ExpoLocation.LocationPermissionResponse>;
  getCurrentPositionAsync(): Promise<ExpoLocation.LocationObject>;
  getLastKnownPositionAsync(maxAge: number | null): Promise<ExpoLocation.LocationObject | null>;
  geocodeAsync(address: string): Promise<ExpoLocation.LocationGeocodedLocation[]>;
  reverseGeocodeAsync(
    latitude: number,
    longitude: number
  ): Promise<ExpoLocation.LocationGeocodedAddress[]>;
  startHeading(): boolean;
  stopHeading(): void;
  addListener(
    event: 'onHeading',
    listener: (heading: ExpoLocation.LocationHeadingObject) => void
  ): { remove(): void };
}

let cached: FossLocationNative | null = null;
const native = (): FossLocationNative =>
  (cached ??= requireNativeModule<FossLocationNative>('FossLocation'));

/** Same numbers as `expo-location`'s `LocationAccuracy`. The native side always gives a coarse fix. */
export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
} as const;

export const getForegroundPermissionsAsync: typeof ExpoLocation.getForegroundPermissionsAsync =
  () => native().getForegroundPermissionsAsync();

export const requestForegroundPermissionsAsync: typeof ExpoLocation.requestForegroundPermissionsAsync =
  () => native().requestForegroundPermissionsAsync();

/** The options are accepted and ignored: the fix is always coarse, and never prompts for settings. */
export const getCurrentPositionAsync: typeof ExpoLocation.getCurrentPositionAsync = () =>
  native().getCurrentPositionAsync();

export const getLastKnownPositionAsync: typeof ExpoLocation.getLastKnownPositionAsync = (options) =>
  native().getLastKnownPositionAsync(options?.maxAge ?? null);

export const geocodeAsync: typeof ExpoLocation.geocodeAsync = (address) =>
  native().geocodeAsync(address);

export const reverseGeocodeAsync: typeof ExpoLocation.reverseGeocodeAsync = (location) =>
  native().reverseGeocodeAsync(location.latitude, location.longitude);

/**
 * The compass, from the magnetometer and accelerometer, as `expo-location` does it. The app uses this
 * only on phones where `modules/qibla-heading` has no rotation vector sensor.
 */
export const watchHeadingAsync: typeof ExpoLocation.watchHeadingAsync = async (callback) => {
  const module = native();
  const subscription = module.addListener('onHeading', callback);
  if (!module.startHeading()) {
    subscription.remove();
    throw new Error('This phone has no compass');
  }
  return {
    remove() {
      subscription.remove();
      module.stopHeading();
    },
  };
};
