/**
 * Settings store — owns every persisted user preference (`AppSettings` from `domain/types`).
 *
 * Responsibilities: the first-run defaults, the typed mutators the Settings screen calls,
 * validation/clamping of anything the user (or a corrupt storage file) can put into those
 * fields, and the versioned persistence contract with MMKV. It owns no derived state and no
 * side effects: computing prayer times, scheduling notifications or resolving a location all
 * happen elsewhere, reading from here.
 *
 * ## Why MMKV (D13)
 * Settings must be readable *synchronously* on the very first render, otherwise the app
 * flashes the wrong theme/language before an async store rehydrates. MMKV reads are
 * synchronous, so `persist` hydrates during `create()` and the first render already sees the
 * user's real settings.
 *
 * ## Why the storage adapter is injectable
 * MMKV is a native module and cannot be constructed under Jest, so the store is built by
 * {@link createSettingsStore}, which takes any {@link SettingsStorage}. The app uses the
 * MMKV-backed singleton {@link useSettingsStore}; tests pass an in-memory adapter.
 *
 * ## Trusting nothing from storage
 * A persisted payload can be older than the app, partially written, or plain garbage. Every
 * read goes through {@link sanitizeSettings}, which rebuilds a complete `AppSettings` on top
 * of {@link DEFAULT_SETTINGS} field by field. A new settings field therefore appears with its
 * default on an existing install, and no stored value can crash startup.
 *
 * Dependency rule: imports `domain/` only. No React Native imports beyond the lazily required
 * MMKV adapter; no user-facing strings (i18n happens in the UI).
 */

import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';

