/**
 * App identity: the version, and every URL and proper noun the About screen has to show.
 *
 * Three reasons this is one small module rather than constants scattered through screens:
 *
 * 1. **The store link is a product decision, not a detail.** PRODUCT_SPEC §13 forbids wiring the
 *    "Rate the app" row to `expo-store-review`: the in-app review API has an OS-enforced quota
 *    (three prompts per year on iOS) that a button press would silently burn, and Google's policy
 *    explicitly forbids attaching a call-to-action to it. A row the user *chose* to tap must
 *    therefore open the store's own write-a-review page. The API is reserved for the behavioural
 *    triggers arriving in M9 — a different code path, in a different module.
 * 2. **Credits are obligations.** The typeface licences have to be on screen and have to stay
 *    accurate; keeping their URLs and their proper nouns in one auditable place is how they stay
 *    that way. (The adhan credit is the reciters' names — see the note below.)
 * 3. **Proper nouns are not translatable copy.** "Lora", "Cyreal", "Material Symbols" are names,
 *    and a name that gets translated stops being checkable — the same reason
 *    `src/i18n/__tests__/locales.test.ts` exempts the calculation authorities from its
 *    "is actually translated" rule. They live here as data; the prose around them lives in i18n.
 *
 * Pure and platform-free: {@link storeReviewUrl} takes the platform as an argument rather than
 * reading `Platform.OS`, so both stores are testable from plain Jest and this module stays free of
 * React Native (`services → domain`). Only {@link appVersion} / {@link appBuild} touch a native
 * module, lazily and defensively.
 */

/** The bundle id / package name, shared by both platforms (docs/DECISIONS.md D21). */
export const APP_PACKAGE_NAME = 'app.simpleprayer';

/** The owner's domain (D21): support page and privacy policy. */
export const APP_WEBSITE_URL = 'https://simpleprayer.app';

/**
 * The App Store's numeric id (App Store Connect → App Information → Apple ID). Set once the
 * listing existed; {@link storeReviewUrl} uses it to build the write-a-review deep link.
 */
export const IOS_APP_STORE_ID: string | null = '6803004652';

/**
 * Where "Ask for a feature" goes (D87). A public Featurebase board: anyone can read what has been
 * asked for without an account, and adding to it may ask for a sign-in.
 *
 * It is deliberately somewhere else, on somebody else's domain. The site cannot host it — the
 * rules in docs/WEBSITE.md forbid forms and third-party embeds, and the deployed CSP
 * (`default-src 'none'; connect-src 'none'; form-action 'none'`) enforces that — and the app must
 * not host it either, because the pledge in Settings names exactly three things that ever leave
 * the phone and a fourth would have to be added to it, to the privacy policy and to both stores'
 * data-safety answers. Opening a URL in the user's browser adds none of that: it is the same
 * hand-off {@link APP_WEBSITE_URL} and {@link storeReviewUrl} already make.
 *
 * Nullable so the row disappears cleanly if the board ever goes away.
 */
export const FEEDBACK_URL: string | null = 'https://simpleprayer.featurebase.app/';

// The adhan recordings have no constants here, and that absence is the point: the four shipped
// from 2026-08-20 carry no located licence and no canonical source page (assets/audio/CREDITS.md),
// so there is nothing for the About screen to link. Credit is the reciters' names, which are
// proper nouns and therefore live in the locale files — written in Arabic script in the Arabic
// bundle. The `ADHAN_SOURCE_*` and `CC0_LICENSE_*` constants that used to sit here belonged to the
// CC0 recording removed on the same day, and went with it (D81).

/** The SIL Open Font License 1.1 — Lora, Amiri and Noto Naskh Arabic. */
export const OFL_LICENSE_URL = 'https://openfontlicense.org/';

/** The Apache License 2.0 — the Material Symbols glyphs. */
export const APACHE_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

/** One bundled typeface: its name, who made it, and the licence text it ships under. */
export interface BundledFont {
  /** Family name as the foundry writes it. */
  name: string;
  /** Designer or foundry. */
  author: string;
  /** The licence's canonical text. */
  licenseUrl: string;
}

/**
 * The three faces in `assets/fonts` + the two Google-hosted families loaded at startup, in the
 * order the About screen lists them: the Latin text face, the Arabic ones, then the icons.
 */
