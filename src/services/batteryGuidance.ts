/**
 * Android battery-management guidance — the "why did the adhan not fire" layer (PRODUCT_SPEC §11,
 * decision D19).
 *
 * ## The problem this exists for
 *
 * "Notifications did not arrive" is the second most common complaint in the whole category
 * (our market research), and on Android the cause is usually not the app. Several OEMs ship
 * battery managers far more aggressive than stock Android's Doze: Xiaomi's MIUI, Huawei's EMUI,
 * Oppo/Realme's ColorOS, Vivo's FuntouchOS and Samsung's "Put unused apps to sleep" will all stop
 * an app's alarms outright unless the user exempts it by hand, in a settings screen that is not
 * where Google put it. The vendors' own answer — "open the app every few days" — is what we are
 * refusing to ship.
 *
 * So this module does two things and refuses to pretend to do a third:
 *
 * 1. **Name the manufacturer**, so the guidance can say "Xiaomi" instead of "some phones"
 *    ({@link detectOemFamily}). The name is the difference between advice a user can follow and
 *    advice they scroll past.
 * 2. **Open the right screen**, using the stock battery-optimisation intent first and the OEM's
 *    own auto-start manager where one is known ({@link openBatteryOptimisationSettings},
 *    {@link openAutoStartSettings}). Every path degrades: OEM component → stock intent → this
 *    app's system settings page. The user is never left with a dead button.
 * 3. **Read whether the exemption is actually in place** ({@link readExemptionState}) — and say
 *    plainly when it could not be read, rather than guessing from the manufacturer name.
 *
 * ## The exemption state, and what it does *not* mean
 *
 * Android answers this through `PowerManager.isIgnoringBatteryOptimizations(packageName)`, and for
 * a long time nothing in this app's dependency set exposed it — `expo-intent-launcher` can only
 * *start* an activity, and `expo-device`/`expo-notifications` do not read power policy — so
 * {@link readExemptionState} answered `'unknown'` everywhere and the reliability screen had to say
 * "we cannot check this from inside the app".
 *
 * `modules/exact-alarms` now carries that call, and {@link createDefaultExemptionProbe} is where
 * it is plugged into the seam {@link setExemptionProbe} always described. `'unknown'` is still a
 * real answer, for a build without the native module and for a probe that throws: a wrong green
 * tick on that screen is worse than an admission.
 *
 * **What a `'exempt'` answer is worth.** It reads Android's own list and nothing else. MIUI's
 * per-app *Battery saver*, EMUI's protected apps and Samsung's sleeping apps are separate policies
 * with no public API, so on the manufacturers in {@link AGGRESSIVE_OEMS} an exemption is necessary
 * and not sufficient. The screen's copy carries that caveat rather than dropping it.
 *
 * ## The auto-start component names
 *
 * The OEM activities below are undocumented, differ between OS versions, and disappear without
 * notice. Every launch is therefore attempted in order and any failure falls through to the next
 * candidate; a wrong guess costs one rejected intent, not a crash. They are listed as data
 * ({@link AUTO_START_TARGETS}) so a version that breaks can be fixed by editing a table.
 *
 * Dependency rule: `services` may touch platform modules; nothing here imports React, a store or
 * the database. Everything platform-shaped goes through {@link BatteryGuidanceAdapter} so the
 * whole module is testable in plain Jest.
 */

/** The manufacturer families whose battery managers are known to differ from stock Android. */
export type OemFamily =
  | 'xiaomi'
  | 'huawei'
  | 'oppo'
  | 'vivo'
  | 'samsung'
  | 'oneplus'
  | 'other';

/**
 * Families that stop scheduled work by default and need an explicit exemption. Everything else
 * gets the stock guidance, without being accused of something it does not do.
 */
export const AGGRESSIVE_OEMS: ReadonlySet<OemFamily> = new Set<OemFamily>([
  'xiaomi',
  'huawei',
  'oppo',
  'vivo',
  'samsung',
  'oneplus',
]);

/** Substrings matched against `Device.manufacturer` and `Device.brand`, lower-cased. */
const OEM_MARKERS: readonly (readonly [OemFamily, readonly string[]])[] = [
  ['xiaomi', ['xiaomi', 'redmi', 'poco', 'miui']],
  ['huawei', ['huawei', 'honor']],
  // Realme and OnePlus both ship ColorOS derivatives, but OnePlus keeps its own component names.
  ['oppo', ['oppo', 'realme']],
  ['oneplus', ['oneplus', 'one plus']],
  ['vivo', ['vivo', 'iqoo']],
  ['samsung', ['samsung']],
];

