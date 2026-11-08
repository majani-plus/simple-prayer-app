/**
 * Calculation-method selection and adhan parameter construction.
 *
 * This module owns three things and nothing else:
 *
 *  1. **Which authority a user gets by default** — `COUNTRY_METHOD_MAP` + `resolveMethod`
 *     turn the `auto` sentinel into a concrete, nameable authority from the user's country.
 *  2. **How that authority is expressed to adhan-js** — `buildParameters` produces a fully
 *     configured `adhan.CalculationParameters` (angles, madhab, high-latitude rule, polar
 *     resolution). `prayerTimes.ts` consumes it; nothing else constructs parameters.
 *  3. **How the choice is named in the UI** — `METHOD_LABEL_KEYS` / `listMethods` expose
 *     ordered i18n KEYS (never literals — see ARCHITECTURE "Conventions").
 *
 * ## Why the country map exists (our market research on Turkey and the Arabic markets)
 *
 * For most users "correct times" means "matches the calendar my mosque prints", not
 * "astronomically defensible". The research is blunt about it: generic apps that silently
 * pick one global method collect "vakitler yanlış" one-star reviews. So the app (a) picks the
 * regionally dominant *authority* from the country code, (b) always names it in the UI
 * ("Auto · Diyanet"), and (c) always lets the user override — both the whole method and, via
 * `CalculationSettings.offsets`, individual prayers (for temkin-style calendars such as
 * Fazilet, which adhan has no method for).
 *
 * Assignment rules used below, in priority order:
 *   - A country's own national authority when adhan ships it (TR→Diyanet, SA→Umm al-Qura,
 *     EG→Egyptian GAS, AE/KW/QA, IR→Tehran, US/CA→ISNA, SG/MY/ID→MUIS-JAKIM-Kemenag 20°/18°).
 *   - Otherwise the regional convention documented by the classic PrayTimes method notes
 *     (North Africa + Levant → Egyptian GAS; South Asia → Karachi; Arabian Peninsula → Umm al-Qura).
 *   - Otherwise the community's historical calendar lineage (Ottoman-heritage Balkan
 *     Islamic communities publish Diyanet-aligned takvims → `turkey`).
 *   - Otherwise Muslim World League, which is also the fallback for every unlisted country.
 *     GB/IE are the deliberate exception: the Moonsighting Committee's seasonal high-latitude
 *     handling is the de-facto British convention.
 *
 * Entries that resolve to `muslimWorldLeague` are still listed explicitly where the choice was
 * *considered* (Oman, Western Europe, Central Asia), so a future reviewer can tell "we decided
 * MWL" apart from "we never looked at it".
 *
 * PURE TypeScript: no React, no React Native, no side effects, no I/O.
 */

import * as adhan from 'adhan';

import {
  CALCULATION_METHODS,
  type CalculationMethodId,
  type ConcreteMethodId,
  type Coordinates,
  type HighLatitudeRuleId,
  type Madhab,
} from './types';

// ---------------------------------------------------------------------------
// Country → method
// ---------------------------------------------------------------------------

/**
 * ISO 3166-1 alpha-2 (uppercase) → the authority `auto` resolves to in that country.
 *
 * Any country not listed here resolves to {@link DEFAULT_METHOD}. Lookups go through
 * {@link resolveMethod}, which normalises case and whitespace first.
 */
