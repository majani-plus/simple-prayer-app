import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS asks for reduced motion (spec-accessibility §2.7).
 *
 * Read once and kept in sync with the system setting, so an animation site can degrade to a
 * jump-cut or a cross-fade the moment the user flips the switch — no restart required. The two
 * large animations (the seal morph, the calibration figure-8) established the pattern; this hook
 * is the same logic extracted so the smaller sites (press dip, switch knob, qada fades, ring fill,
 * recalibrate pulse) do not each grow their own copy.
 *
 * A platform that cannot answer is treated as "motion is fine" — the default.
 *
 * ## One source, not one per mount
 *
 * This used to be `useState` + `useEffect` *per component*: an async
 * `AccessibilityInfo.isReduceMotionEnabled()` native round trip, its own `reduceMotionChanged`
 * listener, and its own `setState` when the promise resolved. Today's screen mounts roughly
 * thirty-five consumers (five seals, their option buttons, every `PressableScale`, the rows, the
 * hero, the sheets), so the first paint was followed by thirty-five native calls and thirty-five
 * re-renders — landing in exactly the window where the user's first seal tap arrives.
 *
 * So the value lives at module scope behind `useSyncExternalStore`: **one** probe and **one**
 * listener however many components read it. The native subscription is reference-counted rather
 * than permanent, and dropping to zero consumers resets the cached value to the default, so a
 * later mount re-probes from scratch exactly as a fresh process would. That keeps the hook's
 * observable behaviour identical to the per-instance version — first render says "motion is fine",
 * the real answer lands a microtask later — while the app pays for it once.
 */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The answer every failure mode falls back to: motion is fine. */
const MOTION_IS_FINE = false;

let reduceMotion: boolean = MOTION_IS_FINE;
const consumers = new Set<() => void>();
let systemSubscription: { remove(): void } | null = null;
/** Bumped on every teardown, so a probe that resolves late cannot speak for a newer generation. */
let generation = 0;

/** The current answer. Stable between changes, as `useSyncExternalStore` requires. */
function getSnapshot(): boolean {
  return reduceMotion;
}

/** Publishes a new answer to every consumer, if it is actually new. */
function publish(next: boolean): void {
  if (next === reduceMotion) return;
  reduceMotion = next;
  // A copy: a consumer is free to unsubscribe from inside its own notification.
  for (const notify of [...consumers]) notify();
}

/** Starts the single probe and the single listener. Called on the first consumer. */
function listen(): void {
  const era = generation;
  try {
    systemSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (era !== generation) return;
      publish(enabled);
    });
  } catch {
    // An OS that cannot answer simply gets the full animation.
  }
  try {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (era !== generation) return;
        publish(enabled);
      })
      .catch(() => {
        // Same again: no answer means the default.
      });
  } catch {
    // A synchronous throw from a stubbed platform module is not worth taking the tree down for.
  }
}

/** Releases the listener and forgets the answer. Called when the last consumer goes. */
function teardown(): void {
  generation += 1;
  systemSubscription?.remove();
  systemSubscription = null;
  reduceMotion = MOTION_IS_FINE;
}

function subscribe(onChange: () => void): () => void {
  consumers.add(onChange);
  if (consumers.size === 1) listen();
  return () => {
    consumers.delete(onChange);
    if (consumers.size === 0) teardown();
  };
}

/**
 * Drops the shared probe, the listener and the cached answer. **Tests only** — the module state
 * outlives a single `render`, so a suite that flips the flag would otherwise leak it into the
 * next test.
 */
export function __resetReduceMotionForTests(): void {
  consumers.clear();
  teardown();
}