/**
 * Maps a device's manufacturer/brand strings onto a known family.
 *
 * Both strings are considered because they disagree often — a Redmi reports `manufacturer`
 * "Xiaomi" and `brand` "Redmi", and some ROMs fill only one of them.
 *
 * @param manufacturer - `Device.manufacturer`, or `null` when unknown.
 * @param brand - `Device.brand`, or `null` when unknown.
 * @returns The matching family, or `'other'` when nothing matches (including on iOS).
 */
export function detectOemFamily(
  manufacturer: string | null | undefined,
  brand: string | null | undefined
): OemFamily {
  const haystack = `${manufacturer ?? ''} ${brand ?? ''}`.toLowerCase();
  if (haystack.trim() === '') return 'other';
  for (const [family, markers] of OEM_MARKERS) {
    if (markers.some((marker) => haystack.includes(marker))) return family;
  }
  return 'other';
}

/** One `(package, class)` pair to try launching. */
export interface AutoStartTarget {
  packageName: string;
  className: string;
}

/**
 * The OEM screens that hold the "let this app run in the background" switch, most likely first.
 *
 * These are not public API. They change between OS versions and they are attempted in order
 * precisely because any one of them may no longer exist.
 */
export const AUTO_START_TARGETS: Readonly<Record<OemFamily, readonly AutoStartTarget[]>> = {
  xiaomi: [
    {
      packageName: 'com.miui.securitycenter',
      className: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
    },
  ],
  huawei: [
    {
      packageName: 'com.huawei.systemmanager',
      className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
    },
    {
      packageName: 'com.huawei.systemmanager',
      className: 'com.huawei.systemmanager.optimize.process.ProtectActivity',
    },
  ],
  oppo: [
    {
      packageName: 'com.coloros.safecenter',
      className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity',
    },
    {
      packageName: 'com.coloros.safecenter',
      className: 'com.coloros.safecenter.startupapp.StartupAppListActivity',
    },
    {
      packageName: 'com.oppo.safe',
      className: 'com.oppo.safe.permission.startup.StartupAppListActivity',
    },
  ],
  vivo: [
    {
      packageName: 'com.vivo.permissionmanager',
      className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity',
    },
  ],
  oneplus: [
    {
      packageName: 'com.oneplus.security',
      className: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity',
    },
  ],
  samsung: [
    {
      packageName: 'com.samsung.android.lool',
      className: 'com.samsung.android.sm.ui.battery.BatteryActivity',
    },
  ],
  other: [],
};

/** Android's stock "apps not optimised for battery" list. Needs no permission to open. */
export const BATTERY_OPTIMISATION_ACTION = 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS';

/** `Intent.ACTION_MAIN`, used when the target is a bare `(package, class)` component. */
const ACTION_MAIN = 'android.intent.action.MAIN';

/** What a "take me there" call did. Never throws; the caller renders the answer. */
export type OpenSettingsResult = 'opened' | 'unavailable';

/** Whether this app is exempt from battery optimisation. See the module header on `'unknown'`. */
export type ExemptionState = 'exempt' | 'restricted' | 'unknown';

/** The platform surface this module uses. Replaceable so every path is testable. */
export interface BatteryGuidanceAdapter {
  readonly platform: 'ios' | 'android' | 'other';
  /** `Device.manufacturer`. */
  manufacturer(): string | null;
  /** `Device.brand`. */
  brand(): string | null;
  /** `IntentLauncher.startActivityAsync`. Rejects when no activity can handle the intent. */
  startActivity(action: string, params?: AutoStartTarget): Promise<void>;
  /** `Linking.openSettings()` — this app's own page in the system settings. */
  openAppSettings(): Promise<void>;
}

let adapter: BatteryGuidanceAdapter | null = null;
let exemptionProbe: (() => Promise<ExemptionState>) | null = null;

/** Builds the real adapter, requiring native modules lazily so importing this file stays cheap. */
function createDefaultAdapter(): BatteryGuidanceAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  const platformOS = RN.Platform.OS;

  return {
    platform: platformOS === 'ios' ? 'ios' : platformOS === 'android' ? 'android' : 'other',
    manufacturer() {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require('expo-device') as typeof import('expo-device')).manufacturer ?? null;
    },
    brand() {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require('expo-device') as typeof import('expo-device')).brand ?? null;
    },
    async startActivity(action, params) {
      const IntentLauncher =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('expo-intent-launcher') as typeof import('expo-intent-launcher');
      await IntentLauncher.startActivityAsync(action, params);
    },
    async openAppSettings() {
      await RN.Linking.openSettings();
    },
  };
}

/** @returns The adapter in use, creating the real one on first call. */
export function getBatteryGuidanceAdapter(): BatteryGuidanceAdapter {
  if (adapter === null) adapter = createDefaultAdapter();
  return adapter;
}

/**
 * Replaces the platform adapter. Tests use this; the app never calls it.
 *
 * @param next - The adapter to install, or `null` to fall back to the real one.
 */
