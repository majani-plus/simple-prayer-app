/**
 * The wiring between the app's state and the notification engine.
 *
 * The engine itself is covered in `services/notifications.test.ts`; what is tested here is the
 * part that decides *when* it runs — the five triggers of PRODUCT_SPEC §11 — and the two ways
 * that wiring can go wrong in a way no unit test of either side would see:
 *
 * 1. **A trigger that never fires.** A settings change nobody notices is a schedule that stays
 *    stale until the next foreground; a logged prayer nobody notices is a nudge that fires
 *    anyway, which is the single most irritating bug this feature can have.
 * 2. **A trigger that fires forever.** Reading a day through the tracking store bumps its
 *    revision, which wakes this hook, which reads more days… The signature helpers exist to
 *    close that loop, so the loop is what the tests aim at.
 *
 * The tracking store is mocked (it opens SQLite); the settings store is real, over an in-memory
 * MMKV, because the whole point is that a real `setReminder` call reaches the engine. The
 * subject is `startNotificationSync`, the controller the hook is a five-line wrapper around —
 * no renderer, no `act`, and therefore no argument about when React flushed what.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import {
  buildSyncInput,
  DEFAULT_SYNC_DEBOUNCE_MS,
  loggedStatusMap,
  newlyLoggedPrayers,
  rebuildNotificationsFromStores,
  reminderSignature,
  startNotificationSync,
  STARTUP_SYNC_DELAY_MS,
  syncNotificationsFromStores,
  trackingSignature,
} from './useNotificationSync';
import { notificationKey } from '@/domain/notificationPlan';
import { unloggedDayRecord } from '@/domain/streaks';
import { initI18n } from '@/i18n';
import {
  createFakeNotificationAdapter,
  createNotificationService,
  type FakeNotificationAdapter,
  type NotificationService,
} from '@/services/notifications';
import { DEFAULT_SETTINGS, useSettingsStore } from '@/stores/settingsStore';

import type { AppSettings, DayRecord, PrayerDay } from '@/domain/types';

jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));

/**
 * The one OS read the controller does for itself. Mocked because the real one reaches a native
 * module that no Jest run has, and because the interesting case is the *change* of answer — which
 * only a phone, or this, can produce.
 */
jest.mock('@/services/exactAlarms', () => ({
  readExactAlarmState: jest.fn(async () => 'exact'),
}));

jest.mock('react-native-mmkv', () => {
  const instances = new Map<string, Map<string, string>>();
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
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        remove: (key: string) => void store.delete(key),
        clearAll: () => store.clear(),
      };
    },
  };
});

