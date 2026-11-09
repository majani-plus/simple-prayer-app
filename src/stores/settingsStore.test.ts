/**
 * Tests for the persisted settings store.
 *
 * `react-native-mmkv` is a native module that cannot load under Jest, so it is replaced with
 * an in-memory mock; the singleton store (created at import time) therefore hydrates safely.
 * Everything else is exercised through `createSettingsStore(createMemorySettingsStorage())`,
 * which is the same code path the app runs, with the storage adapter swapped.
 */

import { act, renderHook } from '@testing-library/react-native';

import { DEFAULT_NUDGE_LEAD_MINUTES } from '../domain/notificationPlan';
import { PRAYERS, type AppLocation, type AppSettings } from '../domain/types';
import {
  createDefaultSettings,
  createMemorySettingsStorage,
  createMmkvSettingsStorage,
  createSettingsStore,
  DEFAULT_SETTINGS,
  getSettingsActions,
  getSettingsSnapshot,
  MAX_EXEMPT_DAYS_PER_MONTH,
  MAX_NUDGE_LEAD_MINUTES,
  MAX_PRAYER_OFFSET_MINUTES,
  MAX_PRE_REMINDER_MINUTES,
  MIN_EXEMPT_DAYS_PER_MONTH,
  MIN_NUDGE_LEAD_MINUTES,
  MIN_PRE_REMINDER_MINUTES,
  migrateSettings,
  sanitizeSettings,
  SETTINGS_PERSIST_VERSION,
  SETTINGS_STORAGE_KEY,
  useCalculationSettings,
  useLanguagePreference,
  usePrayerReminder,
  useReminders,
  useSettingsActions,
  useSettingsStore,
  useThemePreference,
  type SettingsStorage,
} from './settingsStore';