export const COUNTRY_METHOD_MAP: Readonly<Record<string, ConcreteMethodId>> = Object.freeze({
  // --- Türkiye and the Ottoman-heritage Balkans (Diyanet takvim: 18°/17°) ---------------
  TR: 'turkey',
  // The Balkan Islamic communities (Rijaset BiH, KMSH, BIK Kosovo, Grand Mufti of Bulgaria)
  // publish takvims descended from the Ottoman/Diyanet tradition rather than MWL.
  BA: 'turkey',
  AL: 'turkey',
  XK: 'turkey',
  MK: 'turkey',
  ME: 'turkey',
  RS: 'turkey',
  BG: 'turkey',

  // --- North America (ISNA 15°/15°) -----------------------------------------------------
  US: 'northAmerica',
  CA: 'northAmerica',

  // --- British Isles (Moonsighting Committee — seasonal high-latitude adjustment) --------
  GB: 'moonsightingCommittee',
  IE: 'moonsightingCommittee',

  // --- Arabian Peninsula ----------------------------------------------------------------
  SA: 'ummAlQura',
  // Bahrain and Yemen follow the Umm al-Qura shape (18°-ish Fajr, fixed 90-minute Isha).
  BH: 'ummAlQura',
  YE: 'ummAlQura',
  AE: 'dubai',
  KW: 'kuwait',
  QA: 'qatar',
  // Oman's Ministry of Awqaf publishes 18°/18°; MWL (18°/17°) is far closer than Umm al-Qura's
  // fixed Isha interval, so Oman deliberately keeps the default.
  OM: 'muslimWorldLeague',

  // --- North Africa and the Levant (Egyptian General Authority of Survey 19.5°/17.5°) ----
  EG: 'egyptian',
  LY: 'egyptian',
  SD: 'egyptian',
  TN: 'egyptian',
  DZ: 'egyptian',
  MA: 'egyptian',
  MR: 'egyptian',
  SY: 'egyptian',
  LB: 'egyptian',
  JO: 'egyptian',
  PS: 'egyptian',
  IQ: 'egyptian',

  // --- South Asia (University of Islamic Sciences, Karachi 18°/18°) ---------------------
  PK: 'karachi',
  IN: 'karachi',
  BD: 'karachi',
  AF: 'karachi',
  LK: 'karachi',
  NP: 'karachi',

  // --- Southeast Asia (MUIS / JAKIM / Kemenag all use 20°/18°) --------------------------
  SG: 'singapore',
  MY: 'singapore',
  ID: 'singapore',
  BN: 'singapore',

  // --- Iran and the Shia-majority Caucasus (Institute of Geophysics, Tehran) ------------
  IR: 'tehran',
  AZ: 'tehran',

  // --- Europe: MWL is the pan-European default; the high-latitude rule does the rest. ----
  // Diaspora communities often follow their country of origin instead — hence the manual
  // override and the "Auto · <authority>" label that makes the default visible.
  FR: 'muslimWorldLeague',
  DE: 'muslimWorldLeague',
  NL: 'muslimWorldLeague',
  BE: 'muslimWorldLeague',
  LU: 'muslimWorldLeague',
  CH: 'muslimWorldLeague',
  AT: 'muslimWorldLeague',
  ES: 'muslimWorldLeague',
  PT: 'muslimWorldLeague',
  IT: 'muslimWorldLeague',
  GR: 'muslimWorldLeague',
  CY: 'muslimWorldLeague',
  PL: 'muslimWorldLeague',
  CZ: 'muslimWorldLeague',
  SE: 'muslimWorldLeague',
  NO: 'muslimWorldLeague',
  DK: 'muslimWorldLeague',
  FI: 'muslimWorldLeague',
  IS: 'muslimWorldLeague',
  RU: 'muslimWorldLeague',
  UA: 'muslimWorldLeague',

  // --- Central Asia (regional muftiyats publish ~18°/17°) -------------------------------
  KZ: 'muslimWorldLeague',
  KG: 'muslimWorldLeague',
  UZ: 'muslimWorldLeague',
  TJ: 'muslimWorldLeague',
  TM: 'muslimWorldLeague',

  // --- Elsewhere in the anglosphere / Southern Africa -----------------------------------
  AU: 'muslimWorldLeague',
  NZ: 'muslimWorldLeague',
  ZA: 'muslimWorldLeague',
});

/** Used whenever `auto` cannot be narrowed: unknown country, missing country, bad input. */
export const DEFAULT_METHOD: ConcreteMethodId = 'muslimWorldLeague';

/**
 * Whether `id` is a calculation method this build knows about, including the `auto` sentinel.
 *
 * Type guard, so it can safely narrow values coming from persisted settings (MMKV) or an
 * import file written by an older/newer build.
 */
