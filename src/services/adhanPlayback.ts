/**
 * Whether an adhan is sounding *inside the app* right now.
 *
 * One boolean, module-scoped, because the two parties are on opposite sides of the tree and
 * neither should learn about the other. `hooks/useAdhanPreview` owns the player and lives on
 * Settings → Reminders; `hooks/useReviewPrompt` is mounted once in `app/_layout.tsx` and needs to
 * know, at the instant it would ask for a review, whether the user is currently listening to the
 * call to prayer. Threading that through a store or a context would put an audio detail into
 * global state for one consumer.
 *
 * ## Why this exists at all
 *
 * PRODUCT_SPEC §13 lists "never during a prayer window or adhan" as a hard exclusion, and until
 * now the second half of that was dead: the adhan reached the user as an OS notification *sound*,
 * which the process cannot observe, so `isAdhanPlaying` was hardcoded `false` and the
 * `quietAfterAdhanMs` period could never open. That was true and documented — and then D78 added
 * the "Hear the adhan" preview (`expo-audio`), which is in-app playback the process observes
 * perfectly well. The comment saying otherwise outlived the fact by a day (D89).
 *
 * It stays a narrow claim: this is **only** the in-app preview. A notification sound firing at
 * Fajr still cannot be seen from here, and `prayerWindowMinutes` remains what actually protects
 * the user on the mat.
 *
 * Not a store, and deliberately not reactive: the only reader polls it at one instant, inside a
 * timer callback. A subscription would buy nothing and cost a render.
 */

let playing = false;
let onStopped: (() => void) | null = null;

/**
 * Registers the one listener notified when a playback ends.
 *
 * The dependency rule is `hooks → services`, so this module cannot reach into the review service
 * to open its quiet period. It offers a hook point instead and `hooks/useReviewPrompt` registers
 * on mount — which also means the exclusion wires itself, and no screen has to remember to.
 *
 * @param listener - Called once per stop, or `null` to clear.
 * @returns A function that removes this listener.
 */
export function observeAdhanStopped(listener: (() => void) | null): () => void {
  onStopped = listener;
  return () => {
    if (onStopped === listener) onStopped = null;
  };
}

/**
 * Reports whether the in-app adhan preview is sounding.
 *
 * @returns `true` while the preview is playing.
 */
export function isAdhanPlaying(): boolean {
  return playing;
}

/**
 * Records that the in-app adhan preview started or stopped.
 *
 * Idempotent, and safe to call during teardown — it touches nothing but this module.
 *
 * @param next - `true` when a recitation is sounding, `false` when it has stopped for any reason.
 * @returns `true` when this call was the stop that ended a playback, which is the caller's cue to
 *   open the quiet period. Returns `false` for a repeat of a state already held.
 */
export function setAdhanPlaying(next: boolean): boolean {
  const stopped = playing && !next;
  playing = next;
  if (stopped) onStopped?.();
  return stopped;
}

/** Test seam: forget any playback state and any listener. Never called by the app. */
export function resetAdhanPlayback(): void {
  playing = false;
  onStopped = null;
}