jest.mock('react-native-mmkv', () => {
  const instances = new Map<string, Map<string, string | number | boolean>>();
  return {
    createMMKV: ({ id }: { id: string }) => {
      let values = instances.get(id);
      if (values === undefined) {
        values = new Map();
        instances.set(id, values);
      }
      const store = values;
      return {
        id,
        set: (key: string, value: string | number | boolean) => void store.set(key, value),
        getString: (key: string) => {
          const value = store.get(key);
          return typeof value === 'string' ? value : undefined;
        },
        getBoolean: (key: string) => {
          const value = store.get(key);
          return typeof value === 'boolean' ? value : undefined;
        },
        getNumber: (key: string) => {
          const value = store.get(key);
          return typeof value === 'number' ? value : undefined;
        },
        contains: (key: string) => store.has(key),
        remove: (key: string) => store.delete(key),
        clearAll: () => store.clear(),
        getAllKeys: () => [...store.keys()],
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Store = ReturnType<typeof createSettingsStore>;

const SETTINGS_KEYS = Object.keys(createDefaultSettings()) as (keyof AppSettings)[];

function makeStore(seed?: Record<string, string>): { store: Store; storage: SettingsStorage } {
  const storage = createMemorySettingsStorage(seed);
  return { store: createSettingsStore(storage), storage };
}

/** The persisted slice of a store's state (actions stripped). */
function snapshot(store: Store): AppSettings {
  const s = store.getState();
  return {
    location: s.location,
    useAutoLocation: s.useAutoLocation,
    calculation: s.calculation,
    streakMode: s.streakMode,
    trackingMode: s.trackingMode,
    simpleModeSince: s.simpleModeSince,
    simpleQadaMadeUp: s.simpleQadaMadeUp,
    exemptionModeEnabled: s.exemptionModeEnabled,
  exemptionMuteReminders: true,
    exemptDaysPerMonth: s.exemptDaysPerMonth,
    travelActive: s.travelActive,
    travelStartDay: s.travelStartDay,
    travelEndDay: s.travelEndDay,
    reminders: s.reminders,
    adhanVoice: s.adhanVoice,
    nudgeLeadMinutes: s.nudgeLeadMinutes,
    sunriseNoteEnabled: s.sunriseNoteEnabled,
    persistentNotificationEnabled: s.persistentNotificationEnabled,
    liveActivityEnabled: s.liveActivityEnabled,
    liveActivityLeadMinutes: s.liveActivityLeadMinutes,
    liveActivityLingerMinutes: s.liveActivityLingerMinutes,
    pauseAudioEnabled: s.pauseAudioEnabled,
    theme: s.theme,
    language: s.language,
    arabicNumerals: s.arabicNumerals,
    qadaSetupCompleted: s.qadaSetupCompleted,
    onboardingCompleted: s.onboardingCompleted,
    timeFormat: s.timeFormat,
    crashReportingEnabled: s.crashReportingEnabled,
  };
}

function storedPayload(storage: SettingsStorage): { state: AppSettings; version?: number } {
  const raw = storage.getItem(SETTINGS_STORAGE_KEY);
  expect(typeof raw).toBe('string');
  return JSON.parse(raw as string) as { state: AppSettings; version?: number };
}

function seedWith(value: unknown): Record<string, string> {
  return { [SETTINGS_STORAGE_KEY]: JSON.stringify(value) };
}

const LOCATION: AppLocation = {
  latitude: 40.6782,
  longitude: -73.9442,
  label: 'Brooklyn, NY',
  countryCode: 'US',
  timeZone: 'America/New_York',
  source: 'auto',
  resolvedAt: 1_700_000_000_000,
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('DEFAULT_SETTINGS', () => {
  it('covers every AppSettings field', () => {
    expect(new Set(SETTINGS_KEYS)).toEqual(
      new Set([
        'location',
        'useAutoLocation',
        'calculation',
        'streakMode',
        'exemptionModeEnabled',
        'exemptionMuteReminders',
        'exemptDaysPerMonth',
        'travelActive',
        'travelStartDay',
        'travelEndDay',
        'reminders',
        'adhanVoice',
        'nudgeLeadMinutes',
        'sunriseNoteEnabled',
        'persistentNotificationEnabled',
        'liveActivityEnabled',
        'liveActivityLeadMinutes',
        'liveActivityLingerMinutes',
        'pauseAudioEnabled',
        'theme',
        'language',
        'arabicNumerals',
        'qadaSetupCompleted',
        'onboardingCompleted',
        'timeFormat',
        'crashReportingEnabled',
        'trackingMode',
        'simpleModeSince',
        'simpleQadaMadeUp',
      ])
    );
  });

  it('is the documented first-run configuration', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      location: null,
      useAutoLocation: true,
      calculation: {
        method: 'auto',
        madhab: 'auto',
        highLatitudeRule: 'auto',
        offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
        hijriOffset: 0,
      },
      streakMode: 'soft',
      exemptionModeEnabled: false,
      exemptDaysPerMonth: 7,
      // Off — the note at sunrise arrives after Fajr's time has gone, so it is the one
      // reminder nobody can act on. It has to be asked for (D90).
      sunriseNoteEnabled: false,
      persistentNotificationEnabled: false,
      // Off — its iOS counterpart, the prayer-window Live Activity, is opt-in the same way (D27).
      liveActivityEnabled: false,
      // Off — pausing someone's music is only ever done because they asked for it (D96).
      pauseAudioEnabled: false,
      theme: 'system',
      language: 'system',
      qadaSetupCompleted: false,
      timeFormat: 'system',
      // On by default — the owner's decision; the opt-out lives in Settings → Support and the
      // configuration's diagnostic-only limits are pinned in services/telemetry.test.ts.
      crashReportingEnabled: true,
    });
  });

  it('defines a valid reminder block for all five prayers', () => {
    for (const prayer of PRAYERS) {
      const reminder = DEFAULT_SETTINGS.reminders[prayer];
      expect(reminder.adhanEnabled).toBe(true);
      expect(reminder.sound).toBe('system');
      expect(reminder.preReminderEnabled).toBe(false);
      expect(reminder.nudgeEnabled).toBe(true);
      expect(Number.isInteger(reminder.preReminderMinutes)).toBe(true);
      expect(reminder.preReminderMinutes).toBeGreaterThanOrEqual(MIN_PRE_REMINDER_MINUTES);
      expect(reminder.preReminderMinutes).toBeLessThanOrEqual(MAX_PRE_REMINDER_MINUTES);
    }
  });

  it('is deeply frozen, and createDefaultSettings hands out independent copies', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.calculation.offsets)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.reminders.fajr)).toBe(true);

    const a = createDefaultSettings();
    const b = createDefaultSettings();
    expect(a).toEqual(DEFAULT_SETTINGS);
    expect(a.reminders).not.toBe(b.reminders);
    a.calculation.offsets.fajr = 5;
    expect(b.calculation.offsets.fajr).toBe(0);
    expect(DEFAULT_SETTINGS.calculation.offsets.fajr).toBe(0);
  });

  it('survives its own sanitizer unchanged', () => {
    expect(sanitizeSettings(createDefaultSettings())).toEqual(createDefaultSettings());
  });

  it('is what a fresh store starts from', () => {
    const { store } = makeStore();
    expect(snapshot(store)).toEqual(createDefaultSettings());
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe('actions', () => {
  it('setLocation stores a location and clears it again', () => {
    const { store } = makeStore();
    const before = snapshot(store);

    store.getState().setLocation(LOCATION);
    expect(snapshot(store)).toEqual({ ...before, location: LOCATION });

    store.getState().setLocation(null);
    expect(snapshot(store)).toEqual(before);
  });

  it('setUseAutoLocation toggles only its flag', () => {
    const { store } = makeStore();
    const before = snapshot(store);
    store.getState().setUseAutoLocation(false);
    expect(snapshot(store)).toEqual({ ...before, useAutoLocation: false });
  });

  it('setCalculation merges a partial change and leaves the rest alone', () => {
    const { store } = makeStore();
    const before = snapshot(store);
    store.getState().setCalculation({ method: 'karachi', madhab: 'hanafi' });
    expect(snapshot(store)).toEqual({
      ...before,
      calculation: { ...before.calculation, method: 'karachi', madhab: 'hanafi' },
    });
  });

  it('setCalculation can carry offsets and clamps them', () => {
    const { store } = makeStore();
    store
      .getState()
      .setCalculation({ offsets: { ...createDefaultSettings().calculation.offsets, asr: 99 } });
    expect(store.getState().calculation.offsets.asr).toBe(MAX_PRAYER_OFFSET_MINUTES);
  });

  it('setPrayerOffset touches only that prayer', () => {
    const { store } = makeStore();
    const before = snapshot(store);
    store.getState().setPrayerOffset('maghrib', 4);
    expect(snapshot(store)).toEqual({
      ...before,
      calculation: {
        ...before.calculation,
        offsets: { ...before.calculation.offsets, maghrib: 4 },
      },
    });
  });

  it('setStreakMode, setExemptionModeEnabled and setQadaSetupCompleted are independent', () => {
    const { store } = makeStore();
    const before = snapshot(store);

    store.getState().setStreakMode('hard');
    expect(snapshot(store)).toEqual({ ...before, streakMode: 'hard' });

    store.getState().setExemptionModeEnabled(true);
    expect(snapshot(store)).toEqual({ ...before, streakMode: 'hard', exemptionModeEnabled: true });

    store.getState().setQadaSetupCompleted(true);
    expect(snapshot(store)).toEqual({
      ...before,
      streakMode: 'hard',
      exemptionModeEnabled: true,
      qadaSetupCompleted: true,
    });
  });

  it('setReminder patches one prayer only', () => {
    const { store } = makeStore();
    const before = snapshot(store);
    store.getState().setReminder('fajr', { sound: 'adhan', preReminderEnabled: true });
    expect(snapshot(store)).toEqual({
      ...before,
      reminders: {
        ...before.reminders,
        fajr: { ...before.reminders.fajr, sound: 'adhan', preReminderEnabled: true },
      },
    });
  });

  it('setAllReminders applies the patch to all five prayers', () => {
    const { store } = makeStore();
    store.getState().setAllReminders({ adhanEnabled: false, nudgeEnabled: false });
    for (const prayer of PRAYERS) {
      const reminder = store.getState().reminders[prayer];
      expect(reminder.adhanEnabled).toBe(false);
      expect(reminder.nudgeEnabled).toBe(false);
      // Untouched fields keep their defaults.
      expect(reminder.sound).toBe('system');
      expect(reminder.preReminderMinutes).toBe(
        DEFAULT_SETTINGS.reminders[prayer].preReminderMinutes
      );
    }
  });

  it('setSunriseNoteEnabled turns the sunrise note on and off, and touches nothing else', () => {
    const { store } = makeStore();
    const before = snapshot(store);
    expect(before.sunriseNoteEnabled).toBe(false);

    store.getState().setSunriseNoteEnabled(true);
    expect(snapshot(store)).toEqual({ ...before, sunriseNoteEnabled: true });

    // In particular it is not the last call: those five switches are untouched, which is the
    // whole point of giving the note a setting of its own (D90).
    expect(snapshot(store).reminders).toEqual(before.reminders);

    store.getState().setSunriseNoteEnabled(false);
    expect(snapshot(store)).toEqual(before);
  });

  it('setPersistentNotification, setTheme, setLanguage and setTimeFormat set exactly one field each', () => {
    const { store } = makeStore();
    const before = snapshot(store);

    store.getState().setPersistentNotification(true);
    store.getState().setPauseAudioEnabled(true);
    store.getState().setTheme('dark');
    store.getState().setLanguage('ar');
    store.getState().setTimeFormat('24h');

    expect(snapshot(store)).toEqual({
      ...before,
      persistentNotificationEnabled: true,
      pauseAudioEnabled: true,
      theme: 'dark',
      language: 'ar',
      timeFormat: '24h',
    });
  });

  it('setCrashReportingEnabled flips only its flag, and persists it', () => {
    const { store, storage } = makeStore();
    const before = snapshot(store);

    store.getState().setCrashReportingEnabled(false);

    expect(snapshot(store)).toEqual({ ...before, crashReportingEnabled: false });
    // The opt-out MUST survive a restart — it is read once at the next launch, so a value that
    // stayed in memory would silently re-enable reporting the user turned off.
    expect(storedPayload(storage).state.crashReportingEnabled).toBe(false);
  });

  it('resetToDefaults restores every field and persists the reset', () => {
    const { store, storage } = makeStore();
    store.getState().setLocation(LOCATION);
    store.getState().setTheme('dark');
    store.getState().setLanguage('tr');
    store.getState().setCalculation({ method: 'turkey', madhab: 'hanafi', hijriOffset: 2 });
    store.getState().setPrayerOffset('isha', -12);
    store.getState().setAllReminders({ adhanEnabled: false });
    store.getState().setExemptionModeEnabled(true);
    store.getState().setExemptDaysPerMonth(3);
    store.getState().setQadaSetupCompleted(true);
    store.getState().setStreakMode('hard');
    store.getState().setPersistentNotification(true);
    store.getState().setTimeFormat('12h');
    store.getState().setUseAutoLocation(false);
    expect(snapshot(store)).not.toEqual(createDefaultSettings());

    store.getState().resetToDefaults();

    expect(snapshot(store)).toEqual(createDefaultSettings());
    expect(storedPayload(storage).state).toEqual(createDefaultSettings());
    // The actions survive the reset.
    expect(typeof store.getState().setTheme).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

describe('clamping', () => {
  it('clamps prayer offsets at both bounds and rounds to whole minutes', () => {
    const { store } = makeStore();
    const { setPrayerOffset } = store.getState();

    setPrayerOffset('fajr', 999);
    expect(store.getState().calculation.offsets.fajr).toBe(MAX_PRAYER_OFFSET_MINUTES);

    setPrayerOffset('fajr', -999);
    expect(store.getState().calculation.offsets.fajr).toBe(-MAX_PRAYER_OFFSET_MINUTES);

    setPrayerOffset('fajr', MAX_PRAYER_OFFSET_MINUTES);
    expect(store.getState().calculation.offsets.fajr).toBe(MAX_PRAYER_OFFSET_MINUTES);

    setPrayerOffset('fajr', -MAX_PRAYER_OFFSET_MINUTES);
    expect(store.getState().calculation.offsets.fajr).toBe(-MAX_PRAYER_OFFSET_MINUTES);

    setPrayerOffset('fajr', 7.6);
    expect(store.getState().calculation.offsets.fajr).toBe(8);

    setPrayerOffset('fajr', 0);
    expect(store.getState().calculation.offsets.fajr).toBe(0);
  });

  it('leaves a prayer offset untouched when handed a non-finite number', () => {
    const { store } = makeStore();
    store.getState().setPrayerOffset('dhuhr', 10);
    store.getState().setPrayerOffset('dhuhr', Number.NaN);
    expect(store.getState().calculation.offsets.dhuhr).toBe(10);
    store.getState().setPrayerOffset('dhuhr', Number.POSITIVE_INFINITY);
    expect(store.getState().calculation.offsets.dhuhr).toBe(10);
  });

  it('clamps the Hijri offset to ±2 days', () => {
    const { store } = makeStore();
    const { setHijriOffset } = store.getState();

    setHijriOffset(9);
    expect(store.getState().calculation.hijriOffset).toBe(2);

    setHijriOffset(-9);
    expect(store.getState().calculation.hijriOffset).toBe(-2);

    setHijriOffset(2);
    expect(store.getState().calculation.hijriOffset).toBe(2);

    setHijriOffset(-2);
    expect(store.getState().calculation.hijriOffset).toBe(-2);

    setHijriOffset(0);
    expect(store.getState().calculation.hijriOffset).toBe(0);

    setHijriOffset(1);
    setHijriOffset(Number.NaN);
    expect(store.getState().calculation.hijriOffset).toBe(1);
  });

  it('startTravel and endTravel own the three travel fields together', () => {
    const { store } = makeStore();
    const { startTravel, endTravel } = store.getState();

    startTravel('2026-08-19', null);
    expect(snapshot(store)).toMatchObject({
      travelActive: true,
      travelStartDay: '2026-08-19',
      travelEndDay: null,
    });

    // A second call overwrites, which is also how a stale state gets cleaned up: nothing runs in
    // the background to do it.
    startTravel('2026-09-01', '2026-09-03');
    expect(snapshot(store)).toMatchObject({
      travelActive: true,
      travelStartDay: '2026-09-01',
      travelEndDay: '2026-09-03',
    });

    endTravel();
    expect(snapshot(store)).toMatchObject({
      travelActive: false,
      travelStartDay: null,
      travelEndDay: null,
    });
  });

  it('startTravel drops an unusable end day rather than the whole journey', () => {
    const { store } = makeStore();
    const { startTravel } = store.getState();

    // The user did say they were travelling; "until I end it" is the merciful reading.
    startTravel('2026-08-19', '2026-08-17');
    expect(snapshot(store)).toMatchObject({ travelActive: true, travelEndDay: null });

    startTravel('2026-08-19', 'not-a-day' as never);
    expect(snapshot(store)).toMatchObject({ travelActive: true, travelEndDay: null });
  });

  it('startTravel refuses a malformed start day, leaving travel as it was', () => {
    const { store } = makeStore();
    const { startTravel } = store.getState();

    startTravel('2026-02-30' as never, null);
    expect(snapshot(store)).toMatchObject({ travelActive: false, travelStartDay: null });
  });

  it('persists travel across a reload, and rebuilds a state that describes nothing', () => {
    const { store, storage } = makeStore();
    store.getState().startTravel('2026-08-19', '2026-08-21');

    const reloaded = createSettingsStore(storage).getState();
    expect(reloaded.travelActive).toBe(true);
    expect(reloaded.travelStartDay).toBe('2026-08-19');
    expect(reloaded.travelEndDay).toBe('2026-08-21');
  });

  it('reads a corrupt travel payload as OFF, never as travelling', () => {
    // The asymmetry that matters: travel wrongly off costs a correctly-late mark, travel wrongly
    // on would tell somebody a prayer counted on time when it did not.
    expect(
      sanitizeSettings({ travelActive: true, travelStartDay: null, travelEndDay: '2026-08-21' })
    ).toMatchObject({ travelActive: false, travelStartDay: null, travelEndDay: null });

    expect(
      sanitizeSettings({ travelActive: true, travelStartDay: 'nonsense', travelEndDay: null })
    ).toMatchObject({ travelActive: false });

    expect(
      sanitizeSettings({
        travelActive: true,
        travelStartDay: '2026-08-19',
        travelEndDay: '2026-08-17',
      })
    ).toMatchObject({ travelActive: false });

    // Active with a good start and a lost end stays travelling, open-ended.
    expect(
      sanitizeSettings({ travelActive: true, travelStartDay: '2026-08-19', travelEndDay: 7 })
    ).toMatchObject({ travelActive: true, travelStartDay: '2026-08-19', travelEndDay: null });
  });

  it('clamps exempt days per month at both bounds', () => {
    const { store } = makeStore();
    const { setExemptDaysPerMonth } = store.getState();

    setExemptDaysPerMonth(1000);
    expect(store.getState().exemptDaysPerMonth).toBe(MAX_EXEMPT_DAYS_PER_MONTH);

    setExemptDaysPerMonth(-4);
    expect(store.getState().exemptDaysPerMonth).toBe(MIN_EXEMPT_DAYS_PER_MONTH);

    setExemptDaysPerMonth(6.4);
    expect(store.getState().exemptDaysPerMonth).toBe(6);

    setExemptDaysPerMonth(Number.NaN);
    expect(store.getState().exemptDaysPerMonth).toBe(6);
  });

  it('clamps the last-call lead to its documented bounds', () => {
    const { store } = makeStore();
    const { setNudgeLeadMinutes } = store.getState();

    expect(store.getState().nudgeLeadMinutes).toBe(DEFAULT_NUDGE_LEAD_MINUTES);

    setNudgeLeadMinutes(1000);
    expect(store.getState().nudgeLeadMinutes).toBe(MAX_NUDGE_LEAD_MINUTES);

    setNudgeLeadMinutes(0);
    expect(store.getState().nudgeLeadMinutes).toBe(MIN_NUDGE_LEAD_MINUTES);

    setNudgeLeadMinutes(15.4);
    expect(store.getState().nudgeLeadMinutes).toBe(15);

    setNudgeLeadMinutes(Number.NaN);
    expect(store.getState().nudgeLeadMinutes).toBe(15);
  });

  it('rebuilds a stored lead that is out of range, rather than trusting it', () => {
    expect(sanitizeSettings({ nudgeLeadMinutes: 9999 }).nudgeLeadMinutes).toBe(
      MAX_NUDGE_LEAD_MINUTES
    );
    expect(sanitizeSettings({ nudgeLeadMinutes: 'soon' }).nudgeLeadMinutes).toBe(
      DEFAULT_NUDGE_LEAD_MINUTES
    );
    // A payload written before the field existed takes the default, like every other new field.
    expect(sanitizeSettings({}).nudgeLeadMinutes).toBe(DEFAULT_NUDGE_LEAD_MINUTES);
  });

  it('clamps pre-reminder minutes at both bounds', () => {
    const { store } = makeStore();

    store.getState().setReminder('fajr', { preReminderMinutes: 0 });
    expect(store.getState().reminders.fajr.preReminderMinutes).toBe(MIN_PRE_REMINDER_MINUTES);

    store.getState().setReminder('fajr', { preReminderMinutes: 10_000 });
    expect(store.getState().reminders.fajr.preReminderMinutes).toBe(MAX_PRE_REMINDER_MINUTES);

    store.getState().setAllReminders({ preReminderMinutes: -5 });
    for (const prayer of PRAYERS) {
      expect(store.getState().reminders[prayer].preReminderMinutes).toBe(MIN_PRE_REMINDER_MINUTES);
    }
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('persistence', () => {
  it('round-trips every field through storage into a new store', () => {
    const storage = createMemorySettingsStorage();
    const first = createSettingsStore(storage);

    first.getState().setLocation(LOCATION);
    first.getState().setUseAutoLocation(false);
    first.getState().setCalculation({
      method: 'jafari',
      madhab: 'hanafi',
      highLatitudeRule: 'twilightAngle',
      hijriOffset: -1,
    });
    first.getState().setPrayerOffset('asr', -3);
    first.getState().setStreakMode('hard');
    first.getState().setExemptionModeEnabled(true);
    first.getState().setExemptDaysPerMonth(5);
    first.getState().setReminder('isha', { sound: 'adhan', preReminderEnabled: true });
    first.getState().setAllReminders({ nudgeEnabled: false });
    first.getState().setSunriseNoteEnabled(true);
    first.getState().setPersistentNotification(true);
    first.getState().setTheme('light');
    first.getState().setLanguage('tr');
    first.getState().setQadaSetupCompleted(true);
    first.getState().setTimeFormat('12h');

    const second = createSettingsStore(storage);
    expect(snapshot(second)).toEqual(snapshot(first));
    expect(snapshot(second).location).toEqual(LOCATION);
    expect(snapshot(second).calculation.method).toBe('jafari');
    expect(snapshot(second).reminders.isha.sound).toBe('adhan');
  });

  it('writes the schema version alongside the state and persists no actions', () => {
    const { store, storage } = makeStore();
    store.getState().setTheme('dark');

    const payload = storedPayload(storage);
    expect(payload.version).toBe(SETTINGS_PERSIST_VERSION);
    expect(payload.state.theme).toBe('dark');
    expect(Object.keys(payload.state).sort()).toEqual([...SETTINGS_KEYS].sort());
  });

  it('fills fields that a stored payload does not know about yet', () => {
    // A payload written by an older build: no reminders, no timeFormat, no qada flag.
    const { store } = makeStore(
      seedWith({
        version: SETTINGS_PERSIST_VERSION,
        state: { theme: 'dark', language: 'ar', streakMode: 'hard' },
      })
    );

    expect(store.getState().theme).toBe('dark');
    expect(store.getState().language).toBe('ar');
    expect(store.getState().streakMode).toBe('hard');
    expect(store.getState().reminders).toEqual(DEFAULT_SETTINGS.reminders);
    expect(store.getState().timeFormat).toBe(DEFAULT_SETTINGS.timeFormat);
    expect(store.getState().qadaSetupCompleted).toBe(DEFAULT_SETTINGS.qadaSetupCompleted);
    expect(store.getState().calculation).toEqual(DEFAULT_SETTINGS.calculation);
  });

  it('migrates a payload from before crash reporting existed to the default, never undefined', () => {
    // An existing install that updates into the build that introduced `crashReportingEnabled`:
    // its stored payload has no such key. The field-by-field rebuild must land on the default
    // (true, the owner's on-by-default decision) — an `undefined` here would make the Settings
    // switch render off while telemetry read it as falsy, two different lies at once.
    const { store } = makeStore(
      seedWith({
        version: SETTINGS_PERSIST_VERSION,
        state: { theme: 'dark', language: 'tr', qadaSetupCompleted: true },
      })
    );

    expect(store.getState().crashReportingEnabled).toBe(true);
    // And a stored garbage value repairs to the default rather than poisoning the flag.
    expect(sanitizeSettings({ crashReportingEnabled: 'yes' }).crashReportingEnabled).toBe(true);
    expect(sanitizeSettings({ crashReportingEnabled: false }).crashReportingEnabled).toBe(false);
  });

  it('lands a corrupt or absent sunrise-note flag on off, never on', () => {
    // The failure that matters here is only in one direction. A payload written before the
    // setting existed, or one holding garbage, must not start sending a notification the user
    // never asked for — so every unusable value resolves to `false`, the shipped default.
    const { store } = makeStore(
      seedWith({ version: SETTINGS_PERSIST_VERSION, state: { theme: 'dark' } })
    );
    expect(store.getState().sunriseNoteEnabled).toBe(false);

    for (const value of ['yes', 1, 0, null, {}, []]) {
      expect(sanitizeSettings({ sunriseNoteEnabled: value }).sunriseNoteEnabled).toBe(false);
    }
    // A real stored value is believed, in both directions.
    expect(sanitizeSettings({ sunriseNoteEnabled: true }).sunriseNoteEnabled).toBe(true);
    expect(sanitizeSettings({ sunriseNoteEnabled: false }).sunriseNoteEnabled).toBe(false);
  });

  it('migrates a payload stamped with an older version instead of discarding the app', () => {
    const { store } = makeStore(
      seedWith({ version: 0, state: { theme: 'dark', exemptDaysPerMonth: 9 } })
    );
    expect(store.getState().theme).toBe('dark');
    expect(store.getState().exemptDaysPerMonth).toBe(9);
    expect(store.getState().reminders).toEqual(DEFAULT_SETTINGS.reminders);
  });

  it.each([
    ['unparseable text', 'this is not json'],
    ['a bare literal', 'null'],
    ['an array', '[]'],
    ['a numeric state', '{"state":42,"version":1}'],
    ['a string state', '{"state":"nope","version":1}'],
    ['a truncated object', '{"state":{"theme":"da'],
    ['an empty string', ''],
  ])('falls back to defaults for %s', (_label, raw) => {
    const { store } = makeStore({ [SETTINGS_STORAGE_KEY]: raw });
    expect(snapshot(store)).toEqual(createDefaultSettings());
  });

  it('repairs individual fields of a garbage-typed payload', () => {
    const { store } = makeStore(
      seedWith({
        version: SETTINGS_PERSIST_VERSION,
        state: {
          location: { latitude: 'nope', longitude: 12, label: 'X', source: 'auto', resolvedAt: 1 },
          useAutoLocation: 'yes',
          calculation: {
            method: 'not-a-method',
            madhab: 42,
            highLatitudeRule: null,
            offsets: { fajr: 900, dhuhr: 'x' },
            hijriOffset: 99,
          },
          streakMode: 'medium',
          exemptDaysPerMonth: -3,
          reminders: { fajr: { sound: 'trumpet', preReminderMinutes: 0 }, dhuhr: 5 },
          theme: 'neon',
          language: 'kl',
          timeFormat: '36h',
          qadaSetupCompleted: 'yes',
          somethingRemoved: true,
        },
      })
    );

    const state = snapshot(store);
    expect(state.location).toBeNull();
    expect(state.useAutoLocation).toBe(DEFAULT_SETTINGS.useAutoLocation);
    expect(state.calculation.method).toBe('auto');
    expect(state.calculation.madhab).toBe('auto');
    expect(state.calculation.highLatitudeRule).toBe('auto');
    expect(state.calculation.offsets.fajr).toBe(MAX_PRAYER_OFFSET_MINUTES);
    expect(state.calculation.offsets.dhuhr).toBe(0);
    expect(state.calculation.hijriOffset).toBe(2);
    expect(state.streakMode).toBe('soft');
    expect(state.exemptDaysPerMonth).toBe(MIN_EXEMPT_DAYS_PER_MONTH);
    expect(state.reminders.fajr.sound).toBe('system');
    expect(state.reminders.fajr.preReminderMinutes).toBe(MIN_PRE_REMINDER_MINUTES);
    expect(state.reminders.dhuhr).toEqual(DEFAULT_SETTINGS.reminders.dhuhr);
    expect(state.theme).toBe('system');
    expect(state.language).toBe('system');
    expect(state.timeFormat).toBe('system');
    expect(state.qadaSetupCompleted).toBe(false);
  });

  it('keeps a valid stored location, normalising its country code', () => {
    const { store } = makeStore(
      seedWith({
        version: SETTINGS_PERSIST_VERSION,
        state: { location: { ...LOCATION, countryCode: 'us', source: 'manual' } },
      })
    );
    expect(store.getState().location).toEqual({ ...LOCATION, countryCode: 'US', source: 'manual' });
  });

  it('starts on defaults when the storage backend throws', () => {
    const throwing: SettingsStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
      removeItem: () => {
        throw new Error('storage unavailable');
      },
    };

    const store = createSettingsStore(throwing);
    expect(snapshot(store)).toEqual(createDefaultSettings());
    expect(() => store.getState().setTheme('dark')).not.toThrow();
    expect(store.getState().theme).toBe('dark');
  });

  it('isolates stores that use different storage keys', () => {
    const storage = createMemorySettingsStorage();
    const a = createSettingsStore(storage, 'settings-a');
    const b = createSettingsStore(storage, 'settings-b');
    a.getState().setTheme('dark');
    expect(b.getState().theme).toBe('system');
    expect(createSettingsStore(storage, 'settings-a').getState().theme).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// sanitizeSettings / migrateSettings directly
// ---------------------------------------------------------------------------

describe('sanitizeSettings', () => {
  it.each([undefined, null, 0, 'x', [], true, () => undefined])(
    'returns the defaults for %p',
    (input) => {
      expect(sanitizeSettings(input)).toEqual(createDefaultSettings());
    }
  );

  it('returns a fresh mutable object every time', () => {
    const a = sanitizeSettings({});
    const b = sanitizeSettings({});
    expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(false);
    a.theme = 'dark';
    expect(b.theme).toBe('system');
  });

  it('drops unknown keys', () => {
    const result = sanitizeSettings({ theme: 'dark', legacyThing: 1 });
    expect(Object.keys(result).sort()).toEqual([...SETTINGS_KEYS].sort());
  });
});

describe('migrateSettings', () => {
  // D209: version 1 could not tell a chosen Shafi Asr from the untouched default, and the owner
  // chose to move every stored 'shafi' to 'auto'. A deliberate 'hanafi' stays.
  it('moves a version-1 Shafi Asr to auto, and keeps Hanafi', () => {
    const v1 = (madhab: string) => ({ calculation: { method: 'karachi', madhab } });
    expect(migrateSettings(v1('shafi'), 1).calculation).toMatchObject({
      method: 'karachi',
      madhab: 'auto',
    });
    expect(migrateSettings(v1('hanafi'), 1).calculation.madhab).toBe('hanafi');
    // A current payload is never rewritten: 'shafi' chosen after D209 is a real choice.
    expect(migrateSettings(v1('shafi'), 2).calculation.madhab).toBe('shafi');
  });

  it('migrates a stored version-1 payload end to end', () => {
    const { store } = makeStore(
      seedWith({ version: 1, state: { calculation: { method: 'auto', madhab: 'shafi' } } })
    );
    expect(store.getState().calculation.madhab).toBe('auto');
  });

  it('produces a complete settings object from any version', () => {
    expect(migrateSettings({ theme: 'dark' }, 0)).toEqual({
      ...createDefaultSettings(),
      theme: 'dark',
      // A payload written before `onboardingCompleted` existed comes from an install that has
      // already been used — see below.
      onboardingCompleted: true,
    });
    expect(migrateSettings(undefined, 99)).toEqual(createDefaultSettings());
  });

  /**
   * The one field whose migration is NOT "take the default".
   *
   * Every other new setting appears on an existing install with its shipped default, because the
   * question it answers ("what should this be?") has the same answer everywhere.
   * `onboardingCompleted` answers a different question — *has this person already set the app
   * up?* — and the existence of a stored payload is the answer. Getting this wrong would push
   * every existing user through a setup flow for choices they made months ago, which is exactly
   * the nag the flow is built not to be.
   */
  it('treats a payload written before the field existed as an already-set-up install', () => {
    expect(migrateSettings({ theme: 'dark' }, 0).onboardingCompleted).toBe(true);
    // A payload that DOES carry the field is believed, in both directions: someone who quit
    // half-way through setup resumes it on the next launch.
    expect(sanitizeSettings({ onboardingCompleted: false }).onboardingCompleted).toBe(false);
    expect(sanitizeSettings({ onboardingCompleted: true }).onboardingCompleted).toBe(true);
    // Nothing stored at all is a genuinely fresh install: the flow is offered.
    expect(sanitizeSettings(undefined).onboardingCompleted).toBe(false);
    expect(createDefaultSettings().onboardingCompleted).toBe(false);
  });
});

describe('tracking mode (D192)', () => {
  const ZERO = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };

  it('lands an existing persisted blob (no field) on detailed with nothing derived', () => {
    // A 1.4.x payload: a used install, with no idea tracking modes exist.
    const { store } = makeStore(
      seedWith({ state: { theme: 'dark', streakMode: 'hard', onboardingCompleted: true }, version: 1 })
    );
    expect(store.getState().trackingMode).toBe('detailed');
    expect(store.getState().simpleModeSince).toBeNull();
    expect(store.getState().simpleQadaMadeUp).toEqual(ZERO);
    expect(migrateSettings({ theme: 'dark' }, 0).trackingMode).toBe('detailed');
  });

  it('believes a stored mode and rejects garbage', () => {
    expect(sanitizeSettings({ trackingMode: 'simple' }).trackingMode).toBe('simple');
    expect(sanitizeSettings({ trackingMode: 'loud' }).trackingMode).toBe('detailed');
    expect(sanitizeSettings({ simpleModeSince: '2026-11-07' }).simpleModeSince).toBe('2026-11-07');
    expect(sanitizeSettings({ simpleModeSince: '2026-13-40' }).simpleModeSince).toBeNull();
    expect(
      sanitizeSettings({ simpleQadaMadeUp: { fajr: 2.7, dhuhr: -1, asr: 'x', maghrib: 3 } })
        .simpleQadaMadeUp
    ).toEqual({ fajr: 2, dhuhr: 0, asr: 0, maghrib: 3, isha: 0 });
  });

  it('starts simple mode fresh at today, and leaves it without touching anything', () => {
    const { store, storage } = makeStore();
    store.getState().setTrackingMode('simple', '2026-11-07');
    store.getState().setSimpleQadaMadeUp('asr', 2);
    expect(store.getState().simpleModeSince).toBe('2026-11-07');

    store.getState().setTrackingMode('detailed', '2026-11-09');
    expect(store.getState().trackingMode).toBe('detailed');
    expect(store.getState().simpleModeSince).toBe('2026-11-07');
    expect(store.getState().simpleQadaMadeUp.asr).toBe(2);

    // Re-choosing the mode in force does not restart it.
    store.getState().setTrackingMode('detailed', '2026-11-10');
    store.getState().setTrackingMode('simple', '2026-11-12');
    store.getState().setTrackingMode('simple', '2026-11-20');
    expect(store.getState().simpleModeSince).toBe('2026-11-12');
    expect(store.getState().simpleQadaMadeUp).toEqual(ZERO);
    expect(storedPayload(storage).state.trackingMode).toBe('simple');
  });

  it('clamps the made-up counter', () => {
    const { store } = makeStore();
    store.getState().setSimpleQadaMadeUp('fajr', -3);
    expect(store.getState().simpleQadaMadeUp.fajr).toBe(0);
    store.getState().setSimpleQadaMadeUp('fajr', 4.9);
    expect(store.getState().simpleQadaMadeUp.fajr).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// MMKV adapter + singleton
// ---------------------------------------------------------------------------

describe('MMKV-backed singleton', () => {
  afterEach(async () => {
    await act(() => useSettingsStore.getState().resetToDefaults());
  });

  it('round-trips through the MMKV adapter', () => {
    const storage = createMmkvSettingsStorage();
    expect(storage.getItem('probe')).toBeNull();
    storage.setItem('probe', 'value');
    expect(storage.getItem('probe')).toBe('value');
    storage.removeItem('probe');
    expect(storage.getItem('probe')).toBeNull();
  });

  it('hydrated synchronously at import time with valid settings', () => {
    expect(getSettingsSnapshot()).toEqual(createDefaultSettings());
  });

  it('exposes its actions outside React', async () => {
    await act(() => getSettingsActions().setLanguage('ar'));
    expect(getSettingsSnapshot().language).toBe('ar');
  });
});

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------

describe('selector hooks', () => {
  afterEach(async () => {
    await act(() => useSettingsStore.getState().resetToDefaults());
  });

  it('return their slice', async () => {
    const theme = await renderHook(() => useThemePreference());
    const language = await renderHook(() => useLanguagePreference());
    const calculation = await renderHook(() => useCalculationSettings());
    const reminders = await renderHook(() => useReminders());
    const fajr = await renderHook(() => usePrayerReminder('fajr'));

    expect(theme.result.current).toBe('system');
    expect(language.result.current).toBe('system');
    expect(calculation.result.current).toEqual(DEFAULT_SETTINGS.calculation);
    expect(reminders.result.current).toEqual(DEFAULT_SETTINGS.reminders);
    expect(fajr.result.current).toEqual(DEFAULT_SETTINGS.reminders.fajr);

    await act(() => useSettingsStore.getState().setTheme('dark'));
    expect(theme.result.current).toBe('dark');
  });

  it('do not re-render on unrelated settings changes', async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useThemePreference();
    });
    const initial = renders;

    await act(() => useSettingsStore.getState().setLanguage('ar'));
    await act(() => useSettingsStore.getState().setPrayerOffset('asr', 3));
    expect(renders).toBe(initial);

    await act(() => useSettingsStore.getState().setTheme('light'));
    expect(renders).toBeGreaterThan(initial);
    expect(result.current).toBe('light');
  });

  it('keep a per-prayer reminder stable when another prayer changes', async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return usePrayerReminder('fajr');
    });
    const initial = renders;

    await act(() => useSettingsStore.getState().setReminder('isha', { adhanEnabled: false }));
    expect(renders).toBe(initial);

    await act(() => useSettingsStore.getState().setReminder('fajr', { adhanEnabled: false }));
    expect(result.current.adhanEnabled).toBe(false);
  });

  it('useSettingsActions is shallow-stable across unrelated updates', async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useSettingsActions();
    });
    const initial = renders;
    const actions = result.current;

    await act(() => useSettingsStore.getState().setTheme('dark'));
    expect(renders).toBe(initial);
    expect(result.current).toBe(actions);
    expect(typeof actions.setReminder).toBe('function');
  });
});
