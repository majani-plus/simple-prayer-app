/**
 * Opt-in timing marks for the seal tap (D191).
 *
 * Off unless the build was made with `EXPO_PUBLIC_PERF_MARKS=1`. When on, each mark is one
 * `console.log` line, `PERF <label> +<ms since the tap>`, read with `adb logcat | grep PERF`.
 * Nothing is stored and nothing leaves the device: the app has no analytics, and this is not one.
 *
 * The variable is read literally (`process.env.EXPO_PUBLIC_…`) because Expo inlines it at build
 * time only in that form; a normal build therefore carries a constant `false` here.
 */

const enabled = process.env.EXPO_PUBLIC_PERF_MARKS === '1';

let tapAt = 0;

/** Logs one mark, timed from the last {@link markTap}. A no-op unless marks are switched on. */
export function perfMark(label: string): void {
  if (!enabled) return;
  console.log(`PERF ${label} +${(performance.now() - tapAt).toFixed(1)}ms`);
}

/** Starts a tap's timeline, and marks the first frame after it. */
export function markTap(): void {
  if (!enabled) return;
  tapAt = performance.now();
  perfMark('tap');
  requestAnimationFrame(() => perfMark('frame'));
}