export function isMethodSupported(id: string): id is CalculationMethodId {
  return (CALCULATION_METHODS as readonly string[]).includes(id);
}

/** Whether `id` is a method that can actually be computed (i.e. supported and not `auto`). */
export function isConcreteMethod(id: string): id is ConcreteMethodId {
  return id !== 'auto' && isMethodSupported(id);
}

/**
 * Resolve the user's method setting to the concrete authority to compute with.
 *
 * - `'auto'` → {@link COUNTRY_METHOD_MAP} lookup on `countryCode`. The code is trimmed and
 *   upper-cased first, so `'tr'`, `' tr '` and `'TR'` are equivalent. A missing, empty or
 *   unknown country (and any non 2-letter string) yields {@link DEFAULT_METHOD}.
 * - Any concrete id passes through unchanged; `countryCode` is ignored.
 * - Defensive: a value outside `CalculationMethodId` (e.g. a method id removed in a later
 *   version but still sitting in persisted settings) yields {@link DEFAULT_METHOD} rather
 *   than throwing, so the app never loses its prayer times to a stale setting.
 *
 * Never returns `'auto'`. Pure.
 */
export function resolveMethod(method: CalculationMethodId, countryCode?: string): ConcreteMethodId {
  if (method !== 'auto') {
    return isConcreteMethod(method) ? method : DEFAULT_METHOD;
  }
  const code = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : '';
  if (code.length !== 2) return DEFAULT_METHOD;
  return COUNTRY_METHOD_MAP[code] ?? DEFAULT_METHOD;
}

// ---------------------------------------------------------------------------
// Labels (i18n keys only — no user-facing literals live in the domain)
// ---------------------------------------------------------------------------

/** i18n key for the `auto` picker entry, e.g. "Auto"; the UI appends the resolved authority. */
export const AUTO_METHOD_LABEL_KEY = 'methods.auto';

/** i18n keys for each computable method's short name ("Diyanet", "Umm al-Qura", …). */
export const METHOD_LABEL_KEYS: Record<ConcreteMethodId, string> = Object.freeze({
  muslimWorldLeague: 'methods.muslimWorldLeague',
  turkey: 'methods.turkey',
  egyptian: 'methods.egyptian',
  ummAlQura: 'methods.ummAlQura',
  dubai: 'methods.dubai',
  qatar: 'methods.qatar',
  kuwait: 'methods.kuwait',
  karachi: 'methods.karachi',
  singapore: 'methods.singapore',
  northAmerica: 'methods.northAmerica',
  moonsightingCommittee: 'methods.moonsightingCommittee',
  tehran: 'methods.tehran',
  jafari: 'methods.jafari',
});

/**
 * i18n keys for the one-line authority description under each label
 * ("Diyanet İşleri Başkanlığı · 18°/17°"). Same key space, separate subtree.
 */
export const METHOD_DESCRIPTION_KEYS: Record<ConcreteMethodId, string> = Object.freeze({
  muslimWorldLeague: 'methods.descriptions.muslimWorldLeague',
  turkey: 'methods.descriptions.turkey',
  egyptian: 'methods.descriptions.egyptian',
  ummAlQura: 'methods.descriptions.ummAlQura',
  dubai: 'methods.descriptions.dubai',
  qatar: 'methods.descriptions.qatar',
  kuwait: 'methods.descriptions.kuwait',
  karachi: 'methods.descriptions.karachi',
  singapore: 'methods.descriptions.singapore',
  northAmerica: 'methods.descriptions.northAmerica',
  moonsightingCommittee: 'methods.descriptions.moonsightingCommittee',
  tehran: 'methods.descriptions.tehran',
  jafari: 'methods.descriptions.jafari',
});

/** One row of the Settings method picker. */
export interface MethodOption {
  id: CalculationMethodId;
  /** i18n key for the row's title. Never a literal. */
  labelKey: string;
  /** i18n key for the row's secondary line (the authority + its angles). */
  descriptionKey: string;
}

/**
 * i18n key for a method's title, handling the `auto` sentinel.
 * The Settings screen renders "Auto · <resolved>" by pairing this with
 * `METHOD_LABEL_KEYS[resolveMethod('auto', countryCode)]`.
 */
