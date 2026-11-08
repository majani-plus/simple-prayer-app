/**
 * Reloading the app — the adapter around `expo-updates`.
 *
 * A layout-direction change only takes effect on a fresh JS+native start (see `./direction`), and
 * `Updates.reloadAsync()` is the only supported way to ask for one from inside the app.
 *
 * Three things this module exists to guarantee:
 *
 * 1. **`expo-updates` is required lazily.** Jest must never load it (it pulls a native module),
 *    and — more importantly — the dev client installed on the simulator may not contain it at all.
 *    A top-level `import` would turn "the user picked Arabic" into a hard crash on device. Same
 *    pattern as `services/notifications.ts`, `location.ts` and `heading.ts`.
 * 2. **Unavailability is a normal outcome, not an error.** `reloadAsync` throws
 *    `ERR_UPDATES_DISABLED` whenever the runtime has updates switched off — which is every
 *    development build, and every production build until the project's EAS update config lands.
 *    {@link reloadApp} answers `false` for all of it; the caller then tells the user the change
 *    applies next launch, which is the truth.
 * 3. **It never throws.** The only caller is a settings tap. A settings tap must not be able to
 *    crash the app, whatever the platform decides to do.
 */

/** The one function this module needs from `expo-updates`. */
interface UpdatesModule {
  reloadAsync: () => Promise<void>;
}

/**
 * Loads `expo-updates`, or answers `null` when the runtime does not have it.
 *
 * @returns The module, or `null` on any resolution failure.
 */
function loadUpdates(): UpdatesModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: see docblock
    const module = require('expo-updates') as Partial<UpdatesModule> | undefined;
    if (module === undefined || typeof module.reloadAsync !== 'function') return null;
    return module as UpdatesModule;
  } catch {
    return null;
  }
}

/**
 * Restarts the app so a new layout direction takes effect.
 *
 * @returns `true` when the reload was handed to the platform (in which case this process is on its
 * way out and nothing after the call is guaranteed to run), `false` when the runtime cannot
 * reload — the caller must then tell the user the change applies at the next launch.
 */
export async function reloadApp(): Promise<boolean> {
  const updates = loadUpdates();
  if (updates === null) return false;
  try {
    await updates.reloadAsync();
    return true;
  } catch {
    // ERR_UPDATES_DISABLED (dev client, or a build with no update config), ERR_UPDATES_RELOAD, or
    // a web runtime with no native side at all. All of them mean the same thing to the user.
    return false;
  }
}