import { ADHAN_VOICES, DEFAULT_ADHAN_VOICE } from '../domain/adhanVoices';
import { isValidDay } from '../domain/dates';
import { clampHijriOffset } from '../domain/hijri';
import { isMethodSupported } from '../domain/methods';
import {
  DEFAULT_NUDGE_LEAD_MINUTES,
  MAX_NUDGE_LEAD_MINUTES,
  MIN_NUDGE_LEAD_MINUTES,
} from '../domain/notificationPlan';
import {
  PRAYERS,
  TRACKING_MODES,
  type AdhanVoice,
  type AppLocation,
  type AppSettings,
  type CalculationSettings,
  type HighLatitudeRuleId,
  type LanguagePreference,
  type NumeralPreference,
  type Madhab,
  type Prayer,
  type PrayerDay,
  type PrayerOffsets,
  type PrayerReminderSettings,
  type ReminderSettings,
  type ReminderSound,
  type StreakMode,
  type ThemePreference,
  type TrackingMode,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Value domains & bounds
// ---------------------------------------------------------------------------

/** 12/24-hour display preference; `system` follows the device locale. */
export type TimeFormatPreference = AppSettings['timeFormat'];

const STREAK_MODES = ['soft', 'hard'] as const satisfies readonly StreakMode[];
const MADHABS = ['auto', 'shafi', 'hanafi'] as const satisfies readonly Madhab[];
const HIGH_LATITUDE_RULES = [
  'auto',
  'middleOfTheNight',
  'seventhOfTheNight',
  'twilightAngle',
] as const satisfies readonly HighLatitudeRuleId[];
const REMINDER_SOUNDS = ['silent', 'system', 'adhan'] as const satisfies readonly ReminderSound[];
const THEME_PREFERENCES = ['system', 'light', 'dark'] as const satisfies readonly ThemePreference[];
const LANGUAGE_PREFERENCES = [
  'system',
  'en',
  'ar',
  'tr',
  'ur',
] as const satisfies readonly LanguagePreference[];
const NUMERAL_PREFERENCES = [
  'auto',
  'arab',
  'latn',
] as const satisfies readonly NumeralPreference[];
const TIME_FORMATS = ['system', '12h', '24h'] as const satisfies readonly TimeFormatPreference[];

/** The ± limit the Settings screen exposes for a per-prayer manual adjustment (PRODUCT_SPEC §12). */
export const MAX_PRAYER_OFFSET_MINUTES = 30;

/** Bounds for a pre-reminder's "X minutes before" value. */
export const MIN_PRE_REMINDER_MINUTES = 1;
export const MAX_PRE_REMINDER_MINUTES = 120;

/**
 * Bounds for the global last-call lead — how long before a window closes its nudge arrives.
 * Owned by `domain/notificationPlan`, which is where the reasoning for the two ends lives; they
 * are re-exported here so the Settings screen has one place to import its limits from.
 */
export { MIN_NUDGE_LEAD_MINUTES, MAX_NUDGE_LEAD_MINUTES };

/** Bounds for the average exempt-days-per-month figure the qada estimator uses. */
export const MIN_EXEMPT_DAYS_PER_MONTH = 0;
export const MAX_EXEMPT_DAYS_PER_MONTH = 15;

/**
 * Live Activity lead and linger (D112): how many minutes before the next prayer's start the
 * lead card may appear, and how many minutes after a prayer comes in the due card stays. Half
 * an hour each way is the moment around the prayer, which is all the lockscreen should carry;
 * below five minutes a card is born already dying, and past two hours it stops being "around
 * the prayer" at all. One pair of bounds for both knobs — they are two ends of the same window.
 */
export const DEFAULT_LIVE_ACTIVITY_LEAD_MINUTES = 30;
export const DEFAULT_LIVE_ACTIVITY_LINGER_MINUTES = 30;
export const MIN_LIVE_ACTIVITY_MINUTES = 5;
export const MAX_LIVE_ACTIVITY_MINUTES = 120;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default pre-reminder lead time per prayer, in minutes. Pre-reminders ship OFF; this is only
 * the value the picker starts on. Fajr gets a longer lead because its pre-reminder is a
 * wake-up (PRODUCT_SPEC §6), the rest get a "finish what you are doing" nudge.
 */
const DEFAULT_PRE_REMINDER_MINUTES: Readonly<Record<Prayer, number>> = Object.freeze({
  fajr: 30,
  dhuhr: 15,
  asr: 15,
  maghrib: 15,
  isha: 15,
});

function defaultReminder(prayer: Prayer): PrayerReminderSettings {
  return {
    // A prayer-time notification with the device's default sound is what a first-run user
    // expects from a prayer app; it is also the only notification we can promise to deliver
    // before any permission beyond POST_NOTIFICATIONS has been granted.
    adhanEnabled: true,
    // `system` (not `adhan`): an unrequested 30-second adhan clip is a hostile first impression.
    sound: 'system',
    // Off — an extra notification per prayer must be opted into.
    preReminderEnabled: false,
    preReminderMinutes: DEFAULT_PRE_REMINDER_MINUTES[prayer],
    // On — the end-of-window nudge only fires when the prayer is still unlogged, so it is
    // silent for an engaged user and is the feature that makes tracking work.
    nudgeEnabled: true,
  };
}

function defaultReminders(): ReminderSettings {
  return {
    fajr: defaultReminder('fajr'),
    dhuhr: defaultReminder('dhuhr'),
    asr: defaultReminder('asr'),
    maghrib: defaultReminder('maghrib'),
    isha: defaultReminder('isha'),
  };
}

function defaultOffsets(): PrayerOffsets {
  return { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
}

/**
 * Builds a fresh, mutable copy of the first-run settings.
 *
 * Always use this (never a shared object) when seeding or resetting state: the store mutates
 * settings in place through immer, and {@link DEFAULT_SETTINGS} is deeply frozen.
 *
 * @returns A complete `AppSettings` with every field populated.
 */
export function createDefaultSettings(): AppSettings {
  return {
    // Nothing has been granted or chosen yet; the UI shows the location prompt.
    location: null,
    // Ask for device location first — manual city entry is the fallback, not the default path.
    useAutoLocation: true,
    calculation: {
      // Resolved from the user's country at computation time (methods.ts).
      method: 'auto',
      // Resolved from the user's country at computation time, like `method` (D209).
      madhab: 'auto',
      highLatitudeRule: 'auto',
      offsets: defaultOffsets(),
      hijriOffset: 0,
    },
    // Forgiving by default (D30): a hard streak is opt-in.
    streakMode: 'soft',
    // The app as it always was. First-run setup offers simple mode (D192); skipping setup keeps
    // this, which is the "skipping is the old path" rule of the onboarding header.
    trackingMode: 'detailed',
    simpleModeSince: null,
    simpleQadaMadeUp: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    // Off — the exemption feature is only surfaced to users who turn it on.
    exemptionModeEnabled: false,
    // Excused days silence the reminders unless she chooses otherwise on the begin sheet.
    exemptionMuteReminders: true,
    exemptDaysPerMonth: 7,
    reminders: defaultReminders(),
    // The recitation from the Haram — the one most people will recognise. See
    // `domain/adhanVoices` for why the default is a place rather than a named reciter.
    adhanVoice: DEFAULT_ADHAN_VOICE,
    // Twenty minutes: long enough to actually pray, late enough to read as a last call rather
    // than a second adhan.
    nudgeLeadMinutes: DEFAULT_NUDGE_LEAD_MINUTES,
    // Off — the note at sunrise arrives once Fajr's time has already gone, so it is the one
    // reminder nobody can act on. It used to ride the last call, which meant an unmarked Fajr
    // produced two notifications about the same prayer and the only way to stop the second was to
    // give up the first on all five prayers (D90). The last call before sunrise is what remains
    // on by default, and it arrives while there is still time to pray.
    sunriseNoteEnabled: false,
    // Off — an ongoing Android notification is opt-in (D27).
    persistentNotificationEnabled: false,
    // Off — its iOS counterpart, the prayer-window Live Activity, is opt-in the same way (D27).
    liveActivityEnabled: false,
    liveActivityLeadMinutes: DEFAULT_LIVE_ACTIVITY_LEAD_MINUTES,
    liveActivityLingerMinutes: DEFAULT_LIVE_ACTIVITY_LINGER_MINUTES,
    // Off — pausing someone's music is only ever done because they asked for it (D96).
    pauseAudioEnabled: false,
    theme: 'system',
    language: 'system',
    arabicNumerals: 'auto',
    qadaSetupCompleted: false,
    // False on a fresh install — the first-run setup flow offers itself once. An install made
    // before the flow existed never sees it: `sanitizeSettings` migrates a stored payload that
    // predates this field to `true`.
    onboardingCompleted: false,
    timeFormat: 'system',
    // On by default (owner's decision): crash reports are diagnostic-only — see
    // services/telemetry.ts for exactly what is and is not sent — and the switch to turn them
    // off sits in Settings → Support. The value is read once at startup, so a change applies
    // at the next launch.
    crashReportingEnabled: true,
  };
}

/**
 * The first-run settings, deeply frozen. Read it for comparisons and defaults; call
 * {@link createDefaultSettings} whenever a mutable copy is needed.
 */
export const DEFAULT_SETTINGS: AppSettings = deepFreeze(createDefaultSettings());

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Rounds a number into an inclusive integer range, falling back when it is not a usable number.
 *
 * @param value - Any value; non-numbers, `NaN` and infinities yield `fallback`.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @param fallback - Returned verbatim when `value` is unusable.
 * @returns An integer in `min…max`, or `fallback`.
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampPrayerOffset(value: unknown, fallback: number): number {
  return clampInt(value, -MAX_PRAYER_OFFSET_MINUTES, MAX_PRAYER_OFFSET_MINUTES, fallback);
}

function clampPreReminderMinutes(value: unknown, fallback: number): number {
  return clampInt(value, MIN_PRE_REMINDER_MINUTES, MAX_PRE_REMINDER_MINUTES, fallback);
}

function clampExemptDaysPerMonth(value: unknown, fallback: number): number {
  return clampInt(value, MIN_EXEMPT_DAYS_PER_MONTH, MAX_EXEMPT_DAYS_PER_MONTH, fallback);
}

function clampNudgeLeadMinutes(value: unknown, fallback: number): number {
  return clampInt(value, MIN_NUDGE_LEAD_MINUTES, MAX_NUDGE_LEAD_MINUTES, fallback);
}

function clampLiveActivityMinutes(value: unknown, fallback: number): number {
  return clampInt(value, MIN_LIVE_ACTIVITY_MINUTES, MAX_LIVE_ACTIVITY_MINUTES, fallback);
}

// ---------------------------------------------------------------------------
// Sanitization (the storage trust boundary)
// ---------------------------------------------------------------------------

/**
 * Rebuilds an `AppLocation` from untrusted input.
 *
 * @param input - Anything; typically a value read back from storage.
 * @returns A valid location, or `null` when the payload is missing or unusable (the app then
 * simply re-resolves the location).
 */
function sanitizeLocation(input: unknown): AppLocation | null {
  if (!isRecord(input)) return null;
  const { latitude, longitude, label } = input;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return null;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  if (typeof label !== 'string') return null;

  const location: AppLocation = {
    latitude,
    longitude,
    label,
    // Anything unrecognised is treated as `auto`, which is the self-healing choice: the
    // location service is free to refresh it.
    source: input.source === 'manual' ? 'manual' : 'auto',
    resolvedAt:
      typeof input.resolvedAt === 'number' && Number.isFinite(input.resolvedAt)
        ? input.resolvedAt
        : 0,
  };
  if (typeof input.countryCode === 'string' && input.countryCode.length > 0) {
    location.countryCode = input.countryCode.toUpperCase();
  }
  if (typeof input.timeZone === 'string' && input.timeZone.length > 0) {
    location.timeZone = input.timeZone;
  }
  return location;
}

/** Five whole, non-negative counts; anything else is 0. */
function sanitizeMadeUp(input: unknown): Record<Prayer, number> {
  const source = isRecord(input) ? input : {};
  const counts = {} as Record<Prayer, number>;
  for (const prayer of PRAYERS) counts[prayer] = wholeCount(source[prayer]);
  return counts;
}

function wholeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sanitizeOffsets(input: unknown, fallback: PrayerOffsets): PrayerOffsets {
  const source = isRecord(input) ? input : {};
  const offsets = {} as PrayerOffsets;
  for (const prayer of PRAYERS) {
    offsets[prayer] = clampPrayerOffset(source[prayer], fallback[prayer]);
  }
  return offsets;
}

function sanitizeCalculation(input: unknown, fallback: CalculationSettings): CalculationSettings {
  const source = isRecord(input) ? input : {};
  const method =
    typeof source.method === 'string' && isMethodSupported(source.method)
      ? source.method
      : fallback.method;
  return {
    method,
    madhab: pickEnum(source.madhab, MADHABS, fallback.madhab),
    highLatitudeRule: pickEnum(
      source.highLatitudeRule,
      HIGH_LATITUDE_RULES,
      fallback.highLatitudeRule
    ),
    offsets: sanitizeOffsets(source.offsets, fallback.offsets),
    hijriOffset:
      typeof source.hijriOffset === 'number' && Number.isFinite(source.hijriOffset)
        ? clampHijriOffset(source.hijriOffset)
        : fallback.hijriOffset,
  };
}

function sanitizeReminder(
  input: unknown,
  fallback: PrayerReminderSettings
): PrayerReminderSettings {
  const source = isRecord(input) ? input : {};
  return {
    adhanEnabled: pickBoolean(source.adhanEnabled, fallback.adhanEnabled),
    sound: pickEnum(source.sound, REMINDER_SOUNDS, fallback.sound),
    preReminderEnabled: pickBoolean(source.preReminderEnabled, fallback.preReminderEnabled),
    preReminderMinutes: clampPreReminderMinutes(
      source.preReminderMinutes,
      fallback.preReminderMinutes
    ),
    nudgeEnabled: pickBoolean(source.nudgeEnabled, fallback.nudgeEnabled),
  };
}

function sanitizeReminders(input: unknown, fallback: ReminderSettings): ReminderSettings {
  const source = isRecord(input) ? input : {};
  const reminders = {} as ReminderSettings;
  for (const prayer of PRAYERS) {
    reminders[prayer] = sanitizeReminder(source[prayer], fallback[prayer]);
  }
  return reminders;
}

/**
 * Rebuilds a complete `AppSettings` from an untrusted value, field by field, on top of the
 * first-run defaults.
 *
 * This is the only trust boundary between stored bytes and application state. It never throws
 * and never returns a partial object: unknown keys are dropped, missing keys take their
 * default (which is how a newly shipped setting appears on an old install), and out-of-range
 * numbers are clamped.
 *
 * @param input - Anything: a parsed JSON payload, `undefined`, a string, an array…
 * @returns A fresh, complete, mutable `AppSettings`.
 */
export function sanitizeSettings(input: unknown): AppSettings {
  const defaults = createDefaultSettings();
  if (!isRecord(input)) return defaults;
  return {
    location: sanitizeLocation(input.location),
    useAutoLocation: pickBoolean(input.useAutoLocation, defaults.useAutoLocation),
    calculation: sanitizeCalculation(input.calculation, defaults.calculation),
    streakMode: pickEnum(input.streakMode, STREAK_MODES, defaults.streakMode),
    // An install from before tracking modes (no field at all) is an existing user and MUST land
    // on `detailed`, with History and stats exactly as they were (D192) — the onboardingCompleted
    // rule below asks the same question. The fallback is the literal, not `defaults.trackingMode`,
    // so changing the fresh-install default later can never move an existing user.
    trackingMode:
      'trackingMode' in input
        ? pickEnum(input.trackingMode, TRACKING_MODES, 'detailed')
        : 'detailed',
    simpleModeSince: isValidDay(input.simpleModeSince) ? input.simpleModeSince : null,
    simpleQadaMadeUp: sanitizeMadeUp(input.simpleQadaMadeUp),
    exemptionModeEnabled: pickBoolean(input.exemptionModeEnabled, defaults.exemptionModeEnabled),
    exemptionMuteReminders: pickBoolean(
      input.exemptionMuteReminders,
      defaults.exemptionMuteReminders
    ),
    exemptDaysPerMonth: clampExemptDaysPerMonth(
      input.exemptDaysPerMonth,
      defaults.exemptDaysPerMonth
    ),
    reminders: sanitizeReminders(input.reminders, defaults.reminders),
    // An unknown voice falls back to the default rather than being kept: the value names a file
    // that has to exist in the bundle, and a payload written by a build that shipped a different
    // set of recitations would otherwise ask the OS for a sound that is not there — which iOS
    // answers by silently playing its own default, the exact failure this app cannot afford.
    adhanVoice: pickEnum(input.adhanVoice, ADHAN_VOICES, defaults.adhanVoice),
    nudgeLeadMinutes: clampNudgeLeadMinutes(input.nudgeLeadMinutes, defaults.nudgeLeadMinutes),
    // A payload from before this field existed, or one holding garbage, lands on `false` — the
    // failure that matters here runs one way only: never start sending a notification the user
    // has not asked for (D90).
    sunriseNoteEnabled: pickBoolean(input.sunriseNoteEnabled, defaults.sunriseNoteEnabled),
    persistentNotificationEnabled: pickBoolean(
      input.persistentNotificationEnabled,
      defaults.persistentNotificationEnabled
    ),
    liveActivityEnabled: pickBoolean(input.liveActivityEnabled, defaults.liveActivityEnabled),
    liveActivityLeadMinutes: clampLiveActivityMinutes(
      input.liveActivityLeadMinutes,
      defaults.liveActivityLeadMinutes
    ),
    liveActivityLingerMinutes: clampLiveActivityMinutes(
      input.liveActivityLingerMinutes,
      defaults.liveActivityLingerMinutes
    ),
    // Same one-way failure rule as the sunrise note: garbage lands on "do not touch their audio".
    pauseAudioEnabled: pickBoolean(input.pauseAudioEnabled, defaults.pauseAudioEnabled),
    theme: pickEnum(input.theme, THEME_PREFERENCES, defaults.theme),
    language: pickEnum(input.language, LANGUAGE_PREFERENCES, defaults.language),
    arabicNumerals: pickEnum(input.arabicNumerals, NUMERAL_PREFERENCES, defaults.arabicNumerals),
    qadaSetupCompleted: pickBoolean(input.qadaSetupCompleted, defaults.qadaSetupCompleted),
    // The one field that must NOT take its default when it is missing. Everything else here
    // answers "what should a new field be on an existing install?" with "its default"; this one
    // asks a different question — *has this person already set the app up?* — and a stored
    // payload existing at all is the answer: the app has run before, so setup has effectively
    // happened, and reopening it would send a long-standing user back through questions they
    // answered months ago. A truly fresh install reaches this function with a non-record
    // (nothing stored) and keeps the `false` default.
    onboardingCompleted:
      'onboardingCompleted' in input
        ? pickBoolean(input.onboardingCompleted, defaults.onboardingCompleted)
        : true,
    timeFormat: pickEnum(input.timeFormat, TIME_FORMATS, defaults.timeFormat),
    // A payload persisted before this field existed migrates to the default (true), never to
    // `undefined` — the standard behaviour of this field-by-field rebuild.
    crashReportingEnabled: pickBoolean(input.crashReportingEnabled, defaults.crashReportingEnabled),
  };
}

/** Extracts the persisted `AppSettings` slice out of the full store state. */
function selectSettings(state: SettingsStore): AppSettings {
  return {
    location: state.location,
    useAutoLocation: state.useAutoLocation,
    calculation: state.calculation,
    streakMode: state.streakMode,
    trackingMode: state.trackingMode,
    simpleModeSince: state.simpleModeSince,
    simpleQadaMadeUp: state.simpleQadaMadeUp,
    exemptionModeEnabled: state.exemptionModeEnabled,
    exemptionMuteReminders: state.exemptionMuteReminders,
    exemptDaysPerMonth: state.exemptDaysPerMonth,
    reminders: state.reminders,
    adhanVoice: state.adhanVoice,
    nudgeLeadMinutes: state.nudgeLeadMinutes,
    sunriseNoteEnabled: state.sunriseNoteEnabled,
    persistentNotificationEnabled: state.persistentNotificationEnabled,
    liveActivityEnabled: state.liveActivityEnabled,
    liveActivityLeadMinutes: state.liveActivityLeadMinutes,
    liveActivityLingerMinutes: state.liveActivityLingerMinutes,
    pauseAudioEnabled: state.pauseAudioEnabled,
    theme: state.theme,
    language: state.language,
    arabicNumerals: state.arabicNumerals,
    qadaSetupCompleted: state.qadaSetupCompleted,
    onboardingCompleted: state.onboardingCompleted,
    timeFormat: state.timeFormat,
    crashReportingEnabled: state.crashReportingEnabled,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** MMKV instance id; also the storage key namespace for the persisted settings. */
export const SETTINGS_STORAGE_ID = 'simple-prayer-times.settings';

/** Key the serialized settings live under inside {@link SETTINGS_STORAGE_ID}. */
export const SETTINGS_STORAGE_KEY = 'settings';

/**
 * Schema version of the persisted payload.
 *
 * Bump this whenever a stored field changes meaning or shape (adding a field does NOT require
 * a bump — {@link sanitizeSettings} already fills new fields with their default) and add the
 * corresponding step to {@link migrateSettings}.
 */
export const SETTINGS_PERSIST_VERSION = 2;

/**
 * Migrates a payload written by an older (or newer) build into the current shape.
 *
 * Steps run in order, BEFORE the final sanitize:
 *
 * - **v1 → v2 (D209):** `calculation.madhab` gained `'auto'`. Version 1 stored `'shafi'` both for
 *   people who chose it and for everyone who never opened the setting, and the two cannot be told
 *   apart. The owner chose to move every stored `'shafi'` to `'auto'`: outside the Hanafi-default
 *   countries it resolves to the same Asr, so only those countries see a change. `'hanafi'` was
 *   always a deliberate choice and is kept.
 *
 * @param persisted - The stored state as read back from storage; untrusted.
 * @param fromVersion - The version stamped on the stored payload.
 * @returns A complete, valid `AppSettings`.
 */
export function migrateSettings(persisted: unknown, fromVersion: number): AppSettings {
  if (fromVersion < 2 && isRecord(persisted) && isRecord(persisted.calculation)) {
    if (persisted.calculation.madhab === 'shafi') {
      persisted = { ...persisted, calculation: { ...persisted.calculation, madhab: 'auto' } };
    }
  }
  return sanitizeSettings(persisted);
}

/**
 * Minimal synchronous string storage the settings store persists through — the subset of MMKV
 * we actually need, so tests (and any future backend) can substitute their own.
 */
export interface SettingsStorage {
  /** @returns The stored string, or `null`/`undefined` when the key is absent. */
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Creates an in-memory {@link SettingsStorage}. Useful for tests and for a "settings are not
 * persisted" fallback if MMKV is ever unavailable.
 *
 * @param seed - Optional initial key/value contents.
 * @returns A storage adapter backed by a `Map`.
 */
export function createMemorySettingsStorage(seed?: Record<string, string>): SettingsStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * Creates the MMKV-backed {@link SettingsStorage} used by the app.
 *
 * The native module is `require`d lazily on first access, so importing this module stays safe
 * in environments without MMKV (Jest, node scripts) as long as they inject their own storage.
 *
 * @returns A storage adapter over a dedicated MMKV instance ({@link SETTINGS_STORAGE_ID}).
 */
export function createMmkvSettingsStorage(): SettingsStorage {
  let instance: ReturnType<typeof import('react-native-mmkv').createMMKV> | null = null;
  const mmkv = () => {
    if (instance === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
      instance = createMMKV({ id: SETTINGS_STORAGE_ID });
    }
    return instance;
  };
  return {
    getItem: (key) => mmkv().getString(key) ?? null,
    setItem: (key, value) => mmkv().set(key, value),
    removeItem: (key) => void mmkv().remove(key),
  };
}

/**
 * Wraps a string storage as the JSON `PersistStorage` zustand expects.
 *
 * Parsing happens here (rather than via `createJSONStorage`) so that a truncated or corrupt
 * payload — or a storage backend that throws — degrades to "no stored settings" instead of
 * throwing out of `create()` and taking the app down at startup.
 */
function jsonPersistStorage(storage: SettingsStorage): PersistStorage<AppSettings> {
  return {
    getItem: (name) => {
      let raw: string | null | undefined;
      try {
        raw = storage.getItem(name);
      } catch {
        return null;
      }
      if (typeof raw !== 'string' || raw.length === 0) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      if (!isRecord(parsed)) return null;
      const version = typeof parsed.version === 'number' ? parsed.version : 0;
      // `state` is deliberately passed through unvalidated: `migrate`/`merge` sanitize it.
      return { state: parsed.state as AppSettings, version };
    },
    setItem: (name, value: StorageValue<AppSettings>) => {
      try {
        storage.setItem(name, JSON.stringify(value));
      } catch {
        // A failed write must never break a settings change; the value stays in memory.
      }
    },
    removeItem: (name) => {
      try {
        storage.removeItem(name);
      } catch {
        // Nothing to do — the store is already the source of truth in memory.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** The typed mutators the UI calls. All of them validate/clamp their input. */
export interface SettingsActions {
  /** Replaces the active location (`null` clears it, e.g. when permission is revoked). */
  setLocation(location: AppLocation | null): void;
  /** Turns device-location following on/off; `false` means the user picks a city manually. */
  setUseAutoLocation(enabled: boolean): void;
  /** Merges a partial calculation change, clamping any offsets it carries. */
  setCalculation(patch: Partial<CalculationSettings>): void;
  /**
   * Sets one prayer's manual adjustment, clamped to
   * ±{@link MAX_PRAYER_OFFSET_MINUTES} minutes and rounded to whole minutes.
   * A non-finite value leaves the current offset untouched.
   */
  setPrayerOffset(prayer: Prayer, minutes: number): void;
  /** Sets the Hijri day offset, clamped to ±2 days by `domain/hijri`. */
  setHijriOffset(days: number): void;
  setStreakMode(mode: StreakMode): void;
  /**
   * Switches between simple and detailed logging (D192). Turning simple mode ON from detailed
   * starts it fresh at `today`: `simpleModeSince` becomes `today` (so no earlier day can show a
   * derived miss) and the made-up counters, which only ever meant something relative to the old
   * start, go back to zero. Turning it off changes nothing stored — the start and the counters are
   * kept, they simply stop applying. Choosing the mode already in force is a no-op.
   */
  setTrackingMode(mode: TrackingMode, today: PrayerDay): void;
  /** Sets simple mode's made-up count for one prayer; floored, never below zero. */
  setSimpleQadaMadeUp(prayer: Prayer, count: number): void;
  setExemptionModeEnabled(enabled: boolean): void;
  /** See `AppSettings.exemptionMuteReminders`; asked on the begin sheet, default `true`. */
  setExemptionMuteReminders(mute: boolean): void;
  /**
   * Sets the average exempt days per month used by the qada estimator, clamped to
   * {@link MIN_EXEMPT_DAYS_PER_MONTH}…{@link MAX_EXEMPT_DAYS_PER_MONTH}.
   */
  setExemptDaysPerMonth(days: number): void;
  /** Merges a partial reminder change for one prayer, clamping `preReminderMinutes`. */
  setReminder(prayer: Prayer, patch: Partial<PrayerReminderSettings>): void;
  /** Applies the same partial reminder change to all five prayers (bulk toggles). */
  setAllReminders(patch: Partial<PrayerReminderSettings>): void;
  /**
   * Chooses the recitation the `adhan` sound plays, for every prayer that uses it. One choice for
   * the whole app; an unrecognised value is ignored rather than stored.
   */
  setAdhanVoice(voice: AdhanVoice): void;
  /**
   * Sets how many minutes before a window closes the last call arrives, clamped to
   * {@link MIN_NUDGE_LEAD_MINUTES}…{@link MAX_NUDGE_LEAD_MINUTES}. One value for all five
   * prayers; Isha's last call is timed off Islamic midnight and ignores it (D71).
   */
  setNudgeLeadMinutes(minutes: number): void;
  /**
   * Turns the silent note at sunrise on/off — the one that says Fajr's time has ended and names
   * the next prayer. Its own switch since D90, so it neither depends on nor disturbs any prayer's
   * last call; it is still only ever sent for a Fajr that has not been marked.
   */
  setSunriseNoteEnabled(enabled: boolean): void;
  /** Android ongoing notification (D27). */
  setPersistentNotification(enabled: boolean): void;
  /** iOS prayer-window Live Activity (D27's counterpart surface). */
  setLiveActivityEnabled(enabled: boolean): void;
  /**
   * Sets how many minutes before the next prayer's start the Live Activity's lead card may
   * appear, clamped to {@link MIN_LIVE_ACTIVITY_MINUTES}…{@link MAX_LIVE_ACTIVITY_MINUTES} (D112).
   */
  setLiveActivityLeadMinutes(minutes: number): void;
  /**
   * Sets how many minutes after a prayer comes in the Live Activity's due card stays, clamped
   * to the same bounds (D112). Marking the prayer always ends it earlier.
   */
  setLiveActivityLingerMinutes(minutes: number): void;
  /** Android: pause whatever is playing when a prayer's time comes in (D96). */
  setPauseAudioEnabled(enabled: boolean): void;
  setTheme(theme: ThemePreference): void;
  setLanguage(language: LanguagePreference): void;
  setArabicNumerals(preference: NumeralPreference): void;
  setTimeFormat(format: TimeFormatPreference): void;
  /** Marks the qada wizard as completed or skipped. */
  setQadaSetupCompleted(completed: boolean): void;
  /**
   * Marks the first-run setup flow as seen. Finishing it and skipping it call this with the same
   * `true`: the flow is an offer, and an offer declined is an offer answered.
   */
  setOnboardingCompleted(completed: boolean): void;
  /**
   * Turns anonymous crash reporting on/off. The value is read once at startup
   * (`app/_layout.tsx` → `services/telemetry.ts`), so a change applies at the next launch —
   * the Settings row's copy says so.
   */
  setCrashReportingEnabled(enabled: boolean): void;
  /** Restores every field to {@link DEFAULT_SETTINGS} (and persists that). */
  resetToDefaults(): void;
}

/** Full store state: the persisted settings plus the (non-persisted) actions. */
export type SettingsStore = AppSettings & SettingsActions;

/**
 * Builds a settings store bound to the given storage.
 *
 * Hydration is synchronous: by the time this returns, any previously stored settings have been
 * read, migrated, sanitized and merged over the defaults.
 *
 * @param storage - Synchronous string storage; defaults to MMKV. Tests inject
 * {@link createMemorySettingsStorage}.
 * @param storageKey - Key to persist under; defaults to {@link SETTINGS_STORAGE_KEY}. Useful
 * for isolating parallel stores in tests.
 * @returns A zustand hook with `.getState()`, `.setState()`, `.subscribe()` and `.persist`.
 */
export function createSettingsStore(
  storage: SettingsStorage = createMmkvSettingsStorage(),
  storageKey: string = SETTINGS_STORAGE_KEY
) {
  return create<SettingsStore>()(
    persist(
      immer<SettingsStore>((set) => ({
        ...createDefaultSettings(),

        setLocation(location) {
          set((state) => {
            state.location = location === null ? null : sanitizeLocation(location);
          });
        },

        setUseAutoLocation(enabled) {
          set((state) => {
            state.useAutoLocation = enabled;
          });
        },

        setCalculation(patch) {
          set((state) => {
            state.calculation = sanitizeCalculation(
              { ...state.calculation, ...patch },
              state.calculation
            );
          });
        },

        setPrayerOffset(prayer, minutes) {
          set((state) => {
            state.calculation.offsets[prayer] = clampPrayerOffset(
              minutes,
              state.calculation.offsets[prayer]
            );
          });
        },

        setHijriOffset(days) {
          set((state) => {
            if (!Number.isFinite(days)) return;
            state.calculation.hijriOffset = clampHijriOffset(days);
          });
        },

        setStreakMode(mode) {
          set((state) => {
            state.streakMode = mode;
          });
        },

        setTrackingMode(mode, today) {
          set((state) => {
            if (state.trackingMode === mode) return;
            state.trackingMode = mode;
            if (mode === 'simple' && isValidDay(today)) {
              state.simpleModeSince = today;
              for (const prayer of PRAYERS) state.simpleQadaMadeUp[prayer] = 0;
            }
          });
        },

        setSimpleQadaMadeUp(prayer, count) {
          set((state) => {
            state.simpleQadaMadeUp[prayer] = wholeCount(count);
          });
        },

        setExemptionModeEnabled(enabled) {
          set((state) => {
            state.exemptionModeEnabled = enabled;
          });
        },

        setExemptionMuteReminders(mute) {
          set((state) => {
            state.exemptionMuteReminders = mute;
          });
        },

        setExemptDaysPerMonth(days) {
          set((state) => {
            state.exemptDaysPerMonth = clampExemptDaysPerMonth(days, state.exemptDaysPerMonth);
          });
        },

        setReminder(prayer, patch) {
          set((state) => {
            state.reminders[prayer] = sanitizeReminder(
              { ...state.reminders[prayer], ...patch },
              state.reminders[prayer]
            );
          });
        },

        setAllReminders(patch) {
          set((state) => {
            for (const prayer of PRAYERS) {
              state.reminders[prayer] = sanitizeReminder(
                { ...state.reminders[prayer], ...patch },
                state.reminders[prayer]
              );
            }
          });
        },

        setAdhanVoice(voice) {
          set((state) => {
            state.adhanVoice = pickEnum(voice, ADHAN_VOICES, state.adhanVoice);
          });
        },

        setNudgeLeadMinutes(minutes) {
          set((state) => {
            state.nudgeLeadMinutes = clampNudgeLeadMinutes(minutes, state.nudgeLeadMinutes);
          });
        },

        setSunriseNoteEnabled(enabled) {
          set((state) => {
            state.sunriseNoteEnabled = enabled;
          });
        },

        setPauseAudioEnabled(enabled) {
          set((state) => {
            state.pauseAudioEnabled = enabled;
          });
        },

        setPersistentNotification(enabled) {
          set((state) => {
            state.persistentNotificationEnabled = enabled;
          });
        },

        setLiveActivityEnabled(enabled) {
          set((state) => {
            state.liveActivityEnabled = enabled;
          });
        },

        setLiveActivityLeadMinutes(minutes) {
          set((state) => {
            state.liveActivityLeadMinutes = clampLiveActivityMinutes(
              minutes,
              state.liveActivityLeadMinutes
            );
          });
        },

        setLiveActivityLingerMinutes(minutes) {
          set((state) => {
            state.liveActivityLingerMinutes = clampLiveActivityMinutes(
              minutes,
              state.liveActivityLingerMinutes
            );
          });
        },

        setTheme(theme) {
          set((state) => {
            state.theme = theme;
          });
        },

        setLanguage(language) {
          set((state) => {
            state.language = language;
          });
        },
        setArabicNumerals(preference) {
          set((state) => {
            state.arabicNumerals = preference;
          });
        },

        setTimeFormat(format) {
          set((state) => {
            state.timeFormat = format;
          });
        },

        setQadaSetupCompleted(completed) {
          set((state) => {
            state.qadaSetupCompleted = completed;
          });
        },

        setOnboardingCompleted(completed) {
          set((state) => {
            state.onboardingCompleted = completed;
          });
        },

        setCrashReportingEnabled(enabled) {
          set((state) => {
            state.crashReportingEnabled = enabled;
          });
        },

        resetToDefaults() {
          set((state) => {
            Object.assign(state, createDefaultSettings());
          });
        },
      })),
      {
        name: storageKey,
        storage: jsonPersistStorage(storage),
        version: SETTINGS_PERSIST_VERSION,
        partialize: selectSettings,
        migrate: migrateSettings,
        // Never trust the stored object: rebuild it against the defaults, then keep the live
        // actions from `current`.
        merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
      }
    )
  );
}

/** The application-wide settings store, persisted to MMKV. */
export const useSettingsStore = createSettingsStore();

/**
 * Reads the current settings outside React (services, notification scheduling, exports).
 *
 * @returns A plain `AppSettings` snapshot of the singleton store, without the actions.
 */
export function getSettingsSnapshot(): AppSettings {
  return selectSettings(useSettingsStore.getState());
}

/**
 * Reads the actions outside React (e.g. a service that resolved a new location).
 *
 * @returns The singleton store's action set; the identities are stable for the app's lifetime.
 */
export function getSettingsActions(): SettingsActions {
  return useSettingsStore.getState();
}

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------
// Each hook subscribes to the narrowest slice it needs, so a component only re-renders when
// that slice actually changes. immer's structural sharing keeps untouched sub-objects
// referentially stable, which is what makes object-returning selectors safe here.

/** @returns The saved location, or `null` when none has been resolved yet. */
export const useLocation = () => useSettingsStore((s) => s.location);

/** @returns Whether the app follows the device location. */
export const useUseAutoLocation = () => useSettingsStore((s) => s.useAutoLocation);

/** @returns Method, madhab, high-latitude rule, per-prayer offsets and the Hijri offset. */
export const useCalculationSettings = () => useSettingsStore((s) => s.calculation);

/** @returns All five prayers' reminder settings. */
export const useReminders = () => useSettingsStore((s) => s.reminders);

/** @returns One prayer's reminder settings — the slice a `PrayerRow` needs. */
export const usePrayerReminder = (prayer: Prayer) => useSettingsStore((s) => s.reminders[prayer]);

/** @returns The chosen adhan recitation, used by every prayer whose sound is `adhan`. */
export const useAdhanVoice = () => useSettingsStore((s) => s.adhanVoice);

/** @returns The theme preference (`system` resolves against the OS in the theme layer). */
export const useThemePreference = () => useSettingsStore((s) => s.theme);

/** @returns The language preference (`system` resolves against the device locale in i18n). */
export const useLanguagePreference = () => useSettingsStore((s) => s.language);
export const useArabicNumerals = () => useSettingsStore((s) => s.arabicNumerals);

/** @returns The 12/24-hour display preference. */
export const useTimeFormat = () => useSettingsStore((s) => s.timeFormat);

/** @returns The streak engine mode. */
export const useStreakMode = () => useSettingsStore((s) => s.streakMode);

/** @returns `simple` or `detailed` (D192). */
export const useTrackingMode = () => useSettingsStore((s) => s.trackingMode);
/** @returns The prayer day simple mode was last turned on, or `null`. */
export const useSimpleModeSince = () => useSettingsStore((s) => s.simpleModeSince);
/** @returns Simple mode's made-up count per prayer. */
export const useSimpleQadaMadeUp = () => useSettingsStore((s) => s.simpleQadaMadeUp);

/** @returns The global last-call lead, in minutes before a window closes. */
export const useNudgeLeadMinutes = () => useSettingsStore((s) => s.nudgeLeadMinutes);

/** @returns Whether the silent note at sunrise is wanted (off unless the user asked, D90). */
export const useSunriseNoteEnabled = () => useSettingsStore((s) => s.sunriseNoteEnabled);
export const usePauseAudioEnabled = () => useSettingsStore((s) => s.pauseAudioEnabled);

/** @returns Whether the Android ongoing notification is enabled. */
export const usePersistentNotificationEnabled = () =>
  useSettingsStore((s) => s.persistentNotificationEnabled);

/** @returns Whether the iOS prayer-window Live Activity is enabled. */
export const useLiveActivityEnabled = () => useSettingsStore((s) => s.liveActivityEnabled);
export const useLiveActivityLeadMinutes = () =>
  useSettingsStore((s) => s.liveActivityLeadMinutes);
export const useLiveActivityLingerMinutes = () =>
  useSettingsStore((s) => s.liveActivityLingerMinutes);

/** @returns Whether the qada setup wizard has been completed or skipped. */
export const useQadaSetupCompleted = () => useSettingsStore((s) => s.qadaSetupCompleted);

/** @returns Whether the first-run setup flow has already been offered. */
export const useOnboardingCompleted = () => useSettingsStore((s) => s.onboardingCompleted);

/** @returns Whether anonymous crash reporting is enabled (applies at the next launch). */
export const useCrashReportingEnabled = () => useSettingsStore((s) => s.crashReportingEnabled);

/** @returns Exemption-mode flag plus the estimator's days-per-month figure. */
export const useExemptionSettings = () =>
  useSettingsStore(
    useShallow((s) => ({
      enabled: s.exemptionModeEnabled,
      muteReminders: s.exemptionMuteReminders,
      daysPerMonth: s.exemptDaysPerMonth,
    }))
  );

const selectActions = (s: SettingsStore): SettingsActions => ({
  setLocation: s.setLocation,
  setUseAutoLocation: s.setUseAutoLocation,
  setCalculation: s.setCalculation,
  setPrayerOffset: s.setPrayerOffset,
  setHijriOffset: s.setHijriOffset,
  setStreakMode: s.setStreakMode,
  setTrackingMode: s.setTrackingMode,
  setSimpleQadaMadeUp: s.setSimpleQadaMadeUp,
  setExemptionModeEnabled: s.setExemptionModeEnabled,
  setExemptionMuteReminders: s.setExemptionMuteReminders,
  setExemptDaysPerMonth: s.setExemptDaysPerMonth,
  setReminder: s.setReminder,
  setAllReminders: s.setAllReminders,
  setAdhanVoice: s.setAdhanVoice,
  setNudgeLeadMinutes: s.setNudgeLeadMinutes,
  setSunriseNoteEnabled: s.setSunriseNoteEnabled,
  setPersistentNotification: s.setPersistentNotification,
  setLiveActivityEnabled: s.setLiveActivityEnabled,
  setLiveActivityLeadMinutes: s.setLiveActivityLeadMinutes,
  setLiveActivityLingerMinutes: s.setLiveActivityLingerMinutes,
  setPauseAudioEnabled: s.setPauseAudioEnabled,
  setTheme: s.setTheme,
  setLanguage: s.setLanguage,
  setArabicNumerals: s.setArabicNumerals,
  setTimeFormat: s.setTimeFormat,
  setQadaSetupCompleted: s.setQadaSetupCompleted,
  setOnboardingCompleted: s.setOnboardingCompleted,
  setCrashReportingEnabled: s.setCrashReportingEnabled,
  resetToDefaults: s.resetToDefaults,
});

/**
 * @returns Every settings action. Shallow-compared, so it never causes a re-render on its own.
 */
export const useSettingsActions = (): SettingsActions =>
  useSettingsStore(useShallow(selectActions));