export function methodLabelKey(id: CalculationMethodId): string {
  return id === 'auto' ? AUTO_METHOD_LABEL_KEY : METHOD_LABEL_KEYS[id];
}

/**
 * Display order for the Settings picker: `auto` first (the recommended default), then the
 * global default, then authorities grouped by region roughly by audience size, with the
 * Shia methods last. Every `CalculationMethodId` appears exactly once.
 */
const METHOD_ORDER: readonly CalculationMethodId[] = Object.freeze([
  'auto',
  'muslimWorldLeague',
  'turkey',
  'egyptian',
  'ummAlQura',
  'dubai',
  'qatar',
  'kuwait',
  'karachi',
  'singapore',
  'northAmerica',
  'moonsightingCommittee',
  'tehran',
  'jafari',
] as const);

const METHOD_OPTIONS: readonly MethodOption[] = Object.freeze(
  METHOD_ORDER.map((id) =>
    Object.freeze({
      id,
      labelKey: methodLabelKey(id),
      descriptionKey: id === 'auto' ? 'methods.descriptions.auto' : METHOD_DESCRIPTION_KEYS[id],
    })
  )
);

/**
 * The ordered method list for the Settings picker, `auto` first.
 * Returns a frozen, stable array — callers must not mutate it.
 */
export function listMethods(): readonly MethodOption[] {
  return METHOD_OPTIONS;
}

// ---------------------------------------------------------------------------
// adhan parameter construction
// ---------------------------------------------------------------------------

/**
 * Jafari (Shia) angles, per the Leva Research Institute, Qum convention:
 * Fajr 16°, Isha 14°, Maghrib 4° below the horizon (Maghrib is delayed past sunset until the
 * sun is 4° down, rather than taken at sunset as in the Sunni methods).
 *
 * Source: Leva Institute / PrayTimes.org method table ("Jafari — Ithna Ashari, Leva Research
 * Institute, Qum"). adhan-js has no built-in Jafari, so it is assembled from
 * `CalculationMethod.Other()`. This is deliberately NOT the same as adhan's `Tehran`
 * (Institute of Geophysics, University of Tehran: 17.7° / 14° / 4.5°) — both are offered
 * separately in the picker because communities follow one or the other.
 */
export const JAFARI_ANGLES = Object.freeze({ fajr: 16, isha: 14, maghrib: 4 });

/** Inputs `buildParameters` needs beyond the method itself. */
export interface BuildParametersOptions {
  madhab: Madhab;
  highLatitudeRule: HighLatitudeRuleId;
  /**
   * The location the times will be computed for. Only used to resolve
   * `highLatitudeRule: 'auto'`; omitting it makes `auto` fall back to middle-of-the-night.
   */
  coordinates?: Coordinates;
}

function baseParameters(methodId: ConcreteMethodId): adhan.CalculationParameters {
  switch (methodId) {
    case 'muslimWorldLeague':
      return adhan.CalculationMethod.MuslimWorldLeague();
    case 'egyptian':
      return adhan.CalculationMethod.Egyptian();
    case 'karachi':
      return adhan.CalculationMethod.Karachi();
    case 'ummAlQura':
      return adhan.CalculationMethod.UmmAlQura();
    case 'dubai':
      return adhan.CalculationMethod.Dubai();
    case 'qatar':
      return adhan.CalculationMethod.Qatar();
    case 'kuwait':
      return adhan.CalculationMethod.Kuwait();
    case 'moonsightingCommittee':
      return adhan.CalculationMethod.MoonsightingCommittee();
    case 'northAmerica':
      return adhan.CalculationMethod.NorthAmerica();
    case 'singapore':
      return adhan.CalculationMethod.Singapore();
    case 'turkey':
      return adhan.CalculationMethod.Turkey();
    case 'tehran':
      return adhan.CalculationMethod.Tehran();
    case 'jafari': {
      const params = adhan.CalculationMethod.Other();
      params.fajrAngle = JAFARI_ANGLES.fajr;
      params.ishaAngle = JAFARI_ANGLES.isha;
      params.maghribAngle = JAFARI_ANGLES.maghrib;
      return params;
    }
    default: {
      // Exhaustiveness guard: adding a ConcreteMethodId without a case is a compile error.
      const unreachable: never = methodId;
      throw new Error(`Unsupported calculation method: ${String(unreachable)}`);
    }
  }
}