export function setBatteryGuidanceAdapter(next: BatteryGuidanceAdapter | null): void {
  adapter = next;
}

/**
 * The real probe, over `modules/exact-alarms`.
 *
 * The native module is `require`d lazily, exactly as {@link createDefaultAdapter} requires its
 * own, so importing this file stays safe under Jest and in node scripts. A build without the
 * module answers `null`, which becomes `'unknown'` rather than `'restricted'` — nobody is told
 * their reminders are restricted on the strength of a question that was never asked.
 *
 * It lives in `modules/exact-alarms` rather than a module of its own because that module already
 * is "read the OS flags that decide whether a reminder is on time, and open the screens that
 * change them"; see its Kotlin header.
 *
 * @returns A probe that reads Android's battery-optimisation exemption list.
 */
function createDefaultExemptionProbe(): () => Promise<ExemptionState> {
  return async () => {
    const native =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../modules/exact-alarms') as typeof import('../../modules/exact-alarms');
    const exempt = await native.isIgnoringBatteryOptimizations();
    if (exempt === null) return 'unknown';
    return exempt ? 'exempt' : 'restricted';
  };
}

/**
 * Replaces the probe that answers "are we exempt from battery optimisation". Tests use this; the
 * app never calls it.
 *
 * @param probe - The probe to install, or `null` to fall back to the real one
 *                ({@link createDefaultExemptionProbe}) — the same contract as
 *                {@link setBatteryGuidanceAdapter}.
 */
export function setExemptionProbe(probe: (() => Promise<ExemptionState>) | null): void {
  exemptionProbe = probe;
}

/**
 * Whether this app is currently exempt from battery optimisation.
 *
 * Reads Android's own exemption list only — see the module header on why that is necessary and not
 * sufficient on the aggressive manufacturers.
 *
 * @returns `'unknown'` on every non-Android platform and on any build whose binary has no native
 *          module. A failing probe also answers `'unknown'` rather than throwing.
 */
export async function readExemptionState(): Promise<ExemptionState> {
  if (getBatteryGuidanceAdapter().platform !== 'android') return 'unknown';
  if (exemptionProbe === null) exemptionProbe = createDefaultExemptionProbe();
  try {
    return await exemptionProbe();
  } catch {
    return 'unknown';
  }
}

/** The device's manufacturer family, as {@link detectOemFamily} reads it. */
export function currentOemFamily(): OemFamily {
  const platform = getBatteryGuidanceAdapter();
  if (platform.platform !== 'android') return 'other';
  try {
    return detectOemFamily(platform.manufacturer(), platform.brand());
  } catch {
    return 'other';
  }
}

/** Whether this device's manufacturer is one of the known-aggressive families. */
export function hasAggressiveBatteryManager(family: OemFamily = currentOemFamily()): boolean {
  return AGGRESSIVE_OEMS.has(family);
}

/**
 * Opens Android's own "apps not optimised for battery" list, falling back to this app's system
 * settings page when the device has no such screen.
 *
 * The stock list is used rather than `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`: the direct request
 * needs a Play-restricted permission that a prayer-times app has no business holding, and the
 * list gets the user to the same switch in one more tap.
 *
 * @returns `'opened'` when something was shown, `'unavailable'` when nothing could be.
 */
export async function openBatteryOptimisationSettings(): Promise<OpenSettingsResult> {
  const platform = getBatteryGuidanceAdapter();
  if (platform.platform !== 'android') return 'unavailable';

  try {
    await platform.startActivity(BATTERY_OPTIMISATION_ACTION);
    return 'opened';
  } catch {
    // Some ROMs have removed the stock screen; the app's own settings page always exists.
  }
  try {
    await platform.openAppSettings();
    return 'opened';
  } catch {
    return 'unavailable';
  }
}

/**
 * Opens the manufacturer's auto-start / background-activity manager.
 *
 * Each candidate in {@link AUTO_START_TARGETS} is tried in turn — these components are
 * undocumented and version-specific — and the stock battery screen catches whatever is left.
 *
 * @param family - Which manufacturer's screens to try. Defaults to the current device's.
 * @returns `'opened'` when something was shown, `'unavailable'` when nothing could be.
 */
export async function openAutoStartSettings(
  family: OemFamily = currentOemFamily()
): Promise<OpenSettingsResult> {
  const platform = getBatteryGuidanceAdapter();
  if (platform.platform !== 'android') return 'unavailable';

  for (const target of AUTO_START_TARGETS[family]) {
    try {
      await platform.startActivity(ACTION_MAIN, target);
      return 'opened';
    } catch {
      // Wrong component for this OS version: try the next one, then the stock screen.
    }
  }
  return await openBatteryOptimisationSettings();
}