/** A minimal stand-in for the tracking store: the same three reads, plus a way to push changes. */
jest.mock('@/stores/trackingStore', () => {
  const streaks = jest.requireActual<typeof import('@/domain/streaks')>('@/domain/streaks');

  let dayRecords: Record<string, ReturnType<typeof streaks.unloggedDayRecord>> = {};
  let exemptPeriods: { startDay: string; endDay: string | null; createdAt: number }[] = [];
  let today = '2026-08-19';
  const listeners = new Set<(mockNext: unknown, mockPrevious: unknown) => void>();

  const getState = () => ({
    dayRecords,
    exemptPeriods,
    todayDay: () => today,
    isExemptDay: (day: string) =>
      exemptPeriods.some(
        (period) => day >= period.startDay && (period.endDay === null || day <= period.endDay)
      ),
    dayRecordFor: (day: string) => dayRecords[day] ?? streaks.unloggedDayRecord(day),
  });

  return {
    useTrackingStore: {
      getState,
      subscribe: (listener: (mockNext: unknown, mockPrevious: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      __setToday: (day: string) => {
        today = day;
      },
      __push: (next: {
        dayRecords?: Record<string, ReturnType<typeof streaks.unloggedDayRecord>>;
        exemptPeriods?: { startDay: string; endDay: string | null; createdAt: number }[];
      }) => {
        const previous = getState();
        if (next.dayRecords !== undefined) dayRecords = next.dayRecords;
        if (next.exemptPeriods !== undefined) exemptPeriods = next.exemptPeriods;
        for (const listener of listeners) listener(getState(), previous);
      },
      __reset: () => {
        dayRecords = {};
        exemptPeriods = [];
        today = '2026-08-19';
        listeners.clear();
      },
    },
  };
});

const trackingMock = jest.requireMock('@/stores/trackingStore') as {
  useTrackingStore: {
    __push: (next: {
      dayRecords?: Record<string, DayRecord>;
      exemptPeriods?: { startDay: string; endDay: string | null; createdAt: number }[];
    }) => void;
    __reset: () => void;
    __setToday: (day: string) => void;
  };
};

const { router } = jest.requireMock('expo-router') as { router: { navigate: jest.Mock } };

const exactAlarmsMock = jest.requireMock('@/services/exactAlarms') as {
  readExactAlarmState: jest.Mock;
};

/** Accra — on the prime meridian and near the equator, so every prayer genuinely exists. */
const LOCATION: AppSettings['location'] = {
  latitude: 5.6037,
  longitude: -0.187,
  label: 'Accra',
  countryCode: 'GH',
  source: 'auto',
  resolvedAt: 0,
};

const TODAY: PrayerDay = '2026-08-19';

/** A service over the in-memory OS, with the two methods the hook drives spied on. */
function makeService(): {
  service: NotificationService;
  adapter: FakeNotificationAdapter;
  syncs: jest.Mock;
  cancels: jest.Mock;
} {
  const adapter = createFakeNotificationAdapter();
  const real = createNotificationService(adapter, {
    translate: (key) => key,
    formatClock: () => '05:00',
  });
  const syncs = jest.fn(real.sync);
  const cancels = jest.fn(real.clearForPrayer);
  return { adapter, syncs, cancels, service: { ...real, sync: syncs, clearForPrayer: cancels } };
}

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  trackingMock.useTrackingStore.__reset();
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, location: LOCATION });
  // The phone every other test in this file is holding: exactness is not the subject there, and
  // an answer that never changes can never trigger a rebuild.
  exactAlarmsMock.readExactAlarmState.mockResolvedValue('exact');
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((entry) => entry !== listener);
      },
    } as NativeEventSubscription;
  });
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-19T00:30:00.000Z'));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  router.navigate.mockReset();
});

/**
 * Runs the debounce out and drains the promise queue. The service awaits the fake OS once per
 * notification, so a single microtask turn is nowhere near enough.
 */