function adhanMadhab(madhab: Madhab) {
  return madhab === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
}

/**
 * Map our high-latitude setting onto adhan's.
 *
 * `'auto'` delegates to `adhan.HighLatitudeRule.recommended(coords)` — which picks
 * seventh-of-the-night above roughly 48° and middle-of-the-night below it — but only when the
 * helper exists in the installed adhan version AND coordinates were supplied. Otherwise it
 * falls back to middle-of-the-night, adhan's own default, which is defined at every latitude.
 */
function adhanHighLatitudeRule(rule: HighLatitudeRuleId, coordinates?: Coordinates) {
  switch (rule) {
    case 'middleOfTheNight':
      return adhan.HighLatitudeRule.MiddleOfTheNight;
    case 'seventhOfTheNight':
      return adhan.HighLatitudeRule.SeventhOfTheNight;
    case 'twilightAngle':
      return adhan.HighLatitudeRule.TwilightAngle;
    case 'auto': {
      const recommended = adhan.HighLatitudeRule.recommended;
      if (coordinates && typeof recommended === 'function') {
        // adhan 4.4.4's `recommended` tests `latitude > 48` WITHOUT Math.abs, so the far
        // southern hemisphere (Punta Arenas, Ushuaia) would get the mild rule exactly where it
        // needs the strong one. High-latitude twilight is symmetric in |latitude|, so the
        // recommendation is asked about the mirrored northern point instead.
        return recommended(new adhan.Coordinates(Math.abs(coordinates.latitude), coordinates.longitude));
      }
      return adhan.HighLatitudeRule.MiddleOfTheNight;
    }
    default: {
      const unreachable: never = rule;
      throw new Error(`Unsupported high latitude rule: ${String(unreachable)}`);
    }
  }
}

/**
 * Build the adhan parameters for a concrete method.
 *
 * Always returns a FRESH object (adhan's factories are mutable, so sharing one would leak
 * settings between calls). The returned parameters carry:
 *  - the method's own angles / method adjustments, with `jafari` synthesised from
 *    `Other()` + {@link JAFARI_ANGLES};
 *  - `madhab` (Asr shadow length) and `highLatitudeRule` from `opts`;
 *  - `polarCircleResolution = AqrabBalad` ("nearest locality"): above the polar circle the sun
 *    may never reach the Fajr/Isha depression angle, and adhan's default `Unresolved` then
 *    produces invalid dates and throws when they are read. AqrabBalad substitutes the nearest
 *    latitude where the event does occur, so Tromsø and Svalbard get usable times.
 *
 * `CalculationSettings.offsets` are NOT applied here — `params.adjustments` is left at zero and
 * `prayerTimes.ts` owns per-prayer minute offsets, so the offsets stay visible in one place.
 *
 * Pure: no I/O, no clock reads, no mutation of module state.
 *
 * @param methodId concrete method (call {@link resolveMethod} first — `auto` is not accepted)
 * @param opts madhab, high-latitude rule, and optionally the coordinates that `'auto'` needs
 */
export function buildParameters(
  methodId: ConcreteMethodId,
  opts: BuildParametersOptions
): adhan.CalculationParameters {
  const params = baseParameters(methodId);
  params.madhab = adhanMadhab(opts.madhab);
  params.highLatitudeRule = adhanHighLatitudeRule(opts.highLatitudeRule, opts.coordinates);
  params.polarCircleResolution = adhan.PolarCircleResolution.AqrabBalad;
  if (methodId === 'moonsightingCommittee') {
    // Pinned to adhan's default so a library upgrade cannot silently move GB/IE Isha.
    params.shafaq = adhan.Shafaq.General;
  }
  return params;
}
