/**
 * `watch-sync` — the JS face of the phone↔watch transport (Milestone V).
 *
 * The sixth local module, bound by the same house rules as its siblings: **it never schedules a
 * reminder on the phone**, and it never writes the prayer log. Its whole app-facing surface is a
 * mailbox — the app deposits one JSON envelope (`services/watchEnvelope`), the watches read it:
 *
 * - **iOS** (V2): `WCSession.updateApplicationContext` — latest-value, coalesced, delivered in
 *   the background when the watch is next reachable. Marks travel the OTHER way natively
 *   (`transferUserInfo` → the phone-side session delegate appends `widgetMark:<id>` into the D92
 *   queue); they never come through JS.
 * - **Android** (V2): the Wearable Data Layer (`DataClient.putDataItem`). Marks arrive at a
 *   `WearableListenerService` that appends `mark:<id>` into the same SharedPreferences queue the
 *   notification actions use; the app drains it on the next foreground, as always.
 *
 * Resolved lazily and optionally, exactly like `modules/prayer-widgets`: in Jest, on web, or in a
 * dev client built before the module existed, every call is a silent no-op — a watch is an
 * enhancement, never a dependency.
 */

import { requireOptionalNativeModule } from 'expo';

interface WatchSyncNativeModule {
  /** Ships the envelope JSON toward the paired watch (coalesced; only the latest matters). */
  pushEnvelope(json: string): Promise<void>;
  /** Clears the shipped envelope; the watch falls back to its bundled "open the app" state. */
  clearEnvelope(): Promise<void>;
  /** Whether a watch is paired and the companion app installed (may over-report; a hint only). */
  hasWatch(): Promise<boolean>;
  /** The same two facts kept apart, for the "paired but not installed" case. iOS only. */
  watchState(): Promise<{ paired: boolean; appInstalled: boolean }>;
}

/** What the phone knows about the wrist. Both `false` wherever there is no bridge at all. */
export interface WatchState {
  /** A watch is paired with this phone. */
  paired: boolean;
  /** Our companion app is installed on it. */
  appInstalled: boolean;
}

let cached: WatchSyncNativeModule | null | undefined;

function nativeModule(): WatchSyncNativeModule | null {
  if (cached === undefined) {
    try {
      cached = requireOptionalNativeModule<WatchSyncNativeModule>('WatchSync');
    } catch {
      cached = null;
    }
  }
  return cached ?? null;
}

/** Whether this binary carries the native watch bridge. */
export function isSupported(): boolean {
  return nativeModule() !== null;
}

/**
 * Ships the envelope toward the watch. No-op where unsupported.
 *
 * @param json - The serialized `WatchEnvelope`.
 */
export async function pushEnvelope(json: string): Promise<void> {
  await nativeModule()?.pushEnvelope(json);
}

/** Clears the shipped envelope, flipping the watch to its bundled "open the app" state. */
export async function clearEnvelope(): Promise<void> {
  await nativeModule()?.clearEnvelope();
}

/** Whether a paired watch is known to this device. A hint for skipping work, never a gate. */
export async function hasWatch(): Promise<boolean> {
  return (await nativeModule()?.hasWatch()) ?? false;
}

/**
 * Whether a watch is paired, and whether our app is on it.
 *
 * The gap between those two is the only thing an app can do anything about: **there is no API to
 * install a companion watch app** — watchOS installs it by itself when "Automatic App Install" is
 * on (its default), and otherwise it waits in the Watch app's *Available Apps* list where nobody
 * thinks to look. So the app reads the state and can say so once, plainly.
 *
 * @returns Both facts; `{ paired: false, appInstalled: false }` where there is no bridge (Android,
 *   Jest, a build without the module), which reads as "nothing to say".
 */
export async function watchState(): Promise<WatchState> {
  const native = nativeModule();
  if (native?.watchState === undefined) return { paired: false, appInstalled: false };
  try {
    const state = await native.watchState();
    return { paired: state.paired === true, appInstalled: state.appInstalled === true };
  } catch {
    // An older build of the native module: say nothing rather than guess.
    return { paired: false, appInstalled: false };
  }
}