async function settle(ms = DEFAULT_SYNC_DEBOUNCE_MS + 200): Promise<void> {
  jest.advanceTimersByTime(ms);
  for (let turn = 0; turn < 400; turn += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('buildSyncInput', () => {
  const sources = {
    now: new Date('2026-08-19T00:30:00.000Z'),
    settings: { ...DEFAULT_SETTINGS, location: LOCATION },
    todayDay: TODAY,
    isExemptDay: () => false,
    statusesFor: () => ({}),
    locale: 'en',
  };

  it('covers the rolling window, times and Islamic midnights included', () => {
    const input = buildSyncInput({ ...sources, planDays: 3 });

    expect(input?.days.map((day) => day.day)).toEqual(['2026-08-19', '2026-08-20', '2026-08-21']);
    expect(input?.ishaNudgeTimes?.[TODAY]).toBeInstanceOf(Date);
    expect(input?.days[0].times.fajr.getTime()).toBeLessThan(
      input?.days[0].times.dhuhr.getTime() ?? 0
    );
    expect(input?.reminders).toBe(sources.settings.reminders);
    expect(input?.locale).toBe('en');
  });

  it('carries the sunrise-note setting, which ships off (D90)', () => {
    expect(buildSyncInput({ ...sources, planDays: 1 })?.sunriseNoteEnabled).toBe(false);
    expect(
      buildSyncInput({
        ...sources,
        planDays: 1,
        settings: { ...sources.settings, sunriseNoteEnabled: true },
      })?.sunriseNoteEnabled
    ).toBe(true);
  });

  it('is null with no location, because there is nothing to schedule', () => {
    expect(buildSyncInput({ ...sources, settings: { ...sources.settings, location: null } })).toBeNull();
  });

  it('is null rather than throwing when the engine cannot resolve the day', () => {
    const impossible = {
      ...sources,
      settings: {
        ...sources.settings,
        location: { ...LOCATION, latitude: 999 },
      } as AppSettings,
    };
    expect(buildSyncInput(impossible)).toBeNull();
  });

  it('carries the exempt days and the logged statuses through', () => {
    const input = buildSyncInput({
      ...sources,
      planDays: 2,
      isExemptDay: (day) => day === '2026-08-20',
      statusesFor: (day) => (day === TODAY ? { fajr: 'prayed' } : {}),
    });

    expect([...(input?.exemptDays ?? [])]).toEqual(['2026-08-20']);
    expect(input?.statuses[TODAY]).toEqual({ fajr: 'prayed' });
  });
});

describe('the change signatures', () => {
  const record = (day: PrayerDay, patch: Partial<DayRecord['statuses']> = {}): DayRecord => ({
    ...unloggedDayRecord(day),
    statuses: { ...unloggedDayRecord(day).statuses, ...patch },
  });

  it('ignores a day that was merely read into the cache', () => {
    const before = loggedStatusMap({});
    const after = loggedStatusMap({ [TODAY]: record(TODAY) });

    expect(after).toEqual({});
    expect(trackingSignature({ logged: before, exemptPeriods: [] })).toBe(
      trackingSignature({ logged: after, exemptPeriods: [] })
    );
  });

  it('sees a prayer being logged', () => {
    const after = loggedStatusMap({ [TODAY]: record(TODAY, { asr: 'late' }) });

    expect(after).toEqual({ [`${TODAY}:asr`]: 'late' });
    expect(newlyLoggedPrayers({}, after)).toEqual([{ day: TODAY, prayer: 'asr' }]);
  });

  it('does not re-announce a status that only changed', () => {
    const before = { [`${TODAY}:asr`]: 'prayed' as const };
    const after = { [`${TODAY}:asr`]: 'late' as const };
    expect(newlyLoggedPrayers(before, after)).toEqual([]);
  });

  it('sees an exempt period change', () => {
    expect(trackingSignature({ logged: {}, exemptPeriods: [] })).not.toBe(
      trackingSignature({
        logged: {},
        exemptPeriods: [{ startDay: TODAY, endDay: null }],
      })
    );
  });

  it('ignores settings that cannot move a notification', () => {
    const settings = { ...DEFAULT_SETTINGS, location: LOCATION };
    expect(reminderSignature({ ...settings, theme: 'dark', streakMode: 'hard' })).toBe(
      reminderSignature(settings)
    );
    expect(
      reminderSignature({
        ...settings,
        reminders: {
          ...settings.reminders,
          fajr: { ...settings.reminders.fajr, preReminderEnabled: true },
        },
      })
    ).not.toBe(reminderSignature(settings));
  });

  it('reschedules when the sunrise note is switched, on its own (D90)', () => {
    const settings = { ...DEFAULT_SETTINGS, location: LOCATION };

    // It is not a per-prayer reminder, so `settings.reminders` does not move with it — without
    // its own entry in the signature the toggle would reach the store and never reach the OS.
    expect(reminderSignature({ ...settings, sunriseNoteEnabled: true })).not.toBe(
      reminderSignature(settings)
    );
  });

  it('treats a change of recitation as a change of schedule', () => {
    const settings = { ...DEFAULT_SETTINGS, location: LOCATION };

    // Nothing is turned on or off by it, but every adhan reminder now names a different sound
    // file — and on Android rides a different channel — so it has to reach the OS on its own.
    expect(reminderSignature({ ...settings, adhanVoice: 'menk' })).not.toBe(
      reminderSignature(settings)
    );
  });
});

// ---------------------------------------------------------------------------
// The imperative entry point
// ---------------------------------------------------------------------------

describe('syncNotificationsFromStores', () => {
  it('reads the stores and reconciles the OS once', async () => {
    const { service, adapter } = makeService();

    const outcome = await syncNotificationsFromStores({ service, planDays: 2 });

    expect(outcome?.status).toBe('applied');
    expect(adapter.scheduled.size).toBeGreaterThan(0);
  });

  it('answers null when there is no location yet', async () => {
    useSettingsStore.setState({ location: null });
    const { service } = makeService();

    await expect(syncNotificationsFromStores({ service })).resolves.toBeNull();
  });
});

describe('rebuildNotificationsFromStores', () => {
  // Exactness is decided when an alarm is set and never revisited, so allowing exact alarms
  // (D91) can only reach reminders that are scheduled *again* — an ordinary sync sees an
  // unchanged plan and rightly leaves them alone.
  it('cancels what the OS holds and schedules the whole plan again', async () => {
    const { service, adapter } = makeService();
    await syncNotificationsFromStores({ service, planDays: 2 });
    const before = adapter.calls.schedule;
    expect(before).toBeGreaterThan(0);

    const outcome = await rebuildNotificationsFromStores({ service, planDays: 2 });

    expect(outcome?.status).toBe('applied');
    expect(adapter.calls.cancel).toBeGreaterThan(0);
    expect(adapter.calls.schedule).toBeGreaterThan(before);
    expect(adapter.scheduled.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

describe('startNotificationSync', () => {
  // The cold-start wait, which every other test in this file switches off (`startupDelayMs: 0`)
  // so the debounce is the only clock in play.
  describe('the cold start', () => {
    it('holds the first sync back well past the debounce', async () => {
      const { service, syncs } = makeService();
      const stop = startNotificationSync({ service, planDays: 2, navigate: null });

      await settle(DEFAULT_SYNC_DEBOUNCE_MS + 200);
      expect(syncs).not.toHaveBeenCalled();

      await settle(STARTUP_SYNC_DELAY_MS);
      expect(syncs).toHaveBeenCalledTimes(1);
      stop();
    });

    it('cancels it when the controller is stopped before it fires', async () => {
      const { service, syncs } = makeService();
      startNotificationSync({ service, planDays: 2, navigate: null })();

      await settle(STARTUP_SYNC_DELAY_MS + 1000);
      expect(syncs).not.toHaveBeenCalled();
    });

    it('absorbs a trigger that lands inside the wait — one sync, at the wait, with the change in it', async () => {
      // Hydrating the tracking store IS such a trigger (the logged-prayer signature changes on
      // every launch that has data), so a trigger that cancelled the wait would defeat it for
      // exactly the users it exists for.
      const { service, syncs } = makeService();
      const stop = startNotificationSync({ service, planDays: 2, navigate: null });

      useSettingsStore.getState().setReminder('fajr', { preReminderEnabled: true });
      await settle(DEFAULT_SYNC_DEBOUNCE_MS + 200);
      expect(syncs).not.toHaveBeenCalled();

      await settle(STARTUP_SYNC_DELAY_MS);
      expect(syncs).toHaveBeenCalledTimes(1);
      // The sync read the stores when it ran, so the change made during the wait is in it.
      expect(syncs.mock.calls[0]?.[0].reminders.fajr.preReminderEnabled).toBe(true);

      // …and nothing else is pending.
      await settle(STARTUP_SYNC_DELAY_MS + 1000);
      expect(syncs).toHaveBeenCalledTimes(1);
      stop();
    });
  });

  it('syncs once when it starts', async () => {
    const { service, syncs, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });

    await settle();

    expect(syncs).toHaveBeenCalledTimes(1);
    expect(adapter.scheduled.size).toBeGreaterThan(0);
    stop();
  });

  it('coalesces a burst of changes into one sync', async () => {
    const { service, syncs } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    const actions = useSettingsStore.getState();
    actions.setReminder('fajr', { preReminderEnabled: true });
    actions.setReminder('dhuhr', { nudgeEnabled: false });
    actions.setReminder('asr', { sound: 'adhan' });
    await settle();

    expect(syncs).toHaveBeenCalledTimes(1);
    stop();
  });

  it('syncs when the app comes back to the foreground', async () => {
    const { service, syncs } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    for (const listener of appStateListeners) listener('background');
    await settle();
    expect(syncs).not.toHaveBeenCalled();

    for (const listener of appStateListeners) listener('active');
    await settle();
    expect(syncs).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores a settings change that cannot move a notification', async () => {
    const { service, syncs } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    useSettingsStore.getState().setTheme('dark');
    await settle();

    expect(syncs).not.toHaveBeenCalled();
    stop();
  });

  it('reschedules everything when the location changes', async () => {
    const { service, syncs, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    const before = adapter.scheduled.get(notificationKey('adhan', TODAY, 'dhuhr'))?.fireAt;
    syncs.mockClear();

    useSettingsStore
      .getState()
      .setLocation({ ...LOCATION, latitude: 41.01, longitude: 28.98, label: 'Istanbul' });
    await settle();

    expect(syncs).toHaveBeenCalledTimes(1);
    const after = adapter.scheduled.get(notificationKey('adhan', TODAY, 'dhuhr'))?.fireAt;
    expect(after?.getTime()).not.toBe(before?.getTime());
    stop();
  });

  it('cancels a logged prayer’s nudge at once, without waiting for the debounce', async () => {
    const { service, cancels, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    const nudge = notificationKey('nudge', TODAY, 'asr');
    expect(adapter.scheduled.has(nudge)).toBe(true);

    trackingMock.useTrackingStore.__push({
      dayRecords: {
        [TODAY]: {
          ...unloggedDayRecord(TODAY),
          statuses: { ...unloggedDayRecord(TODAY).statuses, asr: 'prayed' },
        },
      },
    });
    expect(cancels).toHaveBeenCalledWith(TODAY, 'asr');

    await settle();
    expect(adapter.scheduled.has(nudge)).toBe(false);
    expect(adapter.scheduled.has(notificationKey('adhan', TODAY, 'asr'))).toBe(true);
    stop();
  });

  it('does not re-sync when a day is merely read into the cache', async () => {
    const { service, syncs } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    trackingMock.useTrackingStore.__push({
      dayRecords: { '2026-08-20': unloggedDayRecord('2026-08-20') },
    });
    await settle();

    expect(syncs).not.toHaveBeenCalled();
    stop();
  });

  it('re-syncs when a day becomes exempt', async () => {
    const { service, syncs, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    trackingMock.useTrackingStore.__push({
      exemptPeriods: [{ startDay: TODAY, endDay: null, createdAt: 0 }],
    });
    await settle();

    expect(syncs).toHaveBeenCalledTimes(1);
    expect([...adapter.scheduled.keys()].some((key) => key.includes(TODAY))).toBe(false);
    stop();
  });

  it('routes a notification tap to the url it carries', async () => {
    const { service, adapter } = makeService();
    const seen: string[] = [];
    const stop = startNotificationSync({
      service,
      planDays: 2,
      navigate: (url) => seen.push(url),
      startupDelayMs: 0,
    });
    await settle();

    adapter.emitTap({ url: '/', payload: null });

    expect(seen).toEqual(['/']);
    stop();
  });

  it('syncs again when the day rolls over', async () => {
    const { service, syncs } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    // Accra's Fajr is around 04:40 UTC; step past it in chunks the controller re-arms on.
    for (let minute = 0; minute < 300; minute += 5) {
      await settle(5 * 60 * 1000);
    }

    expect(syncs).toHaveBeenCalled();
    stop();
  });

  it('leaves no timer and no subscription behind', async () => {
    const { service, syncs } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    stop();

    expect(appStateListeners).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
    useSettingsStore.getState().setReminder('fajr', { preReminderEnabled: true });
    trackingMock.useTrackingStore.__push({
      dayRecords: {
        [TODAY]: {
          ...unloggedDayRecord(TODAY),
          statuses: { ...unloggedDayRecord(TODAY).statuses, fajr: 'prayed' },
        },
      },
    });
    await settle();
    expect(syncs).not.toHaveBeenCalled();
  });

  it('does nothing at all without a location', async () => {
    useSettingsStore.setState({ location: null });
    const { service, syncs, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });

    await settle();

    expect(syncs).not.toHaveBeenCalled();
    expect(adapter.scheduled.size).toBe(0);
    stop();
  });

  /**
   * The refusal that comes back. Someone taps "Don't allow", lives without reminders for a week,
   * then turns notifications on in the OS settings — and never opens the Reminders screen again,
   * because as far as they are concerned they have already fixed it. Nothing in the app is told;
   * the only signal is the app coming back to the foreground, so that has to be enough.
   */
  it('schedules on the next foreground when the OS permission is granted from settings', async () => {
    const { service, adapter } = makeService();
    adapter.config.permission = { status: 'denied', granted: false, canAskAgain: false };

    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    expect(adapter.scheduled.size).toBe(0);

    // Granted in the system settings; the app was in the background the whole time.
    adapter.config.permission = { status: 'granted', granted: true, canAskAgain: true };
    for (const listener of appStateListeners) listener('active');
    await settle();

    expect(adapter.scheduled.size).toBeGreaterThan(0);
    stop();
  });

  /**
   * Settings changed with no connection, then the process is killed before anything could settle
   * — a swipe-away, an OEM task-killer, a low-memory kill. On the next launch the OS is still
   * holding the OLD schedule, and the fix must be a diff, not a teardown: reminders that are still
   * correct are never taken away and given back, and a launch with nothing to do costs zero calls.
   */
  it('converges after a change made while it was not running, without a cancel-all storm', async () => {
    const { service, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    const held = adapter.scheduled.size;
    expect(held).toBeGreaterThan(0);
    stop();

    // Offline is irrelevant to any of this: times are computed locally and MMKV writes are sync.
    useSettingsStore.getState().setAllReminders({ sound: 'adhan' });
    const cancelsBefore = adapter.calls.cancel;

    startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 })();
    const relaunch = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();

    // Only the adhan requests carry the sound, so only those may move; the pre-reminders and
    // nudges are unaffected and must not have been touched at all.
    const adhanCount = [...adapter.scheduled.keys()].filter((key) =>
      key.startsWith('adhan:')
    ).length;
    expect(adapter.calls.cancel - cancelsBefore).toBe(adhanCount);
    for (const [identifier, request] of adapter.scheduled) {
      expect(request.identifier).toBe(identifier);
      expect(request.data.key).toBe(identifier);
      if (request.data.kind === 'adhan') expect(request.data.sound).toBe('adhan');
    }
    relaunch();

    // A launch with nothing changed is free — which is what makes it safe on every cold start.
    const cancels = adapter.calls.cancel;
    const schedules = adapter.calls.schedule;
    const idle = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    expect(adapter.calls.cancel).toBe(cancels);
    expect(adapter.calls.schedule).toBe(schedules);
    idle();
  });

  /**
   * A period of exemption is not one day (PRODUCT_SPEC §6). Nothing at all may be scheduled across
   * it — not the adhan, not the pre-reminder, not the nudge — and the schedule has to come back by
   * itself when the period ends, because nobody re-opens Settings to ask for their reminders back.
   */
  /**
   * The owner's "I'm seeing a clutter of notifications, seems old ones aren't being cleared", end
   * to end. Two things had to be true for that wall to build up: the sweep only ran on a sync, and
   * the sweep declined to judge any day outside the plan's horizon — which, since the horizon
   * starts at today, meant every day the user had missed. Both are fixed here, so a reminder
   * arriving is enough to take the whole backlog out of the tray.
   */
  it('clears a backlog from days gone by the moment a new reminder arrives', async () => {
    const { service, adapter, syncs } = makeService();

    /** A notification the OS has already delivered and is still showing. */
    const put = (kind: string, day: PrayerDay, prayer: string, fireAt: string): string => {
      const key = `${kind}:${day}:${prayer}`;
      adapter.presented.set(key, {
        identifier: key,
        title: key,
        body: key,
        sound: null,
        data: {
          key,
          kind,
          prayer,
          day,
          fireAt: new Date(fireAt).getTime(),
          sound: 'system',
          voice: null,
          lang: 'en',
          url: '/',
        },
      });
      return key;
    };

    const backlog = [
      put('adhan', '2026-08-17', 'dhuhr', '2026-08-17T12:20:00.000Z'),
      put('nudge', '2026-08-17', 'isha', '2026-08-18T00:10:00.000Z'),
      put('adhan', '2026-08-18', 'maghrib', '2026-08-18T18:20:00.000Z'),
    ];
    // Today's Fajr reminder: its window is still open, so it is the one thing worth seeing.
    const live = put('adhan', TODAY, 'fajr', '2026-08-19T04:40:00.000Z');

    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    // Nothing has been logged and no setting has moved — only a reminder landing in the tray.
    adapter.emitReceived({
      payload: {
        key: live,
        kind: 'adhan',
        prayer: 'fajr',
        day: TODAY,
        fireAt: new Date('2026-08-19T04:40:00.000Z').getTime(),
        sound: 'system',
        voice: null,
        lang: 'en',
        url: '/',
      },
    });
    await settle();

    expect(syncs).toHaveBeenCalledTimes(1);
    for (const key of backlog) expect(adapter.presented.has(key)).toBe(false);
    expect(adapter.presented.has(live)).toBe(true);
    stop();
  });

  it('does not sync itself in a circle when it posts the ongoing notification', async () => {
    const { service, adapter, syncs } = makeService();
    useSettingsStore.getState().setPersistentNotification(true);
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    syncs.mockClear();

    // What the OS hands back for the ongoing notification: our own, but carrying no plan payload.
    adapter.emitReceived({ payload: null });
    await settle();

    expect(syncs).not.toHaveBeenCalled();
    stop();
  });

  it('schedules nothing across a multi-day exempt period, and repairs when it ends', async () => {
    const exemptDays = ['2026-08-19', '2026-08-20', '2026-08-21'];
    const { service, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 5, navigate: null, startupDelayMs: 0 });
    await settle();
    const full = adapter.scheduled.size;

    trackingMock.useTrackingStore.__push({
      exemptPeriods: [{ startDay: exemptDays[0], endDay: exemptDays[2], createdAt: 0 }],
    });
    await settle();

    expect(
      [...adapter.scheduled.keys()].filter((key) => exemptDays.some((day) => key.includes(day)))
    ).toEqual([]);
    expect(adapter.scheduled.size).toBeLessThan(full);

    // The period is ended early (the user marked it over). The days behind it come straight back.
    trackingMock.useTrackingStore.__push({
      exemptPeriods: [{ startDay: exemptDays[0], endDay: exemptDays[0], createdAt: 0 }],
    });
    await settle();

    expect(adapter.scheduled.has(notificationKey('adhan', exemptDays[1], 'dhuhr'))).toBe(true);
    expect(adapter.scheduled.has(notificationKey('adhan', exemptDays[0], 'dhuhr'))).toBe(false);
    stop();
  });
});

// ---------------------------------------------------------------------------
// Exact alarms (D91)
// ---------------------------------------------------------------------------

/**
 * An Android alarm's exactness is fixed when it is armed and never revisited, so allowing
 * "Alarms & reminders" reaches nothing that is already waiting. The reliability screen has always
 * repaired that for the user who grants it through its own button; this is the same repair for
 * every other way to the same switch — Android's own Settings app, most of all. Without it,
 * "I allowed it and Fajr was still late" is the expected outcome for days.
 */
describe('the exact-alarm answer changing under it', () => {
  it('rebuilds the whole schedule the first time the phone says yes', async () => {
    exactAlarmsMock.readExactAlarmState.mockResolvedValue('inexact');
    const { service, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();

    const scheduledWhileInexact = adapter.calls.schedule;
    expect(scheduledWhileInexact).toBeGreaterThan(0);
    expect(adapter.calls.cancel).toBe(0);

    // The user allows it in Android's Settings app — not through our button — and comes back.
    exactAlarmsMock.readExactAlarmState.mockResolvedValue('exact');
    for (const listener of appStateListeners) listener('active');
    await settle();

    // Cancelled and re-armed, so the new alarms are set exactly. An ordinary sync would have done
    // nothing at all here: the plan is identical.
    expect(adapter.calls.cancel).toBeGreaterThan(0);
    expect(adapter.calls.schedule).toBeGreaterThan(scheduledWhileInexact);
    expect(adapter.scheduled.size).toBeGreaterThan(0);
    stop();
  });

  it('costs nothing on the ordinary foreground, where the answer has not moved', async () => {
    exactAlarmsMock.readExactAlarmState.mockResolvedValue('inexact');
    const { service, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    const writes = adapter.calls.schedule;

    for (const listener of appStateListeners) listener('active');
    await settle();

    expect(adapter.calls.cancel).toBe(0);
    expect(adapter.calls.schedule).toBe(writes);
    stop();
  });

  it('does not rebuild on the very first read, however good the answer is', async () => {
    // A phone that has always allowed exact alarms, and every launch on iOS. There is no earlier
    // answer to have improved on, and a rebuild on every cold start would throw away a correct
    // schedule for nothing.
    exactAlarmsMock.readExactAlarmState.mockResolvedValue('exact');
    const { service, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();

    expect(adapter.calls.cancel).toBe(0);
    expect(adapter.calls.schedule).toBeGreaterThan(0);
    stop();
  });

  it('leaves the schedule alone when the phone cannot be asked at all', async () => {
    // A build with no native module answers `unknown`. Neither `unknown` → `exact` nor anything
    // else is the transition that matters, and inventing one would rewrite the schedule on a
    // foreground for no reason.
    exactAlarmsMock.readExactAlarmState.mockResolvedValue('unknown');
    const { service, adapter } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });
    await settle();
    const writes = adapter.calls.schedule;

    exactAlarmsMock.readExactAlarmState.mockResolvedValue('exact');
    for (const listener of appStateListeners) listener('active');
    await settle();

    expect(adapter.calls.cancel).toBe(0);
    expect(adapter.calls.schedule).toBe(writes);
    stop();
  });

  it('reads it at the cold-start sync too, not only on a later foreground', async () => {
    exactAlarmsMock.readExactAlarmState.mockClear();
    const { service } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null });

    await settle(STARTUP_SYNC_DELAY_MS + DEFAULT_SYNC_DEBOUNCE_MS);

    expect(exactAlarmsMock.readExactAlarmState).toHaveBeenCalled();
    stop();
  });

  it('survives a platform read that throws', async () => {
    exactAlarmsMock.readExactAlarmState.mockRejectedValue(new Error('binder died'));
    const { service, syncs } = makeService();
    const stop = startNotificationSync({ service, planDays: 2, navigate: null, startupDelayMs: 0 });

    await settle();

    expect(syncs).toHaveBeenCalledTimes(1);
    stop();
  });
});
