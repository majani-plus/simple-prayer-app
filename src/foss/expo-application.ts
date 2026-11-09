/**
 * FOSS build stand-in for `expo-application` (aliased by metro.config.js when `FOSS_BUILD=1`).
 *
 * The real module links Google's Play Install Referrer library, which F-Droid does not accept. The
 * app reads only the build number from it (`services/appInfo.ts`), and falls back to
 * `android.versionCode` from the app config, which the FOSS config sets. `expo-notifications` reads
 * `applicationId` and the iOS push environment, but only while getting a push token, which this
 * build never has.
 */
import type * as Application from 'expo-application';

export const applicationId: typeof Application.applicationId = null;

export const nativeApplicationVersion: typeof Application.nativeApplicationVersion = null;

export const nativeBuildVersion: typeof Application.nativeBuildVersion = null;

export const getIosPushNotificationServiceEnvironmentAsync: typeof Application.getIosPushNotificationServiceEnvironmentAsync =
  async () => null;