export const BUNDLED_FONTS: readonly BundledFont[] = [
  { name: 'Lora', author: 'Cyreal', licenseUrl: OFL_LICENSE_URL },
  { name: 'Amiri', author: 'Khaled Hosny', licenseUrl: OFL_LICENSE_URL },
  { name: 'Noto Naskh Arabic', author: 'The Noto Project Authors', licenseUrl: OFL_LICENSE_URL },
  { name: 'Material Symbols', author: 'Google', licenseUrl: APACHE_LICENSE_URL },
];

/** Loads `expo-constants` lazily; `null` when it is unavailable (plain Jest, a script). */
function constants(): typeof import('expo-constants').default | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-constants') as typeof import('expo-constants')).default;
  } catch {
    return null;
  }
}

/** Loads `expo-application` lazily, on the same terms as {@link constants}. */
function application(): typeof import('expo-application') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-application') as typeof import('expo-application');
  } catch {
    return null;
  }
}

/**
 * Stands in for the version when the config cannot be read. A sentinel rather than `null` because
 * both callers need *a* string — the file header of an export says "unknown" rather than nothing —
 * and the About screen compares against it to switch to its "version unavailable" line.
 */
export const UNKNOWN_VERSION = 'unknown';

/**
 * The version string from `app.json` (`expo.version`).
 *
 * Every failure degrades to {@link UNKNOWN_VERSION}: an About screen that cannot state the version
 * is a small disappointment, but one that throws is a crash in the screen people open when
 * something is already wrong.
 *
 * @returns e.g. `"0.1.0"`, or {@link UNKNOWN_VERSION}.
 */
export function appVersion(): string {
  return constants()?.expoConfig?.version ?? UNKNOWN_VERSION;
}

/**
 * The store build number — `CFBundleVersion` on iOS, `versionCode` on Android.
 *
 * Read from the **binary**, not from the app config, because the app config is only sometimes
 * telling the truth. `eas.json`'s `appVersionSource` decides who owns the counter: under `local`
 * EAS increments `ios.buildNumber` / `android.versionCode` in `app.json`, but under `remote`
 * (which this repo switched to on 2026-08-19) EAS keeps the number server-side and never writes it
 * back — so a config read would pin this to whatever was last committed and the About screen would
 * insist on build 3 while TestFlight served build 12. `expo-application` reports what the running
 * binary actually is, which is correct under both settings and cannot drift.
 *
 * Falls back to the config so the value survives anywhere the native module is missing, and
 * degrades to `null` rather than throwing — this feeds the About screen, which people open when
 * something is already wrong. That `null` is why the screen has both a with-build and a
 * without-build version line.
 *
 * @returns The build as a string, or `null` when it cannot be determined.
 */
export function appBuild(): string | null {
  const native = application()?.nativeBuildVersion;
  if (native !== undefined && native !== null && native !== '') return String(native);

  const config = constants()?.expoConfig;
  const build = config?.ios?.buildNumber ?? config?.android?.versionCode;
  return build === undefined || build === null ? null : String(build);
}

/** The platforms the app ships on, plus whatever else React Native might report. */
export type StorePlatform = 'ios' | 'android' | string;

/**
 * Where the "Rate the app" row goes.
 *
 * @param platform - Usually `Platform.OS`, passed in by the component.
 * @returns The store's write-a-review page, plus a `fallback` when the primary is a scheme only
 *   the store app itself can open (`market://` is absent wherever the Play Store is), or `null`
 *   when the app has no listing on that platform yet — in which case the row must say so instead
 *   of opening something broken.
 */
export function storeReviewUrl(platform: StorePlatform): { url: string; fallback?: string } | null {
  if (platform === 'ios') {
    if (IOS_APP_STORE_ID === null) return null;
    return { url: `https://apps.apple.com/app/id${IOS_APP_STORE_ID}?action=write-review` };
  }
  if (platform === 'android') {
    return {
      url: `market://details?id=${APP_PACKAGE_NAME}`,
      fallback: `https://play.google.com/store/apps/details?id=${APP_PACKAGE_NAME}`,
    };
  }
  return null;
}

/** `https://simpleprayer.app/` → `simpleprayer.app`, for showing a link as a place. */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
